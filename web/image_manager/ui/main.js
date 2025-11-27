/**
 * Main UI component for XIS_ImageManager node.
 * Handles the main interface and coordinates between components.
 */

import { createElementWithClass, createToggle, createButton, createImageCard, debounce } from './components.js';
import { createImageEditorUI } from './editor.js';

/**
 * Create the main image manager UI.
 * @param {Object} node - The node instance.
 * @param {string} nodeId - Node identifier.
 * @param {Object} initialState - Initial state object.
 * @param {Function} updateState - Function to update node state.
 * @param {Function} uploadImages - Function to handle image uploads.
 * @param {Function} deleteImage - Function to handle image deletion.
 * @returns {Object} UI components and functions.
 */
export function createImageManagerUI(node, nodeId, initialState, updateState, uploadImages, deleteImage) {
  let { imagePreviews, imageOrder, enabledLayers, isReversed, isSingleMode, stateVersion, nodeSize, imageState } = initialState;

  if (!Array.isArray(imagePreviews)) imagePreviews = [];
  if (!Array.isArray(imageState) || !imageState.length) {
    imageState = buildImageState(imagePreviews, imageOrder, enabledLayers);
  }

  // Create main container
  const mainContainer = createElementWithClass("div", `xiser-image-manager-container ${getNodeClass(nodeId)}`, {
    "data-nodeId": nodeId
  });

  mainContainer.style.position = "relative";
  mainContainer.style.top = "-190px";
  mainContainer.style.visibility = "hidden";
  mainContainer.style.width = "100%";
  mainContainer.style.height = "100%";
  mainContainer.style.overflow = "visible";

  // Prevent drag events
  mainContainer.addEventListener("dragover", (e) => {
    e.stopPropagation();
    e.preventDefault();
  });

  mainContainer.addEventListener("dragenter", (e) => {
    e.stopPropagation();
    e.preventDefault();
  });

  mainContainer.addEventListener("dragleave", (e) => {
    e.stopPropagation();
    e.preventDefault();
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

  // Upload functionality
  const uploadButton = createButton("Upload Images", () => uploadInput.click());
  const uploadInput = createElementWithClass("input", "", {
    type: "file",
    accept: "image/*",
    multiple: true,
    style: "display:none"
  });

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
      const newImageState = [...imageState, ...newPreviews.map(preview => ({
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
      }))];

      setState({ imagePreviews: newImagePreviews, imageState: newImageState });
      statusText.innerText = `${newImagePreviews.length} images`;
      statusText.style.color = "#2ECC71";
    } catch (error) {
      statusText.innerText = "Upload failed";
      statusText.style.color = "#F55";
      console.error(`Upload failed for node ${nodeId}:`, error);
    }

    uploadInput.value = "";
  });

  // Control toggles
  const reverseToggle = createToggle(isReversed, (checked) => {
    if (checked === isReversed) return;
    setState({ isReversed: checked });
  }, "Reverse");

  const singleModeToggle = createToggle(isSingleMode, (checked) => {
    if (checked === isSingleMode) return;
    setState({ isSingleMode: checked });
  }, "Single Mode");

  // Reset button
  const resetButton = createButton("Reset", () => {
    const defaultOrder = [...Array(imagePreviews.length).keys()];
    const defaultEnabled = Array(imagePreviews.length).fill(true);
    const resetState = buildImageState(imagePreviews, defaultOrder, defaultEnabled);
    if (areImageStatesEqual(imageState, resetState) && !isReversed) return;
    setState({ imageState: resetState, isReversed });
  });

  // Assemble header
  topRow.appendChild(statusText);
  topRow.appendChild(uploadButton);
  topRow.appendChild(uploadInput);

  toggleGroup.appendChild(reverseToggle);
  toggleGroup.appendChild(singleModeToggle);
  controlsContainer.appendChild(toggleGroup);
  controlsContainer.appendChild(resetButton);

  header.appendChild(topRow);
  header.appendChild(controlsContainer);

  // Image editor functionality
  async function openImageEditor(preview) {
    const editor = createImageEditorUI(
      preview,
      (savedData, originalPreview) => {
        // Handle saved crop
        const updatedPreviews = imagePreviews.map(p => {
          if (p.image_id !== originalPreview.image_id) return p;
          const hashValue = savedData.contentHash || savedData.content_hash || p.contentHash || p.content_hash || null;
          return {
            ...p,
            preview: savedData.preview || p.preview,
            width: savedData.width,
            height: savedData.height,
            storageFilename: savedData.storageFilename,
            storage_filename: savedData.storageFilename,
            contentHash: hashValue,
            content_hash: hashValue
          };
        });

        const updatedState = imageState.map(entry => {
          if (entry.id !== originalPreview.image_id) return entry;
          const hashValue = savedData.contentHash || savedData.content_hash || entry.contentHash || entry.content_hash || null;
          return {
            ...entry,
            width: savedData.width,
            height: savedData.height,
            filename: entry.filename || originalPreview.filename,
            originalFilename: entry.originalFilename || originalPreview.originalFilename || originalPreview.filename,
            contentHash: hashValue,
            content_hash: hashValue
          };
        });

        setState({ imagePreviews: updatedPreviews, imageState: updatedState });
        statusText.innerText = "Cropped image saved";
        statusText.style.color = "#2ECC71";
      },
      () => {
        // Editor closed
      },
      fetchFullImage,
      persistCrop
    );

    return editor;
  }

  async function fetchFullImage(preview) {
    const storageFilename = preview.storageFilename || preview.storage_filename || preview.filename;
    if (!storageFilename) {
      throw new Error("No storage filename available for this image");
    }

    const response = await fetch("/fetch_image/xis_image_manager", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        node_id: nodeId,
        filename: preview.filename,
        storage_filename: storageFilename
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "Failed to load original image");
    }

    const data = await response.json();
    if (data.error) throw new Error(data.error);

    return {
      dataUrl: `data:image/png;base64,${data.image}`,
      width: data.width,
      height: data.height,
      storageFilename
    };
  }

  async function persistCrop(preview, dataUrl, targetSize) {
    const storageFilename = preview.storageFilename || preview.storage_filename || preview.filename;
    const response = await fetch("/crop/xis_image_manager", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        node_id: nodeId,
        filename: preview.filename,
        storage_filename: storageFilename,
        image_id: preview.image_id,
        originalFilename: preview.originalFilename || preview.filename,
        image: dataUrl
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "Failed to save crop");
    }

    const data = await response.json();
    if (data.error) throw new Error(data.error);

    return {
      preview: data.preview,
      width: data.width || targetSize.width,
      height: data.height || targetSize.height,
      storageFilename: data.storage_filename || data.filename || storageFilename,
      contentHash: data.content_hash || data.contentHash || preview.contentHash || preview.content_hash || null
    };
  }

  function handleDeleteImage(preview) {
    // Create confirmation popup
    const popupContainer = document.querySelector(`.xiser-image-manager-popup-container.${getNodeClass(nodeId)}`) ||
      createElementWithClass("div", `xiser-image-manager-popup-container ${getNodeClass(nodeId)}`, {
        style: "z-index: 10001;"
      });

    if (!popupContainer.parentNode) {
      document.body.appendChild(popupContainer);
    }

    popupContainer.innerHTML = "";
    const popup = createElementWithClass("div", "xiser-image-manager-popup");
    popup.style.width = "200px";
    popup.style.minHeight = "100px";
    popup.style.zIndex = "10002";

    const message = createElementWithClass("div", "xiser-image-manager-popup-message");
    message.innerText = "Delete this image?";

    const buttonContainer = createElementWithClass("div", "xiser-image-manager-popup-buttons");
    const confirmButton = createButton("Confirm", async () => {
      try {
        await deleteImage(preview.filename, nodeId);
        const imageIdToRemove = preview.image_id;

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
        console.log(`Deleted uploaded image ${preview.filename} for node ${nodeId}`);
      } catch (error) {
        statusText.innerText = "Delete failed";
        statusText.style.color = "#F55";
        console.error(`Failed to delete image ${preview.filename}:`, error);
        popupContainer.innerHTML = "";
      }
    }, "xiser-image-manager-popup-confirm");

    const cancelButton = createButton("Cancel", () => {
      popupContainer.innerHTML = "";
    }, "xiser-image-manager-popup-cancel");

    buttonContainer.appendChild(confirmButton);
    buttonContainer.appendChild(cancelButton);
    popup.appendChild(message);
    popup.appendChild(buttonContainer);
    popupContainer.appendChild(popup);

    // Position popup (simplified)
    popup.style.left = "50%";
    popup.style.top = "50%";
    popup.style.transform = "translate(-50%, -50%)";
  }

  function handleToggleImage(preview, enabled) {
    if (!preview?.image_id) return;

    const updatedState = imageState.map(entry => {
      if (entry.id !== preview.image_id) {
        return isSingleMode && enabled
          ? { ...entry, enabled: false }
          : entry;
      }
      return { ...entry, enabled };
    });

    setState({ imageState: updatedState });
  }

  // State management functions (simplified - would need to import from original utils)
  function buildImageState(imagePreviews, imageOrder, enabledLayers) {
    // Simplified implementation
    return imagePreviews.map((preview, idx) => ({
      id: preview.image_id,
      enabled: enabledLayers[idx] !== false,
      source: preview.source,
      filename: preview.filename,
      originalFilename: preview.originalFilename,
      width: preview.width,
      height: preview.height,
      index: preview.index,
      contentHash: preview.content_hash || preview.contentHash || null,
      storageFilename: preview.storageFilename || preview.storage_filename || preview.filename
    }));
  }

  function reconcileStateWithPreviews(imagePreviews, imageState) {
    // Simplified implementation
    return imageState.filter(entry =>
      imagePreviews.some(preview => preview.image_id === entry.id)
    );
  }

  function areImageStatesEqual(state1, state2) {
    if (!Array.isArray(state1) || !Array.isArray(state2) || state1.length !== state2.length) {
      return false;
    }
    return state1.every((entry, idx) =>
      entry.id === state2[idx].id && entry.enabled === state2[idx].enabled
    );
  }

  function getNodeClass(nodeId) {
    return `node-${nodeId.replace(/[^a-zA-Z0-9]/g, '_')}`;
  }

  // Card list update function
  function updateCardList() {
    cardContainer.innerHTML = "";

    if (imagePreviews.length === 0) {
      statusText.innerText = "No images";
      statusText.style.color = "#F5F6F5";
      return;
    }

    const validatedImageOrder = imageOrder || [...Array(imagePreviews.length).keys()];
    const orderedPreviews = validatedImageOrder.map(idx => {
      const preview = imagePreviews.find(p => p.index === idx);
      return preview ? { ...preview, enabled: enabledLayers[idx] !== false } : null;
    }).filter(p => p);

    const displayPreviews = isReversed ? [...orderedPreviews].reverse() : orderedPreviews;

    displayPreviews.forEach(preview => {
      const card = createImageCard(
        preview,
        openImageEditor,
        handleDeleteImage,
        handleToggleImage,
        isSingleMode
      );
      cardContainer.appendChild(card);
    });

    statusText.innerText = `${imagePreviews.length} images`;
    statusText.style.color = "#2ECC71";
  }

  const debouncedUpdateCardList = debounce(updateCardList, 100);

  /**
   * Update the UI and node state.
   * @param {Object} newState - New state object.
   */
  function setState(newState) {
    // Simplified state update - would need more sophisticated logic
    imagePreviews = newState.imagePreviews ?? imagePreviews;
    imageState = newState.imageState ?? imageState;
    isReversed = newState.isReversed ?? isReversed;
    isSingleMode = newState.isSingleMode ?? isSingleMode;

    // Update UI
    reverseToggle.querySelector('input').checked = isReversed;
    singleModeToggle.querySelector('input').checked = isSingleMode;

    // Update card list
    debouncedUpdateCardList();

    // Update node state
    updateState(node, {
      imagePreviews,
      imageOrder: imageOrder || [...Array(imagePreviews.length).keys()],
      enabledLayers: enabledLayers || Array(imagePreviews.length).fill(true),
      imageState,
      isReversed,
      isSingleMode,
      stateVersion: (stateVersion || 0) + 1,
      nodeSize: nodeSize || [360, 360]
    }, statusText, debouncedUpdateCardList);
  }

  // Initial UI update
  updateCardList();

  return { mainContainer, statusText, debouncedUpdateCardList, setState };
}