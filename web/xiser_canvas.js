/**
 * @fileoverview Main entry point for the XISER_Canvas ComfyUI extension, handling node lifecycle and UI/Konva integration.
 * @module xiser_canvas
 */

import { app } from "/scripts/app.js";
import { initializeUI } from "./canvas_ui.js";
import { initializeKonva, selectLayer, deselectLayer, applyStates, destroyKonva } from "./canvas_konva.js";
import { loadImages } from "./canvas_images.js";
import { log, createNodeState, initializeCanvasProperties, debounce, throttle } from "./canvas_state.js";
import { updateHistory, undo, redo, resetCanvas, setupLayerEventListeners } from "./canvas_history.js";

/**
 * Registers the XISER_Canvas extension with ComfyUI.
 */
app.registerExtension({
  name: "xiser.canvas",
  /**
   * Sets up the extension, loads Konva.js, and overrides ComfyUI event handlers.
   * @async
   */
  async setup() {
    log.info("Extension loaded");

    // Polyfill for requestIdleCallback
    if (!window.requestIdleCallback) {
      window.requestIdleCallback = (callback) => setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 50 }), 1);
      window.cancelIdleCallback = (id) => clearTimeout(id);
    }

    // Load Konva.js
    if (!window.Konva) {
      try {
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "/extensions/ComfyUI_XISER_Nodes/lib/konva.min.js";
          script.onload = () => {
            log.info("Konva.js loaded successfully");
            if (!window.Konva) reject(new Error("Konva.js loaded but window.Konva is undefined"));
            else resolve();
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

    // Override onNodeExecuted
    const originalOnNodeExecuted = app.graph.onNodeExecuted || (() => {});
    app.graph.onNodeExecuted = function (node) {
      originalOnNodeExecuted.apply(this, arguments);
      if (node._onNodeExecuted) node._onNodeExecuted(node);
    };

    // Define node initialization logic
    const initializeNode = async (node) => {
      if (node.comfyClass !== "XISER_Canvas") return;
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

      // Clean up any residual containers with matching nodeId
      document.querySelectorAll(`.xiser-main-container[data-nodeId="${node.id}"]`).forEach(container => {
        log.info(`Cleaning up residual container with nodeId ${node.id}`);
        container.remove();
      });

      // Initialize node state
      const nodeId = node.id;
      const nodeState = createNodeState(nodeId, app);
      nodeState.firstImageDimensions = { width: 0, height: 0 }; // Track first image dimensions
      nodeState.imageNodes = nodeState.imageNodes || []; // Ensure imageNodes is initialized
      nodeState.isInteracting = false; // Track drag/transform interaction state
      node._state = nodeState; // Attach state to node for cleanup

      // Initialize UI
      const uiElements = initializeUI(node, nodeState);
      const { mainContainer, boardContainer, statusText, layerPanel, modal } = uiElements;

      // Disable ComfyUI canvas zoom on wheel
      boardContainer.addEventListener('wheel', (e) => {
        e.stopPropagation();
        log.debug(`Wheel zoom stopped for node ${node.id}`);
      }, { passive: true });

      // Initialize canvas properties
      let { imagePaths, autoSize, boardWidth, boardHeight } = initializeCanvasProperties(node, nodeState);
      let { borderWidth, canvasColor, borderColor, canvasColorValue, uiConfig } = initializeCanvasProperties(node, nodeState);

      // Initialize Konva stage
      const konvaElements = initializeKonva(node, nodeState, boardContainer, boardWidth, boardHeight, borderWidth, canvasColorValue, borderColor);
      Object.assign(nodeState, konvaElements);

      // Initialize layer states
      nodeState.initialStates = node.properties.image_states || [];

      // Create debounced loadImages function
      const debouncedLoadImages = debounce(loadImages, 300);

      // Handle node collapse/expand
      const originalCollapse = node.collapse;
      node.collapse = function () {
        originalCollapse.apply(this, arguments);
        if (node.collapsed) {
          log.debug(`Node ${node.id} collapsed, hiding mainContainer and modal`);
          if (mainContainer) mainContainer.style.display = 'none';
          if (modal) modal.style.display = 'none';
        } else {
          log.debug(`Node ${node.id} expanded, showing mainContainer and modal`);
          if (mainContainer) mainContainer.style.display = 'block';
          if (modal) modal.style.display = nodeState.modalVisible ? 'block' : 'none';
          syncContainerPosition(node);
        }
      };

      /**
       * Synchronizes the container position with the ComfyUI canvas using CSS transforms for better performance.
       * @param {Object} targetNode - The node whose position needs to be synced.
       */
      const syncContainerPosition = throttle((targetNode) => {
        if (!targetNode || !app.canvas || !app.canvas.canvas || !targetNode.pos || !nodeState.stage) return;
        if (targetNode.id !== node.id) return; // Ensure we only update the correct node's container

        requestAnimationFrame(() => {
          try {
            const canvas = app.canvas.canvas;
            const canvasRect = canvas.getBoundingClientRect();
            const nodePos = targetNode.pos;
            const scale = app.canvas.ds.scale || 1;
            const offset = app.canvas.ds.offset || [0];

            const logicalX = (nodePos[0] + offset[0]) * scale;
            const logicalY = (nodePos[1] + offset[1]) * scale;
            const x = canvasRect.left + logicalX + 20 * scale; // 20px left margin
            const y = canvasRect.top + logicalY + 186 * scale;

            // Use transform for better performance instead of top/left
            mainContainer.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
            mainContainer.style.transformOrigin = '0 0';

            log.debug(`Container position synced for node ${targetNode.id}: x=${x}, y=${y}`);
          } catch (e) {
            log.error(`Error syncing container position for node ${targetNode.id}:`, e);
          }
        });
      }, 16); // Throttle to ~60fps (16ms)

      /**
       * Updates the canvas size and properties, triggering a full redraw.
       */
      function updateSize() {
        try {
          let boardWidth = Math.min(Math.max(parseInt(node.properties.ui_config.board_width) || 1024, 256), 4096);
          let boardHeight = Math.min(Math.max(parseInt(node.properties.ui_config.board_height) || 1024, 256), 4096);
          let borderWidth = Math.min(Math.max(parseInt(node.properties.ui_config.border_width) || 40, 10), 200);
          let canvasColorValue = node.widgets.find(w => w.name === "canvas_color")?.value || "black";
          let canvasColor = { black: "rgb(0, 0, 0)", white: "rgb(255, 255, 255)", transparent: "rgba(0, 0, 0, 0)" }[canvasColorValue] || "rgb(0, 0, 0)";
          let borderColor = { black: "rgb(25, 25, 25)", white: "rgb(230, 230, 230)", transparent: "rgba(0, 0, 0, 0)" }[canvasColorValue] || "rgb(25, 25, 25)";
          let autoSize = node.widgets.find(w => w.name === "auto_size")?.value || "off";

          // Update node properties to ensure persistence
          node.properties.ui_config.board_width = boardWidth;
          node.properties.ui_config.board_height = boardHeight;
          node.properties.ui_config.border_width = borderWidth;
          node.properties.ui_config.canvas_color = canvasColor;
          node.properties.ui_config.border_color = borderColor;
          node.properties.ui_config.auto_size = autoSize;
          node.setProperty("ui_config", node.properties.ui_config);

          log.debug(`Updating canvas size for node ${node.id}: boardWidth=${boardWidth}, boardHeight=${boardHeight}, borderWidth=${borderWidth}, autoSize=${autoSize}`);

          // Update widgets
          node.widgets.forEach((widget) => {
            if (widget.name === "board_width") widget.value = boardWidth;
            if (widget.name === "board_height") widget.value = boardHeight;
            if (widget.name === "border_width") widget.value = borderWidth;
            if (widget.name === "canvas_color" && widget.value !== canvasColorValue) widget.value = canvasColorValue;
            if (widget.name === "auto_size") {
              widget.value = autoSize;
              widget.disabled = false; // Always enable auto_size for manual control
            }
            if (widget.name === "image_states") widget.value = JSON.stringify(nodeState.initialStates);
          });
          node.widgets_values = [boardWidth, boardHeight, borderWidth, canvasColorValue, autoSize, JSON.stringify(nodeState.initialStates)];

          // Update canvas dimensions
          const containerWidth = boardWidth + 2 * borderWidth;
          const containerHeight = boardHeight + 2 * borderWidth;

          // Force DOM size update
          boardContainer.style.width = `${containerWidth}px`;
          boardContainer.style.height = `${containerHeight}px`;
          boardContainer.style.minWidth = `${containerWidth}px`;
          boardContainer.style.minHeight = `${containerHeight}px`;
          mainContainer.style.width = `${containerWidth}px`;
          mainContainer.style.height = `${containerHeight}px`;
          mainContainer.style.minWidth = `${containerWidth}px`;
          mainContainer.style.minHeight = `${containerHeight}px`;

          nodeState.stage.width(containerWidth);
          nodeState.stage.height(containerHeight);
          nodeState.borderRect.setAttrs({ x: 0, y: 0, width: containerWidth, height: containerHeight, fill: borderColor });
          nodeState.canvasRect.setAttrs({ x: borderWidth, y: borderWidth, width: boardWidth, height: boardHeight, fill: canvasColor });
          nodeState.borderFrame.setAttrs({ x: borderWidth, y: borderWidth, width: boardWidth, height: boardHeight });

          // Update image states if no file_data
          if (!nodeState.initialStates.length || nodeState.initialStates.length !== imagePaths.length) {
            nodeState.initialStates = imagePaths.map(() => ({
              x: borderWidth + boardWidth / 2,
              y: borderWidth + boardHeight / 2,
              scaleX: 1,
              scaleY: 1,
              rotation: 0
            }));
          }
          applyStates(nodeState);

          // Sync image_states and widget
          node.widgets.find(w => w.name === "image_states").value = JSON.stringify(nodeState.initialStates);

          const nodeWidth = containerWidth + 40; // 20px left + 20px right
          const nodeHeight = containerHeight + 206;
          node.size = [nodeWidth, nodeHeight];
          node.setSize([nodeWidth, nodeHeight]);
          log.debug(`Canvas size updated for node ${node.id}: board=${boardWidth}x${boardHeight}, node=${nodeWidth}x${nodeHeight}`);

          // Only redraw when size changes
          nodeState.canvasLayer.batchDraw();
          nodeState.imageLayer.batchDraw();
          nodeState.borderLayer.batchDraw();
          nodeState.stage.draw();

          uiElements.updateLayerPanel(selectLayer, deselectLayer);
          syncContainerPosition(node);

          updateHistory(nodeState); // Capture size changes in history
        } catch (e) {
          log.error(`Error updating size for node ${node.id}:`, e);
          statusText.innerText = `更新画板失败: ${e.message}`;
          statusText.style.color = "#f00";
        }
      }

      /**
       * Triggers the ComfyUI prompt with updated states.
       * @async
       */
      async function triggerPrompt() {
        try {
          let newImagePaths = node.properties?.ui_config?.image_paths || [];
          let dimensionChanged = false;
          let sizeChanged = false;

          // Check for first image dimension changes
          if (autoSize === "on" && newImagePaths.length && nodeState.imageNodes.length) {
            const firstImage = nodeState.imageNodes[0];
            const currentWidth = firstImage.width();
            const currentHeight = firstImage.height();
            if (currentWidth !== nodeState.firstImageDimensions.width || currentHeight !== nodeState.firstImageDimensions.height) {
              dimensionChanged = true;
              nodeState.firstImageDimensions = { width: currentWidth, height: currentHeight };
              log.debug(`First image dimensions changed for node ${node.id}: ${currentWidth}x${currentHeight}`);
            }
          }

          // Check for canvas size changes
          const currentBoardWidth = node.properties.ui_config.board_width || 1024;
          const currentBoardHeight = node.properties.ui_config.board_height || 1024;
          if (currentBoardWidth !== boardWidth || currentBoardHeight !== boardHeight) {
            sizeChanged = true;
            boardWidth = currentBoardWidth;
            boardHeight = currentBoardHeight;
            node.properties.ui_config.board_width = boardWidth;
            node.properties.ui_config.board_height = boardHeight;
            node.setProperty("ui_config", node.properties.ui_config);
            log.debug(`Canvas size changed for node ${node.id}: ${boardWidth}x${boardHeight}`);
          }

          if (JSON.stringify(newImagePaths) !== JSON.stringify(imagePaths) || dimensionChanged || sizeChanged) {
            imagePaths = newImagePaths;
            if (!nodeState.initialStates.length || nodeState.initialStates.length !== imagePaths.length) {
              nodeState.initialStates = imagePaths.map(() => ({
                x: borderWidth + boardWidth / 2,
                y: borderWidth + boardHeight / 2,
                scaleX: 1,
                scaleY: 1,
                rotation: 0
              }));
            }
          }

          if (autoSize === "on" && imagePaths.length) {
            statusText.innerText = "正在调整画板并重置...";
            statusText.style.color = "#fff";
            await debouncedLoadImages(node, nodeState, imagePaths, nodeState.initialStates, statusText, uiElements, selectLayer, deselectLayer, updateSize);
            boardWidth = node.properties.ui_config.board_width || 1024;
            boardHeight = node.properties.ui_config.board_height || 1024;
            borderWidth = node.properties.ui_config.border_width || 40;
            nodeState.initialStates = imagePaths.map(() => ({
              x: borderWidth + boardWidth / 2,
              y: borderWidth + boardHeight / 2,
              scaleX: 1,
              scaleY: 1,
              rotation: 0
            }));
            applyStates(nodeState);
            statusText.innerText = "调整完成，准备渲染...";
          } else if (sizeChanged) {
            nodeState.initialStates = nodeState.initialStates.map((state, i) => ({
              x: borderWidth + boardWidth / 2,
              y: borderWidth + boardHeight / 2,
              scaleX: state.scaleX || 1,
              scaleY: state.scaleY || 1,
              rotation: state.rotation || 0
            }));
            applyStates(nodeState);
            node.properties.image_states = nodeState.initialStates;
            node.widgets.find(w => w.name === "image_states").value = JSON.stringify(nodeState.initialStates);
            node.setProperty("image_states", nodeState.initialStates);
          }

          nodeState.initialStates = nodeState.initialStates.slice(0, imagePaths.length);
          node.properties.image_states = nodeState.initialStates;
          node.widgets.find(w => w.name === "image_states").value = JSON.stringify(nodeState.initialStates);
          node.setProperty("image_states", nodeState.initialStates);
          node.widgets_values = [boardWidth, boardHeight, borderWidth, canvasColorValue, autoSize, JSON.stringify(nodeState.initialStates)];

          app.queuePrompt?.();
          statusText.innerText = "渲染中...";
          statusText.style.color = "#fff";
        } catch (e) {
          log.error(`Failed to queue prompt for node ${node.id}:`, e);
          statusText.innerText = "触发队列失败";
          statusText.style.color = "#f00";
        }
      }

      // Bind methods to nodeState
      nodeState.triggerPrompt = triggerPrompt;
      nodeState.resetCanvas = () => resetCanvas(node, nodeState, imagePaths, updateSize);
      nodeState.undo = () => undo(node, nodeState);
      nodeState.redo = () => redo(node, nodeState);
      nodeState.updateHistory = () => updateHistory(nodeState);
      nodeState.setupLayerEventListeners = () => setupLayerEventListeners(node, nodeState);

      // Initialize node properties and widgets
      node.widgets = [];
      node.inputs = node.inputs || {};
      node.inputs.board_width = node.inputs.board_width || { value: boardWidth, type: "INT" };
      node.inputs.board_height = node.inputs.board_height || { value: boardHeight, type: "INT" };
      node.inputs.border_width = node.inputs.border_width || { value: borderWidth, type: "INT" };
      node.inputs.canvas_color = node.inputs.canvas_color || { value: canvasColorValue, type: "STRING" };
      node.inputs.auto_size = node.inputs.auto_size || { value: autoSize, type: "STRING" };
      node.inputs.file_data = node.inputs.file_data || { value: null, type: "FILE_DATA" };

      const nodeWidth = boardWidth + 2 * borderWidth + 40;
      const nodeHeight = boardHeight + 2 * borderWidth + 206;
      node.size = [nodeWidth, nodeHeight];
      node.setSize([nodeWidth, nodeHeight]);

      node.widgets_values = [boardWidth, boardHeight, borderWidth, canvasColorValue, autoSize, JSON.stringify(nodeState.initialStates)];

      const boardWidthWidget = node.addWidget("number", "board_width", boardWidth, (value) => {
        boardWidth = Math.min(Math.max(parseInt(value), 256), 4096);
        node.properties.ui_config.board_width = boardWidth;
        log.debug(`Board width changed to ${boardWidth} for node ${node.id}`);
        updateSize();
      }, { min: 256, max: 4096, step: 10, precision: 0 });

      const boardHeightWidget = node.addWidget("number", "board_height", boardHeight, (value) => {
        boardHeight = Math.min(Math.max(parseInt(value), 256), 4096);
        node.properties.ui_config.board_height = boardHeight;
        log.debug(`Board height changed to ${boardHeight} for node ${node.id}`);
        updateSize();
      }, { min: 256, max: 4096, step: 10, precision: 0 });

      const borderWidthWidget = node.addWidget("number", "border_width", borderWidth, (value) => {
        borderWidth = Math.min(Math.max(parseInt(value), 10), 200);
        node.properties.ui_config.border_width = borderWidth;
        log.debug(`Border width changed to ${borderWidth} for node ${node.id}`);
        updateSize();
      }, { min: 10, max: 200, step: 2, precision: 0 });

      node.addWidget("combo", "canvas_color", canvasColorValue, (value) => {
        canvasColorValue = value;
        updateSize();
      }, { values: ["black", "white", "transparent"] });

      const autoSizeWidget = node.addWidget("combo", "auto_size", autoSize, (value) => {
        autoSize = value;
        node.properties.ui_config.auto_size = autoSize;
        log.debug(`Auto_size changed to ${autoSize} for node ${node.id}`);
        boardWidthWidget.disabled = (autoSize === "on");
        boardHeightWidget.disabled = (autoSize === "on");
        if (autoSize === "on" && imagePaths.length) {
          log.debug(`Auto_size toggled to on for node ${node.id}, triggering debounced loadImages`);
          debouncedLoadImages(node, nodeState, imagePaths, nodeState.initialStates, statusText, uiElements, selectLayer, deselectLayer, updateSize);
        } else {
          updateSize();
        }
      }, { values: ["off", "on"] });

      node.addWidget("hidden", "image_states", JSON.stringify(nodeState.initialStates), () => {}, { serialize: true });

      // Disable widgets based on auto_size
      boardWidthWidget.disabled = (autoSize === "on");
      boardHeightWidget.disabled = (autoSize === "on");
      borderWidthWidget.disabled = false; // Always enable border_width for manual adjustment
      autoSizeWidget.disabled = false;

      // Polling for image updates
      function startPolling() {
        if (nodeState.pollInterval) clearInterval(nodeState.pollInterval);
        nodeState.pollInterval = setInterval(() => {
          let newImagePaths = node.properties?.ui_config?.image_paths || [];
          let states = node.properties?.image_states || [];

          if (newImagePaths.length && !nodeState.lastImagePaths.length) {
            log.info(`Forcing initial load for new node ${node.id}, new paths: ${JSON.stringify(newImagePaths)}`);
            imagePaths = newImagePaths;
            node.properties.ui_config.image_paths = imagePaths;
            node.properties.image_states = states.length ? states : imagePaths.map(() => ({
              x: borderWidth + boardWidth / 2,
              y: borderWidth + boardHeight / 2,
              scaleX: 1,
              scaleY: 1,
              rotation: 0
            }));
            nodeState.initialStates = node.properties.image_states;
            node.setProperty("image_states", nodeState.initialStates);
            node.setProperty("ui_config", node.properties.ui_config);
            updateSize();
            debouncedLoadImages(node, nodeState, imagePaths, nodeState.initialStates, statusText, uiElements, selectLayer, deselectLayer, updateSize);
            updateHistory(nodeState);
          } else if (JSON.stringify(newImagePaths) !== JSON.stringify(nodeState.lastImagePaths)) {
            log.info(`Image paths changed for node ${node.id}, new paths: ${JSON.stringify(newImagePaths)}`);
            imagePaths = newImagePaths;
            node.properties.ui_config.image_paths = imagePaths;
            node.properties.image_states = states.length ? states : imagePaths.map(() => ({
              x: borderWidth + boardWidth / 2,
              y: borderWidth + boardHeight / 2,
              scaleX: 1,
              scaleY: 1,
              rotation: 0
            }));
            nodeState.initialStates = node.properties.image_states;
            node.setProperty("image_states", nodeState.initialStates);
            node.setProperty("ui_config", node.properties.ui_config);
            updateSize();
            debouncedLoadImages(node, nodeState, imagePaths, nodeState.initialStates, statusText, uiElements, selectLayer, deselectLayer, updateSize);
            updateHistory(nodeState);
          }
          nodeState.lastImagePaths = imagePaths.slice();
        }, 1000);
      }

      // Add event listeners for canvas alignment
      const onCanvasUpdate = () => {
        syncContainerPosition(node);
        log.debug(`Canvas updated, synced position for node ${node.id}`);
      };

      const onNodeDrag = () => {
        syncContainerPosition(node);
        log.debug(`Node ${node.id} dragged, synced position`);
      };

      // Append to app.canvas.onDrawBackground instead of overwriting
      if (!app.canvas._xiserCanvasListeners) {
        app.canvas._xiserCanvasListeners = new Set();
      }
      app.canvas._xiserCanvasListeners.add(onCanvasUpdate);
      app.canvas.onDrawBackground = () => {
        app.canvas._xiserCanvasListeners.forEach(listener => listener());
      };

      // Bind onDrag for this specific node
      node.onDrag = onNodeDrag;

      // Bind window resize event
      window.addEventListener("resize", onCanvasUpdate);

      startPolling();

      // Execution handlers
      node._onNodeExecuted = function() {
        let states = node.properties?.image_states || [];
        let newImagePaths = node.properties?.ui_config?.image_paths || [];
        if (newImagePaths.length) {
          log.info(`onNodeExecuted for node ${node.id}, new paths: ${JSON.stringify(newImagePaths)}`);
          imagePaths = newImagePaths;
          node.properties.ui_config.image_paths = imagePaths;
          node.properties.image_states = states.length ? states : imagePaths.map(() => ({
            x: borderWidth + boardWidth / 2,
            y: borderWidth + boardHeight / 2,
            scaleX: 1,
            scaleY: 1,
            rotation: 0
          }));
          nodeState.initialStates = node.properties.image_states;
          node.setProperty("image_states", nodeState.initialStates);
          node.setProperty("ui_config", node.properties.ui_config);
          updateSize();
          debouncedLoadImages(node, nodeState, imagePaths, nodeState.initialStates, statusText, uiElements, selectLayer, deselectLayer, updateSize);
          updateHistory(nodeState);
        } else {
          statusText.innerText = "无有效图像数据，请检查上游节点";
          statusText.style.color = "#f00";
          log.error(`No valid image paths in onNodeExecuted for node ${node.id}`);
        }
      };

      /**
       * Handles node execution, updating image paths and states, and setting output.
       * @param {Object} message - Execution message containing image_states and image_paths.
       */
      node.onExecuted = async function(message) {
        let states = message?.image_states || [];
        let newImagePaths = node.properties?.ui_config?.image_paths || [];
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
          node.properties.image_states = states.length ? states : imagePaths.map(() => ({
            x: borderWidth + boardWidth / 2,
            y: borderWidth + boardHeight / 2,
            scaleX: 1,
            scaleY: 1,
            rotation: 0
          }));
          nodeState.initialStates = node.properties.image_states;
          node.setProperty("image_states", nodeState.initialStates);
          nodeState.lastImagePaths = imagePaths.slice();

          // Ensure images are loaded before accessing imageNodes
          if (!nodeState.imageNodes.length || nodeState.imageNodes.length !== imagePaths.length) {
            log.debug(`onExecuted: Image nodes not ready for node ${node.id}, forcing synchronous load`);
            try {
              await loadImages(node, nodeState, imagePaths, nodeState.initialStates, statusText, uiElements, selectLayer, deselectLayer, updateSize);
              nodeState.setupLayerEventListeners(); // Setup listeners after loading images
            } catch (e) {
              log.error(`Failed to load images synchronously in onExecuted for node ${node.id}:`, e);
              statusText.innerText = "图像加载失败";
              statusText.style.color = "#f00";
              return;
            }
          }

          updateSize();
          debouncedLoadImages(node, nodeState, imagePaths, nodeState.initialStates, statusText, uiElements, selectLayer, deselectLayer, updateSize);
          updateHistory(nodeState);

          // Set output dimensions to match current canvas
          const outputCanvas = nodeState.stage.toCanvas();
          const layers = nodeState.initialStates.map((state, index) => {
            const imageNode = nodeState.imageNodes[index];
            if (!imageNode) {
              log.error(`Image node at index ${index} is undefined for node ${node.id}`);
              return {
                x: state.x - borderWidth,
                y: state.y - borderWidth,
                scale_x: state.scaleX,
                scale_y: state.scaleY,
                rotation: state.rotation,
                image: null // Fallback to null if imageNode is undefined
              };
            }
            return {
              x: state.x - borderWidth,
              y: state.y - borderWidth,
              scale_x: state.scaleX,
              scale_y: state.scaleY,
              rotation: state.rotation,
              image: imageNode.toDataURL()
            };
          });

          node.outputs[0].value = {
            canvas: {
              width: boardWidth,
              height: boardHeight
            },
            layers: layers,
            image: outputCanvas.toDataURL()
          };
          log.debug(`Output set for node ${node.id} with dimensions: ${boardWidth}x${boardHeight}, layers: ${layers.length}`);
        } else {
          statusText.innerText = "无有效图像数据，请检查上游节点";
          statusText.style.color = "#f00";
          log.error(`No valid image paths in onExecuted for node ${node.id}`);
        }
      };

      // Cleanup
      node.onRemoved = () => {
        if (nodeState.pollInterval) clearInterval(nodeState.pollInterval);
        if (nodeState.stage) {
          destroyKonva(nodeState);
        }
        // Remove event listeners
        app.canvas._xiserCanvasListeners.delete(onCanvasUpdate);
        if (app.canvas._xiserCanvasListeners.size === 0) {
          app.canvas.onDrawBackground = null;
        }
        node.onDrag = null;
        window.removeEventListener("resize", onCanvasUpdate);
        if (mainContainer && mainContainer.parentNode) mainContainer.remove();
        if (modal && modal.parentNode) modal.remove();
        document.querySelectorAll(`.xiser-main-container[data-nodeId="${node.id}"]`).forEach(container => {
          log.info(`Cleaning up container with nodeId ${node.id} during node removal`);
          container.remove();
        });
        log.info(`Node ${node.id} removed, resources cleaned`);
      };

      // Initial load
      updateSize();
      syncContainerPosition(node);
      if (imagePaths.length) {
        log.info(`Initial loadImages call with paths: ${JSON.stringify(imagePaths)}`);
        debouncedLoadImages(node, nodeState, imagePaths, nodeState.initialStates, statusText, uiElements, selectLayer, deselectLayer, updateSize);
      } else {
        log.info(`No initial image paths, waiting for onExecuted or polling`);
        statusText.innerText = "等待上游节点提供图像...";
        statusText.style.color = "";
      }
    };

    // Register onNodeAdded handler
    const originalOnNodeAdded = app.graph.onNodeAdded || (() => {});
    app.graph.onNodeAdded = function (node) {
      originalOnNodeAdded.apply(this, arguments);
      initializeNode(node);
      // After adding a new node, force position sync for all existing nodes
      app.graph.nodes.forEach(existingNode => {
        if (existingNode.comfyClass === "XISER_Canvas" && existingNode._isInitialized && existingNode._state) {
          const existingState = existingNode._state;
          if (existingState.syncContainerPosition) {
            existingState.syncContainerPosition(existingNode);
            log.debug(`Forced position sync for existing node ${existingNode.id} after node added`);
          }
        }
      });
    };

    // Handle existing nodes (e.g., during graph load)
    app.graph.nodes.forEach(node => {
      if (node.comfyClass === "XISER_Canvas" && !node._isInitialized) {
        initializeNode(node);
      }
    });
  },

  /**
   * Minimal nodeCreated hook to mark nodes.
   * @param {Object} node - The ComfyUI node instance.
   */
  async nodeCreated(node) {
    if (node.comfyClass !== "XISER_Canvas") return;
    node._isInitialized = false; // Mark node for initialization
    log.debug(`Node ${node.id} marked for initialization`);
  }
});