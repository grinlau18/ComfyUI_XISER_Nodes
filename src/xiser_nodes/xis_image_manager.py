"""
Compatibility shim for XIS_ImageManager node.
Actual implementation lives in src/xiser_nodes/image_manager/node.py
"""

from .image_manager.node import XIS_ImageManager, NODE_CLASS_MAPPINGS  # noqa: F401
