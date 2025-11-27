"""
Core image editor functionality for XIS_ImageManager.
Handles image loading, editing operations, and result generation.
"""

import base64
import numpy as np
from PIL import Image
from io import BytesIO
from typing import Dict, Any, Optional, Tuple
from .canvas import CanvasManager
from .operations import CropOperation


class ImageEditor:
    """Main image editor class that coordinates editing operations."""

    def __init__(self):
        self.canvas = CanvasManager()
        self.crop_operation = CropOperation()
        self.current_image: Optional[Image.Image] = None
        self.original_size: Optional[Tuple[int, int]] = None

    def load_image_from_base64(self, base64_data: str) -> Dict[str, Any]:
        """Load image from base64 data."""
        try:
            # Handle data URL format
            if "base64," in base64_data:
                base64_data = base64_data.split("base64,", 1)[1]

            image_bytes = base64.b64decode(base64_data)
            self.current_image = Image.open(BytesIO(image_bytes)).convert("RGBA")
            self.original_size = self.current_image.size

            return {
                "success": True,
                "width": self.current_image.width,
                "height": self.current_image.height,
                "image": self.current_image
            }
        except Exception as e:
            return {
                "success": False,
                "error": f"Failed to load image: {str(e)}"
            }

    def load_image_from_pil(self, pil_image: Image.Image) -> Dict[str, Any]:
        """Load image from PIL Image object."""
        try:
            self.current_image = pil_image.convert("RGBA")
            self.original_size = self.current_image.size

            return {
                "success": True,
                "width": self.current_image.width,
                "height": self.current_image.height,
                "image": self.current_image
            }
        except Exception as e:
            return {
                "success": False,
                "error": f"Failed to load image: {str(e)}"
            }

    def crop_image(self, crop_region: Dict[str, float]) -> Dict[str, Any]:
        """Crop the current image using the specified region."""
        if not self.current_image:
            return {
                "success": False,
                "error": "No image loaded"
            }

        try:
            # Convert crop region to integers
            x = int(crop_region.get('x', 0))
            y = int(crop_region.get('y', 0))
            width = int(crop_region.get('width', self.current_image.width))
            height = int(crop_region.get('height', self.current_image.height))

            # Validate crop region
            if width <= 0 or height <= 0:
                return {
                    "success": False,
                    "error": "Invalid crop dimensions"
                }

            # Ensure crop region is within image bounds
            x = max(0, min(x, self.current_image.width - 1))
            y = max(0, min(y, self.current_image.height - 1))
            width = min(width, self.current_image.width - x)
            height = min(height, self.current_image.height - y)

            # Perform crop
            cropped_image = self.current_image.crop((x, y, x + width, y + height))

            return {
                "success": True,
                "image": cropped_image,
                "width": cropped_image.width,
                "height": cropped_image.height,
                "crop_region": {
                    "x": x,
                    "y": y,
                    "width": width,
                    "height": height
                }
            }

        except Exception as e:
            return {
                "success": False,
                "error": f"Failed to crop image: {str(e)}"
            }

    def get_image_as_base64(self, image: Optional[Image.Image] = None) -> str:
        """Convert image to base64 data URL."""
        target_image = image or self.current_image
        if not target_image:
            return ""

        buffered = BytesIO()
        target_image.save(buffered, format="PNG")
        img_str = base64.b64encode(buffered.getvalue()).decode("utf-8")
        return f"data:image/png;base64,{img_str}"

    def generate_thumbnail(self, image: Image.Image, max_size: int = 64) -> str:
        """Generate a thumbnail as base64 string."""
        try:
            img_width, img_height = image.size
            scale = min(max_size / img_width, max_size / img_height, 1.0)
            new_size = (int(img_width * scale), int(img_height * scale))
            thumbnail = image.resize(new_size, Image.Resampling.LANCZOS)

            buffered = BytesIO()
            thumbnail.save(buffered, format="PNG")
            base64_str = base64.b64encode(buffered.getvalue()).decode("utf-8")
            return base64_str
        except Exception as e:
            raise ValueError(f"Thumbnail generation failed: {str(e)}")

    def reset(self):
        """Reset the editor state."""
        self.current_image = None
        self.original_size = None
        self.canvas.reset()