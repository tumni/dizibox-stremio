/**
 * Custom error classes for Dizibox addon
 */

class ContentNotFoundError extends Error {
    constructor(message, query) {
        super(message);
        this.name = 'ContentNotFoundError';
        this.query = query;
        this.code = 'CONTENT_NOT_FOUND';
    }
}

class ScrapingError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ScrapingError';
        this.code = 'SCRAPING_ERROR';
    }
}

class NetworkError extends Error {
    constructor(message) {
        super(message);
        this.name = 'NetworkError';
        this.code = 'NETWORK_ERROR';
    }
}

module.exports = { ContentNotFoundError, ScrapingError, NetworkError };
