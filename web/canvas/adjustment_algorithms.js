/**
 * adjustment_algorithms.js
 *
 * 统一的图像调节算法模块，提供前后端一致的调节算法实现。
 * 确保预览和最终渲染结果完全一致。
 */

import { clamp } from './adjustment_utils.js';

/**
 * RGB到HSV颜色转换
 * @param {number} r - 红色值 (0-255)
 * @param {number} g - 绿色值 (0-255)
 * @param {number} b - 蓝色值 (0-255)
 * @returns {Object} HSV颜色对象 {h, s, v}，范围0-1
 */
export function rgbToHsv(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  let s = 0;
  const v = max;

  if (delta !== 0) {
    s = delta / max;

    if (max === r) {
      h = (g - b) / delta;
    } else if (max === g) {
      h = 2 + (b - r) / delta;
    } else {
      h = 4 + (r - g) / delta;
    }

    h *= 60;
    if (h < 0) h += 360;
    h /= 360; // 归一化到0-1
  }

  return { h, s, v };
}

/**
 * HSV到RGB颜色转换
 * @param {number} h - 色相 (0-1)
 * @param {number} s - 饱和度 (0-1)
 * @param {number} v - 明度 (0-1)
 * @returns {Object} RGB颜色对象 {r, g, b}，范围0-255
 */
export function hsvToRgb(h, s, v) {
  h *= 360; // 转换回0-360度

  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  let r = 0, g = 0, b = 0;

  if (h >= 0 && h < 60) {
    r = c; g = x; b = 0;
  } else if (h >= 60 && h < 120) {
    r = x; g = c; b = 0;
  } else if (h >= 120 && h < 180) {
    r = 0; g = c; b = x;
  } else if (h >= 180 && h < 240) {
    r = 0; g = x; b = c;
  } else if (h >= 240 && h < 300) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255)
  };
}

/**
 * 应用亮度调整到ImageData
 * @param {ImageData} imageData - 图像数据
 * @param {number} brightness - 亮度值 (-1.0 到 1.0)
 * @returns {ImageData} 调整后的图像数据
 */
export function applyBrightnessToImageData(imageData, brightness) {
  if (Math.abs(brightness) < 0.001) {
    return imageData;
  }

  const data = imageData.data;

  // 使用更细腻的亮度调整算法
  // 当brightness > 0时，使用S曲线增强中间调
  // 当brightness < 0时，使用更平缓的暗化曲线
  const gamma = 1.0 / (1.0 + brightness * 0.5); // 调整伽马值

  for (let i = 0; i < data.length; i += 4) {
    // 归一化到0-1
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;

    // 应用伽马校正
    const adjustedR = Math.pow(r, gamma);
    const adjustedG = Math.pow(g, gamma);
    const adjustedB = Math.pow(b, gamma);

    // 转换回0-255范围
    data[i] = clamp(adjustedR * 255, 0, 255);     // R
    data[i + 1] = clamp(adjustedG * 255, 0, 255); // G
    data[i + 2] = clamp(adjustedB * 255, 0, 255); // B
  }

  return imageData;
}

/**
 * 应用对比度调整到ImageData
 * @param {ImageData} imageData - 图像数据
 * @param {number} contrast - 对比度值 (-100 到 100)
 * @returns {ImageData} 调整后的图像数据
 */
export function applyContrastToImageData(imageData, contrast) {
  if (Math.abs(contrast) < 0.001) {
    return imageData;
  }

  const data = imageData.data;

  // 使用更细腻的对比度调整算法
  // 将contrast从-100到100映射到更平滑的因子范围
  const normalizedContrast = contrast / 100; // -1 到 1

  // 使用Sigmoid-like函数，让中间值变化更平缓
  let factor;
  if (normalizedContrast >= 0) {
    // 增强对比度：使用更平缓的曲线
    factor = 1.0 + normalizedContrast * 0.5; // 最大1.5倍
  } else {
    // 降低对比度：使用更敏感的曲线
    factor = 1.0 / (1.0 - normalizedContrast * 0.8); // 最小约0.56倍
  }

  for (let i = 0; i < data.length; i += 4) {
    // 归一化到0-1范围
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;

    // 应用对比度（使用更平滑的曲线）
    const adjustedR = ((r - 0.5) * factor + 0.5) * 255;
    const adjustedG = ((g - 0.5) * factor + 0.5) * 255;
    const adjustedB = ((b - 0.5) * factor + 0.5) * 255;

    data[i] = clamp(adjustedR, 0, 255);     // R
    data[i + 1] = clamp(adjustedG, 0, 255); // G
    data[i + 2] = clamp(adjustedB, 0, 255); // B
  }

  return imageData;
}

/**
 * 应用饱和度调整到ImageData
 * @param {ImageData} imageData - 图像数据
 * @param {number} saturation - 饱和度值 (-100 到 100)
 * @returns {ImageData} 调整后的图像数据
 */
export function applySaturationToImageData(imageData, saturation) {
  if (Math.abs(saturation) < 0.001) {
    return imageData;
  }

  const data = imageData.data;
  const normalizedSaturation = saturation / 100; // -1 到 1

  // 使用更细腻的饱和度调整算法
  // 对于低饱和度区域变化更平缓，高饱和度区域变化更明显
  for (let i = 0; i < data.length; i += 4) {
    const hsv = rgbToHsv(data[i], data[i + 1], data[i + 2]);

    // 根据原始饱和度值调整变化幅度
    let factor;
    if (normalizedSaturation >= 0) {
      // 增加饱和度：使用S曲线，让变化更自然
      const baseFactor = 1.0 + normalizedSaturation * 0.8; // 最大1.8倍
      // 根据原始饱和度调整：低饱和度区域变化更明显，高饱和度区域变化更平缓
      const adaptiveFactor = 1.0 + (baseFactor - 1.0) * (1.0 - hsv.s * 0.5);
      factor = adaptiveFactor;
    } else {
      // 降低饱和度：使用更平缓的曲线
      const reduction = -normalizedSaturation; // 0 到 1
      // 使用平方根函数让变化更平缓
      factor = 1.0 - Math.sqrt(reduction) * 0.8; // 最小约0.2倍
    }

    hsv.s = clamp(hsv.s * factor, 0, 1);
    const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);

    data[i] = rgb.r;     // R
    data[i + 1] = rgb.g; // G
    data[i + 2] = rgb.b; // B
  }

  return imageData;
}

/**
 * 创建Konva亮度滤镜（与后端算法一致）
 * @returns {Function} Konva滤镜函数
 */
export function createXiserBrightnessFilter() {
  return function xiserBrightnessFilter(imageData) {
    const rawValue = typeof this?.xiserBrightness === 'number'
      ? this.xiserBrightness
      : parseFloat(this?.xiserBrightness) || 0;

    const brightness = clamp(rawValue, -1, 1, 0);
    if (Math.abs(brightness) < 0.001) return;

    return applyBrightnessToImageData(imageData, brightness);
  };
}

/**
 * 创建Konva对比度滤镜（与后端算法一致）
 * @returns {Function} Konva滤镜函数
 */
export function createXiserContrastFilter() {
  return function xiserContrastFilter(imageData) {
    const rawValue = typeof this?.xiserContrast === 'number'
      ? this.xiserContrast
      : parseFloat(this?.xiserContrast) || 0;

    const contrast = clamp(rawValue, -100, 100, 0);
    if (Math.abs(contrast) < 0.001) return;

    return applyContrastToImageData(imageData, contrast);
  };
}

/**
 * 创建Konva饱和度滤镜（与后端算法一致）
 * @returns {Function} Konva滤镜函数
 */
export function createXiserSaturationFilter() {
  return function xiserSaturationFilter(imageData) {
    const rawValue = typeof this?.xiserSaturation === 'number'
      ? this.xiserSaturation
      : parseFloat(this?.xiserSaturation) || 0;

    const saturation = clamp(rawValue, -100, 100, 0);
    if (Math.abs(saturation) < 0.001) return;

    return applySaturationToImageData(imageData, saturation);
  };
}

/**
 * 创建统一的调节滤镜应用器
 * @param {Object} adjustmentState - 调节状态
 * @returns {Object} 滤镜配置对象
 */
export function createAdjustmentFilters(adjustmentState) {
  const filters = [];
  const layerConfig = {};

  const brightness = adjustmentState.brightness || 0;
  const contrast = adjustmentState.contrast || 0;
  const saturation = adjustmentState.saturation || 0;

  // 亮度滤镜 - 使用自定义滤镜确保与后端算法一致
  if (Math.abs(brightness) > 0.001) {
    if (window.Konva.Filters.XiserBrightness) {
      filters.push(window.Konva.Filters.XiserBrightness);
      layerConfig.xiserBrightness = clamp(brightness, -1, 1, 0);
    } else {
      // 回退到Konva内置滤镜（旧算法）
      filters.push(window.Konva.Filters.Brighten);
      layerConfig.brightness = brightness;
    }
  }

  // 对比度滤镜 - 使用自定义滤镜确保与后端算法一致
  if (Math.abs(contrast) > 0.001) {
    if (window.Konva.Filters.XiserContrast) {
      filters.push(window.Konva.Filters.XiserContrast);
      layerConfig.xiserContrast = clamp(contrast, -100, 100, 0);
    } else {
      // 回退到Konva内置滤镜（旧算法）
      filters.push(window.Konva.Filters.Contrast);
      layerConfig.contrast = contrast;
    }
  }

  // 饱和度滤镜 - 使用自定义滤镜确保与后端算法一致
  if (Math.abs(saturation) > 0.001) {
    if (window.Konva.Filters.XiserSaturation) {
      filters.push(window.Konva.Filters.XiserSaturation);
      layerConfig.xiserSaturation = clamp(saturation, -100, 100, 0);
    }
  }

  return {
    filters,
    layerConfig
  };
}

/**
 * 应用调节效果到Konva图层
 * @param {Konva.Layer} layer - Konva图层
 * @param {Object} adjustmentState - 调节状态
 */
export function applyAdjustmentsToKonvaLayer(layer, adjustmentState) {
  if (!layer || !window.Konva) {
    return;
  }

  const brightness = adjustmentState.brightness || 0;
  const contrast = adjustmentState.contrast || 0;
  const saturation = adjustmentState.saturation || 0;
  const opacity = adjustmentState.opacity !== undefined ? adjustmentState.opacity : 100;

  // 应用亮度（使用正确的属性名）
  if (window.Konva.Filters.XiserBrightness) {
    layer.xiserBrightness = clamp(brightness, -1, 1, 0);
  } else {
    layer.brightness(brightness);
  }

  // 应用对比度（使用正确的属性名）
  if (window.Konva.Filters.XiserContrast) {
    layer.xiserContrast = clamp(contrast, -100, 100, 0);
  } else {
    layer.contrast(contrast);
  }

  // 应用饱和度
  if (window.Konva.Filters.XiserSaturation) {
    layer.xiserSaturation = clamp(saturation, -100, 100, 0);
  }

  // 应用透明度
  layer.opacity(opacity / 100);

  // 设置滤镜
  const filterConfig = createAdjustmentFilters(adjustmentState);
  if (filterConfig.filters.length > 0) {
    layer.filters(filterConfig.filters);
    layer.cache();
  } else {
    layer.filters([]);
    layer.clearCache();
  }
}

/**
 * 检查是否需要应用调节效果
 * @param {Object} adjustmentState - 调节状态
 * @returns {boolean} 是否需要应用调节效果
 */
export function needsAdjustment(adjustmentState) {
  if (!adjustmentState) {
    return false;
  }

  const brightness = Math.abs(adjustmentState.brightness || 0);
  const contrast = Math.abs(adjustmentState.contrast || 0);
  const saturation = Math.abs(adjustmentState.saturation || 0);
  const opacity = adjustmentState.opacity !== undefined ? adjustmentState.opacity : 100;

  return (
    brightness > 0.001 ||
    contrast > 0.001 ||
    saturation > 0.001 ||
    Math.abs(opacity - 100) > 0.001
  );
}

// 导出所有算法函数
export default {
  rgbToHsv,
  hsvToRgb,
  applyBrightnessToImageData,
  applyContrastToImageData,
  applySaturationToImageData,
  createXiserSaturationFilter,
  createAdjustmentFilters,
  applyAdjustmentsToKonvaLayer,
  needsAdjustment
};