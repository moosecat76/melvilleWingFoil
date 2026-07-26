
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
    const scope = 'read,activity:read_all';
    const authUrl = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&approval_prompt=force&scope=${scope}`;
    console.log('[Strava] Initiating auth. client_id:', STRAVA_CLIENT_ID, '| redirect_uri:', REDIRECT_URI);
    window.location.href = authUrl;
};

export const disconnectStrava = async (uid) => {
    console.log('[Strava] Disconnecting, uid:', uid);
    localStorage.removeItem('strava_access_token');
    localStorage.removeItem('strava_refresh_token');
    localStorage.removeItem('strava_expires_at');
    localStorage.removeItem('strava_athlete');
    localStorage.removeItem('strava_scope');
    if (uid) {
        await deleteStravaTokens(uid);
    }
};

/**
 * Exchange the OAuth code for tokens.
 * On Vercel: calls the /api/strava-token serverless function (server-side, secret secure).
 * On localhost: falls back to direct Strava call (dev only).
 */
const exchangeCodeForToken = async (code) => {
    const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    if (!isLocalDev) {
        // Production: use our Vercel serverless function
        console.log('[Strava] Using server-side token exchange via /api/strava-token');
        const apiResponse = await fetch('/api/strava-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
        });
        const data = await apiResponse.json();
        if (!apiResponse.ok) {
            throw new Error(data.error || data.message || `Token exchange failed (${apiResponse.status})`);
        }
        return data;
    }

    // Local dev fallback: call Strava directly
    console.log('[Strava] Using client-side token exchange (local dev)');
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
    if (!response.ok) {
        throw new Error(data.message || `Token exchange failed (${response.status})`);
    }
    return data;
};

export const handleStravaCallback = async (code, uid, explicitScope = '') => {
    if (!code) return null;
    if (isCallbackProcessing) {
        console.log('[Strava] Callback already processing, skipping duplicate');
        return null;
    }
    isCallbackProcessing = true;

    try {
        const grantedScope = explicitScope || '';
        console.log('[Strava] Callback received. Granted scope from URL:', grantedScope);

        if (grantedScope && !grantedScope.includes('activity:read')) {
            console.warn('[Strava] Scope check FAILED - missing activity:read in:', grantedScope);
            throw new Error(
                'Activity permissions were not granted on Strava. Please check the "View data about your activities" box when authorizing.'
            );
        }

        const data = await exchangeCodeForToken(code);
        console.log('[Strava] Token exchange success. has access_token:', !!data.access_token, '| athlete:', data.athlete?.firstname);

        if (!data.access_token) {
            throw new Error(data.message || 'No access token received from Strava');
        }

        // --- IMMEDIATE VERIFICATION ---
        console.log('[Strava] Verifying newly minted token has activity read scope...');
        const verifyResponse = await fetch('https://www.strava.com/api/v3/athlete/activities?per_page=1', {
            headers: { 'Authorization': `Bearer ${data.access_token}` }
        });
        console.log('[Strava] Immediate Activity scope verification status:', verifyResponse.status);

        if (!verifyResponse.ok) {
            const verifyErr = await verifyResponse.json().catch(() => ({}));
            console.error('[Strava] NEW Token FAILED activity scope check:', verifyErr);
            const detailStr = JSON.stringify(verifyErr);
            throw new Error(
                `Your newly generated Strava token is STILL missing activity read permission (${verifyResponse.status}). ` +
                `Strava response: ${detailStr}. Please check your Strava App configuration.`
            );
        }
        // ------------------------------

        const effectiveScope = grantedScope || 'activity:read_all';
        saveTokenLocal(data, effectiveScope);

        if (uid) {
            await saveStravaTokens(uid, {
                access_token: data.access_token,
                refresh_token: data.refresh_token,
                expires_at: new Date().getTime() + (data.expires_in * 1000),
                athlete: data.athlete,
                scope: effectiveScope,
            });
        }

        return data.athlete;
    } catch (error) {
        console.error('[Strava] Error handling callback:', error.message);
        throw error;
    } finally {
        isCallbackProcessing = false;
    }
};

const saveTokenLocal = (tokenData, scope = '') => {
    const expiresAt = new Date().getTime() + (tokenData.expires_in * 1000);
    localStorage.setItem('strava_access_token', tokenData.access_token);
    localStorage.setItem('strava_refresh_token', tokenData.refresh_token);
    localStorage.setItem('strava_expires_at', String(expiresAt));
    localStorage.setItem('strava_scope', scope);
    if (tokenData.athlete) {
        localStorage.setItem('strava_athlete', JSON.stringify(tokenData.athlete));
    }
};

export const getStravaToken = async (uid) => {
    if (uid) {
        try {
            const tokens = await getStravaTokens(uid);
            if (tokens && tokens.access_token) {
                const nowMs = new Date().getTime();
                const expiresAt = Number(tokens.expires_at) || 0;
                console.log('[Strava] Firestore token. Expires:', new Date(expiresAt).toISOString(), '| scope:', tokens.scope);
                if (nowMs > expiresAt) {
                    console.log('[Strava] Token expired, refreshing...');
                    const newToken = await refreshToken(uid, tokens.refresh_token);
                    if (newToken) return newToken;
                } else {
                    return tokens.access_token;
                }
            } else {
                console.log('[Strava] No token in Firestore for uid:', uid);
            }
        } catch (e) {
            console.warn('[Strava] Error reading Firestore tokens, falling back to localStorage:', e);
        }
    }

    const storedToken = localStorage.getItem('strava_access_token');
    const storedRefresh = localStorage.getItem('strava_refresh_token');
    const expiresAt = localStorage.getItem('strava_expires_at');
    const storedScope = localStorage.getItem('strava_scope') || '';
    console.log('[Strava] localStorage fallback. token present:', !!storedToken, '| scope:', storedScope);

    if (storedRefresh && expiresAt && new Date().getTime() > Number(expiresAt)) {
        console.log('[Strava] localStorage token expired, refreshing...');
        return await refreshToken(uid, storedRefresh);
    }
    return storedToken || null;
};

const refreshToken = async (uid, refreshTokenValue) => {
    if (!refreshTokenValue) return null;
    console.log('[Strava] Refreshing token...');

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
        console.log('[Strava] Refresh status:', response.status);
        if (response.ok && data.access_token) {
            const existingScope = localStorage.getItem('strava_scope') || '';
            saveTokenLocal(data, existingScope);
            if (uid) {
                await saveStravaTokens(uid, {
                    access_token: data.access_token,
                    refresh_token: data.refresh_token,
                    expires_at: new Date().getTime() + (data.expires_in * 1000),
                });
            }
            return data.access_token;
        } else {
            console.error('[Strava] Refresh failed:', data);
        }
    } catch (e) {
        console.error('[Strava] Failed to refresh token:', e);
    }
    return null;
};

export const getActivities = async (uid) => {
    const token = await getStravaToken(uid);
    if (!token) {
        console.log('[Strava] getActivities: no token available');
        return [];
    }

    console.log('[Strava] Fetching activities, token prefix:', token.substring(0, 8) + '...');
    try {
        const response = await fetch('https://www.strava.com/api/v3/athlete/activities?per_page=10', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        console.log('[Strava] Activities response status:', response.status);

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            console.error('[Strava] Activities API error:', response.status, JSON.stringify(errData));

            if (response.status === 401) {
                await disconnectStrava(uid);
                throw new Error('Strava session expired. Please reconnect Strava.');
            }
            if (response.status === 403) {
                throw new Error(
                    'Strava permission error: this app does not have activity read access. ' +
                    'Please click "Reconnect / Re-authorize" to re-grant permissions.'
                );
            }
            throw new Error(errData.message || `Strava API error (${response.status})`);
        }

        const data = await response.json();
        console.log('[Strava] Activities fetched:', Array.isArray(data) ? data.length : 'not array');
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
            const errData = await response.json().catch(() => ({}));
            console.error('[Strava] Streams API error:', response.status, errData);
            if (response.status === 401) {
                await disconnectStrava(uid);
                throw new Error('Strava session expired. Please reconnect Strava.');
            }
            if (response.status === 403) {
                throw new Error('Strava permission error fetching activity details. Please reconnect with activity permissions.');
            }
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
            console.warn('[Strava] Could not load user from Firestore:', e);
        }
    }
    const stored = localStorage.getItem('strava_athlete');
    if (!stored || stored === 'undefined') return null;
    try {
        return JSON.parse(stored);
    } catch (e) {
        console.error('[Strava] Failed to parse strava athlete from localStorage:', e);
        return null;
    }
};
