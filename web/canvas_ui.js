/**
 * @fileoverview Manages UI components for the XISER_Canvas node, including buttons, modal, layer panel, and CSS styles.
 * @module canvas_ui
 */

/**
 * Initializes UI components for the XISER_Canvas node.
 * @param {Object} node - The ComfyUI node instance.
 * @param {Object} nodeState - The node state object containing log and other properties.
 * @param {HTMLDivElement} widgetContainer - The container for the DOM widget.
 * @returns {Object} UI elements and related functions.
 */
export function initializeUI(node, nodeState, widgetContainer) {
  const log = nodeState.log || console;

  // Configurable button positions (px, at displayScale = 1)
  const BUTTON_POSITIONS = {
    trigger: 130, // Queue button
    instruction: 30, // Tips button
    reset: 254, // Reset button
    undo: 480, // Undo button
    redo: 370 // Redo button
  };

  /**
   * Creates and appends CSS styles for the UI components with node-specific scoping.
   * @private
   * @returns {HTMLStyleElement} The created style element.
   */
  function setupStyles() {
    const style = document.createElement("style");
    style.id = `xiser-styles-${nodeState.nodeId}`;
    style.dataset.nodeId = nodeState.nodeId; // Add identifier for cleanup
    style.textContent = `
      .xiser-canvas-container-${nodeState.nodeId} {
        position: relative;
        box-sizing: border-box;
        overflow: hidden;
        z-index: 10;
        pointer-events: none;
        display: block;
        background: transparent;
      }
      .xiser-canvas-stage-${nodeState.nodeId} {
        position: absolute;
        top: 0;
        left: 0;
        background: transparent;
        pointer-events: auto;
      }
      .xiser-status-text-${nodeState.nodeId} {
        position: absolute;
        top: 10px;
        left: 10px;
        color: #fff;
        background-color: rgba(0, 0, 0, 0.7);
        border-radius: 5px;
        padding: 5px;
        font-family: Arial, sans-serif;
        font-size: 20px;
        z-index: 10;
        pointer-events: none;
      }
      .xiser-button-${nodeState.nodeId} {
        position: absolute;
        top: 10px;
        color: #fff;
        padding: 6px 10px;
        font-family: Arial, sans-serif;
        font-size: 20px;
        border: none;
        cursor: pointer;
        z-index: 10;
        background-color: rgba(0, 0, 0, 0.75);
        border-radius: 5px;
        pointer-events: auto;
      }
      .xiser-button-${nodeState.nodeId}:hover {
        background-color: rgb(30, 121, 195);
      }
      .xiser-trigger-button-${nodeState.nodeId} { right: ${BUTTON_POSITIONS.trigger}px; }
      .xiser-instruction-button-${nodeState.nodeId} { right: ${BUTTON_POSITIONS.instruction}px; }
      .xiser-reset-button-${nodeState.nodeId} { right: ${BUTTON_POSITIONS.reset}px; }
      .xiser-undo-button-${nodeState.nodeId} { right: ${BUTTON_POSITIONS.undo}px; }
      .xiser-redo-button-${nodeState.nodeId} { right: ${BUTTON_POSITIONS.redo}px; }
      .xiser-layer-panel-${nodeState.nodeId} {
        position: absolute;
        top: 50px;
        left: 10px;
        background-color: rgba(0, 0, 0, 0.65);
        color: #fff;
        padding: 10px;
        font-family: Arial, sans-serif;
        font-size: 20px;
        z-index: 10;
        max-height: 200px;
        overflow-y: auto;
        border-radius: 5px;
        pointer-events: auto;
      }
      .xiser-layer-item-${nodeState.nodeId} {
        padding: 5px;
        cursor: pointer;
        border-bottom: 1px solid #444;
        pointer-events: auto;
      }
      .xiser-layer-item-${nodeState.nodeId}:hover {
        background-color: #555;
      }
      .xiser-layer-item-${nodeState.nodeId}.selected {
        background-color: rgb(30, 121, 195);
        color: #fff;
      }
      .xiser-modal-${nodeState.nodeId} {
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
      .xiser-modal-content-${nodeState.nodeId} {
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
      .xiser-modal-content-${nodeState.nodeId} h3 {
        margin-top: 0;
        font-size: 18px;
        color: #fff;
      }
      .xiser-modal-content-${nodeState.nodeId} ul {
        padding-left: 20px;
        margin: 10px 0;
      }
      .xiser-modal-content-${nodeState.nodeId} li {
        margin-bottom: 10px;
      }
    `;
    document.head.appendChild(style);
    log.debug(`UI styles initialized for node ${nodeState.nodeId}`);
    return style;
  }

  /**
   * Creates the board container and status text within the widget container.
   * @private
   * @param {HTMLDivElement} container - The container provided by addDOMWidget.
   * @returns {Object} Container and status text elements.
   */
  function createBoardContainer(container) {
    container.className = `xiser-canvas-container-${nodeState.nodeId}`;
    container.style.display = "block";
    const statusText = document.createElement("div");
    statusText.className = `xiser-status-text-${nodeState.nodeId}`;
    statusText.innerText = "等待图像...";
    container.appendChild(statusText);
    log.debug(`Board container created for node ${nodeState.nodeId}, display: ${container.style.display}`);
    return { boardContainer: container, statusText };
  }

  /**
   * Creates control buttons (Queue, Tips, Reset, Undo, Redo).
   * @private
   * @returns {Object} Button elements.
   */
  function createButtons() {
    const triggerButton = document.createElement("button");
    triggerButton.className = `xiser-button-${nodeState.nodeId} xiser-trigger-button-${nodeState.nodeId}`;
    triggerButton.innerText = "▶️ Queue";
    triggerButton.onclick = () => {
      log.info(`Queue button clicked for node ${nodeState.nodeId}`);
      nodeState.triggerPrompt();
    };

    const instructionButton = document.createElement("button");
    instructionButton.className = `xiser-button-${nodeState.nodeId} xiser-instruction-button-${nodeState.nodeId}`;
    instructionButton.innerText = "ℹ️ Tips";
    instructionButton.onclick = () => {
      log.info(`Tips button clicked for node ${nodeState.nodeId}`);
      nodeState.modalVisible = true;
      modal.style.display = "flex";
    };

    const resetButton = document.createElement("button");
    resetButton.className = `xiser-button-${nodeState.nodeId} xiser-reset-button-${nodeState.nodeId}`;
    resetButton.innerText = "🔁 Reset";
    resetButton.onclick = () => {
      log.info(`Reset button clicked for node ${nodeState.nodeId}`);
      nodeState.resetCanvas();
    };

    const undoButton = document.createElement("button");
    undoButton.className = `xiser-button-${nodeState.nodeId} xiser-undo-button-${nodeState.nodeId}`;
    undoButton.innerText = "↩️ Undo";
    undoButton.onclick = () => {
      log.info(`Undo button clicked for node ${nodeState.nodeId}`);
      nodeState.undo();
    };

    const redoButton = document.createElement("button");
    redoButton.className = `xiser-button-${nodeState.nodeId} xiser-redo-button-${nodeState.nodeId}`;
    redoButton.innerText = "↪️ Redo";
    redoButton.onclick = () => {
      log.info(`Redo button clicked for node ${nodeState.nodeId}`);
      nodeState.redo();
    };

    return { triggerButton, instructionButton, resetButton, undoButton, redoButton };
  }

  /**
   * Creates the instruction modal.
   * @private
   * @returns {Object} Modal and modal content elements.
   */
  function createModal() {
    const modal = document.createElement("div");
    modal.className = `xiser-modal-${nodeState.nodeId}`;
    modal.id = `xiser-modal-${nodeState.nodeId}`;
    const modalContent = document.createElement("div");
    modalContent.className = `xiser-modal-content-${nodeState.nodeId}`;
    modalContent.innerHTML = `
      <h3>操作方法</h3>
      <ul>
        <li>鼠标点击可选中图层，选中图层后可以自由移动，通过控制框可以缩放和旋转</li>
        <li>鼠标滚轮可以对选中图层进行缩放，Alt + 鼠标滚轮可以旋转图层</li>
        <li>通过左上角的图层面板可选择图层并置顶</li>
        <li>取消图层选择可恢复原始图层顺序</li>
        <li>打开"auto_size"开关后，画板会自动调整为第一张图的尺寸</li>
        <li>调整"display_scale"可改变画板显示大小，不影响实际输出尺寸</li>
      </ul>
      <h3>Operation Method</h3>
      <ul>
        <li>Click to select a layer, then move, scale, or rotate it via the control box</li>
        <li>Mouse wheel scales the selected layer; Alt + wheel rotates it</li>
        <li>Use the layer panel in the top-left to select and bring layers to top</li>
        <li>Deselect a layer to restore original layer order</li>
        <li>Enable "auto_size" to adjust the canvas to the first image's size</li>
        <li>Adjust "display_scale" to change the canvas display size without affecting output</li>
      </ul>
    `;
    modal.appendChild(modalContent);
    document.body.appendChild(modal);
    return { modal, modalContent };
  }

  /**
   * Creates the layer panel for managing image layers.
   * @private
   * @returns {HTMLDivElement} The layer panel element.
   */
  function createLayerPanel() {
    const layerPanel = document.createElement("div");
    layerPanel.className = `xiser-layer-panel-${nodeState.nodeId}`;
    return layerPanel;
  }

  /**
   * Updates the layer panel with current image nodes, displaying layer names from file_data if available.
   * @param {Function} selectLayer - Callback to select a layer.
   * @param {Function} deselectLayer - Callback to deselect a layer.
   */
  function updateLayerPanel(selectLayer, deselectLayer) {
    log.debug(`Updating layer panel for node ${nodeState.nodeId}, imageNodes: ${nodeState.imageNodes?.length || 0}`);
    log.debug(`file_data: ${JSON.stringify(nodeState.file_data)}`);
    layerPanel.innerHTML = "";
    nodeState.layerItems = [];

    const layers = nodeState.file_data?.layers || [];
    log.debug(`Layers from file_data: ${JSON.stringify(layers)}`);

    for (let index = 0; index < nodeState.imageNodes.length; index++) {
      const item = document.createElement("div");
      item.className = `xiser-layer-item-${nodeState.nodeId}`;
      const layerIndex = nodeState.imageNodes.length - 1 - index;
      let layerName = `Layer ${layerIndex + 1}`;
      const layerData = layers[layerIndex];

      if (layerData?.name) {
        try {
          let decodedName = layerData.name;
          if (decodedName.includes('\\u')) {
            decodedName = decodeURIComponent(escape(decodeURIComponent(unescape(layerData.name))));
          }
          const chars = [...decodedName];
          layerName = chars.length > 8 ? chars.slice(0, 8).join('') + '...' : decodedName;
          log.debug(`Layer ${layerIndex} name: ${layerName} (original: ${layerData.name})`);
        } catch (e) {
          log.warn(`Failed to decode layer name at index ${layerIndex}: ${e.message}`);
          layerName = `Layer ${layerIndex + 1}`;
        }
      } else {
        log.debug(`No name for layer at index ${layerIndex}, using default: ${layerName}`);
      }

      item.innerText = layerName;
      item.dataset.index = layerIndex.toString();
      layerPanel.appendChild(item);
      nodeState.layerItems.push(item);

      item.addEventListener("click", () => {
        log.info(`Layer item ${layerIndex} (${layerName}) clicked for node ${nodeState.nodeId}`);
        const currentIndex = parseInt(item.dataset.index);
        if (currentIndex >= 0 && currentIndex < nodeState.imageNodes.length && nodeState.imageNodes[currentIndex]) {
          selectLayer(nodeState, currentIndex);
        } else {
          log.warn(`Invalid layer index ${currentIndex} for node ${nodeState.nodeId}`);
          deselectLayer(nodeState);
        }
      });
    }
    log.debug(`Layer panel updated for node ${nodeState.nodeId}, items: ${nodeState.layerItems.length}`);
  }

  /**
   * Updates UI element scales based on display_scale.
   * @param {number} displayScale - The display scale factor (e.g., 1.5 for 150%).
   */
  function updateUIScale(displayScale) {
    document.querySelectorAll(`style#xiser-styles-scale-${nodeState.nodeId}`).forEach(s => s.remove());
    const style = document.createElement("style");
    style.id = `xiser-styles-scale-${nodeState.nodeId}`;
    style.dataset.nodeId = nodeState.nodeId;
    style.textContent = `
      .xiser-status-text-${nodeState.nodeId} {
        top: ${10 * displayScale}px;
        left: ${10 * displayScale}px;
        border-radius: ${5 * displayScale}px;
        padding: ${5 * displayScale}px;
        font-size: ${20 * displayScale}px;
      }
      .xiser-button-${nodeState.nodeId} {
        top: ${10 * displayScale}px;
        padding: ${6 * displayScale}px ${10 * displayScale}px;
        font-size: ${20 * displayScale}px;
        border-radius: ${5 * displayScale}px;
      }
      .xiser-trigger-button-${nodeState.nodeId} { right: ${BUTTON_POSITIONS.trigger * displayScale}px; }
      .xiser-instruction-button-${nodeState.nodeId} { right: ${BUTTON_POSITIONS.instruction * displayScale}px; }
      .xiser-reset-button-${nodeState.nodeId} { right: ${BUTTON_POSITIONS.reset * displayScale}px; }
      .xiser-undo-button-${nodeState.nodeId} { right: ${BUTTON_POSITIONS.undo * displayScale}px; }
      .xiser-redo-button-${nodeState.nodeId} { right: ${BUTTON_POSITIONS.redo * displayScale}px; }
      .xiser-layer-panel-${nodeState.nodeId} {
        top: ${50 * displayScale}px;
        left: ${10 * displayScale}px;
        padding: ${10 * displayScale}px;
        font-size: ${20 * displayScale}px;
        max-height: ${200 * displayScale}px;
        border-radius: ${5 * displayScale}px;
      }
      .xiser-layer-item-${nodeState.nodeId} {
        padding: ${5 * displayScale}px;
        border-bottom: ${1 * displayScale}px solid #444;
      }
    `;
    document.head.appendChild(style);
    log.debug(`UI elements scaled for node ${nodeState.nodeId} with displayScale: ${displayScale}`);
  }

  // Initialize UI components
  const styleElement = setupStyles();
  const { boardContainer, statusText } = createBoardContainer(widgetContainer);
  const { modal, modalContent } = createModal();
  const layerPanel = createLayerPanel();
  const buttons = createButtons();

  // Append UI elements
  boardContainer.appendChild(buttons.triggerButton);
  boardContainer.appendChild(buttons.instructionButton);
  boardContainer.appendChild(buttons.resetButton);
  boardContainer.appendChild(buttons.undoButton);
  boardContainer.appendChild(buttons.redoButton);
  boardContainer.appendChild(layerPanel);

  // Modal close event
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      log.debug(`Modal closed for node ${nodeState.nodeId}`);
      nodeState.modalVisible = false;
      modal.style.display = "none";
    }
  });

  // Add node-specific CSS class
  node.addCustomCssClass?.("xiser-node");

  // Initialize scaling
  updateUIScale(node.properties?.ui_config?.display_scale || 1);

  log.debug(`UI initialized for node ${nodeState.nodeId}, widgetContainer display: ${widgetContainer.style.display}`);

  return {
    widgetContainer,
    boardContainer,
    statusText,
    modal,
    layerPanel,
    buttons,
    updateLayerPanel,
    updateUIScale,
    styleElement // Return style element for cleanup
  };
}