"""Aggregate v3 node registrations - 逐步转向纯v3架构."""

import importlib
import inspect

# ==================== 新的加载策略 ====================
# 原则：已迁移的v3节点加载，未迁移节点暂时不加载，等待迁移

# 已迁移的 v3 模块
V3_MIGRATED_MODULES = [
    "logic",
    "ui_control",
    "list_processing",
    "data_processing",
    "label",
    "set_color",
    "image_and_mask",
    "canvas_mask_processor_v3",
    "canvas",
    "resize_image_or_mask",
    "sampling",
]

# 待迁移的 A 级模块（暂时不加载）
A_LEVEL_MODULES = [
    "psd_layer_extract",
    "adjust_image",
    "image_puzzle",
    "shape_data",
]

# 待迁移的 S 级模块（暂时不加载）
S_LEVEL_MODULES = [
    "curve_editor",
    "coordinate_path",
    "reorder_images",
    "shape_and_text",
    "multi_point_gradient",
    "llm.orchestrator",
    "image_manager.node",
]

# 当前只加载已迁移的v3模块
V3_MODULES = V3_MIGRATED_MODULES

# v3模式：不导出legacy映射
NODE_CLASS_MAPPINGS = None
NODE_DISPLAY_NAME_MAPPINGS = None


async def comfy_entrypoint():
    """v3 入口：只加载 V3_MODULES 列表中的已迁移模块。"""
    try:
        from comfy_api.latest import ComfyExtension  # type: ignore
    except Exception as exc:
        print(f"[XISER] comfy_api not available; skipping v3 entrypoints ({exc})")
        return None

    print("=" * 60)
    print("[XISER] 开始加载v3节点 - 新的后端迁移策略")
    print(f"[XISER] ✅ 已迁移模块 ({len(V3_MIGRATED_MODULES)}个): {', '.join(V3_MIGRATED_MODULES)}")
    print(f"[XISER] 🔄 A级待迁移模块 ({len(A_LEVEL_MODULES)}个): {', '.join(A_LEVEL_MODULES)}")
    print(f"[XISER] 🔄 S级待迁移模块 ({len(S_LEVEL_MODULES)}个): {', '.join(S_LEVEL_MODULES)}")
    print("=" * 60)

    sub_extensions = []
    loaded_modules = []
    loaded_nodes = 0

    for module_name in V3_MODULES:
        try:
            print(f"[XISER] 正在加载v3模块: {module_name}")
            module = importlib.import_module(f".{module_name}", package=__name__)
            entry = getattr(module, "comfy_entrypoint", None)
            if not entry:
                print(f"[XISER] 警告: 模块 {module_name} 没有comfy_entrypoint")
                continue

            # 获取扩展
            ext = entry()
            if inspect.isawaitable(ext):
                ext = await ext

            if ext:
                # 获取节点列表以统计数量
                if hasattr(ext, "get_node_list"):
                    nodes = await ext.get_node_list()
                    node_count = len(nodes) if isinstance(nodes, list) else 1
                    loaded_nodes += node_count
                    print(f"[XISER] ✅ 加载成功: {module_name} ({node_count}个节点)")
                else:
                    print(f"[XISER] ✅ 加载成功: {module_name}")

                sub_extensions.append(ext)
                loaded_modules.append(module_name)
            else:
                print(f"[XISER] 警告: 模块 {module_name} entrypoint返回None")
        except Exception as exc:
            print(f"[XISER] ❌ 加载失败 {module_name}: {exc}")

    if not sub_extensions:
        print("[XISER] 警告: 没有加载任何v3模块")
        return None

    class CombinedExtension(ComfyExtension):  # type: ignore[misc]
        async def on_load(self):
            for ext in sub_extensions:
                if hasattr(ext, "on_load"):
                    await ext.on_load()

        async def get_node_list(self):
            nodes = []
            for ext in sub_extensions:
                ext_nodes = await ext.get_node_list()
                if isinstance(ext_nodes, list):
                    nodes.extend(ext_nodes)
                else:
                    nodes.append(ext_nodes)
            return nodes

    print("=" * 60)
    print(f"[XISER] ✅ v3节点加载完成")
    print(f"[XISER] 加载模块: {', '.join(loaded_modules)}")
    print(f"[XISER] 总节点数: {loaded_nodes}个")
    print("=" * 60)

    return CombinedExtension()
