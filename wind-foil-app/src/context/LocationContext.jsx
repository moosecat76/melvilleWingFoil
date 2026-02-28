import React, { createContext, useState, useEffect, useContext } from 'react';
import { useAuth } from './AuthContext';
import {
    getUserLocations,
    saveUserLocations,
    getCurrentLocationId,
    saveCurrentLocationId
} from '../services/dbService';

const LocationContext = createContext();

const DEFAULT_LOCATION = {
    id: 'melville',
    name: 'Melville Waters',
    latitude: -32.01303172472861,
    longitude: 115.82947437392544,
    idealWindDirection: { min: 135, max: 270 }
};

export const LocationProvider = ({ children }) => {
    const { user } = useAuth();

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
        const fetchRemote = async () => {
            if (user?.uid) {
                const remoteLocations = await getUserLocations(user.uid);
                if (remoteLocations && remoteLocations.length > 0) {
                    setLocations(remoteLocations);
                }
                const remoteCurrentLocationId = await getCurrentLocationId(user.uid);
                if (remoteCurrentLocationId) {
                    const found = (remoteLocations && remoteLocations.length > 0 ? remoteLocations : locations).find(l => l.id === remoteCurrentLocationId);
                    if (found) setCurrentLocation(found);
                }
            } else {
                // Refetch local on logout
                const saved = localStorage.getItem('locations');
                if (saved) setLocations(JSON.parse(saved));

                const savedId = localStorage.getItem('currentLocationId');
                if (savedId) {
                    const savedLocs = JSON.parse(localStorage.getItem('locations') || '[]');
                    const found = savedLocs.find(l => l.id === savedId);
                    if (found) setCurrentLocation({ ...found, idealWindDirection: found.idealWindDirection || { min: 0, max: 360 } });
                }
            }
        };
        fetchRemote();
    }, [user?.uid]);

    useEffect(() => {
        if (user?.uid) {
            saveUserLocations(user.uid, locations);
        } else {
            localStorage.setItem('locations', JSON.stringify(locations));
        }
    }, [locations, user?.uid]);

    useEffect(() => {
        if (user?.uid) {
            saveCurrentLocationId(user.uid, currentLocation.id);
        } else {
            localStorage.setItem('currentLocationId', currentLocation.id);
        }
    }, [currentLocation, user?.uid]);

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

    const updateLocation = (id, updates) => {
        setLocations(prev => prev.map(loc => {
            if (loc.id === id) {
                const updated = {
                    ...loc,
                    ...updates,
                    // Ensure nested structure is preserved/updated correctly if passed flat
                    idealWindDirection: {
                        min: parseFloat(updates.idealMin !== undefined ? updates.idealMin : loc.idealWindDirection.min),
                        max: parseFloat(updates.idealMax !== undefined ? updates.idealMax : loc.idealWindDirection.max)
                    }
                };

                // If it's the current location, update that state too
                if (currentLocation.id === id) {
                    setCurrentLocation(updated);
                }
                return updated;
            }
            return loc;
        }));
    };

    return (
        <LocationContext.Provider value={{
            locations,
            currentLocation,
            addLocation,
            switchLocation,
            deleteLocation,
            updateLocation
        }}>
            {children}
        </LocationContext.Provider>
    );
};

export const useLocation = () => useContext(LocationContext);
