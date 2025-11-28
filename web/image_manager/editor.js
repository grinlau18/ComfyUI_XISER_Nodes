/**
 * @fileoverview Image editor module for XIS_ImageManager node, providing crop and edit functionality.
 * @module xis_image_manager_editor
 */

import { log, createElementWithClass } from "./utils.js";

/**
 * Fetches the full resolution image for editing
 * @param {Object} preview - Image preview object
 * @param {string} nodeId - Node identifier
 * @returns {Promise<Object>} Full image data
 */
async function fetchFullImage(preview, nodeId) {
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

/**
 * Persists the cropped image to the server
 * @param {Object} preview - Original image preview
 * @param {string} dataUrl - Cropped image data URL
 * @param {Object} targetSize - Target dimensions
 * @param {string} nodeId - Node identifier
 * @returns {Promise<Object>} Saved image data
 */
async function persistCrop(preview, dataUrl, targetSize, nodeId) {
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

/**
 * Opens the image editor for a given preview
 * @param {Object} preview - Image preview object to edit
 * @param {Object} options - Editor options
 * @param {string} options.nodeId - Node identifier
 * @param {Function} options.updateState - Function to update parent state
 * @param {HTMLElement} options.statusText - Status text element
 * @param {Array} options.imagePreviews - Current image previews array
 * @param {Array} options.imageState - Current image state array
 * @returns {void}
 */
export function openImageEditor(preview, options) {
  const { nodeId, updateState, statusText, imagePreviews, imageState } = options;
  let isSaving = false;
  const overlay = createElementWithClass("div", "vscode-image-editor-overlay");
  const cleanupListeners = [];
  const addListener = (target, event, handler) => {
    target.addEventListener(event, handler);
    cleanupListeners.push(() => target.removeEventListener(event, handler));
  };
  const panel = createElementWithClass("div", "vscode-image-editor-panel");
  // 设置编辑器为页面90%大小
  panel.style.width = "90vw";
  panel.style.height = "90vh";
  panel.style.maxWidth = "none";
  panel.style.maxHeight = "none";

  const headerBar = createElementWithClass("div", "vscode-image-editor-header");
  const title = createElementWithClass("div", "vscode-image-editor-title");
  title.innerText = `Edit ${preview.originalFilename || preview.filename}`;
  const closeButton = createElementWithClass("div", "vscode-image-editor-close");
  closeButton.innerHTML = "&times;";
  headerBar.appendChild(title);
  headerBar.appendChild(closeButton);
  const body = createElementWithClass("div", "vscode-image-editor-body");
  const footer = createElementWithClass("div", "vscode-image-editor-footer");
  const info = createElementWithClass("div", "vscode-image-editor-info");
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

  const saveButton = createElementWithClass("div", "vscode-button vscode-button-primary");
  saveButton.innerText = "Save Crop";
  const cancelButton = createElementWithClass("div", "vscode-button vscode-button-secondary");
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
    const metaBar = createElementWithClass("div", "vscode-image-editor-meta");

    // 创建左侧信息容器
    const leftInfo = createElementWithClass("div", "vscode-image-editor-meta-left");
    leftInfo.innerText = `Original: ${naturalWidth} x ${naturalHeight}`;

    // 创建右侧容器，包含开关和裁剪尺寸
    const rightContainer = createElementWithClass("div", "vscode-image-editor-meta-right");

    // Crop box visibility toggle with ComfyUI style
    const toggleContainer = createElementWithClass("div", "comfyui-toggle-container");
    const cropToggle = createElementWithClass("input", "comfyui-toggle", {
      type: "checkbox",
      id: `crop-toggle-${nodeId}`,
      checked: true
    });
    cropToggle.checked = true;
    const toggleLabel = createElementWithClass("label", "comfyui-toggle-label");
    toggleLabel.setAttribute("for", `crop-toggle-${nodeId}`);
    toggleLabel.innerText = "Show Crop Box";
    let showCropBox = true;

    addListener(cropToggle, "change", () => {
      showCropBox = cropToggle.checked;
      draw();
    });

    toggleContainer.appendChild(cropToggle);
    toggleContainer.appendChild(toggleLabel);

    sizeLabel = createElementWithClass("div", "vscode-image-editor-size");
    sizeLabel.innerText = `Crop: ${naturalWidth} x ${naturalHeight}`;

    rightContainer.appendChild(toggleContainer);
    rightContainer.appendChild(sizeLabel);

    metaBar.appendChild(leftInfo);
    metaBar.appendChild(rightContainer);
    const canvasShell = createElementWithClass("div", "vscode-image-editor-canvas-shell");
    // 设置画布容器为自适应大小，支持滚动
    canvasShell.style.overflow = "hidden";
    canvasShell.style.position = "relative";

    const canvas = createElementWithClass("canvas", "vscode-image-editor-canvas");
    canvasShell.appendChild(canvas);
    body.appendChild(metaBar);
    body.appendChild(canvasShell);

    const img = new Image();
    img.src = imageUrl;
    const ctx = canvas.getContext("2d");
    const margin = 18;

    // 新的坐标系统架构：基于原始尺寸计算
    let actualWidth = 0;
    let actualHeight = 0;
    let displayScale = 1; // 显示缩放比例
    let userZoom = 1; // 用户缩放比例（鼠标滚轮）
    let canvasOffsetX = 0; // 画布偏移量（用于居中显示）
    let canvasOffsetY = 0;

    let dragging = null;
    let startPoint = null;
    let crop = { x: 0, y: 0, width: 1, height: 1 };

    function setCrop(newCrop) {
      // 确保浮点数精度并严格约束边界
      crop = {
        x: Math.max(0, Math.min(newCrop.x, actualWidth)),
        y: Math.max(0, Math.min(newCrop.y, actualHeight)),
        width: Math.max(1, Math.min(newCrop.width, actualWidth)),
        height: Math.max(1, Math.min(newCrop.height, actualHeight))
      };

      // 严格确保裁剪框不超出图像边界
      if (crop.x + crop.width > actualWidth) crop.width = Math.max(1, actualWidth - crop.x);
      if (crop.y + crop.height > actualHeight) crop.height = Math.max(1, actualHeight - crop.y);

      // 确保裁剪框坐标和尺寸是合理的浮点数
      crop.x = Math.max(0, Math.min(crop.x, actualWidth - 1));
      crop.y = Math.max(0, Math.min(crop.y, actualHeight - 1));
      crop.width = Math.max(1, Math.min(crop.width, actualWidth - crop.x));
      crop.height = Math.max(1, Math.min(crop.height, actualHeight - crop.y));

      // 调试信息
      if (dragging && dragging !== "move") {
        log.debug(`setCrop: finalCrop=(${crop.x.toFixed(1)},${crop.y.toFixed(1)},${crop.width.toFixed(1)},${crop.height.toFixed(1)})`);
      }

      if (sizeLabel) {
        sizeLabel.innerText = `Crop: ${Math.round(crop.width)} x ${Math.round(crop.height)}`;
      }
      updateSaveState(crop.width >= 2 && crop.height >= 2 && !isSaving);
    }

    function draw() {
      // 基于原始尺寸的绘制系统
      if (!actualWidth || !actualHeight) return;

      // 计算显示尺寸 - userZoom=1对应原始尺寸
      const displayWidth = Math.round(actualWidth * userZoom);
      const displayHeight = Math.round(actualHeight * userZoom);

      // 更新画布尺寸 - 画布大小等于显示尺寸
      if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
        canvas.width = displayWidth;
        canvas.height = displayHeight;
      }

      // 计算居中偏移量
      canvasOffsetX = (canvas.width - displayWidth) / 2;
      canvasOffsetY = (canvas.height - displayHeight) / 2;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 绘制图像（居中显示）
      ctx.drawImage(img, canvasOffsetX, canvasOffsetY, displayWidth, displayHeight);

      if (!crop.width || !crop.height) return;

      // 计算裁剪框在显示坐标中的位置
      const left = crop.x * userZoom + canvasOffsetX;
      const top = crop.y * userZoom + canvasOffsetY;
      const w = crop.width * userZoom;
      const h = crop.height * userZoom;

      // Only draw crop overlay when showCropBox is enabled
      if (showCropBox) {
        // Draw crop overlay with better visibility
        ctx.save();
        ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = "destination-out";
        ctx.fillRect(left, top, w, h);
        ctx.restore();

        // Draw crop box - fixed line width
        ctx.strokeStyle = "#007ACC";
        ctx.lineWidth = 2;
        ctx.strokeRect(left, top, w, h);

        // Draw corner handles - fixed size
        const handleSize = 8; // 固定控制点大小
        const handles = [
          [left, top],
          [left + w, top],
          [left, top + h],
          [left + w, top + h]
        ];
        ctx.fillStyle = "#007ACC";
        handles.forEach(([hx, hy]) => {
          ctx.beginPath();
          ctx.arc(hx, hy, handleSize / 2, 0, Math.PI * 2);
          ctx.fill();
        });

        // Draw edge handles for better interaction - fixed size
        const edgeHandles = [
          [left + w/2, top],      // top
          [left + w/2, top + h],  // bottom
          [left, top + h/2],      // left
          [left + w, top + h/2]   // right
        ];
        edgeHandles.forEach(([hx, hy]) => {
          ctx.beginPath();
          ctx.arc(hx, hy, handleSize / 2, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    }

    function toImageCoords(evt) {
      const rect = canvas.getBoundingClientRect();
      const rawX = (evt.clientX - rect.left);
      const rawY = (evt.clientY - rect.top);

      // 新的坐标转换：从显示坐标转换为原始图像坐标
      const displayX = (rawX - canvasOffsetX) / userZoom;
      const displayY = (rawY - canvasOffsetY) / userZoom;

      // 边界约束
      const clampedX = Math.max(0, Math.min(displayX, actualWidth));
      const clampedY = Math.max(0, Math.min(displayY, actualHeight));

      // 调试信息：坐标转换
      if (dragging) {
        log.debug(`Coordinate conversion: raw=(${rawX.toFixed(1)},${rawY.toFixed(1)}) -> display=(${displayX.toFixed(1)},${displayY.toFixed(1)}) -> image=(${clampedX.toFixed(1)},${clampedY.toFixed(1)}), userZoom=${userZoom.toFixed(3)}`);
      }

      return { x: clampedX, y: clampedY };
    }

    function getHandle(pos) {
      // 基于原始尺寸的控制点检测
      if (!crop.width || !crop.height || !actualWidth || !actualHeight) return null;

      // 使用固定阈值，控制点大小为8像素，转换为原始图像空间
      const threshold = 8 / userZoom; // 在原始图像空间中的阈值
      const left = crop.x;
      const right = crop.x + crop.width;
      const top = crop.y;
      const bottom = crop.y + crop.height;

      // 1. 首先检查角点（最高优先级）
      const nearLeft = Math.abs(pos.x - left) <= threshold;
      const nearRight = Math.abs(pos.x - right) <= threshold;
      const nearTop = Math.abs(pos.y - top) <= threshold;
      const nearBottom = Math.abs(pos.y - bottom) <= threshold;

      if (nearLeft && nearTop) return "nw";
      if (nearRight && nearTop) return "ne";
      if (nearLeft && nearBottom) return "sw";
      if (nearRight && nearBottom) return "se";

      // 2. 检查边缘中点
      const nearVerticalCenter = Math.abs(pos.y - (top + bottom) / 2) <= threshold;
      const nearHorizontalCenter = Math.abs(pos.x - (left + right) / 2) <= threshold;

      if (nearTop && nearHorizontalCenter) return "n";
      if (nearBottom && nearHorizontalCenter) return "s";
      if (nearLeft && nearVerticalCenter) return "w";
      if (nearRight && nearVerticalCenter) return "e";

      // 3. 检查是否在裁剪框内部（用于移动）
      const inside = pos.x >= left && pos.x <= right && pos.y >= top && pos.y <= bottom;
      if (inside) return "move";

      // 调试信息：检查控制点检测
      if (dragging) {
        log.debug(`Handle detection: pos=(${pos.x.toFixed(1)},${pos.y.toFixed(1)}), crop=(${left.toFixed(1)},${top.toFixed(1)},${right.toFixed(1)},${bottom.toFixed(1)}), threshold=${threshold.toFixed(2)}, handle=${inside ? 'move' : 'none'}`);
      }

      return null;
    }

    function applyDrag(pos) {
      // 统一使用实际图像尺寸进行拖拽操作
      if (!dragging || !actualWidth || !actualHeight) return;
      const minSize = 8;
      let { x, y, width, height } = crop;

      // 调试信息：拖拽操作开始
      if (dragging && dragging !== "move") {
        log.debug(`ApplyDrag start: dragging=${dragging}, startPoint=(${startPoint.x.toFixed(1)},${startPoint.y.toFixed(1)}), pos=(${pos.x.toFixed(1)},${pos.y.toFixed(1)}), currentCrop=(${x.toFixed(1)},${y.toFixed(1)},${width.toFixed(1)},${height.toFixed(1)})`);
      }

      // 边界约束函数 - 统一使用实际图像尺寸
      const clampX = (val) => Math.max(0, Math.min(val, actualWidth));
      const clampY = (val) => Math.max(0, Math.min(val, actualHeight));

      if (dragging === "new") {
        // 创建新裁剪框
        x = Math.min(startPoint.x, pos.x);
        y = Math.min(startPoint.y, pos.y);
        width = Math.max(minSize, Math.abs(pos.x - startPoint.x));
        height = Math.max(minSize, Math.abs(pos.y - startPoint.y));
      } else if (dragging === "move") {
        // 移动整个裁剪框
        const dx = pos.x - startPoint.x;
        const dy = pos.y - startPoint.y;
        x = clampX(x + dx);
        y = clampY(y + dy);
        startPoint = pos;
      } else {
        // 控制点调整大小
        switch (dragging) {
          case "n": // 上边缘中点 - 只能调整上边
            const newTop = clampY(pos.y);
            height = height + (y - newTop);
            y = newTop;
            break;
          case "s": // 下边缘中点 - 只能调整下边
            const newBottom = clampY(pos.y);
            height = newBottom - y;
            break;
          case "w": // 左边缘中点 - 只能调整左边
            const newLeft = clampX(pos.x);
            width = width + (x - newLeft);
            x = newLeft;
            break;
          case "e": // 右边缘中点 - 只能调整右边
            const newRight = clampX(pos.x);
            width = newRight - x;
            break;
          case "nw": // 左上角 - 可同时调整上边和左边
            const newTopLeftX = clampX(pos.x);
            const newTopLeftY = clampY(pos.y);
            width = width + (x - newTopLeftX);
            height = height + (y - newTopLeftY);
            x = newTopLeftX;
            y = newTopLeftY;
            break;
          case "ne": // 右上角 - 可同时调整上边和右边
            const newTopRightX = clampX(pos.x);
            const newTopRightY = clampY(pos.y);
            width = newTopRightX - x;
            height = height + (y - newTopRightY);
            y = newTopRightY;
            break;
          case "sw": // 左下角 - 可同时调整下边和左边
            const newBottomLeftX = clampX(pos.x);
            const newBottomLeftY = clampY(pos.y);
            width = width + (x - newBottomLeftX);
            height = newBottomLeftY - y;
            x = newBottomLeftX;
            break;
          case "se": // 右下角 - 可同时调整下边和右边
            const newBottomRightX = clampX(pos.x);
            const newBottomRightY = clampY(pos.y);
            width = newBottomRightX - x;
            height = newBottomRightY - y;
            break;
        }

        // 确保最小尺寸
        width = Math.max(minSize, width);
        height = Math.max(minSize, height);

        // 更新起始点以确保连续拖拽的准确性
        startPoint = pos;
      }

      // 确保裁剪框在图像边界内 - 统一使用实际图像尺寸
      x = clampX(x);
      y = clampY(y);
      width = Math.min(width, actualWidth - x);
      height = Math.min(height, actualHeight - y);

      // 调试信息：拖拽操作结束
      if (dragging && dragging !== "move") {
        log.debug(`ApplyDrag end: newCrop=(${x.toFixed(1)},${y.toFixed(1)},${width.toFixed(1)},${height.toFixed(1)})`);
      }

      setCrop({ x, y, width, height });
      draw();
    }

    addListener(canvas, "mousedown", (evt) => {
      evt.preventDefault();
      // 统一使用实际图像尺寸进行交互控制
      // 确保图像已完全加载且尺寸已初始化
      if (!actualWidth || !actualHeight || actualWidth === 0 || actualHeight === 0) {
        log.warning("Image not fully loaded, ignoring interaction");
        return;
      }

      const pos = toImageCoords(evt);
      const handle = getHandle(pos);

      // 只在裁剪框外才触发"new"模式
      if (!handle && (pos.x < crop.x || pos.x > crop.x + crop.width ||
          pos.y < crop.y || pos.y > crop.y + crop.height)) {
        dragging = "new";
        startPoint = pos;
        setCrop({ x: pos.x, y: pos.y, width: 1, height: 1 });
        draw();
      } else {
        // 在裁剪框内或控制点上，使用统一的交互模式
        dragging = handle || "move";
        startPoint = pos;
      }
    });

    const handleMove = (evt) => {
      // 统一使用实际图像尺寸进行移动交互
      if (!dragging || !actualWidth || !actualHeight) return;
      applyDrag(toImageCoords(evt));
    };
    const handleUp = () => {
      dragging = null;
    };
    addListener(window, "mousemove", handleMove);
    addListener(window, "mouseup", handleUp);

    // 添加鼠标滚轮缩放功能 - 绑定到整个canvasShell容器
    addListener(canvasShell, "wheel", (evt) => {
      evt.preventDefault();

      // 计算鼠标在原始图像坐标中的位置
      const rect = canvas.getBoundingClientRect();
      const mouseX = (evt.clientX - rect.left - canvasOffsetX) / userZoom;
      const mouseY = (evt.clientY - rect.top - canvasOffsetY) / userZoom;

      // 应用缩放，最大缩放不超过原始图像尺寸
      const zoomFactor = evt.deltaY > 0 ? 0.9 : 1.1;
      const maxZoom = 1; // 最大缩放为原始尺寸
      const newZoom = Math.max(0.1, Math.min(maxZoom, userZoom * zoomFactor));

      // 如果缩放比例没有变化，则跳过
      if (Math.abs(newZoom - userZoom) < 0.01) return;

      // 计算缩放后的鼠标位置
      const newMouseX = (evt.clientX - rect.left - canvasOffsetX) / newZoom;
      const newMouseY = (evt.clientY - rect.top - canvasOffsetY) / newZoom;

      // 计算偏移量以保持鼠标位置固定
      const deltaX = (newMouseX - mouseX) * newZoom;
      const deltaY = (newMouseY - mouseY) * newZoom;

      // 更新缩放比例和偏移量
      userZoom = newZoom;
      canvasOffsetX += deltaX;
      canvasOffsetY += deltaY;

      // 重绘
      draw();

      // 更新缩放信息
      if (sizeLabel) {
        const zoomPercent = Math.round(userZoom * 100);
        sizeLabel.innerText = `Crop: ${Math.round(crop.width)} x ${Math.round(crop.height)} | Zoom: ${zoomPercent}%`;
      }

      log.debug(`Mouse wheel zoom: userZoom=${userZoom.toFixed(2)}, zoomPercent=${Math.round(userZoom * 100)}%`);
    });

    img.onload = () => {
      // 使用实际加载的图像尺寸
      actualWidth = img.naturalWidth;
      actualHeight = img.naturalHeight;

      // 显示原始图像尺寸
      leftInfo.innerText = `Original: ${actualWidth} x ${actualHeight}`;

      // 计算初始显示缩放比例以适应canvasShell容器
      const canvasShellRect = canvasShell.getBoundingClientRect();
      const maxWidth = canvasShellRect.width - 24; // 减去padding
      const maxHeight = canvasShellRect.height - 24; // 减去padding
      displayScale = Math.min(maxWidth / actualWidth, maxHeight / actualHeight, 1);
      userZoom = displayScale; // 设置初始缩放为适应容器大小

      // 计算显示尺寸用于调试
      const displayWidth = Math.round(actualWidth * userZoom);
      const displayHeight = Math.round(actualHeight * userZoom);

      // 调试信息
      log.debug(`Image loaded: ${actualWidth}x${actualHeight}, displayScale=${displayScale.toFixed(3)}, userZoom=${userZoom.toFixed(3)}`);
      log.debug(`Canvas dimensions: ${canvas.width}x${canvas.height}, display dimensions: ${displayWidth}x${displayHeight}`);

      // 初始化裁剪框为居中且大小为图片尺寸的二分之一
      const defaultWidth = Math.max(1, Math.floor(actualWidth / 2));
      const defaultHeight = Math.max(1, Math.floor(actualHeight / 2));
      const defaultX = Math.max(0, Math.floor((actualWidth - defaultWidth) / 2));
      const defaultY = Math.max(0, Math.floor((actualHeight - defaultHeight) / 2));

      log.debug(`Default crop: center=(${defaultX},${defaultY}), size=${defaultWidth}x${defaultHeight}`);
      setCrop({ x: defaultX, y: defaultY, width: defaultWidth, height: defaultHeight });
      draw();

      // 设置裁剪状态函数 - 基于原始尺寸
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
      const errorText = createElementWithClass("div", "vscode-image-editor-info");
      errorText.innerText = "Unable to render image";
      body.appendChild(errorText);
      updateSaveState(false);
    };
  }

  fetchFullImage(preview, nodeId)
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
      const saved = await persistCrop(preview, cropped.dataUrl, cropped, nodeId);
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
      updateState({ imagePreviews: updatedPreviews, imageState: updatedState });
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