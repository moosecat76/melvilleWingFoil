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

// ─── Journal Entries ────────────────────────────────
const journalCol = (uid) => collection(db, 'users', uid, 'journal_entries');

export const getJournalEntries = async (uid) => {
    const snap = await getDocs(query(journalCol(uid), orderBy('date', 'desc')));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

export const addJournalEntry = async (uid, entry) => {
    const newEntry = {
        date: new Date().toISOString(),
        ...entry,
        createdAt: serverTimestamp(),
    };
    const ref = await addDoc(journalCol(uid), newEntry);
    return { id: ref.id, ...newEntry };
};

export const updateJournalEntry = async (uid, entryId, data) => {
    const ref = doc(db, 'users', uid, 'journal_entries', entryId);
    await updateDoc(ref, { ...data, updatedAt: serverTimestamp() });
    return { id: entryId, ...data };
};

export const deleteJournalEntry = async (uid, entryId) => {
    await deleteDoc(doc(db, 'users', uid, 'journal_entries', entryId));
};

export const getEntriesForLocation = async (uid, locationId) => {
    const snap = await getDocs(
        query(journalCol(uid), where('locationId', '==', locationId))
    );
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
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

// ─── Strava Tokens (per-user) ───────────────────────
const stravaDoc = (uid) => doc(db, 'users', uid, 'strava', 'tokens');

export const getStravaTokens = async (uid) => {
    const snap = await getDoc(stravaDoc(uid));
    return snap.exists() ? snap.data() : null;
};

export const saveStravaTokens = async (uid, tokenData) => {
    await setDoc(stravaDoc(uid), { ...tokenData, updatedAt: serverTimestamp() });
};

// ─── Migration helper ───────────────────────────────
/**
 * One-time migration: move localStorage data into Firestore.
 * Call this right after a user logs in for the first time.
 */
export const migrateLocalStorageToFirestore = async (uid) => {
    // Journal entries
    const localJournal = localStorage.getItem('wind_foil_journal_entries');
    if (localJournal) {
        const existing = await getJournalEntries(uid);
        if (existing.length === 0) {
            const entries = JSON.parse(localJournal);
            for (const entry of entries) {
                const { id, ...rest } = entry;
                await addDoc(journalCol(uid), rest);
            }
            console.log(`Migrated ${entries.length} journal entries to Firestore`);
        }
    }

    // Gear
    const localGear = localStorage.getItem('melvill_user_gear');
    if (localGear) {
        const cloudGear = await getUserGear(uid);
        if (cloudGear.length === 0) {
            await saveUserGear(uid, JSON.parse(localGear));
            console.log('Migrated gear to Firestore');
        }
    }

    // Locations
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

    // Strava tokens
    const stravaAccess = localStorage.getItem('strava_access_token');
    if (stravaAccess) {
        const cloudStrava = await getStravaTokens(uid);
        if (!cloudStrava) {
            await saveStravaTokens(uid, {
                access_token: stravaAccess,
                refresh_token: localStorage.getItem('strava_refresh_token'),
                expires_at: localStorage.getItem('strava_expires_at'),
                athlete: JSON.parse(localStorage.getItem('strava_athlete') || 'null'),
            });
            console.log('Migrated Strava tokens to Firestore');
        }
    }
};
