/**
 * googleFitService.js — Phase 1: OAuth / Authentication only
 *
 * Provides:
 *   - initiateGoogleFitAuth()      Redirect to Google consent screen
 *   - handleGoogleFitCallback()    Exchange auth code for tokens, persist to Firestore
 *   - getGoogleFitAccessToken()    Return a valid access token (auto-refreshes if expired)
 *   - getGoogleFitUser()           Return stored token metadata (null = not connected)
 *   - disconnectGoogleFit()        Clear tokens from localStorage + Firestore
 *
 * Phase 2 (data fetching) will be built on top of getGoogleFitAccessToken().
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * REQUIRED SCOPES — request all four to support all telemetry in Phase 2:
 *
 *   fitness.activity.read   → Session list, activity type, duration
 *   fitness.location.read   → GPS coordinates, elevation (high-frequency)
 *   fitness.body.read       → Body metrics (optional but harmless)
 *   fitness.heart_rate.read → BPM time-series
 *
 * Google will show all four on the consent screen in plain English.
 * ──────────────────────────────────────────────────────────────────────────────
 */

// ── Constants ─────────────────────────────────────────────────────────────────
const CLIENT_ID         = import.meta.env.VITE_GOOGLE_FIT_CLIENT_ID;
// Only used on localhost — Vite can't run serverless functions, so we call Google directly.
// On Vercel the serverless function handles the exchange and this is never read.
const CLIENT_SECRET_DEV = import.meta.env.VITE_GOOGLE_FIT_CLIENT_SECRET;

const IS_LOCAL_DEV = typeof window !== 'undefined' && window.location.hostname === 'localhost';

const SCOPES = [
    'https://www.googleapis.com/auth/fitness.activity.read',
    'https://www.googleapis.com/auth/fitness.location.read',
    'https://www.googleapis.com/auth/fitness.body.read',
    'https://www.googleapis.com/auth/fitness.heart_rate.read',
].join(' ');

const OAUTH_ENDPOINT    = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL  = 'https://oauth2.googleapis.com/token';
const TOKEN_API         = '/api/google-fit-token';   // Vercel serverless (production only)

// localStorage keys
const LS_ACCESS_TOKEN   = 'gfit_access_token';
const LS_REFRESH_TOKEN  = 'gfit_refresh_token';
const LS_EXPIRES_AT     = 'gfit_expires_at';

// ── Internal: unified token exchange (local dev vs production) ────────────────
/**
 * On localhost: calls Google directly (VITE_GOOGLE_FIT_CLIENT_SECRET available in bundle).
 * On Vercel:   calls /api/google-fit-token (client secret stays server-side).
 */
const _exchangeToken = async (body) => {
    if (IS_LOCAL_DEV) {
        // Direct call to Google — only possible on localhost where exposing the
        // VITE_GOOGLE_FIT_CLIENT_SECRET in the bundle is acceptable for dev.
        if (!CLIENT_SECRET_DEV) {
            throw new Error('Add VITE_GOOGLE_FIT_CLIENT_SECRET to your .env file for local dev.');
        }
        const response = await fetch(GOOGLE_TOKEN_URL, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ ...body, client_id: CLIENT_ID, client_secret: CLIENT_SECRET_DEV }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error_description || data.error || 'Token exchange failed');
        return data;
    } else {
        // Production: route through the Vercel serverless function
        const response = await fetch(TOKEN_API, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(body),
        });
        const text = await response.text();
        let data;
        try { data = JSON.parse(text); }
        catch { throw new Error('Token exchange: unexpected server response — ' + text.slice(0, 120)); }
        if (!response.ok) throw new Error(data.error_description || data.error || 'Token exchange failed');
        return data;
    }
};

// ── Step 1 — Redirect to Google consent screen ───────────────────────────────
export const initiateGoogleFitAuth = () => {
    if (!CLIENT_ID) {
        alert('Google Fit Client ID is not configured. Add VITE_GOOGLE_FIT_CLIENT_ID to your .env file.');
        return;
    }

    const redirectUri = window.location.origin;   // Registered in Google Cloud Console

    const params = new URLSearchParams({
        client_id:     CLIENT_ID,
        redirect_uri:  redirectUri,
        response_type: 'code',
        scope:         SCOPES,
        access_type:   'offline',    // Ensures we receive a refresh_token
        prompt:        'consent',    // Force consent to always receive a fresh refresh_token
        state:         'googlefit',  // Distinguish from any other OAuth callback
    });

    window.location.href = `${OAUTH_ENDPOINT}?${params}`;
};

// ── Step 2 — Handle the redirect-back callback ────────────────────────────────
/**
 * Call this on app load if you detect ?state=googlefit&code=... in the URL.
 *
 * @param {string} code  — The authorization code from the URL parameter
 * @param {string} [uid] — Firebase UID (optional; persists tokens to Firestore if provided)
 * @returns {Promise<{ email: string }>} Basic profile info on success
 */
export const handleGoogleFitCallback = async (code, uid) => {
    const redirectUri = window.location.origin;

    // _exchangeToken automatically uses the right path (local dev vs Vercel)
    const data = await _exchangeToken({
        grant_type:   'authorization_code',
        code,
        redirect_uri: redirectUri,
    });

    // data = { access_token, refresh_token, expires_in, token_type, scope }
    _saveTokensLocally(data);

    // Persist to Firestore so the token survives browser sessions
    if (uid) {
        const { saveGoogleFitTokens } = await import('./dbService');
        await saveGoogleFitTokens(uid, {
            access_token:  data.access_token,
            refresh_token: data.refresh_token,
            expires_at:    Date.now() + data.expires_in * 1000,
        });
    }

    // Fetch the user's email to confirm success
    const profile = await _fetchGoogleProfile(data.access_token);
    return profile;
};

// ── Step 3 — Get a valid access token (auto-refresh if needed) ────────────────
/**
 * Use this in every data-fetching call (Phase 2).
 *
 * @param {string} [uid] — Firebase UID (loads tokens from Firestore if localStorage is empty)
 * @returns {Promise<string>} A valid access token
 */
export const getGoogleFitAccessToken = async (uid) => {
    let accessToken  = localStorage.getItem(LS_ACCESS_TOKEN);
    let refreshToken = localStorage.getItem(LS_REFRESH_TOKEN);
    let expiresAt    = parseInt(localStorage.getItem(LS_EXPIRES_AT) || '0', 10);

    // If nothing in localStorage, try Firestore
    if (!accessToken && uid) {
        const { getGoogleFitTokens } = await import('./dbService');
        const stored = await getGoogleFitTokens(uid);
        if (stored) {
            accessToken  = stored.access_token;
            refreshToken = stored.refresh_token;
            expiresAt    = stored.expires_at;
            _saveTokensLocally({ access_token: accessToken, refresh_token: refreshToken, expires_in: Math.max(0, (expiresAt - Date.now()) / 1000) });
        }
    }

    if (!accessToken) throw new Error('Google Fit is not connected. Please authorise via Settings.');

    // Refresh if expired (with 60s buffer)
    if (Date.now() >= expiresAt - 60_000) {
        if (!refreshToken) throw new Error('No refresh token. Please re-authorise Google Fit.');

        const data = await _exchangeToken({ grant_type: 'refresh_token', refresh_token: refreshToken });

        _saveTokensLocally(data);
        if (uid) {
            const { saveGoogleFitTokens } = await import('./dbService');
            await saveGoogleFitTokens(uid, {
                access_token: data.access_token,
                refresh_token: refreshToken,            // refresh_token is not reissued on refresh
                expires_at: Date.now() + data.expires_in * 1000,
            });
        }

        return data.access_token;
    }

    return accessToken;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns the stored Google profile (email) if connected, otherwise null.
 * Used to check connection status without making a network call.
 */
export const getGoogleFitUser = (uid) => {
    const token = localStorage.getItem(LS_ACCESS_TOKEN);
    if (token) {
        const email = localStorage.getItem('gfit_email');
        return email ? { email } : { email: 'Connected' };
    }
    // Fall through to Firestore check if needed (async version in the component)
    return null;
};

/**
 * Async version — checks Firestore too (for page refreshes / multi-device).
 */
export const getGoogleFitUserAsync = async (uid) => {
    // Fast path: localStorage
    const token = localStorage.getItem(LS_ACCESS_TOKEN);
    if (token) {
        const email = localStorage.getItem('gfit_email');
        return { email: email || 'Connected' };
    }
    // Slow path: Firestore
    if (uid) {
        const { getGoogleFitTokens } = await import('./dbService');
        const stored = await getGoogleFitTokens(uid);
        if (stored?.access_token) {
            return { email: stored.email || 'Connected' };
        }
    }
    return null;
};

/**
 * Disconnect: clears tokens from localStorage and Firestore.
 */
export const disconnectGoogleFit = async (uid) => {
    localStorage.removeItem(LS_ACCESS_TOKEN);
    localStorage.removeItem(LS_REFRESH_TOKEN);
    localStorage.removeItem(LS_EXPIRES_AT);
    localStorage.removeItem('gfit_email');

    if (uid) {
        const { deleteGoogleFitTokens } = await import('./dbService');
        await deleteGoogleFitTokens(uid);
    }
};

// ── Private helpers ───────────────────────────────────────────────────────────
const _saveTokensLocally = ({ access_token, refresh_token, expires_in }) => {
    if (access_token)  localStorage.setItem(LS_ACCESS_TOKEN,  access_token);
    if (refresh_token) localStorage.setItem(LS_REFRESH_TOKEN, refresh_token);
    if (expires_in)    localStorage.setItem(LS_EXPIRES_AT, String(Date.now() + expires_in * 1000));
};

const _fetchGoogleProfile = async (accessToken) => {
    try {
        const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        const p = await r.json();
        if (p.email) localStorage.setItem('gfit_email', p.email);
        return p;
    } catch {
        return { email: 'Connected' };
    }
};

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 2 — Session listing and telemetry fetching
// ══════════════════════════════════════════════════════════════════════════════

// ── Activity type labels (Google Fitness API integer codes) ───────────────────
const ACTIVITY_LABELS = {
    1: 'Aerobics', 3: 'Badminton', 4: 'Baseball', 5: 'Basketball',
    7: 'Hand biking', 8: 'Mountain biking', 9: 'Road biking',
    10: 'Spinning', 11: 'Stationary biking', 12: 'Utility biking',
    13: 'Boxing', 14: 'Calisthenics', 15: 'Circuit training',
    16: 'Cricket', 20: 'Curling', 21: 'Cycling', 22: 'Dancing',
    28: 'Football (American)', 29: 'Football (Australian)', 30: 'Football (Soccer)',
    32: 'Frisbee', 34: 'Gardening', 35: 'Golf', 36: 'Gymnastics',
    37: 'Handball', 38: 'Hiking', 39: 'Hockey', 40: 'Horseback riding',
    41: 'Housework', 42: 'Ice skating', 43: 'Jumping rope',
    44: 'Kayaking', 45: 'Kettlebell training', 46: 'Kickboxing',
    48: 'Kitesurfing', 50: 'Martial arts', 52: 'Meditation',
    54: 'Mixed martial arts', 55: 'P90X exercises', 56: 'Paragliding',
    57: 'Pilates', 59: 'Polo', 60: 'Racquetball', 61: 'Rock climbing',
    62: 'Rowing', 63: 'Rowing machine', 64: 'Rugby',
    65: 'Jogging', 66: 'Running', 67: 'Treadmill', 68: 'Sailing',
    69: 'Scuba diving', 70: 'Skateboarding', 71: 'Skating',
    72: 'Cross skating', 73: 'Indoor skating', 74: 'Skiing',
    75: 'Cross-country skiing', 77: 'Snowboarding', 78: 'Snowmobile',
    79: 'Snowshoeing', 80: 'Squash', 81: 'Stair climbing',
    82: 'Stand-up paddleboarding', 83: 'Strength training',
    84: 'Surfing', 85: 'Swimming', 87: 'Table tennis',
    88: 'Team sports', 89: 'Tennis', 90: 'Treadmill',
    91: 'Volleyball', 92: 'Volleyball (beach)', 93: 'Volleyball (indoor)',
    94: 'Wakeboarding', 95: 'Walking', 96: 'Walking (fitness)',
    97: 'Windsurfing', 98: 'Yoga', 99: 'Zumba', 100: 'Diving',
    108: 'Wheelchair', 109: 'Paragliding', 110: 'Flossing',
    111: 'Elevator', 112: 'Escalator', 113: 'Archery',
    114: 'Softball', 115: 'Guided breathing', 116: 'Cardio training',
    117: 'Lacrosse', 118: 'Mountain biking (downhill)', 119: 'Gymnastics',
    120: 'Orienteering', 1001: 'Other workout',
};

// Biking-type activity codes — the Pixel Watch "Outdoor Bike" profile uses one of these
const BIKING_ACTIVITY_TYPES = new Set([7, 8, 9, 10, 11, 12, 21]);

/**
 * Returns a display name for the activity type.
 * If it looks like a biking session (common for Wing Foil on Pixel Watch),
 * it returns 'Wing Foiling 🪁' instead.
 *
 * @param {number} activityType  - Google Fit integer activity type
 * @param {string} [sessionName] - Raw session name from the API
 * @returns {string}
 */
export const relabelActivityType = (activityType, sessionName = '') => {
    if (BIKING_ACTIVITY_TYPES.has(activityType)) {
        return 'Wing Foiling 🪁';   // Auto-relabel biking sessions
    }
    return ACTIVITY_LABELS[activityType] ?? sessionName ?? 'Workout';
};

// ── Fitness API base URL ──────────────────────────────────────────────────────
const FIT_BASE = 'https://www.googleapis.com/fitness/v1/users/me';

// Merged data sources — these are stable across Android devices and watches
const DATA_SOURCES = {
    location:  'derived:com.google.location.sample:com.google.android.gms:merge_location_samples',
    speed:     'derived:com.google.speed:com.google.android.gms:merge_speed_summary',
    altitude:  'derived:com.google.altitude:com.google.android.gms:merge_altitude',
    heartRate: 'derived:com.google.heart_rate.bpm:com.google.android.gms:merge_heart_rate_bpm',
};

// ── Session listing ───────────────────────────────────────────────────────────
/**
 * Returns a list of recent workout sessions from the Fitness API.
 *
 * @param {string} uid      - Firebase UID (for token refresh)
 * @param {number} daysBack - How many days to look back (default 60)
 * @returns {Promise<Array>} Array of Google Fit session objects, newest first
 */
export const fetchRecentSessions = async (uid, daysBack = 60) => {
    const accessToken = await getGoogleFitAccessToken(uid);

    const endTime   = new Date().toISOString();
    const startTime = new Date(Date.now() - daysBack * 24 * 3600 * 1000).toISOString();

    const url = `${FIT_BASE}/sessions?startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}&includeDeleted=false`;
    const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `Fitness API error ${response.status}`);
    }

    const data = await response.json();
    // Sort newest first, filter out very short sessions (<60s)
    return (data.session || [])
        .filter(s => Math.abs(parseInt(s.endTimeMillis) - parseInt(s.startTimeMillis)) >= 60_000)
        .sort((a, b) => parseInt(b.startTimeMillis) - parseInt(a.startTimeMillis));
};

// ── Telemetry fetching + normalisation ────────────────────────────────────────
/**
 * Fetches GPS, speed, elevation, and heart rate for a session,
 * then normalises them into the exact streams format expected by
 * foilAnalysisService.analyzeSession() and SessionMap.
 *
 * @param {string} uid     - Firebase UID (for token refresh)
 * @param {object} session - A session object from fetchRecentSessions()
 * @returns {Promise<{ streams, activityStats, mapPolyline }>}
 *          Same shape as tcxService.parseTcxFile()
 */
export const fetchSessionTelemetry = async (uid, session) => {
    const accessToken = await getGoogleFitAccessToken(uid);

    const startMs = parseInt(session.startTimeMillis);
    const endMs   = parseInt(session.endTimeMillis);
    // Google Fitness API dataset IDs are in nanoseconds
    const startNs = startMs * 1_000_000;
    const endNs   = endMs   * 1_000_000;
    const datasetId = `${startNs}-${endNs}`;

    const headers = { Authorization: `Bearer ${accessToken}` };

    // Fetch all four streams in parallel — missing streams return empty point arrays
    const fetches = Object.entries(DATA_SOURCES).map(([key, src]) =>
        fetch(`${FIT_BASE}/dataSources/${encodeURIComponent(src)}/datasets/${datasetId}`, { headers })
            .then(r => r.ok ? r.json() : { point: [] })
            .then(d => [key, d.point || []])
            .catch(() => [key, []])
    );

    const results = Object.fromEntries(await Promise.all(fetches));
    const { location, speed, altitude, heartRate } = results;

    if (location.length === 0) {
        throw new Error(
            'No GPS data found for this session.\n\n' +
            'Make sure GPS was enabled on your Pixel Watch during this workout. ' +
            'If you used "Outdoor Bike" mode, GPS should be recorded automatically.'
        );
    }

    return _normalizeToStreams({ session, startMs, location, speed, altitude, heartRate });
};

// ── Internal: merge streams by timestamp ──────────────────────────────────────
const _toMs = (nanos) => Math.floor(parseInt(nanos) / 1_000_000);

/** Find the nearest value in a sorted Map within windowMs, or null. */
const _nearest = (entries, targetMs, windowMs) => {
    let best = null;
    let bestDiff = Infinity;
    for (const [ts, val] of entries) {
        const diff = Math.abs(ts - targetMs);
        if (diff < bestDiff && diff <= windowMs) {
            bestDiff = diff;
            best = val;
        }
    }
    return best;
};

/** Haversine distance in metres between two {lat,lng} points */
const _haversineM = (lat1, lng1, lat2, lng2) => {
    const R = 6371000;
    const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
};

/** Google Polyline encoder */
const _encodeNum = (num) => {
    let n = num < 0 ? ~(num << 1) : (num << 1);
    let result = '';
    while (n >= 0x20) { result += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>= 5; }
    return result + String.fromCharCode(n + 63);
};
const _encodePolyline = (pairs) => {
    let result = '', pLat = 0, pLng = 0;
    for (const [lat, lng] of pairs) {
        const dLat = Math.round((lat - pLat) * 1e5);
        const dLng = Math.round((lng - pLng) * 1e5);
        result += _encodeNum(dLat) + _encodeNum(dLng);
        pLat = lat; pLng = lng;
    }
    return result;
};

/** 5-point moving-average smoother */
const _smooth = (arr, w = 5) => {
    const h = Math.floor(w / 2);
    return arr.map((_, i) => {
        const slice = arr.slice(Math.max(0, i-h), Math.min(arr.length, i+h+1));
        return slice.reduce((a, b) => a + b, 0) / slice.length;
    });
};

/**
 * Merges the four raw API streams into the streams format expected by
 * foilAnalysisService.analyzeSession() and tcxService.buildResult().
 */
const _normalizeToStreams = ({ session, startMs, location, speed, altitude, heartRate }) => {
    // Build lookup maps: timestamp → value (5s tolerance for speed/alt, 30s for HR)
    const speedMap = new Map(speed.map(p => [_toMs(p.startTimeNanos), p.value?.[0]?.fpVal ?? 0]));
    const altMap   = new Map(altitude.map(p => [_toMs(p.startTimeNanos), p.value?.[0]?.fpVal ?? 0]));
    const hrMap    = new Map(heartRate.map(p => [_toMs(p.startTimeNanos), p.value?.[0]?.fpVal ?? 0]));

    const speedEntries = [...speedMap.entries()];
    const altEntries   = [...altMap.entries()];
    const hrEntries    = [...hrMap.entries()];

    // Build raw track points from GPS master timeline
    const rawPoints = [];
    for (const point of location) {
        const ts  = _toMs(point.startTimeNanos);
        const lat = point.value?.[0]?.fpVal;
        const lng = point.value?.[1]?.fpVal;
        const altFromGps = point.value?.[3]?.fpVal;   // altitude baked into location stream

        if (!lat || !lng || isNaN(lat) || isNaN(lng)) continue;

        const speedMs = _nearest(speedEntries, ts, 5_000) ?? 0;
        const altM    = altFromGps || _nearest(altEntries, ts, 5_000) || 0;
        const hr      = _nearest(hrEntries, ts, 30_000) || 0;

        rawPoints.push({ timeMs: ts, lat, lng, altitudeM: altM, speedMs, heartRate: hr });
    }

    if (rawPoints.length < 2) {
        throw new Error('Too few valid GPS points in this session to render a track.');
    }

    // Sort by time (API doesn't guarantee order)
    rawPoints.sort((a, b) => a.timeMs - b.timeMs);

    // Build streams arrays
    const timeData   = rawPoints.map(p => (p.timeMs - startMs) / 1000);
    const latlngData = rawPoints.map(p => [p.lat, p.lng]);
    const altData    = rawPoints.map(p => p.altitudeM);
    const hrData     = rawPoints.map(p => p.heartRate);

    // Speed: prefer API speed stream; fall back to Haversine-derived speed
    const rawSpeeds = rawPoints.map((p, i) => {
        if (p.speedMs > 0) return p.speedMs;
        if (i === 0) return 0;
        const prev = rawPoints[i - 1];
        const dt   = (p.timeMs - prev.timeMs) / 1000;
        return dt > 0 ? _haversineM(prev.lat, prev.lng, p.lat, p.lng) / dt : 0;
    });
    const smoothedSpeeds = _smooth(rawSpeeds, 5);

    // Cumulative distance
    let cum = 0;
    const distData = rawPoints.map((p, i) => {
        if (i > 0) cum += _haversineM(rawPoints[i-1].lat, rawPoints[i-1].lng, p.lat, p.lng);
        return cum;
    });

    const streams = {
        time:            { data: timeData },
        latlng:          { data: latlngData },
        altitude:        { data: altData },
        distance:        { data: distData },
        velocity_smooth: { data: smoothedSpeeds },
        heartrate:       { data: hrData },
    };

    // Summary stats (same keys as tcxService.buildResult)
    const maxSpeedMs  = Math.max(...smoothedSpeeds);
    const movingVels  = smoothedSpeeds.filter(v => v > 0.3);
    const avgSpeedMs  = movingVels.length > 0 ? movingVels.reduce((a,b) => a+b, 0) / movingVels.length : 0;
    const totalDistM  = distData[distData.length - 1];
    const durationMs  = rawPoints[rawPoints.length - 1].timeMs - startMs;
    const hrs         = hrData.filter(h => h > 0);

    const activityStats = {
        topSpeed:     (maxSpeedMs * 1.94384).toFixed(1),   // kts
        avgSpeed:     (avgSpeedMs * 1.94384).toFixed(1),   // kts
        distance:     (totalDistM / 1000).toFixed(2),       // km
        duration:     (durationMs / 60000).toFixed(1),      // minutes
        startTime:    new Date(startMs),
        heartRateAvg: hrs.length > 0 ? Math.round(hrs.reduce((a,b) => a+b, 0) / hrs.length) : null,
        heartRateMax: hrs.length > 0 ? Math.max(...hrs) : null,
    };

    const mapPolyline = _encodePolyline(latlngData);

    return { streams, activityStats, mapPolyline };
};

