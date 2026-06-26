const BASE_URL = 'https://biavox.com';
const FOLDER = '2mg51giq8mspc';

import { getTmdbInfo } from '../utils/helpers.js';

function titleMatch(t1, y1, t2, y2) {
    if (!t1 || !t2) return false;
    const clean1 = t1.toLowerCase().replace(/[^a-z0-9]/g, '');
    const clean2 = t2.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (clean1 !== clean2 && !clean1.includes(clean2) && !clean2.includes(clean1)) return false;
    if (y1 && y2 && Math.abs(parseInt(y1) - parseInt(y2)) > 1) return false;
    return true;
}

export async function getStream(args) {
    const { id, s, e } = args;
    if (s || e) return null;

    try {
        const info = await getTmdbInfo(id, 'movie');
        if (!info || !info.titles || !info.titles.length) return null;
        const title = info.titles[0];
        const year = info.year;

        let matchLink = null;
        for (let offset = 0; offset < 300; offset += 30) {
            const apiRes = await fetch(`${BASE_URL}/${FOLDER}/api_films.php?folder=${FOLDER}&pr=biavox&offset=${offset}&limit=30`);
            if (!apiRes.ok) break;
            const data = await apiRes.json();
            if (!data.films || data.films.length === 0) break;

            for (const film of data.films) {
                const filmTitle = film.title.replace(/\(\d{4}\)/, '').trim();
                const filmYearMatch = film.title.match(/\((\d{4})\)/);
                const filmYear = filmYearMatch ? filmYearMatch[1] : null;
                if (titleMatch(title, year, filmTitle, filmYear)) {
                    matchLink = film.link;
                    break;
                }
            }
            if (matchLink) break;
        }

        if (!matchLink) return null;

        const pageRes = await fetch(matchLink.startsWith('/') ? BASE_URL + matchLink : matchLink, {
            headers: { 'Cookie': 'g=true', 'Referer': `${BASE_URL}/${FOLDER}/` }
        });
        const html = await pageRes.text();
        const iframeMatch = html.match(/src=["'](https?:\/\/sharecloudy\.com\/iframe\/[^"']+)["']/);
        if (!iframeMatch) return null;

        const iframeRes = await fetch(iframeMatch[1], {
            headers: { 'Referer': `${BASE_URL}/${FOLDER}/` }
        });
        const iframeHtml = await iframeRes.text();
        const m3u8Match = iframeHtml.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
        if (!m3u8Match) return null;

        return {
            url: m3u8Match[1].replace(/\\\//g, '/'),
            type: 'hls',
            headers: { 'Referer': iframeMatch[1], 'Origin': 'https://sharecloudy.com' }
        };
    } catch (err) {
        return null;
    }
}

export async function getSources(args) {
    const stream = await getStream(args);
    return stream ? [stream.url] : [];
}