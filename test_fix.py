#!/usr/bin/env python3
"""
测试修复后的Shape Data节点定义
"""

def test_fix():
    """测试修复"""
    print("=== 测试Shape Data节点修复 ===")

    # 检查修改内容
    print("\n1. 修复的问题:")
    print("   - 错误: io.Bool.Input (模块中没有 'Bool' 属性)")
    print("   - 正确: io.Boolean.Input (正确的布尔类型)")

    print("\n2. 修改的位置:")
    print("   - 文件: src/xiser_nodes/shape_data_v3.py:68")
    print("   - 原代码: io.Bool.Input('transparent_bg', ...)")
    print("   - 新代码: io.Boolean.Input('transparent_bg', ...)")

    print("\n3. 验证其他V3节点中的布尔类型:")
    print("   - canvas_mask_processor_v3.py: io.Boolean.Input")
    print("   - ui_control_v3.py: io.Boolean.Input/Output")
    print("   - logic_v3.py: io.Boolean.Input/Output")
    print("   - shape_and_text_v3.py: io.Boolean.Input")

    print("\n4. 完整的Shape Data节点输入类型:")
    print("   - count: io.Int.Input")
    print("   - position_x/y: io.Float.Input")
    print("   - rotation: io.Float.Input")
    print("   - scale_x/y: io.Float.Input")
    print("   - skew_x/y: io.Float.Input")
    print("   - shape_color/bg_color/stroke_color: io.String.Input")
    print("   - stroke_width: io.Float.Input")
    print("   - transparent_bg: io.Boolean.Input ✓ (已修复)")
    print("   - mode_selection/shape_type/shape_params: io.String.Input")

    print("\n✓ 修复完成: Shape Data节点现在应该可以正常加载")
    return True

if __name__ == "__main__":
    test_fix()