/**
 * @file xis_button_manager.js
 * @description XIS_CreateShape 节点按钮管理模块
 * @author grinlau18
 */

import { log } from './xis_shape_utils.js';

/**
 * 创建重置按钮
 * @param {Object} node - 节点实例
 * @param {Object} stage - Konva舞台
 * @param {Object} layer - Konva图层
 * @param {Function} resetShapeState - 重置形状状态函数
 */
export function createResetButton(node, stage, layer, resetShapeState) {
  const config = node.konvaState.resetButtonConfig;

  const resetButton = new Konva.Group({
    x: stage.width() - config.xOffset,
    y: config.yOffset,
    width: config.width,
    height: config.height,
    listening: true,
    name: 'resetButton',
    draggable: false,
    preventDefault: true
  });

  // 重置按钮背景 - 半透明黑色圆形
  const resetBg = new Konva.Circle({
    radius: config.bgRadius,
    fill: 'rgba(0, 0, 0, 0.7)',
    stroke: 'rgba(255, 255, 255, 0.3)',
    strokeWidth: 1,
    shadowColor: 'rgba(0, 0, 0, 0.5)',
    shadowBlur: 6,
    shadowOffset: { x: 0, y: 2 },
    shadowOpacity: 0.4,
    listening: true  // 确保背景也能接收事件
  });

  // 重置图标 - 箭头循环刷新图标（白色）
  const resetIcon = new Konva.Path({
    data: 'M64,256H34A222,222,0,0,1,430,118.15V85h30V190H355V160h67.27A192.21,192.21,0,0,0,256,64C150.13,64,64,150.13,64,256Zm384,0c0,105.87-86.13,192-192,192A192.21,192.21,0,0,1,89.73,352H157V322H52V427H82V393.85A222,222,0,0,0,478,256Z',
    fill: '#FFFFFF',
    scaleX: config.iconScale,
    scaleY: config.iconScale,
    offsetX: 256,
    offsetY: 256,
    listening: false  // 图标不需要监听事件，由按钮组处理
  });

  resetButton.add(resetBg);
  resetButton.add(resetIcon);

  // 点击重置按钮
  resetButton.on('click tap', (e) => {
    console.log('Reset button clicked for node', node.id);
    e.cancelBubble = true; // 阻止事件冒泡
    resetShapeState(node);
  });

  layer.add(resetButton);
  node.konvaState.resetButton = resetButton;

  // 鼠标悬停效果 - 现代交互（在添加到layer后设置）
  setupButtonHoverEffects(resetButton, resetBg, resetIcon);

  return resetButton;
}

/**
 * 创建居中对齐按钮
 * @param {Object} node - 节点实例
 * @param {Object} stage - Konva舞台
 * @param {Object} layer - Konva图层
 * @param {Function} centerAlignShape - 居中对齐函数
 */
export function createCenterAlignButton(node, stage, layer, centerAlignShape) {
  const config = node.konvaState.centerAlignButtonConfig;

  const centerAlignButton = new Konva.Group({
    x: stage.width() - config.xOffset,
    y: config.yOffset,
    width: config.width,
    height: config.height,
    listening: true,
    name: 'centerAlignButton',
    draggable: false,
    preventDefault: true
  });

  // 居中对齐按钮背景 - 半透明黑色圆形
  const centerAlignBg = new Konva.Circle({
    radius: config.bgRadius,
    fill: 'rgba(0, 0, 0, 0.7)',
    stroke: 'rgba(255, 255, 255, 0.3)',
    strokeWidth: 1,
    shadowColor: 'rgba(0, 0, 0, 0.5)',
    shadowBlur: 6,
    shadowOffset: { x: 0, y: 2 },
    shadowOpacity: 0.4,
    listening: true  // 确保背景也能接收事件
  });

  // 居中对齐图标 - 方形对齐图标（白色）
  const centerAlignIcon = new Konva.Path({
    data: 'M6 12L4 12L4 4L12 4L12 6L6 6L6 12z M28 12L26 12L26 6L20 6L20 4L28 4L28 12z M12 28L4 28L4 20L6 20L6 26L12 26L12 28z M28 28L20 28L20 26L26 26L26 20L28 20L28 28z M15 10L17 10L17 14L15 14L15 10z M10 15L14 15L14 17L10 17L10 15z M18 15L22 15L22 17L18 17L18 15z M15 18L17 18L17 22L15 22L15 18z',
    fill: '#FFFFFF',
    scaleX: config.iconScale,
    scaleY: config.iconScale,
    offsetX: 16,
    offsetY: 16,
    listening: false  // 图标不需要监听事件，由按钮组处理
  });

  centerAlignButton.add(centerAlignBg);
  centerAlignButton.add(centerAlignIcon);

  // 点击居中对齐按钮
  centerAlignButton.on('click tap', (e) => {
    console.log('Center align button clicked for node', node.id);
    e.cancelBubble = true; // 阻止事件冒泡
    centerAlignShape(node);
  });

  layer.add(centerAlignButton);
  node.konvaState.centerAlignButton = centerAlignButton;

  // 鼠标悬停效果 - 现代交互（在添加到layer后设置）
  setupButtonHoverEffects(centerAlignButton, centerAlignBg, centerAlignIcon);

  return centerAlignButton;
}

/**
 * 设置按钮悬停效果
 * @param {Object} button - 按钮组
 * @param {Object} bg - 按钮背景
 * @param {Object} icon - 按钮图标
 */
function setupButtonHoverEffects(button, bg, icon) {
  button.on('mouseenter', () => {
    const layer = button.getLayer();
    bg.fill('rgba(0, 0, 0, 0.85)');
    icon.fill('#FFFFFF');
    bg.stroke('rgba(255, 255, 255, 0.4)');
    bg.shadowOffset({ x: 0, y: 3 });
    bg.shadowBlur(8);
    if (layer) {
      layer.batchDraw();
    }
  });

  button.on('mouseleave', () => {
    const layer = button.getLayer();
    bg.fill('rgba(0, 0, 0, 0.7)');
    icon.fill('#FFFFFF');
    bg.stroke('rgba(255, 255, 255, 0.3)');
    bg.shadowOffset({ x: 0, y: 2 });
    bg.shadowBlur(6);
    if (layer) {
      layer.batchDraw();
    }
  });

  // 点击效果
  button.on('mousedown touchstart', () => {
    const layer = button.getLayer();
    bg.fill('rgba(0, 0, 0, 0.9)');
    bg.shadowOffset({ x: 0, y: 1 });
    if (layer) {
      layer.batchDraw();
    }
  });

  button.on('mouseup touchend', () => {
    const layer = button.getLayer();
    bg.fill('rgba(0, 0, 0, 0.85)');
    bg.shadowOffset({ x: 0, y: 3 });
    if (layer) {
      layer.batchDraw();
    }
  });
}

/**
 * 更新按钮位置
 * @param {Object} node - 节点实例
 * @param {number} stageWidth - 舞台宽度
 */
export function updateButtonPositions(node, stageWidth) {
  // 更新重置按钮位置
  if (node.konvaState.resetButton && node.konvaState.resetButtonConfig) {
    const resetConfig = node.konvaState.resetButtonConfig;
    node.konvaState.resetButton.x(stageWidth - resetConfig.xOffset);
    node.konvaState.resetButton.y(resetConfig.yOffset);
  }

  // 更新居中对齐按钮位置
  if (node.konvaState.centerAlignButton && node.konvaState.centerAlignButtonConfig) {
    const centerConfig = node.konvaState.centerAlignButtonConfig;
    node.konvaState.centerAlignButton.x(stageWidth - centerConfig.xOffset);
    node.konvaState.centerAlignButton.y(centerConfig.yOffset);
  }
}