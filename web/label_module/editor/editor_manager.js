/**
 * 编辑器管理器
 */
import { logger } from '../core/logger.js';
import { EDITOR_MODES } from '../core/constants.js';
import { HtmlEditor } from './html_editor.js';
import { MarkdownEditor } from './markdown_editor.js';

/**
 * Editor manager for handling different editor types.
 */
export class EditorManager {
    constructor() {
        this.editors = {
            [EDITOR_MODES.HTML]: HtmlEditor,
            [EDITOR_MODES.MARKDOWN]: MarkdownEditor
        };
        this.currentEditor = null;
        this.currentMode = EDITOR_MODES.HTML;
    }

    /**
     * Creates an editor for the specified mode.
     * @param {string} mode - The editor mode ('html' or 'markdown').
     * @param {HTMLElement} container - The container element.
     * @param {string} initialValue - The initial editor value.
     * @returns {Promise<BaseEditor>} The created editor instance.
     */
    async createEditor(mode, container, initialValue) {
        const EditorClass = this.editors[mode];
        if (!EditorClass) {
            logger.warn(`Unknown editor mode: ${mode}, falling back to HTML`);
            this.currentMode = EDITOR_MODES.HTML;
            this.currentEditor = new HtmlEditor();
        } else {
            this.currentMode = mode;
            this.currentEditor = new EditorClass();
        }

        await this.currentEditor.create(container, initialValue);
        return this.currentEditor;
    }

    /**
     * Gets the current editor.
     * @returns {BaseEditor|null} The current editor instance.
     */
    getCurrentEditor() {
        return this.currentEditor;
    }

    /**
     * Gets the current mode.
     * @returns {string} The current editor mode.
     */
    getCurrentMode() {
        return this.currentMode;
    }

    /**
     * Sets the current mode.
     * @param {string} mode - The new editor mode.
     */
    setCurrentMode(mode) {
        if (this.editors[mode]) {
            this.currentMode = mode;
        } else {
            logger.warn(`Invalid editor mode: ${mode}`);
        }
    }

    /**
     * Gets the current editor value.
     * @returns {string} The editor content.
     */
    getValue() {
        return this.currentEditor ? this.currentEditor.getValue() : '';
    }

    /**
     * Sets the editor value.
     * @param {string} value - The value to set.
     */
    setValue(value) {
        if (this.currentEditor) {
            this.currentEditor.setValue(value);
        }
    }

    /**
     * Focuses the editor.
     */
    focus() {
        if (this.currentEditor) {
            this.currentEditor.focus();
        }
    }

    /**
     * Destroys the current editor.
     */
    destroy() {
        if (this.currentEditor) {
            this.currentEditor.destroy();
            this.currentEditor = null;
        }
    }

    /**
     * Checks if an editor mode is supported.
     * @param {string} mode - The mode to check.
     * @returns {boolean} True if supported.
     */
    isModeSupported(mode) {
        return !!this.editors[mode];
    }

    /**
     * Gets all supported editor modes.
     * @returns {string[]} Array of supported modes.
     */
    getSupportedModes() {
        return Object.keys(this.editors);
    }
}