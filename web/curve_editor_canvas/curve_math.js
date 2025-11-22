import { getEffectivePointCount } from "./point_count.js";

function applyCustomCurve(t, curvePoints, node) {
  if (!curvePoints || curvePoints.length < 2) {
    return t;
  }

  const sortedPoints = curvePoints.slice().sort((a, b) => a.x - b.x);
  const interpolationAlgorithm = node?.properties?.interpolation_algorithm || "catmull_rom";

  if (t >= sortedPoints[0].x && t <= sortedPoints[sortedPoints.length - 1].x) {
    if (interpolationAlgorithm === "linear") {
      return applyLinearInterpolation(t, sortedPoints);
    }
    return applyCatmullRomInterpolation(t, sortedPoints);
  }

  if (t <= sortedPoints[0].x) {
    return sortedPoints[0].y;
  }
  return sortedPoints[sortedPoints.length - 1].y;
}

function applyCatmullRomInterpolation(t, sortedPoints) {
  for (let i = 0; i < sortedPoints.length - 1; i++) {
    const p1 = sortedPoints[i];
    const p2 = sortedPoints[i + 1];

    if (p1.x <= t && t <= p2.x) {
      const p0 = i > 0 ? sortedPoints[i - 1] : p1;
      const p3 = i < sortedPoints.length - 2 ? sortedPoints[i + 2] : p2;
      const segmentT = (t - p1.x) / (p2.x - p1.x);
      return catmullRomInterpolate(p0.y, p1.y, p2.y, p3.y, segmentT);
    }
  }
  return applyLinearInterpolation(t, sortedPoints);
}

function catmullRomInterpolate(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

function applyLinearInterpolation(t, sortedPoints) {
  for (let i = 0; i < sortedPoints.length - 1; i++) {
    const p1 = sortedPoints[i];
    const p2 = sortedPoints[i + 1];

    if (p1.x <= t && t <= p2.x) {
      if (p2.x === p1.x) {
        return p1.y;
      }
      const segmentT = (t - p1.x) / (p2.x - p1.x);
      return p1.y + (p2.y - p1.y) * segmentT;
    }
  }
  return t;
}

function drawCatmullRomSegment(ctx, p0, p1, p2, p3, padding, plotWidth, plotHeight) {
  // Use a higher, distance-aware sampling count to generate smoother curves
  const distance = Math.sqrt(
    Math.pow(p2.x - p1.x, 2) +
    Math.pow(p2.y - p1.y, 2)
  );
  const baseSamples = 16;
  const adaptiveSamples = Math.max(baseSamples, Math.floor(distance * 80));

  for (let i = 1; i <= adaptiveSamples; i++) {
    const t = i / adaptiveSamples;
    const curvePoint = calculateCurvePoint(p0, p1, p2, p3, t);
    const canvasX = padding + curvePoint.x * plotWidth;
    const canvasY = padding + (1 - curvePoint.y) * plotHeight;
    ctx.lineTo(canvasX, canvasY);
  }
}

function findClosestSegment(points, targetX, targetY, interpolationAlgorithm = "catmull_rom") {
  let closestIndex = -1;
  let minDistance = Infinity;

  if (interpolationAlgorithm === "linear" || points.length < 3) {
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      const distance = pointToSegmentDistance(targetX, targetY, p1.x, p1.y, p2.x, p2.y);
      if (distance < minDistance && distance < 0.05) {
        minDistance = distance;
        closestIndex = i;
      }
    }
  } else {
    const sampleCount = 20;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = i > 0 ? points[i - 1] : points[0];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = i < points.length - 2 ? points[i + 2] : points[points.length - 1];

      for (let j = 0; j <= sampleCount; j++) {
        const t = j / sampleCount;
        const curvePoint = calculateCurvePoint(p0, p1, p2, p3, t);
        const dx = targetX - curvePoint.x;
        const dy = targetY - curvePoint.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < minDistance && distance < 0.03) {
          minDistance = distance;
          closestIndex = i;
        }
      }
    }
  }

  return { index: closestIndex, distance: minDistance };
}

function calculateCurvePoint(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;

  const x = 0.5 * (
    (2 * p1.x) +
    (-p0.x + p2.x) * t +
    (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
    (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
  );

  const y = 0.5 * (
    (2 * p1.y) +
    (-p0.y + p2.y) * t +
    (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
    (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
  );

  return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
}

function pointToSegmentDistance(px, py, x1, y1, x2, y2) {
  const A = px - x1;
  const B = py - y1;
  const C = x2 - x1;
  const D = y2 - y1;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;

  if (lenSq !== 0) param = dot / lenSq;

  let xx;
  let yy;

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

function snapToVerticalGrid(node, x) {
  const pointCount = getEffectivePointCount(node);
  const verticalLines = Math.min(pointCount, 50);

  if (!node._cachedGrid || node._cachedGrid.verticalLines !== verticalLines) {
    const gridSpacing = 1 / verticalLines;
    const baseSnapDistance = 0.02;
    const densityFactor = Math.max(0.3, Math.min(1.0, 50 / verticalLines));
    const snapDistance = baseSnapDistance * densityFactor;
    const gridPositions = [];

    for (let i = 0; i <= verticalLines; i++) {
      gridPositions.push(i * gridSpacing);
    }

    node._cachedGrid = {
      verticalLines,
      gridPositions,
      snapDistance
    };
  }

  const { gridPositions, snapDistance } = node._cachedGrid;
  let closestGridX = 0;
  let minDistance = Infinity;

  for (const gridX of gridPositions) {
    const distance = Math.abs(x - gridX);
    if (distance < minDistance) {
      minDistance = distance;
      closestGridX = gridX;
    }
  }

  if (minDistance <= snapDistance) {
    return closestGridX;
  }

  return x;
}

export {
  applyCustomCurve,
  calculateCurvePoint,
  drawCatmullRomSegment,
  findClosestSegment,
  pointToSegmentDistance,
  snapToVerticalGrid
};
