import React, { createContext, useState, useEffect, useContext } from 'react';
import { useAuth } from './AuthContext';
import {
    getUserLocations,
    saveUserLocations,
    getCurrentLocationId,
    saveCurrentLocationId
} from '../services/dbService';

const LocationContext = createContext();

export const DEFAULT_LOCATION = {
    id: 'melville',
    name: 'Melville Waters',
    latitude: -32.01303172472861,
    longitude: 115.82947437392544,
    idealWindDirection: { min: 135, max: 270 }
};

/**
 * Sanitizes a location object:
 * - Auto-swaps latitude and longitude if latitude is in (-180..180) outside [-90..90] and longitude is within [-90..90]
 * - Flags or repairs NaN coordinates
 */
export const sanitizeLocation = (loc) => {
    if (!loc) return DEFAULT_LOCATION;
    let lat = parseFloat(loc.latitude);
    let lon = parseFloat(loc.longitude);

    // Auto-fix swapped Lat/Lon (e.g. lat=115.8, lon=-32.0)
    if (!isNaN(lat) && !isNaN(lon) && Math.abs(lat) > 90 && Math.abs(lat) <= 180 && Math.abs(lon) <= 90) {
        const tmp = lat;
        lat = lon;
        lon = tmp;
    }

    // If default Melville location got corrupted out of bounds, restore its coordinates
    if (loc.id === 'melville' && (isNaN(lat) || isNaN(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)) {
        lat = DEFAULT_LOCATION.latitude;
        lon = DEFAULT_LOCATION.longitude;
    }

    return {
        ...loc,
        latitude: isNaN(lat) ? DEFAULT_LOCATION.latitude : lat,
        longitude: isNaN(lon) ? DEFAULT_LOCATION.longitude : lon,
        idealWindDirection: loc.idealWindDirection || { min: 0, max: 360 }
    };
};

export const isValidCoordinates = (lat, lon) => {
    const numLat = parseFloat(lat);
    const numLon = parseFloat(lon);
    return !isNaN(numLat) && !isNaN(numLon) && numLat >= -90 && numLat <= 90 && numLon >= -180 && numLon <= 180;
};

export const LocationProvider = ({ children }) => {
    const { user } = useAuth();

    const [locations, setLocations] = useState(() => {
        try {
            const saved = localStorage.getItem('locations');
            let parsed = saved ? JSON.parse(saved) : [DEFAULT_LOCATION];
            if (!Array.isArray(parsed) || parsed.length === 0) parsed = [DEFAULT_LOCATION];
            return parsed.map(sanitizeLocation);
        } catch {
            return [DEFAULT_LOCATION];
        }
    });

    const [currentLocation, setCurrentLocation] = useState(() => {
        try {
            const savedId = localStorage.getItem('currentLocationId');
            const savedList = JSON.parse(localStorage.getItem('locations') || '[]').map(sanitizeLocation);
            if (savedId) {
                const found = savedList.find(l => l.id === savedId);
                if (found && isValidCoordinates(found.latitude, found.longitude)) {
                    return found;
                }
            }
            const validFirst = savedList.find(l => isValidCoordinates(l.latitude, l.longitude));
            return validFirst || DEFAULT_LOCATION;
        } catch {
            return DEFAULT_LOCATION;
        }
    });

    useEffect(() => {
        const fetchRemote = async () => {
            if (user?.uid) {
                const remoteLocations = await getUserLocations(user.uid);
                const sanitizedRemote = (remoteLocations && remoteLocations.length > 0)
                    ? remoteLocations.map(sanitizeLocation)
                    : null;
                if (sanitizedRemote) {
                    setLocations(sanitizedRemote);
                }
                const remoteCurrentLocationId = await getCurrentLocationId(user.uid);
                if (remoteCurrentLocationId) {
                    const pool = sanitizedRemote || locations;
                    const found = pool.find(l => l.id === remoteCurrentLocationId);
                    if (found) setCurrentLocation(sanitizeLocation(found));
                }
            } else {
                const saved = localStorage.getItem('locations');
                if (saved) {
                    try {
                        const parsed = JSON.parse(saved).map(sanitizeLocation);
                        setLocations(parsed);
                        const savedId = localStorage.getItem('currentLocationId');
                        if (savedId) {
                            const found = parsed.find(l => l.id === savedId);
                            if (found) setCurrentLocation(found);
                        }
                    } catch {
                        setLocations([DEFAULT_LOCATION]);
                        setCurrentLocation(DEFAULT_LOCATION);
                    }
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
        const newLoc = sanitizeLocation({
            id: Date.now().toString(),
            name,
            latitude: parseFloat(lat),
            longitude: parseFloat(lon),
            idealWindDirection: { min: parseFloat(idealMin), max: parseFloat(idealMax) }
        });
        setLocations(prev => [...prev, newLoc]);
        setCurrentLocation(newLoc);
        return newLoc;
    };

    const switchLocation = (id) => {
        const loc = locations.find(l => l.id === id);
        if (loc) {
            setCurrentLocation(sanitizeLocation(loc));
        }
    };

    const deleteLocation = (id) => {
        if (id === 'melville') return;
        const remaining = locations.filter(l => l.id !== id);
        const safeRemaining = remaining.length > 0 ? remaining : [DEFAULT_LOCATION];
        setLocations(safeRemaining);
        if (currentLocation.id === id) {
            setCurrentLocation(safeRemaining[0]);
        }
    };

    const updateLocation = (id, updates) => {
        setLocations(prev => prev.map(loc => {
            if (loc.id === id) {
                const updated = sanitizeLocation({
                    ...loc,
                    ...updates,
                    idealWindDirection: {
                        min: parseFloat(updates.idealMin !== undefined ? updates.idealMin : loc.idealWindDirection.min),
                        max: parseFloat(updates.idealMax !== undefined ? updates.idealMax : loc.idealWindDirection.max)
                    }
                });

                if (currentLocation.id === id) {
                    setCurrentLocation(updated);
                }
                return updated;
            }
            return loc;
        }));
    };

    const resetToDefaultLocation = () => {
        setLocations(prev => {
            const hasMelville = prev.some(l => l.id === 'melville');
            const cleaned = prev.map(l => l.id === 'melville' ? DEFAULT_LOCATION : sanitizeLocation(l));
            return hasMelville ? cleaned : [DEFAULT_LOCATION, ...cleaned];
        });
        setCurrentLocation(DEFAULT_LOCATION);
    };

    return (
        <LocationContext.Provider value={{
            locations,
            currentLocation,
            addLocation,
            switchLocation,
            deleteLocation,
            updateLocation,
            resetToDefaultLocation
        }}>
            {children}
        </LocationContext.Provider>
    );
};

export const useLocation = () => useContext(LocationContext);
