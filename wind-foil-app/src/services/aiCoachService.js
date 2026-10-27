/**
 * aiCoachService.js
 *
 * Client-side service for Phase 5: Efficient LLM-Powered "AI Foil Coach".
 *
 * Key efficiency principles:
 *   1. Never sends raw GPS streams — pre-computes a compact ~300-450 token JSON summary.
 *   2. Calls `/api/ai-coach` (which uses `gemini-3.5-flash-lite` for note tagging & pre-session
 *      game plans and `gemini-3.8-flash` for post-session coaching debriefs via `@google/genai`
 *      `client.interactions.create`).
 *   3. Persists generated `coachTags` and `coachDebrief` directly onto the journal entry so
 *      viewing a session never re-triggers an API call unless requested.
 *   4. Includes a deterministic Smart Telemetry Coach fallback so every feature works
 *      offline or before a Gemini API key is configured.
 */

const LOCAL_KEY_STORAGE = 'melvill_gemini_api_key';

export const getStoredGeminiKey = () => {
    try {
        return localStorage.getItem(LOCAL_KEY_STORAGE) || '';
    } catch {
        return '';
    }
};

export const setStoredGeminiKey = (key) => {
    try {
        if (!key || !key.trim()) {
            localStorage.removeItem(LOCAL_KEY_STORAGE);
        } else {
            localStorage.setItem(LOCAL_KEY_STORAGE, key.trim());
        }
    } catch {
        // ignore storage errors
    }
};

/**
 * Condenses a full journal entry (which may contain thousands of GPS/HR stream points)
 * into a compact ~300-token summary payload suitable for LLM coaching.
 */
export const buildCompactSessionPayload = (entry, computedAnalysis = null) => {
    if (!entry) return {};
    const analysis = computedAnalysis || entry.foilAnalysis || {};
    const stats = analysis.stats || {};
    const maneuvers = analysis.maneuvers || {};
    const efficiency = analysis.efficiency || {};
    const activityStats = entry.activityStats || {};

    return {
        date: entry.date ? String(entry.date).slice(0, 16) : null,
        spot: entry.locationName || entry.locationId || 'Unknown Spot',
        rating: Number(entry.rating) || 3,
        windKts: entry.windSpeed ? Number(entry.windSpeed) : null,
        gustKts: entry.windGusts ? Number(entry.windGusts) : null,
        windDirDeg: entry.windDirection ? Number(entry.windDirection) : null,
        gearUsed: entry.gearUsed || 'Unspecified gear',
        notes: (entry.notes || '').slice(0, 600),
        telemetry: analysis.stats ? {
            topSpeedKts: Number(activityStats.topSpeed || stats.topSpeed || 0),
            avgFoilSpeedKts: Number(stats.avgFoilSpeed || 0),
            percentFoil: Number(stats.percentFoil || 0),
            totalFoilMin: Number(stats.totalFoilTime || 0),
            flightsCount: Number(stats.numberOfFlights || 0),
            longestFlightSec: Number(stats.longestFlightSec || 0),
            distanceKm: Number(activityStats.distance || stats.totalDistance || 0),
            gybeAttempts: maneuvers.totalAttempts ?? 0,
            gybesCompleted: maneuvers.completedTurns ?? 0,
            gybeCompletionPct: maneuvers.completionRate ?? null,
            portFoilSec: maneuvers.portFoilSec ?? maneuvers.portTackSec ?? null,
            starboardFoilSec: maneuvers.starboardFoilSec ?? maneuvers.starboardTackSec ?? null,
            avgUpwindAngleDeg: maneuvers.avgUpwindAngle ?? null,
            upwindVmgKts: maneuvers.upwindVmgKts ?? null,
            takeoffConversionPct: efficiency.takeoffConversionRate ?? null,
            avgFoilingHr: efficiency.avgFoilHeartRate ?? efficiency.avgFoilingHr ?? null,
            avgPumpingHr: efficiency.avgPumpHeartRate ?? efficiency.avgPumpingHr ?? null,
            firstHalfFoilPct: efficiency.firstHalfFoilPct ?? null,
            secondHalfFoilPct: efficiency.secondHalfFoilPct ?? null,
            enduranceDeltaPct: efficiency.enduranceDeltaPct ?? (
                efficiency.firstHalfFoilPct != null && efficiency.secondHalfFoilPct != null
                    ? Number((efficiency.secondHalfFoilPct - efficiency.firstHalfFoilPct).toFixed(1))
                    : null
            )
        } : null
    };
};

/**
 * Deterministic fallback for 5.1 Structured Note Mining when no API key is configured.
 */
export const buildDeterministicCoachTags = (payload) => {
    const notes = (payload.notes || '').toLowerCase();
    const wind = payload.windKts || 15;
    const gusts = payload.gustKts || wind;
    const spread = Math.max(0, gusts - wind);
    const pctFoil = payload.telemetry?.percentFoil || 0;
    const enduranceDelta = payload.telemetry?.enduranceDeltaPct || 0;

    let powerState = 'dialed';
    let wingSizeSentiment = 'just_right';

    if (/way overpowered|blown out|too big|holding on|uncontrollable/.test(notes)) {
        powerState = 'overpowered';
        wingSizeSentiment = 'wish_smaller';
    } else if (/overpowered|gusty|lit|heavy in gusts|slightly big/.test(notes) || spread >= 8) {
        powerState = 'slightly_overpowered';
        wingSizeSentiment = /wish.*smaller|too big/.test(notes) ? 'wish_smaller' : 'just_right';
    } else if (/underpowered|slog|slogging|not enough wind|too light|pumping hard|lull/.test(notes) || (pctFoil > 0 && pctFoil < 25 && payload.rating <= 3)) {
        powerState = 'underpowered';
        wingSizeSentiment = 'wish_larger';
    }

    let foilSentiment = 'balanced';
    if (/breach|breaching|ventilated|too much lift|popping out/.test(notes)) {
        foilSentiment = 'breaching';
    } else if (/early lift|popped right up|easy takeoff|glided through/.test(notes)) {
        foilSentiment = 'lift_early';
    } else if (/draggy|slow|stalled|hard to get up/.test(notes)) {
        foilSentiment = 'too_slow';
    }

    let fatigue = 'fresh';
    if (/exhausted|cooked|tired|arms burned|legs jelly|wiped/.test(notes) || enduranceDelta <= -15 || (payload.telemetry?.avgPumpingHr && payload.telemetry.avgPumpingHr > 165)) {
        fatigue = 'exhausted';
    } else if (/workout|pumping|moderate|solid effort/.test(notes) || (payload.telemetry?.totalFoilMin && payload.telemetry.totalFoilMin >= 35)) {
        fatigue = 'moderate';
    }

    let breakthrough = null;
    if (/first|pb|personal best|finally|nailed|breakthrough|longest|dry gybe/.test(notes)) {
        const match = (payload.notes || '').split(/[.!\n]/).find(s => /first|pb|personal best|finally|nailed|breakthrough|longest|gybe/i.test(s));
        if (match) {
            breakthrough = match.trim().slice(0, 60);
        }
    } else if (payload.telemetry?.gybeCompletionPct >= 75 && payload.telemetry?.gybesCompleted >= 3) {
        breakthrough = `${payload.telemetry.gybesCompleted} dry foiling turns (${payload.telemetry.gybeCompletionPct}%)`;
    }

    return {
        powerState,
        wingSizeSentiment,
        foilSentiment,
        fatigue,
        breakthrough,
        source: 'telemetry_heuristic',
        updatedAt: new Date().toISOString()
    };
};

/**
 * Deterministic fallback for 5.2 Post-Session Coaching Debrief.
 */
export const buildDeterministicSessionDebrief = (payload) => {
    const t = payload.telemetry;
    const windStr = payload.windKts ? `${payload.windKts} kts${payload.gustKts ? ` (gusting ${payload.gustKts} kts)` : ''}` : 'recorded conditions';
    const spread = (payload.gustKts && payload.windKts) ? Math.max(0, payload.gustKts - payload.windKts) : 0;

    if (!t) {
        const tags = buildDeterministicCoachTags(payload);
        return {
            headline: `${payload.rating}★ session at ${payload.spot} in ${windStr} on ${payload.gearUsed}.`,
            whatWentWell: payload.notes
                ? `Logged solid water time on ${payload.gearUsed}. Power state registered as ${tags.powerState.replace('_', ' ')} with ${tags.foilSentiment.replace('_', ' ')} foil feel.`
                : `Consistent session logged at ${payload.spot} with ${payload.gearUsed} in ${windStr}.`,
            tuningRecommendation: tags.powerState === 'overpowered' || tags.powerState === 'slightly_overpowered'
                ? `For ${windStr}, move your mast base 0.5–1.0 cm further back in the tracks or step down 0.5–1.0m in wing size to keep front-foot pressure manageable in gusts.`
                : tags.powerState === 'underpowered'
                    ? `In lighter lulls around ${payload.windKts || 12} kts, slide the mast base 0.5 cm forward for earlier pitch stability when pumping onto foil.`
                    : `Your ${payload.gearUsed} setup is well matched to ${windStr}; keep this mast track position as your baseline reference.`,
            techniqueFocus: `Focus on building board speed slightly off-the-wind (10°–15° below a beam reach) before initiating your pump cadence, and attach a GPX/TCX or Google Health track next session to unlock turn & VMG telemetry.`,
            source: 'telemetry_heuristic',
            model: 'Telemetry Coach Engine',
            updatedAt: new Date().toISOString()
        };
    }

    // With full telemetry
    const longestMin = (t.longestFlightSec / 60).toFixed(1);
    const whatWentWellParts = [
        `You spent ${t.percentFoil}% of the session on foil (${t.totalFoilMin} min across ${t.flightsCount} flights) with a top speed of ${t.topSpeedKts} kts and a longest continuous flight of ${longestMin} min.`
    ];
    if (t.gybeAttempts > 0) {
        whatWentWellParts.push(`You completed ${t.gybesCompleted}/${t.gybeAttempts} foiling turns (${t.gybeCompletionPct}% dry completion).`);
    }
    if (t.avgFoilingHr && t.avgPumpingHr && t.avgPumpingHr > t.avgFoilingHr) {
        whatWentWellParts.push(`Once on foil, your heart rate settled to ${t.avgFoilingHr} bpm vs ${t.avgPumpingHr} bpm during takeoff/pumping (${t.avgPumpingHr - t.avgFoilingHr} bpm efficiency savings).`);
    }

    let tuningRec = '';
    if (spread >= 7) {
        tuningRec = `With a ${spread.toFixed(0)} kt gust spread (${windStr}), move your foil mast 0.5 cm back in the box to prevent over-foiling in peak gusts while relying on your ${payload.gearUsed} glide to bridge lulls.`;
    } else if (t.takeoffConversionPct != null && t.takeoffConversionPct < 60) {
        tuningRec = `Your takeoff conversion was ${t.takeoffConversionPct}%: try shifting your mast base 0.5 cm forward or adding +0.5° stabilizer shim to generate earlier low-end lift during speed surges.`;
    } else if (t.topSpeedKts >= 18) {
        tuningRec = `Hitting ${t.topSpeedKts} kts shows strong top-end pace on ${payload.gearUsed}; a slightly flatter (0° or -0.5°) rear stabilizer shim will reduce drag and unlock another 1–2 kts of glide speed.`;
    } else {
        tuningRec = `Your ${payload.gearUsed} setup delivered ${t.percentFoil}% foil time in ${windStr}; mark your current mast track position as your sweet-spot baseline for ${Math.round(payload.windKts || 16)} kt days.`;
    }

    let techniqueFocus = '';
    if (t.gybeAttempts > 0 && t.gybeCompletionPct < 65) {
        techniqueFocus = `Carry 1–2 kts more entry speed into the gybe apex and initiate your carve before depowering the wing so the foil stays pressurized above stall speed (${Math.max(8, (t.avgFoilSpeedKts - 3)).toFixed(1)} kts) through the foot switch.`;
    } else if (t.portFoilSec != null && t.starboardFoilSec != null && (t.portFoilSec + t.starboardFoilSec) > 120) {
        const portPct = Math.round((t.portFoilSec / (t.portFoilSec + t.starboardFoilSec)) * 100);
        if (Math.abs(portPct - 50) >= 18) {
            const weakerTack = portPct < 50 ? 'Port' : 'Starboard';
            techniqueFocus = `Your tack balance skewed ${portPct}% Port / ${100 - portPct}% Starboard—dedicate the first 15 minutes of your next session to longer upwind legs and toe-side transitions on ${weakerTack} tack.`;
        }
    }
    if (!techniqueFocus) {
        if (t.enduranceDeltaPct != null && t.enduranceDeltaPct <= -12) {
            techniqueFocus = `Foil time dropped ${Math.abs(t.enduranceDeltaPct)}% in the second half of the session—lock your harness/front arm straight on upwind reaches to conserve upper-body energy for late-session transitions.`;
        } else {
            techniqueFocus = `Focus on linking consecutive swells on downwind glides while feathering the wing neutral to extend your longest flight past ${(t.longestFlightSec / 60 + 1).toFixed(1)} minutes.`;
        }
    }

    return {
        headline: `${t.percentFoil}% Foil Time & ${t.topSpeedKts} kts Peak Speed at ${payload.spot}`,
        whatWentWell: whatWentWellParts.join(' '),
        tuningRecommendation: tuningRec,
        techniqueFocus,
        source: 'telemetry_heuristic',
        model: 'Telemetry Coach Engine',
        updatedAt: new Date().toISOString()
    };
};

/**
 * Deterministic fallback for 5.3 Pre-Session "Coach's Game Plan".
 */
export const buildDeterministicGamePlan = (payload) => {
    const { spotName, windKts, gustKts, windDirDeg, tideM, recommendedGear, pastMatches = [] } = payload;
    const spread = Math.max(0, (gustKts || windKts) - windKts);
    const bestPast = pastMatches[0];

    const pastContext = bestPast
        ? `In ${bestPast.windKts} kts here previously, you logged a ${bestPast.rating}★ session (${bestPast.percentFoil ? `${bestPast.percentFoil}% on foil` : bestPast.gearUsed}).`
        : `Conditions are lined up at ${spotName} with ${windKts} kts (${windDirDeg}°).`;

    const briefing = `${spotName} is forecasting ${windKts} kts gusting ${gustKts} kts (${windDirDeg}°)${tideM != null ? ` with a ${Number(tideM).toFixed(2)}m tide` : ''}—rig your ${recommendedGear}. ${pastContext}`;

    let gearTip = `Set your mast base in your standard middle position for ${recommendedGear}.`;
    if (spread >= 7.5) {
        gearTip = `Expect a +${Math.round(spread)} kt gust spread: rig the wing slightly flatter/tighter on outhaul and move your foil mast 0.5 cm back to handle the ${gustKts} kt bullets.`;
    } else if (tideM != null && tideM < 0.7) {
        gearTip = `Low tide (${Number(tideM).toFixed(2)}m): walk out past the inside sandbar before flipping the foil over to protect your front wing tip.`;
    }

    const keyFocus = spread >= 7.5
        ? `Bear away 10° in the lulls to maintain apparent wind speed on foil, then pinch higher upwind during the gusts.`
        : `Use the steady ${windKts} kt breeze to lock in high-speed foiling gybe entries and balanced upwind tacks.`;

    return {
        briefing,
        gearTip,
        keyFocus,
        source: 'telemetry_heuristic',
        model: 'Telemetry Coach Engine',
        generatedAt: new Date().toISOString()
    };
};

/**
 * Helper to invoke `/api/ai-coach` with optional user key header and Firebase Auth ID token.
 */
const callCoachEndpoint = async (mode, payload) => {
    const headers = { 'Content-Type': 'application/json' };
    const storedKey = getStoredGeminiKey();
    if (storedKey) {
        headers['x-gemini-api-key'] = storedKey;
    }
    try {
        const { auth } = await import('./firebaseSetup');
        if (auth?.currentUser && typeof auth.currentUser.getIdToken === 'function') {
            const idToken = await auth.currentUser.getIdToken();
            if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
        }
    } catch (_) {
        // Ignore if Firebase auth is not initialized
    }

    const res = await fetch('/api/ai-coach', {
        method: 'POST',
        headers,
        body: JSON.stringify({ mode, payload })
    });

    if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
    }
    return res.json();
};

/**
 * 5.1 Extracts structured `coachTags` for a session (using `gemini-3.5-flash-lite` or deterministic fallback).
 */
export const extractSessionCoachTags = async (entry, computedAnalysis = null) => {
    const payload = buildCompactSessionPayload(entry, computedAnalysis);
    try {
        const result = await callCoachEndpoint('extract_tags', payload);
        if (!result.fallback && result.data) {
            return {
                ...result.data,
                source: 'gemini',
                model: result.model || 'gemini-3.5-flash-lite',
                updatedAt: new Date().toISOString()
            };
        }
    } catch (err) {
        console.warn('[aiCoachService] Falling back to local tag extraction:', err.message);
    }
    return buildDeterministicCoachTags(payload);
};

/**
 * 5.2 Generates a 3-part Post-Session Coaching Debrief (using `gemini-3.8-flash` or deterministic fallback).
 */
export const generateSessionCoachDebrief = async (entry, computedAnalysis = null) => {
    const payload = buildCompactSessionPayload(entry, computedAnalysis);
    try {
        const result = await callCoachEndpoint('session_debrief', payload);
        if (!result.fallback && result.data) {
            return {
                ...result.data,
                source: 'gemini',
                model: result.model || 'gemini-3.8-flash',
                updatedAt: new Date().toISOString()
            };
        }
    } catch (err) {
        console.warn('[aiCoachService] Falling back to local debrief engine:', err.message);
    }
    return buildDeterministicSessionDebrief(payload);
};

/**
 * 5.3 Generates a Pre-Session "Coach's Game Plan" briefing for the Forecast Page.
 */
export const generatePreSessionGamePlan = async (contextPayload) => {
    try {
        const result = await callCoachEndpoint('game_plan', contextPayload);
        if (!result.fallback && result.data) {
            return {
                ...result.data,
                source: 'gemini',
                model: result.model || 'gemini-3.5-flash-lite',
                generatedAt: new Date().toISOString()
            };
        }
    } catch (err) {
        console.warn('[aiCoachService] Falling back to local game plan engine:', err.message);
    }
    return buildDeterministicGamePlan(contextPayload);
};
