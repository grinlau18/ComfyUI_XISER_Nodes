/**
 * adjustment_utils.js
 *
 * 统一的图像调节工具模块，提供参数范围定义、验证和转换函数。
 * 确保前后端使用一致的参数范围和算法。
 */

// 统一的参数范围定义（与后端保持一致）
export const ADJUSTMENT_RANGES = {
  brightness: { min: -1.0, max: 1.0, default: 0.0, step: 0.01 },
  contrast: { min: -100.0, max: 100.0, default: 0.0, step: 0.1 },
  saturation: { min: -100.0, max: 100.0, default: 0.0, step: 0.1 },
  opacity: { min: 0.0, max: 100.0, default: 100.0, step: 0.1 }
};

// 亮度滑块转换因子（前端滑块范围：-100 到 100，对应亮度值：-1.0 到 1.0）
export const BRIGHTNESS_SLIDER_FACTOR = 100;

/**
 * 限制值在指定范围内
 * @param {number} value - 输入值
 * @param {number} min - 最小值
 * @param {number} max - 最大值
 * @param {number} fallback - 无效值时的默认值
 * @returns {number} 限制后的值
 */
export function clamp(value, min, max, fallback = 0) {
  const number = Number(value);
  if (Number.isNaN(number) || !Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(Math.max(number, min), max);
}

/**
 * 规范化调节状态，确保所有调节参数在有效范围内
 * @param {Object} state - 原始调节状态
 * @returns {Object} 规范化后的调节状态
 */
export function normalizeAdjustmentState(state = {}) {
  return {
    brightness: clamp(
      state.brightness ?? ADJUSTMENT_RANGES.brightness.default,
      ADJUSTMENT_RANGES.brightness.min,
      ADJUSTMENT_RANGES.brightness.max,
      ADJUSTMENT_RANGES.brightness.default
    ),
    contrast: clamp(
      state.contrast ?? ADJUSTMENT_RANGES.contrast.default,
      ADJUSTMENT_RANGES.contrast.min,
      ADJUSTMENT_RANGES.contrast.max,
      ADJUSTMENT_RANGES.contrast.default
    ),
    saturation: clamp(
      state.saturation ?? ADJUSTMENT_RANGES.saturation.default,
      ADJUSTMENT_RANGES.saturation.min,
      ADJUSTMENT_RANGES.saturation.max,
      ADJUSTMENT_RANGES.saturation.default
    ),
    opacity: clamp(
      state.opacity ?? ADJUSTMENT_RANGES.opacity.default,
      ADJUSTMENT_RANGES.opacity.min,
      ADJUSTMENT_RANGES.opacity.max,
      ADJUSTMENT_RANGES.opacity.default
    )
  };
}

/**
 * 将亮度值转换为滑块值
 * @param {number} brightness - 亮度值（-1.0 到 1.0）
 * @returns {number} 滑块值（-100 到 100）
 */
export function brightnessToSlider(brightness) {
  const clamped = clamp(brightness, -1, 1, 0);
  return Math.round(clamped * BRIGHTNESS_SLIDER_FACTOR);
}

/**
 * 将滑块值转换为亮度值
 * @param {number} sliderValue - 滑块值（-100 到 100）
 * @returns {number} 亮度值（-1.0 到 1.0）
 */
export function sliderToBrightness(sliderValue) {
  const clamped = clamp(parseInt(sliderValue, 10), -100, 100, 0);
  return clamped / BRIGHTNESS_SLIDER_FACTOR;
}

/**
 * 将对比度值转换为滑块值
 * @param {number} contrast - 对比度值（-100 到 100）
 * @returns {number} 滑块值（-100 到 100）
 */
export function contrastToSlider(contrast) {
  return Math.round(clamp(contrast, -100, 100, 0));
}

/**
 * 将滑块值转换为对比度值
 * @param {number} sliderValue - 滑块值（-100 到 100）
 * @returns {number} 对比度值（-100 到 100）
 */
export function sliderToContrast(sliderValue) {
  return clamp(parseInt(sliderValue, 10), -100, 100, 0);
}

/**
 * 将饱和度值转换为滑块值
 * @param {number} saturation - 饱和度值（-100 到 100）
 * @returns {number} 滑块值（-100 到 100）
 */
export function saturationToSlider(saturation) {
  return Math.round(clamp(saturation, -100, 100, 0));
}

/**
 * 将滑块值转换为饱和度值
 * @param {number} sliderValue - 滑块值（-100 到 100）
 * @returns {number} 饱和度值（-100 到 100）
 */
export function sliderToSaturation(sliderValue) {
  return clamp(parseInt(sliderValue, 10), -100, 100, 0);
}

/**
 * 将透明度值转换为滑块值
 * @param {number} opacity - 透明度值（0 到 100）
 * @returns {number} 滑块值（0 到 100）
 */
export function opacityToSlider(opacity) {
  return Math.round(clamp(opacity, 0, 100, 100));
}

/**
 * 将滑块值转换为透明度值
 * @param {number} sliderValue - 滑块值（0 到 100）
 * @returns {number} 透明度值（0 到 100）
 */
export function sliderToOpacity(sliderValue) {
  return clamp(parseInt(sliderValue, 10), 0, 100, 100);
}

/**
 * 将透明度百分比转换为alpha值（0-1范围）
 * @param {number} opacity - 透明度百分比（0-100）
 * @returns {number} alpha值（0.0-1.0）
 */
export function opacityToAlpha(opacity) {
  const clamped = clamp(opacity, 0, 100, 100);
  return clamped / 100.0;
}

/**
 * 将alpha值转换为透明度百分比
 * @param {number} alpha - alpha值（0.0-1.0）
 * @returns {number} 透明度百分比（0-100）
 */
export function alphaToOpacity(alpha) {
  const clamped = clamp(alpha, 0.0, 1.0, 1.0);
  return clamped * 100.0;
}

/**
 * 获取默认的调节状态
 * @returns {Object} 默认调节状态
 */
export function getDefaultAdjustmentState() {
  return {
    brightness: ADJUSTMENT_RANGES.brightness.default,
    contrast: ADJUSTMENT_RANGES.contrast.default,
    saturation: ADJUSTMENT_RANGES.saturation.default,
    opacity: ADJUSTMENT_RANGES.opacity.default
  };
}

/**
 * 合并两个调节状态
 * @param {Object} baseState - 基础状态
 * @param {Object} overrideState - 覆盖状态
 * @returns {Object} 合并后的状态
 */
export function mergeAdjustmentStates(baseState = {}, overrideState = {}) {
  const normalizedBase = normalizeAdjustmentState(baseState);
  const normalizedOverride = normalizeAdjustmentState(overrideState);

  return {
    ...normalizedBase,
    ...normalizedOverride
  };
}

/**
 * 检查是否有激活的调节效果
 * @param {Object} state - 调节状态
 * @returns {boolean} 是否有激活的调节效果
 */
export function isAdjustmentActive(state = {}) {
  const normalized = normalizeAdjustmentState(state);
  const defaults = getDefaultAdjustmentState();

  return (
    Math.abs(normalized.brightness - defaults.brightness) > 0.001 ||
    Math.abs(normalized.contrast - defaults.contrast) > 0.001 ||
    Math.abs(normalized.saturation - defaults.saturation) > 0.001 ||
    Math.abs(normalized.opacity - defaults.opacity) > 0.001
  );
}

/**
 * 创建调节控件的配置
 * @returns {Object} 控件配置对象
 */
export function createAdjustmentControlsConfig() {
  return {
    brightness: {
      label: '亮度',
      min: -100,
      max: 100,
      defaultValue: 0,
      toSlider: brightnessToSlider,
      fromSlider: sliderToBrightness
    },
    contrast: {
      label: '对比度',
      min: -100,
      max: 100,
      defaultValue: 0,
      toSlider: contrastToSlider,
      fromSlider: sliderToContrast
    },
    saturation: {
      label: '饱和度',
      min: -100,
      max: 100,
      defaultValue: 0,
      toSlider: saturationToSlider,
      fromSlider: sliderToSaturation
    },
    opacity: {
      label: '透明度',
      min: 0,
      max: 100,
      defaultValue: 100,
      toSlider: opacityToSlider,
      fromSlider: sliderToOpacity
    }
  };
}

// 导出所有工具函数
export default {
  ADJUSTMENT_RANGES,
  BRIGHTNESS_SLIDER_FACTOR,
  clamp,
  normalizeAdjustmentState,
  brightnessToSlider,
  sliderToBrightness,
  contrastToSlider,
  sliderToContrast,
  saturationToSlider,
  sliderToSaturation,
  opacityToSlider,
  sliderToOpacity,
  opacityToAlpha,
  alphaToOpacity,
  getDefaultAdjustmentState,
  mergeAdjustmentStates,
  isAdjustmentActive,
  createAdjustmentControlsConfig
};