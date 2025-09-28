/**
 * @file xis_control_manager.js
 * @description XIS_CreateShape 节点控件管理模块
 * @author grinlau18
 */

import { log, normalizeColor } from './xis_shape_utils.js';
import { updateKonvaShape } from './xis_shape_creator.js';
import { updateCanvasBackground } from './xis_state_manager.js';

/**
 * 监听输入控件变化
 * @param {Object} node - 节点实例
 */
export function setupInputListeners(node) {
  const widgets = node.widgets || [];
  const shapeTypeWidget = widgets.find(w => w.name === "shape_type");
  const shapeColorWidget = widgets.find(w => w.name === "shape_color");
  const bgColorWidget = widgets.find(w => w.name === "bg_color");
  const transparentWidget = widgets.find(w => w.name === "transparent_bg");
  const strokeColorWidget = widgets.find(w => w.name === "stroke_color");
  const strokeWidthWidget = widgets.find(w => w.name === "stroke_width");
  const widthWidget = widgets.find(w => w.name === "width");
  const heightWidget = widgets.find(w => w.name === "height");

  if (shapeTypeWidget) {
    shapeTypeWidget.callback = () => {
      node.properties.shape_type = shapeTypeWidget.value;
      updateKonvaShape(node);
      updateCanvasSize(node);
      node.setDirtyCanvas(true, true);
      log.info(`Node ${node.id} shape_type updated to: ${node.properties.shape_type}`);
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
    container.innerHTML = '';
    const shapeType = node.properties.shape_type || "circle";
    let shapeParams = {};
    try {
      shapeParams = JSON.parse(node.properties.shape_params || "{}");
    } catch (e) {
      log.error(`Error parsing shape_params: ${e}`);
    }

    // 使用模块化参数控件
    const onParamChange = (newParams) => {
      node.properties.shape_params = JSON.stringify(newParams);
      updateKonvaShape(node);
      updateCanvasSize(node);
      node.setDirtyCanvas(true, true);
    };

    ShapeRegistry.getParameterControls(shapeType, container, shapeParams, onParamChange);

    // 立即更新尺寸以确保参数控件可见
    setTimeout(() => {
      updateCanvasSize(node);
      // 确保参数容器完全显示
      if (container.children.length > 0) {
        container.style.display = "block";
      } else {
        container.style.display = "none";
      }
    }, 50);
  };

  const shapeTypeWidget = node.widgets.find(w => w.name === "shape_type");
  if (shapeTypeWidget) {
    const originalCallback = shapeTypeWidget.callback;
    shapeTypeWidget.callback = () => {
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