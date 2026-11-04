import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SessionsPage from '../SessionsPage';
import { ToastProvider } from '../../context/ToastContext';
import { addJournalEntry } from '../../services/journalService';

vi.mock('react-router-dom', () => ({
    useNavigate: () => vi.fn()
}));

vi.mock('../../context/LocationContext', () => ({
    useLocation: () => ({
        locations: [{ id: 'melville', name: 'Melville Water' }],
        currentLocation: { id: 'melville', name: 'Melville Water', latitude: -32.0, longitude: 115.8 }
    })
}));

vi.mock('../../context/AuthContext', () => ({
    useAuth: () => ({
        user: { uid: 'test-user-123' },
        loading: false
    })
}));

let mockJournalEntries = [];

vi.mock('../../services/journalService', () => ({
    subscribeToJournalEntries: vi.fn((uid, cb) => {
        cb(mockJournalEntries);
        return () => {};
    }),
    getJournalEntries: vi.fn().mockResolvedValue([]),
    addJournalEntry: vi.fn(),
    deleteJournalEntry: vi.fn().mockResolvedValue(),
    updateJournalEntry: vi.fn().mockResolvedValue()
}));

vi.mock('../../services/dbService', async () => {
    const actual = await vi.importActual('../../services/dbService');
    return {
        ...actual,
        subscribeToUserGear: vi.fn((uid, cb) => {
            cb([]);
            return () => {};
        }),
        getUserGear: vi.fn().mockResolvedValue([])
    };
});

vi.mock('../../services/aiCoachService', () => ({
    extractSessionCoachTags: vi.fn().mockResolvedValue({ powerState: 'dialed', foilSentiment: 'balanced' })
}));

vi.mock('../../services/weatherService', () => ({
    getWeatherForecast: vi.fn().mockResolvedValue({}),
    getTideForecast: vi.fn().mockResolvedValue({}),
    processChartData: vi.fn().mockReturnValue([])
}));

describe('SessionsPage Notes Rendering & Duplicate Save Prevention', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockJournalEntries = [];
    });

    it('renders session note description with wrapping styles so it does not spill outside card', () => {
        const longDescription = 'Awesome session! Had a blast powered up on 5m wing and high speed gybing across the bay with consistent gusts.';
        mockJournalEntries = [
            {
                id: 'sess-1',
                date: '2026-01-15T10:00:00.000Z',
                locationName: 'Melville Water',
                notes: longDescription,
                rating: 5,
                gearUsed: '5m Cabrinha'
            }
        ];

        render(
            <ToastProvider>
                <SessionsPage />
            </ToastProvider>
        );

        const notesEl = screen.getByText(longDescription);
        expect(notesEl).toBeDefined();
        expect(notesEl.style.whiteSpace).toBe('pre-wrap');
        expect(notesEl.style.wordBreak).toBe('break-word');
        expect(notesEl.style.overflowWrap).toBe('anywhere');
    });

    it('prevents duplicate sessions when Save Session is clicked multiple times rapidly', async () => {
        let resolveSave;
        addJournalEntry.mockImplementation(
            (entryData) =>
                new Promise((resolve) => {
                    resolveSave = () => resolve({ id: 'new-sess-1', ...entryData });
                })
        );

        render(
            <ToastProvider>
                <SessionsPage />
            </ToastProvider>
        );

        // Open Log Session form
        const logBtn = screen.getByRole('button', { name: /\+ Log Session/i });
        fireEvent.click(logBtn);

        const notesInput = screen.getByPlaceholderText(/How did the session feel/i);
        fireEvent.change(notesInput, { target: { value: 'Impatient triple click test' } });

        const saveBtn = screen.getByRole('button', { name: /Save Session/i });

        // Rapidly click Save Session 3 times
        fireEvent.click(saveBtn);
        fireEvent.click(saveBtn);
        fireEvent.click(saveBtn);

        // Button should immediately disable and show Saving Session...
        await waitFor(() => {
            const savingBtn = screen.getByRole('button', { name: /Saving Session/i });
            expect(savingBtn.disabled).toBe(true);
            expect(addJournalEntry).toHaveBeenCalledTimes(1);
        });

        // Resolve the in-flight save
        resolveSave();

        // Only 1 session card should be rendered
        await waitFor(() => {
            const matchingNotes = screen.getAllByText('Impatient triple click test');
            expect(matchingNotes).toHaveLength(1);
        });
    });
});
