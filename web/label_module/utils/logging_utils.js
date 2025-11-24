import { logger } from '../core/logger.js';

const DEFAULT_SCOPE = "LabelModule";

function formatMessage(scope, message) {
    return `[${scope || DEFAULT_SCOPE}] ${message}`;
}

export function logParserWarning(scope, message, error) {
    const text = formatMessage(scope, message);
    if (error) {
        logger.warn(text, error);
    } else {
        logger.warn(text);
    }
}

export function logParserError(scope, message, error) {
    const text = formatMessage(scope, message);
    if (error) {
        logger.error(text, error);
    } else {
        logger.error(text);
    }
}
