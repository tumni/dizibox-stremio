/**
 * Dizibox Scraper Module
 * 
 * Extracts video stream and subtitle URLs from Dizibox episode/film pages.
 * 
 * Flow:
 *   1. Fetch episode page → find iframe src
 *   2. Fetch iframe (ksdpictures.site or similar) → extract m3u8 + vtt
 *   3. Return Stremio-compatible stream object
 */

const { fetch } = require('undici');
const cheerio = require('cheerio');
const { createLogger } = require('./logger');
const { ScrapingError, NetworkError } = require('./errors');
const { getWorkingProxy, createProxyAgent, markProxyBad } = require('./proxy');

const log = createLogger('Scraper');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Fetch a URL with Referer header and proxy fallback.
 */
async function fetchWithReferer(url, referer = 'https://dizibox.now/', maxRetries = 2) {
    const fetchOptions = {
        headers: {
            'User-Agent': UA,
            'Accept': 'text/html,*/*',
            'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
            'Referer': referer,
            'Origin': 'https://dizibox.now',
            'Sec-Fetch-Mode': 'navigate',
        },
        signal: AbortSignal.timeout(8000),
    };

    // Phase 1: Direct fetch
    try {
        const r = await fetch(url, fetchOptions);
        if (r.status !== 403 && r.status !== 429 && r.status !== 503 && r.ok) {
            return await r.text();
        }
        log.warn(`Direct fetch failed (HTTP ${r.status}), falling back to proxy...`);
    } catch (err) {
        log.warn(`Direct fetch failed (${err.message}), falling back to proxy...`);
    }

    // Phase 2: Proxy fetch
    let lastErr;
    fetchOptions.signal = AbortSignal.timeout(10000);
    for (let i = 0; i < maxRetries; i++) {
        const proxy = await getWorkingProxy();
        if (!proxy) continue;

        try {
            fetchOptions.dispatcher = createProxyAgent(proxy);
            const r = await fetch(url, fetchOptions);
            
            if (r.status === 403 || r.status === 429 || r.status === 503) {
                markProxyBad(proxy);
                throw new Error(`IP Blocked: HTTP ${r.status}`);
            }
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            
            return await r.text();
        } catch (err) {
            lastErr = err;
            markProxyBad(proxy);
            log.warn(`Proxy fetch failed (${proxy.address}): ${err.message}`);
        }
    }
    throw new NetworkError(`Failed to fetch ${url} (Direct & Proxy failed): ${lastErr?.message}`);
}

/**
 * Extract iframe sources from Dizibox episode/film page.
 */
async function getIframeSources(pageUrl) {
    log.debug(`Fetching page: ${pageUrl}`);
    const html = await fetchWithReferer(pageUrl);
    const $ = cheerio.load(html);

    const sources = [];
    $('iframe').each((i, el) => {
        const src = $(el).attr('src') || $(el).attr('data-src') || '';
        if (src && src.startsWith('http') &&
            !src.includes('youtube') &&
            !src.includes('google') &&
            !src.includes('facebook') &&
            !src.includes('twitter')) {
            sources.push(src.trim());
            log.debug(`Found iframe: ${src.substring(0, 80)}`);
        }
    });

    // Also look for lazy-loaded iframes with data attributes
    $('[data-src*="http"]').each((i, el) => {
        const src = $(el).attr('data-src') || '';
        if (src && !sources.includes(src) &&
            !src.includes('youtube') && !src.includes('google')) {
            sources.push(src.trim());
        }
    });

    if (sources.length === 0) {
        throw new ScrapingError(`Sayfa yüklendi fakat video iframe bulunamadı: ${pageUrl}`);
    }

    return sources;
}

/**
 * Fetch an iframe page and extract video URL + subtitle URL.
 * Supports ksdpictures.site and similar embed services.
 * 
 * ksdpictures.site exposes: var SOURCE = "...m3u8"; var TRACKS = [...];
 */
async function extractVideoFromIframe(iframeSrc, referer) {
    log.debug(`Fetching iframe: ${iframeSrc.substring(0, 80)}`);
    const html = await fetchWithReferer(iframeSrc, referer);

    // 1. Primary: ksdpictures.site pattern - var SOURCE = "..."
    const sourceVar = html.match(/var\s+SOURCE\s*=\s*["'](https?[^"']+)['"]/);
    if (sourceVar) {
        const videoUrl = sourceVar[1];
        log.info(`SOURCE var found: ${videoUrl.substring(0, 80)}`);

        // Extract TRACKS array for subtitles
        const subtitles = extractTracksSubtitles(html);
        return { videoUrl, subtitles, provider: new URL(iframeSrc).hostname };
    }

    // 2. Fallback: generic m3u8 URL search
    const m3u8Match = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/);
    if (m3u8Match) {
        const videoUrl = m3u8Match[1];
        log.info(`M3U8 found (generic): ${videoUrl.substring(0, 80)}`);
        const subtitles = extractTracksSubtitles(html);
        return { videoUrl, subtitles, provider: new URL(iframeSrc).hostname };
    }

    // 3. Fallback: MP4
    const mp4Match = html.match(/(https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*)/);
    if (mp4Match) {
        const videoUrl = mp4Match[1];
        log.info(`MP4 found: ${videoUrl.substring(0, 80)}`);
        return { videoUrl, subtitles: [], provider: new URL(iframeSrc).hostname };
    }

    // 4. Fallback: "file" in JSON
    const fileMatch = html.match(/"file"\s*:\s*"(https?[^"]+)"/);
    if (fileMatch) {
        const videoUrl = fileMatch[1];
        log.info(`File config found: ${videoUrl.substring(0, 80)}`);
        const subtitles = extractTracksSubtitles(html);
        return { videoUrl, subtitles, provider: new URL(iframeSrc).hostname };
    }

    throw new ScrapingError(`Video URL iframe içinde bulunamadı: ${iframeSrc}`);
}

/**
 * Extract subtitles from ksdpictures.site TRACKS variable or VTT URLs.
 * Parses: var TRACKS = [{"file":"...vtt","label":"Türkçe","srclang":"tr","kind":"captions","default":true}]
 */
function extractTracksSubtitles(html) {
    const subtitles = [];

    // Try TRACKS variable first (ksdpictures.site format)
    const tracksMatch = html.match(/var\s+TRACKS\s*=\s*(\[[\s\S]*?\]);/);
    if (tracksMatch) {
        try {
            const tracks = JSON.parse(tracksMatch[1]);
            for (const track of tracks) {
                if (track.file && track.file.endsWith('.vtt')) {
                    const lang = track.srclang || (track.label?.includes('Türkçe') ? 'tur' : 'eng');
                    const id = lang === 'tr' ? 'tur' : lang;
                    if (!subtitles.find(s => s.url === track.file)) {
                        subtitles.push({ id, url: track.file, lang: id });
                        log.debug(`TRACKS subtitle: ${id} -> ${track.file.substring(0, 60)}`);
                    }
                }
            }
            if (subtitles.length > 0) return subtitles;
        } catch {
            // Fall through to VTT regex
        }
    }

    // Fallback: scan for .vtt URLs
    for (const m of html.matchAll(/(https?:\/\/[^\s"'<>]+\.vtt[^\s"'<>]*)/g)) {
        const url = m[1];
        let lang = 'tur';
        if (url.includes('_en') || url.includes('_eng')) lang = 'eng';
        else if (url.includes('_tr') || url.includes('_tur')) lang = 'tur';
        if (!subtitles.find(s => s.url === url)) {
            subtitles.push({ id: lang, url, lang });
            log.debug(`VTT subtitle: ${lang} -> ${url.substring(0, 60)}`);
        }
    }

    return subtitles;
}

/**
 * Convert scraped data to Stremio stream format.
 */
function toStremioStream(videoData, title) {
    const { videoUrl, subtitles, provider } = videoData;
    
    // Some ksdpictures links don't have .m3u8 in the URL but are HLS
    const isHls = videoUrl.includes('.m3u8') || provider.includes('ksdpictures');

    let streamUrl = videoUrl;

    if (isHls) {
        // Base64 encode params for our proxy
        const b64Url = Buffer.from(videoUrl).toString('base64');
        const b64Ref = Buffer.from(`https://${provider}/`).toString('base64');
        
        // Use our addon's proxy endpoint
        const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 7000}`;
        streamUrl = `${BASE_URL}/proxy/m3u8?url=${b64Url}&ref=${b64Ref}`;
    }

    const stream = {
        name: '📺 Dizibox',
        title: `${title}\n${provider}`,
        url: streamUrl,
        subtitles: subtitles.length > 0 ? subtitles : undefined,
        behaviorHints: {
            notWebReady: isHls ? true : false,
            bingeGroup: 'dizibox',
        },
    };

    return stream;
}

/**
 * Main function: get video stream from a Dizibox episode/film URL.
 * @param {string} pageUrl - Dizibox episode or film URL
 * @param {string} title - Content title (for display)
 * @returns {Promise<{streams: Array}>}
 */
async function getVideoStream(pageUrl, title) {
    // Get iframe sources from the page
    const iframeSources = await getIframeSources(pageUrl);
    log.info(`Found ${iframeSources.length} iframe source(s) on ${pageUrl}`);

    const streams = [];
    const errors = [];

    // Try each iframe source until we get a valid video
    for (const iframeSrc of iframeSources) {
        try {
            const videoData = await extractVideoFromIframe(iframeSrc, pageUrl);
            streams.push(toStremioStream(videoData, title));
            log.info(`Stream extracted from ${iframeSrc.substring(0, 60)}`);
            // Try all sources for multiple quality options
        } catch (err) {
            log.warn(`Failed to extract from ${iframeSrc.substring(0, 60)}: ${err.message}`);
            errors.push(err.message);
        }
    }

    if (streams.length === 0) {
        const errMsg = errors.join('; ');
        throw new ScrapingError(`Hiçbir kaynaktan video çıkarılamadı. Hatalar: ${errMsg}`);
    }

    return { streams };
}

module.exports = { getVideoStream };
