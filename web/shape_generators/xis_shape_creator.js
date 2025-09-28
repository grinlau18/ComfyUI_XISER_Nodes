/**
 * @file xis_shape_creator.js
 * @description XIS_CreateShape 节点形状创建模块
 * @author grinlau18
 */

import { log } from './xis_shape_utils.js';
import ShapeRegistry from './registry.js';

// 描边宽度补偿因子 - 用于调整前端描边宽度显示比例
const STROKE_WIDTH_COMPENSATION = 0.9;

/**
 * 创建 Konva 形状
 * @param {Object} node - 节点实例
 * @param {string} shapeType - 形状类型
 * @param {number} size - 大小
 * @param {string} color - 颜色
 * @param {number} rotation - 旋转角度（度，基于 3 点钟方向 0°）
 * @param {Object} transform - 变换参数（缩放、剪切）
 * @param {string} strokeColor - 描边颜色
 * @param {number} strokeWidth - 描边宽度
 * @returns {Konva.Path|Konva.Shape} Konva 形状对象或路径
 */
export function createKonvaShape(node, shapeType, size, color, rotation, transform = {}, strokeColor = "#FFFFFF", strokeWidth = 2) {
  // 应用描边宽度补偿
  const compensatedStrokeWidth = strokeWidth * STROKE_WIDTH_COMPENSATION;
  const centerX = node.konvaState.stage.width() / 2;
  const centerY = node.konvaState.stage.height() / 2;

  let shape;

  // 获取形状参数
  let shapeParams = {};
  try {
    shapeParams = JSON.parse(node.properties.shape_params || "{}");
  } catch (e) {
    log.error(`Error parsing shape_params: ${e}`);
    shapeParams = {};
  }

  // 使用模块化形状生成器
  const shapeData = ShapeRegistry.generateShape(shapeType, shapeParams, size);

  if (shapeData) {
    // 处理甜甜圈形状 - 使用 Konva.Group 组合内外圆路径
    if (shapeData.metadata.hasInnerRadius && shapeData.metadata.isFullCircle) {
      // 甜甜圈形状：创建组包含外圆和内圆路径
      shape = new Konva.Group({
        x: centerX,
        y: centerY,
        draggable: true,
        name: 'shape'
      });

      // 外圆路径
      const outerPath = new Konva.Path({
        data: shapeData.pathData,
        fill: color,
        stroke: strokeColor,
        strokeWidth: compensatedStrokeWidth
      });

      // 内圆路径（使用背景色填充以创建孔洞效果）
      const innerPath = new Konva.Path({
        data: shapeData.innerPathData,
        fill: node.properties.bg_color || "#000000",
        stroke: strokeColor,
        strokeWidth: compensatedStrokeWidth
      });

      shape.add(outerPath);
      shape.add(innerPath);
    } else if (shapeData.metadata.type === "spiral") {
      // 螺旋形状：只使用描边，不使用填充
      shape = new Konva.Path({
        x: centerX,
        y: centerY,
        data: shapeData.pathData,
        fill: 'rgba(0, 0, 0, 0)', // 透明填充
        stroke: strokeColor,
        strokeWidth: compensatedStrokeWidth,
        draggable: true,
        name: 'shape'
      });
    } else {
      // 普通形状：使用单个路径
      shape = new Konva.Path({
        x: centerX,
        y: centerY,
        data: shapeData.pathData,
        fill: color,
        stroke: strokeColor,
        strokeWidth: compensatedStrokeWidth,
        draggable: true,
        name: 'shape'
      });
    }

    log.info(`Node ${node.id} created ${shapeType} shape with metadata:`, shapeData.metadata);
  } else {
    // 后备方案：使用 Konva.Path 绘制默认圆形
    const defaultSegments = 64;
    let defaultPathData = '';
    const defaultPoints = [];

    for (let i = 0; i <= defaultSegments; i++) {
      const theta = 2 * Math.PI * i / defaultSegments;
      const cosTheta = Math.cos(theta);
      const sinTheta = Math.sin(theta);
      defaultPoints.push([size * cosTheta, size * sinTheta]);
    }

    defaultPathData += `M ${defaultPoints[0][0]} ${defaultPoints[0][1]}`;
    defaultPoints.forEach(([x, y]) => defaultPathData += ` L ${x} ${y}`);
    defaultPathData += ` Z`;

    shape = new Konva.Path({
      x: centerX,
      y: centerY,
      data: defaultPathData,
      fill: color,
      stroke: strokeColor,
      strokeWidth: compensatedStrokeWidth,
      draggable: true,
      name: 'shape'
    });

    log.info(`Node ${node.id} created default circle path with ${defaultPoints.length} points`);
  }

  // 应用变换参数
  shape.rotation(rotation);
  shape.scaleX(transform.scaleX || 1);
  shape.scaleY(transform.scaleY || 1);
  shape.skewX(transform.skewX || 0);
  shape.skewY(transform.skewY || 0);

  log.info(`Node ${node.id} created ${shapeType} with sides/points: ${shapeParams.sides || shapeParams.points || 'N/A'}, inner_radius: ${shapeParams.inner_radius || 0}, angle: ${shapeParams.angle || 360}, rotation: ${rotation}°, scale: (${shape.scaleX()}, ${shape.scaleY()}), skew: (${shape.skewX()}, ${shape.skewY()}), position: (${shape.x()}, ${shape.y()})`);

  shape.on('dragstart', () => {
    if (node.konvaState.transformer) {
      node.konvaState.transformer.nodes([shape]);
    }
  });

  shape.on('dragend', () => {
    saveShapeState(node);
    node.setDirtyCanvas(true, true);
  });

  shape.on('transformend', () => {
    saveShapeState(node);
    node.setDirtyCanvas(true, true);
  });

  return shape;
}

/**
 * 更新 Konva 形状
 * @param {Object} node - 节点实例
 * @param {Object} value - 可选的值数据
 */
export function updateKonvaShape(node, value = null) {
  if (!node.konvaState?.stage || !node.konvaState?.layer) return;

  const state = node.konvaState;
  const properties = node.properties || {};

  // 清除现有形状前保存状态
  if (state.shape) {
    saveShapeState(node);
    state.shape.destroy();
    state.transformer.nodes([]);
  }

  // 获取形状参数
  const shapeType = value?.shape_type || properties.shape_type || "circle";
  const shapeColor = value?.shape_color || properties.shape_color || "#FF0000";
  const strokeColor = value?.stroke_color || properties.stroke_color || "#FFFFFF";
  const strokeWidth = value?.stroke_width !== undefined ? parseInt(value.stroke_width) : parseInt(properties.stroke_width || 0);
  const baseSize = Math.min(state.stage.width(), state.stage.height()) * 0.25; // 0.25为图形缩放因子，可调节图形默认大小
  const rotation = value?.rotation !== undefined ? value.rotation : 0;
  const transform = {
    scaleX: value?.scale?.x || 1,
    scaleY: value?.scale?.y || 1,
    skewX: value?.skew?.x || 0,
    skewY: value?.skew?.y || 0
  };

  // 创建新形状
  const shape = createKonvaShape(node, shapeType, baseSize, shapeColor, rotation, transform, strokeColor, strokeWidth);
  state.layer.add(shape);
  state.shape = shape;

  // 应用保存的状态（如果存在）
  if (properties.shapeState) {
    restoreShapeState(node);
  } else if (value?.position) {
    shape.x(state.stage.width() / 2 + value.position.x * state.stage.width());
    shape.y(state.stage.height() / 2 + value.position.y * state.stage.height());
    saveShapeState(node);
  }

  state.transformer.nodes([shape]);
  state.layer.batchDraw();

  log.info(`Node ${node.id} shape updated: ${shapeType} with rotation ${shape.rotation()}°, scale (${shape.scaleX()}, ${shape.scaleY()}), skew (${shape.skewX()}, ${shape.skewY()}), position (${shape.x()}, ${shape.y()})`);
}

// 需要从主文件导入的函数（循环依赖，需要在主文件中定义）
let saveShapeState = () => {};
let restoreShapeState = () => {};

/**
 * 设置状态管理函数（解决循环依赖）
 * @param {Function} saveFn - 保存状态函数
 * @param {Function} restoreFn - 恢复状态函数
 */
export function setStateManagementFunctions(saveFn, restoreFn) {
  saveShapeState = saveFn;
  restoreShapeState = restoreFn;
}