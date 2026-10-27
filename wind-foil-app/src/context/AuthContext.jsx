import React, { createContext, useState, useEffect, useContext } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { migrateLocalStorageToFirestore } from '../services/dbService';
import { auth, googleProvider } from '../services/firebaseSetup';

const AuthContext = createContext();

/**
 * Checks whether a signed-in Firebase user is permitted when single-user allowlist
 * variables (VITE_ALLOWED_USER_EMAIL or VITE_ALLOWED_USER_UID) are configured.
 */
const isAuthorizedUser = (currentUser) => {
    if (!currentUser) return false;

    const allowedUidsRaw = import.meta.env.VITE_ALLOWED_USER_UID;
    if (allowedUidsRaw && String(allowedUidsRaw).trim()) {
        const allowedUids = String(allowedUidsRaw).split(',').map(s => s.trim()).filter(Boolean);
        if (allowedUids.length > 0 && !allowedUids.includes(currentUser.uid)) {
            return false;
        }
    }

    const allowedEmailsRaw = import.meta.env.VITE_ALLOWED_USER_EMAIL;
    if (allowedEmailsRaw && String(allowedEmailsRaw).trim()) {
        const allowedEmails = String(allowedEmailsRaw).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        const userEmail = (currentUser.email || '').toLowerCase();
        if (allowedEmails.length > 0 && !allowedEmails.includes(userEmail)) {
            return false;
        }
    }

    return true;
};

const clearSensitiveLocalTokens = () => {
    const keysToRemove = [
        'ghealth_access_token',
        'ghealth_refresh_token',
        'ghealth_expires_at',
        'ghealth_email',
        'gfit_access_token',
        'gfit_refresh_token',
        'gfit_expires_at',
        'gfit_email',
        'strava_access_token',
        'strava_refresh_token',
        'strava_expires_at',
        'strava_athlete',
        'strava_scope',
        'melvill_gemini_api_key',
    ];
    for (const k of keysToRemove) {
        try {
            localStorage.removeItem(k);
        } catch (_) { /* ignore */ }
    }
};

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            if (currentUser) {
                if (!isAuthorizedUser(currentUser)) {
                    console.warn('[Auth] Unauthorized account blocked:', currentUser.email);
                    clearSensitiveLocalTokens();
                    await signOut(auth).catch(() => {});
                    setUser(null);
                    setLoading(false);
                    return;
                }
                try {
                    await migrateLocalStorageToFirestore(currentUser.uid);
                } catch (error) {
                    console.error('Migration failed:', error);
                }
            }
            setUser(currentUser);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    const login = async () => {
        setLoading(true);
        try {
            const cred = await signInWithPopup(auth, googleProvider);
            if (cred?.user && !isAuthorizedUser(cred.user)) {
                await signOut(auth);
                alert('Access restricted: this application is private.');
            }
        } catch (error) {
            console.error('Google sign-in failed:', error);
            setLoading(false);
        }
    };

    const logout = async () => {
        try {
            clearSensitiveLocalTokens();
            await signOut(auth);
        } catch (error) {
            console.error('Sign out failed:', error);
        }
    };

    return (
        <AuthContext.Provider value={{ user, loading, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
