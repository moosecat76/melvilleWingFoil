
/**
 * foilAnalysisService.js
 * 
 * Logic for detecting "On Foil" segments from telemetry streams.
 * 
 * RULES:
 * 1. Calibration: Baseline = Mode/Avg of first 10s of Altitude.
 * 2. Detection: 
 *      - Speed > 0.8 m/s (Planning Threshold)
 *      - Altitude < Baseline - 0.2m (Lift)
 *      - Persistence: >= 2 seconds
 * 3. Stats:
 *      - Total Foil Time
 *      - Number of Flights
 *      - % of Moving Time on Foil (Speed > 0.5 m/s)
 *      - Total Runs (Segments separated by > 30s of non-planning)
 */

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

    if (!velocityStream || !altitudeStream || !timeStream) {
        console.warn("Missing required streams for foil analysis.");
        return null; // Cannot analyze without core data
    }

    // 2. Dynamic Calibration & Point-by-Point Detection
    const dynamicBaseline = new Array(timeStream.length).fill(0);
    const pointStates = new Array(timeStream.length).fill('sailing'); // 'foiling', 'sailing', 'beach'

    let lastKnownWaterLevel = altitudeStream[0];
    const WATER_LEVEL_WINDOW = 60; // 60s moving window for water level
    const waterLevelBuffer = [];

    // Constants
    const PLANNING_SPEED = 0.8; // m/s
    const STALL_SPEED = 0.4; // m/s (can stay on foil if speed drops a bit but alt is good)
    const LIFT_THRESHOLD = 0.2; // m (numerical drop = lift)
    const BEACH_THRESHOLD = 0.8; // m (significant numerical rise = beach/walking)
    const PERSISTENCE_SECONDS = 2;

    const foilSegments = [];
    let currentSegment = null;
    let potentialStart = -1;
    let isCurrentlyFoiling = false;

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

        // Determine state for this point
        const currentBaseline = dynamicBaseline[i];
        
        // Beach detection: if altitude numerical value rises significantly (could be walking, or GPS drift)
        // Adjust depending on if sensor is inverted. Fall-in = peak. So let's classify extreme peaks as beach/break
        if (alt > currentBaseline + BEACH_THRESHOLD || alt < currentBaseline - BEACH_THRESHOLD * 2) {
            pointStates[i] = 'beach';
        }

        // Foiling Candidates
        // numerical drop = lift. 
        const hasLift = alt < (currentBaseline - LIFT_THRESHOLD);
        
        let shouldBeFoiling = false;
        if (!isCurrentlyFoiling) {
            // To start foiling, need planning speed and lift
            if (speed > PLANNING_SPEED && hasLift && pointStates[i] !== 'beach') {
                shouldBeFoiling = true;
            }
        } else {
            // To stay on foil, can drop to stall speed as long as lift is maintained
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
            // Condition broken
            if (currentSegment) {
                foilSegments.push(currentSegment);
                currentSegment = null;
            }
            potentialStart = -1;
            isCurrentlyFoiling = false;
        }
    }

    if (currentSegment) {
        foilSegments.push(currentSegment);
    }


    // 4. Calculate Stats
    let totalFoilTimeSeconds = 0;
    foilSegments.forEach(seg => {
        totalFoilTimeSeconds += (timeStream[seg.end] - timeStream[seg.start]);
    });

    const numberOfFlights = foilSegments.length;

    // % Moving Time on Foil
    // Moving time = Total Time where Speed > 0.5 m/s
    let movingTimeSeconds = 0;
    // Assuming 1s intervals roughly, or summing dt
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
    // We already have foilSegments. We can group them.
    // If Gap between Seg1_End and Seg2_Start < 30s, they are same "Run".
    let totalRuns = 0;
    if (foilSegments.length > 0) {
        totalRuns = 1;
        for (let i = 1; i < foilSegments.length; i++) {
            const gap = timeStream[foilSegments[i].start] - timeStream[foilSegments[i - 1].end];
            if (gap > 30) {
                totalRuns++;
            }
        }
    }

    return {
        baselineAltitude: dynamicBaseline[0] || 0, // Fallback for UI if needed
        dynamicBaseline,
        pointStates,
        foilSegments,
        stats: {
            totalFoilTime: (totalFoilTimeSeconds / 60).toFixed(1), // minutes
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
