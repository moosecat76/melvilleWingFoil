import React, { createContext, useState, useEffect, useContext, useRef } from 'react';
import { useAuth } from './AuthContext';
import {
    getUserLocations,
    saveUserLocations,
    getCurrentLocationId,
    saveCurrentLocationId,
    mergeItemLists
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
 * - Restores default coordinates for Melville if corrupted
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

const getStoredLocations = () => {
    try {
        const raw = localStorage.getItem('locations');
        if (!raw) return [DEFAULT_LOCATION];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed) || parsed.length === 0) return [DEFAULT_LOCATION];
        const sanitized = parsed.map(sanitizeLocation);
        const hasMelville = sanitized.some(l => l.id === 'melville');
        return hasMelville ? sanitized : [DEFAULT_LOCATION, ...sanitized];
    } catch {
        return [DEFAULT_LOCATION];
    }
};

const getStoredCurrentLocation = (locsList) => {
    try {
        const savedId = localStorage.getItem('currentLocationId');
        if (savedId) {
            const found = locsList.find(l => l.id === savedId);
            if (found && isValidCoordinates(found.latitude, found.longitude)) {
                return found;
            }
        }
        const validFirst = locsList.find(l => isValidCoordinates(l.latitude, l.longitude));
        return validFirst || DEFAULT_LOCATION;
    } catch {
        return DEFAULT_LOCATION;
    }
};

export const LocationProvider = ({ children }) => {
    const { user, loading: authLoading } = useAuth();
    const [locations, setLocations] = useState(() => getStoredLocations());
    const [currentLocation, setCurrentLocation] = useState(() => {
        const initialLocs = getStoredLocations();
        return getStoredCurrentLocation(initialLocs);
    });

    // Track whether initial cloud sync has completed for this user session
    const syncCompletedForUid = useRef(null);

    // Synchronize cloud + local storage when auth state is resolved
    useEffect(() => {
        if (authLoading) return;

        const syncLocations = async () => {
            const currentUid = user?.uid || null;

            if (currentUid) {
                try {
                    const [remoteLocations, remoteCurrentId] = await Promise.all([
                        getUserLocations(currentUid),
                        getCurrentLocationId(currentUid)
                    ]);

                    const localLocs = getStoredLocations();
                    // Merge remote + local so no location from either source is lost
                    const merged = mergeItemLists(remoteLocations || [], localLocs).map(sanitizeLocation);
                    const hasMelville = merged.some(l => l.id === 'melville');
                    const finalList = hasMelville ? merged : [DEFAULT_LOCATION, ...merged];

                    // Determine active location
                    const targetId = remoteCurrentId || localStorage.getItem('currentLocationId') || 'melville';
                    const activeLoc = finalList.find(l => l.id === targetId && isValidCoordinates(l.latitude, l.longitude))
                        || finalList.find(l => isValidCoordinates(l.latitude, l.longitude))
                        || DEFAULT_LOCATION;

                    // Update local storage
                    localStorage.setItem('locations', JSON.stringify(finalList));
                    localStorage.setItem('currentLocationId', activeLoc.id);

                    // Update cloud database
                    await Promise.all([
                        saveUserLocations(currentUid, finalList),
                        saveCurrentLocationId(currentUid, activeLoc.id)
                    ]);

                    setLocations(finalList);
                    setCurrentLocation(activeLoc);
                    syncCompletedForUid.current = currentUid;
                } catch (err) {
                    console.warn('[LocationContext] Cloud sync failed, using local locations:', err);
                }
            } else {
                // Logged out: ensure local state matches localStorage
                const localLocs = getStoredLocations();
                const activeLoc = getStoredCurrentLocation(localLocs);
                setLocations(localLocs);
                setCurrentLocation(activeLoc);
                syncCompletedForUid.current = null;
            }
        };

        syncLocations();
    }, [user?.uid, authLoading]);

    // Helper to persist both to localStorage and Firestore
    const persistLocations = (newLocations, newCurrentLoc = null) => {
        const hasMelville = newLocations.some(l => l.id === 'melville');
        const safeList = hasMelville ? newLocations : [DEFAULT_LOCATION, ...newLocations];

        // 1. Always update localStorage immediately
        try {
            localStorage.setItem('locations', JSON.stringify(safeList));
            if (newCurrentLoc) {
                localStorage.setItem('currentLocationId', newCurrentLoc.id);
            }
        } catch (e) {
            console.warn('[LocationContext] Failed to write localStorage:', e);
        }

        // 2. If logged in, update Firestore asynchronously
        if (user?.uid) {
            saveUserLocations(user.uid, safeList).catch(err => {
                console.error('[LocationContext] Failed to save locations to Firestore:', err);
            });
            if (newCurrentLoc) {
                saveCurrentLocationId(user.uid, newCurrentLoc.id).catch(err => {
                    console.error('[LocationContext] Failed to save current location to Firestore:', err);
                });
            }
        }
    };

    const addLocation = (name, lat, lon, idealMin = 0, idealMax = 360) => {
        const newLoc = sanitizeLocation({
            id: Date.now().toString(),
            name: name.trim(),
            latitude: parseFloat(lat),
            longitude: parseFloat(lon),
            idealWindDirection: { min: parseFloat(idealMin), max: parseFloat(idealMax) }
        });

        const updatedList = [...locations, newLoc];
        setLocations(updatedList);
        setCurrentLocation(newLoc);
        persistLocations(updatedList, newLoc);
        return newLoc;
    };

    const switchLocation = (id) => {
        const found = locations.find(l => l.id === id);
        if (found) {
            const safe = sanitizeLocation(found);
            setCurrentLocation(safe);
            try {
                localStorage.setItem('currentLocationId', safe.id);
            } catch {}
            if (user?.uid) {
                saveCurrentLocationId(user.uid, safe.id).catch(() => {});
            }
        }
    };

    const deleteLocation = (id) => {
        if (id === 'melville') return;
        const remaining = locations.filter(l => l.id !== id);
        const safeRemaining = remaining.length > 0 ? remaining : [DEFAULT_LOCATION];

        let nextCurrent = currentLocation;
        if (currentLocation.id === id) {
            nextCurrent = safeRemaining[0];
            setCurrentLocation(nextCurrent);
        }

        setLocations(safeRemaining);
        persistLocations(safeRemaining, nextCurrent);
    };

    const updateLocation = (id, updates) => {
        let updatedActive = null;
        const updatedList = locations.map(loc => {
            if (loc.id === id) {
                const updated = sanitizeLocation({
                    ...loc,
                    ...updates,
                    idealWindDirection: {
                        min: parseFloat(updates.idealMin !== undefined ? updates.idealMin : loc.idealWindDirection?.min ?? 0),
                        max: parseFloat(updates.idealMax !== undefined ? updates.idealMax : loc.idealWindDirection?.max ?? 360)
                    }
                });
                if (currentLocation.id === id) {
                    updatedActive = updated;
                }
                return updated;
            }
            return loc;
        });

        setLocations(updatedList);
        if (updatedActive) {
            setCurrentLocation(updatedActive);
        }
        persistLocations(updatedList, updatedActive || currentLocation);
    };

    const resetToDefaultLocation = () => {
        const cleaned = locations.map(l => l.id === 'melville' ? DEFAULT_LOCATION : sanitizeLocation(l));
        const hasMelville = cleaned.some(l => l.id === 'melville');
        const safeList = hasMelville ? cleaned : [DEFAULT_LOCATION, ...cleaned];

        setLocations(safeList);
        setCurrentLocation(DEFAULT_LOCATION);
        persistLocations(safeList, DEFAULT_LOCATION);
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
