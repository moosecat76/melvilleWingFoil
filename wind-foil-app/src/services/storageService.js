import { getJournalEntries } from './journalService';
import {
    getUserGear,
    getUserLocations,
    getCurrentLocationId,
    prepareJournalEntryForFirestore,
    isSameJournalEntry,
    mergeItemLists,
} from './dbService';

const STORAGE_KEY_PREFIX = 'wind_foil_';
const JOURNAL_KEY = 'wind_foil_journal_entries';
const GEAR_KEYS = ['user_gear', 'melvill_user_gear'];
const KEYS_TO_BACKUP = [
    JOURNAL_KEY,
    'locations',
    'currentLocationId',
    'user_gear',
    'melvill_user_gear'
];

const readLocalJson = (key) => {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (_) {
        return null;
    }
};

const asArray = (value) => {
    if (typeof value === 'string') {
        try { value = JSON.parse(value); } catch (_) { return []; }
    }
    return Array.isArray(value) ? value : [];
};

/**
 * Exports a full backup.
 *
 * When signed in, sessions/gear/locations are the MERGE of the cloud database and this
 * device's local storage, so the backup always contains every session — not just whatever
 * happens to be cached in this browser.
 */
export const exportData = async (uid = null) => {
    const backup = {};
    KEYS_TO_BACKUP.forEach(key => {
        const data = localStorage.getItem(key);
        if (data) {
            try {
                backup[key] = JSON.parse(data);
            } catch (e) {
                console.error(`Failed to parse ${key}`, e);
                backup[key] = data;
            }
        }
    });

    if (uid) {
        try {
            // Sessions: cloud + local (getJournalEntries already merges both)
            const entries = await getJournalEntries(uid);
            backup[JOURNAL_KEY] = entries.map((e) => {
                // Compact form: drops derived chart arrays & raw latlng (mapPolyline is kept)
                const { createdAt: _c, updatedAt: _u, ...compact } = prepareJournalEntryForFirestore(e);
                return { id: e.id, ...compact };
            });

            // Gear: cloud + local
            const cloudGear = await getUserGear(uid);
            const localGear = mergeItemLists(asArray(backup.melvill_user_gear), asArray(backup.user_gear));
            const mergedGear = mergeItemLists(cloudGear, localGear);
            if (mergedGear.length > 0) {
                backup.melvill_user_gear = mergedGear;
                backup.user_gear = mergedGear;
            }

            // Locations: cloud + local
            const cloudLocs = await getUserLocations(uid);
            const mergedLocs = mergeItemLists(cloudLocs || [], asArray(backup.locations));
            if (mergedLocs.length > 0) backup.locations = mergedLocs;

            const cloudCurrent = await getCurrentLocationId(uid);
            if (cloudCurrent) backup.currentLocationId = cloudCurrent;
        } catch (e) {
            console.error('[storageService] Could not merge cloud data into export; exporting local data only.', e);
            alert('Warning: could not read your cloud data, so this backup only contains data stored on this device.');
        }
    }

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wind-foil-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
};

/**
 * Imports a backup file into local storage ADDITIVELY.
 * Nothing already on this device is overwritten or removed: sessions are unioned,
 * gear/locations are unioned (existing items win), and other keys are only set if missing.
 */
export const importData = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const backup = JSON.parse(e.target.result);

                Object.keys(backup).forEach(key => {
                    try {
                        if (key === JOURNAL_KEY) {
                            const merged = asArray(readLocalJson(JOURNAL_KEY));
                            for (const entry of asArray(backup[key])) {
                                if (!merged.some(m => isSameJournalEntry(m, entry))) merged.push(entry);
                            }
                            localStorage.setItem(key, JSON.stringify(merged));
                        } else if (GEAR_KEYS.includes(key) || key === 'locations') {
                            const merged = mergeItemLists(asArray(readLocalJson(key)), asArray(backup[key]));
                            localStorage.setItem(key, JSON.stringify(merged));
                        } else if (localStorage.getItem(key) == null) {
                            localStorage.setItem(key, typeof backup[key] === 'object' ? JSON.stringify(backup[key]) : backup[key]);
                        }
                    } catch (storageErr) {
                        // e.g. quota exceeded — cloud restore still receives the full backup data
                        console.warn(`[storageService] Could not cache "${key}" locally:`, storageErr);
                    }
                });

                resolve({ success: true, count: Object.keys(backup).length, data: backup });
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = reject;
        reader.readAsText(file);
    });
};
