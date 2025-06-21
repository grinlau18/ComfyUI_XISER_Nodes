/**
 * @fileoverview XIS_ImageManager node for ComfyUI, handling image upload, state management, and node lifecycle.
 * @module xis_image_manager
 */

import { app } from "/scripts/app.js";
import { log, MIN_NODE_HEIGHT, debounce, getNodeClass, validateImageOrder, injectStyles } from "./xis_image_manager_utils.js";
import { createImageManagerUI } from "./xis_image_manager_ui.js";

/**
 * Uploads images to the server and returns their metadata.
 * @param {File[]} files - Array of image files to upload.
 * @param {string} nodeId - Node identifier.
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

    // Persist new state to backend if node is provided
    if (node) {
      const currentPreviews = node.properties.image_previews || [];
      const currentOrder = node.properties.image_order || [];
      const currentEnabled = node.properties.enabled_layers || [];
      const existingFilenames = new Set(currentPreviews.map(p => p.filename));
      const newPreviews = images
        .filter(img => !existingFilenames.has(img.filename))
        .map((img, i) => ({
          index: currentPreviews.length + i,
          preview: img.preview,
          width: img.width,
          height: img.height,
          filename: img.filename,
          originalFilename: img.originalFilename
        }));
      const updatedPreviews = [...currentPreviews, ...newPreviews];
      const updatedOrder = [...currentOrder, ...newPreviews.map(p => p.index)];
      const updatedEnabled = [...currentEnabled, ...Array(newPreviews.length).fill(true)];
      const isSingleMode = node.properties.is_single_mode || false;
      if (isSingleMode && updatedPreviews.length) {
        const trueIndex = updatedEnabled.indexOf(true);
        if (trueIndex < 0) {
          updatedEnabled.fill(false);
          updatedEnabled[updatedOrder[0]] = true;
        }
      }
      const newState = {
        image_previews: updatedPreviews,
        image_order: updatedOrder,
        enabled_layers: updatedEnabled,
        is_reversed: node.properties.is_reversed || false,
        is_single_mode: isSingleMode,
        state_version: node.properties.state_version || 0,
        node_size: node.properties.node_size || [360, 360],
        deleted_input_images: node.properties.deleted_input_images || []
      };
      try {
        // Call backend to persist state
        await fetch("/set_ui_data/xis_image_manager", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ node_id: nodeId, data: newState })
        });
        log.info(`Persisted new state for node ${nodeId} after upload`);
      } catch (e) {
        log.error(`Failed to persist state after upload for node ${nodeId}: ${e}`);
      }
    }

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
 * @param {boolean} isSingleMode - Whether single mode is active.
 * @param {boolean} isReversed - Whether the order is reversed.
 * @returns {string} Hash of the effective output state.
 */
function computeOutputHash(imagePreviews, imageOrder, enabledLayers, isSingleMode, isReversed) {
  const effectiveEnabled = isSingleMode && imagePreviews.length ? enabledLayers.slice() : enabledLayers.slice();
  const outputImages = imageOrder
    .filter((_, i) => effectiveEnabled[i])
    .map(idx => imagePreviews.find(p => p.index === idx)?.filename || "");
  const hash = JSON.stringify({
    images: isReversed ? outputImages.reverse() : outputImages,
    order: imageOrder,
    enabled: effectiveEnabled
  });
  return hash;
}

/**
 * Centralized state update function to synchronize properties, widgets, and UI.
 * @param {Object} node - The node instance.
 * @param {Object} state - State object.
 * @param {Object[]} state.imagePreviews - Array of image preview objects.
 * @param {number[]} state.imageOrder - Array of image indices.
 * @param {boolean[]} state.enabledLayers - Array of enabled states.
 * @param {boolean} state.isReversed - Whether the order is reversed.
 * @param {boolean} state.isSingleMode - Whether single mode is active.
 * @param {number} state.stateVersion - State version number.
 * @param {number[]} state.nodeSize - Node dimensions [width, height].
 * @param {HTMLElement} statusText - Status text element for UI feedback.
 * @param {Function} debouncedUpdateCardList - Debounced function to update the card list.
 */
function updateState(node, state, statusText, debouncedUpdateCardList) {
  const { imagePreviews, imageOrder, enabledLayers, isReversed, isSingleMode, stateVersion, nodeSize } = state;

  // Compute current output hash
  const currentOutputHash = computeOutputHash(
    node.properties.image_previews || [],
    node.properties.image_order || [],
    node.properties.enabled_layers || [],
    node.properties.is_single_mode || false,
    node.properties.is_reversed || false
  );

  // Validate and normalize state
  let newPreviews = Array.isArray(imagePreviews) ? imagePreviews : [];
  let newOrder = validateImageOrder(imageOrder, newPreviews);
  let newEnabled = enabledLayers.length === newPreviews.length ? enabledLayers : Array(newPreviews.length).fill(true);
  if (isSingleMode && newPreviews.length) {
    const trueCount = newEnabled.filter(x => x).length;
    if (trueCount !== 1) {
      log.warning(`Node ${node.id}: Single mode enabled but ${trueCount} layers active, enabling first enabled layer`);
      const firstTrueIndex = newEnabled.indexOf(true);
      newEnabled = Array(newPreviews.length).fill(false);
      newEnabled[firstTrueIndex >= 0 ? firstTrueIndex : newOrder[0]] = true;
    }
  }
  const newNodeSize = Array.isArray(nodeSize) && nodeSize.length === 2
    ? [Math.max(nodeSize[0], 360), Math.max(nodeSize[1], MIN_NODE_HEIGHT)]
    : [360, 360];

  // Compute new output hash
  const newOutputHash = computeOutputHash(newPreviews, newOrder, newEnabled, isSingleMode, isReversed);

  // Skip update if no significant change
  if (
    currentOutputHash === newOutputHash &&
    JSON.stringify(node.properties.image_previews) === JSON.stringify(newPreviews) &&
    JSON.stringify(node.properties.node_size) === JSON.stringify(newNodeSize)
  ) {
    log.debug(`Skipping state update for node ${node.id}: no significant changes`);
    debouncedUpdateCardList();
    return;
  }

  // Update properties
  node.properties.image_previews = newPreviews;
  node.properties.image_order = newOrder;
  node.properties.enabled_layers = newEnabled;
  node.properties.is_reversed = isReversed;
  node.properties.is_single_mode = isSingleMode;
  node.properties.state_version = stateVersion + 1;
  node.properties.node_size = newNodeSize;

  // Update widgets only if values have changed
  const newOrderValue = JSON.stringify({ node_id: node.id, order: newOrder });
  if (node.widgets[0].value !== newOrderValue) {
    node.widgets[0].value = newOrderValue;
  }
  const newEnabledValue = JSON.stringify({ node_id: node.id, enabled: newEnabled });
  if (node.widgets[1].value !== newEnabledValue) {
    node.widgets[1].value = newEnabledValue;
  }
  if (node.widgets[2].value !== node.id) {
    node.widgets[2].value = node.id;
  }
  if (node.widgets[3].value !== isSingleMode) {
    node.widgets[3].value = isSingleMode;
  }
  if (node.widgets[4].value !== isReversed) {
    node.widgets[4].value = isReversed;
  }
  const newSizeValue = JSON.stringify(newNodeSize);
  if (node.widgets[5].value !== newSizeValue) {
    node.widgets[5].value = newSizeValue;
  }

  // Update UI
  statusText.innerHTML = newPreviews.length ? `${newPreviews.length} images` : "No images";
  statusText.style.color = newPreviews.length ? "#2ECC71" : "#F5F6F5";

  debouncedUpdateCardList();
  app.graph.setDirtyCanvas(true, true);
  log.info(`State updated for node ${node.id}: ${newPreviews.length} images, order=${newOrder}, enabled=${newEnabled}, singleMode=${isSingleMode}, reversed=${isReversed}, nodeSize=${newNodeSize}, version=${node.properties.state_version}`);
}

app.registerExtension({
  name: "XIS.ImageManager",
  /**
   * Registers the node definition.
   * @param {Object} nodeType - The node type.
   * @param {Object} nodeData - The node data.
   * @async
   */
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
        state_version: 0,
        node_size: [360, 360]
      };
      this.setSize([360, MIN_NODE_HEIGHT]);
    };
  },

  /**
   * Sets up the extension by loading dependencies.
   * @async
   */
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
      const fontLink = document.createElement("link");
      fontLink.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap";
      fontLink.rel = "stylesheet";
      document.head.appendChild(fontLink);
      injectStyles();
      document.querySelectorAll(".xiser-image-manager-container:not([data-nodeId])").forEach(el => el.remove());
    } catch (error) {
      log.error(`Setup failed: ${error}`);
    }
  },

  /**
   * Initializes a created node.
   * @param {Object} node - The node instance.
   * @async
   */
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

    /**
     * Checks if a node's DOM element is positioned.
     * @param {Object} node - The node instance.
     * @returns {boolean} True if positioned, false otherwise.
     */
    function isNodePositioned(node) {
      const element = node.getElement ? node.getElement() : null;
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && (rect.left !== 0 || rect.top !== 0);
    }

    /**
     * Initializes node with retry logic and ensures UI is visible after positioning.
     * @param {Object} node - The node instance.
     * @param {Function} callback - Callback to invoke with node ID.
     * @param {number} [retries=10] - Number of retries.
     * @param {number} [delay=100] - Delay between retries in milliseconds.
     */
    function initializeNode(node, callback, retries = 10, delay = 100) {
      if (!node) {
        log.error(`Node is null or undefined. Aborting initialization.`);
        return;
      }
      if (node.id > 0 && app.graph.getNodeById(node.id)) {
        log.info(`Node immediately initialized: ID ${node.id}, type ${node.type}, title ${node.title || "undefined"}`);
        callback(node.id);
        return;
      }
      pendingNodes.set(node, callback);
      app.graph.setDirtyCanvas(true);
      let foundId = null;
      for (const graphNode of app.graph.nodes) {
        if (graphNode === node || (graphNode.id > 0 && graphNode.type === "XIS_ImageManager" && graphNode.id !== node.id)) {
          if (graphNode === node && graphNode.id > 0) {
            foundId = graphNode.id;
            break;
          } else if (graphNode.type === "XIS_ImageManager" && graphNode.id > 0) {
            if (JSON.stringify(graphNode.properties) === JSON.stringify(node.properties)) {
              foundId = graphNode.id;
              break;
            }
          }
        }
      }
      if (foundId) {
        log.info(`Node found in graph: ID ${foundId}, type ${node.type}, title ${node.title || "undefined"}`);
        pendingNodes.delete(node);
        node.id = foundId;
        callback(foundId);
        return;
      }
      if (retries <= 0) {
        log.error(`Node ID not assigned after ${retries * delay}ms (current ID: ${node.id || "undefined"}, graph nodes: ${app.graph.nodes.length}, type: ${node.type}, title: ${node.title || "undefined"}). Awaiting graph configuration or refresh browser.`);
        return;
      }
      log.warning(`Node ID ${node.id || "undefined"} not yet valid (nodes: ${app.graph.nodes.length}), retrying (${retries} attempts left)...`);
      setTimeout(() => initializeNode(node, callback, retries - 1, delay), delay);
    }

    initializeNode(node, async (nodeId) => {
      log.info(`XIS_ImageManager node initialized: ${nodeId}`);

      // Initialize state
      let imagePreviews = node.properties.image_previews || [];
      let imageOrder = node.properties.image_order || [];
      let isReversed = node.properties.is_reversed || false;
      let enabledLayers = node.properties.enabled_layers || [];
      let isSingleMode = node.properties.is_single_mode || false;
      let stateVersion = node.properties.state_version || 0;
      let nodeSize = node.properties.node_size || [360, 360];

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

      // Wait for node to be positioned before showing UI
      function showUI() {
        if (isNodePositioned(node)) {
          mainContainer.style.visibility = "visible";
          log.debug(`Node ${nodeId} UI made visible after positioning`);
          return;
        }
        let attempts = 20;
        function tryShowUI() {
          if (isNodePositioned(node)) {
            mainContainer.style.visibility = "visible";
            log.debug(`Node ${nodeId} UI made visible after ${20 - attempts} attempts`);
            return;
          }
          if (--attempts <= 0) {
            mainContainer.style.visibility = "visible";
            log.warning(`Node ${nodeId} UI shown after max attempts, position may not be finalized`);
            return;
          }
          requestAnimationFrame(tryShowUI);
        }
        requestAnimationFrame(tryShowUI);
      }
      requestAnimationFrame(showUI);

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
            const trueCount = enabledLayers.filter(x => x).length;
            if (trueCount !== 1) {
              log.warning(`Node ${nodeId}: Single mode enabled but ${trueCount} layers active, enabling first enabled layer`);
              const firstTrueIndex = enabledLayers.indexOf(true);
              enabledLayers = Array(imagePreviews.length).fill(false);
              enabledLayers[firstTrueIndex >= 0 ? firstTrueIndex : imageOrder[0]] = true;
            }
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
      }, { serialize: true });

      const singleModeWidget = node.addWidget("hidden", "single_mode", isSingleMode, value => {
        const newSingleMode = !!value;
        if (newSingleMode === isSingleMode) return;
        let newEnabledLayers = enabledLayers.slice();
        if (newSingleMode && imagePreviews.length) {
          const trueIndex = newEnabledLayers.indexOf(true);
          newEnabledLayers = Array(imagePreviews.length).fill(false);
          newEnabledLayers[trueIndex >= 0 ? trueIndex : imageOrder[0]] = true;
        }
        if (JSON.stringify(newEnabledLayers) === JSON.stringify(enabledLayers)) {
          log.debug(`Skipping single mode widget update for node ${nodeId}: no change in enabled layers`);
          return;
        }
        isSingleMode = newSingleMode;
        enabledLayers = newEnabledLayers;
        setState({ imagePreviews, imageOrder, enabledLayers, isReversed, isSingleMode, stateVersion, nodeSize });
        log.info(`Single mode widget updated for node ${nodeId}: ${isSingleMode}`);
      }, { serialize: true });

      const reverseWidget = node.addWidget("hidden", "is_reversed", isReversed, value => {
        isReversed = !!value;
        setState({ imagePreviews, imageOrder, enabledLayers, isReversed, isSingleMode, stateVersion, nodeSize });
        log.info(`Reverse widget updated for node ${nodeId}: ${isReversed}`);
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

      // Add DOM widget
      node.addDOMWidget("image_manager", "Image Manager", mainContainer, {
        serialize: true,
        getValue() {
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
            is_single_mode: isSingleMode,
            is_reversed: isReversed,
            node_id: nodeId,
            node_size: nodeSize,
            state_version: [stateVersion]
          };
        },
        setValue(value) {
          try {
            const receivedVersion = parseInt(Array.isArray(value.state_version) ? value.state_version[0] : value.state_version || 0);
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
            const newSingleMode = !!value.is_single_mode;
            const newReversed = !!value.is_reversed;
            const newNodeSize = Array.isArray(value.node_size) && value.node_size.length === 2
              ? [Math.max(value.node_size[0], 360), Math.max(value.node_size[1], MIN_NODE_HEIGHT)]
              : [360, 360];
            if (newSingleMode && newPreviews.length) {
              const trueCount = newEnabled.filter(x => x).length;
              if (trueCount !== 1) {
                log.warning(`Node ${nodeId}: Single mode enabled but ${trueCount} layers active, enabling first enabled layer`);
                const firstTrueIndex = newEnabled.indexOf(true);
                newEnabled = Array(newPreviews.length).fill(false);
                newEnabled[firstTrueIndex >= 0 ? firstTrueIndex : newOrder[0]] = true;
              }
            }

            const currentHash = computeOutputHash(imagePreviews, imageOrder, enabledLayers, isSingleMode, isReversed);
            const newHash = computeOutputHash(newPreviews, newOrder, newEnabled, newSingleMode, newReversed);
            if (
              currentHash === newHash &&
              JSON.stringify(imagePreviews) === JSON.stringify(newPreviews) &&
              JSON.stringify(nodeSize) === JSON.stringify(newNodeSize) &&
              receivedVersion <= stateVersion
            ) {
              log.debug(`Skipping setValue for node ${nodeId}: no state change`);
              return;
            }

            imagePreviews = newPreviews;
            imageOrder = newOrder;
            enabledLayers = newEnabled;
            isSingleMode = newSingleMode;
            isReversed = newReversed;
            nodeSize = newNodeSize;
            stateVersion = receivedVersion;
            node.setSize([Math.max(nodeSize[0], 360), Math.max(nodeSize[1], MIN_NODE_HEIGHT)]);
            setState({ imagePreviews, imageOrder, enabledLayers, isReversed, isSingleMode, stateVersion, nodeSize });
            log.info(`Restored state for node ${nodeId}: ${imageOrder.length} images, single_mode=${isSingleMode}, reversed=${isReversed}, node_size=${nodeSize}`);
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
        node.properties.node_size = nodeSize;
        // Only update if node.properties is consistent
        const currentPreviews = node.properties.image_previews || imagePreviews;
        const currentOrder = node.properties.image_order || imageOrder;
        const currentEnabled = node.properties.enabled_layers || enabledLayers;
        const currentSingleMode = node.properties.is_single_mode || isSingleMode;
        const currentReversed = node.properties.is_reversed || isReversed;
        const currentStateVersion = node.properties.state_version || stateVersion;
        setState({
          imagePreviews: currentPreviews,
          imageOrder: currentOrder,
          enabledLayers: currentEnabled,
          isReversed: currentReversed,
          isSingleMode: currentSingleMode,
          stateVersion: currentStateVersion,
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
        if (!message?.image_previews || !message?.image_order || !message?.enabled_layers) {
          statusText.innerText = "Execution error";
          statusText.style.color = "#F55";
          log.error(`Invalid execution data for node ${node.id}: ${JSON.stringify(message)}`);
          return;
        }
        const receivedVersion = parseInt(Array.isArray(message.state_version) ? message.state_version[0] : (message.state_version || 0));
        log.debug(`Received execution data for node ${node.id}: version=${receivedVersion}, current=${stateVersion}, input images=${message.image_previews?.length || 0}, single_mode=${message.is_single_mode}, reversed=${message.is_reversed}`);

        const newSingleMode = Array.isArray(message.is_single_mode) ? !!message.is_single_mode[0] : !!message.is_single_mode;
        const newReversed = Array.isArray(message.is_reversed) ? !!message.is_reversed[0] : !!message.is_reversed;
        const newNodeSize = Array.isArray(message.node_size) && message.node_size.length === 2
          ? [Math.max(message.node_size[0], 360), Math.max(message.node_size[1], MIN_NODE_HEIGHT)]
          : nodeSize;
        const newPreviews = message.image_previews.map((p, i) => ({
          ...p,
          index: i,
          originalFilename: p.originalFilename || p.filename
        }));
        const newOrder = validateImageOrder(message.image_order, newPreviews);
        let newEnabled = message.enabled_layers.length === newPreviews.length ? message.enabled_layers : Array(newPreviews.length).fill(true);
        if (newSingleMode && newPreviews.length) {
          const trueCount = newEnabled.filter(x => x).length;
          if (trueCount !== 1) {
            log.warning(`Node ${node.id}: Single mode enabled but ${trueCount} layers active, enabling first enabled layer`);
            const firstTrueIndex = newEnabled.indexOf(true);
            newEnabled = Array(newPreviews.length).fill(false);
            newEnabled[firstTrueIndex >= 0 ? firstTrueIndex : newOrder[0]] = true;
          }
        }

        const currentHash = computeOutputHash(imagePreviews, imageOrder, enabledLayers, isSingleMode, isReversed);
        const newHash = computeOutputHash(newPreviews, newOrder, newEnabled, newSingleMode, newReversed);
        if (
          currentHash === newHash &&
          JSON.stringify(imagePreviews) === JSON.stringify(newPreviews) &&
          JSON.stringify(nodeSize) === JSON.stringify(newNodeSize) &&
          receivedVersion <= stateVersion
        ) {
          log.debug(`Skipping execution update for node ${node.id}: no state change`);
          return;
        }

        imagePreviews = newPreviews;
        imageOrder = newOrder;
        enabledLayers = newEnabled;
        isSingleMode = newSingleMode;
        isReversed = newReversed;
        nodeSize = newNodeSize;
        stateVersion = receivedVersion;
        node.widgets.find(w => w.name === "single_mode").value = isSingleMode;
        node.widgets.find(w => w.name === "is_reversed").value = isReversed;
        node.setSize([Math.max(nodeSize[0], 360), Math.max(nodeSize[1], MIN_NODE_HEIGHT)]);
        setState({ imagePreviews, imageOrder, enabledLayers, isReversed, isSingleMode, stateVersion, nodeSize });
        log.info(`Node ${node.id} executed: ${imagePreviews.length} images, order=${imageOrder}, enabled=${enabledLayers}, singleMode=${isSingleMode}, reversed=${isReversed}, nodeSize=${nodeSize}, version=${stateVersion}`);
      };

      // Handle node removal
      node.onRemoved = function () {
        log.info(`Node ${nodeId} removed`);
      };

      // Initial state update
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