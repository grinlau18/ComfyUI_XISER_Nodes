/**
 * 标签节点模块主入口
 */
import { app } from "/scripts/app.js";
import { logger, setLogLevel } from './core/logger.js';
import { loadCodeMirrorResources, loadMarkedResources } from './core/resource_loader.js';
import { EDITOR_MODES, DEFAULT_COLOR, DEFAULT_NODE_SIZE } from './core/constants.js';
import { ParserManager } from './parser/parser_manager.js';
import { EditorManager } from './editor/editor_manager.js';
import { TextRenderer } from './renderer/text_renderer.js';
import { StyleManager } from './renderer/style_manager.js';
import { debounce } from './utils/debounce.js';
import { createModal, createButton, createEditorStyles, createEditorHeaderControls } from './utils/dom_utils.js';

const SCROLL_MARGIN = 20;
const TITLE_OFFSET = 30;
const MIN_VIEWPORT_HEIGHT = 120;
const SCROLL_STEP = 16;
const SCROLLBAR_MIN_THUMB = 24;

let wheelHandlerAttached = false;
let wheelAttachInterval = null;
let scrollDragState = null;

function cancelEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
}

function normalizeNodeSize(value) {
    if (!Array.isArray(value) || value.length < 2) {
        return [...DEFAULT_NODE_SIZE];
    }
    const width = Math.max(120, Number(value[0]) || DEFAULT_NODE_SIZE[0]);
    const height = Math.max(120, Number(value[1]) || DEFAULT_NODE_SIZE[1]);
    return [width, height];
}

function ensureDefaultNodeSize(node) {
    const storedSize = node.properties?.node_size;
    const fallbackSize = Array.isArray(node.size) && node.size.length === 2
        ? node.size
        : DEFAULT_NODE_SIZE;
    const targetSize = normalizeNodeSize(storedSize || fallbackSize);
    node.properties = node.properties || {};

    // 只有在没有设置节点大小时才设置默认大小
    // 避免在复制节点时覆盖已继承的大小
    if (!node.properties.node_size || !Array.isArray(node.properties.node_size) || node.properties.node_size.length !== 2) {
        node.properties.node_size = targetSize;
        node.setSize([...targetSize]);
    } else {
        // 如果已经有节点大小，确保使用正确的大小
        const normalizedSize = normalizeNodeSize(node.properties.node_size);
        node.setSize([...normalizedSize]);
    }

    node.properties.htmlData = node.properties.htmlData || parserManager.getDefaultText(EDITOR_MODES.HTML);
    node.properties.markdownData = node.properties.markdownData || parserManager.getDefaultText(EDITOR_MODES.MARKDOWN);
}

function handleGlobalWheel(event) {
    try {
        const graphCanvas = app.canvas;
        if (!graphCanvas) return;
        const node = graphCanvas.node_over;
        if (!node) return;
        if (node.type !== "XIS_Label" && node.name !== "XIS_Label") return;

        const viewportHeight =
            node.properties?.scrollViewportHeight ||
            Math.max(node.size[1] + TITLE_OFFSET - SCROLL_MARGIN * 2, MIN_VIEWPORT_HEIGHT);
        const contentHeight = node.properties?.scrollContentHeight || viewportHeight;
        const maxScroll = Math.max(contentHeight - viewportHeight, 0);
        if (maxScroll <= 0) return;

        const delta = event.deltaY ?? -event.wheelDelta ?? 0;
        if (!delta) return;
        const step = Math.sign(delta) * SCROLL_STEP;
        if (!step) return;

        const currentOffset = node.properties?.scrollOffset || 0;
        const newOffset = Math.min(maxScroll, Math.max(0, currentOffset + step));
        if (newOffset === currentOffset) {
            cancelEvent(event);
            return;
        }

        node.properties.scrollOffset = newOffset;
        graphCanvas.setDirty(true, false);
        cancelEvent(event);
    } catch (e) {
        logger.error("Wheel scroll handler failed:", e);
    }
}

function handlePointerDown(event) {
    const graphCanvas = app.canvas;
    if (!graphCanvas?.canvas) return;
    graphCanvas.adjustMouseEvent(event);
    const node = graphCanvas.node_over;
    if (!node) return;
    if (node.type !== "XIS_Label" && node.name !== "XIS_Label") return;
    const scrollbarActive = node.properties?.scrollbarActive;
    if (!scrollbarActive) return;

    const viewportHeight =
        node.properties?.scrollViewportHeight ||
        Math.max(node.size[1] + TITLE_OFFSET - SCROLL_MARGIN * 2, MIN_VIEWPORT_HEIGHT);
    const contentHeight = node.properties?.scrollContentHeight || viewportHeight;
    const maxScroll = Math.max(contentHeight - viewportHeight, 0);
    if (maxScroll <= 0) return;

    const rect = node.properties?.scrollbarRect;
    const localX = event.canvasX - node.pos[0];
    const localY = event.canvasY - node.pos[1];
    if (!rect) {
        return;
    }
    if (localX < rect.x || localX > rect.x + rect.width || localY < rect.y || localY > rect.y + rect.height) {
        return;
    }

    const scrollableTrack = Math.max(rect.height - (rect.thumbHeight || SCROLLBAR_MIN_THUMB), 1);

    scrollDragState = {
        node,
        startY: event.canvasY,
        startOffset: node.properties.scrollOffset || 0,
        scrollableTrack,
        maxScroll
    };
    scrollDragState.pointerId = event.pointerId;

    if (event.pointerId && graphCanvas.canvas.setPointerCapture) {
        graphCanvas.canvas.setPointerCapture(event.pointerId);
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
}

function handlePointerMove(event) {
    if (!scrollDragState) return;
    const graphCanvas = app.canvas;
    if (!graphCanvas?.canvas) return;
    graphCanvas.adjustMouseEvent(event);

    cancelEvent(event);

    const { node, startY, startOffset, scrollableTrack, maxScroll } = scrollDragState;
    if (!node || maxScroll <= 0) return;

    const deltaY = event.canvasY - startY;
    const scrollDelta = (deltaY / scrollableTrack) * maxScroll;
    const newOffset = Math.min(maxScroll, Math.max(0, startOffset + scrollDelta));

    const currentOffset = node.properties?.scrollOffset || 0;
    if (Math.abs(newOffset - currentOffset) < 0.5) return;

    node.properties.scrollOffset = newOffset;
    graphCanvas.setDirty(true, false);
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
}

function handlePointerUp() {
    if (scrollDragState?.pointerId && app.canvas?.canvas?.releasePointerCapture) {
        app.canvas.canvas.releasePointerCapture(scrollDragState.pointerId);
    }
    scrollDragState = null;
}

function ensureWheelHandler() {
    if (wheelHandlerAttached) {
        return;
    }

    const graphCanvas = app.canvas;
    if (graphCanvas?.canvas) {
        const canvasElement = graphCanvas.canvas;
        canvasElement.addEventListener("wheel", handleGlobalWheel, { passive: false, capture: true });
        canvasElement.addEventListener("pointerdown", handlePointerDown, { passive: false, capture: true });
        canvasElement.addEventListener("pointermove", handlePointerMove, { passive: false, capture: true });
        canvasElement.addEventListener("pointerup", handlePointerUp, { passive: false, capture: true });
        canvasElement.addEventListener("pointercancel", handlePointerUp, { passive: false, capture: true });
        wheelHandlerAttached = true;
        if (wheelAttachInterval) {
            clearInterval(wheelAttachInterval);
            wheelAttachInterval = null;
        }
    } else if (!wheelAttachInterval) {
        wheelAttachInterval = setInterval(ensureWheelHandler, 500);
    }
}

// Global instances
let parserManager = null;
let editorManager = null;
let textRenderer = null;
let styleManager = null;

/**
 * Initializes the label module.
 */
function initializeModule() {
    parserManager = new ParserManager();
    editorManager = new EditorManager();
    textRenderer = new TextRenderer();
    styleManager = new StyleManager();

    logger.info("Label module initialized");
}

/**
 * Sets up the XIS_Label node.
 */
function setupLabelNode() {
    app.registerExtension({
        name: "ComfyUI.XISER.Label",
        async setup() {
            try {
                setLogLevel(window.XISER_CONFIG?.logLevel || 2);
                await loadCodeMirrorResources();
                await loadMarkedResources();
                initializeModule();
                ensureWheelHandler();
                logger.info("XIS_Label extension setup completed");
            } catch (e) {
                logger.error("Failed to load resources, node may be unavailable", e);
            }
        },
        async beforeRegisterNodeDef(nodeType, nodeData, app) {
            if (nodeData.name !== "XIS_Label") return;

            // Cache for fonts to improve performance
            const fontCache = new Map();

            /**
             * Renders the node's foreground.
             */
            nodeType.prototype.onDrawForeground = function (ctx) {
                try {
                    if (!this.properties.parsedTextData) {
                        const currentMode = this.properties.editorMode || EDITOR_MODES.HTML;
                        const sourceData = this.properties?.[currentMode === EDITOR_MODES.HTML ? "htmlData" : "markdownData"];
                        this.properties.parsedTextData = parserManager.parse(
                            sourceData,
                            currentMode
                        );
                    }

                    const textData = this.properties.parsedTextData;
                    const nodeStyles = styleManager.getNodeStyles(this);

                    textRenderer.render(ctx, textData, this, nodeStyles);
                } catch (e) {
                    logger.error("Error rendering node foreground:", e);
                }
            };

            /**
             * Handles node mode changes.
             */
            nodeType.prototype.onModeChange = function (newMode, oldMode) {
                this.setDirtyCanvas(true, false);
                app.canvas.setDirty(true);
                logger.debug(`Mode changed from ${oldMode} to ${newMode}`);
            };
            
            /**
             * Handles property changes.
             */
            nodeType.prototype.onPropertyChanged = debounce(function (property, value) {
                if (property === "color" && value) {
                    this.properties.color = value;
                    parserManager.updateBackground(
                        this,
                        value,
                        this.properties.editorMode || EDITOR_MODES.HTML
                    );
                    this.setDirtyCanvas(true, false);
                    app.canvas.setDirty(true);
                    logger.info(`Property changed: ${property} = ${value}`);
                }
                return true;
            }, 100);

            /**
             * Ensures node is redrawn after being added.
             * Only ensures default size if node doesn't already have a valid size.
             */
            nodeType.prototype.onAdded = function () {
                // Only ensure default size if the node doesn't already have a valid size
                if (!this.properties?.node_size || !Array.isArray(this.properties.node_size) || this.properties.node_size.length !== 2) {
                    ensureDefaultNodeSize(this);
                }
                this.setDirtyCanvas(true, false);
            };

            /**
             * Tracks size adjustments so clones keep the same dimensions.
             */
            nodeType.prototype.onResize = function (size) {
                if (!Array.isArray(size) || size.length < 2) {
                    return;
                }
                const normalizedSize = normalizeNodeSize(size);
                this.properties = this.properties || {};
                this.properties.node_size = [...normalizedSize];
            };

            const originalClone = nodeType.prototype.clone;
            nodeType.prototype.clone = function () {
                const cloned = originalClone?.apply(this, arguments) ??
                    LiteGraph?.LGraphNode?.prototype?.clone?.apply(this, arguments);
                if (cloned) {
                    const sourceSize = this.properties?.node_size?.length === 2
                        ? this.properties.node_size
                        : this.size;
                    if (Array.isArray(sourceSize) && sourceSize.length === 2) {
                        const normalizedSize = normalizeNodeSize(sourceSize);
                        cloned.properties = cloned.properties || {};
                        cloned.properties.node_size = [...normalizedSize];
                    }
                    logger.info(`[XIS_Label] clone ${this.id} -> ${cloned.id} size=${sourceSize?.join("x")}`);
                }
                return cloned;
            };

            nodeType.prototype.onDblClick = function () {
                openTextEditor(this);
            };

            const originalOnMouseDown = nodeType.prototype.onMouseDown;
            nodeType.prototype.onMouseDown = function (event, localPos, graphCanvas) {
                const handled = originalOnMouseDown?.call(this, event, localPos, graphCanvas);
                if (handled === true) {
                    return true;
                }
                if (!localPos || !Array.isArray(localPos)) {
                    return handled;
                }
                const [x, y] = localPos;
                const hitboxes = this.properties?.linkHitboxes;
                if (!Array.isArray(hitboxes) || !hitboxes.length) {
                    return handled;
                }
                const target = hitboxes.find((box) => x >= box.x1 && x <= box.x2 && y >= box.y1 && y <= box.y2);
                if (target?.href) {
                    const openTarget = event?.ctrlKey ? "_self" : "_blank";
                    window.open(target.href, openTarget);
                    return true;
                }
                return handled;
            };

            /**
             * Serializes node data, excluding cached parsed data.
             */
            nodeType.prototype.serialize = function () {
                const data = LiteGraph.LGraphNode.prototype.serialize.call(this);
                delete data.properties.parsedTextData;
                return data;
            };

            /**
             * Adds a right-click menu option to edit text with a modal editor.
             */
            nodeType.prototype.getExtraMenuOptions = function (graphCanvas, options) {
                options.push({
                    content: "编辑文本",
                    callback: async () => {
                        await openTextEditor(this);
                    }
                });
            };
        },
    });
}

/**
 * Opens the text editor modal.
 * @param {Object} node - The node object.
 */
async function openTextEditor(node) {
    try {
        const modal = createModal();
        const editorDiv = document.createElement("div");
        editorDiv.className = "editor-content-area";

        const currentMode = node.properties.editorMode || EDITOR_MODES.HTML;
        const headerBar = document.createElement("div");
        headerBar.className = "editor-top-bar";

        const handleColorChange = (newColor) => {
            node.properties.color = newColor;
            node.color = newColor;
            parserManager.updateBackground(
                node,
                newColor,
                node.properties.editorMode || EDITOR_MODES.HTML
            );
            node.setDirtyCanvas(true, false);
            app.canvas.setDirty(true);
            logger.info(`Background color updated: ${newColor}`);
        };

        let headerControlsRef = null;

        const handleModeChange = (mode) => {
            switchEditorMode(mode, node, editorDiv, headerControlsRef);
        };

        const handleTextScale = (value) => {
            node.properties.textScalePercent = value;
            node.setDirtyCanvas(true, false);
            app.canvas.setDirty(true);
        };

        headerControlsRef = createEditorHeaderControls({
            mode: currentMode,
            color: node.properties.color || node.color || DEFAULT_COLOR,
            textScalePercent: node.properties.textScalePercent ?? 50,
            onModeChange: handleModeChange,
            onColorChange: handleColorChange,
            onTextScaleChange: handleTextScale
        });

        const headerControls = headerControlsRef;

        headerBar.appendChild(headerControls.headerLeft);
        headerBar.appendChild(headerControls.headerRight);

        enableModalDrag(modal, headerBar);

        const buttonDiv = document.createElement("div");
        buttonDiv.className = "editor-footer";

        const saveButton = createButton({
            text: "保存",
            className: "save-button"
        });

        const cancelButton = createButton({
            text: "取消",
            className: "cancel-button"
        });

        buttonDiv.appendChild(saveButton);
        buttonDiv.appendChild(cancelButton);

        modal.appendChild(headerBar);
        modal.appendChild(editorDiv);
        modal.appendChild(buttonDiv);

        const style = createEditorStyles();
        document.head.appendChild(style);
        document.body.appendChild(modal);

        // Get initial text based on current mode
        if (!node.properties) node.properties = {};
        if (!node.properties.htmlData) {
            node.properties.htmlData = parserManager.getDefaultText(EDITOR_MODES.HTML);
        }
        if (!node.properties.markdownData) {
            node.properties.markdownData = parserManager.getDefaultText(EDITOR_MODES.MARKDOWN);
        }
        const initialText = node.properties?.[currentMode === EDITOR_MODES.HTML ? "htmlData" : "markdownData"] ||
            parserManager.getDefaultText(currentMode);

        // Ensure CodeMirror mode resources
        await loadCodeMirrorResources(currentMode);
        // Create editor
        await editorManager.createEditor(currentMode, editorDiv, initialText);

        // Mode switch handlers
        const saveHandler = () => {
            try {
                const newText = editorManager.getValue();
                const currentMode = editorManager.getCurrentMode();

                parserManager.update(node, newText, currentMode);
                node.properties.editorMode = currentMode;
                node.setDirtyCanvas(true, false);

                cleanupModal(modal, style);
                logger.info("Text saved and node updated");
            } catch (e) {
                logger.error("Error saving text:", e);
            }
        };

        const cancelHandler = () => {
            cleanupModal(modal, style);
            logger.info("Edit cancelled");
        };

        saveButton.onclick = saveHandler;
        cancelButton.onclick = cancelHandler;

        modal.addEventListener("keydown", (e) => {
            if (e.key === "Escape") cancelHandler();
        });

    } catch (e) {
        logger.error("Error creating text editor modal:", e);
    }
}

/**
 * Switches editor mode.
 * @param {string} mode - The new editor mode.
 * @param {Object} node - The node object.
 * @param {HTMLElement} editorDiv - The editor container.
 */
async function switchEditorMode(mode, node, editorDiv, headerControls) {
    try {
        // Save current editor content to the appropriate data property
        const currentText = editorManager.getValue();
        const currentMode = editorManager.getCurrentMode();

        // Save current content before switching
        if (currentMode === EDITOR_MODES.HTML) {
            node.properties.htmlData = currentText;
        } else {
            node.properties.markdownData = currentText;
        }

        // Destroy current editor
        editorManager.destroy();

        // Clear editor container
        while (editorDiv.firstChild) {
            editorDiv.removeChild(editorDiv.firstChild);
        }

        // Get the text for the new mode (don't convert, use stored data)
        const newText = node.properties?.[mode === EDITOR_MODES.HTML ? "htmlData" : "markdownData"] ||
                       parserManager.getDefaultText(mode);

        // Ensure CodeMirror mode resources
        await loadCodeMirrorResources(mode);
        // Create new editor
        await editorManager.createEditor(mode, editorDiv, newText);

        // Update radio states
        headerControls?.updateValues({
            mode,
            color: node.properties.color || node.color || DEFAULT_COLOR,
            textScalePercent: node.properties.textScalePercent ?? 50
        });

        logger.info(`Editor mode switched to: ${mode}`);
    } catch (e) {
        logger.error("Error switching editor mode:", e);
    }
}

/**
 * Cleans up the modal and related resources.
 * @param {HTMLElement} modal - The modal element.
 * @param {HTMLElement} style - The style element.
 */
function cleanupModal(modal, style) {
    try {
        editorManager.destroy();
        document.body.removeChild(modal);
        if (style.parentNode) {
            document.head.removeChild(style);
        }
    } catch (e) {
        logger.error("Error cleaning up modal:", e);
    }
}

/**
 * Enables dragging the modal via a handle.
 * @param {HTMLElement} modal
 * @param {HTMLElement} handle
 */
function enableModalDrag(modal, handle) {
    let dragState = null;

    const startDrag = (event) => {
        if (event.button !== 0) return;
        const interactive = event.target.closest("button, input, label, .switch-label");
        if (interactive) return;

        const rect = modal.getBoundingClientRect();
        modal.style.left = `${rect.left}px`;
        modal.style.top = `${rect.top}px`;
        modal.style.transform = "none";
        modal.style.position = "fixed";
        modal.style.margin = "0";
        modal.style.right = "auto";

        dragState = {
            startX: event.clientX,
            startY: event.clientY,
            initialLeft: rect.left,
            initialTop: rect.top,
        };

        handle.setPointerCapture?.(event.pointerId);
        cancelEvent(event);
    };

    const onMove = (event) => {
        if (!dragState) return;
        const deltaX = event.clientX - dragState.startX;
        const deltaY = event.clientY - dragState.startY;
        modal.style.left = `${dragState.initialLeft + deltaX}px`;
        modal.style.top = `${dragState.initialTop + deltaY}px`;
        cancelEvent(event);
    };

    const endDrag = (event) => {
        if (!dragState) return;
        dragState = null;
        handle.releasePointerCapture?.(event.pointerId);
        cancelEvent(event);
    };

    handle.style.cursor = "grab";
    handle.addEventListener("pointerdown", startDrag);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
}

// Initialize the module when imported
setupLabelNode();

export {
    parserManager,
    editorManager,
    textRenderer,
    styleManager,
    EDITOR_MODES
};
