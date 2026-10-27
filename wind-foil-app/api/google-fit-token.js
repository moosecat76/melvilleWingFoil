/**
 * api/google-fit-token.js
 *
 * Vercel Serverless Function (& Vite dev middleware): /api/google-fit-token
 *
 * Handles two operations securely server-side:
 *   1. Authorization code → access/refresh token exchange (grant_type: 'authorization_code')
 *   2. Refresh token → new access token              (grant_type: 'refresh_token')
 *
 * Used for Google Health API v4 OAuth (migrated from deprecated Google Fit REST API).
 * The token exchange endpoint (oauth2.googleapis.com/token) is the same for both APIs.
 *
 * The CLIENT_SECRET is NEVER sent to the browser.
 */

const DEFAULT_ALLOWED_ORIGINS = new Set([
    'https://melvillewingfoil.vercel.app',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
]);

function isAllowedOrigin(origin) {
    if (!origin) return true; // Same-origin requests without Origin header
    if (DEFAULT_ALLOWED_ORIGINS.has(origin)) return true;
    const extra = process.env.ALLOWED_ORIGIN;
    if (extra && extra.split(',').map(s => s.trim()).includes(origin)) return true;
    return false;
}

export default async function handler(req, res) {
    // ── Strict CORS Allowlist ────────────────────────────────────────────────
    const origin = req.headers?.origin || '';
    if (origin && !isAllowedOrigin(origin)) {
        return res.status(403).json({ error: 'Origin not allowed' });
    }
    if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // ── Credentials from environment ─────────────────────────────────────────
    const clientId     = process.env.VITE_GOOGLE_FIT_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_FIT_CLIENT_SECRET;   // Never prefixed with VITE_

    if (!clientId || !clientSecret) {
        console.error('[google-fit-token] Missing env vars.',
            'CLIENT_ID present:', !!clientId,
            'CLIENT_SECRET present:', !!clientSecret);
        return res.status(500).json({ error: 'Server config error: missing Google OAuth credentials' });
    }

    const { grant_type, code, refresh_token, redirect_uri } = req.body || {};

    if (!grant_type) {
        return res.status(400).json({ error: 'Missing grant_type' });
    }

    // ── Build the body for Google's token endpoint ────────────────────────────
    let tokenBody;

    if (grant_type === 'authorization_code') {
        if (!code)         return res.status(400).json({ error: 'Missing code' });
        if (!redirect_uri) return res.status(400).json({ error: 'Missing redirect_uri' });

        tokenBody = {
            client_id:     clientId,
            client_secret: clientSecret,
            code,
            redirect_uri,
            grant_type:    'authorization_code',
        };
    } else if (grant_type === 'refresh_token') {
        if (!refresh_token) return res.status(400).json({ error: 'Missing refresh_token' });

        tokenBody = {
            client_id:     clientId,
            client_secret: clientSecret,
            refresh_token,
            grant_type:    'refresh_token',
        };
    } else {
        return res.status(400).json({ error: `Unsupported grant_type: ${grant_type}` });
    }

    try {
        // Google's OAuth2 token endpoint requires application/x-www-form-urlencoded, not JSON.
        const response = await fetch('https://oauth2.googleapis.com/token', {
            method:  'POST',
            body:    new URLSearchParams(tokenBody),
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('[google-fit-token] Google exchange failed:', data.error || response.status);
            return res.status(response.status).json(data);
        }

        return res.status(200).json(data);
    } catch (err) {
        console.error('[google-fit-token] Unexpected error:', err);
        return res.status(500).json({ error: err.message });
    }
}
