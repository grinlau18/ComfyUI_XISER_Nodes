/**
 * @file XIS_MultiPointGradient.js
 * @description ComfyUI 节点注册和前端逻辑，用于多点渐变节点。
 * @author grinlau18
 */

import { app } from "/scripts/app.js";
import { setupCanvas, updateDisplay, setupInputListeners, updateCanvasSize } from "./XIS_MultiPointGradient_canvas.js";

// 日志级别控制
const LOG_LEVEL = "error"; // Options: "info", "warning", "error"

/**
 * 日志工具
 * @type {Object}
 */
const log = {
  info: (...args) => { if (LOG_LEVEL === "info") console.log(...args); },
  warning: (...args) => { if (LOG_LEVEL === "warning" || LOG_LEVEL === "info") console.warn(...args); },
  error: (...args) => { if (LOG_LEVEL === "error" || LOG_LEVEL === "warning" || LOG_LEVEL === "info") console.error(...args); }
};

app.registerExtension({
  name: "XISER.MultiPointGradient",

  /**
   * 节点创建时初始化 UI 和监听器
   * @param {Object} node - 节点实例
   */
  nodeCreated(node) {
    if (node.comfyClass === "XIS_MultiPointGradient") {
      log.info(`Node ${node.id} created`);

      // 初始化默认属性，与后端保持一致
      node.properties = node.properties || {
        control_points: [
          { x: 0.2, y: 0.2, color: "#ff0000", influence: 1.0 },
          { x: 0.8, y: 0.8, color: "#0000ff", influence: 1.0 }
        ],
        node_size: [360, 510],
        width: 512,
        height: 512,
        interpolation: "idw"
      };

      // 延迟初始化，确保 DOM 和扩展注册完成
      // 使用随机延迟避免多个节点同时初始化冲突
      const randomDelay = 100 + Math.random() * 100;
      setTimeout(() => {
        if (node && node.id !== -1) {
          // 检查节点是否仍然存在且未被移除
          if (document.querySelector(`.xiser-gradient-node-${node.id}`)) {
            setupCanvas(node);
            setupInputListeners(node);
            updateDisplay(node);
            if (node.onResize) {
              node.onResize(node.properties.node_size);
            }
          } else {
            // 如果元素不存在，可能是DOM还未完全加载，尝试直接初始化
            log.info(`Node ${node.id} element not found, attempting direct initialization`);
            setupCanvas(node);
            setupInputListeners(node);
            updateDisplay(node);
            if (node.onResize) {
              node.onResize(node.properties.node_size);
            }
          }
        }
      }, randomDelay);
    }
  },

  /**
   * 定义节点并重写执行逻辑
   * @param {Object} nodeType - 节点类型
   * @param {Object} nodeData - 节点数据
   * @param {Object} app - ComfyUI 应用实例
   */
  beforeRegisterNodeDef(nodeType, nodeData, app) {
    if (nodeData.name === "XIS_MultiPointGradient") {
      nodeType.prototype.comfyClass = "XIS_MultiPointGradient";
      const originalOnExecuted = nodeType.prototype.onExecuted;

      nodeType.prototype.onExecuted = function (message) {
        originalOnExecuted?.apply(this, arguments);
        updateDisplay(this, message);
        requestAnimationFrame(() => {
          this.onResize?.(this.computeSize());
          app.graph.setDirtyCanvas(true, false);
        });
        log.info(`Node ${this.id} executed:`, message);
      };

      // 处理节点调整大小
      nodeType.prototype.onResize = function (size) {
        size[0] = Math.max(size[0], 360);
        size[1] = Math.max(size[1], 510);
        this.properties.node_size = [size[0], size[1]];
        updateCanvasSize(this);
        app.graph.setDirtyCanvas(true, true);
        log.info(`Node ${this.id} resized to: ${size[0]}x${size[1]}`);
      };

      // 处理节点移除
      nodeType.prototype.onRemoved = function () {
        document.querySelectorAll(`.xiser-gradient-node-${this.id}, .xiser-gradient-canvas-container-${this.id}, .xiser-color-picker-container-${this.id}, .xiser-context-menu-${this.id}, .xiser-help-icon-${this.id}, .xiser-help-text-${this.id}, .xiser-loading-spinner-${this.id}`).forEach(el => {
          log.info(`Node ${this.id} removing element:`, el.className);
          el.remove();
        });

        // Clean up global event listeners
        if (this._closeHelpHandler) {
          document.removeEventListener("click", this._closeHelpHandler);
          this._closeHelpHandler = null;
        }
        if (this._closeMenuHandler) {
          document.removeEventListener("click", this._closeMenuHandler);
          this._closeMenuHandler = null;
        }

        this.widgets = [];
        this.canvas = null;
        this.errorMessage = null;
        log.info(`Node ${this.id} removed`);
      };
    }
  },

  /**
   * 设置扩展样式
   */
  setup() {
    const style = document.createElement("style");
    style.textContent = `
      .xiser-gradient-container {
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.6);
        border-radius: 8px;
        display: flex;
        flex-direction: column;
        align-items: stretch;
      }
      .xiser-gradient-canvas-container {
        position: relative;
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 200px;
      }
      .xiser-gradient-canvas {
        display: block;
        background: #000;
        border: 1px solid #444;
      }
      .xiser-gradient-node {
        background: rgba(30, 30, 30, 0.6);
        border-radius: 8px;
        resize: both;
        overflow: hidden;
      }
      .xiser-loading-spinner {
        display: none;
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        border: 4px solid #f3f3f3;
        border-top: 4px solid #3498db;
        border-radius: 50%;
        width: 30px;
        height: 30px;
        animation: spin 1s linear infinite;
      }
      @keyframes spin {
        0% { transform: translate(-50%, -50%) rotate(0deg); }
        100% { transform: translate(-50%, -50%) rotate(360deg); }
      }
      .xiser-error-message {
        color: #F55;
        font-size: 12px;
        padding: 4px 8px;
        display: none;
        text-align: center;
      }
    `;
    document.head.appendChild(style);
    log.info("XISER.MultiPointGradient extension styles applied");
  },

  // 导出模块化方法
  setupCanvas,
  updateDisplay,
  setupInputListeners,
  updateCanvasSize,
});