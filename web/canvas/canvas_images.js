/**
 * @fileoverview Manages image loading and caching for the XISER_Canvas node.
 * @module canvas_images
 */

import { mergeStateWithAdjustments, withAdjustmentDefaults } from './canvas_state.js';
import { ensureLayerIds, applyLayerOrder, persistImageStates, normalizeLayerState } from './layer_store.js';

/**
 * Global caches for images and URLs, isolated by nodeId.
 * @type {Map<string, Map<string, HTMLImageElement>>}
 */

const globalImageCache = new Map();

/**
 * @type {Map<string, Map<string, string>>}
 */
const globalLoadedImageUrls = new Map();

/**
 * Loads images and initializes Konva image nodes.
 * @param {Object} node - The ComfyUI node instance.
 * @param {Object} nodeState - The node state object containing log, imageNodes, and other properties.
 * @param {string[]} imagePaths - Array of image file paths.
 * @param {Object[]} states - Array of layer states with properties like x, y, scaleX, scaleY, rotation.
 * @param {HTMLElement} statusText - Status text element for UI feedback.
 * @param {Object} uiElements - UI elements including updateLayerPanel function.
 * @param {Function} selectLayer - Callback to select a layer.
 * @param {Function} deselectLayer - Callback to deselect a layer.
 * @param {Function} [updateSize] - Callback to update canvas size.
 * @param {string[]} [base64Chunks=[]] - Array of base64 image chunks (unused, kept for compatibility).
 * @param {number} [retryCount=0] - Current retry attempt for failed image loads.
 * @param {number} [maxRetries=3] - Maximum retry attempts for failed image loads.
 * @param {boolean} [forceReload=false] - Forces reload even if paths and auto_size are unchanged.
 * @returns {Promise<void>} Resolves when image loading is complete.
 * @throws {Error} If image loading fails critically after retries.
 * @async
 */
export async function loadImages(node, nodeState, imagePaths, states, statusText, uiElements, selectLayer, deselectLayer, updateSize, base64Chunks = [], retryCount = 0, maxRetries = 3, forceReload = false) {
  const log = nodeState?.log || console;
  const nodeId = nodeState?.nodeId;

  // Validate inputs
  if (!node || !nodeState || !nodeId || !statusText || !uiElements) {
    log.error(`Invalid parameters for loadImages: node=${!!node}, nodeState=${!!nodeState}, nodeId=${nodeId}, statusText=${!!statusText}, uiElements=${!!uiElements}`);
    if (statusText && uiElements && uiElements.updateStatusText) {
      uiElements.updateStatusText("Invalid node configuration", "#f00");
    } else if (statusText) {
      statusText.innerText = "Invalid node configuration";
      statusText.style.color = "#f00";
    }
    return;
  }

  // Initialize caches for nodeId
  if (!globalImageCache.has(nodeId)) globalImageCache.set(nodeId, new Map());
  if (!globalLoadedImageUrls.has(nodeId)) globalLoadedImageUrls.set(nodeId, new Map());

  const imageCache = globalImageCache.get(nodeId);
  const loadedImageUrls = globalLoadedImageUrls.get(nodeId);

  // Validate imagePaths
  if (!Array.isArray(imagePaths) || !imagePaths.length || imagePaths.every(path => !path || typeof path !== 'string')) {
    log.info(`No valid image paths provided for node ${nodeId}: ${JSON.stringify(imagePaths)}`);
    if (uiElements && uiElements.updateStatusText) {
      uiElements.updateStatusText("No valid image data", "#f00");
    } else {
      statusText.innerText = "No valid image data";
      statusText.style.color = "#f00";
    }
    nodeState.isLoading = false;
    return;
  }

  // Filter valid image paths
  const validImagePaths = imagePaths.filter(path => typeof path === 'string' && path.trim().length > 0);
  if (validImagePaths.length === 0) {
    log.info(`No valid image paths after filtering for node ${nodeId}: ${JSON.stringify(imagePaths)}`);
    if (uiElements && uiElements.updateStatusText) {
      uiElements.updateStatusText("No valid image paths", "#f00");
    } else {
      statusText.innerText = "No valid image paths";
      statusText.style.color = "#f00";
    }
    nodeState.isLoading = false;
    return;
  }

  // Log invalid paths for debugging
  const invalidPaths = imagePaths.filter(path => !validImagePaths.includes(path));
  if (invalidPaths.length) {
    log.warn(`Invalid image paths filtered out for node ${nodeId}: ${JSON.stringify(invalidPaths)}`);
  }

  // Clean up stale cache entries
  for (const path of imageCache.keys()) {
    if (!validImagePaths.includes(path)) {
      imageCache.delete(path);
      loadedImageUrls.delete(path);
    }
  }

  const autoSize = node.properties?.ui_config?.auto_size || "off";
  // Include auto_size, retryCount, and forceReload in hash
  const pathsHash = JSON.stringify({ imagePaths: validImagePaths, autoSize, retryCount, forceReload });

  // Skip loading if no changes and not forced
  if (!forceReload && nodeState.lastImagePathsHash === pathsHash) {
    nodeState.isLoading = false;
    return;
  }
  nodeState.lastImagePathsHash = pathsHash;

  if (nodeState.isLoading) {
    log.info(`LoadImages already in progress for node ${nodeId}, skipping`);
    return;
  }
  nodeState.isLoading = true;

  log.info(`Starting loadImages for node ${nodeId}, imagePaths: ${JSON.stringify(validImagePaths)}, length: ${validImagePaths.length}, forceReload: ${forceReload}, retryCount: ${retryCount}`);

  // Clean up existing image nodes and transformer
  nodeState.imageNodes.forEach((node, i) => {
    if (node) {
      node.off('dragend transformend'); // Remove listeners
      node.destroy();
    } else {
      log.warn(`Null imageNode at index ${i} during cleanup for node ${nodeId}`);
    }
  });
  nodeState.imageNodes = new Array(validImagePaths.length).fill(null);
  nodeState.imageRefs = new Array(validImagePaths.length).fill(null);
  if (nodeState.imageLayer) {
    if (nodeState.adjustments?.detachIcon) {
      try {
        nodeState.adjustments.detachIcon();
      } catch (error) {
        log.warn(`Failed to detach edit icon for node ${nodeId}: ${error.message}`);
      }
    }
    nodeState.imageLayer.destroyChildren();
    nodeState.imageLayer.batchDraw();
  }
  if (nodeState.transformer) {
    nodeState.transformer.nodes([]);
    nodeState.transformer.destroy();
    nodeState.transformer = null;
  }

  const borderWidth = node.properties?.ui_config?.border_width || 120;
  let boardWidth = node.properties?.ui_config?.board_width || 1024;
  let boardHeight = node.properties?.ui_config?.board_height || 1024;

  // Handle auto_size
  if (autoSize === "on" && validImagePaths.length) {
  }

  // Initialize states
  nodeState.initialStates = validImagePaths.map((_, i) => withAdjustmentDefaults({
    x: states[i]?.x || borderWidth + boardWidth / 2,
    y: states[i]?.y || borderWidth + boardHeight / 2,
    scaleX: states[i]?.scaleX || 1,
    scaleY: states[i]?.scaleY || 1,
    rotation: states[i]?.rotation || 0,
    skewX: states[i]?.skewX || 0,
    skewY: states[i]?.skewY || 0,
    brightness: states[i]?.brightness,
    contrast: states[i]?.contrast,
    saturation: states[i]?.saturation,
    visible: states[i]?.visible,
    locked: states[i]?.locked,
  }));

  const images = validImagePaths.map(path => ({ filename: path, subfolder: "xiser_canvas", type: "output", mime_type: "image/png" }));
  nodeState.imageRefs = images.slice();
  if (uiElements && uiElements.updateStatusText) {
    uiElements.updateStatusText(`Loading images... 0/${images.length}`, "#fff");
  } else {
    statusText.innerText = `Loading images... 0/${images.length}`;
    statusText.style.color = "#fff";
  }

  let loadedCount = 0;

  // Load images concurrently
  const loadImagePromises = images.map((imgData, i) => {
    return new Promise((resolve) => {
      if (!imgData?.filename) {
        log.error(`Invalid imgData at index ${i} for node ${nodeId}: ${JSON.stringify(imgData)}`);
        resolve({ img: null, index: i, success: false });
        return;
      }

      let img = imageCache.get(imgData.filename);
      if (img) {
        resolve({ img, index: i, success: true });
        return;
      }

      img = new Image();
      const imgUrl = `/view?filename=${encodeURIComponent(imgData.filename)}&subfolder=${encodeURIComponent(imgData.subfolder || '')}&type=${imgData.type}&rand=${Math.random()}`;
      img.src = imgUrl;

      img.onload = () => {
        imageCache.set(imgData.filename, img);
        loadedImageUrls.set(imgData.filename, imgUrl);
        log.info(`Image loaded successfully: ${imgData.filename}, dimensions: ${img.width}x${img.height}, URL: ${imgUrl}`);
        resolve({ img, index: i, success: true });
      };
      img.onerror = () => {
        log.error(`Failed to load image ${imgData.filename} for node ${nodeId}`);
        if (retryCount < maxRetries) {
          log.info(`Retrying image ${imgData.filename} for node ${nodeId}, attempt ${retryCount + 1}`);
          setTimeout(() => loadImages(node, nodeState, [imgData.filename], [states[i] || {}], statusText, uiElements, selectLayer, deselectLayer, updateSize, base64Chunks, retryCount + 1, maxRetries, true), 1000);
        }
        resolve({ img: null, index: i, success: false });
      };
    });
  });

  try {
    const results = await Promise.allSettled(loadImagePromises);

    for (const result of results) {
      if (result.status !== 'fulfilled') {
        log.error(`Promise rejected for image index ${result.reason?.index} in node ${nodeId}`);
        continue;
      }

      const { img, index, success } = result.value;
      if (!success || !img) {
        log.warn(`Image at index ${index} failed to load for node ${nodeId}`);
        continue;
      }

      try {
        // Handle auto_size for first image
        if (autoSize === "on" && index === 0) {
          const newBoardWidth = Math.min(Math.max(parseInt(img.width), 256), 8192);
          const newBoardHeight = Math.min(Math.max(parseInt(img.height), 256), 8192);
          log.info(`First image dimensions for node ${nodeId}: ${img.width}x${img.height}, adjusted to ${newBoardWidth}x${newBoardHeight}`);
          if (newBoardWidth !== boardWidth || newBoardHeight !== boardHeight) {
            node.properties.ui_config.board_width = newBoardWidth;
            node.properties.ui_config.board_height = newBoardHeight;
            boardWidth = newBoardWidth;
            boardHeight = newBoardHeight;
            node.widgets.find(w => w.name === "board_width").value = boardWidth;
            node.widgets.find(w => w.name === "board_height").value = boardHeight;
            if (uiElements && uiElements.updateStatusText) {
              uiElements.updateStatusText(`Canvas resized to ${boardWidth}x${boardHeight}`, "#fff");
            } else {
              statusText.innerText = `Canvas resized to ${boardWidth}x${boardHeight}`;
            }
            statusText.style.color = "#0f0";
            log.info(`Auto-size enabled, adjusted canvas to ${boardWidth}x${newBoardHeight} for node ${nodeId}`);

            // Update initial states
            nodeState.initialStates = validImagePaths.map((_, i) => withAdjustmentDefaults({
              x: states[i]?.x || borderWidth + boardWidth / 2,
              y: states[i]?.y || borderWidth + boardHeight / 2,
              scaleX: states[i]?.scaleX || 1,
              scaleY: states[i]?.scaleY || 1,
              rotation: states[i]?.rotation || 0,
              skewX: states[i]?.skewX || 0,
              skewY: states[i]?.skewY || 0,
              brightness: states[i]?.brightness,
              contrast: states[i]?.contrast,
              saturation: states[i]?.saturation,
              order: Number.isFinite(states[i]?.order) ? states[i].order : i,
              filename: states[i]?.filename || validImagePaths[i],
            }));
            node.properties.image_states = nodeState.initialStates;
            node.widgets.find(w => w.name === "image_states").value = JSON.stringify(nodeState.initialStates);
            node.setProperty("image_states", nodeState.initialStates);

            if (typeof updateSize === 'function') {
              updateSize();
              nodeState.stage.draw();
            } else {
              log.warn(`updateSize is not a function for node ${nodeId}, skipping canvas size update`);
            }
          }
        }

        const state = withAdjustmentDefaults(nodeState.initialStates[index] || {});
        const konvaImg = new Konva.Image({
          image: img,
          x: state.x || borderWidth + boardWidth / 2,
          y: state.y || borderWidth + boardHeight / 2,
          scaleX: state.scaleX || 1,
          scaleY: state.scaleY || 1,
          rotation: state.rotation || 0,
          skewX: state.skewX || 0,
          skewY: state.skewY || 0,
          draggable: true,
          offsetX: img.width / 2,
          offsetY: img.height / 2,
          filename: images[index].filename,
          visible: state.visible !== false,
        });
        const ref = nodeState.imageRefs?.[index];
        if (ref) {
          konvaImg.fileRef = ref;
        }
        nodeState.imageLayer.add(konvaImg);
        nodeState.imageNodes[index] = konvaImg;
        nodeState.initialStates[index] = withAdjustmentDefaults({
          ...nodeState.initialStates[index],
          x: konvaImg.x(),
          y: konvaImg.y(),
          scaleX: konvaImg.scaleX(),
          scaleY: konvaImg.scaleY(),
          rotation: konvaImg.rotation(),
          skewX: konvaImg.skewX(),
          skewY: konvaImg.skewY(),
        });

        if (typeof nodeState.applyLayerAdjustments === 'function') {
          try {
            nodeState.applyLayerAdjustments(index);
          } catch (error) {
            log.warn(`applyLayerAdjustments failed for node ${nodeId}, layer ${index}: ${error.message}`);
          }
        }

        // Debounced state update
        const debouncedUpdateState = debounce((index, konvaImg) => {
          const newState = mergeStateWithAdjustments(nodeState.initialStates[index], {
            x: konvaImg.x(),
            y: konvaImg.y(),
            scaleX: konvaImg.scaleX(),
            scaleY: konvaImg.scaleY(),
            rotation: konvaImg.rotation(),
            skewX: konvaImg.skewX ? konvaImg.skewX() : 0,
            skewY: konvaImg.skewY ? konvaImg.skewY() : 0,
          });
          nodeState.initialStates[index] = newState;
          node.properties.image_states = nodeState.initialStates;
          node.widgets.find(w => w.name === "image_states").value = JSON.stringify(nodeState.initialStates);
          node.setProperty("image_states", nodeState.initialStates);
          nodeState.imageLayer.batchDraw();
          debounceSaveHistory(nodeState);
        }, 100);

        // Attach event listeners
        konvaImg.on("dragend transformend", () => {
          debouncedUpdateState(index, konvaImg);
        });

        loadedCount++;
        if (uiElements && uiElements.updateStatusText) {
          uiElements.updateStatusText(`Loading images... ${loadedCount}/${images.length}`, "#fff");
        } else {
          statusText.innerText = `Loading images... ${loadedCount}/${images.length}`;
        }
      } catch (e) {
        log.error(`Error processing image ${index + 1} for node ${nodeId}: ${e.message}, path: ${images[index]?.filename || 'unknown'}`);
        if (uiElements && uiElements.updateStatusText) {
          uiElements.updateStatusText(`Load failed: ${e.message}`, "#f00");
        } else {
          statusText.innerText = `Load failed: ${e.message}`;
          statusText.style.color = "#f00";
        }
        nodeState.imageNodes[index] = null;
      }
    }

    // Persisted map for visibility/order fallback
    const persistedStateMap = new Map();
    if (Array.isArray(node?.properties?.image_states)) {
      node.properties.image_states.forEach((st, idx) => {
        const lid = st?.layer_id || node?.properties?.ui_config?.layer_ids?.[idx] || `layer_${idx}`;
        if (lid) persistedStateMap.set(lid, st);
      });
    }

    // Keep arrays aligned to image_paths; fill missing nodes with defaults
    nodeState.imageNodes.forEach((node, idx) => {
      if (!node) {
        nodeState.initialStates[idx] = nodeState.initialStates[idx] || withAdjustmentDefaults({ filename: validImagePaths[idx] });
      }
    });
    // Ensure filenames/order are attached; prefer persisted layer_order if available
    ensureLayerIds(node, validImagePaths);
    const persistedLayerOrder = Array.isArray(node.properties?.ui_config?.layer_order)
      ? node.properties.ui_config.layer_order
      : null;
    nodeState.initialStates = nodeState.initialStates.map((s, idx) => {
      const layerId = s?.layer_id || node.properties?.ui_config?.layer_ids?.[idx] || `layer_${idx}`;
      const orderFromPersisted = Array.isArray(persistedLayerOrder) ? persistedLayerOrder.indexOf(layerId) : -1;
      const persistedState = persistedStateMap.get(layerId);
      const mergedVisible = typeof persistedState?.visible === 'boolean'
        ? persistedState.visible
        : (typeof s?.visible === 'boolean' ? s.visible : true);
      return normalizeLayerState(
        {
          ...s,
          visible: mergedVisible,
          order: orderFromPersisted >= 0 ? orderFromPersisted : (Number.isFinite(s?.order) ? s.order : idx),
        },
        layerId,
        s?.filename || validImagePaths[idx],
        orderFromPersisted >= 0 ? orderFromPersisted : idx,
      );
    });

    // Apply stacking by order without reordering arrays
    const orderPairs = nodeState.imageNodes.map((node, idx) => ({
      idx,
      order: Number.isFinite(nodeState.initialStates[idx]?.order) ? nodeState.initialStates[idx].order : idx,
    }));
    // Apply stacking and persist via shared helpers
    applyLayerOrder(node, nodeState);
    const imageStatesWidget = node.widgets?.find(w => w.name === 'image_states');
    persistImageStates(node, nodeState, imageStatesWidget);

    // Initialize transformer with scaling and rotation capabilities
    nodeState.transformer = new Konva.Transformer({
      nodes: [],
      keepRatio: false, // Allow independent scaling
      enabledAnchors: [
        "top-left", "top-center", "top-right",
        "middle-left", "middle-right",
        "bottom-left", "bottom-center", "bottom-right"
      ],
      rotateEnabled: true,
      rotateAnchorOffset: 40,
      borderEnabled: true,
      borderStroke: "#0099ff",
      borderStrokeWidth: 2,
      anchorStroke: "#0099ff",
      anchorStrokeWidth: 2,
      anchorFill: "#ffffff",
      anchorSize: 8,
      anchorCornerRadius: 2,
      // Enable scaling and rotation only (disable skew)
      transform: "scale-rotate", // Enable scaling and rotation only
    });
    nodeState.imageLayer.add(nodeState.transformer);
    nodeState.imageLayer.batchDraw();
    nodeState.stage.batchDraw();
    if (nodeState.adjustments?.reattachIcon) {
      try {
        nodeState.adjustments.reattachIcon();
      } catch (error) {
        log.warn(`Failed to reattach edit icon for node ${nodeId}: ${error.message}`);
      }
    }

    // Update UI and history
    uiElements.updateLayerPanel(selectLayer, deselectLayer);
    if (loadedCount === 0) {
      if (uiElements && uiElements.updateStatusText) {
        uiElements.updateStatusText("Unable to load any images, please check upstream nodes", "#f00");
      } else {
        statusText.innerText = "Unable to load any images, please check upstream nodes";
        statusText.style.color = "#f00";
      }
    } else {
      if (uiElements && uiElements.updateStatusText) {
        uiElements.updateStatusText(`Loaded ${loadedCount} images`, "#0f0");
      } else {
        statusText.innerText = `Loaded ${loadedCount} images`;
        statusText.style.color = "#0f0";
      }
    }
    saveHistory(nodeState);
  } catch (e) {
    log.error(`Critical error in loadImages for node ${nodeId}: ${e.message}`);
    if (uiElements && uiElements.updateStatusText) {
      uiElements.updateStatusText(`Critical error: ${e.message}`, "#f00");
    } else {
      statusText.innerText = `Critical error: ${e.message}`;
      statusText.style.color = "#f00";
    }
  } finally {
    nodeState.isLoading = false;
    log.info(`Finished loadImages for node ${nodeId}, imageNodes: ${nodeState.imageNodes.length}, initialStates: ${nodeState.initialStates.length}`);
  }
}

/**
 * Clears all cached images and URLs for a specific node.
 * @param {string|number} nodeId - The ID of the node whose cache should be cleared.
 */
export function clearNodeCache(nodeId) {
  const log = console; // Use default console since nodeState may not be available
  if (globalImageCache.has(nodeId)) {
    globalImageCache.get(nodeId).clear();
    globalImageCache.delete(nodeId);
  }
  if (globalLoadedImageUrls.has(nodeId)) {
    globalLoadedImageUrls.get(nodeId).clear();
    globalLoadedImageUrls.delete(nodeId);
  }
}

/**
 * Invalidates a cached image for a specific node so the next load request fetches it anew.
 * @param {string|number} nodeId - Identifier for the node whose cache should be affected.
 * @param {string} filename - The cached filename/reference to invalidate.
 */
export function invalidateCachedImage(nodeId, filename) {
  if (!nodeId || !filename) return;
  const imageCache = globalImageCache.get(nodeId);
  const loadedImageUrls = globalLoadedImageUrls.get(nodeId);
  if (imageCache && imageCache.has(filename)) {
    imageCache.delete(filename);
  }
  if (loadedImageUrls && loadedImageUrls.has(filename)) {
    loadedImageUrls.delete(filename);
  }
}

/**
 * Debounces history saving to reduce redundant history entries.
 * @param {Object} nodeState - The node state object.
 * @private
 */
function debounceSaveHistory(nodeState) {
  if (nodeState.historyDebounceTimeout) clearTimeout(nodeState.historyDebounceTimeout);
  nodeState.historyDebounceTimeout = setTimeout(() => {
    saveHistory(nodeState);
    nodeState.historyDebounceTimeout = null;
  }, 300);
}

/**
 * Saves the current state to history.
 * @param {Object} nodeState - The node state object.
 * @private
 */
function saveHistory(nodeState) {
  const currentState = nodeState.initialStates.map(state => ({ ...state }));
  nodeState.history = nodeState.history || [];
  nodeState.history.splice(nodeState.historyIndex + 1);
  nodeState.history.push(currentState);
  nodeState.historyIndex = (nodeState.historyIndex || -1) + 1;
  if (nodeState.history.length > 20) {
    nodeState.history.shift();
    nodeState.historyIndex--;
  }
  nodeState.log?.debug(`Saved history for node ${nodeState.nodeId}, index: ${nodeState.historyIndex}, entries: ${nodeState.history.length}`);
}

/**
 * Debounces a function to limit its execution rate.
 * @param {Function} func - The function to debounce.
 * @param {number} wait - The debounce wait time in milliseconds.
 * @returns {Function} The debounced function.
 * @private
 */
function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}
