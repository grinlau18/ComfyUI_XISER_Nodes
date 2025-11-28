#!/usr/bin/env python3
"""
更新JavaScript文件中的导入路径
"""

import os
import re

# 导入路径更新映射
IMPORT_UPDATE_MAP = {
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
    "./xis_shape_utils": "./shape_utils",
    "./xis_shape_creator": "./shape_creator",
    "./xis_state_manager": "./state_manager",
    "./xis_button_manager": "./button_manager",
    "./xis_grid_system": "./grid_system",
    "./xis_control_manager": "./control_manager",
    "./xis_help_overlay": "./help_overlay",
}

def update_imports_in_file(file_path):
    """更新文件中的导入路径"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        original_content = content

        # 替换所有导入路径
        for old_path, new_path in IMPORT_UPDATE_MAP.items():
            # 处理 import from 语句
            content = re.sub(
                rf'from\s+["\']{re.escape(old_path)}\.js["\']',
                f'from "{new_path}.js"',
                content
            )
            # 处理 import 语句
            content = re.sub(
                rf'import\s+.*from\s+["\']{re.escape(old_path)}\.js["\']',
                lambda m: m.group(0).replace(old_path, new_path),
                content
            )
            # 处理 require 语句
            content = re.sub(
                rf'require\s*\(\s*["\']{re.escape(old_path)}\.js["\']\s*\)',
                f'require("{new_path}.js")',
                content
            )

        if content != original_content:
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(content)
            print(f"✓ 已更新: {file_path}")
            return True

        return False

    except Exception as e:
        print(f"✗ 更新失败: {file_path} - {e}")
        return False

def main():
    """主函数"""
    web_dir = "web"
    updated_count = 0

    # 遍历web目录下的所有JavaScript文件
    for root, dirs, files in os.walk(web_dir):
        for file in files:
            if file.endswith('.js'):
                file_path = os.path.join(root, file)
                if update_imports_in_file(file_path):
                    updated_count += 1

    print(f"\n总计更新了 {updated_count} 个文件")

if __name__ == "__main__":
    main()