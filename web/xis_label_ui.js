import { app } from "/scripts/app.js";

// 环境标志（生产环境禁用日志）
const isProduction = false;

// 资源加载状态
const loadedResources = new Set();

// 加载函数（优化：缓存检查、Promise、减少日志）
function loadScript(src, fallbackSrc) {
    if (loadedResources.has(src)) {
        !isProduction && console.debug(`脚本已加载: ${src}`);
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.type = "application/javascript";
        script.src = src;
        script.onload = () => {
            loadedResources.add(src);
            !isProduction && console.log(`成功加载脚本: ${src}`);
            resolve();
        };
        script.onerror = () => {
            !isProduction && console.error(`加载失败: ${src}`);
            if (fallbackSrc) {
                !isProduction && console.log(`尝试 CDN: ${fallbackSrc}`);
                loadScript(fallbackSrc).then(resolve).catch(reject);
            } else {
                reject(new Error(`加载脚本失败: ${src}`));
            }
        };
        document.head.appendChild(script);
    });
}

function loadCss(href, fallbackHref) {
    if (loadedResources.has(href)) {
        !isProduction && console.debug(`CSS 已加载: ${href}`);
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        if (!navigator.onLine) {
            !isProduction && console.warn(`无网络连接，跳过加载: ${href}，使用回退字体`);
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
            !isProduction && console.log(`成功加载 CSS: ${href}`);
            resolve();
        };
        link.onerror = () => {
            !isProduction && console.error(`加载失败: ${href}`);
            if (fallbackHref) {
                !isProduction && console.log(`尝试 CDN: ${fallbackHref}`);
                loadCss(fallbackHref).then(resolve).catch(reject);
            } else {
                !isProduction && console.warn(`无备用 CSS，跳过: ${href}，使用回退字体`);
                loadedResources.add(href);
                resolve();
            }
        };
        document.head.appendChild(link);
    });
}

// 异步加载所有资源
async function loadCodeMirrorResources() {
    const resources = [
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
        },
        {
            type: "css",
            src: "https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500&display=swap",
            fallback: null
        }
    ];

    try {
        await Promise.all(
            resources.map(res =>
                res.type === "script"
                    ? loadScript(res.src, res.fallback)
                    : loadCss(res.src, res.fallback)
            )
        );
        !isProduction && console.log("所有 CodeMirror 资源加载完成");
    } catch (e) {
        !isProduction && console.error("加载 CodeMirror 资源失败:", e);
    }
}

// 单例 CodeMirror 编辑器
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
    name: "MyCustomNodes.XIS_Label",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "XIS_Label") return;

        // 加载资源（仅一次）
        await loadCodeMirrorResources();

        // 解析 HTML 格式（优化：离线 DOM、缓存）
        function parseHtmlFormat(html) {
            const defaultData = {
                lines: [
                    { text: "小贴纸", font_size: 24, color: "#FFFFFF", font_weight: "bold", text_decoration: "none", text_align: "left", margin_left: 0, margin_top: 0, margin_bottom: 0 },
                    { text: "使用右键菜单编辑文字", font_size: 16, color: "#FFFFFF", font_weight: "normal", text_decoration: "none", text_align: "left", margin_left: 0, margin_top: 0, margin_bottom: 0 }
                ]
            };
            try {
                // 清理 HTML，添加中性父容器
                const cleanedHtml = `<div style="margin:0;padding:0;">${html || '<p style="font-size:20px;color:#FFFFFF;">小贴纸</p><p style="font-size:12px;color:#999999;">使用右键菜单编辑文字</p>'}</div>`;
                const parser = new DOMParser();
                const doc = parser.parseFromString(cleanedHtml, "text/html");
                const container = doc.body.firstElementChild || doc.body;
                const lines = [];
                const processedNodes = new Set();
                const blockTags = ["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "BLOCKQUOTE", "SPAN"];

                const processNode = (node, depth = 0) => {
                    if (processedNodes.has(node) || depth > 50) return;
                    processedNodes.add(node);

                    if (node.nodeType !== Node.ELEMENT_NODE) return;

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
                    if ((text || blockTags.includes(node.tagName)) && !["SCRIPT", "STYLE"].includes(node.tagName)) {
                        const inlineStyles = node.style;
                        const computedStyles = getComputedStyle(node);
                        const isBlock = blockTags.includes(node.tagName) || computedStyles.display === "block";
                        const fontSize = parseInt(inlineStyles.fontSize || computedStyles.fontSize) || 24;
                        // 解析 margin-left
                        let marginLeft = parseInt(inlineStyles.marginLeft) || 0;
                        if (!marginLeft && node.getAttribute("style")) {
                            const styleMatch = node.getAttribute("style").match(/margin-left:\s*(\d+)px/i);
                            marginLeft = styleMatch ? parseInt(styleMatch[1]) : 0;
                        }
                        // 解析 margin-top
                        let marginTop = parseInt(inlineStyles.marginTop) || 0;
                        if (!marginTop && node.getAttribute("style")) {
                            const styleMatch = node.getAttribute("style").match(/margin-top:\s*(\d+)px/i);
                            marginTop = styleMatch ? parseInt(styleMatch[1]) : 0;
                        }
                        // 解析 margin-bottom
                        let marginBottom = parseInt(inlineStyles.marginBottom) || 0;
                        if (!marginBottom && node.getAttribute("style")) {
                            const styleMatch = node.getAttribute("style").match(/margin-bottom:\s*(\d+)px/i);
                            marginBottom = styleMatch ? parseInt(styleMatch[1]) : 0;
                        }
                        !isProduction && console.debug(`解析行: text=${text}, margin_left=${marginLeft}, margin_top=${marginTop}, margin_bottom=${marginBottom}, inlineStyles.marginLeft=${inlineStyles.marginLeft}, inlineStyles.marginTop=${inlineStyles.marginTop}, inlineStyles.marginBottom=${inlineStyles.marginBottom}, styleAttr=${node.getAttribute("style")}`);
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
                !isProduction && console.error("解析 HTML 格式错误:", e);
                return defaultData;
            }
        }

        // 更新 textData 背景色
        function updateTextDataBackground(node, newColor) {
            let textData = node.properties?.textData || '<p style="font-size:20px;color:#FFFFFF;">小贴纸</p><p style="font-size:12px;color:#999999;">使用右键菜单编辑文字</p>';
            if (textData.includes('<div style="background')) {
                const parser = new DOMParser();
                const doc = parser.parseFromString(textData, "text/html");
                const container = doc.body.firstElementChild || doc.body;
                container.style.background = newColor;
                textData = container.outerHTML;
                node.properties.textData = textData;
                delete node.properties.parsedTextData;
                !isProduction && console.log("更新 textData 背景色:", newColor);
            }
            app.canvas.setDirty(true);
        }

        // 绘制节点（优化：支持 Pass 和 Mute 状态）
        const fontCache = new Map();
        nodeType.prototype.onDrawForeground = function (ctx) {
            try {
                let textData = this.properties.parsedTextData || parseHtmlFormat(this.properties?.textData);
                this.properties.parsedTextData = textData;

                // 检查节点状态
                const isMuteMode = this.mode === 2;
                const isPassMode = this.mode === 4 || this.flags?.bypassed === true;
                const baseColor = this.color || "#333355";
                const backgroundColor = isPassMode ? "rgba(128, 0, 128, 0.5)" : baseColor;
                const alpha = (isMuteMode || isPassMode) ? 0.5 : 1.0;

                !isProduction && console.debug(`绘制节点: mode=${this.mode}, flags=${JSON.stringify(this.flags)}, backgroundColor=${backgroundColor}, alpha=${alpha}`);

                ctx.globalAlpha = alpha;
                ctx.fillStyle = backgroundColor;
                ctx.fillRect(0, -30, this.size[0], this.size[1] + 30);

                const margin = 20;
                let currentY = margin - 30;
                const lineHeightFactor = 1.2;

                textData.lines.forEach(line => {
                    ctx.fillStyle = line.color || "#FFFFFF";
                    const fontWeight = line.font_weight === "bold" || parseInt(line.font_weight) >= 700 ? "bold" : "normal";
                    const fontKey = `${fontWeight}_${line.font_size}`;
                    let font = fontCache.get(fontKey);
                    if (!font) {
                        font = `${fontWeight} ${line.font_size}px Arial`;
                        fontCache.set(fontKey, font);
                    }
                    ctx.font = font;
                    ctx.textAlign = "left";
                    ctx.textBaseline = "top";

                    // 计算 xPos
                    let xPos = margin + (line.margin_left || 0);
                    let textWidth = line.text ? ctx.measureText(line.text).width : 0;
                    if (line.text_align === "center") {
                        xPos = (this.size[0] - textWidth) / 2;
                    } else if (line.text_align === "right") {
                        xPos = this.size[0] - margin - textWidth - (line.margin_left || 0);
                    }
                    xPos = Math.max(margin, Math.min(xPos, this.size[0] - margin - textWidth));

                    // 应用 margin-top
                    currentY += (line.margin_top || 0);

                    !isProduction && console.debug(`渲染行: text=${line.text}, margin_left=${line.margin_left}, margin_top=${line.margin_top}, margin_bottom=${line.margin_bottom}, xPos=${xPos}, yPos=${currentY}`);

                    if ((line.text_decoration || "none").includes("underline") && line.text) {
                        ctx.beginPath();
                        ctx.strokeStyle = line.color || "#FFFFFF";
                        ctx.lineWidth = 1;
                        ctx.moveTo(xPos, currentY + line.font_size);
                        ctx.lineTo(xPos + textWidth, currentY + line.font_size);
                        ctx.stroke();
                    }

                    if (line.text) {
                        ctx.fillText(line.text, xPos, currentY);
                    }

                    // 更新 currentY，考虑 font_size 和 margin-bottom
                    currentY += (line.font_size || 24) * lineHeightFactor;
                    currentY += (line.margin_bottom || 0);
                });

                // 动态调整节点高度
                this.size[1] = Math.max(this.size[1], currentY + margin);
            } catch (e) {
                !isProduction && console.error("渲染错误:", e);
            } finally {
                ctx.globalAlpha = 1.0;
            }
        };

        // 监听模式变化
        nodeType.prototype.onModeChange = function (newMode, oldMode) {
            !isProduction && console.log(`模式变化: oldMode=${oldMode}, newMode=${newMode}, flags=${JSON.stringify(this.flags)}`);
            this.setDirtyCanvas(true, true);
            app.canvas.setDirty(true);
        };

        // 监听颜色变化（优化：防抖）
        nodeType.prototype.onPropertyChanged = debounce(function (property, value) {
            if (property === "color" && value) {
                updateTextDataBackground(this, value);
                !isProduction && console.log("节点颜色变化:", value);
                this.setDirtyCanvas(true, true);
                app.canvas.setDirty(true);
            }
            return true;
        }, 100);

        // 右键菜单（优化：复用编辑器、清理模态框）
        nodeType.prototype.getExtraMenuOptions = function (graphCanvas, options) {
            options.push({
                content: "编辑文本",
                callback: async () => {
                    !isProduction && console.log("打开 CodeMirror 编辑器 XIS_Label:", this.id);

                    const modal = document.createElement("div");
                    modal.style.position = "fixed";
                    modal.style.top = "50%";
                    modal.style.left = "50%";
                    modal.style.transform = "translate(-50%, -50%)";
                    modal.style.width = "600px";
                    modal.style.height = "400px";
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

                    // 样式（集中管理，Grok 风格）
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
                            !isProduction && console.log("CodeMirror 初始化成功，主题：dracula");
                        } else {
                            codeMirrorInstance.setValue(defaultText);
                            codeMirrorInstance.getWrapperElement().parentNode.removeChild(codeMirrorInstance.getWrapperElement());
                            editorDiv.appendChild(codeMirrorInstance.getWrapperElement());
                            !isProduction && console.log("复用 CodeMirror 实例，主题：dracula");
                        }
                        editor = codeMirrorInstance;
                    } else {
                        !isProduction && console.error("CodeMirror 未加载，使用 textarea 回退");
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
                            this.properties.textData = newText;
                            delete this.properties.parsedTextData;
                            this.setDirtyCanvas(true, true);
                            app.canvas.setDirty(true);
                            !isProduction && console.log("保存 textData:", newText);
                            document.body.removeChild(modal);
                            document.head.removeChild(style);
                            if (editor !== codeMirrorInstance) editor.remove();
                        } catch (e) {
                            !isProduction && console.error("保存错误:", e);
                        }
                    };

                    const cancelHandler = () => {
                        try {
                            document.body.removeChild(modal);
                            document.head.removeChild(style);
                            if (editor !== codeMirrorInstance) editor.remove();
                        } catch (e) {
                            !isProduction && console.error("取消错误:", e);
                        }
                    };

                    saveButton.onclick = saveHandler;
                    cancelButton.onclick = cancelHandler;
                }
            });

            options.push({
                content: "Change Color",
                callback: () => {
                    !isProduction && console.log("打开颜色选择器 XIS_Label:", this.id);

                    const modal = document.createElement("div");
                    modal.style.position = "fixed";
                    modal.style.top = "50%";
                    modal.style.left = "50%";
                    modal.style.transform = "translate(-50%, -50%)";
                    modal.style.background = "#1A1A1A";
                    modal.style.border = "none";
                    modal.style.borderRadius = "8px";
                    modal.style.padding = "20px";
                    modal.style.boxShadow = "0 4px 16px rgba(0,0,0,0.5)";
                    modal.style.zIndex = "10000";
                    modal.style.display = "flex";
                    modal.style.flexDirection = "column";
                    modal.style.gap = "10px";
                    modal.style.fontFamily = "'Segoe UI', Arial, sans-serif";

                    const colorInput = document.createElement("input");
                    colorInput.type = "color";
                    colorInput.value = this.color || "#333355";
                    colorInput.style.width = "100%";
                    colorInput.style.padding = "5px";
                    modal.appendChild(colorInput);

                    const buttonDiv = document.createElement("div");
                    buttonDiv.style.textAlign = "right";
                    const saveButton = document.createElement("button");
                    saveButton.textContent = "保存";
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
                    `;
                    document.head.appendChild(style);

                    document.body.appendChild(modal);

                    const saveColorHandler = () => {
                        try {
                            this.color = colorInput.value;
                            updateTextDataBackground(this, colorInput.value);
                            delete this.properties.parsedTextData;
                            this.setDirtyCanvas(true, true);
                            app.canvas.setDirty(true);
                            !isProduction && console.log("保存节点颜色:", colorInput.value);
                            document.body.removeChild(modal);
                            document.head.removeChild(style);
                        } catch (e) {
                            !isProduction && console.error("保存颜色错误:", e);
                        }
                    };

                    const cancelColorHandler = () => {
                        try {
                            document.body.removeChild(modal);
                            document.head.removeChild(style);
                        } catch (e) {
                            !isProduction && console.error("取消颜色错误:", e);
                        }
                    };

                    saveButton.onclick = saveColorHandler;
                    cancelButton.onclick = cancelColorHandler;
                }
            });
        };
    },
});