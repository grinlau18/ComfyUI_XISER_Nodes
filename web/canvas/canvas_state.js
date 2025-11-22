/**
 * @fileoverview Manages node state, canvas properties, and utility functions for the XISER_Canvas extension.
 * @module canvas_state
 */

/**
 * Logging utility for the XISER_Canvas node with configurable log levels.
 * @type {Object}
 */
const LOG_LEVEL = new URLSearchParams(window.location.search).get('xiser_log') || 'debug'; // Default to 'debug' if not specified
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
export const BRIGHTNESS_RANGE = { min: -1, max: 1 };
export const CONTRAST_RANGE = { min: -100, max: 100 };
export const SATURATION_RANGE = { min: -100, max: 100 };

const clampValue = (value, min, max, fallback = 0) => {
  const number = Number(value);
  if (Number.isNaN(number) || !Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(Math.max(number, min), max);
};

export function withAdjustmentDefaults(state = {}) {
  const orderVal = Number.isFinite(state?.order) ? state.order : undefined;
  const filenameVal = typeof state?.filename === 'string' ? state.filename : undefined;
  return {
    ...state,
    visible: state?.visible !== false, // 默认可见，兼容旧数据
    locked: state?.locked === true, // 默认未锁定
    order: orderVal,
    filename: filenameVal,
    brightness: clampValue(state?.brightness ?? 0, BRIGHTNESS_RANGE.min, BRIGHTNESS_RANGE.max, 0),
    contrast: clampValue(state?.contrast ?? 0, CONTRAST_RANGE.min, CONTRAST_RANGE.max, 0),
    saturation: clampValue(state?.saturation ?? 0, SATURATION_RANGE.min, SATURATION_RANGE.max, 0),
  };
}

export function mergeStateWithAdjustments(existingState = {}, overrides = {}) {
  return withAdjustmentDefaults({
    ...existingState,
    ...overrides,
  });
}

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
  const persistedStates = Array.isArray(node.properties.ui_config.image_states)
    ? node.properties.ui_config.image_states.map((s) => withAdjustmentDefaults(s || {}))
    : Array.isArray(node.properties.image_states)
    ? node.properties.image_states.map((s) => withAdjustmentDefaults(s || {}))
    : null;
  const persistedLayerOrder = Array.isArray(node.properties.ui_config.layer_order)
    ? node.properties.ui_config.layer_order
    : null;

  return {
    nodeId,
    imageNodes: new Array(imagePaths.length).fill(null), // Initialize with nulls
    defaultLayerOrder: [],
    initialStates: persistedStates && persistedStates.length === imagePaths.length
      ? persistedStates.map((s, idx) => withAdjustmentDefaults({
          ...s,
          order: Array.isArray(persistedLayerOrder) && persistedLayerOrder.length === imagePaths.length
            ? persistedLayerOrder[idx]
            : (Number.isFinite(s?.order) ? s.order : idx),
          filename: s?.filename || imagePaths[idx],
        }))
      : imagePaths.map((path, idx) => withAdjustmentDefaults({
          x: 0,
          y: 0,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          skewX: 0,
          skewY: 0,
          brightness: 0,
          contrast: 0,
          saturation: 0,
          order: idx,
          filename: path,
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
    pollInterval: null, // Used for polling node updates in canvas.js
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
    adjustments: null,
    applyLayerAdjustments: null,
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
  }
  if (nodeState.animationFrameId) {
    cancelAnimationFrame(nodeState.animationFrameId);
    nodeState.animationFrameId = null;
  }
  if (nodeState.historyDebounceTimeout) {
    clearTimeout(nodeState.historyDebounceTimeout);
    nodeState.historyDebounceTimeout = null;
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
  if (nodeState.adjustments && typeof nodeState.adjustments.destroy === 'function') {
    nodeState.adjustments.destroy();
  }
  nodeState.adjustments = null;
  nodeState.applyLayerAdjustments = null;

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
  let borderWidth = uiConfig.border_width || 120;
  let canvasColor = uiConfig.canvas_color || 'rgb(0, 0, 0)';
  let borderColor = uiConfig.border_color || 'rgb(25, 25, 25)';
  let autoSize = uiConfig.auto_size || 'off';
  let displayScale = typeof uiConfig.display_scale === 'number'
    ? uiConfig.display_scale
    : parseFloat(uiConfig.display_scale) || 0.5;
  displayScale = Math.min(Math.max(displayScale, 0.1), 1);
  let imagePaths = Array.isArray(uiConfig.image_paths) 
    ? uiConfig.image_paths.filter(p => typeof p === 'string' && p.trim().length > 0) 
    : [];
  // Restore persisted image_states if present in ui_config
  if (Array.isArray(uiConfig.image_states) && uiConfig.image_states.length) {
    const layerOrder = Array.isArray(uiConfig.layer_order) ? uiConfig.layer_order : null;
    nodeState.initialStates = uiConfig.image_states.map((s, idx) => withAdjustmentDefaults({
      ...s,
      order: Array.isArray(layerOrder) && layerOrder.length === uiConfig.image_states.length
        ? layerOrder[idx]
        : (Number.isFinite(s?.order) ? s.order : idx),
      filename: s?.filename || imagePaths[idx],
    }));
  }

  let canvasColorValue =
    node.widgets?.find(w => w.name === 'canvas_color')?.value ||
    (canvasColor === 'rgb(0, 0, 0)'
      ? 'black'
      : canvasColor === 'rgb(255, 255, 255)'
      ? 'white'
      : canvasColor === 'rgba(0, 0, 0, 0)'
      ? 'transparent'
      : 'black');


  // Update properties from widgets
  if (Array.isArray(node.widgets)) {
    for (const widget of node.widgets) {
      switch (widget?.name) {
        case 'board_width':
          boardWidth = parseInt(widget.value) || boardWidth;
          break;
        case 'board_height':
          boardHeight = parseInt(widget.value) || boardHeight;
          break;
        case 'border_width':
          borderWidth = parseInt(widget.value) || borderWidth;
          break;
        case 'canvas_color':
          canvasColorValue = widget.value || canvasColorValue;
          break;
        case 'display_scale':
          displayScale = Math.min(Math.max(parseFloat(widget.value) || displayScale, 0.1), 2);
          break;
        case 'auto_size':
          autoSize = widget.value || autoSize;
          break;
        case 'image_states':
          try {
            nodeState.initialStates = JSON.parse(widget.value) || nodeState.initialStates;
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
  uiConfig.display_scale = displayScale;
  uiConfig.image_paths = imagePaths;


  return {
    boardWidth,
    boardHeight,
    borderWidth,
    canvasColor,
    borderColor,
    canvasColorValue,
    displayScale,
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
    }
  };
}
