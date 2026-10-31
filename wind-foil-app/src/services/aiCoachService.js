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

import { isNoFoilExplicitlyStated } from './foilAnalysisService';

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
 * Accepts optional sessionContext to track chronological progression (e.g. Session #4 of 42).
 */
export const buildCompactSessionPayload = (entry, computedAnalysis = null, sessionContext = null) => {
    if (!entry) return {};
    const analysis = computedAnalysis || entry.foilAnalysis || {};
    const stats = analysis.stats || {};
    const maneuvers = analysis.maneuvers || {};
    const efficiency = analysis.efficiency || {};
    const activityStats = entry.activityStats || {};

    return {
        sessionNumber: sessionContext?.sessionNumber ?? entry.sessionNumber ?? null,
        totalSessions: sessionContext?.totalSessions ?? entry.totalSessions ?? null,
        priorSessionsCount: sessionContext?.priorSessionsCount ?? null,
        riderStage: sessionContext?.riderStage ?? null,
        priorRecentSessions: sessionContext?.priorRecentSessions ?? [],
        recentAnalysis: sessionContext?.recentAnalysis ?? null,
        date: entry.date ? String(entry.date).slice(0, 16) : null,
        spot: entry.locationName || entry.locationId || 'Unknown Spot',
        rating: Number(entry.rating) || 3,
        windKts: entry.windSpeed ? Number(entry.windSpeed) : null,
        gustKts: entry.windGusts ? Number(entry.windGusts) : null,
        windDirDeg: entry.windDirection ? Number(entry.windDirection) : null,
        gearUsed: entry.gearUsed || 'Unspecified gear',
        notes: (entry.notes || entry.commentary || entry.description || '').slice(0, 2500),
        telemetry: analysis.stats ? {
            topSpeedKts: Number(Number(activityStats.topSpeed || stats.topSpeed || 0).toFixed(2)),
            avgFoilSpeedKts: Number(Number(stats.avgFoilSpeed || 0).toFixed(2)),
            percentFoil: Number(stats.percentFoil || 0),
            totalFoilMin: Number(stats.totalFoilTime || 0),
            flightsCount: Number(stats.numberOfFlights || (analysis.foilSegments || []).length || 0),
            longestFlightSec: Math.max(
                Number(stats.longestFlightSec || 0),
                ...(analysis.foilSegments || []).map(s => Number(s.durationSec) || 0),
                0
            ),
            distanceKm: Number(Number(activityStats.distance || stats.totalDistance || 0).toFixed(2)),
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
    const sessionPrefix = payload.sessionNumber
        ? `Session #${payload.sessionNumber}${payload.totalSessions ? ` of ${payload.totalSessions}` : ''} • `
        : '';
    const isNovice = payload.sessionNumber && payload.sessionNumber <= 5;

    if (!t) {
        const tags = buildDeterministicCoachTags(payload);
        return {
            headline: `${sessionPrefix}${payload.rating}★ session at ${payload.spot} in ${windStr} on ${payload.gearUsed}.`,
            sessionNumber: payload.sessionNumber || null,
            riderStage: payload.riderStage || null,
            whatWentWell: payload.notes
                ? `Logged solid water time on ${payload.gearUsed}. Power state registered as ${tags.powerState.replace('_', ' ')} with ${tags.foilSentiment.replace('_', ' ')} foil feel.${payload.sessionNumber ? ` Solid foundation built for Session #${payload.sessionNumber}.` : ''}`
                : `Consistent session logged at ${payload.spot} with ${payload.gearUsed} in ${windStr}.`,
            tuningRecommendation: tags.powerState === 'overpowered' || tags.powerState === 'slightly_overpowered'
                ? `For ${windStr}, slide your foil mast 0.5–1.0 cm back in the tracks and pump wing to full factory PSI for canopy rigidity in gusts, or step down 0.5–1.0m in wing size to keep front-foot pressure manageable.`
                : tags.powerState === 'underpowered'
                    ? `In lighter lulls around ${payload.windKts || 12} kts, slide your foil mast 0.5 cm forward in the tracks for earlier takeoff lift, and use standard/slightly softer PSI for maximum low-end draft.`
                    : `Your ${payload.gearUsed} setup is well matched to ${windStr}; keep this foil mast track position as your baseline reference.`,
            techniqueFocus: isNovice
                ? `Focus on keeping your hips centered over your front foot during takeoff to avoid stalling or breaching, and keep hands close together on the wing handles/boom.`
                : `Focus on building board speed slightly off-the-wind (10°–15° below a beam reach) before initiating your pump cadence, and attach a GPX/TCX or Google Health track next session to unlock turn & VMG telemetry.`,
            source: 'telemetry_heuristic',
            model: 'Telemetry Coach Engine',
            updatedAt: new Date().toISOString()
        };
    }

    // With full telemetry
    const noFoilClaimed = isNoFoilExplicitlyStated(payload.notes);
    const isZeroFoil = Number(t.percentFoil || 0) === 0 || t.flightsCount === 0 || noFoilClaimed;
    const topSpeedStr = Number(t.topSpeedKts || 0).toFixed(2);

    const formatFlightDurationDebrief = (sec) => {
        const s = Math.round(Number(sec) || 0);
        if (s <= 0) return '0s';
        if (s < 60) return `${s}s`;
        return `${(s / 60).toFixed(1)} min`;
    };

    if (isZeroFoil) {
        const headline = `${sessionPrefix}Takeoff & Taxi Session at ${payload.spot} (Top Speed ${topSpeedStr} kts)`;
        const whatWentWell = noFoilClaimed
            ? `As noted in your session commentary, you didn't get up on foil today despite pushing board speed to ${topSpeedStr} kts. Working through the displacement taxi phase on ${payload.gearUsed} is essential muscle memory for learning board balance and finding your stance.`
            : `Logged a dedicated taxi and takeoff practice session on ${payload.gearUsed}, reaching ${topSpeedStr} kts across ${t.distanceKm} km.`;

        const tuningRecommendation = `A larger board has substantial surface area and hull suction that can feel sticky at 3–4 kts before lifting off. Slide your foil mast 1.0–2.0 cm forward in the tracks to generate earlier low-speed pitch lift, and pump your wing to full factory PSI for maximum canopy tension.`;

        const techniqueFocus = `At ${topSpeedStr} kts you were approaching the ~5.5–6.5 kt takeoff threshold. Bear away 15°–20° off the wind to let the board accelerate through the hull drag hump before pumping, and avoid leaning back on the tail which sinks the board and creates water drag.`;

        return {
            headline,
            sessionNumber: payload.sessionNumber || null,
            riderStage: payload.riderStage || null,
            whatWentWell,
            tuningRecommendation,
            techniqueFocus,
            source: 'telemetry_heuristic',
            model: 'Telemetry Coach Engine',
            updatedAt: new Date().toISOString()
        };
    }

    const flightDurStr = formatFlightDurationDebrief(t.longestFlightSec);
    const whatWentWellParts = [];
    if (isNovice) {
        whatWentWellParts.push(`At Session #${payload.sessionNumber} (${payload.riderStage || 'Novice stage'}), you're building foundational flight control!`);
    }
    whatWentWellParts.push(
        `You spent ${t.percentFoil}% of the session on foil (${t.totalFoilMin} min across ${t.flightsCount} flights) with a top speed of ${topSpeedStr} kts and a longest continuous flight of ${flightDurStr}.`
    );
    if (t.gybeAttempts > 0) {
        whatWentWellParts.push(`You completed ${t.gybesCompleted}/${t.gybeAttempts} foiling turns (${t.gybeCompletionPct}% dry completion).`);
    }
    if (t.avgFoilingHr && t.avgPumpingHr && t.avgPumpingHr > t.avgFoilingHr) {
        whatWentWellParts.push(`Once on foil, your heart rate settled to ${t.avgFoilingHr} bpm vs ${t.avgPumpingHr} bpm during takeoff/pumping (${t.avgPumpingHr - t.avgFoilingHr} bpm efficiency savings).`);
    }
    if (payload.recentAnalysis?.techniqueFocus) {
        const prevShort = payload.recentAnalysis.techniqueFocus.split(/[.;]/)[0].trim();
        whatWentWellParts.push(`Continuity: Built upon prior session drill ("${prevShort}").`);
    }

    const notesClean = (payload.notes || '').trim();
    const notesLower = notesClean.toLowerCase();
    if (notesClean) {
        const firstSentence = notesClean.split(/[.!\n]/)[0].trim();
        if (firstSentence) {
            whatWentWellParts.push(`Your session commentary ("${firstSentence.slice(0, 90)}") aligns with your telemetry profile.`);
        }
    }

    let tuningRec = '';
    if (spread >= 7) {
        tuningRec = `With a ${spread.toFixed(0)} kt gust spread (${windStr}), slide your foil mast 0.5–1.0 cm back in the tracks to prevent over-foiling in peak gusts, pump leading edge & strut to full recommended PSI to prevent canopy distortion, and rely on your ${payload.gearUsed} glide to bridge lulls.`;
    } else if (t.takeoffConversionPct != null && t.takeoffConversionPct < 60) {
        tuningRec = `Your takeoff conversion was ${t.takeoffConversionPct}%: try shifting your foil mast 0.5 cm forward in the tracks or adding +0.5° stabilizer shim to generate earlier low-end lift during speed surges.`;
    } else if (t.topSpeedKts >= 18) {
        tuningRec = `Hitting ${topSpeedStr} kts shows strong top-end pace on ${payload.gearUsed}; a slightly flatter (0° or -0.5°) rear stabilizer shim will reduce drag and unlock another 1–2 kts of glide speed.`;
    } else {
        tuningRec = `Your ${payload.gearUsed} setup delivered ${t.percentFoil}% foil time in ${windStr}; mark your current foil mast track position as your sweet-spot baseline for ${Math.round(payload.windKts || 16)} kt days.`;
    }

    if (/mast|track|shim|position|front foot|back foot|pitch/i.test(notesLower)) {
        tuningRec = `Addressing your rigging notes: ${tuningRec}`;
    }

    let techniqueFocus = '';
    if (isNovice) {
        techniqueFocus = `Focus on committing your weight forward over the board centerline during acceleration, and avoid pulling back on the rear wing handle until the board is planing cleanly.`;
    } else if (/switch|feet|foot switch|footwork/i.test(notesLower)) {
        techniqueFocus = `Addressing your footwork commentary: carry 1–2 kts more entry speed into the glide and maintain foil flight speed above ${Math.max(8, (t.avgFoilSpeedKts - 2)).toFixed(2)} kts before initiating your foot switch so the board doesn't drop off foil.`;
    } else if (/breach|breaching|high|over foil/i.test(notesLower)) {
        techniqueFocus = `Addressing your foil height commentary: keep chest weight slightly over the front knee during speed bursts to prevent the front wing from breaching the surface.`;
    } else if (t.gybeAttempts > 0 && t.gybeCompletionPct < 65) {
        techniqueFocus = `Carry 1–2 kts more entry speed into the gybe apex and initiate your carve before depowering the wing so the foil stays pressurized above stall speed (${Math.max(8, (t.avgFoilSpeedKts - 3)).toFixed(2)} kts) through the foot switch.`;
        if (/gybe|jibe|carve|turn/i.test(notesLower)) {
            techniqueFocus = `Following up on your gybe commentary: ${techniqueFocus}`;
        }
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
            const nextTarget = t.longestFlightSec < 60
                ? `${Math.max(30, Math.round(t.longestFlightSec + 15))}s`
                : `${(t.longestFlightSec / 60 + 1).toFixed(1)} minutes`;
            techniqueFocus = `Focus on linking consecutive swells on downwind glides while feathering the wing neutral to extend your longest flight past ${nextTarget}.`;
        }
    }

    return {
        headline: `${sessionPrefix}${t.percentFoil}% Foil Time & ${topSpeedStr} kts Peak Speed at ${payload.spot}`,
        sessionNumber: payload.sessionNumber || null,
        riderStage: payload.riderStage || null,
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
    const {
        spotName,
        windKts,
        gustKts,
        windDirDeg,
        tideM,
        recommendedGear,
        pastMatches = [],
        recentSessionAnalysis = null
    } = payload;
    const spread = Math.max(0, (gustKts || windKts) - windKts);
    const bestPast = pastMatches[0];

    const pastContext = bestPast
        ? `In ${bestPast.windKts} kts here previously, you logged a ${bestPast.rating}★ session (${bestPast.percentFoil ? `${bestPast.percentFoil}% on foil` : bestPast.gearUsed}).`
        : `Conditions are lined up at ${spotName} with ${windKts} kts (${windDirDeg}°).`;

    const briefing = `${spotName} is forecasting ${windKts} kts gusting ${gustKts} kts (${windDirDeg}°)${tideM != null ? ` with a ${Number(tideM).toFixed(2)}m tide` : ''}—rig your ${recommendedGear}. ${pastContext}`;

    let gearTip = `Set your foil mast in your standard track position for ${recommendedGear}.`;
    if (spread >= 7.5) {
        gearTip = `Expect a +${Math.round(spread)} kt gust spread: pump your leading edge & strut to full recommended PSI for canopy stiffness, and slide your foil mast 0.5–1.0 cm back in the tracks to handle the ${gustKts} kt bullets.`;
    } else if (tideM != null && tideM < 0.7) {
        gearTip = `Low tide (${Number(tideM).toFixed(2)}m): walk out past the inside sandbar before flipping the foil over to protect your front wing tip.`;
    }

    let keyFocus = spread >= 7.5
        ? `Bear away 10° in the lulls to maintain apparent wind speed on foil, then pinch higher upwind during the gusts.`
        : `Use the steady ${windKts} kt breeze to lock in high-speed foiling gybe entries and balanced upwind tacks.`;

    const recentDebrief = recentSessionAnalysis?.coachDebrief;
    if (recentDebrief?.techniqueFocus) {
        const shortDrill = recentDebrief.techniqueFocus.split(/[.;]/)[0].trim();
        keyFocus = `Carry forward your recent coaching focus (${shortDrill}): ${keyFocus.charAt(0).toLowerCase() + keyFocus.slice(1)}`;
    }

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
export const extractSessionCoachTags = async (entry, computedAnalysis = null, sessionContext = null) => {
    const payload = buildCompactSessionPayload(entry, computedAnalysis, sessionContext);
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
export const generateSessionCoachDebrief = async (entry, computedAnalysis = null, sessionContext = null) => {
    const payload = buildCompactSessionPayload(entry, computedAnalysis, sessionContext);
    try {
        const result = await callCoachEndpoint('session_debrief', payload);
        if (!result.fallback && result.data) {
            return {
                ...result.data,
                sessionNumber: payload.sessionNumber || null,
                riderStage: payload.riderStage || null,
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
