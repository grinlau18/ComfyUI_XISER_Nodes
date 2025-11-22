/**
 * Star shape generator module
 * Supports stars with configurable points and inner ratio
 */

export class StarGenerator {
    static type = "star";

    /**
     * Generate star shape data
     * @param {Object} params - Shape parameters
     * @param {number} size - Base size
     * @returns {Object} Shape data including path and metadata
     */
    static generate(params = {}, size) {
        const points = params.points || 5;
        const innerRatio = params.inner_ratio || 0.4;

        let pathData = '';
        const coords = [];

        // Generate star points (0° at 3 o'clock)
        for (let i = 0; i < points * 2; i++) {
            const angle = Math.PI * i / points - Math.PI / 2; // Offset to 3 o'clock
            const r = size * (i % 2 === 0 ? 1 : innerRatio);
            const x = r * Math.cos(angle);
            const y = r * Math.sin(angle);
            coords.push([x, y]);
        }

        // Construct path
        pathData += `M ${coords[0][0]} ${coords[0][1]}`;
        for (let i = 1; i < coords.length; i++) {
            pathData += ` L ${coords[i][0]} ${coords[i][1]}`;
        }
        pathData += ` Z`;

        return {
            pathData,
            metadata: {
                type: "star",
                points,
                innerRatio,
                coordinates: coords.length
            }
        };
    }

    /**
     * Get parameter controls for UI
     */
    static getParameterControls(container, shapeParams, onParamChange) {
        const pointsDiv = document.createElement("div");
        pointsDiv.innerHTML = `
            <label style="display: block; margin-bottom: 4px; color: #ccc;">Star Points:</label>
            <input type="range" min="3" max="20" step="1"
                   value="${shapeParams.points || 5}"
                   style="width: 100%;"
                   oninput="this.nextElementSibling.value = this.value">
            <output style="margin-left: 8px; color: #ccc;">${shapeParams.points || 5}</output>
        `;
        const pointsInput = pointsDiv.querySelector("input");
        pointsInput.addEventListener("input", () => {
            shapeParams.points = parseInt(pointsInput.value);
            onParamChange(shapeParams);
        });

        const ratioDiv = document.createElement("div");
        ratioDiv.style.marginTop = "8px";
        ratioDiv.innerHTML = `
            <label style="display: block; margin-bottom: 4px; color: #ccc;">Inner Radius Ratio:</label>
            <input type="range" min="0.1" max="0.9" step="0.05"
                   value="${shapeParams.inner_ratio || 0.4}"
                   style="width: 100%;"
                   oninput="this.nextElementSibling.value = this.value">
            <output style="margin-left: 8px; color: #ccc;">${shapeParams.inner_ratio || 0.4}</output>
        `;
        const ratioInput = ratioDiv.querySelector("input");
        ratioInput.addEventListener("input", () => {
            shapeParams.inner_ratio = parseFloat(ratioInput.value);
            onParamChange(shapeParams);
        });

        container.appendChild(pointsDiv);
        container.appendChild(ratioDiv);
    }
}
