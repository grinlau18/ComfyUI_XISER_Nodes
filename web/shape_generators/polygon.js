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
        const cornerRadius = params.corner_radius || 0;

        let pathData = '';
        let points = [];

        // Generate polygon points (0° at 3 o'clock)
        for (let i = 0; i < sides; i++) {
            const angle = 2 * Math.PI * i / sides - Math.PI / 2; // Offset to 3 o'clock
            const x = size * Math.cos(angle);
            const y = size * Math.sin(angle);
            points.push([x, y]);
        }

        if (cornerRadius > 0) {
            points = this._applyRoundedCorners(points, cornerRadius);
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
                points: points.length,
                cornerRadius: cornerRadius
            }
        };
    }

    static _applyRoundedCorners(points, cornerRadius) {
        const rounded = [];
        const total = points.length;
        const epsilon = 1e-3;

        for (let i = 0; i < total; i++) {
            const prev = points[(i - 1 + total) % total];
            const curr = points[i];
            const next = points[(i + 1) % total];

            const vPrev = { x: curr[0] - prev[0], y: curr[1] - prev[1] };
            const vNext = { x: next[0] - curr[0], y: next[1] - curr[1] };
            const lenPrev = Math.hypot(vPrev.x, vPrev.y);
            const lenNext = Math.hypot(vNext.x, vNext.y);

            if (lenPrev < epsilon || lenNext < epsilon) {
                rounded.push(curr);
                continue;
            }

            const dirIn = { x: -vPrev.x / lenPrev, y: -vPrev.y / lenPrev };
            const dirOut = { x: vNext.x / lenNext, y: vNext.y / lenNext };
            const dot = Math.max(-1, Math.min(1, dirIn.x * dirOut.x + dirIn.y * dirOut.y));
            const angle = Math.acos(dot);

            if (angle < epsilon) {
                rounded.push(curr);
                continue;
            }

            const halfAngle = angle / 2;
            const tanHalf = Math.tan(halfAngle) || epsilon;
            const maxOffset = Math.min(lenPrev, lenNext) * 0.5;
            let offset = cornerRadius / tanHalf;
            if (offset > maxOffset) {
                offset = maxOffset;
            }

            const actualRadius = offset * tanHalf;
            const startPoint = {
                x: curr[0] + dirIn.x * offset,
                y: curr[1] + dirIn.y * offset
            };
            const endPoint = {
                x: curr[0] + dirOut.x * offset,
                y: curr[1] + dirOut.y * offset
            };

            const bisector = { x: dirIn.x + dirOut.x, y: dirIn.y + dirOut.y };
            const bisectorLength = Math.hypot(bisector.x, bisector.y);
            if (bisectorLength < epsilon) {
                rounded.push([startPoint.x, startPoint.y]);
                rounded.push([endPoint.x, endPoint.y]);
                continue;
            }

            const bisectorDir = { x: bisector.x / bisectorLength, y: bisector.y / bisectorLength };
            const centerDistance = actualRadius / (Math.sin(halfAngle) || epsilon);
            const center = {
                x: curr[0] + bisectorDir.x * centerDistance,
                y: curr[1] + bisectorDir.y * centerDistance
            };

            let startAngle = Math.atan2(startPoint.y - center.y, startPoint.x - center.x);
            let endAngle = Math.atan2(endPoint.y - center.y, endPoint.x - center.x);
            let sweep = endAngle - startAngle;
            if (sweep <= 0) {
                sweep += Math.PI * 2;
            }

            const segments = Math.max(4, Math.min(24, Math.ceil(actualRadius / 4)));
            rounded.push([startPoint.x, startPoint.y]);
            for (let s = 1; s < segments; s++) {
                const angleStep = startAngle + (sweep * s) / segments;
                rounded.push([
                    center.x + Math.cos(angleStep) * actualRadius,
                    center.y + Math.sin(angleStep) * actualRadius
                ]);
            }
            rounded.push([endPoint.x, endPoint.y]);
        }

        return rounded;
    }

    /**
     * Get parameter controls for UI
     */
    static getParameterControls(container, shapeParams, onParamChange) {
        const sidesDiv = document.createElement("div");
        sidesDiv.innerHTML = `
            <label style="display: block; margin-bottom: 4px; color: #ccc;">Sides:</label>
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

        const cornerRadiusDiv = document.createElement("div");
        cornerRadiusDiv.style.marginTop = "8px";
        cornerRadiusDiv.innerHTML = `
            <label style="display: block; margin-bottom: 4px; color: #ccc;">Corner Radius:</label>
            <input type="range" min="0" max="50" step="1"
                   value="${shapeParams.corner_radius || 0}"
                   style="width: 100%;"
                   oninput="this.nextElementSibling.value = this.value + 'px'">
            <output style="margin-left: 8px; color: #ccc;">${shapeParams.corner_radius || 0}px</output>
        `;
        const cornerRadiusInput = cornerRadiusDiv.querySelector("input");
        cornerRadiusInput.addEventListener("input", () => {
            shapeParams.corner_radius = parseInt(cornerRadiusInput.value);
            onParamChange(shapeParams);
        });
        container.appendChild(cornerRadiusDiv);
    }
}
