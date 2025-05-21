import { app } from "/scripts/app.js";

// 日志管理
const LOG_LEVEL = "info"; // 可选值: "debug", "info", "error"
const log = {
    debug: (message, ...args) => {
        if (LOG_LEVEL === "debug") console.log(`[XISER_Canvas] ${message}`, ...args);
    },
    info: (message, ...args) => {
        if (LOG_LEVEL === "debug" || LOG_LEVEL === "info") console.log(`[XISER_Canvas] ${message}`, ...args);
    },
    error: (message, ...args) => console.error(`[XISER_Canvas] ${message}`, ...args)
};

// 全局缓存，按 nodeId 隔离
const globalImageCache = new Map(); // Map<nodeId, Map<filename, image>>
const globalLoadedImageUrls = new Map(); // Map<nodeId, Map<filename, url>>

app.registerExtension({
    name: "xiser.canvas",
    async setup() {
        log.info("Extension loaded");

        if (!window.requestIdleCallback) {
            window.requestIdleCallback = (callback) => setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 50 }), 1);
            window.cancelIdleCallback = (id) => clearTimeout(id);
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
                border-radius: 5px;
                padding: 5px;
                font-family: Arial, sans-serif;
                font-size: 12px;
                z-index: 10;
            }
            .xiser-trigger-button, .xiser-instruction-button, .xiser-reset-button, .xiser-undo-button, .xiser-redo-button {
                position: absolute;
                top: 10px;
                color: #fff;
                padding: 6px 10px;
                font-family: Arial, sans-serif;
                font-size: 12px;
                border: none;
                cursor: pointer;
                z-index: 10;
            }
             .xiser-instruction-button {
                right: 10px;
                background-color: rgba(0, 0, 0, 0.75);
                border-radius: 5px;
            }
            .xiser-instruction-button:hover {
                background-color: rgb(30, 121, 195);
            }
            .xiser-trigger-button {
                right: 80px;
                background-color: rgba(0, 0, 0, 0.75);
                border-radius: 5px;
            }
            .xiser-trigger-button:hover {
                background-color: rgb(30, 121, 195);
            }
            .xiser-reset-button {
                right: 164px;
                background-color: rgba(0, 0, 0, 0.75);
                border-radius: 5px;
                padding: 6px 10px;
            }
            .xiser-reset-button:hover {
                background-color: rgb(30, 121, 195);
                padding: 6px 10px;
            }
            .xiser-redo-button {
                right: 244px;
                background-color: rgba(0, 0, 0, 0.75);
                border-radius: 5px;
            }
            .xiser-redo-button:hover {
                background-color: rgb(30, 121, 195);
            }
            .xiser-undo-button {
                right: 320px;
                background-color: rgba(0, 0, 0, 0.75);
                border-radius: 5px;
            }
            .xiser-undo-button:hover {
                background-color: rgb(30, 121, 195);
            }
        
            .xiser-layer-panel {
                position: absolute;
                top: 50px;
                left: 10px;
                background-color: rgba(0, 0, 0, 0.65);
                color: #fff;
                padding: 10px;
                font-family: Arial, sans-serif;
                font-size: 12px;
                z-index: 10;
                max-height: 200px;
                overflow-y: auto;
                border-radius: 5px;
            }
            .xiser-layer-item {
                padding: 5px;
                cursor: pointer;
                border-bottom: 1px solid #444;
            }
            .xiser-layer-item:hover {
                background-color: #555;
            }
            .xiser-layer-item.selected {
                background-color: rgb(30, 121, 195);
                color: #fff;
            }
            .xiser-modal {
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0, 0, 0, 0.5);
                z-index: 10000;
                justify-content: center;
                align-items: center;
            }
            .xiser-modal-content {
                background-color: rgb(30, 35, 49);
                padding: 20px;
                border-radius: 5px;
                max-width: 500px;
                width: 90%;
                font-family: Arial, sans-serif;
                font-size: 14px;
                line-height: 1.5;
                position: relative;
                color: #aaa;
            }
            .xiser-modal-content h3 {
                margin-top: 0;
                font-size: 18px;
                color: #fff;
            }
            .xiser-modal-content ul {
                padding-left: 20px;
                margin: 10px 0;
            }
            .xiser-modal-content li {
                margin-bottom: 10px;
            }
        `;
        document.head.appendChild(style);

        if (!window.Konva) {
            try {
                await new Promise((resolve, reject) => {
                    const script = document.createElement("script");
                    script.src = "/extensions/ComfyUI_XISER_Nodes/lib/konva.min.js";
                    script.onload = () => {
                        log.info("Konva.js loaded successfully");
                        if (!window.Konva) {
                            reject(new Error("Konva.js loaded but window.Konva is undefined"));
                        } else {
                            resolve();
                        }
                    };
                    script.onerror = () => {
                        log.error("Failed to load Konva.js");
                        reject(new Error("Konva.js load failed"));
                    };
                    document.head.appendChild(script);
                });
            } catch (e) {
                log.error("Setup failed due to Konva.js error", e);
                return;
            }
        }

        const originalOnNodeExecuted = app.graph.onNodeExecuted || (() => {});
        app.graph.onNodeExecuted = function (node) {
            originalOnNodeExecuted.apply(this, arguments);
            if (node._onNodeExecuted) {
                node._onNodeExecuted(node);
            }
        };
    },
    async nodeCreated(node) {
        if (node.comfyClass !== "XISER_Canvas") return;

        // 辅助函数：等待有效 node.id
        async function ensureNodeId(node) {
            let attempts = 0;
            const maxAttempts = 100;
            while (node.id === -1 && attempts < maxAttempts) {
                log.debug(`Node ID is -1, waiting for valid ID (attempt ${attempts + 1})`);
                await new Promise(resolve => setTimeout(resolve, 50));
                attempts++;
            }
            if (node.id === -1) {
                log.error(`Failed to get valid node ID for node after ${maxAttempts} attempts, aborting`);
                return false;
            }
            log.info(`Node created with ID: ${node.id}`);
            return true;
        }

        // 检查 node.id 是否有效
        if (node.id === -1) {
            const hasValidId = await ensureNodeId(node);
            if (!hasValidId) {
                const invalidContainers = document.querySelectorAll(`.xiser-main-container[data-nodeId="-1"]`);
                invalidContainers.forEach(container => {
                    log.info(`Removing invalid container with nodeId -1`);
                    container.remove();
                });
                return;
            }
        } else {
            log.info(`Node created with ID: ${node.id}`);
        }

        // 清理任何可能存在的 nodeId=-1 的残留容器
        const invalidContainers = document.querySelectorAll(`.xiser-main-container[data-nodeId="-1"]`);
        invalidContainers.forEach(container => {
            log.info(`Cleaning up residual container with nodeId -1`);
            container.remove();
        });

        // 清理现有 widgets
        if (node.widgets?.length) {
            for (let i = node.widgets.length - 1; i >= 0; i--) {
                const widget = node.widgets[i];
                if (widget.element?.parentNode) {
                    widget.element.parentNode.removeChild(widget.element);
                }
                node.widgets.splice(i, 1);
            }
        }
        node.widgets = [];

        const nodeId = node.id;
        if (!globalImageCache.has(nodeId)) {
            globalImageCache.set(nodeId, new Map());
        }
        if (!globalLoadedImageUrls.has(nodeId)) {
            globalLoadedImageUrls.set(nodeId, new Map());
        }

        const nodeState = {
            nodeId,
            imageNodes: [],
            defaultLayerOrder: [],
            initialStates: [],
            transformer: null,
            lastImagePaths: [],
            loadedImageUrls: globalLoadedImageUrls.get(nodeId),
            imageCache: globalImageCache.get(nodeId),
            history: [],
            historyIndex: -1,
            selectedLayer: null,
            layerItems: [],
            lastNodePos: node.pos ? [...node.pos] : [0, 0],
            lastNodeSize: node.size ? [...node.size] : [0, 0],
            lastScale: app.canvas?.ds?.scale || 1,
            lastOffset: app.canvas?.ds?.offset ? [...app.canvas.ds.offset] : [0, 0],
            pollInterval: null,
            animationFrameId: null,
            stage: null,
            canvasLayer: null,
            imageLayer: null,
            borderLayer: null,
            canvasRect: null,
            borderRect: null,
            borderFrame: null,
            isLoading: false,
            historyDebounceTimeout: null // 用于防抖历史记录
        };

        const uiConfig = node.properties?.ui_config || {};
        nodeState.initialStates = node.properties?.image_states || [];
        let boardWidth = uiConfig.board_width || 1024;
        let boardHeight = uiConfig.board_height || 1024;
        let borderWidth = uiConfig.border_width || 40;
        let canvasColor = uiConfig.canvas_color || "rgb(0, 0, 0)";
        let borderColor = uiConfig.border_color || "rgb(25, 25, 25)";
        let autoSize = uiConfig.auto_size || "off";
        let imagePaths = uiConfig.image_paths || []; // 从 ui_config 获取 image_paths

        let canvasColorValue = node.widgets_values?.[3] ||
            (canvasColor === "rgb(0, 0, 0)" ? "black" :
             canvasColor === "rgb(255, 255, 255)" ? "white" :
             canvasColor === "rgba(0, 0, 0, 0)" ? "transparent" : "black");

        if (node.widgets_values?.length >= 6) {
            boardWidth = parseInt(node.widgets_values[0]) || boardWidth;
            boardHeight = parseInt(node.widgets_values[1]) || boardHeight;
            borderWidth = parseInt(node.widgets_values[2]) || borderWidth;
            canvasColorValue = node.widgets_values[3] || canvasColorValue;
            autoSize = node.widgets_values[4] || autoSize;
            if (node.widgets_values[5]) {
                try {
                    nodeState.initialStates = JSON.parse(node.widgets_values[5]) || nodeState.initialStates;
                } catch (e) {
                    log.error(`Failed to parse image_states for node ${node.id}`, e);
                }
            }
        }

        node.inputs = node.inputs || {};
        node.inputs.board_width = node.inputs.board_width || { value: boardWidth, type: "INT" };
        node.inputs.board_height = node.inputs.board_height || { value: boardHeight, type: "INT" };
        node.inputs.border_width = node.inputs.border_width || { value: borderWidth, type: "INT" };
        node.inputs.canvas_color = node.inputs.canvas_color || { value: canvasColorValue, type: "STRING" };
        node.inputs.auto_size = node.inputs.auto_size || { value: autoSize, type: "STRING" };

        const nodeWidth = boardWidth + 2 * borderWidth + 20;
        const nodeHeight = boardHeight + 2 * borderWidth + 206;
        node.size = [nodeWidth, nodeHeight];
        node.setSize([nodeWidth, nodeHeight]);

        node.widgets_values = [boardWidth, boardHeight, borderWidth, canvasColorValue, autoSize, JSON.stringify(nodeState.initialStates)];

        const boardWidthWidget = node.addWidget("number", "board_width", boardWidth, (value) => {
            boardWidth = Math.min(Math.max(parseInt(value), 256), 4096);
            updateSize();
        }, { min: 256, max: 4096, step: 1, precision: 0 });

        const boardHeightWidget = node.addWidget("number", "board_height", boardHeight, (value) => {
            boardHeight = Math.min(Math.max(parseInt(value), 256), 4096);
            updateSize();
        }, { min: 256, max: 4096, step: 1, precision: 0 });

        node.addWidget("number", "border_width", borderWidth, (value) => {
            borderWidth = Math.min(Math.max(parseInt(value), 10), 200);
            updateSize();
        }, { min: 10, max: 200, step: 1, precision: 0 });

        node.addWidget("combo", "canvas_color", canvasColorValue, (value) => {
            canvasColorValue = value;
            updateSize();
        }, { values: ["black", "white", "transparent"] });

        const autoSizeWidget = node.addWidget("combo", "auto_size", autoSize, (value) => {
            autoSize = value;
            boardWidthWidget.disabled = (autoSize === "on");
            boardHeightWidget.disabled = (autoSize === "on");
            updateSize();
            if (imagePaths.length) {
                loadImages(imagePaths, nodeState.initialStates);
            }
        }, { values: ["off", "on"] });

        node.addWidget("hidden", "image_states", JSON.stringify(nodeState.initialStates), () => {}, { serialize: true });

        boardWidthWidget.disabled = (autoSize === "on");
        boardHeightWidget.disabled = (autoSize === "on");

        const mainContainer = document.createElement("div");
        mainContainer.className = "xiser-main-container";
        mainContainer.dataset.nodeId = nodeId;
        document.body.appendChild(mainContainer);

        const boardContainer = document.createElement("div");
        boardContainer.className = "xiser-canvas-container";

        const statusText = document.createElement("div");
        statusText.className = "xiser-status-text";
        statusText.innerText = "等待图像...";
        boardContainer.appendChild(statusText);

        const triggerButton = document.createElement("button");
        triggerButton.className = "xiser-trigger-button";
        triggerButton.innerText = "▶️ Queue";
        triggerButton.onclick = triggerPrompt;
        boardContainer.appendChild(triggerButton);

        // 添加操作说明按钮
        const instructionButton = document.createElement("button");
        instructionButton.className = "xiser-instruction-button";
        instructionButton.innerText = "ℹ️ Tips";
        instructionButton.onclick = showInstructions;
        boardContainer.appendChild(instructionButton);

        // 创建模态弹窗
        const modal = document.createElement("div");
        modal.className = "xiser-modal";
        modal.id = `xiser-modal-${nodeId}`;
        const modalContent = document.createElement("div");
        modalContent.className = "xiser-modal-content";
        modalContent.innerHTML = `
            <h3>操作方法</h3>
            <ul>
                <li>鼠标点击可选中图层，选中图层后可以自由移动，通过控制框可以缩放和旋转</li>
                <li>鼠标滚轮可以对选中图层进行缩放，Alt + 鼠标滚轮可以旋转图层</li>
                <li>如果上层图层挡住了下层图层，可以通过左上角的图层面板临时将选中的图层置顶</li>
                <li>取消图层选择或在面板中点击最上层图层，可恢复原本图层堆叠顺序。</li>
                <li>打开”auto_size“开关后，画板会自动调整为输入的第一张图的尺寸</li>
            </ul><br>
            <h3>Operation Method</h3>
            <ul>
                <li>Click with the mouse to select a layer. After selecting a layer, you can move it freely. You can scale and rotate it through the control box.</li>
                <li>The mouse wheel can be used to scale the selected layer, and Alt + mouse wheel can be used to rotate the layer.</li>
                <li>If an upper layer blocks a lower layer, you can temporarily bring the selected layer to the top through the layer panel in the upper left corner.</li>
                <li>Deselect the layer or click the top-most layer in the panel to restore the original layer stacking order.</li>
                <li>After turning on the "auto_size" switch, the drawing board will automatically adjust to the size of the first input image.</li>
            </ul>
        `;
        modal.appendChild(modalContent);
        document.body.appendChild(modal);

        // 显示操作说明弹窗
        function showInstructions() {
            modal.style.display = "flex";
        }

        // 点击弹窗外部关闭
        modal.addEventListener("click", (e) => {
            if (e.target === modal) {
                modal.style.display = "none";
            }
        });

        const resetButton = document.createElement("button");
        resetButton.className = "xiser-reset-button";
        resetButton.innerText = "🔁 Reset";
        resetButton.onclick = resetCanvas;
        boardContainer.appendChild(resetButton);

        const undoButton = document.createElement("button");
        undoButton.className = "xiser-undo-button";
        undoButton.innerText = "↩️ Undo";
        undoButton.onclick = undo;
        boardContainer.appendChild(undoButton);

        const redoButton = document.createElement("button");
        redoButton.className = "xiser-redo-button";
        redoButton.innerText = "↪️ Redo";
        redoButton.onclick = redo;
        boardContainer.appendChild(redoButton);

        const layerPanel = document.createElement("div");
        layerPanel.className = "xiser-layer-panel";
        boardContainer.appendChild(layerPanel);

        const stageContainer = document.createElement("div");
        stageContainer.className = "xiser-canvas-stage";
        boardContainer.appendChild(stageContainer);
        mainContainer.appendChild(boardContainer);

        if (!window.Konva) {
            log.error(`Konva.js not available for node ${node.id}`);
            statusText.innerText = "错误：Konva.js 未加载";
            statusText.style.color = "#f00";
            mainContainer.remove();
            return;
        }

        if (typeof window.Konva.Rect !== "function") {
            log.error(`Konva.Rect is not a function for node ${node.id}`);
            statusText.innerText = "错误：Konva.Rect 不可用";
            statusText.style.color = "#f00";
            mainContainer.remove();
            return;
        }

        nodeState.stage = new Konva.Stage({
            container: stageContainer,
            width: boardWidth + 2 * borderWidth,
            height: boardHeight + 2 * borderWidth
        });

        nodeState.canvasLayer = new Konva.Layer();
        nodeState.imageLayer = new Konva.Layer();
        nodeState.borderLayer = new Konva.Layer();
        nodeState.stage.add(nodeState.canvasLayer);
        nodeState.stage.add(nodeState.imageLayer);
        nodeState.stage.add(nodeState.borderLayer);

        nodeState.canvasRect = new Konva.Rect({
            x: borderWidth,
            y: borderWidth,
            width: boardWidth,
            height: boardHeight,
            fill: canvasColor
        });

        nodeState.borderRect = new Konva.Rect({
            x: 0,
            y: 0,
            width: boardWidth + 2 * borderWidth,
            height: boardHeight + 2 * borderWidth,
            fill: borderColor,
            stroke: "#808080",
            strokeWidth: 2
        });

        nodeState.borderFrame = new Konva.Rect({
            x: borderWidth,
            y: borderWidth,
            width: boardWidth,
            height: boardHeight,
            stroke: "#808080",
            strokeWidth: 2,
            fill: null,
            listening: false
        });

        nodeState.canvasLayer.add(nodeState.borderRect);
        nodeState.canvasLayer.add(nodeState.canvasRect);
        nodeState.borderLayer.add(nodeState.borderFrame);

        function syncContainerPosition() {
            try {
                if (!app.canvas || !app.canvas.canvas || !node.pos || !node.size) {
                    return;
                }
                if (!nodeState.stage || !nodeState.canvasRect || !nodeState.borderRect || !nodeState.borderFrame) {
                    log.warn(`Konva objects not initialized for node ${node.id}`);
                    return;
                }
                const canvas = app.canvas.canvas;
                const canvasRect = canvas.getBoundingClientRect();
                const nodePos = node.pos;
                const nodeSize = node.size;
                const scale = app.canvas.ds.scale || 1;
                const offset = app.canvas.ds.offset || [0, 0];

                const logicalX = (nodePos[0] + offset[0]) * scale;
                const logicalY = (nodePos[1] + offset[1]) * scale;
                const x = canvasRect.left + logicalX + 10 * scale;
                const y = canvasRect.top + logicalY + 186 * scale;
                const width = nodeSize[0] - 20;
                const height = nodeSize[1] - 206;

                mainContainer.style.left = `${x}px`;
                mainContainer.style.top = `${y}px`;
                mainContainer.style.width = `${width}px`;
                mainContainer.style.height = `${height}px`;
                mainContainer.style.transform = `scale(${scale})`;

                boardContainer.style.width = `${width}px`;
                boardContainer.style.height = `${height}px`;

                nodeState.stage.width(boardWidth + 2 * borderWidth);
                nodeState.stage.height(boardHeight + 2 * borderWidth);
                nodeState.borderRect.width(boardWidth + 2 * borderWidth);
                nodeState.borderRect.height(boardHeight + 2 * borderWidth);
                nodeState.canvasRect.x(borderWidth);
                nodeState.canvasRect.y(borderWidth);
                nodeState.canvasRect.width(boardWidth);
                nodeState.canvasRect.height(boardHeight);
                nodeState.borderFrame.x(borderWidth);
                nodeState.borderFrame.y(borderWidth);
                nodeState.borderFrame.width(boardWidth);
                nodeState.borderFrame.height(boardHeight);

                nodeState.canvasLayer.batchDraw();
                nodeState.imageLayer.batchDraw();
                nodeState.borderLayer.batchDraw();
            } catch (e) {
                log.error(`Error syncing container position for node ${node.id}`, e);
            }
        }

        syncContainerPosition();

        function checkPositionAndSize() {
            try {
                if (!node.pos || !node.size || !app.canvas?.ds) {
                    return;
                }
                if (!nodeState.stage || !nodeState.canvasRect || !nodeState.borderRect || !nodeState.borderFrame) {
                    log.warn(`Konva objects not initialized for node ${node.id}`);
                    return;
                }
                const nodePos = node.pos;
                const nodeSize = node.size;
                const scale = app.canvas.ds.scale || 1;
                const offset = app.canvas.ds.offset || [0, 0];

                const posChanged = nodePos[0] !== nodeState.lastNodePos[0] || nodePos[1] !== nodeState.lastNodePos[1];
                const sizeChanged = nodeSize[0] !== nodeState.lastNodeSize[0] || nodeSize[1] !== nodeState.lastNodeSize[1];
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
                log.error(`Error checking position/size for node ${node.id}`, e);
            }
            nodeState.animationFrameId = requestAnimationFrame(checkPositionAndSize);
        }
        nodeState.animationFrameId = requestAnimationFrame(checkPositionAndSize);

        const resizeListener = () => syncContainerPosition();
        window.addEventListener("resize", resizeListener);

        node.onDrawForeground = function (ctx) {
            try {
                ctx.save();
                ctx.fillStyle = borderColor;
                ctx.fillRect(10, 186, node.size[0] - 20, node.size[1] - 206);
                ctx.restore();
            } catch (e) {
                log.error(`Error in onDrawForeground for node ${node.id}`, e);
            }
        };

        // 防抖保存历史记录
        function debounceSaveHistory() {
            if (nodeState.historyDebounceTimeout) {
                clearTimeout(nodeState.historyDebounceTimeout);
            }
            nodeState.historyDebounceTimeout = setTimeout(() => {
                saveHistory();
                nodeState.historyDebounceTimeout = null;
            }, 300);
        }

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
            nodeState.imageLayer.batchDraw();
        }

        function redo() {
            if (nodeState.historyIndex >= nodeState.history.length - 1) return;
            nodeState.historyIndex++;
            nodeState.initialStates = nodeState.history[nodeState.historyIndex].map(state => ({ ...state }));
            applyStates();
            node.properties.image_states = nodeState.initialStates;
            node.widgets.find(w => w.name === "image_states").value = JSON.stringify(nodeState.initialStates);
            node.setProperty("image_states", nodeState.initialStates);
            nodeState.imageLayer.batchDraw();
        }

        function applyStates() {
            nodeState.imageNodes.forEach((node, i) => {
                const state = nodeState.initialStates[i] || {};
                node.x(state.x || borderWidth + boardWidth / 2);
                node.y(state.y || borderWidth + boardHeight / 2);
                node.scaleX(state.scaleX || 1);
                node.scaleY(state.scaleY || 1);
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
            nodeState.imageLayer.batchDraw();
            saveHistory();
            deselectLayer();
        }

        function updateLayerPanel() {
            layerPanel.innerHTML = "";
            nodeState.layerItems = [];
            for (let index = nodeState.imageNodes.length - 1; index >= 0; index--) {
                const item = document.createElement("div");
                item.className = "xiser-layer-item";
                item.innerText = `Layer ${index + 1}`;
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
            nodeState.imageLayer.batchDraw();

            nodeState.layerItems.forEach(item => item.classList.remove("selected"));
            const listItemIndex = nodeState.imageNodes.length - 1 - index;
            if (nodeState.layerItems[listItemIndex]) {
                nodeState.layerItems[listItemIndex].classList.add("selected");
            }
        }

        function deselectLayer() {
            if (!nodeState.selectedLayer) return;

            nodeState.defaultLayerOrder.forEach((node, index) => {
                node.zIndex(index);
            });

            nodeState.selectedLayer = null;
            nodeState.transformer.nodes([]);
            nodeState.imageLayer.batchDraw();

            nodeState.layerItems.forEach(item => item.classList.remove("selected"));
        }

        async function loadImages(imagePaths, states, base64Chunks = [], retryCount = 0, maxRetries = 3) {
            if (!imagePaths?.length) {
                log.warn(`No image paths provided for node ${node.id}`);
                statusText.innerText = "无图像数据";
                statusText.style.color = "#f00";
                return;
            }

            if (nodeState.isLoading) {
                log.info(`LoadImages already in progress for node ${node.id}, skipping`);
                return;
            }
            nodeState.isLoading = true;

            log.info(`Starting loadImages for node ${node.id}, imagePaths: ${JSON.stringify(imagePaths)}, length: ${imagePaths.length}, current imageNodes: ${nodeState.imageNodes.length}`);

            nodeState.imageNodes.forEach(node => node.destroy());
            nodeState.imageNodes = [];
            nodeState.imageLayer.destroyChildren();
            nodeState.imageLayer.batchDraw();

            nodeState.initialStates = imagePaths.map(() => ({
                x: borderWidth + boardWidth / 2,
                y: borderWidth + boardHeight / 2,
                scaleX: 1,
                scaleY: 1,
                rotation: 0
            }));
            states.forEach((state, i) => {
                if (i < nodeState.initialStates.length) {
                    nodeState.initialStates[i] = { ...nodeState.initialStates[i], ...state };
                }
            });

            const images = imagePaths.map(path => ({
                filename: path,
                subfolder: "xiser_canvas",
                type: "output",
                mime_type: "image/png"
            }));

            statusText.innerText = `加载图像... 0/${images.length}`;
            statusText.style.color = "#fff";

            let loadedCount = 0;
            let originalBoardWidth = boardWidth;
            let originalBoardHeight = boardHeight;
            for (let i = 0; i < images.length; i++) {
                const imgData = images[i];
                try {
                    let img = nodeState.imageCache.get(imgData.filename);
                    if (!img) {
                        img = new Image();
                        const imgUrl = `/view?filename=${encodeURIComponent(imgData.filename)}&subfolder=${encodeURIComponent(imgData.subfolder || '')}&type=${imgData.type}&rand=${Math.random()}`;
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
                                log.error(`Failed to load image ${imgData.filename} for node ${node.id}`);
                                if (retryCount < maxRetries) {
                                    setTimeout(() => loadImages([imgData.filename], [states[i]], base64Chunks, retryCount + 1, maxRetries), 1000);
                                }
                                resolve();
                            };
                        });
                    }

                    if (autoSize === "on" && i === 0) {
                        originalBoardWidth = boardWidth;
                        originalBoardHeight = boardHeight;
                        boardWidth = Math.min(Math.max(parseInt(img.width), 256), 4096);
                        boardHeight = Math.min(Math.max(parseInt(img.height), 256), 4096);
                        updateSize();
                        statusText.innerText = `画板尺寸已调整为 ${boardWidth}x${boardHeight}`;
                        statusText.style.color = "#0f0";
                    }

                    const state = nodeState.initialStates[i] || {};
                    const konvaImg = new Konva.Image({
                        image: img,
                        x: state.x || borderWidth + boardWidth / 2,
                        y: state.y || borderWidth + boardHeight / 2,
                        scaleX: state.scaleX || 1,
                        scaleY: state.scaleY || 1,
                        rotation: state.rotation || 0,
                        draggable: true,
                        offsetX: img.width / 2,
                        offsetY: img.height / 2,
                        filename: imgData.filename
                    });
                    nodeState.imageLayer.add(konvaImg);
                    nodeState.imageNodes.push(konvaImg);
                    nodeState.initialStates[i] = {
                        x: konvaImg.x(),
                        y: konvaImg.y(),
                        scaleX: konvaImg.scaleX(),
                        scaleY: konvaImg.scaleY(),
                        rotation: konvaImg.rotation()
                    };

                    const updateImageState = () => {
                        nodeState.initialStates[i] = {
                            x: konvaImg.x(),
                            y: konvaImg.y(),
                            scaleX: konvaImg.scaleX(),
                            scaleY: konvaImg.scaleY(),
                            rotation: konvaImg.rotation()
                        };
                        node.properties.image_states = nodeState.initialStates;
                        node.widgets.find(w => w.name === "image_states").value = JSON.stringify(nodeState.initialStates);
                        node.setProperty("image_states", nodeState.initialStates);
                        nodeState.imageLayer.batchDraw();
                        debounceSaveHistory();
                    };

                    konvaImg.on("dragend transformend", updateImageState);

                    loadedCount++;
                    statusText.innerText = `加载图像... ${loadedCount}/${images.length}`;
                } catch (e) {
                    log.error(`Error loading image ${i+1} for node ${node.id}`, e);
                    statusText.innerText = `加载失败：${e.message}`;
                    statusText.style.color = "#f00";
                    continue;
                }
            }

            // 如果 auto_size 打开且画板尺寸有更改，执行重置
            if (autoSize === "on" && (boardWidth !== originalBoardWidth || boardHeight !== originalBoardHeight)) {
                resetCanvas();
            }

            nodeState.defaultLayerOrder = [...nodeState.imageNodes];
            updateLayerPanel();
            nodeState.transformer = new Konva.Transformer({
                nodes: [],
                keepRatio: true,
                enabledAnchors: ["top-left", "top-right", "bottom-left", "bottom-right"],
                rotateEnabled: true
            });
            nodeState.imageLayer.add(nodeState.transformer);
            nodeState.imageLayer.batchDraw();

            if (loadedCount === 0) {
                statusText.innerText = "无法加载任何图像，请检查上游节点";
                statusText.style.color = "#f00";
            } else {
                statusText.innerText = `已加载 ${loadedCount} 张图像`;
                statusText.style.color = "#0f0";
            }
            saveHistory();
            log.info(`Finished loadImages for node ${node.id}, imageNodes: ${nodeState.imageNodes.length}, initialStates: ${nodeState.initialStates.length}`);
            nodeState.isLoading = false;
        }

        if (imagePaths.length) {
            loadImages(imagePaths, nodeState.initialStates);
        } else {
            loadImages([], nodeState.initialStates);
        }

        nodeState.transformer = new Konva.Transformer({
            nodes: [],
            keepRatio: true,
            enabledAnchors: ["top-left", "top-right", "bottom-left", "bottom-right"],
            rotateEnabled: true
        });
        nodeState.imageLayer.add(nodeState.transformer);

        nodeState.stage.on("click tap", (e) => {
            const target = e.target;
            if (target === nodeState.canvasRect || target === nodeState.stage || target === nodeState.borderRect) {
                deselectLayer();
                return;
            }
            if (nodeState.imageNodes.includes(target)) {
                const index = nodeState.imageNodes.indexOf(target);
                if (nodeState.selectedLayer !== target) {
                    selectLayer(index);
                }
            }
        });

        nodeState.stage.on("mousedown", (e) => {
            if (nodeState.imageNodes.includes(e.target)) {
                const index = nodeState.imageNodes.indexOf(e.target);
                selectLayer(index);
            }
        });

        nodeState.stage.on("wheel", (e) => {
            e.evt.preventDefault();
            const target = nodeState.transformer.nodes()[0];
            if (!target || !nodeState.imageNodes.includes(target)) return;

            const index = nodeState.imageNodes.indexOf(target);
            if (index === -1) return;

            // 检测是否按下 Alt 键
            const isAltPressed = e.evt.altKey;

            if (isAltPressed) {
                // Alt + 鼠标滚轮：旋转
                const rotationStep = 1; // 每次旋转 1 度
                const currentRotation = target.rotation();
                const delta = e.evt.deltaY > 0 ? -rotationStep : rotationStep; // 向上滚轮逆时针，向下顺时针
                target.rotation(currentRotation + delta);
            } else {
                // 普通鼠标滚轮：缩放
                const scaleBy = 1.01;
                const oldScale = target.scaleX();
                let newScale = e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy;

                // 添加缩放范围限制
                newScale = Math.min(Math.max(newScale, 0.1), 10); // 限制缩放范围在 0.1 到 10 之间

                target.scaleX(newScale);
                target.scaleY(newScale);
            }

            // 更新状态
            nodeState.initialStates[index] = {
                x: target.x(),
                y: target.y(),
                scaleX: target.scaleX(),
                scaleY: target.scaleY(),
                rotation: target.rotation()
            };
            node.properties.image_states = nodeState.initialStates;
            node.widgets.find(w => w.name === "image_states").value = JSON.stringify(nodeState.initialStates);
            node.setProperty("image_states", nodeState.initialStates);
            debounceSaveHistory();

            nodeState.imageLayer.batchDraw();
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
                    auto_size: autoSize,
                    image_paths: imagePaths,
                    image_states: nodeState.initialStates
                };
            },
            setValue(value) {
                try {
                    boardWidth = parseInt(value.board_width) || boardWidth;
                    boardHeight = parseInt(value.board_height) || boardHeight;
                    borderWidth = parseInt(value.border_width) || borderWidth;
                    canvasColor = value.canvas_color || canvasColor;
                    borderColor = value.border_color || borderColor;
                    autoSize = value.auto_size || autoSize;
                    imagePaths = value.image_paths || imagePaths;
                    nodeState.initialStates = value.image_states || nodeState.initialStates;
                    updateSize();
                    loadImages(imagePaths, nodeState.initialStates);
                } catch (e) {
                    log.error(`Error setting value for node ${node.id}`, e);
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

        async function triggerPrompt() {
            try {
                // 获取最新的 image_paths 从 ui_config
                let newImagePaths = node.properties?.ui_config?.image_paths || [];

                // 如果 image_paths 发生变化，确保 initialStates 长度匹配
                if (JSON.stringify(newImagePaths) !== JSON.stringify(imagePaths)) {
                    imagePaths = newImagePaths;
                    nodeState.initialStates = imagePaths.map(() => ({
                        x: borderWidth + boardWidth / 2,
                        y: borderWidth + boardHeight / 2,
                        scaleX: 1,
                        scaleY: 1,
                        rotation: 0
                    }));
                }

                // 如果 auto_size 打开，重新加载图像并重置
                if (autoSize === "on" && imagePaths.length) {
                    statusText.innerText = "正在调整画板并重置...";
                    statusText.style.color = "#fff";
                    await loadImages(imagePaths, nodeState.initialStates);
                    statusText.innerText = "调整完成，准备渲染...";
                }

                // 强制同步状态
                nodeState.initialStates = nodeState.initialStates.slice(0, imagePaths.length);
                node.properties.image_states = nodeState.initialStates;
                node.widgets.find(w => w.name === "image_states").value = JSON.stringify(nodeState.initialStates);
                node.setProperty("image_states", nodeState.initialStates);
                node.widgets_values = [boardWidth, boardHeight, borderWidth, canvasColorValue, autoSize, JSON.stringify(nodeState.initialStates)];

                app.queuePrompt?.();
                statusText.innerText = "渲染中...";
                statusText.style.color = "#fff";
            } catch (e) {
                log.error(`Failed to queue prompt for node ${node.id}`, e);
                statusText.innerText = "触发队列失败";
                statusText.style.color = "#f00";
            }
        }

        function updateSize() {
            try {
                borderWidth = Math.min(Math.max(parseInt(borderWidth) || 40, 10), 200);
                canvasColorValue = canvasColorValue || "black";

                canvasColor = {
                    black: "rgb(0, 0, 0)",
                    white: "rgb(255, 255, 255)",
                    transparent: "rgba(0, 0, 0, 0)"
                }[canvasColorValue] || "rgb(0, 0, 0)";
                borderColor = {
                    black: "rgb(25, 25, 25)",
                    white: "rgb(230, 230, 230)",
                    transparent: "rgba(0, 0, 0, 0)"
                }[canvasColorValue] || "rgb(25, 25, 25)";

                node.widgets.forEach(widget => {
                    if (widget.name === "board_width") {
                        widget.value = boardWidth;
                        widget.disabled = (autoSize === "on");
                    }
                    if (widget.name === "board_height") {
                        widget.value = boardHeight;
                        widget.disabled = (autoSize === "on");
                    }
                    if (widget.name === "border_width") widget.value = borderWidth;
                    if (widget.name === "canvas_color") widget.value = canvasColorValue;
                    if (widget.name === "auto_size") widget.value = autoSize;
                    if (widget.name === "image_states") widget.value = JSON.stringify(nodeState.initialStates);
                });
                node.widgets_values = [boardWidth, boardHeight, borderWidth, canvasColorValue, autoSize, JSON.stringify(nodeState.initialStates)];

                if (node.inputs) {
                    if (node.inputs.board_width) node.inputs.board_width.value = boardWidth;
                    if (node.inputs.board_height) node.inputs.board_height.value = boardHeight;
                    if (node.inputs.border_width) node.inputs.border_width.value = borderWidth;
                    if (node.inputs.canvas_color) node.inputs.canvas_color.value = canvasColorValue;
                    if (node.inputs.auto_size) node.inputs.auto_size.value = autoSize;
                }

                const containerWidth = boardWidth + 2 * borderWidth;
                const containerHeight = boardHeight + 2 * borderWidth;
                nodeState.stage.width(containerWidth);
                nodeState.stage.height(containerHeight);
                nodeState.borderRect.setAttrs({
                    x: 0,
                    y: 0,
                    width: containerWidth,
                    height: containerHeight,
                    fill: borderColor
                });
                nodeState.canvasRect.setAttrs({
                    x: borderWidth,
                    y: borderWidth,
                    width: boardWidth,
                    height: boardHeight,
                    fill: canvasColor
                });
                nodeState.borderFrame.setAttrs({
                    x: borderWidth,
                    y: borderWidth,
                    width: boardWidth,
                    height: boardHeight
                });

                nodeState.imageNodes.forEach((node, i) => {
                    const state = nodeState.initialStates[i] || {};
                    const imgWidth = node.width();
                    const imgHeight = node.height();
                    const newX = state.x || borderWidth + boardWidth / 2;
                    const newY = state.y || borderWidth + boardHeight / 2;
                    node.x(newX);
                    node.y(newY);
                    node.offsetX(imgWidth / 2);
                    node.offsetY(imgHeight / 2);
                    nodeState.initialStates[i] = {
                        x: newX,
                        y: newY,
                        scaleX: node.scaleX(),
                        scaleY: node.scaleY(),
                        rotation: node.rotation()
                    };
                });

                const nodeWidth = boardWidth + 2 * borderWidth + 20;
                const nodeHeight = boardHeight + 2 * borderWidth + 206;
                node.size = [nodeWidth, nodeHeight];
                node.setSize([nodeWidth, nodeHeight]);

                node.properties.ui_config = {
                    board_width: boardWidth,
                    board_height: boardHeight,
                    border_width: borderWidth,
                    canvas_color: canvasColor,
                    border_color: borderColor,
                    auto_size: autoSize,
                    image_paths: imagePaths
                };
                node.properties.image_states = nodeState.initialStates;
                node.setProperty("ui_config", node.properties.ui_config);
                node.setProperty("image_states", nodeState.initialStates);

                nodeState.canvasLayer.batchDraw();
                nodeState.imageLayer.batchDraw();
                nodeState.borderLayer.batchDraw();
                nodeState.stage.batchDraw();

                updateLayerPanel();
                syncContainerPosition();
            } catch (e) {
                log.error(`Error updating size for node ${node.id}`, e);
                statusText.innerText = `更新画板失败：${e.message}`;
                statusText.style.color = "#f00";
            }
        }

        let loadImagesDebounceTimeout = null;
        function debounceLoadImages(imagePaths, states) {
            if (loadImagesDebounceTimeout) {
                clearTimeout(loadImagesDebounceTimeout);
            }
            loadImagesDebounceTimeout = setTimeout(() => {
                loadImages(imagePaths, states);
                loadImagesDebounceTimeout = null;
            }, 300);
        }

        function startPolling() {
            if (nodeState.pollInterval) clearInterval(nodeState.pollInterval);
            nodeState.pollInterval = setInterval(() => {
                let newImagePaths = node.properties?.ui_config?.image_paths || [];
                let states = node.properties?.image_states || [];

                if (newImagePaths.length && !nodeState.lastImagePaths.length) {
                    log.info(`Forcing initial load for new node ${node.id}, new paths: ${JSON.stringify(newImagePaths)}`);
                    imagePaths = newImagePaths;
                    node.properties.ui_config.image_paths = imagePaths;
                    node.properties.image_states = states;
                    nodeState.initialStates = states.length ? states : imagePaths.map(() => ({
                        x: borderWidth + boardWidth / 2,
                        y: borderWidth + boardHeight / 2,
                        scaleX: 1,
                        scaleY: 1,
                        rotation: 0
                    }));
                    node.setProperty("image_states", nodeState.initialStates);
                    debounceLoadImages(imagePaths, nodeState.initialStates);
                } else if (JSON.stringify(newImagePaths) !== JSON.stringify(nodeState.lastImagePaths)) {
                    log.info(`Image paths changed for node ${node.id}, new paths: ${JSON.stringify(newImagePaths)}`);
                    imagePaths = newImagePaths;
                    node.properties.ui_config.image_paths = imagePaths;
                    node.properties.image_states = states;
                    nodeState.initialStates = states.length ? states : imagePaths.map(() => ({
                        x: borderWidth + boardWidth / 2,
                        y: borderWidth + boardHeight / 2,
                        scaleX: 1,
                        scaleY: 1,
                        rotation: 0
                    }));
                    node.setProperty("image_states", nodeState.initialStates);
                    debounceLoadImages(imagePaths, nodeState.initialStates);
                }
                nodeState.lastImagePaths = newImagePaths.slice();
            }, 1000);
        }
        startPolling();

        node._onNodeExecuted = function () {
            let states = node.properties?.image_states || [];
            let newImagePaths = node.properties?.ui_config?.image_paths || [];

            if (newImagePaths.length) {
                log.info(`onNodeExecuted for node ${node.id}, new paths: ${JSON.stringify(newImagePaths)}`);
                imagePaths = newImagePaths;
                node.properties.ui_config.image_paths = imagePaths;
                node.properties.image_states = states;
                nodeState.initialStates = states.length ? states : imagePaths.map(() => ({
                    x: borderWidth + boardWidth / 2,
                    y: borderWidth + boardHeight / 2,
                    scaleX: 1,
                    scaleY: 1,
                    rotation: 0
                }));
                node.setProperty("image_states", nodeState.initialStates);
                nodeState.lastImagePaths = imagePaths.slice();
                debounceLoadImages(imagePaths, states);
            } else {
                statusText.innerText = "无有效图像数据，请检查上游节点";
                statusText.style.color = "#f00";
                log.error(`No valid image paths in onNodeExecuted for node ${node.id}`);
            }
        };

        node.onExecuted = function (message) {
            let states = message?.image_states || [];
            let newImagePaths = node.properties?.ui_config?.image_paths || [];

            // 从 message 中获取 image_paths（如果有）
            if (message?.image_paths) {
                if (typeof message.image_paths === "string") {
                    newImagePaths = message.image_paths.split(",").filter(p => p);
                } else if (Array.isArray(message.image_paths)) {
                    newImagePaths = message.image_paths.filter(p => p);
                }
            }

            if (newImagePaths.length) {
                log.info(`onExecuted for node ${node.id}, new paths: ${JSON.stringify(newImagePaths)}`);
                imagePaths = newImagePaths;
                node.properties.ui_config.image_paths = imagePaths;
                node.properties.image_states = states;
                nodeState.initialStates = states.length ? states : imagePaths.map(() => ({
                    x: borderWidth + boardWidth / 2,
                    y: borderWidth + boardHeight / 2,
                    scaleX: 1,
                    scaleY: 1,
                    rotation: 0
                }));
                node.setProperty("image_states", nodeState.initialStates);
                nodeState.lastImagePaths = imagePaths.slice();
                debounceLoadImages(imagePaths, states);
            } else {
                statusText.innerText = "无有效图像数据，请检查上游节点";
                statusText.style.color = "#f00";
                log.error(`No valid image paths in onExecuted for node ${node.id}`);
            }
        };

        node.onRemoved = () => {
            if (nodeState.pollInterval) clearInterval(nodeState.pollInterval);
            if (nodeState.animationFrameId) cancelAnimationFrame(nodeState.animationFrameId);
            if (nodeState.stage) {
                nodeState.imageNodes.forEach(node => node.destroy());
                nodeState.stage.destroy();
            }
            if (mainContainer && mainContainer.parentNode) {
                mainContainer.remove();
            }
            if (modal && modal.parentNode) {
                modal.remove();
            }
            globalImageCache.delete(nodeState.nodeId);
            globalLoadedImageUrls.delete(nodeState.nodeId);
            window.removeEventListener("resize", resizeListener);

            const residualContainers = document.querySelectorAll(`.xiser-main-container[data-nodeId="-1"]`);
            residualContainers.forEach(container => {
                log.info(`Cleaning up residual container with nodeId -1 during node removal`);
                container.remove();
            });

            log.info(`Node ${node.id} removed, resources cleaned`);
        };

        updateSize();
    }
});