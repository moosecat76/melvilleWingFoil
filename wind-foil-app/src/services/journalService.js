import {
    getJournalEntries as dbGetJournalEntries,
    addJournalEntry as dbAddJournalEntry,
    updateJournalEntry as dbUpdateJournalEntry,
    deleteJournalEntry as dbDeleteJournalEntry,
    getEntriesForLocation as dbGetEntriesForLocation,
    hydrateJournalEntry,
    isSameJournalEntry,
} from './dbService';

const STORAGE_KEY = 'wind_foil_journal_entries';

/**
 * Checks if two journal entries refer to the same logged session.
 */
const isSameEntry = (a, b) => isSameJournalEntry(a, b);

const getLocalEntries = () => {
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        if (!data) return [];
        const parsed = JSON.parse(data);
        if (!Array.isArray(parsed)) return [];
        return parsed.map((e) => hydrateJournalEntry(e));
    } catch (e) {
        console.warn('[journalService] Failed to parse local journal entries:', e);
        return [];
    }
};

const sortByDateDesc = (entries) => {
    return [...entries].sort((a, b) => {
        const tA = new Date(a.date || 0).getTime() || 0;
        const tB = new Date(b.date || 0).getTime() || 0;
        return tB - tA;
    });
};

export const getJournalEntries = async (uid = null) => {
    if (uid) {
        let cloudEntries = [];
        try {
            cloudEntries = await dbGetJournalEntries(uid);
        } catch (e) {
            console.error('[journalService] Failed to fetch cloud entries:', e);
        }

        const localEntries = getLocalEntries();
        const merged = [...cloudEntries];

        // Merge any local entries that aren't in Firestore yet (or enrich missing streams)
        for (const localEntry of localEntries) {
            const idx = merged.findIndex((e) => isSameEntry(e, localEntry));
            if (idx === -1) {
                merged.push(hydrateJournalEntry(localEntry));
                // Background sync to Firestore
                dbAddJournalEntry(uid, localEntry).catch((err) =>
                    console.warn('[journalService] Failed to background-sync local entry:', err)
                );
            } else if (!merged[idx].streams && localEntry.streams) {
                const enriched = hydrateJournalEntry({
                    ...merged[idx],
                    streams: localEntry.streams,
                    mapPolyline: merged[idx].mapPolyline || localEntry.mapPolyline,
                });
                merged[idx] = enriched;
                dbUpdateJournalEntry(uid, enriched.id, enriched).catch((err) =>
                    console.warn('[journalService] Failed to enrich cloud entry with local streams:', err)
                );
            }
        }

        return sortByDateDesc(merged);
    }

    const localEntries = getLocalEntries();
    return sortByDateDesc(localEntries);
};

export const addJournalEntry = async (entry, uid = null) => {
    if (uid) {
        const added = await dbAddJournalEntry(uid, entry);
        return hydrateJournalEntry(added);
    }
    const entries = getLocalEntries();
    const newEntry = hydrateJournalEntry({
        id: Date.now().toString(),
        date: new Date().toISOString(),
        ...entry
    });
    const updatedEntries = [newEntry, ...entries];
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedEntries));
    } catch (e) {
        console.warn('[journalService] Could not persist to localStorage:', e);
    }
    return newEntry;
};

export const deleteJournalEntry = async (id, uid = null) => {
    if (uid) {
        await dbDeleteJournalEntry(uid, id);
    }
    try {
        const entries = getLocalEntries();
        const updatedEntries = entries.filter(e => String(e.id) !== String(id));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedEntries));
    } catch (_) { /* ignore */ }
};

export const updateJournalEntry = async (updatedEntry, uid = null) => {
    if (uid) {
        const { id, ...data } = updatedEntry;
        const updated = await dbUpdateJournalEntry(uid, id, data);
        return hydrateJournalEntry(updated);
    }
    const entries = getLocalEntries();
    const index = entries.findIndex(e => String(e.id) === String(updatedEntry.id));
    if (index !== -1) {
        entries[index] = hydrateJournalEntry(updatedEntry);
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
        } catch (_) { /* ignore */ }
        return entries[index];
    }
    return null;
};

export const getEntriesForLocation = async (locationId, uid = null) => {
    if (uid) {
        return await dbGetEntriesForLocation(uid, locationId);
    }
    const entries = await getJournalEntries();
    return entries.filter(e => e.locationId === locationId);
};
