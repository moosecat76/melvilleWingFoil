import React, { createContext, useState, useEffect, useContext } from 'react';

const LocationContext = createContext();

const DEFAULT_LOCATION = {
    id: 'melville',
    name: 'Melville Waters',
    latitude: -32.01303172472861,
    longitude: 115.82947437392544,
    idealWindDirection: { min: 135, max: 270 }
};

export const LocationProvider = ({ children }) => {
    const [locations, setLocations] = useState(() => {
        const saved = localStorage.getItem('locations');
        let parsed = saved ? JSON.parse(saved) : [DEFAULT_LOCATION];

        // Migration: Ensure all have idealWindDirection
        parsed = parsed.map(loc => ({
            ...loc,
            idealWindDirection: loc.idealWindDirection || { min: 0, max: 360 }
        }));

        return parsed;
    });

    const [currentLocation, setCurrentLocation] = useState(() => {
        const savedId = localStorage.getItem('currentLocationId');
        if (savedId) {
            const saved = JSON.parse(localStorage.getItem('locations') || '[]').find(l => l.id === savedId);
            // Default fallback if found
            if (saved) {
                return { ...saved, idealWindDirection: saved.idealWindDirection || { min: 0, max: 360 } };
            }
            return DEFAULT_LOCATION;
        }
        return DEFAULT_LOCATION;
    });

    useEffect(() => {
        localStorage.setItem('locations', JSON.stringify(locations));
    }, [locations]);

    useEffect(() => {
        localStorage.setItem('currentLocationId', currentLocation.id);
    }, [currentLocation]);

    const addLocation = (name, lat, lon, idealMin = 0, idealMax = 360) => {
        const newLoc = {
            id: Date.now().toString(), // Simple ID generation
            name,
            latitude: parseFloat(lat),
            longitude: parseFloat(lon),
            idealWindDirection: { min: parseFloat(idealMin), max: parseFloat(idealMax) }
        };
        setLocations(prev => [...prev, newLoc]);
        return newLoc;
    };

    const switchLocation = (id) => {
        const loc = locations.find(l => l.id === id);
        if (loc) {
            setCurrentLocation(loc);
        }
    };

    const deleteLocation = (id) => {
        if (id === 'melville') return; // Prevent deleting default
        setLocations(prev => prev.filter(l => l.id !== id));
        if (currentLocation.id === id) {
            setCurrentLocation(locations[0]);
        }
    };

    return (
        <LocationContext.Provider value={{
            locations,
            currentLocation,
            addLocation,
            switchLocation,
            deleteLocation
        }}>
            {children}
        </LocationContext.Provider>
    );
};

export const useLocation = () => useContext(LocationContext);
