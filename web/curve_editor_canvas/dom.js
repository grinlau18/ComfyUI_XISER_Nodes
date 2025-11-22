import { CANVAS_HEIGHT, CANVAS_WIDTH, log, NODE_UI_HEIGHT, NODE_UI_WIDTH } from "./config.js";
import { applyCustomCurve } from "./curve_math.js";
import { updateDisplay } from "./display.js";
import { getEffectivePointCount, markBackgroundDirty } from "./point_count.js";

function cleanupExistingElements(node) {
  if (!node || node.id === -1) return;

  const selectors = [
    `.xiser-curve-node-${node.id}`,
    `.xiser-curve-canvas-container-${node.id}`,
    `.xiser-control-panel-${node.id}`,
    `[data-node-id="${node.id}"]`,
    `#curve-canvas-${node.id}`
  ];

  selectors.forEach(selector => {
    document.querySelectorAll(selector).forEach(el => {
      if (el.parentNode) {
        log.info(`Node ${node.id} removing element:`, selector);
        el.remove();
      }
    });
  });

  if (node.canvas) {
    node.canvas = null;
  }
  if (node.ctx) {
    node.ctx = null;
  }
  node._backgroundCanvas = null;
  node._backgroundCtx = null;
  node._backgroundDirty = true;
}

function cleanupExistingWidgets(node) {
  if (!node || !node.widgets) return;
  node.widgets = node.widgets.filter(widget => !widget.name || !widget.name.includes('curve_editor'));
}

function initializeNodeState(node) {
  if (!node || node.id === -1) return;

  if (!node.properties.curve_points || !Array.isArray(node.properties.curve_points)) {
    node.properties.curve_points = [
      { x: 0, y: 0 },
      { x: 1, y: 1 }
    ];
  }

  if (node.properties.interpolation_algorithm === undefined) {
    node.properties.interpolation_algorithm = "catmull_rom";
  }

  if (!node._curveState || typeof node._curveState !== 'object') {
    node._curveState = {
      draggingPoint: null,
      hoverPoint: null,
      lastUpdateTime: 0,
      initialized: false
    };
  } else {
    node._curveState.draggingPoint = node._curveState.draggingPoint || null;
    node._curveState.hoverPoint = node._curveState.hoverPoint || null;
    node._curveState.lastUpdateTime = node._curveState.lastUpdateTime || 0;
    node._curveState.initialized = node._curveState.initialized || false;
  }
}

function createUIElements(node) {
  if (!node || node.id === -1) return null;

  const mainContainer = document.createElement("div");
  mainContainer.className = `xiser-curve-node-${node.id}`;
  mainContainer.style.cssText = `
    display: flex;
    flex-direction: column;
    width: ${NODE_UI_WIDTH - 20}px;
    height: ${NODE_UI_HEIGHT - 40}px;
    gap: 12px;
    pointer-events: none;
  `;

  const canvasContainer = document.createElement("div");
  canvasContainer.className = `xiser-curve-canvas-container-${node.id}`;
  canvasContainer.style.cssText = `
    position: relative;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0);
    display: flex;
    justify-content: center;
    align-items: center;
    pointer-events: auto;
  `;

  const canvas = document.createElement("canvas");
  canvas.id = `curve-canvas-${node.id}`;
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  canvas.style.cssText = `
    width: ${CANVAS_WIDTH}px;
    height: ${CANVAS_HEIGHT}px;
    cursor: crosshair;
    background: rgba(0, 0, 0, 0.4);
    border-radius: 4px;
    pointer-events: auto;
  `;

  canvasContainer.appendChild(canvas);
  mainContainer.appendChild(canvasContainer);

  return { mainContainer, canvasContainer, canvas };
}

function createControlPanel(node) {
  if (!node || node.id === -1) return null;

  const controlPanel = document.createElement("div");
  controlPanel.className = `xiser-control-panel-${node.id}`;
  controlPanel.style.cssText = `
    width: 100%;
    padding: 12px;
    background: rgba(0, 0, 0, 0.4);
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    pointer-events: auto;
  `;

  const buttonContainer = document.createElement("div");
  buttonContainer.style.cssText = `
    display: flex;
    gap: 6px;
    justify-content: space-between;
    align-items: center;
    width: 100%;
  `;

  const presets = [
    { name: "Linear", type: "linear", interpolation: "linear" },
    { name: "Ease In", type: "ease_in", interpolation: "catmull_rom" },
    { name: "Ease Out", type: "ease_out", interpolation: "catmull_rom" },
    { name: "E In-Out", type: "ease_in_out", interpolation: "catmull_rom" },
    { name: "E Out-In", type: "ease_out_in", interpolation: "catmull_rom" }
  ];

  presets.forEach(preset => {
    const button = document.createElement("button");
    button.textContent = preset.name;
    button.style.cssText = `
      padding: 6px 10px;
      color: #fff;
      background: #61616155;
      border: 1px solid #ababab46;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
      font-weight: 500;
      transition: all 0.2s ease;
      min-width: 40px;
      flex: 1;
    `;

    button.addEventListener("mouseenter", () => {
      button.style.background = "#61616155";
      button.style.borderColor = "#ababab46";
      button.style.transform = "translateY(-1px)";
    });
    button.addEventListener("mouseleave", () => {
      button.style.background = "#61616155";
      button.style.borderColor = "#ababab46";
      button.style.transform = "translateY(0)";
    });

    button.addEventListener("click", () => {
      applyPresetCurve(node, preset.type);
      node.properties.interpolation_algorithm = preset.interpolation;
      updateToggleState(preset.interpolation === "catmull_rom");
      updateDisplay(node);
      node.setDirtyCanvas(true, true);
      if (node.onWidgetChange) {
        node.onWidgetChange();
      }
    });

    buttonContainer.appendChild(button);
  });

  const toggleContainer = document.createElement("div");
  toggleContainer.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    justify-content: center;
    flex: 1;
  `;

  const toggleLabel = document.createElement("span");
  toggleLabel.textContent = "Smooth";
  toggleLabel.style.cssText = `
    color: #ccc;
    font-size: 11px;
    font-weight: 500;
    margin-left: 10px;
    white-space: nowrap;
  `;

  const toggleWrapper = document.createElement("div");
  toggleWrapper.style.cssText = `
    position: relative;
    width: 36px;
    height: 18px;
    border-radius: 9px;
    background: ${node.properties.interpolation_algorithm === "catmull_rom" ? "#4CAF50" : "#666"};
    border: 1px solid #ababab83;
    cursor: pointer;
    transition: all 0.2s ease;
  `;

  const toggleThumb = document.createElement("div");
  toggleThumb.style.cssText = `
    position: absolute;
    top: 1px;
    left: ${node.properties.interpolation_algorithm === "catmull_rom" ? '19px' : '1px'};
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fff;
    transition: all 0.2s ease;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  `;

  toggleWrapper.appendChild(toggleThumb);

  const updateToggleState = (isCatmullRom) => {
    if (toggleWrapper && toggleThumb) {
      if (isCatmullRom) {
        toggleWrapper.style.background = "#4CAF50";
        toggleThumb.style.left = "19px";
      } else {
        toggleWrapper.style.background = "#666";
        toggleThumb.style.left = "1px";
      }
    }
  };

  node._updateInterpolationToggle = updateToggleState;

  updateToggleState(node.properties.interpolation_algorithm === "catmull_rom");

  toggleWrapper.addEventListener("click", () => {
    const isCurrentlyCatmullRom = node.properties.interpolation_algorithm === "catmull_rom";
    node.properties.interpolation_algorithm = isCurrentlyCatmullRom ? "linear" : "catmull_rom";
    updateToggleState(!isCurrentlyCatmullRom);
    updateDisplay(node);
    node.setDirtyCanvas(true, true);
    if (node.onWidgetChange) {
      node.onWidgetChange();
    }
  });

  toggleContainer.appendChild(toggleLabel);
  toggleContainer.appendChild(toggleWrapper);
  buttonContainer.appendChild(toggleContainer);
  controlPanel.appendChild(buttonContainer);

  return controlPanel;
}

function registerDOMWidget(node, mainContainer, canvas) {
  if (!node || !mainContainer || !canvas) return;

  node.addDOMWidget("curve_editor", "Curve Editor", mainContainer, {
    serialize: true,
    hideOnZoom: false,
    getValue: () => {
      try {
        const widgets = node.widgets || [];
        const dataTypeWidget = widgets.find(w => w.name === "data_type");
        const startValueWidget = widgets.find(w => w.name === "start_value");
        const endValueWidget = widgets.find(w => w.name === "end_value");

        const pointCount = getEffectivePointCount(node, { updateProperty: true });
        const dataType = dataTypeWidget ? dataTypeWidget.value : (node.properties.data_type || "FLOAT");
        const startValue = startValueWidget ? parseFloat(startValueWidget.value || 0) : 0;
        const endValue = endValueWidget ? parseFloat(endValueWidget.value || 1) : 1;

        const distribution_values = [];
        const distribution_t_values = [];

        for (let i = 0; i < pointCount; i++) {
          const t = (i + 1) / pointCount;
          let transformedT = t;

          if (node.properties.curve_points && node.properties.curve_points.length > 0) {
            transformedT = applyCustomCurve(t, node.properties.curve_points, node);
          }

          let value;
          if (dataType === "HEX") {
            value = transformedT;
          } else {
            value = startValue + (endValue - startValue) * transformedT;
            if (dataType === "INT") {
              value = Math.round(value);
            }
          }

          distribution_values.push(value);
          distribution_t_values.push({
            index: i + 1,
            t,
            transformed_t: transformedT
          });
        }

        return {
          curve_points: (node.properties.curve_points || []).slice(0, 50).map(point => ({
            x: Math.max(0, Math.min(1, typeof point.x === "number" ? point.x : 0)),
            y: Math.max(0, Math.min(1, typeof point.y === "number" ? point.y : 0))
          })),
          distribution_values,
          distribution_t_values,
          data_type: dataTypeWidget ? dataTypeWidget.value : (node.properties.data_type || "FLOAT"),
          start_value: startValueWidget ? startValueWidget.value : (node.properties.start_value || "0"),
          end_value: endValueWidget ? endValueWidget.value : (node.properties.end_value || "1"),
          point_count: pointCount,
          interpolation_algorithm: node.properties.interpolation_algorithm || "catmull_rom",
          color_interpolation: node.properties.color_interpolation || "HSV",
          node_size: node.properties.node_size || [NODE_UI_WIDTH, NODE_UI_HEIGHT],
          node_id: node.id.toString()
        };
      } catch (e) {
        log.error(`Node ${node.id} error in getValue: ${e}`);
        const defaultDistributionValues = [];
        const defaultDistributionTValues = [];
        for (let i = 0; i < 10; i++) {
          const t = (i + 1) / 10;
          const value = 0 + (1 - 0) * t;
          defaultDistributionValues.push(value);
          defaultDistributionTValues.push({ index: i + 1, t, transformed_t: t });
        }

        return {
          curve_points: [
            { x: 0, y: 0 },
            { x: 1, y: 1 }
          ],
          distribution_values: defaultDistributionValues,
          distribution_t_values: defaultDistributionTValues,
          data_type: "FLOAT",
          start_value: "0",
          end_value: "1",
          point_count: 10,
          interpolation_algorithm: "catmull_rom",
          color_interpolation: "HSV",
          node_size: [NODE_UI_WIDTH, NODE_UI_HEIGHT],
          node_id: node.id.toString()
        };
      }
    },
    setValue: (value) => {
      try {
        if (value.node_id && value.node_id !== node.id.toString()) {
          log.warning(`Node ${node.id} ignoring data for node ${value.node_id}`);
          return;
        }

        node.properties.curve_points = (value.curve_points && Array.isArray(value.curve_points)
          ? value.curve_points.slice(0, 50).map(point => ({
              x: Math.max(0, Math.min(1, typeof point.x === "number" ? point.x : 0)),
              y: Math.max(0, Math.min(1, typeof point.y === "number" ? point.y : 0))
            }))
          : [
              { x: 0, y: 0 },
              { x: 1, y: 1 }
            ]);

        node.properties.data_type = value.data_type && ["INT", "FLOAT", "HEX"].includes(value.data_type)
          ? value.data_type
          : "FLOAT";
        node.properties.start_value = value.start_value || "0";
        node.properties.end_value = value.end_value || "1";
        node.properties.point_count = Math.max(2, Math.min(100, Math.floor(value.point_count || 10)));
        node.properties.interpolation_algorithm = value.interpolation_algorithm && ["linear", "catmull_rom"].includes(value.interpolation_algorithm)
          ? value.interpolation_algorithm
          : "catmull_rom";
        node.properties.color_interpolation = value.color_interpolation && ["HSV", "RGB", "LAB"].includes(value.color_interpolation)
          ? value.color_interpolation
          : "HSV";
        node.properties.node_size = value.node_size && Array.isArray(value.node_size)
          ? [Math.max(value.node_size[0], NODE_UI_WIDTH), Math.max(value.node_size[1], NODE_UI_HEIGHT)]
          : [NODE_UI_WIDTH, NODE_UI_HEIGHT];

        if (value.distribution_t_values && Array.isArray(value.distribution_t_values)) {
          node.properties.distribution_t_values = value.distribution_t_values;
        } else {
          const pointCount = node.properties.point_count;
          node.properties.distribution_t_values = [];
          for (let i = 0; i < pointCount; i++) {
            const t = (i + 1) / pointCount;
            let transformedT = t;

            if (node.properties.curve_points && node.properties.curve_points.length > 0) {
              transformedT = applyCustomCurve(t, node.properties.curve_points, node);
            }

            node.properties.distribution_t_values.push({
              index: i + 1,
              t,
              transformed_t: transformedT
            });
          }
        }

        markBackgroundDirty(node);
        updateDisplay(node);
        node.setDirtyCanvas(true, true);
        if (node._updateInterpolationToggle) {
          node._updateInterpolationToggle(node.properties.interpolation_algorithm === "catmull_rom");
        }
      } catch (e) {
        log.error(`Node ${node.id} error in setValue: ${e}`);
      }
    }
  });

  node.canvas = canvas;
  node.ctx = canvas.getContext('2d');
}

function applyPresetCurve(node, presetType) {
  const startPoint = { x: 0, y: 0 };
  const endPoint = { x: 1, y: 1 };
  let points = [startPoint, endPoint];

  switch (presetType) {
    case "linear":
      break;
    case "ease_in":
      points.splice(1, 0, { x: 0.2, y: 0.05 });
      points.splice(2, 0, { x: 0.45, y: 0.2 });
      points.splice(3, 0, { x: 0.7, y: 0.5 });
      break;
    case "ease_out":
      points.splice(1, 0, { x: 0.3, y: 0.55 });
      points.splice(2, 0, { x: 0.55, y: 0.8 });
      points.splice(3, 0, { x: 0.8, y: 0.95 });
      break;
    case "ease_in_out":
      points.splice(1, 0, { x: 0.2, y: 0.1 });
      points.splice(2, 0, { x: 0.5, y: 0.5 });
      points.splice(3, 0, { x: 0.8, y: 0.9 });
      break;
    case "ease_out_in":
      points.splice(1, 0, { x: 0.15, y: 0.3 });
      points.splice(2, 0, { x: 0.5, y: 0.5 });
      points.splice(3, 0, { x: 0.85, y: 0.7 });
      break;
  }

  points.sort((a, b) => a.x - b.x);
  node.properties.curve_points = points;
}

export {
  cleanupExistingElements,
  cleanupExistingWidgets,
  createControlPanel,
  createUIElements,
  initializeNodeState,
  registerDOMWidget
};
