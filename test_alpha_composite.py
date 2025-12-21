#!/usr/bin/env python3
"""
测试透明度合成算法
"""

import numpy as np
from PIL import Image

def alpha_composite_simple(background, foreground, x, y):
    """
    简化的预乘alpha合成算法
    """
    # 确保图像都是RGBA模式
    if background.mode != "RGBA":
        background = background.convert("RGBA")
    if foreground.mode != "RGBA":
        foreground = foreground.convert("RGBA")

    # 获取图像尺寸
    bg_width, bg_height = background.size
    fg_width, fg_height = foreground.size

    # 计算实际粘贴区域
    paste_x = max(0, x)
    paste_y = max(0, y)

    # 计算前景图像在背景中的可见区域
    fg_x1 = max(0, -x)
    fg_y1 = max(0, -y)
    fg_x2 = min(fg_width, bg_width - x)
    fg_y2 = min(fg_height, bg_height - y)

    # 如果没有可见区域，直接返回背景
    if fg_x1 >= fg_x2 or fg_y1 >= fg_y2:
        return background

    # 裁剪前景图像的可见部分
    fg_cropped = foreground.crop((fg_x1, fg_y1, fg_x2, fg_y2))

    # 获取背景对应区域
    bg_x1 = paste_x
    bg_y1 = paste_y
    bg_x2 = min(bg_width, paste_x + (fg_x2 - fg_x1))
    bg_y2 = min(bg_height, paste_y + (fg_y2 - fg_y1))

    bg_region = background.crop((bg_x1, bg_y1, bg_x2, bg_y2))

    # 转换为numpy数组进行高效计算
    bg_array = np.array(bg_region, dtype=np.float32) / 255.0
    fg_array = np.array(fg_cropped, dtype=np.float32) / 255.0

    # 提取alpha通道
    bg_alpha = bg_array[..., 3:4]
    fg_alpha = fg_array[..., 3:4]

    # 计算合成后的alpha
    out_alpha = fg_alpha + bg_alpha * (1.0 - fg_alpha)

    # 避免除以零
    out_alpha_clamped = np.where(out_alpha > 0, out_alpha, 1.0)

    # 预乘alpha合成公式
    bg_premult = bg_array[..., :3] * bg_alpha
    fg_premult = fg_array[..., :3] * fg_alpha

    # 合成颜色
    out_rgb = (fg_premult + bg_premult * (1.0 - fg_alpha)) / out_alpha_clamped

    # 组合结果
    out_array = np.concatenate([out_rgb, out_alpha], axis=-1)
    out_array = np.clip(out_array * 255.0, 0, 255).astype(np.uint8)

    # 创建合成后的区域图像
    out_region = Image.fromarray(out_array, mode="RGBA")

    # 将合成后的区域粘贴回背景
    result = background.copy()
    result.paste(out_region, (bg_x1, bg_y1))

    return result

def test_alpha_composition():
    """测试透明度合成算法"""
    print("=== 测试透明度合成算法 ===")

    # 创建测试图像
    # 1. 白色背景
    bg = Image.new("RGBA", (512, 512), (255, 255, 255, 255))

    # 2. 红色半透明矩形 (50%透明度)
    red = Image.new("RGBA", (256, 256), (255, 0, 0, 128))

    # 3. 绿色半透明矩形 (50%透明度)
    green = Image.new("RGBA", (256, 256), (0, 255, 0, 128))

    # 4. 蓝色不透明矩形
    blue = Image.new("RGBA", (256, 256), (0, 0, 255, 255))

    # 测试1: 红色和绿色叠加
    print("\n测试1: 红色(50%)和绿色(50%)叠加")

    # 先合成红色
    result = alpha_composite_simple(bg, red, 128, 128)

    # 再合成绿色（与红色部分重叠）
    result = alpha_composite_simple(result, green, 192, 192)

    # 保存结果
    result.save("test_red_green_overlay.png")
    print("  结果保存到: test_red_green_overlay.png")

    # 检查叠加区域的颜色
    center_x, center_y = 256, 256
    pixel = np.array(result)[center_y, center_x]
    print(f"  叠加区域中心像素 (RGBA): {pixel}")

    # 理论计算：红色(255,0,0,128) + 绿色(0,255,0,128) 在白色背景上
    # 红色贡献: (255,0,0) * 0.5 = (127.5, 0, 0)
    # 绿色贡献: (0,255,0) * 0.5 = (0, 127.5, 0)
    # 背景贡献: (255,255,255) * (1-0.5)*(1-0.5) = (255,255,255)*0.25 = (63.75,63.75,63.75)
    # 总alpha: 1 - (1-0.5)*(1-0.5) = 1 - 0.25 = 0.75
    # 最终颜色: (127.5+0+63.75, 0+127.5+63.75, 0+0+63.75) / 0.75 = (191.25, 191.25, 63.75) / 0.75 = (255, 255, 85)
    print("  理论预期颜色: 接近 (255, 255, 85, 191)")

    # 测试2: 不同透明度叠加
    print("\n测试2: 红色(25%)和绿色(75%)叠加")

    # 创建不同透明度的图像
    red_25 = Image.new("RGBA", (256, 256), (255, 0, 0, 64))   # 25%
    green_75 = Image.new("RGBA", (256, 256), (0, 255, 0, 192)) # 75%

    result2 = alpha_composite_simple(bg, red_25, 128, 128)
    result2 = alpha_composite_simple(result2, green_75, 192, 192)
    result2.save("test_red25_green75_overlay.png")
    print("  结果保存到: test_red25_green75_overlay.png")

    # 测试3: 与不透明蓝色叠加
    print("\n测试3: 半透明红色 + 不透明蓝色")

    result3 = alpha_composite_simple(bg, red, 128, 128)
    result3 = alpha_composite_simple(result3, blue, 160, 160)  # 部分重叠
    result3.save("test_red_blue_overlay.png")
    print("  结果保存到: test_red_blue_overlay.png")

    print("\n=== 测试完成 ===")
    print("请查看生成的PNG文件检查合成效果")

if __name__ == "__main__":
    test_alpha_composition()