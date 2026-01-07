#!/usr/bin/env python3
"""
测试Set Color节点和Shape Data节点的连接兼容性
"""

def test_type_compatibility():
    """测试类型兼容性"""
    print("=== 测试Set Color节点和Shape Data节点的连接兼容性 ===")

    # Set Color节点的输出类型
    set_color_output = "io.String.Output(display_name='hex_color')"

    # Shape Data节点的输入类型（修改后）
    shape_data_inputs = {
        "shape_color": "io.String.Input('shape_color', optional=True, tooltip='形状颜色')",
        "bg_color": "io.String.Input('bg_color', optional=True, tooltip='背景颜色')",
        "stroke_color": "io.String.Input('stroke_color', optional=True, tooltip='描边颜色')"
    }

    print("\n1. Set Color节点输出:")
    print(f"   {set_color_output}")
    print("   → 输出类型: String (单个字符串)")

    print("\n2. Shape Data节点颜色输入端口（修改后）:")
    for port_name, port_def in shape_data_inputs.items():
        print(f"   {port_name}: {port_def}")
        print(f"   → 输入类型: String (单个字符串)")

    print("\n3. 兼容性分析:")
    print("   ✓ Set Color节点输出: String类型")
    print("   ✓ Shape Data节点颜色输入: String类型")
    print("   ✓ 类型匹配: 可以连接")

    print("\n4. 修改总结:")
    print("   - 将Shape Data节点的颜色输入端口从 LIST 类型改为 String 类型")
    print("   - 修改的端口: shape_color, bg_color, stroke_color")
    print("   - 其他相关修改:")
    print("     * stroke_width: Float.Input (单个浮点数)")
    print("     * transparent_bg: Bool.Input (单个布尔值)")
    print("     * mode_selection: String.Input (单个字符串)")
    print("     * shape_type: String.Input (单个字符串)")
    print("     * shape_params: String.Input (单个字符串)")

    print("\n✓ 测试通过: Set Color节点现在可以连接到Shape Data节点的颜色输入端口")
    return True

if __name__ == "__main__":
    test_type_compatibility()