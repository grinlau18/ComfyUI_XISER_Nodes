/**
 * @fileoverview Main entry point for the XISER_Canvas ComfyUI extension, handling node lifecycle and UI/Konva integration.
 * @module canvas
 */

import { app } from '/scripts/app.js';
import { initializeUI } from './canvas/canvas_ui.js';
import { initializeKonva, selectLayer, deselectLayer, applyStates, destroyKonva, setupWheelEvents } from './canvas/canvas_konva.js';
import { loadImages, clearNodeCache } from './canvas/canvas_images.js';
import { setupLayerEventListeners, clearHistory, cleanupLayerEventListeners } from './canvas/canvas_history.js';
import { log, createNodeState, initializeCanvasProperties, debounce, throttle, cleanupNodeState, withAdjustmentDefaults } from './canvas/canvas_state.js';
import { initializeAdjustmentControls } from './canvas/canvas_adjust.js';
import { updateHistory, undo, redo, resetCanvas } from './canvas/canvas_history.js';
import {
  ensureLayerIds,
  layerIdOf,
  getLayerOrderList,
  mergeIncomingStates,
  persistImageStates,
  applyLayerOrder,
} from './canvas/layer_store.js';

// Layout padding applied around the Konva canvas so the node always fits its content
const NODE_HORIZONTAL_PADDING = 20; // Extra width so connectors/widgets have breathing room
const NODE_VERTICAL_PADDING = 256;  // Extra height for overlay UI (buttons, status text)
const MIN_NODE_WIDTH = 360;
const MIN_NODE_HEIGHT = 360;
const POLL_INTERVAL = 2000; // Polling interval for image updates (ms)

const normalizeStateArray = (states) => (Array.isArray(states) ? states.map((state) => withAdjustmentDefaults(state || {})) : []);

const createDefaultLayerState = (boardWidth, boardHeight, borderWidth) =>
  withAdjustmentDefaults({
    x: borderWidth + boardWidth / 2,
    y: borderWidth + boardHeight / 2,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    skewX: 0,
    skewY: 0,
    visible: true,
    filename: undefined,
    order: undefined,
  });

const deriveInitialStates = (imagePaths, rawStates, boardWidth, boardHeight, borderWidth) => {
  const normalized = normalizeStateArray(rawStates);
  if (!imagePaths?.length) return [];
  if (!normalized.length) {
    return imagePaths.map(() => createDefaultLayerState(boardWidth, boardHeight, borderWidth));
  }
  return imagePaths.map((_, index) => normalized[index] ?? createDefaultLayerState(boardWidth, boardHeight, borderWidth));
};

/**
 * Registers the XISER_Canvas extension with ComfyUI.
 */
app.registerExtension({
  name: 'xiser.canvas',
  /**
   * Sets up the extension, loads Konva.js, and overrides ComfyUI event handlers.
   * @async
   */
  async setup() {
    log.info('Extension loaded');

    // Polyfill for requestIdleCallback
    if (!window.requestIdleCallback) {
      window.requestIdleCallback = (callback) => setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 50 }), 1);
      window.cancelIdleCallback = (id) => clearTimeout(id);
    }

    // Load Konva.js
    if (!window.Konva) {
      try {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = '/extensions/ComfyUI_XISER_Nodes/lib/konva.min.js';
          script.onload = () => {
            log.info('Konva.js loaded successfully');
            if (!window.Konva) reject(new Error('Konva.js loaded but window.Konva is undefined'));
            else resolve();
          };
          script.onerror = () => {
            log.error('Failed to load Konva.js');
            reject(new Error('Konva.js load failed'));
          };
          document.head.appendChild(script);
        });
      } catch (e) {
        log.error('Setup failed due to Konva.js error', e);
        return;
      }
    }

    // Override onNodeExecuted
    const originalOnNodeExecuted = app.graph.onNodeExecuted || (() => {});
    app.graph.onNodeExecuted = function (node) {
      originalOnNodeExecuted.apply(this, arguments);
      if (node._onNodeExecuted) node._onNodeExecuted(node);
    };

    /**
     * Initializes a canvas node, setting up widgets, UI, and Konva stage.
     * @param {Object} node - The ComfyUI node instance.
     * @async
     */
    const initializeNode = async (node) => {
      if (node.comfyClass !== 'XISER_Canvas') return;
      if (node._isInitialized) {
        return;
      }
      node._isInitialized = true;

      // Disable manual resizing
      node.resizable = false;

      // Validate node ID
      if (!Number.isInteger(node.id) || node.id <= 0) {
        log.error(`Invalid node ID ${node.id} for XISER_Canvas node, initialization skipped`);
        return;
      }
      log.info(`Initializing node with ID: ${node.id}`);

      // Initialize node state
      const nodeId = node.id;
      const nodeState = createNodeState(nodeId, app);
      nodeState.firstImageDimensions = { width: 0, height: 0 };
      nodeState.imageNodes = [];
      nodeState.isInteracting = false;
      nodeState.file_data = null;
      nodeState.pollIntervalId = null;
      nodeState.lastAutoSize = null;
      nodeState.layoutRaf = null;
      nodeState.pendingLayout = null;
      node._state = nodeState;

      // Initialize canvas properties
      let { imagePaths, autoSize, boardWidth, boardHeight, borderWidth, canvasColor, borderColor, canvasColorValue, uiConfig } = initializeCanvasProperties(node, nodeState);

      // Sanitize uiConfig
      uiConfig.board_width = Math.min(Math.max(parseInt(uiConfig.board_width) || 1024, 256), 8192);
      uiConfig.board_height = Math.min(Math.max(parseInt(uiConfig.board_height) || 1024, 256), 8192);
      uiConfig.border_width = Math.min(Math.max(parseInt(uiConfig.border_width) || 120, 10), 200);
      uiConfig.canvas_color = ['black', 'white', 'transparent'].includes(uiConfig.canvas_color) ? uiConfig.canvas_color : 'black';
      uiConfig.auto_size = ['off', 'on'].includes(uiConfig.auto_size) ? uiConfig.auto_size : 'off';
      uiConfig.display_scale = Math.min(Math.max(parseFloat(uiConfig.display_scale) || 0.5, 0.1), 1);
      node.setProperty('ui_config', uiConfig);
      nodeState.lastAutoSize = uiConfig.auto_size;

      // Sanitize imagePaths
      imagePaths = Array.isArray(imagePaths) ? imagePaths.filter(p => typeof p === 'string' && p.trim().length > 0) : [];
      node.properties.ui_config.image_paths = imagePaths;
      nodeState.lastImagePaths = imagePaths.slice();

      // Add node-specific styles
      const style = document.createElement('style');
      style.dataset.nodeId = nodeId;
      style.textContent = `
        .xiser-main-container-${nodeId} {
          display: flex;
          flex-direction: column;
          box-sizing: border-box;
          overflow: visible;
        }
        .xiser-canvas-container-${nodeId} {
          display: block;
          position: relative;
          overflow: visible;
          flex: 0 0 auto;
        }
      `;
      document.head.appendChild(style);

      // Create containers
      const widgetContainer = document.createElement('div');
      widgetContainer.className = `xiser-canvas-container-${nodeId}`;
      widgetContainer.style.display = 'block';
      widgetContainer.style.position = 'relative';
      widgetContainer.style.pointerEvents = 'auto';
      widgetContainer.style.margin = '0';
      widgetContainer.style.alignSelf = 'flex-start';

      const mainContainer = document.createElement('div');
      mainContainer.className = `xiser-main-container-${nodeId}`;
      mainContainer.style.display = 'flex';
      mainContainer.style.flexDirection = 'column';
      mainContainer.style.pointerEvents = 'none';
      mainContainer.appendChild(widgetContainer);

      // Initialize UI
      const uiElements = initializeUI(node, nodeState, widgetContainer);
      const { statusText, layerPanel, modal } = uiElements;

      // Initialize Konva stage
      const konvaElements = initializeKonva(node, nodeState, widgetContainer, boardWidth, boardHeight, borderWidth, canvasColorValue, borderColor);
      Object.assign(nodeState, konvaElements);

      const adjustments = initializeAdjustmentControls(node, nodeState, widgetContainer);
      if (adjustments) {
        nodeState.adjustments = adjustments;
        nodeState.applyLayerAdjustments = (index) => adjustments.applyStoredAdjustments(index);
      }

      // Initialize layer states
      nodeState.initialStates = normalizeStateArray(node.properties.image_states);

      // Create debounced loadImages function
      const debouncedLoadImages = debounce(loadImages, 500);

      // Handle node collapse/expand
      const originalCollapse = node.collapse;
      node.collapse = function () {
        originalCollapse.apply(this, arguments);
        if (node.collapsed) {
          mainContainer.style.display = 'none';
          if (modal) modal.style.display = 'none';
        } else {
          mainContainer.style.display = 'flex';
          if (modal) modal.style.display = nodeState.modalVisible ? 'flex' : 'none';
        }
      };

      const buildWidgetValueMap = () => {
        const map = new Map();
        const getValue = (widget, fallback) =>
          widget && widget.value !== undefined && widget.value !== null ? widget.value : fallback;

        map.set('board_width', getValue(boardWidthWidget, node.properties?.ui_config?.board_width ?? boardWidth ?? 1024));
        map.set('board_height', getValue(boardHeightWidget, node.properties?.ui_config?.board_height ?? boardHeight ?? 1024));
        map.set('border_width', getValue(borderWidthWidget, node.properties?.ui_config?.border_width ?? borderWidth ?? 120));
        map.set('canvas_color', getValue(canvasColorWidget, node.properties?.ui_config?.canvas_color ?? canvasColorValue ?? 'black'));
        map.set('auto_size', getValue(autoSizeWidget, node.properties?.ui_config?.auto_size ?? autoSize ?? 'off'));
        map.set('display_scale', getValue(displayScaleWidget, node.properties?.ui_config?.display_scale ?? uiConfig.display_scale ?? 0.75));
        map.set('image_states', getValue(imageStatesWidget, JSON.stringify(nodeState.initialStates ?? [])));
        return map;
      };

      const syncWidgetValues = () => {
        if (!Array.isArray(node.widgets)) return;
        const widgetValueMap = buildWidgetValueMap();
        node.widgets_values = node.widgets.map((widget) => {
          if (!widget) return null;
          if (widgetValueMap.has(widget.name)) {
            return widgetValueMap.get(widget.name);
          }
          return widget.value;
        });
      };

      let applyLayerOrderBound = () => {};
      let persistImageStatesBound = () => {};

      const attachFilenamesToStates = () => {
        const filenames = Array.isArray(node.properties?.ui_config?.image_paths)
          ? node.properties.ui_config.image_paths
          : [];
        nodeState.initialStates = nodeState.initialStates.map((s, idx) => ({
          ...s,
          filename: s?.filename || filenames[idx],
          order: Number.isFinite(s?.order) ? s.order : idx,
        }));
      };

      const setLayerVisibility = (layerIndex, visible) => {
        const nodeRef = nodeState.imageNodes?.[layerIndex];
        if (!nodeRef || !nodeState.initialStates[layerIndex]) return;
        nodeRef.visible(visible);
        nodeState.initialStates[layerIndex] = withAdjustmentDefaults({
          ...nodeState.initialStates[layerIndex],
          visible,
        });
        nodeState.imageLayer?.batchDraw();
        uiElements.updateLayerPanel(selectLayer, deselectLayer, {
          onToggleVisibility: setLayerVisibility,
          onMoveLayer: moveLayer,
          onToggleLock: setLayerLock,
        });
      };

      const setLayerLock = (layerIndex, locked) => {
        const nodeRef = nodeState.imageNodes?.[layerIndex];
        if (!nodeRef || !nodeState.initialStates[layerIndex]) return;
        // 设置图层是否可被选中（锁定状态）
        nodeRef.listening(!locked);
        nodeState.initialStates[layerIndex] = withAdjustmentDefaults({
          ...nodeState.initialStates[layerIndex],
          locked,
        });
        nodeState.imageLayer?.batchDraw();
        uiElements.updateLayerPanel(selectLayer, deselectLayer, {
          onToggleVisibility: setLayerVisibility,
          onMoveLayer: moveLayer,
          onToggleLock: setLayerLock,
        });
        updateHistory(nodeState);
      };

      // 重新选中当前选中的图层，保持选中状态同步
      if (nodeState.selectedLayer) {
        const selectedIndex = nodeState.imageNodes.indexOf(nodeState.selectedLayer);
        if (selectedIndex !== -1) {
          selectLayer(nodeState, selectedIndex);
        }
      }

      persistImageStatesBound();
      updateHistory(nodeState, true);

      const moveLayer = (layerIndex, direction = 0) => {
        if (!Array.isArray(nodeState.imageNodes) || nodeState.imageNodes.length === 0) return;
        if (direction === 0) return;

        log.info(`Moving layer ${layerIndex} with direction ${direction}`);

        ensureLayerIds(node);
        const ordered = nodeState.initialStates
          .map((s, idx) => ({
            idx,
            order: Number.isFinite(s?.order) ? s.order : idx,
          }))
          .sort((a, b) => a.order - b.order);
        const currentPos = ordered.findIndex(item => item.idx === layerIndex);

        if (currentPos === -1) {
          log.warn(`Layer ${layerIndex} not found in order list`);
          return;
        }

        // direction > 0: move up (toward top, higher zIndex)
        const targetPos = direction > 0 ? currentPos + 1 : currentPos - 1;

        // 检查目标位置是否有效
        if (targetPos < 0 || targetPos >= ordered.length) {
          log.warn(`Cannot move layer ${layerIndex} to position ${targetPos}, out of bounds`);
          return;
        }

        const [moved] = ordered.splice(currentPos, 1);
        ordered.splice(targetPos, 0, moved);

        ordered.forEach((item, order) => {
          const state = nodeState.initialStates[item.idx];
          if (state) {
            state.order = order;
          }
        });

        applyLayerOrderBound();
        // 更新图层列表
        uiElements.updateLayerPanel(selectLayer, deselectLayer, {
          onToggleVisibility: setLayerVisibility,
          onMoveLayer: moveLayer,
          onToggleLock: setLayerLock,
        });

        // 重新选中当前选中的图层，保持选中状态同步
        if (nodeState.selectedLayer) {
          const selectedIndex = nodeState.imageNodes.indexOf(nodeState.selectedLayer);
          if (selectedIndex !== -1) {
            selectLayer(nodeState, selectedIndex);
          }
        }

        updateHistory(nodeState, true);
        persistImageStatesBound();

        log.info(`Layer move completed: moved layer ${layerIndex} to order ${targetPos}`);
      };

      const scheduleLayoutUpdate = (layout) => {
        if (nodeState.layoutRaf) {
          cancelAnimationFrame(nodeState.layoutRaf);
          nodeState.layoutRaf = null;
        }
        nodeState.pendingLayout = layout;
        nodeState.layoutRaf = requestAnimationFrame(() => {
          nodeState.layoutRaf = null;
          const data = nodeState.pendingLayout;
          nodeState.pendingLayout = null;
          if (!data) return;
          const {
            boardWidth: layoutBoardWidth,
            boardHeight: layoutBoardHeight,
            borderWidth: layoutBorderWidth,
            canvasColor: layoutCanvasColor,
            borderColor: layoutBorderColor,
            displayScale: layoutDisplayScale,
            scaledWidth,
            scaledHeight,
          } = data;

          widgetContainer.style.width = `${scaledWidth}px`;
          widgetContainer.style.height = `${scaledHeight}px`;
          widgetContainer.style.minWidth = `${scaledWidth}px`;
          widgetContainer.style.minHeight = `${scaledHeight}px`;
          if (nodeState.stageWrapper) {
            nodeState.stageWrapper.style.width = `${scaledWidth}px`;
            nodeState.stageWrapper.style.height = `${scaledHeight}px`;
          }

          if (nodeState.adjustments && typeof nodeState.adjustments.updateLayout === 'function') {
            nodeState.adjustments.updateLayout({ scaledWidth, scaledHeight });
          }

          if (nodeState.stage) {
            const stageWidth = layoutBoardWidth + 2 * layoutBorderWidth;
            const stageHeight = layoutBoardHeight + 2 * layoutBorderWidth;
            nodeState.stage.width(stageWidth);
            nodeState.stage.height(stageHeight);
            nodeState.stage.scale({ x: layoutDisplayScale, y: layoutDisplayScale });
          }

          if (nodeState.borderRect) {
            nodeState.borderRect.setAttrs({
              x: 0,
              y: 0,
              width: layoutBoardWidth + 2 * layoutBorderWidth,
              height: layoutBoardHeight + 2 * layoutBorderWidth,
              fill: layoutBorderColor
            });
          }
          if (nodeState.canvasRect) {
            nodeState.canvasRect.setAttrs({
              x: layoutBorderWidth,
              y: layoutBorderWidth,
              width: layoutBoardWidth,
              height: layoutBoardHeight,
              fill: layoutCanvasColor
            });
          }
          if (nodeState.borderFrame) {
            nodeState.borderFrame.setAttrs({
              x: layoutBorderWidth,
              y: layoutBorderWidth,
              width: layoutBoardWidth,
              height: layoutBoardHeight
            });
          }

          const nodeWidth = Math.max(MIN_NODE_WIDTH, scaledWidth + NODE_HORIZONTAL_PADDING);
          const nodeHeight = Math.max(MIN_NODE_HEIGHT, scaledHeight + NODE_VERTICAL_PADDING);
          node.size = [nodeWidth, nodeHeight];
          node.setSize([nodeWidth, nodeHeight]);

          if (nodeState.canvasLayer) nodeState.canvasLayer.batchDraw();
          if (nodeState.imageLayer) nodeState.imageLayer.batchDraw();
          if (nodeState.borderLayer) nodeState.borderLayer.batchDraw();
          if (nodeState.stage) nodeState.stage.draw();
        });
      };

      /**
       * Updates the canvas size, display scale, and properties, triggering a redraw.
       * @private
       */
      function updateSize() {
        try {
          let boardWidth = Math.min(Math.max(parseInt(node.widgets.find((w) => w.name === 'board_width')?.value) || 1024, 256), 8192);
          let boardHeight = Math.min(Math.max(parseInt(node.widgets.find((w) => w.name === 'board_height')?.value) || 1024, 256), 8192);
          let borderWidth = Math.min(Math.max(parseInt(node.widgets.find((w) => w.name === 'border_width')?.value) || 120, 10), 200);
          let canvasColorValue = node.widgets.find((w) => w.name === 'canvas_color')?.value || 'black';
          let canvasColor = { black: 'rgb(0, 0, 0)', white: 'rgb(255, 255, 255)', transparent: 'rgba(0, 0, 0, 0)' }[canvasColorValue] || 'rgb(0, 0, 0)';
          let borderColor = { black: 'rgb(25, 25, 25)', white: 'rgb(230, 230, 230)', transparent: 'rgba(0, 0, 0, 0)' }[canvasColorValue] || 'rgb(25, 25, 25)';
          let autoSize = node.widgets.find((w) => w.name === 'auto_size')?.value || 'off';
          let displayScale = Math.min(Math.max(parseFloat(node.widgets.find((w) => w.name === 'display_scale')?.value) || 0.5, 0.1), 1);

          // Update node properties
          node.properties.ui_config.board_width = boardWidth;
          node.properties.ui_config.board_height = boardHeight;
          node.properties.ui_config.border_width = borderWidth;
          node.properties.ui_config.canvas_color = canvasColorValue;
          node.properties.ui_config.border_color = borderColor;
          node.properties.ui_config.auto_size = autoSize;
          node.properties.ui_config.display_scale = displayScale;
          node.setProperty('ui_config', node.properties.ui_config);

          log.info(`Updating canvas size for node ${node.id}: boardWidth=${boardWidth}, boardHeight=${boardHeight}, borderWidth=${borderWidth}, displayScale=${displayScale}, autoSize=${autoSize}`);

          // Update widgets
          node.widgets.forEach((widget) => {
            if (widget.name === 'board_width') widget.value = boardWidth;
            if (widget.name === 'board_height') widget.value = boardHeight;
            if (widget.name === 'border_width') widget.value = borderWidth;
            if (widget.name === 'canvas_color') widget.value = canvasColorValue;
            if (widget.name === 'auto_size') widget.value = autoSize;
            if (widget.name === 'display_scale') widget.value = displayScale;
            if (widget.name === 'image_states') widget.value = JSON.stringify(nodeState.initialStates);
          });
          syncWidgetValues();

          // Reserve pointer-transparent space so LiteGraph widgets remain interactive

          // Update canvas dimensions with display scale
          const scaledWidth = Math.round((boardWidth + 2 * borderWidth) * displayScale);
          const scaledHeight = Math.round((boardHeight + 2 * borderWidth) * displayScale);
          scheduleLayoutUpdate({
            boardWidth,
            boardHeight,
            borderWidth,
            canvasColor,
            borderColor,
            displayScale,
            scaledWidth,
            scaledHeight,
          });

          // Preserve existing image states
          nodeState.initialStates = normalizeStateArray(nodeState.initialStates);
          if (nodeState.initialStates.length < imagePaths.length) {
            const newStates = Array(imagePaths.length - nodeState.initialStates.length)
              .fill(null)
              .map(() => createDefaultLayerState(boardWidth, boardHeight, borderWidth));
            nodeState.initialStates = [...nodeState.initialStates, ...newStates];
          } else if (nodeState.initialStates.length > imagePaths.length) {
            nodeState.initialStates = normalizeStateArray(nodeState.initialStates.slice(0, imagePaths.length));
          }
          attachFilenamesToStates();
          applyStates(nodeState);

          persistImageStatesBound();

          // Update UI elements
          uiElements.updateUIScale(displayScale);
          uiElements.updateLayerPanel(selectLayer, deselectLayer, {
            onToggleVisibility: setLayerVisibility,
            onMoveLayer: moveLayer,
            onToggleLock: setLayerLock,
          });
          updateHistory(nodeState);

        } catch (e) {
          log.error(`Error updating size for node ${node.id}:`, e);
          uiElements.updateStatusText(`更新画板失败: ${e.message}`, '#f00');
        }
      }

      /**
       * Triggers the ComfyUI prompt with updated states.
       * @async
       */
      async function triggerPrompt() {
        try {
          let newImagePaths = (node.properties?.ui_config?.image_paths || []).filter(p => typeof p === 'string' && p.trim().length > 0);

          if (JSON.stringify(newImagePaths) !== JSON.stringify(imagePaths)) {
            imagePaths = newImagePaths;
            nodeState.imageNodes = new Array(imagePaths.length).fill(null);
            node.properties.ui_config.image_paths = imagePaths;
            nodeState.lastImagePaths = imagePaths.slice();
          }

          if (autoSize === 'on' && imagePaths.length) {
            uiElements.updateStatusText('正在调整画板并重置...', '#fff');
            await debouncedLoadImages(node, nodeState, imagePaths, nodeState.initialStates, statusText, uiElements, selectLayer, deselectLayer, updateSize, [], 0, 3, true);
            boardWidth = node.properties.ui_config.board_width || 1024;
            boardHeight = node.properties.ui_config.board_height || 1024;
            borderWidth = node.properties.ui_config.border_width || 120;
            nodeState.initialStates = imagePaths.map(() => createDefaultLayerState(boardWidth, boardHeight, borderWidth));
            applyStates(nodeState);
            updateSize();
            uiElements.updateStatusText('调整完成，准备渲染...', '#fff');
          }

          nodeState.initialStates = normalizeStateArray(nodeState.initialStates.slice(0, imagePaths.length));
          persistImageStatesBound();
          syncWidgetValues();

          app.queuePrompt?.();
          uiElements.updateStatusText('渲染中...', '#fff');
        } catch (e) {
          log.error(`Failed to queue prompt for node ${node.id}:`, e);
          uiElements.updateStatusText('触发队列失败', '#f00');
        }
      }

      // Bind methods to nodeState
      nodeState.triggerPrompt = triggerPrompt;
      nodeState.resetCanvas = () => resetCanvas(node, nodeState, imagePaths, updateSize);
      nodeState.undo = () => undo(node, nodeState);
      nodeState.redo = () => redo(node, nodeState);
      nodeState.updateHistory = () => updateHistory(nodeState);
      nodeState.applyLayerOrder = applyLayerOrder;

      // Initialize node inputs
      node.inputs = [
        { name: 'pack_images', type: 'IMAGE', default: null },
        { name: 'file_data', type: 'FILE_DATA', default: null },
        { name: 'canvas_config', type: 'CANVAS_CONFIG', default: null },
        { name: 'layer_data', type: 'LAYER_DATA', default: null },
      ];

      const getWidgetByName = (name) =>
        Array.isArray(node.widgets) ? node.widgets.find((widget) => widget.name === name) : null;

      const boardWidthWidget = getWidgetByName('board_width');
      const boardHeightWidget = getWidgetByName('board_height');
      const borderWidthWidget = getWidgetByName('border_width');
      const canvasColorWidget = getWidgetByName('canvas_color');
      const autoSizeWidget = getWidgetByName('auto_size');
      const displayScaleWidget = getWidgetByName('display_scale');
      let imageStatesWidget = getWidgetByName('image_states');

      const requiredWidgets = [
        { name: 'board_width', widget: boardWidthWidget },
        { name: 'board_height', widget: boardHeightWidget },
        { name: 'border_width', widget: borderWidthWidget },
        { name: 'canvas_color', widget: canvasColorWidget },
        { name: 'auto_size', widget: autoSizeWidget },
        { name: 'display_scale', widget: displayScaleWidget },
      ];

      requiredWidgets.forEach(({ name, widget }) => {
        if (!widget) {
          log.error(`Widget "${name}" not found on node ${node.id}. Standard ComfyUI behavior may be limited.`);
        }
      });

      if (boardWidthWidget) boardWidthWidget.value = boardWidth;
      if (boardHeightWidget) boardHeightWidget.value = boardHeight;
      if (borderWidthWidget) borderWidthWidget.value = borderWidth;
      if (canvasColorWidget) canvasColorWidget.value = canvasColorValue;
      if (autoSizeWidget) autoSizeWidget.value = autoSize;
      if (displayScaleWidget) displayScaleWidget.value = uiConfig.display_scale;

      if (!imageStatesWidget) {
        imageStatesWidget = node.addWidget('hidden', 'image_states', JSON.stringify(nodeState.initialStates), () => {}, { serialize: true });
      }
      imageStatesWidget.value = JSON.stringify(nodeState.initialStates);
      imageStatesWidget.serialize = true;
      imageStatesWidget.computeSize = () => [0, 0];
      imageStatesWidget.draw = () => {};
      if (imageStatesWidget.element?.parentNode) {
        imageStatesWidget.element.parentNode.removeChild(imageStatesWidget.element);
      }

      const setupInputListeners = () => {
        const wrapCallback = (widget, handler) => {
          if (!widget) return;
          const originalCallback = widget.callback;
          widget.callback = (...args) => {
            handler(widget.value);
            originalCallback?.apply(widget, args);
          };
        };

        wrapCallback(boardWidthWidget, () => {
          const parsed = Math.min(Math.max(parseInt(boardWidthWidget?.value ?? boardWidth, 10) || boardWidth, 256), 8192);
          boardWidth = parsed;
          if (boardWidthWidget) boardWidthWidget.value = parsed;
          node.properties.ui_config.board_width = parsed;
          updateSize();
        });

        wrapCallback(boardHeightWidget, () => {
          const parsed = Math.min(Math.max(parseInt(boardHeightWidget?.value ?? boardHeight, 10) || boardHeight, 256), 8192);
          boardHeight = parsed;
          if (boardHeightWidget) boardHeightWidget.value = parsed;
          node.properties.ui_config.board_height = parsed;
          updateSize();
        });

        wrapCallback(borderWidthWidget, () => {
          const parsed = Math.min(Math.max(parseInt(borderWidthWidget?.value ?? borderWidth, 10) || borderWidth, 10), 200);
          borderWidth = parsed;
          if (borderWidthWidget) borderWidthWidget.value = parsed;
          node.properties.ui_config.border_width = parsed;
          updateSize();
        });

        wrapCallback(canvasColorWidget, () => {
          const value = canvasColorWidget?.value;
          canvasColorValue = ['black', 'white', 'transparent'].includes(value) ? value : 'black';
          node.properties.ui_config.canvas_color = canvasColorValue;
          updateSize();
        });

        wrapCallback(displayScaleWidget, () => {
          const parsed = Math.min(Math.max(parseFloat(displayScaleWidget?.value ?? uiConfig.display_scale) || uiConfig.display_scale || 0.5, 0.1), 1);
          if (displayScaleWidget) displayScaleWidget.value = parsed;
          node.properties.ui_config.display_scale = parsed;
          updateSize();
        });

        wrapCallback(autoSizeWidget, () => {
          const value = ['off', 'on'].includes(autoSizeWidget?.value) ? autoSizeWidget.value : 'off';
          const autoSizeChanged = nodeState.lastAutoSize !== value;
          autoSize = value;
          node.properties.ui_config.auto_size = autoSize;
          nodeState.lastAutoSize = autoSize;
          if (imagePaths.length && autoSizeChanged) {
            nodeState.imageNodes = new Array(imagePaths.length).fill(null);
            nodeState.lastImagePathsHash = null;
            debouncedLoadImages(node, nodeState, imagePaths, nodeState.initialStates, statusText, uiElements, selectLayer, deselectLayer, updateSize, [], 0, 3, true);
          } else {
            updateSize();
          }
        });
      };

      setupInputListeners();
      syncWidgetValues();

      // Add DOM widget for main container
      node.addDOMWidget('canvas', 'XISER_Canvas', mainContainer, {
        serialize: true,
        hideOnZoom: false,
        getValue: () => ({
          image_states: nodeState.initialStates,
          ui_config: node.properties.ui_config,
          image_paths: imagePaths
        }),
        setValue: (value) => {
          if (value.image_states) {
            nodeState.initialStates = normalizeStateArray(value.image_states);
            applyStates(nodeState);
          }
          if (value.ui_config) {
            node.properties.ui_config = {
              ...node.properties.ui_config,
              ...value.ui_config
            };
            boardWidth = node.properties.ui_config.board_width || boardWidth;
            boardHeight = node.properties.ui_config.board_height || boardHeight;
            borderWidth = node.properties.ui_config.border_width || borderWidth;
            canvasColorValue = node.properties.ui_config.canvas_color || canvasColorValue;
            autoSize = node.properties.ui_config.auto_size || autoSize;
            const currentDisplayScale = Math.min(Math.max(parseFloat(node.properties.ui_config.display_scale) || uiConfig.display_scale || 0.5, 0.1), 1);
            node.properties.ui_config.display_scale = currentDisplayScale;
            node.widgets.forEach((widget) => {
              if (widget.name === 'board_width') widget.value = boardWidth;
              if (widget.name === 'board_height') widget.value = boardHeight;
              if (widget.name === 'border_width') widget.value = borderWidth;
              if (widget.name === 'canvas_color') widget.value = canvasColorValue;
              if (widget.name === 'auto_size') widget.value = autoSize;
              if (widget.name === 'display_scale') widget.value = currentDisplayScale;
              if (widget.name === 'image_states') widget.value = JSON.stringify(nodeState.initialStates);
            });
          }
          if (value.image_paths) {
            imagePaths = Array.isArray(value.image_paths) ? value.image_paths.filter(p => typeof p === 'string' && p.trim().length > 0) : imagePaths;
            node.properties.ui_config.image_paths = imagePaths;
            nodeState.lastImagePaths = imagePaths.slice();
          }
          updateHistory(nodeState);
          updateSize();
        },
      });

      // Disable widgets based on requirements
      boardWidthWidget.disabled = false;
      boardHeightWidget.disabled = false;
      borderWidthWidget.disabled = false;
      autoSizeWidget.disabled = false;
      displayScaleWidget.disabled = false;

      // Sync widget values
      syncWidgetValues();
      applyLayerOrderBound = () => applyLayerOrder(node, nodeState);
      persistImageStatesBound = () => persistImageStates(node, nodeState, imageStatesWidget, syncWidgetValues);
      nodeState.applyLayerOrder = applyLayerOrderBound;

      /**
       * Polls for image updates and triggers reload if necessary.
       * @private
       */
      function startPolling() {
        if (nodeState.pollIntervalId) {
          clearInterval(nodeState.pollIntervalId);
          nodeState.pollIntervalId = null;
        }
        nodeState.pollIntervalId = setInterval(() => {
          let newImagePaths = (node.properties?.ui_config?.image_paths || []).filter(p => typeof p === 'string' && p.trim().length > 0);
          let states = node.properties?.image_states || [];

          const invalidPaths = (node.properties?.ui_config?.image_paths || []).filter(p => !p || typeof p !== 'string' || p.trim().length === 0);
          if (invalidPaths.length) {
            log.warn(`Invalid image paths in polling for node ${node.id}: ${JSON.stringify(invalidPaths)}`);
          }

          if (newImagePaths.length && !nodeState.lastImagePaths.length) {
            log.info(`Forcing initial load for node ${node.id}, new paths: ${JSON.stringify(newImagePaths)}`);
            imagePaths = newImagePaths;
            nodeState.imageNodes = new Array(imagePaths.length).fill(null);
            node.properties.ui_config.image_paths = imagePaths;
            const nextStates = deriveInitialStates(imagePaths, states, boardWidth, boardHeight, borderWidth);
            node.properties.image_states = nextStates;
            nodeState.initialStates = nextStates;
            node.setProperty('image_states', nodeState.initialStates);
            node.setProperty('ui_config', node.properties.ui_config);
            updateSize();
            debouncedLoadImages(node, nodeState, imagePaths, nodeState.initialStates, statusText, uiElements, selectLayer, deselectLayer, updateSize, [], 0, 3, true);
            updateHistory(nodeState);
          } else if (JSON.stringify(newImagePaths) !== JSON.stringify(nodeState.lastImagePaths)) {
            log.info(`Image paths changed for node ${node.id}, new paths: ${JSON.stringify(newImagePaths)}`);
            imagePaths = newImagePaths;
            nodeState.imageNodes = new Array(imagePaths.length).fill(null);
            node.properties.ui_config.image_paths = imagePaths;
            const updatedStates = deriveInitialStates(imagePaths, states, boardWidth, boardHeight, borderWidth);
            node.properties.image_states = updatedStates;
            nodeState.initialStates = updatedStates;
            node.setProperty('image_states', nodeState.initialStates);
            node.setProperty('ui_config', node.properties.ui_config);
            updateSize();
            debouncedLoadImages(node, nodeState, imagePaths, nodeState.initialStates, statusText, uiElements, selectLayer, deselectLayer, updateSize, [], 0, 3, true);
            updateHistory(nodeState);
          }
          nodeState.lastImagePaths = imagePaths.slice();
        }, POLL_INTERVAL);
      }

      // Execution handlers
      node._onNodeExecuted = function () {
        let states = node.properties?.image_states || [];
        let newImagePaths = (node.properties?.ui_config?.image_paths || []).filter(p => typeof p === 'string' && p.trim().length > 0);

        const invalidPaths = (node.properties?.ui_config?.image_paths || []).filter(p => !p || typeof p !== 'string' || p.trim().length === 0);
        if (invalidPaths.length) {
          log.warn(`Invalid image paths in onNodeExecuted for node ${node.id}: ${JSON.stringify(invalidPaths)}`);
        }

        if (newImagePaths.length) {
          log.info(`onNodeExecuted for node ${node.id}, new paths: ${JSON.stringify(newImagePaths)}`);
          imagePaths = newImagePaths;
          nodeState.imageNodes = new Array(imagePaths.length).fill(null);
          node.properties.ui_config.image_paths = imagePaths;
          const executedStates = deriveInitialStates(imagePaths, states, boardWidth, boardHeight, borderWidth);
          node.properties.image_states = executedStates;
          nodeState.initialStates = executedStates;
          node.setProperty('image_states', nodeState.initialStates);
          node.setProperty('ui_config', node.properties.ui_config);
          updateSize();
          debouncedLoadImages(node, nodeState, imagePaths, nodeState.initialStates, statusText, uiElements, selectLayer, deselectLayer, updateSize, [], 0, 3, true);
          updateHistory(nodeState);
        } else {
          uiElements.updateStatusText('无有效图像数据，请检查上游节点', '#f00');
          log.error(`No valid image paths in onNodeExecuted for node ${node.id}`);
        }
      };

      node.onExecuted = async function (message) {
        const log = nodeState.log || console;
        const uiPayload = message?.ui || message || {};
        let states = uiPayload?.image_states || message?.image_states || [];
        let newImagePaths = [];
        let file_data = message?.file_data || uiPayload?.file_data || null;
        const msgBoardWidth = uiPayload?.board_width ?? message?.board_width;
        const msgBoardHeight = uiPayload?.board_height ?? message?.board_height;
        const msgBorderWidth = uiPayload?.border_width ?? message?.border_width;
        const msgAutoSize = uiPayload?.auto_size ?? message?.auto_size;
        const canvasSig = JSON.stringify({
          w: msgBoardWidth,
          h: msgBoardHeight,
          bw: msgBorderWidth,
          fa: msgAutoSize,
          fdw: file_data?.canvas?.width,
          fdh: file_data?.canvas?.height,
        });

        /**
         * Compares two arrays for equality by checking each element.
         * @param {Array} arr1 - First array to compare.
         * @param {Array} arr2 - Second array to compare.
         * @returns {boolean} - True if arrays are equal, false otherwise.
         */
        const arraysEqual = (arr1, arr2) => {
          if (!arr1 || !arr2) return arr1 === arr2;
          return arr1.length === arr2.length && arr1.every((val, i) => val === arr2[i]);
        };

        /**
         * Compares two objects for deep equality using JSON.stringify.
         * @param {Object} obj1 - First object to compare.
         * @param {Object} obj2 - Second object to compare.
         * @returns {boolean} - True if objects are equal, false otherwise.
         */
        const objectsEqual = (obj1, obj2) => {
          if (!obj1 || !obj2) return obj1 === obj2;
          return JSON.stringify(obj1) === JSON.stringify(obj2);
        };

        // Extract image paths from message
        if (message?.image_paths) {
          if (typeof message.image_paths === 'string') {
            newImagePaths = message.image_paths.split(',').filter(p => typeof p === 'string' && p.trim().length > 0);
          } else if (Array.isArray(message.image_paths)) {
            newImagePaths = message.image_paths.filter(p => typeof p === 'string' && p.trim().length > 0);
          }
        } else if (message?.pack_images) {
          if (Array.isArray(message.pack_images)) {
            newImagePaths = message.pack_images.filter(p => typeof p === 'string' && p.trim().length > 0);
          } else {
            log.warn(`Invalid pack_images format in onExecuted for node ${node.id}: ${typeof message.pack_images}`);
          }
        }

        const invalidPaths = (message?.image_paths || []).filter(p => !p || typeof p !== 'string' || p.trim().length === 0);
        if (invalidPaths.length) {
          log.warn(`Invalid image paths in onExecuted for node ${node.id}: ${JSON.stringify(invalidPaths)}`);
        }

        // Skip execution if all inputs haven't changed
        if (
          newImagePaths.length &&
          nodeState.lastImagePaths &&
          arraysEqual(newImagePaths, nodeState.lastImagePaths) &&
          objectsEqual(states, nodeState.initialStates) &&
          objectsEqual(file_data, nodeState.file_data) &&
          canvasSig === nodeState.lastCanvasSig
        ) {
          return;
        }

        // If backend returns board dimensions (e.g., auto_size), sync widgets/properties before layout
        const toScalar = (val) => {
          if (Array.isArray(val)) return val[0];
          return val;
        };
        const toNumber = (val, fallback) => {
          const scalar = toScalar(val);
          const parsed = parseInt(scalar, 10);
          return Number.isFinite(parsed) ? parsed : fallback;
        };
        const toAutoSize = (val, fallback) => {
          const scalar = toScalar(val);
          if (scalar === 'on' || scalar === 'off') return scalar;
          return fallback;
        };

        if (msgBoardWidth !== undefined && msgBoardHeight !== undefined) {
          const backendBoardWidth = Math.min(Math.max(toNumber(msgBoardWidth, 1024), 256), 8192);
          const backendBoardHeight = Math.min(Math.max(toNumber(msgBoardHeight, 1024), 256), 8192);
          const backendBorderWidth = Math.min(Math.max(toNumber(msgBorderWidth, borderWidth), 10), 200);
          const backendAutoSize = toAutoSize(msgAutoSize, node.properties.ui_config.auto_size || 'off');

          node.properties.ui_config.board_width = backendBoardWidth;
          node.properties.ui_config.board_height = backendBoardHeight;
          node.properties.ui_config.border_width = backendBorderWidth;
          node.properties.ui_config.auto_size = backendAutoSize;
          node.setProperty('ui_config', node.properties.ui_config);

          if (boardWidthWidget) boardWidthWidget.value = backendBoardWidth;
          if (boardHeightWidget) boardHeightWidget.value = backendBoardHeight;
          if (borderWidthWidget) borderWidthWidget.value = backendBorderWidth;
          if (autoSizeWidget) autoSizeWidget.value = backendAutoSize;
        } else if (toAutoSize(node.properties.ui_config.auto_size, 'off') === 'on' && file_data?.canvas?.width && file_data?.canvas?.height) {
          // Fallback: derive size from file_data when backend UI payload is missing dimensions
          const fdWidth = Math.min(Math.max(toNumber(file_data.canvas.width, 1024), 256), 8192);
          const fdHeight = Math.min(Math.max(toNumber(file_data.canvas.height, 1024), 256), 8192);
          node.properties.ui_config.board_width = fdWidth;
          node.properties.ui_config.board_height = fdHeight;
          node.setProperty('ui_config', node.properties.ui_config);
          if (boardWidthWidget) boardWidthWidget.value = fdWidth;
          if (boardHeightWidget) boardHeightWidget.value = fdHeight;
        }

        // Always refresh local sizing variables from ui_config after potential updates above
        boardWidth = node.properties.ui_config.board_width || boardWidth;
        boardHeight = node.properties.ui_config.board_height || boardHeight;
        borderWidth = node.properties.ui_config.border_width || borderWidth;

        // Remember last canvas signature to avoid skipping future updates unintentionally
        nodeState.lastCanvasSig = canvasSig;

        if (file_data?.layers?.length) {
          log.info(`Processing file_data for node ${node.id}: ${JSON.stringify(file_data)}`);
          states = file_data.layers.map((layer, i) => {
            if (i >= newImagePaths.length) return null;
            return {
              x: layer.offset_x + borderWidth + (layer.width || 512) / 2,
              y: layer.offset_y + borderWidth + (layer.height || 512) / 2,
              scaleX: layer.scale_x || 1,
              scaleY: layer.scale_y || 1,
              rotation: layer.rotation || 0,
            };
          }).filter(s => s !== null);
          if (!objectsEqual(nodeState.file_data, file_data)) {
            nodeState.file_data = file_data;
          } else {
            nodeState.file_data = null;
          }
        } else {
          nodeState.file_data = null;
        }

        if (newImagePaths.length) {
          log.info(`onExecuted for node ${node.id}, new paths: ${JSON.stringify(newImagePaths)}`);
          imagePaths = newImagePaths;
          nodeState.imageNodes = new Array(imagePaths.length).fill(null);

          // Update ui_config only if changed
          if (!arraysEqual(node.properties.ui_config.image_paths, imagePaths)) {
            node.properties.ui_config.image_paths = imagePaths;
            node.setProperty('ui_config', node.properties.ui_config);
          }

          applyStates(nodeState);
          nodeState.imageLayer.batchDraw();

          // Update image_states: merge incoming with filename/order to preserve stacking
          const mergedStates = mergeIncomingStates(node, nodeState, states, imagePaths);
          node.properties.image_states = mergedStates;
          node.properties.ui_config = { ...(node.properties.ui_config || {}), image_states: mergedStates };
          nodeState.initialStates = mergedStates;
          node.setProperty('image_states', nodeState.initialStates);
          node.setProperty('ui_config', node.properties.ui_config);
          applyLayerOrderBound();

          nodeState.lastImagePaths = imagePaths.slice();

          try {
            await loadImages(node, nodeState, imagePaths, nodeState.initialStates, statusText, uiElements, selectLayer, deselectLayer, updateSize, [], 0, 3, true);
            setupLayerEventListeners(node, nodeState);
            setupWheelEvents(node, nodeState);
          } catch (e) {
            log.error(`Failed to load images in onExecuted for node ${node.id}: ${e.message}`);
            uiElements.updateStatusText('图像加载失败', '#f00');
            return;
          }

          updateSize();
          uiElements.updateLayerPanel(selectLayer, deselectLayer, {
            onToggleVisibility: setLayerVisibility,
            onMoveLayer: moveLayer,
            onToggleLock: setLayerLock,
          });
          updateHistory(nodeState);
          // 确保本次渲染后的叠加顺序立即持久化，避免下一次执行回退
          log.info(`onExecuted persist before setProperty, orders=${JSON.stringify(nodeState.initialStates.map(s=>s.order))}`);
          persistImageStatesBound();

          const outputCanvas = nodeState.stage.toCanvas();
          const layers = nodeState.initialStates.map((state, index) => {
            const imageNode = nodeState.imageNodes[index];
            if (!imageNode) {
              log.warn(`Image node at index ${index} is null for node ${node.id}`);
              return {
                x: state.x - borderWidth,
                y: state.y - borderWidth,
                scale_x: state.scaleX,
                scale_y: state.scaleY,
                rotation: state.rotation,
                image: null,
              };
            }

            // Calculate actual center position considering transformations
            // The state coordinates are the center of the transformed image
            // We need to account for the fact that the image dimensions change after scaling
            const originalWidth = imageNode.width() / (state.scaleX || 1);
            const originalHeight = imageNode.height() / (state.scaleY || 1);
            const actualCenterX = state.x - borderWidth;
            const actualCenterY = state.y - borderWidth;

            return {
              x: actualCenterX,
              y: actualCenterY,
              scale_x: state.scaleX,
              scale_y: state.scaleY,
              rotation: state.rotation,
              image: imageNode.toDataURL(),
            };
          });

          // Update outputs only if necessary
          const newOutput = {
            canvas: {
              width: boardWidth,
              height: boardHeight,
            },
            layers,
            image: outputCanvas.toDataURL(),
          };
          if (!node.outputs?.[0]?.value || !objectsEqual(node.outputs[0].value, newOutput)) {
            node.outputs = node.outputs || [{ name: 'output', type: 'CANVAS', value: null }];
            node.outputs[0].value = newOutput;
          }
        } else {
          uiElements.updateStatusText('无有效图像数据，请检查上游节点', '#f00');
          log.error(`No valid image paths in onExecuted for node ${node.id}`);
        }
      };

      /**
       * Cleans up resources when the node is removed.
       */
      node.onRemoved = () => {
        try {
          log.info(`Cleaning up node ${node.id}`);

          // Stop polling
          if (nodeState.pollIntervalId) {
            clearInterval(nodeState.pollIntervalId);
            nodeState.pollIntervalId = null;
          }

          // Clear node state
          cleanupNodeState(nodeState);

          if (nodeState.layoutRaf) {
            cancelAnimationFrame(nodeState.layoutRaf);
            nodeState.layoutRaf = null;
            nodeState.pendingLayout = null;
          }

          // Clear image cache
          clearNodeCache(nodeId);

          // Clear history
          clearHistory(nodeState);

          // Clean up event listeners
          cleanupLayerEventListeners(nodeState);

          // Destroy Konva resources
          destroyKonva(nodeState);

          // Remove UI elements
          if (modal && modal.parentNode) {
            modal.remove();
          }
          if (mainContainer && mainContainer.parentNode) {
            mainContainer.remove();
          }

          // Remove all node-specific styles
          document.querySelectorAll(`style[data-node-id="${nodeId}"], style#xiser-styles-${nodeId}`).forEach((style) => {
            style.remove();
          });

          // Clear node references
          node._state = null;
          node.widgets = [];
          node.inputs = [];
          node.outputs = [];

          log.info(`Node ${node.id} removed, resources cleaned`);
        } catch (e) {
          log.error(`Error during cleanup of node ${node.id}: ${e.message}`);
        }
      };

      // Initial load
      updateSize();
      if (imagePaths.length) {
        log.info(`Initial loadImages call with paths: ${JSON.stringify(imagePaths)}`);
        nodeState.imageNodes = new Array(imagePaths.length).fill(null);
        debouncedLoadImages(node, nodeState, imagePaths, nodeState.initialStates, statusText, uiElements, selectLayer, deselectLayer, updateSize, [], 0, 3, true);
      } else {
        log.info(`No initial image paths, waiting for images`);
        uiElements.updateStatusText('等待图片数据...', '');
        statusText.style.color = '';
      }

      startPolling();
    };

    // Register onNodeAdded handler
    const originalOnNodeAdded = app.graph.onNodeAdded || (() => {});
    app.graph.onNodeAdded = function (node) {
      originalOnNodeAdded.apply(this, arguments);
      initializeNode(node);
    };

    // Handle existing nodes
    app.graph.nodes.forEach((node) => {
      if (node.comfyClass === 'XISER_Canvas' && !node._isInitialized) {
        initializeNode(node);
      }
    });
  },

  /**
   * Marks nodes for initialization on creation.
   * @async
   * @param {Object} node - The ComfyUI node instance.
   */
  async nodeCreated(node) {
    if (node.comfyClass !== 'XISER_Canvas') return;
    node._isInitialized = false;
  },
});