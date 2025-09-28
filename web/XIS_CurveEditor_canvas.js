/**
 * @file XIS_CurveEditor_canvas.js
 * @description 画布相关逻辑，包括控件设置、画布绘制和鼠标事件处理，优化性能和交互体验。
 * @author grinlau18
 */

// 导入节点最小尺寸常量
import { MIN_NODE_WIDTH, MIN_NODE_HEIGHT } from "./XIS_CurveEditor.js";

// 日志级别控制
const LOG_LEVEL = "error"; // Options: "info", "warning", "error"

// 画布尺寸配置
const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 400;

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
 * 创建节点专用的防抖函数，避免多节点冲突
 * @param {number} wait - 等待时间（毫秒）
 * @returns {Function} 防抖后的函数
 */
function createNodeDebounce(wait) {
  const timeouts = new Map(); // 存储每个节点的防抖计时器

  return function(node, ...args) {
    const nodeId = node?.id;
    if (nodeId === undefined || nodeId === -1) {
      // 对于无效节点，直接执行
      if (typeof args[0] === 'function') {
        args[0]();
      }
      return;
    }

    // 取消该节点之前的防抖计时器
    if (timeouts.has(nodeId)) {
      cancelAnimationFrame(timeouts.get(nodeId));
    }

    // 设置新的防抖计时器
    const timeoutId = requestAnimationFrame(() => {
      setTimeout(() => {
        if (typeof args[0] === 'function') {
          args[0]();
        }
        timeouts.delete(nodeId);
      }, wait);
    });

    timeouts.set(nodeId, timeoutId);
  };
}

// 创建节点专用的防抖实例
const nodeDebounce = createNodeDebounce(16);

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
    `[data-node-id="${node.id}"]`,
    `#curve-canvas-${node.id}`
  ];

  selectors.forEach(selector => {
    document.querySelectorAll(selector).forEach(el => {
      if (el.parentNode) {
        log.info(`Node ${node.id} removing element:`, selector);
        el.remove();
      }
    });
  });

  // 清理节点上的画布引用
  if (node.canvas) {
    node.canvas = null;
  }
  if (node.ctx) {
    node.ctx = null;
  }

  log.info(`Node ${node.id} existing DOM elements and canvas references cleaned up`);
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

  // 初始化插值算法设置
  if (node.properties.interpolation_algorithm === undefined) {
    node.properties.interpolation_algorithm = "catmull_rom"; // 默认使用Catmull-Rom样条插值
  }

  // 临时状态（不序列化）- 确保每个节点有独立的状态对象
  if (!node._curveState || typeof node._curveState !== 'object') {
    node._curveState = {
      draggingPoint: null,
      hoverPoint: null,
      lastUpdateTime: 0,
      initialized: false
    };
  } else {
    // 确保现有状态对象有所有必需的属性
    node._curveState.draggingPoint = node._curveState.draggingPoint || null;
    node._curveState.hoverPoint = node._curveState.hoverPoint || null;
    node._curveState.lastUpdateTime = node._curveState.lastUpdateTime || 0;
    node._curveState.initialized = node._curveState.initialized || false;
  }

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
    background: rgba(0, 0, 0, 0.4); #5556667e
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
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;

  canvas.style.cssText = `
    width: ${CANVAS_WIDTH}px;
    height: ${CANVAS_HEIGHT}px;
    cursor: crosshair;
    background: rgba(0, 0, 0, 0);
    border-radius: 4px;
  `;

  canvasContainer.appendChild(canvas);
  mainContainer.appendChild(canvasContainer);

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
    { name: "线性", type: "linear", interpolation: "linear" },
    { name: "缓入", type: "ease_in", interpolation: "catmull_rom" },
    { name: "缓出", type: "ease_out", interpolation: "catmull_rom" },
    { name: "缓入出", type: "ease_in_out", interpolation: "catmull_rom" }
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
      // 设置对应的插值算法
      node.properties.interpolation_algorithm = preset.interpolation;

      // 联动更新toggle开关状态
      updateToggleState(preset.interpolation === "catmull_rom");

      updateDisplay(node);
      node.setDirtyCanvas(true, true);

      // 触发ComfyUI序列化以保存曲线状态
      if (node.onWidgetChange) {
        node.onWidgetChange();
      }
    });

    buttonContainer.appendChild(button);
  });

  // 创建toggle开关容器
  const toggleContainer = document.createElement("div");
  toggleContainer.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    justify-content: center;
    flex: 1;
  `;

  // 创建toggle开关标签
  const toggleLabel = document.createElement("span");
  toggleLabel.textContent = "平滑插值";
  toggleLabel.style.cssText = `
    color: #ccc;
    font-size: 11px;
    font-weight: 500;
    white-space: nowrap;
  `;

  // 创建toggle开关容器
  const toggleWrapper = document.createElement("div");
  toggleWrapper.style.cssText = `
    position: relative;
    width: 36px;
    height: 18px;
    border-radius: 9px;
    background: ${node.properties.interpolation_algorithm === "catmull_rom" ? "#4CAF50" : "#666"};
    border: 1px solid #ababab83;
    cursor: pointer;
    transition: all 0.2s ease;
  `;

  // 创建toggle开关滑块
  const toggleThumb = document.createElement("div");
  toggleThumb.style.cssText = `
    position: absolute;
    top: 1px;
    left: ${node.properties.interpolation_algorithm === "catmull_rom" ? '19px' : '1px'};
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fff;
    transition: all 0.2s ease;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  `;

  toggleWrapper.appendChild(toggleThumb);

  // 更新toggle开关状态的函数
  const updateToggleState = (isCatmullRom) => {
    if (toggleWrapper && toggleThumb) {
      if (isCatmullRom) {
        toggleWrapper.style.background = "#4CAF50";
        toggleThumb.style.left = "19px";
      } else {
        toggleWrapper.style.background = "#666";
        toggleThumb.style.left = "1px";
      }
    }
  };

  // 初始化toggle开关状态
  updateToggleState(node.properties.interpolation_algorithm === "catmull_rom");

  // toggle开关点击事件
  toggleWrapper.addEventListener("click", () => {
    const isCurrentlyCatmullRom = node.properties.interpolation_algorithm === "catmull_rom";

    // 切换插值算法
    if (isCurrentlyCatmullRom) {
      // 切换到线性插值
      node.properties.interpolation_algorithm = "linear";
    } else {
      // 切换到Catmull-Rom样条插值
      node.properties.interpolation_algorithm = "catmull_rom";
    }

    // 更新toggle开关状态
    updateToggleState(!isCurrentlyCatmullRom);

    updateDisplay(node);
    node.setDirtyCanvas(true, true);

    // 触发ComfyUI序列化以保存曲线状态
    if (node.onWidgetChange) {
      node.onWidgetChange();
    }
  });

  toggleContainer.appendChild(toggleLabel);
  toggleContainer.appendChild(toggleWrapper);
  buttonContainer.appendChild(toggleContainer);
  controlPanel.appendChild(buttonContainer);

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

  // 注册DOM控件 - 使用ComfyUI标准配置
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

        // 计算所有分布点的实际数值
        const pointCount = pointCountWidget ? Number(pointCountWidget.value) || 10 : (node.properties.point_count || 10);
        const dataType = dataTypeWidget ? dataTypeWidget.value : (node.properties.data_type || "FLOAT");
        const startValue = startValueWidget ? parseFloat(startValueWidget.value || 0) : 0;
        const endValue = endValueWidget ? parseFloat(endValueWidget.value || 1) : 1;

        const distribution_values = [];
        const distribution_t_values = [];

        for (let i = 0; i < pointCount; i++) {
          const t = (i + 1) / pointCount;
          let transformedT = t;

          if (node.properties.curve_points && node.properties.curve_points.length > 0) {
            transformedT = applyCustomCurve(t, node.properties.curve_points, node);
          }

          // 计算实际数值
          let value;
          if (dataType === "HEX") {
            value = transformedT; // HEX模式使用百分比值
          } else {
            value = startValue + (endValue - startValue) * transformedT;
            if (dataType === "INT") {
              value = Math.round(value);
            }
          }

          distribution_values.push(value);
          distribution_t_values.push({
            index: i + 1,
            t: t,
            transformed_t: transformedT
          });
        }

        const data = {
          curve_points: (node.properties.curve_points || []).slice(0, 50).map(point => ({
            x: Math.max(0, Math.min(1, typeof point.x === "number" ? point.x : 0)),
            y: Math.max(0, Math.min(1, typeof point.y === "number" ? point.y : 0))
          })),
          distribution_values: distribution_values,
          distribution_t_values: distribution_t_values,
          data_type: dataTypeWidget ? dataTypeWidget.value : (node.properties.data_type || "FLOAT"),
          start_value: startValueWidget ? startValueWidget.value : (node.properties.start_value || "0"),
          end_value: endValueWidget ? endValueWidget.value : (node.properties.end_value || "1"),
          point_count: pointCount,
          interpolation_algorithm: node.properties.interpolation_algorithm || "catmull_rom",
          color_interpolation: node.properties.color_interpolation || "HSV",
          node_size: node.properties.node_size || [MIN_NODE_WIDTH, MIN_NODE_HEIGHT],
          node_id: node.id.toString()
        };
        return data;
      } catch (e) {
        log.error(`Node ${node.id} error in getValue: ${e}`);
        // 错误处理时也计算分布点数值
        const defaultDistributionValues = [];
        const defaultDistributionTValues = [];
        for (let i = 0; i < 10; i++) {
          const t = (i + 1) / 10;
          const value = 0 + (1 - 0) * t; // 默认起始值0，结束值1
          defaultDistributionValues.push(value);
          defaultDistributionTValues.push({
            index: i + 1,
            t: t,
            transformed_t: t
          });
        }

        return {
          curve_points: [
            { x: 0, y: 0 },
            { x: 1, y: 1 }
          ],
          distribution_values: defaultDistributionValues,
          distribution_t_values: defaultDistributionTValues,
          data_type: "FLOAT",
          start_value: "0",
          end_value: "1",
          point_count: 10,
          interpolation_algorithm: "catmull_rom",
          color_interpolation: "HSV",
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
        node.properties.interpolation_algorithm = value.interpolation_algorithm && ["linear", "catmull_rom"].includes(value.interpolation_algorithm)
          ? value.interpolation_algorithm
          : "catmull_rom";
        node.properties.color_interpolation = value.color_interpolation && ["HSV", "RGB", "LAB"].includes(value.color_interpolation)
          ? value.color_interpolation
          : "HSV";
        node.properties.node_size = value.node_size && Array.isArray(value.node_size)
          ? [Math.max(value.node_size[0], MIN_NODE_WIDTH), Math.max(value.node_size[1], MIN_NODE_HEIGHT)]
          : [MIN_NODE_WIDTH, MIN_NODE_HEIGHT];

        // 处理分布点t值（向后兼容）
        if (value.distribution_t_values && Array.isArray(value.distribution_t_values)) {
          node.properties.distribution_t_values = value.distribution_t_values;
        } else {
          // 如果没有提供，重新计算
          const pointCount = node.properties.point_count;
          node.properties.distribution_t_values = [];
          for (let i = 0; i < pointCount; i++) {
            const t = (i + 1) / pointCount;
            let transformedT = t;

            if (node.properties.curve_points && node.properties.curve_points.length > 0) {
              transformedT = applyCustomCurve(t, node.properties.curve_points, node);
            }

            node.properties.distribution_t_values.push({
              index: i + 1,
              t: t,
              transformed_t: transformedT
            });
          }
        }

        updateDisplay(node);
        node.setDirtyCanvas(true, true);

        // 恢复toggle开关状态
        updateToggleState(node.properties.interpolation_algorithm === "catmull_rom");

      } catch (e) {
        log.error(`Node ${node.id} error in setValue: ${e}`);
      }
    }
  });

  // 保存画布引用
  node.canvas = canvas;
  node.ctx = canvas.getContext('2d');

}

/**
 * 初始化Canvas
 * @param {Object} node - 节点实例
 * @param {HTMLElement} canvas - Canvas元素
 */
function initializeCanvas(node, canvas) {
  if (!node || !canvas || node.id === -1 || node._removed) {
    return;
  }

  // 检查Canvas元素是否存在且有效
  if (!canvas || !canvas.getContext) {
    setTimeout(() => initializeCanvas(node, canvas), 100);
    return;
  }

  // 添加防护标志，防止重复初始化
  if (node._canvasInitialized) {
    return;
  }

  try {
    node._canvasInitialized = true;

    // 直接绘制，ComfyUI会自动处理DOM插入
    updateDisplay(node);

    // 多重强制重绘确保内容显示 - 解决多节点同时初始化时的显示问题
    const forceRedraw = () => {
      if (!node._removed && node.canvas) {
        // 确保Canvas在DOM中完全可见后再绘制
        const checkVisibility = () => {
          if (node.canvas && node.canvas.offsetParent !== null) {
            // Canvas已可见，执行绘制
            updateDisplay(node);

            // 触发ComfyUI重绘
            if (node.setDirtyCanvas) {
              node.setDirtyCanvas(true, true);
            }

            // 额外延迟重绘确保内容稳定显示
            setTimeout(() => {
              if (!node._removed && node.canvas) {
                updateDisplay(node);
              }
            }, 100);
          } else {
            // Canvas尚未可见，继续等待
            setTimeout(checkVisibility, 50);
          }
        };

        checkVisibility();
      }
    };

    // 立即重绘
    forceRedraw();

    // 延迟重绘应对DOM插入延迟
    setTimeout(forceRedraw, 100);
    setTimeout(forceRedraw, 300);

    // 标记为已初始化
    node._curveState.initialized = true;
  } catch (error) {
    log.error(`Node ${node.id} canvas initialization error:`, error);
    // 即使出错也标记为已初始化，避免无限重试
    node._curveState.initialized = true;
    node._canvasInitialized = true;
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

  // 添加防护标志，防止重复设置
  if (node._canvasSetupInProgress) {
    return;
  }

  node._canvasSetupInProgress = true;
  log.info(`Node ${node.id} starting setupCanvas`);

  try {
    // 1. 彻底清理已存在的元素和widget
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

    const { mainContainer, canvas } = uiElements;

    // 4. 创建控制面板
    const controlPanel = createControlPanel(node);
    if (controlPanel) {
      mainContainer.appendChild(controlPanel);
    }

    // 5. 注册DOM控件
    registerDOMWidget(node, mainContainer, canvas);

    // 6. 初始化Canvas
    initializeCanvas(node, canvas);

  } catch (error) {
    log.error(`Node ${node.id} setupCanvas error:`, error);
  } finally {
    node._canvasSetupInProgress = false;
  }
}

/**
 * 实际的画布更新函数
 */
function updateDisplayInternal(node) {
  try {
    if (!node || node.id === -1 || node._removed) {
      log.warning(`Node ${node?.id || 'unknown'} is invalid or removed`);
      return;
    }

    // 添加防护标志，防止重复绘制
    if (node._updatingDisplay) {
      return;
    }

    node._updatingDisplay = true;

    // 检查Canvas和上下文是否已初始化
    if (!node.ctx || !node.canvas) {
      log.warning(`Node ${node.id} canvas or context not initialized, attempting to reinitialize`);

      // 尝试重新获取Canvas引用
      const canvasEl = document.querySelector(`#curve-canvas-${node.id}`);
      if (canvasEl && canvasEl.getContext) {
        node.canvas = canvasEl;
        node.ctx = canvasEl.getContext('2d');
        log.info(`Node ${node.id} canvas reinitialized`);
      } else {
        log.warning(`Node ${node.id} canvas element not found or invalid`);
        node._updatingDisplay = false;
        return;
      }
    }

    // 检查Canvas尺寸是否有效
    if (node.canvas.width <= 0 || node.canvas.height <= 0) {
      log.warning(`Node ${node.id} canvas has invalid dimensions: ${node.canvas.width}x${node.canvas.height}`);
      node._updatingDisplay = false;
      return;
    }

    const now = Date.now();
    if (now - node._curveState.lastUpdateTime < 16) { // 限制60fps
      node._updatingDisplay = false;
      return;
    }
    node._curveState.lastUpdateTime = now;

    drawCurve(node);
  } catch (error) {
    log.error(`Node ${node?.id || 'unknown'} error in updateDisplay:`, error);
  } finally {
    node._updatingDisplay = false;
  }
}

/**
 * 更新画布显示（节点专用防抖优化）
 */
export function updateDisplay(node) {
  nodeDebounce(node, () => updateDisplayInternal(node));
}

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

  // 彻底清除画布 - 使用透明背景确保完全清除
  ctx.clearRect(0, 0, width, height);

  // 绘制透明背景确保完全覆盖
  ctx.fillStyle = 'rgba(0, 0, 0, 0)';
  ctx.fillRect(0, 0, width, height);

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

  // 水平网格线 - 保持11条不变，批量绘制
  ctx.beginPath();
  for (let i = 0; i <= 10; i++) {
    const y = padding + i * plotHeight / 10;
    ctx.moveTo(padding, y);
    ctx.lineTo(width - padding, y);
  }
  ctx.stroke();

  // 缓存widget查找结果，避免重复查询
  if (!node._cachedWidgets) {
    node._cachedWidgets = {};
  }

  const pointCountWidget = node._cachedWidgets.pointCount || node.widgets?.find(w => w.name === 'point_count');
  node._cachedWidgets.pointCount = pointCountWidget;
  const pointCount = pointCountWidget ? parseInt(pointCountWidget.value || 10) : 10;
  const verticalLines = Math.min(pointCount, 50); // 最多50条竖线

  // 优化网格绘制：批量绘制竖线
  ctx.beginPath();
  for (let i = 0; i <= verticalLines; i++) {
    const x = padding + i * plotWidth / verticalLines;
    ctx.moveTo(x, padding);
    ctx.lineTo(x, height - padding);
  }
  ctx.stroke();

  // 绘制坐标标签
  ctx.fillStyle = '#ccc';
  ctx.font = '12px Arial';
  ctx.textAlign = 'center';

  // X轴标签 - 显示point_count位置 (从1开始)
  // 根据网格线数量动态调整标签密度，最多显示10个标签
  const maxLabels = 10;
  const labelInterval = Math.max(1, Math.floor(verticalLines / maxLabels));
  for (let i = 0; i <= verticalLines; i += labelInterval) {
    const x = padding + i * plotWidth / verticalLines;
    // 统一使用1到point_count的索引范围进行计算
    // 标签值 = i对应的分布点索引（从1开始）
    const value = Math.max(1, Math.min(pointCount, Math.round(i * pointCount / verticalLines)));
    ctx.fillText(value.toString(), x, height - padding + 15);
  }

  // Y轴标签 - 显示起始值和结束值之间的值
  ctx.textAlign = 'right';

  // 使用缓存的widget查找结果
  const dataTypeWidget = node._cachedWidgets.dataType || node.widgets?.find(w => w.name === 'data_type');
  node._cachedWidgets.dataType = dataTypeWidget;
  const dataType = dataTypeWidget ? dataTypeWidget.value : "FLOAT";

  const startValueWidget = node._cachedWidgets.startValue || node.widgets?.find(w => w.name === 'start_value');
  node._cachedWidgets.startValue = startValueWidget;
  const startValue = startValueWidget ? parseFloat(startValueWidget.value || 0) : 0;

  const endValueWidget = node._cachedWidgets.endValue || node.widgets?.find(w => w.name === 'end_value');
  node._cachedWidgets.endValue = endValueWidget;
  const endValue = endValueWidget ? parseFloat(endValueWidget.value || 1) : 1;


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

  // 绘制曲线 - 根据插值算法设置选择绘制方法
  ctx.strokeStyle = '#4CAF50';
  ctx.lineWidth = 3;

  if (node.properties.curve_points.length >= 2) {
    ctx.beginPath();

    const points = node.properties.curve_points;
    const interpolationAlgorithm = node?.properties?.interpolation_algorithm || "catmull_rom";

    if (interpolationAlgorithm === "linear") {
      // 线性绘制 - 直接连接控制点
      for (let i = 0; i < points.length; i++) {
        const point = points[i];
        const x = padding + point.x * plotWidth;
        const y = padding + (1 - point.y) * plotHeight;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
    } else {
      // Catmull-Rom样条曲线绘制
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
    // 统一使用1到point_count的索引范围进行计算
    // X轴坐标 = x * point_count，对应分布点索引从1到point_count
    const actualX = Math.round(point.x * pointCount);

    // 对于HEX类型，显示百分比而不是数值
    let displayText;
    let transformedY = point.y;
    let actualY = 0;

    if (dataType === "HEX") {
      const percentage = Math.round(point.y * 100);
      displayText = `(${actualX}, ${percentage}%)`;

    } else {
      // 控制点显示原始y值，不应用曲线变换
      transformedY = point.y;
      actualY = startValue + (endValue - startValue) * transformedY;
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
 * 应用自定义曲线变换（根据插值算法设置选择插值方法）
 */
function applyCustomCurve(t, curvePoints, node) {
  if (!curvePoints || curvePoints.length < 2) {
    return t;
  }

  // 按X坐标排序
  const sortedPoints = curvePoints.slice().sort((a, b) => a.x - b.x);

  // 根据插值算法设置选择插值方法
  const interpolationAlgorithm = node?.properties?.interpolation_algorithm || "catmull_rom";

  // 如果t在曲线定义范围内
  if (t >= sortedPoints[0].x && t <= sortedPoints[sortedPoints.length - 1].x) {
    if (interpolationAlgorithm === "linear") {
      return applyLinearInterpolation(t, sortedPoints);
    } else {
      // 默认使用Catmull-Rom样条插值
      return applyCatmullRomInterpolation(t, sortedPoints);
    }
  }

  // 如果在定义范围外，钳制到最近的点
  if (t <= sortedPoints[0].x) {
    return sortedPoints[0].y;
  } else {
    return sortedPoints[sortedPoints.length - 1].y;
  }
}

/**
 * 应用Catmull-Rom样条插值（与绘制曲线使用相同的算法）
 */
function applyCatmullRomInterpolation(t, sortedPoints) {
  // 找到包含t的线段
  for (let i = 0; i < sortedPoints.length - 1; i++) {
    const p1 = sortedPoints[i];
    const p2 = sortedPoints[i + 1];

    if (p1.x <= t && t <= p2.x) {
      // 获取相邻控制点用于Catmull-Rom插值
      const p0 = i > 0 ? sortedPoints[i - 1] : p1;
      const p3 = i < sortedPoints.length - 2 ? sortedPoints[i + 2] : p2;

      // 计算线段内的参数
      const segmentT = (t - p1.x) / (p2.x - p1.x);

      // Catmull-Rom样条插值
      return catmullRomInterpolate(p0.y, p1.y, p2.y, p3.y, segmentT);
    }
  }

  // 如果找不到包含t的线段，返回线性插值作为回退
  return applyLinearInterpolation(t, sortedPoints);
}

/**
 * Catmull-Rom样条插值计算
 */
function catmullRomInterpolate(p0, p1, p2, p3, t) {
  // Catmull-Rom样条公式
  const t2 = t * t;
  const t3 = t2 * t;

  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

/**
 * 线性插值（回退方法）
 */
function applyLinearInterpolation(t, sortedPoints) {
  for (let i = 0; i < sortedPoints.length - 1; i++) {
    const p1 = sortedPoints[i];
    const p2 = sortedPoints[i + 1];

    if (p1.x <= t && t <= p2.x) {
      if (p2.x === p1.x) {
        return p1.y;
      }
      const segmentT = (t - p1.x) / (p2.x - p1.x);
      return p1.y + (p2.y - p1.y) * segmentT;
    }
  }
  return t;
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

  // 创建绑定的事件处理函数，以便后续移除
  node._eventHandlers = {
    mousedown: (e) => onCanvasMouseDown(node, e),
    mousemove: (e) => onCanvasMouseMove(node, e),
    mouseup: () => onCanvasMouseUp(node),
    contextmenu: (e) => onCanvasRightClick(node, e),
    focus: () => {
      if (!node._removed) {
        updateDisplay(node);
      }
    },
    mouseenter: () => {
      if (!node._removed) {
        updateDisplay(node);
      }
    }
  };

  // 添加鼠标事件监听
  node.canvas.addEventListener("mousedown", node._eventHandlers.mousedown);
  node.canvas.addEventListener("mousemove", node._eventHandlers.mousemove);
  node.canvas.addEventListener("mouseup", node._eventHandlers.mouseup);
  node.canvas.addEventListener("contextmenu", node._eventHandlers.contextmenu);

  // 添加焦点和可见性变化监听，解决"需要点击才能显示"的问题
  node.canvas.addEventListener("focus", node._eventHandlers.focus);
  node.canvas.addEventListener("mouseenter", node._eventHandlers.mouseenter);

  // 设置Canvas可聚焦
  node.canvas.tabIndex = 0;
  node.canvas.style.outline = "none";

  // 使用Intersection Observer检测节点可见性变化
  if (typeof IntersectionObserver !== 'undefined') {
    node._intersectionObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !node._removed) {
          updateDisplay(node);
        }
      });
    }, { threshold: 0.1 });

    node._intersectionObserver.observe(node.canvas);
  }

}

/**
 * 移除输入监听器
 */
export function removeInputListeners(node) {
  if (!node || !node.canvas || !node._eventHandlers) {
    log.warning(`Node ${node?.id || 'unknown'} canvas not initialized or no event handlers, cannot remove listeners`);
    return;
  }

  // 移除所有事件监听器
  node.canvas.removeEventListener("mousedown", node._eventHandlers.mousedown);
  node.canvas.removeEventListener("mousemove", node._eventHandlers.mousemove);
  node.canvas.removeEventListener("mouseup", node._eventHandlers.mouseup);
  node.canvas.removeEventListener("contextmenu", node._eventHandlers.contextmenu);

  // 移除焦点和可见性监听器
  node.canvas.removeEventListener("focus", node._eventHandlers.focus);
  node.canvas.removeEventListener("mouseenter", node._eventHandlers.mouseenter);

  // 清理Intersection Observer
  if (node._intersectionObserver) {
    node._intersectionObserver.disconnect();
    node._intersectionObserver = null;
  }

  // 清理事件处理函数引用
  node._eventHandlers = null;

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
      break;
    }
  }

  // 如果没有选中现有点，在曲线上添加新点
  if (node._curveState.draggingPoint === null) {
    // 找到最近的线段（考虑插值算法）
    const interpolationAlgorithm = node.properties.interpolation_algorithm || "catmull_rom";
    const closestSegment = findClosestSegment(node.properties.curve_points, x, y, interpolationAlgorithm);
    if (closestSegment.index !== -1) {
      const newPoint = { x: x, y: y };
      node.properties.curve_points.splice(closestSegment.index + 1, 0, newPoint);
      node._curveState.draggingPoint = closestSegment.index + 1;
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
 * 找到最近的线段（优化曲线检测）
 */
function findClosestSegment(points, targetX, targetY, interpolationAlgorithm = "catmull_rom") {
  let closestIndex = -1;
  let minDistance = Infinity;

  // 根据插值算法选择检测方法
  if (interpolationAlgorithm === "linear" || points.length < 3) {
    // 线性插值：直接检测线段
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
  } else {
    // Catmull-Rom样条插值：采样曲线上的多个点进行检测
    const sampleCount = 20; // 每段曲线采样20个点

    for (let i = 0; i < points.length - 1; i++) {
      const p0 = i > 0 ? points[i - 1] : points[0];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = i < points.length - 2 ? points[i + 2] : points[points.length - 1];

      // 在曲线上采样多个点
      for (let j = 0; j <= sampleCount; j++) {
        const t = j / sampleCount;

        // 计算曲线上的点坐标
        const curvePoint = calculateCurvePoint(p0, p1, p2, p3, t);

        // 计算点到采样点的距离
        const dx = targetX - curvePoint.x;
        const dy = targetY - curvePoint.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < minDistance && distance < 0.03) { // 更严格的阈值
          minDistance = distance;
          closestIndex = i;
        }
      }
    }
  }

  return { index: closestIndex, distance: minDistance };
}

/**
 * 计算Catmull-Rom曲线上的点
 */
function calculateCurvePoint(p0, p1, p2, p3, t) {
  // Catmull-Rom样条公式
  const t2 = t * t;
  const t3 = t2 * t;

  const x = 0.5 * (
    (2 * p1.x) +
    (-p0.x + p2.x) * t +
    (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
    (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
  );

  const y = 0.5 * (
    (2 * p1.y) +
    (-p0.y + p2.y) * t +
    (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
    (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
  );

  return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
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
 * 竖线吸附功能 - 控制点自动吸附到最近的竖线位置
 * @param {Object} node - 节点实例
 * @param {number} x - 当前X坐标（0-1）
 * @returns {number} 吸附后的X坐标
 */
function snapToVerticalGrid(node, x) {
  // 使用缓存的widget查找结果
  const pointCountWidget = node._cachedWidgets.pointCount || node.widgets?.find(w => w.name === 'point_count');
  node._cachedWidgets.pointCount = pointCountWidget;
  const pointCount = pointCountWidget ? parseInt(pointCountWidget.value || 10) : 10;

  // 计算竖线数量（最多50条）
  const verticalLines = Math.min(pointCount, 50);

  // 缓存网格计算，避免重复计算
  if (!node._cachedGrid || node._cachedGrid.verticalLines !== verticalLines) {
    const gridSpacing = 1 / verticalLines;
    const baseSnapDistance = 0.02;
    const densityFactor = Math.max(0.3, Math.min(1.0, 50 / verticalLines));
    const snapDistance = baseSnapDistance * densityFactor;

    // 预计算所有网格位置
    const gridPositions = [];
    for (let i = 0; i <= verticalLines; i++) {
      gridPositions.push(i * gridSpacing);
    }

    node._cachedGrid = {
      verticalLines,
      gridPositions,
      snapDistance
    };
  }

  const { gridPositions, snapDistance } = node._cachedGrid;

  // 查找最近的竖线位置
  let closestGridX = 0;
  let minDistance = Infinity;

  for (const gridX of gridPositions) {
    const distance = Math.abs(x - gridX);
    if (distance < minDistance) {
      minDistance = distance;
      closestGridX = gridX;
    }
  }

  // 如果距离在吸附阈值内，则吸附到最近的竖线
  if (minDistance <= snapDistance) {
    return closestGridX;
  }

  return x;
}

/**
 * 处理画布鼠标移动事件
 */
export function onCanvasMouseMove(node, e) {
  if (!node || node.id === -1 || node._curveState.draggingPoint === null || !node.canvas || !(e.buttons & 1)) return;

  // 添加防抖机制，避免频繁重绘
  const now = Date.now();
  if (node._lastMouseMoveTime && now - node._lastMouseMoveTime < 16) { // 限制60fps
    return;
  }
  node._lastMouseMoveTime = now;

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

  // 竖线吸附功能
  x = snapToVerticalGrid(node, x);

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
}


/**
 * 更新画布大小
 */
export function updateCanvasSize(node) {
  if (!node.canvas) return;

  // 保持固定尺寸
  node.canvas.width = CANVAS_WIDTH;
  node.canvas.height = CANVAS_HEIGHT;

  // 强制重绘以确保内容显示
  updateDisplay(node);

  // 添加延迟重绘确保显示
  setTimeout(() => {
    updateDisplay(node);
  }, 100);

  log.info(`Node ${node.id} canvas size updated with forced redraw`);
}