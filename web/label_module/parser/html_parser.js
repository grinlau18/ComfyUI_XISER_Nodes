/**
 * HTML解析器模块
 */
import { logger } from '../core/logger.js';
import { DEFAULT_LINE_DATA, BLOCK_TAGS, ALLOWED_TAGS, DEFAULT_TEXT_DATA } from '../core/constants.js';

const LIST_CONTAINER_TAGS = ["UL", "OL"];

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

const trimSegmentEdgeWhitespace = (segments) => {
    if (!Array.isArray(segments) || !segments.length) {
        return segments || [];
    }

    const hasVisibleText = (text) => typeof text === "string" && text.trim().length > 0;

    while (segments.length && !hasVisibleText(segments[0].text)) {
        segments.shift();
    }

    while (segments.length && !hasVisibleText(segments[segments.length - 1].text)) {
        segments.pop();
    }

    if (!segments.length) {
        return segments;
    }

    segments[0].text = typeof segments[0].text === "string"
        ? segments[0].text.replace(/^\s+/, "")
        : segments[0].text;

    const lastIndex = segments.length - 1;
    segments[lastIndex].text = typeof segments[lastIndex].text === "string"
        ? segments[lastIndex].text.replace(/\s+$/, "")
        : segments[lastIndex].text;

    return segments;
};

const processContainer = (container) => {
    const lines = [];
    const processedNodes = new Set();

    const getSafeComputedStyles = (node) => {
        try {
            return window.getComputedStyle(node);
        } catch (e) {
            return node.style || {};
        }
    };

    const mergeInlineStyles = (baseStyles, node) => {
        const inlineStyles = node.style || {};
        const computedStyles = getSafeComputedStyles(node);
        const merged = {
            ...baseStyles,
            color: inlineStyles.color || computedStyles.color || baseStyles.color || DEFAULT_LINE_DATA.color,
            font_weight: inlineStyles.fontWeight || computedStyles.fontWeight || baseStyles.font_weight || DEFAULT_LINE_DATA.font_weight,
            font_style: inlineStyles.fontStyle || computedStyles.fontStyle || baseStyles.font_style || DEFAULT_LINE_DATA.font_style,
            text_decoration:
                inlineStyles.textDecoration ||
                computedStyles.textDecorationLine ||
                computedStyles.textDecoration ||
                baseStyles.text_decoration ||
                DEFAULT_LINE_DATA.text_decoration
        };

        if (node.tagName === "STRONG" || node.tagName === "B") {
            merged.font_weight = "bold";
        }

        if (node.tagName === "EM" || node.tagName === "I") {
            merged.font_style = "italic";
        }

        return merged;
    };

    const extractTextSegments = (node, baseStyles, allowBlockChildren = false) => {
        const segments = [];
        const mergedBase = baseStyles || {
            color: DEFAULT_LINE_DATA.color,
            font_weight: DEFAULT_LINE_DATA.font_weight,
            font_style: DEFAULT_LINE_DATA.font_style,
            text_decoration: DEFAULT_LINE_DATA.text_decoration
        };

        node.childNodes.forEach((child) => {
            if (child.nodeType === Node.TEXT_NODE) {
                const content = child.textContent;
                if (content) {
                    segments.push({
                        text: content,
                        ...mergedBase
                    });
                }
                return;
            }

            if (child.nodeType === Node.ELEMENT_NODE) {
                if (LIST_CONTAINER_TAGS.includes(child.tagName)) {
                    segments.push({
                        text: "\n",
                        ...mergedBase
                    });
                    return;
                }

                const childStyles = getSafeComputedStyles(child);
                const isBlockChild = BLOCK_TAGS.includes(child.tagName) || childStyles.display === "block";
                if (isBlockChild) {
                    segments.push({
                        text: "\n",
                        ...mergedBase
                    });
                    if (!allowBlockChildren) {
                        return;
                    }
                }

                if (child.tagName === "BR") {
                    segments.push({
                        text: "\n",
                        ...mergedBase
                    });
                    return;
                }

                const nextStyles = mergeInlineStyles(mergedBase, child);
                segments.push(...extractTextSegments(child, nextStyles, allowBlockChildren));
            }
        });

        if (!segments.length && node.textContent) {
            segments.push({
                text: node.textContent,
                ...mergedBase
            });
        }

        return segments;
    };

    const processNode = (node, depth = 0) => {
        if (processedNodes.has(node) || depth > 50) return;
        processedNodes.add(node);

        if (node.nodeType !== Node.ELEMENT_NODE || !ALLOWED_TAGS.includes(node.tagName)) return;

        if (LIST_CONTAINER_TAGS.includes(node.tagName)) {
            node.childNodes.forEach((child) => processNode(child, depth + 1));
            return;
        }

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
        const computedStyles = getSafeComputedStyles(node);
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

            const baseSegmentStyles = {
                color: inlineStyles.color || computedStyles.color || DEFAULT_LINE_DATA.color,
                font_weight: inlineStyles.fontWeight || computedStyles.fontWeight || DEFAULT_LINE_DATA.font_weight,
                font_style: inlineStyles.fontStyle || computedStyles.fontStyle || DEFAULT_LINE_DATA.font_style,
                text_decoration:
                    inlineStyles.textDecoration ||
                    computedStyles.textDecorationLine ||
                    computedStyles.textDecoration ||
                    DEFAULT_LINE_DATA.text_decoration
            };

            const allowBlockChildren = node.tagName === "LI";
            let segments = extractTextSegments(node, baseSegmentStyles, allowBlockChildren);
            segments = trimSegmentEdgeWhitespace(segments);
            const isMarkdownEmptyLine = node.hasAttribute && node.hasAttribute("data-md-empty-line");

            if (node.tagName === "LI") {
                const prefix = getListPrefix(node);
                if (prefix) {
                    segments.unshift({
                        text: prefix,
                        ...baseSegmentStyles
                    });
                }
            }

            const hasVisibleContent = isMarkdownEmptyLine || segments.some((segment) => segment.text && segment.text.trim() !== "");
            if (!hasVisibleContent && node.tagName !== "LI") {
                node.childNodes.forEach((child) => processNode(child, depth + 1));
                return;
            }

            const combinedText = segments.length ? segments.map((segment) => segment.text).join("") : text;

            lines.push({
                text: isMarkdownEmptyLine ? "" : (combinedText.trim() || text),
                font_size: fontSize,
                color: baseSegmentStyles.color,
                font_weight: baseSegmentStyles.font_weight,
                font_style: baseSegmentStyles.font_style || DEFAULT_LINE_DATA.font_style,
                text_decoration: baseSegmentStyles.text_decoration,
                text_align: inlineStyles.textAlign || computedStyles.textAlign || DEFAULT_LINE_DATA.text_align,
                margin_left: marginLeft,
                margin_top: marginTop,
                margin_bottom: marginBottom,
                is_block: isBlock,
                segments
            });
        }

        if (node.tagName === "LI") {
            node.childNodes.forEach((child) => {
                if (LIST_CONTAINER_TAGS.includes(child.tagName)) {
                    processNode(child, depth + 1);
                }
            });
        } else {
            node.childNodes.forEach((child) => processNode(child, depth + 1));
        }
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
export function updateTextDataBackground(node) {
    if (!node?.properties) {
        node.properties = {};
    }
    let textData = node.properties.htmlData || node.properties.textData || DEFAULT_TEXT_DATA.HTML;
    if (!textData || typeof textData !== "string") {
        textData = DEFAULT_TEXT_DATA.HTML;
    }
    node.properties.htmlData = textData;
    node.properties.textData = textData;
    node.properties.parsedTextData = parseHtmlFormat(textData);
    return node.properties.parsedTextData;
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
