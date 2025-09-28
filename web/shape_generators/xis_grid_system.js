/**
 * @file xis_grid_system.js
 * @description XIS_CreateShape 节点网格系统模块
 * @author grinlau18
 */

import { log, getGridColor } from './xis_shape_utils.js';

/**
 * 创建网格系统
 * @param {Object} stage - Konva舞台
 * @param {string} backgroundColor - 背景颜色
 * @returns {Object} 网格层和绘制函数
 */
export function createGridSystem(stage, backgroundColor) {
  // 创建网格层
  const gridLayer = new Konva.Layer();
  stage.add(gridLayer);

  /**
   * 绘制网格
   */
  const drawGrid = () => {
    gridLayer.destroyChildren();

    const gridColor = getGridColor(backgroundColor);
    const gridSize = 16; // 16x16 网格
    const width = stage.width();
    const height = stage.height();

    // 绘制水平网格线
    for (let y = gridSize; y < height; y += gridSize) {
      const line = new Konva.Line({
        points: [0, y, width, y],
        stroke: gridColor,
        strokeWidth: 1,
        listening: false,
        name: 'grid'
      });
      gridLayer.add(line);
    }

    // 绘制垂直网格线
    for (let x = gridSize; x < width; x += gridSize) {
      const line = new Konva.Line({
        points: [x, 0, x, height],
        stroke: gridColor,
        strokeWidth: 1,
        listening: false,
        name: 'grid'
      });
      gridLayer.add(line);
    }

    gridLayer.batchDraw();
  };

  // 初始绘制网格
  drawGrid();

  return {
    gridLayer,
    drawGrid
  };
}

/**
 * 更新网格颜色
 * @param {Object} node - 节点实例
 */
export function updateGridColor(node) {
  if (!node.konvaState?.drawGrid) return;

  const properties = node.properties || {};
  const bgColor = properties.bg_color || "#000000";
  const transparentBg = Boolean(properties.transparent_bg);
  const backgroundColor = transparentBg ? 'rgba(0, 0, 0, 0.3)' : bgColor;

  // 重新绘制网格以应用新颜色
  node.konvaState.drawGrid();

  log.info(`Node ${node.id} grid color updated for background: ${backgroundColor}`);
}