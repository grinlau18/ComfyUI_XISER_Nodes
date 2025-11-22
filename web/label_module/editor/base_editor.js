/**
 * 基础编辑器类
 */
import { logger } from '../core/logger.js';

/**
 * Base editor class providing common functionality.
 */
export class BaseEditor {
    constructor(options = {}) {
        this.options = options;
        this.editor = null;
        this.isCodeMirror = false;
    }

    /**
     * Creates the editor element.
     * @param {HTMLElement} container - The container element.
     * @param {string} initialValue - The initial editor value.
     * @returns {Promise<HTMLElement>} The editor element.
     */
    async create(container, initialValue) {
        // Parameters are used by subclasses
        void container, void initialValue;
        throw new Error('create method must be implemented by subclass');
    }

    /**
     * Gets the current editor value.
     * @returns {string} The editor content.
     */
    getValue() {
        if (this.isCodeMirror && this.editor) {
            return this.editor.getValue();
        } else if (this.editor) {
            return this.editor.value;
        }
        return '';
    }

    /**
     * Sets the editor value.
     * @param {string} value - The value to set.
     */
    setValue(value) {
        if (this.isCodeMirror && this.editor) {
            this.editor.setValue(value);
        } else if (this.editor) {
            this.editor.value = value;
        }
    }

    /**
     * Focuses the editor.
     */
    focus() {
        if (this.editor) {
            this.editor.focus();
        }
    }

    /**
     * Destroys the editor.
     */
    destroy() {
        if (this.isCodeMirror && this.editor) {
            try {
                // Get the wrapper element and remove it from DOM
                const wrapper = this.editor.getWrapperElement();
                if (wrapper && wrapper.parentNode) {
                    wrapper.parentNode.removeChild(wrapper);
                }
                this.editor = null;
            } catch (e) {
                logger.warn('Error destroying CodeMirror editor:', e);
            }
        } else if (this.editor && this.editor.parentNode) {
            this.editor.parentNode.removeChild(this.editor);
            this.editor = null;
        }
    }

    /**
     * Creates a fallback textarea editor.
     * @param {HTMLElement} container - The container element.
     * @param {string} initialValue - The initial value.
     * @returns {HTMLTextAreaElement} The textarea element.
     */
    createFallbackTextarea(container, initialValue) {
        const textarea = document.createElement("textarea");
        textarea.style.width = "100%";
        textarea.style.height = "100%";
        textarea.style.background = "#1A1A1A";
        textarea.style.color = "#E0E0E0";
        textarea.style.border = "1px solid #333";
        textarea.style.padding = "10px";
        textarea.style.fontFamily = "'Consolas', 'Monaco', monospace";
        textarea.style.fontSize = "14px";
        textarea.style.resize = "none";
        textarea.style.overflowY = "auto";
        textarea.value = initialValue;

        container.appendChild(textarea);
        return textarea;
    }

    /**
     * Checks if CodeMirror is available.
     * @returns {boolean} True if CodeMirror is available.
     */
    isCodeMirrorAvailable() {
        return typeof window.CodeMirror !== 'undefined';
    }
}