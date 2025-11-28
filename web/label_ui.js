/**
 * XIS_Label 节点 UI 模块
 * 重构版本 - 使用模块化架构
 */

// 导入模块化组件
import './label_module/index.js';

// 保持向后兼容性 - 导出主要组件
import { parserManager, editorManager, textRenderer, styleManager, EDITOR_MODES } from './label_module/index.js';

export {
    parserManager,
    editorManager,
    textRenderer,
    styleManager,
    EDITOR_MODES
};