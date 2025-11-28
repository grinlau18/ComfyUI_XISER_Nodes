/**
 * @file XIS_CurveEditor.js
 * @description ComfyUI 节点注册和前端逻辑，用于曲线编辑器节点。
 * @author grinlau18
 */

import { app } from "/scripts/app.js";
import { setupCanvas, updateDisplay, setupInputListeners, removeInputListeners, updateCanvasSize } from "./curve_editor_canvas.js";

// 日志级别控制
const LOG_LEVEL = "error"; // Options: "info", "warning", "error"

// 节点界面尺寸配置 (如需调整整体界面大小，可直接修改下方常量)
const NODE_UI_WIDTH = 560;
const NODE_UI_HEIGHT = 594;

// 为兼容旧逻辑继续保留最小尺寸常量（与界面尺寸保持一致）
const MIN_NODE_WIDTH = NODE_UI_WIDTH;
const MIN_NODE_HEIGHT = NODE_UI_HEIGHT;

/**
 * 确保节点ID有效
 * @param {Object} node - 节点实例
 * @returns {Promise<number>} 有效的节点ID
 */
async function ensureNodeId(node) {
  let attempts = 0;
  const maxAttempts = 50; // 最多尝试50次（5秒）

  while (node.id === -1 && attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 100));
    attempts++;
  }

  if (node.id === -1) {
    return -1;
  }

  return node.id;
}

/**
 * 初始化节点 - 直接调用setupCanvas进行初始化
 * @param {Object} node - 节点实例
 */
async function initializeNode(node) {
  if (!node || node._removed) {
    return;
  }

  // 确保节点ID有效
  const validId = await ensureNodeId(node);
  if (validId === -1) {
    log.error(`Node ${node.id} has invalid ID, skipping initialization`);
    return;
  }

  // 添加初始化防护标志，防止重复初始化
  if (node._initializing || node._initialized) {
    return;
  }

  try {
    node._initializing = true;

    // 设置初始节点大小（使用防护标志避免递归）
    if (!node._resizing) {
      node._resizing = true;
      node.size = [NODE_UI_WIDTH, NODE_UI_HEIGHT];
      if (node.setSize && LGraphNode && LGraphNode.prototype.setSize) {
        LGraphNode.prototype.setSize.call(node, [NODE_UI_WIDTH, NODE_UI_HEIGHT]);
      }
      node.resizable = false;
      node._resizing = false;
    }

    // 直接调用setupCanvas进行初始化
    setupCanvas(node);
    setupInputListeners(node);

  } catch (error) {
    log.error(`Node ${node.id} initialization error:`, error);
  } finally {
    node._initializing = false;
  }
}

/**
 * 日志工具
 * @type {Object}
 */
const log = {
  info: (...args) => { if (LOG_LEVEL === "info") console.log(...args); },
  warning: (...args) => { if (LOG_LEVEL === "warning" || LOG_LEVEL === "info") console.warn(...args); },
  error: (...args) => { if (LOG_LEVEL === "error" || LOG_LEVEL === "warning" || LOG_LEVEL === "info") console.error(...args); }
};

// 注册扩展
app.registerExtension({
  name: "XISER.CurveEditor",

  /**
   * 节点创建时初始化 UI 和监听器
   * @param {Object} node - 节点实例
   */
  nodeCreated(node) {
    if (node.comfyClass === "XIS_CurveEditor") {

      // 添加节点创建防护标志，防止重复处理
      if (node._nodeCreatedProcessed) {
        return;
      }
      node._nodeCreatedProcessed = true;

      // 仅在必要时初始化默认属性，避免覆盖已有状态（特别是复制节点时）
      const defaultProperties = {
        curve_points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 }
        ],
        node_size: [NODE_UI_WIDTH, NODE_UI_HEIGHT],
        data_type: "FLOAT",
        start_value: "0",
        end_value: "1",
        point_count: 10,
        color_interpolation: "HSV"
      };

      // 仅为未定义的属性设置默认值
      node.properties = node.properties || {};
      Object.keys(defaultProperties).forEach(key => {
        if (node.properties[key] === undefined) {
          node.properties[key] = defaultProperties[key];
        }
      });

      // 确保属性对象是独立的，不是共享引用（但保持已有值）
      if (Array.isArray(node.properties.curve_points)) {
        node.properties.curve_points = node.properties.curve_points.map(p => ({...p}));
      }
      if (Array.isArray(node.properties.node_size)) {
        node.properties.node_size = [...node.properties.node_size];
      }

      // 设置初始节点大小
      node.size = [NODE_UI_WIDTH, NODE_UI_HEIGHT];
      // 使用LiteGraph的原型方法避免递归（与XIS_CreateShape_Konva.js保持一致）
      if (node.setSize && LGraphNode && LGraphNode.prototype.setSize) {
        LGraphNode.prototype.setSize.call(node, [NODE_UI_WIDTH, NODE_UI_HEIGHT]);
      }
      node.resizable = false;

      // 清理可能存在的旧DOM元素（防止节点复制和刷新时冲突）
      const selectors = [
        `.xiser-curve-node-${node.id}`,
        `.xiser-curve-canvas-container-${node.id}`,
        `.xiser-control-panel-${node.id}`,
        `[data-node-id="${node.id}"]`
      ];

      selectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
          el.remove();
        });
      });

      // 清理可能存在的旧widget（防止节点复制时冲突）
      if (node.widgets) {
        node.widgets = node.widgets.filter(widget =>
          !widget.name || !widget.name.includes('curve_editor')
        );
      }

      // 对于新添加的节点，立即进行初始化，但使用延迟确保DOM已准备好

      // 使用延迟初始化确保DOM已准备好
      setTimeout(() => {
        if (!node._removed && node.id !== -1) {
          initializeNode(node).then(() => {
            node._initialized = true;
            // 触发重绘确保内容显示
            if (node.setDirtyCanvas) {
              node.setDirtyCanvas(true, true);
            }
          });
        }
      }, 100);
    }
  },

  /**
   * 定义节点并重写执行逻辑
   * @param {Object} nodeType - 节点类型
   * @param {Object} nodeData - 节点数据
   * @param {Object} app - ComfyUI 应用实例
   */
  beforeRegisterNodeDef(nodeType, nodeData, app) {
    if (nodeData.name === "XIS_CurveEditor") {
      nodeType.prototype.comfyClass = "XIS_CurveEditor";
      nodeType.prototype.resizable = false;

      // 处理节点配置（主要用于恢复保存的工作流）
      const origOnConfigure = nodeType.prototype.onConfigure;
      nodeType.prototype.onConfigure = function (config) {
        if (origOnConfigure) origOnConfigure.apply(this, [config]);

        // 添加配置防护标志，防止重复配置
        if (this._configured) {
          return;
        }
        this._configured = true;

        this.resizable = false;
        if (!this._resizing) {
          this._resizing = true;
          this.size = [NODE_UI_WIDTH, NODE_UI_HEIGHT];
          if (this.setSize && LGraphNode && LGraphNode.prototype.setSize) {
            LGraphNode.prototype.setSize.call(this, [NODE_UI_WIDTH, NODE_UI_HEIGHT]);
          }
          this._resizing = false;
        }

        // 防止重复初始化 - 如果已经在nodeCreated中初始化过，则跳过
        if (this._initialized) {
          return;
        }

        // 对于恢复的节点，确保DOM元素已清理并重新初始化
        if (this.id !== -1 && !this._removed) {

          // 延迟初始化确保DOM已准备好
          setTimeout(() => {
            if (!this._removed && !this._initializing) {
              initializeNode(this).then(() => {
                this._initialized = true;
                // 触发重绘确保内容显示
                if (this.setDirtyCanvas) {
                  this.setDirtyCanvas(true, true);
                }
              });
            }
          }, 150);
        }
      };

      // 处理节点调整大小 - 固定节点尺寸，避免用户调整
      nodeType.prototype.onResize = function (size) {
        if (this.id === -1 || this._removed) return;

        if (this._resizing) return;
        this._resizing = true;
        const targetSize = [NODE_UI_WIDTH, NODE_UI_HEIGHT];
        this.size = [...targetSize];
        if (this.setSize && LGraphNode && LGraphNode.prototype.setSize) {
          LGraphNode.prototype.setSize.call(this, targetSize);
        }
        this.properties.node_size = [...targetSize];
        this._resizing = false;
      };

      // 处理节点移除
      nodeType.prototype.onRemoved = function () {
        // 标记节点为已移除
        this._removed = true;

        // 移除事件监听器
        removeInputListeners(this);

        // 清理DOM元素
        const selectors = [
          `.xiser-curve-node-${this.id}`,
          `.xiser-curve-canvas-container-${this.id}`,
          `.xiser-control-panel-${this.id}`,
          `[data-node-id="${this.id}"]`,
          `#curve-canvas-${this.id}`
        ];

        selectors.forEach(selector => {
          document.querySelectorAll(selector).forEach(el => {
            if (el.parentNode) {
              log.info(`Node ${this.id} removing element:`, selector);
              el.remove();
            }
          });
        });

        // 清理所有相关状态
        this.widgets = [];
        this.canvas = null;
        this.ctx = null;
        this._curveState = null;
        this._eventHandlers = null;
        this._intersectionObserver = null;
        this._initializing = false;
        this._nodeCreatedProcessed = false;
        this._configured = false;
        this._resizing = false;
        this._initialized = false;
        this._canvasSetupInProgress = false;
        this._canvasInitialized = false;

      };
    }
  },

  /**
   * 设置扩展样式
   */
  setup() {
    const style = document.createElement("style");
    style.textContent = `
      /* 移除全局样式定义，改为内联样式避免冲突 */
    `;
    document.head.appendChild(style);
    log.info("XISER.CurveEditor extension styles applied");
  }
});

export { MIN_NODE_WIDTH, MIN_NODE_HEIGHT, NODE_UI_WIDTH, NODE_UI_HEIGHT };
