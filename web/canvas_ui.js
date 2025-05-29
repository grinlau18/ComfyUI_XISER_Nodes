/**
 * @fileoverview Manages UI components for the XISER_Canvas node, including buttons, modal, layer panel, and CSS styles.
 * @module canvas_ui
 */

/**
 * Initializes UI components for the XISER_Canvas node.
 * @param {Object} node - The ComfyUI node instance.
 * @param {Object} nodeState - The node state object containing log and other properties.
 * @returns {Object} UI elements and related functions.
 */
export function initializeUI(node, nodeState) {
  const log = nodeState.log || console;

  /**
   * Creates and appends CSS styles for the UI components.
   * @private
   */
  function setupStyles() {
    const style = document.createElement("style");
    style.textContent = `
      .xiser-canvas-container {
        position: absolute;
        box-sizing: border-box;
        overflow: visible;
        z-index: 1000;
        pointer-events: none;
      }
      .xiser-canvas-stage {
        position: absolute;
        top: 0;
        left: 0;
        background: transparent;
        pointer-events: auto;
      }
      .xiser-main-container {
        position: absolute;
        display: block;
        background: transparent;
        overflow: visible;
        pointer-events: none;
        transform-origin: top left;
      }
      .xiser-status-text {
        position: absolute;
        top: 10px;
        left: 10px;
        color: #fff;
        background-color: rgba(0, 0, 0, 0.7);
        border-radius: 5px;
        padding: 5px;
        font-family: Arial, sans-serif;
        font-size: 12px;
        z-index: 10;
        pointer-events: none;
      }
      .xiser-button {
        position: absolute;
        top: 10px;
        color: #fff;
        padding: 6px 10px;
        font-family: Arial, sans-serif;
        font-size: 12px;
        border: none;
        cursor: pointer;
        z-index: 10;
        background-color: rgba(0, 0, 0, 0.75);
        border-radius: 5px;
        pointer-events: auto;
      }
      .xiser-button:hover {
        background-color: rgb(30, 121, 195);
      }
      .xiser-trigger-button { right: 80px; }
      .xiser-instruction-button { right: 10px; }
      .xiser-reset-button { right: 164px; }
      .xiser-undo-button { right: 320px; }
      .xiser-redo-button { right: 244px; }
      .xiser-layer-panel {
        position: absolute;
        top: 50px;
        left: 10px;
        background-color: rgba(0, 0, 0, 0.65);
        color: #fff;
        padding: 10px;
        font-family: Arial, sans-serif;
        font-size: 12px;
        z-index: 10;
        max-height: 200px;
        overflow-y: auto;
        border-radius: 5px;
        pointer-events: auto;
      }
      .xiser-layer-item {
        padding: 5px;
        cursor: pointer;
        border-bottom: 1px solid #444;
        pointer-events: auto;
      }
      .xiser-layer-item:hover {
        background-color: #555;
      }
      .xiser-layer-item.selected {
        background-color: rgb(30, 121, 195);
        color: #fff;
      }
      .xiser-modal {
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.5);
        z-index: 10000;
        justify-content: center;
        align-items: center;
        pointer-events: auto;
      }
      .xiser-modal-content {
        background-color: rgb(30, 35, 49);
        padding: 20px;
        border-radius: 5px;
        max-width: 500px;
        width: 90%;
        font-family: Arial, sans-serif;
        font-size: 14px;
        line-height: 1.5;
        color: #aaa;
        pointer-events: auto;
      }
      .xiser-modal-content h3 {
        margin-top: 0;
        font-size: 18px;
        color: #fff;
      }
      .xiser-modal-content ul {
        padding-left: 20px;
        margin: 10px 0;
      }
      .xiser-modal-content li {
        margin-bottom: 10px;
      }
    `;
    document.head.appendChild(style);
    log.debug(`UI styles initialized for node ${nodeState.nodeId}`);
  }

  /**
   * Creates the main container for the canvas UI.
   * @returns {HTMLDivElement} The main container element.
   */
  function createMainContainer() {
    const mainContainer = document.createElement("div");
    mainContainer.className = "xiser-main-container";
    mainContainer.dataset.nodeId = nodeState.nodeId;
    document.body.appendChild(mainContainer);
    return mainContainer;
  }

  /**
   * Creates the board container and status text.
   * @returns {Object} Container and status text elements.
   */
  function createBoardContainer() {
    const boardContainer = document.createElement("div");
    boardContainer.className = "xiser-canvas-container";
    const statusText = document.createElement("div");
    statusText.className = "xiser-status-text";
    statusText.innerText = "等待图像...";
    boardContainer.appendChild(statusText);
    return { boardContainer, statusText };
  }

  /**
   * Creates control buttons (Queue, Tips, Reset, Undo, Redo).
   * @returns {Object} Button elements.
   */
  function createButtons() {
    const triggerButton = document.createElement("button");
    triggerButton.className = "xiser-button xiser-trigger-button";
    triggerButton.innerText = "▶️ Queue";
    triggerButton.onclick = () => {
      log.info(`Queue button clicked for node ${nodeState.nodeId}`);
      nodeState.triggerPrompt();
    };

    const instructionButton = document.createElement("button");
    instructionButton.className = "xiser-button xiser-instruction-button";
    instructionButton.innerText = "ℹ️ Tips";
    instructionButton.onclick = () => {
      log.info(`Tips button clicked for node ${nodeState.nodeId}`);
      modal.style.display = "flex";
    };

    const resetButton = document.createElement("button");
    resetButton.className = "xiser-button xiser-reset-button";
    resetButton.innerText = "🔁 Reset";
    resetButton.onclick = () => {
      log.info(`Reset button clicked for node ${nodeState.nodeId}`);
      nodeState.resetCanvas();
    };

    const undoButton = document.createElement("button");
    undoButton.className = "xiser-button xiser-undo-button";
    undoButton.innerText = "↩️ Undo";
    undoButton.onclick = () => {
      log.info(`Undo button clicked for node ${nodeState.nodeId}`);
      nodeState.undo();
    };

    const redoButton = document.createElement("button");
    redoButton.className = "xiser-button xiser-redo-button";
    redoButton.innerText = "↪️ Redo";
    redoButton.onclick = () => {
      log.info(`Redo button clicked for node ${nodeState.nodeId}`);
      nodeState.redo();
    };

    return { triggerButton, instructionButton, resetButton, undoButton, redoButton };
  }

  /**
   * Creates the instruction modal.
   * @returns {Object} Modal and modal content elements.
   */
  function createModal() {
    const modal = document.createElement("div");
    modal.className = "xiser-modal";
    modal.id = `xiser-modal-${nodeState.nodeId}`;
    const modalContent = document.createElement("div");
    modalContent.className = "xiser-modal-content";
    modalContent.innerHTML = `
      <h3>操作方法</h3>
      <ul>
        <li>鼠标点击可选中图层，选中图层后可以自由移动，通过控制框可以缩放和旋转</li>
        <li>鼠标滚轮可以对选中图层进行缩放，Alt + 鼠标滚轮可以旋转图层</li>
        <li>通过左上角的图层面板可选择图层并置顶</li>
        <li>取消图层选择可恢复原始图层顺序</li>
        <li>打开"auto_size"开关后，画板会自动调整为第一张图的尺寸</li>
      </ul>
      <h3>Operation Method</h3>
      <ul>
        <li>Click to select a layer, then move, scale, or rotate it via the control box</li>
        <li>Mouse wheel scales the selected layer; Alt + wheel rotates it</li>
        <li>Use the layer panel in the top-left to select and bring layers to top</li>
        <li>Deselect a layer to restore original layer order</li>
        <li>Enable "auto_size" to adjust the canvas to the first image's size</li>
      </ul>
    `;
    modal.appendChild(modalContent);
    document.body.appendChild(modal);
    return { modal, modalContent };
  }

  /**
   * Creates the layer panel for managing image layers.
   * @returns {HTMLDivElement} The layer panel element.
   */
  function createLayerPanel() {
    const layerPanel = document.createElement("div");
    layerPanel.className = "xiser-layer-panel";
    return layerPanel;
  }

  /**
   * Updates the layer panel with current image nodes.
   * @param {Function} selectLayer - Callback to select a layer.
   * @param {Function} deselectLayer - Callback to deselect a layer.
   */
  function updateLayerPanel(selectLayer, deselectLayer) {
    log.debug(`Updating layer panel for node ${nodeState.nodeId}, imageNodes: ${nodeState.imageNodes?.length || 0}`);
    layerPanel.innerHTML = "";
    nodeState.layerItems = [];
    for (let index = nodeState.imageNodes.length - 1; index >= 0; index--) {
      const item = document.createElement("div");
      item.className = "xiser-layer-item";
      item.innerText = `Layer ${index + 1}`;
      item.dataset.index = index;
      layerPanel.appendChild(item);
      nodeState.layerItems.push(item);

      item.addEventListener("click", () => {
        log.info(`Layer item ${index} clicked for node ${nodeState.nodeId}`);
        const currentIndex = parseInt(item.dataset.index);
        if (currentIndex >= 0 && currentIndex < nodeState.imageNodes.length) {
          selectLayer(nodeState, currentIndex);
        } else {
          log.warn(`Invalid layer index ${currentIndex} for node ${nodeState.nodeId}`);
          deselectLayer(nodeState);
        }
      });
    }
    log.debug(`Layer panel updated for node ${nodeState.nodeId}, items: ${nodeState.layerItems.length}`);
  }

  // Initialize UI components
  setupStyles();
  const mainContainer = createMainContainer();
  const { boardContainer, statusText } = createBoardContainer();
  const { modal, modalContent } = createModal();
  const layerPanel = createLayerPanel();
  const buttons = createButtons();

  // Append elements
  boardContainer.appendChild(buttons.triggerButton);
  boardContainer.appendChild(buttons.instructionButton);
  boardContainer.appendChild(buttons.resetButton);
  boardContainer.appendChild(buttons.undoButton);
  boardContainer.appendChild(buttons.redoButton);
  boardContainer.appendChild(layerPanel);
  mainContainer.appendChild(boardContainer);

  // Modal close event
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      log.debug(`Modal closed for node ${nodeState.nodeId}`);
      modal.style.display = "none";
    }
  });

  // Add node-specific CSS class
  if (node.getHTMLElement) {
    const element = node.getHTMLElement();
    if (element) element.classList.add("xiser-node");
  }

  return {
    mainContainer,
    boardContainer,
    statusText,
    modal,
    layerPanel,
    buttons,
    updateLayerPanel
  };
}