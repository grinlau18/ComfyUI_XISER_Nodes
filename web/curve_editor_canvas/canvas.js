import { CANVAS_HEIGHT, CANVAS_WIDTH, log } from "./config.js";
import { updateDisplay } from "./display.js";
import {
  cleanupExistingElements,
  cleanupExistingWidgets,
  createControlPanel,
  createUIElements,
  initializeNodeState,
  registerDOMWidget
} from "./dom.js";
import {
  getEffectivePointCount,
  markBackgroundDirty,
  setupPointCountEventHandlers
} from "./point_count.js";

function initializeCanvas(node, canvas) {
  if (!node || !canvas || node.id === -1 || node._removed) {
    return;
  }

  if (!canvas || !canvas.getContext) {
    setTimeout(() => initializeCanvas(node, canvas), 100);
    return;
  }

  if (node._canvasInitialized) {
    return;
  }

  try {
    node._canvasInitialized = true;
    updateDisplay(node);

    const forceRedraw = () => {
      if (!node._removed && node.canvas) {
        const checkVisibility = () => {
          if (node.canvas && node.canvas.offsetParent !== null) {
            updateDisplay(node);
            if (node.setDirtyCanvas) {
              node.setDirtyCanvas(true, true);
            }
            setTimeout(() => {
              if (!node._removed && node.canvas) {
                updateDisplay(node);
              }
            }, 100);
          } else {
            setTimeout(checkVisibility, 50);
          }
        };
        checkVisibility();
      }
    };

    forceRedraw();
    setTimeout(forceRedraw, 100);
    setTimeout(forceRedraw, 300);

    if (node._curveState) {
      node._curveState.initialized = true;
    }
  } catch (error) {
    log.error(`Node ${node.id} canvas initialization error:`, error);
    if (node._curveState) {
      node._curveState.initialized = true;
    }
    node._canvasInitialized = true;
  }
}

function refreshPointCount(node, options = {}) {
  if (!node || node._removed) {
    return;
  }

  const { force = false } = options;
  const currentValue = getEffectivePointCount(node, { updateProperty: true });
  if (!force && node._lastEffectivePointCount === currentValue) {
    return;
  }

  node._lastEffectivePointCount = currentValue;
  node._cachedGrid = null;
  markBackgroundDirty(node);
  updateDisplay(node);
  if (node.setDirtyCanvas) {
    node.setDirtyCanvas(true, true);
  }
}

function setupCanvas(node) {
  if (!node || node.id === -1) {
    log.warning(`Invalid node or node.id: ${node?.id}`);
    return;
  }

  if (node._canvasSetupInProgress) {
    return;
  }

  node._canvasSetupInProgress = true;
  log.info(`Node ${node.id} starting setupCanvas`);

  try {
    cleanupExistingElements(node);
    cleanupExistingWidgets(node);
    initializeNodeState(node);

    const uiElements = createUIElements(node);
    if (!uiElements) {
      log.error(`Node ${node.id} failed to create UI elements`);
      return;
    }

    const { mainContainer, canvas } = uiElements;
    const controlPanel = createControlPanel(node);
    if (controlPanel) {
      mainContainer.appendChild(controlPanel);
    }

    registerDOMWidget(node, mainContainer, canvas);
    initializeCanvas(node, canvas);

    setupPointCountEventHandlers(node, (options = {}) => refreshPointCount(node, options));
    refreshPointCount(node, { force: true });
  } catch (error) {
    log.error(`Node ${node.id} setupCanvas error:`, error);
  } finally {
    node._canvasSetupInProgress = false;
  }
}

function updateCanvasSize(node) {
  if (!node?.canvas) return;
  node.canvas.width = CANVAS_WIDTH;
  node.canvas.height = CANVAS_HEIGHT;
  updateDisplay(node);
  setTimeout(() => updateDisplay(node), 100);
  log.info(`Node ${node.id} canvas size updated with forced redraw`);
}

export {
  initializeCanvas,
  refreshPointCount,
  setupCanvas,
  updateCanvasSize
};
