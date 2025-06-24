import { app } from "/scripts/app.js";

// Log level control
const LOG_LEVEL = "error"; // Options: "info", "warning", "error"

/**
 * Logging utility for controlled output based on log level.
 * @constant {Object}
 */
const log = {
    info: (...args) => { if (LOG_LEVEL === "info") console.log(...args); },
    warning: (...args) => { if (LOG_LEVEL === "warning" || LOG_LEVEL === "info") console.warn(...args); },
    error: (...args) => { if (LOG_LEVEL === "error" || LOG_LEVEL === "warning" || LOG_LEVEL === "info") console.error(...args); }
};

/**
 * Minimum node height in pixels.
 * @constant {number}
 */
const MIN_NODE_HEIGHT = 300;

/**
 * Debounces a function to limit execution frequency.
 * @param {Function} fn - Function to debounce.
 * @param {number} delay - Delay in milliseconds.
 * @returns {Function} Debounced function.
 */
function debounce(fn, delay) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn(...args), delay);
    };
}

/**
 * Generates a unique class name for node-specific styling.
 * @param {number} nodeId - The node ID.
 * @returns {string} Unique class name.
 */
function getNodeClass(nodeId) {
    return `xiser-reorder-node-${nodeId}`;
}

app.registerExtension({
    name: "XISER.ReorderImages",
    /**
     * Registers node definition and configures initial setup.
     * @param {Object} nodeType - Node type object.
     * @param {Object} nodeData - Node data configuration.
     * @param {Object} app - ComfyUI app instance.
     */
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
        }
    },
    /**
     * Sets up the extension by loading dependencies and styles.
     */
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

        // Add styles with node-specific scoping
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
                font-family: 'Inter', sans-serif;
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
            .xiser-reorder-container .xiser-reorder-single-mode-toggle:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
        `;
        document.head.appendChild(style);

        // Clean up any orphaned containers
        document.querySelectorAll('.xiser-reorder-container:not([data-nodeId])').forEach(c => c.remove());
    },
    /**
     * Initializes node UI and behavior after creation.
     * @param {Object} node - Node instance.
     */
    async nodeCreated(node) {
        if (node.comfyClass !== "XIS_ReorderImages") return;

        /**
         * Ensures a valid node ID.
         * @param {Object} node - Node instance.
         * @returns {Promise<number>} Node ID.
         * @throws {Error} If valid ID cannot be obtained.
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
        let imageOrder = node.properties?.image_order || (imagePreviews.length > 0 ? [...Array(imagePreviews.length).keys()] : []);
        let isReversed = node.properties?.is_reversed || false;
        let enabledLayers = node.properties?.enabled_layers || (imagePreviews.length > 0 ? Array(imagePreviews.length).fill(true) : []);
        let isSingleMode = node.properties?.is_single_mode || false;
        node.widgets_values = [JSON.stringify(imageOrder.filter((_, i) => enabledLayers[i]))];
        const stateVersion = node.properties?.state_version || 0;

        /**
         * Validates image order array.
         * @param {number[]} order - Image order array.
         * @param {Object[]} previews - Image previews array.
         * @param {boolean[]} enabled - Enabled layers array.
         * @returns {number[]} Validated order.
         */
        function validateImageOrder(order, previews, enabled) {
            const numPreviews = previews.length;
            if (!Array.isArray(order) || order.length !== numPreviews) {
                log.warning(`Invalid imageOrder length: ${JSON.stringify(order)}, resetting`);
                return [...Array(numPreviews).keys()];
            }
            const validOrder = order.filter(idx => Number.isInteger(idx) && idx >= 0 && idx < numPreviews);
            if (validOrder.length !== numPreviews || new Set(validOrder).size !== numPreviews) {
                log.warning(`Invalid imageOrder: ${JSON.stringify(order)}, resetting`);
                return [...Array(numPreviews).keys()];
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
        mainContainer.appendChild(header);

        // Create card container
        const cardContainer = document.createElement("div");
        cardContainer.className = "xiser-reorder-card-container";
        mainContainer.appendChild(cardContainer);

        // Add widgets
        const orderWidget = node.addWidget("hidden", "image_order", JSON.stringify(imageOrder.filter((_, i) => enabledLayers[i])), (value) => {
            try {
                const parsedOrder = JSON.parse(value) || imageOrder.filter((_, i) => enabledLayers[i]);
                imageOrder = validateImageOrder(parsedOrder, imagePreviews, enabledLayers);
                node.properties.image_order = imageOrder;
                node.properties.state_version = (node.properties.state_version || 0) + 1;
                node.setProperty("image_order", imageOrder);
                node.widgets_values = [JSON.stringify(imageOrder.filter((_, i) => enabledLayers[i]))];
                debouncedUpdateCardList();
                app.graph.setDirtyCanvas(true, true);
            } catch (e) {
                log.error(`Failed to parse image_order: ${e}`);
                statusText.innerText = "Failed to parse image order";
                statusText.style.color = "#F55";
            }
        }, { serialize: true });

        const reverseWidget = node.addWidget("toggle", "reverse_list", isReversed, (value) => {
            isReversed = value;
            node.properties.is_reversed = isReversed;
            node.properties.state_version = (node.properties.state_version || 0) + 1;
            node.setProperty("is_reversed", isReversed);
            debouncedUpdateCardList();
            app.graph.setDirtyCanvas(true, true);
        }, { label: "Reverse Display", serialize: true });

        const singleModeWidget = node.addWidget("toggle", "single_mode", isSingleMode, (value) => {
            isSingleMode = value;
            node.properties.is_single_mode = isSingleMode;
            node.properties.state_version = (node.properties.state_version || 0) + 1;
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
            }
            debouncedUpdateCardList();
            app.graph.setDirtyCanvas(true, true);
            log.info(`Single mode toggled: ${isSingleMode}`);
        }, { label: "Single Selection Mode", serialize: true });

        const resetButtonWidget = node.addWidget("button", "reset_order", "Reset Order", () => {
            imageOrder = [...Array(imagePreviews.length).keys()];
            node.properties.image_order = imageOrder;
            node.properties.state_version = (node.properties.state_version || 0) + 1;
            const enabledOrder = imageOrder.filter((idx, i) => enabledLayers[idx]);
            orderWidget.value = JSON.stringify(enabledOrder);
            node.widgets_values = [JSON.stringify(enabledOrder)];
            debouncedUpdateCardList();
            app.graph.setDirtyCanvas(true, true);
            log.info(`Reset image order to: ${imageOrder}`);
        }, { label: "Reset Order", serialize: false });

        /**
         * Updates container height based on node size.
         */
        function updateContainerHeight() {
            const nodeHeight = node.size[1];
            const nodeWidth = node.size[0];
            const headerHeight = header.offsetHeight || 30;
            // Use saved margin or default to 50, adjusted for 8px bottom padding
            const marginOffset = node.properties?.margin_offset || 50;
            // Account for 8px top + bottom padding in .xiser-reorder-container
            const availableHeight = nodeHeight - headerHeight - marginOffset - 70; // 70 = 8px top + 8px bottom + 4px border
            // Account for 8px left + right padding
            const availableWidth = nodeWidth - 20; // 20 = 8px left + 8px right + 4px border
            mainContainer.style.height = `${Math.max(availableHeight, 100)}px`;
            mainContainer.style.width = `${Math.max(availableWidth, 332)}px`; // Match min-width
            cardContainer.style.height = `${Math.max(availableHeight - headerHeight, 60)}px`;
            // Save margin_offset
            node.properties.margin_offset = marginOffset;
            node.setProperty("margin_offset", marginOffset);
            log.info(`Updated container dimensions to ${mainContainer.style.width}x${mainContainer.style.height} for node ${nodeId}, margin_offset: ${marginOffset}`);
        }

        /**
         * Updates card list UI and sortable behavior.
         */
        let sortableInstance = null;
        function updateCardList() {
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
                enabledLayers = Array(imagePreviews.length).fill(true);
                node.properties.enabled_layers = enabledLayers;
            }

            imageOrder = validateImageOrder(imageOrder, imagePreviews, enabledLayers);
            node.properties.image_order = imageOrder;
            node.properties.state_version = (node.properties.state_version || 0) + 1;

            const enabledOrder = imageOrder.filter((idx, i) => enabledLayers[idx]);
            orderWidget.value = JSON.stringify(enabledOrder);
            node.widgets_values = [JSON.stringify(enabledOrder)];

            const orderedPreviews = imageOrder.map(idx => {
                const preview = imagePreviews.find(p => p.index === idx);
                if (!preview) {
                    log.error(`No preview for index ${idx}`);
                    return null;
                }
                return { ...preview, enabled: enabledLayers[idx] };
            }).filter(p => p !== null);

            if (orderedPreviews.length !== imagePreviews.length) {
                log.error("Incomplete orderedPreviews, resetting");
                imageOrder = [...Array(imagePreviews.length).keys()];
                enabledLayers = Array(imagePreviews.length).fill(true);
                node.properties.image_order = imageOrder;
                node.properties.enabled_layers = enabledLayers;
                orderWidget.value = JSON.stringify(imageOrder.filter((idx, i) => enabledLayers[idx]));
                node.widgets_values = [JSON.stringify(imageOrder.filter((idx, i) => enabledLayers[idx]))];
                imagePreviews = imagePreviews.map((p, i) => ({ ...p, index: i }));
            }

            const displayPreviews = isReversed ? [...orderedPreviews].reverse() : orderedPreviews;
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
                if (!preview.enabled) {
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
                    info.innerText = `Layer ${layerNumber} | Size: ${preview.width}x${preview.height}`;
                    enabledIndex++;
                } else {
                    info.innerText = `Disabled | Size: ${preview.width}x${preview.height}`;
                }
                card.appendChild(info);

                const toggle = document.createElement("input");
                toggle.type = "checkbox";
                toggle.className = "xiser-reorder-layer-toggle";
                toggle.checked = preview.enabled;
                toggle.disabled = imagePreviews.length <= 1;
                if (imagePreviews.length <= 1 && !preview.enabled) {
                    // Ensure single image is always enabled
                    enabledLayers[preview.index] = true;
                    toggle.checked = true;
                    node.properties.enabled_layers = enabledLayers;
                    node.properties.state_version = (node.properties.state_version || 0) + 1;
                }
                toggle.addEventListener("change", () => {
                    if (isSingleMode) {
                        enabledLayers = Array(imagePreviews.length).fill(false);
                        enabledLayers[preview.index] = toggle.checked;
                    } else {
                        enabledLayers[preview.index] = toggle.checked;
                    }
                    if (imagePreviews.length <= 1) {
                        // Prevent disabling the only image
                        enabledLayers[preview.index] = true;
                        toggle.checked = true;
                    }
                    node.properties.enabled_layers = enabledLayers;
                    node.properties.state_version = (node.properties.state_version || 0) + 1;
                    debouncedUpdateCardList();
                    app.graph.setDirtyCanvas(true, true);
                    log.info(`Layer ${preview.index} enabled: ${toggle.checked}`);
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
                    group: `xiser-reorder-${nodeId}`, // Unique group per node
                    onEnd: (evt) => {
                        const oldIndex = evt.oldIndex;
                        const newIndex = evt.newIndex;
                        log.info(`Sortable event for node ${nodeId}:`, { oldIndex, newIndex });

                        const newDomOrder = Array.from(cardContainer.children).map(card => parseInt(card.dataset.index));
                        const displayOrder = isReversed ? newDomOrder.reverse() : newDomOrder;
                        const enabledIndices = displayOrder.filter(idx => enabledLayers[idx]);
                        const disabledIndices = imageOrder.filter(idx => !enabledLayers[idx]);
                        imageOrder = [...enabledIndices, ...disabledIndices];
                        imageOrder = validateImageOrder(imageOrder, imagePreviews, enabledLayers);
                        node.properties.image_order = imageOrder;
                        node.properties.state_version = (node.properties.state_version || 0) + 1;
                        const enabledOrder = imageOrder.filter((idx, i) => enabledLayers[idx]);
                        orderWidget.value = JSON.stringify(enabledOrder);
                        node.widgets_values = [JSON.stringify(enabledOrder)];
                        node.setProperty("image_order", imageOrder);

                        app.graph.setDirtyCanvas(true, true);
                        log.info(`Image order updated: ${imageOrder}`);
                        debouncedUpdateCardList();
                    }
                });
            } else if (!window.Sortable) {
                statusText.innerText = "Error: Sortable.js not loaded";
                statusText.style.color = "#F55";
            } else {
                statusText.innerText = imagePreviews.length === 0 ? "No images to sort" : "Single image, no sorting needed";
                statusText.style.color = "#F55";
            }

            if (imagePreviews.length <= 50) {
                statusText.innerText = imagePreviews.length > 0 ? `Loaded ${imagePreviews.length} images (${enabledLayers.filter(x => x).length} enabled)` : "Waiting for images...";
                statusText.style.color = imagePreviews.length > 0 ? "#2ECC71" : "#F5F6F5";
            }
        }

        const debouncedUpdateCardList = debounce(updateCardList, 300);

        node.addDOMWidget("reorder", "Image Reorder", mainContainer, {
            serialize: true,
            getValue() {
                return {
                    image_previews: imagePreviews.map(p => ({ index: p.index, width: p.width, height: p.height })),
                    image_order: imageOrder,
                    is_reversed: isReversed,
                    enabled_layers: enabledLayers,
                    is_single_mode: isSingleMode,
                    node_size: [node.size[0], node.size[1]],
                    state_version: [node.properties.state_version || 0] // Wrapped in array
                };
            },
            setValue(value) {
                try {
                    // Extract state_version from array
                    const receivedVersion = Array.isArray(value.state_version) ? value.state_version[0] || 0 : value.state_version || 0;
                    if (receivedVersion && receivedVersion < stateVersion) {
                        log.warning(`Outdated state version: ${receivedVersion}, current: ${stateVersion}`);
                        return;
                    }
                    imagePreviews = value.image_previews || imagePreviews;
                    const newOrder = value.image_order && Array.isArray(value.image_order) 
                        ? value.image_order.filter(idx => Number.isInteger(idx) && idx >= 0 && idx < imagePreviews.length) 
                        : (imagePreviews.length > 0 ? [...Array(imagePreviews.length).keys()] : []);
                    imageOrder = validateImageOrder(newOrder, imagePreviews, enabledLayers);
                    isReversed = value.is_reversed ?? isReversed;
                    enabledLayers = value.enabled_layers && Array.isArray(value.enabled_layers) && value.enabled_layers.length === imagePreviews.length 
                        ? value.enabled_layers 
                        : Array(imagePreviews.length).fill(true);
                    isSingleMode = value.is_single_mode ?? isSingleMode;
                    if (isSingleMode) {
                        const enabledIndex = enabledLayers.findIndex(x => x);
                        enabledLayers = Array(imagePreviews.length).fill(false);
                        if (enabledIndex !== -1) {
                            enabledLayers[enabledIndex] = true;
                        } else if (imagePreviews.length > 0) {
                            enabledLayers[0] = true;
                        }
                    }
                    node.properties.image_previews = imagePreviews;
                    node.properties.image_order = imageOrder;
                    node.properties.is_reversed = isReversed;
                    node.properties.enabled_layers = enabledLayers;
                    node.properties.is_single_mode = isSingleMode;
                    node.properties.state_version = receivedVersion + 1;
                    orderWidget.value = JSON.stringify(imageOrder.filter((idx, i) => enabledLayers[idx]));
                    node.widgets_values = [JSON.stringify(imageOrder.filter((idx, i) => enabledLayers[idx]))];
                    reverseWidget.value = isReversed;
                    singleModeWidget.value = isSingleMode;

                    if (value.node_size && Array.isArray(value.node_size) && value.node_size.length === 2) {
                        const [width, height] = value.node_size;
                        node.setSize([Math.max(width, 360), Math.max(height, MIN_NODE_HEIGHT)]);
                    }

                    debouncedUpdateCardList();
                    app.graph.setDirtyCanvas(true, true);
                    log.info(`Restored state for node ${nodeId}:`, { imageOrder, is_reversed: isReversed, enabledLayers, isSingleMode });
                } catch (e) {
                    log.error(`Error in setValue for node ${nodeId}: ${e}`);
                    statusText.innerText = "Failed to set image order";
                    statusText.style.color = "#F55";
                }
            }
        });

        // Initialize node size
        const savedSize = node.properties?.node_size;
        const savedMargin = node.properties?.margin_offset || 50; // Default margin
        if (savedSize && Array.isArray(savedSize) && savedSize.length === 2) {
            const [width, height] = savedSize;
            node.setSize([Math.max(width, 360), Math.max(height, MIN_NODE_HEIGHT)]);
            node.properties.margin_offset = savedMargin;
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
            // Ensure margin_offset is preserved
            node.properties.margin_offset = node.properties.margin_offset || 50;
            node.setProperty("margin_offset", node.properties.margin_offset);
            updateContainerHeight();
            log.info(`Node ${nodeId} resized to: ${size[0]}x${size[1]}, margin_offset: ${node.properties.margin_offset}`);
        };

        node.onExecuted = function (message) {
            if (message && message.image_previews && message.image_order) {
                const newPreviews = message.image_previews.map((p, i) => ({ ...p, index: i }));
                const prevImageCount = imagePreviews.length;
                const imageCountChanged = prevImageCount !== newPreviews.length;

                if (imageCountChanged) {
                    log.info(`Image count changed from ${prevImageCount} to ${newPreviews.length}`);
                    imagePreviews = newPreviews;
                    imageOrder = [...Array(newPreviews.length).keys()];
                    enabledLayers = isSingleMode
                        ? [true, ...Array(newPreviews.length - 1).fill(false)]
                        : Array(newPreviews.length).fill(true);
                } else {
                    imagePreviews = newPreviews;
                    imageOrder = validateImageOrder(imageOrder, imagePreviews, enabledLayers);
                    enabledLayers = enabledLayers.length === imagePreviews.length
                        ? enabledLayers
                        : (isSingleMode
                            ? [true, ...Array(newPreviews.length - 1).fill(false)]
                            : Array(newPreviews.length).fill(true));
                    if (isSingleMode) {
                        const enabledIndex = enabledLayers.findIndex(x => x);
                        enabledLayers = Array(imagePreviews.length).fill(false);
                        if (enabledIndex !== -1) {
                            enabledLayers[enabledIndex] = true;
                        } else if (imagePreviews.length > 0) {
                            enabledLayers[0] = true;
                        }
                    }
                }

                node.properties.image_previews = imagePreviews;
                node.properties.image_order = imageOrder;
                node.properties.enabled_layers = enabledLayers;
                node.properties.is_single_mode = isSingleMode;
                node.properties.state_version = Array.isArray(message.state_version) ? (message.state_version[0] || 0) + 1 : (message.state_version || 0) + 1;
                orderWidget.value = JSON.stringify(imageOrder.filter((idx, i) => enabledLayers[idx]));
                node.widgets_values = [JSON.stringify(imageOrder.filter((idx, i) => enabledLayers[idx]))];
                debouncedUpdateCardList();
                log.info(`Node ${nodeId} executed, imageOrder: ${imageOrder}`);
            } else {
                statusText.innerText = "No valid image data";
                statusText.style.color = "#F55";
                log.error(`No valid image previews or order for node ${nodeId}`);
            }
        };

        node.onRemoved = () => {
            if (sortableInstance) {
                sortableInstance.destroy();
            }
            mainContainer.remove();
            document.querySelectorAll(`.xiser-reorder-container[data-nodeId="${nodeId}"]`).forEach(c => c.remove());
            log.info(`Node ${nodeId} removed, resources cleaned`);
        };

        imageOrder = validateImageOrder(imageOrder, imagePreviews, enabledLayers);
        enabledLayers = enabledLayers.length === imagePreviews.length
            ? enabledLayers
            : (isSingleMode
                ? [true, ...Array(imagePreviews.length - 1).fill(false)]
                : Array(imagePreviews.length).fill(true));
        if (isSingleMode && imagePreviews.length > 0 && !enabledLayers.includes(true)) {
            enabledLayers[0] = true;
        }
        node.properties.enabled_layers = enabledLayers;
        node.properties.is_single_mode = isSingleMode;
        node.properties.state_version = (node.properties.state_version || 0) + 1;
        orderWidget.value = JSON.stringify(imageOrder.filter((idx, i) => enabledLayers[idx]));
        node.widgets_values = [JSON.stringify(imageOrder.filter((idx, i) => enabledLayers[idx]))];
        updateCardList();
    }
});