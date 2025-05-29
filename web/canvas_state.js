/**
 * @fileoverview Manages node state, canvas properties, and utility functions for the XISER_Canvas extension.
 * @module canvas_state
 */

/**
 * Logging utility for the XISER_Canvas node with configurable log levels.
 * @type {Object}
 */
const LOG_LEVEL = new URLSearchParams(window.location.search).get('xiser_log') || 'error';
export const log = {
  /**
   * Logs a debug message if the log level is 'debug'.
   * @param {string} message - The message to log.
   * @param {...any} args - Additional arguments to include in the log.
   */
  debug: (message, ...args) => {
    if (LOG_LEVEL === 'debug') {
      console.log(`[XISER_Canvas ${new Date().toISOString()}] ${message}`, ...args);
    }
  },
  /**
   * Logs an info message if the log level is 'debug' or 'info'.
   * @param {string} message - The message to log.
   * @param {...any} args - Additional arguments to include in the log.
   */
  info: (message, ...args) => {
    if (LOG_LEVEL === 'debug' || LOG_LEVEL === 'info') {
      console.log(`[XISER_Canvas ${new Date().toISOString()}] ${message}`, ...args);
    }
  },
  /**
   * Logs an error message unconditionally.
   * @param {string} message - The error message to log.
   * @param {...any} args - Additional arguments to include in the log.
   */
  error: (message, ...args) => {
    console.error(`[XISER_Canvas ${new Date().toISOString()}] ${message}`, ...args);
  }
};

/**
 * Creates and initializes the node state for an XISER_Canvas node.
 * @param {number} nodeId - The ID of the node.
 * @param {Object} app - The ComfyUI app instance.
 * @returns {Object} The initialized node state.
 */
export function createNodeState(nodeId, app) {
  return {
    nodeId,
    imageNodes: [],
    defaultLayerOrder: [],
    initialStates: [],
    transformer: null,
    lastImagePaths: [],
    lastImagePathsHash: null,
    history: [],
    historyIndex: -1,
    selectedLayer: null,
    layerItems: [],
    lastNodePos: [0, 0],
    lastNodeSize: [0, 0],
    lastScale: app.canvas?.ds?.scale || 1,
    lastOffset: app.canvas?.ds?.offset ? [...app.canvas.ds.offset] : [0, 0],
    pollInterval: null,
    animationFrameId: null,
    stage: null,
    canvasLayer: null,
    imageLayer: null,
    borderLayer: null,
    canvasRect: null,
    borderRect: null,
    borderFrame: null,
    isLoading: false,
    historyDebounceTimeout: null,
    log
  };
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
  let borderWidth = uiConfig.border_width || 40;
  let canvasColor = uiConfig.canvas_color || 'rgb(0, 0, 0)';
  let borderColor = uiConfig.border_color || 'rgb(25, 25, 25)';
  let autoSize = uiConfig.auto_size || 'off';
  let imagePaths = uiConfig.image_paths || [];

  let canvasColorValue =
    node.widgets_values?.[3] ||
    (canvasColor === 'rgb(0, 0, 0)'
      ? 'black'
      : canvasColor === 'rgb(255, 255, 255)'
      ? 'white'
      : canvasColor === 'rgba(0, 0, 0, 0)'
      ? 'transparent'
      : 'black');

  log.debug(`Canvas dimensions initialized for node ${nodeState.nodeId}: boardWidth=${boardWidth}, boardHeight=${boardHeight}`);

  // Update properties from widgets
  if (node.widgets_values?.length >= 6) {
    boardWidth = parseInt(node.widgets_values[0]) || boardWidth;
    boardHeight = parseInt(node.widgets_values[1]) || boardHeight;
    borderWidth = parseInt(node.widgets_values[2]) || borderWidth;
    canvasColorValue = node.widgets_values[3] || canvasColorValue;
    autoSize = node.widgets_values[4] || autoSize;
    if (node.widgets_values[5]) {
      try {
        nodeState.initialStates = JSON.parse(node.widgets_values[5]) || nodeState.initialStates;
      } catch (e) {
        log.error(`Failed to parse image_states for node ${nodeState.nodeId}`, e);
      }
    }
    uiConfig.board_width = boardWidth;
    uiConfig.board_height = boardHeight;
    uiConfig.border_width = borderWidth;
    uiConfig.canvas_color = canvasColor;
    uiConfig.border_color = borderColor;
    uiConfig.auto_size = autoSize;
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
      const nodeId = args[1]?.nodeId || 'unknown';
      const imagePaths = args[2] || [];
      log.debug(`Debounced function executed for node ${nodeId} with imagePaths: ${JSON.stringify(imagePaths)}`);
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
      const nodeId = args[0]?.nodeId || 'unknown';
      log.debug(`Throttled function executed for node ${nodeId}`);
    }
  };
}