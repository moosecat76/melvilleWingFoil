import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import StatsPage from '../StatsPage';
import { ToastProvider } from '../../context/ToastContext';

vi.mock('react-router-dom', () => ({
    useNavigate: () => vi.fn()
}));

vi.mock('../../context/AuthContext', () => ({
    useAuth: () => ({
        user: { uid: 'test-user-123' },
        loading: false
    })
}));

vi.mock('../../context/PreferencesContext', () => ({
    usePreferences: () => ({
        unit: 'knots'
    })
}));

let mockEntries = [];
let mockUserGear = [];

vi.mock('../../services/journalService', () => ({
    subscribeToJournalEntries: vi.fn((uid, cb) => {
        cb(mockEntries);
        return () => {};
    })
}));

vi.mock('../../services/dbService', () => ({
    subscribeToUserGear: vi.fn((uid, cb) => {
        cb(mockUserGear);
        return () => {};
    }),
    batchUpdateJournalGear: vi.fn().mockResolvedValue(),
    saveUserGear: vi.fn().mockResolvedValue()
}));

// Mock recharts responsive container to render children
vi.mock('recharts', async () => {
    const actual = await vi.importActual('recharts');
    return {
        ...actual,
        ResponsiveContainer: ({ children }) => <div className="recharts-mock">{children}</div>
    };
});

describe('StatsPage Quiver Usage Warning', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockEntries = [];
        mockUserGear = [];
    });

    it('does not display warning banner when there are 0 warnings (clean sessions)', () => {
        mockEntries = [
            { id: '1', date: '2026-01-01', gearUsed: '5m Cabrinha, 1850cm² Neil Pryde' },
            { id: '2', date: '2026-01-02', gearUsed: '6m Cabrinha, 100L Smik' }
        ];
        mockUserGear = [
            { id: 'g1', type: 'wing', size: '5', model: 'Cabrinha' },
            { id: 'g2', type: 'wing', size: '6', model: 'Cabrinha' },
            { id: 'g3', type: 'foil', size: '1850', model: 'Neil Pryde' }
        ];

        render(
            <ToastProvider>
                <StatsPage />
            </ToastProvider>
        );

        expect(screen.getByText(/Quiver Usage & Gear Performance/i)).toBeDefined();
        // Warning banner text must NOT be in the document
        expect(screen.queryByText(/have duplicate or misspelled gear tags/i)).toBeNull();
        expect(screen.queryByText(/Review & Rationalise/i)).toBeNull();
        // Button should say Quiver Clean
        expect(screen.getByRole('button', { name: /Quiver Clean/i })).toBeDefined();
    });

    it('displays warning banner when there are affected sessions (> 0)', () => {
        mockEntries = [
            { id: '1', date: '2026-01-01', gearUsed: '5.0m Cabrihna, 1850cm² Neil Pryde' }
        ];
        mockUserGear = [
            { id: 'g1', type: 'wing', size: '5', model: 'Cabrinha' }
        ];

        render(
            <ToastProvider>
                <StatsPage />
            </ToastProvider>
        );

        expect(screen.getByText(/Quiver Usage & Gear Performance/i)).toBeDefined();
        // Warning banner text MUST be present
        expect(screen.getByText(/have duplicate or misspelled gear tags/i)).toBeDefined();
        expect(screen.getByText(/1 session/i)).toBeDefined();
        expect(screen.getByRole('button', { name: /Review & Rationalise/i })).toBeDefined();
        expect(screen.getByRole('button', { name: /Rationalise Quiver \(1 to merge\)/i })).toBeDefined();
    });
});
