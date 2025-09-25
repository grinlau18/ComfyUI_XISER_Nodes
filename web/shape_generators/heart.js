/**
 * Heart shape generator module
 * Supports heart shape with path offset for expansion/contraction
 */

export class HeartGenerator {
    static type = "heart";

    /**
     * Generate heart shape data
     * @param {Object} params - Shape parameters
     * @param {number} size - Base size
     * @returns {Object} Shape data including path and metadata
     */
    static generate(params = {}, size) {
        const pathOffset = params.path_offset || 0; // -1 to 1
        return this._generateHeartShape(pathOffset, size);
    }

    /**
     * Generate heart shape with path offset
     */
    static _generateHeartShape(pathOffset, size) {
        const radius = size;
        const offsetFactor = pathOffset * 0.3; // Scale offset for reasonable effect

        // Standard heart parametric equations
        const points = [];
        const segments = 64;

        // Generate base heart shape
        for (let i = 0; i <= segments; i++) {
            const t = i / segments * Math.PI * 2;

            // Classic heart parametric equations
            const x = 16 * Math.pow(Math.sin(t), 3);
            const y = -(13 * Math.cos(t) - 5 * Math.cos(2*t) - 2 * Math.cos(3*t) - Math.cos(4*t));

            // Normalize, scale, and apply offset
            const normalizedX = x / 16;
            const normalizedY = y / 16;

            // Calculate offset direction (normal vector)
            const length = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY);
            const offsetX = normalizedX / (length || 1) * offsetFactor;
            const offsetY = normalizedY / (length || 1) * offsetFactor;

            points.push([
                (normalizedX + offsetX) * radius,
                (normalizedY + offsetY) * radius
            ]);
        }

        // Build smooth path data
        let pathData = this._createSmoothPath(points);

        return {
            pathData,
            innerPathData: '',
            metadata: {
                type: "heart",
                points: points.length,
                path_offset: pathOffset
            }
        };
    }

    /**
     * Create smooth path with cubic bezier curves
     */
    static _createSmoothPath(points) {
        if (points.length < 3) return '';

        let pathData = `M ${points[0][0]} ${points[0][1]}`;

        for (let i = 1; i < points.length; i++) {
            const prev = points[i-1];
            const current = points[i];
            const next = points[(i+1) % points.length];

            // Calculate control points for smooth curve
            const cp1x = prev[0] + (current[0] - (i > 1 ? points[i-2][0] : prev[0])) * 0.25;
            const cp1y = prev[1] + (current[1] - (i > 1 ? points[i-2][1] : prev[1])) * 0.25;
            const cp2x = current[0] - (next[0] - prev[0]) * 0.25;
            const cp2y = current[1] - (next[1] - prev[1]) * 0.25;

            pathData += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${current[0]} ${current[1]}`;
        }

        pathData += ` Z`;
        return pathData;
    }

    /**
     * Get parameter controls for UI
     */
    static getParameterControls(container, shapeParams, onParamChange) {
        // Path offset control (replaces roundness and expansion)
        const offsetDiv = document.createElement("div");
        offsetDiv.innerHTML = `
            <label style="display: block; margin-bottom: 4px; color: #ccc;">路径偏移:</label>
            <input type="range" min="-100" max="100" step="1"
                   value="${(shapeParams.path_offset || 0) * 100}"
                   style="width: 100%;"
                   oninput="this.nextElementSibling.value = (this.value / 100).toFixed(2)">
            <output style="margin-left: 8px; color: #ccc;">${(shapeParams.path_offset || 0).toFixed(2)}</output>
        `;
        const offsetInput = offsetDiv.querySelector("input");
        offsetInput.addEventListener("input", () => {
            shapeParams.path_offset = parseInt(offsetInput.value) / 100;
            onParamChange(shapeParams);
        });
        container.appendChild(offsetDiv);
    }
}