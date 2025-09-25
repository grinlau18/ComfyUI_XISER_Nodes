/**
 * Polygon shape generator module
 * Supports regular polygons with configurable sides
 */

export class PolygonGenerator {
    static type = "polygon";

    /**
     * Generate polygon shape data
     * @param {Object} params - Shape parameters
     * @param {number} size - Base size
     * @returns {Object} Shape data including path and metadata
     */
    static generate(params = {}, size) {
        const sides = params.sides || 4;

        let pathData = '';
        const points = [];

        // Generate polygon points (0° at 3 o'clock)
        for (let i = 0; i < sides; i++) {
            const angle = 2 * Math.PI * i / sides - Math.PI / 2; // Offset to 3 o'clock
            const x = size * Math.cos(angle);
            const y = size * Math.sin(angle);
            points.push([x, y]);
        }

        // Construct path
        pathData += `M ${points[0][0]} ${points[0][1]}`;
        for (let i = 1; i < points.length; i++) {
            pathData += ` L ${points[i][0]} ${points[i][1]}`;
        }
        pathData += ` Z`;

        return {
            pathData,
            metadata: {
                type: "polygon",
                sides,
                points: points.length
            }
        };
    }

    /**
     * Get parameter controls for UI
     */
    static getParameterControls(container, shapeParams, onParamChange) {
        const sidesDiv = document.createElement("div");
        sidesDiv.innerHTML = `
            <label style="display: block; margin-bottom: 4px; color: #ccc;">多边形边数:</label>
            <input type="range" min="3" max="20" step="1"
                   value="${shapeParams.sides || 4}"
                   style="width: 100%;"
                   oninput="this.nextElementSibling.value = this.value">
            <output style="margin-left: 8px; color: #ccc;">${shapeParams.sides || 4}</output>
        `;
        const sidesInput = sidesDiv.querySelector("input");
        sidesInput.addEventListener("input", () => {
            shapeParams.sides = parseInt(sidesInput.value);
            onParamChange(shapeParams);
        });
        container.appendChild(sidesDiv);
    }
}