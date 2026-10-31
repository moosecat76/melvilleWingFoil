/**
 * foilAnalysisService.js
 * 
 * Logic for detecting "On Foil" segments, per-flight metrics, maneuver (gybe/tack)
 * detection, tack symmetry, upwind VMG, and pumping efficiency from telemetry streams.
 * 
 * RULES (Altitude Mode - when valid altitude changes are present):
 * 1. Calibration: Dynamic water level baseline from slow/drifting periods.
 * 2. Detection: 
 *      - Speed > 0.8 m/s (Planning Threshold)
 *      - Altitude < Baseline - 0.2m (Lift)
 *      - Persistence: >= 2 seconds
 * 
 * RULES (Adaptive Speed-Only Mode - when altitude is absent or flat):
 * 1. Adaptive Session Profiling:
 *      - Analyses the session's moving speed distribution (percentiles, displacement mode,
 *        and acceleration valleys) to automatically separate displacement sailing/pumping
 *        (typically 0.4–1.8 m/s) from free-flying foil glides (typically >= 2.0 m/s).
 *      - Adapts to wing/foil size and conditions without relying on a rigid static threshold.
 * 2. Multi-Factor Takeoff & Sustain Detection:
 *      - Takeoff requires reaching the adaptive foil entry speed via a positive acceleration
 *        surge from displacement speed, OR reaching clear sustained flight velocity.
 *      - Hysteresis sustains flight down to the adaptive stall threshold (through lulls/gybes)
 *        until a sharp deceleration crash or drop into displacement speeds occurs.
 *      - Persistence: >= 3 seconds of sustained flight.
 */

const _percentile = (sortedArr, p) => {
    if (!sortedArr || sortedArr.length === 0) return 0;
    const idx = (sortedArr.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sortedArr[lo];
    return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo);
};

const _haversineM = (lat1, lng1, lat2, lng2) => {
    const R = 6371000;
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLng = (lng2 - lng1) * toRad;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const _computeBearing = (lat1, lng1, lat2, lng2) => {
    const toRad = Math.PI / 180;
    const φ1 = lat1 * toRad;
    const φ2 = lat2 * toRad;
    const Δλ = (lng2 - lng1) * toRad;
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    const θ = Math.atan2(y, x);
    return ((θ * 180 / Math.PI) + 360) % 360;
};

const _signedAngleDiff = (b1, b2) => {
    if (b1 == null || b2 == null || isNaN(b1) || isNaN(b2)) return 0;
    return ((b2 - b1 + 540) % 360) - 180;
};

export const formatDurationSec = (sec) => {
    const s = Math.max(0, Math.round(Number(sec) || 0));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
};

/**
 * Computes adaptive speed thresholds from the session's velocity distribution.
 * Separates two natural regimes in wing/wind foiling:
 *   1. Displacement / taxiing / slogging regime (lower cluster)
 *   2. Planing / on-foil regime (upper tail separated by takeoff acceleration)
 */
/**
 * Extracts front wing foil surface area in cm² from gear description or equipment strings.
 * e.g. "1850cm² Neil Pryde", "1250cm", "foil 1850", "Neil Pryde 1850"
 */
export const extractFoilAreaCm2 = (gearUsed) => {
    if (!gearUsed || typeof gearUsed !== 'string') return null;
    const m = gearUsed.match(/(\d{3,4})\s*(?:cm²|cm2|cm)\b/i) ||
              gearUsed.match(/foil[^\d]*(\d{3,4})\b/i) ||
              gearUsed.match(/(\d{3,4})\s*(?:Neil Pryde|Severne|F-One|GoFoil|Armstrong|Axis|Slingshot|Fanatic|Duotone|Naish)\s*foil/i) ||
              gearUsed.match(/(\d{3,4})\s*foil\b/i);
    if (m) {
      const val = parseInt(m[1], 10);
      if (val >= 500 && val <= 3200) return val;
    }
    return null;
};

const _computeAdaptiveSpeedProfile = (velocityStream, timeStream, options = {}) => {
    const validMoving = [];
    for (let i = 1; i < velocityStream.length; i++) {
        const v = velocityStream[i];
        if (v >= 0.25 && v < 25) {
            validMoving.push(v);
        }
    }

    const sorted = [...validMoving].sort((a, b) => a - b);
    const p25 = _percentile(sorted, 0.25);
    const p95 = _percentile(sorted, 0.95);
    const foilArea = extractFoilAreaCm2(options.gearUsed);

    // Analyze speeds where positive takeoff accelerations (surges) occur
    const surgeCrossings = [];
    for (let i = 2; i < velocityStream.length - 1; i++) {
        let lookback = i - 1;
        while (lookback > 1 && (timeStream[i] - timeStream[lookback]) < 3.5) {
            lookback--;
        }
        const dt = timeStream[i] - timeStream[lookback];
        if (dt >= 1.0 && dt <= 5.5) {
            const dv = velocityStream[i] - velocityStream[lookback];
            const accel = dv / dt;
            if (dv >= 0.35 && accel >= 0.15 && velocityStream[i] >= 0.9) {
                surgeCrossings.push((velocityStream[i] + velocityStream[lookback]) * 0.5);
            }
        }
    }

    // Calibrate baseline priors based on foil surface area:
    // Large foils (>= 1700 cm², e.g. 1850 cm²): early takeoff around 2.0-2.4 kts (~1.05 - 1.2 m/s), stall ~1.7 kts (~0.88 m/s)
    // Mid foils (1200-1600 cm², e.g. 1250 cm²): takeoff around 3.8-4.2 kts (~1.95 - 2.15 m/s), stall ~2.9 kts (~1.5 m/s)
    // Small foils (<= 1000 cm²): takeoff around 4.5-5.5 kts (~2.3 - 2.8 m/s), stall ~3.5 kts (~1.8 m/s)
    let priorEntry = 1.95;
    let surgeThreshold = 0.40;

    if (foilArea) {
        if (foilArea >= 1700) {
            priorEntry = 1.15; // ~2.2 kts
            surgeThreshold = 0.25;
        } else if (foilArea >= 1400) {
            priorEntry = 1.50; // ~2.9 kts
            surgeThreshold = 0.32;
        } else if (foilArea <= 1000) {
            priorEntry = 2.30; // ~4.5 kts
            surgeThreshold = 0.45;
        }
    } else {
        // If gear isn't explicitly noted, infer from speed distribution:
        // A session with solid sustained runs peaking < 3.2 m/s (6.2 kts) indicates light wind on a big foil
        if (p95 < 3.2 && p95 > 1.2) {
            priorEntry = 1.20;
            surgeThreshold = 0.28;
        }
    }

    // Otsu-style bimodal search around the equipment prior
    let minSearch = Math.max(0.8, priorEntry - 0.4);
    let maxSearch = Math.min(2.8, priorEntry + 0.5);
    let bestOtsu = priorEntry;
    let maxBetweenVar = -1;

    const activeSpeeds = sorted.filter(v => v >= 0.35);
    if (activeSpeeds.length >= 20) {
        for (let t = minSearch; t <= maxSearch; t += 0.05) {
            const c0 = activeSpeeds.filter(v => v < t);
            const c1 = activeSpeeds.filter(v => v >= t);
            if (c0.length < 5 || c1.length < 5) continue;

            const w0 = c0.length / activeSpeeds.length;
            const w1 = c1.length / activeSpeeds.length;
            const mu0 = c0.reduce((a, b) => a + b, 0) / c0.length;
            const mu1 = c1.reduce((a, b) => a + b, 0) / c1.length;

            if (mu1 - mu0 < 0.35) continue;

            const priorWeight = Math.exp(-((t - priorEntry) ** 2) / (2 * 0.35 ** 2));
            const betweenVar = w0 * w1 * ((mu0 - mu1) ** 2) * priorWeight;
            if (betweenVar > maxBetweenVar) {
                maxBetweenVar = betweenVar;
                bestOtsu = t;
            }
        }
    }

    const foilEntrySpeed = Number(bestOtsu.toFixed(2));
    const sustainedFoilSpeed = Number((foilEntrySpeed * 1.15).toFixed(2));
    const stallSpeed = Number(Math.max(0.70, foilEntrySpeed * 0.78).toFixed(2));

    return {
        displacementSpeed: Number(Math.min(p25, stallSpeed * 0.7).toFixed(2)),
        foilArea,
        foilEntrySpeed,
        sustainedFoilSpeed,
        stallSpeed,
        surgeDelta: surgeThreshold,
        p95: Number(p95.toFixed(2)),
    };
};

/**
 * Analyzes GPS bearings for gybe/tack maneuvers, tack symmetry, and upwind/downwind angles.
 */
const _analyzeManeuversAndAngles = (latlngStream, velocityStream, timeStream, pointStates, windDirection = null) => {
    const emptyResult = {
        turns: [],
        totalAttempts: 0,
        completedTurns: 0,
        wetTurns: 0,
        completionRate: null,
        portFoilSec: 0,
        starboardFoilSec: 0,
        portSymmetryPct: null,
        avgUpwindAngle: null,
        avgDownwindAngle: null,
        upwindVmgKts: null,
    };

    if (!Array.isArray(latlngStream) || latlngStream.length < 5 || latlngStream.length !== timeStream.length) {
        return emptyResult;
    }

    const n = timeStream.length;
    const bearings = new Array(n).fill(null);

    // 1. Compute smoothed bearings across ~2 second baseline when moving
    let lastValidBearing = null;
    for (let i = 1; i < n; i++) {
        // Find a point ~1.5-3s earlier that moved at least 1.2m
        let prevIdx = i - 1;
        while (prevIdx > 0 && (timeStream[i] - timeStream[prevIdx]) < 2.0) {
            prevIdx--;
        }
        const pt1 = latlngStream[prevIdx];
        const pt2 = latlngStream[i];
        if (Array.isArray(pt1) && Array.isArray(pt2) && pt1.length >= 2 && pt2.length >= 2) {
            const dist = _haversineM(pt1[0], pt1[1], pt2[0], pt2[1]);
            if (dist >= 1.2 && velocityStream[i] >= 0.5) {
                lastValidBearing = _computeBearing(pt1[0], pt1[1], pt2[0], pt2[1]);
                bearings[i] = lastValidBearing;
            } else if (velocityStream[i] >= 0.8 && lastValidBearing !== null) {
                bearings[i] = lastValidBearing;
            }
        }
    }

    // 2. Detect Turns (Gybes / Tacks initiated while on foil)
    const turns = [];
    let cooldownUntilTime = -999;

    for (let i = 2; i < n - 3; i++) {
        const tEntry = timeStream[i];
        if (tEntry < cooldownUntilTime) continue;

        // Turn must initiate while actively on foil
        const isFoilingEntry = pointStates[i] === 'foiling' && (i + 1 < n && pointStates[i + 1] === 'foiling');
        if (!isFoilingEntry || bearings[i] === null) continue;

        const entryBearing = bearings[i];

        // Look ahead 3 to 8 seconds for the exit heading, tracking how much turn happened while still on foil
        let bestExitIdx = -1;
        let maxAbsDelta = 0;
        let bestSignedDelta = 0;
        let maxFoilDelta = 0;

        for (let j = i + 1; j < n; j++) {
            const dt = timeStream[j] - tEntry;
            if (dt > 8.5) break;

            if (bearings[j] !== null) {
                const signedDelta = _signedAngleDiff(entryBearing, bearings[j]);
                const absDelta = Math.abs(signedDelta);
                if (pointStates[j] === 'foiling' && absDelta > maxFoilDelta) {
                    maxFoilDelta = absDelta;
                }
                if (dt >= 2.5 && absDelta > maxAbsDelta) {
                    maxAbsDelta = absDelta;
                    bestSignedDelta = signedDelta;
                    bestExitIdx = j;
                }
            }
        }

        // The carve must have initiated while on foil (at least 25° rotation before touchdown)
        if (maxFoilDelta < 25) continue;

        // Case A: Full turn of >= 68° completed (either on foil or riding away off-foil)
        // Case B: Mid-carve crash where rider carved >= 45° and immediately crashed (< 0.6 m/s)
        let isCrashTurn = false;
        if (maxAbsDelta >= 45 && maxAbsDelta < 68 && bestExitIdx !== -1) {
            // Check if speed collapsed right after bestExitIdx
            const postIdx = Math.min(n - 1, bestExitIdx + 2);
            if (velocityStream[bestExitIdx] < 0.8 || velocityStream[postIdx] < 0.8 || pointStates[bestExitIdx] === 'beach') {
                isCrashTurn = true;
            }
        }

        if (maxAbsDelta >= 68 || isCrashTurn) {
            // Find the apex (point of maximum turn rate or lowest foil speed during the carve)
            let apexIdx = Math.floor((i + bestExitIdx) / 2);
            let maxStepTurn = -1;
            for (let k = i + 1; k <= bestExitIdx; k++) {
                if (bearings[k] !== null && bearings[k - 1] !== null) {
                    const stepTurn = Math.abs(_signedAngleDiff(bearings[k - 1], bearings[k]));
                    if (stepTurn > maxStepTurn) {
                        maxStepTurn = stepTurn;
                        apexIdx = k;
                    }
                }
            }

            // Determine if the rider stayed on foil through the turn and for at least 3s after apex
            let stayedOnFoil = !isCrashTurn;
            let sustainEndIdx = apexIdx;
            while (sustainEndIdx < n - 1 && (timeStream[sustainEndIdx] - timeStream[apexIdx]) < 3.0) {
                sustainEndIdx++;
            }

            for (let k = i; k <= sustainEndIdx; k++) {
                if (pointStates[k] !== 'foiling') {
                    stayedOnFoil = false;
                    break;
                }
            }

            // Classify Gybe vs Tack if windDirection is known
            let maneuverType = 'Turn';
            const parsedWind = windDirection != null && windDirection !== '' ? Number(windDirection) : null;
            if (parsedWind != null && !isNaN(parsedWind)) {
                const apexBearing = bearings[apexIdx] ?? entryBearing;
                const relToWind = Math.abs(_signedAngleDiff(parsedWind, apexBearing));
                // If apex passes closer to downwind (> 90° from wind source), it's a Gybe; otherwise Tack
                maneuverType = relToWind >= 80 ? 'Gybe' : 'Tack';
            } else {
                maneuverType = 'Gybe';
            }

            turns.push({
                id: turns.length + 1,
                index: apexIdx,
                startIndex: i,
                endIndex: bestExitIdx,
                timeSec: timeStream[apexIdx],
                latlng: latlngStream[apexIdx],
                entryBearing: Math.round(entryBearing),
                exitBearing: Math.round(bearings[bestExitIdx] ?? entryBearing),
                angleChange: Math.round(maxAbsDelta),
                turnDirection: bestSignedDelta >= 0 ? 'starboard' : 'port',
                completed: stayedOnFoil,
                type: maneuverType,
            });

            cooldownUntilTime = timeStream[bestExitIdx] + 10;
            i = bestExitIdx;
        }
    }

    // 3. Port vs Starboard Tack Symmetry & Upwind/Downwind Angles
    let effectiveWindDir = (windDirection != null && windDirection !== '' && !isNaN(Number(windDirection)))
        ? Number(windDirection)
        : null;

    // If windDirection isn't explicitly saved, estimate dominant wind axis from foiling bearings
    if (effectiveWindDir === null) {
        const foilBearings = [];
        for (let i = 1; i < n; i++) {
            if (pointStates[i] === 'foiling' && bearings[i] !== null) {
                foilBearings.push(bearings[i]);
            }
        }
        if (foilBearings.length >= 10) {
            // Double-angle circular mean finds the dominant sailing axis
            let sumSin2 = 0, sumCos2 = 0;
            for (const b of foilBearings) {
                const rad2 = (b * 2 * Math.PI) / 180;
                sumSin2 += Math.sin(rad2);
                sumCos2 += Math.cos(rad2);
            }
            const axisDeg = (((Math.atan2(sumSin2, sumCos2) * 180) / Math.PI) / 2 + 360) % 360;
            // Wind axis is roughly perpendicular (+90°) to the primary cross-wind reach axis
            effectiveWindDir = (axisDeg + 90) % 360;
        }
    }

    let portFoilSec = 0;
    let starboardFoilSec = 0;
    const upwindAngles = [];
    const downwindAngles = [];
    const upwindVmgsMs = [];
    const hasExplicitWind = windDirection != null && windDirection !== '' && !isNaN(Number(windDirection));

    if (effectiveWindDir !== null) {
        for (let i = 1; i < n; i++) {
            const dt = timeStream[i] - timeStream[i - 1];
            if (dt <= 0 || dt > 15 || pointStates[i] !== 'foiling' || bearings[i] === null) continue;

            const signedRel = _signedAngleDiff(effectiveWindDir, bearings[i]);
            const absRel = Math.abs(signedRel);

            // Starboard tack: wind comes over starboard (right) side -> signedRel < 0
            // Port tack: wind comes over port (left) side -> signedRel >= 0
            if (signedRel < 0) {
                starboardFoilSec += dt;
            } else {
                portFoilSec += dt;
            }

            if (hasExplicitWind) {
                if (absRel >= 30 && absRel <= 85) {
                    upwindAngles.push(absRel);
                    const vmg = velocityStream[i] * Math.cos((absRel * Math.PI) / 180);
                    if (vmg > 0) upwindVmgsMs.push(vmg);
                } else if (absRel >= 95 && absRel <= 175) {
                    downwindAngles.push(180 - absRel);
                }
            }
        }
    }

    const totalTackSec = portFoilSec + starboardFoilSec;
    const portSymmetryPct = totalTackSec > 5 ? Math.round((portFoilSec / totalTackSec) * 100) : null;
    const completedTurns = turns.filter(t => t.completed).length;
    const wetTurns = turns.length - completedTurns;
    const completionRate = turns.length > 0 ? Math.round((completedTurns / turns.length) * 100) : null;

    const avgUpwindAngle = upwindAngles.length >= 5
        ? Math.round(upwindAngles.reduce((a, b) => a + b, 0) / upwindAngles.length)
        : null;
    const avgDownwindAngle = downwindAngles.length >= 5
        ? Math.round(downwindAngles.reduce((a, b) => a + b, 0) / downwindAngles.length)
        : null;
    const upwindVmgKts = upwindVmgsMs.length >= 5
        ? Number(((upwindVmgsMs.reduce((a, b) => a + b, 0) / upwindVmgsMs.length) * 1.94384).toFixed(1))
        : null;

    return {
        turns,
        totalAttempts: turns.length,
        completedTurns,
        wetTurns,
        completionRate,
        portFoilSec: Math.round(portFoilSec),
        starboardFoilSec: Math.round(starboardFoilSec),
        portSymmetryPct,
        avgUpwindAngle,
        avgDownwindAngle,
        upwindVmgKts,
    };
};

/**
 * Analyzes takeoff pumping attempts vs successful flights, heart rate by state,
 * and first-half vs second-half session fatigue.
 */
const _analyzeEfficiency = (velocityStream, timeStream, heartrateStream, pointStates, foilSegments, adaptiveProfile) => {
    const n = timeStream.length;
    const numberOfFlights = foilSegments.length;
    const surgeThreshold = adaptiveProfile ? adaptiveProfile.surgeDelta : 0.45;
    const minAttemptSpeed = adaptiveProfile ? adaptiveProfile.foilEntrySpeed * 0.85 : 1.55;

    // 1. Count failed pumping / takeoff surges outside of confirmed foil segments
    let failedSurgeCount = 0;
    let lastAttemptTime = -999;

    for (let i = 2; i < n - 1; i++) {
        if (pointStates[i] === 'foiling') {
            lastAttemptTime = timeStream[i];
            continue;
        }
        if (timeStream[i] - lastAttemptTime < 8) continue;

        let lookback = i - 1;
        while (lookback > 0 && (timeStream[i] - timeStream[lookback]) < 3.5) {
            lookback--;
        }
        const dt = timeStream[i] - timeStream[lookback];
        if (dt >= 1.5 && dt <= 5.5) {
            const dv = velocityStream[i] - velocityStream[lookback];
            if (dv >= surgeThreshold && velocityStream[i] >= minAttemptSpeed && velocityStream[lookback] >= 0.35) {
                // Check if this surge led into a foil segment within 4 seconds
                let ledToFoil = false;
                for (let k = i; k < n && (timeStream[k] - timeStream[i]) <= 4.0; k++) {
                    if (pointStates[k] === 'foiling') {
                        ledToFoil = true;
                        break;
                    }
                }
                if (!ledToFoil) {
                    failedSurgeCount++;
                    lastAttemptTime = timeStream[i];
                }
            }
        }
    }

    const takeoffAttempts = numberOfFlights + failedSurgeCount;
    const takeoffConversionRate = takeoffAttempts > 0
        ? Math.round((numberOfFlights / takeoffAttempts) * 100)
        : null;

    // 2. Heart rate by state (Foiling vs Pumping/Slogging)
    let avgFoilHeartRate = null;
    let avgPumpHeartRate = null;
    if (Array.isArray(heartrateStream) && heartrateStream.length === n) {
        const foilHrs = [];
        const pumpHrs = [];
        for (let i = 0; i < n; i++) {
            const hr = heartrateStream[i];
            if (typeof hr !== 'number' || hr <= 30 || isNaN(hr)) continue;
            if (pointStates[i] === 'foiling') {
                foilHrs.push(hr);
            } else if (pointStates[i] === 'sailing' && velocityStream[i] >= 0.4) {
                pumpHrs.push(hr);
            }
        }
        if (foilHrs.length >= 5) {
            avgFoilHeartRate = Math.round(foilHrs.reduce((a, b) => a + b, 0) / foilHrs.length);
        }
        if (pumpHrs.length >= 5) {
            avgPumpHeartRate = Math.round(pumpHrs.reduce((a, b) => a + b, 0) / pumpHrs.length);
        }
    }

    // 3. First-half vs Second-half session fatigue
    const midTime = (timeStream[0] + timeStream[n - 1]) / 2;
    let firstHalfMoving = 0, firstHalfFoil = 0;
    let secondHalfMoving = 0, secondHalfFoil = 0;

    for (let i = 1; i < n; i++) {
        const dt = timeStream[i] - timeStream[i - 1];
        if (dt <= 0 || dt > 30) continue;
        const avgV = (velocityStream[i] + velocityStream[i - 1]) / 2;
        if (avgV > 0.5) {
            if (timeStream[i] <= midTime) {
                firstHalfMoving += dt;
                if (pointStates[i] === 'foiling') firstHalfFoil += dt;
            } else {
                secondHalfMoving += dt;
                if (pointStates[i] === 'foiling') secondHalfFoil += dt;
            }
        }
    }

    const firstHalfFoilPct = firstHalfMoving > 10 ? Number(((firstHalfFoil / firstHalfMoving) * 100).toFixed(1)) : null;
    const secondHalfFoilPct = secondHalfMoving > 10 ? Number(((secondHalfFoil / secondHalfMoving) * 100).toFixed(1)) : null;

    return {
        takeoffAttempts,
        successfulFlights: numberOfFlights,
        failedSurges: failedSurgeCount,
        takeoffConversionRate,
        avgFoilHeartRate,
        avgPumpHeartRate,
        firstHalfFoilPct,
        secondHalfFoilPct,
    };
};

/**
 * Normalises a drifting altitude channel into a relative altitude.
 * Watch altitude on the water drifts with tide, air pressure and sensor warm-up. Subtracting a
 * slow rolling median (±windowSec) removes that drift so only short-term changes remain
 * (e.g. swell, pumping, wave riding). Returns null if there is no usable altitude.
 */
const _normalizeAltitude = (altitudeStream, timeStream, windowSec = 90) => {
    const n = timeStream.length;
    if (!Array.isArray(altitudeStream) || altitudeStream.length !== n || n === 0) return null;
    const out = new Array(n);
    let lo = 0;
    let hi = 0;
    for (let i = 0; i < n; i++) {
        while (lo < i && timeStream[i] - timeStream[lo] > windowSec) lo++;
        while (hi < n - 1 && timeStream[hi + 1] - timeStream[i] <= windowSec) hi++;
        const win = [];
        for (let k = lo; k <= hi; k++) {
            const a = altitudeStream[k];
            if (typeof a === 'number' && !isNaN(a)) win.push(a);
        }
        const a = altitudeStream[i];
        if (win.length === 0 || typeof a !== 'number' || isNaN(a)) {
            out[i] = 0;
            continue;
        }
        win.sort((x, y) => x - y);
        out[i] = Number((a - _percentile(win, 0.5)).toFixed(2));
    }
    return out;
};

export const analyzeSession = (streams, options = {}) => {
    if (!streams) return null;

    // 1. Extract Streams
    let velocityStream, altitudeStream, timeStream, latlngStream, heartrateStream;

    if (Array.isArray(streams)) {
        velocityStream = streams.find(s => s.type === 'velocity_smooth')?.data;
        altitudeStream = streams.find(s => s.type === 'altitude')?.data;
        timeStream = streams.find(s => s.type === 'time')?.data;
        latlngStream = streams.find(s => s.type === 'latlng')?.data;
        heartrateStream = streams.find(s => s.type === 'heartrate')?.data;
    } else if (typeof streams === 'object') {
        velocityStream = streams.velocity_smooth?.data;
        altitudeStream = streams.altitude?.data;
        timeStream = streams.time?.data;
        latlngStream = streams.latlng?.data;
        heartrateStream = streams.heartrate?.data;
    }

    if (!velocityStream || !timeStream || velocityStream.length === 0 || timeStream.length === 0) {
        return null; // Cannot analyze without speed & time data
    }

    const hasAltitudeArray = Array.isArray(altitudeStream) && altitudeStream.length === timeStream.length;
    if (!hasAltitudeArray) {
        altitudeStream = new Array(timeStream.length).fill(0);
    }

    const hasVelocity = velocityStream.some(v => typeof v === 'number' && v > 0);
    const nonZeroAlts = altitudeStream.filter(a => typeof a === 'number' && !isNaN(a) && a !== 0);
    const altRange = nonZeroAlts.length > 1 ? (Math.max(...nonZeroAlts) - Math.min(...nonZeroAlts)) : 0;
    // Barometric/GPS altitude on the water drifts badly (often 10-20 m over a session, e.g. the
    // 2026-10-31 Melville session swung from +7.7 m to -13.5 m). Real foil ride height is < 1 m,
    // so a robust altitude spread beyond a few metres means the altitude channel is noise and
    // must NOT be used for lift detection — fall back to the adaptive speed model instead.
    const sortedAlts = [...nonZeroAlts].sort((a, b) => a - b);
    const robustAltSpread = sortedAlts.length > 1
        ? _percentile(sortedAlts, 0.95) - _percentile(sortedAlts, 0.05)
        : 0;
    const MAX_PLAUSIBLE_WATER_ALT_SPREAD = 4.0;
    const altitudeUnreliable = robustAltSpread > MAX_PLAUSIBLE_WATER_ALT_SPREAD;
    const hasValidAltitude = nonZeroAlts.length > 0 && altRange > 0.1 && !altitudeUnreliable;

    if (!hasVelocity && !hasValidAltitude) {
        return null;
    }

    // 2. Dynamic Calibration & Point-by-Point Detection
    const dynamicBaseline = new Array(timeStream.length).fill(0);
    const pointStates = new Array(timeStream.length).fill('sailing'); // 'foiling', 'sailing', 'beach'
    const foilSegments = [];
    let currentSegment = null;
    let potentialStart = -1;
    let isCurrentlyFoiling = false;
    let adaptiveProfile = _computeAdaptiveSpeedProfile(velocityStream, timeStream, options);

    if (hasValidAltitude) {
        // ── Mode A: Altitude + Speed Detection ──────────────────────────────────
        let lastKnownWaterLevel = altitudeStream[0];
        const WATER_LEVEL_WINDOW = 60;
        const waterLevelBuffer = [];

        const PLANNING_SPEED = 0.8;
        const STALL_SPEED = 0.4;
        const LIFT_THRESHOLD = 0.2;
        const BEACH_THRESHOLD = 0.8;
        const PERSISTENCE_SECONDS = 2;

        for (let i = 0; i < timeStream.length; i++) {
            const speed = velocityStream[i];
            const alt = altitudeStream[i];

            if (speed < 0.5 && !isCurrentlyFoiling) {
                waterLevelBuffer.push(alt);
                if (waterLevelBuffer.length > WATER_LEVEL_WINDOW) {
                    waterLevelBuffer.shift();
                }
                if (waterLevelBuffer.length > 0) {
                    lastKnownWaterLevel = waterLevelBuffer.reduce((a, b) => a + b, 0) / waterLevelBuffer.length;
                }
            }
            dynamicBaseline[i] = lastKnownWaterLevel;

            const currentBaseline = dynamicBaseline[i];

            if (alt > currentBaseline + BEACH_THRESHOLD || alt < currentBaseline - BEACH_THRESHOLD * 2) {
                pointStates[i] = 'beach';
            }

            const hasLift = alt < (currentBaseline - LIFT_THRESHOLD);

            let shouldBeFoiling = false;
            if (!isCurrentlyFoiling) {
                if (speed > PLANNING_SPEED && hasLift && pointStates[i] !== 'beach') {
                    shouldBeFoiling = true;
                }
            } else {
                if (speed > STALL_SPEED && hasLift && pointStates[i] !== 'beach') {
                    shouldBeFoiling = true;
                }
            }

            if (shouldBeFoiling) {
                pointStates[i] = 'foiling';
                if (potentialStart === -1) {
                    potentialStart = i;
                }

                const durationSoFar = timeStream[i] - timeStream[potentialStart];
                if (durationSoFar >= PERSISTENCE_SECONDS) {
                    isCurrentlyFoiling = true;
                    if (!currentSegment) {
                        currentSegment = { start: potentialStart, end: i };
                    } else {
                        currentSegment.end = i;
                    }
                }
            } else {
                if (currentSegment) {
                    foilSegments.push(currentSegment);
                    currentSegment = null;
                }
                potentialStart = -1;
                isCurrentlyFoiling = false;
            }
        }
    } else {
        // ── Mode B: Adaptive Multi-Factor Speed Detection ───────────────────────
        adaptiveProfile = _computeAdaptiveSpeedProfile(velocityStream, timeStream, options);
        const {
            displacementSpeed: initialDispSpeed,
            foilEntrySpeed,
            sustainedFoilSpeed,
            stallSpeed,
            surgeDelta,
        } = adaptiveProfile;

        let localDispSpeed = initialDispSpeed;
        const DISP_WINDOW = 45;
        const dispBuffer = [];
        const PERSISTENCE_SECONDS = 3;

        for (let i = 0; i < timeStream.length; i++) {
            const speed = (i <= 2 && timeStream[i] <= 5 && velocityStream[i] > 3.5 && velocityStream[Math.min(i + 3, velocityStream.length - 1)] < 1.5)
                ? velocityStream[Math.min(i + 3, velocityStream.length - 1)]
                : velocityStream[i];

            if (speed < 0.25) {
                pointStates[i] = 'beach';
            }

            if (speed >= 0.25 && speed < stallSpeed * 0.9 && !isCurrentlyFoiling) {
                dispBuffer.push(speed);
                if (dispBuffer.length > DISP_WINDOW) {
                    dispBuffer.shift();
                }
                if (dispBuffer.length > 0) {
                    localDispSpeed = dispBuffer.reduce((a, b) => a + b, 0) / dispBuffer.length;
                }
            }
            dynamicBaseline[i] = localDispSpeed;

            let lookbackIdx = i;
            while (lookbackIdx > 0 && (timeStream[i] - timeStream[lookbackIdx]) < 4.5) {
                lookbackIdx--;
            }
            let recentMinSpeed = speed;
            for (let j = lookbackIdx; j < i; j++) {
                if (velocityStream[j] < recentMinSpeed) {
                    recentMinSpeed = velocityStream[j];
                }
            }

            let lookaheadIdx = i;
            while (lookaheadIdx < timeStream.length - 1 && (timeStream[lookaheadIdx] - timeStream[i]) < 2.0) {
                lookaheadIdx++;
            }
            const nextAvgSpeed = (velocityStream[i] + velocityStream[lookaheadIdx]) / 2;

            const recentSurge = speed - recentMinSpeed;
            const liftOverDisp = speed - localDispSpeed;

            let shouldBeFoiling = false;
            if (!isCurrentlyFoiling && potentialStart === -1) {
                const hasTakeoffSurge = recentSurge >= surgeDelta && liftOverDisp >= surgeDelta * 1.2;
                if (
                    (speed >= foilEntrySpeed && hasTakeoffSurge && nextAvgSpeed >= stallSpeed) ||
                    speed >= sustainedFoilSpeed
                ) {
                    shouldBeFoiling = true;
                }
            } else {
                const recentSlice = velocityStream.slice(Math.max(0, i - 4), i + 1);
                const peakRecent = Math.max(...recentSlice);
                const sharpTouchdown = (peakRecent - speed) > 0.75 && speed < foilEntrySpeed * 0.92;

                if (speed >= stallSpeed && !sharpTouchdown) {
                    shouldBeFoiling = true;
                }
            }

            if (shouldBeFoiling) {
                pointStates[i] = 'foiling';
                if (potentialStart === -1) {
                    potentialStart = i;
                }

                const durationSoFar = timeStream[i] - timeStream[potentialStart];
                if (durationSoFar >= PERSISTENCE_SECONDS) {
                    isCurrentlyFoiling = true;
                    if (!currentSegment) {
                        currentSegment = { start: potentialStart, end: i };
                    } else {
                        currentSegment.end = i;
                    }
                }
            } else {
                if (!isCurrentlyFoiling && potentialStart !== -1) {
                    for (let k = potentialStart; k < i; k++) {
                        if (pointStates[k] === 'foiling') pointStates[k] = 'sailing';
                    }
                }
                if (currentSegment) {
                    foilSegments.push(currentSegment);
                    currentSegment = null;
                }
                potentialStart = -1;
                isCurrentlyFoiling = false;
            }
        }
    }

    if (currentSegment) {
        foilSegments.push(currentSegment);
    }

    // Speed mode: reject short "surges" that never reach real flight speed.
    // Calibrated against rider-labelled data (2026-10-31): genuine flights peak at 4.5-5.2 m/s
    // (9-10 kts) while displacement sailing / sailing in on knees tops out ~2.0-2.5 m/s (4-5 kts).
    if (!hasValidAltitude && adaptiveProfile && foilSegments.length > 0) {
        const p95Val = adaptiveProfile.p95 || 0;
        const minFlightPeak = p95Val >= 3.5
            ? Math.max(2.8, p95Val * 0.6)
            : Math.max(1.5, p95Val * 0.55);
        for (let s = foilSegments.length - 1; s >= 0; s--) {
            const seg = foilSegments[s];
            let peak = 0;
            for (let k = seg.start; k <= seg.end; k++) {
                const v = velocityStream[k];
                if (v > peak && v < 30) peak = v;
            }
            if (peak < minFlightPeak) {
                for (let k = seg.start; k <= seg.end; k++) {
                    if (pointStates[k] === 'foiling') pointStates[k] = 'sailing';
                }
                foilSegments.splice(s, 1);
            }
        }
    }

    // Merge micro-dips (< 3 seconds off-foil where speed stayed near stall threshold, e.g. mid-gybe)
    const rawMergedSegments = [];
    for (const seg of foilSegments) {
        if (rawMergedSegments.length === 0) {
            rawMergedSegments.push({ ...seg });
        } else {
            const prev = rawMergedSegments[rawMergedSegments.length - 1];
            const gapSeconds = timeStream[seg.start] - timeStream[prev.end];
            if (gapSeconds <= 3) {
                const prevEnd = prev.end;
                prev.end = seg.end;
                for (let k = prevEnd; k <= seg.start; k++) {
                    pointStates[k] = 'foiling';
                }
            } else {
                rawMergedSegments.push({ ...seg });
            }
        }
    }

    // Enrich each flight segment with per-flight telemetry breakdown (Feature #15)
    let longestFlightSec = 0;
    const hasHrArray = Array.isArray(heartrateStream) && heartrateStream.length === timeStream.length;

    const mergedSegments = rawMergedSegments.map((seg, idx) => {
        const startTimeSec = timeStream[seg.start];
        const endTimeSec = timeStream[seg.end];
        const durationSec = Math.max(1, Math.round(endTimeSec - startTimeSec));
        if (durationSec > longestFlightSec) {
            longestFlightSec = durationSec;
        }

        let distM = 0;
        let maxSpeedMs = velocityStream[seg.start] || 0;
        let hrSum = 0;
        let hrCount = 0;

        for (let k = seg.start; k <= seg.end; k++) {
            const v = velocityStream[k] || 0;
            if (v > maxSpeedMs && v < 30) maxSpeedMs = v;
            if (k > seg.start) {
                const dt = timeStream[k] - timeStream[k - 1];
                if (dt > 0 && dt < 30 && v < 30) {
                    distM += v * dt;
                }
            }
            if (hasHrArray && heartrateStream[k] > 30) {
                hrSum += heartrateStream[k];
                hrCount++;
            }
        }

        const avgSpeedMs = durationSec > 0 ? distM / durationSec : maxSpeedMs;

        return {
            ...seg,
            flightNumber: idx + 1,
            startTimeSec,
            endTimeSec,
            durationSec,
            distanceM: Math.round(distM),
            avgSpeedMs: Number(avgSpeedMs.toFixed(2)),
            maxSpeedMs: Number(maxSpeedMs.toFixed(2)),
            avgSpeedKts: Number((avgSpeedMs * 1.94384).toFixed(1)),
            topSpeedKts: Number((maxSpeedMs * 1.94384).toFixed(1)),
            avgHeartRate: hrCount > 0 ? Math.round(hrSum / hrCount) : null,
        };
    });

    // 4. Calculate Aggregate Stats
    let totalFoilTimeSeconds = 0;
    mergedSegments.forEach(seg => {
        totalFoilTimeSeconds += (timeStream[seg.end] - timeStream[seg.start]);
    });

    const numberOfFlights = mergedSegments.length;

    let movingTimeSeconds = 0;
    for (let i = 1; i < timeStream.length; i++) {
        const avgSpeed = (velocityStream[i] + velocityStream[i - 1]) / 2;
        if (avgSpeed > 0.5) {
            movingTimeSeconds += (timeStream[i] - timeStream[i - 1]);
        }
    }

    const percentFoil = movingTimeSeconds > 0
        ? ((totalFoilTimeSeconds / movingTimeSeconds) * 100).toFixed(1)
        : 0;

    let totalRuns = 0;
    if (mergedSegments.length > 0) {
        totalRuns = 1;
        for (let i = 1; i < mergedSegments.length; i++) {
            const gap = timeStream[mergedSegments[i].start] - timeStream[mergedSegments[i - 1].end];
            if (gap > 30) {
                totalRuns++;
            }
        }
    }

    const validTopSpeeds = velocityStream.slice(1).filter(v => !isNaN(v) && v < 30);
    const maxSpeedMs = validTopSpeeds.length > 0
        ? Math.max(...validTopSpeeds)
        : (velocityStream[0] || 0);
    const topSpeedKts = (maxSpeedMs * 1.94384).toFixed(1);
    const topSpeedMs = maxSpeedMs.toFixed(1);

    let totalDistanceM = 0;
    for (let i = 1; i < timeStream.length; i++) {
        const dt = timeStream[i] - timeStream[i - 1];
        const v = velocityStream[i];
        if (dt > 0 && dt < 30 && !isNaN(v) && v < 30) {
            totalDistanceM += v * dt;
        }
    }
    const totalDistanceKm = (totalDistanceM / 1000).toFixed(2);

    // 5. Maneuver (Gybe/Tack) & Angle Analysis (AI Coach Part 2)
    const maneuvers = _analyzeManeuversAndAngles(
        latlngStream,
        velocityStream,
        timeStream,
        pointStates,
        options?.windDirection
    );

    // 6. Takeoff Efficiency & Heart Rate / Fatigue Analysis (AI Coach Part 2)
    const efficiency = _analyzeEfficiency(
        velocityStream,
        timeStream,
        heartrateStream,
        pointStates,
        mergedSegments,
        adaptiveProfile
    );

    return {
        mode: hasValidAltitude ? 'altitude' : 'speed',
        altitudeRejected: altitudeUnreliable,
        adaptiveThreshold: adaptiveProfile?.foilEntrySpeed || null,
        adaptiveProfile,
        baselineAltitude: dynamicBaseline[0] || 0,
        dynamicBaseline,
        pointStates,
        foilSegments: mergedSegments,
        maneuvers,
        efficiency,
        stats: {
            totalFoilTime: (totalFoilTimeSeconds / 60).toFixed(1), // minutes
            topSpeed: topSpeedKts,
            topSpeedMs,
            totalDistance: totalDistanceKm,
            numberOfFlights,
            percentFoil,
            totalRuns,
            longestFlightSec,
            longestFlightFormatted: formatDurationSec(longestFlightSec),
            gybeAttempts: maneuvers.totalAttempts,
            gybesCompleted: maneuvers.completedTurns,
            gybeCompletionRate: maneuvers.completionRate,
            takeoffAttempts: efficiency.takeoffAttempts,
            takeoffConversionRate: efficiency.takeoffConversionRate,
        },
        data: {
            velocity: velocityStream,
            altitude: altitudeStream,
            // Drift/tide-corrected altitude for display (null when no altitude was recorded)
            altitudeNormalized: (hasAltitudeArray && nonZeroAlts.length > 0 && altRange > 0.1)
                ? _normalizeAltitude(altitudeStream, timeStream)
                : null,
            time: timeStream
        }
    };
};
