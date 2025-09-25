/**
 * Square shape generator module
 * Supports square/rectangle shapes with aspect ratio and rounded corners
 */

export class SquareGenerator {
    static type = "square";

    /**
     * Generate square shape data
     * @param {Object} params - Shape parameters
     * @param {number} size - Base size
     * @returns {Object} Shape data including path and metadata
     */
    static generate(params = {}, size) {
        const aspectRatio = params.aspect_ratio || 50;
        const cornerRadius = params.corner_radius || 0;

        return this._generateSquareShape(aspectRatio, cornerRadius, size);
    }

    /**
     * Generate square coordinates with proper quarter-circle arcs for rounded corners
     */
    static _generateSquareShape(aspectRatio, cornerRadius, size) {
        const maxRadius = size;

        // Convert aspect ratio to width and height ratios
        const widthRatio = aspectRatio / 100.0;
        const heightRatio = 1.0 - widthRatio;

        // Ensure minimum size for very extreme ratios
        const effectiveWidthRatio = Math.max(0.01, Math.min(0.99, widthRatio));
        const effectiveHeightRatio = Math.max(0.01, Math.min(0.99, heightRatio));

        const width = maxRadius * 2 * effectiveWidthRatio;
        const height = maxRadius * 2 * effectiveHeightRatio;
        const halfWidth = width / 2;
        const halfHeight = height / 2;

        let pathData = '';
        const points = [];

        if (cornerRadius <= 0) {
            // Square corners
            points.push([-halfWidth, -halfHeight]);  // top-left
            points.push([halfWidth, -halfHeight]);   // top-right
            points.push([halfWidth, halfHeight]);    // bottom-right
            points.push([-halfWidth, halfHeight]);   // bottom-left
        } else {
            // Rounded corners with proper quarter-circle arcs
            const effectiveCornerRadius = Math.min(cornerRadius, Math.min(halfWidth, halfHeight));
            const segments = 16;  // Number of segments per quarter-circle

            // Top-left corner (starts at 180°, ends at 270°)
            const startAngleTL = Math.PI;
            const endAngleTL = 3 * Math.PI / 2;
            const centerXTL = -halfWidth + effectiveCornerRadius;
            const centerYTL = -halfHeight + effectiveCornerRadius;
            for (let i = 0; i <= segments; i++) {
                const angle = startAngleTL + (endAngleTL - startAngleTL) * i / segments;
                const x = centerXTL + effectiveCornerRadius * Math.cos(angle);
                const y = centerYTL + effectiveCornerRadius * Math.sin(angle);
                points.push([x, y]);
            }

            // Top-right corner (starts at 270°, ends at 0°)
            const startAngleTR = 3 * Math.PI / 2;
            const endAngleTR = 2 * Math.PI;
            const centerXTR = halfWidth - effectiveCornerRadius;
            const centerYTR = -halfHeight + effectiveCornerRadius;
            for (let i = 0; i <= segments; i++) {
                const angle = startAngleTR + (endAngleTR - startAngleTR) * i / segments;
                const x = centerXTR + effectiveCornerRadius * Math.cos(angle);
                const y = centerYTR + effectiveCornerRadius * Math.sin(angle);
                points.push([x, y]);
            }

            // Bottom-right corner (starts at 0°, ends at 90°)
            const startAngleBR = 0;
            const endAngleBR = Math.PI / 2;
            const centerXBR = halfWidth - effectiveCornerRadius;
            const centerYBR = halfHeight - effectiveCornerRadius;
            for (let i = 0; i <= segments; i++) {
                const angle = startAngleBR + (endAngleBR - startAngleBR) * i / segments;
                const x = centerXBR + effectiveCornerRadius * Math.cos(angle);
                const y = centerYBR + effectiveCornerRadius * Math.sin(angle);
                points.push([x, y]);
            }

            // Bottom-left corner (starts at 90°, ends at 180°)
            const startAngleBL = Math.PI / 2;
            const endAngleBL = Math.PI;
            const centerXBL = -halfWidth + effectiveCornerRadius;
            const centerYBL = halfHeight - effectiveCornerRadius;
            for (let i = 0; i <= segments; i++) {
                const angle = startAngleBL + (endAngleBL - startAngleBL) * i / segments;
                const x = centerXBL + effectiveCornerRadius * Math.cos(angle);
                const y = centerYBL + effectiveCornerRadius * Math.sin(angle);
                points.push([x, y]);
            }
        }

        // Build SVG path data
        if (points.length > 0) {
            pathData += `M ${points[0][0]} ${points[0][1]}`;
            for (let i = 1; i < points.length; i++) {
                pathData += ` L ${points[i][0]} ${points[i][1]}`;
            }
            pathData += ' Z';  // Close the path
        }

        return {
            pathData: pathData,
            innerPathData: '', // No inner path for square
            metadata: {
                type: "square",
                aspectRatio: aspectRatio,
                cornerRadius: cornerRadius,
                hasInnerRadius: false,
                isFullCircle: false
            }
        };
    }

    /**
     * Get parameter controls for UI
     */
    static getParameterControls(container, shapeParams, onParamChange) {
        // Aspect ratio control
        const aspectRatioDiv = document.createElement("div");
        aspectRatioDiv.innerHTML = `
            <label style="display: block; margin-bottom: 4px; color: #ccc;">长宽比:</label>
            <input type="range" min="1" max="99" step="1"
                   value="${shapeParams.aspect_ratio || 50}"
                   style="width: 100%;"
                   oninput="this.nextElementSibling.value = this.value + '%'">
            <output style="margin-left: 8px; color: #ccc;">${shapeParams.aspect_ratio || 50}%</output>
        `;
        const aspectRatioInput = aspectRatioDiv.querySelector("input");
        aspectRatioInput.addEventListener("input", () => {
            shapeParams.aspect_ratio = parseInt(aspectRatioInput.value);
            onParamChange(shapeParams);
        });
        container.appendChild(aspectRatioDiv);

        // Corner radius control
        const cornerRadiusDiv = document.createElement("div");
        cornerRadiusDiv.style.marginTop = "8px";
        cornerRadiusDiv.innerHTML = `
            <label style="display: block; margin-bottom: 4px; color: #ccc;">圆角半径:</label>
            <input type="range" min="0" max="50" step="1"
                   value="${shapeParams.corner_radius || 0}"
                   style="width: 100%;"
                   oninput="this.nextElementSibling.value = this.value + 'px'">
            <output style="margin-left: 8px; color: #ccc;">${shapeParams.corner_radius || 0}px</output>
        `;
        const cornerRadiusInput = cornerRadiusDiv.querySelector("input");
        cornerRadiusInput.addEventListener("input", () => {
            shapeParams.corner_radius = parseFloat(cornerRadiusInput.value);
            onParamChange(shapeParams);
        });
        container.appendChild(cornerRadiusDiv);
    }
}