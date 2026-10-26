import { describe, it, expect } from 'vitest';
import { isSameJournalEntry, mergeItemLists } from '../dbService';

describe('Additive merge rules (never lose sessions)', () => {
    it('treats entries with the same id as the same session', () => {
        expect(isSameJournalEntry({ id: 'abc', date: '2026-01-01T00:00:00Z' }, { id: 'abc', date: '2026-02-02T00:00:00Z' })).toBe(true);
    });

    it('treats entries with the same normalized date and notes as the same session', () => {
        const a = { id: 'local-1', date: '2026-02-22T08:06:00.000Z', notes: ' Great session ' };
        const b = { id: 'cloud-9', date: { toDate: () => new Date('2026-02-22T08:06:00.000Z') }, notes: 'Great session' };
        expect(isSameJournalEntry(a, b)).toBe(true);
    });

    it('keeps different sessions apart (same day, different notes)', () => {
        const a = { id: '1', date: '2026-02-22T08:06:00.000Z', notes: 'Morning' };
        const b = { id: '2', date: '2026-02-22T08:06:00.000Z', notes: 'Evening' };
        expect(isSameJournalEntry(a, b)).toBe(false);
    });

    it('mergeItemLists unions by id, keeps everything, and primary wins on conflict', () => {
        const cloud = [{ id: 1, model: 'Cloud wing' }, { id: 2, model: 'Board' }];
        const backup = [{ id: 1, model: 'Old backup wing' }, { id: 3, model: 'Foil' }];
        const merged = mergeItemLists(cloud, backup);
        expect(merged).toHaveLength(3);
        expect(merged.find(i => i.id === 1).model).toBe('Cloud wing');
        expect(merged.map(i => i.id).sort()).toEqual([1, 2, 3]);
    });

    it('mergeItemLists never drops items when one side is empty or invalid', () => {
        expect(mergeItemLists([{ id: 1 }], [])).toHaveLength(1);
        expect(mergeItemLists(null, [{ id: 1 }])).toHaveLength(1);
        expect(mergeItemLists(undefined, undefined)).toEqual([]);
    });
});
