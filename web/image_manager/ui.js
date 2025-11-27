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

  async function fetchFullImage(preview) {
    const storageFilename = getStorageFilename(preview);
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
    const storageFilename = getStorageFilename(preview);
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

  function openImageEditor(preview) {
    let isSaving = false;
    const overlay = createElementWithClass("div", "xiser-image-editor-overlay");
    const cleanupListeners = [];
    const addListener = (target, event, handler) => {
      target.addEventListener(event, handler);
      cleanupListeners.push(() => target.removeEventListener(event, handler));
    };
    const panel = createElementWithClass("div", "xiser-image-editor-panel");
    const headerBar = createElementWithClass("div", "xiser-image-editor-panel-header");
    const title = createElementWithClass("div", "xiser-image-editor-title");
    title.innerText = `Edit ${preview.originalFilename || preview.filename}`;
    const closeButton = createElementWithClass("div", "xiser-image-editor-close");
    closeButton.innerHTML = "&times;";
    headerBar.appendChild(title);
    headerBar.appendChild(closeButton);
    const body = createElementWithClass("div", "xiser-image-editor-panel-body");
    const footer = createElementWithClass("div", "xiser-image-editor-footer");
    const info = createElementWithClass("div", "xiser-image-editor-info");
    info.innerText = "Loading original image...";
    body.appendChild(info);
    panel.appendChild(headerBar);
    panel.appendChild(body);
    panel.appendChild(footer);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    function closeEditor() {
      cleanupListeners.forEach(fn => {
        try { fn(); } catch (e) { /* ignore */ }
      });
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }

    addListener(closeButton, "click", closeEditor);
    addListener(overlay, "click", (e) => {
      if (e.target === overlay) closeEditor();
    });

    const saveButton = createElementWithClass("div", "xiser-image-editor-button xiser-image-editor-primary");
    saveButton.innerText = "Save Crop";
    const cancelButton = createElementWithClass("div", "xiser-image-editor-button");
    cancelButton.innerText = "Cancel";
    footer.appendChild(cancelButton);
    footer.appendChild(saveButton);

    addListener(cancelButton, "click", closeEditor);

    let cropState = null;
    let sizeLabel = null;

    function updateSaveState(enabled) {
      const allow = enabled && !isSaving && typeof cropState === "function";
      if (allow) {
        saveButton.classList.remove("disabled");
        saveButton.style.pointerEvents = "auto";
      } else {
        saveButton.classList.add("disabled");
        saveButton.style.pointerEvents = "none";
      }
    }
    updateSaveState(false);

    function renderCropper(imageUrl, naturalWidth, naturalHeight) {
      body.innerHTML = "";
      cropState = null;
      const metaBar = createElementWithClass("div", "xiser-image-editor-meta");
      metaBar.innerText = `Original: ${naturalWidth} x ${naturalHeight}`;
      sizeLabel = createElementWithClass("div", "xiser-image-editor-size");
      sizeLabel.innerText = `Crop: ${naturalWidth} x ${naturalHeight}`;

      // Crop box visibility toggle
      const toggleContainer = createElementWithClass("div", "xiser-image-editor-toggle-container");
      const toggleLabel = createElementWithClass("label", "xiser-image-editor-toggle-label");
      toggleLabel.innerText = "Show Crop Box";
      const cropToggle = createElementWithClass("input", "xiser-image-editor-toggle", {
        type: "checkbox",
        checked: true
      });
      cropToggle.checked = true;
      let showCropBox = true;

      addListener(cropToggle, "change", () => {
        showCropBox = cropToggle.checked;
        draw();
      });

      toggleContainer.appendChild(toggleLabel);
      toggleContainer.appendChild(cropToggle);
      metaBar.appendChild(toggleContainer);
      metaBar.appendChild(sizeLabel);
      const canvasShell = createElementWithClass("div", "xiser-image-editor-canvas-shell");
      const canvas = createElementWithClass("canvas", "xiser-image-editor-canvas");
      canvasShell.appendChild(canvas);
      body.appendChild(metaBar);
      body.appendChild(canvasShell);

      const img = new Image();
      img.src = imageUrl;
      const ctx = canvas.getContext("2d");
      const margin = 18;
      let scale = 1;
      let dragging = null;
      let startPoint = null;
      let crop = { x: naturalWidth / 4, y: naturalHeight / 4, width: naturalWidth / 2, height: naturalHeight / 2 };

      function setCrop(newCrop) {
        crop = {
          x: Math.max(0, Math.min(newCrop.x, naturalWidth - 1)),
          y: Math.max(0, Math.min(newCrop.y, naturalHeight - 1)),
          width: Math.max(1, Math.min(newCrop.width, naturalWidth)),
          height: Math.max(1, Math.min(newCrop.height, naturalHeight))
        };
        if (crop.x + crop.width > naturalWidth) crop.width = naturalWidth - crop.x;
        if (crop.y + crop.height > naturalHeight) crop.height = naturalHeight - crop.y;
        if (sizeLabel) {
          sizeLabel.innerText = `Crop: ${Math.round(crop.width)} x ${Math.round(crop.height)}`;
        }
        updateSaveState(crop.width >= 2 && crop.height >= 2 && !isSaving);
      }

      function draw() {
        if (!img.complete) return;
        const scaledWidth = Math.max(240, Math.round(naturalWidth * scale));
        const scaledHeight = Math.max(180, Math.round(naturalHeight * scale));
        if (canvas.width !== scaledWidth || canvas.height !== scaledHeight) {
          canvas.width = scaledWidth;
          canvas.height = scaledHeight;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        if (!crop.width || !crop.height) return;

        const left = crop.x * scale;
        const top = crop.y * scale;
        const w = crop.width * scale;
        const h = crop.height * scale;

        // Draw crop overlay (always visible for better UX)
        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = "destination-out";
        ctx.fillRect(left, top, w, h);
        ctx.restore();

        // Draw crop box and handles only when showCropBox is true
        if (showCropBox) {
          ctx.strokeStyle = "#1DA1F2";
          ctx.lineWidth = 2;
          ctx.strokeRect(left + 1, top + 1, w - 2, h - 2);
          const handleSize = Math.max(6, 8 * (scale > 1 ? scale : 1));
          const handles = [
            [left, top],
            [left + w, top],
            [left, top + h],
            [left + w, top + h]
          ];
          ctx.fillStyle = "#1DA1F2";
          handles.forEach(([hx, hy]) => {
            ctx.beginPath();
            ctx.arc(hx, hy, handleSize / 2, 0, Math.PI * 2);
            ctx.fill();
          });
        }
      }

      function toImageCoords(evt) {
        const rect = canvas.getBoundingClientRect();
        return {
          x: (evt.clientX - rect.left) / scale,
          y: (evt.clientY - rect.top) / scale
        };
      }

      function getHandle(pos) {
        if (!crop.width || !crop.height) return null;
        const threshold = 10 / scale;
        const left = crop.x;
        const right = crop.x + crop.width;
        const top = crop.y;
        const bottom = crop.y + crop.height;
        const nearLeft = Math.abs(pos.x - left) <= threshold;
        const nearRight = Math.abs(pos.x - right) <= threshold;
        const nearTop = Math.abs(pos.y - top) <= threshold;
        const nearBottom = Math.abs(pos.y - bottom) <= threshold;
        const inside = pos.x >= left && pos.x <= right && pos.y >= top && pos.y <= bottom;
        if (nearLeft && nearTop) return "nw";
        if (nearRight && nearTop) return "ne";
        if (nearLeft && nearBottom) return "sw";
        if (nearRight && nearBottom) return "se";
        if (nearTop) return "n";
        if (nearBottom) return "s";
        if (nearLeft) return "w";
        if (nearRight) return "e";
        if (inside) return "move";
        return null;
      }

      function applyDrag(pos) {
        if (!dragging) return;
        const minSize = 4;
        let { x, y, width, height } = crop;
        if (dragging === "new") {
          x = Math.min(startPoint.x, pos.x);
          y = Math.min(startPoint.y, pos.y);
          width = Math.max(minSize, Math.abs(pos.x - startPoint.x));
          height = Math.max(minSize, Math.abs(pos.y - startPoint.y));
        } else if (dragging === "move") {
          const dx = pos.x - startPoint.x;
          const dy = pos.y - startPoint.y;
          x += dx;
          y += dy;
          startPoint = pos;
        } else {
          const clampX = (nextX) => Math.max(0, Math.min(nextX, naturalWidth));
          const clampY = (nextY) => Math.max(0, Math.min(nextY, naturalHeight));
          if (dragging.includes("n")) {
            const newY = clampY(pos.y);
            height = height + (y - newY);
            y = newY;
          }
          if (dragging.includes("s")) {
            const bottom = clampY(pos.y);
            height = bottom - y;
          }
          if (dragging.includes("w")) {
            const newX = clampX(pos.x);
            width = width + (x - newX);
            x = newX;
          }
          if (dragging.includes("e")) {
            const rightEdge = clampX(pos.x);
            width = rightEdge - x;
          }
          width = Math.max(minSize, width);
          height = Math.max(minSize, height);
        }
        x = Math.max(0, Math.min(x, naturalWidth - width));
        y = Math.max(0, Math.min(y, naturalHeight - height));
        setCrop({ x, y, width, height });
        draw();
      }

      addListener(canvas, "mousedown", (evt) => {
        evt.preventDefault();
        const pos = toImageCoords(evt);
        const handle = getHandle(pos);
        dragging = handle || "new";
        startPoint = pos;
        if (dragging === "new") {
          setCrop({ x: pos.x, y: pos.y, width: 1, height: 1 });
          draw();
        }
      });

      const handleMove = (evt) => {
        if (!dragging) return;
        applyDrag(toImageCoords(evt));
      };
      const handleUp = () => {
        dragging = null;
      };
      addListener(window, "mousemove", handleMove);
      addListener(window, "mouseup", handleUp);

      img.onload = () => {
        const maxWidth = Math.min(window.innerWidth - margin * 2, 900);
        const maxHeight = Math.min(window.innerHeight - margin * 3, 620);
        scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight, 1);
        setCrop({ x: 0, y: 0, width: naturalWidth, height: naturalHeight });
        draw();
        cropState = () => {
          const cropCanvas = document.createElement("canvas");
          const w = Math.max(1, Math.round(crop.width));
          const h = Math.max(1, Math.round(crop.height));
          cropCanvas.width = w;
          cropCanvas.height = h;
          const cropCtx = cropCanvas.getContext("2d");
          cropCtx.drawImage(img, crop.x, crop.y, crop.width, crop.height, 0, 0, w, h);
          return {
            dataUrl: cropCanvas.toDataURL("image/png"),
            width: w,
            height: h
          };
        };
        updateSaveState(true);
      };
      img.onerror = () => {
        body.innerHTML = "";
        const errorText = createElementWithClass("div", "xiser-image-editor-info");
        errorText.innerText = "Unable to render image";
        body.appendChild(errorText);
        updateSaveState(false);
      };
    }

    fetchFullImage(preview)
      .then((data) => {
        renderCropper(data.dataUrl, data.width, data.height);
      })
      .catch((error) => {
        info.innerText = error.message || "Failed to load image";
        updateSaveState(false);
        log.error(`Node ${nodeId}: failed to open editor - ${error}`);
      });

    saveButton.addEventListener("click", async () => {
      if (!cropState || isSaving) return;
      const cropped = cropState();
      if (!cropped || !cropped.dataUrl) return;
      isSaving = true;
      updateSaveState(false);
      saveButton.innerText = "Saving...";
      try {
        const saved = await persistCrop(preview, cropped.dataUrl, cropped);
        const updatedPreviews = imagePreviews.map(p => {
          if (p.image_id !== preview.image_id) return p;
          const hashValue = saved.contentHash || saved.content_hash || p.contentHash || p.content_hash || null;
          return {
            ...p,
            preview: saved.preview || p.preview,
            width: saved.width,
            height: saved.height,
            storageFilename: saved.storageFilename,
            storage_filename: saved.storageFilename,
            contentHash: hashValue,
            content_hash: hashValue
          };
        });
        const updatedState = imageState.map(entry => {
          if (entry.id !== preview.image_id) return entry;
          const hashValue = saved.contentHash || saved.content_hash || entry.contentHash || entry.content_hash || null;
          return {
            ...entry,
            width: saved.width,
            height: saved.height,
            filename: entry.filename || preview.filename,
            originalFilename: entry.originalFilename || preview.originalFilename || preview.filename,
            contentHash: hashValue,
            content_hash: hashValue
          };
        });
        setState({ imagePreviews: updatedPreviews, imageState: updatedState });
        statusText.innerText = "Cropped image saved";
        statusText.style.color = "#2ECC71";
        closeEditor();
      } catch (error) {
        statusText.innerText = "Save failed";
        statusText.style.color = "#F55";
        saveButton.innerText = "Save Crop";
        isSaving = false;
        updateSaveState(true);
        log.error(`Node ${nodeId}: failed to save cropped image - ${error}`);
      }
    });
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

      const img = createElementWithClass("img", "xiser-image-manager-preview", {
        src: `data:image/png;base64,${preview.preview}`
      });
      img.onerror = () => {
        log.error(`Node ${nodeId}: Failed to load preview image for index ${preview.index}`);
        img.src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="; // Fallback image
      };
      const openEditor = (e) => {
        e.stopPropagation();
        openImageEditor(preview);
      };
      card.addEventListener("dblclick", openEditor);
      img.addEventListener("dblclick", openEditor);
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
