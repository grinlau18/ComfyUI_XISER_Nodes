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
                backgroundColor = node.color || node.properties.color || "#333355"
            } = options;

            const textAreaTop = margin - TITLE_OFFSET;
            const maxWidth = node.size[0] - 2 * margin;
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

                if (!line.text) {
                    const emptyHeight = (line.font_size || 24) * lineHeightFactor;
                    currentY += emptyHeight;
                    const emptyGap = Math.max(line.margin_bottom || 0, MIN_PARAGRAPH_GAP);
                    currentY += emptyGap;
                    maxContentY = Math.max(maxContentY, currentY);
                    return;
                }

                this.setupFont(ctx, line);

                const wrappedLines = this.wrapText(ctx, line.text, maxWidth, line);

                const lineInlineGap = Math.max(line.inline_gap || MIN_LINE_GAP, MIN_LINE_GAP);
                wrappedLines.forEach((wrappedText, index) => {
                    const isLastLine = index === wrappedLines.length - 1;
                    const textWidth = ctx.measureText(wrappedText).width;
                    let xPos = margin + (line.margin_left || 0);

                    xPos = this.calculateTextPosition(xPos, textWidth, maxWidth, line, isLastLine, ctx, wrappedText);

                    this.drawTextDecoration(ctx, wrappedText, xPos, currentY, line, textWidth);

                    ctx.fillText(wrappedText, xPos, currentY);
                    currentY += (line.font_size || 24) * lineHeightFactor;

                    if (isLastLine) {
                        const lineMarginBottom = Math.max(line.margin_bottom || 0, line.is_block ? MIN_PARAGRAPH_GAP : MIN_LINE_GAP);
                        currentY += lineMarginBottom;
                    } else {
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

    /**
     * Wraps text to fit within max width.
     * @param {CanvasRenderingContext2D} ctx - The canvas context.
     * @param {string} text - The text to wrap.
     * @param {number} maxWidth - Maximum width for wrapping.
     * @param {Object} line - Line styling information.
     * @returns {string[]} Array of wrapped lines.
     */
    wrapText(ctx, text, maxWidth, line) {
        const words = text.match(/(\S+|\s+)/g) || [];
        let currentLine = "";
        let currentWidth = 0;
        const wrappedLines = [];

        for (const word of words) {
            const wordWidth = ctx.measureText(word).width;
            if (currentWidth + wordWidth <= maxWidth) {
                currentLine += word;
                currentWidth += wordWidth;
            } else {
                if (currentLine) wrappedLines.push(currentLine.trim());
                if (wordWidth > maxWidth) {
                    // Break long words
                    let tempWord = "";
                    let tempWidth = 0;
                    for (const char of word) {
                        const charWidth = ctx.measureText(char).width;
                        if (tempWidth + charWidth <= maxWidth) {
                            tempWord += char;
                            tempWidth += charWidth;
                        } else {
                            if (tempWord) wrappedLines.push(tempWord);
                            tempWord = char;
                            tempWidth = charWidth;
                        }
                    }
                    if (tempWord) wrappedLines.push(tempWord);
                    currentLine = "";
                    currentWidth = 0;
                } else {
                    currentLine = word;
                    currentWidth = wordWidth;
                }
            }
        }

        if (currentLine.trim()) wrappedLines.push(currentLine.trim());
        return wrappedLines;
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
    calculateTextPosition(xPos, textWidth, maxWidth, line, isLastLine, ctx, wrappedText) {
        const margin = 20;

        if (line.text_align === "center") {
            xPos = (maxWidth + 2 * margin - textWidth) / 2;
        } else if (line.text_align === "right") {
            xPos = maxWidth + 2 * margin - textWidth - margin - (line.margin_left || 0);
        } else if (line.text_align === "justify" && !isLastLine) {
            const wordsInLine = wrappedText.match(/(\S+)/g) || [wrappedText];
            if (wordsInLine.length > 1) {
                const totalWordWidth = wordsInLine.reduce((sum, word) => sum + ctx.measureText(word).width, 0);
                const spaceCount = wordsInLine.length - 1;
                const extraSpace = (maxWidth - totalWordWidth) / spaceCount;
                let currentX = margin + (line.margin_left || 0);
                wordsInLine.forEach((word, wordIndex) => {
                    ctx.fillText(word, currentX, 0); // Y position will be set later
                    currentX += ctx.measureText(word).width + (wordIndex < wordsInLine.length - 1 ? extraSpace : 0);
                });
                // Return original position since we handled positioning internally
                return margin + (line.margin_left || 0);
            }
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
        if ((line.text_decoration || "none").includes("underline") && text) {
            ctx.beginPath();
            ctx.strokeStyle = line.color || "#FFFFFF";
            ctx.lineWidth = 1;
            ctx.moveTo(xPos, yPos + line.font_size);
            ctx.lineTo(xPos + textWidth, yPos + line.font_size);
            ctx.stroke();
        }
    }

    /**
     * Sets up font for rendering.
     * @param {CanvasRenderingContext2D} ctx - The canvas context.
     * @param {Object} line - Line styling information.
     */
    setupFont(ctx, line) {
        const fontWeight = line.font_weight === "bold" || parseInt(line.font_weight) >= 700 ? "bold" : "normal";
        const fontKey = `${fontWeight}_${line.font_size}`;

        let font = this.fontCache.get(fontKey);
        if (!font) {
            font = `${fontWeight} ${line.font_size}px 'Consolas', 'Monaco', monospace`;
            this.fontCache.set(fontKey, font);

            // Limit cache size
            if (this.fontCache.size > 100) {
                this.fontCache.delete(this.fontCache.keys().next().value);
            }
        }

        ctx.font = font;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillStyle = line.color || "#FFFFFF";
    }

    /**
     * Clears the font cache.
     */
    clearFontCache() {
        this.fontCache.clear();
    }
}
