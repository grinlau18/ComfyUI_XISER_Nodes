/**
 * Image editor UI component for XIS_ImageManager.
 * Provides a modal interface for image editing operations.
 */

import { createElementWithClass, createButton } from './components.js';

/**
 * Create an image editor UI.
 * @param {Object} preview - Image preview data.
 * @param {Function} onSave - Save handler.
 * @param {Function} onClose - Close handler.
 * @param {Function} fetchFullImage - Function to fetch full image.
 * @param {Function} persistCrop - Function to save cropped image.
 * @returns {Object} Object with editor instance and cleanup function.
 */
export function createImageEditorUI(preview, onSave, onClose, fetchFullImage, persistCrop) {
  let isSaving = false;
  let cropState = null;
  let cleanupListeners = [];

  // Create overlay and panel
  const overlay = createElementWithClass('div', 'xiser-image-editor-overlay');
  const panel = createElementWithClass('div', 'xiser-image-editor-panel');

  // Header
  const headerBar = createElementWithClass('div', 'xiser-image-editor-panel-header');
  const title = createElementWithClass('div', 'xiser-image-editor-title');
  title.innerText = `Edit ${preview.originalFilename || preview.filename}`;
  const closeButton = createElementWithClass('div', 'xiser-image-editor-close');
  closeButton.innerHTML = '&times;';
  headerBar.appendChild(title);
  headerBar.appendChild(closeButton);

  // Body
  const body = createElementWithClass('div', 'xiser-image-editor-panel-body');
  const info = createElementWithClass('div', 'xiser-image-editor-info');
  info.innerText = 'Loading original image...';
  body.appendChild(info);

  // Footer
  const footer = createElementWithClass('div', 'xiser-image-editor-footer');
  const saveButton = createButton('Save Crop', handleSave, 'xiser-image-editor-primary');
  const cancelButton = createButton('Cancel', handleClose);
  footer.appendChild(cancelButton);
  footer.appendChild(saveButton);

  // Assemble panel
  panel.appendChild(headerBar);
  panel.appendChild(body);
  panel.appendChild(footer);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  // Event listeners
  const addListener = (target, event, handler) => {
    target.addEventListener(event, handler);
    cleanupListeners.push(() => target.removeEventListener(event, handler));
  };

  function handleClose() {
    cleanupListeners.forEach(fn => {
      try { fn(); } catch (e) { /* ignore */ }
    });
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    onClose();
  }

  async function handleSave() {
    if (!cropState || isSaving) return;

    const cropped = cropState();
    if (!cropped || !cropped.dataUrl) return;

    isSaving = true;
    updateSaveState(false);
    saveButton.innerText = 'Saving...';

    try {
      const saved = await persistCrop(preview, cropped.dataUrl, cropped);
      onSave(saved, preview);
      handleClose();
    } catch (error) {
      saveButton.innerText = 'Save Crop';
      isSaving = false;
      updateSaveState(true);
      console.error('Failed to save cropped image:', error);
    }
  }

  function updateSaveState(enabled) {
    const allow = enabled && !isSaving && typeof cropState === 'function';
    if (allow) {
      saveButton.classList.remove('disabled');
      saveButton.style.pointerEvents = 'auto';
    } else {
      saveButton.classList.add('disabled');
      saveButton.style.pointerEvents = 'none';
    }
  }

  // Add event listeners
  addListener(closeButton, 'click', handleClose);
  addListener(overlay, 'click', (e) => {
    if (e.target === overlay) handleClose();
  });

  // Initialize cropper
  fetchFullImage(preview)
    .then((data) => {
      renderCropper(data.dataUrl, data.width, data.height);
    })
    .catch((error) => {
      info.innerText = error.message || 'Failed to load image';
      updateSaveState(false);
    });

  function renderCropper(imageUrl, naturalWidth, naturalHeight) {
    body.innerHTML = '';
    cropState = null;

    const metaBar = createElementWithClass('div', 'xiser-image-editor-meta');
    metaBar.innerText = `Original: ${naturalWidth} x ${naturalHeight}`;

    const sizeLabel = createElementWithClass('div', 'xiser-image-editor-size');
    sizeLabel.innerText = `Crop: ${naturalWidth} x ${naturalHeight}`;

    // Crop box visibility toggle
    const toggleContainer = createElementWithClass('div', 'xiser-image-editor-toggle-container');
    const toggleLabel = createElementWithClass('label', 'xiser-image-editor-toggle-label');
    toggleLabel.innerText = 'Show Crop Box';
    const cropToggle = createElementWithClass('input', 'xiser-image-editor-toggle', {
      type: 'checkbox',
      checked: true
    });

    let showCropBox = true;
    addListener(cropToggle, 'change', () => {
      showCropBox = cropToggle.checked;
      draw();
    });

    toggleContainer.appendChild(toggleLabel);
    toggleContainer.appendChild(cropToggle);
    metaBar.appendChild(toggleContainer);
    metaBar.appendChild(sizeLabel);

    const canvasShell = createElementWithClass('div', 'xiser-image-editor-canvas-shell');
    const canvas = createElementWithClass('canvas', 'xiser-image-editor-canvas');
    canvasShell.appendChild(canvas);

    body.appendChild(metaBar);
    body.appendChild(canvasShell);

    const img = new Image();
    img.src = imageUrl;
    const ctx = canvas.getContext('2d');
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
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillRect(left, top, w, h);
      ctx.restore();

      // Draw crop box and handles only when showCropBox is true
      if (showCropBox) {
        ctx.strokeStyle = '#1DA1F2';
        ctx.lineWidth = 2;
        ctx.strokeRect(left + 1, top + 1, w - 2, h - 2);

        const handleSize = Math.max(6, 8 * (scale > 1 ? scale : 1));
        const handles = [
          [left, top],
          [left + w, top],
          [left, top + h],
          [left + w, top + h]
        ];

        ctx.fillStyle = '#1DA1F2';
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

      if (nearLeft && nearTop) return 'nw';
      if (nearRight && nearTop) return 'ne';
      if (nearLeft && nearBottom) return 'sw';
      if (nearRight && nearBottom) return 'se';
      if (nearTop) return 'n';
      if (nearBottom) return 's';
      if (nearLeft) return 'w';
      if (nearRight) return 'e';
      if (inside) return 'move';
      return null;
    }

    function applyDrag(pos) {
      if (!dragging) return;
      const minSize = 4;
      let { x, y, width, height } = crop;

      if (dragging === 'new') {
        x = Math.min(startPoint.x, pos.x);
        y = Math.min(startPoint.y, pos.y);
        width = Math.max(minSize, Math.abs(pos.x - startPoint.x));
        height = Math.max(minSize, Math.abs(pos.y - startPoint.y));
      } else if (dragging === 'move') {
        const dx = pos.x - startPoint.x;
        const dy = pos.y - startPoint.y;
        x += dx;
        y += dy;
        startPoint = pos;
      } else {
        const clampX = (nextX) => Math.max(0, Math.min(nextX, naturalWidth));
        const clampY = (nextY) => Math.max(0, Math.min(nextY, naturalHeight));

        if (dragging.includes('n')) {
          const newY = clampY(pos.y);
          height = height + (y - newY);
          y = newY;
        }
        if (dragging.includes('s')) {
          const bottom = clampY(pos.y);
          height = bottom - y;
        }
        if (dragging.includes('w')) {
          const newX = clampX(pos.x);
          width = width + (x - newX);
          x = newX;
        }
        if (dragging.includes('e')) {
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

    addListener(canvas, 'mousedown', (evt) => {
      evt.preventDefault();
      const pos = toImageCoords(evt);
      const handle = getHandle(pos);
      dragging = handle || 'new';
      startPoint = pos;

      if (dragging === 'new') {
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

    addListener(window, 'mousemove', handleMove);
    addListener(window, 'mouseup', handleUp);

    img.onload = () => {
      const maxWidth = Math.min(window.innerWidth - margin * 2, 900);
      const maxHeight = Math.min(window.innerHeight - margin * 3, 620);
      scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight, 1);
      setCrop({ x: 0, y: 0, width: naturalWidth, height: naturalHeight });
      draw();

      cropState = () => {
        const cropCanvas = document.createElement('canvas');
        const w = Math.max(1, Math.round(crop.width));
        const h = Math.max(1, Math.round(crop.height));
        cropCanvas.width = w;
        cropCanvas.height = h;
        const cropCtx = cropCanvas.getContext('2d');
        cropCtx.drawImage(img, crop.x, crop.y, crop.width, crop.height, 0, 0, w, h);
        return {
          dataUrl: cropCanvas.toDataURL('image/png'),
          width: w,
          height: h
        };
      };
      updateSaveState(true);
    };

    img.onerror = () => {
      body.innerHTML = '';
      const errorText = createElementWithClass('div', 'xiser-image-editor-info');
      errorText.innerText = 'Unable to render image';
      body.appendChild(errorText);
      updateSaveState(false);
    };
  }

  updateSaveState(false);

  return {
    close: handleClose,
    cleanup: () => {
      cleanupListeners.forEach(fn => {
        try { fn(); } catch (e) { /* ignore */ }
      });
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
  };
}