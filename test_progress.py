#!/usr/bin/env python3
"""测试LLM Orchestrator节点的进度展示功能"""

import sys
import os

# 添加路径以便导入模块
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from src.xiser_nodes.llm_v3 import XIS_LLMOrchestratorV3
from comfy_api.v0_0_2 import io
import torch

def test_progress_integration():
    """测试进度集成"""
    print("测试LLM Orchestrator节点进度展示功能...")

    # 创建虚拟输入
    dummy_image = torch.zeros((1, 3, 512, 512), dtype=torch.float32)

    # 测试节点架构
    schema = XIS_LLMOrchestratorV3.define_schema()
    print(f"节点ID: {schema.node_id}")
    print(f"显示名称: {schema.display_name}")
    print(f"类别: {schema.category}")
    print(f"输入参数数量: {len(schema.inputs)}")
    print(f"输出参数数量: {len(schema.outputs)}")

    # 检查进度API是否可用
    try:
        from comfy_execution.utils import get_executing_context
        print("✓ 进度API模块导入成功")
    except ImportError as e:
        print(f"✗ 进度API模块导入失败: {e}")
        return False

    # 检查API实例
    try:
        from comfy_api.v0_0_2 import ComfyAPISync
        api_sync = ComfyAPISync()
        print("✓ ComfyAPI实例创建成功")
    except Exception as e:
        print(f"✗ ComfyAPI实例创建失败: {e}")
        return False

    print("\n进度展示功能集成测试完成！")
    print("下一步：在ComfyUI中实际运行节点以查看进度条效果")
    return True

if __name__ == "__main__":
    success = test_progress_integration()
    sys.exit(0 if success else 1)