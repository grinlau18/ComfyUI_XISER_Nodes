import { app } from "/scripts/app.js";

// Logging control
const LOG_LEVEL = "info";
const log = {
    info: (...args) => { if (LOG_LEVEL !== "error") console.log(...args); },
    error: (...args) => console.error(...args),
    warning: (...args) => console.warn(...args)
};

// Debounce function
function debounce(fn, delay) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn(...args), delay);
    };
}

app.registerExtension({
    name: "XISER.ReorderImages",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "XIS_ReorderImages") {
            log.info("Registering XIS_ReorderImages node definition");
            nodeType.prototype.comfyClass = "XIS_ReorderImages";
            nodeType.prototype.onNodeCreated = function () {
                log.info(`XIS_ReorderImages node created with ID: ${this.id}`);
                if (this.id <= 0) {
                    log.warning("Temporary invalid node ID, waiting for valid ID");
                }

                // Check if images output already exists to avoid duplicates
                const hasImagesOutput = this.outputs && this.outputs.some(output => output.name === "images");
                if (!hasImagesOutput) {
                    this.addOutput("images", "IMAGE");
                }
            };
        }
    },
    async setup() {
        log.info("XISER_ReorderImages extension loaded");

        // Load Sortable.js
        await new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = "/extensions/ComfyUI_XISER_Nodes/lib/Sortable.min.js";
            script.onload = () => {
                log.info("Sortable.js loaded successfully");
                resolve();
            };
            script.onerror = () => {
                log.error("Failed to load Sortable.js");
                reject();
            };
            document.head.appendChild(script);
        });

        // Load Inter font
        const fontLink = document.createElement("link");
        fontLink.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap";
        fontLink.rel = "stylesheet";
        document.head.appendChild(fontLink);

        // Add styles with unique prefix
        const style = document.createElement("style");
        style.textContent = `
            .xiser-reorder-container {
                box-sizing: border-box;
                width: 100%;
                min-width: 332px;
                background: rgba(0, 0, 0, 0.6);
                border-radius: 8px;
                padding: 8px;
                overflow-y: auto;
                font-family: 'Inter', sans-serif;
                color: #F5F6F5;
            }
            .xiser-reorder-container .xiser-reorder-image-card {
                display: flex;
                align-items: center;
                background: rgba(59, 59, 59, 0.6);
                padding: 8px;
                margin-bottom: 8px;
                border-radius: 6px;
                cursor: move;
                font-size: 12px;
                font-weight: 500;
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
                transition: background 0.2s, transform 0.2s;
            }
            .xiser-reorder-container .xiser-reorder-image-card:hover {
                background: rgba(80, 80, 80, 0.6);
                transform: translateY(-1px);
            }
            .xiser-reorder-container .xiser-reorder-image-card.sortable-chosen {
                background: rgb(29, 139, 242);
                opacity: 0.9;
                box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
            }
            .xiser-reorder-container .xiser-reorder-image-card.sortable-ghost {
                opacity: 0.4;
                background: rgb(29, 139, 242);
            }
            .xiser-reorder-container .xiser-reorder-image-card.disabled {
                cursor: default;
                opacity: 0.6;
                box-shadow: none;
            }
            .xiser-reorder-container .xiser-reorder-image-preview {
                width: 64px;
                height: 64px;
                object-fit: contain;
                margin-right: 12px;
                border-radius: 4px;
                border: 1px solid rgba(90, 90, 90, 0.6);
            }
            .xiser-reorder-container .xiser-reorder-image-info {
                flex: 1;
                color: rgba(245, 246, 245, 0.74);
            }
            .xiser-reorder-container .xiser-reorder-status-text {
                display: inline-block;
                background: rgba(54, 59, 59, 0.6);
                padding: 4px 8px;
                border-radius: 4px;
                font-size: 12px;
                font-weight: 500;
                margin-bottom: 12px;
                color: rgba(245, 246, 245, 0.73);
            }
            .xiser-reorder-container .xiser-reorder-card-container {
                margin-top: 8px;
            }
            .xiser-reorder-node {
                background: rgba(30, 30, 30, 0.6);
                border-radius: 8px;
            }
            .xiser-reorder-container .xiser-reorder-layer-toggle {
                margin-left: 8px;
                width: 40px;
                height: 20px;
                appearance: none;
                background: #4A4A4A;
                border-radius: 10px;
                position: relative;
                cursor: pointer;
                outline: none;
                pointer-events: auto;
            }
            .xiser-reorder-container .xiser-reorder-layer-toggle:checked {
                background: #1DA1F2;
            }
            .xiser-reorder-container .xiser-reorder-layer-toggle::before {
                content: '';
                position: absolute;
                width: 16px;
                height: 16px;
                background: #F5F6F5;
                border-radius: 50%;
                top: 2px;
                left: 2px;
                transition: transform 0.2s;
            }
            .xiser-reorder-container .xiser-reorder-layer-toggle:checked::before {
                transform: translateX(20px);
            }
            .xiser-reorder-container .xiser-reorder-layer-toggle:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
        `;
        document.head.appendChild(style);
    },
    async nodeCreated(node) {
        if (node.comfyClass !== "XIS_ReorderImages") return;

        // Ensure valid node ID
        async function ensureNodeId(node) {
            let attempts = 0;
            const maxAttempts = 400;
            while (node.id === -1 && attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 50));
                attempts++;
            }
            if (node.id === -1) {
                log.error(`Node ${node.comfyClass} failed to get valid ID`);
                throw new Error("Failed to get valid node ID");
            }
            return node.id;
        }

        try {
            await ensureNodeId(node);
            log.info(`XISER_ReorderImages node initialized: ${node.id}`);
        } catch (e) {
            log.error(`Node initialization failed: ${e}`);
            return;
        }

        // Clean up existing widgets
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

        // Initialize properties
        let imagePreviews = node.properties?.image_previews || [];
        let imageOrder = node.properties?.image_order || (imagePreviews.length > 0 ? [...Array(imagePreviews.length).keys()] : []);
        let isReversed = node.properties?.is_reversed || false;
        let enabledLayers = node.properties?.enabled_layers || (imagePreviews.length > 0 ? Array(imagePreviews.length).fill(true) : []);
        node.widgets_values = [JSON.stringify(imageOrder.filter((_, i) => enabledLayers[i]))];

        // Validate imageOrder
        function validateImageOrder(order, previews, enabled) {
            const numPreviews = previews.length;
            if (!Array.isArray(order) || order.length !== numPreviews) {
                log.warning(`Invalid imageOrder length: ${JSON.stringify(order)}, resetting to default [0..${numPreviews-1}]`);
                return [...Array(numPreviews).keys()];
            }
            const validOrder = order.filter(idx => Number.isInteger(idx) && idx >= 0 && idx < numPreviews);
            if (validOrder.length !== numPreviews || new Set(validOrder).size !== numPreviews) {
                log.warning(`Invalid imageOrder: ${JSON.stringify(order)}, resetting to default [0..${numPreviews-1}]`);
                return [...Array(numPreviews).keys()];
            }
            return validOrder;
        }

        // Add hidden widget for image_order
        const orderWidget = node.addWidget("hidden", "image_order", JSON.stringify(imageOrder.filter((_, i) => enabledLayers[i])), (value) => {
            try {
                const parsedOrder = JSON.parse(value) || imageOrder.filter((_, i) => enabledLayers[i]);
                imageOrder = validateImageOrder(parsedOrder, imagePreviews, enabledLayers);
                node.properties.image_order = imageOrder;
                node.setProperty("image_order", imageOrder);
                node.widgets_values = [JSON.stringify(imageOrder.filter((_, i) => enabledLayers[i]))];
                debouncedUpdateCardList();
                app.graph.setDirtyCanvas(true, true);
            } catch (e) {
                log.error(`Failed to parse image_order: ${e}`);
                statusText.innerText = "图像顺序解析失败";
                statusText.style.color = "#F55";
            }
        }, { serialize: true });

        // Add toggle widget for reverse_list
        const reverseWidget = node.addWidget("toggle", "reverse_list", isReversed, (value) => {
            isReversed = value;
            node.properties.is_reversed = isReversed;
            node.setProperty("is_reversed", isReversed);
            debouncedUpdateCardList();
            app.graph.setDirtyCanvas(true, true);
        }, { label: "Reverse Display", serialize: true });

        // Add button widget for resetting order
        const resetButtonWidget = node.addWidget("button", "reset_order", "Reset Order", () => {
            imageOrder = [...Array(imagePreviews.length).keys()];
            node.properties.image_order = imageOrder;
            const enabledOrder = imageOrder.filter((idx, i) => enabledLayers[idx]);
            orderWidget.value = JSON.stringify(enabledOrder);
            node.widgets_values = [JSON.stringify(enabledOrder)];
            debouncedUpdateCardList();
            app.graph.setDirtyCanvas(true, true);
            log.info(`Reset image order to: ${imageOrder}`);
        }, { label: "Reset Order", serialize: false });

        // Create main container
        const mainContainer = document.createElement("div");
        mainContainer.className = "xiser-reorder-container";
        mainContainer.dataset.nodeId = node.id;

        const statusText = document.createElement("div");
        statusText.className = "xiser-reorder-status-text";
        statusText.innerText = imagePreviews.length > 0 ? `已加载 ${imagePreviews.length} 张图像` : "等待图像...";
        mainContainer.appendChild(statusText);

        // Create card container
        const cardContainer = document.createElement("div");
        cardContainer.className = "xiser-reorder-card-container";
        mainContainer.appendChild(cardContainer);

        // Calculate node height
        function calculateNodeHeight() {
            const cardHeight = 84;
            const extraHeight = 96;
            const panelHeight = imagePreviews.length > 0 
                ? Math.min(Math.max(imagePreviews.length * cardHeight + extraHeight, 120), 1000)
                : 120;
            mainContainer.style.height = `${panelHeight-20}px`;
            mainContainer.style.maxHeight = `${panelHeight-20}px`;
            // Preserve current width, set height
            node.setSize([Math.max(node.size[0], 360), panelHeight + 120]);
        }

        // Update card list
        let sortableInstance = null;
        function updateCardList() {
            cardContainer.innerHTML = "";
            if (sortableInstance) {
                sortableInstance.destroy();
                sortableInstance = null;
            }

            // Warn about potential performance issues with large number of images
            if (imagePreviews.length > 50) {
                log.warning(`Large number of images detected: ${imagePreviews.length}. This may impact performance.`);
                statusText.innerText = `已加载 ${imagePreviews.length} 张图像（可能影响性能）`;
                statusText.style.color = "#FFA500"; // Orange warning color
            }

            // Ensure enabledLayers matches imagePreviews length
            if (enabledLayers.length !== imagePreviews.length) {
                enabledLayers = Array(imagePreviews.length).fill(true);
                node.properties.enabled_layers = enabledLayers;
            }

            imageOrder = validateImageOrder(imageOrder, imagePreviews, enabledLayers);
            node.properties.image_order = imageOrder;

            // Store enabled imageOrder
            const enabledOrder = imageOrder.filter((idx, i) => enabledLayers[idx]);
            orderWidget.value = JSON.stringify(enabledOrder);
            node.widgets_values = [JSON.stringify(enabledOrder)];
            log.info(`Enabled order: ${enabledOrder}`);

            const orderedPreviews = imageOrder.map(idx => {
                const preview = imagePreviews.find(p => p.index === idx);
                if (!preview) {
                    log.error(`No preview found for index ${idx}`);
                    return null;
                }
                return { ...preview, enabled: enabledLayers[idx] };
            }).filter(p => p !== null);

            if (orderedPreviews.length !== imagePreviews.length) {
                log.error("Incomplete orderedPreviews, resetting imageOrder");
                imageOrder = [...Array(imagePreviews.length).keys()];
                enabledLayers = Array(imagePreviews.length).fill(true);
                node.properties.image_order = imageOrder;
                node.properties.enabled_layers = enabledLayers;
                orderWidget.value = JSON.stringify(imageOrder.filter((idx, i) => enabledLayers[idx]));
                node.widgets_values = [JSON.stringify(imageOrder.filter((idx, i) => enabledLayers[idx]))];
                imagePreviews = imagePreviews.map((p, i) => ({ ...p, index: i }));
            }

            const displayPreviews = isReversed ? [...orderedPreviews].reverse() : orderedPreviews;

            // Count enabled layers for numbering
            const enabledCount = enabledLayers.filter(x => x).length;
            let enabledIndex = 0;

            displayPreviews.forEach((preview, i) => {
                if (!preview || !Number.isInteger(preview.index)) {
                    log.error("Skipping invalid preview:", preview);
                    return;
                }
                const card = document.createElement("div");
                card.className = "xiser-reorder-image-card";
                card.dataset.index = preview.index.toString();
                if (!preview.enabled || imagePreviews.length <= 1) {
                    card.classList.add("disabled");
                }

                const img = document.createElement("img");
                img.className = "xiser-reorder-image-preview";
                img.src = `data:image/png;base64,${preview.preview}`;
                card.appendChild(img);

                const info = document.createElement("div");
                info.className = "xiser-reorder-image-info";
                if (preview.enabled) {
                    const layerNumber = isReversed ? enabledCount - enabledIndex : enabledIndex + 1;
                    info.innerText = `图层 ${layerNumber} | 尺寸: ${preview.width}x${preview.height}`;
                    enabledIndex++;
                } else {
                    info.innerText = `已屏蔽 | 尺寸: ${preview.width}x${preview.height}`;
                }
                card.appendChild(info);

                // Add toggle for enabling/disabling layer
                const toggle = document.createElement("input");
                toggle.type = "checkbox";
                toggle.className = "xiser-reorder-layer-toggle";
                toggle.checked = preview.enabled;
                toggle.disabled = imagePreviews.length <= 1;
                toggle.addEventListener("change", () => {
                    enabledLayers[preview.index] = toggle.checked;
                    node.properties.enabled_layers = enabledLayers;
                    debouncedUpdateCardList();
                    app.graph.setDirtyCanvas(true, true);
                    log.info(`Layer ${preview.index} enabled: ${toggle.checked}`);
                });
                card.appendChild(toggle);

                cardContainer.appendChild(card);
            });

            calculateNodeHeight();
            log.info(`Card container children for node ${node.id}:`, Array.from(cardContainer.children).map(c => c.dataset.index));

            if (window.Sortable && imagePreviews.length > 1) {
                sortableInstance = new Sortable(cardContainer, {
                    animation: 150,
                    handle: ".xiser-reorder-image-card:not(.disabled)",
                    draggable: ".xiser-reorder-image-card:not(.disabled)",
                    ghostClass: "sortable-ghost",
                    chosenClass: "sortable-chosen",
                    onEnd: (evt) => {
                        const oldIndex = evt.oldIndex;
                        const newIndex = evt.newIndex;

                        log.info(`Sortable event for node ${node.id}:`, { oldIndex, newIndex, item: evt.item.dataset.index });

                        // Get current DOM order
                        const newDomOrder = Array.from(cardContainer.children).map(card => parseInt(card.dataset.index));
                        log.info(`DOM order after drag: ${newDomOrder}`);

                        // Adjust for isReversed
                        const displayOrder = isReversed ? newDomOrder.reverse() : newDomOrder;

                        // Update imageOrder, preserving disabled layers
                        const enabledIndices = displayOrder.filter(idx => enabledLayers[idx]);
                        const disabledIndices = imageOrder.filter(idx => !enabledLayers[idx]);
                        imageOrder = [...enabledIndices, ...disabledIndices];

                        // Ensure valid order
                        imageOrder = validateImageOrder(imageOrder, imagePreviews, enabledLayers);
                        node.properties.image_order = imageOrder;
                        const enabledOrder = imageOrder.filter((idx, i) => enabledLayers[idx]);
                        orderWidget.value = JSON.stringify(enabledOrder);
                        node.widgets_values = [JSON.stringify(enabledOrder)];
                        node.setProperty("image_order", imageOrder);

                        app.graph.setDirtyCanvas(true, true);
                        log.info(`Triggering canvas update for node ${node.id} after drag`);
                        log.info(`Image order updated: ${imageOrder}`);
                        log.info(`Enabled order after drag: ${enabledOrder}`);
                        log.info(`Enabled layers: ${enabledLayers}`);

                        debouncedUpdateCardList();
                    }
                });
            } else if (!window.Sortable) {
                statusText.innerText = "错误：Sortable.js 未加载";
                statusText.style.color = "#F55";
            } else {
                statusText.innerText = imagePreviews.length === 0 ? "无图像可排序" : "单张图像无需排序";
                statusText.style.color = "#F55";
            }

            if (imagePreviews.length <= 50) {
                statusText.innerText = imagePreviews.length > 0 ? `已加载 ${imagePreviews.length} 张图像（${enabledLayers.filter(x => x).length} 张启用）` : "等待图像...";
                statusText.style.color = imagePreviews.length > 0 ? "#2ECC71" : "#F5F6F5";
            }
        }

        // Debounced update card list
        const debouncedUpdateCardList = debounce(updateCardList, 300);

        // Add DOM widget
        node.addDOMWidget("reorder", "Image Reorder", mainContainer, {
            serialize: true,
            getValue() {
                return {
                    image_previews: imagePreviews.map(p => ({ index: p.index, width: p.width, height: p.height })),
                    image_order: imageOrder,
                    is_reversed: isReversed,
                    enabled_layers: enabledLayers
                };
            },
            setValue(value) {
                try {
                    imagePreviews = value.image_previews || imagePreviews;
                    const newOrder = value.image_order && Array.isArray(value.image_order) 
                        ? value.image_order.filter(idx => Number.isInteger(idx) && idx >= 0 && idx < imagePreviews.length) 
                        : (imagePreviews.length > 0 ? [...Array(imagePreviews.length).keys()] : []);
                    imageOrder = validateImageOrder(newOrder, imagePreviews, enabledLayers);
                    isReversed = value.is_reversed ?? isReversed;
                    enabledLayers = value.enabled_layers && Array.isArray(value.enabled_layers) && value.enabled_layers.length === imagePreviews.length 
                        ? value.enabled_layers 
                        : Array(imagePreviews.length).fill(true);
                    node.properties.image_previews = imagePreviews;
                    node.properties.image_order = imageOrder;
                    node.properties.is_reversed = isReversed;
                    node.properties.enabled_layers = enabledLayers;
                    orderWidget.value = JSON.stringify(imageOrder.filter((idx, i) => enabledLayers[idx]));
                    node.widgets_values = [JSON.stringify(imageOrder.filter((idx, i) => enabledLayers[idx]))];
                    reverseWidget.value = isReversed;
                    debouncedUpdateCardList();
                    app.graph.setDirtyCanvas(true, true);
                    log.info(`Restored state for node ${node.id}:`, { imageOrder, isReversed, enabledLayers });
                } catch (e) {
                    log.error(`Error in setValue for node ${node.id}: ${e}`);
                    statusText.innerText = "设置图像顺序失败";
                    statusText.style.color = "#F55";
                }
            }
        });

        // Allow width resizing, lock height, enforce min-width
        node.setSize([360, calculateNodeHeight() + 120]);
        node.onResize = function (size) {
            const cardHeight = 84;
            const extraHeight = 96;
            const panelHeight = 600;
            // Lock height, enforce min-width 360px
            size[0] = Math.max(size[0], 360);
            size[1] = panelHeight + 100;
            mainContainer.style.width = `${size[0]-22}px`;
            mainContainer.style.height = `${panelHeight-20}px`;
            mainContainer.style.maxHeight = `${panelHeight-44}px`;
        };

        // Add node styles
        if (node.getHTMLElement) {
            const element = node.getHTMLElement();
            if (element) {
                element.classList.add("xiser-reorder-node");
            }
        }

        // Handle node execution
        node.onExecuted = function (message) {
            if (message && message.image_previews && message.image_order) {
                const newPreviews = message.image_previews.map((p, i) => ({ ...p, index: i }));
                const prevImageCount = imagePreviews.length;
                const imageCountChanged = prevImageCount !== newPreviews.length;
        
                if (imageCountChanged) {
                    // Reset state if image count changed
                    log.info(`Image count changed from ${prevImageCount} to ${newPreviews.length}, resetting state`);
                    imagePreviews = newPreviews;
                    imageOrder = [...Array(newPreviews.length).keys()];
                    enabledLayers = Array(newPreviews.length).fill(true);
                } else {
                    // Preserve order and enabled layers, update previews
                    log.info(`Image count unchanged (${newPreviews.length}), preserving order and enabled layers`);
                    imagePreviews = newPreviews;
                    imageOrder = validateImageOrder(imageOrder, imagePreviews, enabledLayers);
                    enabledLayers = enabledLayers.length === imagePreviews.length ? enabledLayers : Array(imagePreviews.length).fill(true);
                }
        
                node.properties.image_previews = imagePreviews;
                node.properties.image_order = imageOrder;
                node.properties.enabled_layers = enabledLayers;
                orderWidget.value = JSON.stringify(imageOrder.filter((idx, i) => enabledLayers[idx]));
                node.widgets_values = [JSON.stringify(imageOrder.filter((idx, i) => enabledLayers[idx]))];
                log.info(`Node ${node.id} executed, imageOrder: ${imageOrder}, enabledLayers: ${enabledLayers}`);
                debouncedUpdateCardList();
            } else {
                statusText.innerText = "无有效图像数据";
                statusText.style.color = "#F55";
                log.error(`No valid image previews or order received for node ${node.id}`);
            }
        };

        // Clean up resources
        node.onRemoved = () => {
            if (sortableInstance) {
                sortableInstance.destroy();
            }
            mainContainer.remove();
            document.querySelectorAll(`.xiser-reorder-container[data-nodeId="${node.id}"]`).forEach(c => c.remove());
            log.info(`XISER_ReorderImages node ${node.id} removed, resources cleaned`);
        };

        // Clean up invalid containers
        document.querySelectorAll(`.xiser-reorder-container[data-nodeId="-1"]`).forEach(c => c.remove());

        // Initial render
        imageOrder = validateImageOrder(imageOrder, imagePreviews, enabledLayers);
        enabledLayers = enabledLayers.length === imagePreviews.length ? enabledLayers : Array(imagePreviews.length).fill(true);
        node.properties.enabled_layers = enabledLayers;
        orderWidget.value = JSON.stringify(imageOrder.filter((idx, i) => enabledLayers[idx]));
        node.widgets_values = [JSON.stringify(imageOrder.filter((idx, i) => enabledLayers[idx]))];
        updateCardList();
    }
});