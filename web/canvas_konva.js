/**
 * @fileoverview Manages Konva.js stage, layers, and event handlers for the XISER_Canvas node.
 * @module canvas_konva
 */

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
 */
export function initializeKonva(node, nodeState, boardContainer, boardWidth, boardHeight, borderWidth, canvasColor, borderColor) {
  const log = nodeState.log || console;

  if (!window.Konva) {
    log.error(`Konva.js not available for node ${node.id}`);
    throw new Error("Konva.js not loaded");
  }

  const stageContainer = document.createElement("div");
  stageContainer.className = "xiser-canvas-stage";
  boardContainer.appendChild(stageContainer);

  const stage = new Konva.Stage({
    container: stageContainer,
    width: boardWidth + 2 * borderWidth,
    height: boardHeight + 2 * borderWidth
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
    fill: canvasColor
  });

  const borderRect = new Konva.Rect({
    x: 0,
    y: 0,
    width: boardWidth + 2 * borderWidth,
    height: boardHeight + 2 * borderWidth,
    fill: borderColor,
    stroke: "#808080",
    strokeWidth: 2
  });

  const borderFrame = new Konva.Rect({
    x: borderWidth,
    y: borderWidth,
    width: boardWidth,
    height: boardHeight,
    stroke: "#808080",
    strokeWidth: 2,
    fill: null,
    listening: false
  });

  canvasLayer.add(borderRect);
  canvasLayer.add(canvasRect);
  borderLayer.add(borderFrame);

  // Initialize transformer
  nodeState.transformer = new Konva.Transformer({
    centeredScaling: true,
    rotationSnaps: [0, 45, 90, 135, 180, 225, 270, 315]
  });
  imageLayer.add(nodeState.transformer);

  // Debounce wheel history updates
  let wheelTimeout = null;
  const debounceWheelHistory = () => {
    if (wheelTimeout) clearTimeout(wheelTimeout);
    wheelTimeout = setTimeout(() => {
      if (nodeState.updateHistory) nodeState.updateHistory();
      log.debug(`Wheel history updated for node ${node.id}`);
    }, 300);
  };

  // Event handlers
  stage.on("click tap", (e) => {
    const target = e.target;
    if (target === canvasRect || target === stage || target === borderRect) {
      deselectLayer(nodeState);
      return;
    }
    if (nodeState.imageNodes.includes(target)) {
      const index = nodeState.imageNodes.indexOf(target);
      if (nodeState.selectedLayer !== target) selectLayer(nodeState, index);
    }
  });

  stage.on("mousedown", (e) => {
    if (nodeState.imageNodes.includes(e.target)) {
      const index = nodeState.imageNodes.indexOf(e.target);
      selectLayer(nodeState, index);
    }
  });

  // Transformer event handlers
  nodeState.transformer.on("dragmove transform", (e) => {
    const target = e.target;
    if (!nodeState.imageNodes.includes(target)) return;
    const index = nodeState.imageNodes.indexOf(target);
    if (index === -1) return;

    nodeState.initialStates[index] = {
      x: target.x(),
      y: target.y(),
      scaleX: target.scaleX(),
      scaleY: target.scaleY(),
      rotation: target.rotation()
    };
    node.properties.image_states = nodeState.initialStates;
    node.widgets.find(w => w.name === "image_states").value = JSON.stringify(nodeState.initialStates);
    node.setProperty("image_states", nodeState.initialStates);
    nodeState.imageLayer.batchDraw();
    log.debug(`Transformer updated layer ${index} for node ${node.id}: ${JSON.stringify(nodeState.initialStates[index])}`);
  });

  nodeState.transformer.on("transformend", (e) => {
    const target = e.target;
    if (!nodeState.imageNodes.includes(target)) return;
    const index = nodeState.imageNodes.indexOf(target);
    if (index === -1) return;

    nodeState.initialStates[index] = {
      x: target.x(),
      y: target.y(),
      scaleX: target.scaleX(),
      scaleY: target.scaleY(),
      rotation: target.rotation()
    };
    node.properties.image_states = nodeState.initialStates;
    node.widgets.find(w => w.name === "image_states").value = JSON.stringify(nodeState.initialStates);
    node.setProperty("image_states", nodeState.initialStates);
    if (nodeState.updateHistory) nodeState.updateHistory();
    nodeState.imageLayer.batchDraw();
    log.debug(`Transform ended for layer ${index} for node ${node.id}, history updated`);
  });

  stage.on("wheel", (e) => {
    e.evt.preventDefault();
    const target = nodeState.transformer.nodes()[0];
    if (!target || !nodeState.imageNodes.includes(target)) return;

    const index = nodeState.imageNodes.indexOf(target);
    if (index === -1) return;

    const isAltPressed = e.evt.altKey;
    if (isAltPressed) {
      const rotationStep = 1;
      const currentRotation = target.rotation();
      const delta = e.evt.deltaY > 0 ? -rotationStep : rotationStep;
      target.rotation(currentRotation + delta);
    } else {
      const scaleBy = 1.01;
      const oldScale = target.scaleX();
      let newScale = e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy;
      newScale = Math.min(Math.max(newScale, 0.1), 10);
      target.scaleX(newScale);
      target.scaleY(newScale);
    }

    nodeState.initialStates[index] = {
      x: target.x(),
      y: target.y(),
      scaleX: target.scaleX(),
      scaleY: target.scaleY(),
      rotation: target.rotation()
    };
    node.properties.image_states = nodeState.initialStates;
    node.widgets.find(w => w.name === "image_states").value = JSON.stringify(nodeState.initialStates);
    node.setProperty("image_states", nodeState.initialStates);
    debounceWheelHistory();
    nodeState.imageLayer.batchDraw();
    log.debug(`Wheel event updated layer ${index} for node ${node.id}`);
  });

  log.info(`Konva stage initialized for node ${node.id}`);
  return {
    stage,
    canvasLayer,
    imageLayer,
    borderLayer,
    canvasRect,
    borderRect,
    borderFrame
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

  const containerWidth = boardWidth + 2 * borderWidth;
  const containerHeight = boardHeight + 2 * borderWidth;

  nodeState.stage.width(containerWidth);
  nodeState.stage.height(containerHeight);

  nodeState.borderRect.setAttrs({
    x: 0,
    y: 0,
    width: containerWidth,
    height: containerHeight,
    fill: borderColor
  });

  nodeState.canvasRect.setAttrs({
    x: borderWidth,
    y: borderWidth,
    width: boardWidth,
    height: boardHeight,
    fill: canvasColor
  });

  nodeState.borderFrame.setAttrs({
    x: borderWidth,
    y: borderWidth,
    width: boardWidth,
    height: boardHeight
  });

  // Update image positions to stay centered
  nodeState.imageNodes.forEach((node, i) => {
    const state = nodeState.initialStates[i] || {};
    node.x(borderWidth + boardWidth / 2);
    node.y(borderWidth + boardHeight / 2);
    nodeState.initialStates[i] = {
      x: node.x(),
      y: node.y(),
      scaleX: state.scaleX || 1,
      scaleY: state.scaleY || 1,
      rotation: state.rotation || 0
    };
  });

  nodeState.canvasLayer.batchDraw();
  nodeState.imageLayer.batchDraw();
  nodeState.borderLayer.batchDraw();
  nodeState.stage.draw();

  log.debug(`Stage resized for node ${nodeState.nodeId}: ${containerWidth}x${containerHeight}`);
}

/**
 * Destroys the Konva stage and related elements.
 * @param {Object} nodeState - The node state object.
 */
export function destroyKonva(nodeState) {
  const log = nodeState.log || console;
  if (nodeState.stage) {
    // Remove event listeners
    nodeState.stage.off("click tap");
    nodeState.stage.off("mousedown");
    nodeState.stage.off("wheel");
    if (nodeState.transformer) {
      nodeState.transformer.off("dragmove transform");
      nodeState.transformer.off("transformend");
      nodeState.transformer.destroy();
    }

    // Destroy nodes and layers
    nodeState.imageNodes.forEach(node => node.destroy());
    nodeState.imageNodes = [];
    nodeState.canvasLayer.destroy();
    nodeState.imageLayer.destroy();
    nodeState.borderLayer.destroy();
    nodeState.stage.destroy();

    // Reset nodeState properties
    nodeState.stage = null;
    nodeState.canvasLayer = null;
    nodeState.imageLayer = null;
    nodeState.borderLayer = null;
    nodeState.canvasRect = null;
    nodeState.borderRect = null;
    nodeState.borderFrame = null;
    nodeState.transformer = null;
    nodeState.selectedLayer = null;

    // Remove stage container
    const stageContainer = nodeState.stage?.container();
    if (stageContainer && stageContainer.parentNode) {
      stageContainer.remove();
    }

    log.debug(`Konva stage destroyed for node ${nodeState.nodeId}`);
  }
}

/**
 * Selects a layer by index.
 * @param {Object} nodeState - The node state object.
 * @param {number} index - The layer index.
 */
export function selectLayer(nodeState, index) {
  if (index < 0 || index >= nodeState.imageNodes.length) return;
  const log = nodeState.log || console;
  const node = nodeState.imageNodes[index];
  deselectLayer(nodeState);
  nodeState.selectedLayer = node;
  node.moveToTop();
  nodeState.transformer.nodes([node]);
  nodeState.imageLayer.batchDraw();
  nodeState.layerItems.forEach(item => item.classList.remove("selected"));
  const listItemIndex = nodeState.imageNodes.length - 1 - index;
  if (nodeState.layerItems[listItemIndex]) nodeState.layerItems[listItemIndex].classList.add("selected");
  log.debug(`Selecting layer index ${index} for node ${nodeState.nodeId}`);
}

/**
 * Deselects the current layer.
 * @param {Object} nodeState - The node state object.
 */
export function deselectLayer(nodeState) {
  const log = nodeState.log || console;
  if (!nodeState.selectedLayer) return;
  nodeState.defaultLayerOrder.forEach((node, index) => node.zIndex(index));
  nodeState.selectedLayer = null;
  nodeState.transformer.nodes([]);
  nodeState.imageLayer.batchDraw();
  nodeState.layerItems.forEach(item => item.classList.remove("selected"));
  log.debug(`Deselected layer for node ${nodeState.nodeId}`);
}

/**
 * Applies the current states to image nodes.
 * @param {Object} nodeState - The node state object.
 */
export function applyStates(nodeState) {
  const log = nodeState.log || console;
  nodeState.imageNodes.forEach((node, i) => {
    const state = nodeState.initialStates[i] || {};
    node.x(state.x || nodeState.canvasRect.x() + nodeState.canvasRect.width() / 2);
    node.y(state.y || nodeState.canvasRect.y() + nodeState.canvasRect.height() / 2);
    node.scaleX(state.scaleX || 1);
    node.scaleY(state.scaleY || 1);
    node.rotation(state.rotation || 0);
  });
  nodeState.imageLayer.batchDraw();
  log.debug(`Applied states to ${nodeState.imageNodes.length} image nodes for node ${nodeState.nodeId}`);
}