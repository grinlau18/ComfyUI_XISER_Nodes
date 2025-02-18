"""Top-level package for xiser_nodes."""

__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "WEB_DIRECTORY",
]

__author__ = """XISER"""
__email__ = "grinlau18@gmail.com"
__version__ = "0.0.1"

from .src.xiser_nodes.nodes import NODE_CLASS_MAPPINGS
from .src.xiser_nodes.nodes import NODE_DISPLAY_NAME_MAPPINGS

WEB_DIRECTORY = "./web"
