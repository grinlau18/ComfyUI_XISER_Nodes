/**
 * Wavy circle shape generator module
 * Supports wavy circles with controlled wave parameters
 */

export class WavyGenerator {
    static type = "wavy";

    /**
     * Generate wavy circle shape data
     * @param {Object} params - Shape parameters
     * @param {number} size - Base size
     * @returns {Object} Shape data including path and metadata
     */
    static generate(params = {}, size) {
        const waveCount = params.wave_count || 8;
        const waveAmplitude = params.wave_amplitude || 0.2;

        return this._generateWavyShape(waveCount, waveAmplitude, size);
    }

    /**
     * Generate wavy circle coordinates
     */
    static _generateWavyShape(waveCount, waveAmplitude, size) {
        const radius = size;
        const segments = 128; // High segment count for smooth waves

        let pathData = '';
        const points = [];

        // Generate wavy circle points
        for (let i = 0; i <= segments; i++) {
            const theta = 2 * Math.PI * i / segments;
            // Base circle + sine wave deformation
            const r = radius * (1 + waveAmplitude * Math.sin(waveCount * theta));
            const x = r * Math.cos(theta);
            const y = r * Math.sin(theta);
            points.push([x, y]);
        }

        // Build SVG path data
        pathData += `M ${points[0][0]} ${points[0][1]}`;
        for (let i = 1; i < points.length; i++) {
            pathData += ` L ${points[i][0]} ${points[i][1]}`;
        }
        pathData += ` Z`;

        return {
            pathData: pathData,
            innerPathData: '', // No inner path for wavy circle
            metadata: {
                type: "wavy",
                waveCount: waveCount,
                waveAmplitude: waveAmplitude,
                hasInnerRadius: false,
                isFullCircle: true
            }
        };
    }

    /**
     * Get parameter controls for UI
     */
    static getParameterControls(container, shapeParams, onParamChange) {
        // Wave count control
        const waveCountDiv = document.createElement("div");
        waveCountDiv.innerHTML = `
            <label style="display: block; margin-bottom: 4px; color: #ccc;">波浪数量:</label>
            <input type="range" min="2" max="30" step="1"
                   value="${shapeParams.wave_count || 8}"
                   style="width: 100%;"
                   oninput="this.nextElementSibling.value = this.value">
            <output style="margin-left: 8px; color: #ccc;">${shapeParams.wave_count || 8}</output>
        `;
        const waveCountInput = waveCountDiv.querySelector("input");
        waveCountInput.addEventListener("input", () => {
            shapeParams.wave_count = parseInt(waveCountInput.value);
            onParamChange(shapeParams);
        });
        container.appendChild(waveCountDiv);

        // Wave amplitude control
        const amplitudeDiv = document.createElement("div");
        amplitudeDiv.style.marginTop = "8px";
        amplitudeDiv.innerHTML = `
            <label style="display: block; margin-bottom: 4px; color: #ccc;">波浪幅度:</label>
            <input type="range" min="0.05" max="0.5" step="0.01"
                   value="${shapeParams.wave_amplitude || 0.2}"
                   style="width: 100%;"
                   oninput="this.nextElementSibling.value = Math.round(this.value * 100) + '%'">
            <output style="margin-left: 8px; color: #ccc;">${Math.round((shapeParams.wave_amplitude || 0.2) * 100)}%</output>
        `;
        const amplitudeInput = amplitudeDiv.querySelector("input");
        amplitudeInput.addEventListener("input", () => {
            shapeParams.wave_amplitude = parseFloat(amplitudeInput.value);
            onParamChange(shapeParams);
        });
        container.appendChild(amplitudeDiv);
    }
}