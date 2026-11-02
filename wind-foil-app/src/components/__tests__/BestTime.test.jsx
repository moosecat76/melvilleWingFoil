import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import BestTime from '../BestTime';
import * as aiCoachService from '../../services/aiCoachService';

vi.mock('../../services/aiCoachService', () => ({
    generatePreSessionGamePlan: vi.fn()
}));

describe('BestTime - Coach Game Plan Selected Location Priority', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const now = new Date();
    const createHourlySlot = (hoursAhead, speedKmh, gustsKmh = speedKmh + 6, direction = 220) => {
        const d = new Date(now.getTime() + hoursAhead * 3600 * 1000);
        return {
            time: d.toISOString(),
            speed: speedKmh,
            gusts: gustsKmh,
            direction,
            tide: 0.8
        };
    };

    // Melville: good 24 kmh (~13 kts)
    const melvilleHourly = [
        createHourlySlot(2, 24, 30, 225),
        createHourlySlot(3, 25, 31, 225),
        createHourlySlot(4, 24, 30, 225)
    ];

    // Safety Bay: booming 38 kmh (~20.5 kts), so Safety Bay is ranked #1 as Top Pick
    const safetyBayHourly = [
        createHourlySlot(2, 38, 46, 215),
        createHourlySlot(3, 40, 48, 215),
        createHourlySlot(4, 38, 46, 215)
    ];

    const allLocationForecasts = [
        {
            location: { id: 'melville', name: 'Melville Beach', idealWindDirection: { min: 180, max: 270 } },
            hourlyForecast: melvilleHourly
        },
        {
            location: { id: 'safety-bay', name: 'Safety Bay', idealWindDirection: { min: 180, max: 270 } },
            hourlyForecast: safetyBayHourly
        }
    ];

    const userGear = [
        { id: 'g1', type: 'wing', size: '5m', minWind: 14, maxWind: 22 },
        { id: 'g2', type: 'foil', size: '950cm²' }
    ];

    it('uses selected location (Melville Beach) for coach game plan even when Safety Bay is recommended as Top Pick', async () => {
        aiCoachService.generatePreSessionGamePlan.mockResolvedValueOnce({
            spotName: 'Melville Beach',
            briefing: 'Melville Beach is forecasting 13.2 kts gusting 16.5 kts (225°). Rig your 5m wing.',
            gearTip: 'Foil mast in standard position.',
            keyFocus: 'Carve smooth gybes through the chop.',
            model: 'gemini-3.5-flash-lite'
        });

        render(
            <BestTime
                forecastHourly={melvilleHourly}
                userGear={userGear}
                idealWindDirection={{ min: 180, max: 270 }}
                sessions={[]}
                locationId="melville"
                locationName="Melville Beach"
                allLocationForecasts={allLocationForecasts}
                onSwitchLocation={vi.fn()}
            />
        );

        // Verify that Top Pick banner displays Safety Bay
        expect(screen.getByText('Safety Bay')).toBeDefined();
        expect(screen.getByText(/Top Pick/i)).toBeDefined();

        // Verify button targets the selected location
        const coachBtn = screen.getByRole('button', { name: /Game Plan for Melville Beach/i });
        expect(coachBtn).toBeDefined();

        // Trigger Coach's Game Plan
        fireEvent.click(coachBtn);

        await waitFor(() => {
            expect(aiCoachService.generatePreSessionGamePlan).toHaveBeenCalledTimes(1);
        });

        // Verify payload passed to generatePreSessionGamePlan used Melville Beach, not Safety Bay
        const callArgs = aiCoachService.generatePreSessionGamePlan.mock.calls[0][0];
        expect(callArgs.spotName).toBe('Melville Beach');
        // Wind speed is ~13 kts (from Melville's 24-25 kmh), NOT Safety Bay's ~21 kts
        expect(callArgs.windKts).toBeLessThan(16);

        // Verify game plan card renders Melville Beach
        await waitFor(() => {
            expect(screen.getByText(/Melville Beach is forecasting 13.2 kts/i)).toBeDefined();
            expect(screen.getByText(/Carve smooth gybes/i)).toBeDefined();
        });
    });

    it('generates a game plan for the selected location even when no rating >= 3 window exists', async () => {
        // Light wind at Melville (12 kmh ~ 6.5 kts) - will not produce a >= 3 rating block
        const lightHourly = [
            createHourlySlot(2, 12, 15, 210),
            createHourlySlot(3, 12, 14, 210)
        ];

        aiCoachService.generatePreSessionGamePlan.mockResolvedValueOnce({
            spotName: 'Melville Beach',
            briefing: 'Melville Beach is forecasting 6.5 kts. Rig your largest wing.',
            gearTip: 'Slide mast forward for light wind lift.',
            keyFocus: 'Practice light wind pumping efficiency.',
            model: 'Telemetry Coach Engine'
        });

        render(
            <BestTime
                forecastHourly={lightHourly}
                userGear={userGear}
                idealWindDirection={{ min: 180, max: 270 }}
                sessions={[]}
                locationId="melville"
                locationName="Melville Beach"
                allLocationForecasts={[]}
            />
        );

        // Shows no great sessions message
        expect(screen.getByText(/No great sessions projected in next 48h at Melville Beach/i)).toBeDefined();

        // But still provides Game Plan button for the selected spot
        const coachBtn = screen.getByRole('button', { name: /Game Plan for Melville Beach/i });
        expect(coachBtn).toBeDefined();

        fireEvent.click(coachBtn);

        await waitFor(() => {
            expect(aiCoachService.generatePreSessionGamePlan).toHaveBeenCalledTimes(1);
        });

        const callArgs = aiCoachService.generatePreSessionGamePlan.mock.calls[0][0];
        expect(callArgs.spotName).toBe('Melville Beach');
    });

    it('clears the existing game plan when the selected locationId changes', async () => {
        aiCoachService.generatePreSessionGamePlan.mockResolvedValueOnce({
            spotName: 'Melville Beach',
            briefing: 'Melville Beach advice here.',
            gearTip: 'Tip',
            keyFocus: 'Focus'
        });

        const { rerender } = render(
            <BestTime
                forecastHourly={melvilleHourly}
                userGear={userGear}
                sessions={[]}
                locationId="melville"
                locationName="Melville Beach"
                allLocationForecasts={allLocationForecasts}
            />
        );

        const coachBtn = screen.getByRole('button', { name: /Game Plan for Melville Beach/i });
        fireEvent.click(coachBtn);

        await waitFor(() => {
            expect(screen.getByText('Melville Beach advice here.')).toBeDefined();
        });

        // Now rerender with a changed locationId (user switched spot)
        rerender(
            <BestTime
                forecastHourly={safetyBayHourly}
                userGear={userGear}
                sessions={[]}
                locationId="safety-bay"
                locationName="Safety Bay"
                allLocationForecasts={allLocationForecasts}
            />
        );

        // The old Melville game plan should be cleared
        expect(screen.queryByText('Melville Beach advice here.')).toBeNull();
        expect(screen.getByRole('button', { name: /Game Plan for Safety Bay/i })).toBeDefined();
    });
});
