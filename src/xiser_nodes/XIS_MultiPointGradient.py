"""
XIS_MultiPointGradient.py

Custom node for ComfyUI to generate gradient images based on control points.
Supports multiple interpolation methods, including linear mode with fixed head and tail points.
"""

import torch
import numpy as np
from typing import List, Dict, Any

class XIS_MultiPointGradient:
    """
    A custom node for generating gradient images based on control points.
    """

    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Any]:
        """
        Defines the input types for the node.

        Returns:
            Dict[str, Any]: Input types configuration.
        """
        return {
            "required": {
                "width": ("INT", {"default": 512, "min": 1, "max": 4096, "step": 1}),
                "height": ("INT", {"default": 512, "min": 1, "max": 4096, "step": 1}),
                "interpolation": (
                    "COMBO",
                    {
                        "default": "idw",
                        "options": ["idw", "radial", "voronoi", "idw(soft)", "linear"]
                    }
                ),
                "gradient_canvas": ("WIDGET", {}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "execute"
    CATEGORY = "XISER_Nodes/ImageAndMask"

    def hex_to_rgb(self, hex_color: str) -> List[int]:
        """
        Convert hex color to RGB.

        Args:
            hex_color (str): Hex color string (e.g., "#ff0000").

        Returns:
            List[int]: RGB values [r, g, b].
        """
        hex_color = hex_color.lstrip("#")
        if not len(hex_color) == 6 or not all(c in "0123456789abcdefABCDEF" for c in hex_color):
            print(f"Invalid hex color {hex_color}, using white")
            return [255, 255, 255]
        try:
            return [int(hex_color[i : i + 2], 16) for i in (0, 2, 4)]
        except Exception as e:
            print(f"Error parsing hex color {hex_color}: {e}")
            return [255, 255, 255]

    def project_point_to_line(self, x: float, y: float, x1: float, y1: float, x2: float, y2: float) -> Dict[str, float]:
        """
        Project a point onto a line defined by (x1, y1) and (x2, y2).

        Args:
            x (float): X coordinate of the point.
            y (float): Y coordinate of the point.
            x1 (float): X coordinate of the line start.
            y1 (float): Y coordinate of the line start.
            x2 (float): X coordinate of the line end.
            y2 (float): Y coordinate of the line end.

        Returns:
            Dict[str, float]: Projected point coordinates {'x': x, 'y': y, 't': t}.
        """
        dx = x2 - x1
        dy = y2 - y1
        len_squared = dx * dx + dy * dy
        if len_squared < 1e-6:  # Prevent division by zero
            return {"x": x1, "y": y1, "t": 0.0}
        t = max(0, min(1, ((x - x1) * dx + (y - y1) * dy) / len_squared))
        return {
            "x": x1 + t * dx,
            "y": y1 + t * dy,
            "t": t
        }

    def execute(self, width: int, height: int, interpolation: str, gradient_canvas: Dict[str, Any]) -> tuple:
        """
        Execute the gradient generation.

        Args:
            width (int): Output image width.
            height (int): Output image height.
            interpolation (str): Interpolation method ("idw", "radial", "voronoi", "idw(soft)", "linear").
            gradient_canvas (Dict[str, Any]): Canvas data containing control points.

        Returns:
            tuple: (torch.Tensor) Output image tensor.
        """
        control_points = gradient_canvas.get("control_points", [])
        if not control_points or len(control_points) < 1:
            control_points = [
                {"x": 0.2, "y": 0.2, "color": "#ff0000", "influence": 1.0},
                {"x": 0.8, "y": 0.8, "color": "#0000ff", "influence": 1.0}
            ]

        # Ensure at least two points for linear mode
        if interpolation == "linear" and len(control_points) < 2:
            control_points = [
                {"x": 0.2, "y": 0.2, "color": "#ff0000", "influence": 1.0},
                {"x": 0.8, "y": 0.8, "color": "#0000ff", "influence": 1.0}
            ]

        # Initialize image array
        image = np.zeros((height, width, 3), dtype=np.float32)

        if interpolation == "idw":
            weights_cache = np.zeros((height, width), dtype=np.float32)
            colors_cache = np.zeros((height, width, 3), dtype=np.float32)
            for y in range(height):
                for x in range(width):
                    nx, ny = x / width, y / height
                    total_weight = 0
                    color = np.zeros(3, dtype=np.float32)
                    for point in control_points:
                        px, py = point["x"], point["y"]
                        influence = point.get("influence", 1.0)
                        distance = np.sqrt((nx - px) ** 2 + (ny - py) ** 2) / influence + 1e-6
                        weight = 1 / (distance ** 2)
                        total_weight += weight
                        rgb = np.array(self.hex_to_rgb(point["color"]), dtype=np.float32)
                        color += rgb * weight
                    idx = (y, x)
                    weights_cache[idx] = total_weight
                    colors_cache[idx] = color
            for y in range(height):
                for x in range(width):
                    total_weight = weights_cache[y, x]
                    if total_weight > 0:
                        image[y, x] = colors_cache[y, x] / total_weight

        elif interpolation == "radial":
            distances = np.zeros((height, width, len(control_points)), dtype=np.float32)
            for i, point in enumerate(control_points):
                px, py = point["x"] * width, point["y"] * height
                influence = point.get("influence", 1.0)
                for y in range(height):
                    for x in range(width):
                        distances[y, x, i] = np.sqrt((x - px) ** 2 + (y - py) ** 2) / influence
            for y in range(height):
                for x in range(width):
                    min_dist = np.min(distances[y, x])
                    idx = np.argmin(distances[y, x])
                    image[y, x] = self.hex_to_rgb(control_points[idx]["color"])

        elif interpolation == "voronoi":
            distances = np.zeros((height, width, len(control_points)), dtype=np.float32)
            for i, point in enumerate(control_points):
                px, py = point["x"] * width, point["y"] * height
                for y in range(height):
                    for x in range(width):
                        distances[y, x, i] = abs(x - px) + abs(y - py)
            for y in range(height):
                for x in range(width):
                    min_dist = np.min(distances[y, x])
                    idx = np.argmin(distances[y, x])
                    image[y, x] = self.hex_to_rgb(control_points[idx]["color"])

        elif interpolation == "idw(soft)":
            weights_cache = np.zeros((height, width), dtype=np.float32)
            colors_cache = np.zeros((height, width, 3), dtype=np.float32)
            for y in range(height):
                for x in range(width):
                    nx, ny = x / width, y / height
                    total_weight = 0
                    color = np.zeros(3, dtype=np.float32)
                    for point in control_points:
                        px, py = point["x"], point["y"]
                        influence = point.get("influence", 1.0)
                        distance = np.sqrt((nx - px) ** 2 + (ny - py) ** 2) / influence + 1e-6
                        weight = 1 / distance
                        total_weight += weight
                        rgb = np.array(self.hex_to_rgb(point["color"]), dtype=np.float32)
                        color += rgb * weight
                    idx = (y, x)
                    weights_cache[idx] = total_weight
                    colors_cache[idx] = color
            for y in range(height):
                for x in range(width):
                    total_weight = weights_cache[y, x]
                    if total_weight > 0:
                        image[y, x] = colors_cache[y, x] / total_weight

        elif interpolation == "linear":
            # Fix head and tail points as indices 0 and 1
            first_point = control_points[0]
            last_point = control_points[1]
            # Calculate t values for all points
            points_with_t = [
                {
                    **point,
                    "t": self.project_point_to_line(
                        point["x"], point["y"],
                        first_point["x"], first_point["y"],
                        last_point["x"], last_point["y"]
                    )["t"],
                    "original_index": i
                }
                for i, point in enumerate(control_points)
            ]
            # Sort points by t for interpolation
            points_with_t.sort(key=lambda p: p["t"])
            
            for y in range(height):
                for x in range(width):
                    nx, ny = x / width, y / height
                    dx = last_point["x"] - first_point["x"]
                    dy = last_point["y"] - first_point["y"]
                    len_squared = dx * dx + dy * dy
                    t = 0.0 if len_squared < 1e-6 else max(0, min(1, ((nx - first_point["x"]) * dx + (ny - first_point["y"]) * dy) / len_squared))
                    
                    color = np.array([255, 255, 255], dtype=np.float32)
                    for i in range(len(points_with_t) - 1):
                        p0 = points_with_t[i]
                        p1 = points_with_t[i + 1]
                        if t >= p0["t"] and t <= p1["t"]:
                            factor = 0.0 if p1["t"] == p0["t"] else (t - p0["t"]) / (p1["t"] - p0["t"])
                            rgb0 = np.array(self.hex_to_rgb(control_points[p0["original_index"]]["color"]), dtype=np.float32)
                            rgb1 = np.array(self.hex_to_rgb(control_points[p1["original_index"]]["color"]), dtype=np.float32)
                            color = rgb0 + (rgb1 - rgb0) * factor
                            break
                    image[y, x] = color

        # Convert to torch tensor
        image = np.clip(image, 0, 255).astype(np.uint8)
        image_tensor = torch.from_numpy(image).float() / 255.0
        image_tensor = image_tensor.unsqueeze(0)  # Add batch dimension
        return (image_tensor,)

NODE_CLASS_MAPPINGS = {
    "XIS_MultiPointGradient": XIS_MultiPointGradient
}