/**
 * ComfyUI 扩展，用于在节点界面上显示调整后的图像。
 * @module XIS_AdjustTheImage
 */
import { app } from "/scripts/app.js";

// 全局缓存
const imageCache = new Map(); // Map<nodeId, Map<filename, string>>
const loadedImageUrls = new Set(); // 缓存已加载的图像 URL

/**
 * 防抖函数，限制频繁调用。
 * @param {Function} fn - 要防抖的函数
 * @param {number} delay - 延迟时间（毫秒）
 * @returns {Function} 防抖包装函数
 */
function debounce(fn, delay) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn(...args), delay);
    };
}

/**
 * 确保节点 ID 有效。
 * @param {Object} node - ComfyUI 节点对象
 * @returns {Promise<boolean>} 是否获取到有效 ID
 */
async function ensureNodeId(node) {
    let attempts = 0;
    while (node.id === -1 && attempts < 100) {
        await new Promise(resolve => setTimeout(resolve, 50));
        attempts++;
    }
    if (node.id === -1) {
        console.error("Failed to get valid node ID after 100 attempts");
        return false;
    }
    console.log(`Node ID assigned: ${node.id}`);
    return true;
}

/**
 * 加载并显示图像，自适应容器大小。
 * @param {Object} node - ComfyUI 节点对象
 * @param {string} filename - 图像文件名
 * @param {HTMLElement} imageElement - HTML <img> 元素
 */
async function loadImage(node, filename, imageElement) {
    const url = `/view?filename=${encodeURIComponent(filename)}&subfolder=xis_nodes_cached/xis_adjust_image&type=output&rand=${Math.random()}`;
    if (loadedImageUrls.has(url)) return;

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to load image: ${response.status}`);
        const blob = await response.blob();
        const imgUrl = URL.createObjectURL(blob);
        imageElement.src = imgUrl;

        // 缓存图像
        if (!imageCache.has(node.id)) imageCache.set(node.id, new Map());
        imageCache.get(node.id).set(filename, imgUrl);
        loadedImageUrls.add(url);
        console.log(`Image loaded: ${filename}, URL: ${url}`);
    } catch (error) {
        console.error(`Failed to load image ${filename}: ${error}`);
    }
}

/**
 * ComfyUI 扩展注册
 */
app.registerExtension({
    name: "xiser.adjust_image",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "XIS_AdjustTheImage") return;

        // 保存原始 onExecuted 方法
        const originalOnExecuted = nodeType.prototype.onExecuted;

        // 重写 onExecuted 方法
        nodeType.prototype.onExecuted = function (message) {
            if (originalOnExecuted) {
                originalOnExecuted.apply(this, arguments);
            }
            // 触发图像加载和显示
            if (message.image_path && message.image_path[0]) {
                const extension = app.extensions.find(ext => ext.name === "xiser.adjust_image");
                if (extension && extension.loadImage) {
                    extension.loadImage(this, message.image_path[0]);
                }
            }
            // 强制重绘画布
            app.graph.setDirtyCanvas(true, false);
        };

        console.log(`Node definition registered for XIS_AdjustTheImage`);
    },
    async setup() {
        // 注入 CSS，用于画布容器和图像
        const style = document.createElement("style");
        style.textContent = `
            .xis-adjust-image-container {
                display: flex;
                flex-direction: column;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.3);
                overflow: hidden;
                padding: 0;
                margin: 0;
                box-sizing: border-box;
            }
            .xis-canvas-container {
                flex: 1; /* 占用剩余空间 */
                background: rgba(0, 0, 0, 0);
                position: relative; /* 相对定位以支持绝对定位的图像 */
                overflow: hidden;
                padding: 0;
                margin: 0;
                box-sizing: border-box;
            }
            .xis-canvas-image {
                max-width: 100%;
                max-height: 100%;
                width: auto;
                height: auto;
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                object-fit: contain; /* 等比缩放 */
                display: block; /* 防止默认内联间距 */
                box-sizing: border-box;
                will-change: transform; /* 优化渲染性能 */
            }
            .xis-reset-button {
                margin: 5px;
                padding: 5px 10px;
                background: rgba(255, 255, 255, 0.05);
                color: #fff;
                border: 1px solid #555;
                cursor: pointer;
                font-size: 12px;
                text-align: center;
            }
            .xis-reset-button:hover {
                background: rgba(255, 255, 255, 0.2);
            }
        `;
        document.head.appendChild(style);
    },
    async nodeCreated(node) {
        if (node.comfyClass !== "XIS_AdjustTheImage") return;

        console.log(`Node created: ${node.comfyClass}`);

        // 等待有效节点 ID
        if (!(await ensureNodeId(node))) {
            return;
        }

        // 设置最小节点尺寸
        node.size[0] = Math.max(node.size[0], 400); // 最小宽度 400px
        node.size[1] = Math.max(node.size[1], 650); // 最小高度 650px
        app.graph.setDirtyCanvas(true);

        // 创建主容器
        const mainContainer = document.createElement("div");
        mainContainer.className = "xis-adjust-image-container";

        // 创建 Reset 按钮
        const resetButton = document.createElement("button");
        resetButton.className = "xis-reset-button";
        resetButton.textContent = "Reset";
        resetButton.onclick = () => {
            const defaultValues = {
                brightness: 1.0,
                contrast: 1.0,
                saturation: 1.0,
                hue: 0.0,
                r_gain: 1.0,
                g_gain: 1.0,
                b_gain: 1.0,
                opacity: 1.0
            };
            node.widgets.forEach(widget => {
                if (defaultValues[widget.name] !== undefined) {
                    widget.value = defaultValues[widget.name];
                }
            });
            app.graph.setDirtyCanvas(true);
            console.log("Controls reset to default values");
        };
        mainContainer.appendChild(resetButton);

        // 创建画布容器
        const canvasContainer = document.createElement("div");
        canvasContainer.className = "xis-canvas-container";
        const imageElement = document.createElement("img");
        imageElement.className = "xis-canvas-image";
        canvasContainer.appendChild(imageElement);
        mainContainer.appendChild(canvasContainer);

        // 添加 DOM 小部件到节点界面
        node.addDOMWidget("adjustImage", "Adjust Image", mainContainer, {
            getValue() {
                const adjustments = {};
                node.widgets.forEach(widget => {
                    if (["brightness", "contrast", "saturation", "hue", "r_gain", "g_gain", "b_gain", "opacity"].includes(widget.name)) {
                        adjustments[widget.name] = widget.value;
                    }
                });
                return adjustments;
            },
            setValue(value) {
                Object.entries(value).forEach(([key, val]) => {
                    const widget = node.widgets.find(w => w.name === key);
                    if (widget) widget.value = val;
                });
            }
        });

        // 监听节点尺寸变化
        node.onResize = function () {
            try {
                console.log(`Node resized: ${node.size[0]}x${node.size[1]}, container rect: ${canvasContainer.getBoundingClientRect().width}x${canvasContainer.getBoundingClientRect().height}`);
                app.graph.setDirtyCanvas(true, false);
            } catch (error) {
                console.error("Failed to handle resize:", error);
            }
        };

        // 加载图像
        this.loadImage = debounce((filename) => loadImage(node, filename, imageElement), 100);
        node.onExecuted = function (message) {
            if (message.image_path && message.image_path[0]) {
                this.loadImage(message.image_path[0]);
            }
        }.bind(this);

        // 清理资源
        node.onRemoved = () => {
            try {
                mainContainer.remove();
                imageCache.delete(node.id);
                console.log(`Node removed: ${node.id}`);
            } catch (error) {
                console.error("Failed to clean up node:", error);
            }
        };

        // 节点添加时初始化
        node.onNodeAdded = function () {
            console.log(`Node added: ${node.id}`);
            node.size[0] = Math.max(node.size[0], 400);
            node.size[1] = Math.max(node.size[1], 650);
            app.graph.setDirtyCanvas(true);
        };
    }
});