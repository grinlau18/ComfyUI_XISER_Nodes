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
    shadowColor: 'rgba(0, 0, 0, 0.5)',
    shadowBlur: 6,
    shadowOffset: { x: 0, y: 2 },
    shadowOpacity: 0.4,
    listening: true  // 确保背景也能接收事件
  });

  // 重置图标 - 箭头循环刷新图标（白色）
  const resetIcon = new Konva.Path({
    data: 'M8.71597 3.20277C8.98843 2.93241 9.43017 2.93241 9.70263 3.20277L11.5631 5.04893C11.7626 5.24692 11.8223 5.5447 11.7143 5.8034C11.6063 6.06209 11.352 6.23077 11.0698 6.23077H9.2093C5.99834 6.23077 3.39535 8.81374 3.39535 12C3.39535 15.1862 5.99857 17.7692 9.20956 17.7692H9.67442C10.0597 17.7692 10.3721 18.0792 10.3721 18.4615C10.3721 18.8439 10.0597 19.1538 9.67442 19.1538H9.20956C5.22801 19.1538 2 15.951 2 12C2 8.04904 5.22771 4.84615 9.2093 4.84615H9.38543L8.71597 4.18184C8.44351 3.91148 8.44351 3.47314 8.71597 3.20277ZM13.6279 5.53846C13.6279 5.15611 13.9403 4.84615 14.3256 4.84615H14.7907C18.7723 4.84615 22 8.04904 22 12C22 15.951 18.7723 19.1538 14.7907 19.1538H14.6146L15.284 19.8182C15.5565 20.0885 15.5565 20.5269 15.284 20.7972C15.0116 21.0676 14.5698 21.0676 14.2974 20.7972L12.4369 18.9511C12.2374 18.7531 12.1777 18.4553 12.2857 18.1966C12.3937 17.9379 12.6481 17.7692 12.9302 17.7692H14.7907C18.0017 17.7692 20.6047 15.1863 20.6047 12C20.6047 8.81374 18.0017 6.23077 14.7907 6.23077H14.3256C13.9403 6.23077 13.6279 5.92081 13.6279 5.53846Z M5.48828 11.9999C5.48828 9.96072 7.1542 8.30762 9.20921 8.30762H14.7906C16.8456 8.30762 18.5115 9.96072 18.5115 11.9999C18.5115 14.0391 16.8456 15.6922 14.7906 15.6922H9.20921C7.1542 15.6922 5.48828 14.0391 5.48828 11.9999Z',
    fill: '#FFFFFF',
    scaleX: config.iconScale,
    scaleY: config.iconScale,
    offsetX: 12,
    offsetY: 12,
    listening: false
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
    shadowColor: 'rgba(0, 0, 0, 0.5)',
    shadowBlur: 6,
    shadowOffset: { x: 0, y: 2 },
    shadowOpacity: 0.4,
    listening: true  // 确保背景也能接收事件
  });

  // 居中对齐图标 - 方形对齐图标（白色）
  const centerAlignIcon = new Konva.Path({
    data: 'M21 22.75C20.5858 22.75 20.25 22.4142 20.25 22L20.25 2C20.25 1.58579 20.5858 1.25 21 1.25C21.4142 1.25 21.75 1.58579 21.75 2L21.75 22C21.75 22.4142 21.4142 22.75 21 22.75ZM3 22.75C2.58579 22.75 2.25 22.4142 2.25 22L2.25 2C2.25 1.58579 2.58579 1.25 3 1.25C3.41421 1.25 3.75 1.58579 3.75 2L3.75 22C3.75 22.4142 3.41421 22.75 3 22.75Z M12 20C13.8856 20 14.8284 20 15.4142 19.4142C16 18.8284 16 17.8856 16 16L16 8C16 6.11438 16 5.17157 15.4142 4.58579C14.8284 4 13.8856 4 12 4C10.1144 4 9.17157 4 8.58579 4.58579C8 5.17157 8 6.11438 8 8L8 16C8 17.8856 8 18.8284 8.58579 19.4142C9.17157 20 10.1144 20 12 20Z',
    fill: '#FFFFFF',
    scaleX: config.iconScale,
    scaleY: config.iconScale,
    offsetX: 12,
    offsetY: 12,
    listening: false
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

export function createSettingsButton(node, stage, layer, togglePanel) {
  const config = node.konvaState.settingsButtonConfig;

  const settingsButton = new Konva.Group({
    x: config.xOffset,
    y: config.yOffset,
    width: config.width,
    height: config.height,
    listening: true,
    name: 'settingsButton',
    draggable: false,
    preventDefault: true
  });

  const settingsBg = new Konva.Circle({
    radius: config.bgRadius,
    fill: 'rgba(0, 0, 0, 0.7)',
    shadowColor: 'rgba(0, 0, 0, 0.5)',
    shadowBlur: 6,
    shadowOffset: { x: 0, y: 2 },
    shadowOpacity: 0.4,
    listening: true
  });

  const settingsIcon = new Konva.Path({
    data: 'M14 2.75C15.9068 2.75 17.2615 2.75159 18.2892 2.88976C19.2952 3.02503 19.8749 3.27869 20.2981 3.7019C20.7213 4.12511 20.975 4.70476 21.1102 5.71085C21.2484 6.73851 21.25 8.09318 21.25 10C21.25 10.4142 21.5858 10.75 22 10.75C22.4142 10.75 22.75 10.4142 22.75 10L22.75 9.94359C22.75 8.10583 22.75 6.65019 22.5969 5.51098C22.4392 4.33856 22.1071 3.38961 21.3588 2.64124C20.6104 1.89288 19.6614 1.56076 18.489 1.40314C17.3498 1.24997 15.8942 1.24998 14.0564 1.25H14C13.5858 1.25 13.25 1.58579 13.25 2C13.25 2.41421 13.5858 2.75 14 2.75Z M9.94358 1.25H10C10.4142 1.25 10.75 1.58579 10.75 2C10.75 2.41421 10.4142 2.75 10 2.75C8.09318 2.75 6.73851 2.75159 5.71085 2.88976C4.70476 3.02503 4.12511 3.27869 3.7019 3.7019C3.27869 4.12511 3.02503 4.70476 2.88976 5.71085C2.75159 6.73851 2.75 8.09318 2.75 10C2.75 10.4142 2.41421 10.75 2 10.75C1.58579 10.75 1.25 10.4142 1.25 10V9.94358C1.24998 8.10583 1.24997 6.65019 1.40314 5.51098C1.56076 4.33856 1.89288 3.38961 2.64124 2.64124C3.38961 1.89288 4.33856 1.56076 5.51098 1.40314C6.65019 1.24997 8.10583 1.24998 9.94358 1.25Z M22 13.25C22.4142 13.25 22.75 13.5858 22.75 14V14.0564C22.75 15.8942 22.75 17.3498 22.5969 18.489C22.4392 19.6614 22.1071 20.6104 21.3588 21.3588C20.6104 22.1071 19.6614 22.4392 18.489 22.5969C17.3498 22.75 15.8942 22.75 14.0564 22.75H14C13.5858 22.75 13.25 22.4142 13.25 22C13.25 21.5858 13.5858 21.25 14 21.25C15.9068 21.25 17.2615 21.2484 18.2892 21.1102C19.2952 20.975 19.8749 20.7213 20.2981 20.2981C20.7213 19.8749 20.975 19.2952 21.1102 18.2892C21.2484 17.2615 21.25 15.9068 21.25 14C21.25 13.5858 21.5858 13.25 22 13.25Z M2.75 14C2.75 13.5858 2.41421 13.25 2 13.25C1.58579 13.25 1.25 13.5858 1.25 14V14.0564C1.24998 15.8942 1.24997 17.3498 1.40314 18.489C1.56076 19.6614 1.89288 20.6104 2.64124 21.3588C3.38961 22.1071 4.33856 22.4392 5.51098 22.5969C6.65019 22.75 8.10583 22.75 9.94359 22.75H10C10.4142 22.75 10.75 22.4142 10.75 22C10.75 21.5858 10.4142 21.25 10 21.25C8.09318 21.25 6.73851 21.2484 5.71085 21.1102C4.70476 20.975 4.12511 20.7213 3.7019 20.2981C3.27869 19.8749 3.02503 19.2952 2.88976 18.2892C2.75159 17.2615 2.75 15.9068 2.75 14Z M5.52721 5.52721C5 6.05442 5 6.90294 5 8.6C5 9.73137 5 10.2971 5.35147 10.6485C5.70294 11 6.26863 11 7.4 11H8.6C9.73137 11 10.2971 11 10.6485 10.6485C11 10.2971 11 9.73137 11 8.6V7.4C11 6.26863 11 5.70294 10.6485 5.35147C10.2971 5 9.73137 5 8.6 5C6.90294 5 6.05442 5 5.52721 5.52721Z M5.52721 18.4728C5 17.9456 5 17.0971 5 15.4C5 14.2686 5 13.7029 5.35147 13.3515C5.70294 13 6.26863 13 7.4 13H8.6C9.73137 13 10.2971 13 10.6485 13.3515C11 13.7029 11 14.2686 11 15.4V16.6C11 17.7314 11 18.2971 10.6485 18.6485C10.2971 19 9.73138 19 8.60002 19C6.90298 19 6.05441 19 5.52721 18.4728Z M13 7.4C13 6.26863 13 5.70294 13.3515 5.35147C13.7029 5 14.2686 5 15.4 5C17.0971 5 17.9456 5 18.4728 5.52721C19 6.05442 19 6.90294 19 8.6C19 9.73137 19 10.2971 18.6485 10.6485C18.2971 11 17.7314 11 16.6 11H15.4C14.2686 11 13.7029 11 13.3515 10.6485C13 10.2971 13 9.73137 13 8.6V7.4Z M13.3515 18.6485C13 18.2971 13 17.7314 13 16.6V15.4C13 14.2686 13 13.7029 13.3515 13.3515C13.7029 13 14.2686 13 15.4 13H16.6C17.7314 13 18.2971 13 18.6485 13.3515C19 13.7029 19 14.2686 19 15.4C19 17.097 19 17.9456 18.4728 18.4728C17.9456 19 17.0971 19 15.4 19C14.2687 19 13.7029 19 13.3515 18.6485Z',
    fill: '#FFFFFF',
    scaleX: config.iconScale,
    scaleY: config.iconScale,
    offsetX: 12,
    offsetY: 12,
    listening: false
  });

  settingsButton.add(settingsBg);
  settingsButton.add(settingsIcon);

  settingsButton.on('click tap', (e) => {
    e.cancelBubble = true;
    if (typeof togglePanel === 'function') {
      const pointer = stage.getPointerPosition();
      const containerRect = stage.container().getBoundingClientRect();
      let clientX = e.evt?.clientX ?? (pointer ? containerRect.left + pointer.x : containerRect.left);
      let clientY = e.evt?.clientY ?? (pointer ? containerRect.top + pointer.y : containerRect.top);
      togglePanel({ clientX, clientY });
    }
  });

  layer.add(settingsButton);
  node.konvaState.settingsButton = settingsButton;

  setupButtonHoverEffects(settingsButton, settingsBg, settingsIcon);

  return settingsButton;
}

export function createVerticalAlignButton(node, stage, layer, alignFn) {
  const config = node.konvaState.verticalAlignButtonConfig;

  const button = new Konva.Group({
    x: stage.width() - config.xOffset,
    y: config.yOffset,
    width: config.width,
    height: config.height,
    listening: true,
    name: 'verticalAlignButton',
    draggable: false,
    preventDefault: true
  });

  const bg = new Konva.Circle({
    radius: config.bgRadius,
    fill: 'rgba(0, 0, 0, 0.7)',
    shadowColor: 'rgba(0, 0, 0, 0.5)',
    shadowBlur: 6,
    shadowOffset: { x: 0, y: 2 },
    shadowOpacity: 0.4,
    listening: true
  });

  const icon = new Konva.Path({
    data: 'M1.25 21C1.25 20.5858 1.58579 20.25 2 20.25L22 20.25C22.4142 20.25 22.75 20.5858 22.75 21C22.75 21.4142 22.4142 21.75 22 21.75L2 21.75C1.58579 21.75 1.25 21.4142 1.25 21ZM1.25 3C1.25 2.58579 1.58579 2.25 2 2.25L22 2.25C22.4142 2.25 22.75 2.58579 22.75 3C22.75 3.41421 22.4142 3.75 22 3.75L2 3.75C1.58579 3.75 1.25 3.41421 1.25 3Z M4 12C4 13.8856 4 14.8284 4.58579 15.4142C5.17157 16 6.11438 16 8 16L16 16C17.8856 16 18.8284 16 19.4142 15.4142C20 14.8284 20 13.8856 20 12C20 10.1144 20 9.17157 19.4142 8.58579C18.8284 8 17.8856 8 16 8H8C6.11438 8 5.17157 8 4.58579 8.58579C4 9.17157 4 10.1144 4 12Z',
    fill: '#FFFFFF',
    scaleX: config.iconScale,
    scaleY: config.iconScale,
    offsetX: 12,
    offsetY: 12,
    listening: false
  });

  button.add(bg);
  button.add(icon);

  button.on('click tap', (e) => {
    e.cancelBubble = true;
    if (typeof alignFn === 'function') {
      alignFn(node);
    }
  });

  layer.add(button);
  node.konvaState.verticalAlignButton = button;

  setupButtonHoverEffects(button, bg, icon);

  return button;
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
    bg.fill('rgba(53, 57, 62, 0.85)');
    icon.fill('#FFFFFF');
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
    bg.shadowOffset({ x: 0, y: 2 });
    bg.shadowBlur(6);
    if (layer) {
      layer.batchDraw();
    }
  });

  // 点击效果
  button.on('mousedown touchstart', () => {
    const layer = button.getLayer();
    bg.fill('rgba(53, 57, 62, 0.85)');
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

  if (node.konvaState.settingsButton && node.konvaState.settingsButtonConfig) {
    const settingsConfig = node.konvaState.settingsButtonConfig;
    node.konvaState.settingsButton.x(settingsConfig.xOffset);
    node.konvaState.settingsButton.y(settingsConfig.yOffset);
  }

  if (node.konvaState.verticalAlignButton && node.konvaState.verticalAlignButtonConfig) {
    const config = node.konvaState.verticalAlignButtonConfig;
    node.konvaState.verticalAlignButton.x(stageWidth - config.xOffset);
    node.konvaState.verticalAlignButton.y(config.yOffset);
  }
}
