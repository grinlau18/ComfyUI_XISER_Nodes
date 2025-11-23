/**
 * 文本渲染器模块
 */
import { logger } from '../core/logger.js';

const TITLE_OFFSET = 30;
const SCROLL_MARGIN = 10;
const MIN_VIEWPORT_HEIGHT = 30;
const SCROLLBAR_WIDTH = 6;
const SCROLLBAR_MIN_THUMB = 24;
const MIN_LINE_GAP = 3;
const MIN_PARAGRAPH_GAP = 6;
const MIN_CONTENT_WIDTH = 40;
const CONTENT_SCROLLBAR_GAP = 8;
const DEFAULT_FONT_COLOR = "#FFFFFF";
const DEFAULT_FONT_FAMILY = "'Consolas', 'Monaco', monospace";
const DEFAULT_FONT_STYLE = "normal";
const DEFAULT_FONT_WEIGHT = "normal";
const DEFAULT_FONT_SIZE = 24;

/**
 * Text renderer for drawing text on canvas.
 */
export class TextRenderer {
    constructor() {
        this.fontCache = new Map();
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
                contentPaddingRight = SCROLLBAR_WIDTH + CONTENT_SCROLLBAR_GAP
            } = options;

            const textAreaTop = margin - TITLE_OFFSET;
            const effectivePaddingRight = Math.max(0, contentPaddingRight);
            const maxWidth = Math.max(node.size[0] - 2 * margin - effectivePaddingRight, MIN_CONTENT_WIDTH);
            const viewportHeight = Math.max(node.size[1] + TITLE_OFFSET - margin * 2, MIN_VIEWPORT_HEIGHT);
            const scrollOffset = Math.max(0, node.properties?.scrollOffset || 0);

            const isMuteMode = node.mode === 2;
            const isPassMode = node.mode === 4 || node.flags?.bypassed === true;
            const finalAlpha = isMuteMode || isPassMode ? 0.5 : alpha;

            ctx.globalAlpha = finalAlpha;
            ctx.fillStyle = isPassMode ? "rgba(128, 0, 128, 0.5)" : backgroundColor;
            ctx.fillRect(0, -TITLE_OFFSET, node.size[0], node.size[1] + TITLE_OFFSET);

            ctx.globalAlpha = 1.0;

            let currentY = textAreaTop + margin;
            let maxContentY = currentY;

            ctx.save();
            ctx.beginPath();
            ctx.rect(margin, textAreaTop, maxWidth, viewportHeight);
            ctx.clip();
            ctx.translate(0, -scrollOffset);

            textData.lines.forEach(line => {
                const lineMarginTop = Math.max(line.margin_top || 0, MIN_LINE_GAP);
                currentY += lineMarginTop;

                if (!this.hasRenderableContent(line)) {
                    const emptyHeight = (line.font_size || DEFAULT_FONT_SIZE) * lineHeightFactor;
                    currentY += emptyHeight;
                    const emptyGap = Math.max(line.margin_bottom || 0, MIN_PARAGRAPH_GAP);
                    currentY += emptyGap;
                    maxContentY = Math.max(maxContentY, currentY);
                    return;
                }

                const wrappedLines = this.wrapLineSegments(ctx, line, maxWidth);
                const lineInlineGap = this.getLineInlineGap(line);

                wrappedLines.forEach((wrappedLine, index) => {
                    const isLastLine = index === wrappedLines.length - 1;
                    const textWidth = wrappedLine.width;
                    let xPos = margin + (line.margin_left || 0);

                    xPos = this.calculateTextPosition(xPos, textWidth, maxWidth, line, isLastLine, wrappedLine.text);

                    this.drawTextDecoration(ctx, wrappedLine.text, xPos, currentY, line, textWidth);
                    this.drawSegments(ctx, wrappedLine.segments, xPos, currentY, line);

                    currentY += (line.font_size || DEFAULT_FONT_SIZE) * lineHeightFactor;

                    if (isLastLine) {
                        const lineMarginBottom = Math.max(line.margin_bottom || 0, line.is_block ? MIN_PARAGRAPH_GAP : MIN_LINE_GAP);
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
            const clampedScroll = Math.min(maxScroll, scrollOffset);
            node.properties.scrollOffset = clampedScroll;
            node.properties.scrollContentHeight = contentHeight;
            node.properties.scrollViewportHeight = viewportHeight;
            const scrollbarActive = contentHeight > viewportHeight + 1;
            node.properties.scrollbarActive = scrollbarActive;

            if (scrollbarActive) {
                this.drawScrollbar(ctx, node, textAreaTop, viewportHeight, contentHeight, clampedScroll);
            }

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
    }

    hasRenderableContent(line) {
        if (Array.isArray(line?.segments)) {
            return line.segments.some(segment => typeof segment.text === "string" && segment.text.trim() !== "");
        }
        return typeof line?.text === "string" && line.text.trim() !== "";
    }

    getLineInlineGap(line) {
        if (typeof line.inline_gap === "number") {
            return Math.max(line.inline_gap, 0);
        }
        return line.is_block ? 0 : MIN_LINE_GAP;
    }

    prepareLineSegments(line) {
        if (Array.isArray(line?.segments) && line.segments.length) {
            return line.segments
                .filter(segment => typeof segment.text === "string")
                .map(segment => ({
                    text: segment.text,
                    color: segment.color || line.color,
                    font_weight: segment.font_weight || line.font_weight,
                    font_style: segment.font_style || line.font_style,
                    font_size: segment.font_size || line.font_size,
                    font_family: segment.font_family || line.font_family,
                    text_decoration: segment.text_decoration || line.text_decoration
                }));
        }

        if (typeof line?.text === "string" && line.text.length) {
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
                color: baseSegment.color || line.color || "#FFFFFF"
            };
            currentSegments.push(run);
            currentWidth += measurement.width;
            currentText += textValue;
        };

        const pushToken = (tokenValue, baseSegment) => {
            if (!tokenValue) return;
            const isWhitespace = /^\s+$/.test(tokenValue);
            if (isWhitespace && !currentSegments.length) {
                return;
            }

            const measurement = this.measureSegment(ctx, tokenValue, line, baseSegment);

            if (currentWidth + measurement.width <= maxWidth) {
                appendRun(tokenValue, baseSegment, measurement);
                return;
            }

            if (measurement.width > maxWidth) {
                const characters = Array.from(tokenValue);
                characters.forEach((char) => {
                    const charMeasurement = this.measureSegment(ctx, char, line, baseSegment);
                    if (currentWidth + charMeasurement.width > maxWidth && currentWidth > 0) {
                        pushLine();
                    }
                    appendRun(char, baseSegment, charMeasurement);
                });
                return;
            }

            if (currentSegments.length || currentText) {
                pushLine();
            }
            appendRun(tokenValue, baseSegment, measurement);
        };

        baseSegments.forEach((segment) => {
            const tokens = this.tokenizeSegmentText(segment.text);
            tokens.forEach((token) => {
                if (token.type === "newline") {
                    pushLine();
                    return;
                }
                pushToken(token.value, segment);
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

    drawSegments(ctx, segments, startX, yPos, line) {
        if (!segments?.length) {
            return;
        }

        let cursorX = startX;
        segments.forEach((segment) => {
            if (!segment.text) return;
            const fillColor = segment.color || line.color || DEFAULT_FONT_COLOR;
            if (segment.font) {
                ctx.font = segment.font;
            } else {
                const fontConfig = this.setupFont(ctx, line, segment);
                segment.font = fontConfig.font;
                segment.width = segment.width || ctx.measureText(segment.text).width;
            }
            ctx.fillStyle = fillColor;
            ctx.textAlign = "left";
            ctx.textBaseline = "top";
            ctx.fillText(segment.text, cursorX, yPos);
            cursorX += segment.width || 0;
        });
    }

    measureSegment(ctx, text, line, overrides = {}) {
        const fontConfig = this.setupFont(ctx, line, overrides);
        const width = ctx.measureText(text).width;
        return {
            width,
            font: fontConfig.font,
            fontWeight: fontConfig.fontWeight,
            fontStyle: fontConfig.fontStyle,
            fontSize: fontConfig.fontSize,
            fontFamily: fontConfig.fontFamily,
            color: overrides.color || line.color || DEFAULT_FONT_COLOR
        };
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
            fontFamily: fontFamilyValue
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
    }
}
