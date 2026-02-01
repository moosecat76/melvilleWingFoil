
const STRAVA_CLIENT_ID = import.meta.env.VITE_STRAVA_CLIENT_ID || '';
const STRAVA_CLIENT_SECRET = import.meta.env.VITE_STRAVA_CLIENT_SECRET || ''; // WARN: Storing secret in client side code is risky for public apps
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

export const handleStravaCallback = async (code) => {
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
            saveToken(data);
            return data.athlete;
        } else {
            throw new Error('Failed to exchange token');
        }
    } catch (error) {
        console.error('Error handling Strava callback:', error);
        throw error;
    }
};

const saveToken = (tokenData) => {
    const expiresAt = new Date().getTime() + (tokenData.expires_in * 1000);
    localStorage.setItem('strava_access_token', tokenData.access_token);
    localStorage.setItem('strava_refresh_token', tokenData.refresh_token);
    localStorage.setItem('strava_expires_at', expiresAt);
    localStorage.setItem('strava_athlete', JSON.stringify(tokenData.athlete));
};

export const getStravaToken = async () => {
    const expiresAt = localStorage.getItem('strava_expires_at');
    if (expiresAt && new Date().getTime() > expiresAt) {
        return await refreshToken();
    }
    return localStorage.getItem('strava_access_token');
};

const refreshToken = async () => {
    const refresh = localStorage.getItem('strava_refresh_token');
    if (!refresh) return null;

    try {
        const response = await fetch('https://www.strava.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: STRAVA_CLIENT_ID,
                client_secret: STRAVA_CLIENT_SECRET,
                refresh_token: refresh,
                grant_type: 'refresh_token'
            })
        });
        const data = await response.json();
        if (data.access_token) {
            saveToken(data);
            return data.access_token;
        }
    } catch (e) {
        console.error('Failed to refresh token', e);
    }
    return null;
};

export const getActivities = async () => {
    const token = await getStravaToken();
    if (!token) return [];

    const response = await fetch('https://www.strava.com/api/v3/athlete/activities?per_page=10', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    return await response.json();
};

export const getStravaUser = () => {
    const stored = localStorage.getItem('strava_athlete');
    return stored ? JSON.parse(stored) : null;
};
