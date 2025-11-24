/**
 * 样式管理器模块
 */
import { clamp } from '../utils/common_utils.js';

/**
 * Style manager for handling node appearance and themes.
 */
export class StyleManager {
    constructor() {
        this.themes = {
            default: {
                backgroundColor: "#333355",
                textColor: "#FFFFFF",
                secondaryTextColor: "#999999",
                borderColor: "#444466",
                highlightColor: "#4B5EAA"
            },
            dark: {
                backgroundColor: "#1A1A1A",
                textColor: "#E0E0E0",
                secondaryTextColor: "#888888",
                borderColor: "#333333",
                highlightColor: "#4B5EAA"
            },
            light: {
                backgroundColor: "#F5F5F5",
                textColor: "#333333",
                secondaryTextColor: "#666666",
                borderColor: "#DDDDDD",
                highlightColor: "#4B5EAA"
            }
        };
        this.currentTheme = 'default';
    }

    /**
     * Applies a theme to a node.
     * @param {Object} node - The node object.
     * @param {string} themeName - The theme name.
     */
    applyTheme(node, themeName = 'default') {
        const theme = this.themes[themeName];
        if (!theme) {
            console.warn(`Unknown theme: ${themeName}, using default`);
            return;
        }

        this.currentTheme = themeName;

        // Apply theme to node properties
        if (node.properties) {
            node.color = theme.backgroundColor;
            node.properties.color = theme.backgroundColor;
        }
    }

    /**
     * Gets the current theme.
     * @returns {Object} The current theme.
     */
    getCurrentTheme() {
        return this.themes[this.currentTheme];
    }

    /**
     * Gets available theme names.
     * @returns {string[]} Array of theme names.
     */
    getAvailableThemes() {
        return Object.keys(this.themes);
    }

    /**
     * Creates CSS styles for the modal editor.
     * @returns {string} CSS styles.
     */
    createModalStyles() {
        const theme = this.getCurrentTheme();

        return `
            .save-button, .cancel-button {
                color: ${theme.textColor};
                border: none;
                padding: 8px 16px;
                border-radius: 4px;
                cursor: pointer;
                transition: background 0.2s;
                font-family: 'Segoe UI', Arial, sans-serif;
            }
            .save-button {
                background: linear-gradient(145deg, #4B5EAA, #3B4A8C);
            }
            .save-button:hover {
                background: linear-gradient(145deg, #5A71C2, #4B5EAA);
            }
            .cancel-button {
                background: linear-gradient(145deg, #D81B60, #B01550);
            }
            .cancel-button:hover {
                background: linear-gradient(145deg, #E91E63, #D81B60);
            }
            .CodeMirror {
                font-family: 'Consolas', 'Monaco', monospace !important;
                font-size: 14px !important;
                background: ${theme.backgroundColor} !important;
                color: ${theme.textColor} !important;
                border: 1px solid ${theme.borderColor} !important;
                height: 100% !important;
                width: 100% !important;
            }
            .CodeMirror-scroll {
                overflow-y: auto !important;
                overflow-x: hidden !important;
            }
            textarea {
                resize: none;
                overflow-y: auto !important;
            }
            .mode-switch {
                display: flex;
                gap: 10px;
                margin-bottom: 10px;
                align-items: center;
            }
            .mode-button {
                padding: 6px 12px;
                border: 1px solid ${theme.borderColor};
                background: ${theme.backgroundColor};
                color: ${theme.textColor};
                border-radius: 4px;
                cursor: pointer;
                transition: all 0.2s;
            }
            .mode-button.active {
                background: ${theme.highlightColor};
                border-color: #5A71C2;
            }
            .mode-button:hover {
                background: #3A4A8A;
            }
        `;
    }

    /**
     * Gets node-specific styles based on mode.
     * @param {Object} node - The node object.
     * @returns {Object} Node styles.
     */
    getNodeStyles(node) {
        const isMuteMode = node.mode === 2;
        const isPassMode = node.mode === 4 || node.flags?.bypassed === true;
        const baseColor = node.color || node.properties.color || "#333355";

        const percent = clamp(Number(node.properties?.textScalePercent ?? 50), 1, 100);
        node.properties.textScalePercent = percent;
        return {
            backgroundColor: isPassMode ? "rgba(128, 0, 128, 0.5)" : baseColor,
            alpha: isMuteMode || isPassMode ? 0.5 : 1.0,
            textScale: percent / 100
        };
    }
}
