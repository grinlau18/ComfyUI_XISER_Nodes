import { saveShapeState as persistShapeState } from "./state_manager.js";

/**
 * Konva Wheel Interaction Module
 * Provides mouse wheel interactions for scaling and rotating shapes
 *
 * @module KonvaWheelInteraction
 * @description Adds mouse wheel support for scaling (wheel) and rotation (Alt + wheel)
 * @author grinlau18
 */

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
 * Konva 鼠标滚轮交互类
 * 提供缩放和旋转功能
 */
class KonvaWheelInteraction {
  /**
   * 构造函数
   * @param {Object} node - ComfyUI 节点实例
   * @param {Object} options - 配置选项
   */
  constructor(node, options = {}) {
    this.node = node;
    this.options = {
      scaleFactor: 0.1,      // 缩放因子
      rotationFactor: 2,     // 旋转因子（度）
      minScale: 0.1,         // 最小缩放比例
      maxScale: 10,          // 最大缩放比例
      ...options
    };

    this.isEnabled = true;
    this.isInitialized = false;

    log.info(`KonvaWheelInteraction created for node ${node.id}`);
  }

  /**
   * 初始化滚轮交互
   */
  init() {
    if (this.isInitialized || !this.node.konvaState?.stage) {
      log.warning(`Wheel interaction already initialized or stage not available for node ${this.node.id}`);
      return;
    }

    const stage = this.node.konvaState.stage;

    // 添加滚轮事件监听器
    stage.on('wheel', (e) => {
      this.handleWheel(e);
    });

    this.isInitialized = true;
    log.info(`Wheel interaction initialized for node ${this.node.id}`);
  }

  /**
   * 处理滚轮事件
   * @param {Object} e - 滚轮事件对象
   */
  handleWheel(e) {
    if (!this.isEnabled || !this.node.konvaState?.transformer) {
      return;
    }

    const transformer = this.node.konvaState.transformer;
    const selectedNodes = transformer.nodes();

    if (selectedNodes.length === 0) {
      return; // 没有选中的形状
    }

    const shape = selectedNodes[0];
    e.evt.preventDefault();

    // 获取鼠标位置（转换为形状的本地坐标系）
    const mousePos = this.node.konvaState.stage.getPointerPosition();
    const shapePos = shape.getAbsolutePosition();
    const localPoint = {
      x: mousePos.x - shapePos.x,
      y: mousePos.y - shapePos.y
    };

    if (e.evt.altKey) {
      // Alt + 滚轮：旋转（以形状为中心）
      this.handleRotation(shape, e.evt.deltaY);
    } else {
      // 普通滚轮：缩放
      this.handleScaling(shape, e.evt.deltaY, localPoint);
    }

    // 保存状态并重绘
    this.saveShapeState();
    this.node.konvaState.layer.batchDraw();
    this.node.setDirtyCanvas(true, true);
  }

  /**
   * 处理缩放
   * @param {Object} shape - Konva 形状
   * @param {number} deltaY - 滚轮垂直增量
   * @param {Object} localPoint - 鼠标在形状本地坐标系中的位置
   */
  handleScaling(shape, deltaY, localPoint) {
    const direction = deltaY > 0 ? -1 : 1;
    const scaleChange = direction * this.options.scaleFactor;

    // 计算新的缩放比例
    const newScaleX = shape.scaleX() * (1 + scaleChange);
    const newScaleY = shape.scaleY() * (1 + scaleChange);

    // 应用缩放限制
    const clampedScaleX = Math.max(this.options.minScale, Math.min(this.options.maxScale, newScaleX));
    const clampedScaleY = Math.max(this.options.minScale, Math.min(this.options.maxScale, newScaleY));

    // 计算缩放中心点偏移（保持鼠标位置不变）
    const scaleRatioX = clampedScaleX / shape.scaleX();
    const scaleRatioY = clampedScaleY / shape.scaleY();

    const offsetX = (localPoint.x * (scaleRatioX - 1)) * shape.scaleX();
    const offsetY = (localPoint.y * (scaleRatioY - 1)) * shape.scaleY();

    // 应用缩放和位置调整
    shape.scaleX(clampedScaleX);
    shape.scaleY(clampedScaleY);
    shape.x(shape.x() - offsetX);
    shape.y(shape.y() - offsetY);

    log.info(`Node ${this.node.id} scaled to: (${clampedScaleX.toFixed(2)}, ${clampedScaleY.toFixed(2)})`);
  }

  /**
   * 处理旋转（以形状为中心）
   * @param {Object} shape - Konva 形状
   * @param {number} deltaY - 滚轮垂直增量
   */
  handleRotation(shape, deltaY) {
    const direction = deltaY > 0 ? -1 : 1;
    const rotationChange = direction * this.options.rotationFactor;

    // 计算新的旋转角度
    let newRotation = shape.rotation() + rotationChange;

    // 规范化旋转角度到 0-360 度
    newRotation = ((newRotation % 360) + 360) % 360;

    // 直接应用旋转（以形状中心为旋转中心）
    shape.rotation(newRotation);

    log.info(`Node ${this.node.id} rotated to: ${newRotation.toFixed(1)}°`);
  }

  /**
   * 保存形状状态
   */
  saveShapeState() {
    if (typeof this.node.konvaState?.saveShapeState === 'function') {
      this.node.konvaState.saveShapeState(this.node);
    } else {
      persistShapeState(this.node);
    }
  }

  /**
   * 启用滚轮交互
   */
  enable() {
    this.isEnabled = true;
    log.info(`Wheel interaction enabled for node ${this.node.id}`);
  }

  /**
   * 禁用滚轮交互
   */
  disable() {
    this.isEnabled = false;
    log.info(`Wheel interaction disabled for node ${this.node.id}`);
  }

  /**
   * 销毁滚轮交互
   */
  destroy() {
    if (this.node.konvaState?.stage && this.isInitialized) {
      this.node.konvaState.stage.off('wheel');
      this.isInitialized = false;
      log.info(`Wheel interaction destroyed for node ${this.node.id}`);
    }
  }
}

// 为 Math 对象添加弧度转换辅助方法
if (!Math.radians) {
  Math.radians = function(degrees) {
    return degrees * Math.PI / 180;
  };
}

if (!Math.degrees) {
  Math.degrees = function(radians) {
    return radians * 180 / Math.PI;
  };
}

// 导出模块
export default KonvaWheelInteraction;
