/**
 * Markdown编辑器类
 */
import { BaseEditor } from './base_editor.js';
import { logger } from '../core/logger.js';

/**
 * Markdown editor using CodeMirror with Markdown mode.
 */
export class MarkdownEditor extends BaseEditor {
    constructor(options = {}) {
        super(options);
    }

    /**
     * Creates the Markdown editor.
     * @param {HTMLElement} container - The container element.
     * @param {string} initialValue - The initial editor value.
     * @returns {Promise<HTMLElement>} The editor element.
     */
    async create(container, initialValue) {
        if (this.isCodeMirrorAvailable()) {
            try {
                // Try to create markdown editor - CodeMirror will handle mode loading
                this.editor = window.CodeMirror(container, {
                    value: initialValue,
                    mode: "markdown",
                    lineNumbers: true,
                    theme: "dracula",
                    lineWrapping: true,
                    extraKeys: {
                        "Ctrl-S": () => {
                            // Save handler will be attached externally
                            return false;
                        },
                        "Enter": (cm) => cm.replaceSelection("\n") // Single newline on Enter
                    }
                });
                this.isCodeMirror = true;
                logger.info("Markdown CodeMirror editor created");
                return this.editor.getWrapperElement();
            } catch (e) {
                logger.error("Failed to create Markdown CodeMirror editor:", e);
                // Fallback to textarea if CodeMirror fails
                logger.warn("Falling back to textarea for Markdown editor");
                this.editor = this.createFallbackTextarea(container, initialValue);
                return this.editor;
            }
        }

        // Fallback to textarea if CodeMirror not available
        logger.warn("CodeMirror not available, falling back to textarea for Markdown editor");
        this.editor = this.createFallbackTextarea(container, initialValue);
        return this.editor;
    }
}