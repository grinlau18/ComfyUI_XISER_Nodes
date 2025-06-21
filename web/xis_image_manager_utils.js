/**
 * @fileoverview Utility functions for XISER nodes, including logging, debouncing, DOM helpers, and UI styles.
 * @module xis_utils
 */

/**
 * Logging utility for controlled output based on log level.
 * @type {Object}
 */
const log = {
  level: "info",
  /**
   * Logs a debug message if the log level is 'debug' or 'info'.
   * @param {...any} args - Arguments to log.
   */
  debug: (...args) => {
    if (["debug", "info"].includes(log.level)) console.debug("[XISER]", ...args);
  },
  /**
   * Logs an info message if the log level is 'debug' or 'info'.
   * @param {...any} args - Arguments to log.
   */
  info: (...args) => {
    if (["debug", "info"].includes(log.level)) console.log("[XISER]", ...args);
  },
  /**
   * Logs a warning message if the log level is 'debug', 'info', or 'warning'.
   * @param {...any} args - Arguments to log.
   */
  warning: (...args) => {
    if (["debug", "info", "warning"].includes(log.level)) console.warn("[XISER]", ...args);
  },
  /**
   * Logs an error message.
   * @param {...any} args - Arguments to log.
   */
  error: (...args) => console.error("[XISER]", ...args),
};

/**
 * Minimum height for the node.
 * @type {number}
 */
const MIN_NODE_HEIGHT = 200;

/**
 * Debounces a function to limit execution frequency.
 * @param {Function} fn - Function to debounce.
 * @param {number} [delay=50] - Delay in milliseconds.
 * @returns {Function} Debounced function.
 */
function debounce(fn, delay = 50) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Generates a unique class name for node-specific styling.
 * @param {number} nodeId - The node ID.
 * @returns {string} Unique class name.
 */
function getNodeClass(nodeId) {
  return `xiser-image-manager-node-${nodeId}`;
}

/**
 * Validates image order array.
 * @param {number[]} order - Image order array.
 * @param {Object[]} previews - Image previews array.
 * @param {number} [nodeId] - Optional node ID for logging.
 * @returns {number[]} Validated order.
 */
function validateImageOrder(order, previews, nodeId = null) {
  const numPreviews = previews.length;
  const logPrefix = nodeId ? `Node ${nodeId}: ` : "";
  if (!Array.isArray(order) || order.length !== numPreviews || new Set(order).size !== numPreviews) {
    log.warning(`${logPrefix}Invalid imageOrder: ${JSON.stringify(order)}, resetting to [0...${numPreviews - 1}]`);
    return Array.from({ length: numPreviews }, (_, i) => i);
  }
  const validOrder = order.filter(idx => Number.isInteger(idx) && idx >= 0 && idx < numPreviews);
  if (validOrder.length !== numPreviews) {
    log.warning(`${logPrefix}Incomplete imageOrder: ${JSON.stringify(order)}, resetting to [0...${numPreviews - 1}]`);
    return Array.from({ length: numPreviews }, (_, i) => i);
  }
  return validOrder;
}

/**
 * Truncates a filename if it exceeds a specified length, appending '...'.
 * @param {string} filename - The filename to truncate.
 * @param {number} [maxLength=20] - Maximum length before truncation.
 * @returns {string} Truncated filename.
 */
function truncateFilename(filename, maxLength = 20) {
  if (filename.length <= maxLength) return filename;
  return filename.substring(0, maxLength - 3) + "...";
}

/**
 * Creates a DOM element with specified class and attributes.
 * @param {string} tag - HTML tag name.
 * @param {string} className - CSS class name.
 * @param {Object} [attributes={}] - Optional attributes to set.
 * @returns {HTMLElement} Created element.
 */
function createElementWithClass(tag, className, attributes = {}) {
  const element = document.createElement(tag);
  element.className = className;
  Object.entries(attributes).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      element.setAttribute(key, value);
    }
  });
  return element;
}

/**
 * Updates container height based on node size, avoiding redundant updates.
 * @param {HTMLElement} mainContainer - Main container element.
 * @param {HTMLElement} header - Header element.
 * @param {HTMLElement} cardContainer - Card container element.
 * @param {number[]} nodeSize - Node dimensions [width, height].
 * @param {number} nodeId - Node identifier.
 */
function updateContainerHeight(mainContainer, header, cardContainer, nodeSize, nodeId) {
  const nodeHeight = Math.max(parseInt(nodeSize[1]) || 360, MIN_NODE_HEIGHT);
  const headerHeight = header.offsetHeight || 60;
  const padding = 8;
  const availableHeight = nodeHeight - headerHeight - padding * 2;

  const currentHeight = parseFloat(mainContainer.style.height) || 0;
  const newHeight = Math.max(availableHeight, 100);
  if (Math.abs(currentHeight - newHeight) < 1) {
    log.debug(`Node ${nodeId}: Skipped container height update: current=${currentHeight}px, new=${newHeight}px`);
    return;
  }

  mainContainer.style.height = `${newHeight + 28}px`;
  cardContainer.style.height = `${Math.max(availableHeight - padding, 60)}px`;
  cardContainer.style.padding = `0 ${padding}px`;
  cardContainer.style.boxSizing = "border-box";
  log.debug(`Node ${nodeId}: Updated container height to ${newHeight}px, card height to ${cardContainer.style.height}`);
}

/**
 * Positions a popup near the mouse cursor, adjusting for screen edges.
 * @param {HTMLElement} popup - The popup element.
 * @param {number} clientX - Mouse X coordinate.
 * @param {number} clientY - Mouse Y coordinate.
 */
function positionPopup(popup, clientX, clientY) {
  const popupRect = popup.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  let left = clientX + 10;
  let top = clientY + 10;

  if (left + popupRect.width > viewportWidth) {
    left = Math.max(0, clientX - popupRect.width - 10);
  }
  if (top + popupRect.height > viewportHeight) {
    top = Math.max(0, clientY - popupRect.height - 10);
  }

  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;
}

/**
 * Initializes Sortable.js for drag-and-drop functionality on a container.
 * @param {HTMLElement} container - The container element for sortable items.
 * @param {string} nodeId - Node identifier for grouping.
 * @param {Function} onOrderChange - Callback invoked when order changes, receiving new order array.
 * @returns {Object|null} Sortable instance or null if Sortable.js is unavailable.
 */
function initializeSortable(container, nodeId, onOrderChange) {
  if (!window.Sortable) {
    log.error(`Sortable.js not loaded for node ${nodeId}`);
    return null;
  }
  return new Sortable(container, {
    animation: 150,
    handle: `.xiser-image-manager-image-card:not(.disabled)`,
    draggable: `.xiser-image-manager-image-card:not(.disabled)`,
    ghostClass: "sortable-ghost",
    chosenClass: "sortable-chosen",
    group: `xiser-image-manager-${nodeId}-cards`,
    onEnd: evt => {
      const newOrder = Array.from(container.children).map(card => parseInt(card.dataset.index));
      onOrderChange(newOrder);
    }
  });
}

/**
 * Injects UI styles for XISER nodes.
 */
function injectStyles() {
  const style = document.createElement("style");
  style.textContent = `
    .xiser-image-manager-container {
      box-sizing: border-box;
      width: 100%;
      min-width: 332px;
      background: rgba(0, 0, 0, 0.6);
      border-radius: 8px;
      padding: 8px;
      overflow: hidden;
      font-family: 'Inter', sans-serif;
      color: #F5F6F5;
      display: flex;
      flex-direction: column;
      position: relative; /* Changed from absolute to relative */
      z-index: 1000;
    }
    .xiser-image-manager-header {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 8px;
      flex-shrink: 0;
      z-index: 1000;
    }
    .xiser-image-manager-top-row {
      display: flex;
      align-items: center;
      width: 100%;
    }
    .xiser-image-manager-status {
      width: 66.67%;
      background: rgba(54, 54, 54, 0.6);
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      color: rgba(245, 246, 245, 0.8);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .xiser-image-manager-upload {
      width: 33.33%;
      padding: 4px 8px;
      background: #1DA1F2;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      color: #F5F6F5;
      transition: background 0.2s;
      text-align: center;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .xiser-image-manager-upload:hover {
      background: #0d8cd6;
    }
    .xiser-image-manager-controls {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    .xiser-image-manager-toggle-group {
      display: flex;
      gap: 12px;
    }
    .xiser-image-manager-control-item {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .xiser-image-manager-label {
      font-size: 11px;
      font-weight: 500;
      color: rgba(245, 246, 245, 0.8);
    }
    .xiser-image-manager-reset {
      padding: 3px 6px;
      background: #4A4A4A;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
      font-weight: 500;
      color: rgba(245, 246, 245, 0.8);
      transition: background 0.2s;
    }
    .xiser-image-manager-reset:hover {
      background: #5A5A5A;
    }
    .xiser-image-manager-image-card {
      display: flex;
      align-items: center;
      background: rgba(54, 54, 54, 0.6);
      padding: 8px;
      margin-bottom: 8px;
      border-radius: 6px;
      cursor: move;
      font-size: 12px;
      font-weight: 500;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
      transition: background 0.2s, transform 0.2s;
      position: relative;
    }
    .xiser-image-manager-image-card:hover {
      background: rgba(80, 80, 80, 0.6);
      transform: translateY(-1px);
    }
    .xiser-image-manager-image-card.sortable-chosen {
      background: rgb(29, 161, 242);
      opacity: 0.9;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
    }
    .xiser-image-manager-image-card.sortable-ghost {
      opacity: 0.4;
      background: rgb(29, 161, 242);
    }
    .xiser-image-manager-image-card.disabled {
      cursor: not-allowed;
      opacity: 0.6;
      box-shadow: none;
    }
    .xiser-image-manager-preview {
      width: 64px;
      height: 64px;
      object-fit: contain;
      margin-right: 12px;
      border-radius: 4px;
      border: 1px solid rgba(90, 90, 90, 0.6);
    }
    .xiser-image-manager-info {
      flex: 1;
      display: flex;
      flex-direction: column;
      line-height: 20px;
      max-width: 200px;
      color: rgba(245, 246, 245, 0.6);
    }
    .xiser-image-manager-layer-size {
      font-size: 12px;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .xiser-image-manager-filename {
      font-size: 11px;
      font-weight: 400;
      color: rgba(245, 246, 245, 0.6);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .xiser-image-manager-card-container {
      overflow-y: auto;
      flex-grow: 1;
      min-height: 60px;
      padding: 0 8px;
      box-sizing: border-box;
      scrollbar-width: thin;
      scrollbar-color: rgba(245, 246, 245, 0.4) transparent;
    }
    .xiser-image-manager-card-container::-webkit-scrollbar {
      width: 6px;
    }
    .xiser-image-manager-card-container::-webkit-scrollbar-track {
      background: transparent;
    }
    .xiser-image-manager-card-container::-webkit-scrollbar-thumb {
      background: rgba(245, 246, 245, 0.4);
      border-radius: 3px;
    }
    .xiser-image-manager-node {
      background: rgba(30, 30, 30, 0.6);
      border-radius: 8px;
      resize: both;
      overflow: hidden;
    }
    .xiser-image-manager-button-container {
      position: absolute;
      right: 10px;
      top: 26px;
      display: flex;
      align-items: center;
    }
    .xiser-image-manager-delete-button {
      width: 16px;
      height: 16px;
      margin-right: 5px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      opacity: 0.6;
      transition: opacity 0.2s;
    }
    .xiser-image-manager-delete-button:hover {
      opacity: 1;
    }
    .xiser-image-manager-toggle {
      width: 40px;
      height: 20px;
      appearance: none;
      background: #4A4A4A;
      border-radius: 10px;
      position: relative;
      cursor: pointer;
      outline: none;
      pointer-events: auto;
    }
    .xiser-image-manager-toggle:checked {
      background: #1DA1F2;
    }
    .xiser-image-manager-toggle::before {
      content: '';
      position: absolute;
      width: 16px;
      height: 16px;
      background: #F5F6F5;
      border-radius: 50%;
      top: 2px;
      left: 2px;
      transition: transform 0.2s;
    }
    .xiser-image-manager-toggle:checked::before {
      transform: translateX(20px);
    }
    .xiser-image-manager-toggle.toggle-disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .xiser-image-manager-popup-container {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 9999;
    }
    .xiser-image-manager-popup {
      position: fixed;
      background: rgba(50, 50, 50, 0.95);
      border-radius: 8px;
      padding: 16px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
      pointer-events: auto;
      z-index: 10000;
      width: 200px;
      min-height: 100px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      gap: 12px;
    }
    .xiser-image-manager-popup-message {
      font-size: 13px;
      color: #F5F6F5;
      font-weight: 500;
      text-align: center;
      width: 100%;
    }
    .xiser-image-manager-popup-buttons {
      display: flex;
      justify-content: center;
      gap: 12px;
      width: 100%;
    }
    .xiser-image-manager-popup-button {
      padding: 6px 16px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      text-align: center;
      flex: 1;
      transition: background 0.2s;
    }
    .xiser-image-manager-popup-confirm {
      background: #F55;
      color: #F5F6F5;
    }
    .xiser-image-manager-popup-confirm:hover {
      background: #D44;
    }
    .xiser-image-manager-popup-cancel {
      background: #4A4A4A;
      color: #F5F6F5;
    }
    .xiser-image-manager-popup-cancel:hover {
      background: #5A5A5A;
    }
  `;
  document.head.appendChild(style);
  log.info("XISER UI styles injected");
}

export {
  log,
  MIN_NODE_HEIGHT,
  debounce,
  getNodeClass,
  validateImageOrder,
  truncateFilename,
  createElementWithClass,
  updateContainerHeight,
  positionPopup,
  initializeSortable,
  injectStyles
};