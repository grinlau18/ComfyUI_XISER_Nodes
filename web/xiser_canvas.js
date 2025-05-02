import { app } from "/scripts/app.js";

// 日志级别控制
const LOG_LEVEL = "info"; // 移除动态调试开关，仅保留 info 和 error
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
                position: relative;
                box-sizing: border-box;
                width: 100%;
                height: 100%;
                min-width: 200px;
                min-height: 200px;
                overflow: visible;
            }
            .xiser-canvas-stage {
                position: relative;
                width: 100%;
                height: 100%;
                border: 2px solid #808080;
                background: transparent;
                min-width: 200px;
                min-height: 200px;
                overflow: visible;
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
                position: relative;
                display: block;
                width: 100%;
                height: 100%;
                min-height: 100px;
                background: transparent;
                overflow: visible;
            }
            .xiser-status-text {
                position: absolute;
                top: 10px;
                left: 10px;
                color: #fff;
                background-color: rgba(0, 0, 0, 0.7);
                padding: 3px;
                font-family: Arial, sans-serif;
                font-size: 12px;
                z-index: 10;
            }
            .xiser-trigger-button, .xiser-reset-button, .xiser-undo-button, .xiser-redo-button {
                position: absolute;
                top: 10px;
                color: #fff;
                padding: 5px 10px;
                font-family: Arial, sans-serif;
                font-size: 12px;
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
                padding: 10px;
                font-family: Arial, sans-serif;
                font-size: 12px;
                z-index: 10;
                max-height: 200px;
                overflow-y: auto;
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

        log.info("XISER_Canvas node created:", node.id);

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

        const uiConfig = node.properties?.ui_config || {};
        const imageStates = node.properties?.image_states || [];
        let boardWidth = uiConfig.board_width || 1024;
        let boardHeight = uiConfig.board_height || 1024;
        let borderWidth = uiConfig.border_width || 40;
        let canvasColor = uiConfig.canvas_color || "rgb(0, 0, 0)";
        let borderColor = uiConfig.border_color || "rgb(25, 25, 25)";
        let imagePaths = uiConfig.image_paths ? (typeof uiConfig.image_paths === "string" ? uiConfig.image_paths.split(",").filter(p => p) : uiConfig.image_paths) : [];

        let canvasColorValue = node.widgets_values && node.widgets_values[3] ? node.widgets_values[3] :
                              canvasColor === "rgb(0, 0, 0)" ? "black" :
                              canvasColor === "rgb(255, 255, 255)" ? "white" :
                              canvasColor === "rgba(0, 0, 0, 0)" ? "transparent" : "black";

        node.widgets_values = [boardWidth, boardHeight, borderWidth, canvasColorValue, JSON.stringify(imageStates)];
        node.inputs = node.inputs || {};
        node.inputs.board_width = node.inputs.board_width || { value: boardWidth, type: "INT" };
        node.inputs.board_height = node.inputs.board_height || { value: boardHeight, type: "INT" };
        node.inputs.border_width = node.inputs.border_width || { value: borderWidth, type: "INT" };
        node.inputs.canvas_color = node.inputs.canvas_color || { value: canvasColorValue, type: "STRING" };

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

        node.addWidget("hidden", "image_states", JSON.stringify(imageStates), (value) => {}, { serialize: true });

        const mainContainer = document.createElement("div");
        mainContainer.className = "xiser-main-container";

        const boardContainer = document.createElement("div");
        boardContainer.className = "xiser-canvas-container";
        boardContainer.style.backgroundColor = borderColor;

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
        canvasLayer.add(canvasRect);

        let imageNodes = [];
        let initialStates = imageStates.slice();
        let transformer = null;
        let lastImagePaths = [];
        let loadedImageUrls = new Map();
        const imageCache = new Map();
        const history = [];
        let historyIndex = -1;
        let selectedLayer = null;
        let originalZIndex = null;
        let layerItems = [];

        function saveHistory() {
            const currentState = initialStates.map(state => ({ ...state }));
            history.splice(historyIndex + 1);
            history.push(currentState);
            historyIndex++;
            if (history.length > 20) {
                history.shift();
                historyIndex--;
            }
        }

        function undo() {
            if (historyIndex <= 0) return;
            historyIndex--;
            initialStates = history[historyIndex].map(state => ({ ...state }));
            applyStates();
            node.properties.image_states = initialStates;
            node.widgets.find(w => w.name === "image_states").value = JSON.stringify(initialStates);
            node.setProperty("image_states", initialStates);
            imageLayer.batchDraw();
        }

        function redo() {
            if (historyIndex >= history.length - 1) return;
            historyIndex++;
            initialStates = history[historyIndex].map(state => ({ ...state }));
            applyStates();
            node.properties.image_states = initialStates;
            node.widgets.find(w => w.name === "image_states").value = JSON.stringify(initialStates);
            node.setProperty("image_states", initialStates);
            imageLayer.batchDraw();
        }

        function applyStates() {
            imageNodes.forEach((node, i) => {
                const state = initialStates[i] || {};
                const maxWidth = boardWidth * 0.8;
                const maxHeight = boardHeight * 0.8;
                const scale = Math.min(1, maxWidth / node.width(), maxHeight / node.height());
                node.x(state.x || borderWidth + boardWidth / 2);
                node.y(state.y || borderWidth + boardHeight / 2);
                node.scaleX(scale * (state.scaleX || 1));
                node.scaleY(scale * (state.scaleY || 1));
                node.rotation(state.rotation || 0);
            });
        }

        function resetCanvas() {
            initialStates = imagePaths.map(() => ({
                x: borderWidth + boardWidth / 2,
                y: borderWidth + boardHeight / 2,
                scaleX: 1,
                scaleY: 1,
                rotation: 0
            }));
            applyStates();
            node.properties.image_states = initialStates;
            node.widgets.find(w => w.name === "image_states").value = JSON.stringify(initialStates);
            node.setProperty("image_states", initialStates);
            imageLayer.batchDraw();
            saveHistory();
            deselectLayer();
        }

        function updateLayerPanel() {
            layerPanel.innerHTML = "";
            layerItems = [];
            for (let index = imageNodes.length - 1; index >= 0; index--) {
                const item = document.createElement("div");
                item.className = "xiser-layer-item";
                item.innerText = `图层 ${index + 1}`;
                item.dataset.index = index;
                layerPanel.appendChild(item);
                layerItems.push(item);

                item.addEventListener("click", () => {
                    const currentIndex = parseInt(item.dataset.index);
                    if (selectedLayer === imageNodes[currentIndex]) {
                        deselectLayer();
                    } else {
                        selectLayer(currentIndex);
                    }
                });
            }
        }

        function selectLayer(index) {
            if (index < 0 || index >= imageNodes.length) return;
            const node = imageNodes[index];

            deselectLayer();

            selectedLayer = node;
            originalZIndex = node.zIndex();
            node.moveToTop();
            transformer.moveToTop();

            transformer.nodes([node]);
            imageLayer.batchDraw();

            layerItems.forEach(item => item.classList.remove("selected"));
            const listItemIndex = imageNodes.length - 1 - index;
            if (layerItems[listItemIndex]) {
                layerItems[listItemIndex].classList.add("selected");
            }
        }

        function deselectLayer() {
            if (!selectedLayer) return;

            selectedLayer.zIndex(originalZIndex);
            selectedLayer = null;
            originalZIndex = null;

            transformer.nodes([]);
            imageLayer.batchDraw();

            layerItems.forEach(item => item.classList.remove("selected"));
        }

        async function loadImages(imagePaths, states, base64Chunks = [], retryCount = 0, maxRetries = 3) {
            if (!imagePaths || imagePaths.length === 0) {
                log.warn("No image paths provided");
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
            const imagesToLoad = images.filter(img => !imageNodes.some(node => node.attrs.filename === img.filename));
            const imagesToRemove = imageNodes.filter(node => !currentFilenames.includes(node.attrs.filename));

            imagesToRemove.forEach(node => {
                node.destroy();
                imageNodes = imageNodes.filter(n => n !== node);
                loadedImageUrls.delete(node.attrs.filename);
            });
            imageLayer.batchDraw();

            if (imagesToLoad.length === 0) {
                statusText.innerText = `已加载 ${imageNodes.length} 张图像`;
                statusText.style.color = "#0f0";
                updateLayerPanel();
                return;
            }

            statusText.innerText = `加载图像... 0/${images.length}`;
            statusText.style.color = "#fff";

            let loadedCount = imageNodes.length;
            for (let i = 0; i < images.length; i++) {
                const imgData = images[i];
                if (imageNodes.some(node => node.attrs.filename === imgData.filename)) continue;

                try {
                    let img = imageCache.get(imgData.filename);
                    if (!img) {
                        img = new Image();
                        let imgUrl = `/view?filename=${encodeURIComponent(imgData.filename)}&subfolder=${encodeURIComponent(imgData.subfolder || '')}&type=${imgData.type}&rand=${Math.random()}`;
                        const response = await fetch(imgUrl, { method: 'HEAD' });
                        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                        img.src = imgUrl;
                        await new Promise((resolve, reject) => {
                            img.onload = () => {
                                imageCache.set(imgData.filename, img);
                                loadedImageUrls.set(imgData.filename, imgUrl);
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
                    const scale = Math.min(1, maxWidth / img.width, maxHeight / img.height);
                    const konvaImg = new Konva.Image({
                        image: img,
                        x: state.x || borderWidth + boardWidth / 2,
                        y: state.y || borderWidth + boardHeight / 2,
                        scaleX: scale * (state.scaleX || 1),
                        scaleY: scale * (state.scaleY || 1),
                        rotation: state.rotation || 0,
                        draggable: true,
                        offsetX: img.width / 2,
                        offsetY: img.height / 2,
                        filename: imgData.filename
                    });
                    imageLayer.add(konvaImg);
                    imageNodes.push(konvaImg);
                    initialStates[i] = initialStates[i] || {
                        x: konvaImg.x(),
                        y: konvaImg.y(),
                        scaleX: konvaImg.scaleX() / scale,
                        scaleY: konvaImg.scaleY() / scale,
                        rotation: konvaImg.rotation()
                    };

                    const updateImageState = () => {
                        initialStates[i] = {
                            x: konvaImg.x(),
                            y: konvaImg.y(),
                            scaleX: konvaImg.scaleX() / scale,
                            scaleY: konvaImg.scaleY() / scale,
                            rotation: konvaImg.rotation()
                        };
                        node.properties.image_states = initialStates;
                        node.widgets.find(w => w.name === "image_states").value = JSON.stringify(initialStates);
                        node.setProperty("image_states", initialStates);
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

            updateLayerPanel();
            transformer.nodes([]);
            imageLayer.add(transformer);
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
            loadImages(imagePaths, imageStates);
        }

        transformer = new Konva.Transformer({
            nodes: [],
            keepRatio: true,
            enabledAnchors: ["top-left", "top-right", "bottom-left", "bottom-right"],
            rotateEnabled: true
        });
        imageLayer.add(transformer);

        stage.on("click tap", (e) => {
            const target = e.target;
            if (target === canvasRect || target === stage) {
                deselectLayer();
                return;
            }
            if (imageNodes.includes(target)) {
                const index = imageNodes.indexOf(target);
                if (selectedLayer === target) return;
                selectLayer(index);
            }
        });

        stage.on("mousedown", (e) => {
            if (imageNodes.includes(e.target)) {
                const index = imageNodes.indexOf(e.target);
                selectLayer(index);
            }
        });

        stage.on("wheel", (e) => {
            e.evt.preventDefault();
            const scaleBy = 1.01; // 提高缩放灵敏度
            const target = transformer.nodes()[0];
            if (!target || !imageNodes.includes(target)) return;

            const oldScale = target.scaleX();
            const newScale = e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy;

            target.scaleX(newScale);
            target.scaleY(newScale);

            const index = imageNodes.indexOf(target);
            if (index !== -1) {
                const maxWidth = boardWidth * 0.8;
                const maxHeight = boardHeight * 0.8;
                const scale = Math.min(1, maxWidth / target.width(), maxHeight / target.height());
                initialStates[index] = {
                    x: target.x(),
                    y: target.y(),
                    scaleX: target.scaleX() / scale,
                    scaleY: target.scaleY() / scale,
                    rotation: target.rotation()
                };
                node.properties.image_states = initialStates;
                node.widgets.find(w => w.name === "image_states").value = JSON.stringify(initialStates);
                node.setProperty("image_states", initialStates);
                saveHistory();
            }

            imageLayer.batchDraw();
        });

        node.addDOMWidget("canvas", "Canvas", mainContainer, {
            serialize: true,
            getValue() {
                return {
                    board_width: boardWidth,
                    board_height: boardHeight,
                    border_width: borderWidth,
                    canvas_color: canvasColor,
                    border_color: borderColor,
                    image_paths: imagePaths,
                    image_states: initialStates
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
                    initialStates = value.image_states || initialStates;
                    updateSize();
                    if (imagePaths.length > 0) {
                        loadImages(imagePaths, initialStates);
                    }
                } catch (e) {
                    log.error("Error in setValue:", e);
                    statusText.innerText = "设置画板值失败";
                    statusText.style.color = "#f00";
                }
            }
        });

        const nodeWidth = boardWidth + 2 * borderWidth + 20;
        const nodeHeight = boardHeight + 2 * borderWidth + 206;
        node.setSize([nodeWidth, nodeHeight]);
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
                node.properties.image_states = initialStates;
                const serializedStates = JSON.stringify(initialStates);
                node.widgets.find(w => w.name === "image_states").value = serializedStates;
                node.setProperty("image_states", initialStates);
                if (app.queuePrompt) {
                    app.queuePrompt();
                }
            } catch (e) {
                log.error("Failed to queue prompt:", e);
            }
        }

        function updateSize() {
            try {
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

                node.widgets.forEach(widget => {
                    if (widget.name === "board_width") widget.value = boardWidth;
                    if (widget.name === "board_height") widget.value = boardHeight;
                    if (widget.name === "border_width") widget.value = borderWidth;
                    if (widget.name === "canvas_color") widget.value = canvasColorValue;
                    if (widget.name === "image_states") widget.value = JSON.stringify(initialStates);
                });
                node.widgets_values = [boardWidth, boardHeight, borderWidth, canvasColorValue, JSON.stringify(initialStates)];

                node.inputs.board_width.value = boardWidth;
                node.inputs.board_height.value = boardHeight;
                node.inputs.border_width.value = borderWidth;
                node.inputs.canvas_color.value = canvasColorValue;

                const containerWidth = boardWidth + 2 * borderWidth;
                const containerHeight = boardHeight + 2 * borderWidth;
                stage.width(containerWidth);
                stage.height(containerHeight);
                canvasRect.setAttrs({
                    x: borderWidth,
                    y: borderWidth,
                    width: boardWidth,
                    height: boardHeight,
                    fill: canvasColor
                });

                imageNodes.forEach((node, i) => {
                    const state = initialStates[i] || {};
                    const imgWidth = node.width();
                    const imgHeight = node.height();
                    const maxWidth = boardWidth * 0.8;
                    const maxHeight = boardHeight * 0.8;
                    const scale = Math.min(1, maxWidth / imgWidth, maxHeight / imgHeight);
                    const newX = state.x || borderWidth + boardWidth / 2;
                    const newY = state.y || borderWidth + boardHeight / 2;
                    node.x(newX);
                    node.y(newY);
                    node.scaleX(scale * (state.scaleX || 1));
                    node.scaleY(scale * (state.scaleY || 1));
                    node.rotation(state.rotation || 0);
                    node.offsetX(imgWidth / 2);
                    node.offsetY(imgHeight / 2);
                    initialStates[i] = {
                        x: node.x(),
                        y: node.y(),
                        scaleX: node.scaleX() / scale,
                        scaleY: node.scaleY() / scale,
                        rotation: node.rotation()
                    };
                });

                const nodeWidth = boardWidth + 2 * borderWidth + 20;
                const nodeHeight = boardHeight + 2 * borderWidth + 206;
                node.setSize([nodeWidth, nodeHeight]);

                node.properties.ui_config = {
                    board_width: boardWidth,
                    board_height: boardHeight,
                    border_width: borderWidth,
                    canvas_color: canvasColor,
                    border_color: borderColor,
                    image_paths: imagePaths
                };
                node.properties.image_states = initialStates;
                node.setProperty("ui_config", node.properties.ui_config);
                node.setProperty("image_states", initialStates);

                canvasLayer.batchDraw();
                imageLayer.batchDraw();
                stage.batchDraw();

                updateLayerPanel();
            } catch (e) {
                log.error("Error in updateSize:", e);
                statusText.innerText = "更新画板失败";
                statusText.style.color = "#f00";
            }
        }

        let pollInterval = null;
        function startPolling() {
            if (pollInterval) clearInterval(pollInterval);
            pollInterval = setInterval(() => {
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

                if (JSON.stringify(newImagePaths) !== JSON.stringify(lastImagePaths)) {
                    lastImagePaths = newImagePaths.slice();
                    if (newImagePaths.length > 0) {
                        imagePaths = newImagePaths;
                        node.properties.ui_config.image_paths = imagePaths;
                        node.properties.image_states = states;
                        if (states.length === 0 && initialStates.length === 0) {
                            initialStates = states;
                            node.setProperty("image_states", initialStates);
                        } else {
                            initialStates = states;
                        }
                        loadImages(imagePaths, initialStates);
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
                if (states.length === 0 && initialStates.length === 0) {
                    initialStates = states;
                    node.setProperty("image_states", initialStates);
                } else {
                    initialStates = states;
                }
                lastImagePaths = imagePaths.slice();
                loadImages(imagePaths, initialStates);
            } else {
                statusText.innerText = "无有效图像数据，请检查上游节点";
                statusText.style.color = "#f00";
                log.error("No valid image paths received in onNodeExecuted");
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
                if (states.length === 0 && initialStates.length === 0) {
                    initialStates = states;
                    node.setProperty("image_states", initialStates);
                } else {
                    initialStates = states;
                }
                lastImagePaths = imagePaths.slice();
                loadImages(imagePaths, states);
            } else {
                statusText.innerText = "无有效图像数据，请检查上游节点";
                statusText.style.color = "#f00";
                log.error("No valid image paths received in onExecuted");
            }
        };

        node.onRemoved = () => {
            if (pollInterval) clearInterval(pollInterval);
            stage.destroy();
            mainContainer.remove();
            imageCache.clear();
            log.info("XISER_Canvas node removed, resources cleaned");
        };

        updateSize();
    }
});