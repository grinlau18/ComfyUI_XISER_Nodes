/**
 * Sunburst shape generator module
 * Supports sunburst/rays shapes with controlled ray count and length
 */

export class SunburstGenerator {
    static type = "sunburst";

    /**
     * Generate sunburst shape data
     * @param {Object} params - Shape parameters
     * @param {number} size - Base size
     * @returns {Object} Shape data including path and metadata
     */
    static generate(params = {}, size) {
        const rayCount = params.ray_count || 10;
        const startWidth = params.start_width || -1; // 直接的起点宽度值
        const endWidth = params.end_width || 30; // 末端宽度
        const rayLength = params.ray_length || 1.0;

        return this._generateSunburstShape(rayCount, startWidth, endWidth, rayLength, size);
    }

    /**
     * Generate sunburst coordinates using trapezoid rays (exact reference implementation)
     */
    static _generateSunburstShape(rayCount, startWidth, endWidth, rayLength, size) {
        const maxRadius = size;
        const lengthFactor = Math.min(rayLength, 5.0); // Limit to prevent overlap

        let pathData = '';

        // 使用与参考代码完全相同的中心点
        const centerX = 0;
        const centerY = 0;
        const outerRadius = lengthFactor * maxRadius; // 射线长度

        console.log(`Sunburst参数: centerX=${centerX}, centerY=${centerY}, outerRadius=${outerRadius}, startWidth=${startWidth}, endWidth=${endWidth}`);

        // 生成每个梯形射线（与参考代码完全一致）
        for (let i = 0; i < rayCount; i++) {
            const angle = 2 * Math.PI * i / rayCount;
            const dx = Math.cos(angle);
            const dy = Math.sin(angle);
            const px = -dy; // 垂直于射线方向的向量
            const py = dx;

            // 计算射线末端坐标
            const endX = centerX + dx * outerRadius;
            const endY = centerY + dy * outerRadius;

            // 计算梯形四个顶点（与参考代码完全一致的算法）
            // 直接从中心点开始，使用与参考代码相同的公式
            const innerLeftX = centerX + px * (startWidth / 2);
            const innerLeftY = centerY + py * (startWidth / 2);
            const innerRightX = centerX - px * (startWidth / 2);
            const innerRightY = centerY - py * (startWidth / 2);
            const outerLeftX = endX - px * (endWidth / 2);
            const outerLeftY = endY - py * (endWidth / 2);
            const outerRightX = endX + px * (endWidth / 2);
            const outerRightY = endY + py * (endWidth / 2);

            // 构建独立的梯形路径（每个梯形单独填充）
            // 使用与参考代码完全一致的顶点顺序
            pathData += `M ${innerLeftX.toFixed(2)} ${innerLeftY.toFixed(2)} `;
            pathData += `L ${outerLeftX.toFixed(2)} ${outerLeftY.toFixed(2)} `;
            pathData += `L ${outerRightX.toFixed(2)} ${outerRightY.toFixed(2)} `;
            pathData += `L ${innerRightX.toFixed(2)} ${innerRightY.toFixed(2)} Z `;
        }

        return {
            pathData: pathData.trim(),
            innerPathData: '', // No inner path for sunburst
            metadata: {
                type: "sunburst",
                rayCount: rayCount,
                startWidth: startWidth,
                endWidth: endWidth,
                rayLength: rayLength,
                hasInnerRadius: false,
                isFullCircle: false
            }
        };
    }

    /**
     * Get parameter controls for UI
     */
    static getParameterControls(container, shapeParams, onParamChange) {
        // Ray count control
        const rayCountDiv = document.createElement("div");
        rayCountDiv.innerHTML = `
            <label style="display: block; margin-bottom: 4px; color: #ccc;">Ray Count:</label>
            <input type="range" min="4" max="32" step="1"
                   value="${shapeParams.ray_count ?? 10}"
                   style="width: 100%;"
                   oninput="this.nextElementSibling.value = this.value">
            <output style="margin-left: 8px; color: #ccc;">${shapeParams.ray_count ?? 10}</output>
        `;
        const rayCountInput = rayCountDiv.querySelector("input");
        rayCountInput.addEventListener("input", () => {
            shapeParams.ray_count = parseInt(rayCountInput.value);
            onParamChange(shapeParams);
        });
        container.appendChild(rayCountDiv);

        // Start width control
        const startWidthDiv = document.createElement("div");
        startWidthDiv.style.marginTop = "8px";
        startWidthDiv.innerHTML = `
            <label style="display: block; margin-bottom: 4px; color: #ccc;">Center Offset:</label>
            <input type="range" min="-100" max="100" step="1"
                   value="${shapeParams.start_width ?? -1}"
                   style="width: 100%;"
                   oninput="this.nextElementSibling.value = this.value">
            <output style="margin-left: 8px; color: #ccc;">${shapeParams.start_width ?? -1}</output>
        `;
        const startWidthInput = startWidthDiv.querySelector("input");
        startWidthInput.addEventListener("input", () => {
            shapeParams.start_width = parseInt(startWidthInput.value);
            onParamChange(shapeParams);
        });
        container.appendChild(startWidthDiv);

        // End width control
        const endWidthDiv = document.createElement("div");
        endWidthDiv.style.marginTop = "8px";
        endWidthDiv.innerHTML = `
            <label style="display: block; margin-bottom: 4px; color: #ccc;">End Width:</label>
            <input type="range" min="1" max="200" step="1"
                   value="${shapeParams.end_width ?? 30}"
                   style="width: 100%;"
                   oninput="this.nextElementSibling.value = this.value">
            <output style="margin-left: 8px; color: #ccc;">${shapeParams.end_width ?? 30}</output>
        `;
        const endWidthInput = endWidthDiv.querySelector("input");
        endWidthInput.addEventListener("input", () => {
            shapeParams.end_width = parseInt(endWidthInput.value);
            onParamChange(shapeParams);
        });
        container.appendChild(endWidthDiv);

        // Ray length control
        const rayLengthDiv = document.createElement("div");
        rayLengthDiv.style.marginTop = "8px";
        rayLengthDiv.innerHTML = `
            <label style="display: block; margin-bottom: 4px; color: #ccc;">Ray Length:</label>
            <input type="range" min="0.3" max="5" step="0.05"
                   value="${shapeParams.ray_length ?? 1.0}"
                   style="width: 100%;"
                   oninput="this.nextElementSibling.value = Math.round(this.value * 100) + '%'">
            <output style="margin-left: 8px; color: #ccc;">${Math.round((shapeParams.ray_length ?? 1.0) * 100)}%</output>
        `;
        const rayLengthInput = rayLengthDiv.querySelector("input");
        rayLengthInput.addEventListener("input", () => {
            shapeParams.ray_length = parseFloat(rayLengthInput.value);
            onParamChange(shapeParams);
        });
        container.appendChild(rayLengthDiv);
    }
}
