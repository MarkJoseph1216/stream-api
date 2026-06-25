import { getTmdbInfo } from '../utils/helpers.js';

const DEC_API = 'https://enc-dec.app/api/dec-videasy';
const VIDEASY_API = 'https://api.videasy.to';
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Referer': 'https://player.videasy.to/',
    'Origin': 'https://player.videasy.to'
};
const SERVERS = [
    'downloader2',
    'mb-flix',
    'cdn',
    '1movies',
    'm4uhd',
    'hdmovie',
    'lamovie',
    'superflix',
];

const BLOCKED_DOMAINS = ['easy.speedsterwave.app'];
const decCache = new Map();

async function resolveItsdeskmate(url) {
    try {
        if (!url.includes('go.itsdeskmate.com/mp4/')) return url;
        const encoded = url.split('/mp4/')[1];
        if (!encoded) return url;
        const decoded = Buffer.from(decodeURIComponent(encoded), 'base64').toString('utf8');
        const tokenMatch = decoded.match(/([A-Za-z0-9_\-]{8,})/);
        if (!tokenMatch) return url;
        const res = await fetch(`https://v.itsdeskmate.com/p/${tokenMatch[1]}`, {
            method: 'HEAD',
            redirect: 'follow',
            signal: AbortSignal.timeout(5_000),
            headers: { 'Referer': 'https://player.videasy.to/', 'User-Agent': HEADERS['User-Agent'] }
        });
        if (res.ok || res.status === 206) return `https://v.itsdeskmate.com/p/${tokenMatch[1]}`;
        return url;
    } catch { return url; }
}

function isBlockedUrl(url) { try { const urlObj = new URL(url); return BLOCKED_DOMAINS.some(domain => urlObj.hostname.includes(domain)); } catch { return false; } }

async function getImdbId(type, id, title, year) {
    try {
        const res = await fetch(`https://api.anyembed.xyz/api/meta?tmdb_id=${id}&title=${encodeURIComponent(title)}&year=${year}&type=${type}`);
        if (!res.ok) return '';
        const json = await res.json();
        return json.imdb_id ?? '';
    } catch { return ''; }
}

async function fetchServer(server, id, s, e, title, year, imdbId) {
    try {
        const type = s != null ? 'tv' : 'movie';
        const params = new URLSearchParams({
            title: title ?? '',
            mediaType: type,
            year: String(year ?? ''),
            tmdbId: String(id),
            imdbId: imdbId ?? '',
            episodeId: String(e ?? 1),
            seasonId: String(s ?? 1),
        });
        const url = `${VIDEASY_API}/${server}/sources-with-title?${params}`;
        const res = await fetch(url, { headers: HEADERS });
        if (!res?.ok) return [];
        const blob = await res.text();
        if (!blob || blob.length < 10) return [];
        const decRes = await fetch(DEC_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: blob, id: String(id) }) });
        if (!decRes?.ok) return [];
        const json = await decRes.json();
        if (json.status !== 200 || !json.result?.sources?.length) return [];
        return json.result.sources
            .filter(st => st?.url && !isBlockedUrl(st.url))
            .map(st => ({ url: st.url, headers: HEADERS }));
    } catch { return []; }
}

export async function getStream({ id, s, e }) {
    const info = await getTmdbInfo(id, s ? 'tv' : 'movie', s);
    const title = info.titles?.[0] ?? '';
    const year = info.year ?? '';
    const type = s ? 'tv' : 'movie';
    const imdbId = await getImdbId(type, id, title, year);
    const results = await Promise.all(SERVERS.map(async srv => {
        const urls = await fetchServer(srv, id, s, e, title, year, imdbId);
        return urls.length ? { server: srv, urls } : null;
    }));
    const valid = results.filter(Boolean);
    if (!valid.length) return null;
    const allUrls = valid.flatMap(r => r.urls.map(u => ({ ...u, label: r.server })));
    return { allUrls };
}