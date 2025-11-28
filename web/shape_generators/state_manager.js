/**
 * @file xis_state_manager.js
 * @description XIS_ShapeAndText 节点状态管理模块
 * @author grinlau18
 */

import { log } from "./shape_utils.js";

/**
 * 保存形状状态到节点
 * @param {Object} node - 节点实例
 */
export function saveShapeState(node) {
  if (!node.konvaState?.shape) return;

  const shape = node.konvaState.shape;
  const stage = node.konvaState.stage;

  // 简化坐标系统：直接使用画布坐标（画板固定为输出尺寸的75%）
  const canvasWidth = stage.width();
  const canvasHeight = stage.height();

  // 获取输出尺寸用于日志记录
  const outputWidth = parseInt(node.properties.width) || 512;
  const outputHeight = parseInt(node.properties.height) || 512;

  // 归一化位置相对于画布中心
  node.properties.shapeState = JSON.stringify({
    position: {
      x: (shape.x() - canvasWidth / 2) / canvasWidth,
      y: (shape.y() - canvasHeight / 2) / canvasHeight
    },
    rotation: shape.rotation(),
    scale: {
      x: shape.scaleX(),
      y: shape.scaleY()
    },
    skew: {
      x: shape.skewX(),
      y: shape.skewY()
    },
    // 存储画布尺寸用于状态恢复
    canvasDimensions: {
      width: canvasWidth,
      height: canvasHeight
    }
  });
  node.properties.shape_state = node.properties.shapeState;
  if (node.graph?.setDirtyCanvas) {
    node.graph.setDirtyCanvas(true, true);
  }
  if (node.graph?.setDirty) {
    node.graph.setDirty(true, false);
  }
  node.setDirtyCanvas?.(true, true);

  log.info(`Node ${node.id} shape state saved with rotation ${shape.rotation()}°, scale (${shape.scaleX()}, ${shape.scaleY()}), skew (${shape.skewX()}, ${shape.skewY()}), position (${shape.x()}, ${shape.y()}), logical canvas: ${outputWidth}x${outputHeight}, stage: ${stage.width()}x${stage.height()}`);
}

/**
 * 从节点恢复形状状态
 * @param {Object} node - 节点实例
 */
export function restoreShapeState(node) {
  if (!node.konvaState?.shape || !node.properties.shapeState) return;

  try {
    const state = JSON.parse(node.properties.shapeState);
    const shape = node.konvaState.shape;
    const stage = node.konvaState.stage;

    // 简化坐标系统恢复
    const canvasWidth = stage.width();
    const canvasHeight = stage.height();

    // 处理画布尺寸不匹配的情况
    const savedCanvasWidth = state.canvasDimensions?.width || canvasWidth;
    const savedCanvasHeight = state.canvasDimensions?.height || canvasHeight;

    if (state.position) {
      // 位置相对于画布中心，考虑尺寸变化
      const scaleX = canvasWidth / savedCanvasWidth;
      const scaleY = canvasHeight / savedCanvasHeight;

      shape.x(canvasWidth / 2 + state.position.x * savedCanvasWidth * scaleX);
      shape.y(canvasHeight / 2 + state.position.y * savedCanvasHeight * scaleY);
    }

    if (state.rotation !== undefined) {
      shape.rotation(state.rotation);
    }

    if (state.scale) {
      // 直接使用保存的比例值（画板固定大小，无需额外缩放）
      shape.scaleX(state.scale.x);
      shape.scaleY(state.scale.y);
    }

    if (state.skew) {
      shape.skewX(state.skew.x);
      shape.skewY(state.skew.y);
    }

    node.konvaState.transformer.nodes([shape]);
    node.konvaState.layer.batchDraw();

    log.info(`Node ${node.id} restored shape state: rotation ${state.rotation}°, scale (${shape.scaleX().toFixed(3)}, ${shape.scaleY().toFixed(3)}), skew (${shape.skewX()}, ${shape.skewY()}), position (${shape.x().toFixed(1)}, ${shape.y().toFixed(1)})`);
  } catch (e) {
    log.error(`Node ${node.id} error restoring shape state: ${e}`);
  }
}

/**
 * 重置形状到默认状态
 * @param {Object} node - 节点实例
 */
export function resetShapeState(node) {
  if (!node.konvaState?.shape || !node.konvaState?.stage) return;

  const shape = node.konvaState.shape;
  const stage = node.konvaState.stage;

  // 重置到默认状态：居中、无旋转、无缩放、无剪切
  shape.x(stage.width() / 2);
  shape.y(stage.height() / 2);
  shape.rotation(0);
  shape.scaleX(1);
  shape.scaleY(1);
  shape.skewX(0);
  shape.skewY(0);

  // 更新变换器
  if (node.konvaState.transformer) {
    node.konvaState.transformer.nodes([shape]);
  }

  // 保存新状态
  saveShapeState(node);
  node.konvaState.layer.batchDraw();
  node.setDirtyCanvas(true, true);

  log.info(`Node ${node.id} shape reset to default state`);
}

/**
 * 居中对齐形状
 * @param {Object} node - 节点实例
 */
export function centerAlignShape(node) {
  if (!node.konvaState?.shape || !node.konvaState?.stage) return;

  const shape = node.konvaState.shape;
  const stage = node.konvaState.stage;

  shape.x(stage.width() / 2);
  if (node.konvaState.transformer) {
    node.konvaState.transformer.nodes([shape]);
  }

  saveShapeState(node);
  node.konvaState.layer.batchDraw();
  node.setDirtyCanvas(true, true);

  log.info(`Node ${node.id} shape horizontally centered`);
}

export function verticalAlignShape(node) {
  if (!node.konvaState?.shape || !node.konvaState?.stage) return;

  const shape = node.konvaState.shape;
  const stage = node.konvaState.stage;

  shape.y(stage.height() / 2);

  // 更新变换器
  if (node.konvaState.transformer) {
    node.konvaState.transformer.nodes([shape]);
  }

  // 保存新状态
  saveShapeState(node);
  node.konvaState.layer.batchDraw();
  node.setDirtyCanvas(true, true);

  log.info(`Node ${node.id} shape vertically centered`);
}

/**
 * 更新画布背景颜色
 * @param {Object} node - 节点实例
 */
export function updateCanvasBackground(node) {
  if (!node.konvaState?.background) return;

  const properties = node.properties || {};
  const bgColor = properties.bg_color || "#000000";
  const transparentBg = Boolean(properties.transparent_bg);
  const backgroundColor = transparentBg ? 'rgba(0, 0, 0, 0.3)' : bgColor;

  node.konvaState.background.fill(backgroundColor);
  node.konvaState.layer.batchDraw();

  if (node.konvaState.drawGrid) {
    node.konvaState.drawGrid(backgroundColor);
    if (node.konvaState.gridLayer) {
      node.konvaState.gridLayer.visible(node.konvaState.gridVisible !== false);
      node.konvaState.gridLayer.batchDraw();
    }
  }

  log.info(`Node ${node.id} background updated to: ${backgroundColor}`);
}
