/**
 * @file XISER Reorder Images Extension for ComfyUI
 * @description Manages image reordering with drag-and-drop and toggle functionality
 * @requires Sortable.js
 */

import { app } from "/scripts/app.js";

// Log level control
const LOG_LEVEL = "error"; // Options: "info", "warning", "error"

/**
 * Logging utility
 * @type {Object}
 */
const log = {
    info: (...args) => { if (LOG_LEVEL === "info") console.log(...args); },
    warning: (...args) => { if (LOG_LEVEL === "warning" || LOG_LEVEL === "info") console.warn(...args); },
    error: (...args) => { if (LOG_LEVEL === "error" || LOG_LEVEL === "warning" || LOG_LEVEL === "info") console.error(...args); }
};

const MIN_NODE_HEIGHT = 300;

// Global resource registry for reference counting
const resourceRegistry = {
    sortable: { count: 0, script: null }
};

/**
 * Generates unique node class name
 * @param {number} nodeId - Node identifier
 * @returns {string} CSS class name
 */
function getNodeClass(nodeId) {
    return `xiser-reorder-node-${nodeId}`;
}

/**
 * Debounce utility function
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
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
            };
            nodeType.prototype.onConfigure = function () {
                log.info(`Node ${this.id} configured, syncing state`);
                if (this.widgets) {
                    const orderWidget = this.widgets.find(w => w.name === "image_order");
                    if (orderWidget && this.properties) {
                        const imageOrder = this.properties.image_order || [];
                        const enabledLayers = this.properties.enabled_layers || [];
                        if (imageOrder.length && enabledLayers.length) {
                            orderWidget.value = JSON.stringify(imageOrder.filter((_, i) => enabledLayers[i]));
                            this.widgets_values = [orderWidget.value];
                            this.setDirtyCanvas(true, true);
                        }
                    }
                }
            };
        }
    },
    async setup() {
        log.info("XISER_ReorderImages extension loaded");

        // Load Sortable.js
        if (!resourceRegistry.sortable.script) {
            await new Promise((resolve, reject) => {
                const script = document.createElement("script");
                script.src = "/extensions/ComfyUI_XISER_Nodes/lib/Sortable.min.js";
                script.onload = () => {
                    log.info("Sortable.js loaded successfully");
                    resourceRegistry.sortable.script = script;
                    resourceRegistry.sortable.count++;
                    resolve();
                };
                script.onerror = () => {
                    log.error("Failed to load Sortable.js");
                    reject();
                };
                document.head.appendChild(script);
            });
        } else {
            resourceRegistry.sortable.count++;
        }

        // Add styles (using system font)
        const style = document.createElement("style");
        style.textContent = `
            .xiser-reorder-container {
                box-sizing: border-box;
                width: 100%;
                min-width: 332px;
                background: rgba(0, 0, 0, 0.6);
                border-radius: 8px;
                padding: 8px;
                overflow: hidden;
                font-family: system-ui, -apple-system, sans-serif;
                color: #F5F6F5;
                height: 100%;
                display: flex;
                flex-direction: column;
            }
            .xiser-reorder-container .xiser-reorder-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 8px;
                flex-shrink: 0;
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
                background: rgba(54, 59, 59, 0.6);
                padding: 4px 8px;
                border-radius: 4px;
                font-size: 12px;
                font-weight: 500;
                color: rgba(245, 246, 245, 0.73);
            }
            .xiser-reorder-container .xiser-reorder-card-container {
                margin-top: 8px;
                overflow-y: auto;
                flex-grow: 1;
                min-height: 60px;
            }
            .xiser-reorder-node {
                background: rgba(30, 30, 30, 0.6);
                border-radius: 8px;
                resize: both;
                overflow: hidden;
            }
            .xiser-reorder-container .xiser-reorder-layer-toggle,
            .xiser-reorder-container .xiser-reorder-single-mode-toggle {
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
            .xiser-reorder-container .xiser-reorder-layer-toggle:checked,
            .xiser-reorder-container .xiser-reorder-single-mode-toggle:checked {
                background: #1DA1F2;
            }
            .xiser-reorder-container .xiser-reorder-layer-toggle::before,
            .xiser-reorder-container .xiser-reorder-single-mode-toggle::before {
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
            .xiser-reorder-container .xiser-reorder-layer-toggle:checked::before,
            .xiser-reorder-container .xiser-reorder-single-mode-toggle:checked::before {
                transform: translateX(20px);
            }
            .xiser-reorder-container .xiser-reorder-layer-toggle:disabled,
            .xiser-reorder-single-mode-toggle:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
            .xiser-reorder-error-message {
                color: #F55;
                font-size: 12px;
                margin-top: 4px;
            }
        `;
        document.head.appendChild(style);

        // Clean up orphaned containers
        document.querySelectorAll('.xiser-reorder-container:not([data-nodeId])').forEach(c => c.remove());
    },
    async nodeCreated(node) {
        if (node.comfyClass !== "XIS_ReorderImages") return;

        /**
         * Ensures valid node ID
         * @param {Object} node - ComfyUI node
         * @returns {Promise<number>} Node ID
         */
        async function ensureNodeId(node) {
            let attempts = 0;
            const maxAttempts = 400;
            while (node.id <= 0 && attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 50));
                attempts++;
            }
            if (node.id <= 0) {
                log.error(`Node ${node.comfyClass} failed to get valid ID`);
                throw new Error("Failed to get valid node ID");
            }
            return node.id;
        }

        let nodeId;
        try {
            nodeId = await ensureNodeId(node);
            log.info(`XISER_ReorderImages node initialized: ${nodeId}`);
        } catch (e) {
            log.error(`Node initialization failed: ${e}`);
            return;
        }

        // Clean up existing widgets
        if (node.widgets) {
            node.widgets.forEach(widget => {
                if (widget.element && widget.element.parentNode) {
                    widget.element.parentNode.removeChild(widget.element);
                }
            });
            node.widgets = [];
        }

        // Initialize properties
        let imagePreviews = node.properties?.image_previews || [];
        let imageOrder = node.properties?.image_order || (imagePreviews.length > 0 ? imagePreviews.map(p => p.id) : []);
        let isReversed = node.properties?.is_reversed || false;
        let enabledLayers = node.properties?.enabled_layers || (imagePreviews.length > 0 ? Array(imagePreviews.length).fill(true) : []);
        let isSingleMode = node.properties?.is_single_mode || false;
        node.widgets_values = [JSON.stringify(imageOrder.filter((_, i) => enabledLayers[i]))];

        /**
         * Validates node state
         * @param {number[]} order - Image order array
         * @param {boolean[]} enabled - Enabled layers array
         * @param {Object[]} previews - Image previews array
         * @returns {boolean} Validity status
         */
        function validateState(order, enabled, previews) {
            const numPreviews = previews.length;
            if (!Array.isArray(order) || order.length !== numPreviews) {
                log.warning(`Invalid imageOrder length: ${order.length}, expected ${numPreviews}`);
                return false;
            }
            if (!Array.isArray(enabled) || enabled.length !== numPreviews) {
                log.warning(`Invalid enabledLayers length: ${enabled.length}, expected ${numPreviews}`);
                return false;
            }
            if (!order.every(id => Number.isInteger(id) && previews.some(p => p.id === id))) {
                log.warning(`Invalid IDs in imageOrder: ${JSON.stringify(order)}`);
                return false;
            }
            if (!enabled.every(e => typeof e === 'boolean')) {
                log.warning(`Invalid enabledLayers values: ${JSON.stringify(enabled)}`);
                return false;
            }
            return true;
        }

        /**
         * Validates and corrects image order
         * @param {number[]} order - Image order array
         * @param {Object[]} previews - Image previews array
         * @returns {number[]} Validated order
         */
        function validateImageOrder(order, previews) {
            const numPreviews = previews.length;
            if (!Array.isArray(order) || order.length !== numPreviews) {
                log.warning(`Invalid imageOrder length: ${JSON.stringify(order)}, resetting`);
                return previews.map(p => p.id);
            }
            const validOrder = order.filter(id => Number.isInteger(id) && previews.some(p => p.id === id));
            if (validOrder.length !== numPreviews) {
                log.warning(`Invalid imageOrder: ${JSON.stringify(order)}, resetting`);
                return previews.map(p => p.id);
            }
            return validOrder;
        }

        // Create main container
        const mainContainer = document.createElement("div");
        mainContainer.className = `xiser-reorder-container ${getNodeClass(nodeId)}`;
        mainContainer.dataset.nodeId = nodeId.toString();

        // Create header
        const header = document.createElement("div");
        header.className = "xiser-reorder-header";
        const statusText = document.createElement("div");
        statusText.className = "xiser-reorder-status-text";
        statusText.innerText = imagePreviews.length > 0 ? `Loaded ${imagePreviews.length} images` : "Waiting for images...";
        header.appendChild(statusText);

        const errorMessage = document.createElement("div");
        errorMessage.className = "xiser-reorder-error-message";
        errorMessage.style.display = "none";
        header.appendChild(errorMessage);

        mainContainer.appendChild(header);

        // Create card container
        const cardContainer = document.createElement("div");
        cardContainer.className = "xiser-reorder-card-container";
        mainContainer.appendChild(cardContainer);

        /**
         * Updates widget and marks canvas dirty
         * @param {number[]} order - Image order
         * @param {boolean[]} enabled - Enabled layers
         */
        function updateWidgetAndDirty(order, enabled) {
            const enabledOrder = order.filter((_, i) => enabled[i]);
            node.widgets_values[0] = JSON.stringify(enabledOrder);
            if (node.widgets[0]) {
                node.widgets[0].value = JSON.stringify(enabledOrder);
                if (node.onWidgetChanged) {
                    node.onWidgetChanged(node.widgets[0].name, node.widgets[0].value);
                }
            }
            node.setDirtyCanvas(true, true);
            app.graph.setDirtyCanvas(true, true);
            log.info(`Updated widget with order: ${enabledOrder}`);
        }

        // Add widgets
        const orderWidget = node.addWidget("hidden", "image_order", JSON.stringify(imageOrder.filter((_, i) => enabledLayers[i])), (value) => {
            try {
                const parsedOrder = JSON.parse(value) || imageOrder.filter((_, i) => enabledLayers[i]);
                const newOrder = validateImageOrder(parsedOrder, imagePreviews);
                if (!validateState(newOrder, enabledLayers, imagePreviews)) {
                    throw new Error("Invalid state after order update");
                }
                imageOrder = newOrder;
                node.properties.image_order = imageOrder;
                node.setProperty("image_order", imageOrder);
                updateWidgetAndDirty(imageOrder, enabledLayers);
                debouncedUpdateCardList();
                errorMessage.style.display = "none";
            } catch (e) {
                log.error(`Failed to parse image_order: ${e}`);
                statusText.innerText = "Failed to parse image order";
                errorMessage.innerText = `Error: ${e.message}`;
                errorMessage.style.display = "block";
            }
        }, { serialize: true });

        const reverseWidget = node.addWidget("toggle", "Reverse Display", isReversed, (value) => {
            isReversed = value;
            node.properties.is_reversed = isReversed;
            node.setProperty("is_reversed", isReversed);
            updateWidgetAndDirty(imageOrder, enabledLayers);
            debouncedUpdateCardList();
            errorMessage.style.display = "none";
        }, { serialize: true });

        const singleModeWidget = node.addWidget("toggle", "Single Mode", isSingleMode, (value) => {
            isSingleMode = value;
            node.properties.is_single_mode = isSingleMode;
            node.setProperty("is_single_mode", isSingleMode);
            if (isSingleMode) {
                const enabledIndex = enabledLayers.findIndex(x => x);
                enabledLayers = Array(imagePreviews.length).fill(false);
                if (enabledIndex !== -1) {
                    enabledLayers[enabledIndex] = true;
                } else if (imagePreviews.length > 0) {
                    enabledLayers[0] = true;
                }
                node.properties.enabled_layers = enabledLayers;
                node.setProperty("enabled_layers", enabledLayers);
            }
            updateWidgetAndDirty(imageOrder, enabledLayers);
            debouncedUpdateCardList();
            log.info(`Single mode toggled: ${isSingleMode}`);
            errorMessage.style.display = "none";
        }, { serialize: true });

        const resetButtonWidget = node.addWidget("button", "Reset Order", "Reset Order", () => {
            imageOrder = imagePreviews.map(p => p.id);
            enabledLayers = Array(imagePreviews.length).fill(true);
            node.properties.image_order = imageOrder;
            node.properties.enabled_layers = enabledLayers;
            node.setProperty("image_order", imageOrder);
            node.setProperty("enabled_layers", enabledLayers);
            updateWidgetAndDirty(imageOrder, enabledLayers);
            debouncedUpdateCardList();
            log.info(`Reset image order to: ${imageOrder}`);
            errorMessage.style.display = "none";
        }, { serialize: false });

        /**
         * Updates container height based on node size
         */
        function updateContainerHeight() {
            const nodeHeight = node.size[1];
            const nodeWidth = node.size[0];
            const headerHeight = header.offsetHeight || 30;
            const marginOffset = node.properties?.margin_offset || 50;
            const availableHeight = nodeHeight - headerHeight - marginOffset - 70;
            const availableWidth = nodeWidth - 20;
            mainContainer.style.height = `${Math.max(availableHeight, 100)}px`;
            mainContainer.style.width = `${Math.max(availableWidth, 332)}px`;
            cardContainer.style.height = `${Math.max(availableHeight - headerHeight, 60)}px`;
            node.properties.margin_offset = marginOffset;
            node.setProperty("margin_offset", marginOffset);
        }

        let sortableInstance = null;
        // Debounced updateCardList to reduce frequent DOM updates
        const debouncedUpdateCardList = debounce(() => {
            cardContainer.innerHTML = "";
            if (sortableInstance) {
                sortableInstance.destroy();
                sortableInstance = null;
            }

            if (imagePreviews.length > 50) {
                log.warning(`Large number of images: ${imagePreviews.length}`);
                statusText.innerText = `Loaded ${imagePreviews.length} images (may impact performance)`;
                statusText.style.color = "#FFA500";
            }

            if (enabledLayers.length !== imagePreviews.length) {
                enabledLayers = Array(imagePreviews.length).fill(isSingleMode ? false : true);
                if (isSingleMode && imagePreviews.length > 0) {
                    enabledLayers[0] = true;
                }
                node.properties.enabled_layers = enabledLayers;
                node.setProperty("enabled_layers", enabledLayers);
            }

            imageOrder = validateImageOrder(imageOrder, imagePreviews);
            if (!validateState(imageOrder, enabledLayers, imagePreviews)) {
                log.error("Invalid state, resetting");
                imageOrder = imagePreviews.map(p => p.id);
                enabledLayers = Array(imagePreviews.length).fill(isSingleMode ? false : true);
                if (isSingleMode && imagePreviews.length > 0) {
                    enabledLayers[0] = true;
                }
                errorMessage.innerText = "Invalid state, reset to default";
                errorMessage.style.display = "block";
                node.properties.image_order = imageOrder;
                node.properties.enabled_layers = enabledLayers;
                node.setProperty("image_order", imageOrder);
                node.setProperty("enabled_layers", enabledLayers);
            }

            node.properties.image_order = imageOrder;
            node.properties.enabled_layers = enabledLayers;
            updateWidgetAndDirty(imageOrder, enabledLayers);

            const orderedPreviews = imageOrder.map(id => imagePreviews.find(p => p.id === id)).filter(p => p);
            const displayPreviews = isReversed ? [...orderedPreviews].reverse() : orderedPreviews;
            const enabledCount = enabledLayers.filter(x => x).length;
            let enabledIndex = 0;

            displayPreviews.forEach((preview, i) => {
                if (!preview || !Number.isInteger(preview.id)) {
                    log.error("Skipping invalid preview:", preview);
                    return;
                }
                const card = document.createElement("div");
                card.className = "xiser-reorder-image-card";
                card.dataset.id = preview.id.toString();
                const index = imagePreviews.findIndex(p => p.id === preview.id);
                if (!enabledLayers[index]) {
                    card.classList.add("disabled");
                }

                const img = document.createElement("img");
                img.className = "xiser-reorder-image-preview";
                img.src = `data:image/webp;base64,${preview.preview}`; // Use WebP for smaller size
                card.appendChild(img);

                const info = document.createElement("div");
                info.className = "xiser-reorder-image-info";
                if (enabledLayers[index]) {
                    const layerNumber = isReversed ? enabledCount - enabledIndex - 1 : enabledIndex + 1;
                    info.innerText = `Layer ${layerNumber} | Size: ${preview.width}x${preview.height}`;
                    enabledIndex++;
                } else {
                    info.innerText = `Disabled | Size: ${preview.width}x${preview.height}`;
                }
                card.appendChild(info);

                const toggle = document.createElement("input");
                toggle.type = "checkbox";
                toggle.className = "xiser-reorder-layer-toggle";
                toggle.checked = enabledLayers[index];
                toggle.disabled = imagePreviews.length <= 1;
                if (imagePreviews.length <= 1) {
                    enabledLayers[index] = true;
                    toggle.checked = true;
                }
                toggle.addEventListener("change", () => {
                    if (isSingleMode) {
                        enabledLayers = Array(imagePreviews.length).fill(false);
                        enabledLayers[index] = toggle.checked;
                    } else {
                        enabledLayers[index] = toggle.checked;
                    }
                    if (imagePreviews.length <= 1) {
                        enabledLayers[index] = true;
                        toggle.checked = true;
                    }
                    if (!validateState(imageOrder, enabledLayers, imagePreviews)) {
                        log.error("Invalid state after toggle, resetting");
                        imageOrder = imagePreviews.map(p => p.id);
                        enabledLayers = Array(imagePreviews.length).fill(true);
                        errorMessage.innerText = "Invalid layer state, reset to default";
                        errorMessage.style.display = "block";
                        node.properties.image_order = imageOrder;
                        node.properties.enabled_layers = enabledLayers;
                        node.setProperty("image_order", imageOrder);
                        node.setProperty("enabled_layers", enabledLayers);
                    }
                    node.properties.enabled_layers = enabledLayers;
                    node.setProperty("enabled_layers", enabledLayers);
                    updateWidgetAndDirty(imageOrder, enabledLayers);
                    debouncedUpdateCardList();
                    log.info(`Layer ${preview.id} enabled: ${toggle.checked}`);
                });
                card.appendChild(toggle);

                cardContainer.appendChild(card);
            });

            updateContainerHeight();
            if (window.Sortable && imagePreviews.length > 1) {
                sortableInstance = new Sortable(cardContainer, {
                    animation: 150,
                    handle: `.xiser-reorder-image-card:not(.disabled)`,
                    draggable: `.xiser-reorder-image-card:not(.disabled)`,
                    ghostClass: "sortable-ghost",
                    chosenClass: "sortable-chosen",
                    group: `xiser-reorder-${nodeId}`,
                    onEnd: (evt) => {
                        const newDomOrder = Array.from(cardContainer.children).map(card => parseInt(card.dataset.id));
                        imageOrder = isReversed ? newDomOrder.reverse() : newDomOrder;
                        imageOrder = validateImageOrder(imageOrder, imagePreviews);
                        if (!validateState(imageOrder, enabledLayers, imagePreviews)) {
                            log.error("Invalid state after drag, resetting order");
                            imageOrder = imagePreviews.map(p => p.id);
                            errorMessage.innerText = "Invalid order state, reset to default";
                            errorMessage.style.display = "block";
                            node.properties.image_order = imageOrder;
                            node.setProperty("image_order", imageOrder);
                        }
                        node.properties.image_order = imageOrder;
                        node.setProperty("image_order", imageOrder);
                        updateWidgetAndDirty(imageOrder, enabledLayers);
                        debouncedUpdateCardList();
                        log.info(`Image order updated: ${imageOrder}`);
                    }
                });
            } else if (!window.Sortable) {
                statusText.innerText = "Error: Sortable.js not loaded";
                statusText.style.color = "#F55";
                errorMessage.innerText = "Sortable.js not loaded";
                errorMessage.style.display = "block";
            } else {
                statusText.innerText = imagePreviews.length === 0 ? "No images to sort" : "Single image, no sorting needed";
                statusText.style.color = "#F55";
            }

            if (imagePreviews.length <= 50) {
                statusText.innerText = imagePreviews.length > 0 ? `Loaded ${imagePreviews.length} images (${enabledLayers.filter(x => x).length} enabled)` : "Waiting for images...";
                statusText.style.color = imagePreviews.length > 0 ? "#2ECC71" : "#F5F6F5";
                errorMessage.style.display = "none";
            }
        }, 100); // Debounce with 100ms delay

        node.addDOMWidget("reorder", "Image Reorder", mainContainer, {
            serialize: true,
            getValue() {
                return {
                    image_previews: imagePreviews.map(p => ({ id: p.id, width: p.width, height: p.height })), // Exclude preview to reduce size
                    image_order: imageOrder,
                    is_reversed: isReversed,
                    enabled_layers: enabledLayers,
                    is_single_mode: isSingleMode,
                    node_size: [node.size[0], node.size[1]]
                };
            },
            setValue(value) {
                try {
                    imagePreviews = value.image_previews || imagePreviews;
                    const newOrder = value.image_order && Array.isArray(value.image_order)
                        ? value.image_order.filter(id => Number.isInteger(id) && imagePreviews.some(p => p.id === id))
                        : imagePreviews.map(p => p.id);
                    imageOrder = validateImageOrder(newOrder, imagePreviews);
                    isReversed = value.is_reversed ?? isReversed;
                    enabledLayers = value.enabled_layers && Array.isArray(value.enabled_layers) && value.enabled_layers.length === imagePreviews.length
                        ? value.enabled_layers
                        : Array(imagePreviews.length).fill(isSingleMode ? false : true);
                    if (isSingleMode && imagePreviews.length > 0 && !enabledLayers.includes(true)) {
                        enabledLayers[0] = true;
                    }
                    isSingleMode = value.is_single_mode ?? isSingleMode;
                    if (!validateState(imageOrder, enabledLayers, imagePreviews)) {
                        log.error("Invalid state in setValue, resetting");
                        imageOrder = imagePreviews.map(p => p.id);
                        enabledLayers = Array(imagePreviews.length).fill(isSingleMode ? false : true);
                        if (isSingleMode && imagePreviews.length > 0) {
                            enabledLayers[0] = true;
                        }
                        errorMessage.innerText = "Invalid state, reset to default";
                        errorMessage.style.display = "block";
                        node.properties.image_order = imageOrder;
                        node.properties.enabled_layers = enabledLayers;
                        node.setProperty("image_order", imageOrder);
                        node.setProperty("enabled_layers", enabledLayers);
                    }
                    node.properties.image_previews = imagePreviews;
                    node.properties.image_order = imageOrder;
                    node.properties.is_reversed = isReversed;
                    node.properties.enabled_layers = enabledLayers;
                    node.properties.is_single_mode = isSingleMode;
                    updateWidgetAndDirty(imageOrder, enabledLayers);
                    reverseWidget.value = isReversed;
                    singleModeWidget.value = isSingleMode;

                    if (value.node_size && Array.isArray(value.node_size) && value.node_size.length === 2) {
                        const [width, height] = value.node_size;
                        node.setSize([Math.max(width, 360), Math.max(height, MIN_NODE_HEIGHT)]);
                    }

                    debouncedUpdateCardList();
                    log.info(`Restored state for node ${nodeId}:`, { imageOrder, isReversed, enabledLayers, isSingleMode });
                    errorMessage.style.display = "none";
                } catch (e) {
                    log.error(`Error in setValue for node ${nodeId}: ${e}`);
                    statusText.innerText = "Failed to set image order";
                    statusText.style.color = "#F55";
                    errorMessage.innerText = `Error: ${e.message}`;
                    errorMessage.style.display = "block";
                }
            }
        });

        // Initialize node size
        const savedSize = node.properties?.node_size;
        const savedMargin = node.properties?.margin_offset || 50;
        if (savedSize && Array.isArray(savedSize) && savedSize.length === 2) {
            const [width, height] = savedSize;
            node.setSize([Math.max(width, 360), Math.max(height, MIN_NODE_HEIGHT)]);
            node.properties.margin_offset = savedMargin;
            node.setProperty("margin_offset", savedMargin);
            updateContainerHeight();
            log.info(`Restored node size for node ${nodeId}: ${width}x${height}, margin_offset: ${savedMargin}`);
        } else {
            node.setSize([360, 360]);
            node.properties.margin_offset = savedMargin;
            node.setProperty("margin_offset", savedMargin);
            updateContainerHeight();
            log.info(`Set default node size for node ${nodeId}: 360x360, margin_offset: ${savedMargin}`);
        }

        node.onResize = function (size) {
            size[0] = Math.max(size[0], 360);
            size[1] = Math.max(size[1], MIN_NODE_HEIGHT);
            node.properties.node_size = [size[0], size[1]];
            node.setProperty("node_size", [size[0], size[1]]);
            node.properties.margin_offset = node.properties.margin_offset || 50;
            node.setProperty("margin_offset", node.properties.margin_offset);
            updateContainerHeight();
            log.info(`Node ${nodeId} resized to: ${size[0]}x${size[1]}, margin_offset: ${node.properties.margin_offset}`);
        };

        node.onExecuted = function (message) {
            if (message && message.image_previews) {
                const prevImageCount = imagePreviews.length;
                const newPreviews = message.image_previews;
                const imageCountChanged = prevImageCount !== newPreviews.length;

                if (imageCountChanged) {
                    log.info(`Image count changed from ${prevImageCount} to ${newPreviews.length}`);
                    imagePreviews = newPreviews;
                    imageOrder = newPreviews.map(p => p.id);
                    enabledLayers = isSingleMode
                        ? Array(newPreviews.length).fill(false)
                        : Array(newPreviews.length).fill(true);
                    if (isSingleMode && newPreviews.length > 0) {
                        enabledLayers[0] = true;
                    }
                } else {
                    const oldIds = imagePreviews.map(p => p.id);
                    const newIds = newPreviews.map(p => p.id);
                    if (!oldIds.every((id, i) => id === newIds[i])) {
                        log.info("Image IDs changed, updating previews");
                        imagePreviews = newPreviews;
                        imageOrder = validateImageOrder(imageOrder, imagePreviews);
                    } else {
                        imagePreviews = newPreviews;
                    }
                    if (enabledLayers.length !== imagePreviews.length) {
                        enabledLayers = isSingleMode
                            ? Array(imagePreviews.length).fill(false)
                            : Array(imagePreviews.length).fill(true);
                        if (isSingleMode && imagePreviews.length > 0) {
                            enabledLayers[0] = true;
                        }
                    }
                }

                if (!validateState(imageOrder, enabledLayers, imagePreviews)) {
                    log.error("Invalid state from server, resetting");
                    imageOrder = imagePreviews.map(p => p.id);
                    enabledLayers = Array(imagePreviews.length).fill(isSingleMode ? false : true);
                    if (isSingleMode && imagePreviews.length > 0) {
                        enabledLayers[0] = true;
                    }
                    errorMessage.innerText = "Invalid server state, reset to default";
                    errorMessage.style.display = "block";
                    node.properties.image_order = imageOrder;
                    node.properties.enabled_layers = enabledLayers;
                    node.setProperty("image_order", imageOrder);
                    node.setProperty("enabled_layers", enabledLayers);
                }

                node.properties.image_previews = imagePreviews;
                node.properties.image_order = imageOrder;
                node.properties.enabled_layers = enabledLayers;
                node.properties.is_single_mode = isSingleMode;
                updateWidgetAndDirty(imageOrder, enabledLayers);
                debouncedUpdateCardList();
                log.info(`Node ${nodeId} executed, imageOrder: ${imageOrder}`);
                errorMessage.style.display = "none";
            } else {
                statusText.innerText = "No valid image data";
                statusText.style.color = "#F55";
                errorMessage.innerText = "No valid image previews";
                errorMessage.style.display = "block";
                log.error(`No valid image previews for node ${nodeId}`);
            }
        };

        node.onRemoved = function () {
            if (sortableInstance) {
                sortableInstance.destroy();
                sortableInstance = null;
            }
            mainContainer.remove();
            document.querySelectorAll(`.xiser-reorder-container[data-nodeId="${nodeId}"]`).forEach(c => c.remove());
            resourceRegistry.sortable.count--;
            if (resourceRegistry.sortable.count <= 0 && resourceRegistry.sortable.script) {
                resourceRegistry.sortable.script.remove();
                resourceRegistry.sortable.script = null;
                log.info("Unloaded Sortable.js");
            }
            log.info(`Node ${nodeId} removed, resources cleaned`);
        };

        imageOrder = validateImageOrder(imageOrder, imagePreviews);
        enabledLayers = enabledLayers.length === imagePreviews.length
            ? enabledLayers
            : (isSingleMode
                ? Array(imagePreviews.length).fill(false)
                : Array(imagePreviews.length).fill(true));
        if (isSingleMode && imagePreviews.length > 0 && !enabledLayers.includes(true)) {
            enabledLayers[0] = true;
        }
        if (!validateState(imageOrder, enabledLayers, imagePreviews)) {
            log.error("Invalid initial state, resetting");
            imageOrder = imagePreviews.map(p => p.id);
            enabledLayers = Array(imagePreviews.length).fill(isSingleMode ? false : true);
            if (isSingleMode && imagePreviews.length > 0) {
                enabledLayers[0] = true;
            }
            errorMessage.innerText = "Invalid initial state, reset to default";
            errorMessage.style.display = "block";
        }
        node.properties.image_order = imageOrder;
        node.properties.enabled_layers = enabledLayers;
        node.properties.is_single_mode = isSingleMode;
        node.setProperty("image_order", imageOrder);
        node.setProperty("enabled_layers", enabledLayers);
        node.setProperty("is_single_mode", isSingleMode);
        updateWidgetAndDirty(imageOrder, enabledLayers);
        debouncedUpdateCardList();
    }
});