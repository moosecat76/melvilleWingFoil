
import { getStravaTokens, saveStravaTokens, deleteStravaTokens } from './dbService';

const STRAVA_CLIENT_ID = import.meta.env.VITE_STRAVA_CLIENT_ID || '';
const STRAVA_CLIENT_SECRET = import.meta.env.VITE_STRAVA_CLIENT_SECRET || '';
const REDIRECT_URI = window.location.origin;

let isCallbackProcessing = false;

export const initiateStravaAuth = () => {
    if (!STRAVA_CLIENT_ID) {
        alert('Please configure VITE_STRAVA_CLIENT_ID in your .env file.');
        return;
    }
    const scope = 'activity:read_all,activity:read,read';
    const authUrl = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&approval_prompt=force&scope=${scope}`;
    window.location.href = authUrl;
};

export const disconnectStrava = async (uid) => {
    localStorage.removeItem('strava_access_token');
    localStorage.removeItem('strava_refresh_token');
    localStorage.removeItem('strava_expires_at');
    localStorage.removeItem('strava_athlete');
    if (uid) {
        await deleteStravaTokens(uid);
    }
};

export const handleStravaCallback = async (code, uid, explicitScope = '') => {
    if (!code) return null;
    if (isCallbackProcessing) return null;
    isCallbackProcessing = true;

    try {
        const params = new URLSearchParams(window.location.search);
        const grantedScope = explicitScope || params.get('scope') || '';
        if (grantedScope && !grantedScope.includes('activity:read')) {
            await disconnectStrava(uid);
            throw new Error('Activity permissions were not granted on Strava. On the Strava authorization screen, please check the box for "View data about your activities".');
        }

        const response = await fetch('https://www.strava.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: STRAVA_CLIENT_ID,
                client_secret: STRAVA_CLIENT_SECRET,
                code: code,
                grant_type: 'authorization_code'
            })
        });
        const data = await response.json();

        if (response.ok && data.access_token) {
            // Save to localStorage as immediate fallback
            saveTokenLocal(data);

            if (uid) {
                // Save to Firestore for logged-in users
                await saveStravaTokens(uid, {
                    access_token: data.access_token,
                    refresh_token: data.refresh_token,
                    expires_at: new Date().getTime() + (data.expires_in * 1000),
                    athlete: data.athlete,
                });
            }
            return data.athlete;
        } else {
            const msg = data.message || 'Failed to exchange token';
            throw new Error(msg);
        }
    } catch (error) {
        console.error('Error handling Strava callback:', error);
        throw error;
    } finally {
        isCallbackProcessing = false;
    }
};

const saveTokenLocal = (tokenData) => {
    const expiresAt = new Date().getTime() + (tokenData.expires_in * 1000);
    localStorage.setItem('strava_access_token', tokenData.access_token);
    localStorage.setItem('strava_refresh_token', tokenData.refresh_token);
    localStorage.setItem('strava_expires_at', expiresAt);
    if (tokenData.athlete) {
        localStorage.setItem('strava_athlete', JSON.stringify(tokenData.athlete));
    }
};

export const getStravaToken = async (uid) => {
    // 1. Try Firestore if user is authenticated
    if (uid) {
        try {
            const tokens = await getStravaTokens(uid);
            if (tokens && tokens.access_token) {
                if (new Date().getTime() > (tokens.expires_at || 0)) {
                    const newToken = await refreshToken(uid, tokens.refresh_token);
                    if (newToken) return newToken;
                } else {
                    return tokens.access_token;
                }
            }
        } catch (e) {
            console.warn('Error reading Strava tokens from Firestore, falling back to localStorage:', e);
        }
    }

    // 2. Fallback to localStorage
    const storedToken = localStorage.getItem('strava_access_token');
    const storedRefresh = localStorage.getItem('strava_refresh_token');
    const expiresAt = localStorage.getItem('strava_expires_at');

    if (storedRefresh && expiresAt && new Date().getTime() > Number(expiresAt)) {
        return await refreshToken(uid, storedRefresh);
    }
    return storedToken || null;
};

const refreshToken = async (uid, refreshTokenValue) => {
    if (!refreshTokenValue) return null;

    try {
        const response = await fetch('https://www.strava.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: STRAVA_CLIENT_ID,
                client_secret: STRAVA_CLIENT_SECRET,
                refresh_token: refreshTokenValue,
                grant_type: 'refresh_token'
            })
        });
        const data = await response.json();
        if (response.ok && data.access_token) {
            saveTokenLocal(data);
            if (uid) {
                await saveStravaTokens(uid, {
                    access_token: data.access_token,
                    refresh_token: data.refresh_token,
                    expires_at: new Date().getTime() + (data.expires_in * 1000),
                });
            }
            return data.access_token;
        } else {
            console.error('Strava token refresh failed:', data);
        }
    } catch (e) {
        console.error('Failed to refresh Strava token:', e);
    }
    return null;
};

export const getActivities = async (uid) => {
    const token = await getStravaToken(uid);
    if (!token) return [];

    try {
        const response = await fetch('https://www.strava.com/api/v3/athlete/activities?per_page=10', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                await disconnectStrava(uid);
                if (response.status === 403) {
                    throw new Error('Strava permission error (Forbidden). Missing activity read scope. Please reconnect Strava.');
                }
                throw new Error('Strava connection expired. Please reconnect Strava.');
            }
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.message || `Strava API error (${response.status})`);
        }

        const data = await response.json();
        return Array.isArray(data) ? data : [];
    } catch (e) {
        if (e.name === 'TypeError' && e.message.includes('fetch')) {
            throw new Error('Network error connecting to Strava. Please check your internet connection.');
        }
        throw e;
    }
};

export const getActivityStreams = async (activityId, uid) => {
    const token = await getStravaToken(uid);
    if (!token) return null;

    try {
        const keys = 'time,latlng,distance,altitude,velocity_smooth,grade_smooth';
        const response = await fetch(`https://www.strava.com/api/v3/activities/${activityId}/streams?keys=${keys}&key_by_type=false`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                await disconnectStrava(uid);
                throw new Error('Strava connection expired or unauthorized. Please reconnect Strava.');
            }
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.message || `Strava Stream API error (${response.status})`);
        }

        return await response.json();
    } catch (e) {
        if (e.name === 'TypeError' && e.message.includes('fetch')) {
            throw new Error('Network error connecting to Strava.');
        }
        throw e;
    }
};

export const getStravaUser = async (uid) => {
    if (uid) {
        try {
            const tokens = await getStravaTokens(uid);
            if (tokens?.athlete) return tokens.athlete;
        } catch (e) {
            console.warn('Could not load user from Firestore:', e);
        }
    }
    // Fallback to localStorage
    const stored = localStorage.getItem('strava_athlete');
    if (!stored || stored === 'undefined') return null;
    try {
        return JSON.parse(stored);
    } catch (e) {
        console.error('Failed to parse strava user:', e);
        return null;
    }
};
