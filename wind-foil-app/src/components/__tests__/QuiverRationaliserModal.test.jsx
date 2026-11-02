import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import QuiverRationaliserModal from '../QuiverRationaliserModal';
import { ToastProvider } from '../../context/ToastContext';

vi.mock('../../services/dbService', () => ({
    batchUpdateJournalGear: vi.fn().mockResolvedValue(3),
    saveUserGear: vi.fn().mockResolvedValue(),
}));

import { batchUpdateJournalGear, saveUserGear } from '../../services/dbService';

describe('QuiverRationaliserModal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('displays detected duplicate mappings and allows one-click rationalisation', async () => {
        const sessions = [
            { id: 's1', gearUsed: '5.0m Cabrihna, 1850cm² Neil Pryde' },
            { id: 's2', gearUsed: '5m Cabrhina, 100L Smik' },
            { id: 's3', gearUsed: '6.0m Cabrinha' },
        ];
        const userGear = [
            { id: 1, type: 'wing', size: '5', model: 'Cabrinha' },
            { id: 2, type: 'wing', size: '6', model: 'Cabrinha' },
        ];

        const handleClose = vi.fn();
        const handleSuccess = vi.fn();

        render(
            <ToastProvider>
                <QuiverRationaliserModal
                    isOpen={true}
                    onClose={handleClose}
                    sessions={sessions}
                    userGear={userGear}
                    uid="user-123"
                    onSuccess={handleSuccess}
                />
            </ToastProvider>
        );

        // Header and mapping presence
        expect(screen.getByText(/Rationalise Quiver & Sessions/i)).toBeDefined();
        expect(screen.getByText('5.0m Cabrihna')).toBeDefined();
        expect(screen.getByText('5m Cabrhina')).toBeDefined();
        expect(screen.getByText('6.0m Cabrinha')).toBeDefined();

        // Apply button
        const applyBtn = screen.getByRole('button', { name: /Apply Rationalisation/i });
        expect(applyBtn).toBeDefined();

        fireEvent.click(applyBtn);

        await waitFor(() => {
            expect(batchUpdateJournalGear).toHaveBeenCalledWith('user-123', expect.any(Array));
            expect(saveUserGear).toHaveBeenCalledWith('user-123', expect.any(Array));
            expect(handleSuccess).toHaveBeenCalled();
            expect(handleClose).toHaveBeenCalled();
        });
    });

    it('shows clean state when there are no duplicates', () => {
        const sessions = [
            { id: 's1', gearUsed: '5m Cabrinha, 1850cm² Neil Pryde' },
        ];
        const userGear = [
            { id: 1, type: 'wing', size: '5', model: 'Cabrinha' },
            { id: 2, type: 'foil', size: '1850', model: 'Neil Pryde' },
        ];

        render(
            <ToastProvider>
                <QuiverRationaliserModal
                    isOpen={true}
                    onClose={vi.fn()}
                    sessions={sessions}
                    userGear={userGear}
                    uid="user-123"
                />
            </ToastProvider>
        );

        expect(screen.getByText(/Quiver & Sessions are 100% Rationalised/i)).toBeDefined();
    });
});
