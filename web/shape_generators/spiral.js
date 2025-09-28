/**
 * Spiral shape generator module
 * Supports spiral shapes with controlled turns and density
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
        const spiralTurns = params.spiral_turns || 3;
        const spiralDensity = params.spiral_density || 1.0;

        return this._generateSpiralShape(spiralTurns, spiralDensity, size);
    }

    /**
     * Generate spiral coordinates
     */
    static _generateSpiralShape(spiralTurns, spiralDensity, size) {
        const maxRadius = size;
        const segments = 512; // Fixed segment count for smooth spiral

        let pathData = '';
        const points = [];

        // Generate spiral points with controlled boundary
        for (let i = 0; i <= segments; i++) {
            // Parameterized spiral: angle from 0 to 2π*turns
            const angle = 2 * Math.PI * spiralTurns * i / segments;

            // Radius from 0 to maxRadius, controlled by density
            let r = maxRadius * (i / segments) * spiralDensity;

            // Ensure spiral stays within maximum boundary
            r = Math.min(r, maxRadius);

            const x = r * Math.cos(angle);
            const y = r * Math.sin(angle);
            points.push([x, y]);
        }

        // Build SVG path data
        if (points.length > 0) {
            pathData += `M ${points[0][0]} ${points[0][1]}`;
            for (let i = 1; i < points.length; i++) {
                pathData += ` L ${points[i][0]} ${points[i][1]}`;
            }
        }

        return {
            pathData: pathData,
            innerPathData: '', // No inner path for spiral
            metadata: {
                type: "spiral",
                spiralTurns: spiralTurns,
                spiralDensity: spiralDensity,
                hasInnerRadius: false,
                isFullCircle: false
            }
        };
    }

    /**
     * Get parameter controls for UI
     */
    static getParameterControls(container, shapeParams, onParamChange) {
        // Spiral turns control
        const turnsDiv = document.createElement("div");
        turnsDiv.innerHTML = `
            <label style="display: block; margin-bottom: 4px; color: #ccc;">螺旋圈数:</label>
            <input type="range" min="1" max="10" step="1"
                   value="${shapeParams.spiral_turns || 3}"
                   style="width: 100%;"
                   oninput="this.nextElementSibling.value = this.value">
            <output style="margin-left: 8px; color: #ccc;">${shapeParams.spiral_turns || 3}</output>
        `;
        const turnsInput = turnsDiv.querySelector("input");
        turnsInput.addEventListener("input", () => {
            shapeParams.spiral_turns = parseInt(turnsInput.value);
            onParamChange(shapeParams);
        });
        container.appendChild(turnsDiv);

        // Spiral density control
        const densityDiv = document.createElement("div");
        densityDiv.style.marginTop = "8px";
        densityDiv.innerHTML = `
            <label style="display: block; margin-bottom: 4px; color: #ccc;">螺旋密度:</label>
            <input type="range" min="0.1" max="4.0" step="0.1"
                   value="${shapeParams.spiral_density || 1.0}"
                   style="width: 100%;"
                   oninput="this.nextElementSibling.value = this.value">
            <output style="margin-left: 8px; color: #ccc;">${shapeParams.spiral_density || 1.0}</output>
        `;
        const densityInput = densityDiv.querySelector("input");
        densityInput.addEventListener("input", () => {
            shapeParams.spiral_density = parseFloat(densityInput.value);
            onParamChange(shapeParams);
        });
        container.appendChild(densityDiv);
    }
}