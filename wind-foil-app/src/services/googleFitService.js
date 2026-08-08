/**
 * googleFitService.js — Google Health API v4
 *
 * Migrated from the deprecated Google Fit REST API to the Google Health API v4.
 * The filename is kept as-is to avoid breaking imports across the codebase.
 *
 * Provides:
 *   - initiateGoogleFitAuth()      Redirect to Google consent screen (Health scopes)
 *   - handleGoogleFitCallback()    Exchange auth code for tokens, persist to Firestore
 *   - getGoogleFitAccessToken()    Return a valid access token (auto-refreshes if expired)
 *   - getGoogleFitUser()           Return stored token metadata (null = not connected)
 *   - getGoogleFitUserAsync()      Async version that also checks Firestore
 *   - disconnectGoogleFit()        Clear tokens from localStorage + Firestore
 *   - fetchRecentSessions()        List exercise sessions from Google Health API v4
 *   - fetchSessionTelemetry()      GPS via exportExerciseTcx; falls back to HR-only if no GPS
 *   - relabelActivityType()        Return display-friendly label for a session
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * REQUIRED SCOPES (Google Health API v4):
 *
 *   googlehealth.activity_and_fitness.readonly  → Session list, activity metadata
 *   googlehealth.location.readonly              → GPS coordinates recorded during exercise
 *   googlehealth.health_metrics_and_measurements.readonly  → Heart rate and other health stats
 *
 * These are "Restricted" scopes. For personal / test use, add your Google account
 * as a Test User in the OAuth consent screen in Google Cloud Console.
 * ──────────────────────────────────────────────────────────────────────────────
 */

// ── Constants ─────────────────────────────────────────────────────────────────
const CLIENT_ID         = import.meta.env.VITE_GOOGLE_FIT_CLIENT_ID;
// Only used on localhost — Vite can't run serverless functions, so we call Google directly.
// On Vercel the serverless function handles the exchange and this is never read.
const CLIENT_SECRET_DEV = import.meta.env.VITE_GOOGLE_FIT_CLIENT_SECRET;

const IS_LOCAL_DEV = typeof window !== 'undefined' && window.location.hostname === 'localhost';

// Google Health API v4 scopes (replaces the deprecated fitness.* scopes)
const SCOPES = [
    'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
    'https://www.googleapis.com/auth/googlehealth.location.readonly',
    'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
].join(' ');

const OAUTH_ENDPOINT   = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TOKEN_API        = '/api/google-fit-token';   // Vercel serverless (production only)

// localStorage keys — new prefix to avoid conflicts with old Fit tokens
const LS_ACCESS_TOKEN  = 'ghealth_access_token';
const LS_REFRESH_TOKEN = 'ghealth_refresh_token';
const LS_EXPIRES_AT    = 'ghealth_expires_at';

// Google Health API v4 base URL
const HEALTH_BASE = 'https://health.googleapis.com/v4/users/me';

// ── Internal: unified token exchange (local dev vs production) ────────────────
/**
 * On localhost: calls Google directly (VITE_GOOGLE_FIT_CLIENT_SECRET available in bundle).
 * On Vercel:   calls /api/google-fit-token (client secret stays server-side).
 */
const _exchangeToken = async (body) => {
    if (IS_LOCAL_DEV) {
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
        alert('Google Client ID is not configured. Add VITE_GOOGLE_FIT_CLIENT_ID to your .env file.');
        return;
    }

    const redirectUri = window.location.origin;

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

    const profile = await _fetchGoogleProfile(data.access_token);
    return profile;
};

// ── Step 3 — Get a valid access token (auto-refresh if needed) ────────────────
/**
 * Use this in every data-fetching call.
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
            _saveTokensLocally({
                access_token:  accessToken,
                refresh_token: refreshToken,
                expires_in:    Math.max(0, (expiresAt - Date.now()) / 1000),
            });
        }
    }

    if (!accessToken) throw new Error('Google Health is not connected. Please authorise via Settings.');

    // Refresh if expired (with 60s buffer)
    if (Date.now() >= expiresAt - 60_000) {
        if (!refreshToken) throw new Error('No refresh token. Please re-authorise Google Health.');

        const data = await _exchangeToken({ grant_type: 'refresh_token', refresh_token: refreshToken });

        _saveTokensLocally(data);
        if (uid) {
            const { saveGoogleFitTokens } = await import('./dbService');
            await saveGoogleFitTokens(uid, {
                access_token:  data.access_token,
                refresh_token: refreshToken,   // refresh_token is not reissued on refresh
                expires_at:    Date.now() + data.expires_in * 1000,
            });
        }

        return data.access_token;
    }

    return accessToken;
};

// ── Connection status helpers ─────────────────────────────────────────────────

export const getGoogleFitUser = () => {
    const token = localStorage.getItem(LS_ACCESS_TOKEN);
    if (token) {
        const email = localStorage.getItem('ghealth_email');
        return email ? { email } : { email: 'Connected' };
    }
    return null;
};

/**
 * Async version — checks Firestore too (for page refreshes / multi-device).
 */
export const getGoogleFitUserAsync = async (uid) => {
    // Fast path: localStorage
    const token = localStorage.getItem(LS_ACCESS_TOKEN);
    if (token) {
        const email = localStorage.getItem('ghealth_email');
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
    localStorage.removeItem('ghealth_email');
    // Also clear old Fit keys in case they still exist
    localStorage.removeItem('gfit_access_token');
    localStorage.removeItem('gfit_refresh_token');
    localStorage.removeItem('gfit_expires_at');
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
        if (p.email) localStorage.setItem('ghealth_email', p.email);
        return p;
    } catch {
        return { email: 'Connected' };
    }
};

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 2 — Session listing and telemetry fetching (Google Health API v4)
// ══════════════════════════════════════════════════════════════════════════════

// ── Health Connect ExerciseSessionType integer code → friendly name ───────────
// Source: android.health.connect.datatypes.ExerciseSessionType
// The Google Health API returns exerciseType as an integer in the response.
const EXERCISE_TYPE_NAMES = {
    0:   'Other Workout',
    2:   'Badminton',
    4:   'Baseball',
    5:   'Basketball',
    8:   'Biking',
    9:   'Stationary Bike',
    10:  'Boot Camp',
    11:  'Boxing',
    13:  'Calisthenics',
    14:  'Cricket',
    16:  'Dancing',
    25:  'Elliptical',
    26:  'Exercise Class',
    27:  'Fencing',
    28:  'American Football',
    29:  'Australian Football',
    31:  'Frisbee',
    32:  'Golf',
    33:  'Guided Breathing',
    34:  'Gymnastics',
    35:  'Handball',
    36:  'High Intensity Interval Training',
    37:  'Hiking',
    38:  'Ice Hockey',
    39:  'Ice Skating',
    43:  'Martial Arts',
    44:  'Paddling',
    45:  'Paragliding',
    46:  'Pilates',
    47:  'Racquetball',
    48:  'Rock Climbing',
    49:  'Roller Hockey',
    50:  'Rowing',
    51:  'Rowing Machine',
    52:  'Rugby',
    53:  'Running',
    54:  'Treadmill Running',
    55:  'Sailing',
    56:  'Scuba Diving',
    57:  'Skateboarding',
    58:  'Skiing',
    59:  'Cross-Country Skiing',
    60:  'Snowboarding',
    61:  'Snowshoeing',
    62:  'Soccer',
    63:  'Softball',
    64:  'Squash',
    65:  'Stair Climbing',
    66:  'Stair Climbing Machine',
    67:  'Strength Training',
    68:  'Stretching',
    69:  'Surfing',
    70:  'Swimming (Open Water)',
    71:  'Swimming (Pool)',
    72:  'Table Tennis',
    73:  'Tennis',
    74:  'Volleyball (Beach)',
    75:  'Volleyball (Indoor)',
    76:  'Walking',
    78:  'Water Polo',
    79:  'Weightlifting',
    80:  'Wheelchair',
    81:  'Windsurfing',
    82:  'Yoga',
    83:  'Meditation',
    84:  'Cross Training',
    85:  'Triathlon',
    86:  'Winter Sports',
    87:  'Hunting',
    88:  'Diving',
    89:  'Kite Surfing',
    // Wing foiling is often mapped to 89 (kite surfing) or uses a custom type
};

/**
 * Generates a friendly time-of-day name for sessions with unknown type.
 * e.g. "Morning Workout", "Evening Session"
 */
const _timeOfDayName = (startMs) => {
    if (!startMs) return 'Workout';
    const h = new Date(startMs).getHours();
    if (h < 5)  return 'Night Workout';
    if (h < 12) return 'Morning Workout';
    if (h < 14) return 'Midday Workout';
    if (h < 17) return 'Afternoon Workout';
    if (h < 21) return 'Evening Workout';
    return 'Night Workout';
};

/**
 * Resolve the human-friendly name from a raw Health API data point.
 * Tries (in order):
 *   1. exercise.exerciseType integer → lookup table name
 *   2. exercise.title (if the user named the session in the Health app)
 *   3. Time-of-day generated name
 *
 * @param {object} p        - Raw data point from the API
 * @param {number} startMs  - Start time in ms (for time-of-day fallback)
 * @returns {string}
 */
const _resolveSessionName = (p, startMs) => {
    // 1. User display name / title (e.g. "Paddleboarding" from watch/app)
    if (p.exercise?.displayName && p.exercise.displayName.trim()) {
        return p.exercise.displayName.trim();
    }
    if (p.exercise?.title && p.exercise.title.trim()) {
        return p.exercise.title.trim();
    }

    // 2. Exercise type string (e.g. "PADDLEBOARDING") or integer code
    const type = p.exercise?.exerciseType;
    if (typeof type === 'string' && type.trim()) {
        // Convert "PADDLEBOARDING" -> "Paddleboarding", "WIND_SURFING" -> "Wind Surfing"
        return type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    }
    if (typeof type === 'number') {
        const mapped = EXERCISE_TYPE_NAMES[type];
        if (mapped) return mapped;
    }

    // 3. Time-of-day fallback
    return _timeOfDayName(startMs);
};

/**
 * Returns a display-friendly label for a session.
 * Kept for backwards compatibility with SessionsPage.jsx callers.
 *
 * @param {number|string} activityType  - Ignored (Health API passes null)
 * @param {string}        sessionName   - Pre-resolved name from _resolveSessionName()
 * @returns {string}
 */
export const relabelActivityType = (_activityType, sessionName = '') => {
    const name = (sessionName || '').trim();
    if (!name) return 'Workout';
    return name;
};

/**
 * Returns the best emoji icon for a session label.
 * Used in the session list picker UI.
 *
 * @param {string} label - The display label from relabelActivityType()
 * @returns {string} emoji
 */
export const sessionEmoji = (label = '') => {
    const l = label.toLowerCase();
    if (l.includes('wing') || l.includes('foil') || l.includes('kite surf')) return '🪁';
    if (l.includes('windsurf') || l.includes('surf')) return '🏄';
    if (l.includes('paddle') || l.includes('sup')) return '🏄‍♂️';
    if (l.includes('swim')) return '🏊';
    if (l.includes('run') || l.includes('jog') || l.includes('treadmill')) return '🏃';
    if (l.includes('bike') || l.includes('cycl') || l.includes('cycling')) return '🚴';
    if (l.includes('walk')) return '🚶';
    if (l.includes('kayak') || l.includes('paddle') || l.includes('row')) return '🚣';
    if (l.includes('sail')) return '⛵';
    if (l.includes('hike') || l.includes('hiking')) return '🥾';
    if (l.includes('yoga') || l.includes('meditat') || l.includes('breath')) return '🧘';
    if (l.includes('strength') || l.includes('weight')) return '🏋️';
    if (l.includes('ski') || l.includes('snow')) return '⛷️';
    if (l.includes('hiit') || l.includes('interval') || l.includes('circuit')) return '⚡';
    return '🏃';
};

// ── Session listing ───────────────────────────────────────────────────────────
/**
 * Returns a list of recent exercise sessions from the Google Health API v4.
 *
 * Endpoint: GET /v4/users/me/dataTypes/exercise/dataPoints
 * Each data point represents one exercise session (workout).
 *
 * @param {string} uid      - Firebase UID (for token refresh)
 * @param {number} daysBack - How many days to look back (default 60)
 * @returns {Promise<Array>} Array of normalised session objects, newest first
 */
export const fetchRecentSessions = async (uid, daysBack = 60) => {
    const accessToken = await getGoogleFitAccessToken(uid);

    const timeThreshold = Date.now() - daysBack * 24 * 3600 * 1000;

    // NOTE: The Google Health API v4 filter for exercise.interval.end_time returns 400.
    // Fetch unfiltered and apply client-side date filtering instead.
    const response = await fetch(`${HEALTH_BASE}/dataTypes/exercise/dataPoints?pageSize=100`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        console.error('[GHealth] fetchRecentSessions error:', err);
        throw new Error(err.error?.message || `Google Health API error ${response.status}`);
    }

    const data = await response.json();
    const points = (data.dataPoints || []).filter(p => {
        const endMs = new Date(p.exercise?.interval?.endTime || 0).getTime();
        return endMs >= timeThreshold;
    });

    // Normalise into a consistent session shape used by the rest of the app.
    if (points.length > 0) {
        console.log('[GHealth] Sample data point shape:', JSON.stringify(points[0], null, 2));
    }

    return points
        .map(p => {
            const interval = p.exercise?.interval || {};
            const startMs = interval.startTime ? new Date(interval.startTime).getTime() : null;
            const endMs   = interval.endTime   ? new Date(interval.endTime).getTime()   : null;
            if (!startMs || !endMs) return null;

            const durationMs = endMs - startMs;
            if (durationMs < 60_000) return null;  // Skip < 1 min

            // Resolve human-friendly name (e.g. "Paddleboarding" from p.exercise.displayName)
            const resolvedName = _resolveSessionName(p, startMs);

            // Extract unique DataPoint ID from resource name "users/.../dataPoints/{id}"
            const realId = p.name ? p.name.split('/').pop() : `${startMs}`;

            return {
                id:              realId,
                name:            resolvedName,
                activityType:    null,   // Not used for Health API (string names instead)
                startTimeMillis: String(startMs),
                endTimeMillis:   String(endMs),
                metricsSummary:  p.exercise?.metricsSummary || null,
                _dataPointName:  p.name,  // Full resource name for exportExerciseTcx call
            };
        })
        .filter(Boolean)
        .sort((a, b) => parseInt(b.startTimeMillis) - parseInt(a.startTimeMillis));
};

// ── Telemetry fetching: GPS first, heart-rate fallback ───────────────────────

/**
 * Builds a streams + activityStats object from raw heart-rate sample points.
 * Used when GPS is unavailable so the session can still be logged with HR data.
 *
 * @param {Array}  hrSamples  - Raw Health API heart_rate data points
 * @param {number} startMs    - Session start in epoch ms
 * @param {number} endMs      - Session end in epoch ms
 * @returns {{ streams, activityStats, mapPolyline: null }}
 */
const _buildHrOnlyResult = (hrSamples, startMs, endMs, metricsSummary = null) => {
    const timeData = [];
    const hrData   = [];

    for (const sample of hrSamples) {
        const sampleTime = sample.heart_rate?.sample_time?.physical_time || sample.heart_rate_bpm?.sample_time?.physical_time;
        const bpm        = sample.heart_rate?.bpm || sample.heart_rate_bpm?.bpm || sample.bpm;
        if (!sampleTime || bpm == null) continue;

        const tMs = new Date(sampleTime).getTime();
        if (tMs < startMs || tMs > endMs) continue;

        timeData.push((tMs - startMs) / 1000);  // seconds from start
        hrData.push(Math.round(bpm));
    }

    const durationMs = endMs - startMs;
    const hrs        = hrData.filter(h => h > 0);

    // Extract summary values directly from Google Health session metricsSummary if available
    const summaryAvgHr = metricsSummary?.averageHeartRateBeatsPerMinute
        ? Math.round(parseFloat(metricsSummary.averageHeartRateBeatsPerMinute))
        : null;

    const summaryDistKm = metricsSummary?.distanceMillimeters
        ? (parseFloat(metricsSummary.distanceMillimeters) / 1_000_000).toFixed(2)
        : null;

    const summaryAvgSpeedKts = metricsSummary?.averageSpeedMillimetersPerSecond
        ? (parseFloat(metricsSummary.averageSpeedMillimetersPerSecond) * 0.00194384).toFixed(1)
        : null;

    const streams = {
        time:            { data: timeData },
        latlng:          { data: [] },          // No GPS
        altitude:        { data: [] },
        distance:        { data: [] },
        velocity_smooth: { data: [] },
        heartrate:       { data: hrData },
    };

    const activityStats = {
        topSpeed:     null,
        avgSpeed:     summaryAvgSpeedKts,
        distance:     summaryDistKm,
        duration:     (durationMs / 60000).toFixed(1),
        startTime:    new Date(startMs),
        heartRateAvg: hrs.length > 0 ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : summaryAvgHr,
        heartRateMax: hrs.length > 0 ? Math.max(...hrs) : summaryAvgHr,
        hasGps:       false,
    };

    return { streams, activityStats, mapPolyline: null };
};

/**
 * Fetch heart-rate samples from the Google Health API for a given time window.
 * Expands search window by ±60 seconds to catch boundary samples for short sessions.
 *
 * Endpoint: GET /v4/users/me/dataTypes/heart_rate/dataPoints
 * Filter:   heart_rate.sample_time.physical_time (Sample type)
 *
 * @param {string} accessToken
 * @param {string} startIso  - ISO 8601 start time
 * @param {string} endIso    - ISO 8601 end time
 * @returns {Promise<Array>} Raw heart_rate data points
 */
const _fetchHeartRateForSession = async (_accessToken, _startIso, _endIso) => {
    // The Google Health API v4 does not expose per-sample heart rate data via
    // the dataPoints endpoint (both 'heart_rate' and 'heart_rate_bpm' return
    // 400 INVALID_ARGUMENT). Heart rate is only available via session
    // metricsSummary.averageHeartRateBeatsPerMinute, which is already extracted
    // directly in _buildHrOnlyResult via the metricsSummary parameter.
    return [];
};

/**
 * Fetches telemetry for a session.
 *
 * Strategy:
 *   1. Try exportExerciseTcx → full GPS + HR track (best data)
 *      Tries candidate URLs (`users/me` path & full resource name)
 *   2. If no GPS / TCX fails → fetch heart_rate data points for the session window
 *   3. If no HR → return basic session metadata (duration, start time, weather lookup)
 *
 * @param {string} uid     - Firebase UID (for token refresh)
 * @param {object} session - A session object from fetchRecentSessions()
 * @returns {Promise<{ streams, activityStats, mapPolyline }>}
 *   mapPolyline will be null for non-GPS sessions.
 *   activityStats.hasGps will be false for non-GPS sessions.
 */
export const fetchSessionTelemetry = async (uid, session) => {
    const accessToken = await getGoogleFitAccessToken(uid);

    const startMs  = parseInt(session.startTimeMillis);
    const endMs    = parseInt(session.endTimeMillis);
    const startIso = new Date(startMs).toISOString();
    const endIso   = new Date(endMs).toISOString();

    // ── Step 1: Try GPS/TCX export (try candidate endpoint formats) ───────────
    const dataPointId = session.id.includes('/') ? session.id.split('/').pop() : session.id;
    const candidateUrls = [
        `${HEALTH_BASE}/dataTypes/exercise/dataPoints/${dataPointId}:exportExerciseTcx`,
    ];
    if (session._dataPointName) {
        candidateUrls.unshift(`${HEALTH_BASE.replace('/users/me', '')}/${session._dataPointName}:exportExerciseTcx`);
    }

    let tcxResult = null;
    for (const tcxUrl of candidateUrls) {
        try {
            console.log('[GHealth] Attempting TCX export:', tcxUrl);
            const tcxResponse = await fetch(tcxUrl, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    Accept:        'application/xml, text/xml, */*',
                },
            });

            const responseText = await tcxResponse.text();
            if (!tcxResponse.ok) {
                console.warn('[GHealth] TCX export status:', tcxResponse.status, responseText.slice(0, 200));
                continue;
            }

            // The Google Health API wraps TCX in a JSON envelope: { "tcxData": "<?xml..." }
            // Unwrap it to get the raw XML string.
            let tcxText = responseText;
            try {
                const parsed = JSON.parse(responseText);
                if (parsed?.tcxData) {
                    tcxText = parsed.tcxData;
                    console.log('[GHealth] Unwrapped TCX from JSON envelope. XML length:', tcxText.length);
                }
            } catch (_) {
                // Not JSON — use responseText directly as XML
            }

            const lowerXml = (tcxText || '').toLowerCase();
            const hasTrackpoints = lowerXml.includes('trackpoint');

            if (hasTrackpoints) {
                try {
                    const { parseTcxFile } = await import('./tcxService');
                    tcxResult = await parseTcxFile(tcxText);
                    if (tcxResult?.activityStats) {
                        tcxResult.activityStats.hasGps = tcxResult.activityStats.hasGps ?? (tcxResult.mapPolyline != null);
                    }
                    console.log('[GHealth] TCX export successful! GPS:', tcxResult.activityStats?.hasGps, 'Points:', tcxResult.streams?.time?.data?.length || 0);
                    break;
                } catch (parseErr) {
                    console.warn('[GHealth] TCX parse error:', parseErr.message, '| Preview:', tcxText.slice(0, 300));
                }
            } else {
                console.warn('[GHealth] TCX has no trackpoints. Preview:', tcxText.slice(0, 300));
            }
        } catch (e) {
            console.warn('[GHealth] TCX export fetch error:', e.message);
        }
    }

    if (tcxResult) return tcxResult;

    // ── Step 2: No GPS — build from metricsSummary ────────────────────────────
    // NOTE: The Google Health API v4 does not provide per-sample HR data points.
    // Average HR, distance, and speed come from session.metricsSummary directly.
    console.log('[GHealth] No GPS TCX found. Building result from session metricsSummary.');
    return _buildHrOnlyResult([], startMs, endMs, session.metricsSummary);
};

