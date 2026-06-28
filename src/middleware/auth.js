import dotenv from 'dotenv';
import crypto from 'crypto';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

dotenv.config();

const HARDCODED_KEYS = new Map([
    ['WMbNlxULjNW37BYfbss6', { type: 'standard', rpm: 100 }]
]);

const BYPASS_FIRESTORE = true;

if (!BYPASS_FIRESTORE) {
    if (!getApps().length) {
        try {
            initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
        } catch (err) {
            console.error('❌ Firebase init error:', err.message);
        }
    }
}

const db = !BYPASS_FIRESTORE ? getFirestore() : null;
const API_KEYS = new Map();

if (BYPASS_FIRESTORE) {
    HARDCODED_KEYS.forEach((value, key) => {
        API_KEYS.set(key, value);
    });
    console.log(`Loaded ${API_KEYS.size} hardcoded API keys`);
    console.log(`Keys: ${[...API_KEYS.keys()].join(', ')}`);
}

const rateLimitMap = new Map();

async function loadKeysFromFirestore() {
    if (BYPASS_FIRESTORE || !db) {
        console.log('Skipping Firestore load (bypass mode)');
        return;
    }
    
    try {
        const snap = await db.collection('api_keys').get();
        API_KEYS.clear();
        for (const doc of snap.docs) {
            const data = doc.data();
            if (data.enabled) {
                API_KEYS.set(doc.id, { type: data.type, rpm: data.requests_per_minute ?? 100 });
            }
        }
        console.log(`Loaded ${API_KEYS.size} API keys from Firestore`);
        console.log(`Keys: ${[...API_KEYS.keys()].join(', ')}`);
    } catch (err) {
        console.error('Firestore error:', err.message);
    }
}

if (!BYPASS_FIRESTORE) {
    await loadKeysFromFirestore();
    setInterval(loadKeysFromFirestore, 5 * 60 * 1000);
} else {
    console.log('Running in BYPASS mode - Firestore disabled');
}

const TOKEN_SECRET = process.env.TOKEN_SECRET || 'fallback-secret-do-not-use-in-production';
const TOKEN_TTL_MS = 30 * 60 * 1000;

export function issueSessionToken(type = 'player') {
    const expires = Date.now() + TOKEN_TTL_MS;
    const payload = `${expires}.${type}`;
    const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex');
    return `${expires}.${type}.${sig}`;
}

export function validateSessionToken(token) {
    if (!token) return false;
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return false;
        const [expires, type, sig] = parts;
        if (Date.now() > parseInt(expires)) return false;
        const payload = `${expires}.${type}`;
        const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex');
        if (sig.length !== expected.length) return false;
        return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))
            ? type
            : false;
    } catch {
        return false;
    }
}

function parseKey(apiKey) {
    if (!apiKey) return null;
    return apiKey.includes(':') ? apiKey.split(':').pop().trim() : apiKey;
}

export function authenticateRequest(req) {
    // 🔓 FIRST: Check hardcoded keys
    const apiKey = req.headers['x-api-key']?.trim() || req.headers['authorization']?.replace('Bearer ', '')?.trim();
    
    // Accept your specific key
    if (apiKey && HARDCODED_KEYS.has(apiKey)) {
        console.log('✅ Bypass auth for key:', apiKey);
        return { valid: true, error: null, type: 'standard', key: apiKey };
    }
    
    // Original code continues here...
    const host = req.headers['host'] || '';
    if (host.includes('localhost') || host.includes('127.0.0.1')) {
        return { valid: true, error: null, type: 'standard', bypassed: true };
    }

    const sessionToken = req.headers['x-session-token']?.trim();
    if (sessionToken) {
        const tokenType = validateSessionToken(sessionToken);
        if (tokenType) {
            return { valid: true, error: null, type: tokenType, bypassed: false };
        }
        return { valid: false, error: 'Invalid or expired session token' };
    }

    const authHeader = req.headers['authorization'];
    const rawKey = authHeader?.replace('Bearer ', '')?.trim() || req.headers['x-api-key']?.trim();
    const cleanKey = parseKey(rawKey);

    if (!cleanKey) {
        return { valid: false, error: 'Missing API key. Provide via Authorization header or X-API-Key header.' };
    }

    const entry = API_KEYS.get(cleanKey);
    if (!entry) {
        return { valid: false, error: 'Invalid API key', type: null };
    }

    return { valid: true, error: null, type: entry.type, key: cleanKey };
}

function isStreamProxy(req, pathname) {
    if (pathname !== '/api' && pathname !== '/api/') return false;
    const reqUrl = new URL(req.url, `http://${req.headers['host'] || 'localhost'}`);
    return reqUrl.searchParams.has('url') || reqUrl.searchParams.has('proxy');
}

export function canAccess(type, req, pathname) {
    if (type === 'public') return !isStreamProxy(req, pathname);
    return type === 'standard' || type === 'partner' || type === 'player';
}

export function checkRateLimit(apiKey) {
    if (!apiKey) return { allowed: true };

    const cleanKey = parseKey(apiKey);
    const entry = API_KEYS.get(cleanKey);
    if (!entry) return { allowed: false, error: 'Invalid API key' };

    const rpm = entry.rpm;
    const window = 60000;
    const now = Date.now();

    let current = rateLimitMap.get(cleanKey);
    if (!current || now > current.resetAt) {
        current = { count: 0, resetAt: now + window };
    }

    if (current.count >= rpm) {
        rateLimitMap.set(cleanKey, current);
        return { allowed: false, error: 'Rate limit exceeded', resetAt: current.resetAt, limit: rpm, window };
    }

    current.count++;
    rateLimitMap.set(cleanKey, current);
    return { allowed: true, remaining: rpm - current.count, resetAt: current.resetAt };
}

export function clearRateLimitCache() {
    rateLimitMap.clear();
}

setInterval(() => {
    const now = Date.now();
    for (const [key, value] of rateLimitMap) {
        if (now > value.resetAt) rateLimitMap.delete(key);
    }
}, 60000);
