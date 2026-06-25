import dotenv from 'dotenv';
import crypto from 'crypto';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

dotenv.config();

if (!getApps().length) {
    initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
}

const db = getFirestore();

const API_KEYS = new Map();
const rateLimitMap = new Map();

async function loadKeysFromFirestore() {
    try {
        const snap = await db.collection('api_keys').get();
        API_KEYS.clear();
        for (const doc of snap.docs) {
            const data = doc.data();
            if (data.enabled) {
                API_KEYS.set(doc.id, {
                    type: data.type,
                    rpm: data.requests_per_minute ?? 100,
                });
            }
        }
    } catch {
    }
}

await loadKeysFromFirestore();
setInterval(loadKeysFromFirestore, 5 * 60 * 1000);

const TOKEN_SECRET = process.env.TOKEN_SECRET;
const TOKEN_TTL_MS = 30 * 60 * 1000;

export function issueSessionToken() {
    const expires = Date.now() + TOKEN_TTL_MS;
    const payload = `${expires}`;
    const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex');
    return `${expires}.${sig}`;
}

export function validateSessionToken(token) {
    if (!token) return false;
    try {
        const parts = token.split('.');
        if (parts.length !== 2) return false;
        const [expires, sig] = parts;
        if (Date.now() > parseInt(expires)) return false;
        const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(expires).digest('hex');
        if (sig.length !== expected.length) return false;
        return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
        return false;
    }
}

export function validateApiKey(apiKey) {
    if (!apiKey) {
        return { valid: false, error: 'Missing API key', type: null };
    }

    let cleanKey = apiKey;
    if (apiKey.includes(':')) {
        const parts = apiKey.split(':');
        cleanKey = parts[parts.length - 1].trim();
    }

    const entry = API_KEYS.get(cleanKey);
    if (!entry) {
        return { valid: false, error: 'Invalid API key', type: null };
    }

    return { valid: true, error: null, type: entry.type };
}

export function checkRateLimit(apiKey, clientIP) {
    let cleanKey = apiKey;
    if (apiKey?.includes(':')) {
        const parts = apiKey.split(':');
        cleanKey = parts[parts.length - 1].trim();
    }

    const entry = API_KEYS.get(cleanKey);
    if (!entry) return { allowed: false, error: 'Invalid API key' };

    const rpm = entry.rpm;
    const window = 60000;
    const now = Date.now();
    const key = `${cleanKey}:${clientIP}`;

    const current = rateLimitMap.get(key) || { count: 0, resetAt: now + window };

    if (now > current.resetAt) {
        current.count = 0;
        current.resetAt = now + window;
    }

    if (current.count >= rpm) {
        return {
            allowed: false,
            error: 'Rate limit exceeded',
            resetAt: current.resetAt,
            limit: rpm,
            window,
        };
    }

    current.count++;
    rateLimitMap.set(key, current);

    return {
        allowed: true,
        remaining: rpm - current.count,
        resetAt: current.resetAt,
    };
}

export function authenticateRequest(req) {
    const host = req.headers['host'] || '';
    if (host.includes('localhost') || host.includes('127.0.0.1')) {
        return { valid: true, error: null, type: 'standard', bypassed: true };
    }

    const sessionToken = req.headers['x-session-token']?.trim();
    if (sessionToken) {
        if (validateSessionToken(sessionToken)) {
            return { valid: true, error: null, type: 'player', bypassed: true };
        }
        return { valid: false, error: 'Invalid or expired session token' };
    }

    const authHeader = req.headers['authorization'];
    const apiKey = authHeader?.replace('Bearer ', '')?.trim() || req.headers['x-api-key']?.trim();

    if (!apiKey) {
        return { valid: false, error: 'Missing API key. Provide via Authorization header or X-API-Key header.' };
    }

    return validateApiKey(apiKey);
}

export function canAccessStreaming(keyType) {
    return keyType === 'standard' || keyType === 'partner' || keyType === 'player';
}

export function canAccessSubtitlesAndDownloads(keyType) {
    return keyType === 'standard' || keyType === 'partner' || keyType === 'player';
}

export function clearRateLimitCache() {
    rateLimitMap.clear();
}

setInterval(() => {
    const now = Date.now();
    for (const [key, value] of rateLimitMap) {
        if (now > value.resetAt) {
            rateLimitMap.delete(key);
        }
    }
}, 60000);