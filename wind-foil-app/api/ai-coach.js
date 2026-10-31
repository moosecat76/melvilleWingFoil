/**
 * api/ai-coach.js
 *
 * Vercel Serverless Function (& Vite dev middleware endpoint): /api/ai-coach
 *
 * Implements Phase 5 (AI Foil Coach) using the official @google/genai SDK
 * and the Interactions API (`client.interactions.create`):
 *   - Mode 'extract_tags'    -> gemini-3.5-flash-lite (Structured Note Mining)
 *   - Mode 'session_debrief' -> gemini-3.8-flash      (Post-Session Coaching Debrief)
 *   - Mode 'game_plan'       -> gemini-3.5-flash-lite (Pre-Session Coach's Game Plan)
 */
import { GoogleGenAI } from '@google/genai';

const DEFAULT_ALLOWED_ORIGINS = new Set([
    'https://melvillewingfoil.vercel.app',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
]);

function isAllowedOrigin(origin) {
    if (!origin) return true; // Same-origin requests without Origin header
    if (DEFAULT_ALLOWED_ORIGINS.has(origin)) return true;
    const extra = process.env.ALLOWED_ORIGIN;
    if (extra && extra.split(',').map(s => s.trim()).includes(origin)) return true;
    return false;
}

/**
 * Verifies a Firebase Auth ID token via Google Identity Toolkit when using the server's GEMINI_API_KEY.
 */
async function verifyFirebaseIdToken(authHeader) {
    if (!authHeader || !String(authHeader).startsWith('Bearer ')) {
        return { valid: false, reason: 'missing_token' };
    }
    const idToken = String(authHeader).slice(7).trim();
    const firebaseApiKey = process.env.VITE_FIREBASE_API_KEY;
    if (!firebaseApiKey) {
        return { valid: false, reason: 'missing_firebase_config' };
    }

    try {
        const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken }),
        });
        if (!resp.ok) return { valid: false, reason: 'invalid_token' };
        const data = await resp.json();
        const account = data?.users?.[0];
        if (!account?.localId) return { valid: false, reason: 'invalid_user' };

        const allowedEmailsRaw = process.env.ALLOWED_USER_EMAIL || process.env.VITE_ALLOWED_USER_EMAIL;
        if (allowedEmailsRaw) {
            const allowedList = allowedEmailsRaw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
            const userEmail = (account.email || '').toLowerCase();
            if (allowedList.length > 0 && !allowedList.includes(userEmail)) {
                return { valid: false, reason: 'unauthorized_email' };
            }
        }
        return { valid: true, uid: account.localId, email: account.email };
    } catch {
        return { valid: false, reason: 'verification_failed' };
    }
}

const TAGS_JSON_SCHEMA = {
    type: 'object',
    properties: {
        powerState: {
            type: 'string',
            enum: ['underpowered', 'dialed', 'slightly_overpowered', 'overpowered'],
            description: 'Rider power state based on notes, wind, and gear.'
        },
        wingSizeSentiment: {
            type: 'string',
            enum: ['wish_smaller', 'just_right', 'wish_larger'],
            description: 'Whether the rider felt their wing was too big, just right, or too small.'
        },
        foilSentiment: {
            type: 'string',
            enum: ['lift_early', 'too_slow', 'breaching', 'balanced'],
            description: 'How the hydrofoil behaved during the session.'
        },
        fatigue: {
            type: 'string',
            enum: ['fresh', 'moderate', 'exhausted'],
            description: 'Rider physical fatigue level inferred from notes and heart rate/endurance.'
        },
        breakthrough: {
            type: ['string', 'null'],
            description: 'Short 3-8 word summary of a milestone or breakthrough if mentioned, otherwise null.'
        }
    },
    required: ['powerState', 'wingSizeSentiment', 'foilSentiment', 'fatigue', 'breakthrough']
};

const DEBRIEF_JSON_SCHEMA = {
    type: 'object',
    properties: {
        headline: {
            type: 'string',
            description: 'A concise 1-sentence headline summarizing performance, noting the chronological session number and progression stage when provided (e.g. Session #4 of 42 • Novice Stage).'
        },
        whatWentWell: {
            type: 'string',
            description: 'Specific positive insights calibrated to the rider progression stage at this specific session number, directly engaging with and validating the rider written commentary/self-analysis against telemetry (flights, gybe %, speed, or HR efficiency).'
        },
        tuningRecommendation: {
            type: 'string',
            description: 'Actionable wing foiling gear advice (wing PSI, foil mast track position in cm, stabilizer shim, or wing/foil sizing), directly addressing any gear feedback, feel, or tuning experiments the rider described in their commentary. Inflatable wings have NO outhauls or downhauls.'
        },
        techniqueFocus: {
            type: 'string',
            description: 'Concrete technique drill or focus appropriate for their progression stage, building directly upon the self-analysis, challenges, or breakthroughs mentioned in the rider commentary.'
        }
    },
    required: ['headline', 'whatWentWell', 'tuningRecommendation', 'techniqueFocus']
};

const GAME_PLAN_JSON_SCHEMA = {
    type: 'object',
    properties: {
        briefing: {
            type: 'string',
            description: 'A punchy 2-sentence pre-session Coach Game Plan synthesizing wind, gusts, tide, recommended setup, past sessions at this spot, and recent coaching analysis.'
        },
        gearTip: {
            type: 'string',
            description: 'One short sentence on wing foiling rigging adjustment (wing PSI on leading edge/strut, foil mast track position in cm, or stabilizer shim) for the forecasted gust spread and tide. Inflatable wings have NO outhauls or downhauls — never mention outhauls or windsurfing terms.'
        },
        keyFocus: {
            type: 'string',
            description: 'One short tactical focus for the water today, connecting to the rider recent session debrief focus if available.'
        }
    },
    required: ['briefing', 'gearTip', 'keyFocus']
};

export default async function handler(req, res) {
    const origin = req.headers?.origin || '';
    if (origin && !isAllowedOrigin(origin)) {
        return res.status(403).json({ error: 'Origin not allowed' });
    }
    if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-gemini-api-key');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const headerKey = req.headers?.['x-gemini-api-key'];
    const userProvidedKey = headerKey && String(headerKey).trim();
    const serverKey = process.env.GEMINI_API_KEY;

    // If relying on the server's GEMINI_API_KEY, require an authenticated Firebase user
    if (!userProvidedKey && serverKey) {
        const authCheck = await verifyFirebaseIdToken(req.headers?.authorization);
        if (!authCheck.valid) {
            return res.status(200).json({
                fallback: true,
                reason: 'unauthenticated',
                message: 'Sign in required to use server Gemini API key; using local deterministic coach.'
            });
        }
    }

    const apiKey = userProvidedKey || serverKey;

    if (!apiKey) {
        return res.status(200).json({
            fallback: true,
            reason: 'missing_api_key',
            message: 'GEMINI_API_KEY not configured on server; using local deterministic coach.'
        });
    }

    const { mode, payload } = req.body || {};
    if (!mode || !payload) {
        return res.status(400).json({ error: 'Missing mode or payload' });
    }

    try {
        const client = new GoogleGenAI({ apiKey });

        let model = 'gemini-3.5-flash-lite';
        let systemInstruction = '';
        let schema = TAGS_JSON_SCHEMA;

        if (mode === 'extract_tags') {
            model = 'gemini-3.5-flash-lite';
            schema = TAGS_JSON_SCHEMA;
            systemInstruction =
                'You are an expert wing-foiling and wind-foiling telemetry analyst. ' +
                'Analyze the compact session summary and rider notes to extract structured equipment and physical sentiment tags. ' +
                'Be accurate and grounded in wing/wind foil physics.';
        } else if (mode === 'session_debrief') {
            model = 'gemini-3.8-flash';
            schema = DEBRIEF_JSON_SCHEMA;
            systemInstruction =
                'You are an elite Wing Foil Coach analyzing a rider session summary. ' +
                'CRITICAL EQUIPMENT & RIGGING RULES: ' +
                '1. The sport is strictly WING FOILING (handheld inflatable wing and hydrofoil board). ' +
                '2. Inflatable wings DO NOT HAVE outhauls, downhauls, booms with outhauls, or sail battens! NEVER advise adjusting outhaul or downhaul. ' +
                '3. Wing foiling tuning consists strictly of: ' +
                '   - Inflatable wing: inflation pressure (PSI) on the leading edge and strut (e.g. pump to full spec PSI for canopy rigidity in gusts, standard PSI for low-end grunt), harness line position, or wing size (m²). ' +
                '   - Hydrofoil & board: foil mast position in the bottom twin US box tracks (slide forward 0.5-1 cm for early lift / light wind; slide back 0.5-1 cm for high-wind gust control), stabilizer shim angle (0° or -0.5° for high speed/control, +0.5° for early lift), and front wing area (cm²). ' +
                'CHRONOLOGICAL SESSION CONTEXT & OUT-OF-SEQUENCE ANALYSIS: ' +
                '4. Note `sessionNumber`, `totalSessions`, and `priorSessionsCount` in the payload. ' +
                '   The user may analyze an older session out of chronological order (e.g. analyzing Session #4 when they currently have 40 sessions logged). ' +
                '   Calibrate your tone, praise, and technical expectations strictly to their progression stage at THAT specific session number: ' +
                '   - Sessions 1-5 (Novice): Celebrate first flights, taxi-to-foil pop-ups, pitch control, and board trim. Do not expect dry gybes. ' +
                '   - Sessions 6-20 (Early Progression): Sustained flights, touch-and-go recovery, initial carving entries. ' +
                '   - Sessions 21-50 (Intermediate): Dry foiling gybes, foot switches, building upwind VMG and swell glides. ' +
                '   - Sessions 50+ (Advanced): High-speed carving, swell linking, tacks, efficiency. ' +
                '5. If `recentAnalysis` or `priorRecentSessions` are provided, acknowledge how this session built upon their previous focus areas. ' +
                'RIDER COMMENTARY & SELF-ANALYSIS (HIGH PRIORITY): ' +
                '6. The rider frequently includes their own post-session analysis, sensations, tuning changes, and reflections in `notes`. ' +
                '   Treat the rider commentary as first-class input: ' +
                '   - Directly acknowledge, validate, and respond to their self-analysis in the debrief (e.g. "You noted feeling...", "As you observed in your commentary..."). ' +
                '   - Reconcile their subjective feeling with their objective telemetry metrics (e.g. comparing what they felt in turns or gusts against speed, flight %, and HR). ' +
                '   - Answer any questions, gear experiments, or technique struggles they reflected on. ' +
                'Provide a sharp, encouraging, highly specific 3-part debrief: ' +
                '1) What Went Well (cite exact metrics and validate the rider written self-analysis), ' +
                '2) Tuning Recommendation (strictly wing foiling mechanics: wing PSI, foil mast track position in cm, stabilizer shim, or foil/wing sizing, addressing any gear feelings mentioned in their notes), ' +
                '3) Technique Focus for Next Session (concrete drill directly tackling the focus areas from their self-analysis).';
        } else if (mode === 'game_plan') {
            model = 'gemini-3.5-flash-lite';
            schema = GAME_PLAN_JSON_SCHEMA;
            systemInstruction =
                'You are an elite Wing Foil Coach giving a concise dockside pre-session briefing. ' +
                'CRITICAL EQUIPMENT RULES: ' +
                '1. The sport is WING FOILING (handheld inflatable wing and hydrofoil board). ' +
                '2. Inflatable wings DO NOT HAVE outhauls, downhauls, or sail battens! NEVER mention outhaul or downhaul. ' +
                '3. Wing foiling rigging adjustments refer ONLY to: ' +
                '   - Inflatable wing: inflation pressure (PSI) on the leading edge/strut (pump to full spec PSI for gust stiffness, standard PSI for light wind draft), harness lines, or wing size (m²). ' +
                '   - Hydrofoil & board: foil mast track position in the US boxes (move forward 0.5-1 cm for light wind lift; move back 0.5-1 cm for gust control in high wind), and rear stabilizer shim angle. ' +
                '4. RECENT SESSION CONTINUITY: ' +
                '   - Check `recentSessionAnalysis` (the rider recent debrief, technique focus, tuning recommendation, and power tags). ' +
                '   - Connect today game plan and water focus to the drill or lesson from their recent session. ' +
                'Synthesize the forecasted wind speed, gust spread, tide level, recommended quiver setup, past sessions at this spot, and recent coaching focus into a 2-sentence briefing, a gear rigging tip (strictly wing foiling terms), and a key focus.';
        } else {
            return res.status(400).json({ error: `Unsupported mode: ${mode}` });
        }

        const interaction = await client.interactions.create({
            model,
            system_instruction: systemInstruction,
            input: JSON.stringify(payload),
            response_format: {
                type: 'text',
                mime_type: 'application/json',
                schema
            }
        });

        const rawText = interaction.output_text || '{}';
        const parsed = JSON.parse(rawText);

        return res.status(200).json({
            fallback: false,
            model,
            interactionId: interaction.id || null,
            data: parsed
        });
    } catch (err) {
        console.error('[ai-coach] Gemini API error:', err);
        return res.status(200).json({
            fallback: true,
            reason: 'api_error',
            message: err.message || 'Gemini interaction failed'
        });
    }
}
