/**
 * @fileoverview XIS_ImageManager node for ComfyUI, handling frontend-driven state management and node lifecycle.
 * @module xis_image_manager
 */

import { app } from "/scripts/app.js";
import { log, MIN_NODE_HEIGHT, debounce, getNodeClass, validateImageOrder, injectStyles, arraysShallowEqual, areImageStatesEqual, areImagePreviewsEqual } from "./utils.js";
import { createImageManagerUI } from "./ui.js";

/**
 * Uploads images to the server and returns their metadata.
 * @param {File[]} files - Array of image files to upload.
 * @param {string} nodeId - Node identifier.
 * @param {Object} node - Node instance.
 * @returns {Promise<Object[]>} Array of image metadata objects.
 * @async
 */
async function uploadImages(files, nodeId, node = null) {
  const formData = new FormData();
  const originalFilenames = [];
  for (const file of files) {
    if (file.type.startsWith("image/")) {
      formData.append("images", file);
      originalFilenames.push(file.name);
    }
  }
  formData.append("node_id", nodeId);
  log.info(`Uploading ${files.length} images for node ${nodeId}`);
  try {
    const response = await fetch("/upload/xis_image_manager", {
      method: "POST",
      body: formData
    });
    if (!response.ok) throw new Error(`Upload failed: ${response.statusText}`);
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    const images = data.images.map((img, i) => ({
      ...img,
      originalFilename: originalFilenames[i] || img.filename
    }));
    log.info(`Uploaded ${images.length} images for node ${nodeId}`);
    return images;
  } catch (e) {
    log.error(`Image upload failed for node ${nodeId}: ${e}`);
    throw e;
  }
}

/**
 * Deletes an uploaded image from the server.
 * @param {string} filename - The filename to delete.
 * @param {string} nodeId - Node identifier.
 * @returns {Promise<void>}
 * @async
 */
async function deleteImage(filename, nodeId) {
  try {
    const response = await fetch("/delete/xis_image_manager", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename, node_id: nodeId })
    });
    if (!response.ok) throw new Error(`Delete failed: ${response.statusText}`);
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    log.info(`Deleted image ${filename} for node ${nodeId}`);
  } catch (e) {
    log.error(`Image deletion failed for node ${nodeId}: ${e}`);
    throw e;
  }
}

function reconcileImageState(imagePreviews, imageState) {
  const previewById = new Map();
  imagePreviews.forEach((preview) => {
    if (preview.image_id) previewById.set(preview.image_id, preview);
  });

  const result = [];
  const seen = new Set();

  if (Array.isArray(imageState)) {
    for (const entry of imageState) {
      if (!entry || typeof entry !== "object" || !entry.id) continue;
      const preview = previewById.get(entry.id);
      if (!preview) continue;
      result.push({
        id: entry.id,
        enabled: entry.enabled !== undefined ? !!entry.enabled : true,
        source: entry.source ?? preview.source,
        filename: entry.filename ?? preview.filename,
        originalFilename: entry.originalFilename ?? preview.originalFilename,
      width: entry.width ?? preview.width,
      height: entry.height ?? preview.height,
      index: preview.index,
      contentHash: entry.contentHash ?? entry.content_hash ?? preview.content_hash ?? preview.contentHash ?? null,
      storageFilename: entry.storageFilename ?? entry.storage_filename ?? preview.storageFilename ?? preview.storage_filename ?? preview.filename
    });
    seen.add(entry.id);
  }
  }

  for (const preview of imagePreviews) {
    if (seen.has(preview.image_id)) continue;
    result.push({
      id: preview.image_id,
      enabled: true,
      source: preview.source,
      filename: preview.filename,
      originalFilename: preview.originalFilename,
      width: preview.width,
      height: preview.height,
      index: preview.index,
      contentHash: preview.content_hash || preview.contentHash || null,
      storageFilename: preview.storageFilename || preview.storage_filename || preview.filename
    });
  }

  return result;
}

function deriveOrderAndEnabled(imagePreviews, imageState) {
  const idToPreview = new Map();
  imagePreviews.forEach((preview) => {
    if (preview.image_id) idToPreview.set(preview.image_id, preview);
  });

  const imageOrder = [];
  const enabledLayers = Array(imagePreviews.length).fill(true);
  const seen = new Set();

  (imageState || []).forEach((entry) => {
    if (!entry || !entry.id) return;
    const preview = idToPreview.get(entry.id);
    if (!preview) return;
    imageOrder.push(preview.index);
    enabledLayers[preview.index] = entry.enabled !== undefined ? !!entry.enabled : true;
    seen.add(entry.id);
  });

  imagePreviews.forEach((preview) => {
    if (!seen.has(preview.image_id)) {
      imageOrder.push(preview.index);
    }
  });

  return { imageOrder, enabledLayers };
}

function serializeImageState(imageState, nodeId) {
  const images = (imageState || []).map((entry) => ({
    id: entry.id,
    enabled: entry.enabled !== undefined ? !!entry.enabled : true,
    source: entry.source ?? null,
    filename: entry.filename ?? null,
    originalFilename: entry.originalFilename ?? null,
    width: entry.width ?? null,
    height: entry.height ?? null,
    index: entry.index ?? null,
    contentHash: entry.contentHash ?? entry.content_hash ?? null,
    storageFilename: entry.storageFilename ?? entry.storage_filename ?? entry.filename ?? null
  }));

  return JSON.stringify({ node_id: nodeId, images });
}

function buildStateFromLegacy(imagePreviews, imageOrder = [], enabledLayers = []) {
  const previewsByIndex = new Map(imagePreviews.map((preview) => [preview.index, preview]));
  const result = [];
  const seen = new Set();
  const orderList = Array.isArray(imageOrder) && imageOrder.length
    ? imageOrder
    : imagePreviews.map((preview) => preview.index);

  orderList.forEach((idx) => {
    const preview = previewsByIndex.get(idx);
    if (!preview || seen.has(preview.image_id)) return;
    const enabled = idx < enabledLayers.length ? !!enabledLayers[idx] : true;
    result.push({
      id: preview.image_id,
      enabled,
      source: preview.source,
      filename: preview.filename,
      originalFilename: preview.originalFilename,
      width: preview.width,
      height: preview.height,
      index: preview.index,
      contentHash: preview.content_hash || preview.contentHash || null,
      storageFilename: preview.storageFilename || preview.storage_filename || preview.filename
    });
    seen.add(preview.image_id);
  });

  imagePreviews.forEach((preview) => {
    if (seen.has(preview.image_id)) return;
    const enabled = preview.index < enabledLayers.length ? !!enabledLayers[preview.index] : true;
    result.push({
      id: preview.image_id,
      enabled,
      source: preview.source,
      filename: preview.filename,
      originalFilename: preview.originalFilename,
      width: preview.width,
      height: preview.height,
      index: preview.index,
      contentHash: preview.content_hash || preview.contentHash || null,
      storageFilename: preview.storageFilename || preview.storage_filename || preview.filename
    });
    seen.add(preview.image_id);
  });

  return result;
}

function reorderStateFromOrder(imagePreviews, imageState, nextOrder) {
  const previewByIndex = new Map(imagePreviews.map((preview) => [preview.index, preview]));
  const entryById = new Map((Array.isArray(imageState) ? imageState : []).map(entry => [entry.id, entry]));
  const ordered = [];
  const seen = new Set();

  (Array.isArray(nextOrder) ? nextOrder : []).forEach(idx => {
    const preview = previewByIndex.get(idx);
    if (!preview || !preview.image_id || seen.has(preview.image_id)) return;
    const entry = entryById.get(preview.image_id);
    if (entry) {
      ordered.push(entry);
      seen.add(preview.image_id);
    }
  });

  imagePreviews.forEach(preview => {
    if (!preview.image_id || seen.has(preview.image_id)) return;
    const entry = entryById.get(preview.image_id);
    if (entry) {
      ordered.push(entry);
      seen.add(preview.image_id);
    }
  });

  return reconcileImageState(imagePreviews, ordered);
}

function enforceSingleModeState(imageState) {
  if (!Array.isArray(imageState) || !imageState.length) return imageState;
  let activeIndex = imageState.findIndex(entry => entry && entry.enabled);
  if (activeIndex < 0) activeIndex = 0;
  return imageState.map((entry, idx) => ({
    ...entry,
    enabled: idx === activeIndex
  }));
}

/**
 * Computes the effective output state for comparison.
 * @param {Object[]} imagePreviews - Array of image preview objects.
 * @param {Object[]} imageState - Unified image state entries.
 * @returns {string} Hash of the effective output state.
 */
function computeOutputHash(imagePreviews, imageState) {
  const { imageOrder, enabledLayers } = deriveOrderAndEnabled(imagePreviews, imageState);
  const outputImages = imageOrder
    .filter((_, i) => enabledLayers[i])
    .map(idx => imagePreviews.find(p => p.index === idx)?.filename || "");
  return JSON.stringify({
    images: outputImages,
    previews: imagePreviews.map(p => ({
      index: p.index,
      filename: p.filename,
      width: p.width,
      height: p.height
    }))
  });
}

function getNormalizedNodeSize(size) {
  return Array.isArray(size) && size.length === 2 ? size : [360, 360];
}

function getSerializedImageStateValue(node, imageState, nodeIdOverride = null) {
  if (!node) return serializeImageState(imageState, nodeIdOverride || "unknown");
  const cache = node._serializedImageStateCache;
  const resolvedNodeId = nodeIdOverride || node.properties?.node_id || node.id;
  if (cache && cache.stateRef === imageState && cache.nodeId === resolvedNodeId) {
    return cache.value;
  }
  const serialized = serializeImageState(imageState, resolvedNodeId);
  node._serializedImageStateCache = { stateRef: imageState, nodeId: resolvedNodeId, value: serialized };
  return serialized;
}

function cacheNodeState(node, state) {
  if (!node) return;
  node._xisCachedState = {
    imagePreviews: Array.isArray(state.imagePreviews) ? state.imagePreviews : [],
    imageState: Array.isArray(state.imageState) ? state.imageState : [],
    isReversed: !!state.isReversed,
    isSingleMode: !!state.isSingleMode,
    nodeSize: getNormalizedNodeSize(state.nodeSize)
  };
}

const pendingNodeRegistry = new Map();

function finalizePendingNode(node, entry, resolvedId) {
  if (entry.timeoutId) {
    clearTimeout(entry.timeoutId);
    entry.timeoutId = null;
  }
  pendingNodeRegistry.delete(node);
  try {
    entry.callback(resolvedId);
  } catch (error) {
    log.error(`Failed to initialize pending node ${resolvedId}: ${error}`);
  }
}

function tryResolvePendingNode(node, entry) {
  if (!node) return false;
  const resolvedId = node.id > 0 && app.graph.getNodeById(node.id) ? node.id : null;
  if (!resolvedId) return false;
  finalizePendingNode(node, entry, resolvedId);
  log.info(`Node initialized after pending resolution: ID ${resolvedId}, type ${node.type}, title ${node.title || "undefined"}`);
  return true;
}

function schedulePendingRetry(node, entry) {
  entry.timeoutId = setTimeout(() => {
    if (tryResolvePendingNode(node, entry)) return;
    if (entry.retries <= 0) {
      const fallbackId = node && node.id > 0 ? node.id : Math.abs(node?.id || 0) || Date.now();
      log.warning(`Node ID ${node?.id || "undefined"} not assigned after max retries. Using fallback ID ${fallbackId}.`);
      finalizePendingNode(node, entry, fallbackId);
      return;
    }
    entry.retries -= 1;
    schedulePendingRetry(node, entry);
  }, entry.delay);
}

function registerPendingNode(node, callback, retries = 20, delay = 200) {
  const entry = { callback, retries, delay, timeoutId: null };
  pendingNodeRegistry.set(node, entry);
  if (!tryResolvePendingNode(node, entry)) {
    schedulePendingRetry(node, entry);
  }
}

function processPendingNodes() {
  pendingNodeRegistry.forEach((entry, pendingNode) => {
    tryResolvePendingNode(pendingNode, entry);
  });
}

/**
 * Updates node widgets with frontend state and ensures serialization only when necessary.
 * @param {Object} node - The node instance.
 * @param {Object} state - State object.
 * @param {Object[]} state.imagePreviews - Array of image preview objects.
 * @param {Object[]} [state.imageState] - Unified image state entries.
 * @param {boolean} [state.isReversed] - Whether the order is reversed.
 * @param {boolean} [state.isSingleMode] - Whether single mode is active.
 * @param {number[]} [state.nodeSize] - Node dimensions [width, height].
 * @param {HTMLElement} statusText - Status text element for UI feedback.
 * @param {Function} debouncedUpdateCardList - Debounced function to update the card list.
 */

/**
 * Get current state from node widgets
 * @param {Object} node - The node instance
 * @returns {Object} Current state object
 */
function getStateFromNode(node) {
  if (node?._xisCachedState) {
    const cached = node._xisCachedState;
    return {
      imagePreviews: cached.imagePreviews || [],
      imageState: cached.imageState || [],
      isReversed: !!cached.isReversed,
      isSingleMode: !!cached.isSingleMode,
      nodeSize: getNormalizedNodeSize(cached.nodeSize)
    };
  }
  try {
    const nodeSizeData = JSON.parse(node.widgets[3].value || "[360, 360]");
    const reversedData = JSON.parse(node.widgets[4].value || "{}");
    const singleModeData = JSON.parse(node.widgets[5].value || "{}");

    let imageStateData = [];
    if (node.widgets[7] && node.widgets[7].value) {
      const parsedState = JSON.parse(node.widgets[7].value || "[]");
      if (Array.isArray(parsedState)) {
        imageStateData = parsedState;
      } else if (parsedState && typeof parsedState === "object" && Array.isArray(parsedState.images)) {
        imageStateData = parsedState.images;
      }
    }

    if (!imageStateData.length) {
      const orderData = JSON.parse(node.widgets[0].value || "{}");
      const enabledData = JSON.parse(node.widgets[1].value || "{}");
      const previews = node.properties.image_previews || [];
      imageStateData = buildStateFromLegacy(
        previews,
        Array.isArray(orderData?.order) ? orderData.order : [],
        Array.isArray(enabledData?.enabled) ? enabledData.enabled : []
      );
    }

    const previews = node.properties.image_previews || [];
    const reconciledState = reconcileImageState(previews, imageStateData);
    const normalizedState = {
      imagePreviews: previews,
      imageState: reconciledState,
      isReversed: !!(reversedData.reversed ?? reversedData),
      isSingleMode: !!(singleModeData.single_mode ?? singleModeData),
      nodeSize: getNormalizedNodeSize(nodeSizeData)
    };
    cacheNodeState(node, normalizedState);
    return normalizedState;
  } catch (e) {
    log.error(`Failed to get state from node ${node.id}: ${e}`);
    const fallbackState = {
      imagePreviews: node.properties.image_previews || [],
      imageState: [],
      isReversed: false,
      isSingleMode: false,
      nodeSize: [360, 360]
    };
    cacheNodeState(node, fallbackState);
    return fallbackState;
  }
}

function updateState(node, state, statusText, debouncedUpdateCardList) {
  const imagePreviews = Array.isArray(state.imagePreviews) ? state.imagePreviews : [];
  const resolvedState = Array.isArray(state.imageState) && state.imageState.length
    ? state.imageState
    : buildStateFromLegacy(imagePreviews, state.imageOrder, state.enabledLayers);

  const reconciledState = reconcileImageState(imagePreviews, resolvedState);
  const { imageOrder, enabledLayers } = deriveOrderAndEnabled(imagePreviews, reconciledState);
  const isReversed = !!state.isReversed;
  const isSingleMode = !!state.isSingleMode;
  const nodeSize = getNormalizedNodeSize(state.nodeSize);

  cacheNodeState(node, {
    imagePreviews,
    imageState: reconciledState,
    isReversed,
    isSingleMode,
    nodeSize
  });

  let stateChanged = false;

  // CRITICAL: Always update widgets immediately when state changes
  // This ensures backend receives the latest state on next execution
  // Use consistent node_id across all widgets to ensure fingerprint consistency
  const correctNodeId = node.properties.node_id || node.id;
  const newOrderValue = JSON.stringify({ node_id: correctNodeId, order: imageOrder });
  const newEnabledValue = JSON.stringify({ node_id: correctNodeId, enabled: enabledLayers });
  const newReverseValue = JSON.stringify({ node_id: correctNodeId, reversed: isReversed });
  const newSingleModeValue = JSON.stringify({ node_id: correctNodeId, single_mode: isSingleMode });
  const newSizeValue = JSON.stringify(nodeSize);
  const newImageIdsValue = JSON.stringify({ node_id: correctNodeId, image_ids: imagePreviews.map(p => p.image_id || "") });
  const newImageStateValue = getSerializedImageStateValue(node, reconciledState, correctNodeId);

  // Update widgets with latest state
  if (node.widgets[0].value !== newOrderValue) {
    node.widgets[0].value = newOrderValue;
    stateChanged = true;
  }

  if (node.widgets[1].value !== newEnabledValue) {
    node.widgets[1].value = newEnabledValue;
    stateChanged = true;
  }

  if (node.widgets[2].value !== correctNodeId) {
    node.widgets[2].value = correctNodeId;
    stateChanged = true;
  }

  if (node.widgets[3].value !== newSizeValue) {
    node.widgets[3].value = newSizeValue;
    stateChanged = true;
  }

  if (node.widgets[4].value !== newReverseValue) {
    node.widgets[4].value = newReverseValue;
    stateChanged = true;
  }

  if (node.widgets[5].value !== newSingleModeValue) {
    node.widgets[5].value = newSingleModeValue;
    stateChanged = true;
  }

  if (node.widgets[6] && node.widgets[6].value !== newImageIdsValue) {
    node.widgets[6].value = newImageIdsValue;
    stateChanged = true;
  }

  if (node.widgets[7] && node.widgets[7].value !== newImageStateValue) {
    node.widgets[7].value = newImageStateValue;
    stateChanged = true;
  }

  // Update UI
  statusText.innerHTML = imagePreviews.length ? `${imagePreviews.length} images` : "No images";
  statusText.style.color = imagePreviews.length ? "#2ECC71" : "#F5F6F5";

  // Trigger card list update
  debouncedUpdateCardList();

  // Update node properties to persist state across operations like resize
  if (stateChanged) {
    node.properties = {
      ...node.properties,
      image_previews: imagePreviews,
      image_state: reconciledState,
      image_order: imageOrder,
      enabled_layers: enabledLayers,
      is_reversed: isReversed,
      is_single_mode: isSingleMode,
      node_size: nodeSize
    };
    log.debug(`Updated node properties for ${node.id}`);
  }

  // Log state update for debugging
  log.info(`State updated for node ${node.id}: ${imagePreviews.length} images, order=${imageOrder}, enabled=${enabledLayers}, reversed=${isReversed}, single_mode=${isSingleMode}, nodeSize=${nodeSize}`);
}

app.registerExtension({
  name: "XIS.ImageManager",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "XIS") return;
    log.info("Registering XIS_ImageManager node definition");
    nodeType.prototype.comfyClass = "XIS_ImageManager";
    nodeType.prototype.onNodeCreated = function () {
      log.info(`XIS_ImageManager node created with ID: ${this.id || "pending"}`);
      this.properties = {
        image_previews: [],
        image_state: [],
        image_order: [],
        enabled_layers: [],
        is_reversed: false,
        is_single_mode: false,
        node_size: [360, MIN_NODE_HEIGHT]
      };
      this.setSize([360, MIN_NODE_HEIGHT]);
      this._lastCacheKey = ""; // Initialize cache key
      this._lastPreviewCount = 0; // Initialize preview count
      this._lastContentFingerprint = ""; // Initialize content fingerprint
    };
  },

  async setup() {
    log.info("XIS_ImageManager extension loaded");
    try {
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "/extensions/ComfyUI_XISER_Nodes/lib/Sortable.min.js";
        script.onload = () => {
          log.info("Successfully loaded Sortable.js");
          resolve();
        };
        script.onerror = () => {
          log.error("Failed to load Sortable.js");
          reject();
        };
        document.head.appendChild(script);
      });
      injectStyles();
    } catch (error) {
      log.error(`Setup failed: ${error}`);
    }
  },

  async nodeCreated(node) {
    if (node.comfyClass !== "XIS_ImageManager") return;

    if (!window.xisImageManagerAfterGraphConfigured) {
      window.xisImageManagerAfterGraphConfigured = true;
      app.graph.afterGraphConfigured = (function (original) {
        return function () {
          if (original) original.call(this);
          processPendingNodes();
        };
      })(app.graph.afterGraphConfigured || null);
    }

    function initializeNode(targetNode, callback, retries = 20, delay = 200) {
      if (!targetNode) {
        log.error(`Node is null or undefined. Aborting initialization.`);
        return;
      }

      if (targetNode.id > 0 && app.graph.getNodeById(targetNode.id)) {
        log.info(`Node immediately initialized: ID ${targetNode.id}, type ${targetNode.type}, title ${targetNode.title || "undefined"}`);
        callback(targetNode.id);
        return;
      }

      log.info(`Node ${targetNode.title || "undefined"} pending ID assignment, queuing initialization.`);
      registerPendingNode(targetNode, (resolvedId) => {
        callback(resolvedId);
      }, retries, delay);
    }

    initializeNode(node, async (nodeId) => {
      log.info(`XIS_ImageManager node initialized: ${nodeId}`);

      // Initialize state from node.properties
      let imagePreviews = node.properties.image_previews || [];
      let imageOrder = node.properties.image_order || [...Array(imagePreviews.length).keys()];
      let enabledLayers = node.properties.enabled_layers || Array(imagePreviews.length).fill(true);
      let imageState = Array.isArray(node.properties.image_state) ? node.properties.image_state : [];
      let isReversed = node.properties.is_reversed || false;
      let isSingleMode = node.properties.is_single_mode || false;
      let stateVersion = 0; // Internal frontend state tracking
      let nodeSize = node.properties.node_size || [360, MIN_NODE_HEIGHT];

      if (!Array.isArray(imageState) || !imageState.length) {
        imageState = buildStateFromLegacy(imagePreviews, imageOrder, enabledLayers);
      }
      imageState = reconcileImageState(imagePreviews, imageState);
      const derivedState = deriveOrderAndEnabled(imagePreviews, imageState);
      imageOrder = validateImageOrder(derivedState.imageOrder, imagePreviews);
      enabledLayers = derivedState.enabledLayers;

      // Ensure single mode consistency at initialization
      if (isSingleMode && imagePreviews.length) {
        const trueIndex = enabledLayers.indexOf(true);
        enabledLayers = Array(imagePreviews.length).fill(false);
        enabledLayers[trueIndex >= 0 ? trueIndex : imageOrder[0]] = true;
      }

      log.debug(`Node ${nodeId}: Initial state - imagePreviews: ${JSON.stringify(imagePreviews)}, order=${imageOrder}, enabled=${enabledLayers}, reversed=${isReversed}, single_mode=${isSingleMode}, nodeSize=${nodeSize}`);

      node.setSize([Math.max(nodeSize[0], 360), Math.max(nodeSize[1], MIN_NODE_HEIGHT)]);

      // Clear existing widgets
      node.widgets?.forEach(w => w.element?.parentNode?.removeChild(w.element));
      node.widgets = [];

      // Create UI and get necessary elements and callbacks
      const { mainContainer, statusText, debouncedUpdateCardList, setState } = createImageManagerUI(
        node,
        nodeId,
        {
          imagePreviews,
          imageOrder,
          enabledLayers,
          imageState,
          isReversed,
          isSingleMode,
          stateVersion,
          nodeSize
        },
        updateState,
        uploadImages,
        deleteImage
      );
      const applyState = setState;

      // Show UI immediately - the complex positioning logic was causing issues
      // ComfyUI will handle node positioning automatically
      mainContainer.style.visibility = "visible";
      log.debug(`Node ${nodeId}: UI made visible`);

      // Add widgets
      const orderWidget = node.addWidget("hidden", "image_order", JSON.stringify({ node_id: nodeId, order: imageOrder }), value => {
        try {
          const data = JSON.parse(value);
          if (data.node_id !== nodeId) log.warning(`Mismatched node_id: ${data.node_id}, expected ${nodeId}`);
          if (!Array.isArray(data?.order)) return;
          const validatedOrder = validateImageOrder(data.order, imagePreviews);
          if (!validatedOrder.length || arraysShallowEqual(imageOrder, validatedOrder)) return;
          const reorderedState = reorderStateFromOrder(imagePreviews, imageState, validatedOrder);
          applyState({ imageState: reorderedState });
        } catch (error) {
          statusText.innerText = "Order error";
          statusText.style.color = "#F55";
          log.error(`Failed to parse image_order: ${error}`);
        }
      }, { serialize: true });

      const enabledWidget = node.addWidget("hidden", "enabled_layers", JSON.stringify({ node_id: nodeId, enabled: enabledLayers }), value => {
        try {
          const data = JSON.parse(value);
          if (data.node_id !== nodeId) log.warning(`Mismatched node_id: ${data.node_id}, expected ${nodeId}`);
          if (!Array.isArray(data?.enabled)) return;
          const normalized = data.enabled.map(flag => !!flag);
          let nextState = imageState.map(entry => {
            const preview = imagePreviews.find(p => p.image_id === entry.id);
            if (!preview) return entry;
            const idx = preview.index;
            const nextEnabled = idx < normalized.length ? normalized[idx] : entry.enabled;
            if (!!entry.enabled === !!nextEnabled) return entry;
            return { ...entry, enabled: !!nextEnabled };
          });
          if (isSingleMode) {
            nextState = enforceSingleModeState(nextState);
          }
          if (areImageStatesEqual(nextState, imageState)) return;
          applyState({ imageState: nextState });
        } catch (error) {
          statusText.innerText = "Layers error";
          statusText.style.color = "#F55";
          log.error(`Failed to parse enabled_layers: ${error}`);
        }
      }, { serialize: true });

      const nodeIdWidget = node.addWidget("hidden", "node_id", nodeId, value => {
        if (value !== nodeId) log.warning(`Node ID mismatch: ${value}, expected ${nodeId}`);
        node.widgets[2].value = nodeId;
        if (node.widgets[2].onChange) node.widgets[2].onChange(nodeId);
      }, { serialize: true });

      const nodeSizeWidget = node.addWidget("hidden", "node_size", JSON.stringify(nodeSize), value => {
        try {
          const parsedSize = JSON.parse(value);
          if (Array.isArray(parsedSize) && parsedSize.length === 2) {
            const newSize = [Math.max(parsedSize[0], 360), Math.max(parsedSize[1], MIN_NODE_HEIGHT)];
            // Only update if size actually changed
            if (!arraysShallowEqual(nodeSize, newSize)) {
              nodeSize = newSize;
              node.setSize(nodeSize);
              // Don't call setState here to avoid circular updates
              debouncedUpdateCardList();
            }
          }
        } catch (error) {
          log.error(`Failed to parse node_size: ${error}`);
        }
      }, { serialize: true });

      const reverseWidget = node.addWidget("hidden", "is_reversed", JSON.stringify({ node_id: nodeId, reversed: isReversed }), value => {
        try {
          const data = JSON.parse(value);
          if (data.node_id !== nodeId) log.warning(`Mismatched node_id: ${data.node_id}, expected ${nodeId}`);
          const newReversed = !!data.reversed;
          // Only update if reversed state actually changed
          if (isReversed !== newReversed) {
            isReversed = newReversed;
            // Don't call setState here to avoid circular updates
            debouncedUpdateCardList();
          }
        } catch (error) {
          statusText.innerText = "Reverse error";
          statusText.style.color = "#F55";
          log.error(`Failed to parse is_reversed: ${error}`);
        }
      }, { serialize: true });

      const singleModeWidget = node.addWidget("hidden", "is_single_mode", JSON.stringify({ node_id: nodeId, single_mode: isSingleMode }), value => {
        try {
          const data = JSON.parse(value);
          if (data.node_id !== nodeId) log.warning(`Mismatched node_id: ${data.node_id}, expected ${nodeId}`);
          const newSingleMode = !!data.single_mode;
          // Only update if single mode state actually changed
          if (isSingleMode !== newSingleMode) {
            isSingleMode = newSingleMode;
            if (isSingleMode && imagePreviews.length) {
              const trueIndex = enabledLayers.indexOf(true);
              enabledLayers = Array(imagePreviews.length).fill(false);
              enabledLayers[trueIndex >= 0 ? trueIndex : imageOrder[0]] = true;
            }
            // Don't call setState here to avoid circular updates
            debouncedUpdateCardList();
          }
        } catch (error) {
          statusText.innerText = "Single mode error";
          statusText.style.color = "#F55";
          log.error(`Failed to parse is_single_mode: ${error}`);
        }
      }, { serialize: true });

      // Add image_ids widget for ID-based state management (must match backend INPUT_TYPES order)
      const imageIdsWidget = node.addWidget("hidden", "image_ids", JSON.stringify({ node_id: nodeId, image_ids: imagePreviews.map(p => p.image_id || "") }), value => {
        try {
          const data = JSON.parse(value);
          if (data.node_id !== nodeId) log.warning(`Mismatched node_id: ${data.node_id}, expected ${nodeId}`);
          // Image IDs are primarily used by backend for mapping, frontend just passes them through
          log.debug(`Node ${nodeId}: Received image_ids: ${JSON.stringify(data.image_ids)}`);
        } catch (error) {
          log.error(`Failed to parse image_ids: ${error}`);
        }
      }, { serialize: true });

      const imageStateWidget = node.addWidget("hidden", "image_state", getSerializedImageStateValue(node, imageState, nodeId), value => {
        try {
          const parsed = JSON.parse(value || "[]");
          let parsedState = [];
          if (Array.isArray(parsed)) {
            parsedState = parsed;
          } else if (parsed && typeof parsed === "object" && Array.isArray(parsed.images)) {
            parsedState = parsed.images;
          }
          imageState = reconcileImageState(imagePreviews, parsedState);
          const derived = deriveOrderAndEnabled(imagePreviews, imageState);
          imageOrder = validateImageOrder(derived.imageOrder, imagePreviews);
          enabledLayers = derived.enabledLayers;
          debouncedUpdateCardList();
        } catch (error) {
          log.error(`Failed to parse image_state: ${error}`);
        }
      }, { serialize: true });


      log.info(`Node ${nodeId}: Widgets created - total count: ${node.widgets?.length || 0}`);
      // Debug widget names and indices
      node.widgets?.forEach((widget, index) => {
        log.info(`Node ${nodeId}: Widget ${index}: ${widget.name}`);
      });

      // Add DOM widget
      node.addDOMWidget("image_manager", "Image Manager", mainContainer, {
        serialize: true,
        getValue() {
          // Generate a stable cache key based on the actual output state
          const outputImages = imageOrder
            .filter((_, i) => enabledLayers[i])
            .map(idx => imagePreviews.find(p => p.index === idx)?.filename || "");

          return {
            image_previews: imagePreviews.map(p => ({
              index: p.index,
              width: p.width,
              height: p.height,
              filename: p.filename,
              originalFilename: p.originalFilename,
              preview: p.preview,
              image_id: p.image_id || "",  // Include unique ID
              content_hash: p.content_hash || null
            })),
            image_order: imageOrder,
            enabled_layers: enabledLayers,
            image_state: imageState,
            is_reversed: isReversed,
            is_single_mode: isSingleMode,
            node_id: nodeId,
            node_size: nodeSize,
            cache_key: node._lastCacheKey || ""
          };
        },
        setValue(value) {
          try {
            if (value.node_id && value.node_id !== nodeId) {
              log.warning(`Mismatched node_id: ${value.node_id}, expected ${nodeId}`);
            }
      const newPreviews = value.image_previews?.map((p, i) => ({
        ...p,
        index: i,
        originalFilename: p.originalFilename || p.filename,
        image_id: p.image_id || "",  // Preserve unique ID
        source: p.source || ((p.filename && p.filename.startsWith("pack_image_")) ? "pack_images" : "uploaded"),
        content_hash: p.content_hash || p.contentHash || null
      })) || [];
            const newOrder = validateImageOrder(value.image_order || [...Array(newPreviews.length).keys()], newPreviews);
            let newEnabled = value.enabled_layers?.length === newPreviews.length ? value.enabled_layers : Array(newPreviews.length).fill(true);
            const incomingImageState = Array.isArray(value.image_state) ? value.image_state : [];
            const newIsReversed = value.is_reversed ?? isReversed;
            const newIsSingleMode = value.is_single_mode ?? isSingleMode;
            const newNodeSize = Array.isArray(value.node_size) && value.node_size.length === 2
              ? [Math.max(value.node_size[0], 360), Math.max(value.node_size[1], MIN_NODE_HEIGHT)]
              : nodeSize;

            // Enforce single mode
            if (newIsSingleMode && newPreviews.length) {
              const trueIndex = newEnabled.indexOf(true);
              newEnabled = Array(newPreviews.length).fill(false);
              newEnabled[trueIndex >= 0 ? trueIndex : newOrder[0]] = true;
            }

            const reconciled = reconcileImageState(
              newPreviews,
              incomingImageState.length ? incomingImageState : buildStateFromLegacy(newPreviews, newOrder, newEnabled)
            );
            const nextImageState = newIsSingleMode ? enforceSingleModeState(reconciled) : reconciled;
            const stateChanged =
              !areImagePreviewsEqual(imagePreviews, newPreviews) ||
              !areImageStatesEqual(imageState, nextImageState) ||
              isReversed !== newIsReversed ||
              isSingleMode !== newIsSingleMode ||
              !arraysShallowEqual(nodeSize, newNodeSize);

            if (stateChanged) {
              imagePreviews = newPreviews;
              imageState = nextImageState;
              isReversed = newIsReversed;
              isSingleMode = newIsSingleMode;
              nodeSize = newNodeSize;
              const derived = deriveOrderAndEnabled(imagePreviews, imageState);
              node.properties = {
                image_previews: imagePreviews,
                image_state: imageState,
                image_order: derived.imageOrder,
                enabled_layers: derived.enabledLayers,
                is_reversed: isReversed,
                is_single_mode: isSingleMode,
                node_size: nodeSize
              };
              node.setSize([Math.max(nodeSize[0], 360), Math.max(nodeSize[1], MIN_NODE_HEIGHT)]);
              applyState({ imagePreviews, imageState, isReversed, isSingleMode, nodeSize });
              log.info(`Restored state for node ${nodeId}: ${derived.imageOrder.length} images, order=${derived.imageOrder}, single_mode=${isSingleMode}, node_size=${nodeSize}`);
            } else {
              log.debug(`State unchanged in setValue for node ${nodeId}, skipping update`);
            }
          } catch (error) {
            statusText.innerText = "State error";
            statusText.style.color = "#F55";
            log.error(`Error in setValue for node ${nodeId}: ${error}`);
          }
        }
      });

      // Handle node resize
      node.onResize = function (size) {
        size[0] = Math.max(size[0], 360);
        size[1] = Math.max(size[1], MIN_NODE_HEIGHT);
        const newNodeSize = [size[0], size[1]];
        if (arraysShallowEqual(nodeSize, newNodeSize)) {
          log.debug(`Node ${nodeId} resize skipped: no size change`);
          return;
        }
        nodeSize = newNodeSize;
        node.properties.node_size = newNodeSize;

        const currentState = getStateFromNode(node);
        currentState.nodeSize = newNodeSize;
        applyState(currentState);
        log.debug(`Node ${nodeId} resized: width=${size[0]}, height=${size[1]}`);
      };

      // Handle node movement
      node.onNodeMoved = function () {
        log.debug(`Node ${nodeId} moved, triggering UI update`);
        debouncedUpdateCardList();
        // Node movement should not trigger re-execution
        // Completely avoid marking canvas dirty to prevent forced execution
      };

      // Add node class
      if (node.getElement) {
        node.getElement().classList.add("xiser-image-manager-node", getNodeClass(nodeId));
      }

      // Handle execution
      node.onExecuted = function (message) {
        if (!message?.image_previews && !message?.cache_key) {
          statusText.innerText = "Execution error: No image previews";
          statusText.style.color = "#F55";
          log.error(`Node ${node.id}: Invalid execution data: ${JSON.stringify(message)}`);
          return;
        }

        const backendCacheKey = Array.isArray(message?.cache_key)
          ? message.cache_key[0]
          : message?.cache_key;

        if (!message.image_previews) {
          if (backendCacheKey && node._lastCacheKey !== backendCacheKey) {
            node._lastCacheKey = backendCacheKey;
            log.info(`Node ${node.id}: Updated cache key from backend: ${backendCacheKey}`);
          }
          return;
        }

        const newPreviews = message.image_previews.map((p, i) => ({
          ...p,
          index: i,
          originalFilename: p.originalFilename || p.filename,
          source: p.source || ((p.filename && p.filename.startsWith("pack_image_")) ? "pack_images" : "uploaded"),
          content_hash: p.content_hash || p.contentHash || null
        }));

        let backendImageState = [];
        if (Array.isArray(message.image_state)) {
          backendImageState = message.image_state[0];
        } else if (message.image_state && typeof message.image_state === "object" && Array.isArray(message.image_state.images)) {
          backendImageState = message.image_state.images;
        }
        if (!Array.isArray(backendImageState) || !backendImageState.length) {
          backendImageState = buildStateFromLegacy(newPreviews, [], []);
        }
        backendImageState = reconcileImageState(newPreviews, backendImageState);

        const currentState = getStateFromNode(node);
        const targetState = {
          imagePreviews: newPreviews,
          imageState: currentState.isSingleMode ? enforceSingleModeState(backendImageState) : backendImageState,
          isReversed: currentState.isReversed,
          isSingleMode: currentState.isSingleMode,
          nodeSize: currentState.nodeSize
        };

        applyState(targetState);

        if (backendCacheKey && node._lastCacheKey !== backendCacheKey) {
          node._lastCacheKey = backendCacheKey;
          log.info(`Node ${node.id}: Updated cache key from backend: ${backendCacheKey}`);
        }

        const derived = deriveOrderAndEnabled(imagePreviews, imageState);
        log.info(`Node ${node.id}: EXECUTION SUMMARY - images=${imagePreviews.length}, order=${JSON.stringify(derived.imageOrder)}, enabled=${JSON.stringify(derived.enabledLayers)}, single_mode=${isSingleMode}, reversed=${isReversed}`);
      };
      // Handle node removal
      node.onRemoved = function () {
        log.info(`Node ${nodeId} removed`);
      };

      // Initial state update
      node.properties = {
        image_previews: imagePreviews,
        image_state: imageState,
        image_order: imageOrder,
        enabled_layers: enabledLayers,
        is_reversed: isReversed,
        is_single_mode: isSingleMode,
        node_size: nodeSize
      };
      applyState({ imagePreviews, imageState, isReversed, isSingleMode, nodeSize });
    });
  }
});

export {
  uploadImages,
  deleteImage,
  updateState,
  computeOutputHash
};
