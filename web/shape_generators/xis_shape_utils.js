/**
 * @file xis_shape_utils.js
 * @description XIS_CreateShape 节点工具函数模块
 * @author grinlau18
 */

// 日志级别控制
const LOG_LEVEL = "error"; // Options: "info", "warning", "error"

/**
 * 日志工具
 * @type {Object}
 */
export const log = {
  info: (...args) => { if (LOG_LEVEL === "info") console.log(...args); },
  warning: (...args) => { if (LOG_LEVEL === "warning" || LOG_LEVEL === "info") console.warn(...args); },
  error: (...args) => { if (LOG_LEVEL === "error" || LOG_LEVEL === "warning" || LOG_LEVEL === "info") console.error(...args); }
};

/**
 * 十六进制颜色转 RGB
 * @param {string} hex - 十六进制颜色
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
 * 规范化颜色字符串格式
 * @param {string} color - 颜色字符串
 * @returns {string} 规范化的颜色字符串（小写，带#前缀）
 */
export function normalizeColor(color) {
  if (!color || typeof color !== 'string') return '#ffffff';

  // 移除空格并转换为小写
  color = color.trim().toLowerCase();

  // 处理十六进制格式（带#或不带#）
  if (color.startsWith('#') || /^[0-9a-f]{3,6}$/.test(color)) {
    // 移除#（如果存在）
    const hex = color.startsWith('#') ? color.slice(1) : color;

    if (hex.length === 3) {
      // 扩展简写格式 abc -> #aabbcc
      return '#' + hex.split('').map(c => c + c).join('');
    } else if (hex.length === 6) {
      return '#' + hex;
    }
  }

  // 处理命名颜色（简单映射）
  const namedColors = {
    'red': '#ff0000',
    'green': '#00ff00',
    'blue': '#0000ff',
    'white': '#ffffff',
    'black': '#000000',
    'yellow': '#ffff00',
    'cyan': '#00ffff',
    'magenta': '#ff00ff'
  };

  if (namedColors[color]) {
    return namedColors[color];
  }

  // 默认返回白色
  return '#ffffff';
}

/**
 * 计算颜色亮度
 * @param {string} color - 颜色字符串
 * @returns {number} 亮度值 (0-255)
 */
export function calculateBrightness(color) {
  let r, g, b;

  if (color.startsWith('rgba')) {
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (match) {
      r = parseInt(match[1]);
      g = parseInt(match[2]);
      b = parseInt(match[3]);
    }
  } else if (color.startsWith('#')) {
    const hex = color.replace('#', '');
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else if (hex.length === 6) {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    }
  }

  // 计算亮度 (0-255)
  return r !== undefined ? (0.299 * r + 0.587 * g + 0.114 * b) : 128;
}

/**
 * 根据背景亮度获取网格颜色
 * @param {string} backgroundColor - 背景颜色
 * @returns {string} 网格颜色
 */
export function getGridColor(backgroundColor) {
  const brightness = calculateBrightness(backgroundColor);
  return brightness > 128 ? 'rgba(0, 0, 0, 0.2)' : 'rgba(255, 255, 255, 0.2)';
}