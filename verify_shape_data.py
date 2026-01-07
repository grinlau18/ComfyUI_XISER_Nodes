#!/usr/bin/env python3
"""
验证Shape Data节点修改后的定义
"""

import sys
import os

# 添加当前目录
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

def verify_shape_data():
    """验证Shape Data节点定义"""
    print("=== 验证Shape Data节点定义 ===")

    try:
        # 导入comfy_api
        import comfy_api.v0_0_2 as api

        # 导入Shape Data节点
        from src.xiser_nodes.shape_data_v3 import XIS_ShapeDataV3

        # 获取节点架构
        schema = XIS_ShapeDataV3.define_schema()

        print(f"✓ 成功加载节点: {schema.node_id} ({schema.display_name})")
        print(f"类别: {schema.category}")
        print(f"描述: {schema.description}")

        # 检查输入端口
        print("\n=== 输入端口 ===")
        for input_def in schema.inputs:
            input_type = type(input_def).__name__
            input_name = getattr(input_def, 'name', 'unknown')
            optional = getattr(input_def, 'optional', False)
            tooltip = getattr(input_def, 'tooltip', '')

            print(f"  - {input_name}: {input_type} (可选: {optional})")
            if tooltip:
                print(f"    提示: {tooltip}")

        # 检查输出端口
        print("\n=== 输出端口 ===")
        for output_def in schema.outputs:
            output_type = type(output_def).__name__
            display_name = getattr(output_def, 'display_name', 'unknown')
            is_output_list = getattr(output_def, 'is_output_list', False)

            print(f"  - {display_name}: {output_type} (列表输出: {is_output_list})")

        # 特别检查颜色相关端口
        print("\n=== 颜色相关端口 ===")
        color_ports = ['shape_color', 'bg_color', 'stroke_color']
        for port_name in color_ports:
            for input_def in schema.inputs:
                if getattr(input_def, 'name', '') == port_name:
                    input_type = type(input_def).__name__
                    print(f"  - {port_name}: {input_type}")
                    break

        print("\n✓ 验证完成")
        return True

    except ImportError as e:
        print(f"✗ 导入失败: {e}")
        return False
    except Exception as e:
        print(f"✗ 验证失败: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = verify_shape_data()
    sys.exit(0 if success else 1)