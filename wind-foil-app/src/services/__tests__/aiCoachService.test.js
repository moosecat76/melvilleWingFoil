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
        expect(debrief.whatWentWell).toContain('session commentary');
        expect(debrief.tuningRecommendation).toContain('gust spread');
        expect(debrief.techniqueFocus).toBeTruthy();
    });

    it('preserves and incorporates detailed rider post-analysis commentary in debrief', () => {
        const longCommentary = 'After analyzing my flights, I felt the mast was slightly too far back causing rear leg fatigue during takeoff, but gybe carving felt stable. Need to work on foot switch timing.';
        const entryWithCommentary = {
            ...mockEntry,
            notes: longCommentary
        };
        const payload = buildCompactSessionPayload(entryWithCommentary);
        expect(payload.notes).toBe(longCommentary);

        const debrief = buildDeterministicSessionDebrief(payload);
        expect(debrief.whatWentWell).toContain('session commentary');
        expect(debrief.tuningRecommendation).toContain('Addressing your rigging notes');
        expect(debrief.techniqueFocus).toContain('Addressing your footwork commentary');
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
        expect(plan.gearTip).not.toContain('outhaul');
        expect(plan.gearTip).toContain('PSI');
        expect(plan.keyFocus).toBeTruthy();
    });

    it('contextualizes older & out-of-sequence sessions with session number and rider stage', () => {
        const sessionContext = {
            sessionNumber: 3,
            totalSessions: 35,
            priorSessionsCount: 2,
            riderStage: 'Novice • First Flights',
            recentAnalysis: {
                techniqueFocus: 'Center hips over front foot'
            }
        };
        const payload = buildCompactSessionPayload(mockEntry, null, sessionContext);
        expect(payload.sessionNumber).toBe(3);
        expect(payload.totalSessions).toBe(35);
        expect(payload.riderStage).toBe('Novice • First Flights');

        const debrief = buildDeterministicSessionDebrief(payload);
        expect(debrief.headline).toContain('Session #3 of 35');
        expect(debrief.whatWentWell).toContain('Session #3 (Novice • First Flights)');
        expect(debrief.whatWentWell).toContain('Center hips over front foot');
        expect(debrief.tuningRecommendation).not.toContain('outhaul');
        expect(debrief.tuningRecommendation).toContain('foil mast');
    });

    it('synthesizes recent session debrief focus into the pre-session game plan', () => {
        const plan = buildDeterministicGamePlan({
            spotName: 'The Wall - Hillarys Harbour',
            windKts: 10,
            gustKts: 26,
            windDirDeg: 224,
            tideM: 0.45,
            recommendedGear: '5m Cabrinha + 1250cm² Neil Pryde',
            pastMatches: [{ windKts: 9.4, rating: 5, percentFoil: 34, gearUsed: '5m Cabrinha' }],
            recentSessionAnalysis: {
                coachDebrief: {
                    techniqueFocus: 'Carry 1–2 kts more entry speed into the gybe apex'
                }
            }
        });
        expect(plan.gearTip).not.toContain('outhaul');
        expect(plan.gearTip).toContain('PSI');
        expect(plan.keyFocus).toContain('Carry 1–2 kts more entry speed into the gybe apex');
    });

    it('handles zero-foil session correctly when commentary states no time on foil (Majestic Point scenario)', () => {
        const payload = {
            spot: 'Majestic Point',
            sessionNumber: 1,
            totalSessions: 20,
            gearUsed: '5m Wing, 1850cm² Foil, 120L Board',
            notes: "I didn't have anytime on foil at majestic point. Got to 4knt on the bigger board.",
            telemetry: {
                topSpeedKts: 4.1,
                avgFoilSpeedKts: 0,
                percentFoil: 0,
                totalFoilMin: 0,
                flightsCount: 0,
                distanceKm: 3.2
            }
        };

        const debrief = buildDeterministicSessionDebrief(payload);
        expect(debrief.headline).toContain('Takeoff & Taxi Session');
        expect(debrief.whatWentWell).not.toContain('% of the session on foil');
        expect(debrief.whatWentWell).toContain("didn't get up on foil");
        expect(debrief.tuningRecommendation).toContain('larger board');
        expect(debrief.tuningRecommendation).toContain('Slide your foil mast 1.0–2.0 cm forward');
        expect(debrief.techniqueFocus).toContain('takeoff threshold');
    });

    it('recovers longest flight from individual foilSegments when stats.longestFlightSec is 0 and reports short flights in seconds (e.g. 23s, not 0.0m)', () => {
        const sessionWithSegments = {
            id: 'sess-5apr',
            date: '2026-04-05T10:00:00.000Z',
            locationName: 'Melville Waters',
            rating: 4,
            windSpeed: 14,
            windGusts: 18,
            activityStats: {
                topSpeed: 15.849201948
            },
            foilAnalysis: {
                stats: {
                    topSpeed: 15.8,
                    longestFlightSec: 0,
                    longestFlightFormatted: '0s',
                    percentFoil: 8.5,
                    totalFoilTime: 3.5,
                    numberOfFlights: 3
                },
                foilSegments: [
                    { flightNumber: 1, durationSec: 12, topSpeedKts: 13.4 },
                    { flightNumber: 2, durationSec: 23, topSpeedKts: 15.849 },
                    { flightNumber: 3, durationSec: 8, topSpeedKts: 12.1 }
                ]
            }
        };

        const payload = buildCompactSessionPayload(sessionWithSegments);
        expect(payload.telemetry.longestFlightSec).toBe(23);
        expect(payload.telemetry.topSpeedKts).toBe(15.85);

        const debrief = buildDeterministicSessionDebrief(payload);
        expect(debrief.whatWentWell).toContain('longest continuous flight of 23s');
        expect(debrief.whatWentWell).not.toContain('0.0m');
        expect(debrief.whatWentWell).not.toContain('0.0 min');
        expect(debrief.whatWentWell).toContain('15.85 kts');
        expect(debrief.headline).toContain('15.85 kts Peak Speed');
    });
});
