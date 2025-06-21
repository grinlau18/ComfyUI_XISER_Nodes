import { app } from "/scripts/app.js";

// Set of loaded resources to prevent duplicate loading
const loadedResources = new Set();

/**
 * Logger utility for consistent logging with levels.
 * @type {{debug: Function, info: Function, warn: Function, error: Function}}
 */
const logger = {
    debug: (message, ...args) => logLevel >= 3 && console.debug(`[XIS_Label] ${message}`, ...args),
    info: (message, ...args) => logLevel >= 2 && console.info(`[XIS_Label] ${message}`, ...args),
    warn: (message, ...args) => logLevel >= 1 && console.warn(`[XIS_Label] ${message}`, ...args),
    error: (message, ...args) => logLevel >= 0 && console.error(`[XIS_Label] ${message}`, ...args),
};

// Log level: 0=error, 1=warn, 2=info, 3=debug
let logLevel = 2; // Default to info level

/**
 * Sets the logging level for the extension.
 * @param {number} level - Log level (0=error, 1=warn, 2=info, 3=debug).
 */
function setLogLevel(level) {
    if (typeof level === 'number' && level >= 0 && level <= 3) {
        logLevel = level;
        logger.info(`Log level set to ${level}`);
    } else {
        logger.warn(`Invalid log level: ${level}. Keeping current level: ${logLevel}`);
    }
}

/**
 * Loads a JavaScript script with caching, CDN fallback, and retries.
 * @param {string} src - The script URL.
 * @param {string} [fallbackSrc] - Fallback CDN URL.
 * @param {number} [retries=2] - Number of retries.
 * @returns {Promise<void>} Resolves when loaded, rejects on failure.
 */
async function loadScript(src, fallbackSrc, retries = 2) {
    if (loadedResources.has(src)) {
        logger.debug(`Script already loaded: ${src}`);
        return Promise.resolve();
    }
    for (let i = 0; i < retries; i++) {
        try {
            await new Promise((resolve, reject) => {
                const script = document.createElement("script");
                script.type = "application/javascript";
                script.src = src;
                script.onload = () => {
                    loadedResources.add(src);
                    resolve();
                };
                script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
                document.head.appendChild(script);
            });
            return;
        } catch (e) {
            if (i === retries - 1 && fallbackSrc) {
                logger.warn(`Retrying with fallback: ${fallbackSrc}`);
                await loadScript(fallbackSrc);
                return;
            }
        }
    }
    throw new Error(`Failed to load script after retries: ${src}`);
}

/**
 * Loads a CSS stylesheet with caching and CDN fallback.
 * @param {string} href - The CSS URL.
 * @param {string} [fallbackHref] - Fallback CDN URL.
 * @returns {Promise<void>} Resolves when loaded or on fallback success.
 */
function loadCss(href, fallbackHref) {
    if (loadedResources.has(href)) {
        logger.debug(`CSS already loaded: ${href}`);
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        if (!navigator.onLine) {
            loadedResources.add(href);
            logger.info(`Offline mode, skipping CSS load: ${href}`);
            resolve();
            return;
        }
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.type = "text/css";
        link.href = href;
        link.onload = () => {
            loadedResources.add(href);
            resolve();
        };
        link.onerror = () => {
            if (fallbackHref) {
                logger.warn(`CSS load failed, trying fallback: ${fallbackHref}`);
                loadCss(fallbackHref).then(resolve).catch(reject);
            } else {
                loadedResources.add(href);
                logger.info(`No fallback for CSS, continuing: ${href}`);
                resolve();
            }
        };
        document.head.appendChild(link);
    });
}

/**
 * Asynchronously loads CodeMirror resources in sequence, with fonts being optional.
 * @returns {Promise<void>} Resolves when all critical resources are loaded.
 */
async function loadCodeMirrorResources() {
    const criticalResources = [
        {
            type: "script",
            src: "/extensions/ComfyUI_XISER_Nodes/lib/codemirror/codemirror.js",
            fallback: "https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.17/codemirror.min.js"
        },
        {
            type: "css",
            src: "/extensions/ComfyUI_XISER_Nodes/lib/codemirror/codemirror.css",
            fallback: "https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.17/codemirror.min.css"
        },
        {
            type: "script",
            src: "/extensions/ComfyUI_XISER_Nodes/lib/codemirror/htmlmixed.js",
            fallback: "https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.17/mode/htmlmixed/htmlmixed.min.js"
        },
        {
            type: "css",
            src: "/extensions/ComfyUI_XISER_Nodes/lib/codemirror/theme/dracula.css",
            fallback: "https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.17/theme/dracula.min.css"
        }
    ];
    const optionalResources = [
        {
            type: "css",
            src: "https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500&display=swap",
            fallback: null
        }
    ];

    // Load critical resources sequentially to ensure dependencies
    for (const res of criticalResources) {
        try {
            if (res.type === "script") {
                await loadScript(res.src, res.fallback);
                logger.info(`Loaded script: ${res.src}`);
            } else {
                await loadCss(res.src, res.fallback);
                logger.info(`Loaded CSS: ${res.src}`);
            }
        } catch (e) {
            logger.error(`Failed to load resource: ${res.src}`, e);
            throw e;
        }
    }

    // Load optional resources in parallel
    await Promise.all(
        optionalResources.map(res =>
            res.type === "script"
                ? loadScript(res.src, res.fallback).catch(e => logger.warn(`Failed to load optional script: ${res.src}`, e))
                : loadCss(res.src, res.fallback).catch(e => logger.warn(`Failed to load optional CSS: ${res.src}`, e))
        )
    );
}

// Singleton CodeMirror editor instance
let codeMirrorInstance = null;

/**
 * Debounces a function to limit execution rate.
 * @param {Function} fn - The function to debounce.
 * @param {number} wait - The wait time in milliseconds.
 * @returns {Function} The debounced function.
 */
function debounce(fn, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn.apply(this, args), wait);
    };
}

/**
 * Parses HTML-formatted text into structured line data.
 * @param {string} html - The input HTML string.
 * @returns {Object} Structured data with lines array.
 */
function parseHtmlFormat(html) {
    const defaultData = {
        lines: [
            { text: "小贴纸", font_size: 24, color: "#FFFFFF", font_weight: "bold", text_decoration: "none", text_align: "left", margin_left: 0, margin_top: 0, margin_bottom: 0 },
            { text: "使用右键菜单编辑文字", font_size: 16, color: "#FFFFFF", font_weight: "normal", text_decoration: "none", text_align: "left", margin_left: 0, margin_top: 0, margin_bottom: 0 }
        ]
    };
    try {
        if (!html || typeof html !== 'string') {
            logger.warn("Invalid or empty HTML input, returning default data");
            return defaultData;
        }
        const cleanedHtml = `<div style="margin:0;padding:0;">${html}</div>`;
        const parser = new DOMParser();
        const doc = parser.parseFromString(cleanedHtml, "text/html");
        const container = doc.body.firstElementChild || doc.body;
        const lines = [];
        const processedNodes = new Set();
        const blockTags = ["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "BLOCKQUOTE", "SPAN"];
        const allowedTags = ["P", "DIV", "SPAN", "BR"];

        const processNode = (node, depth = 0) => {
            if (processedNodes.has(node) || depth > 50) return;
            processedNodes.add(node);

            if (node.nodeType !== Node.ELEMENT_NODE || !allowedTags.includes(node.tagName)) return;

            if (node.tagName === "BR") {
                lines.push({
                    text: "",
                    font_size: 24,
                    color: "#FFFFFF",
                    font_weight: "normal",
                    text_decoration: "none",
                    text_align: "left",
                    margin_left: 0,
                    margin_top: 0,
                    margin_bottom: 0,
                    is_block: true
                });
                return;
            }

            const text = node.textContent.trim();
            if (text || blockTags.includes(node.tagName)) {
                const inlineStyles = node.style;
                const computedStyles = window.getComputedStyle(node);
                const isBlock = blockTags.includes(node.tagName) || computedStyles.display === "block";
                const fontSize = parseInt(inlineStyles.fontSize || computedStyles.fontSize) || 24;
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
                    color: inlineStyles.color || computedStyles.color || "#FFFFFF",
                    font_weight: inlineStyles.fontWeight || computedStyles.fontWeight || "normal",
                    text_decoration: inlineStyles.textDecoration || computedStyles.textDecorationLine || computedStyles.textDecoration || "none",
                    text_align: inlineStyles.textAlign || computedStyles.textAlign || "left",
                    margin_left: marginLeft,
                    margin_top: marginTop,
                    margin_bottom: marginBottom,
                    is_block: isBlock
                });
            }

            node.childNodes.forEach(child => processNode(child, depth + 1));
        };

        container.childNodes.forEach(child => processNode(child));
        return lines.length ? { lines } : defaultData;
    } catch (e) {
        logger.error("Failed to parse HTML format:", e);
        return defaultData;
    }
}

/**
 * Updates node's textData and background color, caching parsed results.
 * @param {Object} node - The node object.
 * @param {string} newColor - The new background color.
 */
function updateTextDataBackground(node, newColor) {
    let textData = node.properties?.textData || '<p style="font-size:20px;color:#FFFFFF;">小贴纸</p><p style="font-size:12px;color:#999999;">使用右键菜单编辑文字</p>';
    if (textData.includes('<div style="background')) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(textData, "text/html");
        const container = doc.body.firstElementChild || doc.body;
        container.style.background = newColor;
        textData = container.outerHTML;
    }
    node.properties.textData = textData;
    node.properties.parsedTextData = parseHtmlFormat(textData);
    app.canvas.setDirty(true);
}

/**
 * Updates node's textData and caches parsed results.
 * @param {Object} node - The node object.
 * @param {string} newText - The new text data.
 */
function updateTextData(node, newText) {
    if (node.properties.textData !== newText) {
        delete node.properties.parsedTextData;
    }
    node.properties.textData = newText;
    node.properties.parsedTextData = parseHtmlFormat(newText);
    app.canvas.setDirty(true);
}

app.registerExtension({
    name: "ComfyUI.XISER.Label",
    async setup() {
        try {
            setLogLevel(window.XISER_CONFIG?.logLevel || 2);
            await loadCodeMirrorResources();
            codeMirrorInstance = null; // Reset CodeMirror instance
            logger.info("XIS_Label extension setup completed");
        } catch (e) {
            logger.error("Failed to load resources, node may be unavailable", e);
        }
    },
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "XIS_Label") return;

        // Cache for fonts to improve performance
        const fontCache = new Map();

        /**
         * Renders the node's foreground, displaying text with word-wrapping and justified alignment.
         * @param {CanvasRenderingContext2D} ctx - The canvas context for rendering.
         */
        nodeType.prototype.onDrawForeground = function (ctx) {
            try {
                if (!this.properties.parsedTextData) {
                    this.properties.parsedTextData = parseHtmlFormat(this.properties?.textData);
                }
                const textData = this.properties.parsedTextData;
                if (!textData?.lines) {
                    logger.warn("Invalid parsedTextData, skipping rendering");
                    return;
                }

                const isMuteMode = this.mode === 2;
                const isPassMode = this.mode === 4 || this.flags?.bypassed === true;
                const baseColor = this.color || this.properties.color || "#333355";
                const backgroundColor = isPassMode ? "rgba(128, 0, 128, 0.5)" : baseColor;
                const alpha = isMuteMode || isPassMode ? 0.5 : 1.0;

                ctx.globalAlpha = alpha;
                ctx.fillStyle = backgroundColor;
                ctx.fillRect(0, -30, this.size[0], this.size[1] + 30);

                const margin = 20;
                let currentY = margin - 30;
                const lineHeightFactor = 1.2;
                const maxWidth = this.size[0] - 2 * margin;

                textData.lines.forEach(line => {
                    ctx.fillStyle = line.color || "#FFFFFF";
                    const fontWeight = line.font_weight === "bold" || parseInt(line.font_weight) >= 700 ? "bold" : "normal";
                    const fontKey = `${fontWeight}_${line.font_size}`;
                    let font = fontCache.get(fontKey);
                    if (!font) {
                        font = `${fontWeight} ${line.font_size}px 'Fira Code', monospace`;
                        fontCache.set(fontKey, font);
                        if (fontCache.size > 100) {
                            fontCache.delete(fontCache.keys().next().value);
                        }
                    }
                    ctx.font = font;
                    ctx.textAlign = "left";
                    ctx.textBaseline = "top";

                    currentY += line.margin_top || 0;

                    if (!line.text) {
                        currentY += (line.font_size || 24) * lineHeightFactor;
                        currentY += line.margin_bottom || 0;
                        return;
                    }

                    const words = line.text.match(/(\S+|\s+)/g) || [];
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

                    wrappedLines.forEach((wrappedText, index) => {
                        const isLastLine = index === wrappedLines.length - 1;
                        const textWidth = ctx.measureText(wrappedText).width;
                        let xPos = margin + (line.margin_left || 0);

                        if (line.text_align === "center") {
                            xPos = (this.size[0] - textWidth) / 2;
                        } else if (line.text_align === "right") {
                            xPos = this.size[0] - margin - textWidth - (line.margin_left || 0);
                        } else if (line.text_align === "justify" && !isLastLine) {
                            const wordsInLine = wrappedText.match(/(\S+)/g) || [wrappedText];
                            if (wordsInLine.length > 1) {
                                const totalWordWidth = wordsInLine.reduce((sum, word) => sum + ctx.measureText(word).width, 0);
                                const spaceCount = wordsInLine.length - 1;
                                const extraSpace = (maxWidth - totalWordWidth) / spaceCount;
                                let currentX = margin + (line.margin_left || 0);
                                wordsInLine.forEach((word, wordIndex) => {
                                    ctx.fillText(word, currentX, currentY);
                                    currentX += ctx.measureText(word).width + (wordIndex < wordsInLine.length - 1 ? extraSpace : 0);
                                });
                                currentY += (line.font_size || 24) * lineHeightFactor;
                                if (isLastLine) currentY += line.margin_bottom || 0;
                                return;
                            }
                        }

                        xPos = Math.max(margin, Math.min(xPos, this.size[0] - margin - textWidth));

                        if ((line.text_decoration || "none").includes("underline") && wrappedText) {
                            ctx.beginPath();
                            ctx.strokeStyle = line.color || "#FFFFFF";
                            ctx.lineWidth = 1;
                            ctx.moveTo(xPos, currentY + line.font_size);
                            ctx.lineTo(xPos + textWidth, currentY + line.font_size);
                            ctx.stroke();
                        }

                        ctx.fillText(wrappedText, xPos, currentY);
                        currentY += (line.font_size || 24) * lineHeightFactor;

                        if (isLastLine) currentY += line.margin_bottom || 0;
                    });
                });

                this.size[1] = Math.max(this.size[1], currentY + margin);
            } catch (e) {
                logger.error("Error rendering node foreground:", e);
            } finally {
                ctx.globalAlpha = 1.0;
            }
        };

        /**
         * Handles node mode changes, triggering a redraw.
         * @param {number} newMode - The new mode.
         * @param {number} oldMode - The previous mode.
         */
        nodeType.prototype.onModeChange = function (newMode, oldMode) {
            this.setDirtyCanvas(true, false);
            app.canvas.setDirty(true);
            logger.debug(`Mode changed from ${oldMode} to ${newMode}`);
        };

        /**
         * Handles property changes, updating color and triggering redraw.
         * @param {string} property - The changed property.
         * @param {any} value - The new value.
         * @returns {boolean} True to indicate successful handling.
         */
        nodeType.prototype.onPropertyChanged = debounce(function (property, value) {
            if (property === "color" && value) {
                this.properties.color = value;
                updateTextDataBackground(this, value);
                this.setDirtyCanvas(true, false);
                app.canvas.setDirty(true);
                logger.info(`Property changed: ${property} = ${value}`);
            }
            return true;
        }, 100);

        /**
         * Ensures node is redrawn after being added.
         */
        nodeType.prototype.onAdded = function () {
            this.setDirtyCanvas(true, false);
            logger.debug("Node added to canvas");
        };

        /**
         * Serializes node data, excluding cached parsed data.
         * @returns {Object} The serialized node data.
         */
        nodeType.prototype.serialize = function () {
            const data = LiteGraph.LGraphNode.prototype.serialize.call(this);
            delete data.properties.parsedTextData;
            return data;
        };

        /**
         * Adds a right-click menu option to edit text with a modal editor.
         * @param {Object} graphCanvas - The graph canvas instance.
         * @param {Array} options - The menu options array.
         */
        nodeType.prototype.getExtraMenuOptions = function (graphCanvas, options) {
            options.push({
                content: "编辑文本",
                callback: async () => {
                    try {
                        const modal = document.createElement("div");
                        modal.style.position = "fixed";
                        modal.style.top = "50%";
                        modal.style.left = "50%";
                        modal.style.transform = "translate(-50%, -50%)";
                        modal.style.width = "min(90vw, 600px)";
                        modal.style.height = "min(90vh, 400px)";
                        modal.style.background = "#1A1A1A";
                        modal.style.border = "none";
                        modal.style.borderRadius = "8px";
                        modal.style.boxShadow = "0 4px 16px rgba(0,0,0,0.5)";
                        modal.style.zIndex = "10000";
                        modal.style.display = "flex";
                        modal.style.flexDirection = "column";
                        modal.style.fontFamily = "'Segoe UI', Arial, sans-serif";

                        const editorDiv = document.createElement("div");
                        editorDiv.style.height = "calc(100% - 60px)"; // Fixed height minus button area
                        editorDiv.style.overflowY = "auto"; // Vertical scrollbar
                        editorDiv.style.padding = "10px";
                        modal.appendChild(editorDiv);

                        const buttonDiv = document.createElement("div");
                        buttonDiv.style.padding = "10px";
                        buttonDiv.style.textAlign = "right";
                        buttonDiv.style.background = "#1A1A1A";
                        buttonDiv.style.borderTop = "1px solid #333";

                        const saveButton = document.createElement("button");
                        saveButton.textContent = "保存";
                        saveButton.style.marginRight = "10px";
                        saveButton.className = "save-button";

                        const cancelButton = document.createElement("button");
                        cancelButton.textContent = "取消";
                        cancelButton.className = "cancel-button";

                        buttonDiv.appendChild(saveButton);
                        buttonDiv.appendChild(cancelButton);
                        modal.appendChild(buttonDiv);

                        const style = document.createElement("style");
                        style.textContent = `
                            .save-button, .cancel-button {
                                color: #E0E0E0;
                                border: none;
                                padding: 8px 16px;
                                border-radius: 4px;
                                cursor: pointer;
                                transition: background 0.2s;
                                font-family: 'Segoe UI', Arial, sans-serif;
                            }
                            .save-button {
                                background: linear-gradient(145deg, #4B5EAA, #3B4A8C);
                            }
                            .save-button:hover {
                                background: linear-gradient(145deg, #5A71C2, #4B5EAA);
                            }
                            .cancel-button {
                                background: linear-gradient(145deg, #D81B60, #B01550);
                            }
                            .cancel-button:hover {
                                background: linear-gradient(145deg, #E91E63, #D81B60);
                            }
                            .CodeMirror {
                                font-family: 'Fira Code', 'Consolas', 'Monaco', monospace !important;
                                font-size: 14px !important;
                                background: #1A1A1A !important;
                                color: #E0E0E0 !important;
                                border: 1px solid #333 !important;
                                height: 100% !important;
                                width: 100% !important;
                            }
                            .CodeMirror-scroll {
                                overflow-y: auto !important;
                                overflow-x: hidden !important;
                            }
                            textarea {
                                resize: none;
                                overflow-y: auto !important;
                            }
                        `;
                        // Prevent duplicate style elements
                        const existingStyle = document.querySelector("style[data-xis-label]");
                        if (existingStyle) existingStyle.remove();
                        style.dataset.xisLabel = "true";
                        document.head.appendChild(style);

                        document.body.appendChild(modal);

                        let editor;
                        const defaultText = this.properties?.textData || '<p style="font-size:20px;color:#FFFFFF;">小贴纸</p><p style="font-size:12px;color:#999999;">使用右键菜单编辑文字</p>';

                        if (window.CodeMirror) {
                            if (!codeMirrorInstance) {
                                codeMirrorInstance = window.CodeMirror(editorDiv, {
                                    value: defaultText,
                                    mode: "htmlmixed",
                                    lineNumbers: true,
                                    theme: "dracula",
                                    lineWrapping: true,
                                    extraKeys: {
                                        "Ctrl-S": () => saveButton.click(),
                                        "Enter": (cm) => cm.replaceSelection("\n") // Single newline on Enter
                                    }
                                });
                            } else {
                                codeMirrorInstance.setValue("");
                                editorDiv.appendChild(codeMirrorInstance.getWrapperElement());
                                codeMirrorInstance.setValue(defaultText);
                            }
                            editor = codeMirrorInstance;
                        } else {
                            logger.warn("CodeMirror not loaded, falling back to textarea");
                            const errorMsg = document.createElement("div");
                            errorMsg.style.color = "#FF5555";
                            errorMsg.textContent = "CodeMirror 加载失败，使用普通文本编辑器";
                            editorDiv.appendChild(errorMsg);
                            const textarea = document.createElement("textarea");
                            textarea.style.width = "100%";
                            textarea.style.height = "100%";
                            textarea.style.background = "#1A1A1A";
                            textarea.style.color = "#E0E0E0";
                            textarea.style.border = "1px solid #333";
                            textarea.style.padding = "10px";
                            textarea.style.fontFamily = "'Fira Code', 'Consolas', 'Monaco', monospace";
                            textarea.style.fontSize = "14px";
                            textarea.value = defaultText;
                            editorDiv.appendChild(textarea);
                            editor = textarea;
                        }

                        const saveHandler = () => {
                            try {
                                const newText = editor.getValue ? editor.getValue() : editor.value;
                                updateTextData(this, newText);
                                this.setDirtyCanvas(true, false);
                                document.body.removeChild(modal);
                                document.head.removeChild(style);
                                if (editor !== codeMirrorInstance) editor.remove();
                                saveButton.onclick = null;
                                cancelButton.onclick = null;
                                logger.info("Text saved and node updated");
                            } catch (e) {
                                logger.error("Error saving text:", e);
                            }
                        };

                        const cancelHandler = () => {
                            try {
                                document.body.removeChild(modal);
                                document.head.removeChild(style);
                                if (editor !== codeMirrorInstance) editor.remove();
                                if (codeMirrorInstance) {
                                    codeMirrorInstance.getWrapperElement().remove();
                                    codeMirrorInstance = null;
                                }
                                saveButton.onclick = null;
                                cancelButton.onclick = null;
                                logger.info("Edit cancelled");
                            } catch (e) {
                                logger.error("Error cancelling edit:", e);
                            }
                        };

                        saveButton.onclick = saveHandler;
                        cancelButton.onclick = cancelHandler;
                        modal.addEventListener("keydown", (e) => {
                            if (e.key === "Escape") cancelHandler();
                        });
                    } catch (e) {
                        logger.error("Error creating text editor modal:", e);
                    }
                }
            });
        };
    },
});