/**
 * @file xis_control_manager.js
 * @description XIS_ShapeAndText 节点控件管理模块
 * @author grinlau18
 */

import { log, normalizeColor, modeToShapeType, shapeTypeToMode, DEFAULT_MODE_SELECTION } from "./shape_utils.js";
import { updateKonvaShape } from "./shape_creator.js";
import { updateCanvasBackground } from "./state_manager.js";

/**
 * 监听输入控件变化
 * @param {Object} node - 节点实例
 */
export function setupInputListeners(node) {
  const widgets = node.widgets || [];
  const modeWidget = widgets.find(w => w.name === "mode_selection") || widgets.find(w => w.name === "shape_type");
  const shapeColorWidget = widgets.find(w => w.name === "shape_color");
  const bgColorWidget = widgets.find(w => w.name === "bg_color");
  const transparentWidget = widgets.find(w => w.name === "transparent_bg");
  const strokeColorWidget = widgets.find(w => w.name === "stroke_color");
  const strokeWidthWidget = widgets.find(w => w.name === "stroke_width");
  const widthWidget = widgets.find(w => w.name === "width");
  const heightWidget = widgets.find(w => w.name === "height");

  if (modeWidget) {
    modeWidget.callback = () => {
      const selectedMode = modeWidget.value || DEFAULT_MODE_SELECTION;
      node.properties.mode_selection = selectedMode;
      node.properties.shape_type = modeToShapeType(selectedMode);
      updateKonvaShape(node);
      updateCanvasSize(node);
      node.setDirtyCanvas(true, true);
      log.info(`Node ${node.id} mode_selection updated to: ${selectedMode}, shape_type=${node.properties.shape_type}`);
    };
  }

  if (shapeColorWidget) {
    shapeColorWidget.callback = () => {
      // 防止setValue操作期间的冲突
      if (node.konvaState?.isSettingValue) {
        log.debug(`Node ${node.id} shape_color callback skipped during setValue operation`);
        return;
      }

      const newColor = shapeColorWidget.value;
      // 只有当控件未连接到上游节点或值确实发生变化时才更新
      if (!shapeColorWidget.link && normalizeColor(newColor) !== normalizeColor(node.properties.shape_color)) {
        node.properties.shape_color = newColor;
        updateKonvaShape(node);
        node.setDirtyCanvas(true, true);
        log.info(`Node ${node.id} shape_color updated to: ${node.properties.shape_color}`);
      }
    };
  }

  if (bgColorWidget) {
    bgColorWidget.callback = () => {
      // 防止setValue操作期间的冲突
      if (node.konvaState?.isSettingValue) {
        log.debug(`Node ${node.id} bg_color callback skipped during setValue operation`);
        return;
      }

      const newColor = bgColorWidget.value;
      // 只有当控件未连接到上游节点或值确实发生变化时才更新
      if (!bgColorWidget.link && normalizeColor(newColor) !== normalizeColor(node.properties.bg_color)) {
        node.properties.bg_color = newColor;
        updateCanvasBackground(node);
        node.setDirtyCanvas(true, true);
        log.info(`Node ${node.id} bg_color updated to: ${node.properties.bg_color}`);
      }
    };
  }

  if (transparentWidget) {
    transparentWidget.callback = () => {
      const newTransparent = Boolean(transparentWidget.value);
      // 只有当控件未连接到上游节点或值确实发生变化时才更新
      if (!transparentWidget.link && newTransparent !== node.properties.transparent_bg) {
        node.properties.transparent_bg = newTransparent;
        updateCanvasBackground(node);
        node.setDirtyCanvas(true, true);
        log.info(`Node ${node.id} transparent_bg updated to: ${node.properties.transparent_bg}`);
      }
    };
  }

  if (strokeColorWidget) {
    strokeColorWidget.callback = () => {
      // 防止setValue操作期间的冲突
      if (node.konvaState?.isSettingValue) {
        log.debug(`Node ${node.id} stroke_color callback skipped during setValue operation`);
        return;
      }

      const newColor = strokeColorWidget.value;
      // 只有当控件未连接到上游节点或值确实发生变化时才更新
      if (!strokeColorWidget.link && normalizeColor(newColor) !== normalizeColor(node.properties.stroke_color)) {
        node.properties.stroke_color = newColor;
        updateKonvaShape(node);
        node.setDirtyCanvas(true, true);
        log.info(`Node ${node.id} stroke_color updated to: ${node.properties.stroke_color}`);
      }
    };
  }

  if (strokeWidthWidget) {
    strokeWidthWidget.callback = () => {
      const newWidth = parseInt(strokeWidthWidget.value);
      // 只有当控件未连接到上游节点或值确实发生变化时才更新
      if (!strokeWidthWidget.link && newWidth !== node.properties.stroke_width) {
        node.properties.stroke_width = newWidth;
        updateKonvaShape(node);
        node.setDirtyCanvas(true, true);
        log.info(`Node ${node.id} stroke_width updated to: ${node.properties.stroke_width}`);
      }
    };
  }

  if (widthWidget) {
    widthWidget.callback = () => {
      const newWidth = parseInt(widthWidget.value);
      if (newWidth !== node.properties.width) {
        node.properties.width = newWidth;
        // 立即更新画板和节点尺寸
        updateCanvasSize(node);
        // 保存当前形状状态
        if (node.konvaState.shape) {
          saveShapeState(node);
        }
        node.setDirtyCanvas(true, true);
        log.info(`Node ${node.id} width updated to: ${node.properties.width}`);
      }
    };
  }

  if (heightWidget) {
    heightWidget.callback = () => {
      const newHeight = parseInt(heightWidget.value);
      if (newHeight !== node.properties.height) {
        node.properties.height = newHeight;
        // 立即更新画板和节点尺寸
        updateCanvasSize(node);
        // 保存当前形状状态
        if (node.konvaState.shape) {
          saveShapeState(node);
        }
        node.setDirtyCanvas(true, true);
        log.info(`Node ${node.id} height updated to: ${node.properties.height}`);
      }
    };
  }

  log.info(`Input listeners setup for node ${node.id}`);
}

/**
 * 创建参数化形状控制 UI
 * @param {Object} node - 节点实例
 * @param {HTMLDivElement} container - 参数容器
 */
export function setupParametricControls(node, container) {
  const updateParametricControls = () => {
    if (!container) return;
    container.innerHTML = '';
    const modeSelection = node.properties.mode_selection || shapeTypeToMode(node.properties.shape_type) || DEFAULT_MODE_SELECTION;
    const shapeType = modeToShapeType(modeSelection);
    let shapeParams = {};
    try {
      shapeParams = JSON.parse(node.properties.shape_params || "{}");
    } catch (e) {
      log.error(`Error parsing shape_params: ${e}`);
    }

    if (node.konvaState?.paramsTitle) {
      node.konvaState.paramsTitle.textContent = shapeType === "text" ? "Text Settings" : "Shape Settings";
    }

    // 使用模块化参数控件
    const onParamChange = (newParams) => {
      node.properties.shape_params = JSON.stringify(newParams);
      updateKonvaShape(node);
      updateCanvasSize(node);
      node.setDirtyCanvas(true, true);
    };

    // 通用旋转角度控制（仅适用于非文字模式）
    if (shapeType !== "text") {
      const rotationWrapper = document.createElement("div");
      rotationWrapper.innerHTML = `
        <label style="display:flex; justify-content:space-between; align-items:center; color:#ccc;">
          <span>Shape Rotation (°)</span>
          <span class="xiser-rotation-value" style="min-width:40px; text-align:right;">${shapeParams.shape_rotation ?? 0}</span>
        </label>
        <input type="range" min="-180" max="180" step="1" value="${shapeParams.shape_rotation ?? 0}" style="width:100%;">
      `;
      const rotationInput = rotationWrapper.querySelector("input");
      const rotationValue = rotationWrapper.querySelector(".xiser-rotation-value");
      rotationInput.addEventListener("input", () => {
        const val = parseFloat(rotationInput.value);
        rotationValue.textContent = val.toFixed(0);
        shapeParams.shape_rotation = val;
        onParamChange(shapeParams);
      });
      container.appendChild(rotationWrapper);
    }

    ShapeRegistry.getParameterControls(shapeType, container, shapeParams, onParamChange);
  };

  if (node.konvaState) {
    node.konvaState.refreshParams = updateParametricControls;
  }

  const modeWidget = node.widgets.find(w => w.name === "mode_selection") || node.widgets.find(w => w.name === "shape_type");
  if (modeWidget) {
    const originalCallback = modeWidget.callback;
    modeWidget.callback = () => {
      if (originalCallback) originalCallback();
      updateParametricControls();
    };
  }

  updateParametricControls();
  log.info(`Parametric controls setup for node ${node.id}`);
}

/**
 * 从节点属性初始化widget值
 * @param {Object} node - 节点实例
 */
export function initializeWidgetsFromProperties(node) {
  const widgets = node.widgets || [];
  const properties = node.properties || {};

  // 初始化所有widget的值
  widgets.forEach(widget => {
    if (widget.name && properties[widget.name] !== undefined) {
      widget.value = properties[widget.name];
      log.info(`Node ${node.id} widget ${widget.name} initialized to: ${widget.value}`);
    }
  });
}

// 需要从主文件导入的函数（循环依赖，需要在主文件中定义）
let saveShapeState = () => {};
let ShapeRegistry = {};
let updateCanvasSize = () => {};

/**
 * 设置依赖函数（解决循环依赖）
 * @param {Function} saveFn - 保存状态函数
 * @param {Object} registry - 形状注册表
 * @param {Function} canvasSizeFn - 更新画布尺寸函数
 */
export function setControlDependencies(saveFn, registry, canvasSizeFn) {
  saveShapeState = saveFn;
  ShapeRegistry = registry;
  updateCanvasSize = canvasSizeFn;
}
