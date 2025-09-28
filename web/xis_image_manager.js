/**
 * @fileoverview XIS_ImageManager node for ComfyUI, handling frontend-driven state management and node lifecycle.
 * @module xis_image_manager
 */

import { app } from "/scripts/app.js";
import { log, MIN_NODE_HEIGHT, debounce, getNodeClass, validateImageOrder, injectStyles } from "./xis_image_manager_utils.js";
import { createImageManagerUI } from "./xis_image_manager_ui.js";

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

/**
 * Computes the effective output state for comparison.
 * @param {Object[]} imagePreviews - Array of image preview objects.
 * @param {number[]} imageOrder - Array of image indices.
 * @param {boolean[]} enabledLayers - Array of enabled states.
 * @returns {string} Hash of the effective output state.
 */
function computeOutputHash(imagePreviews, imageOrder, enabledLayers) {
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

/**
 * Updates node widgets with frontend state and ensures serialization only when necessary.
 * @param {Object} node - The node instance.
 * @param {Object} state - State object.
 * @param {Object[]} state.imagePreviews - Array of image preview objects.
 * @param {number[]} state.imageOrder - Array of image indices.
 * @param {boolean[]} state.enabledLayers - Array of enabled states.
 * @param {boolean} state.isReversed - Whether the order is reversed.
 * @param {boolean} state.isSingleMode - Whether single mode is active.
 * @param {number[]} state.nodeSize - Node dimensions [width, height].
 * @param {number} state.stateVersion - Frontend state version (internal use only).
 * @param {HTMLElement} statusText - Status text element for UI feedback.
 * @param {Function} debouncedUpdateCardList - Debounced function to update the card list.
 */

/**
 * Get current state from node widgets
 * @param {Object} node - The node instance
 * @returns {Object} Current state object
 */
function getStateFromNode(node) {
  try {
    const orderData = JSON.parse(node.widgets[0].value || "{}");
    const enabledData = JSON.parse(node.widgets[1].value || "{}");
    const reversedData = JSON.parse(node.widgets[4].value || "{}");
    const singleModeData = JSON.parse(node.widgets[5].value || "{}");
    const nodeSizeData = JSON.parse(node.widgets[3].value || "[360, 360]");
    
    return {
      imageOrder: orderData.order || [],
      enabledLayers: enabledData.enabled || [],
      isReversed: reversedData.reversed || false,
      isSingleMode: singleModeData.single_mode || false,
      nodeSize: Array.isArray(nodeSizeData) ? nodeSizeData : [360, 360]
    };
  } catch (e) {
    log.error(`Failed to get state from node ${node.id}: ${e}`);
    return {
      imageOrder: [],
      enabledLayers: [],
      isReversed: false,
      isSingleMode: false,
      nodeSize: [360, 360]
    };
  }
}

function updateState(node, state, statusText, debouncedUpdateCardList) {
  const { imagePreviews, imageOrder, enabledLayers, isReversed, isSingleMode, nodeSize } = state;

  let stateChanged = false;

  // Update widgets only if values have changed - parse existing values to compare content, not just string equality
  const newOrderValue = JSON.stringify({ node_id: node.id, order: imageOrder });
  try {
    const currentOrderData = JSON.parse(node.widgets[0].value || "{}");
    const currentOrder = currentOrderData.order || [];
    if (JSON.stringify(currentOrder) !== JSON.stringify(imageOrder) || currentOrderData.node_id !== node.id) {
      node.widgets[0].value = newOrderValue;
      if (node.widgets[0].onChange) node.widgets[0].onChange(newOrderValue);
      stateChanged = true;
    }
  } catch (e) {
    node.widgets[0].value = newOrderValue;
    if (node.widgets[0].onChange) node.widgets[0].onChange(newOrderValue);
    stateChanged = true;
  }
  
  const newEnabledValue = JSON.stringify({ node_id: node.id, enabled: enabledLayers });
  try {
    const currentEnabledData = JSON.parse(node.widgets[1].value || "{}");
    const currentEnabled = currentEnabledData.enabled || [];
    if (JSON.stringify(currentEnabled) !== JSON.stringify(enabledLayers) || currentEnabledData.node_id !== node.id) {
      node.widgets[1].value = newEnabledValue;
      if (node.widgets[1].onChange) node.widgets[1].onChange(newEnabledValue);
      stateChanged = true;
    }
  } catch (e) {
    node.widgets[1].value = newEnabledValue;
    if (node.widgets[1].onChange) node.widgets[1].onChange(newEnabledValue);
    stateChanged = true;
  }
  
  if (node.widgets[2].value !== node.id) {
    node.widgets[2].value = node.id;
    if (node.widgets[2].onChange) node.widgets[2].onChange(node.id);
    stateChanged = true;
  }
  
  const newSizeValue = JSON.stringify(nodeSize);
  try {
    const currentSize = JSON.parse(node.widgets[3].value || "[360, 360]");
    if (JSON.stringify(currentSize) !== JSON.stringify(nodeSize)) {
      node.widgets[3].value = newSizeValue;
      if (node.widgets[3].onChange) node.widgets[3].onChange(newSizeValue);
      stateChanged = true;
    }
  } catch (e) {
    node.widgets[3].value = newSizeValue;
    if (node.widgets[3].onChange) node.widgets[3].onChange(newSizeValue);
    stateChanged = true;
  }
  
  const newReverseValue = JSON.stringify({ node_id: node.id, reversed: isReversed });
  try {
    const currentReverseData = JSON.parse(node.widgets[4].value || "{}");
    if (currentReverseData.reversed !== isReversed || currentReverseData.node_id !== node.id) {
      node.widgets[4].value = newReverseValue;
      if (node.widgets[4].onChange) node.widgets[4].onChange(newReverseValue);
      stateChanged = true;
    }
  } catch (e) {
    node.widgets[4].value = newReverseValue;
    if (node.widgets[4].onChange) node.widgets[4].onChange(newReverseValue);
    stateChanged = true;
  }
  
  const newSingleModeValue = JSON.stringify({ node_id: node.id, single_mode: isSingleMode });
  try {
    const currentSingleModeData = JSON.parse(node.widgets[5].value || "{}");
    if (currentSingleModeData.single_mode !== isSingleMode || currentSingleModeData.node_id !== node.id) {
      node.widgets[5].value = newSingleModeValue;
      if (node.widgets[5].onChange) node.widgets[5].onChange(newSingleModeValue);
      stateChanged = true;
    }
  } catch (e) {
    node.widgets[5].value = newSingleModeValue;
    if (node.widgets[5].onChange) node.widgets[5].onChange(newSingleModeValue);
    stateChanged = true;
  }

  // Update UI
  statusText.innerHTML = imagePreviews.length ? `${imagePreviews.length} images` : "No images";
  statusText.style.color = imagePreviews.length ? "#2ECC71" : "#F5F6F5";

  // Trigger card list update and canvas serialization only if state changed
  debouncedUpdateCardList();
  
  // Update node properties to persist state across operations like resize
  if (stateChanged) {
    node.properties = {
      ...node.properties,
      image_previews: imagePreviews,
      image_order: imageOrder,
      enabled_layers: enabledLayers,
      is_reversed: isReversed,
      is_single_mode: isSingleMode,
      node_size: nodeSize
    };
    log.debug(`Updated node properties for ${node.id}`);
  }
  
  // Generate current cache key for comparison
  const outputImages = imageOrder
    .filter((_, i) => enabledLayers[i])
    .map(idx => imagePreviews.find(p => p.index === idx)?.filename || "");
  const currentCacheKey = JSON.stringify({
    output_images: outputImages,
    order: imageOrder,
    enabled: enabledLayers,
    reversed: isReversed,
    single_mode: isSingleMode
  });
  
  // Only mark as dirty if the actual output state has changed
  // Also mark dirty if this is the first execution (cache key is empty)
  if (stateChanged || node._lastCacheKey === "" || node._lastCacheKey !== currentCacheKey) {
    node._lastCacheKey = currentCacheKey;
    app.graph.setDirtyCanvas(true, true);
    log.info(`State updated for node ${node.id}: ${imagePreviews.length} images, order=${imageOrder}, enabled=${enabledLayers}, reversed=${isReversed}, single_mode=${isSingleMode}, nodeSize=${nodeSize}`);
  } else {
    log.debug(`State unchanged for node ${node.id}, skipping serialization`);
  }
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
        image_order: [],
        enabled_layers: [],
        is_reversed: false,
        is_single_mode: false,
        node_size: [360, MIN_NODE_HEIGHT]
      };
      this.setSize([360, MIN_NODE_HEIGHT]);
      this._lastCacheKey = ""; // Initialize cache key
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
    const pendingNodes = new WeakMap();

    if (!window.xisImageManagerAfterGraphConfigured) {
      window.xisImageManagerAfterGraphConfigured = true;
      app.graph.afterGraphConfigured = (function (original) {
        return function () {
          if (original) original.call(this);
          for (const [pendingNode, callback] of pendingNodes) {
            if (pendingNode.id > 0 && app.graph.getNodeById(pendingNode.id)) {
              log.info(`Node registered after graph config: ID ${pendingNode.id}, type ${pendingNode.type}, title ${pendingNode.title || "undefined"}`);
              pendingNodes.delete(pendingNode);
              callback(pendingNode.id);
            }
          }
        };
      })(app.graph.afterGraphConfigured || null);
    }


    function initializeNode(node, callback, retries = 20, delay = 200) {
      if (!node) {
        log.error(`Node is null or undefined. Aborting initialization.`);
        return;
      }
      
      // Check if node already has a valid ID
      if (node.id > 0 && app.graph.getNodeById(node.id)) {
        log.info(`Node immediately initialized: ID ${node.id}, type ${node.type}, title ${node.title || "undefined"}`);
        callback(node.id);
        return;
      }
      
      // For workflow loading, nodes might start with negative IDs that get resolved later
      // Just wait for the node to get a valid ID through normal ComfyUI processes
      if (retries <= 0) {
        log.warning(`Node ID ${node.id || "undefined"} not assigned after max retries. UI may show but functionality limited.`);
        // Still proceed with initialization but use a temporary ID
        const tempId = node.id > 0 ? node.id : Math.abs(node.id) || Date.now();
        callback(tempId);
        return;
      }
      
      // Wait a bit and try again
      setTimeout(() => initializeNode(node, callback, retries - 1, delay), delay);
    }

    initializeNode(node, async (nodeId) => {
      log.info(`XIS_ImageManager node initialized: ${nodeId}`);

      // Initialize state from node.properties
      let imagePreviews = node.properties.image_previews || [];
      let imageOrder = node.properties.image_order || [...Array(imagePreviews.length).keys()];
      let enabledLayers = node.properties.enabled_layers || Array(imagePreviews.length).fill(true);
      let isReversed = node.properties.is_reversed || false;
      let isSingleMode = node.properties.is_single_mode || false;
      let stateVersion = 0; // Internal frontend state tracking
      let nodeSize = node.properties.node_size || [360, MIN_NODE_HEIGHT];

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
          isReversed,
          isSingleMode,
          stateVersion,
          nodeSize
        },
        updateState,
        uploadImages,
        deleteImage
      );

      // Show UI immediately - the complex positioning logic was causing issues
      // ComfyUI will handle node positioning automatically
      mainContainer.style.visibility = "visible";
      log.debug(`Node ${nodeId}: UI made visible`);

      // Add widgets
      const orderWidget = node.addWidget("hidden", "image_order", JSON.stringify({ node_id: nodeId, order: imageOrder }), value => {
        try {
          const data = JSON.parse(value);
          if (data.node_id !== nodeId) log.warning(`Mismatched node_id: ${data.node_id}, expected ${nodeId}`);
          imageOrder = validateImageOrder(data.order || imageOrder, imagePreviews);
          setState({ imagePreviews, imageOrder, enabledLayers, isReversed, isSingleMode, stateVersion, nodeSize });
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
          enabledLayers = data.enabled?.length === imagePreviews.length ? data.enabled : Array(imagePreviews.length).fill(true);
          if (isSingleMode && imagePreviews.length) {
            const trueIndex = enabledLayers.indexOf(true);
            enabledLayers = Array(imagePreviews.length).fill(false);
            enabledLayers[trueIndex >= 0 ? trueIndex : imageOrder[0]] = true;
          }
          setState({ imagePreviews, imageOrder, enabledLayers, isReversed, isSingleMode, stateVersion, nodeSize });
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
            nodeSize = [Math.max(parsedSize[0], 360), Math.max(parsedSize[1], MIN_NODE_HEIGHT)];
            node.setSize(nodeSize);
            setState({ imagePreviews, imageOrder, enabledLayers, isReversed, isSingleMode, stateVersion, nodeSize });
          }
        } catch (error) {
          log.error(`Failed to parse node_size: ${error}`);
        }
      }, { serialize: true });

      const reverseWidget = node.addWidget("hidden", "is_reversed", JSON.stringify({ node_id: nodeId, reversed: isReversed }), value => {
        try {
          const data = JSON.parse(value);
          if (data.node_id !== nodeId) log.warning(`Mismatched node_id: ${data.node_id}, expected ${nodeId}`);
          isReversed = !!data.reversed;
          setState({ imagePreviews, imageOrder, enabledLayers, isReversed, isSingleMode, stateVersion, nodeSize });
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
          isSingleMode = !!data.single_mode;
          if (isSingleMode && imagePreviews.length) {
            const trueIndex = enabledLayers.indexOf(true);
            enabledLayers = Array(imagePreviews.length).fill(false);
            enabledLayers[trueIndex >= 0 ? trueIndex : imageOrder[0]] = true;
          }
          setState({ imagePreviews, imageOrder, enabledLayers, isReversed, isSingleMode, stateVersion, nodeSize });
        } catch (error) {
          statusText.innerText = "Single mode error";
          statusText.style.color = "#F55";
          log.error(`Failed to parse is_single_mode: ${error}`);
        }
      }, { serialize: true });

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
              preview: p.preview
            })),
            image_order: imageOrder,
            enabled_layers: enabledLayers,
            is_reversed: isReversed,
            is_single_mode: isSingleMode,
            node_id: nodeId,
            node_size: nodeSize,
            cache_key: JSON.stringify({
              output_images: outputImages,
              order: imageOrder,
              enabled: enabledLayers,
              reversed: isReversed,
              single_mode: isSingleMode
            })
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
              originalFilename: p.originalFilename || p.filename
            })) || [];
            const newOrder = validateImageOrder(value.image_order || [...Array(newPreviews.length).keys()], newPreviews);
            let newEnabled = value.enabled_layers?.length === newPreviews.length ? value.enabled_layers : Array(newPreviews.length).fill(true);
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

            // Check if state has actually changed before updating
            const stateChanged = 
              JSON.stringify(imagePreviews) !== JSON.stringify(newPreviews) ||
              JSON.stringify(imageOrder) !== JSON.stringify(newOrder) ||
              JSON.stringify(enabledLayers) !== JSON.stringify(newEnabled) ||
              isReversed !== newIsReversed ||
              isSingleMode !== newIsSingleMode ||
              JSON.stringify(nodeSize) !== JSON.stringify(newNodeSize);

            if (stateChanged) {
              imagePreviews = newPreviews;
              imageOrder = newOrder;
              enabledLayers = newEnabled;
              isReversed = newIsReversed;
              isSingleMode = newIsSingleMode;
              nodeSize = newNodeSize;
              node.properties = {
                image_previews: imagePreviews,
                image_order: imageOrder,
                enabled_layers: enabledLayers,
                is_reversed: isReversed,
                is_single_mode: isSingleMode,
                node_size: nodeSize
              };
              node.setSize([Math.max(nodeSize[0], 360), Math.max(nodeSize[1], MIN_NODE_HEIGHT)]);
              setState({ imagePreviews, imageOrder, enabledLayers, isReversed, isSingleMode, stateVersion, nodeSize });
              log.info(`Restored state for node ${nodeId}: ${imageOrder.length} images, order=${imageOrder}, enabled=${enabledLayers}, reversed=${isReversed}, single_mode=${isSingleMode}, node_size=${nodeSize}`);
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
        if (JSON.stringify(nodeSize) === JSON.stringify(newNodeSize)) {
          log.debug(`Node ${nodeId} resize skipped: no size change`);
          return;
        }
        nodeSize = newNodeSize;
        node.properties.node_size = newNodeSize;
        
        // Get current state from node properties to ensure we have the latest state including uploaded images
        const currentImagePreviews = node.properties.image_previews || [];
        const currentImageOrder = node.properties.image_order || [...Array(currentImagePreviews.length).keys()];
        const currentEnabledLayers = node.properties.enabled_layers || Array(currentImagePreviews.length).fill(true);
        const currentIsReversed = node.properties.is_reversed || false;
        const currentIsSingleMode = node.properties.is_single_mode || false;
        
        setState({ 
          imagePreviews: currentImagePreviews, 
          imageOrder: currentImageOrder, 
          enabledLayers: currentEnabledLayers, 
          isReversed: currentIsReversed, 
          isSingleMode: currentIsSingleMode, 
          stateVersion, 
          nodeSize: newNodeSize 
        });
        log.debug(`Node ${nodeId} resized: width=${size[0]}, height=${size[1]}`);
      };

      // Handle node movement
      node.onNodeMoved = function () {
        log.debug(`Node ${nodeId} moved, triggering UI update`);
        debouncedUpdateCardList();
        app.graph.setDirtyCanvas(true, true);
      };

      // Add node class
      if (node.getElement) {
        node.getElement().classList.add("xiser-image-manager-node", getNodeClass(nodeId));
      }

      // Handle execution
      node.onExecuted = function (message) {
        if (!message?.image_previews) {
          statusText.innerText = "Execution error: No image previews";
          statusText.style.color = "#F55";
          log.error(`Node ${node.id}: Invalid execution data: ${JSON.stringify(message)}`);
          return;
        }
        log.debug(`Node ${node.id}: onExecuted received image_previews: ${JSON.stringify(message.image_previews)}`);

        // Prepare new previews - preserve originalFilename from backend
        const newPreviews = message.image_previews.map((p, i) => ({
          ...p,
          index: i,
          // Preserve original filename from backend, fallback to filename
          originalFilename: p.originalFilename || p.filename
        }));

        // Restore existing state from widgets
        let currentOrder = imageOrder;
        let currentEnabled = enabledLayers;
        let currentIsReversed = isReversed;
        let currentIsSingleMode = isSingleMode;
        try {
          const orderData = JSON.parse(node.widgets[0].value);
          if (orderData.node_id === nodeId) {
            currentOrder = orderData.order || imageOrder;
          }
          const enabledData = JSON.parse(node.widgets[1].value);
          if (enabledData.node_id === nodeId) {
            currentEnabled = enabledData.enabled || enabledLayers;
          }
          const reverseData = JSON.parse(node.widgets[4].value);
          if (reverseData.node_id === nodeId) {
            currentIsReversed = !!reverseData.reversed;
          }
          const singleModeData = JSON.parse(node.widgets[5].value);
          if (singleModeData.node_id === nodeId) {
            currentIsSingleMode = !!singleModeData.single_mode;
          }
        } catch (error) {
          log.error(`Failed to parse widget state for node ${node.id}: ${error}`);
        }

        // Use full order from backend if available, otherwise match by filename
        const newOrder = [];
        const newEnabled = Array(newPreviews.length).fill(true); // Default to true for new nodes
        
        if (message.full_image_order && Array.isArray(message.full_image_order)) {
          // Use the full order provided by backend for state preservation
          newOrder.push(...message.full_image_order.filter(idx => idx < newPreviews.length));
          
          // Preserve enabled states for existing images, default new ones based on mode
          for (let i = 0; i < newPreviews.length; i++) {
            if (i < currentEnabled.length) {
              newEnabled[i] = currentEnabled[i];
            } else {
              // New images: enable by default in multi mode, disable in single mode
              newEnabled[i] = !currentIsSingleMode;
            }
          }
          
          // Add any missing indices (new images not in full order)
          const missingIndices = [];
          for (let i = 0; i < newPreviews.length; i++) {
            if (!newOrder.includes(i)) {
              missingIndices.push(i);
            }
          }
          newOrder.push(...missingIndices);
        } else {
          // Fallback: match existing images by filename
          const matchedIndices = new Set();
          
          // Match existing images
          for (const oldIdx of currentOrder) {
            const oldPreview = imagePreviews.find(p => p.index === oldIdx);
            if (!oldPreview) continue;
            const newPreviewIndex = newPreviews.findIndex(p => p.filename === oldPreview.filename);
            if (newPreviewIndex >= 0 && !matchedIndices.has(newPreviewIndex)) {
              newOrder.push(newPreviewIndex);
              newEnabled[newPreviewIndex] = currentEnabled[oldIdx] ?? true;
              matchedIndices.add(newPreviewIndex);
            }
          }

          // Add new images
          newPreviews.forEach((p, i) => {
            if (!matchedIndices.has(i)) {
              newOrder.push(i);
              newEnabled[i] = true; // New images enabled by default
            }
          });
        }

        // Enforce single mode
        if (currentIsSingleMode && newPreviews.length) {
          const trueIndex = newEnabled.indexOf(true);
          if (trueIndex === -1) {
            // No enabled images, enable the first one
            newEnabled.fill(false);
            newEnabled[newOrder[0]] = true;
          } else if (newEnabled.filter(x => x).length > 1) {
            // Multiple enabled images, keep only the first one
            const firstTrueIndex = newEnabled.findIndex(x => x);
            newEnabled.fill(false);
            newEnabled[firstTrueIndex] = true;
          }
        }

        const newNodeSize = Array.isArray(message.node_size) && message.node_size.length === 2
          ? [Math.max(message.node_size[0], 360), Math.max(message.node_size[1], MIN_NODE_HEIGHT)]
          : nodeSize;

        // Update state only if necessary
        const stateChanged =
          JSON.stringify(imagePreviews) !== JSON.stringify(newPreviews) ||
          JSON.stringify(imageOrder) !== JSON.stringify(newOrder) ||
          JSON.stringify(enabledLayers) !== JSON.stringify(newEnabled) ||
          isReversed !== currentIsReversed ||
          isSingleMode !== currentIsSingleMode ||
          JSON.stringify(nodeSize) !== JSON.stringify(newNodeSize);

        if (stateChanged) {
          imagePreviews = newPreviews;
          imageOrder = validateImageOrder(newOrder, imagePreviews);
          enabledLayers = newEnabled;
          isReversed = currentIsReversed;
          isSingleMode = currentIsSingleMode;
          nodeSize = newNodeSize;
          node.properties = {
            image_previews: imagePreviews,
            image_order: imageOrder,
            enabled_layers: enabledLayers,
            is_reversed: isReversed,
            is_single_mode: isSingleMode,
            node_size: nodeSize
          };
          node.setSize([Math.max(nodeSize[0], 360), Math.max(nodeSize[1], MIN_NODE_HEIGHT)]);
          setState({ imagePreviews, imageOrder, enabledLayers, isReversed, isSingleMode, stateVersion: stateVersion + 1, nodeSize });
          log.info(`Node ${node.id}: Executed with ${imagePreviews.length} images, order=${imageOrder}, enabled=${enabledLayers}, reversed=${isReversed}, single_mode=${isSingleMode}, nodeSize=${nodeSize}, version=${stateVersion}`);
        } else {
          log.debug(`Node ${node.id}: No state change, skipping update`);
        }
      };

      // Handle node removal
      node.onRemoved = function () {
        log.info(`Node ${nodeId} removed`);
      };

      // Initial state update
      node.properties = {
        image_previews: imagePreviews,
        image_order: imageOrder,
        enabled_layers: enabledLayers,
        is_reversed: isReversed,
        is_single_mode: isSingleMode,
        node_size: nodeSize
      };
      setState({ imagePreviews, imageOrder, enabledLayers, isReversed, isSingleMode, stateVersion, nodeSize });
    });
  }
});

export {
  uploadImages,
  deleteImage,
  updateState,
  computeOutputHash
};