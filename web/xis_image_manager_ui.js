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
  initializeSortable
} from "./xis_image_manager_utils.js";

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
  let { imagePreviews, imageOrder, enabledLayers, isReversed, isSingleMode, stateVersion, nodeSize } = initialState;

  // Create main container
  const mainContainer = createElementWithClass("div", `xiser-image-manager-container ${getNodeClass(nodeId)}`, {
    "data-nodeId": nodeId
  });
  mainContainer.style.position = "relative";
  mainContainer.style.top = "-145px";
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
        originalFilename: img.originalFilename
      }));
      const newImagePreviews = [...imagePreviews, ...newPreviews];
      const newImageOrder = [...imageOrder, ...newPreviews.map(p => p.index)];
      let newEnabledLayers = [...enabledLayers, ...Array(newPreviews.length).fill(true)];
      if (isSingleMode && newImagePreviews.length) {
        newEnabledLayers = Array(newImagePreviews.length).fill(false);
        newEnabledLayers[newImageOrder[0]] = true;
      }
      setState({ 
        imagePreviews: newImagePreviews, 
        imageOrder: newImageOrder, 
        enabledLayers: newEnabledLayers, 
        isReversed, 
        isSingleMode, 
        stateVersion, 
        nodeSize 
      });
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
    setState({ imagePreviews, imageOrder, enabledLayers, isReversed: newIsReversed, isSingleMode, stateVersion, nodeSize });
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
    let newEnabledLayers = enabledLayers.slice();
    if (newSingleMode && imagePreviews.length) {
      const trueIndex = newEnabledLayers.indexOf(true);
      newEnabledLayers = Array(imagePreviews.length).fill(false);
      newEnabledLayers[trueIndex >= 0 ? trueIndex : imageOrder[0]] = true;
    }
    if (newSingleMode === isSingleMode && JSON.stringify(newEnabledLayers) === JSON.stringify(enabledLayers)) {
      singleModeToggle.checked = isSingleMode;
      log.debug(`Skipping single mode toggle for node ${nodeId}: no change`);
      return;
    }
    setState({ imagePreviews, imageOrder, enabledLayers: newEnabledLayers, isReversed, isSingleMode: newSingleMode, stateVersion, nodeSize });
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
    const newImageOrder = [...Array(imagePreviews.length).keys()];
    let newEnabledLayers = Array(imagePreviews.length).fill(true);
    if (isSingleMode && imagePreviews.length) {
      newEnabledLayers = Array(imagePreviews.length).fill(false);
      newEnabledLayers[0] = true;
    }
    if (JSON.stringify(newImageOrder) === JSON.stringify(imageOrder) && JSON.stringify(newEnabledLayers) === JSON.stringify(enabledLayers)) {
      log.debug(`Skipping reset for node ${nodeId}: no change`);
      return;
    }
    setState({ imagePreviews, imageOrder: newImageOrder, enabledLayers: newEnabledLayers, isReversed, isSingleMode, stateVersion, nodeSize });
    log.info(`Reset image order for node ${nodeId}: ${newImageOrder}`);
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
      JSON.stringify(imageOrder) !== JSON.stringify(validatedImageOrder) ||
      JSON.stringify(enabledLayers) !== JSON.stringify(newEnabledLayers);
    
    if (stateChanged) {
      imageOrder = validatedImageOrder;
      enabledLayers = newEnabledLayers;
      setState({ imagePreviews, imageOrder, enabledLayers, isReversed, isSingleMode, stateVersion, nodeSize });
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
      const newImageOrder = [...Array(imagePreviews.length).keys()];
      let newEnabledLayers = Array(imagePreviews.length).fill(true);
      if (isSingleMode && imagePreviews.length) {
        newEnabledLayers = Array(imagePreviews.length).fill(false);
        newEnabledLayers[0] = true;
      }
      setState({ imagePreviews, imageOrder: newImageOrder, enabledLayers: newEnabledLayers, isReversed, isSingleMode, stateVersion, nodeSize });
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

      const img = createElementWithClass("img", "xiser-image-manager-preview", {
        src: `data:image/png;base64,${preview.preview}`
      });
      img.onerror = () => {
        log.error(`Node ${nodeId}: Failed to load preview image for index ${preview.index}`);
        img.src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="; // Fallback image
      };
      card.appendChild(img);

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
      if (preview.filename.startsWith("xis_image_manager_")) {
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
              const indexToRemove = preview.index;
              const newImagePreviews = imagePreviews
                .filter(p => p.index !== indexToRemove)
                .map((p, i) => ({ ...p, index: i }));
              const newImageOrder = imageOrder
                .filter(idx => idx !== indexToRemove)
                .map(idx => idx > indexToRemove ? idx - 1 : idx);
              let newEnabledLayers = enabledLayers.filter((_, idx) => idx !== indexToRemove);
              if (isSingleMode && newImagePreviews.length && newEnabledLayers.filter(x => x).length === 0) {
                newEnabledLayers = Array(newImagePreviews.length).fill(false);
                newEnabledLayers[0] = true;
              }
              setState({ 
                imagePreviews: newImagePreviews, 
                imageOrder: newImageOrder, 
                enabledLayers: newEnabledLayers, 
                isReversed, 
                isSingleMode, 
                stateVersion, 
                nodeSize 
              });
              popupContainer.innerHTML = "";
              log.info(`Deleted uploaded image ${preview.filename} at index ${indexToRemove} for node ${nodeId}`);
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
        let newEnabledLayers = enabledLayers.slice();
        if (isSingleMode) {
          if (toggle.checked) {
            newEnabledLayers = Array(imagePreviews.length).fill(false);
            newEnabledLayers[preview.index] = true;
          }
        } else {
          newEnabledLayers[preview.index] = toggle.checked;
        }
        if (JSON.stringify(newEnabledLayers) === JSON.stringify(enabledLayers)) {
          log.debug(`Skipping layer toggle for node ${nodeId}: no change in enabled layers`);
          toggle.checked = preview.enabled;
          return;
        }
        setState({ imagePreviews, imageOrder, enabledLayers: newEnabledLayers, isReversed, isSingleMode, stateVersion, nodeSize });
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
        let newEnabledLayers = enabledLayers;
        if (isSingleMode && imagePreviews.length) {
          const currentEnabledIndex = enabledLayers.indexOf(true);
          if (currentEnabledIndex >= 0 && currentEnabledIndex !== validatedImageOrder[0]) {
            newEnabledLayers = Array(imagePreviews.length).fill(false);
            newEnabledLayers[validatedImageOrder[0]] = true;
          }
        }
        if (JSON.stringify(validatedImageOrder) === JSON.stringify(imageOrder) && JSON.stringify(newEnabledLayers) === JSON.stringify(enabledLayers)) {
          log.debug(`Skipping sortable update for node ${nodeId}: no change`);
          return;
        }
        setState({ imagePreviews, imageOrder: validatedImageOrder, enabledLayers: newEnabledLayers, isReversed, isSingleMode, stateVersion, nodeSize });
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
    const {
      imagePreviews: newImagePreviews,
      imageOrder: newImageOrder,
      enabledLayers: newEnabledLayers,
      isReversed: newIsReversed,
      isSingleMode: newIsSingleMode,
      stateVersion: newStateVersion,
      nodeSize: newNodeSize
    } = newState;

    // Check if state has changed
    const stateChanged =
      JSON.stringify(imagePreviews) !== JSON.stringify(newImagePreviews) ||
      JSON.stringify(imageOrder) !== JSON.stringify(newImageOrder) ||
      JSON.stringify(enabledLayers) !== JSON.stringify(newEnabledLayers) ||
      isReversed !== newIsReversed ||
      isSingleMode !== newIsSingleMode ||
      JSON.stringify(nodeSize) !== JSON.stringify(newNodeSize);

    if (!stateChanged) {
      log.debug(`Skipping setState for node ${nodeId}: no state change`);
      return;
    }

    // Update state
    imagePreviews = newImagePreviews;
    imageOrder = newImageOrder;
    enabledLayers = newEnabledLayers;
    isReversed = newIsReversed;
    isSingleMode = newIsSingleMode;
    stateVersion = newStateVersion + 1; // Increment only on actual state change
    nodeSize = newNodeSize;

    // Update UI controls
    singleModeToggle.checked = isSingleMode;
    reverseToggle.checked = isReversed;
    updateContainerHeight(mainContainer, header, cardContainer, node.size, nodeId);
    updateState(node, { imagePreviews, imageOrder, enabledLayers, isReversed, isSingleMode, stateVersion, nodeSize }, statusText, debouncedUpdateCardList);
    log.debug(`Node ${nodeId}: setState updated, new stateVersion=${stateVersion}`);
  }

  // Initial UI update
  updateCardList();

  return { mainContainer, statusText, debouncedUpdateCardList, setState };
}

export { createImageManagerUI };