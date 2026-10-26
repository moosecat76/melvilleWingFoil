/**
 * foilAnalysisService.js
 * 
 * Logic for detecting "On Foil" segments from telemetry streams.
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
 * 
 * 3. Stats:
 *      - Total Foil Time (minutes)
 *      - Top Speed (kts and m/s)
 *      - Number of Flights
 *      - % of Moving Time on Foil (Speed > 0.5 m/s)
 *      - Total Runs (Segments separated by > 30s of non-planning)
 */

const _percentile = (sortedArr, p) => {
    if (!sortedArr || sortedArr.length === 0) return 0;
    const idx = (sortedArr.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sortedArr[lo];
    return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo);
};

/**
 * Computes adaptive speed thresholds from the session's velocity distribution.
 * Separates two natural regimes in wing/wind foiling:
 *   1. Displacement / taxiing / slogging regime (lower cluster)
 *   2. Planing / on-foil regime (upper tail separated by takeoff acceleration)
 */
const _computeAdaptiveSpeedProfile = (velocityStream, timeStream) => {
    // Filter out initial GPS spike at t=0 (common when watch acquires lock) and stationary points
    const validMoving = [];
    for (let i = 1; i < velocityStream.length; i++) {
        const v = velocityStream[i];
        if (v >= 0.3 && v < 25) {
            validMoving.push(v);
        }
    }

    if (validMoving.length < 10) {
        return {
            displacementSpeed: 0.8,
            foilEntrySpeed: 1.9,
            sustainedFoilSpeed: 2.2,
            stallSpeed: 1.5,
            surgeDelta: 0.45,
        };
    }

    const sorted = [...validMoving].sort((a, b) => a - b);
    const p25 = _percentile(sorted, 0.25);
    const p50 = _percentile(sorted, 0.50);
    const p75 = _percentile(sorted, 0.75);
    const p90 = _percentile(sorted, 0.90);
    const p95 = _percentile(sorted, 0.95);

    // 1. Estimate typical displacement (off-foil) sailing speed
    // Look at the lower speeds where displacement taxiing/slogging occurs (< 1.6 m/s)
    const lowerHalf = sorted.filter(v => v <= 1.6);
    const displacementBase = lowerHalf.length > 0
        ? lowerHalf.reduce((a, b) => a + b, 0) / lowerHalf.length
        : Math.min(p25, 1.0);

    // 2. Analyze speeds where strongest positive accelerations (takeoff surges) occur
    // When popping onto the foil, drag drops suddenly and speed jumps rapidly over 2-4 seconds
    const surgeCrossings = [];
    for (let i = 2; i < velocityStream.length - 1; i++) {
        let lookback = i - 1;
        while (lookback > 1 && (timeStream[i] - timeStream[lookback]) < 3.5) {
            lookback--;
        }
        const dt = timeStream[i] - timeStream[lookback];
        if (dt >= 1.5 && dt <= 6) {
            const dv = velocityStream[i] - velocityStream[lookback];
            const accel = dv / dt;
            // Strong positive acceleration crossing above displacement hull speed
            if (dv >= 0.5 && accel >= 0.18 && velocityStream[i] >= 1.5 && velocityStream[lookback] >= 0.4) {
                // Midpoint of the surge is right around liftoff
                surgeCrossings.push((velocityStream[i] + velocityStream[lookback]) * 0.55);
            }
        }
    }

    // 3. Otsu-style bimodal valley search between [1.4 m/s, 2.6 m/s]
    // Finds the threshold that maximizes between-class variance of (displacement vs foiling)
    let bestOtsuThreshold = 1.95;
    let maxBetweenVar = -1;
    const activeSpeeds = sorted.filter(v => v >= 0.5);
    if (activeSpeeds.length >= 20) {
        for (let t = 1.45; t <= 2.55; t += 0.05) {
            const c0 = activeSpeeds.filter(v => v < t);
            const c1 = activeSpeeds.filter(v => v >= t);
            if (c0.length < 5 || c1.length < 5) continue;

            const w0 = c0.length / activeSpeeds.length;
            const w1 = c1.length / activeSpeeds.length;
            const mu0 = c0.reduce((a, b) => a + b, 0) / c0.length;
            const mu1 = c1.reduce((a, b) => a + b, 0) / c1.length;

            // Require meaningful separation between displacement mean and foil mean
            if (mu1 - mu0 < 0.8) continue;

            // Favor thresholds near the physical displacement-to-foil transition (1.8-2.05 m/s)
            // rather than high up inside the flight speed distribution
            const priorWeight = Math.exp(-((t - 1.95) ** 2) / (2 * 0.35 ** 2));
            const betweenVar = w0 * w1 * ((mu0 - mu1) ** 2) * priorWeight;
            if (betweenVar > maxBetweenVar) {
                maxBetweenVar = betweenVar;
                bestOtsuThreshold = t;
            }
        }
    }

    // 4. Combine Otsu bimodal boundary, surge crossing median, and session speed range
    const surgeMedian = surgeCrossings.length >= 3
        ? _percentile([...surgeCrossings].sort((a, b) => a - b), 0.5)
        : bestOtsuThreshold;

    // Blend the estimators and clamp to realistic physical foil takeoff bounds (1.75 m/s to 2.2 m/s)
    // For a 1200cm² foil with top speeds ~4.5-5.5 m/s (~10-11 kts), this naturally lands right around 1.9–2.05 m/s.
    const rawEntry = 0.6 * bestOtsuThreshold + 0.25 * surgeMedian + 0.15 * Math.max(1.8, displacementBase + 1.0);
    const foilEntrySpeed = Number(Math.min(2.2, Math.max(1.75, rawEntry)).toFixed(2));
    const sustainedFoilSpeed = Number(Math.min(2.6, Math.max(foilEntrySpeed + 0.25, 2.25)).toFixed(2));
    const stallSpeed = Number(Math.max(1.4, foilEntrySpeed * 0.82).toFixed(2));
    const surgeDelta = Number(Math.max(0.35, (foilEntrySpeed - displacementBase) * 0.35).toFixed(2));

    return {
        displacementSpeed: Number(displacementBase.toFixed(2)),
        foilEntrySpeed,
        sustainedFoilSpeed,
        stallSpeed,
        surgeDelta,
        p95: Number(p95.toFixed(2)),
    };
};

export const analyzeSession = (streams) => {
    if (!streams) return null;

    // 1. Extract Streams
    let velocityStream, altitudeStream, timeStream;

    // Handle Strava format (array of objects with type) vs processed format (object with keys)
    if (Array.isArray(streams)) {
        velocityStream = streams.find(s => s.type === 'velocity_smooth')?.data;
        altitudeStream = streams.find(s => s.type === 'altitude')?.data;
        timeStream = streams.find(s => s.type === 'time')?.data;
    } else if (typeof streams === 'object') {
        velocityStream = streams.velocity_smooth?.data;
        altitudeStream = streams.altitude?.data;
        timeStream = streams.time?.data;
    }

    if (!velocityStream || !timeStream || velocityStream.length === 0 || timeStream.length === 0) {
        return null; // Cannot analyze without speed & time data
    }

    // Ensure altitudeStream is an array of same length (fallback to zeros if missing)
    const hasAltitudeArray = Array.isArray(altitudeStream) && altitudeStream.length === timeStream.length;
    if (!hasAltitudeArray) {
        altitudeStream = new Array(timeStream.length).fill(0);
    }

    // Check if streams actually contain valid motion
    const hasVelocity = velocityStream.some(v => v > 0);
    const nonZeroAlts = altitudeStream.filter(a => a !== 0 && !isNaN(a));
    const altRange = nonZeroAlts.length > 1 ? (Math.max(...nonZeroAlts) - Math.min(...nonZeroAlts)) : 0;
    const hasValidAltitude = nonZeroAlts.length > 0 && altRange > 0.1;

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
    let adaptiveProfile = null;

    if (hasValidAltitude) {
        // ── Mode A: Altitude + Speed Detection ──────────────────────────────────
        let lastKnownWaterLevel = altitudeStream[0];
        const WATER_LEVEL_WINDOW = 60; // 60s moving window for water level
        const waterLevelBuffer = [];

        const PLANNING_SPEED = 0.8; // m/s
        const STALL_SPEED = 0.4; // m/s (can stay on foil if speed drops a bit but alt is good)
        const LIFT_THRESHOLD = 0.2; // m (numerical drop = lift)
        const BEACH_THRESHOLD = 0.8; // m (significant numerical rise = beach/walking)
        const PERSISTENCE_SECONDS = 2;

        for (let i = 0; i < timeStream.length; i++) {
            const speed = velocityStream[i];
            const alt = altitudeStream[i];

            // Track water level only when moving slowly (e.g., drifting, not foiling)
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

            // Beach detection: if altitude numerical value rises significantly
            if (alt > currentBaseline + BEACH_THRESHOLD || alt < currentBaseline - BEACH_THRESHOLD * 2) {
                pointStates[i] = 'beach';
            }

            // Foiling Candidates: numerical drop = lift
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
        adaptiveProfile = _computeAdaptiveSpeedProfile(velocityStream, timeStream);
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
        const PERSISTENCE_SECONDS = 3; // Require at least 3s to filter out brief wave/pump spikes

        for (let i = 0; i < timeStream.length; i++) {
            // Ignore initial GPS lock spike in the first 3 seconds if abnormally high
            const speed = (i <= 2 && timeStream[i] <= 5 && velocityStream[i] > 3.5 && velocityStream[Math.min(i + 3, velocityStream.length - 1)] < 1.5)
                ? velocityStream[Math.min(i + 3, velocityStream.length - 1)]
                : velocityStream[i];

            if (speed < 0.25) {
                pointStates[i] = 'beach'; // Stationary / resting in water
            }

            // Update local displacement baseline when clearly sailing off-foil
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

            // Look back ~4 seconds to measure takeoff surge from displacement trough
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

            // Look ahead ~2 seconds to check if speed is actively building or already crashing
            let lookaheadIdx = i;
            while (lookaheadIdx < timeStream.length - 1 && (timeStream[lookaheadIdx] - timeStream[i]) < 2.0) {
                lookaheadIdx++;
            }
            const nextAvgSpeed = (velocityStream[i] + velocityStream[lookaheadIdx]) / 2;

            const recentSurge = speed - recentMinSpeed;
            const liftOverDisp = speed - localDispSpeed;

            let shouldBeFoiling = false;
            if (!isCurrentlyFoiling && potentialStart === -1) {
                // To initiate flight:
                // 1) Speed reaches adaptive foilEntrySpeed (~2.0 m/s) WITH a sudden acceleration surge
                //    and doesn't immediately collapse on the next sample, OR
                // 2) Speed reaches clear sustainedFoilSpeed (~2.25+ m/s)
                const hasTakeoffSurge = recentSurge >= surgeDelta && liftOverDisp >= surgeDelta * 1.2;
                if (
                    (speed >= foilEntrySpeed && hasTakeoffSurge && nextAvgSpeed >= stallSpeed) ||
                    speed >= sustainedFoilSpeed
                ) {
                    shouldBeFoiling = true;
                }
            } else {
                // Once in flight (or takeoff candidate):
                // Stay on foil as long as speed remains above adaptive stallSpeed (~1.6 m/s)
                // and hasn't suffered a sharp touchdown deceleration below foilEntrySpeed
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
                // Clean up candidate points that didn't reach persistence
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

    // Merge micro-dips (< 3 seconds off-foil where speed stayed near stall threshold, e.g. mid-gybe)
    const mergedSegments = [];
    for (const seg of foilSegments) {
        if (mergedSegments.length === 0) {
            mergedSegments.push({ ...seg });
        } else {
            const prev = mergedSegments[mergedSegments.length - 1];
            const gapSeconds = timeStream[seg.start] - timeStream[prev.end];
            if (gapSeconds <= 3) {
                prev.end = seg.end;
                for (let k = prev.end; k <= seg.start; k++) {
                    pointStates[k] = 'foiling';
                }
            } else {
                mergedSegments.push({ ...seg });
            }
        }
    }

    // 4. Calculate Stats
    let totalFoilTimeSeconds = 0;
    mergedSegments.forEach(seg => {
        totalFoilTimeSeconds += (timeStream[seg.end] - timeStream[seg.start]);
    });

    const numberOfFlights = mergedSegments.length;

    // % Moving Time on Foil
    // Moving time = Total Time where Speed > 0.5 m/s
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

    // Total Runs
    // "Count of segments separated by more than 30 seconds of stationary or sub-planning speed"
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

    // Calculate Top Speed (ignoring t=0 initial GPS lock artifact if present)
    const validTopSpeeds = velocityStream.slice(1).filter(v => !isNaN(v) && v < 30);
    const maxSpeedMs = validTopSpeeds.length > 0
        ? Math.max(...validTopSpeeds)
        : (velocityStream[0] || 0);
    const topSpeedKts = (maxSpeedMs * 1.94384).toFixed(1);
    const topSpeedMs = maxSpeedMs.toFixed(1);

    return {
        mode: hasValidAltitude ? 'altitude' : 'speed',
        adaptiveThreshold: adaptiveProfile?.foilEntrySpeed || null,
        adaptiveProfile,
        baselineAltitude: dynamicBaseline[0] || 0, // Fallback for UI if needed
        dynamicBaseline,
        pointStates,
        foilSegments: mergedSegments,
        stats: {
            totalFoilTime: (totalFoilTimeSeconds / 60).toFixed(1), // minutes
            topSpeed: topSpeedKts,
            topSpeedMs,
            numberOfFlights,
            percentFoil,
            totalRuns
        },
        data: {
            velocity: velocityStream,
            altitude: altitudeStream,
            time: timeStream
        }
    };
};
