# extensions.py
"""
Server-side extension to handle cache clearing for XIS_Test node
"""
from server import PromptServer

class XIS_Test_Extension:
    @staticmethod
    def add_routes():
        @PromptServer.instance.routes.post("/xis_clear_cache")
        async def clear_cache(request):
            data = await request.json()
            node_id = data.get("node_id")
            # Find node instance and clear its cache
            for node in PromptServer.instance.graph.nodes.values():
                if node.id == node_id and hasattr(node, "clear_cache"):
                    node.clear_cache()
            return {"success": True}

PromptServer.instance.add_extension(XIS_Test_Extension)