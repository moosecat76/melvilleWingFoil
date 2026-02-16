
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

    // 2. Calibration (Dynamic Baseline)
    // "Average of the first 10 seconds"
    // Assuming 1hz data for simplicity, or using time stream if available.
    // Strava streams are usually 1 datapoint per second, but let's be safe.
    let baselineAltitude = 0;
    let calibrationPoints = 0;

    for (let i = 0; i < timeStream.length; i++) {
        if (timeStream[i] - timeStream[0] <= 10) {
            baselineAltitude += altitudeStream[i];
            calibrationPoints++;
        } else {
            break;
        }
    }

    baselineAltitude = calibrationPoints > 0 ? baselineAltitude / calibrationPoints : altitudeStream[0];

    // 3. Detection
    const foilSegments = [];
    let currentSegment = null;
    let potentialStart = -1;

    // Constants
    const PLANNING_SPEED = 0.8; // m/s
    const LIFT_THRESHOLD = 0.2; // m (lower than baseline)
    const PERSISTENCE_SECONDS = 2;

    // Helper to check if a point is "On Foil" candidates
    const isFoilCandidate = (i) => {
        const speed = velocityStream[i];
        const alt = altitudeStream[i];

        // "Altitude is at least 0.2m LOWER than baseline (indicating physical lift)"
        // Note: As discussed, we assume sensor measures distance-to-water or similar where DROP = LIFT.
        // OR standard barometric where UP = UP. 
        // Logic requested: "lower than baseline". 
        // e.g. Baseline 4.2. Lift if Alt < 4.0.
        const hasLift = alt < (baselineAltitude - LIFT_THRESHOLD);

        return speed > PLANNING_SPEED && hasLift;
    };

    // Iterate
    for (let i = 0; i < timeStream.length; i++) {
        if (isFoilCandidate(i)) {
            if (potentialStart === -1) {
                potentialStart = i;
            }

            // If we have a potential start, check persistence
            const durationSoFar = timeStream[i] - timeStream[potentialStart];

            if (durationSoFar >= PERSISTENCE_SECONDS) {
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
        }
    }
    // Close last segment if active
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
        baselineAltitude,
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
