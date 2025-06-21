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
 * @param {number} initialState.stateVersion - State version number.
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
      const uploadedImages = await uploadImages(uploadInput.files, nodeId, node); // Pass node instance
      const existingFilenames = new Set(imagePreviews.map(p => p.filename));
      const newPreviews = uploadedImages
        .filter(img => !existingFilenames.has(img.filename))
        .map((img, i) => ({
          index: imagePreviews.length + i,
          preview: img.preview,
          width: img.width,
          height: img.height,
          filename: img.filename,
          originalFilename: img.originalFilename
        }));
      imagePreviews = [...imagePreviews, ...newPreviews];
      imageOrder = [...imageOrder, ...newPreviews.map(p => p.index)];
      enabledLayers = [...enabledLayers, ...Array(newPreviews.length).fill(true)];
      if (isSingleMode && imagePreviews.length) {
        const trueIndex = enabledLayers.indexOf(true);
        if (trueIndex < 0) {
          enabledLayers = Array(imagePreviews.length).fill(false);
          enabledLayers[imageOrder[0]] = true;
        }
      }
      setState({ imagePreviews, imageOrder, enabledLayers, isReversed, isSingleMode, stateVersion, nodeSize });
      statusText.innerText = `${imagePreviews.length} images`;
      statusText.style.color = "#2ECC71";
    } catch (error) {
      statusText.innerText = "Upload failed";
      statusText.style.color = "#F55";
      log.error(`Upload failed: ${error}`);
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
    isReversed = reverseToggle.checked;
    setState({ imagePreviews, imageOrder, enabledLayers, isReversed, isSingleMode, stateVersion, nodeSize });
    log.info(`Reverse toggled for node ${nodeId}: ${isReversed}`);
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
    if (JSON.stringify(newEnabledLayers) === JSON.stringify(enabledLayers) && newSingleMode === isSingleMode) {
      singleModeToggle.checked = isSingleMode;
      log.debug(`Skipping single mode toggle for node ${nodeId}: no change`);
      return;
    }
    isSingleMode = newSingleMode;
    enabledLayers = newEnabledLayers;
    setState({ imagePreviews, imageOrder, enabledLayers, isReversed, isSingleMode, stateVersion, nodeSize });
    log.info(`Single mode toggled for node ${nodeId}: ${isSingleMode}`);
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
    imageOrder = [...Array(imagePreviews.length).keys()];
    enabledLayers = Array(imagePreviews.length).fill(true);
    if (isSingleMode && imagePreviews.length) {
      const trueIndex = enabledLayers.indexOf(true);
      enabledLayers = Array(imagePreviews.length).fill(false);
      enabledLayers[trueIndex >= 0 ? trueIndex : 0] = true;
    }
    setState({ imagePreviews, imageOrder, enabledLayers, isReversed, isSingleMode, stateVersion, nodeSize });
    log.info(`Reset image order for node ${nodeId}: ${imageOrder}`);
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

    log.debug(`Updating card list for node ${nodeId}: ${imagePreviews.length} images, order=${imageOrder}, enabled=${enabledLayers}`);

    if (imagePreviews.length > 50) {
      statusText.innerText = "Too many images";
      statusText.style.color = "#FFA500";
    }

    imageOrder = validateImageOrder(imageOrder, imagePreviews);
    enabledLayers = enabledLayers.length === imagePreviews.length ? enabledLayers : Array(imagePreviews.length).fill(true);
    if (isSingleMode && imagePreviews.length) {
      const trueCount = enabledLayers.filter(x => x).length;
      if (trueCount !== 1) {
        log.warning(`Node ${nodeId}: Single mode enabled but ${trueCount} layers active, enabling first enabled layer`);
        const firstTrueIndex = enabledLayers.indexOf(true);
        enabledLayers = Array(imagePreviews.length).fill(false);
        enabledLayers[firstTrueIndex >= 0 ? firstTrueIndex : imageOrder[0]] = true;
      }
    }

    const orderedPreviews = imageOrder.map(idx => {
      const preview = imagePreviews.find(p => p.index === idx);
      if (!preview) {
        log.error(`No preview for index ${idx}`);
        return null;
      }
      return { ...preview, enabled: enabledLayers[idx] };
    }).filter(p => p);

    if (orderedPreviews.length !== imagePreviews.length) {
      log.error("Incomplete orderedPreviews, resetting");
      imageOrder = [...Array(imagePreviews.length).keys()];
      enabledLayers = Array(imagePreviews.length).fill(true);
      if (isSingleMode && imagePreviews.length) {
        enabledLayers = Array(imagePreviews.length).fill(false);
        enabledLayers[0] = true;
      }
      setState({ imagePreviews, imageOrder, enabledLayers, isReversed, isSingleMode, stateVersion, nodeSize });
      return;
    }

    const displayPreviews = isReversed ? [...orderedPreviews].reverse() : orderedPreviews;
    const enabledCount = enabledLayers.filter(x => x).length;
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
      if (imagePreviews.length === 0) {
        card.classList.add("disabled");
      }

      const img = createElementWithClass("img", "xiser-image-manager-preview", {
        src: `data:image/png;base64,${preview.preview}`
      });
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
              imagePreviews = imagePreviews
                .filter(p => p.index !== indexToRemove)
                .map((p, i) => ({ ...p, index: i }));
              imageOrder = imageOrder
                .filter(idx => idx !== indexToRemove)
                .map(idx => idx > indexToRemove ? idx - 1 : idx);
              enabledLayers = enabledLayers.filter((_, idx) => idx !== indexToRemove);
              if (isSingleMode && imagePreviews.length && enabledLayers.filter(x => x).length === 0) {
                enabledLayers = Array(imagePreviews.length).fill(false);
                enabledLayers[0] = true;
              }
              setState({ imagePreviews, imageOrder, enabledLayers, isReversed, isSingleMode, stateVersion, nodeSize });
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
        enabledLayers = newEnabledLayers;
        setState({ imagePreviews, imageOrder, enabledLayers, isReversed, isSingleMode, stateVersion, nodeSize });
        log.info(`Layer ${preview.index} enabled: ${toggle.checked}`);
      });
      buttonContainer.appendChild(toggle);
      card.appendChild(buttonContainer);

      cardContainer.appendChild(card);
    });

    updateContainerHeight(mainContainer, header, cardContainer, node.size, nodeId);

    if (imagePreviews.length > 1) {
      sortableInstance = initializeSortable(cardContainer, nodeId, (newDomOrder) => {
        imageOrder = isReversed ? newDomOrder.reverse() : newDomOrder;
        imageOrder = validateImageOrder(imageOrder, imagePreviews);
        if (isSingleMode && imagePreviews.length) {
          const currentEnabledIndex = enabledLayers.indexOf(true);
          if (currentEnabledIndex >= 0 && currentEnabledIndex !== imageOrder[0]) {
            enabledLayers = Array(imagePreviews.length).fill(false);
            enabledLayers[imageOrder[0]] = true;
          }
        }
        setState({ imagePreviews, imageOrder, enabledLayers, isReversed, isSingleMode, stateVersion, nodeSize });
        log.info(`Image order updated for node ${nodeId}: ${imageOrder}`);
      });
    }

    statusText.innerText = window.Sortable
      ? imagePreviews.length
        ? `${imagePreviews.length} images`
        : "No images"
      : "Sortable.js error";
    statusText.style.color = window.Sortable ? "#2ECC71" : "#F55";
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
   * @param {number} newState.stateVersion - State version number.
   * @param {number[]} newState.nodeSize - Node dimensions [width, height].
   */
  function setState(newState) {
    imagePreviews = newState.imagePreviews;
    imageOrder = newState.imageOrder;
    enabledLayers = newState.enabledLayers;
    isReversed = newState.isReversed;
    isSingleMode = newState.isSingleMode;
    stateVersion = newState.stateVersion;
    nodeSize = newState.nodeSize;
    singleModeToggle.checked = isSingleMode;
    reverseToggle.checked = isReversed;
    updateContainerHeight(mainContainer, header, cardContainer, node.size, nodeId);
    updateState(node, newState, statusText, debouncedUpdateCardList);
  }

  // Initial UI update
  updateCardList();

  return { mainContainer, statusText, debouncedUpdateCardList, setState };
}

export { createImageManagerUI };