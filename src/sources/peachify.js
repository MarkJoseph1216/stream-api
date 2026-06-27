const BASE_URL = 'https://peachify.top';
const MOVIEBOX_URL = 'https://uwu.eat-peach.sbs';
const API_URL = 'https://usa.eat-peach.sbs';

export const SERVERS = [
    { name: 'moviebox', url: `${MOVIEBOX_URL}/moviebox` },
    { name: 'holly', url: `${API_URL}/holly` },
    { name: 'air', url: `${API_URL}/air` },
    { name: 'multi', url: `${API_URL}/multi` },
    { name: 'net', url: `${MOVIEBOX_URL}/net` },
    { name: 'bmb', url: `${MOVIEBOX_URL}/bmb` },
];

const HEADERS = {
    Accept: 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: `${BASE_URL}/`,
    Origin: BASE_URL,
};

const STREAM_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Referer: `${BASE_URL}/`,
    Origin: BASE_URL,
};

export const SKIP_VERIFY = true;
export const MULTI_URL = true;

const THIRD_PARTY_PROXY_PATTERNS = [
    /^https:\/\/[^/]+\.workers\.dev\/(?:m3u8|mp4)-proxy\?url=(.+?)(?:&|$)/,
    /^https:\/\/[^/]+\.workers\.dev\/((?:https?:\/\/|https?%3A%2F%2F).+)$/,
    /\/(?:m3u8|mp4)-proxy\?url=(.+?)(?:&|$)/,
];

function unwrapProxyUrl(url) {
    for (const pattern of THIRD_PARTY_PROXY_PATTERNS) {
        const match = url.match(pattern);
        if (match) {
            let inner = match[1];
            try { inner = decodeURIComponent(inner); } catch { }
            try { inner = decodeURIComponent(inner); } catch { }
            if (inner.startsWith('http')) return { url: inner, wasWrapped: true };
        }
    }
    return { url, wasWrapped: false };
}

function base64UrlToBytes(value) {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    return new Uint8Array(Buffer.from(padded, 'base64'));
}

function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    return bytes;
}

let currentKeyHex = Buffer.from('YThmMmExYjVlOWM0NzA4MTRmNmIyYzNhNWQ4ZTdmOWMxYTJiM2M0ZDVlM2Y3YThiOGNhZDFlMmQwYTRkNWM1ZA==', 'base64').toString();
let keyLastFetched = 0;
const KEY_CACHE_TTL = 1000 * 60 * 60 * 12;
let keyFetchPromise = null;

export async function fetchKey(force = false) {
    if (!force && Date.now() - keyLastFetched < KEY_CACHE_TTL) return currentKeyHex;
    if (keyFetchPromise) return keyFetchPromise;

    keyFetchPromise = (async () => {
        try {
            const res = await fetch("https://peachify.top/", { headers: STREAM_HEADERS, signal: AbortSignal.timeout(10000) });
            const html = await res.text();
            const scriptMatches = html.match(/<script[^>]*src=["']([^"']+)["'][^>]*>/gi);
            if (!scriptMatches) return currentKeyHex;

            for (const match of scriptMatches) {
                const srcMatch = match.match(/src=["']([^"']+)["']/);
                if (!srcMatch) continue;
                const src = srcMatch[1];
                const jsUrl = src.startsWith('http') ? src : `https://peachify.top${src.startsWith('/') ? '' : '/'}${src}`;
                const jsRes = await fetch(jsUrl, { headers: STREAM_HEADERS, signal: AbortSignal.timeout(5000) });
                const js = await jsRes.text();

                const hexPat = /["']([0-9a-fA-F]{64})["']/g;
                let m;
                while ((m = hexPat.exec(js)) !== null) {
                    currentKeyHex = m[1];
                    keyLastFetched = Date.now();
                    return currentKeyHex;
                }
            }
        } catch (e) { } finally { keyFetchPromise = null; }
        return currentKeyHex;
    })();
    return keyFetchPromise;
}

async function decrypt(payload) {
    try {
        const parts = payload.split('.');
        if (parts.length < 2) return null;
        const iv = base64UrlToBytes(parts[0]);
        const ciphertext = base64UrlToBytes(parts[1]);
        const keyBytes = hexToBytes(currentKeyHex);
        const counterBlock = new Uint8Array(16);
        counterBlock.set(iv, 0);
        counterBlock[15] = 2;
        const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CTR' }, false, ['decrypt']);
        const decrypted = await crypto.subtle.decrypt({ name: 'AES-CTR', counter: counterBlock, length: 32 }, key, ciphertext);
        return JSON.parse(new TextDecoder().decode(decrypted));
    } catch { return null; }
}

function pickString(obj, keys) {
    for (const key of keys) {
        const val = obj[key];
        if (typeof val === 'string' && val.trim()) return val.trim();
    }
    return '';
}

function pickNumber(obj, keys) {
    for (const key of keys) {
        const val = obj[key];
        if (typeof val === 'number') return val;
    }
    return undefined;
}

async function fetchServer(serverBase, id, s, e, ua) {
    const targetUrl = s && e ? `${serverBase}/tv/${id}/${s}/${e}` : `${serverBase}/movie/${id}`;
    const res = await fetch(targetUrl, { headers: { ...HEADERS, 'User-Agent': ua }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    let body = await res.json();
    if (body.isEncrypted && body.data) {
        body = await decrypt(body.data);
    }
    if (!body || !Array.isArray(body.sources)) return null;
    return { rawSources: body.sources, rawSubtitles: body.subtitles || [] };
}

export async function getStream(args) {
    const { id, s, e, server: serverName } = args;
    await fetchKey();
    const ua = STREAM_HEADERS['User-Agent'];
    const serversToTest = serverName && serverName !== 'all' ? SERVERS.filter(srv => srv.name === serverName) : SERVERS;

    const results = await Promise.allSettled(serversToTest.map(srv => fetchServer(srv.url, id, s, e, ua).then(res => res ? { ...res, serverName: srv.name } : null)));

    const allSources = [];
    const seenUrls = new Set();

    for (const result of results) {
        if (result.status !== 'fulfilled' || !result.value) continue;
        const { rawSources, serverName: srvName } = result.value;

        for (const raw of rawSources) {
            const rawUrl = pickString(raw, ['url', 'src', 'file', 'stream', 'playbackUrl']);
            if (!rawUrl) continue;

            const { url } = unwrapProxyUrl(rawUrl);
            if (seenUrls.has(url)) continue;
            seenUrls.add(url);

            const rawType = pickString(raw, ['type', 'format']).toLowerCase();
            const type = rawType.includes('m3u8') || url.includes('.m3u8') ? 'hls' : 'mp4';
            const quality = pickNumber(raw, ['quality', 'resolution', 'height']);
            const rawHeaders = raw.headers || raw.header || raw.requestHeaders;
            const headers = { ...STREAM_HEADERS, ...(rawHeaders || {}) };

            allSources.push({ url, type, quality, headers, server: srvName, skipProxy: true, skipVerify: true, skipHlsCheck: true });
        }
    }

    if (allSources.length === 0) return null;
    return { allUrls: allSources };
}

export async function getSources(args) {
    const res = await getStream(args);
    if (!res || !res.allUrls) return [];
    return [...new Set(res.allUrls.map(u => u.server))];
}