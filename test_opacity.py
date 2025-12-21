#!/usr/bin/env python3
"""
测试XISER_Canvas节点的透明度合成效果
"""

import numpy as np
from PIL import Image
import torch
import sys
import os
import json

# 模拟ComfyUI的folder_paths模块
class MockFolderPaths:
    @staticmethod
    def get_output_directory():
        return "/tmp/comfyui_test_output"

# 模拟folder_paths模块
sys.modules['folder_paths'] = MockFolderPaths()

# 添加当前目录到Python路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# 直接导入canvas模块，避免ComfyUI依赖
canvas_module_path = os.path.join(os.path.dirname(__file__), "src/xiser_nodes/canvas.py")
with open(canvas_module_path, 'r', encoding='utf-8') as f:
    canvas_code = f.read()

# 移除ComfyUI特定的导入
canvas_code = canvas_code.replace('import folder_paths', '# import folder_paths')
canvas_code = canvas_code.replace('from PIL import Image', 'from PIL import Image\nimport folder_paths')

# 执行代码
exec(canvas_code, globals())

# 现在可以使用XISER_Canvas类

def create_test_images():
    """创建测试图像"""
    # 创建红色半透明图像
    red_img = np.zeros((256, 256, 4), dtype=np.uint8)
    red_img[:, :, 0] = 255  # R
    red_img[:, :, 3] = 128  # Alpha = 50%

    # 创建绿色半透明图像
    green_img = np.zeros((256, 256, 4), dtype=np.uint8)
    green_img[:, :, 1] = 255  # G
    green_img[:, :, 3] = 128  # Alpha = 50%

    # 创建蓝色不透明图像
    blue_img = np.zeros((256, 256, 4), dtype=np.uint8)
    blue_img[:, :, 2] = 255  # B
    blue_img[:, :, 3] = 255  # Alpha = 100%

    return [
        torch.from_numpy(red_img.astype(np.float32) / 255.0),
        torch.from_numpy(green_img.astype(np.float32) / 255.0),
        torch.from_numpy(blue_img.astype(np.float32) / 255.0)
    ]

def test_opacity_composition():
    """测试透明度合成"""
    print("=== 测试XISER_Canvas透明度合成效果 ===")

    # 创建Canvas实例
    canvas = XISER_Canvas()

    # 创建测试图像
    test_images = create_test_images()

    # 测试不同的透明度设置
    test_cases = [
        {
            "name": "测试1: 红色50% + 绿色50% 叠加",
            "opacities": [50, 50, 100],  # 红50%, 绿50%, 蓝100%
            "positions": [(128, 128), (192, 192), (64, 64)]  # 不同位置
        },
        {
            "name": "测试2: 红色25% + 绿色75% 叠加",
            "opacities": [25, 75, 100],
            "positions": [(128, 128), (192, 192), (64, 64)]
        },
        {
            "name": "测试3: 所有图层100%透明度",
            "opacities": [100, 100, 100],
            "positions": [(128, 128), (192, 192), (64, 64)]
        }
    ]

    for i, test_case in enumerate(test_cases):
        print(f"\n{test_case['name']}")

        # 创建图像状态
        image_states = []
        for j in range(3):
            state = {
                "x": test_case['positions'][j][0] + 120,  # 加上border_width
                "y": test_case['positions'][j][1] + 120,  # 加上border_width
                "scaleX": 1.0,
                "scaleY": 1.0,
                "rotation": 0.0,
                "opacity": test_case['opacities'][j],
                "visible": True,
                "order": j,
                "filename": f"test_{j}.png"
            }
            image_states.append(state)

        # 渲染
        try:
            result = canvas.render(
                pack_images=test_images,
                board_width=512,
                board_height=512,
                border_width=120,
                canvas_color="white",
                display_scale=0.5,
                auto_size="off",
                image_states=image_states,
                file_data=None,
                canvas_config=None,
                layer_data=None
            )

            # 获取输出图像
            canvas_tensor = result["result"][0]
            canvas_img = (canvas_tensor[0].numpy() * 255).astype(np.uint8)

            # 保存测试结果
            output_path = f"test_opacity_case_{i+1}.png"
            Image.fromarray(canvas_img, mode="RGBA").save(output_path)
            print(f"  测试结果已保存到: {output_path}")

            # 检查合成效果
            # 在红色和绿色叠加区域检查颜色值
            center_x, center_y = 256, 256  # 画布中心
            pixel = canvas_img[center_y, center_x]
            print(f"  叠加区域中心像素值 (RGBA): {pixel}")

        except Exception as e:
            print(f"  测试失败: {e}")
            import traceback
            traceback.print_exc()

    # 清理
    canvas.cleanup()
    print("\n=== 测试完成 ===")

if __name__ == "__main__":
    test_opacity_composition()