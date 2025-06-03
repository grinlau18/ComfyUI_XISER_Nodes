/**
 * @fileoverview Manages history and user interaction logic for the XISER_Canvas extension, including undo/redo and layer events.
 * @module canvas_history
 */

import { log, throttle } from './canvas_state.js';
import { applyStates, selectLayer, deselectLayer } from './canvas_konva.js';

/**
 * Updates the history state for a node after layer changes, capturing the full state of all layers.
 * @param {Object} nodeState - The node state containing history and layer information.
 */
export function updateHistory(nodeState) {
  // Ensure history is initialized
  nodeState.history = nodeState.history || [];
  nodeState.historyIndex = nodeState.historyIndex ?? -1;

  // Ensure initialStates is an array
  const initialStates = Array.isArray(nodeState.initialStates) ? nodeState.initialStates : [];
  const currentState = initialStates.map(state => ({
    x: state.x,
    y: state.y,
    scaleX: state.scaleX || 1,
    scaleY: state.scaleY || 1,
    rotation: state.rotation || 0
  }));

  // Only push to history if the state has changed
  const lastState = nodeState.history[nodeState.historyIndex];
  if (!lastState || JSON.stringify(lastState) !== JSON.stringify(currentState)) {
    nodeState.history = nodeState.history.slice(0, nodeState.historyIndex + 1);
    nodeState.history.push(currentState);
    nodeState.historyIndex = nodeState.history.length - 1;

    // Limit history to 100 entries
    if (nodeState.history.length > 100) {
      nodeState.history.shift();
      nodeState.historyIndex--;
    }

    log.debug(`Updated history for node ${nodeState.nodeId}, index: ${nodeState.historyIndex}, state: ${JSON.stringify(currentState)}`);
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
      rotation: state.rotation || 0
    }));
    applyStates(nodeState);
    node.properties.image_states = nodeState.initialStates;
    node.widgets.find(w => w.name === 'image_states').value = JSON.stringify(nodeState.initialStates);
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
      rotation: state.rotation || 0
    }));
    applyStates(nodeState);
    node.properties.image_states = nodeState.initialStates;
    node.widgets.find(w => w.name === 'image_states').value = JSON.stringify(nodeState.initialStates);
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
    const boardHeight = node.properties.ui_config.board_height || 1024;
    const borderWidth = node.properties.ui_config.border_width || 40;

    nodeState.initialStates = imagePaths.map(() => ({
      x: borderWidth + boardWidth / 2,
      y: borderWidth + boardHeight / 2,
      scaleX: 1,
      scaleY: 1,
      rotation: 0
    }));
    applyStates(nodeState);
    node.properties.image_states = nodeState.initialStates;
    node.widgets.find(w => w.name === 'image_states').value = JSON.stringify(nodeState.initialStates);
    node.setProperty('image_states', nodeState.initialStates);
    nodeState.imageLayer.batchDraw();
    deselectLayer(nodeState);
    updateSize();
    updateHistory(nodeState);
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
  // Throttled function for scale/rotate updates (300ms interval)
  const throttledTransformUpdate = throttle(() => {
    if (!nodeState.isInteracting) return;
    let updated = false;
    nodeState.imageNodes.forEach((imageNode, i) => {
      const state = nodeState.initialStates[i] || {};
      if (
        state.scaleX !== imageNode.scaleX() ||
        state.scaleY !== imageNode.scaleY() ||
        state.rotation !== imageNode.rotation()
      ) {
        nodeState.initialStates[i] = {
          x: imageNode.x(),
          y: imageNode.y(),
          scaleX: imageNode.scaleX(),
          scaleY: imageNode.scaleY(),
          rotation: imageNode.rotation()
        };
        updated = true;
      }
    });
    if (updated) {
      node.properties.image_states = nodeState.initialStates;
      node.widgets.find(w => w.name === 'image_states').value = JSON.stringify(nodeState.initialStates);
      node.setProperty('image_states', nodeState.initialStates);
      updateHistory(nodeState);
      nodeState.imageLayer.batchDraw();
      log.debug(`Transform update for node ${nodeState.nodeId}, states: ${JSON.stringify(nodeState.initialStates)}`);
    }
  }, 300);

  // Add drag and transform event listeners to image nodes
  nodeState.imageNodes.forEach((imageNode, index) => {
    imageNode.on('dragstart', () => {
      nodeState.isInteracting = true;
      log.debug(`Drag started for image ${index} in node ${node.id}`);
    });

    imageNode.on('dragend', () => {
      nodeState.isInteracting = false;
      nodeState.initialStates[index] = {
        x: imageNode.x(),
        y: imageNode.y(),
        scaleX: imageNode.scaleX(),
        scaleY: imageNode.scaleY(),
        rotation: imageNode.rotation()
      };
      node.properties.image_states = nodeState.initialStates;
      node.widgets.find(w => w.name === 'image_states').value = JSON.stringify(nodeState.initialStates);
      node.setProperty('image_states', nodeState.initialStates);
      updateHistory(nodeState);
      nodeState.imageLayer.batchDraw();
      log.debug(`Drag ended for image ${index} in node ${node.id}, states: ${JSON.stringify(nodeState.initialStates)}`);
    });

    imageNode.on('transformstart', () => {
      nodeState.isInteracting = true;
      log.debug(`Transform started for image ${index} in node ${node.id}`);
    });

    imageNode.on('transform', throttledTransformUpdate);

    imageNode.on('transformend', () => {
      nodeState.isInteracting = false;
      nodeState.initialStates[index] = {
        x: imageNode.x(),
        y: imageNode.y(),
        scaleX: imageNode.scaleX(),
        scaleY: imageNode.scaleY(),
        rotation: imageNode.rotation()
      };
      node.properties.image_states = nodeState.initialStates;
      node.widgets.find(w => w.name === 'image_states').value = JSON.stringify(nodeState.initialStates);
      node.setProperty('image_states', nodeState.initialStates);
      updateHistory(nodeState);
      nodeState.imageLayer.batchDraw();
      log.debug(`Transform ended for image ${index} in node ${node.id}, states: ${JSON.stringify(nodeState.initialStates)}`);
    });
  });

  // Wheel events are handled in canvas_konva.js
}