import React, { createContext, useContext, useState, useEffect } from 'react';

const PreferencesContext = createContext();

const PREF_STORAGE_KEY = 'melvill_unit_preference';

export const PreferencesProvider = ({ children }) => {
    const [unit, setUnitState] = useState(() => {
        try {
            const saved = localStorage.getItem(PREF_STORAGE_KEY);
            return saved === 'kmh' ? 'kmh' : 'knots';
        } catch {
            return 'knots';
        }
    });

    const setUnit = (newUnit) => {
        const validUnit = newUnit === 'kmh' ? 'kmh' : 'knots';
        setUnitState(validUnit);
        try {
            localStorage.setItem(PREF_STORAGE_KEY, validUnit);
        } catch (e) {
            console.warn('[PreferencesContext] Could not persist unit preference:', e);
        }
    };

    const unitLabel = unit === 'knots' ? 'kts' : 'km/h';

    /**
     * Converts wind speed from km/h to active unit
     */
    const formatSpeedFromKmh = (valKmh, decimals = 1) => {
        if (valKmh == null || isNaN(valKmh)) return '-';
        if (unit === 'knots') {
            return (valKmh * 0.539957).toFixed(decimals);
        }
        return Math.round(valKmh).toString();
    };

    /**
     * Converts telemetry speed from m/s to active unit
     */
    const convertSpeedFromMs = (valMs) => {
        if (valMs == null || isNaN(valMs)) return 0;
        return unit === 'kmh' ? valMs * 3.6 : valMs * 1.94384;
    };

    const formatSpeedFromMs = (valMs, decimals = 1) => {
        if (valMs == null || isNaN(valMs)) return '-';
        return convertSpeedFromMs(valMs).toFixed(decimals);
    };

    return (
        <PreferencesContext.Provider
            value={{
                unit,
                setUnit,
                unitLabel,
                formatSpeedFromKmh,
                convertSpeedFromMs,
                formatSpeedFromMs,
            }}
        >
            {children}
        </PreferencesContext.Provider>
    );
};

export const usePreferences = () => {
    const context = useContext(PreferencesContext);
    if (!context) {
        // Fallback if rendered outside provider
        return {
            unit: 'knots',
            setUnit: () => {},
            unitLabel: 'kts',
            formatSpeedFromKmh: (v) => (v != null ? (v * 0.539957).toFixed(1) : '-'),
            convertSpeedFromMs: (v) => (v != null ? v * 1.94384 : 0),
            formatSpeedFromMs: (v) => (v != null ? (v * 1.94384).toFixed(1) : '-'),
        };
    }
    return context;
};
