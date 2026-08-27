/**
 * Dizibox Search Module
 * 
 * Finds series/film pages on dizibox.now using title search.
 * Since Dizibox doesn't expose IMDb IDs, we resolve them via Cinemeta first.
 */

const { fetch } = require('undici');
const cheerio = require('cheerio');
const { createLogger } = require('./logger');
const { ContentNotFoundError, NetworkError } = require('./errors');
const { getWorkingProxy, createProxyAgent, markProxyBad } = require('./proxy');

const log = createLogger('Search');

const BASE_URL = 'https://dizibox.now';
const CINEMETA_URL = 'https://v3-cinemeta.strem.io';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const DEFAULT_HEADERS = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
};

/** Normalize a title for fuzzy matching */
function normalize(str) {
    return str.toLowerCase()
        .replace(/[^a-z0-9 ]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Fetch a URL with proxy rotation and retries */
async function fetchPage(url, extraHeaders = {}, maxRetries = 3) {
    let lastErr;
    for (let i = 0; i < maxRetries; i++) {
        const proxy = await getWorkingProxy();
        if (!proxy) continue;

        try {
            const dispatcher = createProxyAgent(proxy);
            const r = await fetch(url, {
                headers: { ...DEFAULT_HEADERS, ...extraHeaders },
                dispatcher,
                signal: AbortSignal.timeout(15000)
            });
            
            if (r.status === 403 || r.status === 429 || r.status === 503) {
                markProxyBad(proxy);
                throw new Error(`IP Blocked or Rate Limited: HTTP ${r.status}`);
            }
            if (!r.ok) {
                throw new Error(`HTTP ${r.status}`);
            }
            
            return await r.text();
        } catch (err) {
            lastErr = err;
            markProxyBad(proxy);
            log.warn(`Fetch attempt ${i + 1} failed for ${url} via ${proxy.address}: ${err.message}`);
        }
    }
    throw new NetworkError(`Failed to fetch ${url} after ${maxRetries} retries: ${lastErr?.message}`);
}

/**
 * Get title and year from Cinemeta by IMDb ID.
 * @param {string} type - 'movie' or 'series'
 * @param {string} imdbId - IMDb ID (tt...)
 */
async function getTitleFromCinemeta(type, imdbId) {
    const url = `${CINEMETA_URL}/meta/${type}/${imdbId}.json`;
    log.debug(`Fetching meta from Cinemeta: ${url}`);
    try {
        const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!r.ok) throw new Error(`Cinemeta HTTP ${r.status}`);
        const data = await r.json();
        return {
            title: data.meta?.name,
            year: data.meta?.year,
            imdbRating: data.meta?.imdbRating,
        };
    } catch (err) {
        log.warn(`Cinemeta lookup failed for ${imdbId}: ${err.message}`);
        return null;
    }
}

/**
 * Search Dizibox for a title and return content URL.
 * @param {string} title - Content title
 * @param {string} type - 'movie' or 'series'
 * @returns {Promise<{url: string, slug: string, type: string}>}
 */
async function searchDizibox(title, type) {
    const searchUrl = `${BASE_URL}/?s=${encodeURIComponent(title)}`;
    log.info(`Searching Dizibox: "${title}" (${type}) -> ${searchUrl}`);

    const html = await fetchPage(searchUrl);
    const $ = cheerio.load(html);

    const normalizedQuery = normalize(title);
    let bestMatch = null;
    let bestScore = 0;

    // Search results: articles, post cards, or episode links
    const candidates = [];

    // Direct dizi/film detail pages
    $('a[href*="/dizi/"], a[href*="/film/"]').each((i, el) => {
        const href = $(el).attr('href') || '';
        const text = ($(el).attr('title') || $(el).text()).trim();
        if (href && text) candidates.push({ href, text });
    });

    // Episode links — we'll use these to infer series URLs
    $('a[href*="-sezon-"]').each((i, el) => {
        const href = $(el).attr('href') || '';
        const text = ($(el).attr('title') || $(el).text()).trim();
        if (href && text) candidates.push({ href, text });
    });

    // Article titles (WordPress posts)
    $('article h2 a, article h3 a, .entry-title a, .post-title a').each((i, el) => {
        const href = $(el).attr('href') || '';
        const text = $(el).text().trim();
        if (href && text) candidates.push({ href, text });
    });

    log.debug(`Found ${candidates.length} candidates`);

    for (const { href, text } of candidates) {
        const normText = normalize(text.replace(/\d+\.\s*sezon.*/i, '').replace(/\d+\.\s*bölüm.*/i, ''));
        const score = similarity(normalizedQuery, normText);
        if (score > bestScore) {
            bestScore = score;
            bestMatch = { href, text };
        }
    }

    if (!bestMatch || bestScore < 0.4) {
        throw new ContentNotFoundError(
            `"${title}" Dizibox'ta bulunamadı (en iyi skor: ${bestScore.toFixed(2)})`,
            title
        );
    }

    log.info(`Best match: "${bestMatch.text}" (score: ${bestScore.toFixed(2)}) -> ${bestMatch.href}`);

    // Extract slug
    let diziboxUrl = bestMatch.href;
    let slug = '';

    if (diziboxUrl.includes('/dizi/')) {
        slug = diziboxUrl.split('/dizi/')[1].replace(/\/$/, '');
        return { url: diziboxUrl, slug, contentType: 'series' };
    } else if (diziboxUrl.includes('/film/')) {
        slug = diziboxUrl.split('/film/')[1].replace(/\/$/, '');
        return { url: diziboxUrl, slug, contentType: 'movie' };
    } else if (diziboxUrl.includes('-sezon-')) {
        // Extract slug from episode URL: /series-slug-N-sezon-N-bolum/
        const match = diziboxUrl.match(/\/([^/]+)-\d+-sezon-\d+-bolum/);
        if (match) {
            slug = match[1];
            return { url: `${BASE_URL}/dizi/${slug}/`, slug, contentType: 'series' };
        }
    }

    return { url: diziboxUrl, slug, contentType: type };
}

/**
 * Find the episode URL for a series.
 * @param {string} seriesSlug - Dizibox series slug
 * @param {number} season - Season number
 * @param {number} episode - Episode number
 */
async function findEpisodeUrl(seriesSlug, season, episode) {
    // Try common URL patterns
    const patterns = [
        `${BASE_URL}/${seriesSlug}-${season}-sezon-${episode}-bolum/`,
        `${BASE_URL}/${seriesSlug}-${season}-sezon-${episode}-bolum-hd2/`,
        `${BASE_URL}/${seriesSlug}-${season}-sezon-${episode}-bolum-izle/`,
    ];

    for (const url of patterns) {
        log.debug(`Trying episode URL: ${url}`);
        try {
            const r = await fetch(url, {
                headers: DEFAULT_HEADERS,
                signal: AbortSignal.timeout(8000),
            });
            if (r.ok) {
                const html = await r.text();
                // Make sure it's actually an episode page (has an iframe)
                if (html.includes('iframe') && html.includes('ksdpictures') || html.includes('vplayer')) {
                    log.info(`Episode URL found: ${url}`);
                    return url;
                }
            }
        } catch {
            // try next
        }
    }

    // Fallback: get series page and find episode link
    log.info(`Pattern not found, searching series page for S${season}E${episode}`);
    return findEpisodeFromSeriesPage(seriesSlug, season, episode);
}

/**
 * Navigate the series page to find a specific episode link.
 */
async function findEpisodeFromSeriesPage(slug, season, episode) {
    const seriesUrl = `${BASE_URL}/dizi/${slug}/`;
    const html = await fetchPage(seriesUrl);
    const $ = cheerio.load(html);

    // Look for episode link matching season/episode
    let found = null;
    $('a[href*="-sezon-"]').each((i, el) => {
        const href = $(el).attr('href') || '';
        const match = href.match(/-(\d+)-sezon-(\d+)-bolum/);
        if (match) {
            const s = parseInt(match[1]);
            const e = parseInt(match[2]);
            if (s === season && e === episode) {
                found = href;
                return false; // break
            }
        }
    });

    if (!found) {
        throw new ContentNotFoundError(`S${season}E${episode} bulunamadı (slug: ${slug})`, slug);
    }

    return found;
}

/**
 * Main function: find content URL on Dizibox given IMDb ID.
 */
async function findContent(type, imdbId, season, episode) {
    // 1. Get title from Cinemeta
    const meta = await getTitleFromCinemeta(type, imdbId);
    if (!meta || !meta.title) {
        throw new ContentNotFoundError(`IMDb ID ${imdbId} için başlık bulunamadı`, imdbId);
    }

    log.info(`Resolved IMDb ${imdbId} -> "${meta.title}" (${meta.year})`);

    // 2. Search Dizibox
    const result = await searchDizibox(meta.title, type);

    // 3. For series, get specific episode URL
    if (type === 'series' && season && episode) {
        const episodeUrl = await findEpisodeUrl(result.slug, parseInt(season), parseInt(episode));
        return { url: episodeUrl, title: meta.title, slug: result.slug };
    }

    return { url: result.url, title: meta.title, slug: result.slug };
}

/**
 * Simple Jaccard similarity between two strings.
 */
function similarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;

    // Check if one contains the other
    if (a.includes(b) || b.includes(a)) return 0.85;

    const setA = new Set(a.split(' ').filter(w => w.length > 1));
    const setB = new Set(b.split(' ').filter(w => w.length > 1));
    if (setA.size === 0 || setB.size === 0) return 0;

    const intersection = new Set([...setA].filter(x => setB.has(x)));
    const union = new Set([...setA, ...setB]);

    return intersection.size / union.size;
}

module.exports = { findContent, getTitleFromCinemeta };
