"""
Canvas management for image editing operations.
Handles coordinate transformations, scaling, and canvas state.
"""

from typing import Dict, Any, Optional, Tuple


class CanvasManager:
    """Manages canvas state and coordinate transformations for image editing."""

    def __init__(self):
        self.scale = 1.0
        self.offset_x = 0
        self.offset_y = 0
        self.canvas_width = 0
        self.canvas_height = 0
        self.image_width = 0
        self.image_height = 0

    def setup_canvas(self, image_width: int, image_height: int,
                    max_width: int, max_height: int) -> Dict[str, Any]:
        """Setup canvas with appropriate scaling for the image."""
        self.image_width = image_width
        self.image_height = image_height

        # Calculate scale to fit within max dimensions
        scale_x = max_width / image_width
        scale_y = max_height / image_height
        self.scale = min(scale_x, scale_y, 1.0)  # Don't scale up

        self.canvas_width = int(image_width * self.scale)
        self.canvas_height = int(image_height * self.scale)

        return {
            "scale": self.scale,
            "canvas_width": self.canvas_width,
            "canvas_height": self.canvas_height
        }

    def screen_to_image_coords(self, screen_x: float, screen_y: float) -> Tuple[float, float]:
        """Convert screen coordinates to image coordinates."""
        if self.scale == 0:
            return 0, 0

        image_x = (screen_x - self.offset_x) / self.scale
        image_y = (screen_y - self.offset_y) / self.scale

        return image_x, image_y

    def image_to_screen_coords(self, image_x: float, image_y: float) -> Tuple[float, float]:
        """Convert image coordinates to screen coordinates."""
        screen_x = image_x * self.scale + self.offset_x
        screen_y = image_y * self.scale + self.offset_y

        return screen_x, screen_y

    def validate_crop_region(self, crop_region: Dict[str, float]) -> Dict[str, float]:
        """Validate and clamp crop region to image bounds."""
        x = max(0, min(crop_region.get('x', 0), self.image_width - 1))
        y = max(0, min(crop_region.get('y', 0), self.image_height - 1))

        width = crop_region.get('width', self.image_width)
        height = crop_region.get('height', self.image_height)

        # Ensure crop region stays within image bounds
        width = min(width, self.image_width - x)
        height = min(height, self.image_height - y)

        # Ensure minimum size
        width = max(1, width)
        height = max(1, height)

        return {
            'x': x,
            'y': y,
            'width': width,
            'height': height
        }

    def get_crop_region_screen(self, crop_region: Dict[str, float]) -> Dict[str, float]:
        """Convert crop region from image coordinates to screen coordinates."""
        x, y = self.image_to_screen_coords(crop_region['x'], crop_region['y'])
        width = crop_region['width'] * self.scale
        height = crop_region['height'] * self.scale

        return {
            'x': x,
            'y': y,
            'width': width,
            'height': height
        }

    def reset(self):
        """Reset canvas state."""
        self.scale = 1.0
        self.offset_x = 0
        self.offset_y = 0
        self.canvas_width = 0
        self.canvas_height = 0
        self.image_width = 0
        self.image_height = 0