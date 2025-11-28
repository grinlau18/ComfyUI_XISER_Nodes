#!/usr/bin/env python3
"""
文件重命名映射表
按照规则：
1. 所有文件统一使用小写字母命名
2. 删除"XIS_"或"xis_"前缀
3. 连续大写字母组合使用"_"拆分
"""

# Python后端文件重命名映射
PYTHON_RENAME_MAP = {
    # 需要重命名的Python文件
    "XIS_SetColor.py": "set_color.py",
    "XIS_CoordinatePath.py": "coordinate_path.py",
    "XIS_MultiPointGradient.py": "multi_point_gradient.py",
    "XIS_ShapeData.py": "shape_data.py",
    "XIS_CurveEditor.py": "curve_editor.py",
    "XIS_ShapeAndText.py": "shape_and_text.py",
    "xis_reorder_images.py": "reorder_images.py",
    "xis_adjust_image.py": "adjust_image.py",
    "xis_image_manager.py": "image_manager_node.py",
    "image_stitcher.py": "image_stitcher.py",  # 这个已经符合规则
    "image_and_mask.py": "image_and_mask.py",  # 这个已经符合规则
    "canvas_mask_processor.py": "canvas_mask_processor.py",  # 这个已经符合规则
    "data_processing.py": "data_processing.py",  # 这个已经符合规则
    "list_processing.py": "list_processing.py",  # 这个已经符合规则
    "logic.py": "logic.py",  # 这个已经符合规则
    "ui_control.py": "ui_control.py",  # 这个已经符合规则
    "sampling.py": "sampling.py",  # 这个已经符合规则
    "canvas.py": "canvas.py",  # 这个已经符合规则
    "psd_layer_extract.py": "psd_layer_extract.py",  # 这个已经符合规则
    "resize_image_or_mask.py": "resize_image_or_mask.py",  # 这个已经符合规则
    "label.py": "label.py",  # 这个已经符合规则
    "key_store.py": "key_store.py",  # 这个已经符合规则
}

# JavaScript前端文件重命名映射
JS_RENAME_MAP = {
    # 需要重命名的JavaScript文件
    "XIS_SetColor.js": "set_color.js",
    "XIS_CoordinatePath.js": "coordinate_path.js",
    "XIS_MultiPointGradient.js": "multi_point_gradient.js",
    "XIS_MultiPointGradient_canvas.js": "multi_point_gradient_canvas.js",
    "XIS_CurveEditor.js": "curve_editor.js",
    "XIS_CurveEditor_canvas.js": "curve_editor_canvas.js",
    "xis_reorder_images.js": "reorder_images.js",
    "xis_adjust_image.js": "adjust_image.js",
    "xis_label_ui.js": "label_ui.js",
    "xis_canvas_mask_processor.js": "canvas_mask_processor.js",
    "xis_image_manager.js": "image_manager.js",
    "xis_image_manager_ui.js": "image_manager_ui.js",
    "xis_image_manager_utils.js": "image_manager_utils.js",
    "xis_shapeandtext_konva.js": "shape_and_text_konva.js",

    # 形状生成器相关文件
    "xis_state_manager.js": "state_manager.js",
    "xis_grid_system.js": "grid_system.js",
    "xis_control_manager.js": "control_manager.js",
    "xis_button_manager.js": "button_manager.js",
    "xis_help_overlay.js": "help_overlay.js",
    "xis_shape_creator.js": "shape_creator.js",
    "xis_shape_utils.js": "shape_utils.js",

    # LLM相关文件
    "LLM_KeyManager.js": "llm_key_manager.js",
    "LLM_NodeUI.js": "llm_node_ui.js",
}

# 需要更新的导入路径映射
IMPORT_UPDATE_MAP = {
    # Python导入更新
    "xiser_nodes.XIS_SetColor": "xiser_nodes.set_color",
    "xiser_nodes.XIS_CoordinatePath": "xiser_nodes.coordinate_path",
    "xiser_nodes.XIS_MultiPointGradient": "xiser_nodes.multi_point_gradient",
    "xiser_nodes.XIS_ShapeData": "xiser_nodes.shape_data",
    "xiser_nodes.XIS_CurveEditor": "xiser_nodes.curve_editor",
    "xiser_nodes.XIS_ShapeAndText": "xiser_nodes.shape_and_text",
    "xiser_nodes.xis_reorder_images": "xiser_nodes.reorder_images",
    "xiser_nodes.xis_adjust_image": "xiser_nodes.adjust_image",
    "xiser_nodes.xis_image_manager": "xiser_nodes.image_manager_node",

    # JavaScript导入更新
    "./XIS_SetColor": "./set_color",
    "./XIS_CoordinatePath": "./coordinate_path",
    "./XIS_MultiPointGradient": "./multi_point_gradient",
    "./XIS_MultiPointGradient_canvas": "./multi_point_gradient_canvas",
    "./XIS_CurveEditor": "./curve_editor",
    "./XIS_CurveEditor_canvas": "./curve_editor_canvas",
    "./xis_reorder_images": "./reorder_images",
    "./xis_adjust_image": "./adjust_image",
    "./xis_label_ui": "./label_ui",
    "./xis_canvas_mask_processor": "./canvas_mask_processor",
    "./xis_image_manager": "./image_manager",
    "./xis_image_manager_ui": "./image_manager_ui",
    "./xis_image_manager_utils": "./image_manager_utils",
    "./xis_shapeandtext_konva": "./shape_and_text_konva",
    "./LLM_KeyManager": "./llm_key_manager",
    "./LLM_NodeUI": "./llm_node_ui",
}

def print_rename_plan():
    """打印重命名计划"""
    print("=== Python文件重命名计划 ===")
    for old_name, new_name in PYTHON_RENAME_MAP.items():
        print(f"  {old_name} -> {new_name}")

    print("\n=== JavaScript文件重命名计划 ===")
    for old_name, new_name in JS_RENAME_MAP.items():
        print(f"  {old_name} -> {new_name}")

    print(f"\n总计需要重命名: {len(PYTHON_RENAME_MAP)} 个Python文件, {len(JS_RENAME_MAP)} 个JavaScript文件")

if __name__ == "__main__":
    print_rename_plan()