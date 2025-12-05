"""Top-level package for xiser_nodes."""

__all__ = [
    "WEB_DIRECTORY",
    "comfy_entrypoint",
]

__author__ = """XISER"""
__email__ = "grinlau18@gmail.com"
__version__ = "1.3.3"

from server import PromptServer
import json
import aiohttp.web
import traceback
from .server_extension import (
    list_psd_files,
    get_available_fonts,
    serve_font_file,
    cutout_image,
)  # 导入处理函数

# 安全导入KEY_STORE，避免触发节点映射导入
try:
    from .src.xiser_nodes.key_store import KEY_STORE
except ImportError as e:
    print(f"[XISER] 警告: 无法导入KEY_STORE: {e}")
    # 创建虚拟的KEY_STORE以避免错误
    class DummyKeyStore:
        def list_profiles(self):
            return {}
        def save_key(self, profile, api_key, overwrite=False):
            pass
        def delete_key(self, profile):
            pass
    KEY_STORE = DummyKeyStore()

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

# 导入v3节点注册
try:
    from .src.xiser_nodes import comfy_entrypoint as _comfy_entrypoint
    comfy_entrypoint = _comfy_entrypoint
    # v3模式：不导出legacy映射
    NODE_CLASS_MAPPINGS = None
    NODE_DISPLAY_NAME_MAPPINGS = None
except Exception as exc:
    print(f"[XISER] Failed to import v3 node registrations: {exc}")
    NODE_CLASS_MAPPINGS = None
    NODE_DISPLAY_NAME_MAPPINGS = None

    async def comfy_entrypoint():
        return None

# 节点颜色存储
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

        # 更新工作流 JSON
        updated_workflow = None
        if workflow and isinstance(workflow, dict) and "nodes" in workflow:
            try:
                # 由于NODE_CLASS_MAPPINGS现在是None（为了启用V3节点），我们无法直接访问
                # 这里跳过工作流更新，或者可以尝试动态导入
                print("[XISER] V3模式：跳过工作流颜色更新（需要重新实现）")
                # 如果需要此功能，可以在这里动态导入XIS_ReorderImages类
                # from .src.xiser_nodes.reorder_images import XIS_ReorderImages
                # updated_workflow = XIS_ReorderImages.set_color(node_id, color, color_type, workflow)
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

    # Register XIS_ImageManager routes
    from .src.xiser_nodes.image_manager.api import register_routes
    register_routes()

    print("[XISER] Successfully registered routes: /xiser_color, /xiser/cutout, /custom/list_psd_files, /xiser/fonts, XIS_ImageManager endpoints")
except Exception as e:
    print("[XISER] Failed to register routes:", str(e))

# 注册 Web 扩展
WEB_DIRECTORY = "./web"
