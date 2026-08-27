/**
 * Logger module - simple leveled logger
 */

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL] ?? LOG_LEVELS.info;

function pad(s, n) { return String(s).padStart(n, '0'); }

function timestamp() {
    const d = new Date();
    return `[${pad(d.getHours(),2)}:${pad(d.getMinutes(),2)}:${pad(d.getSeconds(),2)}]`;
}

function createLogger(name) {
    const prefix = `[${name}]`;
    return {
        debug: (...a) => CURRENT_LEVEL <= 0 && console.debug(timestamp(), 'DEBUG', prefix, ...a),
        info:  (...a) => CURRENT_LEVEL <= 1 && console.info(timestamp(),  'INFO ', prefix, ...a),
        warn:  (...a) => CURRENT_LEVEL <= 2 && console.warn(timestamp(),  'WARN ', prefix, ...a),
        error: (...a) => CURRENT_LEVEL <= 3 && console.error(timestamp(), 'ERROR', prefix, ...a),
    };
}

module.exports = { createLogger };
