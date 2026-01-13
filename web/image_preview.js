import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

const EXTENSION_NAME = "xiser.image_preview_dom";
const TARGET_NODE = "XIS_ImagePreview";

let stylesInjected = false;

// --- CSS 样式注入 (包含所有 100% 高度约束和导航样式) ---

function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement("style");
    style.textContent = `
    /* 预览容器：确保 100% 高度 */
    .xis-preview-container {
        margin-top: 4px;
        width: 100%;
        height: 100%;
    }



    /* 空状态/加载状态 */
    .xis-preview-empty {
        width: 100%;
        height: 100%;
        display: grid;
        place-items: center;
        font-size: 14px;
    }

    /* 分页模式：Flex 列布局，100% 高度 */
    .xis-preview-page-view {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        position: relative;
    }

    /* 图片舞台： Flex: 1 占据剩余空间，min-height: 0 关键 */
    .xis-preview-image-stage {
        flex: 1; /* 自动填充导航外的所有剩余高度 */
        width: 100%; /* 宽度铺满父容器 */
        display: flex;
        justify-content: center; /* 图片水平居中 */
        align-items: center; /* 图片垂直居中 */
        overflow: hidden; /* 防止图片溢出图片容器 */
    }

    /* 关闭按钮 */
    .xis-preview-close-btn {
        position: absolute;
        top: 11px;
        right: 9px;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: rgba(0,0,0,0.5);
        color: #fff;
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        opacity: 0.7;
        transition: opacity 0.2s, background 0.2s;
        z-index: 20;
        user-select: none;
    }

    .xis-preview-close-btn:hover {
        opacity: 1;
        background: rgba(0,0,0,0.7);
    }

    /* 图片强制显示：max-height: 100% 关键 */
    .xis-preview-image {
        max-width: 100%; /* 不超过图片容器宽度 */
        max-height: 100%; /* 不超过图片容器高度（核心：最大化） */
        width: auto; /* 保持宽高比 */
        height: auto; /* 保持宽高比 */
        object-fit: contain; /* 完全显示，不裁剪（如需填充可换 cover） */
        cursor: pointer; /* 表示图片可交互（支持双击） */
    }
    
    /* -------------------------------------- */
    /* 居中导航按钮 */
    /* -------------------------------------- */
    .xis-nav-btn {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        width: 28px;
        height: 32px;
        border-radius: 10%;
        background: rgba(0,0,0,0.5);
        color: #fff;
        border: none;
        cursor: pointer;
        font-size: 20px;
        line-height: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0.7;
        transition: opacity 0.2s, background 0.2s;
        z-index: 10;
        user-select: none;
    }

    .xis-nav-btn:hover {
        opacity: 1;
        background: rgba(0,0,0,0.7);
    }

    .xis-nav-left {
        left: 8px;
    }

    .xis-nav-right {
        right: 8px;
    }
    
    /* -------------------------------------- */
    /* 分辨率显示区域 */
    /* -------------------------------------- */
    .xis-resolution-display {
        height: 24px; /* 稍微增加高度 */
        display: flex;
        justify-content: center;
        align-items: center;
        padding: 4px 0;
        box-sizing: border-box;
        flex-shrink: 0;
        font-size: 13px;
        color: #666;
        font-family: monospace;
        user-select: none;
        font-weight: 500;
        background: rgba(0, 0, 0, 0.03);
        border-radius: 4px;
        margin: 4px 8px;
    }

    /* 方格容器 - 优化自适应布局 */

    .xis-preview-grid {
        display: grid;
        /* 列数由JS动态计算 */
        grid-template-columns: repeat(var(--grid-columns, 4), 1fr);
        /* 固定行高，保持网格整齐 */
        grid-auto-rows: minmax(var(--grid-item-size, 150px), auto);
        gap: 4px;
        padding: 2px;
        box-sizing: border-box;
        background: transparent;
        width: 100%;
        height: 100%;
        position: relative;
        overflow-y: auto; /* 允许垂直滚动 */
        transition: grid-template-columns 0.3s ease; /* 平滑过渡 */
    }

    .xis-preview-grid-item {
        min-width: 0;
        min-height: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        cursor: pointer;
        overflow: hidden;
        position: relative;
        background: transparent;
        /* 移除固定方形约束，允许矩形布局 */
        width: 100%;
        height: 100%;
    }

    .xis-preview-grid-image {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
        display: block;
        visibility: visible;
        opacity: 1;
        background: transparent;
        transition: transform 0.2s ease;
    }

    .xis-preview-grid-item:hover .xis-preview-grid-image {
        transform: scale(1.05); /* 网格图片悬停放大效果 */
    }

    .xis-preview-grid-item {
        cursor: pointer; /* 表示网格项可交互（单击切换分页模式） */
        transition: background-color 0.2s ease;
    }

    .xis-preview-grid-item:hover {
        background-color: rgba(0, 0, 0, 0.05); /* 网格项悬停背景 */
    }

    /* 徽章样式 */
    .xis-preview-badge {
        position: absolute;
        top: 4px;
        right: 4px;
        z-index: 10;
        font-size: 10px;
        padding: 1px 4px;
        background: #ffc107;
        color: #fff;
        border-radius: 4px;
    }

    /* LiteGraph 适配 */
    .litegraph-node .widget-xis-preview {
        width: 100%;
        height: 100%;
        padding: 0;
        margin: 0;
        overflow: hidden;
        position: relative;
    }

    .litegraph-node .widget-wrap {
        width: 100%;
        height: 100%;
        overflow: hidden;
    }
    `;
    document.head.appendChild(style);
}

// --- 实用工具函数 (与之前版本一致) ---

function buildImageUrls(nodeId, output) {
    if (nodeId === -1 || !nodeId) {
        return { urls: [], originalUrls: [], animated: [], resolutions: [] };
    }

    const previewParam = app.getPreviewFormatParam ? app.getPreviewFormatParam() : "";
    const rand = app.getRandParam ? app.getRandParam() : "";

    // 确保使用 PNG 格式以支持透明背景
    let finalPreviewParam = previewParam;
    if (finalPreviewParam.includes('format=')) {
        // 替换现有的格式参数为 PNG
        finalPreviewParam = finalPreviewParam.replace(/format=[^&]*/, 'format=png');
    } else if (finalPreviewParam) {
        // 添加 PNG 格式参数
        finalPreviewParam += '&format=png';
    } else {
        finalPreviewParam = '&format=png';
    }

    let urls = [];
    let originalUrls = [];
    let animated = [];
    let resolutions = [];

    try {
        const outputData = output?.xiser_images || output?.images;
        // 从后端获取分辨率信息
        resolutions = output?.resolutions || [];

        if (outputData && Array.isArray(outputData) && outputData.length > 0) {
            urls = outputData.map(img => {
                // Simplified URL construction for brevity in this response
                const params = new URLSearchParams();
                let filename = img.filename || img.name || img.file;
                let subfolder = img.subfolder || img.folder || img.dir;
                let type = img.type || img.folder_type || "temp";

                if (filename) params.set("filename", filename);
                if (subfolder) params.set("subfolder", subfolder);
                params.set("type", type);
                return `${api.apiURL("/view")}?${params.toString()}${finalPreviewParam}${rand}`;
            });

            // 构建原始图片URL（不带预览参数）
            originalUrls = outputData.map(img => {
                const params = new URLSearchParams();
                let filename = img.filename || img.name || img.file;
                let subfolder = img.subfolder || img.folder || img.dir;
                let type = img.type || img.folder_type || "temp";

                if (filename) params.set("filename", filename);
                if (subfolder) params.set("subfolder", subfolder);
                params.set("type", type);
                return `${api.apiURL("/view")}?${params.toString()}`;
            });

            const outputAnimated = output.animated || [];
            animated = urls.map((_, index) => !!outputAnimated[index]);

            // 确保resolutions数组长度与urls一致
            if (resolutions.length < urls.length) {
                resolutions = resolutions.concat(Array(urls.length - resolutions.length).fill("N/A"));
            }
        }
        // ... (处理 app.nodePreviewImages 逻辑)
    } catch (err) {
        console.error(`[${EXTENSION_NAME}] 构建图片URL失败:`, err);
        urls = [];
        originalUrls = [];
        animated = [];
        resolutions = [];
    }

    return { urls, originalUrls, animated, resolutions };
}

// --- LiteGraph 节点绑定逻辑 (纯 DOM/JS 实现) ---

function attachToNode(node) {
    if (!node || node._xisPreviewAttached) return;
    if (node.comfyClass !== TARGET_NODE) return;

    node._xisPreviewAttached = true;

    // 状态对象
    const state = {
        mode: "grid", // "grid" or "page"
        images: [], // 预览图片URL
        originalImages: [], // 原始图片URL（用于双击打开）
        animated: [],
        resolutions: [], // 新增：分辨率信息
        currentPage: 0,
        loading: false,
        container: null,
        gridContainer: null, // 网格容器引用
        resizeObserver: null, // 用于监听容器大小变化
        debounceTimer: null, // 防抖计时器
    };

    node.resizable = true;
    node.lock_aspect_ratio = false;

    const minNodeHeight = 350;

    injectStyles();

    const container = document.createElement("div");
    container.className = "xis-preview-container";
    state.container = container;
    
    // 渲染函数：根据状态重新构建 DOM
    function render() {
        if (!container) return;

        let innerHTML = '';
        const count = state.images.length;
        // 当只有一张图片时强制使用分页模式
        const actualMode = count === 1 ? 'page' : state.mode;

        if (state.loading) {
            innerHTML = `<div class="xis-preview-empty">
                            <div style="margin:4px auto;display:grid;place-items:center;">
                                <span>加载中...</span>
                            </div>
                        </div>`;
        } else if (count === 0) {
            innerHTML = `<div class="xis-preview-empty">暂无图片，请执行工作流后查看</div>`;
        } else if (actualMode === 'page') {
            const currentImg = state.images[state.currentPage];
            const isAnimated = state.animated[state.currentPage];
            const currentResolution = state.resolutions[state.currentPage] || "N/A";
            const pageInfo = count > 1 ? `${state.currentPage + 1}/${count}` : "";

            // 构造分页模式 HTML
            innerHTML = `
            <div class="xis-preview-page-view">
                <div class="xis-preview-image-stage">
                    ${count > 1 ? '<button class="xis-preview-close-btn">✕</button>' : ''}
                    <img src="${currentImg}" class="xis-preview-image" />
                    ${isAnimated ? '<span class="xis-preview-badge">动画</span>' : ''}

                    ${count > 1 ? `
                    <button class="xis-nav-btn xis-nav-left">〈&nbsp;&nbsp;</button>
                    <button class="xis-nav-btn xis-nav-right">&nbsp;&nbsp;〉</button>
                    ` : ''}
                </div>

                ${count > 0 ? `<div class="xis-resolution-display">
                    ${currentResolution}${pageInfo ? ` | ${pageInfo}` : ''}
                </div>` : ''}
            </div>`;

        } else { // Grid Mode
             innerHTML = `
            <div class="xis-preview-grid">
                ${state.images.map((img, idx) => `
                    <div class="xis-preview-grid-item" data-index="${idx}">
                        <img src="${img}" class="xis-preview-grid-image" />
                        ${state.animated[idx] ? '<span class="xis-preview-badge">动画</span>' : ''}
                    </div>
                `).join('')}
            </div>`;
        }
        
        // 关键步骤：用新内容替换，并重新绑定事件
        container.innerHTML = innerHTML;

        // 如果是网格模式，初始化自适应布局
        if (actualMode === 'grid') {
            state.gridContainer = container.querySelector('.xis-preview-grid');
            if (state.gridContainer) {
                initAdaptiveGrid();
            }
        }

        bindEvents();
    }

    // 优化版网格布局函数 - 最大化空间利用率
    function calculateOptimalLayout(containerWidth, containerHeight) {
        const minItemSize = 120; // 最小图像尺寸
        const gap = 4; // 间距
        const padding = 4; // 容器内边距

        const availableWidth = containerWidth - padding * 2;
        const availableHeight = containerHeight - padding * 2;
        const aspectRatio = availableWidth / availableHeight;

        const imageCount = state.images.length;

        // 如果没有图像，返回默认值
        if (imageCount === 0) {
            return {
                columns: 4,
                rows: 1,
                itemWidth: minItemSize,
                itemHeight: minItemSize,
                fillRate: 0
            };
        }

        // 1. 根据容器宽高比确定基础列数范围
        let minColumns, maxColumns;

        if (aspectRatio > 2.5) { // 非常宽的容器
            minColumns = Math.max(2, Math.floor(imageCount / 2));
            maxColumns = Math.min(imageCount, Math.floor(availableWidth / (minItemSize + gap)));
        } else if (aspectRatio > 1.5) { // 较宽的容器
            minColumns = Math.max(1, Math.floor(Math.sqrt(imageCount) * 0.8));
            maxColumns = Math.min(imageCount, Math.ceil(Math.sqrt(imageCount) * 1.5));
        } else if (aspectRatio < 0.4) { // 非常高的容器
            minColumns = 1;
            maxColumns = Math.min(3, imageCount);
        } else if (aspectRatio < 0.67) { // 较高的容器
            minColumns = 1;
            maxColumns = Math.min(Math.ceil(Math.sqrt(imageCount)), imageCount);
        } else { // 接近方形的容器
            minColumns = Math.max(1, Math.floor(Math.sqrt(imageCount) * 0.7));
            maxColumns = Math.min(imageCount, Math.ceil(Math.sqrt(imageCount) * 1.3));
        }

        // 确保范围合理
        minColumns = Math.max(1, minColumns);
        maxColumns = Math.max(minColumns, Math.min(imageCount, maxColumns));

        // 2. 评估不同列数的布局，选择填充率最高的
        let bestLayout = null;
        let bestFillRate = 0;

        for (let cols = minColumns; cols <= maxColumns; cols++) {
            const rows = Math.ceil(imageCount / cols);
            const itemWidth = (availableWidth - (cols - 1) * gap) / cols;
            const itemHeight = (availableHeight - (rows - 1) * gap) / rows;

            // 检查最小尺寸约束
            if (itemWidth < minItemSize || itemHeight < minItemSize) {
                continue;
            }

            // 计算填充率（空间利用率）
            const totalItemArea = itemWidth * itemHeight * imageCount;
            const containerArea = availableWidth * availableHeight;
            const fillRate = totalItemArea / containerArea;

            // 考虑宽高比适配性分数
            let aspectScore = 1.0;
            const itemAspectRatio = itemWidth / itemHeight;

            // 如果容器很宽，优先宽矩形；如果容器很高，优先高矩形
            if (aspectRatio > 1.5 && itemAspectRatio < 0.8) {
                aspectScore *= 0.8; // 惩罚太高的项目
            } else if (aspectRatio < 0.67 && itemAspectRatio > 1.25) {
                aspectScore *= 0.8; // 惩罚太宽的项目
            }

            const finalScore = fillRate * aspectScore;

            // 选择分数最高的布局
            if (!bestLayout || finalScore > bestFillRate) {
                bestLayout = {
                    columns: cols,
                    rows: rows,
                    itemWidth: itemWidth,
                    itemHeight: itemHeight,
                    fillRate: fillRate
                };
                bestFillRate = finalScore;
            }
        }

        // 3. 如果没有找到合适布局，使用保守方案
        if (!bestLayout) {
            // 尝试更宽松的最小尺寸
            const relaxedMinSize = 80;
            for (let cols = Math.min(4, imageCount); cols >= 1; cols--) {
                const rows = Math.ceil(imageCount / cols);
                const itemWidth = (availableWidth - (cols - 1) * gap) / cols;
                const itemHeight = (availableHeight - (rows - 1) * gap) / rows;

                if (itemWidth >= relaxedMinSize && itemHeight >= relaxedMinSize) {
                    const fillRate = (itemWidth * itemHeight * imageCount) / (availableWidth * availableHeight);
                    return {
                        columns: cols,
                        rows: rows,
                        itemWidth: itemWidth,
                        itemHeight: itemHeight,
                        fillRate: fillRate
                    };
                }
            }

            // 最后手段：使用最小尺寸
            const cols = Math.min(4, imageCount);
            const rows = Math.ceil(imageCount / cols);
            return {
                columns: cols,
                rows: rows,
                itemWidth: minItemSize,
                itemHeight: minItemSize,
                fillRate: (minItemSize * minItemSize * imageCount) / (availableWidth * availableHeight)
            };
        }

        return bestLayout;
    }

    function updateGridLayout() {
        if (!state.gridContainer || state.mode !== 'grid') return;

        const containerWidth = state.gridContainer.clientWidth;
        const containerHeight = state.gridContainer.clientHeight;
        const layout = calculateOptimalLayout(containerWidth, containerHeight);

        // 使用布局计算出的实际尺寸（允许矩形）
        const itemWidth = layout.itemWidth;
        const itemHeight = layout.itemHeight;

        // 更新CSS变量
        state.gridContainer.style.setProperty('--grid-columns', layout.columns);
        state.gridContainer.style.setProperty('--grid-item-size', `${Math.min(itemWidth, itemHeight)}px`);

        // 更新网格项的大小（使用实际计算的宽高）
        const gridItems = state.gridContainer.querySelectorAll('.xis-preview-grid-item');
        gridItems.forEach(item => {
            item.style.width = `${itemWidth}px`;
            item.style.height = `${itemHeight}px`;
        });

    }

    function initAdaptiveGrid() {
        if (!state.gridContainer) return;

        // 初始更新布局
        updateGridLayout();

        // 清理之前的观察器
        if (state.resizeObserver) {
            state.resizeObserver.disconnect();
        }

        // 创建ResizeObserver监听容器大小变化
        state.resizeObserver = new ResizeObserver(() => {
            // 防抖处理，避免频繁重排
            clearTimeout(state.debounceTimer);
            state.debounceTimer = setTimeout(() => {
                updateGridLayout();
            }, 100);
        });

        // 开始观察
        state.resizeObserver.observe(state.gridContainer);

        // 监听窗口大小变化（作为后备）
        window.addEventListener('resize', () => {
            clearTimeout(state.debounceTimer);
            state.debounceTimer = setTimeout(() => {
                if (state.gridContainer && state.mode === 'grid') {
                    updateGridLayout();
                }
            }, 150);
        });
    }

    function cleanupAdaptiveGrid() {
        // 清理观察器
        if (state.resizeObserver) {
            state.resizeObserver.disconnect();
            state.resizeObserver = null;
        }

        // 清理防抖计时器
        clearTimeout(state.debounceTimer);
        state.debounceTimer = null;

        // 移除窗口resize监听器
        window.removeEventListener('resize', () => {});
    }

    // 双击打开图片函数
    function openImageInNewTab(imageIndex) {
        const originalUrl = state.originalImages[imageIndex];
        if (originalUrl && originalUrl.trim()) {
            window.open(originalUrl, '_blank');
        } else {
            // 如果没有原始URL，使用预览URL
            const previewUrl = state.images[imageIndex];
            if (previewUrl && previewUrl.trim()) {
                window.open(previewUrl, '_blank');
            }
        }
    }

    // 事件绑定函数
    function bindEvents() {
        const count = state.images.length;
        const actualMode = count === 1 ? 'page' : state.mode;

        if (actualMode === 'page') {
            // 切换到 Grid 模式
            container.querySelector('.xis-preview-close-btn')?.addEventListener('click', () => {
                cleanupAdaptiveGrid(); // 清理当前布局
                state.mode = 'grid';
                render();
            });

            // 上一页/下一页
            container.querySelector('.xis-nav-left')?.addEventListener('click', () => changePage(-1));
            container.querySelector('.xis-nav-right')?.addEventListener('click', () => changePage(1));

            // 图片加载完成回调（重要！）
            const imgEl = container.querySelector('.xis-preview-image');
            if (imgEl) {
                imgEl.onload = () => {
                    // 确保在图片加载完成且 DOM 稳定后，通知 LiteGraph 可能需要重绘
                    // 配合 resize: false，这有助于防止不必要的拉伸。
                    app.graph.setDirtyCanvas(true, true);
                };

                // 添加双击事件：在新标签页打开原始图片
                imgEl.addEventListener('dblclick', () => {
                    openImageInNewTab(state.currentPage);
                });

                // 添加标题提示
                imgEl.title = "双击在新标签页打开原始图片";
            }

        } else { // Grid Mode
            // 网格图片点击切换到分页模式
            container.querySelectorAll('.xis-preview-grid-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    const index = parseInt(e.currentTarget.dataset.index);
                    cleanupAdaptiveGrid(); // 清理网格布局
                    selectImage(index);
                });
            });
        }
    }
    
    // 状态修改函数
    function changePage(delta) {
        const count = state.images.length;
        if (count <= 1) return;
        state.currentPage = (state.currentPage + delta + count) % count;
        render();
    }

    function selectImage(index) {
        state.currentPage = index;
        state.mode = 'page';
        render();
    }

    // 外部 API
    node.setImages = (urls = [], animatedFlags = [], resolutions = [], originalUrls = []) => {
        state.images = urls.filter(url => url && url.trim());
        state.originalImages = originalUrls.filter(url => url && url.trim());
        // 确保originalImages长度与images一致
        if (state.originalImages.length < state.images.length) {
            state.originalImages = state.originalImages.concat(
                Array(state.images.length - state.originalImages.length).fill("")
            );
        }
        state.animated = animatedFlags || Array(state.images.length).fill(false);
        state.resolutions = resolutions || Array(state.images.length).fill("N/A");
        state.currentPage = 0;
        state.loading = false;
        render();
    };
    
    node.setLoading = (isLoading) => {
        state.loading = isLoading;
        render();
    };


    try {
        // 添加 Widget
        const widget = node.addDOMWidget("XIS Preview", "xis-preview", container, {
            hideOnZoom: false,
            // computeSize 告知 LiteGraph Widget 应占用的高度
            computeSize: (width) => {
                const nodeHeight = node.size?.[1] || minNodeHeight;
                // 计算目标高度：节点高度 - 标题栏/边距/插槽 (~60px)
                const targetHeight = Math.round(Math.max(nodeHeight - 60, 250)); 
                return [width, targetHeight]; 
            },
            // 核心限制：禁止 LiteGraph 自动根据内容调整大小
            resize: false 
        });
        widget.serialize = false;


        // 监听节点执行事件
        const origOnExecuted = node.onExecuted;
        node.onExecuted = function(output) {
            origOnExecuted?.apply(this, arguments);
            node.setLoading(true);
            setTimeout(() => {
                const { urls, originalUrls, animated, resolutions } = buildImageUrls(this.id, output);
                node.setImages(urls, animated, resolutions, originalUrls);
            }, 100);
        };

        const origOnExecutionStart = node.onExecutionStart;
        node.onExecutionStart = function() {
            origOnExecutionStart?.apply(this, arguments);
            node.setLoading(true);
        };

        // 初始化渲染
        const output = app.nodeOutputs?.[node.id] || {};
        const { urls, originalUrls, animated, resolutions } = buildImageUrls(node.id, output);
        node.setImages(urls, animated, resolutions, originalUrls);


        // 确保在移除时销毁
        const origOnRemoved = node.onRemoved;
        node.onRemoved = function() {
            origOnRemoved?.apply(this, arguments);
            // 清理自适应网格布局
            cleanupAdaptiveGrid();
            // 移除所有 DOM 及其事件监听
            if (container.parentNode) {
                container.parentNode.removeChild(container);
            }
            delete this._xisPreviewAttached;
            delete this.setImages;
            delete this.setLoading;
        };
    } catch (err) {
        console.error(`[${EXTENSION_NAME}] 绑定节点失败:`, err);
    }
}

// --- 扩展注册 ---

app.registerExtension({
    name: EXTENSION_NAME,
    
    setup() {
        injectStyles();
    },
    
    nodeCreated(node) {
        if (node && node.comfyClass === TARGET_NODE) {
            setTimeout(() => attachToNode(node), 100); 
        }
    },
    
    loadedGraphNode(node) {
        if (node && node.comfyClass === TARGET_NODE) {
            setTimeout(() => attachToNode(node), 100); 
        }
    }
});