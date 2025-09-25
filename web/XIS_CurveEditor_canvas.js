/**
 * @file XIS_CurveEditor_canvas.js
 * @description 画布相关逻辑，包括控件设置、画布绘制和鼠标事件处理，优化性能和交互体验。
 * @author grinlau18
 */

// 日志级别控制
const LOG_LEVEL = "info"; // Options: "info", "warning", "error"

// 节点最小尺寸配置 (与主文件保持一致，方便手动修改)
const MIN_NODE_WIDTH = 400;   // 节点最小宽度 (px)
const MIN_NODE_HEIGHT = 500;  // 节点最小高度 (px)

/**
 * 日志工具
 * @type {Object}
 */
const log = {
  info: (...args) => { if (LOG_LEVEL === "info") console.log(...args); },
  warning: (...args) => { if (LOG_LEVEL === "warning" || LOG_LEVEL === "info") console.warn(...args); },
  error: (...args) => { if (LOG_LEVEL === "error" || LOG_LEVEL === "warning" || LOG_LEVEL === "info") console.error(...args); }
};

/**
 * 防抖函数，使用 requestAnimationFrame 优化性能
 * @param {Function} func - 要防抖的函数
 * @param {number} wait - 等待时间（毫秒）
 * @returns {Function} 防抖后的函数
 */
export function debounce(func, wait) {
  let timeout;
  return function (...args) {
    cancelAnimationFrame(timeout);
    timeout = requestAnimationFrame(() => {
      setTimeout(() => func.apply(this, args), wait);
    });
  };
}

/**
 * 清理已存在的DOM元素
 * @param {Object} node - 节点实例
 */
function cleanupExistingElements(node) {
  if (!node || node.id === -1) return;

  // 清理可能存在的旧DOM元素
  const selectors = [
    `.xiser-curve-node-${node.id}`,
    `.xiser-curve-canvas-container-${node.id}`,
    `.xiser-control-panel-${node.id}`,
    `[data-node-id="${node.id}"]`
  ];

  selectors.forEach(selector => {
    document.querySelectorAll(selector).forEach(el => {
      if (el.parentNode) {
        el.remove();
      }
    });
  });

  log.info(`Node ${node.id} existing DOM elements cleaned up`);
}

/**
 * 清理已存在的widget
 * @param {Object} node - 节点实例
 */
function cleanupExistingWidgets(node) {
  if (!node || !node.widgets) return;

  // 清理可能存在的旧widget
  node.widgets = node.widgets.filter(widget =>
    !widget.name || !widget.name.includes('curve_editor')
  );

  log.info(`Node ${node.id} existing widgets cleaned up`);
}

/**
 * 初始化节点状态
 * @param {Object} node - 节点实例
 */
function initializeNodeState(node) {
  if (!node || node.id === -1) return;

  // 初始化状态 - 使用node.properties存储状态（避免覆盖复制节点的已有状态）
  if (!node.properties.curve_points || !Array.isArray(node.properties.curve_points)) {
    node.properties.curve_points = [
      { x: 0, y: 0 },
      { x: 1, y: 1 }
    ];
  }

  // 临时状态（不序列化）
  node._curveState = node._curveState || {
    draggingPoint: null,
    hoverPoint: null,
    lastUpdateTime: 0,
    initialized: false
  };

  log.info(`Node ${node.id} state initialized`);
}

/**
 * 创建UI元素
 * @param {Object} node - 节点实例
 * @returns {Object} UI元素对象
 */
function createUIElements(node) {
  if (!node || node.id === -1) return null;

  // 创建主容器
  const mainContainer = document.createElement("div");
  mainContainer.className = `xiser-curve-node-${node.id}`;
  mainContainer.dataset.nodeId = node.id.toString();
  mainContainer.style.cssText = `
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.4);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 8px;
    box-sizing: border-box;
    overflow: hidden;
  `;

  // 创建画布容器
  const canvasContainer = document.createElement("div");
  canvasContainer.className = `xiser-curve-canvas-container-${node.id}`;
  canvasContainer.style.cssText = `
    background: rgba(0, 0, 0, 0);
    border-radius: 6px;
    flex: 1;
    max-width: 100%;
    max-height: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
    overflow: hidden;
    position: relative;
    min-height: 300px;
  `;

  // 创建Canvas元素
  const canvas = document.createElement("canvas");
  canvas.id = `curve-canvas-${node.id}`;

  // 设置Canvas固定尺寸
  canvas.width = 400;
  canvas.height = 300;

  canvas.style.cssText = `
    width: 400px;
    height: 300px;
    cursor: crosshair;
    background: rgba(0, 0, 0, 0);
    border-radius: 4px;
  `;

  canvasContainer.appendChild(canvas);
  mainContainer.appendChild(canvasContainer);

  log.info(`Node ${node.id} UI elements created`);
  return { mainContainer, canvasContainer, canvas };
}

/**
 * 创建控制面板
 * @param {Object} node - 节点实例
 * @returns {HTMLElement} 控制面板元素
 */
function createControlPanel(node) {
  if (!node || node.id === -1) return null;

  // 创建控制面板
  const controlPanel = document.createElement("div");
  controlPanel.className = `xiser-control-panel-${node.id}`;
  controlPanel.style.cssText = `
    width: 100%;
    padding: 12px;
    background: rgba(90, 90, 90, 0.15);
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  `;

  // 按钮容器 - 所有按钮放在同一行
  const buttonContainer = document.createElement("div");
  buttonContainer.style.cssText = `
    display: flex;
    gap: 6px;
    justify-content: space-between;
    align-items: center;
    width: 100%;
  `;

  const presets = [
    { name: "线性", type: "linear" },
    { name: "缓入", type: "ease_in" },
    { name: "缓出", type: "ease_out" },
    { name: "缓入出", type: "ease_in_out" }
  ];

  // 创建预设按钮
  presets.forEach(preset => {
    const button = document.createElement("button");
    button.textContent = preset.name;
    button.style.cssText = `
      padding: 6px 10px;
      color: #fff;
      background: #6a6a6a87;
      border: 1px solid #ababab83;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
      font-weight: 500;
      transition: all 0.2s ease;
      min-width: 50px;
      flex: 1;
    `;

    // 添加悬停效果
    button.addEventListener("mouseenter", () => {
      button.style.background = "#6a6a6a87";
      button.style.borderColor = "#ababab83";
      button.style.transform = "translateY(-1px)";
    });
    button.addEventListener("mouseleave", () => {
      button.style.background = "#6a6a6a87";
      button.style.borderColor = "#ababab83";
      button.style.transform = "translateY(0)";
    });

    button.addEventListener("click", () => {
      applyPresetCurve(node, preset.type);
      updateDisplay(node);
      node.setDirtyCanvas(true, true);

      // 触发ComfyUI序列化以保存曲线状态
      if (node.onWidgetChange) {
        node.onWidgetChange();
      }
    });

    buttonContainer.appendChild(button);
  });

  // 重置按钮 - 与其他按钮在同一行
  const resetButton = document.createElement("button");
  resetButton.textContent = "重置";
  resetButton.style.cssText = `
    padding: 6px 10px;
    border: 1px solid #ababab83;
    background: #6a6a6a87;
    color: #fff;
    border-radius: 4px;
    cursor: pointer;
    font-size: 11px;
    font-weight: 600;
    transition: all 0.2s ease;
    min-width: 50px;
    flex: 1;
  `;

  // 添加重置按钮悬停效果
  resetButton.addEventListener("mouseenter", () => {
    resetButton.style.background = "#6a6a6a87";
    resetButton.style.borderColor = "#ababab83";
    resetButton.style.transform = "translateY(-1px)";
  });
  resetButton.addEventListener("mouseleave", () => {
    resetButton.style.background = "#6a6a6a87";
    resetButton.style.borderColor = "#ababab83";
    resetButton.style.transform = "translateY(0)";
  });

  resetButton.addEventListener("click", () => {
    resetCurve(node);
    updateDisplay(node);
    node.setDirtyCanvas(true, true);

    // 触发ComfyUI序列化以保存曲线状态
    if (node.onWidgetChange) {
      node.onWidgetChange();
    }
  });

  buttonContainer.appendChild(resetButton);
  controlPanel.appendChild(buttonContainer);

  log.info(`Node ${node.id} control panel created`);
  return controlPanel;
}

/**
 * 注册DOM控件
 * @param {Object} node - 节点实例
 * @param {HTMLElement} mainContainer - 主容器元素
 * @param {HTMLElement} canvas - Canvas元素
 */
function registerDOMWidget(node, mainContainer, canvas) {
  if (!node || !mainContainer || !canvas) return;

  // 注册DOM控件
  node.addDOMWidget("curve_editor", "Curve Editor", mainContainer, {
    serialize: true,
    hideOnZoom: false,
    getValue: () => {
      try {
        const widgets = node.widgets || [];
        const dataTypeWidget = widgets.find(w => w.name === "data_type");
        const startValueWidget = widgets.find(w => w.name === "start_value");
        const endValueWidget = widgets.find(w => w.name === "end_value");
        const pointCountWidget = widgets.find(w => w.name === "point_count");

        const data = {
          curve_points: (node.properties.curve_points || []).slice(0, 50).map(point => ({
            x: Math.max(0, Math.min(1, typeof point.x === "number" ? point.x : 0)),
            y: Math.max(0, Math.min(1, typeof point.y === "number" ? point.y : 0))
          })),
          data_type: dataTypeWidget ? dataTypeWidget.value : (node.properties.data_type || "FLOAT"),
          start_value: startValueWidget ? startValueWidget.value : (node.properties.start_value || "0"),
          end_value: endValueWidget ? endValueWidget.value : (node.properties.end_value || "1"),
          point_count: pointCountWidget ? Number(pointCountWidget.value) || 10 : (node.properties.point_count || 10),
          node_size: node.properties.node_size || [MIN_NODE_WIDTH, MIN_NODE_HEIGHT],
          node_id: node.id.toString()
        };
        log.info(`Node ${node.id} serialized curve_editor:`, data);
        return data;
      } catch (e) {
        log.error(`Node ${node.id} error in getValue: ${e}`);
        return {
          curve_points: [
            { x: 0, y: 0 },
            { x: 1, y: 1 }
          ],
          data_type: "FLOAT",
          start_value: "0",
          end_value: "1",
          point_count: 10,
          node_size: [MIN_NODE_WIDTH, MIN_NODE_HEIGHT],
          node_id: node.id.toString()
        };
      }
    },
    setValue: (value) => {
      try {
        // Only restore data if it belongs to this node or if no node_id is specified (backward compatibility)
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
        node.properties.node_size = value.node_size && Array.isArray(value.node_size)
          ? [Math.max(value.node_size[0], MIN_NODE_WIDTH), Math.max(value.node_size[1], MIN_NODE_HEIGHT)]
          : [MIN_NODE_WIDTH, MIN_NODE_HEIGHT];

        updateDisplay(node);
        node.setDirtyCanvas(true, true);
        log.info(`Node ${node.id} restored curve editor state`);
      } catch (e) {
        log.error(`Node ${node.id} error in setValue: ${e}`);
      }
    }
  });

  // 保存画布引用
  node.canvas = canvas;
  node.ctx = canvas.getContext('2d');

  log.info(`Node ${node.id} DOM widget registered`);
}

/**
 * 初始化Canvas
 * @param {Object} node - 节点实例
 * @param {HTMLElement} canvas - Canvas元素
 */
function initializeCanvas(node, canvas) {
  if (!node || !canvas || node.id === -1 || node._removed) {
    log.warning(`Node ${node?.id || 'unknown'} is invalid or removed, skipping canvas initialization`);
    return;
  }

  // 简化检查：只检查Canvas元素是否存在
  if (!canvas) {
    log.warning(`Node ${node.id} canvas not found, retrying...`);
    setTimeout(() => initializeCanvas(node, canvas), 100);
    return;
  }

  try {
    // 立即尝试绘制
    updateDisplay(node);

    // 添加延迟重绘确保内容显示
    setTimeout(() => updateDisplay(node), 50);
    setTimeout(() => updateDisplay(node), 200);
    setTimeout(() => updateDisplay(node), 500);

    // 标记为已初始化
    node._curveState.initialized = true;
    log.info(`Node ${node.id} canvas initialization completed`);
  } catch (error) {
    log.error(`Node ${node.id} canvas initialization error:`, error);
    // 即使出错也标记为已初始化，避免无限重试
    node._curveState.initialized = true;
  }
}

/**
 * 设置画布和控件
 * @param {Object} node - 节点实例
 */
export function setupCanvas(node) {
  if (!node || node.id === -1) {
    log.warning(`Invalid node or node.id: ${node?.id}`);
    return;
  }

  log.info(`Node ${node.id} starting setupCanvas`);

  // 1. 清理已存在的元素和widget
  cleanupExistingElements(node);
  cleanupExistingWidgets(node);

  // 2. 初始化节点状态
  initializeNodeState(node);

  // 3. 创建UI元素
  const uiElements = createUIElements(node);
  if (!uiElements) {
    log.error(`Node ${node.id} failed to create UI elements`);
    return;
  }

  const { mainContainer, canvasContainer, canvas } = uiElements;

  // 4. 创建控制面板
  const controlPanel = createControlPanel(node);
  if (controlPanel) {
    mainContainer.appendChild(controlPanel);
  }

  // 5. 注册DOM控件
  registerDOMWidget(node, mainContainer, canvas);

  // 6. 初始化Canvas
  initializeCanvas(node, canvas);

  log.info(`Node ${node.id} setupCanvas completed`);
}

/**
 * 更新画布显示（防抖优化）
 */
export const updateDisplay = debounce((node) => {
  try {
    if (!node || node.id === -1 || node._removed) {
      log.warning(`Node ${node?.id || 'unknown'} is invalid or removed`);
      return;
    }

    // 检查Canvas和上下文是否已初始化
    if (!node.ctx || !node.canvas) {
      log.warning(`Node ${node.id} canvas or context not initialized, attempting to reinitialize`);

      // 尝试重新获取Canvas引用
      const canvasEl = document.querySelector(`#curve-canvas-${node.id}`);
      if (canvasEl) {
        node.canvas = canvasEl;
        node.ctx = canvasEl.getContext('2d');
        log.info(`Node ${node.id} canvas reinitialized`);
      } else {
        log.warning(`Node ${node.id} canvas element not found`);
        return;
      }
    }

    // 检查Canvas尺寸是否有效
    if (node.canvas.width <= 0 || node.canvas.height <= 0) {
      log.warning(`Node ${node.id} canvas has invalid dimensions: ${node.canvas.width}x${node.canvas.height}`);
      return;
    }

    const now = Date.now();
    if (now - node._curveState.lastUpdateTime < 16) { // 限制60fps
      return;
    }
    node._curveState.lastUpdateTime = now;

    drawCurve(node);
  } catch (error) {
    log.error(`Node ${node?.id || 'unknown'} error in updateDisplay:`, error);
  }
}, 16);

/**
 * 绘制曲线和控件
 */
function drawCurve(node) {
  try {
    const ctx = node.ctx;
    const canvas = node.canvas;

    // 验证Canvas和上下文状态
    if (!ctx || !canvas) {
      log.error(`Node ${node.id} invalid canvas or context in drawCurve`);
      return;
    }

    // 验证Canvas尺寸
    if (canvas.width <= 0 || canvas.height <= 0) {
      log.error(`Node ${node.id} invalid canvas dimensions: ${canvas.width}x${canvas.height}`);
      return;
    }

    const width = canvas.width;
    const height = canvas.height;
    const padding = 40;  // 增加边界距离，避免标签被裁剪
    const plotWidth = width - 2 * padding;
    const plotHeight = height - 2 * padding;

  // 清除画布
  ctx.clearRect(0, 0, width, height);

  // 绘制背景 - 使用半透明黑色背景，确保内容可见
  ctx.fillStyle = 'rgba(90, 90, 90, 0.15)';
  ctx.fillRect(0, 0, width, height);

  // 绘制坐标轴
  ctx.strokeStyle = '#666';
  ctx.lineWidth = 2;

  // X轴
  ctx.beginPath();
  ctx.moveTo(padding, height - padding);
  ctx.lineTo(width - padding, height - padding);
  ctx.stroke();

  // Y轴
  ctx.beginPath();
  ctx.moveTo(padding, padding);
  ctx.lineTo(padding, height - padding);
  ctx.stroke();

  // 绘制网格
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1;

  // 水平网格线
  for (let i = 0; i <= 10; i++) {
    const y = padding + i * plotHeight / 10;
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(width - padding, y);
    ctx.stroke();
  }

  // 垂直网格线
  for (let i = 0; i <= 10; i++) {
    const x = padding + i * plotWidth / 10;
    ctx.beginPath();
    ctx.moveTo(x, padding);
    ctx.lineTo(x, height - padding);
    ctx.stroke();
  }

  // 绘制坐标标签
  ctx.fillStyle = '#ccc';
  ctx.font = '12px Arial';
  ctx.textAlign = 'center';

  // X轴标签 - 显示point_count位置 (从1开始)
  // 直接从控件获取值，而不是从属性
  const pointCountWidget = node.widgets?.find(w => w.name === 'point_count');
  const pointCount = pointCountWidget ? parseInt(pointCountWidget.value || 10) : 10;
  log.info(`Drawing X-axis labels: point_count=${pointCount}`);
  for (let i = 0; i <= 5; i++) {
    const x = padding + i * plotWidth / 5;
    const value = Math.round(1 + i * (pointCount - 1) / 5); // 从1开始到point_count
    ctx.fillText(value.toString(), x, height - padding + 15);
  }

  // Y轴标签 - 显示起始值和结束值之间的值
  ctx.textAlign = 'right';
  const dataTypeWidget = node.widgets?.find(w => w.name === 'data_type');
  const dataType = dataTypeWidget ? dataTypeWidget.value : "FLOAT";
  const startValueWidget = node.widgets?.find(w => w.name === 'start_value');
  const endValueWidget = node.widgets?.find(w => w.name === 'end_value');
  const startValue = startValueWidget ? parseFloat(startValueWidget.value || 0) : 0;
  const endValue = endValueWidget ? parseFloat(endValueWidget.value || 1) : 1;
  log.info(`Drawing Y-axis labels: start=${startValue}, end=${endValue}, dataType=${dataType}`);

  for (let i = 0; i <= 5; i++) {
    const y = padding + i * plotHeight / 5;
    let labelText;

    if (dataType === "HEX") {
      // 对于HEX类型，显示百分比
      const percentage = Math.round((1 - i / 5) * 100);
      labelText = `${percentage}%`;
    } else {
      const value = startValue + (endValue - startValue) * (1 - i / 5);
      labelText = value.toFixed(1);
    }

    ctx.fillText(labelText, padding - 10, y + 4);
  }

  // 绘制曲线 - 使用Catmull-Rom样条曲线确保平滑
  ctx.strokeStyle = '#4CAF50';
  ctx.lineWidth = 3;

  if (node.properties.curve_points.length >= 2) {
    ctx.beginPath();

    // 绘制Catmull-Rom样条曲线
    const points = node.properties.curve_points;

    // 起始点
    const firstPoint = points[0];
    const startX = padding + firstPoint.x * plotWidth;
    const startY = padding + (1 - firstPoint.y) * plotHeight;
    ctx.moveTo(startX, startY);

    // 绘制曲线段
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = i > 0 ? points[i - 1] : points[0];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = i < points.length - 2 ? points[i + 2] : points[points.length - 1];

      drawCatmullRomSegment(ctx, p0, p1, p2, p3, padding, plotWidth, plotHeight);
    }

    ctx.stroke();
  }

  // 绘制控制点
  for (let i = 0; i < node.properties.curve_points.length; i++) {
    const point = node.properties.curve_points[i];
    const x = padding + point.x * plotWidth;
    const y = padding + (1 - point.y) * plotHeight;

    // 设置控制点样式
    if (node._curveState.draggingPoint === i) {
      ctx.fillStyle = '#FF5722';
      ctx.strokeStyle = '#fff';
    } else if (node._curveState.hoverPoint === i) {
      ctx.fillStyle = '#2196F3';
      ctx.strokeStyle = '#fff';
    } else {
      ctx.fillStyle = '#4CAF50';
      ctx.strokeStyle = '#fff';
    }

    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();

    // 显示坐标值
    ctx.fillStyle = '#fff';
    ctx.font = '10px Arial';
    ctx.textAlign = 'center';
    const actualX = Math.round(point.x * pointCount);

    // 对于HEX类型，显示百分比而不是数值
    let displayText;
    if (dataType === "HEX") {
      const percentage = Math.round(point.y * 100);
      displayText = `(${actualX}, ${percentage}%)`;
    } else {
      const actualY = startValue + (endValue - startValue) * point.y;
      displayText = `(${actualX}, ${actualY.toFixed(2)})`;
    }
    ctx.fillText(displayText, x, y - 15);
  }

  // 绘制标题
  ctx.fillStyle = '#fff';
  ctx.font = '14px Arial';
  ctx.textAlign = 'center';

  let titleText;
  if (dataType === "HEX") {
    titleText = `曲线编辑器 (X: point_count位置, Y: 0% → 100%)`;
  } else {
    titleText = `曲线编辑器 (X: point_count位置, Y: ${startValue} → ${endValue})`;
  }

  ctx.fillText(titleText, width / 2, 15);
  } catch (error) {
    log.error(`Node ${node.id} error in drawCurve:`, error);
  }
}

/**
 * 绘制优化的Catmull-Rom样条曲线段
 * 简化计算以提高性能，同时保持良好平滑度
 */
function drawCatmullRomSegment(ctx, p0, p1, p2, p3, padding, plotWidth, plotHeight) {
  // 使用固定张力0.5，简化计算
  const tension = 0.5;

  // 简化的控制点计算（避免复杂的距离计算）
  const d1x = (p2.x - p0.x) * tension;
  const d1y = (p2.y - p0.y) * tension;
  const d2x = (p3.x - p1.x) * tension;
  const d2y = (p3.y - p1.y) * tension;

  // 将参数空间坐标转换为画布坐标
  const x1 = padding + p1.x * plotWidth;
  const y1 = padding + (1 - p1.y) * plotHeight;
  const x2 = padding + p2.x * plotWidth;
  const y2 = padding + (1 - p2.y) * plotHeight;

  const cp1x = padding + (p1.x + d1x / 3) * plotWidth;
  const cp1y = padding + (1 - (p1.y + d1y / 3)) * plotHeight;
  const cp2x = padding + (p2.x - d2x / 3) * plotWidth;
  const cp2y = padding + (1 - (p2.y - d2y / 3)) * plotHeight;

  // 绘制贝塞尔曲线段
  ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x2, y2);
}

/**
 * 设置输入监听器
 */
export function setupInputListeners(node) {
  if (!node || !node.canvas) {
    log.warning(`Node ${node?.id || 'unknown'} canvas not initialized`);
    return;
  }

  // 添加鼠标事件监听 - 使用内联处理函数避免引用冲突
  node.canvas.addEventListener("mousedown", (e) => onCanvasMouseDown(node, e));
  node.canvas.addEventListener("mousemove", (e) => onCanvasMouseMove(node, e));
  node.canvas.addEventListener("mouseup", () => onCanvasMouseUp(node));
  node.canvas.addEventListener("contextmenu", (e) => onCanvasRightClick(node, e));

  log.info(`Node ${node.id} input listeners setup completed`);
}

/**
 * 处理画布鼠标按下事件
 */
export function onCanvasMouseDown(node, e) {
  if (e.button !== 0) return;
  if (!node || node.id === -1 || !node.canvas) {
    log.warning(`Node ${node?.id || 'unknown'} canvas not initialized`);
    return;
  }

  const rect = node.canvas.getBoundingClientRect();
  const padding = 30;  // 增加边界距离，避免标签被裁剪
  const plotWidth = node.canvas.width - 2 * padding;
  const plotHeight = node.canvas.height - 2 * padding;

  // 精确计算鼠标在绘图区域内的坐标（使用调试工具验证的正确方法）
  const scaleX = node.canvas.width / rect.width;
  const scaleY = node.canvas.height / rect.height;
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  // 计算实际像素坐标
  const pixelX = mouseX * scaleX;
  const pixelY = mouseY * scaleY;

  // 转换为绘图区域内的归一化坐标
  const x = Math.max(0, Math.min(1, (pixelX - padding) / plotWidth));
  const y = Math.max(0, Math.min(1, 1 - (pixelY - padding) / plotHeight)); // 反转Y轴，使向上移动对应数值增加

  if (x < 0 || x > 1 || y < 0 || y > 1) return;

  node._curveState.draggingPoint = null;
  const selectionRadius = 15 / Math.min(plotWidth, plotHeight);

  // 查找最近的控制点
  for (let i = 0; i < node.properties.curve_points.length; i++) {
    const point = node.properties.curve_points[i];
    const dx = point.x - x;
    const dy = point.y - y;
    if (Math.sqrt(dx * dx + dy * dy) < selectionRadius) {
      node._curveState.draggingPoint = i;
      log.info(`Node ${node.id} started dragging point ${i + 1}`);
      break;
    }
  }

  // 如果没有选中现有点，在曲线上添加新点
  if (node._curveState.draggingPoint === null) {
    // 找到最近的线段
    const closestSegment = findClosestSegment(node.properties.curve_points, x, y);
    if (closestSegment.index !== -1) {
      const newPoint = { x: x, y: y };
      node.properties.curve_points.splice(closestSegment.index + 1, 0, newPoint);
      node._curveState.draggingPoint = closestSegment.index + 1;
      log.info(`Node ${node.id} added new control point at: ${x}, ${y}`);
    }
  }

  updateDisplay(node);
  node.setDirtyCanvas(true, true);

  // 触发ComfyUI序列化以保存曲线状态
  if (node.onWidgetChange) {
    node.onWidgetChange();
  }
}

/**
 * 找到最近的线段
 */
function findClosestSegment(points, targetX, targetY) {
  let closestIndex = -1;
  let minDistance = Infinity;

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];

    // 计算点到线段的距离
    const distance = pointToSegmentDistance(targetX, targetY, p1.x, p1.y, p2.x, p2.y);

    if (distance < minDistance && distance < 0.05) { // 距离阈值
      minDistance = distance;
      closestIndex = i;
    }
  }

  return { index: closestIndex, distance: minDistance };
}

/**
 * 计算点到线段的距离
 */
function pointToSegmentDistance(px, py, x1, y1, x2, y2) {
  const A = px - x1;
  const B = py - y1;
  const C = x2 - x1;
  const D = y2 - y1;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;

  if (lenSq !== 0) param = dot / lenSq;

  let xx, yy;

  if (param < 0) {
    xx = x1;
    yy = y1;
  } else if (param > 1) {
    xx = x2;
    yy = y2;
  } else {
    xx = x1 + param * C;
    yy = y1 + param * D;
  }

  const dx = px - xx;
  const dy = py - yy;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 处理画布鼠标移动事件
 */
export function onCanvasMouseMove(node, e) {
  if (!node || node.id === -1 || node._curveState.draggingPoint === null || !node.canvas || !(e.buttons & 1)) return;

  const rect = node.canvas.getBoundingClientRect();
  const padding = 30;  // 增加边界距离，避免标签被裁剪
  const plotWidth = node.canvas.width - 2 * padding;
  const plotHeight = node.canvas.height - 2 * padding;

  // 精确计算鼠标在绘图区域内的坐标（使用调试工具验证的正确方法）
  const scaleX = node.canvas.width / rect.width;
  const scaleY = node.canvas.height / rect.height;
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  // 计算实际像素坐标
  const pixelX = mouseX * scaleX;
  const pixelY = mouseY * scaleY;

  let x = Math.max(0, Math.min(1, (pixelX - padding) / plotWidth));
  let y = Math.max(0, Math.min(1, 1 - (pixelY - padding) / plotHeight)); // 反转Y轴

  // 边缘吸附
  const snapThreshold = 10 / Math.min(node.canvas.width, node.canvas.height);
  if (x < snapThreshold) x = 0;
  else if (x > 1 - snapThreshold) x = 1;
  if (y < snapThreshold) y = 0;
  else if (y > 1 - snapThreshold) y = 1;

  x = Math.max(0, Math.min(1, x));
  y = Math.max(0, Math.min(1, y));

  if (node._curveState.draggingPoint < node.properties.curve_points.length) {
    const pointIndex = node._curveState.draggingPoint;

    // 首尾点只能垂直移动，不能水平移动
    if (pointIndex === 0 || pointIndex === node.properties.curve_points.length - 1) {
      node.properties.curve_points[pointIndex].y = y;
    } else {
      // 中间点可以自由移动，但要保持X轴顺序
      node.properties.curve_points[pointIndex].x = x;
      node.properties.curve_points[pointIndex].y = y;

      // 保持X轴排序
      node.properties.curve_points.sort((a, b) => a.x - b.x);

      // 更新拖拽点索引（排序后可能改变）
      const draggedPoint = node.properties.curve_points.find(p =>
        Math.abs(p.x - x) < 0.001 && Math.abs(p.y - y) < 0.001
      );
      if (draggedPoint) {
        node._curveState.draggingPoint = node.properties.curve_points.indexOf(draggedPoint);
      }
    }

    updateDisplay(node);
    node.setDirtyCanvas(true, true);

    // 触发ComfyUI序列化以保存曲线状态
    if (node.onWidgetChange) {
      node.onWidgetChange();
    }
  }
}

/**
 * 处理画布鼠标释放事件
 */
export function onCanvasMouseUp(node) {
  if (node._curveState.draggingPoint !== null) {
    log.info(`Node ${node.id} stopped dragging point ${node._curveState.draggingPoint + 1}`);
  }
  node._curveState.draggingPoint = null;
}

/**
 * 处理画布右键点击事件 - 删除控制点
 */
export function onCanvasRightClick(node, e) {
  e.preventDefault();

  if (!node || node.id === -1 || !node.canvas) return;

  const rect = node.canvas.getBoundingClientRect();
  const padding = 30;  // 增加边界距离，避免标签被裁剪
  const plotWidth = node.canvas.width - 2 * padding;
  const plotHeight = node.canvas.height - 2 * padding;

  // 精确计算鼠标在绘图区域内的坐标（使用调试工具验证的正确方法）
  const scaleX = node.canvas.width / rect.width;
  const scaleY = node.canvas.height / rect.height;
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  // 计算实际像素坐标
  const pixelX = mouseX * scaleX;
  const pixelY = mouseY * scaleY;

  const x = Math.max(0, Math.min(1, (pixelX - padding) / plotWidth));
  const y = Math.max(0, Math.min(1, 1 - (pixelY - padding) / plotHeight)); // 反转Y轴

  const selectionRadius = 15 / Math.min(plotWidth, plotHeight);
  let pointIndex = -1;

  // 查找最近的控制点
  for (let i = 0; i < node.properties.curve_points.length; i++) {
    const point = node.properties.curve_points[i];
    const dx = point.x - x;
    const dy = point.y - y;
    if (Math.sqrt(dx * dx + dy * dy) < selectionRadius) {
      pointIndex = i;
      break;
    }
  }

  // 删除控制点（至少保留2个点，且不能删除首尾点）
  if (pointIndex !== -1 &&
      node.properties.curve_points.length > 2 &&
      pointIndex !== 0 &&
      pointIndex !== node.properties.curve_points.length - 1) {
    node.properties.curve_points.splice(pointIndex, 1);
    updateDisplay(node);
    node.setDirtyCanvas(true, true);

    // 触发ComfyUI序列化以保存曲线状态
    if (node.onWidgetChange) {
      node.onWidgetChange();
    }

    log.info(`Node ${node.id} deleted control point ${pointIndex + 1}`);
  }
}

/**
 * 应用预设曲线
 */
function applyPresetCurve(node, presetType) {
  // 确保首尾点位置固定
  const startPoint = { x: 0, y: 0 };
  const endPoint = { x: 1, y: 1 };

  let points = [startPoint, endPoint];

  switch (presetType) {
    case "linear":
      // 线性曲线只有首尾点
      break;
    case "ease_in":
      // 缓入：开始时极其缓慢，逐渐加速 - 使用1个关键中间点
      // 控制点设计原理：单个点位于左下角，引导曲线形成自然弧度
      points.splice(1, 0, { x: 0.4, y: 0.15 });
      points.splice(2, 0, { x: 0.8, y: 0.55 });
      break;
    case "ease_out":
      // 缓出：开始时快速，逐渐减速 - 使用1个关键中间点
      // 控制点设计原理：单个点位于右上角，引导曲线形成自然弧度
      points.splice(1, 0, { x: 0.2, y: 0.45 });
      points.splice(2, 0, { x: 0.6, y: 0.85 });
      break;
    case "ease_in_out":
      // 缓入出：对称的S形曲线 - 使用2个中间点生成流畅S形曲线
      // 控制点设计原理：两个点对称分布，形成自然的S形
      points.splice(1, 0, { x: 0.25, y: 0.15 });
      points.splice(2, 0, { x: 0.75, y: 0.85 });
      break;
  }

  // 确保点按X坐标排序
  points.sort((a, b) => a.x - b.x);

  node.properties.curve_points = points;
  log.info(`Node ${node.id} applied ${presetType} preset`);
}

/**
 * 重置曲线
 */
function resetCurve(node) {
  node.properties.curve_points = [
    { x: 0, y: 0 },
    { x: 1, y: 1 }
  ];
  log.info(`Node ${node.id} curve reset`);
}

/**
 * 更新画布大小
 */
export function updateCanvasSize(node) {
  if (!node.canvas) return;

  // 保持固定尺寸
  node.canvas.width = 400;
  node.canvas.height = 300;

  // 强制重绘以确保内容显示
  updateDisplay(node);

  // 添加延迟重绘确保显示
  setTimeout(() => {
    updateDisplay(node);
  }, 100);

  log.info(`Node ${node.id} canvas size updated with forced redraw`);
}