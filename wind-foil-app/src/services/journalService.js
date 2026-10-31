import {
    getJournalEntries as dbGetJournalEntries,
    addJournalEntry as dbAddJournalEntry,
    updateJournalEntry as dbUpdateJournalEntry,
    deleteJournalEntry as dbDeleteJournalEntry,
    getEntriesForLocation as dbGetEntriesForLocation,
    subscribeToJournalEntries as dbSubscribeToJournalEntries,
    prepareJournalEntryForFirestore,
    hydrateJournalEntry,
    isSameJournalEntry,
} from './dbService';

const STORAGE_KEY = 'wind_foil_journal_entries';
const DELETED_IDS_KEY = 'wind_foil_deleted_ids';

/**
 * Checks if two journal entries refer to the same logged session.
 */
const isSameEntry = (a, b) => isSameJournalEntry(a, b);

const getDeletedIds = () => {
    try {
        const raw = localStorage.getItem(DELETED_IDS_KEY);
        if (!raw) return new Set();
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? new Set(parsed.map(String)) : new Set();
    } catch {
        return new Set();
    }
};

const addDeletedId = (id) => {
    if (!id) return;
    try {
        const set = getDeletedIds();
        set.add(String(id));
        localStorage.setItem(DELETED_IDS_KEY, JSON.stringify(Array.from(set).slice(-200)));
    } catch (_) { /* ignore */ }
};

const getLocalEntries = () => {
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        if (!data) return [];
        const parsed = JSON.parse(data);
        if (!Array.isArray(parsed)) return [];
        const deletedIds = getDeletedIds();
        return parsed
            .filter((e) => !e?.id || !deletedIds.has(String(e.id)))
            .map((e) => hydrateJournalEntry(e));
    } catch (e) {
        console.warn('[journalService] Failed to parse local journal entries:', e);
        return [];
    }
};

/**
 * Persists a compact version of journal entries to localStorage so offline/failed writes
 * never lose a session, while keeping storage footprint small enough for mobile browsers.
 */
const saveLocalEntries = (entries) => {
    try {
        const compactList = (entries || []).map((e) => {
            if (!e || typeof e !== 'object') return e;
            const { createdAt: _c, updatedAt: _u, ...compact } = prepareJournalEntryForFirestore(e);
            return { id: e.id, ...compact };
        });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(compactList));
    } catch (e) {
        console.warn('[journalService] Could not persist to localStorage:', e);
    }
};

const sortByDateDesc = (entries) => {
    return [...entries].sort((a, b) => {
        const tA = new Date(a.date || 0).getTime() || 0;
        const tB = new Date(b.date || 0).getTime() || 0;
        return tB - tA;
    });
};

/**
 * Merges cloud entries with local entries:
 * - Any local-only entry (e.g., logged while mobile had spotty connection or before sign-in)
 *   is preserved and background-synced to Firestore.
 * - Updates localStorage cache with the unified list so both mobile and desktop stay in sync.
 */
const mergeCloudAndLocalEntries = (cloudEntries = [], uid = null, allowBackgroundPush = true) => {
    const deletedIds = getDeletedIds();
    const localEntries = getLocalEntries();
    const merged = cloudEntries.filter((e) => !e?.id || !deletedIds.has(String(e.id)));
    let localChanged = false;

    for (const localEntry of localEntries) {
        if (localEntry?.id && deletedIds.has(String(localEntry.id))) continue;
        const idx = merged.findIndex((e) => isSameEntry(e, localEntry));
        if (idx === -1) {
            const hydratedLocal = hydrateJournalEntry(localEntry);
            merged.push(hydratedLocal);
            localChanged = true;
            if (uid && allowBackgroundPush) {
                dbAddJournalEntry(uid, localEntry)
                    .then((synced) => {
                        // Replace local temporary ID with Firestore ID in localStorage cache
                        const currentLocal = getLocalEntries();
                        const updated = currentLocal.map((item) =>
                            isSameEntry(item, localEntry) ? { ...item, id: synced.id } : item
                        );
                        saveLocalEntries(updated);
                    })
                    .catch((err) =>
                        console.warn('[journalService] Failed to background-sync local entry:', err)
                    );
            }
        } else if (!merged[idx].streams && localEntry.streams) {
            const enriched = hydrateJournalEntry({
                ...merged[idx],
                streams: localEntry.streams,
                mapPolyline: merged[idx].mapPolyline || localEntry.mapPolyline,
            });
            merged[idx] = enriched;
            localChanged = true;
            if (uid && allowBackgroundPush) {
                dbUpdateJournalEntry(uid, enriched.id, enriched).catch((err) =>
                    console.warn('[journalService] Failed to enrich cloud entry with local streams:', err)
                );
            }
        }
    }

    const sorted = sortByDateDesc(merged);
    if (sorted.length > 0 || localChanged) {
        saveLocalEntries(sorted);
    }
    return sorted;
};

export const getJournalEntries = async (uid = null) => {
    if (uid) {
        let cloudEntries = [];
        try {
            cloudEntries = await dbGetJournalEntries(uid);
        } catch (e) {
            console.error('[journalService] Failed to fetch cloud entries:', e);
        }
        return mergeCloudAndLocalEntries(cloudEntries, uid, true);
    }

    const localEntries = getLocalEntries();
    return sortByDateDesc(localEntries);
};

/**
 * Subscribes to real-time updates of journal entries from Firestore (and window focus/online events).
 * Ensures that sessions logged on mobile immediately appear when opening or focusing the desktop app.
 */
export const subscribeToJournalEntries = (uid, onUpdate) => {
    if (!uid) {
        onUpdate(sortByDateDesc(getLocalEntries()));
        return () => {};
    }

    let isSubscribed = true;

    const unsubscribeSnapshot = dbSubscribeToJournalEntries(
        uid,
        (cloudEntries) => {
            if (!isSubscribed) return;
            const merged = mergeCloudAndLocalEntries(cloudEntries, uid, true);
            onUpdate(merged);
        },
        async () => {
            // Fallback if snapshot fails: fetch once
            if (!isSubscribed) return;
            const entries = await getJournalEntries(uid);
            if (isSubscribed) onUpdate(entries);
        }
    );

    const handleVisibilityOrOnline = () => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        getJournalEntries(uid)
            .then((entries) => {
                if (isSubscribed) onUpdate(entries);
            })
            .catch(() => {});
    };

    if (typeof window !== 'undefined') {
        window.addEventListener('focus', handleVisibilityOrOnline);
        window.addEventListener('online', handleVisibilityOrOnline);
        document.addEventListener('visibilitychange', handleVisibilityOrOnline);
    }

    return () => {
        isSubscribed = false;
        if (typeof unsubscribeSnapshot === 'function') unsubscribeSnapshot();
        if (typeof window !== 'undefined') {
            window.removeEventListener('focus', handleVisibilityOrOnline);
            window.removeEventListener('online', handleVisibilityOrOnline);
            document.removeEventListener('visibilitychange', handleVisibilityOrOnline);
        }
    };
};

export const addJournalEntry = async (entry, uid = null) => {
    const entries = getLocalEntries();
    const optimisticEntry = hydrateJournalEntry({
        id: entry.id || Date.now().toString(),
        date: entry.date || new Date().toISOString(),
        ...entry,
    });

    // 1. Always write to localStorage immediately so closing the mobile tab never loses the session
    const dedupedLocal = [optimisticEntry, ...entries.filter((e) => !isSameEntry(e, optimisticEntry))];
    saveLocalEntries(dedupedLocal);

    // 2. Sync to Firestore if signed in
    if (uid) {
        try {
            const added = await dbAddJournalEntry(uid, optimisticEntry);
            const hydratedCloud = hydrateJournalEntry(added);
            const syncedLocal = dedupedLocal.map((e) =>
                isSameEntry(e, optimisticEntry) ? hydratedCloud : e
            );
            saveLocalEntries(syncedLocal);
            return hydratedCloud;
        } catch (err) {
            console.warn('[journalService] Cloud save deferred (saved locally and will sync on next connection):', err);
            return optimisticEntry;
        }
    }

    return optimisticEntry;
};

export const deleteJournalEntry = async (id, uid = null) => {
    addDeletedId(id);
    try {
        const entries = getLocalEntries();
        const updatedEntries = entries.filter(e => String(e.id) !== String(id));
        saveLocalEntries(updatedEntries);
    } catch (_) { /* ignore */ }

    if (uid) {
        await dbDeleteJournalEntry(uid, id);
    }
};

export const updateJournalEntry = async (updatedEntry, uid = null) => {
    const hydrated = hydrateJournalEntry(updatedEntry);
    const entries = getLocalEntries();
    const index = entries.findIndex(e => String(e.id) === String(updatedEntry.id) || isSameEntry(e, updatedEntry));
    if (index !== -1) {
        entries[index] = hydrated;
    } else {
        entries.unshift(hydrated);
    }
    saveLocalEntries(entries);

    if (uid) {
        try {
            const { id, ...data } = updatedEntry;
            const updated = await dbUpdateJournalEntry(uid, id, data);
            return hydrateJournalEntry(updated);
        } catch (err) {
            console.warn('[journalService] Cloud update deferred (updated locally):', err);
            return hydrated;
        }
    }
    return hydrated;
};

export const getEntriesForLocation = async (locationId, uid = null) => {
    if (uid) {
        return await dbGetEntriesForLocation(uid, locationId);
    }
    const entries = await getJournalEntries();
    return entries.filter(e => e.locationId === locationId);
};
