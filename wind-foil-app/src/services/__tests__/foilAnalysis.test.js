import { describe, it, expect } from 'vitest';
import { analyzeSession } from '../foilAnalysisService';

describe('foilAnalysisService', () => {
    it('uses altitude mode when valid altitude changes are present', () => {
        // 15 seconds: 0-4s drifting at alt=10m, 5-12s foiling at speed=2.5 m/s & alt=9.5m, 13-14s slow at alt=10m
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
    });

    it('adaptively profiles speed distribution (~2 m/s entry) and ignores sub-foil slogging (<1.8 m/s)', () => {
        // 40 seconds:
        // 0-9s: displacement sailing / pumping attempts at 0.5 - 1.5 m/s (should NOT trigger foil)
        // 10-20s: sudden takeoff surge onto foil (2.1 -> 3.8 m/s)
        // 21-29s: drop off foil back to displacement slogging (0.6 - 1.4 m/s)
        // 30-39s: second foil flight (2.2 -> 4.2 m/s)
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
    });

    it('detects multiple flights and separates runs when gap > 30s in adaptive speed mode', () => {
        // 70 points, 1s apart
        const time = Array.from({ length: 70 }, (_, i) => i);
        const velocity = new Array(70).fill(0.7);
        const altitude = new Array(70).fill(0);

        // Flight 1: t = 5..12 (7s duration at ~3.0 m/s)
        for (let t = 5; t <= 12; t++) velocity[t] = 3.0;

        // Flight 2: t = 18..25 (gap = 6s -> same run)
        for (let t = 18; t <= 25; t++) velocity[t] = 3.2;

        // Flight 3: t = 58..65 (gap = 33s -> second run)
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
});
