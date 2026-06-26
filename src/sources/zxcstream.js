import crypto from 'crypto';

export const ID = "zxcstream";
export const DOMAIN = "https://z.zxcstream.xyz";
export const MULTI_URL = true;

const HEADERS = {
    'Origin': DOMAIN,
    'Referer': `${DOMAIN}/`
};

export const SERVERS = [
    { id: 'atlas_v2', name: 'atlas' },
    { id: 'icarus', name: 'icarus' },
    { id: 'orion', name: 'orion' },
    { id: 'zeus', name: 'talos' },
    { id: 'athena', name: 'athena' },
    { id: 'daedalus', name: 'daedalus' }
];

let currentSalt = "122333444455555666666777777788888888999999999";
let saltLastFetched = 0;
let _saltPromise = null;

async function fetchSalt() {
    if (Date.now() - saltLastFetched < 1000 * 60 * 60 * 12) return;
    if (_saltPromise) return _saltPromise;

    _saltPromise = (async () => {
        try {
            const res = await fetch(`${DOMAIN}/player/movie/220102`, { headers: HEADERS, signal: AbortSignal.timeout(5000) });
            const html = await res.text();
            const chunks = html.match(/_next\/static\/chunks\/[^\.]+\.js/g) || [];
            for (const chunk of chunks) {
                const jsRes = await fetch(`${DOMAIN}/${chunk}`, { signal: AbortSignal.timeout(5000) });
                const match = (await jsRes.text()).match(/="(\d+)",[a-zA-Z0-9$]+="rgrwsdsdfgwrwrwwr"/);
                if (match) {
                    currentSalt = match[1];
                    saltLastFetched = Date.now();
                    return;
                }
            }
        } catch (e) { }
    })().finally(() => {
        _saltPromise = null;
    });

    return _saltPromise;
}

async function generateTokens(tmdbId) {
    await fetchSalt();
    const t = Date.now();
    const xt = crypto.createHash('sha512').update(`${t}:${currentSalt}:${tmdbId}`).digest('hex').slice(0, 64);
    return { xt, t };
}

async function tryServer(serverObj, id, isTv, type, title, year, imdbId, s, e) {
    try {
        const { xt, t } = await generateTokens(id);
        const tokenRes = await fetch(`${DOMAIN}/backend/token`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...HEADERS },
            body: JSON.stringify({
                rgrwsdsdfgwrwrwwr: id,
                xfgdfgdsffgrwgrwyjhkjt: xt,
                rdghhdghhfssft: t
            }),
            signal: AbortSignal.timeout(7000)
        });

        if (!tokenRes?.ok) return null;
        const tokenData = await tokenRes.json();
        if (!tokenData.ZDDVHJFGHYRHG) return null;

        const params = new URLSearchParams({
            rgrwsdsdfgwrwrwwr: id,
            b: type,
            rdghhdghhfssft: tokenData.rdghhdghhfssft,
            ZDDVHJFGHYRHG: tokenData.ZDDVHJFGHYRHG,
            xfgdfgdsffgrwgrwyjhkjt: xt,
            TUKTHFSSFGDGHJS: title || "Unknown",
            "53653TRFG647GF": year || "2000",
            "564745ygtuy5yi75yuy": imdbId || "tt0000000"
        });

        if (isTv) {
            params.append('adkljfhdahfladhfjahfjlahfhfljkadfdf', s);
            params.append('546745ygy46ytfgty', e);
        }

        const serverRes = await fetch(`${DOMAIN}/backend/servers/${serverObj.id}?${params.toString()}`, {
            headers: HEADERS,
            signal: AbortSignal.timeout(7000)
        });

        if (!serverRes?.ok) return null;
        const serverData = await serverRes.json();

        if (serverData.success && serverData.links?.length > 0) {
            const hlsLink = serverData.links.find(l => l.type === 'hls' || l.link.includes('.m3u8'));
            if (hlsLink) {
                return {
                    url: hlsLink.link,
                    headers: HEADERS,
                    server: serverObj.name,
                    type: "hls",
                    skipVerify: true,
                    subtitles: serverData.subtitles ? serverData.subtitles.map(sub => ({
                        lang: sub.display,
                        url: sub.file
                    })) : []
                };
            }
        }
    } catch (err) { }
    return null;
}

export async function getStream(args) {
    const { id, s, e, title, server: serverName } = args;
    const isTv = s != null && e != null;
    const type = isTv ? 'tv' : 'movie';
    const year = "2000";
    const imdbId = "tt0000000";

    let targetServers = SERVERS;
    if (serverName && serverName !== 'all') {
        targetServers = SERVERS.filter(sv => sv.name === serverName);
        if (targetServers.length === 0) targetServers = SERVERS;
    }

    const settled = await Promise.allSettled(
        targetServers.map(sv => tryServer(sv, id, isTv, type, title, year, imdbId, s, e))
    );

    const allUrls = settled
        .filter(r => r.status === 'fulfilled' && r.value)
        .map(r => r.value);

    if (!allUrls.length) return null;

    return { allUrls };
}

export async function getSources(args) {
    const res = await getStream(args);
    return res ? res.allUrls.map(s => s.server) : [];
}