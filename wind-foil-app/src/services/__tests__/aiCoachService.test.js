import { describe, it, expect } from 'vitest';
import {
    buildCompactSessionPayload,
    buildDeterministicCoachTags,
    buildDeterministicSessionDebrief,
    buildDeterministicGamePlan
} from '../aiCoachService';

describe('aiCoachService - Phase 5 AI Foil Coach', () => {
    const mockEntry = {
        id: 'sess-101',
        date: '2026-10-25T14:00:00.000Z',
        locationName: 'Melville Waters',
        rating: 5,
        windSpeed: 18,
        windGusts: 26,
        windDirection: 225,
        gearUsed: '5m Strike, 950cm² Phantom, 75L Rocket',
        notes: 'First time nailing 5 dry foiling gybes in a row! Slightly overpowered in the 26kt gusts.',
        foilAnalysis: {
            stats: {
                topSpeed: 21.4,
                avgFoilSpeed: 14.8,
                percentFoil: 68,
                totalFoilTime: 42,
                numberOfFlights: 11,
                longestFlightSec: 390,
                totalDistance: 16.5
            },
            maneuvers: {
                totalAttempts: 8,
                completedTurns: 6,
                completionRate: 75,
                portFoilSec: 1200,
                starboardFoilSec: 1320,
                avgUpwindAngle: 44,
                upwindVmgKts: 9.8
            },
            efficiency: {
                takeoffConversionRate: 78,
                avgFoilHeartRate: 138,
                avgPumpHeartRate: 162,
                firstHalfFoilPct: 71,
                secondHalfFoilPct: 65
            }
        }
    };

    it('builds a compact ~300-token payload without raw GPS streams', () => {
        const payload = buildCompactSessionPayload(mockEntry);
        expect(payload.spot).toBe('Melville Waters');
        expect(payload.telemetry.percentFoil).toBe(68);
        expect(payload.telemetry.gybeCompletionPct).toBe(75);
        expect(payload.telemetry.avgFoilingHr).toBe(138);
        expect(payload.telemetry.avgPumpingHr).toBe(162);
        expect(payload.streams).toBeUndefined();
    });

    it('extracts structured note tags (powerState, wingSizeSentiment, foilSentiment, fatigue, breakthrough)', () => {
        const payload = buildCompactSessionPayload(mockEntry);
        const tags = buildDeterministicCoachTags(payload);
        expect(tags.powerState).toBe('slightly_overpowered');
        expect(tags.foilSentiment).toBe('balanced');
        expect(tags.breakthrough).toContain('First time nailing 5 dry foiling gybes');
    });

    it('synthesizes a 3-point post-session coaching debrief from telemetry and notes', () => {
        const payload = buildCompactSessionPayload(mockEntry);
        const debrief = buildDeterministicSessionDebrief(payload);
        expect(debrief.headline).toContain('68% Foil Time');
        expect(debrief.whatWentWell).toContain('6/8 foiling turns (75% dry completion)');
        expect(debrief.whatWentWell).toContain('138 bpm');
        expect(debrief.tuningRecommendation).toContain('gust spread');
        expect(debrief.techniqueFocus).toBeTruthy();
    });

    it('generates a pre-session Coach Game Plan synthesizing forecast, tide, gear, and past sessions', () => {
        const plan = buildDeterministicGamePlan({
            spotName: 'Melville Waters',
            windKts: 18,
            gustKts: 26,
            windDirDeg: 225,
            tideM: 0.85,
            recommendedGear: '5m Strike + 950cm² Phantom',
            pastMatches: [{ windKts: 18, rating: 5, percentFoil: 68, gearUsed: '5m Strike' }]
        });
        expect(plan.briefing).toContain('Melville Waters');
        expect(plan.briefing).toContain('5m Strike + 950cm² Phantom');
        expect(plan.gearTip).toContain('gust spread');
        expect(plan.keyFocus).toBeTruthy();
    });
});
