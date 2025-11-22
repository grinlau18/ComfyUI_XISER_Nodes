/**
 * HTML解析器模块
 */
import { logger } from '../core/logger.js';
import { DEFAULT_LINE_DATA, BLOCK_TAGS, ALLOWED_TAGS, DEFAULT_TEXT_DATA } from '../core/constants.js';

/**
 * Parses HTML-formatted text into structured line data.
 * @param {string} html - The input HTML string.
 * @returns {Object} Structured data with lines array.
 */
const HEADING_SIZES = {
    H1: 32,
    H2: 28,
    H3: 24,
    H4: 20,
    H5: 18,
    H6: 16
};

const LIST_BULLET = "• ";

const getListPrefix = (node) => {
    if (node.tagName !== "LI") return "";
    const parent = node.parentElement;
    if (!parent) return LIST_BULLET;
    if (parent.tagName === "OL") {
        const listItems = Array.from(parent.children).filter((child) => child.tagName === "LI");
        const index = listItems.indexOf(node);
        return index >= 0 ? `${index + 1}. ` : LIST_BULLET;
    }
    return LIST_BULLET;
};

const processContainer = (container) => {
    const lines = [];
    const processedNodes = new Set();

    const processNode = (node, depth = 0) => {
        if (processedNodes.has(node) || depth > 50) return;
        processedNodes.add(node);

        if (node.nodeType !== Node.ELEMENT_NODE || !ALLOWED_TAGS.includes(node.tagName)) return;

        if (node.tagName === "BR") {
            lines.push({
                ...DEFAULT_LINE_DATA,
                text: "",
                is_block: true
            });
            return;
        }

        const rawText = node.textContent.trim();
        let text = rawText;
        if (node.tagName === "LI") {
            text = getListPrefix(node) + text;
        }

        const inlineStyles = node.style;
        const computedStyles = window.getComputedStyle(node);
        const isBlock = BLOCK_TAGS.includes(node.tagName) || computedStyles.display === "block";

        if (isBlock) {
            const fontSize =
                HEADING_SIZES[node.tagName] ||
                parseInt(inlineStyles.fontSize || computedStyles.fontSize) ||
                DEFAULT_LINE_DATA.font_size;

            let marginLeft = parseInt(inlineStyles.marginLeft) || 0;
            if (!marginLeft && node.getAttribute("style")) {
                const styleMatch = node.getAttribute("style").match(/margin-left:\s*(\d+)px/i);
                marginLeft = styleMatch ? parseInt(styleMatch[1]) : 0;
            }

            let marginTop = parseInt(inlineStyles.marginTop) || 0;
            if (!marginTop && node.getAttribute("style")) {
                const styleMatch = node.getAttribute("style").match(/margin-top:\s*(\d+)px/i);
                marginTop = styleMatch ? parseInt(styleMatch[1]) : 0;
            }

            let marginBottom = parseInt(inlineStyles.marginBottom) || 0;
            if (!marginBottom && node.getAttribute("style")) {
                const styleMatch = node.getAttribute("style").match(/margin-bottom:\s*(\d+)px/i);
                marginBottom = styleMatch ? parseInt(styleMatch[1]) : 0;
            }

            lines.push({
                text,
                font_size: fontSize,
                color: inlineStyles.color || computedStyles.color || DEFAULT_LINE_DATA.color,
                font_weight: inlineStyles.fontWeight || computedStyles.fontWeight || DEFAULT_LINE_DATA.font_weight,
                text_decoration:
                    inlineStyles.textDecoration ||
                    computedStyles.textDecorationLine ||
                    computedStyles.textDecoration ||
                    DEFAULT_LINE_DATA.text_decoration,
                text_align: inlineStyles.textAlign || computedStyles.textAlign || DEFAULT_LINE_DATA.text_align,
                margin_left: marginLeft,
                margin_top: marginTop,
                margin_bottom: marginBottom,
                is_block: isBlock
            });
        }

        node.childNodes.forEach((child) => processNode(child, depth + 1));
    };

    container.childNodes.forEach((child) => processNode(child));
    return lines;
};

const parseHtmlString = (html) => {
    if (!html || typeof html !== "string") return null;
    const cleanedHtml = `<div style="margin:0;padding:0;">${html}</div>`;
    const parser = new DOMParser();
    const doc = parser.parseFromString(cleanedHtml, "text/html");
    const container = doc.body.firstElementChild || doc.body;
    const lines = processContainer(container);
    return lines.length ? { lines } : null;
};

export function parseHtmlFormat(html) {
    try {
        const parsed = parseHtmlString(html);
        if (parsed) {
            return parsed;
        }
        if (!html || typeof html !== "string") {
            logger.warn("Invalid or empty HTML input, falling back to default HTML text");
        } else {
            logger.warn("No lines parsed from HTML input, falling back to default HTML text");
        }
    } catch (e) {
        logger.error("Failed to parse HTML format:", e);
    }

    return parseHtmlString(DEFAULT_TEXT_DATA.HTML);
}

/**
 * Updates node's textData and background color, caching parsed results.
 * @param {Object} node - The node object.
 * @param {string} newColor - The new background color.
 */
export function updateTextDataBackground(node, newColor) {
    let textData = node.properties?.textData || DEFAULT_TEXT_DATA.HTML;
    if (textData.includes('<div style="background')) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(textData, "text/html");
        const container = doc.body.firstElementChild || doc.body;
        container.style.background = newColor;
        textData = container.outerHTML;
    }
    node.properties.textData = textData;
    node.properties.parsedTextData = parseHtmlFormat(textData);
}

/**
 * Updates node's textData and caches parsed results.
 * @param {Object} node - The node object.
 * @param {string} newText - The new text data.
 * @param {string} mode - The editor mode.
 */
export function updateTextData(node, newText, mode) {
    // Save HTML data separately
    node.properties.htmlData = newText;
    node.properties.parsedTextData = parseHtmlFormat(newText);
}
