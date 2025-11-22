/**
 * Spiral shape generator module
 * Supports spiral shapes with controlled width and turns (based on shape filling)
 */

export class SpiralGenerator {
    static type = "spiral";

    /**
     * Generate spiral shape data
     * @param {Object} params - Shape parameters
     * @param {number} size - Base size
     * @returns {Object} Shape data including path and metadata
     */
    static generate(params = {}, size) {
        const centerX = 0; // 固定中心位置
        const centerY = 0; // 固定中心位置
        // 宽度参数使用固定的值，不受任何缩放影响
        // 这样前后端会有一致的宽度表现
        const startWidth = params.startWidth ?? 15;
        const endWidth = params.endWidth ?? 15;
        const turns = params.turns || 4;
        const pointsPerTurn = params.pointsPerTurn ?? 100;
        const lineLength = params.lineLength ?? 1.0; // 线条长度控制，默认占满画布
        const smoothness = 1.0; // 固定平滑度

        return this._generateSpiralShape({
            centerX, centerY, startWidth, endWidth, turns, pointsPerTurn, smoothness, lineLength
        }, size);
    }

    /**
     * Generate spiral coordinates with width control (based on shape filling)
     */
    static _generateSpiralShape(attrs, size) {
        const { centerX, centerY, turns, pointsPerTurn, startWidth, endWidth, smoothness, lineLength } = attrs;
        const totalPoints = turns * pointsPerTurn;
        const maxRadius = size * lineLength; // 使用线条长度参数控制螺旋大小
        const minRadius = Math.max(startWidth / 2, 0.5);

        // 生成螺旋路径点（使用稳定的切线计算）
        function getSpiralPoints() {
            const points = [];

            for (let i = 0; i < totalPoints; i++) {
                const progress = i / totalPoints;
                const angle = (i / pointsPerTurn) * 2 * Math.PI;
                const radius = minRadius + progress * (maxRadius - minRadius);

                // 计算当前点坐标
                const x = centerX + radius * Math.cos(angle);
                const y = centerY + radius * Math.sin(angle);

                // 稳定的切线计算（使用前后点平均）
                const prevI = Math.max(i - 1, 0);
                const nextI = Math.min(i + 1, totalPoints - 1);

                const prevAngle = (prevI / pointsPerTurn) * 2 * Math.PI;
                const prevRadius = minRadius + (prevI / totalPoints) * (maxRadius - minRadius);
                const prevX = centerX + prevRadius * Math.cos(prevAngle);
                const prevY = centerY + prevRadius * Math.sin(prevAngle);

                const nextAngle = (nextI / pointsPerTurn) * 2 * Math.PI;
                const nextRadius = minRadius + (nextI / totalPoints) * (maxRadius - minRadius);
                const nextX = centerX + nextRadius * Math.cos(nextAngle);
                const nextY = centerY + nextRadius * Math.sin(nextAngle);

                // 切线方向（使用前后点向量）
                const tangentAngle = Math.atan2(nextY - prevY, nextX - prevX);

                points.push({
                    x, y,
                    width: startWidth + (endWidth - startWidth) * progress,
                    tangentAngle: tangentAngle,
                    progress: progress
                });
            }
            return points;
        }

        // 起点封口
        function closeStart(firstPoint, innerPoint, outerPoint) {
            const transition = [];
            if (!firstPoint || !innerPoint || !outerPoint) return transition;

            // 当宽度非常小时，跳过封口计算，避免产生异常连线
            if (firstPoint.width <= 0.1) {
                return transition;
            }

            // 简单可靠的贝塞尔过渡
            const controlX = firstPoint.x - Math.cos(firstPoint.tangentAngle) * firstPoint.width * 0.3;
            const controlY = firstPoint.y - Math.sin(firstPoint.tangentAngle) * firstPoint.width * 0.3;

            // 减少计算点但保持平滑
            for (let t = 0; t <= 1; t += 0.02) {
                const x =
                    (1-t)**2 * innerPoint.x +
                    2*(1-t)*t * controlX +
                    t**2 * outerPoint.x;

                const y =
                    (1-t)**2 * innerPoint.y +
                    2*(1-t)*t * controlY +
                    t**2 * outerPoint.y;

                transition.push({x, y});
            }
            return transition;
        }

        // 终点封口
        function closeEnd(lastPoint, innerPoint, outerPoint) {
            const transition = [];
            if (!lastPoint || !innerPoint || !outerPoint) return transition;

            // 当宽度非常小时，跳过封口计算，避免产生异常连线
            if (lastPoint.width <= 0.1) {
                return transition;
            }

            // 180度半圆封口（最稳定的方式）
            const radius = lastPoint.width / 2;
            const startAngle = lastPoint.tangentAngle + Math.PI/2;
            const endAngle = lastPoint.tangentAngle - Math.PI/2;

            // 计算外侧到半圆起点的过渡
            const outerToArc = [];
            for (let t = 0; t <= 1; t += 0.1) {
                outerToArc.push({
                    x: outerPoint.x + t * (lastPoint.x + Math.cos(startAngle) * radius - outerPoint.x),
                    y: outerPoint.y + t * (lastPoint.y + Math.sin(startAngle) * radius - outerPoint.y)
                });
            }

            // 绘制半圆
            const arcPoints = [];
            const steps = Math.floor(20 * smoothness);
            for (let i = 1; i < steps; i++) {
                const angle = startAngle - (startAngle - endAngle) * (i / steps);
                arcPoints.push({
                    x: lastPoint.x + Math.cos(angle) * radius,
                    y: lastPoint.y + Math.sin(angle) * radius
                });
            }

            // 计算半圆终点到内侧的过渡
            const arcToInner = [];
            for (let t = 0; t <= 1; t += 0.1) {
                arcToInner.push({
                    x: (lastPoint.x + Math.cos(endAngle) * radius) + t * (innerPoint.x - (lastPoint.x + Math.cos(endAngle) * radius)),
                    y: (lastPoint.y + Math.sin(endAngle) * radius) + t * (innerPoint.y - (lastPoint.y + Math.sin(endAngle) * radius))
                });
            }

            // 合并所有点（去重）
            return [...outerToArc.slice(0, -1), ...arcPoints, ...arcToInner.slice(1)];
        }

        // 生成螺旋点
        const points = getSpiralPoints();
        const totalPointsCount = points.length;

        // 当宽度非常小时，仍然生成路径但确保不会产生异常连线
        // 移除强制最小宽度限制，允许更细的螺旋线

        if (totalPointsCount < 5) {
            // 回退到简单圆形
            const pathData = `M ${centerX} ${centerY} m -50, 0 a 50,50 0 1,0 100,0 a 50,50 0 1,0 -100,0 Z`;
            return {
                pathData: pathData,
                innerPathData: '',
                metadata: {
                    type: "spiral",
                    turns: turns,
                    startWidth: startWidth,
                    endWidth: endWidth,
                    pointsPerTurn: pointsPerTurn,
                    smoothness: smoothness,
                    hasInnerRadius: false,
                    isFullCircle: false
                }
            };
        }

        // 计算边界点
        const outerPoints = [];
        const innerPoints = [];
        points.forEach(p => {
            const halfWidth = p.width / 2;
            outerPoints.push({
                x: p.x + Math.cos(p.tangentAngle + Math.PI/2) * halfWidth,
                y: p.y + Math.sin(p.tangentAngle + Math.PI/2) * halfWidth
            });
            innerPoints.push({
                x: p.x + Math.cos(p.tangentAngle - Math.PI/2) * halfWidth,
                y: p.y + Math.sin(p.tangentAngle - Math.PI/2) * halfWidth
            });
        });

        // 关键节点
        const firstPoint = points[0];
        const lastPoint = points[totalPointsCount - 1];
        const firstOuter = outerPoints[0];
        const firstInner = innerPoints[0];
        const lastOuter = outerPoints[outerPoints.length - 1];
        const lastInner = innerPoints[innerPoints.length - 1];

        // 构建填充路径（确保顺序正确）
        const fillPoints = [];

        // 外侧路径（全部点，保证连续性）
        outerPoints.forEach(p => fillPoints.push(p.x, p.y));

        // 终点封口
        const endTransition = closeEnd(lastPoint, lastInner, lastOuter);
        endTransition.forEach(p => fillPoints.push(p.x, p.y));

        // 内侧路径（反向）
        for (let i = innerPoints.length - 1; i >= 0; i--) {
            fillPoints.push(innerPoints[i].x, innerPoints[i].y);
        }

        // 起点封口
        const startTransition = closeStart(firstPoint, firstInner, firstOuter);
        startTransition.forEach(p => fillPoints.push(p.x, p.y));

        // 构建SVG路径数据
        let pathData = '';
        if (fillPoints.length > 0) {
            pathData += `M ${fillPoints[0]} ${fillPoints[1]}`;
            for (let i = 2; i < fillPoints.length; i += 2) {
                pathData += ` L ${fillPoints[i]} ${fillPoints[i+1]}`;
            }
            pathData += ` Z`; // 闭合路径
        }

        return {
            pathData: pathData,
            innerPathData: '',
            metadata: {
                type: "spiral",
                turns: turns,
                startWidth: startWidth,
                endWidth: endWidth,
                pointsPerTurn: pointsPerTurn,
                smoothness: smoothness,
                hasInnerRadius: false,
                isFullCircle: false
            }
        };
    }

    /**
     * Get parameter controls for UI
     */
    static getParameterControls(container, shapeParams, onParamChange) {
        // Scale control
        const scaleDiv = document.createElement("div");
        scaleDiv.innerHTML = `
            <label style="display: block; margin-bottom: 4px; color: #ccc;">Scale:</label>
            <input type="range" min="0.1" max="5.0" step="0.1"
                   value="${shapeParams.lineLength ?? 1.0}"
                   style="width: 100%;"
                   oninput="this.nextElementSibling.value = this.value">
            <output style="margin-left: 8px; color: #ccc;">${shapeParams.lineLength ?? 1.0}</output>
        `;
        const scaleInput = scaleDiv.querySelector("input");
        scaleInput.addEventListener("input", () => {
            shapeParams.lineLength = parseFloat(scaleInput.value);
            onParamChange(shapeParams);
        });
        container.appendChild(scaleDiv);

        // Start width control
        const startWidthDiv = document.createElement("div");
        startWidthDiv.style.marginTop = "8px";
        startWidthDiv.innerHTML = `
            <label style="display: block; margin-bottom: 4px; color: #ccc;">Start Width:</label>
            <input type="range" min="0.01" max="50" step="0.01"
                   value="${shapeParams.startWidth ?? 15}"
                   style="width: 100%;"
                   oninput="this.nextElementSibling.value = this.value">
            <output style="margin-left: 8px; color: #ccc;">${shapeParams.startWidth ?? 15}</output>
        `;
        const startWidthInput = startWidthDiv.querySelector("input");
        startWidthInput.addEventListener("input", () => {
            shapeParams.startWidth = parseFloat(startWidthInput.value);
            onParamChange(shapeParams);
        });
        container.appendChild(startWidthDiv);

        // End width control
        const endWidthDiv = document.createElement("div");
        endWidthDiv.style.marginTop = "8px";
        endWidthDiv.innerHTML = `
            <label style="display: block; margin-bottom: 4px; color: #ccc;">End Width:</label>
            <input type="range" min="0.01" max="50" step="0.01"
                   value="${shapeParams.endWidth ?? 15}"
                   style="width: 100%;"
                   oninput="this.nextElementSibling.value = this.value">
            <output style="margin-left: 8px; color: #ccc;">${shapeParams.endWidth ?? 15}</output>
        `;
        const endWidthInput = endWidthDiv.querySelector("input");
        endWidthInput.addEventListener("input", () => {
            shapeParams.endWidth = parseFloat(endWidthInput.value);
            onParamChange(shapeParams);
        });
        container.appendChild(endWidthDiv);

        // Turns control
        const turnsDiv = document.createElement("div");
        turnsDiv.style.marginTop = "8px";
        turnsDiv.innerHTML = `
            <label style="display: block; margin-bottom: 4px; color: #ccc;">Turns:</label>
            <input type="range" min="1" max="10" step="1"
                   value="${shapeParams.turns || 4}"
                   style="width: 100%;"
                   oninput="this.nextElementSibling.value = this.value">
            <output style="margin-left: 8px; color: #ccc;">${shapeParams.turns || 4}</output>
        `;
        const turnsInput = turnsDiv.querySelector("input");
        turnsInput.addEventListener("input", () => {
            shapeParams.turns = parseInt(turnsInput.value);
            onParamChange(shapeParams);
        });
        container.appendChild(turnsDiv);

        // Points per turn control
        const pointsPerTurnDiv = document.createElement("div");
        pointsPerTurnDiv.style.marginTop = "8px";
        pointsPerTurnDiv.innerHTML = `
            <label style="display: block; margin-bottom: 4px; color: #ccc;">Smoothness:</label>
            <input type="range" min="1" max="100" step="5"
                   value="${shapeParams.pointsPerTurn ?? 100}"
                   style="width: 100%;"
                   oninput="this.nextElementSibling.value = this.value">
            <output style="margin-left: 8px; color: #ccc;">${shapeParams.pointsPerTurn ?? 100}</output>
        `;
        const pointsPerTurnInput = pointsPerTurnDiv.querySelector("input");
        pointsPerTurnInput.addEventListener("input", () => {
            shapeParams.pointsPerTurn = parseInt(pointsPerTurnInput.value);
            onParamChange(shapeParams);
        });
        container.appendChild(pointsPerTurnDiv);
    }
}
