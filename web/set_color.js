/**
 * @file XIS_SetColor.js
 * @description ComfyUI 节点注册和前端逻辑，用于颜色选择节点。
 * @author grinlau18
 */

import { app } from "/scripts/app.js";

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

/**
 * 确保节点 ID 有效
 * @param {Object} node - ComfyUI 节点对象
 * @returns {Promise<boolean>} 是否获取到有效 ID
 */
async function ensureNodeId(node) {
    let attempts = 0;
    while (node.id === -1 && attempts < 100) {
        await new Promise(resolve => setTimeout(resolve, 50));
        attempts++;
    }
    if (node.id === -1) {
        log.error("Failed to get valid node ID after 100 attempts");
        return false;
    }
    log.info(`Node ID assigned: ${node.id}`);
    return true;
}

/**
 * 创建颜色块 UI
 * @param {Object} node - 节点实例
 */
function createColorBlockUI(node) {
    // 创建颜色块容器
    const container = document.createElement("div");
    container.className = `xis-color-container xis-color-container-${node.id}`;

    // 创建颜色块
    const colorBlock = document.createElement("div");
    colorBlock.className = `xis-color-block xis-color-block-${node.id}`;
    colorBlock.style.backgroundColor = node.properties.colorData?.color || "#ffffff";

    // 添加点击事件监听器
    colorBlock.addEventListener("click", (e) => {
        e.stopPropagation();
        openColorPicker(node);
    });


    container.appendChild(colorBlock);

    // 存储颜色块引用以便后续更新
    node.colorBlockElement = colorBlock;

    return container;
}

/**
 * 更新颜色显示
 * @param {Object} node - 节点实例
 */
function updateColorDisplay(node) {
    const color = node.properties.colorData?.color || "#ffffff";

    // 使用存储的颜色块引用，只更新背景颜色
    if (node.colorBlockElement) {
        node.colorBlockElement.style.backgroundColor = color;
    }
}

/**
 * 打开颜色选择器
 * @param {Object} node - 节点实例
 */
function openColorPicker(node) {
    const currentColor = node.properties.colorData?.color || "#ffffff";

    // 创建颜色选择器输入元素
    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = currentColor;
    colorInput.style.position = "absolute";
    colorInput.style.left = "-9999px";
    colorInput.style.top = "-9999px";

    // 添加变化事件监听器
    colorInput.addEventListener("change", (e) => {
        const newColor = e.target.value;

        // 更新节点属性
        node.properties.colorData = { color: newColor };

        // 更新显示
        updateColorDisplay(node);

        // 触发节点值变化
        if (node.widgets) {
            const colorWidget = node.widgets.find(w => w.name === "color_data");
            if (colorWidget && colorWidget.callback) {
                colorWidget.callback(node.properties.colorData);
            }
        }

        // 设置图形为脏状态以触发重新渲染
        app.graph.setDirtyCanvas(true, false);

        log.info(`Color changed to: ${newColor}`);

        // 移除颜色选择器
        document.body.removeChild(colorInput);
    });

    // 添加失去焦点事件（用户可能点击其他地方取消）
    colorInput.addEventListener("blur", () => {
        setTimeout(() => {
            if (document.body.contains(colorInput)) {
                document.body.removeChild(colorInput);
            }
        }, 100);
    });

    // 添加到文档并触发点击
    document.body.appendChild(colorInput);
    colorInput.click();
}

app.registerExtension({
  name: "XISER.SetColor",

  /**
   * 节点创建时初始化 UI
   * @param {Object} node - 节点实例
   */
  async nodeCreated(node) {
    if (node.comfyClass === "XIS_SetColor") {
      log.info(`Node ${node.id} created`);

      // 初始化默认属性
      node.properties = node.properties || {
        colorData: { color: "#ffffff" }
      };

      // 等待有效节点 ID
      if (!(await ensureNodeId(node))) {
        return;
      }

      // 设置最小节点尺寸
      app.graph.setDirtyCanvas(true);

      // 移除现有的颜色选择器控件（如果存在）
      if (node.widgets) {
        node.widgets = node.widgets.filter(widget =>
          !widget.name || !widget.name.includes('color_data')
        );
      }

      // 创建颜色块 UI（LiteGraph DOM 模式）
      const colorContainer = createColorBlockUI(node);

      // 注册 DOM 控件；Vue 前端支持 DOM widget 时显示色块
      if (typeof node.addDOMWidget === "function") {
        node.addDOMWidget("color_data", "Color Picker", colorContainer, {
          serialize: true,
          hideOnZoom: false,
          getValue: () => {
            return node.properties.colorData || { color: "#ffffff" };
          },
          setValue: (value) => {
            node.properties.colorData = value;
            updateColorDisplay(node);
          },
          getMinHeight: () => 32, // 设置最小高度
          getHeight: () => 32,
          margin: 6
        });
      } else {
        log.warning("addDOMWidget not available; SetColor DOM widget will not render in this frontend.");
      }

      log.info(`Color widget setup completed for node ${node.id}`);
    }
  },

  /**
   * 定义节点并重写执行逻辑
   * @param {Object} nodeType - 节点类型
   * @param {Object} nodeData - 节点数据
   * @param {Object} app - ComfyUI 应用实例
   */
  beforeRegisterNodeDef(nodeType, nodeData, app) {
    if (nodeData.name === "XIS_SetColor") {
      nodeType.prototype.comfyClass = "XIS_SetColor";

      // 处理节点调整大小
      nodeType.prototype.onResize = function (size) {
        // 确保最小尺寸
        size[0] = Math.max(size[0], 210);
        size[1] = Math.max(size[1], 60);
        app.graph.setDirtyCanvas(true, true);
        log.info(`Node ${this.id} resized to: ${size[0]}x${size[1]}`);
      };

      // 处理节点移除
      nodeType.prototype.onRemoved = function () {
        if (this.element) {
          this.element.querySelectorAll(`.xis-color-container-${this.id}, .xis-color-block-${this.id}`).forEach(el => {
            log.info(`Node ${this.id} removing element:`, el.className);
            el.remove();
          });
        }
        // 清理颜色块引用
        this.colorBlockElement = null;
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
      .xis-color-container {
        box-sizing: border-box;
        width: 100%;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        border-radius: 8px;
        margin-top: -4px;
      }

      .xis-color-block {
        width: 100%;
        height: 100%;
        border-radius: 6px;
        box-shadow: 0 2px 3px rgba(0,0,0,0.15);
        transition: all 0.2s ease;
        cursor: pointer;
      }

      .xis-color-block:hover {
        transform: scale(1.02);
      }
    `;
    document.head.appendChild(style);
    log.info("XISER.SetColor extension styles applied");
  }
});
