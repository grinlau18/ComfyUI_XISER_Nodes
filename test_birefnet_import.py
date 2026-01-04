#!/usr/bin/env python3
"""
测试BiRefNet模块导入
"""

import os
import sys

# 设置路径
BASE_DIR = os.path.dirname(__file__)
BIRENET_SRC_ROOT = os.path.join(BASE_DIR, "src", "xiser_nodes")
BIRENET_REPO_DIR = os.path.join(BIRENET_SRC_ROOT, "birefnet_repo")

print(f"BASE_DIR: {BASE_DIR}")
print(f"BIRENET_SRC_ROOT: {BIRENET_SRC_ROOT}")
print(f"BIRENET_REPO_DIR: {BIRENET_REPO_DIR}")

# 添加路径到sys.path
if BIRENET_SRC_ROOT not in sys.path:
    sys.path.insert(0, BIRENET_SRC_ROOT)
if BIRENET_REPO_DIR not in sys.path:
    sys.path.insert(0, BIRENET_REPO_DIR)

print(f"sys.path: {sys.path}")

# 尝试导入
try:
    print("尝试导入BiRefNet...")
    from birefnet_repo.models.birefnet import BiRefNet
    print("✓ BiRefNet导入成功")

    print("尝试导入check_state_dict...")
    from birefnet_repo.utils import check_state_dict
    print("✓ check_state_dict导入成功")

    print("\n所有导入成功！")

except ImportError as exc:
    print(f"✗ 导入失败: {exc}")
    print(f"错误类型: {type(exc).__name__}")

    # 检查模块是否存在
    print("\n检查模块文件是否存在:")
    birefnet_path = os.path.join(BIRENET_REPO_DIR, "models", "birefnet.py")
    utils_path = os.path.join(BIRENET_REPO_DIR, "utils.py")
    print(f"birefnet.py: {os.path.exists(birefnet_path)} - {birefnet_path}")
    print(f"utils.py: {os.path.exists(utils_path)} - {utils_path}")

    # 检查文件内容
    if os.path.exists(birefnet_path):
        with open(birefnet_path, 'r') as f:
            first_line = f.readline().strip()
        print(f"birefnet.py第一行: {first_line}")

    if os.path.exists(utils_path):
        with open(utils_path, 'r') as f:
            content = f.read()
        if 'check_state_dict' in content:
            print("✓ utils.py中包含check_state_dict函数")
        else:
            print("✗ utils.py中不包含check_state_dict函数")