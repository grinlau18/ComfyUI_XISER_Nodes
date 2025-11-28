/**
 * @file XIS_CoordinatePath.js
 * @description ComfyUI 节点注册和前端逻辑，用于坐标路径节点。
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
 * Catmull-Rom 样条曲线计算
 * @param {Array} points - 控制点数组
 * @param {number} segmentIndex - 曲线段索引
 * @param {number} t - 参数 [0, 1]
 * @returns {Object} 曲线点坐标 {x, y}
 */
function catmullRom(points, segmentIndex, t) {
  const p0 = points[segmentIndex];
  const p1 = points[segmentIndex + 1];
  const p2 = points[segmentIndex + 2];
  const p3 = points[segmentIndex + 3];

  const t2 = t * t;
  const t3 = t2 * t;

  const x = 0.5 * ((2 * p1.x) +
                (-p0.x + p2.x) * t +
                (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
                (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);

  const y = 0.5 * ((2 * p1.y) +
                (-p0.y + p2.y) * t +
                (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
                (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);

  return { x, y };
}

function generateCurveSamples(controlPoints, width, height) {
  if (controlPoints.length < 2) return [];
  const points = controlPoints.map(p => ({ x: p.x * width, y: p.y * height }));
  let curvePoints = [...points];
  if (curvePoints.length === 2) {
    curvePoints = [curvePoints[0], curvePoints[0], curvePoints[1], curvePoints[1]];
  } else if (curvePoints.length === 3) {
    curvePoints = [curvePoints[0], curvePoints[0], curvePoints[1], curvePoints[2], curvePoints[2]];
  } else {
    curvePoints = [curvePoints[0], ...curvePoints, curvePoints[curvePoints.length - 1]];
  }

  const samples = [];
  const numSegments = curvePoints.length - 3;
  const samplesPerSegment = 40;
  for (let seg = 0; seg < numSegments; seg++) {
    for (let j = 0; j <= samplesPerSegment; j++) {
      const t = j / samplesPerSegment;
      samples.push(catmullRom(curvePoints, seg, t));
    }
  }
  return samples;
}

function optimizeControlPoints(node) {
  const controlPoints = node.properties?.control_points || [];
  if (controlPoints.length < 2) return controlPoints;

  const width = node.properties?.width || node.canvas?.width || 512;
  const height = node.properties?.height || node.canvas?.height || 512;
  const pathMode = node.properties?.path_mode || "linear";

  const sampled = samplePath(controlPoints, width, height, pathMode);
  if (sampled.length < 2) return controlPoints;

  const distances = [0];
  for (let i = 1; i < sampled.length; i++) {
    const dx = sampled[i].x - sampled[i - 1].x;
    const dy = sampled[i].y - sampled[i - 1].y;
    distances.push(distances[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  const total = distances[distances.length - 1];
  if (total <= 0) return controlPoints;

  const targetCount = Math.max(2, controlPoints.length);
  const step = total / (targetCount - 1);
  const resampled = [];
  for (let i = 0; i < targetCount; i++) {
    const target = i * step;
    const idx = distances.findIndex(d => d >= target);
    if (idx <= 0) {
      resampled.push(sampled[0]);
      continue;
    }
    const d0 = distances[idx - 1];
    const d1 = distances[idx];
    const t = (target - d0) / (d1 - d0 || 1);
    const p0 = sampled[idx - 1];
    const p1 = sampled[idx];
    resampled.push({
      x: p0.x + (p1.x - p0.x) * t,
      y: p0.y + (p1.y - p0.y) * t
    });
  }

  resampled[0] = { x: controlPoints[0].x * width, y: controlPoints[0].y * height };
  resampled[resampled.length - 1] = {
    x: controlPoints[controlPoints.length - 1].x * width,
    y: controlPoints[controlPoints.length - 1].y * height
  };

  return resampled.map(p => ({
    x: Math.max(0, Math.min(1, p.x / width)),
    y: Math.max(0, Math.min(1, p.y / height))
  }));
}

function applyOptimization(node) {
  if (!node) return;
  node.properties.control_points = optimizeControlPoints(node);
  updateDisplay(node);
  if (node.setDirtyCanvas) {
    node.setDirtyCanvas(true, true);
  }
  if (node.onWidgetChange) {
    node.onWidgetChange();
  }
  log.info(`Node ${node.id} optimized control points`);
}

function samplePath(controlPoints, width, height, pathMode) {
  if (controlPoints.length < 2) return [];
  if (pathMode === "curve") {
    return generateCurveSamples(controlPoints, width, height);
  }
  const samples = [];
  const samplesPerSegment = 20;
  for (let i = 0; i < controlPoints.length - 1; i++) {
    const p1 = controlPoints[i];
    const p2 = controlPoints[i + 1];
    for (let j = 0; j <= samplesPerSegment; j++) {
      const t = j / samplesPerSegment;
      samples.push({
        x: (p1.x + (p2.x - p1.x) * t) * width,
        y: (p1.y + (p2.y - p1.y) * t) * height
      });
    }
  }
  return samples;
}

/**
 * 生成曲线路径点用于检测点击
 * @param {Array} controlPoints - 控制点数组
 * @param {number} canvasWidth - 画布宽度
 * @param {number} canvasHeight - 画布高度
 * @returns {Array} 曲线上的点坐标数组
 */
function generateCurvePoints(controlPoints, canvasWidth, canvasHeight) {
  if (controlPoints.length < 2) return [];

  const points = controlPoints.map(p => ({
    x: p.x * canvasWidth,
    y: p.y * canvasHeight
  }));

  // 为 Catmull-Rom 添加虚拟端点
  let curvePoints = [...points];
  if (curvePoints.length === 2) {
    curvePoints = [curvePoints[0], curvePoints[0], curvePoints[1], curvePoints[1]];
  } else if (curvePoints.length === 3) {
    curvePoints = [curvePoints[0], curvePoints[0], curvePoints[1], curvePoints[2], curvePoints[2]];
  } else {
    // 对于4个及以上控制点，添加虚拟端点
    curvePoints = [curvePoints[0], ...curvePoints, curvePoints[curvePoints.length - 1]];
  }

  const result = [];
  const numSegments = curvePoints.length - 3;

  if (numSegments > 0) {
    for (let seg = 0; seg < numSegments; seg++) {
      // 使用与绘制相同的采样密度
      const samplesPerSegment = 40;
      for (let j = 0; j <= samplesPerSegment; j++) {
        const t = j / samplesPerSegment;
        const point = catmullRom(curvePoints, seg, t);
        result.push(point);
      }
    }
  }

  return result;
}

/**
 * 设置画布和控件
 * @param {Object} node - 节点实例
 */
export function setupCanvas(node) {
  if (!node || node.id === -1) return;

  // 初始化默认属性
  node.properties = node.properties || {
    control_points: [
      { x: 125.0 / 512, y: 125.0 / 512 },
      { x: 387.0 / 512, y: 387.0 / 512 }
    ],
    node_size: [360, 510],
    width: 512,
    height: 512
  };

  // 创建主容器
  const mainContainer = document.createElement("div");
  mainContainer.className = `xiser-coordinate-container xiser-coordinate-node-${node.id}`;
  mainContainer.dataset.nodeId = node.id.toString();
  mainContainer.style.cssText = `
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.4);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    position: relative;
    padding: 8px;
  `;

  // 创建画布容器
  const canvasContainer = document.createElement("div");
  canvasContainer.className = `xiser-coordinate-canvas-container-${node.id}`;
  canvasContainer.style.cssText = `
    flex-grow: 1;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    position: relative;
    background: rgba(90, 90, 90, 0);
    border-radius: 4px;
  `;

  // 创建画布
  node.canvas = document.createElement("canvas");
  node.canvas.className = `xiser-coordinate-canvas-${node.id}`;
  node.canvas.style.cssText = `
    display: block;
    cursor: crosshair;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  `;
  canvasContainer.appendChild(node.canvas);

  // 自动优化按钮（右上角）
  const optimizeBtn = document.createElement("button");
  optimizeBtn.innerHTML = `
    <span style="display:flex;align-items:center;gap:6px;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M17.2903 4.14004L17.2203 7.93004C17.2103 8.45004 17.5403 9.14004 17.9603 9.45004L20.4403 11.33C22.0303 12.53 21.7703 14 19.8703 14.6L16.6403 15.61C16.1003 15.78 15.5303 16.37 15.3903 16.92L14.6203 19.86C14.0103 22.18 12.4903 22.41 11.2303 20.37L9.47027 17.52C9.15027 17 8.39027 16.61 7.79027 16.64L4.45027 16.81C2.06027 16.93 1.38027 15.55 2.94027 13.73L4.92027 11.43C5.29027 11 5.46027 10.2 5.29027 9.66004L4.27027 6.42004C3.68027 4.52004 4.74027 3.47004 6.63027 4.09004L9.58027 5.06004C10.0803 5.22004 10.8303 5.11004 11.2503 4.80004L14.3303 2.58004C16.0003 1.39004 17.3303 2.09004 17.2903 4.14004Z" fill="#fff"></path>
        <path d="M21.4403 20.4702L18.4103 17.4402C18.1203 17.1502 17.6403 17.1502 17.3503 17.4402C17.0603 17.7302 17.0603 18.2102 17.3503 18.5002L20.3803 21.5302C20.5303 21.6802 20.7203 21.7502 20.9103 21.7502C21.1003 21.7502 21.2903 21.6802 21.4403 21.5302C21.7303 21.2402 21.7303 20.7602 21.4403 20.4702Z" fill="#fff"></path>
      </svg>
      <span style="font-size:11px;color:#fff;">Optimize</span>
    </span>
  `;
  optimizeBtn.style.cssText = `
    position: absolute;
    top: 8px;
    right: 8px;
    padding: 6px 8px;
    background: rgba(0,0,0,0.15);
    color: #fff;
    border: 1px solid #888;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 6px;
  `;
  optimizeBtn.addEventListener("click", () => {
    applyOptimization(node);
  });
  canvasContainer.appendChild(optimizeBtn);
  mainContainer.appendChild(canvasContainer);
  node.ctx = node.canvas.getContext("2d");

  // 创建控制点信息显示
  const infoDiv = document.createElement("div");
  infoDiv.className = `xiser-coordinate-info xiser-coordinate-info-${node.id}`;
  infoDiv.style.cssText = `
    color: #ccc;
    font-size: 12px;
    text-align: center;
    padding: 4px;
    background: rgba(90, 90, 90, 0);
    border-radius: 4px;
    margin-top: 8px;
  `;
  infoDiv.textContent = "LMB: add point | RMB: menu";
  mainContainer.appendChild(infoDiv);

  // 注册画布控件
  node.addDOMWidget("path_canvas", "Path Canvas", mainContainer, {
    serialize: true,
    hideOnZoom: false,
    getValue: () => {
      try {
        const widgets = node.widgets || [];
        const widthWidget = widgets.find(w => w.name === "width");
        const heightWidget = widgets.find(w => w.name === "height");
        const pathModeWidget = widgets.find(w => w.name === "path_mode");
        const distributionModeWidget = widgets.find(w => w.name === "distribution_mode");

        // Ensure control_points is always an array
        const controlPoints = Array.isArray(node.properties.control_points)
          ? node.properties.control_points.slice(0, 50)
          : [];

        const data = {
          control_points: controlPoints.map(point => ({
            x: Math.max(0, Math.min(1, typeof point.x === "number" ? point.x : 0.5)),
            y: Math.max(0, Math.min(1, typeof point.y === "number" ? point.y : 0.5))
          })),
          width: widthWidget ? Number(widthWidget.value) || 512 : (node.properties.width || 512),
          height: heightWidget ? Number(heightWidget.value) || 512 : (node.properties.height || 512),
          path_mode: pathModeWidget ? pathModeWidget.value : (node.properties.path_mode || "linear"),
          distribution_mode: distributionModeWidget ? distributionModeWidget.value : (node.properties.distribution_mode || "uniform"),
          node_size: node.properties.node_size || [360, 510]
        };
        
        // Ensure we always have at least 2 control points
        if (data.control_points.length < 2) {
          data.control_points = [
            { x: 125.0 / 512, y: 125.0 / 512 },
            { x: 387.0 / 512, y: 387.0 / 512 }
          ];
        }
        
        log.info(`Node ${node.id} serialized path_canvas:`, data);
        return data;
      } catch (e) {
        log.error(`Node ${node.id} error in getValue: ${e}`);
        return {
          control_points: [
            { x: 125.0 / 512, y: 125.0 / 512 },
            { x: 387.0 / 512, y: 387.0 / 512 }
          ],
          width: 512,
          height: 512,
          path_mode: "linear",
          node_size: [360, 510]
        };
      }
    },
    setValue: (value) => {
      try {
        if (value.control_points && Array.isArray(value.control_points)) {
          node.properties.control_points = value.control_points.slice(0, 50).map(point => ({
            x: Math.max(0, Math.min(1, typeof point.x === "number" ? point.x : 0.5)),
            y: Math.max(0, Math.min(1, typeof point.y === "number" ? point.y : 0.5))
          }));
        } else if (!node.properties.control_points || node.properties.control_points.length === 0) {
          // Only set default if no existing control points
          node.properties.control_points = [
            { x: 125.0 / 512, y: 125.0 / 512 },
            { x: 387.0 / 512, y: 387.0 / 512 }
          ];
        } else {
          // Preserve existing control points if value doesn't contain control_points
          log.info(`Node ${node.id} preserving existing control points: ${node.properties.control_points.length} points`);
        }
        
        node.properties.width = Math.max(1, Math.min(4096, Math.floor(value.width || 512)));
        node.properties.height = Math.max(1, Math.min(4096, Math.floor(value.height || 512)));
        node.properties.path_mode = value.path_mode && ["linear", "curve"].includes(value.path_mode)
          ? value.path_mode
          : "linear";
        node.properties.distribution_mode = value.distribution_mode && ["uniform", "ease_in", "ease_out", "ease_in_out", "ease_out_in"].includes(value.distribution_mode)
          ? value.distribution_mode
          : "uniform";
        node.properties.node_size = value.node_size && Array.isArray(value.node_size)
          ? [Math.max(value.node_size[0], 360), Math.max(value.node_size[1], 510)]
          : [360, 510];
        
        node.setSize([node.properties.node_size[0], node.properties.node_size[1]]);
        updateCanvasSize(node);
        updateDisplay(node);
        node.setDirtyCanvas(true, true);
        log.info(`Node ${node.id} restored canvas state`);
      } catch (e) {
        log.error(`Node ${node.id} error in setValue: ${e}`);
      }
    },
  });

  // 添加鼠标事件监听
  node.canvas.addEventListener("mousedown", (e) => onCanvasMouseDown(node, e));
  node.canvas.addEventListener("mousemove", (e) => onCanvasMouseMove(node, e));
  node.canvas.addEventListener("mouseup", () => onCanvasMouseUp(node));
  node.canvas.addEventListener("contextmenu", (e) => onCanvasRightClick(node, e));

  // 立即更新画布显示
  updateCanvasSize(node);
  updateDisplay(node);
  
  log.info(`Canvas setup for node ${node.id}`);
}

/**
 * 更新画布显示
 * @param {Object} node - 节点实例
 * @param {Object} message - 执行消息（可选）
 */
export function updateDisplay(node, message) {
  if (!node || !node.canvas || !node.ctx) return;
  if (node._updateScheduled) return;
  node._updateScheduled = true;

  requestAnimationFrame(() => {
    node._updateScheduled = false;

    const canvas = node.canvas;
    const ctx = node.ctx;
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    const controlPoints = node.properties?.control_points || [
      { x: 125.0 / 512, y: 125.0 / 512 },
      { x: 387.0 / 512, y: 387.0 / 512 }
    ];

    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  const cols = 10;
  const rows = 10;
  const xStep = width / cols;
  const yStep = height / rows;
  for (let i = 0; i <= cols; i++) {
    const x = Math.round(i * xStep) + 0.5;
    ctx.moveTo(x, 0.5);
    ctx.lineTo(x, height - 0.5);
  }
  for (let i = 0; i <= rows; i++) {
    const y = Math.round(i * yStep) + 0.5;
    ctx.moveTo(0.5, y);
    ctx.lineTo(width - 0.5, y);
  }
  ctx.rect(0.5, 0.5, width - 1, height - 1);
  ctx.stroke();

    if (controlPoints.length > 0) {
      ctx.strokeStyle = "#4CAF50";
      ctx.lineWidth = 2;
      ctx.beginPath();
      
      const pathMode = node.properties?.path_mode || "linear";
      
      if (pathMode === "curve" && controlPoints.length >= 2) {
        const points = controlPoints.map(p => ({
          x: p.x * width,
          y: p.y * height
        }));
        
        let curvePoints = [...points];
        if (curvePoints.length === 2) {
          const p0 = { x: curvePoints[0].x - 0.2 * (curvePoints[1].x - curvePoints[0].x),
                      y: curvePoints[0].y - 0.2 * (curvePoints[1].y - curvePoints[0].y) };
          const p3 = { x: curvePoints[1].x + 0.2 * (curvePoints[1].x - curvePoints[0].x),
                      y: curvePoints[1].y + 0.2 * (curvePoints[1].y - curvePoints[0].y) };
          curvePoints = [p0, curvePoints[0], curvePoints[1], p3];
        } else if (curvePoints.length === 3) {
          const p0 = { x: curvePoints[0].x - 0.15 * (curvePoints[1].x - curvePoints[0].x),
                      y: curvePoints[0].y - 0.15 * (curvePoints[1].y - curvePoints[0].y) };
          const p4 = { x: curvePoints[2].x + 0.15 * (curvePoints[2].x - curvePoints[1].x),
                      y: curvePoints[2].y + 0.15 * (curvePoints[2].y - curvePoints[1].y) };
          curvePoints = [p0, curvePoints[0], curvePoints[1], curvePoints[2], p4];
        } else {
          const p0 = { x: curvePoints[0].x - 0.1 * (curvePoints[1].x - curvePoints[0].x),
                      y: curvePoints[0].y - 0.1 * (curvePoints[1].y - curvePoints[0].y) };
          const p_end = { x: curvePoints[curvePoints.length - 1].x + 0.1 * (curvePoints[curvePoints.length - 1].x - curvePoints[curvePoints.length - 2].x),
                        y: curvePoints[curvePoints.length - 1].y + 0.1 * (curvePoints[curvePoints.length - 1].y - curvePoints[curvePoints.length - 2].y) };
          curvePoints = [p0, ...curvePoints, p_end];
        }
        
        const numSegments = curvePoints.length - 3;
        for (let seg = 0; seg < numSegments; seg++) {
          const samplesPerSegment = 40;
          for (let j = 0; j <= samplesPerSegment; j++) {
            const t = j / samplesPerSegment;
            const point = catmullRom(curvePoints, seg, t);
            if (t === 0 && seg === 0) {
              ctx.moveTo(point.x, point.y);
            } else {
              ctx.lineTo(point.x, point.y);
            }
          }
        }
      } else {
        for (let i = 0; i < controlPoints.length; i++) {
          const point = controlPoints[i];
          const x = point.x * width;
          const y = point.y * height;
          
          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
      }
      ctx.stroke();

      for (let i = 0; i < controlPoints.length; i++) {
        const point = controlPoints[i];
        const x = point.x * width;
        const y = point.y * height;
        ctx.fillStyle = "#0e8420ff";
        ctx.beginPath();
        ctx.arc(x, y, 10, 0, 2 * Math.PI);
        ctx.fill();
        ctx.strokeStyle = "#FFF";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 10, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.fillStyle = "#FFF";
        ctx.font = "13px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText((i + 1).toString(), x, y+1);
      }
    }

    const infoDiv = node.canvas.parentElement?.parentElement?.querySelector(`.xiser-coordinate-info`);
    if (infoDiv) {
      const pathMode = node.properties?.path_mode || "linear";
      const distributionMode = node.properties?.distribution_mode || "uniform";
      const distributionModeText = {
        "uniform": "Uniform",
        "ease_in": "Ease In",
        "ease_out": "Ease Out",
        "ease_in_out": "Ease In-Out",
        "ease_out_in": "Ease Out-In"
      }[distributionMode] || "Uniform";
      infoDiv.textContent = `Points: ${controlPoints.length} | Path: ${pathMode === "curve" ? "Curve" : "Line"} | Distribution: ${distributionModeText}`;
    }
  });
}

/**
 * 更新画布大小
 * @param {Object} node - 节点实例
 */
export function updateCanvasSize(node) {
  if (!node || node.id === -1 || !node.canvas || !node.ctx || !node.canvas.parentElement) {
    log.warning(`Node ${node?.id || 'unknown'} canvas or context not initialized`);
    return;
  }

  const canvasContainer = node.canvas.parentElement;
  const nodeWidth = node.size[0] || 360;
  const nodeHeight = node.size[1] || 510;

  // 获取输入值
  const widgets = node.widgets || [];
  const widthWidget = widgets.find(w => w.name === "width");
  const heightWidget = widgets.find(w => w.name === "height");
  node.properties.width = widthWidget ? Number(widthWidget.value) || 512 : 512;
  node.properties.height = heightWidget ? Number(heightWidget.value) || 512 : 512;

  // 计算控件区域高度
  const widgetHeight = widgets
    .filter(w => w.type === "number" || w.type === "combo")
    .reduce((sum, w) => sum + (w.element?.getBoundingClientRect().height || 30), 0);

  const availableWidth = nodeWidth - 16;
  const availableHeight = Math.max(100, nodeHeight - widgetHeight - 60); // 考虑padding和信息区域

  const aspectRatio = node.properties.width / node.properties.height;
  let canvasWidth, canvasHeight;

  if (availableHeight * aspectRatio <= availableWidth) {
    canvasHeight = availableHeight;
    canvasWidth = Math.round(canvasHeight * aspectRatio);
  } else {
    canvasWidth = availableWidth;
    canvasHeight = Math.round(canvasWidth / aspectRatio);
  }

  canvasWidth = Math.max(1, Math.floor(canvasWidth));
  canvasHeight = Math.max(1, Math.floor(canvasHeight));

  node.canvas.width = canvasWidth;
  node.canvas.height = canvasHeight;
  node.canvas.style.width = `${canvasWidth}px`;
  node.canvas.style.height = `${canvasHeight}px`;

  updateDisplay(node);
}

/**
 * 监听输入控件变化
 * @param {Object} node - 节点实例
 */
export function setupInputListeners(node) {
  const widgets = node.widgets || [];
  const widthWidget = widgets.find(w => w.name === "width");
  const heightWidget = widgets.find(w => w.name === "height");
  const pathModeWidget = widgets.find(w => w.name === "path_mode");
  const distributionModeWidget = widgets.find(w => w.name === "distribution_mode");

  if (widthWidget) {
    widthWidget.callback = () => {
      node.properties.width = Number(widthWidget.value) || 512;
      updateCanvasSize(node);
      updateDisplay(node);
      node.setDirtyCanvas(true, true);
      log.info(`Node ${node.id} width updated to: ${node.properties.width}`);
    };
  }

  if (heightWidget) {
    heightWidget.callback = () => {
      node.properties.height = Number(heightWidget.value) || 512;
      updateCanvasSize(node);
      updateDisplay(node);
      node.setDirtyCanvas(true, true);
      log.info(`Node ${node.id} height updated to: ${node.properties.height}`);
    };
  }

  if (pathModeWidget) {
    pathModeWidget.callback = () => {
      node.properties.path_mode = pathModeWidget.value;
      updateDisplay(node);
      node.setDirtyCanvas(true, true);
      log.info(`Node ${node.id} path_mode updated to: ${node.properties.path_mode}`);
    };
  }

  if (distributionModeWidget) {
    distributionModeWidget.callback = () => {
      node.properties.distribution_mode = distributionModeWidget.value;
      updateDisplay(node);
      node.setDirtyCanvas(true, true);
      log.info(`Node ${node.id} distribution_mode updated to: ${node.properties.distribution_mode}`);
    };
  }

  log.info(`Input listeners setup for node ${node.id}`);
}

/**
 * 计算点到线段的距离
 * @param {number} px - 点X坐标
 * @param {number} py - 点Y坐标
 * @param {number} x1 - 线段起点X
 * @param {number} y1 - 线段起点Y
 * @param {number} x2 - 线段终点X
 * @param {number} y2 - 线段终点Y
 * @returns {number} 点到线段的距离
 */
function distanceToSegment(px, py, x1, y1, x2, y2) {
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
 * 处理画布鼠标按下事件
 * @param {Object} node - 节点实例
 * @param {MouseEvent} e - 鼠标事件
 */
function onCanvasMouseDown(node, e) {
  if (e.button !== 0) return; // 只处理左键点击
  if (!node || node.id === -1 || !node.canvas) return;

  const rect = node.canvas.getBoundingClientRect();

  // 计算实际显示的canvas区域（考虑object-fit: contain）
  const containerAspect = rect.width / rect.height;
  const canvasAspect = node.canvas.width / node.canvas.height;

  let displayedWidth, displayedHeight, offsetX, offsetY;

  if (containerAspect > canvasAspect) {
    // 容器更宽，canvas上下有空白
    displayedHeight = rect.height;
    displayedWidth = displayedHeight * canvasAspect;
    offsetX = (rect.width - displayedWidth) / 2;
    offsetY = 0;
  } else {
    // 容器更高，canvas左右有空白
    displayedWidth = rect.width;
    displayedHeight = displayedWidth / canvasAspect;
    offsetX = 0;
    offsetY = (rect.height - displayedHeight) / 2;
  }

  // 检查点击是否在canvas实际显示区域内
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  if (mouseX < offsetX || mouseX > offsetX + displayedWidth ||
      mouseY < offsetY || mouseY > offsetY + displayedHeight) {
    return; // 点击在空白区域
  }

  // 计算标准化坐标（基于canvas实际分辨率）
  const canvasX = (mouseX - offsetX) * (node.canvas.width / displayedWidth);
  const canvasY = (mouseY - offsetY) * (node.canvas.height / displayedHeight);

  const x = canvasX / node.canvas.width;
  const y = canvasY / node.canvas.height;

  if (x < 0 || x > 1 || y < 0 || y > 1) return;

  node.draggingPoint = null;
  const selectionRadius = 15;

  // 检查是否点击了现有控制点
  for (let i = 0; i < (node.properties.control_points || []).length; i++) {
    const point = node.properties.control_points[i];
    const dx = (point.x - x) * node.canvas.width;
    const dy = (point.y - y) * node.canvas.height;
    if (Math.sqrt(dx * dx + dy * dy) < selectionRadius) {
      node.draggingPoint = i;
      log.info(`Node ${node.id} selected control point ${i + 1}`);
      return;
    }
  }

  // 检查是否点击了路径线段，以便插入控制点
  const controlPoints = node.properties.control_points || [];
  const pathMode = node.properties.path_mode || "linear";

  if (controlPoints.length >= 2) {
    const lineSelectionRadius = 10; // 线段选择半径
    let closestSegmentIndex = -1;
    let minDistance = lineSelectionRadius;

    if (pathMode === "linear") {
      // 线性模式：检查所有线段
      for (let i = 0; i < controlPoints.length - 1; i++) {
        const p1 = controlPoints[i];
        const p2 = controlPoints[i + 1];
        const distance = distanceToSegment(
          x * node.canvas.width, y * node.canvas.height,
          p1.x * node.canvas.width, p1.y * node.canvas.height,
          p2.x * node.canvas.width, p2.y * node.canvas.height
        );

        if (distance < minDistance) {
          minDistance = distance;
          closestSegmentIndex = i;
        }
      }
    } else {
      // 曲线模式：检查曲线上的最近点
      const curvePoints = generateCurvePoints(controlPoints, node.canvas.width, node.canvas.height);
      for (let i = 0; i < curvePoints.length - 1; i++) {
        const p1 = curvePoints[i];
        const p2 = curvePoints[i + 1];
        const distance = distanceToSegment(
          x * node.canvas.width, y * node.canvas.height,
          p1.x, p1.y,
          p2.x, p2.y
        );

        if (distance < minDistance) {
          minDistance = distance;
          // 找到对应的控制点段
          const segmentPerPoint = Math.ceil(curvePoints.length / (controlPoints.length - 1));
          closestSegmentIndex = Math.floor(i / segmentPerPoint);
        }
      }
    }

    if (closestSegmentIndex !== -1) {
      // 在找到的线段位置插入控制点
      const insertIndex = closestSegmentIndex + 1;
      const newPoint = { x, y };

      // 检查是否点击了非常接近现有控制点的位置
      let tooClose = false;
      for (const point of controlPoints) {
        const dx = (point.x - x) * node.canvas.width;
        const dy = (point.y - y) * node.canvas.height;
        if (Math.sqrt(dx * dx + dy * dy) < 5) { // 5像素阈值
          tooClose = true;
          break;
        }
      }

      if (!tooClose) {
        controlPoints.splice(insertIndex, 0, newPoint);
        node.draggingPoint = insertIndex;
        updateDisplay(node);
        node.setDirtyCanvas(true, true);
        log.info(`Node ${node.id} inserted control point at index ${insertIndex}: ${JSON.stringify(newPoint)}`);
        return;
      }
    }
  }

  // 如果既没有点击控制点也没有点击线段，则在末尾添加新控制点
  if (controlPoints.length < 50) {
    // Ensure control_points array exists but don't overwrite existing points
    if (!node.properties.control_points) {
      node.properties.control_points = [];
    }
    const newPoint = { x, y };

    // 检查是否点击了非常接近现有控制点的位置
    let tooClose = false;
    for (const point of controlPoints) {
      const dx = (point.x - x) * node.canvas.width;
      const dy = (point.y - y) * node.canvas.height;
      if (Math.sqrt(dx * dx + dy * dy) < 5) { // 5像素阈值
        tooClose = true;
        break;
      }
    }

    if (!tooClose) {
      node.properties.control_points.push(newPoint);
      node.draggingPoint = node.properties.control_points.length - 1;
      updateDisplay(node);
      node.setDirtyCanvas(true, true);
      log.info(`Node ${node.id} added control point: ${JSON.stringify(newPoint)}`);
    } else {
      log.info(`Node ${node.id} click too close to existing point, not adding new one`);
    }
  }
}

/**
 * 处理画布鼠标移动事件
 * @param {Object} node - 节点实例
 * @param {MouseEvent} e - 鼠标事件
 */
function onCanvasMouseMove(node, e) {
  if (!node || node.id === -1 || node.draggingPoint === null || !node.canvas || !(e.buttons & 1)) return;

  const rect = node.canvas.getBoundingClientRect();

  // 计算实际显示的canvas区域（考虑object-fit: contain）
  const containerAspect = rect.width / rect.height;
  const canvasAspect = node.canvas.width / node.canvas.height;

  let displayedWidth, displayedHeight, offsetX, offsetY;

  if (containerAspect > canvasAspect) {
    // 容器更宽，canvas上下有空白
    displayedHeight = rect.height;
    displayedWidth = displayedHeight * canvasAspect;
    offsetX = (rect.width - displayedWidth) / 2;
    offsetY = 0;
  } else {
    // 容器更高，canvas左右有空白
    displayedWidth = rect.width;
    displayedHeight = displayedWidth / canvasAspect;
    offsetX = 0;
    offsetY = (rect.height - displayedHeight) / 2;
  }

  // 计算标准化坐标（基于canvas实际分辨率）
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  const canvasX = (mouseX - offsetX) * (node.canvas.width / displayedWidth);
  const canvasY = (mouseY - offsetY) * (node.canvas.height / displayedHeight);

  let x = canvasX / node.canvas.width;
  let y = canvasY / node.canvas.height;

  // 边缘吸附
  const snapThreshold = 10 / Math.min(node.canvas.width, node.canvas.height);
  if (x < snapThreshold) x = 0;
  else if (x > 1 - snapThreshold) x = 1;
  if (y < snapThreshold) y = 0;
  else if (y > 1 - snapThreshold) y = 1;

  x = Math.max(0, Math.min(1, x));
  y = Math.max(0, Math.min(1, y));

  if (node.properties.control_points && node.draggingPoint < node.properties.control_points.length) {
    node.properties.control_points[node.draggingPoint].x = x;
    node.properties.control_points[node.draggingPoint].y = y;
    updateDisplay(node);
    node.setDirtyCanvas(true, true);
    log.info(`Node ${node.id} moved control point ${node.draggingPoint + 1} to: ${x}, ${y}`);
  }
}

/**
 * 处理画布鼠标释放事件
 * @param {Object} node - 节点实例
 */
function onCanvasMouseUp(node) {
  node.draggingPoint = null;
  log.info(`Node ${node.id} stopped dragging`);
}

/**
 * 处理画布右键事件，显示复制和删除菜单
 * @param {Object} node - 节点实例
 * @param {MouseEvent} e - 鼠标事件
 */
function onCanvasRightClick(node, e) {
  e.preventDefault();
  e.stopPropagation();
  node.draggingPoint = null;

  if (!node || node.id === -1 || !node.canvas) return;

  const rect = node.canvas.getBoundingClientRect();

  // 计算实际显示的canvas区域（考虑object-fit: contain）
  const containerAspect = rect.width / rect.height;
  const canvasAspect = node.canvas.width / node.canvas.height;

  let displayedWidth, displayedHeight, offsetX, offsetY;

  if (containerAspect > canvasAspect) {
    // 容器更宽，canvas上下有空白
    displayedHeight = rect.height;
    displayedWidth = displayedHeight * canvasAspect;
    offsetX = (rect.width - displayedWidth) / 2;
    offsetY = 0;
  } else {
    // 容器更高，canvas左右有空白
    displayedWidth = rect.width;
    displayedHeight = displayedWidth / canvasAspect;
    offsetX = 0;
    offsetY = (rect.height - displayedHeight) / 2;
  }

  // 检查点击是否在canvas实际显示区域内
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  if (mouseX < offsetX || mouseX > offsetX + displayedWidth ||
      mouseY < offsetY || mouseY > offsetY + displayedHeight) {
    return; // 点击在空白区域
  }

  // 计算标准化坐标（基于canvas实际分辨率）
  const canvasX = (mouseX - offsetX) * (node.canvas.width / displayedWidth);
  const canvasY = (mouseY - offsetY) * (node.canvas.height / displayedHeight);

  const x = canvasX / node.canvas.width;
  const y = canvasY / node.canvas.height;

  let selectedIndex = -1;
  const selectionRadius = 15;
  
  for (let i = 0; i < (node.properties.control_points || []).length; i++) {
    const point = node.properties.control_points[i];
    const dx = (point.x - x) * node.canvas.width;
    const dy = (point.y - y) * node.canvas.height;
    if (Math.sqrt(dx * dx + dy * dy) < selectionRadius) {
      selectedIndex = i;
      break;
    }
  }

  if (selectedIndex !== -1) {
    showContextMenu(node, e.clientX, e.clientY, selectedIndex);
  }
}

/**
 * 显示右键菜单
 * @param {Object} node - 节点实例
 * @param {number} x - 菜单X坐标
 * @param {number} y - 菜单Y坐标
 * @param {number} pointIndex - 控制点索引
 */
function showContextMenu(node, x, y, pointIndex) {
  // 移除现有菜单
  const existingMenu = document.querySelector(`.xiser-context-menu-${node.id}`);
  if (existingMenu) existingMenu.remove();

  // 创建菜单
  const menu = document.createElement("div");
  menu.className = `xiser-context-menu xiser-context-menu-${node.id}`;
  menu.style.cssText = `
    position: fixed;
    left: ${x}px;
    top: ${y}px;
    background: #2a2a2a;
    border: 1px solid #555;
    border-radius: 4px;
    padding: 4px 0;
    z-index: 1000;
    min-width: 120px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  `;

  // 菜单选项
  const options = [
    { text: "Copy", action: () => copyCoordinates(node, pointIndex) },
    { text: "Delete", action: () => deleteControlPoint(node, pointIndex) },
    { text: "Clear All", action: () => clearAllPoints(node) }
  ];

  options.forEach(option => {
    const menuItem = document.createElement("div");
    menuItem.textContent = option.text;
    menuItem.style.cssText = `
      padding: 6px 12px;
      cursor: pointer;
      font-size: 12px;
      color: #ccc;
    `;
    menuItem.addEventListener("mouseenter", () => {
      menuItem.style.background = "#3a3a3a";
    });
    menuItem.addEventListener("mouseleave", () => {
      menuItem.style.background = "transparent";
    });
    menuItem.addEventListener("click", () => {
      option.action();
      menu.remove();
    });
    menu.appendChild(menuItem);
  });

  document.body.appendChild(menu);

  // 点击外部关闭菜单
  const closeMenu = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener("click", closeMenu);
    }
  };
  setTimeout(() => document.addEventListener("click", closeMenu), 100);
}

/**
 * 复制坐标到剪贴板
 * @param {Object} node - 节点实例
 * @param {number} pointIndex - 控制点索引
 */
function copyCoordinates(node, pointIndex) {
  const controlPoints = node.properties?.control_points || [];
  if (pointIndex >= 0 && pointIndex < controlPoints.length) {
    const point = controlPoints[pointIndex];
    const text = `X: ${point.x.toFixed(3)}, Y: ${point.y.toFixed(3)}`;
    navigator.clipboard.writeText(text).then(() => {
      log.info(`Copied coordinates: ${text}`);
    });
  }
}

/**
 * 删除控制点
 * @param {Object} node - 节点实例
 * @param {number} pointIndex - 控制点索引
 */
function deleteControlPoint(node, pointIndex) {
  const controlPoints = node.properties?.control_points || [];
  if (pointIndex >= 0 && pointIndex < controlPoints.length) {
    controlPoints.splice(pointIndex, 1);
    node.properties.control_points = controlPoints;
    updateDisplay(node);
    node.setDirtyCanvas(true, true);
    log.info(`Deleted control point at index ${pointIndex}`);
  }
}

/**
 * 清空所有控制点
 * @param {Object} node - 节点实例
 */
function clearAllPoints(node) {
  node.properties.control_points = [];
  updateDisplay(node);
  node.setDirtyCanvas(true, true);
  log.info(`Cleared all control points`);
}

// 注册扩展
app.registerExtension({
  name: "XISER.CoordinatePath",

  /**
   * 节点创建时初始化 UI 和监听器
   * @param {Object} node - 节点实例
   */
  nodeCreated(node) {
    if (node.comfyClass === "XIS_CoordinatePath") {
      log.info(`Node ${node.id} created`);

      // 初始化默认属性
      node.properties = node.properties || {
        control_points: [
          { x: 125.0 / 512, y: 125.0 / 512 },
          { x: 387.0 / 512, y: 387.0 / 512 }
        ],
        node_size: [360, 510],
        width: 512,
        height: 512,
        path_mode: "linear",
        distribution_mode: "uniform"
      };

      // 延迟初始化
      setTimeout(() => {
        if (node && node.id !== -1) {
          setupCanvas(node);
          setupInputListeners(node);
          updateDisplay(node);
          if (node.onResize) {
            node.onResize(node.properties.node_size);
          }
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
    if (nodeData.name === "XIS_CoordinatePath") {
      nodeType.prototype.comfyClass = "XIS_CoordinatePath";
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
        document.querySelectorAll(`.xiser-coordinate-node-${this.id}, .xiser-coordinate-canvas-${this.id}, .xiser-coordinate-info-${this.id}, .xiser-context-menu-${this.id}`).forEach(el => {
          log.info(`Node ${this.id} removing element:`, el.className);
          el.remove();
        });
        this.widgets = [];
        this.canvas = null;
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
      .xiser-coordinate-node {
        border-radius: 8px;
        resize: both;
        overflow: hidden;
      }
      .xiser-context-menu div:hover {
        background: #3a3a3a !important;
      }
    `;
    document.head.appendChild(style);
    log.info("XISER.CoordinatePath extension styles applied");
  },

  // 导出模块化方法
  setupCanvas,
  updateDisplay,
  setupInputListeners,
  updateCanvasSize,
});
