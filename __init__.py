"""Top-level package for xiser_nodes."""

__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "WEB_DIRECTORY",
]

__author__ = """XISER"""
__email__ = "grinlau18@gmail.com"
__version__ = "1.1.0"

from server import PromptServer
import json
import aiohttp.web
from .server_extension import list_psd_files  # 导入处理函数

# 导入节点映射
from .src.xiser_nodes import NODE_CLASS_MAPPINGS
try:
    from .src.xiser_nodes import NODE_DISPLAY_NAME_MAPPINGS
except ImportError:
    NODE_DISPLAY_NAME_MAPPINGS = {}

# 节点颜色存储
NODE_COLORS = {"title": {}, "content": {}}

async def handle_color_change(request):
    try:
        data = await request.json()
        print("[XISER] 收到颜色更改消息:", data)
        node_id = data.get("node_id")
        color = data.get("color")
        color_type = data.get("color_type")
        workflow = data.get("workflow")
        if node_id and color and color_type in ["title", "content"]:
            NODE_COLORS[color_type][node_id] = color
            # 更新工作流 JSON
            if workflow and "nodes" in workflow and "XIS_ReorderImages" in NODE_CLASS_MAPPINGS:
                updated_workflow = NODE_CLASS_MAPPINGS["XIS_ReorderImages"].set_color(node_id, color, color_type, workflow)
                if updated_workflow:
                    response = {
                        "type": "xiser_node_color_change_response",
                        "node_id": node_id,
                        "color": color,
                        "color_type": color_type,
                        "workflow": updated_workflow
                    }
                    print("[XISER] 发送响应:", response)
                    return aiohttp.web.json_response(response)
            response = {
                "type": "xiser_node_color_change_response",
                "node_id": node_id,
                "color": color,
                "color_type": color_type
            }
            print("[XISER] 发送响应:", response)
            return aiohttp.web.json_response(response)
        print("[XISER] 无效数据，跳过")
        return aiohttp.web.json_response({"error": "Invalid data"}, status=400)
    except json.JSONDecodeError as e:
        print("[XISER] JSON 解析错误:", str(e))
        return aiohttp.web.json_response({"error": "Invalid JSON"}, status=400)
    except Exception as e:
        print("[XISER] 颜色更改处理错误:", str(e))
        return aiohttp.web.json_response({"error": "Server error"}, status=500)

# 注册路由
try:
    PromptServer.instance.app.router.add_post("/xiser_color", handle_color_change)
    PromptServer.instance.app.router.add_get("/custom/list_psd_files", list_psd_files)
    print("[XISER] Successfully registered routes: /xiser_color, /custom/list_psd_files")
except Exception as e:
    print("[XISER] Failed to register routes:", str(e))

# 注册 Web 扩展
WEB_DIRECTORY = "./web"