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
        const rayCount = params.ray_count || 16;
        const rayLength = params.ray_length || 0.6;

        return this._generateSunburstShape(rayCount, rayLength, size);
    }

    /**
     * Generate sunburst coordinates
     */
    static _generateSunburstShape(rayCount, rayLength, size) {
        const maxRadius = size;
        const rayLengthFactor = Math.min(rayLength, 5.0); // Limit to prevent overlap

        let pathData = '';
        const points = [];

        // Generate sunburst rays (from center to tip)
        for (let i = 0; i < rayCount; i++) {
            const angle = 2 * Math.PI * i / rayCount;

            // Center point
            points.push([0, 0]);

            // Ray tip point
            const tipRadius = maxRadius * rayLengthFactor;
            const x = tipRadius * Math.cos(angle);
            const y = tipRadius * Math.sin(angle);
            points.push([x, y]);
        }

        // Build SVG path data - each ray as separate M L segments
        if (points.length > 0) {
            for (let i = 0; i < points.length; i += 2) {
                if (i > 0) pathData += ' '; // Space between segments
                pathData += `M ${points[i][0]} ${points[i][1]} L ${points[i + 1][0]} ${points[i + 1][1]}`;
            }
        }

        return {
            pathData: pathData,
            innerPathData: '', // No inner path for sunburst
            metadata: {
                type: "sunburst",
                rayCount: rayCount,
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
            <label style="display: block; margin-bottom: 4px; color: #ccc;">射线数量:</label>
            <input type="range" min="4" max="32" step="1"
                   value="${shapeParams.ray_count || 16}"
                   style="width: 100%;"
                   oninput="this.nextElementSibling.value = this.value">
            <output style="margin-left: 8px; color: #ccc;">${shapeParams.ray_count || 16}</output>
        `;
        const rayCountInput = rayCountDiv.querySelector("input");
        rayCountInput.addEventListener("input", () => {
            shapeParams.ray_count = parseInt(rayCountInput.value);
            onParamChange(shapeParams);
        });
        container.appendChild(rayCountDiv);

        // Ray length control
        const rayLengthDiv = document.createElement("div");
        rayLengthDiv.style.marginTop = "8px";
        rayLengthDiv.innerHTML = `
            <label style="display: block; margin-bottom: 4px; color: #ccc;">射线长度:</label>
            <input type="range" min="0.3" max="5" step="0.05"
                   value="${shapeParams.ray_length || 0.6}"
                   style="width: 100%;"
                   oninput="this.nextElementSibling.value = Math.round(this.value * 100) + '%'">
            <output style="margin-left: 8px; color: #ccc;">${Math.round((shapeParams.ray_length || 0.6) * 100)}%</output>
        `;
        const rayLengthInput = rayLengthDiv.querySelector("input");
        rayLengthInput.addEventListener("input", () => {
            shapeParams.ray_length = parseFloat(rayLengthInput.value);
            onParamChange(shapeParams);
        });
        container.appendChild(rayLengthDiv);
    }
}