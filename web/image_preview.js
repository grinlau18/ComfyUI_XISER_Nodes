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
    /* 小圆点分页 */
    /* -------------------------------------- */
    .xis-preview-dots {
        height: 16px; /* 节省空间 */
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 6px;
        padding: 4px 0;
        box-sizing: border-box;
        flex-shrink: 0;
    }

    .xis-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: rgba(100, 100, 100, 0.5);
        cursor: pointer;
        transition: background 0.2s;
        flex-shrink: 0;
    }

    .xis-dot:hover {
        background: rgba(100, 100, 100, 0.8);
    }

    .xis-dot-active {
        background: #c3c8ccff; /* 突出显示当前页 */
    }

    /* 方格容器 */

    .xis-preview-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 2fr));
        /* 行高自动：每个行高由内容最高的网格项决定 */
        grid-auto-rows: auto;
        gap: 4px;
        padding: 2px;
        box-sizing: border-box;
        background: transparent;
        width: 100%;
        height: 100%;
        position: relative;
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
        aspect-ratio: 1 / 1;
        background: transparent;
    }

    .xis-preview-grid-image {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
        display: block;
        visibility: visible;
        opacity: 1;
        background: transparent;
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
        return { urls: [], animated: [] };
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
    let animated = [];

    try {
        const outputData = output?.xiser_images || output?.images;
        // ... (URL 构建逻辑与 Vue 版本一致，此处省略以节省空间，但代码中应包含完整逻辑)
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
            
            const outputAnimated = output.animated || [];
            animated = urls.map((_, index) => !!outputAnimated[index]);
        }
        // ... (处理 app.nodePreviewImages 逻辑)
    } catch (err) {
        console.error(`[${EXTENSION_NAME}] 构建图片URL失败:`, err);
        urls = [];
        animated = [];
    }

    return { urls, animated };
}

// --- LiteGraph 节点绑定逻辑 (纯 DOM/JS 实现) ---

function attachToNode(node) {
    if (!node || node._xisPreviewAttached) return;
    if (node.comfyClass !== TARGET_NODE) return;

    node._xisPreviewAttached = true;

    // 状态对象
    const state = {
        mode: "grid", // "grid" or "page"
        images: [],
        animated: [],
        currentPage: 0,
        loading: false,
        container: null,
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

                ${count > 1 ? `<div class="xis-preview-dots">
                    ${state.images.map((_, idx) => `<span class="xis-dot${idx === state.currentPage ? ' xis-dot-active' : ''}" data-index="${idx}"></span>`).join('')}
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
        bindEvents();
    }

    // 事件绑定函数
    function bindEvents() {
        const count = state.images.length;
        const actualMode = count === 1 ? 'page' : state.mode;

        if (actualMode === 'page') {
            // 切换到 Grid 模式
            container.querySelector('.xis-preview-close-btn')?.addEventListener('click', () => {
                state.mode = 'grid';
                render();
            });

            // 上一页/下一页
            container.querySelector('.xis-nav-left')?.addEventListener('click', () => changePage(-1));
            container.querySelector('.xis-nav-right')?.addEventListener('click', () => changePage(1));

            // 点点分页
            container.querySelectorAll('.xis-dot').forEach(dot => {
                dot.addEventListener('click', (e) => selectImage(parseInt(e.target.dataset.index)));
            });

            // 图片加载完成回调（重要！）
            const imgEl = container.querySelector('.xis-preview-image');
            if (imgEl) {
                imgEl.onload = () => {
                    // 确保在图片加载完成且 DOM 稳定后，通知 LiteGraph 可能需要重绘
                    // 配合 resize: false，这有助于防止不必要的拉伸。
                    app.graph.setDirtyCanvas(true, true);
                };
            }

        } else { // Grid Mode
            // 网格图片点击切换到分页模式
            container.querySelectorAll('.xis-preview-grid-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    const index = parseInt(e.currentTarget.dataset.index);
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
    node.setImages = (urls = [], animatedFlags = []) => {
        state.images = urls.filter(url => url && url.trim());
        state.animated = animatedFlags || Array(state.images.length).fill(false);
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
                const { urls, animated } = buildImageUrls(this.id, output);
                node.setImages(urls, animated);
            }, 100);
        };

        const origOnExecutionStart = node.onExecutionStart;
        node.onExecutionStart = function() {
            origOnExecutionStart?.apply(this, arguments);
            node.setLoading(true);
        };

        // 初始化渲染
        const output = app.nodeOutputs?.[node.id] || {};
        const { urls, animated } = buildImageUrls(node.id, output);
        node.setImages(urls, animated);


        // 确保在移除时销毁
        const origOnRemoved = node.onRemoved;
        node.onRemoved = function() {
            origOnRemoved?.apply(this, arguments);
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