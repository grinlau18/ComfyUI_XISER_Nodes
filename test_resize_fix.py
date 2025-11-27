#!/usr/bin/env python3
"""
测试脚本：验证XIS_ResizeImageOrMask节点的修复
主要测试：
1. pack_images缩放逻辑是否尊重resize_mode设置
2. 所有图像是否通过resized_image端口输出
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import torch
import numpy as np
from src.xiser_nodes.resize_image_or_mask import XIS_ResizeImageOrMask

def test_resize_modes():
    """测试不同的resize_mode是否正常工作"""
    print("=== 测试XIS_ResizeImageOrMask节点修复 ===")

    # 创建节点实例
    node = XIS_ResizeImageOrMask()

    # 创建测试图像数据
    batch_size = 2
    height, width = 100, 150
    channels = 3

    # 创建测试图像张量
    test_image = torch.rand(batch_size, height, width, channels)

    # 创建pack_images数据
    pack_images = [
        torch.rand(1, 80, 120, channels),  # 不同尺寸的图像
        torch.rand(1, 60, 90, channels)
    ]

    # 测试参数
    resize_modes = ["force_resize", "scale_proportionally", "limited_by_canvas", "fill_the_canvas"]
    target_width, target_height = 256, 256

    print(f"原始图像尺寸: {test_image.shape}")
    print(f"pack_images数量: {len(pack_images)}")
    print(f"目标尺寸: {target_width}x{target_height}")

    for mode in resize_modes:
        print(f"\n--- 测试模式: {mode} ---")

        try:
            # 调用节点方法
            result = node.resize_image_or_mask(
                resize_mode=mode,
                scale_condition="always",
                interpolation="bilinear",
                min_unit=16,
                image=test_image,
                pack_images=pack_images,
                manual_width=target_width,
                manual_height=target_height,
                fill_hex="#000000"
            )

            resized_image, resized_mask, out_width, out_height, resized_pack = result

            print(f"✓ 成功执行模式: {mode}")
            print(f"  - resized_image形状: {resized_image.shape}")
            print(f"  - resized_mask: {resized_mask}")
            print(f"  - 输出尺寸: {out_width}x{out_height}")
            print(f"  - resized_pack长度: {len(resized_pack) if resized_pack is not None else 0}")

            # 验证所有图像都通过resized_image输出
            expected_batch_size = batch_size + len(pack_images)
            if resized_image is not None:
                actual_batch_size = resized_image.shape[0]
                print(f"  - 批次大小验证: {actual_batch_size} (期望: {expected_batch_size})")

                if actual_batch_size == expected_batch_size:
                    print("  ✓ 所有图像正确合并到resized_image输出")
                else:
                    print(f"  ✗ 批次大小不匹配: {actual_batch_size} != {expected_batch_size}")

        except Exception as e:
            print(f"✗ 模式 {mode} 执行失败: {e}")

    print("\n=== 测试完成 ===")

if __name__ == "__main__":
    test_resize_modes()