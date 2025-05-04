import { app } from "/scripts/app.js";

// 日志级别控制
const LOG_LEVEL = "info";
const log = {
    info: (...args) => { if (LOG_LEVEL !== "error") console.log(...args); },
    error: (...args) => console.error(...args)
};

app.registerExtension({
    name: "xiser.canvas",
    async setup() {
        log.info("XISER_Canvas extension loaded");
        if (!window.requestIdleCallback) {
            window.requestIdleCallback = function (callback) {
                return setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 50 }), 1);
            };
            window.cancelIdleCallback = function (id) {
                clearTimeout(id);
            };
        }
        const style = document.createElement("style");
        style.textContent = `
            .xiser-canvas-container {
                position: absolute;
                box-sizing: border-box;
                overflow: visible;
                z-index: 1000;
            }
            .xiser-canvas-stage {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: transparent;
                min-width: 200px;
                min-height: 200px;
                overflow: visible;
                margin: 0;
                padding: 0;
            }
            .xiser-node {
                resize: none !important;
                overflow: visible !important;
                user-select: none;
                position: relative;
            }
            .xiser-node .comfy-node-resize-handle {
                display: none !important;
            }
            .xiser-main-container {
                position: absolute;
                display: block;
                min-height: 100px;
                background: transparent;
                overflow: visible;
                transform-origin: top left;
            }
            .xiser-status-text {
                position: absolute;
                top: 10px;
                left: 10px;
                color: #fff;
                background-color: rgba(0, 0, 0, 0.7);
                padding: var(--xiser-padding, 3px);
                font-family: Arial, sans-serif;
                font-size: var(--xiser-font-size, 12px);
                z-index: 10;
            }
            .xiser-trigger-button, .xiser-reset-button, .xiser-undo-button, .xiser-redo-button {
                position: absolute;
                top: 10px;
                color: #fff;
                padding: var(--xiser-padding, 5px 10px);
                font-family: Arial, sans-serif;
                font-size: var(--xiser-font-size, 12px);
                border: none;
                cursor: pointer;
                z-index: 10;
            }
            .xiser-trigger-button {
                right: 10px;
                background-color: #4CAF50;
            }
            .xiser-trigger-button:hover {
                background-color: #45a049;
            }
            .xiser-reset-button {
                right: 90px;
                background-color: #f44336;
            }
            .xiser-reset-button:hover {
                background-color: #da190b;
            }
            .xiser-undo-button {
                right: 170px;
                background-color: #2196F3;
            }
            .xiser-undo-button:hover {
                background-color: #0b7dda;
            }
            .xiser-redo-button {
                right: 225px;
                background-color: #2196F3;
            }
            .xiser-redo-button:hover {
                background-color: #0b7dda;
            }
            .xiser-layer-panel {
                position: absolute;
                top: 50px;
                left: 10px;
                background-color: rgba(0, 0, 0, 0.8);
                color: #fff;
                padding: var(--xiser-padding, 10px);
                font-family: Arial, sans-serif;
                font-size: var(--xiser-font-size, 12px);
                z-index: 10;
                max-height: 200px;
                overflow-y: auto;
            }
            .xiser-layer-item {
                padding: var(--xiser-padding, 5px);
                cursor: pointer;
                border-bottom: 1px solid #444;
            }
            .xiser-layer-item:hover {
                background-color: #555;
            }
            .xiser-layer-item.selected {
                background-color: #2196F3;
                color: #fff;
            }
        `;
        document.head.appendChild(style);

        await new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = "/extensions/ComfyUI_XISER_Nodes/lib/konva.min.js";
            script.onload = () => {
                log.info("Konva.js loaded successfully");
                resolve();
            };
            script.onerror = () => {
                log.error("Failed to load Konva.js");
                reject();
            };
            document.head.appendChild(script);
        });

        const originalOnNodeExecuted = app.graph.onNodeExecuted || (() => {});
        app.graph.onNodeExecuted = function (node) {
            log.info("Global onNodeExecuted triggered for node:", node.id);
            originalOnNodeExecuted.apply(this, arguments);
            if (node._onNodeExecuted) {
                node._onNodeExecuted(node);
            }
        };
    },
    async nodeCreated(node) {
        if (node.comfyClass !== "XISER_Canvas") return;

        // 延迟日志打印，确保 node.id 已分配
        setTimeout(() => {
            log.info("XISER_Canvas node created:", node.id);
        }, 100);

        if (node.widgets && node.widgets.length > 0) {
            for (let i = node.widgets.length - 1; i >= 0; i--) {
                const widget = node.widgets[i];
                if (widget.element && widget.element.parentNode) {
                    widget.element.parentNode.removeChild(widget.element);
                }
                node.widgets.splice(i, 1);
            }
        }
        node.widgets = [];

        // 初始化节点状态
        const nodeState = {
            imageNodes: [],
            defaultLayerOrder: [],
            initialStates: [],
            transformer: null,
            lastImagePaths: [],
            loadedImageUrls: new Map(),
            imageCache: new Map(),
            history: [],
            historyIndex: -1,
            selectedLayer: null,
            layerItems: [],
            lastNodePos: node.pos ? [...node.pos] : [0, 0],
            lastNodeSize: node.size ? [...node.size] : [0, 0],
            lastScale: app.canvas.ds.scale || 1,
            lastOffset: app.canvas.ds.offset ? [...app.canvas.ds.offset] : [0, 0],
            pollInterval: null,
            animationFrameId: null
        };

        // 从 node.properties.ui_config 和 node.widgets_values 恢复参数
        const uiConfig = node.properties?.ui_config || {};
        nodeState.initialStates = node.properties?.image_states || [];
        let boardWidth = uiConfig.board_width || 1024;
        let boardHeight = uiConfig.board_height || 1024;
        let borderWidth = uiConfig.border_width || 40;
        let canvasColor = uiConfig.canvas_color || "rgb(0, 0, 0)";
        let borderColor = uiConfig.border_color || "rgb(25, 25, 25)";
        let imagePaths = uiConfig.image_paths ? (typeof uiConfig.image_paths === "string" ? uiConfig.image_paths.split(",").filter(p => p) : uiConfig.image_paths) : [];

        // 从 widgets_values 恢复参数
        let canvasColorValue = node.widgets_values && node.widgets_values[3] ? node.widgets_values[3] :
                              canvasColor === "rgb(0, 0, 0)" ? "black" :
                              canvasColor === "rgb(255, 255, 255)" ? "white" :
                              canvasColor === "rgba(0, 0, 0, 0)" ? "transparent" : "black";

        if (node.widgets_values && node.widgets_values.length >= 5) {
            boardWidth = parseInt(node.widgets_values[0]) || boardWidth;
            boardHeight = parseInt(node.widgets_values[1]) || boardHeight;
            borderWidth = parseInt(node.widgets_values[2]) || borderWidth;
            canvasColorValue = node.widgets_values[3] || canvasColorValue;
            if (node.widgets_values[4]) {
                try {
                    nodeState.initialStates = JSON.parse(node.widgets_values[4]) || nodeState.initialStates;
                } catch (e) {
                    log.error("Failed to parse image_states from widgets_values:", e);
                }
            }
        }

        // 确保 node.inputs 正确初始化
        node.inputs = node.inputs || {};
        node.inputs.board_width = node.inputs.board_width || { value: boardWidth, type: "INT" };
        node.inputs.board_height = node.inputs.board_height || { value: boardHeight, type: "INT" };
        node.inputs.border_width = node.inputs.border_width || { value: borderWidth, type: "INT" };
        node.inputs.canvas_color = node.inputs.canvas_color || { value: canvasColorValue, type: "STRING" };

        // 设置初始 node.size
        const nodeWidth = boardWidth + 2 * borderWidth + 20;
        const nodeHeight = boardHeight + 2 * borderWidth + 206;
        node.size = [nodeWidth, nodeHeight];
        node.setSize([nodeWidth, nodeHeight]);

        node.widgets_values = [boardWidth, boardHeight, borderWidth, canvasColorValue, JSON.stringify(nodeState.initialStates)];

        node.addWidget("number", "board_width", boardWidth, (value) => {
            boardWidth = Math.min(Math.max(parseInt(value), 256), 4096);
            updateSize();
        }, { min: 256, max: 4096, step: 16 });

        node.addWidget("number", "board_height", boardHeight, (value) => {
            boardHeight = Math.min(Math.max(parseInt(value), 256), 4096);
            updateSize();
        }, { min: 256, max: 4096, step: 16 });

        node.addWidget("number", "border_width", borderWidth, (value) => {
            borderWidth = Math.min(Math.max(parseInt(value), 10), 200);
            updateSize();
        }, { min: 10, max: 200, step: 1 });

        node.addWidget("combo", "canvas_color", canvasColorValue, (value) => {
            canvasColorValue = value;
            updateSize();
        }, { values: ["black", "white", "transparent"] });

        node.addWidget("hidden", "image_states", JSON.stringify(nodeState.initialStates), (value) => {}, { serialize: true });

        // 创建独立的主容器，附加到 <body>
        const mainContainer = document.createElement("div");
        mainContainer.className = "xiser-main-container";
        document.body.appendChild(mainContainer);

        const boardContainer = document.createElement("div");
        boardContainer.className = "xiser-canvas-container";

        const statusText = document.createElement("div");
        statusText.className = "xiser-status-text";
        statusText.innerText = "等待图像...";
        boardContainer.appendChild(statusText);

        const triggerButton = document.createElement("button");
        triggerButton.className = "xiser-trigger-button";
        triggerButton.innerText = "运行节点";
        triggerButton.onclick = () => {
            triggerPrompt();
        };
        boardContainer.appendChild(triggerButton);

        const resetButton = document.createElement("button");
        resetButton.className = "xiser-reset-button";
        resetButton.innerText = "重置画板";
        resetButton.onclick = () => {
            resetCanvas();
        };
        boardContainer.appendChild(resetButton);

        const undoButton = document.createElement("button");
        undoButton.className = "xiser-undo-button";
        undoButton.innerText = "撤销";
        undoButton.onclick = () => {
            undo();
        };
        boardContainer.appendChild(undoButton);

        const redoButton = document.createElement("button");
        redoButton.className = "xiser-redo-button";
        redoButton.innerText = "重做";
        redoButton.onclick = () => {
            redo();
        };
        boardContainer.appendChild(redoButton);

        const layerPanel = document.createElement("div");
        layerPanel.className = "xiser-layer-panel";
        boardContainer.appendChild(layerPanel);

        const stageContainer = document.createElement("div");
        stageContainer.className = "xiser-canvas-stage";
        boardContainer.appendChild(stageContainer);
        mainContainer.appendChild(boardContainer);

        if (!window.Konva) {
            log.error("Konva.js not loaded, aborting stage creation");
            statusText.innerText = "错误：Konva.js 未加载";
            statusText.style.color = "#f00";
            mainContainer.remove();
            return;
        }

        const stage = new Konva.Stage({
            container: stageContainer,
            width: boardWidth + 2 * borderWidth,
            height: boardHeight + 2 * borderWidth
        });

        const canvasLayer = new Konva.Layer();
        const imageLayer = new Konva.Layer();
        stage.add(canvasLayer);
        stage.add(imageLayer);

        const canvasRect = new Konva.Rect({
            x: borderWidth,
            y: borderWidth,
            width: boardWidth,
            height: boardHeight,
            fill: canvasColor,
            stroke: "#808080",
            strokeWidth: 2
        });

        const borderRect = new Konva.Rect({
            x: 0,
            y: 0,
            width: boardWidth + 2 * borderWidth,
            height: boardHeight + 2 * borderWidth,
            fill: borderColor,
            stroke: "#808080",
            strokeWidth: 2
        });

        canvasLayer.add(borderRect);
        canvasLayer.add(canvasRect);

        // 同步容器位置
        function syncContainerPosition() {
            try {
                const canvas = app.canvas.canvas;
                const canvasRect = canvas.getBoundingClientRect();
                const nodePos = node.pos;
                const nodeSize = node.size;
                const scale = app.canvas.ds.scale;
                const offset = app.canvas.ds.offset;

                // 计算节点在画布中的像素坐标
                const logicalX = (nodePos[0] + offset[0]) * scale;
                const logicalY = (nodePos[1] + offset[1]) * scale;

                // 转换为浏览器视口的绝对像素坐标
                const x = canvasRect.left + logicalX + 10 * scale; // 加上节点的边距（10px）
                const y = canvasRect.top + logicalY + 186 * scale; // 加上标题栏高度（186px）
                const width = (nodeSize[0] - 20); // 逻辑宽度，缩放前
                const height = (nodeSize[1] - 206); // 逻辑高度，缩放前

                // 设置 mainContainer 的绝对位置和缩放
                mainContainer.style.left = `${x}px`;
                mainContainer.style.top = `${y}px`;
                mainContainer.style.width = `${width}px`;
                mainContainer.style.height = `${height}px`;
                mainContainer.style.transform = `scale(${scale})`; // 使用 CSS 缩放

                // 设置 boardContainer 的逻辑尺寸（抵消缩放影响）
                boardContainer.style.width = `${width}px`;
                boardContainer.style.height = `${height}px`;

                // 保持 stage 逻辑尺寸不变
                stage.width(boardWidth + 2 * borderWidth);
                stage.height(boardHeight + 2 * borderWidth);
                borderRect.width(boardWidth + 2 * borderWidth);
                borderRect.height(boardHeight + 2 * borderWidth);
                canvasRect.x(borderWidth);
                canvasRect.y(borderWidth);
                canvasRect.width(boardWidth);
                canvasRect.height(boardHeight);
                canvasLayer.batchDraw();

                // 动态调整控件样式（仅调整视觉大小，不调整位置）
                const basePadding = 5; // 基础内边距
                const baseFontSize = 12; // 基础字体大小
                const padding = basePadding / scale;
                const fontSize = baseFontSize / scale;

                mainContainer.style.setProperty('--xiser-padding', `${padding}px`);
                mainContainer.style.setProperty('--xiser-font-size', `${fontSize}px`);

                imageLayer.batchDraw();

                log.info(`Sync position: nodePos=(${nodePos[0]}, ${nodePos[1]}), scale=${scale}, offset=(${offset[0]}, ${offset[1]}), canvasRect=(${canvasRect.left}, ${canvasRect.top}), final=(${x}, ${y}, ${width}, ${height})`);
            } catch (e) {
                log.error("Error syncing container position:", e);
            }
        }

        // 延迟初始同步位置，确保画布渲染完成
        setTimeout(() => {
            syncContainerPosition();
        }, 500);

        // 实时检测节点位置和大小变化
        function checkPositionAndSize() {
            try {
                const nodePos = node.pos;
                const nodeSize = node.size;
                const scale = app.canvas.ds.scale;
                const offset = app.canvas.ds.offset;

                const posChanged = nodePos[0] !== nodeState.lastNodePos[0] || nodePos[1] !== nodeState.lastNodePos[1];
                const sizeChanged = nodeSize[0] !== nodeState.lastNodeSize[0] || nodePos[1] !== nodeState.lastNodeSize[1];
                const scaleChanged = scale !== nodeState.lastScale;
                const offsetChanged = offset[0] !== nodeState.lastOffset[0] || offset[1] !== nodeState.lastOffset[1];

                if (posChanged || sizeChanged || scaleChanged || offsetChanged) {
                    syncContainerPosition();
                    nodeState.lastNodePos = [...nodePos];
                    nodeState.lastNodeSize = [...nodeSize];
                    nodeState.lastScale = scale;
                    nodeState.lastOffset = [...offset];
                }
            } catch (e) {
                log.error("Error in checkPositionAndSize:", e);
            }
            nodeState.animationFrameId = requestAnimationFrame(checkPositionAndSize);
        }
        nodeState.animationFrameId = requestAnimationFrame(checkPositionAndSize);

        // 监听窗口调整
        const resizeListener = () => {
            syncContainerPosition();
        };
        window.addEventListener("resize", resizeListener);

        // 使用 ctx 绘制占位矩形
        node.onDrawForeground = function (ctx) {
            try {
                ctx.save();
                ctx.fillStyle = borderColor;
                ctx.fillRect(10, 186, node.size[0] - 20, node.size[1] - 206);
                ctx.strokeStyle = "#808080";
                ctx.lineWidth = 2;
                ctx.strokeRect(10 + borderWidth, 186 + borderWidth, boardWidth, boardHeight);
                ctx.restore();
            } catch (e) {
                log.error("Error in onDrawForeground:", e);
            }
        };

        function saveHistory() {
            const currentState = nodeState.initialStates.map(state => ({ ...state }));
            nodeState.history.splice(nodeState.historyIndex + 1);
            nodeState.history.push(currentState);
            nodeState.historyIndex++;
            if (nodeState.history.length > 20) {
                nodeState.history.shift();
                nodeState.historyIndex--;
            }
        }

        function undo() {
            if (nodeState.historyIndex <= 0) return;
            nodeState.historyIndex--;
            nodeState.initialStates = nodeState.history[nodeState.historyIndex].map(state => ({ ...state }));
            applyStates();
            node.properties.image_states = nodeState.initialStates;
            node.widgets.find(w => w.name === "image_states").value = JSON.stringify(nodeState.initialStates);
            node.setProperty("image_states", nodeState.initialStates);
            imageLayer.batchDraw();
        }

        function redo() {
            if (nodeState.historyIndex >= nodeState.history.length - 1) return;
            nodeState.historyIndex++;
            nodeState.initialStates = nodeState.history[nodeState.historyIndex].map(state => ({ ...state }));
            applyStates();
            node.properties.image_states = nodeState.initialStates;
            node.widgets.find(w => w.name === "image_states").value = JSON.stringify(nodeState.initialStates);
            node.setProperty("image_states", nodeState.initialStates);
            imageLayer.batchDraw();
        }

        function applyStates() {
            nodeState.imageNodes.forEach((node, i) => {
                const state = nodeState.initialStates[i] || {};
                const maxWidth = boardWidth * 0.8;
                const maxHeight = boardHeight * 0.8;
                const imageScale = Math.min(1, maxWidth / node.width(), maxHeight / node.height());
                node.x(state.x || borderWidth + boardWidth / 2);
                node.y(state.y || borderWidth + boardHeight / 2);
                node.scaleX(imageScale * (state.scaleX || 1));
                node.scaleY(imageScale * (state.scaleY || 1));
                node.rotation(state.rotation || 0);
            });
        }

        function resetCanvas() {
            nodeState.initialStates = imagePaths.map(() => ({
                x: borderWidth + boardWidth / 2,
                y: borderWidth + boardHeight / 2,
                scaleX: 1,
                scaleY: 1,
                rotation: 0
            }));
            applyStates();
            node.properties.image_states = nodeState.initialStates;
            node.widgets.find(w => w.name === "image_states").value = JSON.stringify(nodeState.initialStates);
            node.setProperty("image_states", nodeState.initialStates);
            imageLayer.batchDraw();
            saveHistory();
            deselectLayer();
        }

        function updateLayerPanel() {
            layerPanel.innerHTML = "";
            nodeState.layerItems = [];
            for (let index = nodeState.imageNodes.length - 1; index >= 0; index--) {
                const item = document.createElement("div");
                item.className = "xiser-layer-item";
                item.innerText = `图层 ${index + 1}`;
                item.dataset.index = index;
                layerPanel.appendChild(item);
                nodeState.layerItems.push(item);

                item.addEventListener("click", () => {
                    const currentIndex = parseInt(item.dataset.index);
                    if (nodeState.selectedLayer === nodeState.imageNodes[currentIndex]) {
                        deselectLayer();
                    } else {
                        selectLayer(currentIndex);
                    }
                });
            }
        }

        function selectLayer(index) {
            if (index < 0 || index >= nodeState.imageNodes.length) return;
            const node = nodeState.imageNodes[index];

            deselectLayer();

            nodeState.selectedLayer = node;
            node.moveToTop();
            nodeState.transformer.nodes([node]);
            imageLayer.batchDraw();

            nodeState.layerItems.forEach(item => item.classList.remove("selected"));
            const listItemIndex = nodeState.imageNodes.length - 1 - index;
            if (nodeState.layerItems[listItemIndex]) {
                nodeState.layerItems[listItemIndex].classList.add("selected");
            }
        }

        function deselectLayer() {
            if (!nodeState.selectedLayer) return;

            // 恢复输入时的默认图层顺序
            nodeState.defaultLayerOrder.forEach((node, index) => {
                node.zIndex(index);
            });

            nodeState.selectedLayer = null;
            nodeState.transformer.nodes([]);
            imageLayer.batchDraw();

            nodeState.layerItems.forEach(item => item.classList.remove("selected"));
        }

        async function loadImages(imagePaths, states, base64Chunks = [], retryCount = 0, maxRetries = 3) {
            if (!imagePaths || imagePaths.length === 0) {
                log.warn("No image paths provided for node:", node.id);
                statusText.innerText = "无图像数据";
                statusText.style.color = "#f00";
                return;
            }

            if (states.length !== imagePaths.length) {
                states = states.slice(0, imagePaths.length);
                while (states.length < imagePaths.length) {
                    states.push({ x: borderWidth + boardWidth / 2, y: borderWidth + boardHeight / 2, scaleX: 1, scaleY: 1, rotation: 0 });
                }
            }

            const images = imagePaths.map(path => ({
                filename: path,
                subfolder: "xiser_canvas",
                type: "output",
                mime_type: "image/png"
            }));

            const currentFilenames = images.map(img => img.filename);
            const imagesToLoad = images.filter(img => !nodeState.imageNodes.some(node => node.attrs.filename === img.filename));
            const imagesToRemove = nodeState.imageNodes.filter(node => !currentFilenames.includes(node.attrs.filename));

            imagesToRemove.forEach(node => {
                node.destroy();
                nodeState.imageNodes = nodeState.imageNodes.filter(n => n !== node);
                nodeState.loadedImageUrls.delete(node.attrs.filename);
            });
            imageLayer.batchDraw();

            if (imagesToLoad.length === 0) {
                statusText.innerText = `已加载 ${nodeState.imageNodes.length} 张图像`;
                statusText.style.color = "#0f0";
                updateLayerPanel();
                return;
            }

            statusText.innerText = `加载图像... 0/${images.length}`;
            statusText.style.color = "#fff";

            let loadedCount = nodeState.imageNodes.length;
            for (let i = 0; i < images.length; i++) {
                const imgData = images[i];
                if (nodeState.imageNodes.some(node => node.attrs.filename === imgData.filename)) continue;

                try {
                    let img = nodeState.imageCache.get(imgData.filename);
                    if (!img) {
                        img = new Image();
                        let imgUrl = `/view?filename=${encodeURIComponent(imgData.filename)}&subfolder=${encodeURIComponent(imgData.subfolder || '')}&type=${imgData.type}&rand=${Math.random()}`;
                        const response = await fetch(imgUrl, { method: 'HEAD' });
                        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                        img.src = imgUrl;
                        await new Promise((resolve, reject) => {
                            img.onload = () => {
                                nodeState.imageCache.set(imgData.filename, img);
                                nodeState.loadedImageUrls.set(imgData.filename, imgUrl);
                                resolve();
                            };
                            img.onerror = () => {
                                log.error(`Failed to load image ${i+1}: ${imgData.filename}, URL: ${imgUrl}`);
                                if (retryCount < maxRetries) {
                                    setTimeout(() => loadImages([imgData.filename], [states[i]], base64Chunks, retryCount + 1, maxRetries), 1000);
                                }
                                resolve();
                            };
                        });
                    }

                    const state = states[i] || {};
                    const maxWidth = boardWidth * 0.8;
                    const maxHeight = boardHeight * 0.8;
                    const imageScale = Math.min(1, maxWidth / img.width, maxHeight / img.height);
                    const konvaImg = new Konva.Image({
                        image: img,
                        x: state.x || borderWidth + boardWidth / 2,
                        y: state.y || borderWidth + boardHeight / 2,
                        scaleX: imageScale * (state.scaleX || 1),
                        scaleY: imageScale * (state.scaleY || 1),
                        rotation: state.rotation || 0,
                        draggable: true,
                        offsetX: img.width / 2,
                        offsetY: img.height / 2,
                        filename: imgData.filename
                    });
                    imageLayer.add(konvaImg);
                    nodeState.imageNodes.push(konvaImg);
                    nodeState.initialStates[i] = nodeState.initialStates[i] || {
                        x: state.x || borderWidth + boardWidth / 2,
                        y: state.y || borderWidth + boardHeight / 2,
                        scaleX: konvaImg.scaleX() / imageScale,
                        scaleY: konvaImg.scaleY() / imageScale,
                        rotation: konvaImg.rotation()
                    };

                    const updateImageState = () => {
                        nodeState.initialStates[i] = {
                            x: konvaImg.x(),
                            y: konvaImg.y(),
                            scaleX: konvaImg.scaleX() / imageScale,
                            scaleY: konvaImg.scaleY() / imageScale,
                            rotation: konvaImg.rotation()
                        };
                        node.properties.image_states = nodeState.initialStates;
                        node.widgets.find(w => w.name === "image_states").value = JSON.stringify(nodeState.initialStates);
                        node.setProperty("image_states", nodeState.initialStates);
                        imageLayer.batchDraw();
                        saveHistory();
                    };

                    konvaImg.on("dragend transformend", updateImageState);

                    loadedCount++;
                    statusText.innerText = `加载图像... ${loadedCount}/${images.length}`;
                } catch (e) {
                    log.error(`Error loading image ${i+1}:`, e);
                    statusText.innerText = `加载失败：${e.message}`;
                    statusText.style.color = "#f00";
                    continue;
                }
            }

            // 记录输入时的默认图层顺序
            nodeState.defaultLayerOrder = [...nodeState.imageNodes];

            updateLayerPanel();
            nodeState.transformer.nodes([]);
            imageLayer.add(nodeState.transformer);
            imageLayer.batchDraw();
            if (loadedCount === 0) {
                statusText.innerText = "无法加载任何图像，请检查上游节点";
                statusText.style.color = "#f00";
            } else {
                statusText.innerText = `已加载 ${loadedCount} 张图像`;
                statusText.style.color = "#0f0";
            }
            saveHistory();
        }

        if (imagePaths.length > 0) {
            loadImages(imagePaths, nodeState.initialStates);
        }

        nodeState.transformer = new Konva.Transformer({
            nodes: [],
            keepRatio: true,
            enabledAnchors: ["top-left", "top-right", "bottom-left", "bottom-right"],
            rotateEnabled: true
        });
        imageLayer.add(nodeState.transformer);

        stage.on("click tap", (e) => {
            const target = e.target;
            if (target === canvasRect || target === stage || target === borderRect) {
                deselectLayer();
                return;
            }
            if (nodeState.imageNodes.includes(target)) {
                const index = nodeState.imageNodes.indexOf(target);
                if (nodeState.selectedLayer === target) return;
                selectLayer(index);
            }
        });

        stage.on("mousedown", (e) => {
            if (nodeState.imageNodes.includes(e.target)) {
                const index = nodeState.imageNodes.indexOf(e.target);
                selectLayer(index);
            }
        });

        stage.on("wheel", (e) => {
            e.evt.preventDefault();
            const scaleBy = 1.01;
            const target = nodeState.transformer.nodes()[0];
            if (!target || !nodeState.imageNodes.includes(target)) return;

            const oldScale = target.scaleX();
            const newScale = e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy;

            target.scaleX(newScale);
            target.scaleY(newScale);

            const index = nodeState.imageNodes.indexOf(target);
            if (index !== -1) {
                const maxWidth = boardWidth * 0.8;
                const maxHeight = boardHeight * 0.8;
                const imageScale = Math.min(1, maxWidth / target.width(), maxHeight / target.height());
                nodeState.initialStates[index] = {
                    x: target.x(),
                    y: target.y(),
                    scaleX: target.scaleX() / imageScale,
                    scaleY: target.scaleY() / imageScale,
                    rotation: target.rotation()
                };
                node.properties.image_states = nodeState.initialStates;
                node.widgets.find(w => w.name === "image_states").value = JSON.stringify(nodeState.initialStates);
                node.setProperty("image_states", nodeState.initialStates);
                saveHistory();
            }

            imageLayer.batchDraw();
        });

        node.addDOMWidget("canvas", "Canvas", document.createElement("div"), {
            serialize: true,
            getValue() {
                return {
                    board_width: boardWidth,
                    board_height: boardHeight,
                    border_width: borderWidth,
                    canvas_color: canvasColor,
                    border_color: borderColor,
                    image_paths: imagePaths,
                    image_states: nodeState.initialStates
                };
            },
            setValue(value) {
                try {
                    boardWidth = value.board_width || boardWidth;
                    boardHeight = value.board_height || boardHeight;
                    borderWidth = value.border_width || borderWidth;
                    canvasColor = value.canvas_color || canvasColor;
                    borderColor = value.border_color || borderColor;
                    imagePaths = value.image_paths || imagePaths;
                    nodeState.initialStates = value.image_states || nodeState.initialStates;
                    updateSize();
                    if (imagePaths.length > 0) {
                        loadImages(imagePaths, nodeState.initialStates);
                    }
                } catch (e) {
                    log.error("Error in setValue:", e);
                    statusText.innerText = "设置画板值失败";
                    statusText.style.color = "#f00";
                }
            }
        });

        node.resizable = false;
        node.isResizable = () => false;

        if (node.getHTMLElement) {
            const element = node.getHTMLElement();
            if (element) {
                element.classList.add("xiser-node");
            }
        }

        function triggerPrompt() {
            try {
                node.properties.image_states = nodeState.initialStates;
                const serializedStates = JSON.stringify(nodeState.initialStates);
                node.widgets.find(w => w.name === "image_states").value = serializedStates;
                node.setProperty("image_states", nodeState.initialStates);
                if (app.queuePrompt) {
                    app.queuePrompt();
                }
            } catch (e) {
                log.error("Failed to queue prompt:", e);
            }
        }

        function updateSize() {
            try {
                // 验证参数范围
                boardWidth = Math.min(Math.max(parseInt(boardWidth) || 1024, 256), 4096);
                boardHeight = Math.min(Math.max(parseInt(boardHeight) || 1024, 256), 4096);
                borderWidth = Math.min(Math.max(parseInt(borderWidth) || 40, 10), 200);
                canvasColorValue = canvasColorValue || "black";

                canvasColor = {
                    "black": "rgb(0, 0, 0)",
                    "white": "rgb(255, 255, 255)",
                    "transparent": "rgba(0, 0, 0, 0)"
                }[canvasColorValue] || "rgb(0, 0, 0)";
                borderColor = {
                    "black": "rgb(25, 25, 25)",
                    "white": "rgb(230, 230, 230)",
                    "transparent": "rgba(0, 0, 0, 0)"
                }[canvasColorValue] || "rgb(25, 25, 25)";

                // 更新 widgets 和 inputs
                node.widgets.forEach(widget => {
                    if (widget.name === "board_width") widget.value = boardWidth;
                    if (widget.name === "board_height") widget.value = boardHeight;
                    if (widget.name === "border_width") widget.value = borderWidth;
                    if (widget.name === "canvas_color") widget.value = canvasColorValue;
                    if (widget.name === "image_states") widget.value = JSON.stringify(nodeState.initialStates);
                });
                node.widgets_values = [boardWidth, boardHeight, borderWidth, canvasColorValue, JSON.stringify(nodeState.initialStates)];

                // 安全更新 node.inputs
                if (node.inputs) {
                    if (node.inputs.board_width) node.inputs.board_width.value = boardWidth;
                    if (node.inputs.board_height) node.inputs.board_height.value = boardHeight;
                    if (node.inputs.border_width) node.inputs.border_width.value = borderWidth;
                    if (node.inputs.canvas_color) node.inputs.canvas_color.value = canvasColorValue;
                }

                // 更新 stage 和画板元素
                const containerWidth = boardWidth + 2 * borderWidth;
                const containerHeight = boardHeight + 2 * borderWidth;
                if (stage) {
                    stage.width(containerWidth);
                    stage.height(containerHeight);
                }
                if (borderRect) {
                    borderRect.setAttrs({
                        x: 0,
                        y: 0,
                        width: containerWidth,
                        height: containerHeight,
                        fill: borderColor
                    });
                }
                if (canvasRect) {
                    canvasRect.setAttrs({
                        x: borderWidth,
                        y: borderWidth,
                        width: boardWidth,
                        height: boardHeight,
                        fill: canvasColor
                    });
                }

                // 更新图像节点位置
                nodeState.imageNodes.forEach((node, i) => {
                    const state = nodeState.initialStates[i] || {};
                    const imgWidth = node.width();
                    const imgHeight = node.height();
                    const maxWidth = boardWidth * 0.8;
                    const maxHeight = boardHeight * 0.8;
                    const imageScale = Math.min(1, maxWidth / imgWidth, maxHeight / imgHeight);
                    const newX = state.x || borderWidth + boardWidth / 2;
                    const newY = state.y || borderWidth + boardHeight / 2;
                    node.x(newX);
                    node.y(newY);
                    node.scaleX(imageScale * (state.scaleX || 1));
                    node.scaleY(imageScale * (state.scaleY || 1));
                    node.rotation(state.rotation || 0);
                    node.offsetX(imgWidth / 2);
                    node.offsetY(imgHeight / 2);
                    nodeState.initialStates[i] = {
                        x: newX,
                        y: newY,
                        scaleX: node.scaleX() / imageScale,
                        scaleY: node.scaleY() / imageScale,
                        rotation: node.rotation()
                    };
                });

                // 更新节点尺寸
                const nodeWidth = boardWidth + 2 * borderWidth + 20;
                const nodeHeight = boardHeight + 2 * borderWidth + 206;
                node.size = [nodeWidth, nodeHeight];
                node.setSize([nodeWidth, nodeHeight]);

                // 更新 node.properties
                node.properties.ui_config = {
                    board_width: boardWidth,
                    board_height: boardHeight,
                    border_width: borderWidth,
                    canvas_color: canvasColor,
                    border_color: borderColor,
                    image_paths: imagePaths
                };
                node.properties.image_states = nodeState.initialStates;
                node.setProperty("ui_config", node.properties.ui_config);
                node.setProperty("image_states", nodeState.initialStates);

                // 绘制画板
                if (canvasLayer) canvasLayer.batchDraw();
                if (imageLayer) imageLayer.batchDraw();
                if (stage) stage.batchDraw();

                updateLayerPanel();
                syncContainerPosition();
            } catch (e) {
                log.error("Error in updateSize:", e.message, e.stack);
                statusText.innerText = "更新画板失败：" + e.message;
                statusText.style.color = "#f00";
            }
        }

        function startPolling() {
            if (nodeState.pollInterval) clearInterval(nodeState.pollInterval);
            nodeState.pollInterval = setInterval(() => {
                let newImagePaths = [];
                let states = node.properties?.image_states || [];

                if (node.outputs && node.outputs[1] && node.outputs[1].value) {
                    if (typeof node.outputs[1].value === "string") {
                        newImagePaths = node.outputs[1].value.split(",").filter(p => p);
                    } else if (Array.isArray(node.outputs[1].value)) {
                        newImagePaths = node.outputs[1].value.filter(p => p);
                    }
                }

                const uiConfigPaths = node.properties?.ui_config?.image_paths || [];
                if (newImagePaths.length === 0 && uiConfigPaths.length > 0) {
                    newImagePaths = uiConfigPaths;
                }

                if (JSON.stringify(newImagePaths) !== JSON.stringify(nodeState.lastImagePaths)) {
                    nodeState.lastImagePaths = newImagePaths.slice();
                    if (newImagePaths.length > 0) {
                        imagePaths = newImagePaths;
                        node.properties.ui_config.image_paths = imagePaths;
                        node.properties.image_states = states;
                        if (states.length === 0 && nodeState.initialStates.length === 0) {
                            nodeState.initialStates = states;
                            node.setProperty("image_states", nodeState.initialStates);
                        } else {
                            nodeState.initialStates = states;
                        }
                        loadImages(imagePaths, nodeState.initialStates);
                    }
                }
            }, 1000);
        }
        startPolling();

        node._onNodeExecuted = function () {
            let states = node.properties?.image_states || [];
            let newImagePaths = [];

            if (node.outputs && node.outputs[1] && node.outputs[1].value) {
                if (typeof node.outputs[1].value === "string") {
                    newImagePaths = node.outputs[1].value.split(",").filter(p => p);
                } else if (Array.isArray(node.outputs[1].value)) {
                    newImagePaths = node.outputs[1].value.filter(p => p);
                }
            }

            if (newImagePaths.length === 0 && node.properties?.ui_config?.image_paths) {
                newImagePaths = node.properties.ui_config.image_paths;
            }

            if (newImagePaths.length > 0) {
                imagePaths = newImagePaths;
                node.properties.ui_config.image_paths = imagePaths;
                node.properties.image_states = states;
                if (states.length === 0 && nodeState.initialStates.length === 0) {
                    nodeState.initialStates = states;
                    node.setProperty("image_states", nodeState.initialStates);
                } else {
                    nodeState.initialStates = states;
                }
                nodeState.lastImagePaths = imagePaths.slice();
                loadImages(imagePaths, nodeState.initialStates);
            } else {
                statusText.innerText = "无有效图像数据，请检查上游节点";
                statusText.style.color = "#f00";
                log.error("No valid image paths received in onNodeExecuted for node:", node.id);
            }
        };

        node.onExecuted = function (message) {
            let states = [];
            let newImagePaths = [];

            if (message && message.image_paths) {
                if (typeof message.image_paths === "string") {
                    newImagePaths = message.image_paths.split(",").filter(p => p);
                } else if (Array.isArray(message.image_paths)) {
                    newImagePaths = message.image_paths.filter(p => p);
                }
            }

            if (message) {
                states = message.image_states || [];
            }

            if (newImagePaths.length === 0 && node.outputs && node.outputs[1] && node.outputs[1].value) {
                if (typeof node.outputs[1].value === "string") {
                    newImagePaths = node.outputs[1].value.split(",").filter(p => p);
                } else if (Array.isArray(node.outputs[1].value)) {
                    newImagePaths = node.outputs[1].value.filter(p => p);
                }
            }

            if (newImagePaths.length === 0 && node.properties?.ui_config?.image_paths) {
                newImagePaths = node.properties.ui_config.image_paths;
            }

            if (newImagePaths.length > 0) {
                imagePaths = newImagePaths;
                node.properties.ui_config.image_paths = imagePaths;
                node.properties.image_states = states;
                if (states.length === 0 && nodeState.initialStates.length === 0) {
                    nodeState.initialStates = states;
                    node.setProperty("image_states", nodeState.initialStates);
                } else {
                    nodeState.initialStates = states;
                }
                nodeState.lastImagePaths = imagePaths.slice();
                loadImages(imagePaths, states);
            } else {
                statusText.innerText = "无有效图像数据，请检查上游节点";
                statusText.style.color = "#f00";
                log.error("No valid image paths received in onExecuted for node:", node.id);
            }
        };

        node.onRemoved = () => {
            if (nodeState.pollInterval) clearInterval(nodeState.pollInterval);
            if (nodeState.animationFrameId) cancelAnimationFrame(nodeState.animationFrameId);
            stage.destroy();
            mainContainer.remove();
            nodeState.imageCache.clear();
            window.removeEventListener("resize", resizeListener);
            log.info("XISER_Canvas node removed, resources cleaned for node:", node.id);
        };

        updateSize();
    }
});