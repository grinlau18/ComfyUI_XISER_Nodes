/**
 * 文本渲染器模块
 */
import { logger } from '../core/logger.js';
import { clamp, hasText } from '../utils/common_utils.js';

const TITLE_OFFSET = 30; // Space reserved for LiteGraph title bar.
const SCROLL_MARGIN = 12; // Padding applied between node edge and text area.
const MIN_VIEWPORT_HEIGHT = 30; // Ensures a minimum readable viewport height.
const SCROLLBAR_WIDTH = 6; // Width of the custom scrollbar.
const SCROLLBAR_MIN_THUMB = 24; // Minimum draggable thumb size for usability.
const MIN_LINE_GAP = 3; // Default spacing between inline lines.
const MIN_PARAGRAPH_GAP = 4; // Default spacing between block paragraphs.
const MIN_CONTENT_WIDTH = 40; // Avoid layout collapse on very narrow nodes.
const CONTENT_SCROLLBAR_GAP = 8; // Extra spacing between text and scrollbar.
const DEFAULT_FONT_COLOR = "#FFFFFF"; // Fallback text color.
const DEFAULT_FONT_FAMILY = "'Consolas', 'Monaco', monospace"; // Fallback font stack.
const DEFAULT_FONT_STYLE = "normal"; // Fallback font style.
const DEFAULT_FONT_WEIGHT = "normal"; // Fallback font weight.
const DEFAULT_FONT_SIZE = 24; // Fallback font size (px).

/**
 * Text renderer for drawing text on canvas.
 */
export class TextRenderer {
    constructor() {
        this.fontCache = new Map();
        this.measureCache = new Map();
    }

    /**
     * Renders text lines on canvas context.
     * @param {CanvasRenderingContext2D} ctx - The canvas context.
     * @param {Object} textData - The parsed text data.
     * @param {Object} node - The node object.
     * @param {Object} options - Rendering options.
     */
    render(ctx, textData, node, options = {}) {
        try {
            if (!textData?.lines) {
                logger.warn("Invalid textData, skipping rendering");
                return;
            }

            const {
                margin = SCROLL_MARGIN,
                lineHeightFactor = 1.2,
                alpha = 1.0,
                backgroundColor = node.color || node.properties.color || "#333355",
                contentPaddingRight = SCROLLBAR_WIDTH + CONTENT_SCROLLBAR_GAP,
                textScale = 0.5
            } = options;
            const clampedTextScale = clamp(textScale, 0.01, 2);
            const scaledMinLineGap = Math.max(1, MIN_LINE_GAP * clampedTextScale);
            const scaledMinParagraphGap = Math.max(1, MIN_PARAGRAPH_GAP * clampedTextScale);

            const textAreaTop = margin - TITLE_OFFSET;
            const effectivePaddingRight = Math.max(0, contentPaddingRight);
            const availableWidth = node.size[0] - 2 * margin - effectivePaddingRight;
            const maxWidth = Math.max(availableWidth, MIN_CONTENT_WIDTH);
            const viewportHeight = Math.max(node.size[1] + TITLE_OFFSET - margin * 2, MIN_VIEWPORT_HEIGHT);
            const scrollOffset = clamp(node.properties?.scrollOffset || 0, 0, Number.MAX_SAFE_INTEGER);

            const isMuteMode = node.mode === 2;
            const isPassMode = node.mode === 4 || node.flags?.bypassed === true;
            const finalAlpha = isMuteMode || isPassMode ? 0.5 : alpha;

            ctx.globalAlpha = finalAlpha;
            ctx.fillStyle = isPassMode ? "rgba(128, 0, 128, 0.5)" : backgroundColor;
            ctx.fillRect(0, -TITLE_OFFSET, node.size[0], node.size[1] + TITLE_OFFSET);

            ctx.globalAlpha = 1.0;

            let currentY = textAreaTop + margin;
            let maxContentY = currentY;

            const linkHitboxes = [];
            node.properties.linkHitboxes = linkHitboxes;

            ctx.save();
            ctx.beginPath();
            ctx.rect(margin, textAreaTop, maxWidth, viewportHeight);
            ctx.clip();
            ctx.translate(0, -scrollOffset);

            textData.lines.forEach(line => {
                const scaledLine = clampedTextScale === 1 ? line : this.scaleLine(line, clampedTextScale);
                const lineMarginTop = Math.max(scaledLine.margin_top || 0, scaledMinLineGap);
                currentY += lineMarginTop;

                if (!this.hasRenderableContent(scaledLine)) {
                    const baseSize = scaledLine.font_size || DEFAULT_FONT_SIZE;
                    const emptyHeight = scaledLine.is_markdown_empty_line
                        ? baseSize
                        : baseSize * lineHeightFactor;
                    currentY += emptyHeight;
                    const emptyGap = Math.max(
                        scaledLine.margin_bottom || 0,
                        scaledLine.is_markdown_empty_line ? scaledMinLineGap : scaledMinParagraphGap
                    );
                    currentY += emptyGap;
                    maxContentY = Math.max(maxContentY, currentY);
                    return;
                }

                const wrappedLines = this.wrapLineSegments(ctx, scaledLine, maxWidth);
                const lineInlineGap = this.getLineInlineGap(scaledLine, scaledMinLineGap);

                wrappedLines.forEach((wrappedLine, index) => {
                    const isLastLine = index === wrappedLines.length - 1;
                    const textWidth = wrappedLine.width;
                    let xPos = margin + (scaledLine.margin_left || 0);

                    xPos = this.calculateTextPosition(xPos, textWidth, maxWidth, scaledLine, isLastLine, wrappedLine.text);

                    this.drawTextDecoration(ctx, wrappedLine.text, xPos, currentY, scaledLine, textWidth);
                    this.drawSegments(ctx, wrappedLine.segments, xPos, currentY, scaledLine, linkHitboxes, scrollOffset);

                    currentY += (scaledLine.font_size || DEFAULT_FONT_SIZE) * lineHeightFactor;

                    if (isLastLine) {
                        const lineMarginBottom = Math.max(
                            scaledLine.margin_bottom || 0,
                            scaledLine.is_block ? scaledMinParagraphGap : scaledMinLineGap
                        );
                        currentY += lineMarginBottom;
                    } else if (lineInlineGap > 0) {
                        currentY += lineInlineGap;
                    }
                    maxContentY = Math.max(maxContentY, currentY);
                });
            });

            ctx.restore();

            const contentHeight = Math.max(maxContentY - textAreaTop, viewportHeight);
            const maxScroll = Math.max(contentHeight - viewportHeight, 0);
            const clampedScroll = clamp(scrollOffset, 0, maxScroll);
            node.properties.scrollOffset = clampedScroll;
            node.properties.scrollContentHeight = contentHeight;
            node.properties.scrollViewportHeight = viewportHeight;
            const scrollbarActive = contentHeight > viewportHeight + 1;
            node.properties.scrollbarActive = scrollbarActive;

            if (scrollbarActive) {
                node.properties.scrollbarRect = this.drawScrollbar(
                    ctx,
                    node,
                    textAreaTop,
                    viewportHeight,
                    contentHeight,
                    clampedScroll
                );
            } else {
                delete node.properties.scrollbarRect;
            }
            node.properties.contentMargin = margin;

        } catch (e) {
            logger.error("Error rendering text:", e);
        } finally {
            ctx.globalAlpha = 1.0;
        }
    }

    /**
     * Draws the scrollbar track/thumb.
     * @param {CanvasRenderingContext2D} ctx
     * @param {Object} node
     * @param {number} textAreaTop
     * @param {number} viewportHeight
     * @param {number} contentHeight
     * @param {number} scrollOffset
     */
    drawScrollbar(ctx, node, textAreaTop, viewportHeight, contentHeight, scrollOffset) {
        const trackX = node.size[0] - SCROLL_MARGIN - SCROLLBAR_WIDTH;
        const trackY = textAreaTop;
        const trackHeight = viewportHeight;
        const maxScroll = Math.max(contentHeight - viewportHeight, 1);
        const thumbHeight = Math.max((viewportHeight / contentHeight) * trackHeight, SCROLLBAR_MIN_THUMB);
        const scrollRatio = scrollOffset / maxScroll;
        const thumbY = trackY + scrollRatio * (trackHeight - thumbHeight);

        ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
        ctx.fillRect(trackX, trackY, SCROLLBAR_WIDTH, trackHeight);
        ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
        ctx.fillRect(trackX, thumbY, SCROLLBAR_WIDTH, thumbHeight);

        return {
            x: trackX,
            y: trackY,
            width: SCROLLBAR_WIDTH,
            height: trackHeight,
            thumbHeight
        };
    }

    hasRenderableContent(line) {
        if (Array.isArray(line?.segments)) {
            return line.segments.some(segment => hasText(segment.text));
        }
        return hasText(line?.text);
    }

    getLineInlineGap(line, defaultGap = MIN_LINE_GAP) {
        if (typeof line.inline_gap === "number") {
            return Math.max(line.inline_gap, 0);
        }
        return line.is_block ? 0 : Math.max(defaultGap, 0);
    }

    prepareLineSegments(line) {
        if (Array.isArray(line?.segments) && line.segments.length) {
            return line.segments
                .filter(segment => hasText(segment.text))
                .map(segment => ({
                    text: segment.text,
                    color: segment.color || line.color,
                    font_weight: segment.font_weight || line.font_weight,
                    font_style: segment.font_style || line.font_style,
                    font_size: segment.font_size || line.font_size,
                    font_family: segment.font_family || line.font_family,
                    text_decoration: segment.text_decoration || line.text_decoration,
                    link_href: segment.link_href || line.link_href
                }));
        }

        if (hasText(line?.text)) {
            return [{
                text: line.text,
                color: line.color,
                font_weight: line.font_weight,
                font_style: line.font_style,
                font_size: line.font_size,
                font_family: line.font_family,
                text_decoration: line.text_decoration
            }];
        }

        return [];
    }
    
    scaleLine(line, scale) {
        const scaled = {
            ...line,
            font_size: (line.font_size || DEFAULT_FONT_SIZE) * scale
        };
        if (typeof line.margin_top === "number") {
            scaled.margin_top = line.margin_top * scale;
        }
        if (typeof line.margin_bottom === "number") {
            scaled.margin_bottom = line.margin_bottom * scale;
        }
        if (typeof line.inline_gap === "number") {
            scaled.inline_gap = line.inline_gap * scale;
        }
        if (Array.isArray(line.segments)) {
            scaled.segments = line.segments.map(segment => ({
                ...segment,
                font_size: (segment.font_size || line.font_size || DEFAULT_FONT_SIZE) * scale
            }));
        }
        return scaled;
    }

    wrapLineSegments(ctx, line, maxWidth) {
        const baseSegments = this.prepareLineSegments(line);
        if (!baseSegments.length) {
            return [{
                text: "",
                width: 0,
                segments: []
            }];
        }

        const wrappedLines = [];
        let currentSegments = [];
        let currentWidth = 0;
        let currentText = "";

        const pushLine = () => {
            wrappedLines.push({
                text: currentText,
                width: currentWidth,
                segments: currentSegments
            });
            currentSegments = [];
            currentWidth = 0;
            currentText = "";
        };

        const appendRun = (textValue, baseSegment, measurement) => {
            const run = {
                text: textValue,
                width: measurement.width,
                font: measurement.font,
                font_weight: measurement.fontWeight,
                font_style: measurement.fontStyle,
                font_size: measurement.fontSize,
                font_family: measurement.fontFamily,
                color: baseSegment.color || line.color || "#FFFFFF",
                link_href: baseSegment.link_href,
                is_markdown_empty_line: baseSegment.is_markdown_empty_line
            };
            currentSegments.push(run);
            currentWidth += measurement.width;
            currentText += textValue;
        };

        const pushToken = (tokenValue, baseSegment, fontConfig) => {
            if (!tokenValue) return;
            const isWhitespace = /^\s+$/.test(tokenValue);
            if (isWhitespace && !currentSegments.length) {
                return;
            }

            const measurement = this.measureSegment(ctx, tokenValue, line, baseSegment, fontConfig);

            if (currentWidth + measurement.width <= maxWidth) {
                appendRun(tokenValue, baseSegment, measurement);
                return;
            }

            if (measurement.width > maxWidth) {
                let pendingRun = "";
                let pendingWidth = 0;
                const flushPending = () => {
                    if (!pendingRun) return;
                    appendRun(pendingRun, baseSegment, {
                        width: pendingWidth,
                        font: fontConfig.font,
                        fontWeight: fontConfig.fontWeight,
                        fontStyle: fontConfig.fontStyle,
                        fontSize: fontConfig.fontSize,
                        fontFamily: fontConfig.fontFamily
                    });
                    pendingRun = "";
                    pendingWidth = 0;
                };
                const characters = Array.from(tokenValue);
                characters.forEach((char) => {
                    const charMeasurement = this.measureSegment(ctx, char, line, baseSegment, fontConfig);
                    if (currentWidth + pendingWidth + charMeasurement.width > maxWidth && (currentWidth + pendingWidth) > 0) {
                        flushPending();
                        pushLine();
                    }
                    pendingRun += char;
                    pendingWidth += charMeasurement.width;
                });
                flushPending();
                return;
            }

            if (currentSegments.length || currentText) {
                pushLine();
            }
            appendRun(tokenValue, baseSegment, measurement);
        };

        baseSegments.forEach((segment) => {
            const segmentFontConfig = this.setupFont(ctx, line, segment);
            const tokens = this.tokenizeSegmentText(segment.text);
            tokens.forEach((token) => {
                if (token.type === "newline") {
                    pushLine();
                    return;
                }
                pushToken(token.value, segment, segmentFontConfig);
            });
        });

        if (currentSegments.length || currentText || !wrappedLines.length) {
            pushLine();
        }

        return wrappedLines;
    }

    tokenizeSegmentText(text = "") {
        const tokens = [];
        const parts = String(text).split(/(\r?\n)/);

        parts.forEach((part) => {
            if (part === "\r" || part === "\n" || part === "\r\n") {
                tokens.push({ type: "newline" });
                return;
            }

            if (!part) return;

            const subTokens = part.match(/(\S+|\s+)/g) || [];
            subTokens.forEach((token) => tokens.push({ type: "text", value: token }));
        });

        return tokens;
    }

    drawSegments(ctx, segments, startX, yPos, line, linkHitboxes = [], scrollOffset = 0) {
        if (!segments?.length) {
            return;
        }

        let cursorX = startX;
        segments.forEach((segment) => {
            if (!segment.text) return;
            const isLink = Boolean(segment.link_href);
            const fillColor = isLink ? (segment.color || DEFAULT_FONT_COLOR) : (segment.color || line.color || DEFAULT_FONT_COLOR);
            if (!segment.font) {
                const measurement = this.measureSegment(ctx, segment.text, line, segment);
                segment.font = measurement.font;
                segment.width = segment.width || measurement.width;
                segment.font_size = segment.font_size || measurement.fontSize;
            }
            ctx.font = segment.font;
            ctx.fillStyle = fillColor;
            ctx.textAlign = "left";
            ctx.textBaseline = "top";
            ctx.fillText(segment.text, cursorX, yPos);
            if (isLink) {
                this.drawLinkUnderline(ctx, cursorX, yPos, segment.width || 0, line, segment);
                this.recordLinkHitbox(linkHitboxes, cursorX, yPos - scrollOffset, segment.width || 0, segment.font_size || line.font_size || DEFAULT_FONT_SIZE, segment.link_href);
            }
            cursorX += segment.width || 0;
        });
    }

    measureSegment(ctx, text, line, overrides = {}, fontConfig) {
        const config = fontConfig || this.setupFont(ctx, line, overrides);
        ctx.font = config.font;
        const cacheKey = this.getMeasureCacheKey(config.fontKey, text);
        if (cacheKey && this.measureCache.has(cacheKey)) {
            return {
                width: this.measureCache.get(cacheKey),
                font: config.font,
                fontWeight: config.fontWeight,
                fontStyle: config.fontStyle,
                fontSize: config.fontSize,
                fontFamily: config.fontFamily,
                color: overrides.color || line.color || DEFAULT_FONT_COLOR
            };
        }

        const width = ctx.measureText(text).width;
        if (cacheKey) {
            this.measureCache.set(cacheKey, width);
            if (this.measureCache.size > 1000) {
                this.measureCache.delete(this.measureCache.keys().next().value);
            }
        }
        return {
            width,
            font: config.font,
            fontWeight: config.fontWeight,
            fontStyle: config.fontStyle,
            fontSize: config.fontSize,
            fontFamily: config.fontFamily,
            color: overrides.color || line.color || DEFAULT_FONT_COLOR
        };
    }

    getMeasureCacheKey(fontKey, text) {
        if (!fontKey || typeof text !== "string") {
            return null;
        }
        return `${fontKey}::${text}`;
    }

    /**
     * Calculates text position based on alignment.
     * @param {number} xPos - Current x position.
     * @param {number} textWidth - Width of the text.
     * @param {number} maxWidth - Maximum available width.
     * @param {Object} line - Line styling information.
     * @param {boolean} isLastLine - Whether this is the last line.
     * @param {CanvasRenderingContext2D} ctx - The canvas context.
     * @param {string} wrappedText - The text to position.
     * @returns {number} Calculated x position.
     */
    calculateTextPosition(xPos, textWidth, maxWidth, line) {
        const margin = 20;

        if (line.text_align === "center") {
            xPos = (maxWidth + 2 * margin - textWidth) / 2;
        } else if (line.text_align === "right") {
            xPos = maxWidth + 2 * margin - textWidth - margin - (line.margin_left || 0);
        }

        return Math.max(margin, Math.min(xPos, maxWidth + 2 * margin - textWidth));
    }

    /**
     * Draws text decorations (underline, etc.).
     * @param {CanvasRenderingContext2D} ctx - The canvas context.
     * @param {string} text - The text.
     * @param {number} xPos - X position.
     * @param {number} yPos - Y position.
     * @param {Object} line - Line styling information.
     * @param {number} textWidth - Width of the text.
     */
    drawTextDecoration(ctx, text, xPos, yPos, line, textWidth) {
        if ((line.text_decoration || "none").includes("underline") && text && textWidth > 0) {
            ctx.beginPath();
            ctx.strokeStyle = line.color || DEFAULT_FONT_COLOR;
            ctx.lineWidth = 1;
            const underlineOffset = (line.font_size || DEFAULT_FONT_SIZE);
            ctx.moveTo(xPos, yPos + underlineOffset);
            ctx.lineTo(xPos + textWidth, yPos + underlineOffset);
            ctx.stroke();
        }
    }

    drawLinkUnderline(ctx, xPos, yPos, width, line, segment) {
        if (!width) return;
        ctx.save();
        ctx.beginPath();
        ctx.strokeStyle = segment.color || line.color || DEFAULT_FONT_COLOR;
        ctx.lineWidth = 1;
        const underlineOffset = (segment.font_size || line.font_size || DEFAULT_FONT_SIZE);
        ctx.moveTo(xPos, yPos + underlineOffset);
        ctx.lineTo(xPos + width, yPos + underlineOffset);
        ctx.stroke();
        ctx.restore();
    }

    recordLinkHitbox(hitboxes, x, y, width, height, href) {
        if (!href || width <= 0 || height <= 0) return;
        hitboxes.push({
            href,
            x1: x,
            y1: y,
            x2: x + width,
            y2: y + height
        });
    }

    /**
     * Sets up font for rendering.
     * @param {CanvasRenderingContext2D} ctx - The canvas context.
     * @param {Object} line - Line styling information.
     */
    setupFont(ctx, line, overrides = {}) {
        const fontWeightValue = overrides.font_weight || line.font_weight || DEFAULT_FONT_WEIGHT;
        const fontStyleValue = overrides.font_style || line.font_style || DEFAULT_FONT_STYLE;
        const sizeValue = overrides.font_size ?? line.font_size ?? DEFAULT_FONT_SIZE;
        const numericSize = typeof sizeValue === "number" ? sizeValue : parseFloat(sizeValue);
        const fontSizeValue = Number.isFinite(numericSize) ? numericSize : DEFAULT_FONT_SIZE;
        const fontFamilyValue = overrides.font_family || line.font_family || DEFAULT_FONT_FAMILY;
        const normalizedWeight = this.normalizeFontWeight(fontWeightValue);
        const fontKey = `${fontStyleValue}_${normalizedWeight}_${fontSizeValue}_${fontFamilyValue}`;

        let font = this.fontCache.get(fontKey);
        if (!font) {
            font = `${fontStyleValue} ${normalizedWeight} ${fontSizeValue}px ${fontFamilyValue}`;
            this.fontCache.set(fontKey, font);

            // Limit cache size
            if (this.fontCache.size > 100) {
                this.fontCache.delete(this.fontCache.keys().next().value);
            }
        }

        ctx.font = font;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        return {
            font,
            fontWeight: normalizedWeight,
            fontStyle: fontStyleValue,
            fontSize: fontSizeValue,
            fontFamily: fontFamilyValue,
            fontKey
        };
    }

    normalizeFontWeight(value) {
        if (value === undefined || value === null) {
            return DEFAULT_FONT_WEIGHT;
        }

        const stringValue = value.toString().trim().toLowerCase();
        if (stringValue === "bold" || stringValue === "normal") {
            return stringValue;
        }

        const parsedWeight = parseInt(stringValue, 10);
        if (!isNaN(parsedWeight) && parsedWeight >= 100 && parsedWeight <= 900) {
            return parsedWeight.toString();
        }

        return DEFAULT_FONT_WEIGHT;
    }

    /**
     * Clears the font cache.
     */
    clearFontCache() {
        this.fontCache.clear();
        this.measureCache.clear();
    }
}
