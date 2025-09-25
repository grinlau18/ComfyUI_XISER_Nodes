/**
 * @file XIS_CreateShape_Konva.js
 * @description ComfyUI 节点注册和前端逻辑，使用 Konva 库创建几何形状节点，支持移动、缩放、旋转和变形。
 * @author grinlau18
 */

import { app } from "/scripts/app.js";
import ShapeRegistry from "./shape_generators/registry.js";
import KonvaWheelInteraction from "./shape_generators/konva_wheel_interaction.js";

// 导入模块化组件
import { log, normalizeColor } from "./shape_generators/xis_shape_utils.js";
import { createKonvaShape, updateKonvaShape, setStateManagementFunctions } from "./shape_generators/xis_shape_creator.js";
import { createResetButton, createCenterAlignButton, updateButtonPositions } from "./shape_generators/xis_button_manager.js";
import { createGridSystem, updateGridColor } from "./shape_generators/xis_grid_system.js";
import { saveShapeState, restoreShapeState, resetShapeState, centerAlignShape, updateCanvasBackground } from "./shape_generators/xis_state_manager.js";
import { setupInputListeners, setupParametricControls, initializeWidgetsFromProperties, setControlDependencies } from "./shape_generators/xis_control_manager.js";

// 日志级别控制
const LOG_LEVEL = "error"; // Options: "info", "warning", "error"

// 固定节点尺寸配置
const MIN_NODE_WIDTH = 360;  // 节点最小宽度 (px)
const MIN_NODE_HEIGHT = 510; // 节点最小高度 (px)

// 画布缩放因子 - 画布大小为输出尺寸的75%
const CANVAS_SCALE_FACTOR = 0.75;

// 描边宽度补偿因子 - 用于调整前端描边宽度显示比例
const STROKE_WIDTH_COMPENSATION = 0.9; // 值越小，前端描边越细

console.log("XIS_CreateShape_Konva.js loaded successfully");

// 设置模块间的依赖关系
setStateManagementFunctions(saveShapeState, restoreShapeState);
setControlDependencies(saveShapeState, ShapeRegistry, updateCanvasSize);

/**
 * 设置 Konva 画布
 * @param {Object} node - 节点实例
 */
export function setupKonvaCanvas(node) {
  if (!node || node.id === -1) {
    log.warning(`Invalid node or node.id: ${node?.id}`);
    return;
  }

  // 在初始化前先清理可能存在的旧DOM元素（防止节点复制时冲突）
  const selectors = [
    `.xiser-shape-node-${node.id}`,
    `.xiser-shape-canvas-container-${node.id}`,
    `.xiser-params-container-${node.id}`,
    `[data-node-id="${node.id}"]`
  ];

  selectors.forEach(selector => {
    document.querySelectorAll(selector).forEach(el => {
      el.remove();
    });
  });

  // 清理可能存在的旧DOM widget（防止节点复制时冲突）
  if (node.widgets) {
    node.widgets = node.widgets.filter(widget =>
      !widget.name || !widget.name.includes('shape_canvas')
    );
  }

  // 如果已经初始化过，先清理旧状态
  if (node.konvaState?.initialized) {
    if (node.konvaState.stage) {
      node.konvaState.stage.destroy();
    }
    if (node.konvaState.wheelInteraction) {
      node.konvaState.wheelInteraction.destroy();
    }
    if (node.konvaState.layer) {
      node.konvaState.layer.destroy();
    }
    node.konvaState = null;
  }

  node.konvaState = node.konvaState || {
    stage: null,
    shape: null,
    transformer: null,
    layer: null,
    background: null,
    resetButton: null,
    centerAlignButton: null,
    initialized: false,
    isSettingValue: false // 防止setValue和widget回调冲突
  };

  // 重置按钮配置
  node.konvaState.resetButtonConfig = {
    xOffset: 32,    // 距离右侧的偏移量
    yOffset: 28,    // 距离顶部的偏移量
    width: 32,      // 按钮宽度
    height: 32,     // 按钮高度
    bgRadius: 16,   // 背景圆形半径
    iconScale: 0.045 // 图标缩放比例
  };

  // 居中对齐按钮配置
  node.konvaState.centerAlignButtonConfig = {
    xOffset: 72,    // 距离右侧的偏移量（在重置按钮左侧）
    yOffset: 28,    // 距离顶部的偏移量
    width: 32,      // 按钮宽度
    height: 32,     // 按钮高度
    bgRadius: 16,   // 背景圆形半径
    iconScale: 0.7  // 图标缩放比例（新图标需要更大缩放）
  };

  // 创建主容器
  const mainContainer = document.createElement("div");
  mainContainer.className = `xiser-shape-node-${node.id}`;
  mainContainer.dataset.nodeId = node.id.toString();
  mainContainer.style.cssText = `
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.4);
    border-radius: 8px;
    display: flex;
    gap: 8px;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 8px;
    box-sizing: border-box;
    overflow: hidden; /* 防止子元素溢出 */
  `;

  // 创建画布容器
  const canvasContainer = document.createElement("div");
  canvasContainer.className = `xiser-shape-canvas-container-${node.id}`;
  canvasContainer.style.cssText = `
    background: rgba(0,0,0,0);
    border-radius: 6px;
    flex: 1; /* 占用剩余空间 */
    max-width: 100%;
    max-height: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
    overflow: visible;
  `;

  // 创建参数容器
  const paramsContainer = document.createElement("div");
  paramsContainer.className = `xiser-params-container-${node.id}`;
  paramsContainer.style.cssText = `
    width: 100%;
    padding: 12px;
    box-sizing: border-box;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 6px;
    display: none; /* 默认隐藏，动态显示 */
    transition: height 0.3s ease, opacity 0.3s ease; /* 添加平滑过渡 */
  `;

  mainContainer.appendChild(canvasContainer);
  mainContainer.appendChild(paramsContainer);

  // 加载 Konva
  let retryCount = 0;
  const loadKonva = () => {
    if (!window.Konva && retryCount < 5) {
      retryCount++;
      log.warning(`Konva not loaded, retry ${retryCount}/5`);
      setTimeout(loadKonva, 100);
      return;
    }
    if (!window.Konva) {
      log.error("Failed to load Konva after retries");
      return;
    }

    // 初始画布尺寸 - 使用缩放后的尺寸
    const outputWidth = parseInt(node.properties.width) || 512;
    const outputHeight = parseInt(node.properties.height) || 512;
    const stageWidth = Math.round(outputWidth * CANVAS_SCALE_FACTOR);
    const stageHeight = Math.round(outputHeight * CANVAS_SCALE_FACTOR);

    // 创建 Konva 舞台
    const stage = new Konva.Stage({
      container: canvasContainer,
      width: stageWidth,
      height: stageHeight
    });

    // 创建背景
    const properties = node.properties || {};
    const bgColor = properties.bg_color || "#000000";
    const transparentBg = Boolean(properties.transparent_bg);
    const backgroundColor = transparentBg ? 'rgba(0, 0, 0, 0.3)' : bgColor;

    const background = new Konva.Rect({
      x: 0,
      y: 0,
      width: stage.width(),
      height: stage.height(),
      fill: backgroundColor,
      listening: false,
      name: 'background'
    });

    // 创建网格系统
    const { gridLayer, drawGrid } = createGridSystem(stage, backgroundColor);

    const layer = new Konva.Layer();
    stage.add(layer);
    layer.add(background);

    // 创建重置按钮
    const resetButton = createResetButton(node, stage, layer, resetShapeState);

    // 创建居中对齐按钮
    const centerAlignButton = createCenterAlignButton(node, stage, layer, centerAlignShape);

    // 创建变换器，支持更多锚点和剪切
    const transformer = new Konva.Transformer({
      keepRatio: false,
      enabledAnchors: [
        'top-left', 'top-center', 'top-right',
        'middle-left', 'middle-right',
        'bottom-left', 'bottom-center', 'bottom-right'
      ],
      rotateEnabled: true,
      skewEnabled: true,
      boundBoxFunc: (oldBox, newBox) => {
        if (newBox.width < 10 || newBox.height < 10) return oldBox;
        return newBox;
      }
    });
    layer.add(transformer);

    // 点击选择形状
    stage.on('click tap', (e) => {
      // 检查点击目标是否是按钮，如果是则忽略
      const target = e.target;
      if (target && (target.getName() === 'resetButton' || target.getName() === 'centerAlignButton' ||
          target.parent && (target.parent.getName() === 'resetButton' || target.parent.getName() === 'centerAlignButton'))) {
        return; // 忽略按钮点击，让按钮自己的事件处理器处理
      }

      const shape = e.target.closest('Path') || e.target.closest('Group') || e.target;
      if (shape && shape.getName() === 'shape') {
        transformer.nodes([shape]);
      } else {
        transformer.nodes([]);
      }
      layer.batchDraw();
    });

    node.konvaState.stage = stage;
    node.konvaState.layer = layer;
    node.konvaState.transformer = transformer;
    node.konvaState.background = background;
    node.konvaState.drawGrid = drawGrid;

    // 初始化形状
    updateKonvaShape(node);
    updateCanvasSize(node);
    layer.batchDraw();

    // 标记为已初始化
    node.konvaState.initialized = true;

    // 初始化鼠标滚轮交互
    node.konvaState.wheelInteraction = new KonvaWheelInteraction(node);
    node.konvaState.wheelInteraction.init();

    // 恢复形状状态
    if (node.properties.shapeState) {
      restoreShapeState(node);
      log.info(`Node ${node.id} shape state restored during canvas setup`);
    }

    log.info(`Node ${node.id} Konva stage initialized with size ${stage.width()}x${stage.height()}`);
  };

  // 确保 DOM 渲染完成
  requestAnimationFrame(() => {
    if (document.body.contains(mainContainer)) {
      loadKonva();
    } else {
      log.warning(`Node ${node.id} mainContainer not in DOM, retrying...`);
      setTimeout(loadKonva, 100);
    }
  });

  // 确保没有重复的shape_canvas widget
  if (node.widgets) {
    node.widgets = node.widgets.filter(widget =>
      !widget.name || !widget.name.includes('shape_canvas')
    );
  }

  // 注册 DOM 控件
  node.addDOMWidget("shape_canvas", "Shape Canvas", mainContainer, {
    serialize: true,
    hideOnZoom: false,
    getValue: () => {
      try {
        const shape = node.konvaState?.shape;

        // 保存当前形状状态（如果形状存在）
        if (shape) {
          saveShapeState(node);
        }

        // 解析当前形状状态以传递给后端
        let shapeState = {};
        try {
          shapeState = JSON.parse(node.properties.shapeState || "{}");
        } catch (e) {
          log.error(`Node ${node.id} error parsing shapeState: ${e}`);
        }

        // 检查是否有shape_data输入端口数据
        const hasShapeData = node.inputs && node.inputs.some(input =>
          input.name === "shape_data" && input.link !== null
        );

        // 返回完整的序列化数据包含变换参数
        const serializedData = {
          shape_type: node.properties.shape_type || "circle",
          shape_params: node.properties.shape_params || JSON.stringify({ angle: 360, inner_radius: 0 }),
          shape_color: node.properties.shape_color || "#FF0000",
          bg_color: node.properties.bg_color || "rgba(0,0,0,0)",
          transparent_bg: Boolean(node.properties.transparent_bg),
          stroke_color: node.properties.stroke_color || "#FFFFFF",
          stroke_width: parseInt(node.properties.stroke_width) || 0,
          width: parseInt(node.properties.width) || 512,
          height: parseInt(node.properties.height) || 512,
          // 直接传递变换参数给后端
          position: shapeState.position || { x: 0.0, y: 0.0 },
          rotation: shapeState.rotation || 0,
          scale: shapeState.scale || { x: 1, y: 1 },
          skew: shapeState.skew || { x: 0, y: 0 },
          // 标记是否有shape_data输入
          has_shape_data_input: hasShapeData
        };

        log.info(`Node ${node.id} serialized data for backend: position=${JSON.stringify(serializedData.position)}, rotation=${serializedData.rotation}, scale=${JSON.stringify(serializedData.scale)}, skew=${JSON.stringify(serializedData.skew)}, has_shape_data_input=${hasShapeData}`);
        return serializedData;
      } catch (e) {
        log.error(`Node ${node.id} error in getValue: ${e}`);

        // 返回最基本的默认数据
        return {
          shape_type: "circle",
          shape_params: JSON.stringify({ angle: 360, inner_radius: 0 }),
          shape_color: "#FF0000",
          bg_color: "#000000",
          transparent_bg: false,
          stroke_color: "#FFFFFF",
          stroke_width: 0,
          width: 512,
          height: 512,
          position: { x: 0.0, y: 0.0 },
          rotation: 0,
          scale: { x: 1, y: 1 },
          skew: { x: 0, y: 0 },
          has_shape_data_input: false
        };
      }
    },
    setValue: (value) => {
      try {
        log.info(`Node ${node.id} setValue received:`, Object.keys(value || {}));

        // 设置标志防止widget回调冲突
        if (node.konvaState) {
          node.konvaState.isSettingValue = true;
        }

        // 安全地更新节点属性，处理可能的undefined值
        const safeValue = value || {};

        // 只更新实际提供的且发生变化的属性，避免不必要的更新
        const propertiesToUpdate = {};

        if (safeValue.shape_type !== undefined && safeValue.shape_type !== node.properties.shape_type) propertiesToUpdate.shape_type = safeValue.shape_type;
        if (safeValue.shape_params !== undefined && safeValue.shape_params !== node.properties.shape_params) propertiesToUpdate.shape_params = safeValue.shape_params;
        if (safeValue.shape_color !== undefined && normalizeColor(safeValue.shape_color) !== normalizeColor(node.properties.shape_color)) propertiesToUpdate.shape_color = safeValue.shape_color;
        if (safeValue.bg_color !== undefined && normalizeColor(safeValue.bg_color) !== normalizeColor(node.properties.bg_color)) propertiesToUpdate.bg_color = safeValue.bg_color;
        if (safeValue.transparent_bg !== undefined && Boolean(safeValue.transparent_bg) !== Boolean(node.properties.transparent_bg)) propertiesToUpdate.transparent_bg = Boolean(safeValue.transparent_bg);
        if (safeValue.stroke_color !== undefined && normalizeColor(safeValue.stroke_color) !== normalizeColor(node.properties.stroke_color)) propertiesToUpdate.stroke_color = safeValue.stroke_color;
        if (safeValue.stroke_width !== undefined && parseInt(safeValue.stroke_width) !== parseInt(node.properties.stroke_width)) propertiesToUpdate.stroke_width = parseInt(safeValue.stroke_width) || 0;
        if (safeValue.width !== undefined && parseInt(safeValue.width) !== parseInt(node.properties.width)) propertiesToUpdate.width = parseInt(safeValue.width) || 512;
        if (safeValue.height !== undefined && parseInt(safeValue.height) !== parseInt(node.properties.height)) propertiesToUpdate.height = parseInt(safeValue.height) || 512;
        if (safeValue.shapeState !== undefined && safeValue.shapeState !== node.properties.shapeState) propertiesToUpdate.shapeState = safeValue.shapeState;

        // 只在有实际变化时合并属性
        if (Object.keys(propertiesToUpdate).length > 0) {
          node.properties = {
            ...node.properties,
            ...propertiesToUpdate
          };
        }

        // 更新控件值（只在属性有变化时更新）
        const widgets = node.widgets || [];
        widgets.forEach(widget => {
          if (widget.name && node.properties[widget.name] !== undefined && widget.value !== node.properties[widget.name]) {
            widget.value = node.properties[widget.name];
          }
        });

        log.info(`Node ${node.id} properties updated from setValue`);

        // 如果Konva已经初始化，更新画布和形状
        if (node.konvaState?.initialized) {
          // 检查颜色相关属性是否实际发生变化，如果是则更新画布
          const colorPropsChanged =
            (safeValue.shape_color !== undefined && normalizeColor(safeValue.shape_color) !== normalizeColor(node.properties.shape_color)) ||
            (safeValue.bg_color !== undefined && normalizeColor(safeValue.bg_color) !== normalizeColor(node.properties.bg_color)) ||
            (safeValue.transparent_bg !== undefined && Boolean(safeValue.transparent_bg) !== Boolean(node.properties.transparent_bg)) ||
            (safeValue.stroke_color !== undefined && normalizeColor(safeValue.stroke_color) !== normalizeColor(node.properties.stroke_color)) ||
            (safeValue.stroke_width !== undefined && parseInt(safeValue.stroke_width) !== parseInt(node.properties.stroke_width));

          if (colorPropsChanged) {
            updateCanvasBackground(node);
            updateKonvaShape(node);
          }

          // 如果有shapeState，恢复形状状态
          if (node.properties.shapeState) {
            updateKonvaShape(node);
            restoreShapeState(node);
          }

          // 更新画布尺寸（必须在颜色更新之后调用）
          updateCanvasSize(node);

          node.setDirtyCanvas(true, true);
          log.info(`Node ${node.id} canvas updated from setValue`);
        }

        // 重置标志
        if (node.konvaState) {
          node.konvaState.isSettingValue = false;
        }
      } catch (e) {
        log.error(`Node ${node.id} error in setValue: ${e}`);
        // 确保异常时也重置标志
        if (node.konvaState) {
          node.konvaState.isSettingValue = false;
        }
      }
    }
  });

  setupInputListeners(node);
  setupParametricControls(node, paramsContainer);
}

/**
 * 更新画布大小
 * @param {Object} node - 节点实例
 */
export function updateCanvasSize(node) {
  if (!node || node.id === -1 || !node.konvaState?.stage) {
    log.warning(`Node ${node?.id || 'unknown'} Konva stage not initialized`);
    return;
  }

  const mainContainerEl = document.querySelector(`.xiser-shape-node-${node.id}`);
  const canvasContainerEl = document.querySelector(`.xiser-shape-canvas-container-${node.id}`);
  const paramsContainerEl = document.querySelector(`.xiser-params-container-${node.id}`);

  if (!mainContainerEl || !canvasContainerEl || !paramsContainerEl) {
    log.warning(`Node ${node.id} containers not found`);
    return;
  }

  // 固定画布尺寸为输出尺寸的75%
  const outputWidth = parseInt(node.properties.width) || 512;
  const outputHeight = parseInt(node.properties.height) || 512;
  const stageWidth = Math.round(outputWidth * CANVAS_SCALE_FACTOR);
  const stageHeight = Math.round(outputHeight * CANVAS_SCALE_FACTOR);

  // 设置画布容器和舞台大小
  canvasContainerEl.style.width = `${stageWidth}px`;
  canvasContainerEl.style.height = `${stageHeight}px`;
  node.konvaState.stage.width(stageWidth);
  node.konvaState.stage.height(stageHeight);

  // 设置参数容器宽度，匹配画布宽度
  paramsContainerEl.style.maxWidth = `${stageWidth}px`;

  // 更新背景大小
  if (node.konvaState.background) {
    node.konvaState.background.width(stageWidth);
    node.konvaState.background.height(stageHeight);
  }

  // 更新网格颜色
  if (node.konvaState.drawGrid) {
    node.konvaState.drawGrid();
  }

  // 更新按钮位置
  updateButtonPositions(node, stageWidth);

  // 使用固定高度估算控件高度（因为控件可能尚未渲染）
  const widgets = node.widgets || [];
  const widgetCount = widgets.filter(w =>
    w.type === "number" || w.type === "combo" || w.type === "string" || w.type === "boolean"
  ).length;

  // 每个控件大约40px高度，加上间距
  const widgetHeight = widgetCount * 44;

  // 计算参数控件高度
  let paramsHeight = 0;
  if (paramsContainerEl.children.length > 0) {
    // 使用固定估算值，因为元素可能尚未完全渲染
    paramsHeight = 120; // 参数控件的大致高度
  }

  // 自动调整节点尺寸以适应固定画布大小和控件
  const containerPadding = 8;
  const targetWidth = Math.max(MIN_NODE_WIDTH, stageWidth + 2 * containerPadding + 20); // 额外宽度边距
  const targetHeight = Math.max(MIN_NODE_HEIGHT, stageHeight + widgetHeight + paramsHeight + 2 * containerPadding + 130); // 增加额外高度确保完全显示

  if (node.size[0] !== targetWidth || node.size[1] !== targetHeight) {
    node.size = [targetWidth, targetHeight];
    // 使用LiteGraph的原型方法避免递归
    LGraphNode.prototype.setSize.call(node, [targetWidth, targetHeight]);
    node.setDirtyCanvas(true, true);
  }

  // 确保参数容器可见
  if (paramsContainerEl.children.length > 0) {
    paramsContainerEl.style.display = "block";
  }

  // 验证容器和画布尺寸
  const mainRect = mainContainerEl.getBoundingClientRect();
  const canvasRect = canvasContainerEl.getBoundingClientRect();
  const paramsRect = paramsContainerEl.getBoundingClientRect();
  log.info(`Node ${node.id} layout updated: node=${targetWidth}x${targetHeight}, mainContainer=${mainRect.width}x${mainRect.height}, canvas=${canvasRect.width}x${canvasRect.height}, params=${paramsRect.width}x${paramsRect.height}, stage=${stageWidth}x${stageHeight}`);

  // 更新形状
  if (node.konvaState.shape) {
    updateKonvaShape(node);
    node.konvaState.transformer.nodes([node.konvaState.shape]);
    node.konvaState.layer.batchDraw();
  }
}

// 注册扩展
app.registerExtension({
  name: "XISER.CreateShapeKonva",

  /**
   * 节点创建时初始化 UI 和监听器
   * @param {Object} node - 节点实例
   */
  nodeCreated(node) {
    if (node.comfyClass === "XIS_CreateShape") {
      log.info(`Node ${node.id} created`);

      // 保存原始onConnectionsChange方法
      const origOnConnectionsChange = node.onConnectionsChange;
      node.onConnectionsChange = function(type, index, connected, link_info) {
        if (origOnConnectionsChange) origOnConnectionsChange.apply(this, arguments);

        // 当控件连接到上游节点时，确保实时更新
        if (type === "input" && link_info) {
          const widgetName = link_info.name;
          const colorWidgets = ['shape_color', 'bg_color', 'stroke_color', 'stroke_width', 'transparent_bg'];

          if (colorWidgets.includes(widgetName)) {
            if (connected) {
              log.info(`Node ${node.id} color widget ${widgetName} connected to upstream`);
            } else {
              log.info(`Node ${node.id} color widget ${widgetName} disconnected from upstream`);
            }
            // 立即更新画布以反映连接状态变化
            if (node.konvaState?.initialized) {
              updateCanvasBackground(node);
              updateKonvaShape(node);
              node.setDirtyCanvas(true, true);
            }
          }

          // 处理shape_data端口连接变化
          if (widgetName === "shape_data") {
            if (connected) {
              log.info(`Node ${node.id} shape_data input connected to upstream`);
            } else {
              log.info(`Node ${node.id} shape_data input disconnected from upstream`);
            }
            // 立即更新画布以反映连接状态变化
            if (node.konvaState?.initialized) {
              node.setDirtyCanvas(true, true);
            }
          }
        }
      };

      // 清理可能存在的旧状态（防止节点复制时冲突）
      if (node.widgets) {
        node.widgets = node.widgets.filter(widget =>
          !widget.name || !widget.name.includes('shape_canvas')
        );
      }

      // 清理Konva状态
      if (node.konvaState) {
        if (node.konvaState.stage) {
          node.konvaState.stage.destroy();
        }
        if (node.konvaState.wheelInteraction) {
          node.konvaState.wheelInteraction.destroy();
        }
        if (node.konvaState.layer) {
          node.konvaState.layer.destroy();
        }
        node.konvaState = null;
      }

      // 清理可能存在的DOM元素（防止节点复制时冲突）
      const selectors = [
        `.xiser-shape-node-${node.id}`,
        `.xiser-shape-canvas-container-${node.id}`,
        `.xiser-params-container-${node.id}`,
        `[data-node-id="${node.id}"]`
      ];

      selectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
          el.remove();
        });
      });

      // 仅在必要时初始化默认属性，避免覆盖已有状态
      const defaultProperties = {
        shape_type: "circle",
        shape_params: JSON.stringify({ angle: 360, inner_radius: 0 }),
        shape_color: "#FF0000",
        bg_color: "#000000",
        transparent_bg: false,
        stroke_color: "#FFFFFF",
        stroke_width: 0,
        width: 512,
        height: 512
      };

      // 仅为未定义的属性设置默认值
      node.properties = node.properties || {};
      Object.keys(defaultProperties).forEach(key => {
        if (node.properties[key] === undefined) {
          node.properties[key] = defaultProperties[key];
        }
      });

      // 初始化widget值从属性
      initializeWidgetsFromProperties(node);

      // 设置初始节点大小
      node.size = [MIN_NODE_WIDTH, MIN_NODE_HEIGHT];
      // 使用LiteGraph的原型方法避免递归
      LGraphNode.prototype.setSize.call(node, [MIN_NODE_WIDTH, MIN_NODE_HEIGHT]);

      // 确保 DOM 渲染后初始化（增加延迟以防止节点复制时的冲突）
      setTimeout(() => {
        requestAnimationFrame(() => {
          if (node && node.id !== -1) {
            setupKonvaCanvas(node);
            // 延迟更新尺寸以确保所有控件都已渲染
            setTimeout(() => {
              updateCanvasSize(node);
            }, 200);
          }
        });
      }, 100);
    }
  },

  /**
   * 处理节点调整大小
   * @param {Object} nodeType - 节点类型
   * @param {Object} nodeData - 节点数据
   * @param {Object} app - ComfyUI 应用实例
   */
  beforeRegisterNodeDef(nodeType, nodeData, app) {
    if (nodeData.name === "XIS_CreateShape") {
      nodeType.prototype.comfyClass = "XIS_CreateShape";

      // shape_data输入端口由后端Python文件定义，前端只负责检测和处理连接状态

      // 禁用手动调整节点大小，节点大小完全由自动调整控制
      nodeType.prototype.onResize = function (size) {
        // 忽略所有手动调整，保持自动调整的大小
        if (this.id !== -1 && this.size) {
          // 恢复为自动调整的大小，但避免递归调用
          if (!this._resizing) {
            this._resizing = true;
            LGraphNode.prototype.setSize.call(this, this.size);
            this._resizing = false;
            log.info(`Node ${this.id} resize ignored, maintaining auto-adapted size`);
          }
        }
      };

      nodeType.prototype.onRemoved = function () {
        if (this.konvaState?.stage) {
          this.konvaState.stage.destroy();
        }

        // 清理滚轮交互
        if (this.konvaState?.wheelInteraction) {
          this.konvaState.wheelInteraction.destroy();
        }

        // 清理所有相关的DOM元素
        const selectors = [
          `.xiser-shape-node-${this.id}`,
          `.xiser-shape-canvas-container-${this.id}`,
          `.xiser-params-container-${this.id}`,
          `[data-node-id="${this.id}"]`
        ];

        selectors.forEach(selector => {
          document.querySelectorAll(selector).forEach(el => {
            el.remove();
          });
        });
        this.widgets = [];
        log.info(`Node ${this.id} removed`);
      };
    }
  },

  /**
   * 设置扩展样式
   */
  setup() {
    console.log("XIS_CreateShapeKonva extension setup called");
    const style = document.createElement("style");
    style.textContent = `
      [class^="xiser-shape-node-"] {
        background: rgba(30, 30, 30, 0.4);
        border-radius: 8px;
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        box-sizing: border-box;
      }
      .konvajs-content {
        border-radius: 4px;
        width: 100%;
        height: 100%;
      }
      [class^="xiser-shape-canvas-container-"] {
        background: rgba(0,0,0,0);
        border-radius: 6px;
        display: flex;
        justify-content: center;
        align-items: center;
        flex: 1;
        max-width: 100%;
        max-height: 100%;
        overflow: visible;
      }
      [class^="xiser-params-container-"] {
        width: 100%;
        padding: 8px;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: 8px;
        background: rgba(0, 0, 0, 0.2);
        border-radius: 4px;
        transition: height 0.3s ease, opacity 0.3s ease;
      }
    `;
    document.head.appendChild(style);
    log.info("XISER.CreateShapeKonva extension styles applied");
  }
});