#!/usr/bin/env python3
"""
测试修复后的透明度合成效果
"""

import numpy as np
from PIL import Image

def test_simple_alpha_composite():
    """测试简单的透明度合成"""
    print("=== 测试透明度合成修复效果 ===")

    # 创建白色背景
    bg = Image.new("RGBA", (512, 512), (255, 255, 255, 255))

    # 测试不同透明度的红色矩形
    test_cases = [
        {"name": "红色 100% 透明度", "color": (255, 0, 0, 255), "opacity": 1.0},
        {"name": "红色 75% 透明度", "color": (255, 0, 0, 255), "opacity": 0.75},
        {"name": "红色 50% 透明度", "color": (255, 0, 0, 255), "opacity": 0.5},
        {"name": "红色 25% 透明度", "color": (255, 0, 0, 255), "opacity": 0.25},
    ]

    for i, test_case in enumerate(test_cases):
        print(f"\n{test_case['name']}")

        # 创建前景图像（完全不透明）
        fg = Image.new("RGBA", (256, 256), test_case['color'])

        # 手动实现合成算法（模拟修复后的代码）
        # 转换为numpy数组
        bg_array = np.array(bg.crop((128, 128, 384, 384)), dtype=np.float32) / 255.0
        fg_array = np.array(fg, dtype=np.float32) / 255.0

        # 提取alpha通道
        bg_alpha = bg_array[..., 3:4]
        fg_alpha = fg_array[..., 3:4]

        # 应用透明度
        fg_alpha_adjusted = fg_alpha * test_case['opacity']

        # 计算合成后的alpha
        out_alpha = fg_alpha_adjusted + bg_alpha * (1.0 - fg_alpha_adjusted)
        out_alpha_clamped = np.where(out_alpha > 0, out_alpha, 1.0)

        # 预乘alpha合成
        bg_premult = bg_array[..., :3] * bg_alpha
        fg_premult = fg_array[..., :3] * fg_alpha_adjusted

        # 合成颜色
        out_rgb = (fg_premult + bg_premult * (1.0 - fg_alpha_adjusted)) / out_alpha_clamped

        # 组合结果
        out_array = np.concatenate([out_rgb, out_alpha], axis=-1)
        out_array = np.clip(out_array * 255.0, 0, 255).astype(np.uint8)

        # 创建结果图像
        result_region = Image.fromarray(out_array, mode="RGBA")
        result = bg.copy()
        result.paste(result_region, (128, 128))

        # 保存结果
        filename = f"test_opacity_{int(test_case['opacity']*100)}.png"
        result.save(filename)
        print(f"  结果保存到: {filename}")

        # 检查中心像素
        center_pixel = np.array(result)[256, 256]
        print(f"  中心像素 (RGBA): {center_pixel}")

        # 理论计算
        # 对于红色(255,0,0)在白色背景(255,255,255)上，透明度为opacity
        # 合成颜色 = 前景 * opacity + 背景 * (1 - opacity)
        expected_r = int(255 * test_case['opacity'] + 255 * (1 - test_case['opacity']))
        expected_g = int(0 * test_case['opacity'] + 255 * (1 - test_case['opacity']))
        expected_b = int(0 * test_case['opacity'] + 255 * (1 - test_case['opacity']))
        expected_a = 255
        print(f"  理论颜色 (RGB): ({expected_r}, {expected_g}, {expected_b})")

    # 测试多层叠加
    print("\n=== 测试多层透明度叠加 ===")

    # 创建新背景
    bg2 = Image.new("RGBA", (512, 512), (255, 255, 255, 255))

    # 第一层：蓝色 50% 透明度
    blue = Image.new("RGBA", (256, 256), (0, 0, 255, 255))
    # 手动合成蓝色层
    bg2_array = np.array(bg2.crop((128, 128, 384, 384)), dtype=np.float32) / 255.0
    blue_array = np.array(blue, dtype=np.float32) / 255.0
    blue_alpha = blue_array[..., 3:4] * 0.5  # 50%透明度
    bg_alpha = bg2_array[..., 3:4]

    out_alpha1 = blue_alpha + bg_alpha * (1.0 - blue_alpha)
    out_alpha_clamped1 = np.where(out_alpha1 > 0, out_alpha1, 1.0)
    bg_premult1 = bg2_array[..., :3] * bg_alpha
    blue_premult = blue_array[..., :3] * blue_alpha
    out_rgb1 = (blue_premult + bg_premult1 * (1.0 - blue_alpha)) / out_alpha_clamped1

    # 第二层：红色 50% 透明度（部分重叠）
    red = Image.new("RGBA", (256, 256), (255, 0, 0, 255))
    # 在合成后的背景上继续合成红色层
    intermediate_array = np.concatenate([out_rgb1, out_alpha1], axis=-1)

    red_array = np.array(red, dtype=np.float32) / 255.0
    red_alpha = red_array[..., 3:4] * 0.5  # 50%透明度

    out_alpha2 = red_alpha + out_alpha1 * (1.0 - red_alpha)
    out_alpha_clamped2 = np.where(out_alpha2 > 0, out_alpha2, 1.0)
    intermediate_premult = out_rgb1 * out_alpha1
    red_premult = red_array[..., :3] * red_alpha
    out_rgb2 = (red_premult + intermediate_premult * (1.0 - red_alpha)) / out_alpha_clamped2

    # 最终结果
    out_array2 = np.concatenate([out_rgb2, out_alpha2], axis=-1)
    out_array2 = np.clip(out_array2 * 255.0, 0, 255).astype(np.uint8)

    result2_region = Image.fromarray(out_array2, mode="RGBA")
    result2 = bg2.copy()
    result2.paste(result2_region, (128, 128))
    result2.save("test_multilayer_overlay.png")

    print("  多层叠加结果保存到: test_multilayer_overlay.png")

    # 检查叠加区域
    overlap_pixel = np.array(result2)[256, 256]
    print(f"  叠加区域中心像素 (RGBA): {overlap_pixel}")

    print("\n=== 测试完成 ===")
    print("请查看生成的PNG文件，检查透明度效果是否更'通透'")

if __name__ == "__main__":
    test_simple_alpha_composite()