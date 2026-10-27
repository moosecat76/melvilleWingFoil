import { describe, it, expect } from 'vitest';
import { isDirectionInSector, getWindRating } from '../recommendationService';

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
