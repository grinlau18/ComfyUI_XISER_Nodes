/**
 * Flower shape generator module
 * Supports flower shape with petal count and length control
 */

export class FlowerGenerator {
    static type = "flower";

    /**
     * Generate flower shape data
     * @param {Object} params - Shape parameters
     * @param {number} size - Base size
     * @returns {Object} Shape data including path and metadata
     */
    static generate(params = {}, size) {
        const petals = params.petals || 5;
        const petalLength = params.petal_length || 0.5; 

        return this._generateFlowerShape(petals, petalLength, size);
    }

    /**
     * Generate flower shape with petal controls
     */
    static _generateFlowerShape(petals, petalLength, size) {
        const radius = size;
        const petalCount = Math.max(3, Math.min(12, petals));
        const lengthFactor = Math.max(0.1, Math.min(1.3, petalLength));

        const points = [];
        const segments = 64; // Fixed segments for smoothness

        // Generate flower points with proper petal distribution
        for (let i = 0; i <= segments; i++) {
            const t = i / segments * Math.PI * 2;

            // Improved flower equation with proper petal alignment
            // Use petalCount directly for correct petal number
            const r = radius * (0.65 + 0.5 * Math.sin(petalCount * t) * lengthFactor);  // 调整系数使花朵更大

            const x = r * Math.cos(t);
            const y = r * Math.sin(t);

            points.push([x, y]);
        }

        // Build smooth path data with cubic bezier curves
        let pathData = this._createSmoothPath(points);

        return {
            pathData,
            innerPathData: '',
            metadata: {
                type: "flower",
                points: points.length,
                petals: petalCount,
                petal_length: lengthFactor
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
        // Petal count control
        const petalsDiv = document.createElement("div");
        petalsDiv.innerHTML = `
            <label style="display: block; margin-bottom: 4px; color: #ccc;">Petal Count:</label>
            <input type="range" min="3" max="12" step="1"
                   value="${shapeParams.petals || 5}"
                   style="width: 100%;"
                   oninput="this.nextElementSibling.value = this.value">
            <output style="margin-left: 8px; color: #ccc;">${shapeParams.petals || 5}</output>
        `;
        const petalsInput = petalsDiv.querySelector("input");
        petalsInput.addEventListener("input", () => {
            shapeParams.petals = parseInt(petalsInput.value);
            onParamChange(shapeParams);
        });
        container.appendChild(petalsDiv);

        // Petal length control
        const lengthDiv = document.createElement("div");
        lengthDiv.style.marginTop = "8px";
        lengthDiv.innerHTML = `
            <label style="display: block; margin-bottom: 4px; color: #ccc;">Petal Length:</label>
            <input type="range" min="10" max="130" step="1"
                   value="${(shapeParams.petal_length || 0.5) * 100}"
                   style="width: 100%;"
                   oninput="this.nextElementSibling.value = (this.value / 100).toFixed(2)">
            <output style="margin-left: 8px; color: #ccc;">${(shapeParams.petal_length || 0.5).toFixed(2)}</output>
        `;
        const lengthInput = lengthDiv.querySelector("input");
        lengthInput.addEventListener("input", () => {
            shapeParams.petal_length = parseInt(lengthInput.value) / 100;
            onParamChange(shapeParams);
        });
        container.appendChild(lengthDiv);
    }
}
