/**
 * DOM操作工具函数
 */

/**
 * Creates a modal element with consistent styling
 * @param {Object} options - Modal configuration options
 * @returns {HTMLElement} The created modal element
 */
export function createModal(options = {}) {
    const {
        width = "min(90vw, 640px)",
        height = "min(90vh, 480px)",
        background = "#1A1A1A",
        borderRadius = "8px",
        zIndex = "10000"
    } = options;

    const modal = document.createElement("div");
    modal.style.position = "fixed";
    modal.style.top = "50%";
    modal.style.left = "50%";
    modal.style.transform = "translate(-50%, -50%)";
    modal.style.width = width;
    modal.style.height = height;
    modal.style.background = background;
    modal.style.border = "none";
    modal.style.borderRadius = borderRadius;
    modal.style.boxShadow = "0 4px 16px rgba(0,0,0,0.5)";
    modal.style.zIndex = zIndex;
    modal.style.display = "flex";
    modal.style.flexDirection = "column";
    modal.style.fontFamily = "'Segoe UI', Arial, sans-serif";

    return modal;
}

/**
 * Creates a button with consistent styling
 * @param {Object} options - Button configuration options
 * @returns {HTMLButtonElement} The created button element
 */
export function createButton(options = {}) {
    const {
        text = "",
        className = "",
        background = "linear-gradient(145deg, #4B5EAA, #3B4A8C)",
        hoverBackground = "linear-gradient(145deg, #5A71C2, #4B5EAA)",
        marginRight = "10px"
    } = options;

    const button = document.createElement("button");
    button.textContent = text;
    button.style.marginRight = marginRight;
    button.className = className;

    // Apply base styles
    button.style.color = "#E0E0E0";
    button.style.border = "none";
    button.style.padding = "8px 16px";
    button.style.borderRadius = "4px";
    button.style.cursor = "pointer";
    button.style.transition = "background 0.2s";
    button.style.fontFamily = "'Segoe UI', Arial, sans-serif";
    button.style.background = background;

    // Add hover effect
    button.addEventListener("mouseenter", () => {
        button.style.background = hoverBackground;
    });
    button.addEventListener("mouseleave", () => {
        button.style.background = background;
    });

    return button;
}

/**
 * Creates editor styles
 * @returns {HTMLStyleElement} The created style element
 */
export function createEditorStyles() {
    const style = document.createElement("style");
    style.textContent = `
        .save-button, .cancel-button {
            color: #E0E0E0;
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            transition: background 0.2s;
            font-family: 'Segoe UI', Arial, sans-serif;
            margin: 0 4px;
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
            background: #141414 !important;
            color: #E0E0E0 !important;
            border: 1px solid #333 !important;
            height: 100% !important;
            width: 100% !important;
            border-radius: 10px;
        }
        .CodeMirror-scroll {
            overflow-y: auto !important;
            overflow-x: hidden !important;
        }
        textarea {
            resize: none;
            overflow-y: auto !important;
            background: #141414;
            color: #E0E0E0;
            border-radius: 10px;
        }
        .editor-top-bar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
            padding: 10px 10px 0px 10px;
        }
        .editor-top-bar .mode-switch {
            flex: 1;
        }
        .color-swatch-button {
            width: 36px;
            height: 36px;
            border: none;
            border-radius: 6px;
            background: linear-gradient(145deg, #4B5EAA, #3B4A8C);
            box-shadow: 0 3px 8px rgba(0, 0, 0, 0.4);
            cursor: pointer;
            transition: transform 0.2s;
            padding: 0;
        }
        .color-swatch-button:hover {
            transform: translateY(-1px);
        }
        .background-control {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .background-label {
            font-size: 12px;
            color: #a1a9c4;
            letter-spacing: 0.5px;
            text-transform: uppercase;
        }
        .html-markdown-switch {
            display: inline-flex;
            align-items: center;
            background-color: #1f1f1f;
            border-radius: 6px;
            padding: 2px;
            width: 200px;
            height: 40px;
            box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.04);
            cursor: pointer;
            transition: background-color 0.2s ease;
        }
        .html-markdown-switch:hover {
            background-color: #2a2a2a;
        }
        .switch-radio {
            display: none;
        }
        .switch-label {
            flex: 1;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 14px;
            font-weight: 600;
            color: #8f98a6;
            border-radius: 6px;
            transition: all 0.2s ease;
            user-select: none;
            letter-spacing: 0.2px;
        }
        .switch-radio:checked + .switch-label {
            background-color: #ffffff;
            color: #4096ff;
            box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
        }
        .switch-label:hover {
            color: #99b0ff;
            background-color: rgba(64, 150, 255, 0.08);
        }
        }
        input[type="color"] {
            display: none;
        }
    `;

    // Prevent duplicate style elements
    const existingStyle = document.querySelector("style[data-xis-label]");
    if (existingStyle) existingStyle.remove();
    style.dataset.xisLabel = "true";

    return style;
}
