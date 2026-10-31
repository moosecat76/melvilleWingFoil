import { describe, it, expect } from 'vitest';
import { analyzeSession } from '../foilAnalysisService';

describe('foilAnalysisService', () => {
    it('uses altitude mode when valid altitude changes are present', () => {
        const time = Array.from({ length: 15 }, (_, i) => i);
        const velocity = [
            0.2, 0.2, 0.3, 0.3, 0.4,
            2.2, 2.5, 2.6, 2.5, 2.4, 2.3, 2.2, 2.0,
            0.3, 0.2
        ];
        const altitude = [
            10.0, 10.0, 10.0, 10.0, 10.0,
            9.5, 9.4, 9.4, 9.5, 9.5, 9.5, 9.6, 9.6,
            10.0, 10.0
        ];

        const result = analyzeSession({
            time: { data: time },
            velocity_smooth: { data: velocity },
            altitude: { data: altitude },
        });

        expect(result).not.toBeNull();
        expect(result.mode).toBe('altitude');
        expect(result.stats.numberOfFlights).toBe(1);
        expect(parseFloat(result.stats.totalFoilTime)).toBeGreaterThan(0);
        expect(parseFloat(result.stats.topSpeed)).toBeGreaterThan(4.5);
        expect(result.foilSegments[0].flightNumber).toBe(1);
        expect(result.foilSegments[0].durationSec).toBe(7);
        expect(result.foilSegments[0].topSpeedKts).toBeGreaterThan(4.5);
    });

    it('adaptively profiles speed distribution (~2 m/s entry) and ignores sub-foil slogging (<1.8 m/s)', () => {
        const time = Array.from({ length: 40 }, (_, i) => i);
        const velocity = [
            0.5, 0.7, 1.1, 1.4, 1.5, 1.3, 0.9, 0.7, 0.8, 1.0,
            2.1, 2.8, 3.4, 3.8, 3.7, 3.5, 3.2, 2.9, 2.6, 2.3, 2.0,
            1.1, 0.8, 0.6, 0.9, 1.3, 1.4, 1.2, 0.8, 0.9,
            2.2, 3.0, 3.6, 4.2, 4.0, 3.8, 3.3, 2.8, 2.4, 2.1
        ];
        const altitude = new Array(40).fill(0);

        const result = analyzeSession({
            time: { data: time },
            velocity_smooth: { data: velocity },
            altitude: { data: altitude },
        });

        expect(result).not.toBeNull();
        expect(result.mode).toBe('speed');
        expect(result.adaptiveThreshold).toBeGreaterThanOrEqual(1.65);
        expect(result.adaptiveThreshold).toBeLessThanOrEqual(2.4);
        expect(result.stats.numberOfFlights).toBe(2);
        expect(result.foilSegments[0].start).toBe(10);
        expect(result.foilSegments[0].end).toBe(20);
        expect(result.foilSegments[1].start).toBe(30);
        expect(result.foilSegments[1].end).toBe(39);
        expect(result.stats.totalRuns).toBe(1);
        expect(result.stats.longestFlightSec).toBe(10);
    });

    it('detects multiple flights and separates runs when gap > 30s in adaptive speed mode', () => {
        const time = Array.from({ length: 70 }, (_, i) => i);
        const velocity = new Array(70).fill(0.7);
        const altitude = new Array(70).fill(0);

        for (let t = 5; t <= 12; t++) velocity[t] = 3.0;
        for (let t = 18; t <= 25; t++) velocity[t] = 3.2;
        for (let t = 58; t <= 65; t++) velocity[t] = 3.5;

        const result = analyzeSession({
            time: { data: time },
            velocity_smooth: { data: velocity },
            altitude: { data: altitude },
        });

        expect(result.mode).toBe('speed');
        expect(result.stats.numberOfFlights).toBe(3);
        expect(result.stats.totalRuns).toBe(2);
    });

    it('rejects drifting barometric altitude and ignores slow sailing surges (2026-10-31 calibration)', () => {
        const n = 200;
        const time = Array.from({ length: n }, (_, i) => i);
        const velocity = new Array(n).fill(0.6); // walking / drifting
        // Real flight: ~4.5 m/s (8.7 kts) for 60s
        for (let t = 20; t < 80; t++) velocity[t] = 4.5;
        // Slow sailing in on knees: ~1.5 m/s with a short 2.3 m/s surge (should NOT be foil)
        for (let t = 100; t < 180; t++) velocity[t] = 1.5;
        for (let t = 130; t < 140; t++) velocity[t] = 2.3;
        // Altitude drifts ~15 m across the session (barometric noise on the water)
        const altitude = time.map(t => 7 - t * 0.075);

        const result = analyzeSession({
            time: { data: time },
            velocity_smooth: { data: velocity },
            altitude: { data: altitude },
        });

        expect(result.mode).toBe('speed');
        expect(result.altitudeRejected).toBe(true);
        expect(result.stats.numberOfFlights).toBe(1);
        expect(result.foilSegments[0].startTimeSec).toBeGreaterThanOrEqual(19);
        expect(result.foilSegments[0].startTimeSec).toBeLessThanOrEqual(22);
        expect(result.pointStates.slice(100, 180).every(s => s !== 'foiling')).toBe(true);
    });

    it('detects foiling gybes vs wet gybes and computes tack symmetry from GPS latlng stream', () => {
        // 50 seconds:
        // t=0..4: displacement (0.8 m/s)
        // t=5..25: continuous foiling flight (3.5 m/s) with a 100° foiling gybe around t=14..18
        // t=26..30: displacement (0.8 m/s)
        // t=31..40: foiling flight (3.4 m/s) into a wet gybe at t=40..44 where rider turns 95° and drops to 0.9 m/s
        const n = 50;
        const time = Array.from({ length: n }, (_, i) => i);
        const velocity = new Array(n).fill(0.8);
        const altitude = new Array(n).fill(0);
        const heartrate = new Array(n).fill(145);

        for (let t = 5; t <= 25; t++) {
            velocity[t] = 3.5;
            heartrate[t] = 132;
        }
        for (let t = 31; t <= 40; t++) {
            velocity[t] = 3.4;
            heartrate[t] = 135;
        }
        for (let t = 41; t <= 46; t++) {
            velocity[t] = 1.0; // dropped off foil during turn exit
            heartrate[t] = 158;
        }

        // Build GPS coordinates matching headings:
        // t=0..14: heading East (90°)
        // t=15..25: carves South-West (195°) -> 105° turn while staying on foil!
        // t=26..39: heading East (90°)
        // t=40..48: carves South-West (190°) -> 100° turn but drops off foil at t=41!
        const latlng = [];
        let lat = -32.013;
        let lng = 115.829;
        for (let t = 0; t < n; t++) {
            let bearingDeg = 90;
            if (t >= 15 && t <= 25) bearingDeg = 195;
            else if (t === 39) bearingDeg = 140; // carving through apex on foil
            else if (t >= 40) bearingDeg = 190;  // completes turn angle and touches down at t=41

            const distM = velocity[t]; // 1s step
            const rad = (bearingDeg * Math.PI) / 180;
            lat += (distM / 111320) * Math.cos(rad);
            lng += (distM / (111320 * Math.cos((lat * Math.PI) / 180))) * Math.sin(rad);
            latlng.push([lat, lng]);
        }

        const result = analyzeSession(
            {
                time: { data: time },
                velocity_smooth: { data: velocity },
                altitude: { data: altitude },
                latlng: { data: latlng },
                heartrate: { data: heartrate },
            },
            { windDirection: 225 }
        );

        expect(result.maneuvers).toBeDefined();
        expect(result.maneuvers.totalAttempts).toBe(2);
        expect(result.maneuvers.completedTurns).toBe(1);
        expect(result.maneuvers.wetTurns).toBe(1);
        expect(result.maneuvers.completionRate).toBe(50);
        expect(result.efficiency.avgFoilHeartRate).toBeLessThan(result.efficiency.avgPumpHeartRate);
    });

    it('calculates percentFoil across total session duration and provides percentFoilMoving', () => {
        // 120s total session:
        // t=0..20: stationary / beach rest (0.1 m/s)
        // t=21..50: foiling (3.5 m/s) -> 30s foil time
        // t=51..70: displacement sailing (0.8 m/s) -> 20s moving non-foil
        // t=71..120: stationary / rest on beach (0.1 m/s) -> 50s rest
        // Total session: 120s
        // Total moving time: 30s (foil) + 20s (sailing) = ~50s moving
        // percentFoil of session = 30 / 120 = 25.0%
        // percentFoilMoving = 30 / 50 = ~60.0%
        const n = 121;
        const time = Array.from({ length: n }, (_, i) => i);
        const velocity = new Array(n).fill(0.1);
        const altitude = new Array(n).fill(0);

        for (let t = 21; t <= 50; t++) velocity[t] = 3.5;
        for (let t = 51; t <= 70; t++) velocity[t] = 0.8;

        const result = analyzeSession({
            time: { data: time },
            velocity_smooth: { data: velocity },
            altitude: { data: altitude },
        });

        expect(result).not.toBeNull();
        expect(result.stats.numberOfFlights).toBe(1);
        expect(result.stats.totalFoilTime).toBe('0.5'); // ~30s = 0.5 min
        expect(parseFloat(result.stats.percentFoil)).toBeGreaterThanOrEqual(23.0);
        expect(parseFloat(result.stats.percentFoil)).toBeLessThanOrEqual(26.0);
        expect(parseFloat(result.stats.percentFoilMoving)).toBeGreaterThanOrEqual(55.0);
        expect(parseFloat(result.stats.percentFoilMoving)).toBeLessThanOrEqual(65.0);
        expect(parseFloat(result.stats.percentFoil)).toBeLessThan(parseFloat(result.stats.percentFoilMoving));
        expect(result.stats.sessionDurationMinutes).toBe('2.0');
        expect(parseFloat(result.stats.movingTimeMinutes)).toBeGreaterThan(0.7);
        expect(parseFloat(result.stats.restTimeMinutes)).toBeGreaterThan(1.0);
    });
});
