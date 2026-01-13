import { log } from "./config.js";
import { getCachedWidget, getEffectivePointCount } from "./point_count.js";
import { drawCatmullRomSegment } from "./curve_math.js";

function ensureBackgroundCanvas(node, width, height) {
  if (!node) return;

  if (!node._backgroundCanvas) {
    node._backgroundCanvas = document.createElement("canvas");
    node._backgroundCtx = node._backgroundCanvas.getContext("2d");
    node._backgroundDirty = true;
  }

  if (node._backgroundCanvas.width !== width || node._backgroundCanvas.height !== height) {
    node._backgroundCanvas.width = width;
    node._backgroundCanvas.height = height;
    node._backgroundDirty = true;
  }
}

function renderBackgroundLayer(node, width, height, padding, plotWidth, plotHeight, verticalLines) {
  ensureBackgroundCanvas(node, width, height);
  if (!node._backgroundCtx || !node._backgroundCanvas) {
    return;
  }

  if (!node._backgroundDirty && node._backgroundCanvas._lastVerticalLines === verticalLines) {
    return;
  }

  node._backgroundCanvas._lastVerticalLines = verticalLines;
  node._backgroundDirty = false;

  const bgCtx = node._backgroundCtx;
  bgCtx.clearRect(0, 0, width, height);

  bgCtx.fillStyle = 'rgba(0, 0, 0, 0)';
  bgCtx.fillRect(0, 0, width, height);
  bgCtx.fillStyle = 'rgba(90, 90, 90, 0.15)';
  bgCtx.fillRect(0, 0, width, height);

  bgCtx.strokeStyle = '#666';
  bgCtx.lineWidth = 2;

  bgCtx.beginPath();
  bgCtx.moveTo(padding, height - padding);
  bgCtx.lineTo(width - padding, height - padding);
  bgCtx.stroke();

  bgCtx.beginPath();
  bgCtx.moveTo(padding, padding);
  bgCtx.lineTo(padding, height - padding);
  bgCtx.stroke();

  bgCtx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  bgCtx.lineWidth = 1;
  bgCtx.beginPath();
  for (let i = 0; i <= 10; i++) {
    const y = padding + i * plotHeight / 10;
    bgCtx.moveTo(padding, y);
    bgCtx.lineTo(width - padding, y);
  }
  bgCtx.stroke();

  bgCtx.beginPath();
  if (verticalLines === 1) {
    const x = padding;
    bgCtx.moveTo(x, padding);
    bgCtx.lineTo(x, height - padding);
  } else {
    for (let i = 0; i < verticalLines; i++) {
      const x = padding + i * plotWidth / (verticalLines - 1);
      bgCtx.moveTo(x, padding);
      bgCtx.lineTo(x, height - padding);
    }
  }
  bgCtx.stroke();
}

function drawCurve(node) {
  try {
    const ctx = node.ctx;
    const canvas = node.canvas;

    if (!ctx || !canvas) {
      log.error(`Node ${node?.id || 'unknown'} invalid canvas or context in drawCurve`);
      return;
    }

    if (canvas.width <= 0 || canvas.height <= 0) {
      log.error(`Node ${node.id} invalid canvas dimensions: ${canvas.width}x${canvas.height}`);
      return;
    }

    const width = canvas.width;
    const height = canvas.height;
    const padding = 40;
    const plotWidth = width - 2 * padding;
    const plotHeight = height - 2 * padding;

    if (!node._cachedWidgets) {
      node._cachedWidgets = {};
    }

    const pointCount = getEffectivePointCount(node);
    const verticalLines = Math.max(1, Math.min(pointCount, 50));

    renderBackgroundLayer(node, width, height, padding, plotWidth, plotHeight, verticalLines);
    ctx.clearRect(0, 0, width, height);
    if (node._backgroundCanvas) {
      ctx.drawImage(node._backgroundCanvas, 0, 0);
    }

    ctx.fillStyle = '#ccc';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';

    const maxLabels = 10;
    const labelInterval = Math.max(1, Math.ceil(verticalLines / maxLabels));

    // 确保显示第一个和最后一个标签
    const labelIndices = [];
    for (let i = 0; i < verticalLines; i += labelInterval) {
      labelIndices.push(i);
    }

    // 确保包含最后一个点
    if (verticalLines > 1 && !labelIndices.includes(verticalLines - 1)) {
      labelIndices.push(verticalLines - 1);
    }

    // 对索引排序并去重
    labelIndices.sort((a, b) => a - b);
    const uniqueIndices = [...new Set(labelIndices)];

    for (const i of uniqueIndices) {
      let x, value;
      if (verticalLines === 1) {
        x = padding;
        value = 0;
      } else {
        x = padding + i * plotWidth / (verticalLines - 1);
        value = Math.min(pointCount - 1, Math.round(i * (pointCount - 1) / (verticalLines - 1)));
      }
      ctx.fillText(value.toString(), x, height - padding + 15);
    }

    ctx.textAlign = 'right';

    const dataTypeWidget = node._cachedWidgets.dataType || node.widgets?.find(w => w.name === 'data_type');
    node._cachedWidgets.dataType = dataTypeWidget;
    const dataType = dataTypeWidget ? dataTypeWidget.value : "FLOAT";

    const startValueWidget = node._cachedWidgets.startValue || node.widgets?.find(w => w.name === 'start_value');
    node._cachedWidgets.startValue = startValueWidget;
    const startValue = startValueWidget ? parseFloat(startValueWidget.value || 0) : 0;

    const endValueWidget = node._cachedWidgets.endValue || node.widgets?.find(w => w.name === 'end_value');
    node._cachedWidgets.endValue = endValueWidget;
    const endValue = endValueWidget ? parseFloat(endValueWidget.value || 1) : 1;

    for (let i = 0; i <= 5; i++) {
      const y = padding + i * plotHeight / 5;
      let labelText;
      if (dataType === "HEX") {
        const percentage = Math.round((1 - i / 5) * 100);
        labelText = `${percentage}%`;
      } else {
        const value = startValue + (endValue - startValue) * (1 - i / 5);
        labelText = value.toFixed(1);
      }
      ctx.fillText(labelText, padding - 10, y + 4);
    }

    ctx.strokeStyle = '#4CAF50';
    ctx.lineWidth = 3;

    if (node.properties.curve_points.length >= 2) {
      ctx.beginPath();
      const points = node.properties.curve_points;
      const interpolationAlgorithm = node?.properties?.interpolation_algorithm || "catmull_rom";

      if (interpolationAlgorithm === "linear") {
        for (let i = 0; i < points.length; i++) {
          const point = points[i];
          const x = padding + point.x * plotWidth;
          const y = padding + (1 - point.y) * plotHeight;
          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
      } else {
        const firstPoint = points[0];
        const startX = padding + firstPoint.x * plotWidth;
        const startY = padding + (1 - firstPoint.y) * plotHeight;
        ctx.moveTo(startX, startY);
        for (let i = 0; i < points.length - 1; i++) {
          const p0 = i > 0 ? points[i - 1] : points[0];
          const p1 = points[i];
          const p2 = points[i + 1];
          const p3 = i < points.length - 2 ? points[i + 2] : points[points.length - 1];
          drawCatmullRomSegment(ctx, p0, p1, p2, p3, padding, plotWidth, plotHeight);
        }
      }
      ctx.stroke();
    }

    for (let i = 0; i < node.properties.curve_points.length; i++) {
      const point = node.properties.curve_points[i];
      const x = padding + point.x * plotWidth;
      const y = padding + (1 - point.y) * plotHeight;

      if (node._curveState.draggingPoint === i) {
        ctx.fillStyle = '#FF5722';
        ctx.strokeStyle = '#fff';
      } else if (node._curveState.hoverPoint === i) {
        ctx.fillStyle = '#2196F3';
        ctx.strokeStyle = '#fff';
      } else {
        ctx.fillStyle = '#4CAF50';
        ctx.strokeStyle = '#fff';
      }

      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#fff';
      ctx.font = '10px Arial';
      ctx.textAlign = 'center';
      const actualX = Math.round(point.x * (pointCount - 1));

      let displayText;
      if (dataType === "HEX") {
        const percentage = Math.round(point.y * 100);
        displayText = `(${actualX}, ${percentage}%)`;
      } else {
        const actualY = startValue + (endValue - startValue) * point.y;
        displayText = `(${actualX}, ${actualY.toFixed(2)})`;
      }
      ctx.fillText(displayText, x, y - 15);
    }

    ctx.fillStyle = '#fff';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';

    let titleText;
    if (dataType === "HEX") {
      titleText = `Curve Editor (X: point index, Y: 0% to 100%)`;
    } else {
      titleText = `Curve Editor (X: point index, Y: ${startValue} to ${endValue})`;
    }
    ctx.fillText(titleText, width / 2, 15);
  } catch (error) {
    log.error(`Node ${node?.id || 'unknown'} error in drawCurve:`, error);
  }
}

export {
  drawCurve,
  renderBackgroundLayer
};
