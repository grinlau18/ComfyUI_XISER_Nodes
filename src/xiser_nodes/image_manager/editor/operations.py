"""
Image editing operations for XIS_ImageManager.
Contains operations like cropping, rotation, scaling, etc.
"""

from typing import Dict, Any
from PIL import Image


class CropOperation:
    """Handles image cropping operations."""

    def __init__(self):
        self.min_size = 4  # Minimum crop size in pixels

    def validate_crop_region(self, crop_region: Dict[str, float],
                           image_width: int, image_height: int) -> Dict[str, Any]:
        """Validate crop region against image dimensions."""
        x = int(crop_region.get('x', 0))
        y = int(crop_region.get('y', 0))
        width = int(crop_region.get('width', image_width))
        height = int(crop_region.get('height', image_height))

        # Check minimum size
        if width < self.min_size or height < self.min_size:
            return {
                "valid": False,
                "error": f"Crop region too small. Minimum size is {self.min_size}x{self.min_size} pixels"
            }

        # Check bounds
        if x < 0 or y < 0 or x >= image_width or y >= image_height:
            return {
                "valid": False,
                "error": "Crop region outside image bounds"
            }

        if x + width > image_width or y + height > image_height:
            return {
                "valid": False,
                "error": "Crop region exceeds image bounds"
            }

        return {
            "valid": True,
            "crop_region": {
                "x": x,
                "y": y,
                "width": width,
                "height": height
            }
        }

    def apply_crop(self, image: Image.Image, crop_region: Dict[str, int]) -> Image.Image:
        """Apply crop operation to image."""
        x = crop_region['x']
        y = crop_region['y']
        width = crop_region['width']
        height = crop_region['height']

        return image.crop((x, y, x + width, y + height))


class TransformOperation:
    """Handles image transformation operations."""

    def rotate(self, image: Image.Image, angle: float) -> Image.Image:
        """Rotate image by specified angle."""
        return image.rotate(-angle, expand=True, resample=Image.Resampling.BICUBIC)

    def scale(self, image: Image.Image, scale_factor: float) -> Image.Image:
        """Scale image by specified factor."""
        if scale_factor <= 0:
            raise ValueError("Scale factor must be positive")

        new_width = int(image.width * scale_factor)
        new_height = int(image.height * scale_factor)

        return image.resize((new_width, new_height), Image.Resampling.LANCZOS)

    def resize(self, image: Image.Image, width: int, height: int) -> Image.Image:
        """Resize image to specified dimensions."""
        if width <= 0 or height <= 0:
            raise ValueError("Width and height must be positive")

        return image.resize((width, height), Image.Resampling.LANCZOS)