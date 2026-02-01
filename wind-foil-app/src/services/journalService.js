const STORAGE_KEY = 'wind_foil_journal_entries';

export const getJournalEntries = () => {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
};

export const addJournalEntry = (entry) => {
    const entries = getJournalEntries();
    const newEntry = {
        id: Date.now().toString(),
        date: new Date().toISOString(),
        ...entry
    };
    const updatedEntries = [newEntry, ...entries];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedEntries));
    return newEntry;
};

export const deleteJournalEntry = (id) => {
    const entries = getJournalEntries();
    const updatedEntries = entries.filter(e => e.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedEntries));
};

export const updateJournalEntry = (updatedEntry) => {
    const entries = getJournalEntries();
    const index = entries.findIndex(e => e.id === updatedEntry.id);
    if (index !== -1) {
        entries[index] = updatedEntry;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
        return updatedEntry;
    }
    return null;
};

export const getEntriesForLocation = (locationId) => {
    const entries = getJournalEntries();
    return entries.filter(e => e.locationId === locationId);
};
