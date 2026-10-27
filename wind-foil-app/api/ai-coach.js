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
            description: 'A concise 1-sentence headline summarizing the session performance.'
        },
        whatWentWell: {
            type: 'string',
            description: 'Specific positive insights referencing the rider telemetry (flights, gybe %, speed, or HR efficiency) and notes.'
        },
        tuningRecommendation: {
            type: 'string',
            description: 'Actionable gear or rig tuning advice (wing size, foil front wing/stabilizer shim, or mast base track position) for these conditions.'
        },
        techniqueFocus: {
            type: 'string',
            description: 'Concrete technique drill or focus for the next session (e.g. gybe entry speed, foot switch timing, pump-to-glide transition).'
        }
    },
    required: ['headline', 'whatWentWell', 'tuningRecommendation', 'techniqueFocus']
};

const GAME_PLAN_JSON_SCHEMA = {
    type: 'object',
    properties: {
        briefing: {
            type: 'string',
            description: 'A punchy 2-sentence pre-session Coach Game Plan synthesizing wind, gusts, tide, recommended setup, and past sessions at this spot.'
        },
        gearTip: {
            type: 'string',
            description: 'One short sentence on rigging/setup adjustment for the forecasted gust spread and tide.'
        },
        keyFocus: {
            type: 'string',
            description: 'One short tactical focus for the water today.'
        }
    },
    required: ['briefing', 'gearTip', 'keyFocus']
};

export default async function handler(req, res) {
    const origin = req.headers?.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-gemini-api-key');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const headerKey = req.headers?.['x-gemini-api-key'];
    const apiKey = (headerKey && String(headerKey).trim()) || process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;

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
                'You are an elite Wing & Wind Foil Coach. ' +
                'Analyze the rider session summary (wind, gusts, gear used, flight stats, gybe completion, takeoff conversion, heart-rate efficiency, and rider notes). ' +
                'Provide a sharp, encouraging, highly specific 3-part debrief: ' +
                '1) What Went Well (cite exact metrics from their session), ' +
                '2) Tuning Recommendation (mast track position in cm, shim/stabilizer, or wing/foil sizing for the gust spread), ' +
                '3) Technique Focus for Next Session (specific body mechanics, entry speed before gybe apex, or pumping cadence).';
        } else if (mode === 'game_plan') {
            model = 'gemini-3.5-flash-lite';
            schema = GAME_PLAN_JSON_SCHEMA;
            systemInstruction =
                'You are an elite Wing & Wind Foil Coach giving a concise dockside pre-session briefing. ' +
                'Synthesize the forecasted wind speed, gust spread, tide level, recommended quiver setup, and the rider past sessions at this spot into a 2-sentence briefing, a gear rigging tip, and a key focus.';
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
