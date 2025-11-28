"""
Image editor module for XIS_ImageManager node.
Provides core editing functionality including cropping, transformations, and canvas operations.
"""

from .core import ImageEditor
from .canvas import CanvasManager
from .operations import CropOperation, TransformOperation

__all__ = [
    "ImageEditor",
    "CanvasManager",
    "CropOperation",
    "TransformOperation"
]