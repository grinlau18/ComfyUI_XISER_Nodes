import { app } from "/scripts/app.js";
import {
  DEFAULT_POINT_COUNT,
  POINT_COUNT_MAX,
  POINT_COUNT_MIN,
  POINT_COUNT_WIDGET_INDEX
} from "./config.js";

function normalizePointCount(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return null;
  }
  return Math.max(POINT_COUNT_MIN, Math.min(POINT_COUNT_MAX, Math.floor(num)));
}

function getCachedWidget(node, widgetName) {
  if (!node) {
    return null;
  }
  node._cachedWidgets = node._cachedWidgets || {};
  if (node._cachedWidgets[widgetName]) {
    return node._cachedWidgets[widgetName];
  }
  const widget = node.widgets?.find(w => w.name === widgetName) || null;
  if (widget) {
    node._cachedWidgets[widgetName] = widget;
  }
  return widget;
}

function getLinkedInputValue(node, inputName) {
  if (!node?.inputs) {
    return null;
  }
  const inputInfo = node.inputs.find(input => input?.name === inputName);
  if (!inputInfo) {
    return null;
  }

  const directValue = normalizePointCount(inputInfo.value);
  if (directValue !== null) {
    return directValue;
  }

  const linkId = inputInfo.link;
  const graph = node.graph || app?.graph;
  if (linkId == null || !graph?.links) {
    return null;
  }
  const link = graph.links[linkId];
  if (!link || !graph.getNodeById) {
    return null;
  }
  const originNode = graph.getNodeById(link.origin_id);
  if (!originNode) {
    return null;
  }
  const outputSlot = originNode.outputs?.[link.origin_slot];
  if (!outputSlot) {
    return null;
  }

  let normalized = normalizePointCount(outputSlot.value);
  if (normalized !== null) {
    return normalized;
  }

  if (Array.isArray(outputSlot.value) && outputSlot.value.length > 0) {
    normalized = normalizePointCount(outputSlot.value[0]);
    if (normalized !== null) {
      return normalized;
    }
  }

  const slotValue = outputSlot.value;
  if (slotValue && typeof slotValue === "object" && "value" in slotValue) {
    normalized = normalizePointCount(slotValue.value);
    if (normalized !== null) {
      return normalized;
    }
  }

  if (outputSlot.widget && originNode.widgets) {
    const widgetName = outputSlot.widget.name;
    const widget = originNode.widgets.find(w => w.name === widgetName);
    if (widget && widget.value !== undefined) {
      normalized = normalizePointCount(widget.value);
      if (normalized !== null) {
        return normalized;
      }
    }

    if (!widget && Array.isArray(originNode.widgets_values) && Array.isArray(originNode.widgets)) {
      const widgetIndex = originNode.widgets.findIndex(w => w.name === widgetName);
      if (widgetIndex !== -1 && originNode.widgets_values.length > widgetIndex) {
        normalized = normalizePointCount(originNode.widgets_values[widgetIndex]);
        if (normalized !== null) {
          return normalized;
        }
      }
    }

    if (originNode.properties && widgetName in originNode.properties) {
      normalized = normalizePointCount(originNode.properties[widgetName]);
      if (normalized !== null) {
        return normalized;
      }
    }
  }

  return null;
}

function getStoredWidgetPointCount(node) {
  if (!Array.isArray(node?.widgets_values)) {
    return null;
  }
  if (POINT_COUNT_WIDGET_INDEX >= node.widgets_values.length) {
    return null;
  }
  return normalizePointCount(node.widgets_values[POINT_COUNT_WIDGET_INDEX]);
}

function getEffectivePointCount(node, options = {}) {
  if (!node) {
    return DEFAULT_POINT_COUNT;
  }

  const { updateProperty = false } = options;
  let resolved = getLinkedInputValue(node, "point_count");

  if (resolved === null) {
    const widget = getCachedWidget(node, "point_count");
    if (widget) {
      resolved = normalizePointCount(widget.value);
    }
  }

  if (resolved === null) {
    resolved = getStoredWidgetPointCount(node);
  }

  if (resolved === null && typeof node.properties?.point_count === "number") {
    resolved = normalizePointCount(node.properties.point_count);
  }

  if (resolved === null) {
    resolved = DEFAULT_POINT_COUNT;
  }

  if (updateProperty && node.properties) {
    node.properties.point_count = resolved;
  }

  return resolved;
}

function hasPointCountLink(node) {
  return !!node?.inputs?.some(input => input?.name === "point_count" && input.link != null);
}

function markBackgroundDirty(node) {
  if (!node) return;
  node._backgroundDirty = true;
}

function notifyPointCountChange(node, options = {}) {
  if (typeof node?._onPointCountChange === "function") {
    node._onPointCountChange(options);
  }
}

function startPointCountPolling(node) {
  if (!node || node._pointCountMonitor || !hasPointCountLink(node)) {
    return;
  }

  node._pointCountMonitor = setInterval(() => {
    if (node._removed || !hasPointCountLink(node)) {
      stopPointCountPolling(node);
      return;
    }
    notifyPointCountChange(node);
  }, 300);
}

function stopPointCountPolling(node) {
  if (node?._pointCountMonitor) {
    clearInterval(node._pointCountMonitor);
    node._pointCountMonitor = null;
  }
}

function wrapPointCountWidget(node) {
  const pointCountWidget = getCachedWidget(node, "point_count");
  if (pointCountWidget && !pointCountWidget._xiserWrapped) {
    pointCountWidget._xiserWrapped = true;
    const origCallback = pointCountWidget.callback;
    pointCountWidget.callback = function (...args) {
      if (origCallback) {
        origCallback.apply(this, args);
      }
      notifyPointCountChange(node, { force: true });
    };
  }
}

function setupPointCountEventHandlers(node, onChange) {
  if (!node || node._pointCountHandlersInstalled) {
    return;
  }

  node._pointCountHandlersInstalled = true;
  node._onPointCountChange = onChange;

  wrapPointCountWidget(node);

  if (!node._origOnConnectionsChange) {
    node._origOnConnectionsChange = node.onConnectionsChange;
    node.onConnectionsChange = function (type, index, connected, link_info) {
      if (this._origOnConnectionsChange) {
        this._origOnConnectionsChange.apply(this, arguments);
      }

      if (type === "input" && link_info?.name === "point_count") {
        if (connected) {
          startPointCountPolling(this);
        } else {
          stopPointCountPolling(this);
        }
        notifyPointCountChange(this, { force: true });
      }
    };
  }

  if (hasPointCountLink(node)) {
    startPointCountPolling(node);
  } else {
    stopPointCountPolling(node);
  }
}

export {
  getCachedWidget,
  getEffectivePointCount,
  markBackgroundDirty,
  normalizePointCount,
  setupPointCountEventHandlers,
  stopPointCountPolling
};
