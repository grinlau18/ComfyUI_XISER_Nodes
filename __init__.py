"""Top-level package for xiser_nodes - V3 Architecture."""

__all__ = [
    "comfy_entrypoint",
    "WEB_DIRECTORY",
]

__author__ = """XISER"""
__email__ = "grinlau18@gmail.com"
__version__ = "1.3.7"

# V3 API imports
from comfy_api.v0_0_2 import ComfyExtension, io, ui

# Server imports for route registration
import json
import aiohttp.web
import traceback

# Try to import PromptServer, but don't fail if not in ComfyUI environment
try:
    from server import PromptServer
    HAS_PROMPT_SERVER = True
except ImportError:
    HAS_PROMPT_SERVER = False
    print("[XISER] 注意: 不在ComfyUI环境中，跳过路由注册")
from .server_extension import (
    list_psd_files,
    get_available_fonts,
    serve_font_file,
    cutout_image,
)  # 导入处理函数
from .src.xiser_nodes.key_store import KEY_STORE
from aiohttp import web


async def list_keys(request):
    data = KEY_STORE.list_profiles()
    return web.json_response({"profiles": list(data.keys())})


async def save_key(request):
    try:
        payload = await request.json()
        profile = payload.get("profile", "").strip()
        api_key = payload.get("api_key", "").strip()
        overwrite = bool(payload.get("overwrite", False))
        if not profile or not api_key:
            return web.json_response({"error": "profile and api_key are required"}, status=400)
        try:
            KEY_STORE.save_key(profile, api_key, overwrite=overwrite)
        except ValueError as exc:
            return web.json_response({"error": str(exc)}, status=400)
        return web.json_response({"ok": True})
    except Exception as exc:
        return web.json_response({"error": str(exc)}, status=500)


async def delete_key(request):
    profile = request.match_info.get("profile", "")
    if not profile:
        return web.json_response({"error": "profile is required"}, status=400)
    KEY_STORE.delete_key(profile)
    return web.json_response({"ok": True})


async def set_default_key(request):
    return web.json_response({"error": "default key not supported"}, status=400)

# 节点颜色存储 (保持向后兼容)
NODE_COLORS = {"title": {}, "content": {}}

async def handle_color_change(request):
    try:
        data = await request.json()
        print("[XISER] 收到颜色更改消息:", data)
        node_id = str(data.get("node_id"))  # 转换为字符串
        color = data.get("color")
        color_type = data.get("color_type")
        workflow = data.get("workflow")

        if not (node_id and color and color_type in ["title", "content"]):
            print("[XISER] 无效数据:", {"node_id": node_id, "color": color, "color_type": color_type})
            return aiohttp.web.json_response({"error": "Invalid data"}, status=400)

        # 存储颜色
        NODE_COLORS[color_type][node_id] = color

        # 更新工作流 JSON (V3架构中暂时禁用，等待节点迁移)
        updated_workflow = None
        if workflow and isinstance(workflow, dict) and "nodes" in workflow:
            try:
                # TODO: V3架构中需要重新实现颜色设置功能
                # 暂时跳过工作流更新
                print("[XISER V3] 工作流颜色更新功能暂时禁用 - 等待节点迁移")
                # if "XIS_ReorderImages" in NODE_CLASS_MAPPINGS:
                #     updated_workflow = NODE_CLASS_MAPPINGS["XIS_ReorderImages"].set_color(node_id, color, color_type, workflow)
                # else:
                #     print("[XISER] XIS_ReorderImages 未加载，跳过工作流更新")
            except Exception as e:
                print("[XISER] 更新工作流失败:", str(e))
                traceback.print_exc()

        response = {
            "type": "xiser_node_color_change_response",
            "node_id": node_id,
            "color": color,
            "color_type": color_type
        }
        if updated_workflow:
            response["workflow"] = updated_workflow
        print("[XISER] 发送响应:", response)
        return aiohttp.web.json_response(response)

    except json.JSONDecodeError as e:
        print("[XISER] JSON 解析错误:", str(e))
        return aiohttp.web.json_response({"error": "Invalid JSON"}, status=400)
    except Exception as e:
        print("[XISER] 颜色更改处理错误:", str(e))
        traceback.print_exc()
        return aiohttp.web.json_response({"error": f"Server error: {str(e)}"}, status=500)

# 注册路由
if HAS_PROMPT_SERVER:
    try:
        PromptServer.instance.app.router.add_post("/xiser_color", handle_color_change)
        PromptServer.instance.app.router.add_post("/xiser/cutout", cutout_image)
        PromptServer.instance.app.router.add_get("/custom/list_psd_files", list_psd_files)
        PromptServer.instance.app.router.add_get("/xiser/fonts", get_available_fonts)
        PromptServer.instance.app.router.add_get("/xiser/font-files/{filename}", serve_font_file)
        PromptServer.instance.app.router.add_get("/xiser/keys", list_keys)
        PromptServer.instance.app.router.add_post("/xiser/keys", save_key)
        PromptServer.instance.app.router.add_delete("/xiser/keys/{profile}", delete_key)
        # default key route retained for compatibility but returns 400
        PromptServer.instance.app.router.add_post("/xiser/keys/default", set_default_key)

        # Register XIS_ImageManager V3 API routes
        from .src.xiser_nodes.image_manager.api import register_routes
        register_routes()

        # print("[XISER] Successfully registered routes: /xiser_color, /xiser/cutout, /custom/list_psd_files, /xiser/fonts, /upload/xis_image_manager, /delete/xis_image_manager")  # 简化日志，不显示此信息
    except Exception as e:
        print("[XISER] Failed to register routes:", str(e))
else:
    print("[XISER] 跳过路由注册（不在ComfyUI环境中）")

# 注册 Web 扩展
WEB_DIRECTORY = "./web"

# ============================================================================
# V3 Extension Definition
# ============================================================================

class XISERExtension(ComfyExtension):
    """XISER Nodes V3 Extension"""

    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        """
        返回所有V3节点类的列表。
        """
        try:
            # 导入已迁移的V3节点
            from .src.xiser_nodes.list_processing_v3 import V3_NODE_CLASSES as LIST_PROCESSING_NODES
            from .src.xiser_nodes.dynamic_image_inputs_v3 import V3_NODE_CLASSES as DYNAMIC_IMAGE_NODES
            from .src.xiser_nodes.image_and_mask_v3 import V3_NODE_CLASSES as IMAGE_MASK_NODES
            from .src.xiser_nodes.resize_image_or_mask_v3 import V3_NODE_CLASSES as RESIZE_NODES
            from .src.xiser_nodes.canvas_mask_processor_v3 import V3_NODE_CLASSES as CANVAS_MASK_NODES
            from .src.xiser_nodes.logic_v3 import V3_NODE_CLASSES as LOGIC_NODES
            from .src.xiser_nodes.ui_control_v3 import V3_NODE_CLASSES as UI_CONTROL_NODES
            from .src.xiser_nodes.sampling_v3 import V3_NODE_CLASSES as SAMPLING_NODES
            # 第四批次节点
            from .src.xiser_nodes.data_processing_v3 import V3_NODE_CLASSES as DATA_PROCESSING_NODES
            from .src.xiser_nodes.dynamic_pack_images_v3 import V3_NODE_CLASSES as DYNAMIC_PACK_NODES
            from .src.xiser_nodes.coordinate_path_v3 import V3_NODE_CLASSES as COORDINATE_PATH_NODES
            # 第五批次节点 - canvas
            from .src.xiser_nodes.canvas_v3 import V3_NODE_CLASSES as CANVAS_NODES
            # 第五批次节点 - curve_editor 和 image_puzzle
            from .src.xiser_nodes.curve_editor_v3 import V3_NODE_CLASSES as CURVE_EDITOR_NODES
            from .src.xiser_nodes.image_puzzle_v3 import V3_NODE_CLASSES as IMAGE_PUZZLE_NODES

            # 第六批次节点 - 剩余简单节点
            from .src.xiser_nodes.shape_and_text_v3 import V3_NODE_CLASSES as SHAPE_AND_TEXT_NODES
            from .src.xiser_nodes.shape_data_v3 import V3_NODE_CLASSES as SHAPE_DATA_NODES
            from .src.xiser_nodes.adjust_image_v3 import V3_NODE_CLASSES as ADJUST_IMAGE_NODES
            from .src.xiser_nodes.psd_layer_extract_v3 import V3_NODE_CLASSES as PSD_LAYER_EXTRACT_NODES
            from .src.xiser_nodes.multi_point_gradient_v3 import V3_NODE_CLASSES as MULTI_POINT_GRADIENT_NODES
            from .src.xiser_nodes.set_color_v3 import V3_NODE_CLASSES as SET_COLOR_NODES
            from .src.xiser_nodes.label_v3 import V3_NODE_CLASSES as LABEL_NODES
            from .src.xiser_nodes.image_manager_v3 import V3_NODE_CLASSES as IMAGE_MANAGER_NODES
            # 新增节点 - image preview
            from .src.xiser_nodes.image_preview_v3 import V3_NODE_CLASSES as IMAGE_PREVIEW_NODES
            # 新增节点 - LLM
            from .src.xiser_nodes.llm_v3 import V3_NODE_CLASSES as LLM_NODES

            # 合并所有V3节点
            v3_nodes = []
            v3_nodes.extend(LIST_PROCESSING_NODES)
            v3_nodes.extend(DYNAMIC_IMAGE_NODES)
            v3_nodes.extend(IMAGE_MASK_NODES)
            v3_nodes.extend(RESIZE_NODES)
            v3_nodes.extend(CANVAS_MASK_NODES)
            v3_nodes.extend(LOGIC_NODES)
            v3_nodes.extend(UI_CONTROL_NODES)
            v3_nodes.extend(SAMPLING_NODES)
            v3_nodes.extend(DATA_PROCESSING_NODES)
            v3_nodes.extend(DYNAMIC_PACK_NODES)
            v3_nodes.extend(COORDINATE_PATH_NODES)
            v3_nodes.extend(CANVAS_NODES)
            v3_nodes.extend(CURVE_EDITOR_NODES)
            v3_nodes.extend(IMAGE_PUZZLE_NODES)
            v3_nodes.extend(SHAPE_AND_TEXT_NODES)
            v3_nodes.extend(SHAPE_DATA_NODES)
            v3_nodes.extend(ADJUST_IMAGE_NODES)
            v3_nodes.extend(PSD_LAYER_EXTRACT_NODES)
            v3_nodes.extend(MULTI_POINT_GRADIENT_NODES)
            v3_nodes.extend(SET_COLOR_NODES)
            v3_nodes.extend(LABEL_NODES)
            v3_nodes.extend(IMAGE_MANAGER_NODES)
            v3_nodes.extend(IMAGE_PREVIEW_NODES)
            v3_nodes.extend(LLM_NODES)

            # print(f"[XISER V3] 成功加载 {len(v3_nodes)} 个V3节点")  # 简化日志，不显示此信息
            print("[XISER V3] 成功全部节点")

            return v3_nodes

        except ImportError as e:
            print(f"[XISER V3] 导入V3节点失败: {e}")
            print("[XISER V3] 返回空节点列表")
            return []
        except Exception as e:
            print(f"[XISER V3] 加载V3节点时发生错误: {e}")
            import traceback
            traceback.print_exc()
            return []

async def comfy_entrypoint() -> XISERExtension:
    """
    ComfyUI V3 入口点函数。

    这个函数会被ComfyUI自动调用以获取扩展实例。
    可以声明为async或非async，但get_node_list必须是async。
    """
    return XISERExtension()
