import { log, nodeDebounce } from "./config.js";
import { drawCurve } from "./render.js";

function updateDisplayInternal(node) {
  try {
    if (!node || node.id === -1 || node._removed) {
      log.warning(`Node ${node?.id || 'unknown'} is invalid or removed`);
      return;
    }

    if (node._updatingDisplay) {
      return;
    }

    node._updatingDisplay = true;

    if (!node.ctx || !node.canvas) {
      log.warning(`Node ${node.id} canvas or context not initialized, attempting to reinitialize`);
      const canvasEl = document.querySelector(`#curve-canvas-${node.id}`);
      if (canvasEl && canvasEl.getContext) {
        node.canvas = canvasEl;
        node.ctx = canvasEl.getContext('2d');
        log.info(`Node ${node.id} canvas reinitialized`);
      } else {
        log.warning(`Node ${node.id} canvas element not found or invalid`);
        node._updatingDisplay = false;
        return;
      }
    }

    if (node.canvas.width <= 0 || node.canvas.height <= 0) {
      log.warning(`Node ${node.id} canvas has invalid dimensions: ${node.canvas.width}x${node.canvas.height}`);
      node._updatingDisplay = false;
      return;
    }

    const now = Date.now();
    if (node._curveState && now - node._curveState.lastUpdateTime < 16) {
      node._updatingDisplay = false;
      return;
    }
    if (node._curveState) {
      node._curveState.lastUpdateTime = now;
    }

    drawCurve(node);
  } catch (error) {
    log.error(`Node ${node?.id || 'unknown'} error in updateDisplay:`, error);
  } finally {
    node._updatingDisplay = false;
  }
}

function updateDisplay(node) {
  nodeDebounce(node, () => updateDisplayInternal(node));
}

export {
  updateDisplay,
  updateDisplayInternal
};
