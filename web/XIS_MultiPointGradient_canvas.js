/**
 * @file XIS_MultiPointGradient_canvas.js
 * @description 画布相关逻辑，包括控件设置、画布绘制和鼠标事件处理，支持 linear 模式控制点缓存。
 * @author grinlau18
 */

/**
 * 日志工具
 * @type {Object}
 */
const log = {
  info: (...args) => { if (LOG_LEVEL === "info") console.log(...args); },
  warning: (...args) => { if (LOG_LEVEL === "warning" || LOG_LEVEL === "info") console.warn(...args); },
  error: (...args) => { if (LOG_LEVEL === "error" || LOG_LEVEL === "warning" || LOG_LEVEL === "info") console.error(...args); }
};

// 日志级别控制
const LOG_LEVEL = "error"; // Options: "info", "warning", "error"

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
 * 十六进制颜色转 RGB
 * @param {string} hex - 十六进制颜色（如 "#ff0000" 或 "ff0000"）
 * @returns {number[]} RGB 数组 [r, g, b]
 */
export function hexToRgb(hex) {
  hex = hex.replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    log.warning(`Invalid hex color: ${hex}, using default white`);
    return [255, 255, 255];
  }
  try {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  } catch (e) {
    log.error(`Error parsing hex color ${hex}: ${e}`);
    return [255, 255, 255];
  }
}

/**
 * 计算补色
 * @param {string} hex - 十六进制颜色（如 "#ff0000" 或 "ff0000"）
 * @returns {string} 补色的十六进制值（如 "#00ffff"）
 */
export function complementaryColor(hex) {
  const rgb = hexToRgb(hex);
  const compRgb = rgb.map(v => 255 - v);
  return `#${compRgb.map(c => c.toString(16).padStart(2, '0')).join('')}`;
}


/**
 * 优化的径向基函数 (RBF) 插值
 * 使用高斯核函数，性能优于IDW
 */
function rbfInterpolation(x, y, points, sigma = 0.1) {
  let numeratorR = 0, numeratorG = 0, numeratorB = 0;
  let denominator = 0;
  
  for (const point of points) {
    const px = point.x;
    const py = point.y;
    const influence = point.influence || 1.0;
    
    // 高斯核函数，比IDW的倒数平方更高效
    const distance = Math.sqrt(Math.pow(x - px, 2) + Math.pow(y - py, 2));
    const weight = Math.exp(-distance * distance / (2 * sigma * sigma * influence * influence));
    
    const rgb = hexToRgb(point.color);
    numeratorR += rgb[0] * weight;
    numeratorG += rgb[1] * weight;
    numeratorB += rgb[2] * weight;
    denominator += weight;
  }
  
  if (denominator === 0) return [255, 255, 255];
  
  return [
    Math.round(numeratorR / denominator),
    Math.round(numeratorG / denominator),
    Math.round(numeratorB / denominator)
  ];
}

/**
 * 设置画布控件
 * @param {Object} node - 节点实例
 */
export function setupCanvas(node) {
  log.info(`Node ${node.id} setting up canvas`);

  // 初始化属性
  node.properties = node.properties || {};
  // 初始化所有模式的缓存
  if (!node.properties.linear_cache) {
    node.properties.linear_cache = [
      { x: 0.2, y: 0.2, color: "#ff0000", influence: 1.0 },
      { x: 0.8, y: 0.8, color: "#0000ff", influence: 1.0 }
    ];
    log.info(`Node ${node.id} initialized default linear_cache`);
  }
  if (!node.properties.other_modes_cache) {
    node.properties.other_modes_cache = [
      { x: 0.2, y: 0.2, color: "#ff0000", influence: 1.0 },
      { x: 0.8, y: 0.8, color: "#0000ff", influence: 1.0 }
    ];
    log.info(`Node ${node.id} initialized default other_modes_cache`);
  }
  // 初始化控制点
  if (!node.properties.control_points || node.properties.control_points.length === 0) {
    if (node.properties.interpolation === "linear") {
      node.properties.control_points = node.properties.linear_cache.slice();
      log.info(`Node ${node.id} initialized control_points from linear_cache`);
    } else {
      node.properties.control_points = node.properties.other_modes_cache.slice();
      log.info(`Node ${node.id} initialized control_points from other_modes_cache`);
    }
  }

  // 创建主容器
  const mainContainer = document.createElement("div");
  mainContainer.className = `xiser-gradient-container xiser-gradient-node xiser-gradient-node-${node.id}`;
  mainContainer.dataset.nodeId = node.id.toString();

  // 创建错误消息显示
  node.errorMessage = document.createElement("div");
  node.errorMessage.className = `xiser-error-message xiser-error-message-${node.id}`;
  mainContainer.appendChild(node.errorMessage);

  // 创建加载动画
  node.loadingSpinner = document.createElement("div");
  node.loadingSpinner.className = `xiser-loading-spinner xiser-loading-spinner-${node.id}`;
  mainContainer.appendChild(node.loadingSpinner);

  // 创建画布容器
  const canvasContainer = document.createElement("div");
  canvasContainer.className = `xiser-gradient-canvas-container xiser-gradient-canvas-container-${node.id}`;
  node.canvas = document.createElement("canvas");
  node.canvas.className = `xiser-gradient-canvas xiser-gradient-canvas-${node.id}`;
  node.canvas.style.display = "block";
  canvasContainer.appendChild(node.canvas);
  mainContainer.appendChild(canvasContainer);
  node.ctx = node.canvas.getContext("2d");

  // 创建帮助图标
  const helpIcon = document.createElement("div");
  helpIcon.className = `xiser-help-icon-${node.id}`;
  helpIcon.style.cssText = `
    position: absolute;
    top: 8px;
    right: 8px;
    width: 20px;
    height: 20px;
    background: #000;
    border-radius: 50%;
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    cursor: pointer;
    user-select: none;
  `;
  helpIcon.innerText = "?";
  helpIcon.addEventListener("click", () => {
    const helpText = document.createElement("div");
    helpText.className = `xiser-help-text-${node.id}`;
    helpText.style.cssText = `
      position: absolute;
      top: 32px;
      right: 8px;
      background: #333;
      color: #fff;
      padding: 8px;
      border-radius: 4px;
      border: 1px solid #555;
      font-size: 12px;
      z-index: 1000;
      max-width: 300px;
      text-align: left;
    `;
    helpText.innerHTML = `
      <strong>操作说明 / Instructions:</strong><br>
      1. 使用鼠标左键点击图片区域来增加控制点。<br>
      2. 双击控制点，可以指定颜色；点击鼠标右键弹出菜单，可以复制和删除控制点。<br>
      3. 在 linear 模式下，1号和2号控制点定义渐变方向连线，可自由移动；其他控制点（3号及以上）需在连线上添加和移动。<br>
      <br>
      1. Click the image area with the left mouse button to add a control point.<br>
      2. Double-click a control point to set its color; right-click to open a menu to copy or delete the control point.<br>
      3. In linear mode, points 1 and 2 define the gradient line and can move freely; other points (3 and above) must be added and moved along the line.
    `;
    canvasContainer.appendChild(helpText);
    const closeHelp = () => {
      helpText.remove();
      document.removeEventListener("click", closeHelp);
    };
    setTimeout(() => document.addEventListener("click", closeHelp), 0);
    // Store the closeHelp function for cleanup
    node._closeHelpHandler = closeHelp;
  });
  canvasContainer.appendChild(helpIcon);

  // 注册画布控件
  node.addDOMWidget("gradient_canvas", "Gradient Canvas", mainContainer, {
    serialize: true,
    hideOnZoom: false,
    getValue: () => {
      try {
        const widgets = node.widgets || [];
        const widthWidget = widgets.find(w => w.name === "width");
        const heightWidget = widgets.find(w => w.name === "height");
        const interpolationWidget = widgets.find(w => w.name === "interpolation");
        
        const data = {
          control_points: (node.properties.control_points || []).slice(0, 50).map(point => ({
            x: Math.max(0, Math.min(1, typeof point.x === "number" ? point.x : 0.5)),
            y: Math.max(0, Math.min(1, typeof point.y === "number" ? point.y : 0.5)),
            color: typeof point.color === "string" && /^[0-9a-fA-F]{6}$/.test(point.color.replace(/^#/, ""))
              ? point.color
              : "#ffffff",
            influence: Math.max(0.5, Math.min(2.0, typeof point.influence === "number" ? point.influence : 1.0)),
          })),
          linear_cache: (node.properties.linear_cache || []).slice(0, 50).map(point => ({
            x: Math.max(0, Math.min(1, typeof point.x === "number" ? point.x : 0.5)),
            y: Math.max(0, Math.min(1, typeof point.y === "number" ? point.y : 0.5)),
            color: typeof point.color === "string" && /^[0-9a-fA-F]{6}$/.test(point.color.replace(/^#/, ""))
              ? point.color
              : "#ffffff",
            influence: Math.max(0.5, Math.min(2.0, typeof point.influence === "number" ? point.influence : 1.0)),
          })),
          other_modes_cache: (node.properties.other_modes_cache || []).slice(0, 50).map(point => ({
            x: Math.max(0, Math.min(1, typeof point.x === "number" ? point.x : 0.5)),
            y: Math.max(0, Math.min(1, typeof point.y === "number" ? point.y : 0.5)),
            color: typeof point.color === "string" && /^[0-9a-fA-F]{6}$/.test(point.color.replace(/^#/, ""))
              ? point.color
              : "#ffffff",
            influence: Math.max(0.5, Math.min(2.0, typeof point.influence === "number" ? point.influence : 1.0)),
          })),
          width: widthWidget ? Number(widthWidget.value) || 512 : (node.properties.width || 512),
          height: heightWidget ? Number(heightWidget.value) || 512 : (node.properties.height || 512),
          interpolation: interpolationWidget ? interpolationWidget.value : (node.properties.interpolation || "idw"),
          node_size: node.properties.node_size || [360, 510],
          node_id: node.id.toString(),
        };
        log.info(`Node ${node.id} serialized gradient_canvas:`, data);
        return data;
      } catch (e) {
        log.error(`Node ${node.id} error in getValue: ${e}`);
        return {
          control_points: [
            { x: 0.2, y: 0.2, color: "#ff0000", influence: 1.0 },
            { x: 0.8, y: 0.8, color: "#0000ff", influence: 1.0 }
          ],
          linear_cache: [
            { x: 0.2, y: 0.2, color: "#ff0000", influence: 1.0 },
            { x: 0.8, y: 0.8, color: "#0000ff", influence: 1.0 }
          ],
          other_modes_cache: [
            { x: 0.2, y: 0.2, color: "#ff0000", influence: 1.0 },
            { x: 0.8, y: 0.8, color: "#0000ff", influence: 1.0 }
          ],
          width: node.properties.width || 512,
          height: node.properties.height || 512,
          interpolation: node.properties.interpolation || "idw",
          node_size: node.properties.node_size || [360, 510],
          node_id: node.id.toString(),
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

        node.properties.control_points = (value.control_points && Array.isArray(value.control_points)
          ? value.control_points.slice(0, 50).map(point => ({
              x: Math.max(0, Math.min(1, typeof point.x === "number" ? point.x : 0.5)),
              y: Math.max(0, Math.min(1, typeof point.y === "number" ? point.y : 0.5)),
              color: typeof point.color === "string" && /^[0-9a-fA-F]{6}$/.test(point.color.replace(/^#/, ""))
                ? point.color
                : "#ffffff",
              influence: Math.max(0.5, Math.min(2.0, typeof point.influence === "number" ? point.influence : 1.0)),
            }))
          : [
              { x: 0.2, y: 0.2, color: "#ff0000", influence: 1.0 },
              { x: 0.8, y: 0.8, color: "#0000ff", influence: 1.0 }
            ]);
        node.properties.linear_cache = (value.linear_cache && Array.isArray(value.linear_cache)
          ? value.linear_cache.slice(0, 50).map(point => ({
              x: Math.max(0, Math.min(1, typeof point.x === "number" ? point.x : 0.5)),
              y: Math.max(0, Math.min(1, typeof point.y === "number" ? point.y : 0.5)),
              color: typeof point.color === "string" && /^[0-9a-fA-F]{6}$/.test(point.color.replace(/^#/, ""))
                ? point.color
                : "#ffffff",
              influence: Math.max(0.5, Math.min(2.0, typeof point.influence === "number" ? point.influence : 1.0)),
            }))
          : [
              { x: 0.2, y: 0.2, color: "#ff0000", influence: 1.0 },
              { x: 0.8, y: 0.8, color: "#0000ff", influence: 1.0 }
            ]);
        node.properties.other_modes_cache = (value.other_modes_cache && Array.isArray(value.other_modes_cache)
          ? value.other_modes_cache.slice(0, 50).map(point => ({
              x: Math.max(0, Math.min(1, typeof point.x === "number" ? point.x : 0.5)),
              y: Math.max(0, Math.min(1, typeof point.y === "number" ? point.y : 0.5)),
              color: typeof point.color === "string" && /^[0-9a-fA-F]{6}$/.test(point.color.replace(/^#/, ""))
                ? point.color
                : "#ffffff",
              influence: Math.max(0.5, Math.min(2.0, typeof point.influence === "number" ? point.influence : 1.0)),
            }))
          : [
              { x: 0.2, y: 0.2, color: "#ff0000", influence: 1.0 },
              { x: 0.8, y: 0.8, color: "#0000ff", influence: 1.0 }
            ]);
        node.properties.width = Math.max(1, Math.min(4096, Math.floor(value.width || 512)));
        node.properties.height = Math.max(1, Math.min(4096, Math.floor(value.height || 512)));
        node.properties.interpolation = value.interpolation && ["idw", "radial", "voronoi", "idw(soft)", "linear"].includes(value.interpolation)
          ? value.interpolation
          : "idw";
        node.properties.node_size = value.node_size && Array.isArray(value.node_size)
          ? [Math.max(value.node_size[0], 360), Math.max(value.node_size[1], 510)]
          : [360, 510];
        node.setSize([node.properties.node_size[0], node.properties.node_size[1]]);
        updateCanvasSize(node);
        updateDisplay(node);
        node.setDirtyCanvas(true, true);
        if (node.errorMessage) {
          node.errorMessage.style.display = "none";
        }
        log.info(`Node ${node.id} restored canvas state`);
      } catch (e) {
        log.error(`Node ${node.id} error in setValue: ${e}`);
        if (node.errorMessage) {
          node.errorMessage.innerText = `Error restoring state: ${e.message}`;
          node.errorMessage.style.display = "block";
          setTimeout(() => node.errorMessage.style.display = "none", 3000);
        }
      }
    },
  });

  // 添加鼠标事件监听
  node.canvas.addEventListener("mousedown", (e) => onCanvasMouseDown(node, e));
  node.canvas.addEventListener("mousemove", (e) => onCanvasMouseMove(node, e));
  node.canvas.addEventListener("mouseup", () => onCanvasMouseUp(node));
  node.canvas.addEventListener("dblclick", (e) => onCanvasDblClick(node, e));
  node.canvas.addEventListener("contextmenu", (e) => onCanvasRightClick(node, e));
  node.canvas.addEventListener("wheel", (e) => onCanvasWheel(node, e));

  // 立即更新画布显示
  updateCanvasSize(node);
  updateDisplay(node);
}

/**
 * 更新画布大小
 * @param {Object} node - 节点实例
 */
export function updateCanvasSize(node) {
  if (!node || node.id === -1 || !node.canvas || !node.ctx || !node.canvas.parentElement) {
    log.warning(`Node ${node?.id || 'unknown'} canvas or context not initialized`);
    return;
  }

  const canvasContainer = node.canvas.parentElement;
  const nodeWidth = node.size[0] || 360;
  const nodeHeight = node.size[1] || 510;

  // 获取输入值
  const widgets = node.widgets || [];
  const widthWidget = widgets.find(w => w.name === "width");
  const heightWidget = widgets.find(w => w.name === "height");
  node.properties.width = widthWidget ? Number(widthWidget.value) || 512 : 512;
  node.properties.height = heightWidget ? Number(heightWidget.value) || 512 : 512;

  // 计算控件区域高度
  const widgetHeight = widgets
    .filter(w => w.type === "number" || w.type === "combo")
    .reduce((sum, w) => sum + (w.element?.getBoundingClientRect().height || 30), 0);

  const availableWidth = nodeWidth - 16;
  const availableHeight = Math.max(100, nodeHeight - widgetHeight - 16);

  const aspectRatio = node.properties.width / node.properties.height;
  let canvasWidth, canvasHeight;

  if (availableHeight * aspectRatio <= availableWidth) {
    canvasHeight = availableHeight;
    canvasWidth = Math.round(canvasHeight * aspectRatio);
  } else {
    canvasWidth = availableWidth;
    canvasHeight = Math.round(canvasWidth / aspectRatio);
  }

  canvasWidth = Math.max(1, Math.floor(canvasWidth));
  canvasHeight = Math.max(1, Math.floor(canvasHeight));

  node.canvas.width = canvasWidth;
  node.canvas.height = canvasHeight;
  node.canvas.style.width = `${canvasWidth}px`;
  node.canvas.style.height = `${canvasHeight}px`;

  // 创建或更新 OffscreenCanvas
  if (!node.offscreenCanvas || node.offscreenCanvas.width !== canvasWidth || node.offscreenCanvas.height !== canvasHeight) {
    try {
      node.offscreenCanvas = new OffscreenCanvas(canvasWidth, canvasHeight);
      log.info(`Node ${node.id} created OffscreenCanvas: ${canvasWidth}x${canvasHeight}`);
    } catch (e) {
      log.error(`Node ${node.id} failed to create OffscreenCanvas: ${e}`);
      if (node.errorMessage) {
        node.errorMessage.innerText = `Failed to create canvas: ${e.message}`;
        node.errorMessage.style.display = "block";
        setTimeout(() => node.errorMessage.style.display = "none", 3000);
      }
      canvasWidth = 512;
      canvasHeight = 512;
      node.canvas.width = canvasWidth;
      node.canvas.height = canvasHeight;
      node.canvas.style.width = `${canvasWidth}px`;
      node.canvas.style.height = `${canvasHeight}px`;
      node.offscreenCanvas = new OffscreenCanvas(canvasWidth, canvasHeight);
    }
  }

  updateDisplay(node);
}

/**
 * 监听输入控件变化
 * @param {Object} node - 节点实例
 */
export function setupInputListeners(node) {
  const widgets = node.widgets || [];
  const widthWidget = widgets.find(w => w.name === "width");
  const heightWidget = widgets.find(w => w.name === "height");
  const interpolationWidget = widgets.find(w => w.name === "interpolation");

  if (widthWidget) {
    widthWidget.callback = () => {
      node.properties.width = Number(widthWidget.value) || 512;
      updateCanvasSize(node);
      updateDisplay(node);
      node.setDirtyCanvas(true, true);
      log.info(`Node ${node.id} width updated to: ${node.properties.width}`);
    };
  }

  if (heightWidget) {
    heightWidget.callback = () => {
      node.properties.height = Number(heightWidget.value) || 512;
      updateCanvasSize(node);
      updateDisplay(node);
      node.setDirtyCanvas(true, true);
      log.info(`Node ${node.id} height updated to: ${node.properties.height}`);
    };
  }

  if (interpolationWidget) {
    interpolationWidget.callback = () => {
      const newInterpolation = interpolationWidget.value;
      const oldInterpolation = node.properties.interpolation;
      
      // 保存当前模式的状态到对应的缓存
      if (oldInterpolation === "linear") {
        // 从 linear 模式切换到其他模式，保存 linear 状态
        node.properties.linear_cache = node.properties.control_points.slice().map(point => ({
          x: point.x,
          y: point.y,
          color: point.color,
          influence: point.influence
        }));
        log.info(`Node ${node.id} saved linear mode control points to linear_cache`);
      } else {
        // 从其他模式切换到其他模式或 linear 模式，保存其他模式状态
        node.properties.other_modes_cache = node.properties.control_points.slice().map(point => ({
          x: point.x,
          y: point.y,
          color: point.color,
          influence: point.influence
        }));
        log.info(`Node ${node.id} saved other modes control points to other_modes_cache`);
      }
      
      // 恢复目标模式的状态
      if (newInterpolation === "linear") {
        // 切换到 linear 模式，恢复 linear_cache 中的控制点
        node.properties.control_points = (node.properties.linear_cache && node.properties.linear_cache.length >= 2)
          ? node.properties.linear_cache.slice()
          : [
              { x: 0.2, y: 0.2, color: "#ff0000", influence: 1.0 },
              { x: 0.8, y: 0.8, color: "#0000ff", influence: 1.0 }
            ];
        log.info(`Node ${node.id} restored control points for linear mode`);
      } else {
        // 切换到其他模式，恢复 other_modes_cache 中的控制点
        node.properties.control_points = (node.properties.other_modes_cache && node.properties.other_modes_cache.length > 0)
          ? node.properties.other_modes_cache.slice()
          : [
              { x: 0.2, y: 0.2, color: "#ff0000", influence: 1.0 },
              { x: 0.8, y: 0.8, color: "#0000ff", influence: 1.0 }
            ];
        log.info(`Node ${node.id} restored control points for other modes`);
      }
      
      node.properties.interpolation = newInterpolation;
      updateDisplay(node);
      node.setDirtyCanvas(true, true);
      log.info(`Node ${node.id} interpolation updated from ${oldInterpolation} to: ${newInterpolation}`);
    };
  }
}

/**
 * 投影点到直线上的函数
 * @param {number} x - 点的 x 坐标
 * @param {number} y - 点的 y 坐标
 * @param {number} x1 - 直线起点 x
 * @param {number} y1 - 直线起点 y
 * @param {number} x2 - 直线终点 x
 * @param {number} y2 - 直线终点 y
 * @returns {Object} 投影点坐标 {x, y} 和 t 参数
 */
function projectPointToLine(x, y, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSquared = dx * dx + dy * dy;
  if (lenSquared < 1e-6) return { x: x1, y: y1, t: 0 }; // 防止除零
  let t = ((x - x1) * dx + (y - y1) * dy) / lenSquared;
  t = Math.max(0, Math.min(1, t));
  return {
    x: x1 + t * dx,
    y: y1 + t * dy,
    t: t
  };
}

/**
 * 更新画布显示
 * @param {Object} node - 节点实例
 * @param {Object} [message] - 执行结果
 */
export const updateDisplay = debounce((node, message) => {
  if (!node || node.id === -1 || !node.ctx || !node.canvas || !node.offscreenCanvas) {
    log.warning(`Node ${node?.id || 'unknown'} canvas or context not initialized`);
    return;
  }

  const startTime = performance.now();

  // 获取输入值
  const widgets = node.widgets || [];
  const widthWidget = widgets.find(w => w.name === "width");
  const heightWidget = widgets.find(w => w.name === "height");
  const interpolationWidget = widgets.find(w => w.name === "interpolation");

  node.properties.width = widthWidget ? Number(widthWidget.value) || 512 : 512;
  node.properties.height = heightWidget ? Number(heightWidget.value) || 512 : 512;
  node.properties.interpolation = interpolationWidget ? interpolationWidget.value : "idw";

  // 如果有执行结果，更新控制点
  if (message?.gradient_canvas?.control_points) {
    node.properties.control_points = message.gradient_canvas.control_points.slice(0, 50).map(point => ({
      x: Math.max(0, Math.min(1, point.x)),
      y: Math.max(0, Math.min(1, point.y)),
      color: point.color || "#ffffff",
      influence: Math.max(0.5, Math.min(2.0, point.influence || 1.0)),
    }));
    if (node.properties.interpolation === "linear" && message.gradient_canvas.linear_cache) {
      node.properties.linear_cache = message.gradient_canvas.linear_cache.slice(0, 50).map(point => ({
        x: Math.max(0, Math.min(1, point.x)),
        y: Math.max(0, Math.min(1, point.y)),
        color: point.color || "#ffffff",
        influence: Math.max(0.5, Math.min(2.0, point.influence || 1.0)),
      }));
    }
  }

  const ctx = node.ctx;
  const w = node.canvas.width;
  const h = node.canvas.height;
  const interpolation = node.properties.interpolation || "idw";

  // 显示加载动画
  if (node.loadingSpinner) {
    node.loadingSpinner.style.display = "block";
  }

  const offscreenCtx = node.offscreenCanvas.getContext("2d");
  offscreenCtx.clearRect(0, 0, w, h);
  offscreenCtx.fillStyle = "#000000";
  offscreenCtx.fillRect(0, 0, w, h);

  // 绘制渐变背景
  if (node.properties.control_points?.length > 0) {
    try {
      const imageData = offscreenCtx.createImageData(w, h);
      const data = imageData.data;

      if (interpolation === "idw") {
        const weightsCache = new Float32Array(w * h);
        const colorsCache = new Float32Array(w * h * 3);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            let totalWeight = 0;
            let color = [0, 0, 0];
            node.properties.control_points.forEach((point) => {
              const px = point.x * w;
              const py = point.y * h;
              const influence = point.influence || 1.0;
              const distance = Math.sqrt((x - px) ** 2 + (y - py) ** 2) / influence + 1e-6;
              const weight = 1 / (distance ** 2);
              totalWeight += weight;
              const rgb = hexToRgb(point.color);
              color[0] += rgb[0] * weight;
              color[1] += rgb[1] * weight;
              color[2] += rgb[2] * weight;
            });
            const index = (y * w + x);
            weightsCache[index] = totalWeight;
            colorsCache[index * 3] = color[0];
            colorsCache[index * 3 + 1] = color[1];
            colorsCache[index * 3 + 2] = color[2];
          }
        }
        for (let i = 0; i < w * h; i++) {
          const index = i * 4;
          const totalWeight = weightsCache[i];
          if (totalWeight > 0) {
            data[index] = Math.round(colorsCache[i * 3] / totalWeight);
            data[index + 1] = Math.round(colorsCache[i * 3 + 1] / totalWeight);
            data[index + 2] = Math.round(colorsCache[i * 3 + 2] / totalWeight);
            data[index + 3] = 255;
          }
        }
      } else if (interpolation === "radial") {
        const distances = new Float32Array(w * h * node.properties.control_points.length);
        for (let i = 0; i < node.properties.control_points.length; i++) {
          const point = node.properties.control_points[i];
          const px = point.x * w;
          const py = point.y * h;
          const influence = point.influence || 1.0;
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              distances[(y * w + x) * node.properties.control_points.length + i] = Math.sqrt((x - px) ** 2 + (y - py) ** 2) / influence;
            }
          }
        }
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            let minDist = Infinity;
            let color = [255, 255, 255];
            for (let i = 0; i < node.properties.control_points.length; i++) {
              const dist = distances[(y * w + x) * node.properties.control_points.length + i];
              if (dist < minDist) {
                minDist = dist;
                color = hexToRgb(node.properties.control_points[i].color);
              }
            }
            const index = (y * w + x) * 4;
            data[index] = color[0];
            data[index + 1] = color[1];
            data[index + 2] = color[2];
            data[index + 3] = 255;
          }
        }
      } else if (interpolation === "voronoi") {
        const distances = new Float32Array(w * h * node.properties.control_points.length);
        for (let i = 0; i < node.properties.control_points.length; i++) {
          const point = node.properties.control_points[i];
          const px = point.x * w;
          const py = point.y * h;
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              distances[(y * w + x) * node.properties.control_points.length + i] = (Math.abs(x - px) + Math.abs(y - py));
            }
          }
        }
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            let minDist = Infinity;
            let color = [255, 255, 255];
            for (let i = 0; i < node.properties.control_points.length; i++) {
              const dist = distances[(y * w + x) * node.properties.control_points.length + i];
              if (dist < minDist) {
                minDist = dist;
                color = hexToRgb(node.properties.control_points[i].color);
              }
            }
            const index = (y * w + x) * 4;
            data[index] = color[0];
            data[index + 1] = color[1];
            data[index + 2] = color[2];
            data[index + 3] = 255;
          }
        }
      } else if (interpolation === "idw(soft)") {
        const weightsCache = new Float32Array(w * h);
        const colorsCache = new Float32Array(w * h * 3);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            let totalWeight = 0;
            let color = [0, 0, 0];
            node.properties.control_points.forEach((point) => {
              const px = point.x * w;
              const py = point.y * h;
              const influence = point.influence || 1.0;
              const distance = Math.sqrt((x - px) ** 2 + (y - py) ** 2) / influence + 1e-6;
              const weight = 1 / distance;
              totalWeight += weight;
              const rgb = hexToRgb(point.color);
              color[0] += rgb[0] * weight;
              color[1] += rgb[1] * weight;
              color[2] += rgb[2] * weight;
            });
            const index = (y * w + x);
            weightsCache[index] = totalWeight;
            colorsCache[index * 3] = color[0];
            colorsCache[index * 3 + 1] = color[1];
            colorsCache[index * 3 + 2] = color[2];
          }
        }
        for (let i = 0; i < w * h; i++) {
          const index = i * 4;
          const totalWeight = weightsCache[i];
          if (totalWeight > 0) {
            data[index] = Math.round(colorsCache[i * 3] / totalWeight);
            data[index + 1] = Math.round(colorsCache[i * 3 + 1] / totalWeight);
            data[index + 2] = Math.round(colorsCache[i * 3 + 2] / totalWeight);
            data[index + 3] = 255;
          }
        }
      } else if (interpolation === "linear") {
        // 确保至少有两个控制点
        if (node.properties.control_points.length < 2) {
          node.properties.control_points = (node.properties.linear_cache && node.properties.linear_cache.length >= 2)
            ? node.properties.linear_cache.slice()
            : [
                { x: 0.2, y: 0.2, color: "#ff0000", influence: 1.0 },
                { x: 0.8, y: 0.8, color: "#0000ff", influence: 1.0 }
              ];
          node.properties.linear_cache = node.properties.control_points.slice();
          log.info(`Node ${node.id} restored control points from linear_cache or default`);
        }
        // 获取首尾控制点（固定为索引 0 和 1）
        const firstPoint = node.properties.control_points[0];
        const lastPoint = node.properties.control_points[1];
        // 计算控制点的 t 值，用于渐变插值（不修改原始数组）
        const pointsWithT = node.properties.control_points.map((point, index) => ({
          ...point,
          t: projectPointToLine(point.x, point.y, firstPoint.x, firstPoint.y, lastPoint.x, lastPoint.y).t,
          originalIndex: index
        })).sort((a, b) => a.t - b.t);
        
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const nx = x / w;
            const ny = y / h;
            const dx = lastPoint.x - firstPoint.x;
            const dy = lastPoint.y - firstPoint.y;
            const lenSquared = dx * dx + dy * dy;
            let t = lenSquared > 1e-6 ? ((nx - firstPoint.x) * dx + (ny - firstPoint.y) * dy) / lenSquared : 0;
            t = Math.max(0, Math.min(1, t));
            
            let color = [255, 255, 255];
            for (let i = 0; i < pointsWithT.length - 1; i++) {
              const p0 = pointsWithT[i];
              const p1 = pointsWithT[i + 1];
              if (t >= p0.t && t <= p1.t) {
                const factor = p1.t === p0.t ? 0 : (t - p0.t) / (p1.t - p0.t);
                const rgb0 = hexToRgb(node.properties.control_points[p0.originalIndex].color);
                const rgb1 = hexToRgb(node.properties.control_points[p1.originalIndex].color);
                color = [
                  Math.round(rgb0[0] + (rgb1[0] - rgb0[0]) * factor),
                  Math.round(rgb0[1] + (rgb1[1] - rgb0[1]) * factor),
                  Math.round(rgb0[2] + (rgb1[2] - rgb0[2]) * factor)
                ];
                break;
              }
            }
            const index = (y * w + x) * 4;
            data[index] = color[0];
            data[index + 1] = color[1];
            data[index + 2] = color[2];
            data[index + 3] = 255;
          }
        }
      }

      offscreenCtx.putImageData(imageData, 0, 0);
    } catch (e) {
      log.error(`Node ${node.id} error drawing gradient: ${e}`);
      if (node.errorMessage) {
        node.errorMessage.innerText = `Gradient preview failed: ${e.message}`;
        node.errorMessage.style.display = "block";
        setTimeout(() => node.errorMessage.style.display = "none", 3000);
      }
    }
  } else {
    // 使用默认控制点
    const defaultPoints = (node.properties.interpolation === "linear" && node.properties.linear_cache && node.properties.linear_cache.length >= 2)
      ? node.properties.linear_cache.slice()
      : [
          { x: 0.2, y: 0.2, color: "#ff0000", influence: 1.0 },
          { x: 0.8, y: 0.8, color: "#0000ff", influence: 1.0 }
        ];
    node.properties.control_points = defaultPoints;
    node.properties.linear_cache = node.properties.interpolation === "linear" ? defaultPoints.slice() : node.properties.linear_cache;
    const imageData = offscreenCtx.createImageData(w, h);
    const data = imageData.data;

    if (interpolation === "linear") {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const nx = x / w;
          const ny = y / h;
          const dx = defaultPoints[1].x - defaultPoints[0].x;
          const dy = defaultPoints[1].y - defaultPoints[0].y;
          const lenSquared = dx * dx + dy * dy;
          let t = lenSquared > 1e-6 ? ((nx - defaultPoints[0].x) * dx + (ny - defaultPoints[0].y) * dy) / lenSquared : 0;
          t = Math.max(0, Math.min(1, t));
          
          const rgb0 = hexToRgb(defaultPoints[0].color);
          const rgb1 = hexToRgb(defaultPoints[1].color);
          const color = [
            Math.round(rgb0[0] + (rgb1[0] - rgb0[0]) * t),
            Math.round(rgb0[1] + (rgb1[1] - rgb0[1]) * t),
            Math.round(rgb0[2] + (rgb1[2] - rgb0[2]) * t)
          ];
          
          const index = (y * w + x) * 4;
          data[index] = color[0];
          data[index + 1] = color[1];
          data[index + 2] = color[2];
          data[index + 3] = 255;
        }
      }
    } else {
      const weightsCache = new Float32Array(w * h);
      const colorsCache = new Float32Array(w * h * 3);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let totalWeight = 0;
          let color = [0, 0, 0];
          defaultPoints.forEach((point) => {
            const px = point.x * w;
            const py = point.y * h;
            const influence = point.influence || 1.0;
            const distance = Math.sqrt((x - px) ** 2 + (y - py) ** 2) / influence + 1e-6;
            const weight = 1 / (distance ** 2);
            totalWeight += weight;
            const rgb = hexToRgb(point.color);
            color[0] += rgb[0] * weight;
            color[1] += rgb[1] * weight;
            color[2] += rgb[2] * weight;
          });
          const index = (y * w + x);
          weightsCache[index] = totalWeight;
          colorsCache[index * 3] = color[0];
          colorsCache[index * 3 + 1] = color[1];
          colorsCache[index * 3 + 2] = color[2];
        }
      }
      for (let i = 0; i < w * h; i++) {
        const index = i * 4;
        const totalWeight = weightsCache[i];
        if (totalWeight > 0) {
          data[index] = Math.round(colorsCache[i * 3] / totalWeight);
          data[index + 1] = Math.round(colorsCache[i * 3 + 1] / totalWeight);
          data[index + 2] = Math.round(colorsCache[i * 3 + 2] / totalWeight);
          data[index + 3] = 255;
        }
      }
    }
    offscreenCtx.putImageData(imageData, 0, 0);
  }

  ctx.drawImage(node.offscreenCanvas, 0, 0);

  // 绘制控制点
  ctx.strokeStyle = "#444";
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, w, h);

  if (interpolation === "linear" && node.properties.control_points?.length >= 2) {
    // 绘制连线（始终连接索引 0 和 1）
    const firstPoint = node.properties.control_points[0];
    const lastPoint = node.properties.control_points[1];
    ctx.beginPath();
    ctx.moveTo(firstPoint.x * w, firstPoint.y * h);
    ctx.lineTo(lastPoint.x * w, lastPoint.y * h);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  (node.properties.control_points || []).forEach((point, index) => {
    const radius = interpolation === "voronoi" ? 8 : 8 * (point.influence || 1.0);
    ctx.fillStyle = point.color;
    ctx.beginPath();
    ctx.arc(point.x * w, point.y * h, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = complementaryColor(point.color);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = complementaryColor(point.color);
    ctx.font = "12px Arial, sans-serif";
    ctx.fillText(index + 1, point.x * w + radius + 2, point.y * h);
  });

  // 隐藏加载动画
  if (node.loadingSpinner) {
    node.loadingSpinner.style.display = "none";
  }
  log.info(`Node ${node.id} canvas updated with ${node.properties.control_points?.length || 0} points, interpolation: ${interpolation}`);
  
}, 100);


/**
 * 处理画布鼠标按下事件
 * @param {Object} node - 节点实例
 * @param {MouseEvent} e - 鼠标事件
 */
export function onCanvasMouseDown(node, e) {
  if (e.button !== 0) return;
  if (!node || node.id === -1 || !node.canvas) {
    log.warning(`Node ${node?.id || 'unknown'} canvas not initialized`);
    return;
  }
  const rect = node.canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  const y = (e.clientY - rect.top) / rect.height;

  if (x < 0 || x > 1 || y < 0 || y > 1) return;

  node.draggingPoint = null;
  const selectionRadius = 15;
  const interpolation = node.properties.interpolation || "idw";

  for (let i = 0; i < (node.properties.control_points || []).length; i++) {
    const point = node.properties.control_points[i];
    const dx = (point.x - x) * node.canvas.width;
    const dy = (point.y - y) * node.canvas.height;
    if (Math.sqrt(dx * dx + dy * dy) < selectionRadius) {
      node.draggingPoint = i;
      log.info(`Node ${node.id} selected control point ${i + 1}`);
      return;
    }
  }

  let canAddPoint = true;
  if (interpolation === "linear") {
    // 确保至少有两个控制点
    if (node.properties.control_points.length < 2) {
      node.properties.control_points = (node.properties.linear_cache && node.properties.linear_cache.length >= 2)
        ? node.properties.linear_cache.slice()
        : [
            { x: 0.2, y: 0.2, color: "#ff0000", influence: 1.0 },
            { x: 0.8, y: 0.8, color: "#0000ff", influence: 1.0 }
          ];
      node.properties.linear_cache = node.properties.control_points.slice();
      log.info(`Node ${node.id} initialized control points from linear_cache or default`);
    }
    // 检查是否靠近连线
    const firstPoint = node.properties.control_points[0];
    const lastPoint = node.properties.control_points[1];
    const proj = projectPointToLine(x, y, firstPoint.x, firstPoint.y, lastPoint.x, lastPoint.y);
    const distToLine = Math.sqrt((proj.x - x) ** 2 + (proj.y - y) ** 2) * Math.min(node.canvas.width, node.canvas.height);
    if (distToLine > 10) {
      canAddPoint = false;
    }
  } else {
    for (const point of node.properties.control_points || []) {
      const dx = (point.x - x) * node.canvas.width;
      const dy = (point.y - y) * node.canvas.height;
      if (Math.sqrt(dx * dx + dy * dy) < selectionRadius * 1.5) {
        canAddPoint = false;
        break;
      }
    }
  }

  if (canAddPoint && (node.properties.control_points || []).length < 50) {
    node.properties.control_points = node.properties.control_points || [];
    if (interpolation === "linear") {
      // 计算新点在连线上的投影
      const firstPoint = node.properties.control_points[0];
      const lastPoint = node.properties.control_points[1];
      const proj = projectPointToLine(x, y, firstPoint.x, firstPoint.y, lastPoint.x, lastPoint.y);
      const newPoint = { x: proj.x, y: proj.y, color: "#ffffff", influence: 1.0 };
      // 插入到数组末尾（尾点索引 1 保持不变）
      node.properties.control_points.push(newPoint);
      node.properties.linear_cache = node.properties.control_points.slice();
      node.draggingPoint = node.properties.control_points.length - 1;
      log.info(`Node ${node.id} added control point ${node.properties.control_points.length}: ${JSON.stringify(newPoint)}, t: ${proj.t}`);
    } else {
      const newPoint = { x, y, color: "#ffffff", influence: 1.0 };
      node.properties.control_points.push(newPoint);
      node.draggingPoint = node.properties.control_points.length - 1;
      log.info(`Node ${node.id} added control point: ${JSON.stringify(newPoint)}`);
    }
    updateDisplay(node);
    node.setDirtyCanvas(true, true);
  } else if ((node.properties.control_points || []).length >= 50) {
    if (node.errorMessage) {
      node.errorMessage.innerText = "Maximum 50 control points reached";
      node.errorMessage.style.display = "block";
      setTimeout(() => node.errorMessage.style.display = "none", 3000);
    }
    log.warning(`Node ${node.id} cannot add control point: max limit reached`);
  } else if (interpolation === "linear") {
    if (node.errorMessage) {
      node.errorMessage.innerText = "New points must be added on the line";
      node.errorMessage.style.display = "block";
      setTimeout(() => node.errorMessage.style.display = "none", 3000);
    }
    log.warning(`Node ${node.id} cannot add control point: not on the line`);
  }
}

/**
 * 处理画布鼠标移动事件
 * @param {Object} node - 节点实例
 * @param {MouseEvent} e - 鼠标事件
 */
export function onCanvasMouseMove(node, e) {
  if (!node || node.id === -1 || node.draggingPoint === null || !node.canvas || !(e.buttons & 1)) return;
  const rect = node.canvas.getBoundingClientRect();
  let x = (e.clientX - rect.left) / rect.width;
  let y = (e.clientY - rect.top) / rect.height;

  // 边缘吸附
  const snapThreshold = 10 / Math.min(node.canvas.width, node.canvas.height);
  if (x < snapThreshold) x = 0;
  else if (x > 1 - snapThreshold) x = 1;
  if (y < snapThreshold) y = 0;
  else if (y > 1 - snapThreshold) y = 1;

  x = Math.max(0, Math.min(1, x));
  y = Math.max(0, Math.min(1, y));

  if (node.properties.control_points && node.draggingPoint < node.properties.control_points.length) {
    if (node.properties.interpolation === "linear" && node.properties.control_points.length >= 2) {
      const firstPointIndex = 0;
      const lastPointIndex = 1;
      if (node.draggingPoint === firstPointIndex || node.draggingPoint === lastPointIndex) {
        // 首尾控制点自由移动
        node.properties.control_points[node.draggingPoint].x = x;
        node.properties.control_points[node.draggingPoint].y = y;
        // 重新投影中间控制点到新连线
        if (node.properties.control_points.length > 2) {
          const firstPoint = node.properties.control_points[0];
          const lastPoint = node.properties.control_points[1];
          for (let i = 2; i < node.properties.control_points.length; i++) {
            const point = node.properties.control_points[i];
            const proj = projectPointToLine(point.x, point.y, firstPoint.x, firstPoint.y, lastPoint.x, lastPoint.y);
            point.x = proj.x;
            point.y = proj.y;
          }
        }
      } else {
        // 中间控制点限制在连线上
        const firstPoint = node.properties.control_points[0];
        const lastPoint = node.properties.control_points[1];
        const proj = projectPointToLine(x, y, firstPoint.x, firstPoint.y, lastPoint.x, lastPoint.y);
        node.properties.control_points[node.draggingPoint].x = proj.x;
        node.properties.control_points[node.draggingPoint].y = proj.y;
      }
      // 更新当前模式的缓存
      if (node.properties.interpolation === "linear") {
        node.properties.linear_cache = node.properties.control_points.slice();
      } else {
        node.properties.other_modes_cache = node.properties.control_points.slice();
      }
    } else {
      node.properties.control_points[node.draggingPoint].x = x;
      node.properties.control_points[node.draggingPoint].y = y;
    }
    updateDisplay(node);
    node.setDirtyCanvas(true, true);
    log.info(`Node ${node.id} moved control point ${node.draggingPoint + 1} to: ${x}, ${y}`);
  }
}

/**
 * 处理画布鼠标释放事件
 * @param {Object} node - 节点实例
 */
export function onCanvasMouseUp(node) {
  if (node.draggingPoint !== null) {
    // 更新当前模式的缓存
    if (node.properties.interpolation === "linear") {
      node.properties.linear_cache = node.properties.control_points.slice();
      log.info(`Node ${node.id} updated linear_cache after dragging`);
    } else {
      node.properties.other_modes_cache = node.properties.control_points.slice();
      log.info(`Node ${node.id} updated other_modes_cache after dragging`);
    }
  }
  node.draggingPoint = null;
  log.info(`Node ${node.id} stopped dragging`);
}

/**
 * 处理画布双击事件，触发颜色选择器
 * @param {Object} node - 节点实例
 * @param {MouseEvent} e - 鼠标事件
 */
export function onCanvasDblClick(node, e) {
  if (!node || node.id === -1 || !node.canvas) {
    log.warning(`Node ${node?.id || 'unknown'} canvas not initialized`);
    return;
  }
  const rect = node.canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  const y = (e.clientY - rect.top) / rect.height;

  const selectionRadius = 15;
  for (let i = 0; i < (node.properties.control_points || []).length; i++) {
    const point = node.properties.control_points[i];
    const dx = (point.x - x) * node.canvas.width;
    const dy = (point.y - y) * node.canvas.height;
    if (Math.sqrt(dx * dx + dy * dy) < selectionRadius) {
      const input = document.createElement("input");
      input.type = "color";
      input.value = point.color;
      document.body.appendChild(input);
      input.addEventListener("change", () => {
        point.color = input.value;
        // 更新当前模式的缓存
        if (node.properties.interpolation === "linear") {
          node.properties.linear_cache = node.properties.control_points.slice();
          log.info(`Node ${node.id} updated linear_cache after color change`);
        } else {
          node.properties.other_modes_cache = node.properties.control_points.slice();
          log.info(`Node ${node.id} updated other_modes_cache after color change`);
        }
        updateDisplay(node);
        node.setDirtyCanvas(true, true);
        log.info(`Node ${node.id} changed control point ${i + 1} color to: ${input.value}`);
        input.remove();
      });
      input.addEventListener("cancel", () => {
        input.remove();
      });
      input.click();
      break;
    }
  }
}

/**
 * 处理画布鼠标滚轮事件，调整控制点影响力
 * @param {Object} node - 节点实例
 * @param {WheelEvent} e - 鼠标滚轮事件
 */
export function onCanvasWheel(node, e) {
  e.preventDefault();
  if (!node || node.id === -1 || !node.canvas || node.properties.interpolation === "voronoi") {
    if (node.properties.interpolation === "voronoi") {
      log.info(`Node ${node?.id || 'unknown'} influence adjustment skipped in voronoi mode`);
    } else {
      log.warning(`Node ${node?.id || 'unknown'} canvas not initialized`);
    }
    return;
  }
  const rect = node.canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  const y = (e.clientY - rect.top) / rect.height;

  const selectionRadius = 15;
  for (let i = 0; i < (node.properties.control_points || []).length; i++) {
    const point = node.properties.control_points[i];
    const dx = (point.x - x) * node.canvas.width;
    const dy = (point.y - y) * node.canvas.height;
    if (Math.sqrt(dx * dx + dy * dy) < selectionRadius) {
      const delta = e.deltaY < 0 ? 0.1 : -0.1; // 向上滚轮增加，向下减少
      point.influence = Math.max(0.5, Math.min(2.0, (point.influence || 1.0) + delta));
      // 更新当前模式的缓存
      if (node.properties.interpolation === "linear") {
        node.properties.linear_cache = node.properties.control_points.slice();
        log.info(`Node ${node.id} updated linear_cache after influence change`);
      } else {
        node.properties.other_modes_cache = node.properties.control_points.slice();
        log.info(`Node ${node.id} updated other_modes_cache after influence change`);
      }
      updateDisplay(node);
      node.setDirtyCanvas(true, true);
      log.info(`Node ${node.id} adjusted control point ${i + 1} influence to: ${point.influence}`);
      break;
    }
  }
}

/**
 * 处理画布右键事件，显示复制和删除菜单
 * @param {Object} node - 节点实例
 * @param {MouseEvent} e - 鼠标事件
 */
export function onCanvasRightClick(node, e) {
  e.preventDefault();
  e.stopPropagation();
  node.draggingPoint = null;
  if (!node || node.id === -1 || !node.canvas) {
    log.warning(`Node ${node?.id || 'unknown'} canvas not initialized`);
    return;
  }
  const rect = node.canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  const y = (e.clientY - rect.top) / rect.height;

  let selectedIndex = -1;
  const selectionRadius = 15;
  for (let i = 0; i < (node.properties.control_points || []).length; i++) {
    const point = node.properties.control_points[i];
    const dx = (point.x - x) * node.canvas.width;
    const dy = (point.y - y) * node.canvas.height;
    if (Math.sqrt(dx * dx + dy * dy) < selectionRadius) {
      selectedIndex = i;
      break;
    }
  }

  if (selectedIndex !== -1) {
    const menu = document.createElement("div");
    menu.className = `xiser-context-menu-${node.id}`;
    menu.style.cssText = `
      position: absolute;
      left: ${e.clientX}px;
      top: ${e.clientY}px;
      background: #333;
      border: 1px solid #555;
      border-radius: 4px;
      padding: 4px;
      z-index: 1000;
    `;

    const copyItem = document.createElement("div");
    copyItem.style.cssText = `
      padding: 4px 8px;
      color: #fff;
      cursor: pointer;
      font-size: 12px;
    `;
    copyItem.innerText = "Copy Control Point";
    copyItem.addEventListener("click", () => {
      if ((node.properties.control_points || []).length >= 50) {
        if (node.errorMessage) {
          node.errorMessage.innerText = "Maximum 50 control points reached";
          node.errorMessage.style.display = "block";
          setTimeout(() => node.errorMessage.style.display = "none", 3000);
        }
        log.warning(`Node ${node.id} cannot copy control point: max limit reached`);
        menu.remove();
        return;
      }
      const original = node.properties.control_points[selectedIndex];
      let newPoint = { x: original.x, y: original.y, color: original.color, influence: original.influence || 1.0 };
      if (node.properties.interpolation === "linear") {
        const firstPoint = node.properties.control_points[0];
        const lastPoint = node.properties.control_points[1];
        const proj = projectPointToLine(original.x + 0.05, original.y + 0.05, firstPoint.x, firstPoint.y, lastPoint.x, lastPoint.y);
        newPoint.x = proj.x;
        newPoint.y = proj.y;
        node.properties.control_points.push(newPoint);
        node.properties.linear_cache = node.properties.control_points.slice();
      } else {
        newPoint.x = Math.min(1, original.x + 0.05);
        newPoint.y = Math.min(1, original.y + 0.05);
        node.properties.control_points.push(newPoint);
      }
      updateDisplay(node);
      node.setDirtyCanvas(true, true);
      log.info(`Node ${node.id} copied control point ${selectedIndex + 1}`);
      menu.remove();
    });

    const deleteItem = document.createElement("div");
    deleteItem.style.cssText = `
      padding: 4px 8px;
      color: #fff;
      cursor: pointer;
      font-size: 12px;
    `;
    deleteItem.innerText = "Delete Control Point";
    deleteItem.addEventListener("click", () => {
      if (node.properties.interpolation === "linear" && node.properties.control_points.length <= 2) {
        if (node.errorMessage) {
          node.errorMessage.innerText = "Linear mode requires at least 2 points";
          node.errorMessage.style.display = "block";
          setTimeout(() => node.errorMessage.style.display = "none", 3000);
        }
        log.warning(`Node ${node.id} cannot delete control point: minimum 2 points required in linear mode`);
        menu.remove();
        return;
      }
      if (node.properties.interpolation === "linear" && (selectedIndex === 0 || selectedIndex === 1)) {
        if (node.errorMessage) {
          node.errorMessage.innerText = "Cannot delete points 1 or 2 in linear mode";
          node.errorMessage.style.display = "block";
          setTimeout(() => node.errorMessage.style.display = "none", 3000);
        }
        log.warning(`Node ${node.id} cannot delete control point ${selectedIndex + 1}: points 1 and 2 are fixed in linear mode`);
        menu.remove();
        return;
      }
      node.properties.control_points.splice(selectedIndex, 1);
      // 更新当前模式的缓存
      if (node.properties.interpolation === "linear") {
        node.properties.linear_cache = node.properties.control_points.slice();
        log.info(`Node ${node.id} updated linear_cache after deletion`);
      } else {
        node.properties.other_modes_cache = node.properties.control_points.slice();
        log.info(`Node ${node.id} updated other_modes_cache after deletion`);
      }
      node.draggingPoint = null;
      updateDisplay(node);
      node.setDirtyCanvas(true, true);
      log.info(`Node ${node.id} deleted control point ${selectedIndex + 1}`);
      menu.remove();
    });

    const clearItem = document.createElement("div");
    clearItem.style.cssText = `
      padding: 4px 8px;
      color: #fff;
      cursor: pointer;
      font-size: 12px;
    `;
    clearItem.innerText = "Clear All Points";
    clearItem.addEventListener("click", () => {
      if (node.properties.interpolation === "linear") {
        node.properties.control_points = [
          { x: 0.2, y: 0.2, color: "#ff0000", influence: 1.0 },
          { x: 0.8, y: 0.8, color: "#0000ff", influence: 1.0 }
        ];
        node.properties.linear_cache = node.properties.control_points.slice();
      } else {
        node.properties.control_points = [];
        node.properties.other_modes_cache = [];
      }
      updateDisplay(node);
      node.setDirtyCanvas(true, true);
      log.info(`Node ${node.id} cleared all control points`);
      menu.remove();
    });

    menu.appendChild(copyItem);
    menu.appendChild(deleteItem);
    menu.appendChild(clearItem);
    document.body.appendChild(menu);

    const closeMenu = () => {
      menu.remove();
      document.removeEventListener("click", closeMenu);
    };
    setTimeout(() => document.addEventListener("click", closeMenu), 0);
    // Store the closeMenu function for cleanup
    node._closeMenuHandler = closeMenu;
  }
}