/**
 * Markdown解析器模块
 */
import { logger } from '../core/logger.js';
import { DEFAULT_LINE_DATA, DEFAULT_TEXT_DATA } from '../core/constants.js';
import { parseHtmlFormat } from './html_parser.js';

const DEFAULT_HTML_FALLBACK = parseHtmlFormat(DEFAULT_TEXT_DATA.HTML);
const defaultData = DEFAULT_HTML_FALLBACK;

/**
 * Parses Markdown-formatted text into structured line data.
 * @param {string} markdown - The input Markdown string.
 * @returns {Object} Structured data with lines array.
 */
export function parseMarkdownFormat(markdown) {
    try {
        if (!markdown || typeof markdown !== 'string') {
            logger.warn("Invalid or empty Markdown input, returning default data");
            return defaultData;
        }

        const convertedHtml = markdownToHtml(markdown);
        const parsedFromHtml = parseHtmlFormat(convertedHtml);
        if (parsedFromHtml?.lines?.length) {
            return parsedFromHtml;
        }

        return parseMarkdownWithHtml(markdown);
    } catch (e) {
        logger.error("Failed to parse Markdown format:", e);
        return defaultData;
    }
}

/**
 * Parses a single Markdown line and returns structured data.
 * @param {string} line - The Markdown line to parse.
 * @returns {Object} Structured line data.
 */
function parseMarkdownLine(line) {
    const baseLine = { ...DEFAULT_LINE_DATA };
    let text = line.trim();

    // Parse heading levels
    const headingMatch = text.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
        const [, hashes, content] = headingMatch;
        const level = hashes.length;
        return {
            ...baseLine,
            text: content,
            font_size: getHeadingFontSize(level),
            font_weight: "bold",
            is_block: true
        };
    }

    // Parse blockquotes
    const blockquoteMatch = text.match(/^>\s+(.+)$/);
    if (blockquoteMatch) {
        return {
            ...baseLine,
            text: blockquoteMatch[1],
            color: "#CCCCCC",
            font_style: "italic",
            margin_left: 20,
            is_block: true
        };
    }

    // Parse horizontal rules
    if (text.match(/^[-*_]{3,}$/)) {
        return {
            ...baseLine,
            text: "",
            is_block: true,
            is_separator: true
        };
    }

    // Enhanced inline formatting with better styling
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__(.*?)__/g, '<strong>$1</strong>');
    text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');
    text = text.replace(/_(.*?)_/g, '<em>$1</em>');
    text = text.replace(/`(.*?)`/g, '<code style="background:#2A2A2A;padding:2px 4px;border-radius:3px;font-family:monospace;">$1</code>');
    text = text.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" style="color:#4A90E2;text-decoration:underline;">$1</a>');

    // Handle lists with better formatting
    const listMatch = text.match(/^([\-\*\+]|\d+\.)\s+(.+)$/);
    if (listMatch) {
        return {
            ...baseLine,
            text: listMatch[2],
            margin_left: 20,
            is_block: true
        };
    }

    return {
        ...baseLine,
        text: text,
        is_block: true
    };
}

/**
 * Gets font size based on heading level.
 * @param {number} level - Heading level (1-6).
 * @returns {number} Font size.
 */
function getHeadingFontSize(level) {
    const sizes = [32, 28, 24, 20, 18, 16];
    return sizes[level - 1] || DEFAULT_LINE_DATA.font_size;
}

/**
 * Converts Markdown to HTML for rendering.
 * @param {string} markdown - The Markdown text.
 * @returns {string} HTML string.
 */
export function markdownToHtml(markdown) {
    try {
        if (typeof window.marked !== 'undefined') {
            return window.marked.parse(markdown);
        }
        logger.info("Marked.js not available, using basic converter");
        return basicMarkdownToHtml(markdown);
    } catch (e) {
        logger.error("Failed to convert Markdown to HTML:", e);
        return basicMarkdownToHtml(markdown);
    }
}

/**
 * Basic Markdown to HTML conversion (fallback).
 * @param {string} markdown - The Markdown text.
 * @returns {string} HTML string.
 */
function basicMarkdownToHtml(markdown) {
    let html = markdown;

    // Headings
    html = html.replace(/^###### (.+)$/gm, '<h6>$1</h6>');
    html = html.replace(/^##### (.+)$/gm, '<h5>$1</h5>');
    html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Bold and italic
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

    // Code
    html = html.replace(/`(.*?)`/g, '<code>$1</code>');

    // Links
    html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>');

    // Line breaks
    html = html.replace(/\n/g, '<br>');

    return html;
}

/**
 * Updates node's textData with Markdown content.
 * @param {Object} node - The node object.
 * @param {string} newMarkdown - The new Markdown text data.
 * @param {string} mode - The editor mode.
 */
export function updateMarkdownData(node, newMarkdown, mode) {
    // Save Markdown data separately
    node.properties.markdownData = newMarkdown;
    node.properties.parsedTextData = parseMarkdownFormat(newMarkdown);
}

/**
 * Enhanced Markdown parser with better HTML support.
 * @param {string} markdown - The Markdown text.
 * @returns {Object} Structured data with lines array.
 */
function parseMarkdownWithHtml(markdown) {
    const lines = markdown.split('\n');
    const parsedLines = [];
    let inHtmlBlock = false;
    let htmlBlockContent = [];

    for (const line of lines) {
        const trimmedLine = line.trim();

        // Detect HTML block start
        if (trimmedLine.startsWith('<') && !inHtmlBlock) {
            inHtmlBlock = true;
            htmlBlockContent = [trimmedLine];
            continue;
        }

        // Handle HTML block content
        if (inHtmlBlock) {
            htmlBlockContent.push(trimmedLine);

            // Detect HTML block end
            if (trimmedLine.endsWith('>') &&
                (trimmedLine.includes('</div>') ||
                 trimmedLine.includes('</p>') ||
                 trimmedLine.includes('</h') ||
                 trimmedLine.includes('</span>'))) {
                inHtmlBlock = false;

                // Parse the HTML block
                const htmlContent = htmlBlockContent.join('\n');
                try {
                    const htmlParsed = parseHtmlFormat(htmlContent);
                    if (htmlParsed.lines) {
                        parsedLines.push(...htmlParsed.lines);
                    }
                } catch (e) {
                    logger.warn("Failed to parse HTML block in Markdown:", e);
                    // Fallback to treating as regular text
                    parsedLines.push({
                        ...DEFAULT_LINE_DATA,
                        text: htmlContent,
                        is_block: true
                    });
                }
                htmlBlockContent = [];
            }
            continue;
        }

        // Handle regular Markdown lines
        if (!trimmedLine) {
            // Empty line
            parsedLines.push({
                ...DEFAULT_LINE_DATA,
                text: "",
                is_block: true
            });
        } else {
            const parsedLine = parseMarkdownLine(line);
            parsedLines.push(parsedLine);
        }
    }

    // Handle case where HTML block wasn't properly closed
    if (inHtmlBlock && htmlBlockContent.length > 0) {
        const htmlContent = htmlBlockContent.join('\n');
        try {
            const htmlParsed = parseHtmlFormat(htmlContent);
            if (htmlParsed.lines) {
                parsedLines.push(...htmlParsed.lines);
            }
        } catch (e) {
            logger.warn("Failed to parse unclosed HTML block:", e);
            parsedLines.push({
                ...DEFAULT_LINE_DATA,
                text: htmlContent,
                is_block: true
            });
        }
    }

    return parsedLines.length ? { lines: parsedLines } : defaultData;
}
