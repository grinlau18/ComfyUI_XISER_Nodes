/**
 * HTML解析器模块
 */
import { DEFAULT_LINE_DATA, BLOCK_TAGS, ALLOWED_TAGS, DEFAULT_TEXT_DATA } from '../core/constants.js';
import { hasText } from '../utils/common_utils.js';
import { logParserWarning, logParserError } from '../utils/logging_utils.js';

const LIST_CONTAINER_TAGS = ["UL", "OL"];
const PARSER_SCOPE = "HTMLParser";
const DEFAULT_EMPTY_LINE_HEIGHT = 12;
const DEFAULT_LINK_COLOR = "#4A90E2";
const INLINE_COLOR_MAP = {
    A: DEFAULT_LINK_COLOR,
    STRONG: "#F1FA8C",
    B: "#F1FA8C",
    EM: "#FFB3CA",
    I: "#FFB3CA",
    CODE: "#FFB86C"
};
const BLOCK_MARGIN_DEFAULTS = {
    P: { top: 10, bottom: 10 },
    DIV: { top: 6, bottom: 6 },
    H1: { top: 20, bottom: 14 },
    H2: { top: 18, bottom: 12 },
    H3: { top: 16, bottom: 10 },
    H4: { top: 12, bottom: 8 },
    H5: { top: 10, bottom: 6 },
    H6: { top: 8, bottom: 4 },
    UL: { top: 8, bottom: 8 },
    OL: { top: 8, bottom: 8 },
    LI: { top: 4, bottom: 4 },
    BLOCKQUOTE: { top: 10, bottom: 10 }
};
const styleCache = typeof WeakMap !== "undefined" ? new WeakMap() : null;

function getMarkdownEmptyLineHeight() {
    const configured = typeof window !== "undefined"
        ? window?.XISER_CONFIG?.markdownEmptyLineHeight
        : undefined;
    const numeric = Number(configured);
    if (Number.isFinite(numeric) && numeric > 0) {
        return Math.min(200, Math.max(2, numeric));
    }
    return DEFAULT_EMPTY_LINE_HEIGHT;
}

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
        if (styleCache?.has?.(node)) {
            return styleCache.get(node);
        }
        let computed = {};
        try {
            computed = window.getComputedStyle(node);
        } catch (e) {
            computed = node.style || {};
        }
        const summary = {
            color: computed.color,
            fontWeight: computed.fontWeight,
            fontStyle: computed.fontStyle,
            textDecoration: computed.textDecorationLine || computed.textDecoration,
            textAlign: computed.textAlign,
            display: computed.display,
            marginLeft: computed.marginLeft,
            marginTop: computed.marginTop,
            marginBottom: computed.marginBottom
        };
        styleCache?.set?.(node, summary);
        return summary;
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

        const inlineColor = INLINE_COLOR_MAP[node.tagName];
        if (inlineColor && !inlineStyles.color && !baseStyles?.color) {
            merged.color = inlineColor;
        } else if (inlineColor && !inlineStyles.color) {
            merged.color = inlineColor;
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
                if (child.tagName === "A") {
                    const href = child.getAttribute("href") || "";
                    const linkSegments = extractTextSegments(child, nextStyles, allowBlockChildren).map(seg => ({
                        ...seg,
                        link_href: href,
                        color: seg.color || DEFAULT_LINK_COLOR,
                        text_decoration: seg.text_decoration || "underline"
                    }));
                    segments.push(...linkSegments);
                    return;
                }
                segments.push(...extractTextSegments(child, nextStyles, allowBlockChildren));
            }
        });

        if (!segments.length && hasText(node.textContent)) {
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

        const rawText = (node.textContent || "").trim();
        let text = rawText;
        if (node.tagName === "LI") {
            text = getListPrefix(node) + text;
        }

        const inlineStyles = node.style || {};
        const computedStyles = getSafeComputedStyles(node);
        const isBlock = BLOCK_TAGS.includes(node.tagName) || computedStyles.display === "block";

        if (isBlock) {
            const fontSize =
                HEADING_SIZES[node.tagName] ||
                parseInt(inlineStyles.fontSize || computedStyles.fontSize) ||
                DEFAULT_LINE_DATA.font_size;

            const marginDefaults = BLOCK_MARGIN_DEFAULTS[node.tagName] || {};
            const marginLeft = parseInt(inlineStyles.marginLeft || computedStyles.marginLeft) || 0;
            let marginTop = parseInt(inlineStyles.marginTop || computedStyles.marginTop) || 0;
            let marginBottom = parseInt(inlineStyles.marginBottom || computedStyles.marginBottom) || 0;
            if (!marginTop && marginDefaults.top) {
                marginTop = marginDefaults.top;
            }
            if (!marginBottom && marginDefaults.bottom) {
                marginBottom = marginDefaults.bottom;
            }
            const isSimpleBlock = node.childElementCount === 0;

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

            if (!inlineStyles.color) {
                if (node.tagName === "BLOCKQUOTE") {
                    baseSegmentStyles.color = "#A1A9C4";
                } else if (node.tagName === "CODE" || node.tagName === "PRE") {
                    baseSegmentStyles.color = INLINE_COLOR_MAP.CODE;
                }
            }

            const allowBlockChildren = node.tagName === "LI";
            let segments = isSimpleBlock
                ? [{ text: text, ...baseSegmentStyles }]
                : extractTextSegments(node, baseSegmentStyles, allowBlockChildren);
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

            const hasVisibleContent = isMarkdownEmptyLine || segments.some((segment) => hasText(segment.text));
            if (!hasVisibleContent && node.tagName !== "LI") {
                node.childNodes.forEach((child) => processNode(child, depth + 1));
                return;
            }

            const combinedText = segments.length ? segments.map((segment) => segment.text).join("") : text;

            lines.push({
                text: isMarkdownEmptyLine ? "" : (combinedText.trim() || text),
                font_size: isMarkdownEmptyLine ? getMarkdownEmptyLineHeight() : fontSize,
                color: baseSegmentStyles.color,
                font_weight: baseSegmentStyles.font_weight,
                font_style: baseSegmentStyles.font_style || DEFAULT_LINE_DATA.font_style,
                text_decoration: baseSegmentStyles.text_decoration,
                text_align: inlineStyles.textAlign || computedStyles.textAlign || DEFAULT_LINE_DATA.text_align,
                margin_left: marginLeft,
                margin_top: marginTop,
                margin_bottom: marginBottom,
                is_block: isBlock,
                segments,
                is_markdown_empty_line: isMarkdownEmptyLine
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
            logParserWarning(PARSER_SCOPE, "Invalid or empty HTML input, using default text");
        } else {
            logParserWarning(PARSER_SCOPE, "No lines parsed from HTML input, using default text");
        }
    } catch (e) {
        logParserError(PARSER_SCOPE, "Failed to parse HTML format, using default text", e);
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
