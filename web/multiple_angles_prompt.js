/**
 * @file XIS_MultipleAnglesPrompt.js
 * @description ComfyUI 多角度相机提示词节点主文件
 * 重构为基于 addDOMWidget 的架构，参考 multi_point_gradient.js 模式
 * @author grinlau18
 */

import { app } from "/scripts/app.js";
import { setupCameraPreview, cleanupNodeResources, updatePlaneTextureFromOutput } from "./multiple_angles_prompt_canvas.js";

// 日志级别控制
const LOG_LEVEL = "error";

// 节点界面尺寸配置
const NODE_UI_WIDTH = 380;
const NODE_UI_HEIGHT = 640;

// 日志工具
const log = {
  info: (...args) => { if (LOG_LEVEL === "info") console.log(...args); },
  warning: (...args) => { if (LOG_LEVEL === "warning" || LOG_LEVEL === "info") console.warn(...args); },
  error: (...args) => { if (LOG_LEVEL === "error" || LOG_LEVEL === "warning" || LOG_LEVEL === "info") console.error(...args); }
};

// 注册扩展
app.registerExtension({
  name: "XISER.MultipleAnglesPrompt",

  /**
   * 节点创建时初始化 UI
   * @param {Object} node - 节点实例
   */
  nodeCreated(node) {
    if (node.comfyClass === "XIS_MultipleAnglesPrompt") {
      log.info(`Node ${node.id} created`);

      // 初始化节点属性
      node.properties = node.properties || {
        azimuth: 0,
        elevation: 0,
        distance: 1.0,
        prompt: ''
      };

      // 延迟初始化，确保 DOM 和扩展注册完成
      // 使用随机延迟避免多个节点同时初始化冲突
      const randomDelay = 100 + Math.random() * 100;
      setTimeout(() => {
        if (node && node.id !== -1) {
          // 检查节点是否仍然存在且未被移除
          if (document.querySelector(`.xiser-multiple-angles-container-${node.id}`)) {
            setupCameraPreview(node);
            if (node.onResize) {
              node.onResize([NODE_UI_WIDTH, NODE_UI_HEIGHT]);
            }
          } else {
            // 如果元素不存在，可能是DOM还未完全加载，尝试直接初始化
            log.info(`Node ${node.id} element not found, attempting direct initialization`);
            setupCameraPreview(node);
            if (node.onResize) {
              node.onResize([NODE_UI_WIDTH, NODE_UI_HEIGHT]);
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
    if (nodeData.name === "XIS_MultipleAnglesPrompt") {
      nodeType.prototype.comfyClass = "XIS_MultipleAnglesPrompt";

      // 保存原始方法
      const originalOnExecuted = nodeType.prototype.onExecuted;
      const originalOnResize = nodeType.prototype.onResize;
      const originalOnRemoved = nodeType.prototype.onRemoved;

      // 重写onExecuted
      nodeType.prototype.onExecuted = function (message) {
        originalOnExecuted?.apply(this, arguments);
        // 可以在这里处理执行结果
        log.info(`Node ${this.id} executed:`, message);

        // 如果消息中包含图像数据，更新纹理
        if (message && typeof message === 'object') {
          try {
            updatePlaneTextureFromOutput(this, message);
          } catch (error) {
            log.error(`Node ${this.id} failed to update texture:`, error);
          }
        }

        requestAnimationFrame(() => {
          this.onResize?.([NODE_UI_WIDTH, NODE_UI_HEIGHT]);
          app.graph.setDirtyCanvas(true, false);
        });
      };

      // 重写onResize（保持节点固定尺寸）
      nodeType.prototype.onResize = function (size) {
        size[0] = Math.max(size[0], NODE_UI_WIDTH);
        size[1] = Math.max(size[1], NODE_UI_HEIGHT);
        if (originalOnResize) {
          originalOnResize.apply(this, [size]);
        }
        app.graph.setDirtyCanvas(true, true);
        log.info(`Node ${this.id} resized to: ${size[0]}x${size[1]}`);
      };

      // 重写onRemoved
      nodeType.prototype.onRemoved = function () {
        // 清理DOM元素
        document.querySelectorAll(`.xiser-multiple-angles-container-${this.id}, .xiser-multiple-angles-preview-area-${this.id}, .xiser-multiple-angles-loading-tip-${this.id}, .xiser-multiple-angles-preview-info-${this.id}, .xiser-multiple-angles-param-controls-${this.id}, .xiser-multiple-angles-prompt-display-${this.id}`).forEach(el => {
          log.info(`Node ${this.id} removing element:`, el.className);
          el.remove();
        });

        // 清理Three.js资源
        cleanupNodeResources(this);

        this.widgets = [];
        this._threejs = null;
        log.info(`Node ${this.id} removed`);

        if (originalOnRemoved) {
          originalOnRemoved.apply(this);
        }
      };
    }
  },

  /**
   * 设置扩展样式
   */
  setup() {
    const style = document.createElement("style");
    style.textContent = `
      .xiser-multiple-angles-container {
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        padding: 10px;
        font-family: Arial, sans-serif;
      }
      .xiser-multiple-angles-preview-area {
        width: 100%;
        height: 300px;
        margin: 0 auto 15px;
        overflow: visible;
        position: relative;
        background: transparent;
      }
      .xiser-multiple-angles-preview-area canvas {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 5;
        background: transparent;
      }
      .xiser-multiple-angles-loading-tip {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        color: rgb(170,170,170);
        font-size: 14px;
        z-index: 5;
      }
      .xiser-multiple-angles-preview-info {
        position: absolute;
        bottom: 8px;
        left: 8px;
        background: rgba(0, 0, 0, 0.7);
        color: rgb(170,170,170);
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 11px;
        z-index: 1000;
      }
      .xiser-multiple-angles-param-controls {
        margin-bottom: 0px !important;
        padding: 0px 0;
      }
      .xiser-multiple-angles-param-controls .control-group {
        margin-bottom: 0px;
      }
      .xiser-multiple-angles-param-controls .control-group .control-header {
        margin-bottom: 4px;
      }
      .xiser-multiple-angles-param-controls .control-group label {
        display: inline-block;
        margin-right: 8px;
        font-weight: 600;
        color: rgb(170,170,170);
        font-size: 12px;
      }
      .xiser-multiple-angles-param-controls .control-group input[type="range"] {
        width: 100%;
        height: 24px;
        margin: 0;
        padding: 0;
      }
      .xiser-multiple-angles-param-controls .param-value {
        display: inline-block;
        font-size: 11px;
        color: rgb(170,170,170);
        margin-left: 4px;
      }
      .xiser-multiple-angles-prompt-display {
        margin-top: -20px !important;
        margin-bottom: 0px !important;
        padding: 0px 0;
      }
      .xiser-multiple-angles-prompt-display h3 {
        font-size: 14px;
        margin-bottom: 6px !important;
        color: rgb(170,170,170);
        font-weight: 500;
      }
      .xiser-multiple-angles-prompt-display .prompt-output {
        width: 100%;
        padding: 8px;
        border: 1px solid #ffffff2a;
        border-radius: 4px;
        font-size: 12px;
        margin-bottom: 8px;
        resize: none;
        height: 52px;
        background: #ffffff1b;
        color: rgb(170,170,170);
        font-family: monospace;
      }
      .xiser-multiple-angles-prompt-display .prompt-info {
        font-size: 11px;
        color: rgb(170,170,170);
        text-align: center;
      }
    `;
    document.head.appendChild(style);
    log.info("XISER.MultipleAnglesPrompt extension styles applied");
  },

  // 导出模块化方法
  setupCameraPreview,
  cleanupNodeResources
});