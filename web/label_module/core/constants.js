/**
 * 标签节点常量定义
 */

export const LOG_LEVELS = {
    ERROR: 0,
    WARN: 1,
    INFO: 2,
    DEBUG: 3
};

export const EDITOR_MODES = {
    HTML: 'html',
    MARKDOWN: 'markdown'
};

const DEFAULT_HTML_TEXT =
    '<div style="font-size: 32px; font-weight: bold;">小贴纸</div>' +
    '<div style="font-size: 24px; font-weight: normal;">使用鼠标左键双击打开编辑器</div>' +
    '<div style="font-size: 20px; font-weight: normal; color: #B0C4FF;">Double-click with the left mouse button to open the editor</div>';
const DEFAULT_MARKDOWN_TEXT =
    '# 小贴纸\n\n' +
    '使用鼠标左键双击打开编辑器\n\n' +
    '## Double-click with the left mouse button to open the editor';

export const DEFAULT_TEXT_DATA = {
    html: DEFAULT_HTML_TEXT,
    markdown: DEFAULT_MARKDOWN_TEXT,
    HTML: DEFAULT_HTML_TEXT,
    MARKDOWN: DEFAULT_MARKDOWN_TEXT
};

export const DEFAULT_COLOR = '#333355';

export const DEFAULT_LINE_DATA = {
    text: "小贴纸",
    font_size: 24,
    color: "#FFFFFF",
    font_weight: "bold",
    font_style: "normal",
    text_decoration: "none",
    text_align: "left",
    margin_left: 0,
    margin_top: 0,
    margin_bottom: 0
};

export const CODEMIRROR_RESOURCES = {
    SCRIPT: "/extensions/ComfyUI_XISER_Nodes/lib/external/codemirror/codemirror.js",
    CSS: "/extensions/ComfyUI_XISER_Nodes/lib/external/codemirror/codemirror.css",
    THEME: "/extensions/ComfyUI_XISER_Nodes/lib/external/codemirror/theme/dracula.css",
    HTML_MODE: "/extensions/ComfyUI_XISER_Nodes/lib/codemirror/htmlmixed.js",
    MARKDOWN_MODE: "/extensions/ComfyUI_XISER_Nodes/lib/codemirror/markdown.js"
};

export const CODEMIRROR_FALLBACKS = {
    SCRIPT: "https://cdn.jsdelivr.net/npm/codemirror@5.65.13/lib/codemirror.min.js",
    CSS: "https://cdn.jsdelivr.net/npm/codemirror@5.65.13/lib/codemirror.min.css",
    THEME: "https://cdn.jsdelivr.net/npm/codemirror@5.65.13/theme/dracula.min.css",
    HTML_MODE: "https://cdn.jsdelivr.net/npm/codemirror@5.65.13/mode/htmlmixed/htmlmixed.min.js",
    MARKDOWN_MODE: "https://cdn.jsdelivr.net/npm/codemirror@5.65.13/mode/markdown/markdown.min.js"
};

export const MARKED_SCRIPT = "/extensions/ComfyUI_XISER_Nodes/lib/codemirror/marked.min.js";
export const MARKED_FALLBACK = "https://cdn.jsdelivr.net/npm/marked@5.1.1/marked.min.js";

export const DEFAULT_NODE_SIZE = [360, 180];

export const BLOCK_TAGS = [
    "P",
    "DIV",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "LI",
    "BLOCKQUOTE",
    "UL",
    "OL",
    "PRE"
];
export const ALLOWED_TAGS = [
    "P",
    "DIV",
    "SPAN",
    "BR",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "BLOCKQUOTE",
    "UL",
    "OL",
    "LI",
    "STRONG",
    "EM",
    "B",
    "I",
    "A",
    "CODE",
    "PRE"
];
