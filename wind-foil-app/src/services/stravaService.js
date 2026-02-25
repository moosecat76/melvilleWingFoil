
import { getStravaTokens, saveStravaTokens } from './dbService';

const STRAVA_CLIENT_ID = import.meta.env.VITE_STRAVA_CLIENT_ID || '';
const STRAVA_CLIENT_SECRET = import.meta.env.VITE_STRAVA_CLIENT_SECRET || '';
const REDIRECT_URI = window.location.origin;

export const initiateStravaAuth = () => {
    if (!STRAVA_CLIENT_ID) {
        alert('Please configure VITE_STRAVA_CLIENT_ID in your .env file.');
        return;
    }
    const scope = 'read,activity:read_all';
    const authUrl = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&response_type=code&redirect_uri=${REDIRECT_URI}&approval_prompt=force&scope=${scope}`;
    window.location.href = authUrl;
};

export const handleStravaCallback = async (code, uid) => {
    try {
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
        if (data.access_token) {
            if (uid) {
                // Save to Firestore for logged-in users
                await saveStravaTokens(uid, {
                    access_token: data.access_token,
                    refresh_token: data.refresh_token,
                    expires_at: new Date().getTime() + (data.expires_in * 1000),
                    athlete: data.athlete,
                });
            } else {
                // Fallback to localStorage for non-logged-in users
                saveTokenLocal(data);
            }
            return data.athlete;
        } else {
            throw new Error('Failed to exchange token');
        }
    } catch (error) {
        console.error('Error handling Strava callback:', error);
        throw error;
    }
};

const saveTokenLocal = (tokenData) => {
    const expiresAt = new Date().getTime() + (tokenData.expires_in * 1000);
    localStorage.setItem('strava_access_token', tokenData.access_token);
    localStorage.setItem('strava_refresh_token', tokenData.refresh_token);
    localStorage.setItem('strava_expires_at', expiresAt);
    localStorage.setItem('strava_athlete', JSON.stringify(tokenData.athlete));
};

export const getStravaToken = async (uid) => {
    if (uid) {
        const tokens = await getStravaTokens(uid);
        if (!tokens) return null;
        if (new Date().getTime() > tokens.expires_at) {
            return await refreshToken(uid, tokens.refresh_token);
        }
        return tokens.access_token;
    }
    // Fallback to localStorage
    const expiresAt = localStorage.getItem('strava_expires_at');
    if (expiresAt && new Date().getTime() > expiresAt) {
        return await refreshToken(null, localStorage.getItem('strava_refresh_token'));
    }
    return localStorage.getItem('strava_access_token');
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
        if (data.access_token) {
            if (uid) {
                await saveStravaTokens(uid, {
                    access_token: data.access_token,
                    refresh_token: data.refresh_token,
                    expires_at: new Date().getTime() + (data.expires_in * 1000),
                });
            } else {
                saveTokenLocal(data);
            }
            return data.access_token;
        }
    } catch (e) {
        console.error('Failed to refresh token', e);
    }
    return null;
};

export const getActivities = async (uid) => {
    const token = await getStravaToken(uid);
    if (!token) return [];

    const response = await fetch('https://www.strava.com/api/v3/athlete/activities?per_page=10', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    return await response.json();
};

export const getActivityStreams = async (activityId, uid) => {
    const token = await getStravaToken(uid);
    if (!token) return null;

    const keys = 'time,latlng,distance,altitude,velocity_smooth,grade_smooth';
    const response = await fetch(`https://www.strava.com/api/v3/activities/${activityId}/streams?keys=${keys}&key_by_type=false`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    return await response.json();
};

export const getStravaUser = async (uid) => {
    if (uid) {
        const tokens = await getStravaTokens(uid);
        return tokens?.athlete || null;
    }
    // Fallback
    const stored = localStorage.getItem('strava_athlete');
    if (!stored || stored === 'undefined') return null;
    try {
        return JSON.parse(stored);
    } catch (e) {
        console.error('Failed to parse strava user:', e);
        return null;
    }
};
