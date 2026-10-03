import { describe, it, expect } from 'vitest';
import { encodePolyline, decodePolyline } from '../tcxService';
import {
    sanitizeForFirestore,
    prepareJournalEntryForFirestore,
    hydrateJournalEntry,
} from '../dbService';

describe('Polyline Encoder & Decoder', () => {
    it('correctly encodes and decodes [lat, lng] coordinate pairs', () => {
        const coords = [
            [-32.01234, 115.81234],
            [-32.01345, 115.81345],
            [-32.01456, 115.81456],
        ];
        const encoded = encodePolyline(coords);
        expect(typeof encoded).toBe('string');
        expect(encoded.length).toBeGreaterThan(0);

        const decoded = decodePolyline(encoded);
        expect(decoded.length).toBe(coords.length);
        for (let i = 0; i < coords.length; i++) {
            expect(decoded[i][0]).toBeCloseTo(coords[i][0], 4);
            expect(decoded[i][1]).toBeCloseTo(coords[i][1], 4);
        }
    });

    it('supports coordinate objects { lat, lng } in encodePolyline', () => {
        const coords = [
            { lat: -32.01234, lng: 115.81234 },
            { lat: -32.01345, lng: 115.81345 },
        ];
        const encoded = encodePolyline(coords);
        const decoded = decodePolyline(encoded);
        expect(decoded.length).toBe(2);
        expect(decoded[0][0]).toBeCloseTo(-32.01234, 4);
        expect(decoded[0][1]).toBeCloseTo(115.81234, 4);
    });

    it('safely handles empty or invalid inputs', () => {
        expect(encodePolyline(null)).toBe('');
        expect(encodePolyline([])).toBe('');
        expect(decodePolyline(null)).toEqual([]);
        expect(decodePolyline('')).toEqual([]);
    });
});

describe('Firestore Sanitizer & Preparation', () => {
    it('converts undefined to null and strips undefined object keys', () => {
        const input = {
            a: 'hello',
            b: undefined,
            c: { d: undefined, e: 42 },
        };
        const cleaned = sanitizeForFirestore(input);
        expect(cleaned.a).toBe('hello');
        expect(cleaned.b).toBeUndefined();
        expect(cleaned.c.e).toBe(42);
        expect(cleaned.c.d).toBeUndefined();
    });

    it('converts nested arrays into objects to prevent Firestore rejection', () => {
        const nestedArray = [
            [-32.01, 115.81],
            [-32.02, 115.82],
        ];
        const cleaned = sanitizeForFirestore(nestedArray);
        // Cleaned array items should not be arrays
        expect(Array.isArray(cleaned[0])).toBe(false);
        expect(cleaned[0]).toEqual({ lat: -32.01, lng: 115.81 });
    });

    it('prepares TCX journal entries by removing nested latlng stream and retaining mapPolyline', () => {
        const tcxEntry = {
            notes: 'Test session',
            rating: 5,
            mapPolyline: 'encoded_poly_test',
            streams: {
                time: { data: [0, 1, 2] },
                latlng: {
                    data: [
                        [-32.01, 115.81],
                        [-32.02, 115.82],
                    ],
                },
                velocity_smooth: { data: [5.2, 5.5, 6.1] },
                altitude: { data: [-0.5, -0.4, -0.6] },
            },
            activityStats: { topSpeed: '12.0', duration: '30' },
            foilAnalysis: { stats: { totalFoilTime: '10' } },
        };

        const prepared = prepareJournalEntryForFirestore(tcxEntry);

        // 1. Raw latlng must NOT be in streams (which would cause Firestore nested array rejection)
        expect(prepared.streams.latlng).toBeUndefined();

        // 2. 1D number stream arrays must be preserved
        expect(prepared.streams.time.data).toEqual([0, 1, 2]);
        expect(prepared.streams.velocity_smooth.data).toEqual([5.2, 5.5, 6.1]);
        expect(prepared.streams.altitude.data).toEqual([-0.5, -0.4, -0.6]);

        // 3. mapPolyline preserved
        expect(prepared.mapPolyline).toBe('encoded_poly_test');
    });

    it('auto-encodes mapPolyline if missing when latlng stream is present', () => {
        const entryWithoutPolyline = {
            streams: {
                latlng: {
                    data: [
                        [-32.01234, 115.81234],
                        [-32.01345, 115.81345],
                    ],
                },
                velocity_smooth: { data: [3.1, 4.2] },
            },
        };

        const prepared = prepareJournalEntryForFirestore(entryWithoutPolyline);
        expect(prepared.mapPolyline).toBeTruthy();
        expect(typeof prepared.mapPolyline).toBe('string');
        expect(prepared.streams.latlng).toBeUndefined();

        // Decoding this mapPolyline reproduces the original coordinates
        const decoded = decodePolyline(prepared.mapPolyline);
        expect(decoded[0][0]).toBeCloseTo(-32.01234, 4);
    });

    it('normalizes Strava array stream format into map format without nested arrays', () => {
        const stravaEntry = {
            notes: 'Strava session',
            mapPolyline: null,
            streams: [
                { type: 'time', data: [0, 1, 2] },
                {
                    type: 'latlng',
                    data: [
                        [-32.01234, 115.81234],
                        [-32.01345, 115.81345],
                    ],
                },
                { type: 'velocity_smooth', data: [2.5, 3.0, 3.5] },
            ],
        };

        const prepared = prepareJournalEntryForFirestore(stravaEntry);

        // streams must now be an object, NOT an array of objects
        expect(Array.isArray(prepared.streams)).toBe(false);
        expect(prepared.streams.time.data).toEqual([0, 1, 2]);
        expect(prepared.streams.velocity_smooth.data).toEqual([2.5, 3.0, 3.5]);

        // latlng stream should be removed and encoded into mapPolyline
        expect(prepared.streams.latlng).toBeUndefined();
        expect(prepared.mapPolyline).toBeTruthy();
    });

    it('hydrates entry by reconstructing streams.latlng in-memory from mapPolyline', () => {
        const coords = [
            [-32.01234, 115.81234],
            [-32.01345, 115.81345],
        ];
        const encodedPoly = encodePolyline(coords);

        const storedDoc = {
            id: 'doc-123',
            mapPolyline: encodedPoly,
            streams: {
                velocity_smooth: { data: [4.1, 4.3] },
            },
        };

        const hydrated = hydrateJournalEntry(storedDoc);
        expect(hydrated.streams.latlng).toBeDefined();
        expect(hydrated.streams.latlng.data.length).toBe(2);
        expect(hydrated.streams.latlng.data[0][0]).toBeCloseTo(-32.01234, 4);
    });
});
