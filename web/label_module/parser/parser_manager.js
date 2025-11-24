/**
 * 解析器管理器
 */
import { logger } from '../core/logger.js';
import { EDITOR_MODES, DEFAULT_TEXT_DATA } from '../core/constants.js';
import { parseHtmlFormat, updateTextData, updateTextDataBackground } from './html_parser.js';
import { parseMarkdownFormat, updateMarkdownData, markdownToHtml, updateMarkdownBackground } from './markdown_parser.js';

/**
 * Parser manager for handling different text formats.
 */
export class ParserManager {
    constructor() {
        this.parsers = {
            [EDITOR_MODES.HTML]: {
                parse: parseHtmlFormat,
                update: updateTextData,
                updateBackground: updateTextDataBackground
            },
            [EDITOR_MODES.MARKDOWN]: {
                parse: parseMarkdownFormat,
                update: updateMarkdownData,
                updateBackground: updateMarkdownBackground
            }
        };
    }

    /**
     * Parses text data based on the specified mode.
     * @param {string} text - The text to parse.
     * @param {string} mode - The parser mode ('html' or 'markdown').
     * @returns {Object} Parsed data.
     */
    parse(text, mode = EDITOR_MODES.HTML) {
        const parser = this.parsers[mode];
        if (!parser) {
            logger.warn(`Unknown parser mode: ${mode}, falling back to HTML`);
            return this.parsers[EDITOR_MODES.HTML].parse(text);
        }
        return parser.parse(text);
    }

    /**
     * Updates node's text data based on the specified mode.
     * @param {Object} node - The node object.
     * @param {string} newText - The new text data.
     * @param {string} mode - The parser mode ('html' or 'markdown').
     */
    update(node, newText, mode = EDITOR_MODES.HTML) {
        const parser = this.parsers[mode];
        if (!parser) {
            logger.warn(`Unknown parser mode: ${mode}, falling back to HTML`);
            return this.parsers[EDITOR_MODES.HTML].update(node, newText);
        }
        const cacheKey = mode === EDITOR_MODES.HTML ? "htmlData" : "markdownData";
        node.properties.lastParsedSource = node.properties.lastParsedSource || {};
        node.properties.lastParsedResult = node.properties.lastParsedResult || {};

        if (node.properties.lastParsedSource[cacheKey] === newText) {
            const cachedResult = node.properties.lastParsedResult[cacheKey];
            if (cachedResult) {
                node.properties.parsedTextData = cachedResult;
                node.properties.parsedTextMode = mode;
                logger.debug(`[ParserManager] ${mode} text unchanged, reused cached parsed data`);
                return cachedResult;
            }
            logger.debug(`[ParserManager] ${mode} text unchanged but no cached parsed data, reparsing`);
        }

        const result = parser.update(node, newText, mode);
        node.properties.lastParsedSource[cacheKey] = newText;
        node.properties.lastParsedResult[cacheKey] = node.properties.parsedTextData;
        node.properties.parsedTextMode = mode;
        return result;
    }

    /**
     * Updates node's background color.
     * @param {Object} node - The node object.
     * @param {string} newColor - The new background color.
     * @param {string} mode - The parser mode ('html' or 'markdown').
     */
    updateBackground(node, newColor, mode = EDITOR_MODES.HTML) {
        if (!node?.properties) {
            node.properties = {};
        }
        if (newColor) {
            node.properties.color = newColor;
        }

        const normalizedMode = this.isValidMode(mode) ? mode : EDITOR_MODES.HTML;
        const parser = this.parsers[normalizedMode];
        if (!parser) {
            logger.warn(`Unknown parser mode: ${mode}, using HTML parser for refresh`);
            const fallbackText = node.properties.htmlData || this.getDefaultText(EDITOR_MODES.HTML);
            const parsed = this.parsers[EDITOR_MODES.HTML].parse(fallbackText);
            node.properties.parsedTextData = parsed;
            return parsed;
        }

        if (typeof parser.updateBackground === "function") {
            return parser.updateBackground(node, newColor);
        }

        const dataKey = normalizedMode === EDITOR_MODES.MARKDOWN ? "markdownData" : "htmlData";
        const text = node.properties?.[dataKey] || this.getDefaultText(normalizedMode);
        const parsed = parser.parse(text);
        node.properties.parsedTextData = parsed;
        return parsed;
    }

    /**
     * Converts text between formats.
     * @param {string} text - The text to convert.
     * @param {string} fromMode - Source mode.
     * @param {string} toMode - Target mode.
     * @returns {string} Converted text.
     */
    convert(text, fromMode, toMode) {
        if (fromMode === toMode) {
            return text;
        }

        if (fromMode === EDITOR_MODES.MARKDOWN && toMode === EDITOR_MODES.HTML) {
            return markdownToHtml(text);
        }

        // For HTML to Markdown conversion, we'd need a more sophisticated converter
        // For now, just return the text as-is
        logger.warn(`Conversion from ${fromMode} to ${toMode} not fully implemented`);
        return text;
    }

    /**
     * Gets the default text for a mode.
     * @param {string} mode - The parser mode.
     * @returns {string} Default text.
     */
    getDefaultText(mode) {
        const normalizedMode = (typeof mode === "string" ? mode.toLowerCase() : EDITOR_MODES.HTML);
        return (
            DEFAULT_TEXT_DATA[normalizedMode] ||
            DEFAULT_TEXT_DATA.html ||
            DEFAULT_TEXT_DATA[EDITOR_MODES.HTML]
        );
    }

    /**
     * Validates if a mode is supported.
     * @param {string} mode - The mode to validate.
     * @returns {boolean} True if supported.
     */
    isValidMode(mode) {
        return Object.values(EDITOR_MODES).includes(mode);
    }
}
