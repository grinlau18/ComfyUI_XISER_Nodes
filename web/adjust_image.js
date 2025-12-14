/**
 * ComfyUI 扩展，用于在节点界面上显示调整后的图像。
 * @module XIS_ImageAdjustAndBlend
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
 * @param {HTMLElement} imagesContainer - 图像容器元素
 */
async function loadImage(node, filename, imageElement, imagesContainer, isOriginal = false) {
    const url = `/view?filename=${encodeURIComponent(filename)}&subfolder=xis_nodes_cached/xis_image_adjust_and_blend&type=output&rand=${Math.random()}`;
    if (loadedImageUrls.has(url) && !isOriginal) return;

    try {
        console.log(`正在加载图像: ${url}`);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to load image: ${response.status}`);
        const blob = await response.blob();
        console.log(`图像加载成功，blob大小: ${blob.size} bytes`);
        
        if (isOriginal) {
            return blob;
        }
        
        const imgUrl = URL.createObjectURL(blob);
        console.log(`创建ObjectURL: ${imgUrl}`);
        imageElement.src = imgUrl;

        // 缓存图像
        if (!imageCache.has(node.id)) imageCache.set(node.id, new Map());
        imageCache.get(node.id).set(filename, imgUrl);
        loadedImageUrls.add(url);
        
        // 监听图像加载完成事件
        imageElement.onload = () => {
            console.log(`图像加载完成: ${filename}, 原始尺寸: ${imageElement.naturalWidth}x${imageElement.naturalHeight}, 显示尺寸: ${imageElement.offsetWidth}x${imageElement.offsetHeight}`);
            
            // 确保图像正确适配容器
            if (imageElement.complete) {
                setTimeout(() => {
                    const containerWidth = imagesContainer.offsetWidth;
                    const containerHeight = imagesContainer.offsetHeight;
                    const aspectRatio = imageElement.naturalWidth / imageElement.naturalHeight;
                    
                    // 计算最佳显示尺寸
                    let displayWidth = containerWidth;
                    let displayHeight = containerWidth / aspectRatio;
                    
                    if (displayHeight > containerHeight) {
                        displayHeight = containerHeight;
                        displayWidth = containerHeight * aspectRatio;
                    }
                    
                    console.log(`图像适配: 容器=${containerWidth}x${containerHeight}, 显示=${displayWidth}x${displayHeight}, 比例=${aspectRatio.toFixed(2)}`);
                    app.graph.setDirtyCanvas(true, false);
                }, 100);
            }
            
            // 确保图像正确居中显示
            app.graph.setDirtyCanvas(true, false);
        };
        imageElement.onerror = (e) => {
            console.error(`图像加载失败: ${filename}`, e);
        };
    } catch (error) {
        console.error(`加载图像失败 ${filename}: ${error}`);
    }
}

/**
 * ComfyUI 扩展注册
 */
app.registerExtension({
    name: "xiser.image_adjust_and_blend",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "XIS_ImageAdjustAndBlend") return;

        // 保存原始 onExecuted 方法
        const originalOnExecuted = nodeType.prototype.onExecuted;

        // 重写 onExecuted 方法
        nodeType.prototype.onExecuted = function (message) {
            if (originalOnExecuted) {
                originalOnExecuted.apply(this, arguments);
            }
            // 触发图像加载和显示
            if (message.image_path && message.image_path.length > 0) {
                const extension = app.extensions.find(ext => ext.name === "xiser.image_adjust_and_blend");
                if (extension && extension.loadImages) {
                    extension.loadImages(message.image_path);
                }
            }
            // 强制重绘画布
            app.graph.setDirtyCanvas(true, false);
        };

        console.log(`Node definition registered for XIS_ImageAdjustAndBlend`);
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
                background: rgba(0, 0, 0, 0.3);
                overflow: hidden;
                padding: 0;
                margin: 0;
                box-sizing: border-box;
                display: flex;
                flex-direction: column;
                position: relative;
            }
            .xis-images-container {
                flex: 1;
                display: flex;
                justify-content: center;
                align-items: center;
                padding: 10px;
                overflow: hidden;
                width: 100%;
                height: 100%;
                position: relative;
            }
            .xis-single-image-wrapper {
                position: relative;
                width: 100%;
                height: 100%;
                display: flex;
                justify-content: center;
                align-items: center;
                overflow: hidden;
            }
            .xis-canvas-image {
                max-width: 100%;
                max-height: 100%;
                object-fit: contain; /* 等比缩放保持比例 */
                display: block;
                box-sizing: border-box;
                margin: auto;
                position: relative;
                width: auto;
                height: auto;
            }
            .xis-pagination {
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 8px;
                background: rgba(0, 0, 0, 0.5); /* 黑色背景，50%透明度 */
                border-top: 1px solid rgba(255, 255, 255, 0.3);
                gap: 4px;
                min-height: 36px;
                z-index: 30;
                position: absolute;
                bottom: 0;
                left: 0;
                right: 0;
            }
            .xis-page-btn {
                padding: 4px 8px;
                background: rgba(255, 255, 255, 0.2);
                color: #fff;
                border: 1px solid rgba(255, 255, 255, 0.4);
                border-radius: 3px;
                cursor: pointer;
                font-size: 12px;
                min-width: 32px;
                transition: all 0.2s ease;
                font-weight: bold;
            }
            .xis-page-btn:hover:not(:disabled) {
                background: rgba(255, 255, 255, 0.2);
                border-color: rgba(255, 255, 255, 0.3);
            }
            .xis-page-btn:disabled {
                opacity: 0.3;
                cursor: not-allowed;
            }
            .xis-page-info {
                font-size: 12px;
                color: rgba(255, 255, 255, 0.8);
                margin: 0 8px;
                min-width: 60px;
                text-align: center;
            }
            .xis-image-label {
                position: absolute;
                top: 6px;
                left: 6px;
                background: rgba(0, 0, 0, 0.7);
                color: white;
                padding: 2px 6px;
                font-size: 11px;
                border-radius: 3px;
                z-index: 10;
                pointer-events: none;
            }
            .xis-loading-overlay {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.5);
                display: flex;
                justify-content: center;
                align-items: center;
                z-index: 20;
            }
            .xis-loading-spinner {
                width: 30px;
                height: 30px;
                border: 3px solid rgba(255, 255, 255, 0.3);
                border-top: 3px solid #fff;
                border-radius: 50%;
                animation: spin 1s linear infinite;
            }
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
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
        if (node.comfyClass !== "XIS_ImageAdjustAndBlend") return;

        console.log(`Node created: ${node.comfyClass}`);

        // 等待有效节点 ID
        if (!(await ensureNodeId(node))) {
            return;
        }

        // 设置最小节点尺寸（预览关闭时较小）
        node.size[0] = Math.max(node.size[0], 300); // 最小宽度
        node.size[1] = Math.max(node.size[1], 600); // 最小高度（无预览时）
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
        canvasContainer.style.display = 'block'; // 默认显示
        
        // 创建单图显示容器
        const imagesContainer = document.createElement("div");
        imagesContainer.className = "xis-images-container";
        canvasContainer.appendChild(imagesContainer);
        
        // 创建分页控件
        const pagination = document.createElement("div");
        pagination.className = "xis-pagination";
        pagination.style.display = 'none'; // 默认隐藏
        
        const prevBtn = document.createElement("button");
        prevBtn.className = "xis-page-btn";
        prevBtn.textContent = "←";
        prevBtn.disabled = true;
        
        const nextBtn = document.createElement("button");
        nextBtn.className = "xis-page-btn";
        nextBtn.textContent = "→";
        nextBtn.disabled = true;
        
        const pageInfo = document.createElement("span");
        pageInfo.className = "xis-page-info";
        pageInfo.textContent = "0/0";
        
        pagination.appendChild(prevBtn);
        pagination.appendChild(pageInfo);
        pagination.appendChild(nextBtn);
        canvasContainer.appendChild(pagination);
        
        mainContainer.appendChild(canvasContainer);
        
        // 分页状态
        let currentPage = 1;
        let totalPages = 0;
        let allFilenames = [];

        // 更新分页控件状态
        function updatePagination() {
            totalPages = allFilenames.length;
            
            // 只有多于1张图时才显示分页
            if (totalPages > 1) {
                pagination.style.display = 'flex';
                prevBtn.disabled = currentPage <= 1;
                nextBtn.disabled = currentPage >= totalPages;
                pageInfo.textContent = `${currentPage}/${totalPages}`;
            } else {
                pagination.style.display = 'none';
            }
        }

        // 显示当前图像
        function showCurrentImage() {
            // 清空当前显示
            while (imagesContainer.firstChild) {
                imagesContainer.removeChild(imagesContainer.firstChild);
            }

            if (allFilenames.length === 0) {
                const emptyMsg = document.createElement("div");
                emptyMsg.textContent = "暂无图像";
                emptyMsg.style.textAlign = "center";
                emptyMsg.style.color = "rgba(255, 255, 255, 0.5)";
                emptyMsg.style.padding = "20px";
                imagesContainer.appendChild(emptyMsg);
                return;
            }

            const filename = allFilenames[currentPage - 1];
            const imageWrapper = document.createElement("div");
            imageWrapper.className = "xis-single-image-wrapper";

            const imageElement = document.createElement("img");
            imageElement.className = "xis-canvas-image";
            imageElement.title = `Image ${currentPage} of ${totalPages}`;

            const imageLabel = document.createElement("div");
            imageLabel.className = "xis-image-label";
            imageLabel.textContent = `${currentPage}/${totalPages}`;

            // 先添加到DOM再加载图像
            imageWrapper.appendChild(imageElement);
            imageWrapper.appendChild(imageLabel);
            imagesContainer.appendChild(imageWrapper);
            
            // 调试信息
            console.log(`显示图像: ${filename}, 容器尺寸: ${imagesContainer.offsetWidth}x${imagesContainer.offsetHeight}, 图像在DOM中: ${document.contains(imageElement)}`);
            
            loadImage(node, filename, imageElement, imagesContainer);
            
        }

        // 分页按钮事件
        prevBtn.onclick = () => {
            if (currentPage > 1) {
                currentPage--;
                updatePagination();
                showCurrentImage();
            }
        };

        nextBtn.onclick = () => {
            if (currentPage < totalPages) {
                currentPage++;
                updatePagination();
                showCurrentImage();
            }
        };

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
                
                // 调试布局尺寸
                console.log(`Resize调试 - 主容器: ${mainContainer.offsetWidth}x${mainContainer.offsetHeight}, 画布容器: ${canvasContainer.offsetWidth}x${canvasContainer.offsetHeight}, 图像容器: ${imagesContainer.offsetWidth}x${imagesContainer.offsetHeight}`);
                
                app.graph.setDirtyCanvas(true, false);
            } catch (error) {
                console.error("Failed to handle resize:", error);
            }
        };

        // 加载图像到分页系统
        this.loadImages = debounce((filenames) => {
            console.log(`加载 ${filenames.length} 张图像到分页系统`);
            
            allFilenames = filenames;
            currentPage = 1; // 总是从第一页开始
            
            // 清空缓存
            
            updatePagination();
            showCurrentImage();
        }, 100);
        
        node.onExecuted = function (message) {
            if (message.image_path && message.image_path.length > 0) {
                this.loadImages(message.image_path);
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