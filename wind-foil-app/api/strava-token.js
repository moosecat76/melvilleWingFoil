/**
 * Vercel Serverless Function: /api/strava-token
 *
 * Handles the Strava OAuth code-for-token exchange SERVER-SIDE.
 * This keeps the client_secret secure (never sent to the browser).
 *
 * Strava's token endpoint restricts activity scopes when called from
 * browser origins, so doing this server-side is critical.
 */
export default async function handler(req, res) {
    // Allow CORS from same origin
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { code } = req.body || {};
    if (!code) {
        return res.status(400).json({ error: 'Missing authorization code' });
    }

    const clientId = process.env.VITE_STRAVA_CLIENT_ID;
    const clientSecret = process.env.STRAVA_CLIENT_SECRET || process.env.VITE_STRAVA_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        console.error('[strava-token] Missing env vars. CLIENT_ID present:', !!clientId, 'CLIENT_SECRET present:', !!clientSecret);
        return res.status(500).json({ error: 'Server configuration error: missing Strava credentials' });
    }

    console.log('[strava-token] Exchanging code, client_id:', clientId);

    try {
        const stravaResponse = await fetch('https://www.strava.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: clientId,
                client_secret: clientSecret,
                code: code,
                grant_type: 'authorization_code'
            })
        });

        const data = await stravaResponse.json();
        console.log('[strava-token] Strava response status:', stravaResponse.status, '| has access_token:', !!data.access_token);

        if (!stravaResponse.ok) {
            console.error('[strava-token] Strava exchange failed:', data);
            return res.status(stravaResponse.status).json(data);
        }

        return res.status(200).json(data);
    } catch (error) {
        console.error('[strava-token] Unexpected error:', error);
        return res.status(500).json({ error: error.message });
    }
}
