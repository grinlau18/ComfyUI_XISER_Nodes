import { app } from "/scripts/app.js";

// 资源加载状态
const loadedResources = new Set();

/**
 * 加载JavaScript脚本，支持缓存、CDN回退和重试
 * @param {string} src - 脚本URL
 * @param {string} [fallbackSrc] - 回退CDN URL
 * @param {number} [retries=2] - 重试次数
 * @returns {Promise<void>} 加载完成或失败的Promise
 */
async function loadScript(src, fallbackSrc, retries = 2) {
    if (loadedResources.has(src)) {
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
                script.onerror = () => reject(new Error(`加载脚本失败: ${src}`));
                document.head.appendChild(script);
            });
            return;
        } catch (e) {
            if (i === retries - 1 && fallbackSrc) {
                await loadScript(fallbackSrc);
                return;
            }
        }
    }
    throw new Error(`加载脚本失败: ${src}`);
}

/**
 * 加载CSS样式表，支持缓存和CDN回退
 * @param {string} href - CSS URL
 * @param {string} [fallbackHref] - 回退CDN URL
 * @returns {Promise<void>} 加载完成或失败的Promise
 */
function loadCss(href, fallbackHref) {
    if (loadedResources.has(href)) {
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        if (!navigator.onLine) {
            loadedResources.add(href);
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
                loadCss(fallbackHref).then(resolve).catch(reject);
            } else {
                loadedResources.add(href);
                resolve();
            }
        };
        document.head.appendChild(link);
    });
}

/**
 * 异步加载CodeMirror相关资源，字体为可选
 * @returns {Promise<void>} 所有关键资源加载完成的Promise
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

    await Promise.all(
        criticalResources.map(res =>
            res.type === "script"
                ? loadScript(res.src, res.fallback)
                : loadCss(res.src, res.fallback)
        )
    );
    await Promise.all(
        optionalResources.map(res =>
            res.type === "script"
                ? loadScript(res.src, res.fallback).catch(() => {})
                : loadCss(res.src, res.fallback).catch(() => {})
        )
    );
}

// 单例CodeMirror编辑器
let codeMirrorInstance = null;

// 防抖函数
function debounce(fn, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn.apply(this, args), wait);
    };
}

app.registerExtension({
    name: "ComfyUI.XISER.Label",
    async setup() {
        try {
            await loadCodeMirrorResources();
        } catch (e) {
            console.error("资源加载失败，节点可能不可用", e);
        }
    },
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "XIS_Label") return;

        /**
         * 解析HTML格式的文本数据，转换为结构化行数据
         * @param {string} html - 输入的HTML字符串
         * @returns {Object} 包含行数据的对象，格式为 { lines: Array }
         */
        function parseHtmlFormat(html) {
            const defaultData = {
                lines: [
                    { text: "小贴纸", font_size: 24, color: "#FFFFFF", font_weight: "bold", text_decoration: "none", text_align: "left", margin_left: 0, margin_top: 0, margin_bottom: 0 },
                    { text: "使用右键菜单编辑文字", font_size: 16, color: "#FFFFFF", font_weight: "normal", text_decoration: "none", text_align: "left", margin_left: 0, margin_top: 0, margin_bottom: 0 }
                ]
            };
            try {
                // 清理HTML，限制允许的标签，添加中性父容器
                const cleanedHtml = `<div style="margin:0;padding:0;">${html || '<p style="font-size:20px;color:#FFFFFF;">小贴纸</p><p style="font-size:12px;color:#999999;">使用右键菜单编辑文字</p>'}</div>`;
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
                    if ((text || blockTags.includes(node.tagName))) {
                        const inlineStyles = node.style;
                        const computedStyles = getComputedStyle(node);
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
                            text: text,
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
                return defaultData;
            }
        }

        /**
         * 更新节点的textData和背景色，并缓存解析结果
         * @param {Object} node - 节点对象
         * @param {string} newColor - 新背景色
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
         * 更新节点的textData，并缓存解析结果
         * @param {Object} node - 节点对象
         * @param {string} newText - 新文本数据
         */
        function updateTextData(node, newText) {
            if (node.properties.textData !== newText) {
                delete node.properties.parsedTextData;
            }
            node.properties.textData = newText;
            node.properties.parsedTextData = parseHtmlFormat(newText);
            app.canvas.setDirty(true);
        }

        // 绘制节点
        const fontCache = new Map();
        nodeType.prototype.onDrawForeground = function (ctx) {
            try {
                if (!this.properties.parsedTextData) {
                    this.properties.parsedTextData = parseHtmlFormat(this.properties?.textData);
                }
                const textData = this.properties.parsedTextData;

                const isMuteMode = this.mode === 2;
                const isPassMode = this.mode === 4 || this.flags?.bypassed === true;
                const baseColor = this.color || this.properties.color || "#333355";
                const backgroundColor = isPassMode ? "rgba(128, 0, 128, 0.5)" : baseColor;
                const alpha = (isMuteMode || isPassMode) ? 0.5 : 1.0;

                ctx.globalAlpha = alpha;
                ctx.fillStyle = backgroundColor;
                ctx.fillRect(0, -30, this.size[0], this.size[1] + 30);

                const margin = 20;
                let currentY = margin - 30;
                const lineHeightFactor = 1.2;
                const maxWidth = this.size[0] - 2 * margin; // 可用宽度

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

                    // 应用margin-top
                    currentY += (line.margin_top || 0);

                    // 如果文本为空或仅为换行符，直接处理
                    if (!line.text) {
                        currentY += (line.font_size || 24) * lineHeightFactor;
                        currentY += (line.margin_bottom || 0);
                        return;
                    }

                    // 计算换行
                    const words = line.text.split(/(\s+)/); // 按空格和空白字符分割
                    let currentLine = "";
                    const wrappedLines = [];
                    let currentWidth = 0;

                    for (const word of words) {
                        const wordWidth = ctx.measureText(word).width;
                        if (currentWidth + wordWidth <= maxWidth) {
                            currentLine += word;
                            currentWidth += wordWidth;
                        } else {
                            if (currentLine) wrappedLines.push(currentLine);
                            // 对于长单词或中文，按字符分割
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
                    if (currentLine) wrappedLines.push(currentLine);

                    // 渲染每一行
                    wrappedLines.forEach((wrappedText, index) => {
                        const textWidth = ctx.measureText(wrappedText).width;
                        let xPos = margin + (line.margin_left || 0);
                        if (line.text_align === "center") {
                            xPos = (this.size[0] - textWidth) / 2;
                        } else if (line.text_align === "right") {
                            xPos = this.size[0] - margin - textWidth - (line.margin_left || 0);
                        }
                        xPos = Math.max(margin, Math.min(xPos, this.size[0] - margin - textWidth));

                        // 下划线
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

                        // 仅在最后一行应用margin-bottom
                        if (index === wrappedLines.length - 1) {
                            currentY += (line.margin_bottom || 0);
                        }
                    });
                });

                // 动态调整节点高度
                this.size[1] = Math.max(this.size[1], currentY + margin);
            } catch (e) {
            } finally {
                ctx.globalAlpha = 1.0;
            }
        };

        // 监听模式变化
        nodeType.prototype.onModeChange = function (newMode, oldMode) {
            this.setDirtyCanvas(true, false);
            app.canvas.setDirty(true);
        };

        // 监听颜色变化
        nodeType.prototype.onPropertyChanged = debounce(function (property, value) {
            if (property === "color" && value) {
                this.properties.color = value; // 同步到properties.color
                updateTextDataBackground(this, value);
                this.setDirtyCanvas(true, false);
                app.canvas.setDirty(true);
            }
            return true;
        }, 100);

        // 确保节点加载后渲染
        nodeType.prototype.onAdded = function () {
            this.setDirtyCanvas(true, false);
        };

        // 自定义序列化，防止缓存数据保存
        nodeType.prototype.serialize = function () {
            const data = LiteGraph.LGraphNode.prototype.serialize.call(this);
            delete data.properties.parsedTextData;
            return data;
        };

        // 右键菜单（仅保留文本编辑）
        nodeType.prototype.getExtraMenuOptions = function (graphCanvas, options) {
            options.push({
                content: "编辑文本",
                callback: async () => {
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
                    editorDiv.style.flex = "1";
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
                        }
                    `;
                    document.head.appendChild(style);

                    document.body.appendChild(modal);

                    let editor;
                    const defaultText = this.properties?.textData || '<p style="font-size:20px;color:#FFFFFF;">小贴纸</p><p style="font-size:12px;color:#999999;">使用右键菜单编辑文字</p>';

                    if (window.CodeMirror) {
                        if (!codeMirrorInstance) {
                            codeMirrorInstance = CodeMirror(editorDiv, {
                                value: defaultText,
                                mode: "htmlmixed",
                                lineNumbers: true,
                                theme: "dracula",
                                lineWrapping: true,
                                extraKeys: { "Ctrl-S": () => saveButton.click() }
                            });
                        } else {
                            codeMirrorInstance.setValue("");
                            editorDiv.appendChild(codeMirrorInstance.getWrapperElement());
                            codeMirrorInstance.setValue(defaultText);
                        }
                        editor = codeMirrorInstance;
                    } else {
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
                        } catch (e) {
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
                        } catch (e) {
                        }
                    };

                    saveButton.onclick = saveHandler;
                    cancelButton.onclick = cancelHandler;
                    modal.addEventListener("keydown", (e) => {
                        if (e.key === "Escape") cancelHandler();
                    });
                }
            });
        };
    },
});