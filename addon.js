/**
 * Dizibox Stremio Addon Server
 * 
 * Provides Turkish-subtitled foreign series and films from dizibox.now
 * 
 * @author @tumni
 */

require('dotenv').config();

const { fetch } = require('undici');
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const express = require('express');
const { createLogger } = require('./logger');
const { findContent } = require('./search');
const { getVideoStream } = require('./scraper');
const { getCatalog } = require('./catalog');
const { ContentNotFoundError, ScrapingError, NetworkError } = require('./errors');

const log = createLogger('Addon');

const PORT = process.env.PORT || 7000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

const GENRE_OPTIONS = [
    'Action', 'Adventure', 'Animation', 'Biography', 'Comedy',
    'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy',
    'History', 'Horror', 'Mystery', 'Romance', 'Sci-Fi',
    'Sport', 'Thriller', 'War', 'Western'
];

const manifest = {
    id: 'community.dizibox',
    version: '1.0.0',
    name: 'Dizibox',
    description: 'Dizibox üzerinden Türkçe altyazılı yabancı dizi ve film izleyin.',
    types: ['series', 'movie'],
    idPrefixes: ['tt'],
    resources: ['stream', 'catalog'],
    catalogs: [
        {
            type: 'series',
            id: 'dizibox-series',
            name: 'Dizibox',
            extra: [
                { name: 'genre', isRequired: false, options: GENRE_OPTIONS },
                { name: 'skip', isRequired: false }
            ]
        },
        {
            type: 'movie',
            id: 'dizibox-movies',
            name: 'Dizibox',
            extra: [
                { name: 'genre', isRequired: false, options: GENRE_OPTIONS },
                { name: 'skip', isRequired: false }
            ]
        }
    ],
    logo: 'https://dizibox.now/wp-content/uploads/2026/03/diziboxfavicon.png',
    behaviorHints: {
        configurable: false,
        configurationRequired: false
    }
};

const builder = new addonBuilder(manifest);

/** Catalog handler */
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    return await getCatalog(type, id, extra);
});

/** Stream handler */
builder.defineStreamHandler(async ({ type, id }) => {
    const startTime = Date.now();
    log.info(`Stream request: ${type} - ${id}`);

    try {
        const [imdbId, season, episode] = id.split(':');

        if (!imdbId || !imdbId.startsWith('tt')) {
            log.warn(`Invalid IMDb ID: ${imdbId}`);
            return { streams: [] };
        }

        // Find content URL on Dizibox
        const content = await findContent(type, imdbId, season, episode);
        log.info(`Content found: ${content.url}`);

        // Extract video stream
        const result = await getVideoStream(content.url, content.title);

        const elapsed = Date.now() - startTime;
        log.info(`Returning ${result.streams.length} stream(s) for ${imdbId} (${elapsed}ms)`);

        return result;

    } catch (error) {
        const elapsed = Date.now() - startTime;

        if (error instanceof ContentNotFoundError) {
            log.info(`Content not found: ${error.query} (${elapsed}ms)`);
            return {
                streams: [{
                    name: 'Dizibox',
                    title: '❌ İçerik Bulunamadı\nBu içerik Dizibox\'ta mevcut değil.',
                    externalUrl: 'https://dizibox.now'
                }]
            };
        }

        if (error instanceof ScrapingError) {
            log.warn(`Scraping error (${elapsed}ms): ${error.message}`);
            return {
                streams: [{
                    name: 'Dizibox',
                    title: '⚠️ Video Yüklenemedi\nKaynak geçici olarak kullanılamıyor.',
                    externalUrl: 'https://dizibox.now'
                }]
            };
        }

        log.error(`Unexpected error (${elapsed}ms): ${error.message}`);
        return { streams: [] };
    }
});


// Build Express app
const addonRouter = getRouter(builder.getInterface());
const app = express();

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    next();
});

app.get('/proxy/m3u8', async (req, res) => {
    try {
        const { url, ref } = req.query;
        if (!url) return res.status(400).send('Missing url parameter');

        const videoUrl = Buffer.from(url, 'base64').toString('utf-8');
        const referer = ref ? Buffer.from(ref, 'base64').toString('utf-8') : '';
        const baseUrl = videoUrl.substring(0, videoUrl.lastIndexOf('/') + 1);

        log.info(`[Proxy] M3U8 requested: ${videoUrl}`);

        const response = await fetch(videoUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': referer,
                'Origin': referer ? new URL(referer).origin : ''
            }
        });

        if (!response.ok) return res.status(response.status).send('Failed to fetch m3u8');

        let content = await response.text();

        const proxyUrl = (originalUrl) => {
            const fullUrl = originalUrl.startsWith('http') ? originalUrl : baseUrl + originalUrl;
            const encodedUrl = Buffer.from(fullUrl).toString('base64');
            return `${BASE_URL}/proxy/stream?url=${encodedUrl}&ref=${ref}`;
        };

        content = content.split('\n').map(line => {
            const trimmed = line.trim();
            if (trimmed.includes('URI="')) {
                return trimmed.replace(/URI="([^"]+)"/g, (match, uri) => `URI="${proxyUrl(uri)}"`);
            }
            if (trimmed && !trimmed.startsWith('#')) {
                return proxyUrl(trimmed);
            }
            return line;
        }).join('\n');

        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.send(content);
    } catch (e) {
        log.error(`Proxy m3u8 error: ${e.message}`);
        res.status(500).send('Proxy error');
    }
});

app.get('/proxy/stream', async (req, res) => {
    try {
        const { url, ref } = req.query;
        if (!url) return res.status(400).send('Missing url parameter');

        const streamUrl = Buffer.from(url, 'base64').toString('utf-8');
        const referer = ref ? Buffer.from(ref, 'base64').toString('utf-8') : '';
        const baseUrl = streamUrl.substring(0, streamUrl.lastIndexOf('/') + 1);

        const response = await fetch(streamUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': referer,
                'Origin': referer ? new URL(referer).origin : ''
            }
        });

        if (!response.ok) return res.status(response.status).send('Failed to fetch stream');

        const contentType = response.headers.get('content-type') || '';
        const isM3u8 = streamUrl.endsWith('.m3u8') || streamUrl.endsWith('.txt') ||
            contentType.includes('mpegurl') || contentType.includes('m3u8');

        if (isM3u8) {
            let content = await response.text();
            const proxyUrl = (originalUrl) => {
                const fullUrl = originalUrl.startsWith('http') ? originalUrl : baseUrl + originalUrl;
                const encodedUrl = Buffer.from(fullUrl).toString('base64');
                return `${BASE_URL}/proxy/stream?url=${encodedUrl}&ref=${ref}`;
            };
            content = content.split('\n').map(line => {
                const trimmed = line.trim();
                if (trimmed.includes('URI="')) {
                    return trimmed.replace(/URI="([^"]+)"/g, (match, uri) => `URI="${proxyUrl(uri)}"`);
                }
                if (trimmed && !trimmed.startsWith('#')) {
                    return proxyUrl(trimmed);
                }
                return line;
            }).join('\n');
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            return res.send(content);
        }

        // Pipe video stream
        res.setHeader('Content-Type', contentType);
        const arrayBuffer = await response.arrayBuffer();
        res.send(Buffer.from(arrayBuffer));
    } catch (e) {
        log.error(`Proxy stream error: ${e.message}`);
        res.status(500).send('Proxy error');
    }
});

app.use('/', addonRouter);

app.listen(PORT, () => {
    log.info(`Dizibox Addon v${manifest.version} running at ${BASE_URL}/manifest.json`);
    log.info(`Author: @tumni`);
});
