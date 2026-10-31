import { describe, it, expect } from 'vitest';
import {
    isDirectionInSector,
    getWindRating,
    extractNoteSentiment,
    computeSessionQualityScore,
    buildPersonalSweetSpotMatrix,
    getGearRecommendation,
    analyzeSpotWindProfile,
    findSimilarPastSessions,
    rankLocationsAndTimes
} from '../recommendationService';

describe('recommendationService - wind sectors', () => {
    describe('isDirectionInSector', () => {
        it('handles standard non-wrapping sector correctly', () => {
            // Sector: 180° to 240° (South to SW)
            expect(isDirectionInSector(210, 180, 240)).toBe(true);
            expect(isDirectionInSector(180, 180, 240)).toBe(true);
            expect(isDirectionInSector(240, 180, 240)).toBe(true);
            expect(isDirectionInSector(170, 180, 240)).toBe(false);
            expect(isDirectionInSector(250, 180, 240)).toBe(false);
            expect(isDirectionInSector(0, 180, 240)).toBe(false);
        });

        it('handles wrap-around sector across 0°/360° correctly (e.g. NW to NE)', () => {
            // Sector: 315° to 45°
            expect(isDirectionInSector(315, 315, 45)).toBe(true);
            expect(isDirectionInSector(350, 315, 45)).toBe(true);
            expect(isDirectionInSector(0, 315, 45)).toBe(true);
            expect(isDirectionInSector(360, 315, 45)).toBe(true);
            expect(isDirectionInSector(20, 315, 45)).toBe(true);
            expect(isDirectionInSector(45, 315, 45)).toBe(true);

            // Outside sector
            expect(isDirectionInSector(50, 315, 45)).toBe(false);
            expect(isDirectionInSector(180, 315, 45)).toBe(false);
            expect(isDirectionInSector(300, 315, 45)).toBe(false);
        });

        it('handles null and undefined values safely', () => {
            expect(isDirectionInSector(null, 180, 240)).toBe(false);
            expect(isDirectionInSector(210, null, 240)).toBe(false);
            expect(isDirectionInSector(210, 180, null)).toBe(false);
        });
    });

    describe('getWindRating with wrap-around sector', () => {
        it('rates ideal wrap-around direction as Excellent in good breeze', () => {
            const idealRange = { min: 315, max: 45 };
            const ratingInside = getWindRating(22, 10, idealRange);
            expect(ratingInside.rating).toBe(5);
            expect(ratingInside.label).toBe('Excellent');

            const ratingOutside = getWindRating(22, 180, idealRange);
            expect(ratingOutside.rating).toBe(3);
            expect(ratingOutside.label).toBe('Good (Off-Axis)');
        });
    });
});

describe('recommendationService - Phase 4 Statistical Gear & Spot Engine', () => {
    const mockGear = [
        { id: 'w1', type: 'wing', size: 6, model: 'Strike' },
        { id: 'w2', type: 'wing', size: 5, model: 'Strike' },
        { id: 'w3', type: 'wing', size: 4, model: 'Strike' },
        { id: 'f1', type: 'foil', size: 1250, model: 'Seven Seas' },
        { id: 'f2', type: 'foil', size: 950, model: 'Phantom' },
        { id: 'b1', type: 'board', size: 75, model: 'Rocket' }
    ];

    const mockSessions = [
        {
            id: 's1',
            date: '2026-10-10',
            locationId: 'melville',
            windSpeed: 18, // kts
            windGusts: 21, // kts
            windDirection: 225, // SW
            rating: 5,
            gearUsed: '5m Strike, 950cm² Phantom, 75L Rocket',
            notes: 'Absolutely dialed in, sweet spot all afternoon!',
            foilAnalysis: { stats: { percentFoil: 68 } }
        },
        {
            id: 's2',
            date: '2026-10-12',
            locationId: 'melville',
            windSpeed: 19, // kts
            windGusts: 23, // kts
            windDirection: 230, // SW
            rating: 5,
            gearUsed: '5m Strike, 950cm² Phantom, 75L Rocket',
            notes: 'Perfect power and super smooth glides.',
            foilAnalysis: { stats: { percentFoil: 72 } }
        },
        {
            id: 's3',
            date: '2026-10-15',
            locationId: 'melville',
            windSpeed: 18, // kts
            windGusts: 22, // kts
            windDirection: 90, // E (choppy/off-axis)
            rating: 2,
            gearUsed: '6m Strike, 1250cm² Seven Seas',
            notes: 'Way overpowered in the gusts, exhausting.',
            foilAnalysis: { stats: { percentFoil: 32 } }
        },
        {
            id: 's4',
            date: '2026-10-18',
            locationId: 'melville',
            windSpeed: 18, // kts
            windGusts: 20, // kts
            windDirection: 95, // E
            rating: 3,
            gearUsed: '6m Strike, 1250cm² Seven Seas',
            notes: 'A bit overpowered.',
            foilAnalysis: { stats: { percentFoil: 40 } }
        }
    ];

    it('extracts note power sentiment accurately', () => {
        expect(extractNoteSentiment({ notes: 'Felt dialed and sweet spot' }).label).toBe('Dialed');
        expect(extractNoteSentiment({ notes: 'Completely overpowered and blown out' }).label).toBe('Overpowered');
        expect(extractNoteSentiment({ notes: 'Slogging and underpowered in lulls' }).label).toBe('Underpowered');
    });

    it('computes weighted session quality score combining rating, % foil, and note sentiment', () => {
        const highScore = computeSessionQualityScore(mockSessions[0]);
        const lowScore = computeSessionQualityScore(mockSessions[2]);
        expect(highScore).toBeGreaterThan(85);
        expect(lowScore).toBeLessThanOrEqual(45);
    });

    it('builds personal sweet spot matrix and recommends data-driven Wing + Foil + Board setup', () => {
        const matrix = buildPersonalSweetSpotMatrix(mockSessions, mockGear);
        const wing5m = matrix.find(m => m.label === '5m Strike');
        expect(wing5m).toBeDefined();
        expect(wing5m.sessionsCount).toBe(2);
        expect(wing5m.sweetSpotIdealKts).toBeCloseTo(18.5, 1);

        // ~34 km/h is ~18.4 kts
        const rec = getGearRecommendation(34, mockGear, { sessions: mockSessions, gustsKmh: 40 });
        expect(rec.isDataDriven).toBe(true);
        expect(rec.setup.wing.model).toBe('Strike');
        expect(rec.setup.wing.size).toBe(5);
        expect(rec.setup.foil.model).toBe('Phantom');
        expect(rec.setup.board.model).toBe('Rocket');
        expect(rec.text).toContain('5m Strike');
        expect(rec.text).toContain('950cm² Phantom');
        expect(rec.sub).toContain('Board: 75L Rocket');
        expect(rec.sub).toContain('Sweet-spot matched');
    });

    it('adjusts for high gust-to-lull spread (>= 7.5 kts)', () => {
        // 33 km/h (~17.8 kts) base wind with 52 km/h (~28.1 kts) gusts -> >10 kts spread
        const rec = getGearRecommendation(33, mockGear, { sessions: [], gustsKmh: 52 });
        expect(rec.gustSpreadKts).toBeGreaterThanOrEqual(7.5);
        expect(rec.gustAdvice).toBeTruthy();
        expect(rec.gustAdvice.toLowerCase()).toContain('gust spread');
    });

    it('profiles spot wind directions to identify best performing corridor', () => {
        const profile = analyzeSpotWindProfile(mockSessions, 'melville');
        expect(profile).not.toBeNull();
        expect(profile.centerDeg).toBeGreaterThanOrEqual(215);
        expect(profile.centerDeg).toBeLessThanOrEqual(245);
        expect(profile.avgRating).toBe(5);
        expect(profile.avgFoilPct).toBe(70);
    });

    it('finds top similar past sessions matching forecast wind speed and direction', () => {
        const matches = findSimilarPastSessions(
            { speedKmh: 34, gustsKmh: 40, direction: 228 },
            mockSessions,
            'melville',
            2
        );
        expect(matches.length).toBe(2);
        expect(matches[0].entry.id).toBe('s1');
        expect(matches[0].powerLabel).toBe('Dialed');
    });

    it('ranks multiple locations and recommends both the best time and best location based on wind sector and history', () => {
        const now = new Date();
        const future1 = new Date(now.getTime() + 3 * 3600 * 1000);
        future1.setHours(14, 0, 0, 0);
        if (future1 <= now) future1.setDate(future1.getDate() + 1);
        const future2 = new Date(future1.getTime() + 3600 * 1000);

        // Forecast has an Easterly (90°) 22 km/h breeze:
        // - Melville ideal sector is SW (180°–250°), so 90° is off-axis
        // - East Bay ideal sector is E (70°–110°), so 90° is ideal
        const hourlySlots = [
            { time: future1.getTime(), speed: 22, gusts: 26, direction: 90 },
            { time: future2.getTime(), speed: 24, gusts: 28, direction: 92 },
        ];

        const locationForecasts = [
            {
                location: { id: 'melville', name: 'Melville Waters', idealWindDirection: { min: 180, max: 250 } },
                hourlyForecast: hourlySlots,
                dailyData: null
            },
            {
                location: { id: 'eastbay', name: 'East Bay Point', idealWindDirection: { min: 70, max: 110 } },
                hourlyForecast: hourlySlots,
                dailyData: null
            }
        ];

        const ranking = rankLocationsAndTimes(locationForecasts, mockGear, mockSessions);
        expect(ranking.bestOverallBlock).not.toBeNull();
        expect(ranking.bestOverallBlock.locationId).toBe('eastbay');
        expect(ranking.bestOverallBlock.locationName).toBe('East Bay Point');
        expect(ranking.bestOverallBlock.isIdealSector).toBe(true);
        expect(ranking.rankedBlocks.length).toBe(2);
    });
});
