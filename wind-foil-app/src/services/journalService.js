import {
    getJournalEntries as dbGetJournalEntries,
    addJournalEntry as dbAddJournalEntry,
    updateJournalEntry as dbUpdateJournalEntry,
    deleteJournalEntry as dbDeleteJournalEntry,
    getEntriesForLocation as dbGetEntriesForLocation,
} from './dbService';

const STORAGE_KEY = 'wind_foil_journal_entries';

export const getJournalEntries = async (uid = null) => {
    if (uid) {
        return await dbGetJournalEntries(uid);
    }
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
};

export const addJournalEntry = async (entry, uid = null) => {
    if (uid) {
        return await dbAddJournalEntry(uid, entry);
    }
    const entries = await getJournalEntries();
    const newEntry = {
        id: Date.now().toString(),
        date: new Date().toISOString(),
        ...entry
    };
    const updatedEntries = [newEntry, ...entries];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedEntries));
    return newEntry;
};

export const deleteJournalEntry = async (id, uid = null) => {
    if (uid) {
        await dbDeleteJournalEntry(uid, id);
        return;
    }
    const entries = await getJournalEntries();
    const updatedEntries = entries.filter(e => e.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedEntries));
};

export const updateJournalEntry = async (updatedEntry, uid = null) => {
    if (uid) {
        const { id, ...data } = updatedEntry;
        return await dbUpdateJournalEntry(uid, id, data);
    }
    const entries = await getJournalEntries();
    const index = entries.findIndex(e => e.id === updatedEntry.id);
    if (index !== -1) {
        entries[index] = updatedEntry;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
        return updatedEntry;
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
