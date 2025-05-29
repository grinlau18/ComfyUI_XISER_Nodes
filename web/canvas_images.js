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

  if (!imagePaths?.length) {
    log.info(`No image paths provided for node ${nodeId}`);
    statusText.innerText = "无图像数据";
    statusText.style.color = "#f00";
    return;
  }

  // Check for duplicate imagePaths
  const pathsHash = JSON.stringify(imagePaths);
  if (nodeState.lastImagePathsHash === pathsHash) {
    log.debug(`Skipping loadImages for node ${nodeId}: identical imagePaths`);
    return;
  }
  nodeState.lastImagePathsHash = pathsHash;

  if (nodeState.isLoading) {
    log.info(`LoadImages already in progress for node ${nodeId}, skipping`);
    return;
  }
  nodeState.isLoading = true;

  log.info(`Starting loadImages for node ${nodeId}, imagePaths: ${JSON.stringify(imagePaths)}, length: ${imagePaths.length}, current imageNodes: ${nodeState.imageNodes.length}`);

  nodeState.imageNodes.forEach(node => node.destroy());
  nodeState.imageNodes = [];
  nodeState.imageLayer.destroyChildren();
  nodeState.imageLayer.batchDraw();

  const borderWidth = node.properties.ui_config.border_width || 40;
  const boardWidth = node.properties.ui_config.board_width || 1024;
  const boardHeight = node.properties.ui_config.board_height || 1024;
  const autoSize = node.properties.ui_config.auto_size || "off";
  log.debug(`Auto_size state for node ${nodeId}: ${autoSize}`);

  nodeState.initialStates = imagePaths.map(() => ({
    x: borderWidth + boardWidth / 2,
    y: borderWidth + boardHeight / 2,
    scaleX: 1,
    scaleY: 1,
    rotation: 0
  }));
  states.forEach((state, i) => {
    if (i < nodeState.initialStates.length) nodeState.initialStates[i] = { ...nodeState.initialStates[i], ...state };
  });

  const images = imagePaths.map(path => ({ filename: path, subfolder: "xiser_canvas", type: "output", mime_type: "image/png" }));
  statusText.innerText = `加载图像... 0/${images.length}`;
  statusText.style.color = "#fff";

  let loadedCount = 0;
  let originalBoardWidth = boardWidth;
  let originalBoardHeight = boardHeight;

  for (let i = 0; i < images.length; i++) {
    const imgData = images[i];
    try {
      let img = imageCache.get(imgData.filename);
      if (!img) {
        img = new Image();
        const imgUrl = `/view?filename=${encodeURIComponent(imgData.filename)}&subfolder=${encodeURIComponent(imgData.subfolder || '')}&type=${imgData.type}&rand=${Math.random()}`;
        const response = await fetch(imgUrl, { method: 'HEAD' });
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        img.src = imgUrl;
        await new Promise((resolve, reject) => {
          img.onload = () => {
            imageCache.set(imgData.filename, img);
            loadedImageUrls.set(imgData.filename, imgUrl);
            resolve();
          };
          img.onerror = () => {
            log.error(`Failed to load image ${imgData.filename} for node ${nodeId}`);
            if (retryCount < maxRetries) setTimeout(() => loadImages(node, nodeState, [imgData.filename], [states[i]], statusText, uiElements, selectLayer, deselectLayer, updateSize, base64Chunks, retryCount + 1, maxRetries), 1000);
            resolve();
          };
        });
      }

      if (autoSize === "on" && i === 0) {
        originalBoardWidth = boardWidth;
        originalBoardHeight = boardHeight;
        node.properties.ui_config.board_width = Math.min(Math.max(parseInt(img.width), 256), 4096);
        node.properties.ui_config.board_height = Math.min(Math.max(parseInt(img.height), 256), 4096);
        statusText.innerText = `画板尺寸已调整为 ${node.properties.ui_config.board_width}x${node.properties.ui_config.board_height}`;
        statusText.style.color = "#0f0";
        if (typeof updateSize === 'function') {
          updateSize(node, nodeState);
          nodeState.stage.draw(); // Force full redraw
          log.debug(`updateSize called for auto_size in node ${nodeId}: ${node.properties.ui_config.board_width}x${node.properties.ui_config.board_height}`);
        } else {
          log.info(`updateSize is not a function for node ${nodeId}, skipping canvas size update`);
        }
      }

      const state = nodeState.initialStates[i] || {};
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
        filename: imgData.filename
      });
      nodeState.imageLayer.add(konvaImg);
      nodeState.imageNodes.push(konvaImg);
      nodeState.initialStates[i] = {
        x: konvaImg.x(),
        y: konvaImg.y(),
        scaleX: konvaImg.scaleX(),
        scaleY: konvaImg.scaleY(),
        rotation: konvaImg.rotation()
      };

      konvaImg.on("dragend transformend", () => {
        nodeState.initialStates[i] = {
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
      log.error(`Error loading image ${i+1} for node ${nodeId}`, e);
      statusText.innerText = `加载失败：${e.message}`;
      statusText.style.color = "#f00";
      continue;
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