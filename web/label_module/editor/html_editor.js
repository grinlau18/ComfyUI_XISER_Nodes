/**
 * HTML编辑器类
 */
import { BaseEditor } from './base_editor.js';
import { logger } from '../core/logger.js';

/**
 * HTML editor using CodeMirror with HTML mode.
 */
export class HtmlEditor extends BaseEditor {
    constructor(options = {}) {
        super(options);
    }

    /**
     * Creates the HTML editor.
     * @param {HTMLElement} container - The container element.
     * @param {string} initialValue - The initial editor value.
     * @returns {Promise<HTMLElement>} The editor element.
     */
    async create(container, initialValue) {
        if (this.isCodeMirrorAvailable()) {
            try {
                this.editor = window.CodeMirror(container, {
                    value: initialValue,
                    mode: "htmlmixed",
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
                logger.info("HTML CodeMirror editor created");
                return this.editor.getWrapperElement();
            } catch (e) {
                logger.error("Failed to create HTML CodeMirror editor:", e);
            }
        }

        // Fallback to textarea
        logger.warn("CodeMirror not available, falling back to textarea for HTML editor");
        this.editor = this.createFallbackTextarea(container, initialValue);
        return this.editor;
    }
}