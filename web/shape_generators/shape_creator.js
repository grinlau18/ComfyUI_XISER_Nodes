/**
 * @file xis_shape_creator.js
 * @description XIS_ShapeAndText 节点形状创建模块
 * @author grinlau18
 */

import { log, normalizeColor, modeToShapeType, DEFAULT_MODE_SELECTION } from "./shape_utils.js";
import ShapeRegistry from './registry.js';
import { getFontManager } from './text.js';

// 描边宽度补偿因子 - 从主文件导入
const STROKE_WIDTH_COMPENSATION = window.STROKE_WIDTH_COMPENSATION || 0.9;
const CANVAS_SCALE_FACTOR = window.XISER_CANVAS_SCALE_FACTOR || 0.75;
const BASE_REFERENCE_SIZE = 512; // 与前端 Konva 画布默认参考尺寸保持一致
const BASE_SIZE_RATIO = 0.25; // 参考尺寸占比（半径）
const FontManager = getFontManager();

/**
 * 计算当前输出尺寸下的基础形状尺寸（与前端显示保持一致）
 * @param {Object} properties - 节点属性
 * @returns {number} Konva 画布中的基础半径
 */
export function getBaseShapeSize(properties = {}) {
  const referenceSize = parseInt(properties.base_shape_reference, 10);
  const baseReference = Number.isFinite(referenceSize) && referenceSize > 0
    ? referenceSize
    : BASE_REFERENCE_SIZE;

  // 维持现有体验：默认使用常见的512输出尺寸参考值
  return baseReference * BASE_SIZE_RATIO;
}

function getStrokeRenderOptions(node, strokeColor, strokeWidth) {
  return {
    color: strokeColor,
    width: strokeWidth,
    join: "round",
    cap: "round",
    miterLimit: 2
  };
}

function createLayeredPath(pathData, fillColor, strokeOptions, extraOptions = {}) {
  const { fillEnabled = true } = extraOptions;
  const safeFillColor = (fillColor === undefined || fillColor === null)
    ? 'rgba(0, 0, 0, 0)'
    : fillColor;
  const basePath = new Konva.Path({
    x: 0,
    y: 0,
    data: pathData,
    fill: safeFillColor,
    fillEnabled,
    stroke: strokeOptions.color,
    strokeWidth: strokeOptions.width,
    lineJoin: strokeOptions.join,
    lineCap: strokeOptions.cap,
    miterLimit: strokeOptions.miterLimit,
    listening: true
  });

  // Allow stroke width to scale together with shape transforms (matches output)
  basePath.strokeScaleEnabled(true);

  if (!strokeOptions.width || strokeOptions.width <= 0) {
    return basePath;
  }

  const strokePath = basePath.clone({
    fillEnabled: false,
    stroke: strokeOptions.color,
    strokeWidth: strokeOptions.width,
    strokeEnabled: true,
    listening: true,
    lineJoin: strokeOptions.join,
    lineCap: strokeOptions.cap,
    miterLimit: strokeOptions.miterLimit
  });
  strokePath.strokeScaleEnabled(true);
  basePath.strokeEnabled(false);

  const layeredGroup = new Konva.Group({
    x: 0,
    y: 0,
    listening: true
  });
  layeredGroup.add(strokePath);
  layeredGroup.add(basePath);
  return layeredGroup;
}

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

  const strokeOptions = getStrokeRenderOptions(node, strokeColor, compensatedStrokeWidth);
  const rootShape = new Konva.Group({
    x: centerX,
    y: centerY,
    draggable: true,
    name: 'shape'
  });
  let shape = rootShape;

  // 获取形状参数
  let shapeParams = {};
  try {
    shapeParams = JSON.parse(node.properties.shape_params || "{}");
  } catch (e) {
    log.error(`Error parsing shape_params: ${e}`);
    shapeParams = {};
  }

  if (shapeType === "text") {
    return createKonvaTextShape(node, shapeParams, color, strokeColor, compensatedStrokeWidth);
  }

  // 使用模块化形状生成器
  const shapeData = ShapeRegistry.generateShape(shapeType, shapeParams, size);
  const internalRotation = parseFloat(shapeParams.shape_rotation ?? 0) || 0;
  const contentGroup = new Konva.Group({
    x: 0,
    y: 0,
    listening: true,
    name: 'shapeContent',
    rotation: internalRotation
  });
  rootShape.add(contentGroup);

  if (shapeData) {
    if (shapeData.metadata.hasInnerRadius && shapeData.metadata.isFullCircle) {
      const outerLayer = createLayeredPath(shapeData.pathData, color, strokeOptions);
      const innerFill = node.properties.bg_color || "#000000";
      const innerLayer = createLayeredPath(shapeData.innerPathData, innerFill, strokeOptions);
      contentGroup.add(outerLayer);
      contentGroup.add(innerLayer);
    } else {
      contentGroup.add(createLayeredPath(shapeData.pathData, color, strokeOptions));
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

    contentGroup.add(createLayeredPath(defaultPathData, color, strokeOptions));
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

function createKonvaTextShape(node, shapeParams, color, strokeColor, strokeWidth) {
const defaults = {
    content: "A",
    font_file: "",
    font_family: "",
    font_size: 128,
    letter_spacing: 0,
    line_spacing: 1.2,
    font_weight: "normal",
    font_style: "normal",
    underline: false,
    uppercase: true,
    text_align: "center"
  };

  const params = { ...defaults, ...(shapeParams || {}) };
  let textContent = params.content || "A";
  if (params.uppercase) {
    textContent = textContent.toUpperCase();
  }

  const centerX = node.konvaState.stage.width() / 2;
  const centerY = node.konvaState.stage.height() / 2;
  const fontFamily = params.font_family || FontManager.getFontFamily(params.font_file) || "Arial";
  const fontSize = Math.max(12, parseInt(params.font_size || 128, 10));
  const letterSpacing = parseFloat(params.letter_spacing || 0);
  const lineHeight = parseFloat(params.line_spacing || 1.2);
  const isBold = params.font_weight === "bold";
  const isItalic = params.font_style === "italic";
  const fontStyle = `${isBold ? "bold" : "normal"}${isItalic ? " italic" : ""}`.trim();
  const textDecoration = params.underline ? "underline" : "";
  const textAlign = (params.text_align || "center").toLowerCase();

  const strokeJoinStyle = "round";

  const baseConfig = {
    x: 0,
    y: 0,
    text: textContent,
    fontSize,
    fontFamily,
    letterSpacing,
    lineHeight,
    fontStyle,
    textDecoration,
    align: ["left", "center", "right"].includes(textAlign) ? textAlign : "center"
  };

  const fillText = new Konva.Text({
    ...baseConfig,
    fill: color,
    strokeWidth: 0,
    draggable: false,
    listening: true
  });
  fillText.offsetX(fillText.width() / 2);
  fillText.offsetY(fillText.height() / 2);

  let textNode = fillText;

  if (strokeWidth > 0) {
    fillText.strokeEnabled(false);
    fillText.stroke(null);
    fillText.strokeWidth(0);

    const strokeText = fillText.clone({
      fillEnabled: false,
      stroke: strokeColor,
      strokeWidth,
      lineJoin: strokeJoinStyle,
      lineCap: "round",
      miterLimit: 2,
      listening: true,
      strokeEnabled: true
    });
    strokeText.strokeScaleEnabled(false);

    const textGroup = new Konva.Group({
      x: centerX,
      y: centerY,
      draggable: true,
      name: "shape",
      listening: true
    });
    textGroup.add(strokeText);
    textGroup.add(fillText);
    textNode = textGroup;
  } else {
    fillText.x(centerX);
    fillText.y(centerY);
    fillText.draggable(true);
    fillText.name("shape");
    fillText.strokeEnabled(false);
    fillText.stroke(null);
    fillText.strokeWidth(0);
    fillText.strokeScaleEnabled(false);
  }

  log.info(`Node ${node.id} created text shape with font ${fontFamily}, size ${fontSize}`);

  if (params.font_file) {
    FontManager.waitForFont(params.font_file).then(() => {
      const applyFontFamily = (nodeToUpdate) => {
        if (!nodeToUpdate) return;
        if (nodeToUpdate.className === "Text") {
          nodeToUpdate.fontFamily(fontFamily);
        } else if (nodeToUpdate.children) {
          nodeToUpdate.children.forEach(applyFontFamily);
        }
      };
      applyFontFamily(textNode);
      const layer = textNode?.getLayer();
      if (layer) {
        layer.batchDraw();
      }
    });
  }

  textNode.on('dragstart', () => {
    if (node.konvaState.transformer) {
      node.konvaState.transformer.nodes([textNode]);
    }
  });

  textNode.on('dragend', () => {
    saveShapeState(node);
    node.setDirtyCanvas(true, true);
  });

  textNode.on('transformend', () => {
    saveShapeState(node);
    node.setDirtyCanvas(true, true);
  });

  return textNode;
}

/**
 * 更新 Konva 形状
 * @param {Object} node - 节点实例
 * @param {Object} value - 可选的值数据
 */
export function updateKonvaShape(node, value = null) {
  if (!node.konvaState?.stage || !node.konvaState?.layer) return;

  const isNumber = (num) => typeof num === "number" && Number.isFinite(num);

  const state = node.konvaState;
  const properties = node.properties || {};

  const modeSelectionValue =
    value?.mode_selection ??
    properties.mode_selection ??
    value?.shape_type ??
    properties.shape_type ??
    DEFAULT_MODE_SELECTION;
  const shapeType = modeToShapeType(modeSelectionValue);
  const shapeColor = value?.shape_color || properties.shape_color || "#0f98b3";
  const strokeColor = value?.stroke_color || properties.stroke_color || "#FFFFFF";
  const strokeWidth = value?.stroke_width !== undefined ? parseInt(value.stroke_width) : parseInt(properties.stroke_width || 0);
  let storedState = null;
  try {
    storedState = node.properties.shapeState ? JSON.parse(node.properties.shapeState) : null;
  } catch (err) {
    storedState = null;
  }

  const hasExplicitPosition =
    value?.position &&
    isNumber(value.position.x) &&
    isNumber(value.position.y);
  const rotationFromValue = isNumber(value?.rotation) ? value.rotation : undefined;
  const scaleXFromValue = isNumber(value?.scale?.x) ? value.scale.x : undefined;
  const scaleYFromValue = isNumber(value?.scale?.y) ? value.scale.y : undefined;
  const skewXFromValue = isNumber(value?.skew?.x) ? value.skew.x : undefined;
  const skewYFromValue = isNumber(value?.skew?.y) ? value.skew.y : undefined;

  const hasExplicitTransforms =
    hasExplicitPosition ||
    rotationFromValue !== undefined ||
    scaleXFromValue !== undefined ||
    scaleYFromValue !== undefined ||
    skewXFromValue !== undefined ||
    skewYFromValue !== undefined;

  const initialRotation = rotationFromValue ?? storedState?.rotation ?? 0;
  const initialTransform = {
    scaleX: scaleXFromValue ?? storedState?.scale?.x ?? 1,
    scaleY: scaleYFromValue ?? storedState?.scale?.y ?? 1,
    skewX: skewXFromValue ?? storedState?.skew?.x ?? 0,
    skewY: skewYFromValue ?? storedState?.skew?.y ?? 0
  };

  const textShape = shapeType === "text";
  const shapeParamsStr = value?.shape_params || properties.shape_params || "{}";
  const needsRebuild =
    textShape ||
    !state.shape ||
    state.shape.shapeType !== shapeType ||
    state.shape.shapeParamsHash !== shapeParamsStr ||
    (state.shape.lastStrokeWidth !== undefined && state.shape.lastStrokeWidth !== strokeWidth) ||
    (state.shape.lastShapeColor !== undefined && normalizeColor(state.shape.lastShapeColor) !== normalizeColor(shapeColor)) ||
    (state.shape.lastStrokeColor !== undefined && normalizeColor(state.shape.lastStrokeColor) !== normalizeColor(strokeColor));
  // 记录基础形状大小，用于前后端保持一致
  const baseSize = getBaseShapeSize(properties);
  node.konvaState.baseSize = baseSize;
  node.konvaState.canvasScaleFactor = CANVAS_SCALE_FACTOR;

  let shape = state.shape;
  if (needsRebuild) {
    if (shape) {
      saveShapeState(node);
      shape.destroy();
    }
    const newShape = createKonvaShape(
      node,
      shapeType,
      baseSize,
      shapeColor,
      initialRotation,
      initialTransform,
      strokeColor,
      strokeWidth
    );
    newShape.shapeType = shapeType;
    newShape.shapeParamsHash = shapeParamsStr;
    newShape.lastStrokeWidth = strokeWidth; // 存储当前描边宽度
    newShape.lastShapeColor = shapeColor; // 存储当前形状颜色
    newShape.lastStrokeColor = strokeColor; // 存储当前描边颜色
    state.layer.add(newShape);
    state.shape = newShape;
    shape = newShape;

    // 恢复之前保存的状态
    restoreShapeState(node);
  } else if (shape) {
    shape.children?.forEach(child => {
      const applyFill = typeof child.fill === "function";
      const applyStroke = typeof child.stroke === "function";
      const applyStrokeWidth = typeof child.strokeWidth === "function";

      if (child.className === "Text") {
        if (applyFill) child.fill(shapeColor);
      } else if (child.className === "Group") {
        child.children?.forEach(grandChild => {
          if (grandChild.className === "Text" && typeof grandChild.fill === "function") {
            grandChild.fill(shapeColor);
          } else {
            if (typeof grandChild.fill === "function") grandChild.fill(shapeColor);
            if (typeof grandChild.stroke === "function") grandChild.stroke(strokeColor);
            if (typeof grandChild.strokeWidth === "function") grandChild.strokeWidth(strokeWidth * STROKE_WIDTH_COMPENSATION);
          }
        });
      } else {
        if (applyFill) child.fill(shapeColor);
        if (applyStroke) child.stroke(strokeColor);
        if (applyStrokeWidth) child.strokeWidth(strokeWidth * STROKE_WIDTH_COMPENSATION);
      }
    });
    // 更新存储的描边宽度和颜色
    shape.lastStrokeWidth = strokeWidth;
    shape.lastShapeColor = shapeColor;
    shape.lastStrokeColor = strokeColor;
  }

  if (shape) {
    shape.shapeParamsHash = shapeParamsStr;
    const stageWidth = state.stage.width();
    const stageHeight = state.stage.height();

    const applyPosition = (pos) => {
      shape.x(stageWidth / 2 + pos.x * stageWidth);
      shape.y(stageHeight / 2 + pos.y * stageHeight);
    };

    const resolvedPosition = hasExplicitPosition
      ? value.position
      : storedState?.position;
    if (resolvedPosition) {
      applyPosition(resolvedPosition);
    }

    const resolvedRotation =
      rotationFromValue !== undefined
        ? rotationFromValue
        : storedState?.rotation;
    if (resolvedRotation !== undefined) {
      shape.rotation(resolvedRotation);
    }

    const resolvedScaleX =
      scaleXFromValue !== undefined
        ? scaleXFromValue
        : storedState?.scale?.x;
    if (resolvedScaleX !== undefined) {
      shape.scaleX(resolvedScaleX);
    }

    const resolvedScaleY =
      scaleYFromValue !== undefined
        ? scaleYFromValue
        : storedState?.scale?.y;
    if (resolvedScaleY !== undefined) {
      shape.scaleY(resolvedScaleY);
    }

    const resolvedSkewX =
      skewXFromValue !== undefined ? skewXFromValue : storedState?.skew?.x;
    if (resolvedSkewX !== undefined) {
      shape.skewX(resolvedSkewX);
    }

    const resolvedSkewY =
      skewYFromValue !== undefined ? skewYFromValue : storedState?.skew?.y;
    if (resolvedSkewY !== undefined) {
      shape.skewY(resolvedSkewY);
    }

    if (state.transformer) {
      state.transformer.nodes([shape]);
    }
    state.layer.batchDraw();

    const shouldSaveState =
      !storedState ||
      hasExplicitTransforms;
    if (shouldSaveState) {
      saveShapeState(node);
    }
  }
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
