/**
 * Catalog module - proxies Cinemeta for discover section
 */

const { fetch } = require('undici');
const { createLogger } = require('./logger');

const log = createLogger('Catalog');
const CINEMETA_URL = 'https://v3-cinemeta.strem.io';

async function getCatalog(type, id, extra = {}) {
    try {
        log.info(`Catalog request: type=${type}, id=${id}, extra=${JSON.stringify(extra)}`);

        let path = `/catalog/${type}/top`;
        const parts = [];

        if (extra.search) {
            path = `/catalog/${type}/top/search=${encodeURIComponent(extra.search)}`;
        } else {
            if (extra.genre) parts.push(`genre=${encodeURIComponent(extra.genre)}`);
            if (extra.skip) parts.push(`skip=${extra.skip}`);
            if (parts.length > 0) path += `/${parts.join('&')}`;
        }

        path += '.json';
        const targetUrl = `${CINEMETA_URL}${path}`;
        log.debug(`Fetching from Cinemeta: ${targetUrl}`);

        const response = await fetch(targetUrl, { signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error(`Cinemeta returned ${response.status}`);

        const data = await response.json();
        return { metas: data.metas || [] };
    } catch (error) {
        log.error(`Catalog error: ${error.message}`);
        return { metas: [] };
    }
}

module.exports = { getCatalog };
