/**
 * Markdown解析器模块（简化版）
 * 直接将 Markdown 转为 HTML，再复用 HTML 解析逻辑。
 */
import { DEFAULT_TEXT_DATA } from '../core/constants.js';
import { parseHtmlFormat } from './html_parser.js';
import { logParserWarning, logParserError } from '../utils/logging_utils.js';

const defaultData = parseHtmlFormat(DEFAULT_TEXT_DATA.HTML);
const MARKDOWN_EMPTY_LINE_SENTINEL = '<div data-md-empty-line="true"></div>';
const EMBEDDED_HTML_TAGS = ["div", "section", "article", "main", "aside", "header", "footer", "center"];
const PARSER_SCOPE = "MarkdownParser";

export function parseMarkdownFormat(markdown) {
    try {
        if (!markdown || typeof markdown !== 'string') {
            logParserWarning(PARSER_SCOPE, "Invalid or empty Markdown input, using default text");
            return defaultData;
        }

        const html = markdownToHtml(markdown);
        const parsed = parseHtmlFormat(html);
        if (parsed?.lines?.length) {
            return parsed;
        }
    } catch (e) {
        logParserError(PARSER_SCOPE, "Failed to parse Markdown format, using default text", e);
    }
    return defaultData;
}

export function markdownToHtml(markdown, options = {}) {
    try {
        const preparedMarkdown = preprocessMarkdown(markdown, options);
        if (typeof window.marked !== 'undefined') {
            return window.marked.parse(preparedMarkdown);
        }
        logParserWarning(PARSER_SCOPE, "Marked.js missing, using basic Markdown converter");
        return basicMarkdownToHtml(preparedMarkdown);
    } catch (e) {
        logParserError(PARSER_SCOPE, "Failed to convert Markdown to HTML, using basic converter", e);
        return basicMarkdownToHtml(markdown);
    }
}

function basicMarkdownToHtml(markdown) {
    let html = markdown;
    html = html.replace(/^###### (.+)$/gm, '<h6>$1</h6>');
    html = html.replace(/^##### (.+)$/gm, '<h5>$1</h5>');
    html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/`(.*?)`/g, '<code>$1</code>');
    html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>');
    html = html.replace(/\n/g, '<br>');
    return html;
}

function preprocessMarkdown(markdown, options = {}) {
    const { skipEmbedded = false } = options;
    let text = markdown;
    if (!skipEmbedded) {
        text = normalizeEmbeddedHtmlBlocks(text);
    }
    return preserveMarkdownEmptyLines(text);
}

function normalizeEmbeddedHtmlBlocks(markdown) {
    const blockRegex = new RegExp(
        `<(${EMBEDDED_HTML_TAGS.join("|")})([^>]*)>([\\s\\S]*?)<\\/\\1>`,
        "gi"
    );

    return markdown.replace(blockRegex, (match, tag, attrs = "", inner = "") => {
        const trimmedInner = inner.trim();
        if (!trimmedInner) {
            return match;
        }
        const convertedInner = basicMarkdownToHtml(trimmedInner);
        const attributePart = attrs || "";
        return `<${tag}${attributePart}>${convertedInner}</${tag}>`;
    });
}

function preserveMarkdownEmptyLines(markdown) {
    const lines = markdown.split(/\r?\n/);
    let inFence = false;
    const fenceRegex = /^(```|~~~)/;

    const transformed = lines.map((line) => {
        const trimmed = line.trim();
        if (fenceRegex.test(trimmed)) {
            inFence = !inFence;
            return line;
        }
        if (!inFence && trimmed.length === 0) {
            return `${MARKDOWN_EMPTY_LINE_SENTINEL}\n`;
        }
        return line;
    });

    return transformed.join("\n");
}

export function updateMarkdownData(node, newMarkdown, mode) {
    node.properties.markdownData = newMarkdown;
    node.properties.parsedTextData = parseMarkdownFormat(newMarkdown);
}

export function updateMarkdownBackground(node) {
    if (!node?.properties) {
        node.properties = {};
    }
    let markdownText = node.properties.markdownData || node.properties.textData || DEFAULT_TEXT_DATA.MARKDOWN;
    if (!markdownText || typeof markdownText !== "string") {
        markdownText = DEFAULT_TEXT_DATA.MARKDOWN;
    }
    node.properties.markdownData = markdownText;
    node.properties.parsedTextData = parseMarkdownFormat(markdownText);
    return node.properties.parsedTextData;
}
