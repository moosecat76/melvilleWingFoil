/**
 * dbService.js — Firestore-backed persistence layer.
 *
 * Data lives at:
 *   users/{uid}/journal_entries   (collection of docs)
 *   users/{uid}/settings/gear     (single doc)
 *   users/{uid}/settings/locations (single doc)
 *   users/{uid}/strava            (single doc — tokens)
 *
 * Every public function requires a `uid` so components can call
 * the service after the user has authenticated.
 */

import {
    collection,
    doc,
    getDocs,
    getDoc,
    setDoc,
    addDoc,
    updateDoc,
    deleteDoc,
    query,
    where,
    orderBy,
    serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebaseSetup';
import { encodePolyline, decodePolyline } from './tcxService';
import { analyzeSession } from './foilAnalysisService';

/**
 * Normalizes an entry's date field (ISO string, Firestore Timestamp, epoch ms, or activityStats.startTime)
 * into a valid ISO 8601 string.
 */
export const normalizeEntryDate = (entry) => {
    if (!entry || typeof entry !== 'object') return null;
    const raw = entry.date ?? entry.activityStats?.startTime ?? entry.createdAt;
    if (!raw) return null;
    if (typeof raw === 'string') {
        const ms = Date.parse(raw);
        return !isNaN(ms) ? new Date(ms).toISOString() : raw;
    }
    if (typeof raw.toDate === 'function') {
        try {
            return raw.toDate().toISOString();
        } catch (_) {
            return null;
        }
    }
    if (typeof raw.seconds === 'number') {
        return new Date(raw.seconds * 1000).toISOString();
    }
    if (raw instanceof Date && !isNaN(raw.getTime())) {
        return raw.toISOString();
    }
    if (typeof raw === 'number' && !isNaN(raw)) {
        return new Date(raw).toISOString();
    }
    return null;
};

// ─── Firestore Data Sanitization & Preparation ──────
/**
 * Recursively sanitize objects so Firestore never encounters:
 * 1. undefined values (rejected by Firestore)
 * 2. Nested arrays (e.g. array of arrays, or array containing objects that contain arrays)
 */
export const sanitizeForFirestore = (data) => {
    if (data === undefined) return null;
    if (data === null || typeof data !== 'object') return data;
    if (data instanceof Date) return data;
    if (typeof data.toMillis === 'function' || data._methodName) return data;

    if (Array.isArray(data)) {
        return data.map(item => {
            if (Array.isArray(item)) {
                // Nested array: convert coordinate pairs [lat, lng] to objects { lat, lng }
                if (item.length === 2 && typeof item[0] === 'number' && typeof item[1] === 'number') {
                    return { lat: item[0], lng: item[1] };
                }
                return JSON.stringify(item);
            }
            if (item && typeof item === 'object') {
                const cleaned = {};
                for (const [k, v] of Object.entries(item)) {
                    if (Array.isArray(v)) {
                        // An object inside an array cannot contain another array in Firestore
                        cleaned[k] = JSON.stringify(v);
                    } else {
                        cleaned[k] = sanitizeForFirestore(v);
                    }
                }
                return cleaned;
            }
            return sanitizeForFirestore(item);
        });
    }

    const result = {};
    for (const [key, value] of Object.entries(data)) {
        if (value === undefined) continue;
        result[key] = sanitizeForFirestore(value);
    }
    return result;
};

/**
 * Prepares a journal entry for writing to Firestore:
 * - Normalizes streams from array (Strava) to map format
 * - Encodes latlng coordinates into mapPolyline if needed
 * - Removes raw latlng nested arrays from streams to comply with Firestore
 * - Deep sanitizes against any nested arrays or undefined values
 */
export const prepareJournalEntryForFirestore = (entry) => {
    if (!entry || typeof entry !== 'object') return entry;
    const { id, ...copy } = entry;

    const normalizedDate = normalizeEntryDate(copy);
    if (normalizedDate) {
        copy.date = normalizedDate;
    }

    if (copy.streams) {
        let streamsObj = copy.streams;

        // If Strava array format: [{ type: 'time', data: [...] }] -> { time: { data: [...] } }
        if (Array.isArray(streamsObj)) {
            const mapped = {};
            for (const s of streamsObj) {
                if (s && s.type && s.data) {
                    mapped[s.type] = { data: s.data };
                }
            }
            streamsObj = mapped;
        } else {
            streamsObj = { ...streamsObj };
        }

        // Handle latlng stream: encode to mapPolyline and remove from Firestore doc to avoid nested arrays
        if (streamsObj.latlng?.data) {
            if (!copy.mapPolyline && Array.isArray(streamsObj.latlng.data) && streamsObj.latlng.data.length > 0) {
                try {
                    copy.mapPolyline = encodePolyline(streamsObj.latlng.data);
                } catch (e) {
                    console.warn('[DB] Failed to encode polyline from latlng stream:', e);
                }
            }
            // Remove raw latlng stream from Firestore payload
            delete streamsObj.latlng;
        }

        copy.streams = streamsObj;
    }

    // Strip redundant large per-point arrays from foilAnalysis when streams is already stored,
    // keeping Firestore documents well below the 1 MiB limit.
    if (copy.foilAnalysis && typeof copy.foilAnalysis === 'object' && copy.streams) {
        const { data: _d, dynamicBaseline: _db, pointStates: _ps, ...compactAnalysis } = copy.foilAnalysis;
        copy.foilAnalysis = compactAnalysis;
    }

    return sanitizeForFirestore(copy);
};

/**
 * Hydrates a journal entry when loaded from Firestore:
 * - Normalizes entry.date
 * - Reconstructs streams.latlng in-memory from mapPolyline if missing
 * - Reconstructs full foilAnalysis (with chart arrays and adaptive profile) from streams
 */
export const hydrateJournalEntry = (entry) => {
    if (!entry || typeof entry !== 'object') return entry;
    const hydrated = { ...entry };

    const normalizedDate = normalizeEntryDate(hydrated);
    if (normalizedDate) {
        hydrated.date = normalizedDate;
    }

    if (hydrated.mapPolyline && hydrated.streams && !hydrated.streams.latlng) {
        try {
            const coords = decodePolyline(hydrated.mapPolyline);
            if (coords && coords.length > 0) {
                hydrated.streams = {
                    ...hydrated.streams,
                    latlng: { data: coords },
                };
            }
        } catch (e) {
            console.warn('[DB] Could not decode polyline for entry:', hydrated.id, e);
        }
    }

    if (hydrated.streams && (!hydrated.foilAnalysis || !hydrated.foilAnalysis.data || !hydrated.foilAnalysis.adaptiveProfile)) {
        try {
            const computed = analyzeSession(hydrated.streams);
            if (computed) {
                hydrated.foilAnalysis = computed;
            }
        } catch (e) {
            console.warn('[DB] Could not compute foilAnalysis for entry:', hydrated.id, e);
        }
    }

    return hydrated;
};

/**
 * Checks if two journal entries refer to the same logged session.
 * Matches on id, or on identical normalized date + notes.
 */
export const isSameJournalEntry = (a, b) => {
    if (!a || !b) return false;
    if (a.id && b.id && String(a.id) === String(b.id)) return true;
    const dateA = normalizeEntryDate(a) || a.date;
    const dateB = normalizeEntryDate(b) || b.date;
    return !!(dateA && dateB && dateA === dateB && (a.notes || '').trim() === (b.notes || '').trim());
};

/**
 * Union two lists of settings items (gear / locations) by id (or JSON content when no id).
 * Items in `primary` win on conflict; nothing from either list is ever dropped.
 */
export const mergeItemLists = (primary = [], secondary = []) => {
    const keyOf = (item) => (item && item.id != null ? `id:${item.id}` : `json:${JSON.stringify(item)}`);
    const merged = [];
    const seen = new Set();
    for (const item of [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(secondary) ? secondary : [])]) {
        const k = keyOf(item);
        if (seen.has(k)) continue;
        seen.add(k);
        merged.push(item);
    }
    return merged;
};

// ─── Journal Entries ────────────────────────────────
const journalCol = (uid) => collection(db, 'users', uid, 'journal_entries');

export const getJournalEntries = async (uid) => {
    // Fetch all docs in journal_entries without orderBy('date') so Firestore never excludes
    // documents that might have a missing or unindexed date field; sort client-side instead.
    const snap = await getDocs(journalCol(uid));
    const entries = [];
    for (const d of snap.docs) {
        try {
            entries.push(hydrateJournalEntry({ id: d.id, ...d.data() }));
        } catch (e) {
            console.warn('[DB] Failed to hydrate journal entry:', d.id, e);
            entries.push({ id: d.id, ...d.data() });
        }
    }
    return entries.sort((a, b) => {
        const tA = new Date(a.date || 0).getTime() || 0;
        const tB = new Date(b.date || 0).getTime() || 0;
        return tB - tA;
    });
};

export const addJournalEntry = async (uid, entry) => {
    const prepared = prepareJournalEntryForFirestore(entry);
    const newEntry = {
        date: new Date().toISOString(),
        ...prepared,
        createdAt: serverTimestamp(),
    };
    const ref = await addDoc(journalCol(uid), newEntry);
    // Return original entry combined with server id and timestamps
    return { ...entry, id: ref.id, ...newEntry };
};

export const updateJournalEntry = async (uid, entryId, data) => {
    const prepared = prepareJournalEntryForFirestore(data);
    const ref = doc(db, 'users', uid, 'journal_entries', entryId);
    await updateDoc(ref, { ...prepared, updatedAt: serverTimestamp() });
    return { ...data, id: entryId };
};

export const deleteJournalEntry = async (uid, entryId) => {
    await deleteDoc(doc(db, 'users', uid, 'journal_entries', entryId));
};

export const getEntriesForLocation = async (uid, locationId) => {
    const snap = await getDocs(
        query(journalCol(uid), where('locationId', '==', locationId))
    );
    return snap.docs.map((d) => hydrateJournalEntry({ id: d.id, ...d.data() }));
};

// ─── User Gear ──────────────────────────────────────
const gearDoc = (uid) => doc(db, 'users', uid, 'settings', 'gear');

export const getUserGear = async (uid) => {
    const snap = await getDoc(gearDoc(uid));
    return snap.exists() ? snap.data().items || [] : [];
};

export const saveUserGear = async (uid, gearItems) => {
    await setDoc(gearDoc(uid), { items: gearItems }, { merge: true });
};

// ─── Locations ──────────────────────────────────────
const locDoc = (uid) => doc(db, 'users', uid, 'settings', 'locations');

export const getUserLocations = async (uid) => {
    const snap = await getDoc(locDoc(uid));
    return snap.exists() ? snap.data().items || [] : null;
};

export const saveUserLocations = async (uid, locationsArray) => {
    await setDoc(locDoc(uid), { items: locationsArray }, { merge: true });
};

export const getCurrentLocationId = async (uid) => {
    const snap = await getDoc(locDoc(uid));
    return snap.exists() ? snap.data().currentId || null : null;
};

export const saveCurrentLocationId = async (uid, locationId) => {
    await setDoc(locDoc(uid), { currentId: locationId }, { merge: true });
};

// ─── Google Health Tokens (per-user) ─────────────────
// Stored at the same Firestore path for backwards compatibility.
// Previously called "Google Fit" tokens; now used for Google Health API v4.
const gfitDoc = (uid) => doc(db, 'users', uid, 'googlefit', 'tokens');

export const getGoogleFitTokens = async (uid) => {
    if (!uid) return null;
    const snap = await getDoc(gfitDoc(uid));
    return snap.exists() ? snap.data() : null;
};

export const saveGoogleFitTokens = async (uid, tokenData) => {
    if (!uid) return;
    await setDoc(gfitDoc(uid), { ...tokenData, updatedAt: serverTimestamp() }, { merge: true });
};

export const deleteGoogleFitTokens = async (uid) => {
    if (!uid) return;
    try {
        await deleteDoc(gfitDoc(uid));
    } catch (e) {
        console.error('Failed to delete Google Health tokens from Firestore:', e);
    }
};

// ─── Migration helper ───────────────────────────────
/**
 * One-time migration: move localStorage data into Firestore.
 * Call this right after a user logs in for the first time.
 */
export const migrateLocalStorageToFirestore = async (uid) => {
    console.log('Starting DB Migration/Merge for UID:', uid);

    // 1. Journal entries
    try {
        const localJournal = localStorage.getItem('wind_foil_journal_entries');
        if (localJournal) {
            let existing = [];
            try {
                existing = await getJournalEntries(uid);
            } catch (e) {
                console.warn('Could not fetch existing journal entries. Will push blindly.', e);
            }

            const entries = JSON.parse(localJournal);
            let added = 0;
            for (const entry of entries) {
                const isDuplicate = existing.some(e => e.date === entry.date && e.notes === entry.notes);
                if (!isDuplicate) {
                    const prepared = prepareJournalEntryForFirestore(entry);
                    try {
                        await addDoc(journalCol(uid), prepared);
                        added++;
                    } catch (err) {
                        console.error('Failed to migrate journal entry:', entry.date, err.code, err.message);
                    }
                }
            }
            if (added > 0) console.log(`Migrated ${added} journal entries to Firestore`);
        }
    } catch (e) {
        console.error('Critical error in Journal Migration', e);
    }

    // 2. Gear
    try {
        const localGear = localStorage.getItem('melvill_user_gear');
        if (localGear) {
            const cloudGear = await getUserGear(uid);
            if (!cloudGear || cloudGear.length === 0) {
                await saveUserGear(uid, JSON.parse(localGear));
                console.log('Migrated gear to Firestore');
            }
        }
    } catch (e) {
        console.error('Gear migration failed', e);
    }

    // 3. Locations
    try {
        const localLocations = localStorage.getItem('locations');
        if (localLocations) {
            const cloudLocs = await getUserLocations(uid);
            if (!cloudLocs || cloudLocs.length === 0) {
                await saveUserLocations(uid, JSON.parse(localLocations));
                const currentId = localStorage.getItem('currentLocationId');
                if (currentId) await saveCurrentLocationId(uid, currentId);
                console.log('Migrated locations to Firestore');
            }
        }
    } catch (e) {
        console.error('Locations migration failed', e);
    }

    
};

// ─── Restore backup directly to Firestore ────────────
/**
 * Additive restore: merges a backup into Firestore and NEVER deletes or overwrites
 * existing cloud data. Sessions already present (same id, or same date + notes) are skipped;
 * gear and locations are unioned with what is already in the cloud.
 */
export const restoreBackupToFirestore = async (uid, backupData) => {
    console.log('Starting Cloud Restore for UID:', uid);

    // 1. Journal entries
    if (backupData.wind_foil_journal_entries) {
        let entries = backupData.wind_foil_journal_entries;
        if (typeof entries === 'string') entries = JSON.parse(entries);

        // Abort rather than push blindly: a failed fetch must never cause duplicates.
        const existing = await getJournalEntries(uid);

        let added = 0;
        for (const entry of entries) {
            if (existing.some(e => isSameJournalEntry(e, entry))) continue;
            const prepared = prepareJournalEntryForFirestore(entry);
            // Server-managed timestamps from an export are not meaningful in a new document
            delete prepared.createdAt;
            delete prepared.updatedAt;
            try {
                await addDoc(journalCol(uid), { ...prepared, createdAt: serverTimestamp() });
                existing.push(entry); // also guards against duplicates inside the backup file itself
                added++;
            } catch (err) {
                console.error('Failed to restore journal entry:', entry.date, err.code, err.message);
            }
        }
        console.log(`Restored ${added} new journal entries to Firestore`);
    }

    // 2. Gear — union with cloud (cloud wins on conflicts)
    if (backupData.melvill_user_gear || backupData.user_gear) {
        let gear = backupData.melvill_user_gear || backupData.user_gear;
        if (typeof gear === 'string') gear = JSON.parse(gear);
        if (Array.isArray(gear)) {
            const cloudGear = await getUserGear(uid);
            await saveUserGear(uid, mergeItemLists(cloudGear, gear));
            console.log('Merged Gear into Firestore');
        }
    }

    // 3. Locations — union with cloud (cloud wins on conflicts)
    if (backupData.locations) {
        let locs = backupData.locations;
        if (typeof locs === 'string') locs = JSON.parse(locs);
        if (Array.isArray(locs)) {
            const cloudLocs = await getUserLocations(uid);
            await saveUserLocations(uid, mergeItemLists(cloudLocs || [], locs));
            console.log('Merged Locations into Firestore');
        }
    }

    // Only adopt the backup's current location if none is set yet
    if (backupData.currentLocationId) {
        const cloudCurrent = await getCurrentLocationId(uid);
        if (!cloudCurrent) {
            await saveCurrentLocationId(uid, backupData.currentLocationId);
            console.log('Restored Current Location ID');
        }
    }
};
