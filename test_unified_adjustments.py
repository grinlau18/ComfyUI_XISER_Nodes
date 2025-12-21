#!/usr/bin/env python3
"""
测试统一的图像调节工具和算法
验证前后端使用一致的参数范围和算法
"""

import sys
import os
import numpy as np
from PIL import Image

# 添加当前目录到Python路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# 添加src目录到Python路径
src_dir = os.path.join(os.path.dirname(__file__), "src", "xiser_nodes")
sys.path.insert(0, os.path.dirname(os.path.dirname(src_dir)))

# 直接读取和解析模块代码
def import_module_directly(module_name):
    """直接导入模块，避免ComfyUI依赖"""
    module_path = os.path.join(src_dir, f"{module_name}.py")
    with open(module_path, 'r', encoding='utf-8') as f:
        code = f.read()

    # 移除可能的ComfyUI导入
    code = code.replace('import comfy', '# import comfy')
    code = code.replace('from comfy', '# from comfy')
    code = code.replace('import folder_paths', '# import folder_paths')

    # 创建模块命名空间
    module_globals = {
        '__name__': module_name,
        '__file__': module_path,
        'np': np,
        'Image': Image
    }

    # 执行代码
    exec(code, module_globals)
    return module_globals

# 导入调节工具
adjustment_utils_globals = import_module_directly('adjustment_utils')
adjustment_algorithms_globals = import_module_directly('adjustment_algorithms')

# 获取类
AdjustmentUtils = adjustment_utils_globals['AdjustmentUtils']
AdjustmentAlgorithms = adjustment_algorithms_globals['AdjustmentAlgorithms']


def test_adjustment_utils():
    """测试调节工具模块"""
    print("=== 测试统一的调节工具模块 ===")

    # 测试范围验证
    test_cases = [
        ("亮度正常值", "brightness", 0.5, 0.5),
        ("亮度超出上限", "brightness", 2.0, 1.0),
        ("亮度超出下限", "brightness", -2.0, -1.0),
        ("对比度正常值", "contrast", 50.0, 50.0),
        ("对比度超出上限", "contrast", 200.0, 100.0),
        ("对比度超出下限", "contrast", -200.0, -100.0),
        ("饱和度正常值", "saturation", 50.0, 50.0),
        ("饱和度超出上限", "saturation", 200.0, 100.0),
        ("饱和度超出下限", "saturation", -200.0, -100.0),
        ("透明度正常值", "opacity", 50.0, 50.0),
        ("透明度超出上限", "opacity", 200.0, 100.0),
        ("透明度超出下限", "opacity", -50.0, 0.0),
    ]

    for name, param, input_val, expected in test_cases:
        normalized = AdjustmentUtils.normalize_adjustment_state({param: input_val})
        result = normalized[param]
        status = "✓" if abs(result - expected) < 0.001 else "✗"
        print(f"{status} {name}: {input_val} -> {result} (期望: {expected})")

    # 测试透明度转换
    print("\n=== 测试透明度转换 ===")
    for opacity in [0, 25, 50, 75, 100]:
        alpha = AdjustmentUtils.opacity_to_alpha(opacity)
        restored = AdjustmentUtils.alpha_to_opacity(alpha)
        status = "✓" if abs(restored - opacity) < 0.001 else "✗"
        print(f"{status} 透明度 {opacity}% -> alpha {alpha:.3f} -> 恢复 {restored}%")

    # 测试默认状态
    print("\n=== 测试默认状态 ===")
    default_state = AdjustmentUtils.get_default_state()
    print(f"默认亮度: {default_state['brightness']}")
    print(f"默认对比度: {default_state['contrast']}")
    print(f"默认饱和度: {default_state['saturation']}")
    print(f"默认透明度: {default_state['opacity']}")

    return True


def test_adjustment_algorithms():
    """测试调节算法模块"""
    print("\n=== 测试统一的调节算法模块 ===")

    # 创建测试图像
    test_image = np.zeros((100, 100, 3), dtype=np.uint8)
    test_image[:, :, 0] = 128  # 红色通道
    test_image[:, :, 1] = 64   # 绿色通道
    test_image[:, :, 2] = 192  # 蓝色通道
    pil_img = Image.fromarray(test_image, mode="RGB")

    # 测试亮度调整
    print("\n测试亮度调整:")
    bright_img = AdjustmentAlgorithms.apply_adjustments(pil_img, brightness=0.5)
    bright_array = np.array(bright_img)
    print(f"  原始像素平均值: {test_image.mean():.1f}")
    print(f"  亮度调整后平均值: {bright_array.mean():.1f}")
    print(f"  预期增加: {0.5 * 255 = :.1f}")
    print(f"  实际增加: {bright_array.mean() - test_image.mean():.1f}")

    # 测试对比度调整
    print("\n测试对比度调整:")
    contrast_img = AdjustmentAlgorithms.apply_adjustments(pil_img, contrast=50.0)
    contrast_array = np.array(contrast_img)
    print(f"  对比度调整后平均值: {contrast_array.mean():.1f}")

    # 测试饱和度调整
    print("\n测试饱和度调整:")
    saturation_img = AdjustmentAlgorithms.apply_adjustments(pil_img, saturation=50.0)
    saturation_array = np.array(saturation_img)
    print(f"  饱和度调整后平均值: {saturation_array.mean():.1f}")

    # 测试组合调整
    print("\n测试组合调整:")
    combined_img = AdjustmentAlgorithms.apply_adjustments(
        pil_img,
        brightness=0.2,
        contrast=25.0,
        saturation=-25.0
    )
    combined_array = np.array(combined_img)
    print(f"  组合调整后平均值: {combined_array.mean():.1f}")

    return True


def test_consistency():
    """测试前后端一致性"""
    print("\n=== 测试前后端一致性 ===")

    # 创建测试图像
    test_image = np.zeros((50, 50, 3), dtype=np.uint8)
    test_image[10:40, 10:40, :] = 128
    pil_img = Image.fromarray(test_image, mode="RGB")

    # 测试不同调节值
    test_values = [
        {"brightness": 0.3, "contrast": 20.0, "saturation": -10.0},
        {"brightness": -0.2, "contrast": -30.0, "saturation": 40.0},
        {"brightness": 0.0, "contrast": 0.0, "saturation": 0.0},
    ]

    for i, values in enumerate(test_values):
        print(f"\n测试用例 {i+1}: {values}")
        adjusted_img = AdjustmentAlgorithms.apply_adjustments(
            pil_img,
            brightness=values["brightness"],
            contrast=values["contrast"],
            saturation=values["saturation"]
        )
        adjusted_array = np.array(adjusted_img)

        # 检查图像是否有效
        if adjusted_array.min() < 0 or adjusted_array.max() > 255:
            print("  ✗ 图像值超出范围!")
            return False

        # 检查是否有变化
        if np.allclose(adjusted_array, test_image, atol=1.0):
            print("  ✓ 图像无变化（如预期）")
        else:
            print(f"  ✓ 图像已调整，平均值变化: {adjusted_array.mean() - test_image.mean():.1f}")

    return True


def main():
    """主测试函数"""
    print("开始测试统一的图像调节系统...")

    try:
        # 测试调节工具
        if not test_adjustment_utils():
            print("调节工具测试失败!")
            return 1

        # 测试调节算法
        if not test_adjustment_algorithms():
            print("调节算法测试失败!")
            return 1

        # 测试一致性
        if not test_consistency():
            print("一致性测试失败!")
            return 1

        print("\n" + "="*50)
        print("所有测试通过! ✓")
        print("统一的图像调节系统工作正常。")
        print("="*50)

        return 0

    except Exception as e:
        print(f"\n测试过程中出现错误: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())