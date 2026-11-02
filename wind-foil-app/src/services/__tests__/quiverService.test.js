import { describe, it, expect } from 'vitest';
import {
    normalizeBrandName,
    normalizeSize,
    formatGearLabel,
    parseGearString,
    normalizeSingleGearName,
    normalizeGearUsed,
    deduplicateUserGear,
    analyzeQuiverRationalisation,
} from '../quiverService';

describe('quiverService', () => {
    describe('normalizeBrandName', () => {
        it('corrects common typos to Cabrinha', () => {
            expect(normalizeBrandName('Cabrihna')).toBe('Cabrinha');
            expect(normalizeBrandName('Cabrhina')).toBe('Cabrinha');
            expect(normalizeBrandName('cabrinh')).toBe('Cabrinha');
            expect(normalizeBrandName('cabrina')).toBe('Cabrinha');
            expect(normalizeBrandName('Cabrinha')).toBe('Cabrinha');
        });

        it('corrects Neil Pryde variations', () => {
            expect(normalizeBrandName('neil pryde')).toBe('Neil Pryde');
            expect(normalizeBrandName('neilpryde')).toBe('Neil Pryde');
            expect(normalizeBrandName('neil-pryde')).toBe('Neil Pryde');
        });

        it('normalises other major brands', () => {
            expect(normalizeBrandName('fone')).toBe('F-One');
            expect(normalizeBrandName('doutone')).toBe('Duotone');
            expect(normalizeBrandName('smik')).toBe('Smik');
            expect(normalizeBrandName('naish')).toBe('Naish');
        });
    });

    describe('normalizeSize', () => {
        it('strips redundant trailing zeros', () => {
            expect(normalizeSize('5.0')).toBe('5');
            expect(normalizeSize('6.00')).toBe('6');
            expect(normalizeSize(4.0)).toBe('4');
            expect(normalizeSize('1850')).toBe('1850');
        });

        it('preserves valid decimals', () => {
            expect(normalizeSize('4.5')).toBe('4.5');
            expect(normalizeSize(3.5)).toBe('3.5');
        });
    });

    describe('parseGearString and normalizeSingleGearName', () => {
        it('handles all items from the user screenshot', () => {
            expect(normalizeSingleGearName('1850cm² Neil Pryde')).toBe('1850cm² Neil Pryde');
            expect(normalizeSingleGearName('100L Smik')).toBe('100L Smik');
            expect(normalizeSingleGearName('5m Cabrinha')).toBe('5m Cabrinha');
            expect(normalizeSingleGearName('1250cm² Neil Pryde')).toBe('1250cm² Neil Pryde');
            expect(normalizeSingleGearName('5.0m Cabrihna')).toBe('5m Cabrinha');
            expect(normalizeSingleGearName('118L Cabrinha')).toBe('118L Cabrinha');
            expect(normalizeSingleGearName('140L Naish')).toBe('140L Naish');
            expect(normalizeSingleGearName('6m Cabrinha')).toBe('6m Cabrinha');
            expect(normalizeSingleGearName('4.0m Cabrihna')).toBe('4m Cabrinha');
            expect(normalizeSingleGearName('5m Cabrhina')).toBe('5m Cabrinha');
            expect(normalizeSingleGearName('6.0m Cabrinha')).toBe('6m Cabrinha');
        });

        it('resolves against userGear list if provided', () => {
            const userGear = [
                { id: 1, type: 'wing', size: '5', model: 'Cabrinha' },
                { id: 2, type: 'foil', size: '1850', model: 'Neil Pryde' },
            ];
            expect(normalizeSingleGearName('5.0m Cabrihna', userGear)).toBe('5m Cabrinha');
            expect(normalizeSingleGearName('1850cm² neilpryde', userGear)).toBe('1850cm² Neil Pryde');
        });
    });

    describe('normalizeGearUsed', () => {
        it('normalises multi-item gear strings and removes duplicates within a session', () => {
            const input = '5.0m Cabrihna, 1850cm² Neil Pryde, 100L Smik';
            const expected = '5m Cabrinha, 1850cm² Neil Pryde, 100L Smik';
            expect(normalizeGearUsed(input)).toBe(expected);
        });

        it('deduplicates duplicate gear mentions in the same session', () => {
            const input = '5m Cabrinha, 5.0m Cabrihna';
            expect(normalizeGearUsed(input)).toBe('5m Cabrinha');
        });
    });

    describe('deduplicateUserGear', () => {
        it('removes duplicate quiver entries in settings', () => {
            const userGear = [
                { id: 1, type: 'wing', size: '5', model: 'Cabrinha' },
                { id: 2, type: 'wing', size: '5.0', model: 'Cabrihna' },
                { id: 3, type: 'foil', size: '1850', model: 'Neil Pryde' },
            ];
            const deduped = deduplicateUserGear(userGear);
            expect(deduped).toHaveLength(2);
            expect(deduped[0].size).toBe('5');
            expect(deduped[0].model).toBe('Cabrinha');
            expect(deduped[1].model).toBe('Neil Pryde');
        });
    });

    describe('analyzeQuiverRationalisation', () => {
        it('correctly detects session updates and replacements without data loss', () => {
            const sessions = [
                { id: 's1', date: '2026-01-01', gearUsed: '5.0m Cabrihna, 1850cm² Neil Pryde' },
                { id: 's2', date: '2026-01-02', gearUsed: '5m Cabrhina, 100L Smik' },
                { id: 's3', date: '2026-01-03', gearUsed: '6.0m Cabrinha, 140L Naish' },
                { id: 's4', date: '2026-01-04', gearUsed: '5m Cabrinha, 1850cm² Neil Pryde' }, // already clean
            ];
            const userGear = [
                { id: 1, type: 'wing', size: '5', model: 'Cabrinha' },
                { id: 2, type: 'wing', size: '6', model: 'Cabrinha' },
            ];

            const plan = analyzeQuiverRationalisation(sessions, userGear);
            expect(plan.hasChanges).toBe(true);
            expect(plan.totalAffectedSessions).toBe(3);
            expect(plan.sessionUpdates).toHaveLength(3);
            expect(plan.sessionUpdates[0].newGearUsed).toBe('5m Cabrinha, 1850cm² Neil Pryde');
            expect(plan.sessionUpdates[1].newGearUsed).toBe('5m Cabrinha, 100L Smik');
            expect(plan.sessionUpdates[2].newGearUsed).toBe('6m Cabrinha, 140L Naish');

            const rep5m = plan.replacementList.find(r => r.canonical === '5m Cabrinha');
            expect(rep5m).toBeDefined();
        });
    });
});
