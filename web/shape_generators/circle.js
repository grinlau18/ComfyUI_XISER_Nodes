/**
 * Circle shape generator module
 * Supports circles, donuts, and circle sectors
 */

export class CircleGenerator {
    static type = "circle";

    /**
     * Generate circle shape data
     * @param {Object} params - Shape parameters
     * @param {number} size - Base size
     * @returns {Object} Shape data including path and metadata
     */
    static generate(params = {}, size) {
        const angle = params.angle || 360;
        const innerRadius = params.inner_radius || 0;

        return this._generateCircleShape(angle, innerRadius, size);
    }

    /**
     * Unified circle shape generation with proper stroke handling
     * Returns separate paths for outer and inner circles to ensure correct filling
     */
    static _generateCircleShape(angle, innerRadius, size) {
        const outerRadius = size;
        const innerRadiusVal = size * (innerRadius / 100);
        const hasInnerRadius = innerRadius > 0;
        const isFullCircle = angle === 360 || angle === 0;
        const isSector = angle < 360 && angle > 0;

        // Higher segment count for better quality
        const segments = Math.max(32, Math.min(96, Math.ceil((isFullCircle ? 360 : angle) * 48 / Math.PI)));
        const angleRad = (isFullCircle ? 2 * Math.PI : angle * Math.PI / 180);

        let outerPathData = '';
        let innerPathData = '';
        const outerPoints = [];
        const innerPoints = [];

        // Generate points for outer and inner circles
        for (let i = 0; i <= segments; i++) {
            const theta = angleRad * i / segments;
            const cosTheta = Math.cos(theta);
            const sinTheta = Math.sin(theta);

            outerPoints.push([outerRadius * cosTheta, outerRadius * sinTheta]);
            if (hasInnerRadius) {
                innerPoints.push([innerRadiusVal * cosTheta, innerRadiusVal * sinTheta]);
            }
        }

        if (hasInnerRadius) {
            // Donut or donut sector - generate separate paths
            if (isFullCircle) {
                // Full donut - two separate closed circles
                outerPathData += `M ${outerPoints[0][0]} ${outerPoints[0][1]}`;
                for (let i = 1; i < outerPoints.length; i++) {
                    outerPathData += ` L ${outerPoints[i][0]} ${outerPoints[i][1]}`;
                }
                outerPathData += ` Z`;

                innerPathData += `M ${innerPoints[0][0]} ${innerPoints[0][1]}`;
                for (let i = 1; i < innerPoints.length; i++) {
                    innerPathData += ` L ${innerPoints[i][0]} ${innerPoints[i][1]}`;
                }
                innerPathData += ` Z`;
            } else {
                // Donut sector - single closed path connecting outer and inner arcs
                outerPathData += `M ${outerPoints[0][0]} ${outerPoints[0][1]}`;
                for (let i = 1; i < outerPoints.length; i++) {
                    outerPathData += ` L ${outerPoints[i][0]} ${outerPoints[i][1]}`;
                }
                outerPathData += ` L ${innerPoints[innerPoints.length - 1][0]} ${innerPoints[innerPoints.length - 1][1]}`;
                for (let i = innerPoints.length - 2; i >= 0; i--) {
                    outerPathData += ` L ${innerPoints[i][0]} ${innerPoints[i][1]}`;
                }
                outerPathData += ` Z`;
            }
        } else {
            // Regular circle or sector
            if (isFullCircle) {
                // Full circle - single closed circle
                outerPathData += `M ${outerPoints[0][0]} ${outerPoints[0][1]}`;
                for (let i = 1; i < outerPoints.length; i++) {
                    outerPathData += ` L ${outerPoints[i][0]} ${outerPoints[i][1]}`;
                }
                outerPathData += ` Z`;
            } else {
                // Sector - closed path with center point
                outerPathData += `M 0 0`;
                outerPathData += ` L ${outerPoints[0][0]} ${outerPoints[0][1]}`;
                for (let i = 1; i < outerPoints.length; i++) {
                    outerPathData += ` L ${outerPoints[i][0]} ${outerPoints[i][1]}`;
                }
                outerPathData += ` Z`;
            }
        }

        return {
            pathData: outerPathData,
            innerPathData: hasInnerRadius ? innerPathData : '',
            metadata: {
                type: hasInnerRadius ? (isFullCircle ? "donut" : "donut_sector") : (isFullCircle ? "circle" : "sector"),
                outerPoints: outerPoints.length,
                innerPoints: innerPoints.length,
                angle,
                innerRadius,
                hasInnerRadius,
                isFullCircle
            }
        };
    }

    /**
     * Get parameter controls for UI
     */
    static getParameterControls(container, shapeParams, onParamChange) {
        // Angle control
        const angleDiv = document.createElement("div");
        angleDiv.innerHTML = `
            <label style="display: block; margin-bottom: 4px; color: #ccc;">角度:</label>
            <input type="range" min="0" max="360" step="1"
                   value="${shapeParams.angle || 360}"
                   style="width: 100%;"
                   oninput="this.nextElementSibling.value = this.value + '°'">
            <output style="margin-left: 8px; color: #ccc;">${shapeParams.angle || 360}°</output>
        `;
        const angleInput = angleDiv.querySelector("input");
        angleInput.addEventListener("input", () => {
            shapeParams.angle = parseInt(angleInput.value);
            onParamChange(shapeParams);
        });
        container.appendChild(angleDiv);

        // Inner radius control
        const innerRadiusDiv = document.createElement("div");
        innerRadiusDiv.style.marginTop = "8px";
        innerRadiusDiv.innerHTML = `
            <label style="display: block; margin-bottom: 4px; color: #ccc;">内圆半径 (%):</label>
            <input type="range" min="0" max="100" step="1"
                   value="${shapeParams.inner_radius || 0}"
                   style="width: 100%;"
                   oninput="this.nextElementSibling.value = this.value + '%'">
            <output style="margin-left: 8px; color: #ccc;">${shapeParams.inner_radius || 0}%</output>
        `;
        const innerRadiusInput = innerRadiusDiv.querySelector("input");
        innerRadiusInput.addEventListener("input", () => {
            shapeParams.inner_radius = parseInt(innerRadiusInput.value);
            onParamChange(shapeParams);
        });
        container.appendChild(innerRadiusDiv);
    }
}