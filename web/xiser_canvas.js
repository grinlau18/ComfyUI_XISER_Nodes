/**
 * @fileoverview Main entry point for the XISER_Canvas ComfyUI extension, handling node lifecycle and UI/Konva integration.
 * @module xiser_canvas
 */

import { app } from '/scripts/app.js';
import { initializeUI } from './canvas_ui.js';
import { initializeKonva, selectLayer, deselectLayer, applyStates, destroyKonva, setupWheelEvents } from './canvas_konva.js';
import { loadImages } from './canvas_images.js';
import { setupLayerEventListeners } from './canvas_history.js';
import { log, createNodeState, initializeCanvasProperties, debounce, throttle } from './canvas_state.js';
import { updateHistory, undo, redo, resetCanvas } from './canvas_history.js';

// Configurable constants for layout adjustments
const TOP_MARGIN = -50; // Space between controls and canvas (px)
const HEIGHT_BUFFER = 20; // Extra height to prevent clipping (px)
const SIDE_MARGIN = 20; // Total horizontal padding (px, split left/right)
const CONTROL_HEIGHT_OVERRIDE = 130; // Set to a number (px) to override controlHeight, or null for dynamic
const HEIGHT_ADJUSTMENT = 130; // Default height adjustment (px) if widget is hidden

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
      if (node._isInitialized) return; // Prevent re-initialization
      node._isInitialized = true;

      // Disable manual resizing
      node.resizable = false;
      log.debug(`Manual resizing disabled for node ${node.id}`);

      // Validate node ID
      if (node.id === -1) {
        log.error(`Node ${node.id} has invalid ID (-1) after onNodeAdded, initialization skipped`);
        return;
      }
      log.info(`Initializing node with ID: ${node.id}`);

      // Initialize node state
      const nodeId = node.id;
      const nodeState = createNodeState(nodeId, app);
      nodeState.firstImageDimensions = { width: 0, height: 0 }; // Track first image dimensions
      nodeState.imageNodes = []; // Initialize imageNodes as empty
      nodeState.isInteracting = false; // Track drag/transform interaction state
      nodeState.fileData = null; // Store file_data for layer states
      nodeState.pollIntervalId = null; // Initialize poll interval ID
      nodeState.lastAutoSize = null; // Track last auto_size value
      node._state = nodeState; // Attach state to node for cleanup

      // Initialize canvas properties with defaults
      let { imagePaths, autoSize, boardWidth, boardHeight, borderWidth, canvasColor, borderColor, canvasColorValue, uiConfig } = initializeCanvasProperties(node, nodeState);

      // Sanitize uiConfig
      uiConfig.board_width = Math.min(Math.max(parseInt(uiConfig.board_width) || 1024, 256), 8192);
      uiConfig.board_height = Math.min(Math.max(parseInt(uiConfig.board_height) || 1024, 256), 8192);
      uiConfig.border_width = Math.min(Math.max(parseInt(uiConfig.border_width) || 40, 10), 200);
      uiConfig.canvas_color = ['black', 'white', 'transparent'].includes(uiConfig.canvas_color) ? uiConfig.canvas_color : 'black';
      uiConfig.auto_size = ['off', 'on'].includes(uiConfig.auto_size) ? uiConfig.auto_size : 'off';
      uiConfig.display_scale = Math.min(Math.max(parseFloat(uiConfig.display_scale) || 1, 0.1), 2);
      uiConfig.height_adjustment = Math.min(Math.max(parseInt(uiConfig.height_adjustment) || 0, -100), 100);
      node.setProperty('ui_config', uiConfig);
      nodeState.lastAutoSize = uiConfig.auto_size; // Initialize lastAutoSize

      // Sanitize imagePaths
      imagePaths = Array.isArray(imagePaths) ? imagePaths.filter(p => typeof p === 'string' && p.trim().length > 0) : [];
      node.properties.ui_config.image_paths = imagePaths;
      nodeState.lastImagePaths = imagePaths.slice();

      // Add node-specific styles
      const style = document.createElement('style');
      style.dataset.nodeId = nodeId; // Add identifier for cleanup
      style.textContent = `
        .xiser-main-container-${nodeId} {
          display: flex;
          flex-direction: column;
          box-sizing: border-box;
          overflow: visible;
        }
        .xiser-controls-container-${nodeId} {
          display: block;
          margin-bottom: ${TOP_MARGIN}px;
        }
        .xiser-canvas-container-${nodeId} {
          display: block;
          position: relative;
          overflow: visible;
          flex: 0 0 auto;
        }
        .xiser-controls-container-${nodeId} > * {
          margin-bottom: 1px;
        }
      `;
      document.head.appendChild(style);

      // Create controls container
      const controlsContainer = document.createElement('div');
      controlsContainer.className = `xiser-controls-container-${nodeId}`;
      controlsContainer.style.display = 'block';
      controlsContainer.style.marginBottom = `${TOP_MARGIN}px`;
      log.debug(`Controls container created for node ${node.id}`);

      // Create widget container for canvas
      const widgetContainer = document.createElement('div');
      widgetContainer.className = `xiser-canvas-container-${nodeId}`;
      widgetContainer.style.display = 'block';
      widgetContainer.style.position = 'relative';
      log.debug(`Widget container created for node ${node.id}`);

      // Create main container to hold controls and canvas
      const mainContainer = document.createElement('div');
      mainContainer.className = `xiser-main-container-${nodeId}`;
      mainContainer.style.display = 'flex';
      mainContainer.style.flexDirection = 'column';
      mainContainer.appendChild(controlsContainer);
      mainContainer.appendChild(widgetContainer);
      log.debug(`Main container created for node ${node.id}`);

      // Initialize UI with widget container
      const uiElements = initializeUI(node, nodeState, widgetContainer);
      const { statusText, layerPanel, modal } = uiElements;

      // Initialize Konva stage within widget container
      const konvaElements = initializeKonva(node, nodeState, widgetContainer, boardWidth, boardHeight, borderWidth, canvasColorValue, borderColor);
      Object.assign(nodeState, konvaElements);

      // Initialize layer states as an array
      nodeState.initialStates = Array.isArray(node.properties.image_states) ? node.properties.image_states : [];

      // Create debounced loadImages function
      const debouncedLoadImages = debounce(loadImages, 500);

      // Handle node collapse/expand
      const originalCollapse = node.collapse;
      node.collapse = function () {
        originalCollapse.apply(this, arguments);
        if (node.collapsed) {
          log.debug(`Node ${node.id} collapsed, hiding main container and modal`);
          mainContainer.style.display = 'none';
          if (modal) modal.style.display = 'none';
        } else {
          log.debug(`Node ${node.id} expanded, showing main container and modal`);
          mainContainer.style.display = 'flex';
          if (modal) modal.style.display = nodeState.modalVisible ? 'flex' : 'none';
        }
      };

      /**
       * Updates the canvas size, display scale, and properties, triggering a redraw.
       */
      function updateSize() {
        try {
          let boardWidth = Math.min(Math.max(parseInt(node.widgets.find((w) => w.name === 'board_width')?.value) || 1024, 256), 8192);
          let boardHeight = Math.min(Math.max(parseInt(node.widgets.find((w) => w.name === 'board_height')?.value) || 1024, 256), 8192);
          let borderWidth = Math.min(Math.max(parseInt(node.widgets.find((w) => w.name === 'border_width')?.value) || 40, 10), 200);
          let canvasColorValue = node.widgets.find((w) => w.name === 'canvas_color')?.value || 'black';
          let canvasColor = { black: 'rgb(0, 0, 0)', white: 'rgb(255, 255, 255)', transparent: 'rgba(0, 0, 0, 0)' }[canvasColorValue] || 'rgb(0, 0, 0)';
          let borderColor = { black: 'rgb(25, 25, 25)', white: 'rgb(230, 230, 230)', transparent: 'rgba(0, 0, 0, 0)' }[canvasColorValue] || 'rgb(25, 25, 25)';
          let autoSize = node.widgets.find((w) => w.name === 'auto_size')?.value || 'off';
          let displayScale = Math.min(Math.max(parseFloat(node.widgets.find((w) => w.name === 'display_scale')?.value) || 1, 0.1), 2);
          let heightAdjustment = node.widgets.find((w) => w.name === 'height_adjustment')?.value || HEIGHT_ADJUSTMENT;

          // Update node properties
          node.properties.ui_config.board_width = boardWidth;
          node.properties.ui_config.board_height = boardHeight;
          node.properties.ui_config.border_width = borderWidth;
          node.properties.ui_config.canvas_color = canvasColorValue;
          node.properties.ui_config.border_color = borderColor;
          node.properties.ui_config.auto_size = autoSize;
          node.properties.ui_config.display_scale = displayScale;
          node.properties.ui_config.height_adjustment = heightAdjustment;
          node.setProperty('ui_config', node.properties.ui_config);

          log.info(`Updating canvas size for node ${node.id}: boardWidth=${boardWidth}, boardHeight=${boardHeight}, borderWidth=${borderWidth}, displayScale=${displayScale}, autoSize=${autoSize}, heightAdjustment=${heightAdjustment}`);

          // Update widgets
          node.widgets.forEach((widget) => {
            if (widget.name === 'board_width') widget.value = boardWidth;
            if (widget.name === 'board_height') widget.value = boardHeight;
            if (widget.name === 'border_width') widget.value = borderWidth;
            if (widget.name === 'canvas_color') widget.value = canvasColorValue;
            if (widget.name === 'auto_size') widget.value = autoSize;
            if (widget.name === 'display_scale') widget.value = displayScale;
            if (widget.name === 'height_adjustment') widget.value = heightAdjustment;
            if (widget.name === 'image_states') widget.value = JSON.stringify(nodeState.initialStates);
          });
          node.widgets_values = [boardWidth, boardHeight, borderWidth, canvasColorValue, autoSize, displayScale, heightAdjustment, JSON.stringify(nodeState.initialStates)];

          // Force reflow for accurate control height
          controlsContainer.style.display = 'none';
          controlsContainer.offsetHeight; // Trigger reflow
          controlsContainer.style.display = 'block';

          // Calculate control height
          const controlHeight = CONTROL_HEIGHT_OVERRIDE !== null ? CONTROL_HEIGHT_OVERRIDE : (controlsContainer.offsetHeight || 100);
          log.debug(`Control height for node ${node.id}: ${controlHeight}px`);

          // Update canvas dimensions with display scale
          const scaledWidth = (boardWidth + 2 * borderWidth) * displayScale;
          const scaledHeight = (boardHeight + 2 * borderWidth) * displayScale;
          widgetContainer.style.width = `${scaledWidth}px`;
          widgetContainer.style.height = `${scaledHeight}px`;
          widgetContainer.style.minWidth = `${scaledWidth}px`;
          widgetContainer.style.minHeight = `${scaledHeight}px`;
          if (nodeState.stage) {
            nodeState.stage.width(boardWidth + 2 * borderWidth);
            nodeState.stage.height(boardHeight + 2 * borderWidth);
            nodeState.stage.scale({ x: displayScale, y: displayScale });
          }

          if (nodeState.borderRect) {
            nodeState.borderRect.setAttrs({ x: 0, y: 0, width: boardWidth + 2 * borderWidth, height: boardHeight + 2 * borderWidth, fill: borderColor });
          }
          if (nodeState.canvasRect) {
            nodeState.canvasRect.setAttrs({ x: borderWidth, y: borderWidth, width: boardWidth, height: boardHeight, fill: canvasColor });
          }
          if (nodeState.borderFrame) {
            nodeState.borderFrame.setAttrs({ x: borderWidth, y: borderWidth, width: boardWidth, height: boardHeight });
          }

          // Preserve existing image states
          if (nodeState.initialStates.length < imagePaths.length) {
            // Append new states for additional images
            const newStates = Array(imagePaths.length - nodeState.initialStates.length).fill().map(() => ({
              x: borderWidth + boardWidth / 2,
              y: borderWidth + boardHeight / 2,
              scaleX: 1,
              scaleY: 1,
              rotation: 0,
            }));
            nodeState.initialStates = [...nodeState.initialStates, ...newStates];
          } else if (nodeState.initialStates.length > imagePaths.length) {
            // Truncate excess states
            nodeState.initialStates = nodeState.initialStates.slice(0, imagePaths.length);
          }
          applyStates(nodeState);

          // Sync image_states
          const imageStatesWidget = node.widgets.find((w) => w.name === 'image_states');
          if (imageStatesWidget) {
            imageStatesWidget.value = JSON.stringify(nodeState.initialStates);
          }
          node.setProperty('image_states', nodeState.initialStates);

          // Update node size with buffer and adjustment
          const nodeWidth = scaledWidth + SIDE_MARGIN;
          const nodeHeight = scaledHeight + controlHeight + TOP_MARGIN + HEIGHT_BUFFER + heightAdjustment;
          requestAnimationFrame(() => {
            node.size = [nodeWidth, nodeHeight];
            node.setSize([nodeWidth, nodeHeight]);
            log.debug(`Canvas size updated for node ${node.id}: board=${boardWidth}x${boardHeight}, scaled=${scaledWidth}x${scaledHeight}, node=${nodeWidth}x${nodeHeight}, heightAdjustment=${heightAdjustment}`);
          });

          // Redraw layers
          if (nodeState.canvasLayer) nodeState.canvasLayer.batchDraw();
          if (nodeState.imageLayer) nodeState.imageLayer.batchDraw();
          if (nodeState.borderLayer) nodeState.borderLayer.batchDraw();
          if (nodeState.stage) nodeState.stage.draw();

          // Update UI element scales
          uiElements.updateUIScale(displayScale);
          uiElements.updateLayerPanel(selectLayer, deselectLayer);
          updateHistory(nodeState);

          // Debug visibility
          log.debug(`Main container visibility for node ${node.id}: display=${mainContainer.style.display}, dimensions=${scaledWidth}x${scaledHeight}, stage=${nodeState.stage?.width() || 'undefined'}x${nodeState.stage?.height() || 'undefined'}`);
        } catch (e) {
          log.error(`Error updating size for node ${node.id}:`, e);
          statusText.innerText = `更新画板失败: ${e.message}`;
          statusText.style.color = '#f00';
        }
      }

      /**
       * Triggers the ComfyUI prompt with updated states.
       * @async
       */
      async function triggerPrompt() {
        try {
          let newImagePaths = (node.properties?.ui_config?.image_paths || []).filter(p => typeof p === 'string' && p.trim().length > 0);

          // Update image paths and states
          if (JSON.stringify(newImagePaths) !== JSON.stringify(imagePaths)) {
            imagePaths = newImagePaths;
            nodeState.imageNodes = new Array(imagePaths.length).fill(null); // Initialize with nulls
            node.properties.ui_config.image_paths = imagePaths;
            nodeState.lastImagePaths = imagePaths.slice();
            log.debug(`Image paths updated for node ${node.id}: ${JSON.stringify(imagePaths)}`);
          }

          if (autoSize === 'on' && imagePaths.length) {
            statusText.innerText = '正在调整画板并重置...';
            statusText.style.color = '#fff';
            await debouncedLoadImages(node, nodeState, imagePaths, nodeState.initialStates, statusText, uiElements, selectLayer, deselectLayer, updateSize, [], 0, 3, true);
            boardWidth = node.properties.ui_config.board_width || 1024;
            boardHeight = node.properties.ui_config.board_height || 1024;
            borderWidth = node.properties.ui_config.border_width || 40;
            nodeState.initialStates = imagePaths.map(() => ({
              x: borderWidth + boardWidth / 2,
              y: borderWidth + boardHeight / 2,
              scaleX: 1,
              scaleY: 1,
              rotation: 0,
            }));
            applyStates(nodeState);
            updateSize();
            statusText.innerText = '调整完成，准备渲染...';
          }

          nodeState.initialStates = nodeState.initialStates.slice(0, imagePaths.length);
          node.properties.image_states = nodeState.initialStates;
          node.widgets.find((w) => w.name === 'image_states').value = JSON.stringify(nodeState.initialStates);
          node.setProperty('image_states', nodeState.initialStates);
          node.widgets_values = [boardWidth, boardHeight, borderWidth, canvasColorValue, autoSize, node.widgets.find((w) => w.name === 'display_scale')?.value || 1, node.widgets.find((w) => w.name === 'height_adjustment')?.value || HEIGHT_ADJUSTMENT, JSON.stringify(nodeState.initialStates)];

          app.queuePrompt?.();
          statusText.innerText = '渲染中...';
          statusText.style.color = '#fff';
        } catch (e) {
          log.error(`Failed to queue prompt for node ${node.id}:`, e);
          statusText.innerText = '触发队列失败';
          statusText.style.color = '#f00';
        }
      }

      // Bind methods to nodeState
      nodeState.triggerPrompt = triggerPrompt;
      nodeState.resetCanvas = () => resetCanvas(node, nodeState, imagePaths, updateSize);
      nodeState.undo = () => undo(node, nodeState);
      nodeState.redo = () => redo(node, nodeState);
      nodeState.updateHistory = () => updateHistory(nodeState);

      // Initialize node inputs
      node.inputs = [
        { name: 'pack_images', type: 'XIS_IMAGES', default: null },
        { name: 'file_data', type: 'FILE_DATA', default: null },
      ];

      // Initialize widgets
      node.widgets = [];

      const boardWidthWidget = node.addWidget('number', 'board_width', boardWidth, (value) => {
        boardWidth = Math.min(Math.max(parseInt(value), 256), 8192);
        node.properties.ui_config.board_width = boardWidth;
        log.debug(`Board width changed to ${boardWidth} for node ${node.id}`);
        updateSize();
      }, { min: 256, max: 8192, step: 16, precision: 0 });

      const boardHeightWidget = node.addWidget('number', 'board_height', boardHeight, (value) => {
        boardHeight = Math.min(Math.max(parseInt(value), 256), 8192);
        node.properties.ui_config.board_height = boardHeight;
        log.debug(`Board height changed to ${boardHeight} for node ${node.id}`);
        updateSize();
      }, { min: 256, max: 8192, step: 16, precision: 0 });

      const borderWidthWidget = node.addWidget('number', 'border_width', borderWidth, (value) => {
        borderWidth = Math.min(Math.max(parseInt(value), 10), 200);
        node.properties.ui_config.border_width = borderWidth;
        log.debug(`Border width changed to ${borderWidth} for node ${node.id}`);
        updateSize();
      }, { min: 10, max: 200, step: 1, precision: 0 });

      const canvasColorWidget = node.addWidget('combo', 'canvas_color', canvasColorValue, (value) => {
        canvasColorValue = ['black', 'white', 'transparent'].includes(value) ? value : 'black';
        node.properties.ui_config.canvas_color = canvasColorValue;
        log.debug(`Canvas color changed to ${canvasColorValue} for node ${node.id}`);
        updateSize();
      }, { values: ['black', 'white', 'transparent'] });

      const autoSizeWidget = node.addWidget('combo', 'auto_size', autoSize, (value) => {
        autoSize = ['off', 'on'].includes(value) ? value : 'off';
        node.properties.ui_config.auto_size = autoSize;
        log.debug(`Auto_size changed to ${autoSize} for node ${node.id}`);
        const autoSizeChanged = nodeState.lastAutoSize !== autoSize;
        nodeState.lastAutoSize = autoSize;
        if (imagePaths.length && autoSizeChanged) {
          log.debug(`Auto_size toggled to ${autoSize} for node ${node.id}, forcing loadImages`);
          nodeState.imageNodes = new Array(imagePaths.length).fill(null); // Reset imageNodes
          nodeState.lastImagePathsHash = null; // Invalidate hash to force reload
          debouncedLoadImages(node, nodeState, imagePaths, nodeState.initialStates, statusText, uiElements, selectLayer, deselectLayer, updateSize, [], 0, 3, true);
        } else {
          updateSize();
        }
      }, { values: ['off', 'on'] });

      const displayScaleWidget = node.addWidget('number', 'display_scale', uiConfig.display_scale, (value) => {
        const newDisplayScale = Math.min(Math.max(parseFloat(value), 0.1), 2);
        node.properties.ui_config.display_scale = newDisplayScale;
        log.debug(`Display scale changed to ${newDisplayScale} for node ${node.id}`);
        updateSize();
      }, { min: 0.1, max: 2, step: 0.05, precision: 2 });

      const heightAdjustmentWidget = node.addWidget('hidden', 'height_adjustment', uiConfig.height_adjustment || HEIGHT_ADJUSTMENT, () => {}, { serialize: true });

      const imageStatesWidget = node.addWidget('hidden', 'image_states', JSON.stringify(nodeState.initialStates), () => {}, { serialize: true });

      // Append visible widget DOM elements to controlsContainer
      [boardWidthWidget, boardHeightWidget, borderWidthWidget, canvasColorWidget, autoSizeWidget, displayScaleWidget].forEach((widget) => {
        if (widget.element) {
          controlsContainer.appendChild(widget.element);
        }
      });

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
            nodeState.initialStates = Array.isArray(value.image_states) ? value.image_states : [];
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
            node.widgets.forEach((widget) => {
              if (widget.name === 'board_width') widget.value = boardWidth;
              if (widget.name === 'board_height') widget.value = boardHeight;
              if (widget.name === 'border_width') widget.value = borderWidth;
              if (widget.name === 'canvas_color') widget.value = canvasColorValue;
              if (widget.name === 'auto_size') widget.value = autoSize;
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

      // Disable widgets based on requirements (none disabled by auto_size)
      boardWidthWidget.disabled = false;
      boardHeightWidget.disabled = false;
      borderWidthWidget.disabled = false;
      autoSizeWidget.disabled = false;
      displayScaleWidget.disabled = false;

      // Sync widget values
      node.widgets_values = [
        boardWidth,
        boardHeight,
        borderWidth,
        canvasColorValue,
        autoSize,
        uiConfig.display_scale,
        uiConfig.height_adjustment || HEIGHT_ADJUSTMENT,
        JSON.stringify(nodeState.initialStates),
      ];

      // Polling for image updates
      function startPolling() {
        if (nodeState.pollIntervalId) {
          clearInterval(nodeState.pollIntervalId);
          nodeState.pollIntervalId = null;
        }
        nodeState.pollIntervalId = setInterval(() => {
          let newImagePaths = (node.properties?.ui_config?.image_paths || []).filter(p => typeof p === 'string' && p.trim().length > 0);
          let states = node.properties?.image_states || [];

          // Log invalid paths for debugging
          const invalidPaths = (node.properties?.ui_config?.image_paths || []).filter(p => !p || typeof p !== 'string' || p.trim().length === 0);
          if (invalidPaths.length) {
            log.warn(`Invalid image paths in polling for node ${node.id}: ${JSON.stringify(invalidPaths)}`);
          }

          if (newImagePaths.length && !nodeState.lastImagePaths.length) {
            log.info(`Forcing initial load for new node ${node.id}, new paths: ${JSON.stringify(newImagePaths)}`);
            imagePaths = newImagePaths;
            nodeState.imageNodes = new Array(imagePaths.length).fill(null); // Initialize with nulls
            node.properties.ui_config.image_paths = imagePaths;
            node.properties.image_states = Array.isArray(states) ? states : imagePaths.map(() => ({
              x: borderWidth + boardWidth / 2,
              y: borderWidth + boardHeight / 2,
              scaleX: 1,
              scaleY: 1,
              rotation: 0,
            }));
            nodeState.initialStates = node.properties.image_states;
            node.setProperty('image_states', nodeState.initialStates);
            node.setProperty('ui_config', node.properties.ui_config);
            updateSize();
            debouncedLoadImages(node, nodeState, imagePaths, nodeState.initialStates, statusText, uiElements, selectLayer, deselectLayer, updateSize, [], 0, 3, true);
            updateHistory(nodeState);
          } else if (JSON.stringify(newImagePaths) !== JSON.stringify(nodeState.lastImagePaths)) {
            log.info(`Image paths changed for node ${node.id}, new paths: ${JSON.stringify(newImagePaths)}`);
            imagePaths = newImagePaths;
            nodeState.imageNodes = new Array(imagePaths.length).fill(null); // Initialize with nulls
            node.properties.ui_config.image_paths = imagePaths;
            node.properties.image_states = Array.isArray(states) ? states : imagePaths.map(() => ({
              x: borderWidth + boardWidth / 2,
              y: borderWidth + boardHeight / 2,
              scaleX: 1,
              scaleY: 1,
              rotation: 0,
            }));
            nodeState.initialStates = node.properties.image_states;
            node.setProperty('image_states', nodeState.initialStates);
            node.setProperty('ui_config', node.properties.ui_config);
            updateSize();
            debouncedLoadImages(node, nodeState, imagePaths, nodeState.initialStates, statusText, uiElements, selectLayer, deselectLayer, updateSize, [], 0, 3, true);
            updateHistory(nodeState);
          }
          nodeState.lastImagePaths = imagePaths.slice();
        }, 2000);
      }

      // Execution handlers
      node._onNodeExecuted = function () {
        let states = node.properties?.image_states || [];
        let newImagePaths = (node.properties?.ui_config?.image_paths || []).filter(p => typeof p === 'string' && p.trim().length > 0);

        // Log invalid paths for debugging
        const invalidPaths = (node.properties?.ui_config?.image_paths || []).filter(p => !p || typeof p !== 'string' || p.trim().length === 0);
        if (invalidPaths.length) {
          log.warn(`Invalid image paths in onNodeExecuted for node ${node.id}: ${JSON.stringify(invalidPaths)}`);
        }

        if (newImagePaths.length) {
          log.info(`onNodeExecuted for node ${node.id}, new paths: ${JSON.stringify(newImagePaths)}`);
          imagePaths = newImagePaths;
          nodeState.imageNodes = new Array(imagePaths.length).fill(null); // Initialize with nulls
          node.properties.ui_config.image_paths = imagePaths;
          node.properties.image_states = Array.isArray(states) ? states : imagePaths.map(() => ({
            x: borderWidth + boardWidth / 2,
            y: borderWidth + boardHeight / 2,
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
          }));
          nodeState.initialStates = node.properties.image_states;
          node.setProperty('image_states', nodeState.initialStates);
          node.setProperty('ui_config', node.properties.ui_config);
          updateSize();
          debouncedLoadImages(node, nodeState, imagePaths, nodeState.initialStates, statusText, uiElements, selectLayer, deselectLayer, updateSize, [], 0, 3, true);
          updateHistory(nodeState);
        } else {
          statusText.innerText = '无有效图像数据，请检查上游节点';
          statusText.style.color = '#f00';
          log.error(`No valid image paths in onNodeExecuted for node ${node.id}`);
        }
      };

      node.onExecuted = async function (message) {
        let states = message?.image_states || [];
        let newImagePaths = [];
        let fileData = message?.file_data || null;

        if (message?.image_paths) {
          if (typeof message.image_paths === 'string') {
            newImagePaths = message.image_paths.split(',').filter(p => typeof p === 'string' && p.trim().length > 0);
          } else if (Array.isArray(message.image_paths)) {
            newImagePaths = message.image_paths.filter(p => typeof p === 'string' && p.trim().length > 0);
          }
        } else if (message?.pack_images) {
          if (Array.isArray(message.pack_images)) {
            newImagePaths = message.pack_images.filter(p => typeof p === 'string' && p.trim().length > 0);
            log.debug(`Extracted ${newImagePaths.length} image paths from pack_images for node ${node.id}`);
          } else {
            log.warn(`Invalid pack_images format in onExecuted for node ${node.id}: ${typeof message.pack_images}`);
          }
        }

        // Log invalid paths for debugging
        const invalidPaths = (message?.image_paths || []).filter(p => !p || typeof p !== 'string' || p.trim().length === 0);
        if (invalidPaths.length) {
          log.warn(`Invalid image paths in onExecuted for node ${node.id}: ${JSON.stringify(invalidPaths)}`);
        }

        // Process file_data for layer states and names
        if (fileData?.layers?.length) {
          log.info(`Processing file_data for node ${node.id}: ${JSON.stringify(fileData)}`);
          states = fileData.layers.map((layer, i) => {
            if (i >= newImagePaths.length) return null;
            return {
              x: layer.offset_x + borderWidth + (layer.width || 512) / 2,
              y: layer.offset_y + borderWidth + (layer.height || 512) / 2,
              scaleX: layer.scale_x || 1,
              scaleY: layer.scale_y || 1,
              rotation: layer.rotation || 0,
            };
          }).filter(s => s !== null);
          nodeState.file_data = fileData; // Use consistent naming
          log.debug(`Stored file_data in nodeState for node ${node.id}: ${JSON.stringify(nodeState.file_data)}`);
        } else {
          nodeState.file_data = null;
          log.debug(`No valid file_data.layers for node ${node.id}`);
        }

        if (newImagePaths.length) {
          log.info(`onExecuted for node ${node.id}, new paths: ${JSON.stringify(newImagePaths)}`);
          imagePaths = newImagePaths;
          nodeState.imageNodes = new Array(imagePaths.length).fill(null);
          node.properties.ui_config.image_paths = imagePaths;

          // Apply latest states before rendering
          applyStates(nodeState);
          nodeState.imageLayer.batchDraw();

          node.properties.image_states = Array.isArray(states) ? states : nodeState.initialStates;
          nodeState.initialStates = node.properties.image_states;
          node.setProperty('image_states', nodeState.initialStates);
          node.setProperty('ui_config', node.properties.ui_config);
          nodeState.lastImagePaths = imagePaths.slice();

          log.debug(`onExecuted: Loading images for node ${node.id} with ${imagePaths.length} paths`);
          try {
            await loadImages(node, nodeState, imagePaths, nodeState.initialStates, statusText, uiElements, selectLayer, deselectLayer, updateSize, [], 0, 3, true);
            setupLayerEventListeners(node, nodeState);
            setupWheelEvents(node, nodeState);
          } catch (e) {
            log.error(`Failed to load images in onExecuted for node ${node.id}: ${e.message}`);
            statusText.innerText = '图像加载失败';
            statusText.style.color = '#f00';
            return;
          }

          updateSize();
          uiElements.updateLayerPanel(selectLayer, deselectLayer); // Explicitly update layer panel
          updateHistory(nodeState);

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
            return {
              x: state.x - borderWidth,
              y: state.y - borderWidth,
              scale_x: state.scaleX,
              scale_y: state.scaleY,
              rotation: state.rotation,
              image: imageNode.toDataURL(),
            };
          });

          node.outputs = node.outputs || [{ name: 'output', type: 'CANVAS', value: null }];
          node.outputs[0].value = {
            canvas: {
              width: boardWidth,
              height: boardHeight,
            },
            layers,
            image: outputCanvas.toDataURL(),
          };
          log.debug(`Output set for node ${node.id} with dimensions: ${boardWidth}x${boardHeight}, layers: ${layers.length}`);
        } else {
          statusText.innerText = '无有效图像数据，请检查上游节点';
          statusText.style.color = '#f00';
          log.error(`No valid image paths in onExecuted for node ${node.id}`);
        }
      };

      // Cleanup
      node.onRemoved = () => {
        try {
          log.info(`Cleaning up node ${node.id}`);

          // Stop polling
          if (nodeState.pollIntervalId) {
            clearInterval(nodeState.pollIntervalId);
            nodeState.pollIntervalId = null;
            log.debug(`Cleared poll interval for node ${node.id}`);
          }

          // Destroy Konva resources
          destroyKonva(nodeState);

          // Remove UI elements
          if (modal && modal.parentNode) {
            modal.remove();
            log.debug(`Removed modal for node ${node.id}`);
          }
          if (mainContainer && mainContainer.parentNode) {
            mainContainer.remove();
            log.debug(`Removed main container for node ${node.id}`);
          }

          // Remove styles
          const style = document.querySelector(`style[data-node-id="${nodeId}"]`);
          if (style) {
            style.remove();
            log.debug(`Removed styles for node ${node.id}`);
          }

          // Clear node state
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
        nodeState.imageNodes = new Array(imagePaths.length).fill(null); // Initialize with nulls
        debouncedLoadImages(node, nodeState, imagePaths, nodeState.initialStates, statusText, uiElements, selectLayer, deselectLayer, updateSize, [], 0, 3, true);
      } else {
        log.info(`No initial image paths, waiting for images`);
        statusText.innerText = '等待图片数据...';
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
    log.debug(`Node ${node.id} marked for initialization`);
  },
});