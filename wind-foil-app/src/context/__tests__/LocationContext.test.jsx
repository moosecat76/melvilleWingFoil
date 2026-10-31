import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocationProvider, useLocation, DEFAULT_LOCATION } from '../LocationContext';
import * as dbService from '../../services/dbService';

vi.mock('../../context/AuthContext', () => ({
    useAuth: () => ({
        user: { uid: 'user-123' },
        loading: false
    })
}));

vi.mock('../../services/dbService', () => ({
    getUserLocations: vi.fn().mockResolvedValue([]),
    saveUserLocations: vi.fn().mockResolvedValue(),
    getCurrentLocationId: vi.fn().mockResolvedValue('melville'),
    saveCurrentLocationId: vi.fn().mockResolvedValue(),
    subscribeToUserLocations: vi.fn(),
    mergeItemLists: vi.fn((a = [], b = []) => {
        const seen = new Set();
        const res = [];
        for (const item of [...a, ...b]) {
            const key = item.id || JSON.stringify(item);
            if (!seen.has(key)) {
                seen.add(key);
                res.push(item);
            }
        }
        return res;
    })
}));

const TestConsumer = ({ onContext }) => {
    const ctx = useLocation();
    onContext(ctx);
    return <div>Locations count: {ctx.locations.length}</div>;
};

describe('LocationContext duplicate deletion and sync', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
    });

    it('successfully deletes a duplicate location', () => {
        const initial = [
            DEFAULT_LOCATION,
            { id: '1793084138566', name: 'Majestic Point', latitude: -32.006, longitude: 115.831 },
            { id: '1793112096199', name: 'Majestic point', latitude: -32.005, longitude: 115.832 }
        ];
        localStorage.setItem('locations', JSON.stringify(initial));

        let context;
        render(
            <LocationProvider>
                <TestConsumer onContext={(ctx) => { context = ctx; }} />
            </LocationProvider>
        );

        expect(context.locations.length).toBe(3);

        act(() => {
            context.deleteLocation('1793112096199');
        });

        expect(context.locations.length).toBe(2);
        expect(context.locations.find(l => l.id === '1793112096199')).toBeUndefined();
        expect(context.locations.find(l => l.id === '1793084138566')).toBeDefined();

        const stored = JSON.parse(localStorage.getItem('locations'));
        expect(stored.length).toBe(2);
        expect(stored.find(l => l.id === '1793112096199')).toBeUndefined();
    });

    it('deduplicates locations by name and coordinates', () => {
        const initial = [
            DEFAULT_LOCATION,
            { id: '1793084138566', name: 'Majestic Point', latitude: -32.006018, longitude: 115.831514 },
            { id: '1793112096199', name: 'Majestic point', latitude: -32.005856, longitude: 115.831972 }
        ];
        localStorage.setItem('locations', JSON.stringify(initial));

        let context;
        render(
            <LocationProvider>
                <TestConsumer onContext={(ctx) => { context = ctx; }} />
            </LocationProvider>
        );

        let removedCount = 0;
        act(() => {
            removedCount = context.deduplicateLocations();
        });

        expect(removedCount).toBe(1);
        expect(context.locations.length).toBe(2);
    });

    it('allows deleting duplicate Melville entries while preserving at least one', () => {
        const initial = [
            DEFAULT_LOCATION,
            { id: 'melville', name: 'Melville Waters', latitude: -32.013, longitude: 115.829 }
        ];
        localStorage.setItem('locations', JSON.stringify(initial));

        let context;
        render(
            <LocationProvider>
                <TestConsumer onContext={(ctx) => { context = ctx; }} />
            </LocationProvider>
        );

        expect(context.locations.filter(l => l.id === 'melville').length).toBe(2);

        act(() => {
            context.deleteLocation('melville');
        });

        expect(context.locations.filter(l => l.id === 'melville').length).toBe(1);

        // Attempting to delete the last Melville should do nothing
        act(() => {
            context.deleteLocation('melville');
        });
        expect(context.locations.filter(l => l.id === 'melville').length).toBe(1);
    });

    it('does not resurrect deleted locations on real-time snapshots after initial sync', () => {
        let snapshotCallback;
        dbService.subscribeToUserLocations.mockImplementation((uid, cb) => {
            snapshotCallback = cb;
            return () => {};
        });

        const initial = [
            DEFAULT_LOCATION,
            { id: '1793084138566', name: 'Majestic Point', latitude: -32.006, longitude: 115.831 },
            { id: '1793112096199', name: 'Majestic point', latitude: -32.005, longitude: 115.832 }
        ];
        localStorage.setItem('locations', JSON.stringify(initial));

        let context;
        render(
            <LocationProvider>
                <TestConsumer onContext={(ctx) => { context = ctx; }} />
            </LocationProvider>
        );

        // Initial snapshot with remote locations
        act(() => {
            snapshotCallback({
                items: initial,
                currentId: 'melville'
            });
        });
        expect(context.locations.length).toBe(3);

        // User deletes one location
        act(() => {
            context.deleteLocation('1793112096199');
        });
        expect(context.locations.length).toBe(2);

        // Subsequent snapshot comes back from Firestore confirming the deletion
        act(() => {
            snapshotCallback({
                items: [
                    DEFAULT_LOCATION,
                    { id: '1793084138566', name: 'Majestic Point', latitude: -32.006, longitude: 115.831 }
                ],
                currentId: 'melville'
            });
        });

        // The deleted item should NOT be resurrected
        expect(context.locations.length).toBe(2);
        expect(context.locations.find(l => l.id === '1793112096199')).toBeUndefined();
    });
});
