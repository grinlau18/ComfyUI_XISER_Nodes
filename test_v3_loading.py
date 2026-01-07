#!/usr/bin/env python3
"""
测试V3节点加载
"""

import sys
import os

# 添加ComfyUI路径
comfy_path = "/Users/grin/Documents/comfy/ComfyUI"
if comfy_path not in sys.path:
    sys.path.insert(0, comfy_path)

# 添加当前目录
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

def test_v3_loading():
    """测试V3节点加载"""
    print("=== 测试V3节点加载 ===")

    try:
        # 模拟ComfyUI环境
        import comfy_api.v0_0_2 as api

        # 导入Extension
        from __init__ import XISERExtension

        # 创建Extension实例
        extension = XISERExtension()

        # 测试get_node_list方法
        import asyncio

        async def test_async():
            try:
                nodes = await extension.get_node_list()
                print(f"✓ 成功加载 {len(nodes)} 个V3节点")

                # 按类别统计
                categories = {}
                for node_cls in nodes:
                    try:
                        schema = node_cls.define_schema()
                        category = schema.category
                        node_id = schema.node_id
                        display_name = schema.display_name

                        if category not in categories:
                            categories[category] = []
                        categories[category].append(f"{node_id} ({display_name})")
                    except Exception as e:
                        print(f"✗ 获取节点 {node_cls.__name__} 架构失败: {e}")

                # 显示按类别分组的节点
                print("\n=== 按类别分组的节点 ===")
                for category, node_list in sorted(categories.items()):
                    print(f"\n[{category}] ({len(node_list)}个节点)")
                    for node_info in sorted(node_list):
                        print(f"  - {node_info}")

                # 检查第六批次节点
                sixth_batch_nodes = [
                    "XIS_ShapeAndText",
                    "XIS_ShapeData",
                    "XIS_ImageAdjustAndBlend",
                    "XIS_ReorderImages",
                    "XIS_PSDLayerExtractor",
                    "XIS_MultiPointGradient",
                    "XIS_SetColor",
                    "XIS_Label"
                ]

                print("\n=== 检查第六批次节点 ===")
                loaded_node_ids = []
                for node_cls in nodes:
                    try:
                        schema = node_cls.define_schema()
                        loaded_node_ids.append(schema.node_id)
                    except:
                        pass

                for node_id in sixth_batch_nodes:
                    if node_id in loaded_node_ids:
                        print(f"✓ {node_id} 已加载")
                    else:
                        print(f"✗ {node_id} 未加载")

                return True

            except Exception as e:
                print(f"✗ 加载节点失败: {e}")
                import traceback
                traceback.print_exc()
                return False

        # 运行异步测试
        result = asyncio.run(test_async())
        return result

    except ImportError as e:
        print(f"✗ 导入失败: {e}")
        print("请确保在ComfyUI环境中运行此测试")
        return False
    except Exception as e:
        print(f"✗ 测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = test_v3_loading()
    sys.exit(0 if success else 1)