/**
 * @fileoverview UI logic for XIS_ImageManager node in ComfyUI, handling DOM creation, event handling, and card list updates.
 * @module xis_image_manager_ui
 */

import {
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
  arraysShallowEqual,
  areImagePreviewsEqual,
  areImageStatesEqual
} from "./utils.js";
import { openImageEditor } from "./editor.js";

function buildImageState(imagePreviews, imageOrder, enabledLayers) {
  const previewsByIndex = new Map(imagePreviews.map(preview => [preview.index, preview]));
  const result = [];
  const enabled = Array.isArray(enabledLayers) ? enabledLayers : [];
  const orderList = Array.isArray(imageOrder) && imageOrder.length ? imageOrder : imagePreviews.map(preview => preview.index);
  const seen = new Set();

  orderList.forEach(idx => {
    const preview = previewsByIndex.get(idx);
    if (!preview || seen.has(preview.image_id)) return;
    result.push({
      id: preview.image_id,
      enabled: idx < enabled.length ? !!enabled[idx] : true,
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

  imagePreviews.forEach(preview => {
    if (seen.has(preview.image_id)) return;
    const idx = preview.index;
    result.push({
      id: preview.image_id,
      enabled: idx < enabled.length ? !!enabled[idx] : true,
      source: preview.source,
      filename: preview.filename,
      originalFilename: preview.originalFilename,
      width: preview.width,
      height: preview.height,
      index: idx,
      contentHash: preview.content_hash || preview.contentHash || null,
      storageFilename: preview.storageFilename || preview.storage_filename || preview.filename
    });
  });

  return result;
}

function reconcileStateWithPreviews(imagePreviews, imageState) {
  const previewById = new Map(imagePreviews.map(preview => [preview.image_id, preview]));
  const result = [];
  const seen = new Set();

  (Array.isArray(imageState) ? imageState : []).forEach(entry => {
    if (!entry || typeof entry !== "object" || !entry.id) return;
    const preview = previewById.get(entry.id);
    if (!preview || seen.has(entry.id)) return;
    result.push({
      id: entry.id,
      enabled: entry.enabled !== undefined ? !!entry.enabled : true,
      source: preview.source,
      filename: preview.filename,
      originalFilename: preview.originalFilename,
      width: preview.width,
      height: preview.height,
      index: preview.index,
      contentHash: entry.contentHash ?? entry.content_hash ?? preview.content_hash ?? preview.contentHash ?? null,
      storageFilename: entry.storageFilename ?? entry.storage_filename ?? preview.storageFilename ?? preview.storage_filename ?? preview.filename
    });
    seen.add(entry.id);
  });

  imagePreviews.forEach(preview => {
    if (seen.has(preview.image_id)) return;
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
    seen.add(preview.image_id);
  });

  return result;
}

function deriveOrderAndEnabledFromState(imagePreviews, imageState, enforceSingleMode = false) {
  const previewById = new Map(imagePreviews.map(preview => [preview.image_id, preview]));
  const order = [];
  const orderSet = new Set();
  const enabled = Array(imagePreviews.length).fill(true);

  (Array.isArray(imageState) ? imageState : []).forEach(entry => {
    if (!entry || !entry.id) return;
    const preview = previewById.get(entry.id);
    if (!preview) return;
    const idx = preview.index;
    if (!orderSet.has(idx)) {
      order.push(idx);
      orderSet.add(idx);
    }
    if (idx < enabled.length) {
      enabled[idx] = entry.enabled !== undefined ? !!entry.enabled : true;
    }
  });

  imagePreviews.forEach(preview => {
    const idx = preview.index;
    if (!orderSet.has(idx)) {
      order.push(idx);
      orderSet.add(idx);
    }
    if (enabled[idx] === undefined) {
      enabled[idx] = true;
    }
  });

  if (enforceSingleMode && order.length) {
    let activeIdx = order.find(idx => enabled[idx]);
    if (activeIdx === undefined) activeIdx = order[0];
    for (let i = 0; i < enabled.length; i++) {
      enabled[i] = i === activeIdx;
    }
  }

  return { order, enabled };
}

function reorderImageState(imagePreviews, imageState, nextOrder) {
  const previewByIndex = new Map(imagePreviews.map(preview => [preview.index, preview]));
  const entryById = new Map((Array.isArray(imageState) ? imageState : []).map(entry => [entry.id, entry]));
  const nextState = [];
  const seen = new Set();

  nextOrder.forEach(idx => {
    const preview = previewByIndex.get(idx);
    if (!preview || !preview.image_id || seen.has(preview.image_id)) return;
    const entry = entryById.get(preview.image_id);
    if (entry) {
      nextState.push(entry);
      seen.add(preview.image_id);
    }
  });

  imagePreviews.forEach(preview => {
    if (!preview.image_id || seen.has(preview.image_id)) return;
    const entry = entryById.get(preview.image_id);
    if (entry) {
      nextState.push(entry);
      seen.add(preview.image_id);
    }
  });

  return reconcileStateWithPreviews(imagePreviews, nextState);
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
 * Creates and manages the UI for the XIS_ImageManager node.
 * @param {Object} node - The node instance.
 * @param {string} nodeId - Node identifier.
 * @param {Object} initialState - Initial state object.
 * @param {Object[]} initialState.imagePreviews - Array of image preview objects.
 * @param {number[]} initialState.imageOrder - Array of image indices.
 * @param {boolean[]} initialState.enabledLayers - Array of enabled states.
 * @param {boolean} initialState.isReversed - Whether the order is reversed.
 * @param {boolean} initialState.isSingleMode - Whether single mode is active.
 * @param {number} initialState.stateVersion - State version number (internal use only).
 * @param {number[]} initialState.nodeSize - Node dimensions [width, height].
 * @param {Function} updateState - Function to update node state.
 * @param {Function} uploadImages - Function to handle image uploads.
 * @param {Function} deleteImage - Function to handle image deletion.
 * @returns {Object} Object containing mainContainer, statusText, debouncedUpdateCardList, and setState.
 */
function createImageManagerUI(node, nodeId, initialState, updateState, uploadImages, deleteImage) {
  let { imagePreviews, imageOrder, enabledLayers, isReversed, isSingleMode, stateVersion, nodeSize, imageState } = initialState;
  if (!Array.isArray(imagePreviews)) imagePreviews = [];
  if (!Array.isArray(imageState) || !imageState.length) {
    imageState = buildImageState(imagePreviews, imageOrder, enabledLayers);
  }
  imageState = reconcileStateWithPreviews(imagePreviews, imageState);
  const { order: derivedOrder, enabled: derivedEnabled } = deriveOrderAndEnabledFromState(imagePreviews, imageState, isSingleMode);
  imageOrder = derivedOrder;
  enabledLayers = derivedEnabled;
  imagePreviews = imagePreviews.map(preview => ({
    ...preview,
    enabled: enabledLayers[preview.index] ?? true
  }));

  // Create main container
  const mainContainer = createElementWithClass("div", `xiser-image-manager-container ${getNodeClass(nodeId)}`, {
    "data-nodeId": nodeId
  });
  mainContainer.style.position = "relative";
  mainContainer.style.top = "-190px";
  mainContainer.style.visibility = "hidden"; // Initially hidden to prevent flash
  mainContainer.style.width = "100%";
  mainContainer.style.height = "100%";
  mainContainer.style.overflow = "visible";

  // Prevent drag events from interfering
  mainContainer.addEventListener("dragover", (e) => {
    e.stopPropagation();
    e.preventDefault();
    log.debug(`Dragover event stopped on node ${nodeId}`);
  });
  mainContainer.addEventListener("dragenter", (e) => {
    e.stopPropagation();
    e.preventDefault();
    log.debug(`Dragenter event stopped on node ${nodeId}`);
  });
  mainContainer.addEventListener("dragleave", (e) => {
    e.stopPropagation();
    e.preventDefault();
    log.debug(`Dragleave event stopped on node ${nodeId}`);
  });

  // Create UI elements
  const header = createElementWithClass("div", "xiser-image-manager-header");
  const topRow = createElementWithClass("div", "xiser-image-manager-top-row");
  const statusText = createElementWithClass("div", "xiser-image-manager-status");
  const controlsContainer = createElementWithClass("div", "xiser-image-manager-controls");
  const toggleGroup = createElementWithClass("div", "xiser-image-manager-toggle-group");
  const cardContainer = createElementWithClass("div", "xiser-image-manager-card-container");
  cardContainer.innerHTML = "";
  mainContainer.appendChild(header);
  mainContainer.appendChild(cardContainer);

  function getStorageFilename(preview) {
    return preview.storageFilename || preview.storage_filename || preview.filename;
  }

  // Upload button and input
  const uploadButton = createElementWithClass("div", "xiser-image-manager-upload");
  uploadButton.innerText = "Upload Images";
  const uploadInput = createElementWithClass("input", "", {
    type: "file",
    accept: "image/*",
    multiple: true,
    style: "display:none"
  });
  uploadButton.addEventListener("click", () => uploadInput.click());
  uploadInput.addEventListener("change", async () => {
    if (!uploadInput.files.length) return;
    statusText.innerText = `Uploading ${uploadInput.files.length} images...`;
    statusText.style.color = "#FFF";
    try {
      const uploadedImages = await uploadImages(uploadInput.files, nodeId, node);
      const maxIndex = imagePreviews.length ? Math.max(...imagePreviews.map(p => p.index)) + 1 : 0;
      const newPreviews = uploadedImages.map((img, i) => ({
        index: maxIndex + i,
        preview: img.preview,
        width: img.width,
        height: img.height,
        filename: img.filename,
        storageFilename: img.storageFilename || img.filename,
        originalFilename: img.originalFilename,
        image_id: img.image_id && String(img.image_id).length ? img.image_id : `${nodeId}_upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        source: "uploaded",
        enabled: true
      }));
      const newImagePreviews = [...imagePreviews, ...newPreviews];
      const appendedState = [
        ...imageState,
        ...newPreviews.map(preview => ({
          id: preview.image_id || "",
          enabled: true,
          source: preview.source,
          filename: preview.filename,
          originalFilename: preview.originalFilename,
          width: preview.width,
          height: preview.height,
          index: preview.index,
          contentHash: preview.content_hash || preview.contentHash || null,
          storageFilename: preview.storageFilename || preview.storage_filename || preview.filename
        }))
      ];
      const reconciledState = reconcileStateWithPreviews(newImagePreviews, appendedState);
      setState({ imagePreviews: newImagePreviews, imageState: reconciledState });
      statusText.innerText = `${newImagePreviews.length} images`;
      statusText.style.color = "#2ECC71";
    } catch (error) {
      statusText.innerText = "Upload failed";
      statusText.style.color = "#F55";
      log.error(`Upload failed for node ${nodeId}: ${error}`);
    }
    uploadInput.value = "";
  });

  topRow.appendChild(statusText);
  topRow.appendChild(uploadButton);
  topRow.appendChild(uploadInput);
  header.appendChild(topRow);

  // Reverse toggle
  const reverseToggle = createElementWithClass("input", "xiser-image-manager-toggle", {
    type: "checkbox",
    checked: isReversed
  });
  reverseToggle.checked = isReversed;
  reverseToggle.addEventListener("change", () => {
    const newIsReversed = reverseToggle.checked;
    if (newIsReversed === isReversed) {
      log.debug(`Skipping reverse toggle for node ${nodeId}: no change`);
      reverseToggle.checked = isReversed;
      return;
    }
    setState({ isReversed: newIsReversed });
    log.info(`Reverse toggled for node ${nodeId}: ${newIsReversed}`);
  });
  const reverseLabel = createElementWithClass("label", "xiser-image-manager-label");
  reverseLabel.innerText = "Reverse";
  const reverseContainer = createElementWithClass("div", "xiser-image-manager-control-item");
  reverseContainer.appendChild(reverseLabel);
  reverseContainer.appendChild(reverseToggle);

  // Single mode toggle
  const singleModeToggle = createElementWithClass("input", "xiser-image-manager-toggle", {
    type: "checkbox",
    checked: isSingleMode
  });
  singleModeToggle.checked = isSingleMode;
  singleModeToggle.addEventListener("change", () => {
    const newSingleMode = singleModeToggle.checked;
    if (newSingleMode === isSingleMode) {
      singleModeToggle.checked = isSingleMode;
      log.debug(`Skipping single mode toggle for node ${nodeId}: no change`);
      return;
    }
    setState({ isSingleMode: newSingleMode });
    log.info(`Single mode toggled for node ${nodeId}: ${newSingleMode}`);
  });
  const singleModeLabel = createElementWithClass("label", "xiser-image-manager-label");
  singleModeLabel.innerText = "Single Mode";
  const singleModeContainer = createElementWithClass("div", "xiser-image-manager-control-item");
  singleModeContainer.appendChild(singleModeLabel);
  singleModeContainer.appendChild(singleModeToggle);

  // Reset button
  const resetButton = createElementWithClass("div", "xiser-image-manager-reset");
  resetButton.innerText = "Reset";
  resetButton.addEventListener("click", () => {
    const defaultOrder = [...Array(imagePreviews.length).keys()];
    const defaultEnabled = Array(imagePreviews.length).fill(true);
    const resetState = buildImageState(imagePreviews, defaultOrder, defaultEnabled);
    if (areImageStatesEqual(imageState, resetState) && !isReversed) {
      log.debug(`Skipping reset for node ${nodeId}: no change`);
      return;
    }
    setState({ imageState: resetState, isReversed });
    log.info(`Reset image order for node ${nodeId}`);
  });

  toggleGroup.appendChild(reverseContainer);
  toggleGroup.appendChild(singleModeContainer);
  controlsContainer.appendChild(toggleGroup);
  controlsContainer.appendChild(resetButton);
  header.appendChild(controlsContainer);

  let sortableInstance = null;
  function updateCardList() {
    cardContainer.innerHTML = "";
    if (sortableInstance) {
      sortableInstance.destroy();
      sortableInstance = null;
    }

    log.debug(`Node ${nodeId}: updateCardList called with ${imagePreviews.length} previews, order=${JSON.stringify(imageOrder)}, enabled=${JSON.stringify(enabledLayers)}`);

    if (!window.Sortable) {
      log.error(`Node ${nodeId}: Sortable.js not loaded`);
      statusText.innerText = "Sortable.js error";
      statusText.style.color = "#F55";
      updateContainerHeight(mainContainer, header, cardContainer, node.size, nodeId);
      return;
    }

    if (imagePreviews.length === 0) {
      statusText.innerText = "No images";
      statusText.style.color = "#F5F6F5";
      log.debug(`Node ${nodeId}: No images to render`);
      updateContainerHeight(mainContainer, header, cardContainer, node.size, nodeId);
      return;
    }

    if (imagePreviews.length > 50) {
      statusText.innerText = "Too many images";
      statusText.style.color = "#FFA500";
      log.warning(`Node ${nodeId}: Too many images (${imagePreviews.length})`);
    }

    const validatedImageOrder = validateImageOrder(imageOrder, imagePreviews, nodeId);
    let newEnabledLayers = enabledLayers.length === imagePreviews.length ? enabledLayers : Array(imagePreviews.length).fill(true);
    if (isSingleMode && imagePreviews.length) {
      const trueCount = newEnabledLayers.filter(x => x).length;
      if (trueCount !== 1) {
        log.warning(`Node ${nodeId}: Single mode enabled but ${trueCount} layers active, enabling first layer`);
        newEnabledLayers = Array(imagePreviews.length).fill(false);
        newEnabledLayers[validatedImageOrder[0]] = true;
      }
    }

    // Check if state needs updating
    const stateChanged = 
      !arraysShallowEqual(imageOrder, validatedImageOrder) ||
      !arraysShallowEqual(enabledLayers, newEnabledLayers);

    if (stateChanged) {
      const normalizedState = buildImageState(imagePreviews, validatedImageOrder, newEnabledLayers);
      setState({ imagePreviews, imageState: normalizedState, isReversed, isSingleMode });
    }

    const orderedPreviews = imageOrder.map(idx => {
      const preview = imagePreviews.find(p => p.index === idx);
      if (!preview) {
        log.error(`Node ${nodeId}: No preview for index ${idx}`);
        return null;
      }
      return { ...preview, enabled: enabledLayers[idx] };
    }).filter(p => p);

    if (orderedPreviews.length !== imagePreviews.length) {
      log.error(`Node ${nodeId}: Incomplete orderedPreviews, resetting order`);
      const resetState = buildImageState(imagePreviews, [...Array(imagePreviews.length).keys()], Array(imagePreviews.length).fill(true));
      setState({ imagePreviews, imageState: resetState, isReversed, isSingleMode });
      return;
    }

    const displayPreviews = isReversed ? [...orderedPreviews].reverse() : orderedPreviews;
    let enabledCount = enabledLayers.filter(x => x).length;
    let enabledIndex = 0;

    let popupContainer = document.querySelector(`.xiser-image-manager-popup-container.${getNodeClass(nodeId)}`);
    if (!popupContainer) {
      popupContainer = createElementWithClass("div", `xiser-image-manager-popup-container ${getNodeClass(nodeId)}`, {
        style: "z-index: 10001;"
      });
      document.body.appendChild(popupContainer);
    }

    displayPreviews.forEach(preview => {
      const card = createElementWithClass("div", "xiser-image-manager-image-card", { "data-index": preview.index });
      if (!preview.enabled) {
        card.classList.add("disabled");
      }

      // 创建图片容器
      const imgContainer = createElementWithClass("div", "xiser-image-manager-preview-container");

      const img = createElementWithClass("img", "xiser-image-manager-preview", {
        src: `data:image/png;base64,${preview.preview}`
      });
      img.onerror = () => {
        log.error(`Node ${nodeId}: Failed to load preview image for index ${preview.index}`);
        img.src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="; // Fallback image
      };
      const openEditor = (e) => {
        e.stopPropagation();
        openImageEditor(preview, {
          nodeId,
          updateState: setState,
          statusText,
          imagePreviews,
          imageState
        });
      };
      imgContainer.addEventListener("click", openEditor);

      imgContainer.appendChild(img);
      card.appendChild(imgContainer);

      const info = createElementWithClass("div", "xiser-image-manager-info");
      const layerSize = createElementWithClass("div", "xiser-image-manager-layer-size");
      const displayFilename = truncateFilename(preview.originalFilename || preview.filename);
      layerSize.innerText = preview.enabled
        ? `Layer ${isReversed ? enabledCount - enabledIndex++ : ++enabledIndex} | ${preview.width}x${preview.height}`
        : `Disabled | Size: ${preview.width}x${preview.height}`;
      const filename = createElementWithClass("div", "xiser-image-manager-filename");
      filename.innerText = displayFilename;
      info.appendChild(layerSize);
      info.appendChild(filename);
      card.appendChild(info);

      const buttonContainer = createElementWithClass("div", "xiser-image-manager-button-container");
      if (preview.source === "uploaded" || preview.filename.startsWith("upload_image_")) {
        const deleteButton = createElementWithClass("div", "xiser-image-manager-delete-button");
        deleteButton.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 2L10 10M2 10L10 2" stroke="#FF5555" stroke-width="1.5" stroke-linecap="round"/></svg>`;
        deleteButton.addEventListener("click", (e) => {
          log.debug(`Delete button clicked for uploaded image ${preview.filename} at index ${preview.index}`);
          popupContainer.innerHTML = "";
          const popup = createElementWithClass("div", "xiser-image-manager-popup");
          popup.style.width = "200px";
          popup.style.minHeight = "100px";
          popup.style.zIndex = "10002";
          const message = createElementWithClass("div", "xiser-image-manager-popup-message");
          message.innerText = "Delete this image?";
          const buttonContainer = createElementWithClass("div", "xiser-image-manager-popup-buttons");
          const confirmButton = createElementWithClass("div", "xiser-image-manager-popup-button xiser-image-manager-popup-confirm");
          confirmButton.innerText = "Confirm";
          confirmButton.addEventListener("click", async () => {
            try {
              await deleteImage(preview.filename, nodeId);
              const imageIdToRemove = preview.image_id;

              // Remove the deleted image from previews
              const newImagePreviews = imagePreviews
                .filter(p => p.image_id !== imageIdToRemove)
                .map((p, i) => ({ ...p, index: i }));

              const filteredState = imageState.filter(entry => entry.id !== imageIdToRemove);
              const reconciledState = reconcileStateWithPreviews(newImagePreviews, filteredState);

              setState({
                imagePreviews: newImagePreviews,
                imageState: reconciledState
              });
              popupContainer.innerHTML = "";
              log.info(`Deleted uploaded image ${preview.filename} (image_id: ${imageIdToRemove}) for node ${nodeId}`);
            } catch (error) {
              statusText.innerText = "Delete failed";
              statusText.style.color = "#F55";
              log.error(`Failed to delete image ${preview.filename}: ${error}`);
              popupContainer.innerHTML = "";
            }
          });
          const cancelButton = createElementWithClass("div", "xiser-image-manager-popup-button xiser-image-manager-popup-cancel");
          cancelButton.innerText = "Cancel";
          cancelButton.addEventListener("click", () => {
            popupContainer.innerHTML = "";
          });
          buttonContainer.appendChild(confirmButton);
          buttonContainer.appendChild(cancelButton);
          popup.appendChild(message);
          popup.appendChild(buttonContainer);
          popupContainer.appendChild(popup);
          positionPopup(popup, e.clientX - 120, e.clientY - 130);
          log.debug(`Popup created at position: left=${popup.style.left}, top=${popup.style.top}`);
        });
        buttonContainer.appendChild(deleteButton);
      }

      const toggle = createElementWithClass("input", "xiser-image-manager-toggle", {
        type: "checkbox",
        checked: preview.enabled
      });
      toggle.checked = preview.enabled;
      if (imagePreviews.length === 1) {
        toggle.classList.add("toggle-disabled");
        toggle.disabled = true;
      } else if (isSingleMode && preview.enabled) {
        toggle.disabled = true;
      }
      toggle.addEventListener("change", () => {
        if (imagePreviews.length === 1 || (isSingleMode && preview.enabled && !toggle.checked)) {
          toggle.checked = preview.enabled;
          log.debug(`Skipping layer toggle for node ${nodeId}: single image or single mode restriction`);
          return;
        }
        if (!preview?.image_id) {
          toggle.checked = preview.enabled;
          log.warning(`Node ${nodeId}: Missing image_id for preview index ${preview.index}`);
          return;
        }
        const updatedState = imageState.map(entry => {
          if (entry.id !== preview.image_id) {
            return isSingleMode && toggle.checked
              ? { ...entry, enabled: false }
              : entry;
          }
          return { ...entry, enabled: toggle.checked };
        });
        setState({ imageState: updatedState });
        log.info(`Layer ${preview.index} enabled: ${toggle.checked} for node ${nodeId}`);
      });
      buttonContainer.appendChild(toggle);
      card.appendChild(buttonContainer);
      cardContainer.appendChild(card);
    });

    log.debug(`Node ${nodeId}: cardContainer children after render: ${cardContainer.children.length}`);
    updateContainerHeight(mainContainer, header, cardContainer, node.size, nodeId);

    if (imagePreviews.length > 1) {
      sortableInstance = initializeSortable(cardContainer, nodeId, (newDomOrder) => {
        const newImageOrder = isReversed ? newDomOrder.reverse() : newDomOrder;
        const validatedImageOrder = validateImageOrder(newImageOrder, imagePreviews, nodeId);
        if (arraysShallowEqual(validatedImageOrder, imageOrder)) {
          log.debug(`Skipping sortable update for node ${nodeId}: no change`);
          return;
        }
        const reorderedState = reorderImageState(imagePreviews, imageState, validatedImageOrder);
        setState({ imageState: reorderedState });
        log.info(`Image order updated for node ${nodeId}: ${validatedImageOrder}`);
      });
    }

    statusText.innerText = imagePreviews.length ? `${imagePreviews.length} images` : "No images";
    statusText.style.color = imagePreviews.length ? "#2ECC71" : "#F5F6F5";
  }

  const debouncedUpdateCardList = debounce(updateCardList, 100);

  /**
   * Updates the UI and node state.
   * @param {Object} newState - New state object.
   * @param {Object[]} newState.imagePreviews - Array of image preview objects.
   * @param {number[]} newState.imageOrder - Array of image indices.
   * @param {boolean[]} newState.enabledLayers - Array of enabled states.
   * @param {boolean} newState.isReversed - Whether the order is reversed.
   * @param {boolean} newState.isSingleMode - Whether single mode is active.
   * @param {number} newState.stateVersion - State version number (internal use only).
   * @param {number[]} newState.nodeSize - Node dimensions [width, height].
   */
  function setState(newState) {
    const newImagePreviewsInput = newState.imagePreviews ?? imagePreviews;
    const newIsReversed = newState.isReversed ?? isReversed;
    const newIsSingleMode = newState.isSingleMode ?? isSingleMode;
    const newNodeSize = newState.nodeSize ?? nodeSize;
    const incomingVersion = newState.stateVersion ?? stateVersion;

    let nextImageState;
    if (Array.isArray(newState.imageState) && newState.imageState.length) {
      nextImageState = reconcileStateWithPreviews(newImagePreviewsInput, newState.imageState);
    } else if (newState.imageOrder || newState.enabledLayers) {
      nextImageState = reconcileStateWithPreviews(
        newImagePreviewsInput,
        buildImageState(
          newImagePreviewsInput,
          newState.imageOrder ?? imageOrder,
          newState.enabledLayers ?? enabledLayers
        )
      );
    } else {
      nextImageState = reconcileStateWithPreviews(newImagePreviewsInput, imageState);
    }

    if (newIsSingleMode && nextImageState.length) {
      nextImageState = enforceSingleModeState(nextImageState);
    }

    const { order: derivedOrder, enabled: derivedEnabled } = deriveOrderAndEnabledFromState(newImagePreviewsInput, nextImageState, newIsSingleMode);

    const normalizedPreviews = newImagePreviewsInput.map(preview => ({
      ...preview,
      enabled: derivedEnabled[preview.index] ?? true
    }));

    const stateChanged =
      !areImagePreviewsEqual(imagePreviews, normalizedPreviews) ||
      !arraysShallowEqual(imageOrder, derivedOrder) ||
      !arraysShallowEqual(enabledLayers, derivedEnabled) ||
      !areImageStatesEqual(imageState, nextImageState) ||
      isReversed !== newIsReversed ||
      isSingleMode !== newIsSingleMode ||
      !arraysShallowEqual(nodeSize, newNodeSize);

    if (!stateChanged) {
      log.debug(`Skipping setState for node ${nodeId}: no state change`);
      return;
    }

    imagePreviews = normalizedPreviews;
    imageState = nextImageState;
    imageOrder = derivedOrder;
    enabledLayers = derivedEnabled;
    isReversed = newIsReversed;
    isSingleMode = newIsSingleMode;
    nodeSize = newNodeSize;
    stateVersion = incomingVersion + 1;

    singleModeToggle.checked = isSingleMode;
    reverseToggle.checked = isReversed;
    updateContainerHeight(mainContainer, header, cardContainer, node.size, nodeId);
    updateState(node, { imagePreviews, imageOrder, enabledLayers, imageState, isReversed, isSingleMode, stateVersion, nodeSize }, statusText, debouncedUpdateCardList);
    log.debug(`Node ${nodeId}: setState updated, new stateVersion=${stateVersion}`);
  }

  // Initial UI update
  updateCardList();

  return { mainContainer, statusText, debouncedUpdateCardList, setState };
}

export { createImageManagerUI };
