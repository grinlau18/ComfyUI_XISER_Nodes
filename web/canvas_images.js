/**
 * @fileoverview Manages image loading and caching for the XISER_Canvas node.
 * @module canvas_images
 */

/**
 * Global caches for images and URLs, isolated by nodeId.
 * @type {Map<string, Map<string, HTMLImageElement>>}
 */
const globalImageCache = new Map();

/**
 * @type {Map<string, Map<string, string>>}
 */
const globalLoadedImageUrls = new Map();

/**
 * Loads images and initializes Konva image nodes.
 * @param {Object} node - The ComfyUI node instance.
 * @param {Object} nodeState - The node state object.
 * @param {string[]} imagePaths - Array of image file paths.
 * @param {Object[]} states - Array of layer states.
 * @param {HTMLElement} statusText - Status text element for UI feedback.
 * @param {Object} uiElements - UI elements including updateLayerPanel.
 * @param {Function} selectLayer - Callback to select a layer.
 * @param {Function} deselectLayer - Callback to deselect a layer.
 * @param {Function} [updateSize] - Callback to update canvas size.
 * @param {string[]} [base64Chunks=[]] - Array of base64 image chunks.
 * @param {number} [retryCount=0] - Current retry attempt.
 * @param {number} [maxRetries=3] - Maximum retry attempts.
 * @async
 * @throws {Error} If image loading fails critically.
 */
export async function loadImages(node, nodeState, imagePaths, states, statusText, uiElements, selectLayer, deselectLayer, updateSize, base64Chunks = [], retryCount = 0, maxRetries = 3) {
  const log = nodeState.log || console;
  const nodeId = nodeState.nodeId;

  if (!globalImageCache.has(nodeId)) globalImageCache.set(nodeId, new Map());
  if (!globalLoadedImageUrls.has(nodeId)) globalLoadedImageUrls.set(nodeId, new Map());

  const imageCache = globalImageCache.get(nodeId);
  const loadedImageUrls = globalLoadedImageUrls.get(nodeId);

  // Validate imagePaths
  if (!Array.isArray(imagePaths) || !imagePaths.length || imagePaths.every(path => !path || typeof path !== 'string')) {
    log.info(`No valid image paths provided for node ${nodeId}: ${JSON.stringify(imagePaths)}`);
    statusText.innerText = "无图像数据";
    statusText.style.color = "#f00";
    return;
  }

  // Filter valid image paths
  const validImagePaths = imagePaths.filter(path => typeof path === 'string' && path.trim().length > 0);
  if (validImagePaths.length === 0) {
    log.info(`No valid image paths after filtering for node ${nodeId}: ${JSON.stringify(imagePaths)}`);
    statusText.innerText = "无有效图像路径";
    statusText.style.color = "#f00";
    return;
  }

  // Log invalid paths for debugging
  const invalidPaths = imagePaths.filter(path => !validImagePaths.includes(path));
  if (invalidPaths.length) {
    log.warn(`Invalid image paths filtered out for node ${nodeId}: ${JSON.stringify(invalidPaths)}`);
  }

  // Clear cache for provided image paths
  validImagePaths.forEach((path) => {
    if (imageCache.has(path)) {
      log.debug(`Clearing cache for path ${path} in node ${nodeId}`);
      imageCache.delete(path);
      loadedImageUrls.delete(path);
    }
  });

  const autoSize = node.properties.ui_config.auto_size || "off";
  const pathsHash = JSON.stringify(validImagePaths);
  if (nodeState.lastImagePathsHash === pathsHash && autoSize !== "on") {
    log.debug(`Skipping loadImages for node ${nodeId}: identical imagePaths`);
    return;
  }
  nodeState.lastImagePathsHash = pathsHash;

  if (nodeState.isLoading) {
    log.info(`LoadImages already in progress for node ${nodeId}, skipping`);
    return;
  }
  nodeState.isLoading = true;

  log.info(`Starting loadImages for node ${nodeId}, imagePaths: ${JSON.stringify(validImagePaths)}, length: ${validImagePaths.length}, current imageNodes: ${nodeState.imageNodes.length}`);

  // Clear existing image nodes
  nodeState.imageNodes.forEach(node => node?.destroy());
  nodeState.imageNodes = new Array(validImagePaths.length).fill(null); // Initialize with nulls
  nodeState.imageLayer.destroyChildren();
  nodeState.imageLayer.batchDraw();

  const borderWidth = node.properties.ui_config.border_width || 40;
  let boardWidth = node.properties.ui_config.board_width || 1024;
  let boardHeight = node.properties.ui_config.board_height || 1024;

  // Handle auto_size with first image dimensions
  if (autoSize === "on" && validImagePaths.length) {
    log.debug(`Auto_size enabled for node ${nodeId}, will adjust based on first image`);
  }

  // Initialize states
  nodeState.initialStates = validImagePaths.map(() => ({
    x: borderWidth + boardWidth / 2,
    y: borderWidth + boardHeight / 2,
    scaleX: 1,
    scaleY: 1,
    rotation: 0
  }));
  states.forEach((state, i) => {
    if (i < nodeState.initialStates.length) nodeState.initialStates[i] = { ...nodeState.initialStates[i], ...state };
  });

  const images = validImagePaths.map(path => ({ filename: path, subfolder: "xiser_canvas", type: "output", mime_type: "image/png" }));
  statusText.innerText = `加载图像... 0/${images.length}`;
  statusText.style.color = "#fff";

  let loadedCount = 0;

  // Load images concurrently with Promise.allSettled
  const loadImagePromises = images.map((imgData, i) => {
    return new Promise((resolve) => {
      if (!imgData?.filename) {
        log.error(`Invalid imgData at index ${i} for node ${nodeId}: ${JSON.stringify(imgData)}`);
        resolve({ img: null, index: i, success: false });
        return;
      }

      let img = imageCache.get(imgData.filename);
      if (img) {
        resolve({ img, index: i, success: true });
        return;
      }

      img = new Image();
      const imgUrl = `/view?filename=${encodeURIComponent(imgData.filename)}&subfolder=${encodeURIComponent(imgData.subfolder || '')}&type=${imgData.type}&rand=${Math.random()}`;
      img.src = imgUrl;

      img.onload = () => {
        imageCache.set(imgData.filename, img);
        loadedImageUrls.set(imgData.filename, imgUrl);
        resolve({ img, index: i, success: true });
      };
      img.onerror = () => {
        log.error(`Failed to load image ${imgData.filename} for node ${nodeId}`);
        if (retryCount < maxRetries) {
          log.info(`Retrying image ${imgData.filename} for node ${nodeId}, attempt ${retryCount + 1}`);
          setTimeout(() => loadImages(node, nodeState, [imgData.filename], [states[i] || {}], statusText, uiElements, selectLayer, deselectLayer, updateSize, base64Chunks, retryCount + 1, maxRetries), 1000);
        }
        resolve({ img: null, index: i, success: false });
      };
    });
  });

  const results = await Promise.allSettled(loadImagePromises);

  for (const result of results) {
    if (result.status !== 'fulfilled') {
      log.error(`Promise rejected for image index ${result.reason?.index} in node ${nodeId}`);
      continue;
    }

    const { img, index, success } = result.value;
    if (!success || !img) {
      log.warn(`Image at index ${index} failed to load for node ${nodeId}`);
      continue;
    }

    try {
      // Handle auto_size for first image
      if (autoSize === "on" && index === 0) {
        const newBoardWidth = Math.min(Math.max(parseInt(img.width), 256), 8192);
        const newBoardHeight = Math.min(Math.max(parseInt(img.height), 256), 8192);
        log.info(`First image dimensions for node ${nodeId}: ${img.width}x${img.height}, adjusted to ${newBoardWidth}x${newBoardHeight}`);
        if (newBoardWidth !== boardWidth || newBoardHeight !== boardHeight) {
          node.properties.ui_config.board_width = newBoardWidth;
          node.properties.ui_config.board_height = newBoardHeight;
          boardWidth = newBoardWidth;
          boardHeight = newBoardHeight;
          node.widgets.find(w => w.name === "board_width").value = boardWidth;
          node.widgets.find(w => w.name === "board_height").value = boardHeight;
          statusText.innerText = `画板尺寸已调整为 ${boardWidth}x${boardHeight}`;
          statusText.style.color = "#0f0";
          log.info(`Auto-size enabled, adjusted canvas to ${boardWidth}x${newBoardHeight} from first image for node ${nodeId}`);

          // Update initial states with new dimensions
          nodeState.initialStates = validImagePaths.map(() => ({
            x: borderWidth + boardWidth / 2,
            y: borderWidth + boardHeight / 2,
            scaleX: 1,
            scaleY: 1,
            rotation: 0
          }));
          states.forEach((state, j) => {
            if (j < nodeState.initialStates.length) nodeState.initialStates[j] = { ...nodeState.initialStates[j], ...state };
          });
          node.properties.image_states = nodeState.initialStates;
          node.widgets.find(w => w.name === "image_states").value = JSON.stringify(nodeState.initialStates);
          node.setProperty("image_states", nodeState.initialStates);

          if (typeof updateSize === 'function') {
            updateSize();
            nodeState.stage.draw();
            log.debug(`updateSize called for auto_size in node ${nodeId}: ${boardWidth}x${boardHeight}`);
          } else {
            log.warn(`updateSize is not a function for node ${nodeId}, skipping canvas size update`);
          }
        }
      }

      const state = nodeState.initialStates[index] || {};
      const konvaImg = new Konva.Image({
        image: img,
        x: state.x || borderWidth + boardWidth / 2,
        y: state.y || borderWidth + boardHeight / 2,
        scaleX: state.scaleX || 1,
        scaleY: state.scaleY || 1,
        rotation: state.rotation || 0,
        draggable: true,
        offsetX: img.width / 2,
        offsetY: img.height / 2,
        filename: images[index].filename
      });
      nodeState.imageLayer.add(konvaImg);
      nodeState.imageNodes[index] = konvaImg;
      nodeState.initialStates[index] = {
        x: konvaImg.x(),
        y: konvaImg.y(),
        scaleX: konvaImg.scaleX(),
        scaleY: konvaImg.scaleY(),
        rotation: konvaImg.rotation()
      };

      konvaImg.on("dragend transformend", () => {
        nodeState.initialStates[index] = {
          x: konvaImg.x(),
          y: konvaImg.y(),
          scaleX: konvaImg.scaleX(),
          scaleY: konvaImg.scaleY(),
          rotation: konvaImg.rotation()
        };
        node.properties.image_states = nodeState.initialStates;
        node.widgets.find(w => w.name === "image_states").value = JSON.stringify(nodeState.initialStates);
        node.setProperty("image_states", nodeState.initialStates);
        nodeState.imageLayer.batchDraw();
        debounceSaveHistory(nodeState);
      });

      loadedCount++;
      statusText.innerText = `加载图像... ${loadedCount}/${images.length}`;
    } catch (e) {
      log.error(`Error processing image ${index+1} for node ${nodeId}: ${e.message}, path: ${images[index]?.filename || 'unknown'}`);
      statusText.innerText = `加载失败：${e.message}`;
      statusText.style.color = "#f00";
      nodeState.imageNodes[index] = null; // Mark failed image
    }
  }

  nodeState.defaultLayerOrder = [...nodeState.imageNodes];
  uiElements.updateLayerPanel(selectLayer, deselectLayer);
  nodeState.transformer = new Konva.Transformer({
    nodes: [],
    keepRatio: true,
    enabledAnchors: ["top-left", "top-right", "bottom-left", "bottom-right"],
    rotateEnabled: true
  });
  nodeState.imageLayer.add(nodeState.transformer);
  nodeState.imageLayer.batchDraw();
  nodeState.stage.batchDraw();

  if (loadedCount === 0) {
    statusText.innerText = "无法加载任何图像，请检查上游节点";
    statusText.style.color = "#f00";
  } else {
    statusText.innerText = `已加载 ${loadedCount} 张图像`;
    statusText.style.color = "#0f0";
  }
  saveHistory(nodeState);
  log.info(`Finished loadImages for node ${nodeId}, imageNodes: ${nodeState.imageNodes.length}, initialStates: ${nodeState.initialStates.length}`);
  nodeState.isLoading = false;
}

/**
 * Debounces history saving.
 * @param {Object} nodeState - The node state object.
 */
function debounceSaveHistory(nodeState) {
  if (nodeState.historyDebounceTimeout) clearTimeout(nodeState.historyDebounceTimeout);
  nodeState.historyDebounceTimeout = setTimeout(() => {
    saveHistory(nodeState);
    nodeState.historyDebounceTimeout = null;
  }, 300);
}

/**
 * Saves the current state to history.
 * @param {Object} nodeState - The node state object.
 */
function saveHistory(nodeState) {
  const currentState = nodeState.initialStates.map(state => ({ ...state }));
  nodeState.history.splice(nodeState.historyIndex + 1);
  nodeState.history.push(currentState);
  nodeState.historyIndex++;
  if (nodeState.history.length > 20) {
    nodeState.history.shift();
    nodeState.historyIndex--;
  }
}