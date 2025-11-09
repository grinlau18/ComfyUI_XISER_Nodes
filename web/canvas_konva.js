/**
 * @fileoverview Manages Konva.js stage, layers, and event handlers for the XISER_Canvas node.
 * @module canvas_konva
 */

import { log } from './canvas_state.js';
import { updateHistory } from './canvas_history.js';

/**
 * Initializes the Konva.js stage and layers for the canvas.
 * @param {Object} node - The ComfyUI node instance.
 * @param {Object} nodeState - The node state object containing log and other properties.
 * @param {HTMLDivElement} boardContainer - The container for the stage.
 * @param {number} boardWidth - Canvas width.
 * @param {number} boardHeight - Canvas height.
 * @param {number} borderWidth - Border width.
 * @param {string} canvasColor - Canvas color.
 * @param {string} borderColor - Border color.
 * @returns {Object} Konva stage and layer objects.
 * @throws {Error} If Konva.js is not loaded.
 */
export function initializeKonva(node, nodeState, boardContainer, boardWidth, boardHeight, borderWidth, canvasColor, borderColor) {
  const log = nodeState.log || console;

  // Define step constants for wheel interactions
  const ROTATION_STEP = 1; // Rotation step size (1 degree)
  const SCALE_STEP = 0.01; // Scaling step size (1%)

  if (!window.Konva) {
    log.error(`Konva.js not available for node ${node.id}`);
    throw new Error('Konva.js not loaded');
  }

  const stageContainer = document.createElement('div');
  stageContainer.className = `xiser-canvas-stage-${node.id}`;
  boardContainer.appendChild(stageContainer);

  const stage = new Konva.Stage({
    container: stageContainer,
    width: boardWidth + 2 * borderWidth,
    height: boardHeight + 2 * borderWidth,
  });

  const canvasLayer = new Konva.Layer();
  const imageLayer = new Konva.Layer();
  const borderLayer = new Konva.Layer();
  stage.add(canvasLayer);
  stage.add(imageLayer);
  stage.add(borderLayer);

  const canvasRect = new Konva.Rect({
    x: borderWidth,
    y: borderWidth,
    width: boardWidth,
    height: boardHeight,
    fill: canvasColor,
    listening: false,
  });

  const borderRect = new Konva.Rect({
    x: 0,
    y: 0,
    width: boardWidth + 2 * borderWidth,
    height: boardHeight + 2 * borderWidth,
    fill: borderColor,
    stroke: '#808080',
    strokeWidth: 2,
    listening: false,
  });

  const borderFrame = new Konva.Rect({
    x: borderWidth,
    y: borderWidth,
    width: boardWidth,
    height: boardHeight,
    stroke: '#808080',
    strokeWidth: 2,
    fill: null,
    listening: false,
  });

  canvasLayer.add(borderRect);
  canvasLayer.add(canvasRect);
  borderLayer.add(borderFrame);

  // Initialize transformer with scaling and rotation capabilities
  nodeState.transformer = new Konva.Transformer({
    nodes: [],
    keepRatio: false, // Allow independent scaling
    enabledAnchors: [
      'top-left', 'top-center', 'top-right',
      'middle-left', 'middle-right',
      'bottom-left', 'bottom-center', 'bottom-right'
    ],
    rotateEnabled: true,
    rotateAnchorOffset: 40,
    borderEnabled: true,
    borderStroke: '#0099ff',
    borderStrokeWidth: 2,
    anchorStroke: '#0099ff',
    anchorStrokeWidth: 2,
    anchorFill: '#ffffff',
    anchorSize: 8,
    anchorCornerRadius: 2,
    // Enable scaling and rotation only (disable skew)
    transform: 'scale-rotate', // Enable scaling and rotation only
    boundBoxFunc: (oldBox, newBox) => {
      if (newBox.width < 10 || newBox.height < 10) {
        return oldBox;
      }
      return newBox;
    },
  });
  imageLayer.add(nodeState.transformer);

  // Event handlers for stage
  stage.on('click tap', (e) => {
    const target = e.target;
    if (target === canvasRect || target === stage || target === borderRect) {
      deselectLayer(nodeState);
      return;
    }
    if (nodeState.imageNodes.includes(target) && target) {
      const index = nodeState.imageNodes.indexOf(target);
      selectLayer(nodeState, index);
    }
  });

  stage.on('mousedown', (e) => {
    const target = e.target;
    if (nodeState.imageNodes.includes(target) && target) {
      const index = nodeState.imageNodes.indexOf(target);
      selectLayer(nodeState, index);
    }
  });

  log.info(`Konva stage initialized for node ${node.id} with size ${boardWidth}x${boardHeight}`);
  return {
    stage,
    canvasLayer,
    imageLayer,
    borderLayer,
    canvasRect,
    borderRect,
    borderFrame,
  };
}

/**
 * Resizes the Konva stage and updates layer dimensions.
 * @param {Object} nodeState - The node state object.
 * @param {number} boardWidth - New canvas width.
 * @param {number} boardHeight - New canvas height.
 * @param {number} borderWidth - Border width.
 * @param {string} canvasColor - Canvas color.
 * @param {string} borderColor - Border color.
 */
export function resizeStage(nodeState, boardWidth, boardHeight, borderWidth, canvasColor, borderColor) {
  const log = nodeState.log || console;
  if (!nodeState.stage) {
    log.error(`Cannot resize stage: stage is null for node ${nodeState.nodeId}`);
    return;
  }

  // Validate dimensions
  boardWidth = Math.min(Math.max(parseInt(boardWidth) || 1024, 256), 8192);
  boardHeight = Math.min(Math.max(parseInt(boardHeight) || 1024, 256), 8192);
  borderWidth = Math.min(Math.max(parseInt(borderWidth) || 40, 10), 200);

  const containerWidth = boardWidth + 2 * borderWidth;
  const containerHeight = boardHeight + 2 * borderWidth;

  log.debug(`Resizing stage for node ${nodeState.nodeId}: board=${boardWidth}x${boardHeight}, container=${containerWidth}x${containerHeight}`);

  nodeState.stage.width(containerWidth);
  nodeState.stage.height(containerHeight);

  nodeState.borderRect.setAttrs({
    x: 0,
    y: 0,
    width: containerWidth,
    height: containerHeight,
    fill: borderColor,
  });

  nodeState.canvasRect.setAttrs({
    x: borderWidth,
    y: borderWidth,
    width: boardWidth,
    height: boardHeight,
    fill: canvasColor,
  });

  nodeState.borderFrame.setAttrs({
    x: borderWidth,
    y: borderWidth,
    width: boardWidth,
    height: boardHeight,
  });

  // Preserve existing image states
  const validNodes = nodeState.imageNodes.filter(node => node !== null);
  validNodes.forEach((node, i) => {
    if (!nodeState.initialStates[i]) {
      log.warn(`No initial state for image node ${i} in node ${nodeState.nodeId}, using defaults`);
      nodeState.initialStates[i] = {
        x: borderWidth + boardWidth / 2,
        y: borderWidth + boardHeight / 2,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
      };
    }
    // Apply preserved states
    node.x(nodeState.initialStates[i].x);
    node.y(nodeState.initialStates[i].y);
    node.scaleX(nodeState.initialStates[i].scaleX || 1);
    node.scaleY(nodeState.initialStates[i].scaleY || 1);
    node.rotation(nodeState.initialStates[i].rotation || 0);
  });

  nodeState.canvasLayer.batchDraw();
  nodeState.imageLayer.batchDraw();
  nodeState.borderLayer.batchDraw();
  nodeState.stage.draw();

  log.info(`Stage resized for node ${nodeState.nodeId}: ${containerWidth}x${containerHeight}`);
}

/**
 * Destroys the Konva stage and related elements.
 * @param {Object} nodeState - The node state object.
 */
export function destroyKonva(nodeState) {
  const log = nodeState.log || console;
  try {
    if (!nodeState.stage) {
      log.debug(`No Konva stage to destroy for node ${nodeState.nodeId}`);
      return;
    }

    // Remove event listeners
    nodeState.stage.off('click tap mousedown wheel');

    // Destroy transformer
    if (nodeState.transformer) {
      nodeState.transformer.off('transform transformend');
      nodeState.transformer.nodes([]);
      nodeState.transformer.destroy();
      nodeState.transformer = null;
    }

    // Destroy image nodes (event listeners handled by cleanupLayerEventListeners)
    nodeState.imageNodes.forEach((node, i) => {
      if (node) {
        node.destroy();
      } else {
        log.warn(`Null imageNode at index ${i} during cleanup for node ${nodeState.nodeId}`);
      }
    });
    nodeState.imageNodes = [];

    // Destroy layers
    if (nodeState.canvasLayer) {
      nodeState.canvasLayer.destroy();
      nodeState.canvasLayer = null;
    }
    if (nodeState.imageLayer) {
      nodeState.imageLayer.destroy();
      nodeState.imageLayer = null;
    }
    if (nodeState.borderLayer) {
      nodeState.borderLayer.destroy();
      nodeState.borderLayer = null;
    }

    // Clear references
    nodeState.canvasRect = null;
    nodeState.borderRect = null;
    nodeState.borderFrame = null;
    nodeState.selectedLayer = null;
    nodeState.layerItems = [];

    // Destroy stage
    const stageContainer = nodeState.stage.container();
    nodeState.stage.destroy();
    nodeState.stage = null;

    // Remove stage container
    if (stageContainer && stageContainer.parentNode) {
      stageContainer.remove();
    }

    log.info(`Konva stage and resources destroyed for node ${nodeState.nodeId}`);
  } catch (e) {
    log.error(`Error destroying Konva stage for node ${nodeState.nodeId}: ${e.message}`);
  }
}

/**
 * Selects a layer by index and updates the UI accordingly.
 * @param {Object} nodeState - The node state object containing image nodes and layer items.
 * @param {number} index - The index of the layer in imageNodes to select.
 */
export function selectLayer(nodeState, index) {
  const log = nodeState.log || console;
  if (!nodeState.imageNodes || index < 0 || index >= nodeState.imageNodes.length || !nodeState.imageNodes[index]) {
    log.warn(`Invalid or null layer at index ${index} for node ${nodeState.nodeId}`);
    deselectLayer(nodeState);
    return;
  }
  // Clear transformation state when selecting a new layer
  nodeState.isTransforming = false;
  nodeState.transformStartState = null;
  const node = nodeState.imageNodes[index];
  deselectLayer(nodeState);
  nodeState.selectedLayer = node;
  node.moveToTop();
  nodeState.transformer.nodes([node]);
  nodeState.imageLayer.batchDraw();

  // Update layer panel selection
  if (Array.isArray(nodeState.layerItems) && nodeState.layerItems.length > 0) {
    nodeState.layerItems.forEach((item) => item.classList.remove('selected'));
    const listItemIndex = nodeState.imageNodes.length - 1 - index; // Map imageNodes index to layerItems index
    if (nodeState.layerItems[listItemIndex]) {
      nodeState.layerItems[listItemIndex].classList.add('selected');
      log.debug(`Selected layer item at listItemIndex ${listItemIndex} (Layer ${index + 1}) for node ${nodeState.nodeId}`);
    } else {
      log.warn(`Layer item at listItemIndex ${listItemIndex} not found for node ${nodeState.nodeId}`);
    }
  } else {
    log.warn(`No valid layerItems array for node ${nodeState.nodeId}`);
  }

  // Sync state
  nodeState.initialStates[index] = {
    x: node.x(),
    y: node.y(),
    scaleX: node.scaleX(),
    scaleY: node.scaleY(),
    rotation: node.rotation(),
  };
  log.info(`Selected layer index ${index} (Layer ${index + 1}) for node ${nodeState.nodeId}`);
}

/**
 * Deselects the current layer and resets the UI.
 * @param {Object} nodeState - The node state object containing image nodes and layer items.
 */
export function deselectLayer(nodeState) {
  const log = nodeState.log || console;
  if (!nodeState.selectedLayer) {
    log.debug(`No layer selected to deselect for node ${nodeState.nodeId}`);
    return;
  }
  nodeState.defaultLayerOrder.forEach((node, index) => {
    if (node) {
      node.zIndex(index);
    } else {
      log.warn(`Null node in defaultLayerOrder at index ${index} for node ${nodeState.nodeId}`);
    }
  });
  nodeState.selectedLayer = null;
  nodeState.transformer.nodes([]);
  nodeState.imageLayer.batchDraw();
  if (Array.isArray(nodeState.layerItems)) {
    nodeState.layerItems.forEach((item) => item.classList.remove('selected'));
  }
  // Clear transformation state
  nodeState.isTransforming = false;
  nodeState.transformStartState = null;
  log.debug(`Deselected layer for node ${nodeState.nodeId}`);
}

/**
 * Applies the current states to image nodes.
 * @param {Object} nodeState - The node state object containing image nodes and initial states.
 */
export function applyStates(nodeState) {
  const log = nodeState.log || console;
  const validNodes = nodeState.imageNodes.filter(node => node !== null);
  if (validNodes.length !== nodeState.imageNodes.length) {
    log.warn(`Found ${nodeState.imageNodes.length - validNodes.length} null imageNodes in node ${nodeState.nodeId}`);
  }
  validNodes.forEach((node, i) => {
    const state = nodeState.initialStates[i] || {};
    const x = state.x || (nodeState.canvasRect?.x() + nodeState.canvasRect?.width() / 2) || 512;
    const y = state.y || (nodeState.canvasRect?.y() + nodeState.canvasRect?.height() / 2) || 512;
    const scaleX = state.scaleX || 1;
    const scaleY = state.scaleY || 1;
    const rotation = state.rotation || 0;

    try {
      node.x(x);
      node.y(y);
      node.scaleX(scaleX);
      node.scaleY(scaleY);
      node.rotation(rotation);
      nodeState.initialStates[i] = { x, y, scaleX, scaleY, rotation };
    } catch (e) {
      log.error(`Failed to apply state to image node ${i} for node ${nodeState.nodeId}: ${e.message}`);
    }
  });
  nodeState.imageLayer.batchDraw();
  log.debug(`Applied states to ${validNodes.length} valid image nodes for node ${nodeState.nodeId}`);
}

/**
 * Debounces a function to prevent multiple calls within a specified delay.
 * @param {Function} func - The function to debounce.
 * @param {number} delay - The debounce delay in milliseconds.
 * @returns {Function} The debounced function.
 * @private
 */
function debounce(func, delay) {
  let timeoutId;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      func.apply(this, args);
      log.debug(`Debounced function executed`);
    }, delay);
  };
}

/**
 * Sets up wheel event handlers for zooming and rotating selected layers.
 * @param {Object} node - The ComfyUI node instance.
 * @param {Object} nodeState - The node state object containing stage and image nodes.
 * @requires updateHistory from canvas_history.js to save state changes.
 */
export function setupWheelEvents(node, nodeState) {
  const log = nodeState.log || console;

  // Define constants for consistent transformation steps
  const ROTATION_STEP = 1; // 1 degree per wheel tick
  const SCALE_STEP = 0.01; // 1% scaling per wheel tick

  // Remove existing wheel event listeners to prevent duplicates
  nodeState.stage.off('wheel');
  log.debug(`Removed existing wheel event listeners for node ${node.id}`);

  // Update state function
  const updateState = (target, index, updateHistoryFlag = true) => {
    if (!target || !nodeState.imageNodes.includes(target)) return;
    nodeState.initialStates[index] = {
      x: target.x(),
      y: target.y(),
      scaleX: target.scaleX(),
      scaleY: target.scaleY(),
      rotation: target.rotation(),
    };
    node.properties.image_states = nodeState.initialStates;
    const imageStatesWidget = node.widgets.find((w) => w.name === 'image_states');
    if (imageStatesWidget) {
      imageStatesWidget.value = JSON.stringify(nodeState.initialStates);
    }
    node.setProperty('image_states', nodeState.initialStates);
    nodeState.imageLayer.batchDraw();
    if (updateHistoryFlag) {
      updateHistory(nodeState, true); // Force history update
    }
    log.debug(`Wheel update for layer ${index} in node ${node.id}, states: ${JSON.stringify(nodeState.initialStates[index])}`);
  };

  // Debounced history update
  const debouncedUpdateHistory = debounce(() => {
    nodeState.isTransforming = false;
    updateHistory(nodeState, true);
    nodeState.transformStartState = null;
    log.debug(`Debounced history update for wheel interaction in node ${node.id}`);
  }, 300);

  // Wheel event handler for zooming and rotating
  nodeState.stage.on('wheel', (e) => {
    e.evt.preventDefault();
    const target = nodeState.transformer.nodes()[0];
    if (!target || !nodeState.imageNodes.includes(target)) return;

    const index = nodeState.imageNodes.indexOf(target);
    if (index === -1 || !nodeState.imageNodes[index]) {
      log.warn(`Invalid or null target at index ${index} in node ${node.id}`);
      return;
    }

    nodeState.isInteracting = true;
    if (!nodeState.isTransforming) {
      // Start of transformation
      nodeState.isTransforming = true;
      nodeState.transformStartState = {
        x: target.x(),
        y: target.y(),
        scaleX: target.scaleX(),
        scaleY: target.scaleY(),
        rotation: target.rotation(),
      };
      log.debug(`Wheel transform started for layer ${index} in node ${node.id}, initial state: ${JSON.stringify(nodeState.transformStartState)}`);
    }

    const isAltPressed = e.evt.altKey;
    if (isAltPressed) {
      const currentRotation = target.rotation();
      const delta = e.evt.deltaY > 0 ? -ROTATION_STEP : ROTATION_STEP;
      target.rotation(currentRotation + delta);
    } else {
      // Preserve independent scaling ratios
      const oldScaleX = target.scaleX();
      const oldScaleY = target.scaleY();
      const scaleFactor = e.evt.deltaY > 0 ? (1 - SCALE_STEP) : (1 + SCALE_STEP);
      const newScaleX = Math.min(Math.max(oldScaleX * scaleFactor, 0.1), 10);
      const newScaleY = Math.min(Math.max(oldScaleY * scaleFactor, 0.1), 10);
      target.scaleX(newScaleX);
      target.scaleY(newScaleY);
    }

    updateState(target, index, false); // Update state without history
    debouncedUpdateHistory(); // Schedule history update
    nodeState.isInteracting = false;
  });

  log.info(`Wheel event listeners set up for node ${node.id}`);
}