import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import LocationManager from '../LocationManager';
import { LocationProvider, DEFAULT_LOCATION } from '../../context/LocationContext';
import { ToastProvider } from '../../context/ToastContext';

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
    subscribeToUserLocations: vi.fn(() => () => {}),
    mergeItemLists: vi.fn((a = [], b = []) => [...a])
}));

describe('LocationManager UI interactions', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
    });

    it('renders duplicates and removes them when Clean up Duplicates is clicked', () => {
        const initial = [
            DEFAULT_LOCATION,
            { id: '1793084138566', name: 'Majestic Point', latitude: -32.006018, longitude: 115.831514 },
            { id: '1793112096199', name: 'Majestic point', latitude: -32.005856, longitude: 115.831972 }
        ];
        localStorage.setItem('locations', JSON.stringify(initial));

        render(
            <ToastProvider>
                <LocationProvider>
                    <LocationManager />
                </LocationProvider>
            </ToastProvider>
        );

        // Check if banner is present
        expect(screen.getByText(/1 duplicate location detected/i)).toBeDefined();

        // Click "Clean up Duplicates"
        const cleanBtn = screen.getByRole('button', { name: /clean up duplicates/i });
        fireEvent.click(cleanBtn);

        // After clicking, the duplicate should be gone
        const allItems = screen.getAllByText(/Majestic/i);
        console.log('Majestic elements after clean:', allItems.map(el => el.textContent));
        expect(screen.queryByText(/1 duplicate location detected/i)).toBeNull();
    });

    it('deletes location when Trash button is clicked', () => {
        const initial = [
            DEFAULT_LOCATION,
            { id: '1793084138566', name: 'Majestic Point', latitude: -32.006018, longitude: 115.831514 },
            { id: '1793112096199', name: 'Majestic point', latitude: -32.005856, longitude: 115.831972 }
        ];
        localStorage.setItem('locations', JSON.stringify(initial));

        render(
            <ToastProvider>
                <LocationProvider>
                    <LocationManager />
                </LocationProvider>
            </ToastProvider>
        );

        // Click delete on the second Majestic point
        const deleteButtons = screen.getAllByTitle('Delete Location');
        expect(deleteButtons.length).toBe(2);
        fireEvent.click(deleteButtons[1]);

        expect(screen.getByText('Majestic Point')).toBeDefined();
        expect(screen.queryByText('Majestic point')).toBeNull();
    });
});
