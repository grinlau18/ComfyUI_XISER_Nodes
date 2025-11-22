import { log } from "./config.js";
import { updateDisplay } from "./display.js";
import { findClosestSegment, snapToVerticalGrid } from "./curve_math.js";
import { stopPointCountPolling } from "./point_count.js";

function setupInputListeners(node) {
  if (!node || !node.canvas) {
    log.warning(`Node ${node?.id || 'unknown'} canvas not initialized`);
    return;
  }

  node._eventHandlers = {
    mousedown: (e) => onCanvasMouseDown(node, e),
    mousemove: (e) => onCanvasMouseMove(node, e),
    mouseup: () => onCanvasMouseUp(node),
    contextmenu: (e) => onCanvasRightClick(node, e),
    focus: () => {
      if (!node._removed) {
        updateDisplay(node);
      }
    },
    mouseenter: () => {
      if (!node._removed) {
        updateDisplay(node);
      }
    }
  };

  node.canvas.addEventListener("mousedown", node._eventHandlers.mousedown);
  node.canvas.addEventListener("mousemove", node._eventHandlers.mousemove);
  node.canvas.addEventListener("mouseup", node._eventHandlers.mouseup);
  node.canvas.addEventListener("contextmenu", node._eventHandlers.contextmenu);
  node.canvas.addEventListener("focus", node._eventHandlers.focus);
  node.canvas.addEventListener("mouseenter", node._eventHandlers.mouseenter);
  node.canvas.tabIndex = 0;
  node.canvas.style.outline = "none";

  if (typeof IntersectionObserver !== 'undefined') {
    node._intersectionObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !node._removed) {
          updateDisplay(node);
        }
      });
    }, { threshold: 0.1 });

    node._intersectionObserver.observe(node.canvas);
  }
}

function removeInputListeners(node) {
  if (!node || !node.canvas || !node._eventHandlers) {
    log.warning(`Node ${node?.id || 'unknown'} canvas not initialized or no event handlers, cannot remove listeners`);
    return;
  }

  node.canvas.removeEventListener("mousedown", node._eventHandlers.mousedown);
  node.canvas.removeEventListener("mousemove", node._eventHandlers.mousemove);
  node.canvas.removeEventListener("mouseup", node._eventHandlers.mouseup);
  node.canvas.removeEventListener("contextmenu", node._eventHandlers.contextmenu);
  node.canvas.removeEventListener("focus", node._eventHandlers.focus);
  node.canvas.removeEventListener("mouseenter", node._eventHandlers.mouseenter);

  if (node._intersectionObserver) {
    node._intersectionObserver.disconnect();
    node._intersectionObserver = null;
  }

  stopPointCountPolling(node);
  node._eventHandlers = null;
}

function onCanvasMouseDown(node, e) {
  if (e.button !== 0) return;
  if (!node || node.id === -1 || !node.canvas) {
    log.warning(`Node ${node?.id || 'unknown'} canvas not initialized`);
    return;
  }

  const rect = node.canvas.getBoundingClientRect();
  const padding = 30;
  const plotWidth = node.canvas.width - 2 * padding;
  const plotHeight = node.canvas.height - 2 * padding;
  const scaleX = node.canvas.width / rect.width;
  const scaleY = node.canvas.height / rect.height;
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  const pixelX = mouseX * scaleX;
  const pixelY = mouseY * scaleY;
  const x = Math.max(0, Math.min(1, (pixelX - padding) / plotWidth));
  const y = Math.max(0, Math.min(1, 1 - (pixelY - padding) / plotHeight));

  if (x < 0 || x > 1 || y < 0 || y > 1) return;

  node._curveState.draggingPoint = null;
  const selectionRadius = 15 / Math.min(plotWidth, plotHeight);
  for (let i = 0; i < node.properties.curve_points.length; i++) {
    const point = node.properties.curve_points[i];
    const dx = point.x - x;
    const dy = point.y - y;
    if (Math.sqrt(dx * dx + dy * dy) < selectionRadius) {
      node._curveState.draggingPoint = i;
      break;
    }
  }

  if (node._curveState.draggingPoint === null) {
    const interpolationAlgorithm = node.properties.interpolation_algorithm || "catmull_rom";
    const closestSegment = findClosestSegment(node.properties.curve_points, x, y, interpolationAlgorithm);
    if (closestSegment.index !== -1) {
      const newPoint = { x, y };
      node.properties.curve_points.splice(closestSegment.index + 1, 0, newPoint);
      node._curveState.draggingPoint = closestSegment.index + 1;
    }
  }

  updateDisplay(node);
  node.setDirtyCanvas(true, true);
  if (node.onWidgetChange) {
    node.onWidgetChange();
  }
}

function onCanvasMouseMove(node, e) {
  if (!node || node.id === -1 || node._curveState.draggingPoint === null || !node.canvas || !(e.buttons & 1)) return;

  const now = Date.now();
  if (node._lastMouseMoveTime && now - node._lastMouseMoveTime < 16) {
    return;
  }
  node._lastMouseMoveTime = now;

  const rect = node.canvas.getBoundingClientRect();
  const padding = 30;
  const plotWidth = node.canvas.width - 2 * padding;
  const plotHeight = node.canvas.height - 2 * padding;
  const scaleX = node.canvas.width / rect.width;
  const scaleY = node.canvas.height / rect.height;
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  const pixelX = mouseX * scaleX;
  const pixelY = mouseY * scaleY;
  let x = Math.max(0, Math.min(1, (pixelX - padding) / plotWidth));
  let y = Math.max(0, Math.min(1, 1 - (pixelY - padding) / plotHeight));

  const snapThreshold = 10 / Math.min(node.canvas.width, node.canvas.height);
  if (x < snapThreshold) x = 0;
  else if (x > 1 - snapThreshold) x = 1;
  if (y < snapThreshold) y = 0;
  else if (y > 1 - snapThreshold) y = 1;

  x = snapToVerticalGrid(node, x);
  x = Math.max(0, Math.min(1, x));
  y = Math.max(0, Math.min(1, y));

  if (node._curveState.draggingPoint < node.properties.curve_points.length) {
    const pointIndex = node._curveState.draggingPoint;

    if (pointIndex === 0 || pointIndex === node.properties.curve_points.length - 1) {
      node.properties.curve_points[pointIndex].y = y;
    } else {
      node.properties.curve_points[pointIndex].x = x;
      node.properties.curve_points[pointIndex].y = y;
      node.properties.curve_points.sort((a, b) => a.x - b.x);
      const draggedPoint = node.properties.curve_points.find(p =>
        Math.abs(p.x - x) < 0.001 && Math.abs(p.y - y) < 0.001
      );
      if (draggedPoint) {
        node._curveState.draggingPoint = node.properties.curve_points.indexOf(draggedPoint);
      }
    }

    updateDisplay(node);
    node.setDirtyCanvas(true, true);
    if (node.onWidgetChange) {
      node.onWidgetChange();
    }
  }
}

function onCanvasMouseUp(node) {
  if (node) {
    node._curveState.draggingPoint = null;
  }
}

function onCanvasRightClick(node, e) {
  e.preventDefault();
  if (!node || node.id === -1 || !node.canvas) return;

  const rect = node.canvas.getBoundingClientRect();
  const padding = 30;
  const plotWidth = node.canvas.width - 2 * padding;
  const plotHeight = node.canvas.height - 2 * padding;
  const scaleX = node.canvas.width / rect.width;
  const scaleY = node.canvas.height / rect.height;
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  const pixelX = mouseX * scaleX;
  const pixelY = mouseY * scaleY;
  const x = Math.max(0, Math.min(1, (pixelX - padding) / plotWidth));
  const y = Math.max(0, Math.min(1, 1 - (pixelY - padding) / plotHeight));

  const selectionRadius = 15 / Math.min(plotWidth, plotHeight);
  let pointIndex = -1;
  for (let i = 0; i < node.properties.curve_points.length; i++) {
    const point = node.properties.curve_points[i];
    const dx = point.x - x;
    const dy = point.y - y;
    if (Math.sqrt(dx * dx + dy * dy) < selectionRadius) {
      pointIndex = i;
      break;
    }
  }

  if (pointIndex !== -1 &&
      node.properties.curve_points.length > 2 &&
      pointIndex !== 0 &&
      pointIndex !== node.properties.curve_points.length - 1) {
    node.properties.curve_points.splice(pointIndex, 1);
    updateDisplay(node);
    node.setDirtyCanvas(true, true);
    if (node.onWidgetChange) {
      node.onWidgetChange();
    }
  }
}

export {
  onCanvasMouseDown,
  onCanvasMouseMove,
  onCanvasMouseUp,
  onCanvasRightClick,
  removeInputListeners,
  setupInputListeners
};
