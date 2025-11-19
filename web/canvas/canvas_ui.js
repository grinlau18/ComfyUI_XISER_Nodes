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
    instruction: 15, // Tips button
    reset: 113, // Reset button
    undo: 339, // Undo button
    redo: 229 // Redo button
  };

  // Auto-hide timeout for status text (ms)
  const STATUS_AUTO_HIDE_TIMEOUT = 3000;

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
        overflow: visible;
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
        bottom: 10px;
        left: 50%;
        transform: translateX(-50%);
        color: #fff;
        background-color: rgba(0, 0, 0, 0.7);
        border-radius: 5px;
        padding: 5px;
        font-size: 20px;
        z-index: 10;
        pointer-events: none;
        transition: opacity 0.3s ease;
      }
      .xiser-status-text-${nodeState.nodeId}.hidden {
        opacity: 0;
        pointer-events: none;
      }
      .xiser-button-group-${nodeState.nodeId} {
        position: absolute;
        top: 12px;
        right: 12px;
        display: flex;
        gap: 6px;
        pointer-events: auto;
        z-index: 15;
      }
      .xiser-button-${nodeState.nodeId} {
        color: #fff;
        width: 34px;
        height: 34px;
        border: none;
        cursor: pointer;
        background-color: rgba(0, 0, 0, 0.78);
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
      }
      .xiser-button-${nodeState.nodeId} svg {
        width: 20px;
        height: 20px;
      }
      .xiser-button-${nodeState.nodeId}:hover {
        background-color: rgb(30, 121, 195);
      }
      .xiser-layer-panel-${nodeState.nodeId} {
        position: absolute;
        top: 12px;
        left: 12px;
        background-color: rgba(0, 0, 0, 0.78);
        color: #fff;
        padding: 0px;
        font-size: 16px;
        z-index: 10;
        max-height: 320px;
        overflow: hidden;
        border-radius: 8px;
        pointer-events: auto;
        transition: max-height 0.3s ease, padding 0.3s ease, opacity 0.3s ease;
        display: flex;
        flex-direction: column;
      }
      .xiser-layer-panel-${nodeState.nodeId}.collapsed {
        padding: 0px;
        overflow: hidden;
        max-height: 34px;
      }
      .xiser-layer-panel-header-${nodeState.nodeId} {
        display: flex;
        justify-content: space-between;
        align-items: center;
        cursor: pointer;
        font-weight: normal;
        margin: 0;
        padding: 0px 12px;
        font-size: 16px;
        line-height: 1;
        color: #fff;
        height: 34px;
        box-sizing: border-box;
        flex-shrink: 0;
        position: sticky;
        top: 0;
        background-color: rgba(0, 0, 0, 0.78);
        z-index: 1;
      }
      .xiser-layer-panel-header-${nodeState.nodeId}:hover {
        background-color: rgb(30, 121, 195); /* 与按钮一致的悬停颜色 */
        border-radius: 5px; /* 与按钮一致的圆角 */
      }
      .xiser-layer-panel-content-${nodeState.nodeId} {
        transition: opacity 0.3s ease;
        margin-top: 0px;
        overflow-y: auto;
        flex: 1;
        max-height: calc(320px - 34px);
      }
      .xiser-layer-panel-${nodeState.nodeId}.collapsed .xiser-layer-panel-content-${nodeState.nodeId} {
        opacity: 0;
        pointer-events: none;
      }
      .xiser-layer-item-${nodeState.nodeId} {
        padding: 5px;
        cursor: pointer;
        border-bottom: 1px solid #444;
        pointer-events: auto;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
      }
      .xiser-layer-item-${nodeState.nodeId} .layer-controls {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .xiser-layer-item-${nodeState.nodeId} .layer-order-button {
        width: 18px;
        height: 16px;
        background: rgba(255,255,255,0.08);
        color: #fff;
        border: 1px solid #555;
        border-radius: 3px;
        padding: 0;
        cursor: pointer;
      }
      .xiser-layer-item-${nodeState.nodeId} .layer-order-button:hover {
        background: rgba(255,255,255,0.18);
      }
      .xiser-layer-item-${nodeState.nodeId} .layer-visibility {
        background: transparent;
        border: none;
        color: #fff;
        cursor: pointer;
        padding: 3px 4px;
        border-radius: 4px;
      }
      .xiser-layer-item-${nodeState.nodeId} .layer-visibility.off {
        opacity: 0.5;
      }
      .xiser-layer-item-${nodeState.nodeId} .layer-visibility:hover {
        background-color: rgba(255,255,255,0.12);
      }
      .xiser-layer-item-${nodeState.nodeId} .layer-name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .xiser-layer-item-${nodeState.nodeId} .layer-adjust-icon {
        cursor: pointer;
        opacity: 0.7;
        transition: opacity 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 2px;
        border-radius: 3px;
      }
      .xiser-layer-item-${nodeState.nodeId} .layer-adjust-icon:hover {
        opacity: 1;
        background-color: rgba(255, 255, 255, 0.1);
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
        max-height: 50vh;
        overflow-y: auto;
        font-size: 14px;
        line-height: 1.5;
        color: #aaa;
        pointer-events: auto;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
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
    if (!document.head.contains(style)) {
      document.head.appendChild(style);
    }
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
    return { boardContainer: container, statusText };
  }

  /**
   * Updates the status text with auto-hide functionality.
   * @param {string} text - The text to display.
   * @param {string} color - The text color (optional).
   */
  function updateStatusText(text, color) {
    statusText.innerText = text;
    statusText.style.color = color || '#fff';
    statusText.classList.remove('hidden');

    // Clear existing timeout
    if (nodeState.statusTimeoutId) {
      clearTimeout(nodeState.statusTimeoutId);
    }

    // Set new timeout to hide after 3 seconds
    nodeState.statusTimeoutId = setTimeout(() => {
      statusText.classList.add('hidden');
    }, STATUS_AUTO_HIDE_TIMEOUT);
  }

  /**
   * Creates control buttons (Tips, Reset, Undo, Redo).
   * @private
   * @returns {Object} Button elements.
   */
  function createButtons() {
    const createIconButton = (className, svgMarkup, label) => {
      const button = document.createElement('button');
      button.className = className;
      button.innerHTML = svgMarkup;
      button.setAttribute('aria-label', label);
      button.style.display = 'flex';
      button.style.alignItems = 'center';
      button.style.justifyContent = 'center';
      return button;
    };

    const instructionIcon = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip0_info)"><circle cx="12" cy="12" r="9" stroke="#fdfdfd" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></circle><rect x="12" y="8" width="0.01" height="0.01" stroke="#fdfdfd" stroke-width="3.75" stroke-linejoin="round"></rect><path d="M12 12V16" stroke="#fdfdfd" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path></g><defs><clipPath id="clip0_info"><rect width="24" height="24" fill="white"></rect></clipPath></defs></svg>`;
    const resetIcon = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11 2L13 3.99545L12.9408 4.05474M13 18.0001L11 19.9108L11.0297 19.9417M12.9408 4.05474L11 6M12.9408 4.05474C12.6323 4.01859 12.3183 4 12 4C7.58172 4 4 7.58172 4 12C4 14.5264 5.17107 16.7793 7 18.2454M17 5.75463C18.8289 7.22075 20 9.47362 20 12C20 16.4183 16.4183 20 12 20C11.6716 20 11.3477 19.9802 11.0297 19.9417M13 22.0001L11.0297 19.9417" stroke="#fdfdfd" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;
    const undoIcon = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g transform="scale(-1,1) translate(-24,0)"><path fill-rule="evenodd" clip-rule="evenodd" d="M13.2929 4.29289C13.6834 3.90237 14.3166 3.90237 14.7071 4.29289L18.7071 8.29289C19.0976 8.68342 19.0976 9.31658 18.7071 9.70711L14.7071 13.7071C14.3166 14.0976 13.6834 14.0976 13.2929 13.7071C12.9024 13.3166 12.9024 12.6834 13.2929 12.2929L15.5858 10H10.5C8.567 10 7 11.567 7 13.5C7 15.433 8.567 17 10.5 17H13C13.5523 17 14 17.4477 14 18C14 18.5523 13.5523 19 13 19H10.5C7.46243 19 5 16.5376 5 13.5C5 10.4624 7.46243 8 10.5 8H15.5858L13.2929 5.70711C12.9024 5.31658 12.9024 4.68342 13.2929 4.29289Z" fill="#fdfdfd"></path></g></svg>`;
    const redoIcon = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M13.2929 4.29289C13.6834 3.90237 14.3166 3.90237 14.7071 4.29289L18.7071 8.29289C19.0976 8.68342 19.0976 9.31658 18.7071 9.70711L14.7071 13.7071C14.3166 14.0976 13.6834 14.0976 13.2929 13.7071C12.9024 13.3166 12.9024 12.6834 13.2929 12.2929L15.5858 10H10.5C8.567 10 7 11.567 7 13.5C7 15.433 8.567 17 10.5 17H13C13.5523 17 14 17.4477 14 18C14 18.5523 13.5523 19 13 19H10.5C7.46243 19 5 16.5376 5 13.5C5 10.4624 7.46243 8 10.5 8H15.5858L13.2929 5.70711C12.9024 5.31658 12.9024 4.68342 13.2929 4.29289Z" fill="#fdfdfd"></path></svg>`;

    const instructionButton = createIconButton(`xiser-button-${nodeState.nodeId} xiser-instruction-button-${nodeState.nodeId}`, instructionIcon, 'Tips');
    instructionButton.onclick = () => {
      log.info(`Tips button clicked for node ${nodeState.nodeId}`);
      nodeState.modalVisible = true;
      modal.style.display = "flex";
    };

    const resetButton = createIconButton(`xiser-button-${nodeState.nodeId} xiser-reset-button-${nodeState.nodeId}`, resetIcon, 'Reset');
    resetButton.onclick = () => {
      log.info(`Reset button clicked for node ${nodeState.nodeId}`);
      nodeState.resetCanvas();
    };

    const undoButton = createIconButton(`xiser-button-${nodeState.nodeId} xiser-undo-button-${nodeState.nodeId}`, undoIcon, 'Undo');
    undoButton.onclick = () => {
      log.info(`Undo button clicked for node ${nodeState.nodeId}`);
      nodeState.undo();
    };

    const redoButton = createIconButton(`xiser-button-${nodeState.nodeId} xiser-redo-button-${nodeState.nodeId}`, redoIcon, 'Redo');
    redoButton.onclick = () => {
      log.info(`Redo button clicked for node ${nodeState.nodeId}`);
      nodeState.redo();
    };

    const group = document.createElement('div');
    group.className = `xiser-button-group-${nodeState.nodeId}`;
    group.append(undoButton, redoButton, resetButton, instructionButton);

    return { instructionButton, resetButton, undoButton, redoButton, buttonGroup: group };
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
      <h3>Canvas Operation Guide</h3>
      <ul>
        <li><strong>Layer Selection:</strong> Click on any image layer to select it. Selected layers can be moved, scaled, and rotated.</li>
        <li><strong>Transform Controls:</strong> Use the control box handles to scale and rotate selected layers independently.</li>
        <li><strong>Mouse Wheel Actions:</strong>
          <ul>
            <li>Mouse wheel: Scale the selected layer</li>
            <li>Alt + Mouse wheel: Rotate the selected layer</li>
          </ul>
        </li>
        <li><strong>Layer Management:</strong>
          <ul>
            <li>Use the layer panel to select and reorder layers</li>
            <li>Selected layers are automatically brought to the top</li>
            <li>Deselect layers to restore original stacking order</li>
          </ul>
        </li>
        <li><strong>Auto Size Feature:</strong> Enable "auto_size" to automatically adjust canvas dimensions to match the first image's size.</li>
        <li><strong>Display Scaling:</strong> Adjust "display_scale" to change canvas display size without affecting the actual output dimensions.</li>
        <li><strong>Image Adjustments:</strong>
          <ul>
            <li>Select a layer and click the floating adjustment icon at its center to open the panel.</li>
            <li>Brightness (-100% to +100%) shifts exposure; Contrast (-100 to +100) compresses or expands tones.</li>
            <li>Saturation (-100 to +100) matches backend output: -100 yields monochrome, 0 restores original color, +100 doubles color intensity.</li>
            <li>Reset button restores all three sliders to their defaults for the active layer.</li>
          </ul>
        </li>
        <li><strong>History & Undo:</strong> Use undo/redo buttons to navigate through layer transformation history.</li>
        <li><strong>Canvas Reset:</strong> Use the reset button to center all images and restore default states.</li>
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

    // Create header with toggle functionality (图标+文字样式)
    const header = document.createElement("div");
    header.className = `xiser-layer-panel-header-${nodeState.nodeId}`;
    header.innerHTML = `
      <span>🏞️ Layers</span>
      <span>&nbsp;▾</span>
    `;

    // Create content container
    const content = document.createElement("div");
    content.className = `xiser-layer-panel-content-${nodeState.nodeId}`;

    // Assemble panel
    layerPanel.appendChild(header);
    layerPanel.appendChild(content);

    // Toggle functionality
    header.addEventListener("click", () => {
      const isCollapsed = layerPanel.classList.contains("collapsed");
      if (isCollapsed) {
        layerPanel.classList.remove("collapsed");
        header.querySelector("span:last-child").innerHTML = "&nbsp;▾";
      } else {
        layerPanel.classList.add("collapsed");
        header.querySelector("span:last-child").innerHTML = "&nbsp;▸";
      }
    });

    // Start collapsed by default
    layerPanel.classList.add("collapsed");

    return layerPanel;
  }

  /**
   * Updates the layer panel with current image nodes, displaying layer names from file_data if available.
   * @param {Function} selectLayer - Callback to select a layer.
   * @param {Function} deselectLayer - Callback to deselect a layer.
   * @param {Object} actions - Extra actions for layer item controls.
   * @param {Function} actions.onToggleVisibility - Toggle visibility handler.
   * @param {Function} actions.onMoveLayer - Reorder handler.
   */
  function updateLayerPanel(selectLayer, deselectLayer, actions = {}) {
    const { onToggleVisibility, onMoveLayer } = actions;

    // Find the content container
    const content = layerPanel.querySelector(`.xiser-layer-panel-content-${nodeState.nodeId}`);
    if (!content) {
      log.error(`Layer panel content container not found for node ${nodeState.nodeId}`);
      return;
    }

    content.innerHTML = "";
    nodeState.layerItems = [];

    const layers = nodeState.file_data?.layers || [];

    const layerIds = Array.isArray(node?.properties?.ui_config?.layer_ids)
      ? node.properties.ui_config.layer_ids
      : [];

    // 按zIndex降序排列图层，列表最上方对应画板最上层
    const ordered = nodeState.imageNodes
      .map((node, idx) => ({ idx, node, zIndex: node ? node.zIndex() : idx }))
      .sort((a, b) => b.zIndex - a.zIndex);

    for (const { idx: originalIndex } of ordered) {
      const item = document.createElement("div");
      item.className = `xiser-layer-item-${nodeState.nodeId}`;
      let layerName = `Layer ${originalIndex + 1}`;
      const layerData = layers[originalIndex];
      const isVisible = nodeState.initialStates?.[originalIndex]?.visible !== false;
      const layerId = layerIds[originalIndex] || originalIndex.toString();

      if (layerData?.name) {
        try {
          let decodedName = layerData.name;
          if (decodedName.includes('\\u')) {
            // Modern replacement for deprecated escape/unescape functions
            decodedName = decodeURIComponent(JSON.parse('"' + layerData.name.replace(/"/g, '\\"') + '"'));
          }
          const chars = [...decodedName];
          layerName = chars.length > 8 ? chars.slice(0, 8).join('') + '...' : decodedName;
        } catch (e) {
          log.warn(`Failed to decode layer name at index ${originalIndex}: ${e.message}`);
          layerName = `Layer ${originalIndex + 1}`;
        }
      } else {
      }

      // 创建图层列表项内容
      item.innerHTML = `
        <div class="layer-controls">
          <button class="layer-order-button" data-dir="1" title="上移">▲</button>
          <button class="layer-order-button" data-dir="-1" title="下移">▼</button>
        </div>
        <span class="layer-name">${layerName}</span>
        <button class="layer-visibility ${isVisible ? 'on' : 'off'}" data-index="${originalIndex}" title="显示/隐藏">
          ${isVisible ? '👁' : '🚫'}
        </button>
        <span class="layer-adjust-icon" data-index="${originalIndex}">
          <svg viewBox="0 0 48 48" width="14" height="14" fill="#ffffff">
            <path d="M44,14H23.65c-0.826-2.327-3.043-4-5.65-4s-4.824,1.673-5.65,4H4v4h8.35c0.826,2.327,3.043,4,5.65,4s4.824-1.673,5.65-4H44 V14z"/>
            <path d="M44,30h-8.35c-0.826-2.327-3.043-4-5.65-4s-4.824,1.673-5.65,4H4v4h20.35c0.826,2.327,3.043,4,5.65,4s4.824-1.673,5.65-4 H44V30z"/>
          </svg>
        </span>
      `;
      item.dataset.index = originalIndex.toString();
      item.dataset.layerId = layerId;
      content.appendChild(item);
      nodeState.layerItems.push(item);

      // 显示/隐藏
      const visibilityBtn = item.querySelector('.layer-visibility');
      visibilityBtn?.addEventListener("click", (event) => {
        event.stopPropagation();
        if (typeof onToggleVisibility === 'function') {
          const currentVisible = nodeState.initialStates?.[originalIndex]?.visible !== false;
          onToggleVisibility(originalIndex, !currentVisible);
        }
      });

      // 上下移动
      const orderButtons = item.querySelectorAll('.layer-order-button');
      orderButtons?.forEach((btn) => {
        btn.addEventListener("click", (event) => {
          event.stopPropagation();
          if (typeof onMoveLayer === 'function') {
            const dir = parseInt(btn.dataset.dir, 10) || 0;
            onMoveLayer(originalIndex, dir);
          }
        });
      });

      // 图层名称点击事件 - 选择图层
      item.addEventListener("click", (event) => {
        // 如果点击的是调整图标，则不触发图层选择
        if (event.target.closest('.layer-adjust-icon')) {
          return;
        }
        log.info(`Layer item ${originalIndex} (${layerName}) clicked for node ${nodeState.nodeId}`);
        const targetIndex = parseInt(item.dataset.index, 10);
        if (targetIndex >= 0 && targetIndex < nodeState.imageNodes.length && nodeState.imageNodes[targetIndex]) {
          selectLayer(nodeState, targetIndex);
        } else {
          log.warn(`Invalid layer index ${targetIndex} for node ${nodeState.nodeId}`);
          deselectLayer(nodeState);
        }
      });

      // 调整图标点击事件 - 弹出调节面板
      const adjustIcon = item.querySelector('.layer-adjust-icon');
      adjustIcon.addEventListener("click", (event) => {
        event.stopPropagation(); // 阻止事件冒泡到图层项
        log.info(`Adjust icon clicked for layer ${originalIndex} (${layerName}) for node ${nodeState.nodeId}`);
        const currentIndex = parseInt(adjustIcon.dataset.index);

        // 首先选择该图层
        if (currentIndex >= 0 && currentIndex < nodeState.imageNodes.length && nodeState.imageNodes[currentIndex]) {
          selectLayer(nodeState, currentIndex);

          // 然后触发调节面板显示
          if (nodeState.adjustments && nodeState.adjustments.onLayerSelected) {
            nodeState.adjustments.onLayerSelected(currentIndex);
            // 手动触发调节面板显示
            if (nodeState.adjustments.showPanel) {
              nodeState.adjustments.showPanel();
            }
          }
        } else {
          log.warn(`Invalid layer index ${currentIndex} for adjustment panel`);
        }
      });
    }
  }

  /**
   * Maps display_scale from [0.1, 1.0] to [0.5, 0.9] range for UI elements.
   * This prevents UI elements from becoming too small or too large.
   * @param {number} displayScale - The original display scale factor.
   * @returns {number} The mapped scale factor for UI elements.
   */
  function mapDisplayScaleForUI(displayScale) {
    // Map from [0.1, 1.0] to [0.5, 0.9]
    const inputMin = 0.1;
    const inputMax = 1.0;
    const outputMin = 0.4;
    const outputMax = 0.7;

    // Clamp input to valid range
    const clampedScale = Math.max(inputMin, Math.min(inputMax, displayScale));

    // Linear mapping
    const mappedScale = outputMin + (clampedScale - inputMin) * (outputMax - outputMin) / (inputMax - inputMin);

    return mappedScale;
  }

  /**
   * Updates UI element scales based on display_scale.
   * @param {number} displayScale - The display scale factor (e.g., 1.5 for 150%).
   */
  function updateUIScale(displayScale) {
    // Use mapped scale for UI elements to prevent extreme sizes
    const uiScale = mapDisplayScaleForUI(displayScale);
    document.querySelectorAll(`style#xiser-styles-scale-${nodeState.nodeId}`).forEach(s => s.remove());
    const style = document.createElement("style");
    style.id = `xiser-styles-scale-${nodeState.nodeId}`;
    style.dataset.nodeId = nodeState.nodeId;
    style.textContent = `
      .xiser-status-text-${nodeState.nodeId} {
        bottom: ${10 * uiScale}px;
        border-radius: ${5 * uiScale}px;
        padding: ${5 * uiScale}px;
        font-size: ${20 * uiScale}px;
      }
      .xiser-layer-item-${nodeState.nodeId} {
        padding: 8px;
        margin-left: 8px;
        border-bottom: 1px solid #444;
      }
    `;
    document.head.appendChild(style);
  }

  // Initialize UI components
  const styleElement = setupStyles();
  const { boardContainer, statusText } = createBoardContainer(widgetContainer);
  const { modal } = createModal();
  const layerPanel = createLayerPanel();
  const buttons = createButtons();

  // Append UI elements
  boardContainer.appendChild(buttons.buttonGroup);
  boardContainer.appendChild(layerPanel);

  // Modal close event
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      nodeState.modalVisible = false;
      modal.style.display = "none";
    }
  });

  // Add node-specific CSS class
  node.addCustomCssClass?.("xiser-node");

  // Initialize scaling
  updateUIScale(node.properties?.ui_config?.display_scale || 0.75);


  return {
    widgetContainer,
    boardContainer,
    statusText,
    modal,
    layerPanel,
    buttons,
    updateLayerPanel,
    updateUIScale,
    updateStatusText,
    styleElement // Return style element for cleanup
  };
}
