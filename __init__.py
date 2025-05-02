"""Top-level package for xiser_nodes."""

__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "WEB_DIRECTORY",
]

__author__ = """XISER"""
__email__ = "grinlau18@gmail.com"
__version__ = "1.0.10"

from .src.xiser_nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

# 注册 Web 扩展
WEB_DIRECTORY = "./web"

    