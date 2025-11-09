/**
 * @fileoverview Manages node state, canvas properties, and utility functions for the XISER_Canvas extension.
 * @module canvas_state
 */

/**
 * Logging utility for the XISER_Canvas node with configurable log levels.
 * @type {Object}
 */
const LOG_LEVEL = new URLSearchParams(window.location.search).get('xiser_log') || 'error'; // Default to 'debug' if not specified
export const log = {
  debug: (message, ...args) => {
    if (LOG_LEVEL === 'debug') {
      console.log(`[XISER_Canvas ${new Date().toISOString()}] ${message}`, ...args);
    }
  },
  info: (message, ...args) => {
    if (LOG_LEVEL === 'debug' || LOG_LEVEL === 'info') {
      console.log(`[XISER_Canvas ${new Date().toISOString()}] ${message}`, ...args);
    }
  },
  warn: (message, ...args) => {
    if (LOG_LEVEL === 'debug' || LOG_LEVEL === 'info' || LOG_LEVEL === 'warn') {
      console.warn(`[XISER_Canvas ${new Date().toISOString()}] ${message}`, ...args);
    }
  },
  error: (message, ...args) => {
    console.error(`[XISER_Canvas ${new Date().toISOString()}] ${message}`, ...args);
  }
};

/**
 * Creates and initializes the node state for an XISER_Canvas node.
 * @param {number} nodeId - The ID of the node.
 * @param {Object} app - The ComfyUI app instance.
 * @returns {Object|null} The initialized node state, or null if initialization fails.
 */
export function createNodeState(nodeId, app) {
  if (!app || !app.graph || !nodeId) {
    log.error(`Invalid parameters for createNodeState: nodeId=${nodeId}, app=${!!app}`);
    return null;
  }

  const node = app.graph.getNodeById(nodeId);
  if (!node) {
    log.warn(`Node not found for id ${nodeId}`);
    return null;
  }

  // Initialize properties if undefined
  node.properties = node.properties || {};
  node.properties.ui_config = node.properties.ui_config || {};

  const imagePaths = Array.isArray(node.properties.ui_config.image_paths) 
    ? node.properties.ui_config.image_paths.slice() : [];

  log.debug(`Creating node state for node ${nodeId}, imagePaths: ${JSON.stringify(imagePaths)}`);

  return {
    nodeId,
    imageNodes: new Array(imagePaths.length).fill(null), // Initialize with nulls
    defaultLayerOrder: [],
    initialStates: imagePaths.map(() => ({
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
    })), // Default states
    transformer: null,
    lastImagePaths: imagePaths.slice(),
    lastImagePathsHash: null,
    history: [],
    historyIndex: -1,
    selectedLayer: null,
    layerItems: [],
    lastNodePos: [0, 0],
    lastNodeSize: [0, 0],
    lastScale: app.canvas?.ds?.scale || 1,
    lastOffset: app.canvas?.ds?.offset ? [...app.canvas.ds.offset] : [0, 0],
    pollInterval: null, // Used for polling node updates in xiser_canvas.js
    animationFrameId: null,
    stage: null,
    canvasLayer: null,
    imageLayer: null,
    borderLayer: null,
    canvasRect: null,
    borderRect: null,
    borderFrame: null,
    isLoading: false,
    isTransforming: false, // Tracks ongoing rotation/scaling operations
    transformStartState: null, // Stores initial state at transform start
    historyDebounceTimeout: null,
    log,
  };
}

/**
 * Cleans up node state by clearing timers and arrays.
 * @param {Object} nodeState - The node state object.
 */
export function cleanupNodeState(nodeState) {
  if (!nodeState) {
    log.warn('No nodeState provided for cleanup');
    return;
  }

  // Clear timers
  if (nodeState.pollInterval) {
    clearInterval(nodeState.pollInterval);
    nodeState.pollInterval = null;
    log.debug(`Cleared pollInterval for node ${nodeState.nodeId}`);
  }
  if (nodeState.animationFrameId) {
    cancelAnimationFrame(nodeState.animationFrameId);
    nodeState.animationFrameId = null;
    log.debug(`Cleared animationFrameId for node ${nodeState.nodeId}`);
  }
  if (nodeState.historyDebounceTimeout) {
    clearTimeout(nodeState.historyDebounceTimeout);
    nodeState.historyDebounceTimeout = null;
    log.debug(`Cleared historyDebounceTimeout for node ${nodeState.nodeId}`);
  }

  // Clear arrays and references
  nodeState.imageNodes = [];
  nodeState.defaultLayerOrder = [];
  nodeState.initialStates = [];
  nodeState.history = [];
  nodeState.historyIndex = -1;
  nodeState.layerItems = [];
  nodeState.selectedLayer = null;
  nodeState.isTransforming = false;
  nodeState.transformStartState = null;

  log.info(`Node state cleaned up for node ${nodeState.nodeId}`);
}

/**
 * Initializes canvas properties for the node.
 * @param {Object} node - The ComfyUI node instance.
 * @param {Object} nodeState - The node state.
 * @returns {Object} Canvas properties and variables.
 */
export function initializeCanvasProperties(node, nodeState) {
  node.properties = node.properties || {};
  node.properties.ui_config = node.properties.ui_config || {};
  const uiConfig = node.properties.ui_config;

  let boardWidth = uiConfig.board_width || 1024;
  let boardHeight = uiConfig.board_height || 1024;
  let borderWidth = uiConfig.border_width || 80;
  let canvasColor = uiConfig.canvas_color || 'rgb(0, 0, 0)';
  let borderColor = uiConfig.border_color || 'rgb(25, 25, 25)';
  let autoSize = uiConfig.auto_size || 'off';
  let imagePaths = Array.isArray(uiConfig.image_paths) 
    ? uiConfig.image_paths.filter(p => typeof p === 'string' && p.trim().length > 0) 
    : [];

  let canvasColorValue =
    node.widgets?.find(w => w.name === 'canvas_color')?.value ||
    (canvasColor === 'rgb(0, 0, 0)'
      ? 'black'
      : canvasColor === 'rgb(255, 255, 255)'
      ? 'white'
      : canvasColor === 'rgba(0, 0, 0, 0)'
      ? 'transparent'
      : 'black');

  log.debug(`Canvas dimensions initialized for node ${nodeState.nodeId}: boardWidth=${boardWidth}, boardHeight=${boardHeight}`);

  // Update properties from widgets
  const widgetNames = ['board_width', 'board_height', 'border_width', 'canvas_color', 'auto_size', '', '', 'image_states'];
  if (Array.isArray(node.widgets)) {
    for (let i = 0; i < node.widgets.length && i < widgetNames.length; i++) {
      if (node.widgets[i]?.name === widgetNames[i]) {
        switch (widgetNames[i]) {
          case 'board_width':
            boardWidth = parseInt(node.widgets[i].value) || boardWidth;
            break;
          case 'board_height':
            boardHeight = parseInt(node.widgets[i].value) || boardHeight;
            break;
          case 'border_width':
            borderWidth = parseInt(node.widgets[i].value) || borderWidth;
            break;
          case 'canvas_color':
            canvasColorValue = node.widgets[i].value || canvasColorValue;
            break;
          case 'auto_size':
            autoSize = node.widgets[i].value || autoSize;
            break;
          case 'image_states':
            try {
              nodeState.initialStates = JSON.parse(node.widgets[i].value) || nodeState.initialStates;
            } catch (e) {
              log.error(`Failed to parse image_states for node ${nodeState.nodeId}: ${e.message}`);
            }
            break;
        }
      }
    }
    uiConfig.board_width = boardWidth;
    uiConfig.board_height = boardHeight;
    uiConfig.border_width = borderWidth;
    uiConfig.canvas_color = canvasColorValue;
    uiConfig.border_color = borderColor;
    uiConfig.auto_size = autoSize;
    uiConfig.image_paths = imagePaths;
  }

  log.debug(`Canvas properties initialized for node ${nodeState.nodeId}: boardWidth=${boardWidth}, boardHeight=${boardHeight}, autoSize=${autoSize}`);

  return {
    boardWidth,
    boardHeight,
    borderWidth,
    canvasColor,
    borderColor,
    canvasColorValue,
    autoSize,
    imagePaths,
    uiConfig
  };
}

/**
 * Debounces a function to prevent multiple calls within a specified delay.
 * @param {Function} func - The function to debounce.
 * @param {number} delay - The debounce delay in milliseconds.
 * @returns {Function} The debounced function.
 */
export function debounce(func, delay) {
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
 * Throttles a function to limit its execution rate to a maximum frequency.
 * @param {Function} func - The function to throttle.
 * @param {number} limit - The minimum time interval in milliseconds between executions.
 * @returns {Function} The throttled function.
 */
export function throttle(func, limit) {
  let inThrottle;
  return function (...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
      log.debug(`Throttled function executed`);
    }
  };
}