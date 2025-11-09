/**
 * @fileoverview Manages history and user interaction logic for the XISER_Canvas extension, including undo/redo and layer events.
 * @module canvas_history
 */

import { log } from './canvas_state.js';
import { applyStates, selectLayer, deselectLayer } from './canvas_konva.js';

/**
 * Updates the history state for a node after layer changes, capturing the full state of all layers.
 * @param {Object} nodeState - The node state containing history and layer information.
 * @param {boolean} [force=false] - Forces history update even if transforming.
 */
export function updateHistory(nodeState, force = false) {
  // Skip history update during transformation unless forced
  if (nodeState.isTransforming && !force) {
    log.debug(`Skipping history update for node ${nodeState.nodeId} during transformation`);
    return;
  }

  // Ensure history is initialized
  nodeState.history = nodeState.history || [];
  nodeState.historyIndex = nodeState.historyIndex ?? -1;

  // Ensure initialStates is an array
  const initialStates = Array.isArray(nodeState.initialStates) ? nodeState.initialStates : [];
  const currentState = initialStates.map(state => ({
    x: state.x || 0,
    y: state.y || 0,
    scaleX: state.scaleX || 1,
    scaleY: state.scaleY || 1,
    rotation: state.rotation || 0,
    skewX: state.skewX || 0,
    skewY: state.skewY || 0,
  }));

  // Only push to history if the state has changed
  const lastState = nodeState.history[nodeState.historyIndex];
  if (!lastState || JSON.stringify(lastState) !== JSON.stringify(currentState)) {
    nodeState.history = nodeState.history.slice(0, nodeState.historyIndex + 1);
    nodeState.history.push(currentState);
    nodeState.historyIndex = nodeState.history.length - 1;

    // Limit history to 20 entries
    if (nodeState.history.length > 20) {
      nodeState.history.shift();
      nodeState.historyIndex--;
    }

    log.debug(`Updated history for node ${nodeState.nodeId}, index: ${nodeState.historyIndex}, entries: ${nodeState.history.length}`);
  }
}

/**
 * Undoes the last action by restoring the previous history state.
 * @param {Object} node - The ComfyUI node instance.
 * @param {Object} nodeState - The node state containing history and layer information.
 */
export function undo(node, nodeState) {
  try {
    if (!nodeState.history || nodeState.historyIndex <= 0) {
      log.debug(`No actions to undo for node ${node.id}`);
      return;
    }
    nodeState.historyIndex--;
    nodeState.initialStates = (nodeState.history[nodeState.historyIndex] || []).map(state => ({
      x: state.x,
      y: state.y,
      scaleX: state.scaleX || 1,
      scaleY: state.scaleY || 1,
      rotation: state.rotation || 0,
      skewX: state.skewX || 0,
      skewY: state.skewY || 0,
    }));
    applyStates(nodeState);
    node.properties.image_states = nodeState.initialStates;
    const imageStatesWidget = node.widgets.find(w => w.name === 'image_states');
    if (imageStatesWidget) {
      imageStatesWidget.value = JSON.stringify(nodeState.initialStates);
    }
    node.setProperty('image_states', nodeState.initialStates);
    nodeState.imageLayer.batchDraw();
    log.info(`Undo performed for node ${node.id}, historyIndex: ${nodeState.historyIndex}`);
  } catch (e) {
    log.error(`Undo failed for node ${node.id}:`, e);
  }
}

/**
 * Redoes the last undone action by restoring the next history state.
 * @param {Object} node - The ComfyUI node instance.
 * @param {Object} nodeState - The node state containing history and layer information.
 */
export function redo(node, nodeState) {
  try {
    if (!nodeState.history || nodeState.historyIndex >= nodeState.history.length - 1) {
      log.debug(`No actions to redo for node ${node.id}`);
      return;
    }
    nodeState.historyIndex++;
    nodeState.initialStates = (nodeState.history[nodeState.historyIndex] || []).map(state => ({
      x: state.x,
      y: state.y,
      scaleX: state.scaleX || 1,
      scaleY: state.scaleY || 1,
      rotation: state.rotation || 0,
      skewX: state.skewX || 0,
      skewY: state.skewY || 0,
    }));
    applyStates(nodeState);
    node.properties.image_states = nodeState.initialStates;
    const imageStatesWidget = node.widgets.find(w => w.name === 'image_states');
    if (imageStatesWidget) {
      imageStatesWidget.value = JSON.stringify(nodeState.initialStates);
    }
    node.setProperty('image_states', nodeState.initialStates);
    nodeState.imageLayer.batchDraw();
    log.info(`Redo performed for node ${node.id}, historyIndex: ${nodeState.historyIndex}`);
  } catch (e) {
    log.error(`Redo failed for node ${node.id}:`, e);
  }
}

/**
 * Resets the canvas to default states, centering all images.
 * @param {Object} node - The ComfyUI node instance.
 * @param {Object} nodeState - The node state containing canvas and layer information.
 * @param {string[]} imagePaths - Array of image paths for the node.
 * @param {Function} updateSize - Function to update the canvas size and properties.
 */
export function resetCanvas(node, nodeState, imagePaths, updateSize) {
  try {
    const boardWidth = node.properties.ui_config.board_width || 1024;
    const borderWidth = node.properties.ui_config.border_width || 80;
    const boardHeight = node.properties.ui_config.board_height || 1024;

    nodeState.initialStates = imagePaths.map(() => ({
      x: borderWidth + boardWidth / 2,
      y: borderWidth + boardHeight / 2,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      skewX: 0,
      skewY: 0,
    }));
    applyStates(nodeState);
    node.properties.image_states = nodeState.initialStates;
    const imageStatesWidget = node.widgets.find(w => w.name === 'image_states');
    if (imageStatesWidget) {
      imageStatesWidget.value = JSON.stringify(nodeState.initialStates);
    }
    node.setProperty('image_states', nodeState.initialStates);
    nodeState.imageLayer.batchDraw();
    deselectLayer(nodeState);
    updateSize();
    updateHistory(nodeState, true); // Force history update
    log.debug(`Canvas reset for node ${node.id}`);
  } catch (e) {
    log.error(`Reset canvas failed for node ${node.id}:`, e);
  }
}

/**
 * Sets up event listeners for drag, transform, and wheel interactions on image layers.
 * @param {Object} node - The ComfyUI node instance.
 * @param {Object} nodeState - The node state containing layer and interaction information.
 */
export function setupLayerEventListeners(node, nodeState) {
  const log = nodeState.log || console;

  // Filter valid imageNodes
  const validNodes = nodeState.imageNodes.filter(node => node !== null);
  if (validNodes.length !== nodeState.imageNodes.length) {
    log.warn(`Found ${nodeState.imageNodes.length - validNodes.length} null imageNodes in node ${node.id}`);
  }

  // Update state function
  const updateState = (imageNode, index, updateHistoryFlag = true) => {
    if (!imageNode) {
      log.warn(`Skipping state update for null imageNode at index ${index} in node ${node.id}`);
      return;
    }
    nodeState.initialStates[index] = {
      x: imageNode.x(),
      y: imageNode.y(),
      scaleX: imageNode.scaleX(),
      scaleY: imageNode.scaleY(),
      rotation: imageNode.rotation(),
    };
    node.properties.image_states = nodeState.initialStates;
    const imageStatesWidget = node.widgets.find(w => w.name === 'image_states');
    if (imageStatesWidget) {
      imageStatesWidget.value = JSON.stringify(nodeState.initialStates);
    }
    node.setProperty('image_states', nodeState.initialStates);
    if (updateHistoryFlag) {
      updateHistory(nodeState, true); // Force history update
    }
    nodeState.imageLayer.batchDraw();
    log.debug(`State updated for node ${node.id}, layer ${index}: ${JSON.stringify(nodeState.initialStates[index])}`);
  };

  // Remove existing listeners and add new ones
  validNodes.forEach((imageNode, index) => {
    // Remove existing listeners to prevent duplicates
    imageNode.off('dragstart dragend transformstart transform transformend');

    imageNode.on('dragstart', () => {
      nodeState.isInteracting = true;
      log.debug(`Drag started for image ${index} in node ${node.id}`);
    });

    imageNode.on('dragend', () => {
      nodeState.isInteracting = false;
      updateState(imageNode, index);
    });

    imageNode.on('transformstart', () => {
      nodeState.isInteracting = true;
      nodeState.isTransforming = true;
      // Store initial state
      nodeState.transformStartState = {
        x: imageNode.x(),
        y: imageNode.y(),
        scaleX: imageNode.scaleX(),
        scaleY: imageNode.scaleY(),
        rotation: imageNode.rotation(),
      };
      log.debug(`Transform started for image ${index} in node ${node.id}, initial state: ${JSON.stringify(nodeState.transformStartState)}`);
    });

    imageNode.on('transform', () => {
      // Update state without saving to history
      updateState(imageNode, index, false);
    });

    imageNode.on('transformend', () => {
      nodeState.isInteracting = false;
      nodeState.isTransforming = false;
      updateState(imageNode, index);
      nodeState.transformStartState = null;
      log.debug(`Transform ended for image ${index} in node ${node.id}`);
    });
  });

  log.info(`Event listeners set up for ${validNodes.length} valid image nodes in node ${node.id}`);
}

/**
 * Removes all event listeners from image nodes to prevent memory leaks.
 * @param {Object} nodeState - The node state containing imageNodes.
 */
export function cleanupLayerEventListeners(nodeState) {
  const log = nodeState.log || console;
  const validNodes = nodeState.imageNodes.filter(node => node !== null);
  validNodes.forEach((imageNode, index) => {
    imageNode.off('dragstart dragend transformstart transform transformend');
    log.debug(`Removed event listeners for image ${index} in node ${nodeState.nodeId}`);
  });
  log.info(`Cleaned up event listeners for ${validNodes.length} image nodes in node ${nodeState.nodeId}`);
}

/**
 * Clears the history for a node, resetting history array and index.
 * @param {Object} nodeState - The node state containing history information.
 */
export function clearHistory(nodeState) {
  nodeState.history = [];
  nodeState.historyIndex = -1;
  nodeState.isTransforming = false;
  nodeState.transformStartState = null;
  log.debug(`Cleared history for node ${nodeState.nodeId}`);
}