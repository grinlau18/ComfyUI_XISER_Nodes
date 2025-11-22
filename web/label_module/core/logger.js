/**
 * 日志工具模块
 */
import { LOG_LEVELS } from './constants.js';

let logLevel = LOG_LEVELS.DEBUG;

/**
 * Logger utility for consistent logging with levels.
 */
export const logger = {
    debug: (message, ...args) => logLevel >= LOG_LEVELS.DEBUG && console.debug(`[XIS_Label] ${message}`, ...args),
    info: (message, ...args) => logLevel >= LOG_LEVELS.INFO && console.info(`[XIS_Label] ${message}`, ...args),
    warn: (message, ...args) => logLevel >= LOG_LEVELS.WARN && console.warn(`[XIS_Label] ${message}`, ...args),
    error: (message, ...args) => logLevel >= LOG_LEVELS.ERROR && console.error(`[XIS_Label] ${message}`, ...args),
};

/**
 * Sets the logging level for the extension.
 * @param {number} level - Log level (0=error, 1=warn, 2=info, 3=debug).
 */
export function setLogLevel(level) {
    if (typeof level === 'number' && level >= LOG_LEVELS.ERROR && level <= LOG_LEVELS.DEBUG) {
        logLevel = level;
        logger.info(`Log level set to ${level}`);
    } else {
        logger.warn(`Invalid log level: ${level}. Keeping current level: ${logLevel}`);
    }
}

export function getLogLevel() {
    return logLevel;
}