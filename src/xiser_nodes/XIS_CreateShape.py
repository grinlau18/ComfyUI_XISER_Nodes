"""
XIS_CreateShape.py

Custom node for ComfyUI to generate various geometric shapes with interactive controls.
Supports circles (with optional inner radius for donut shape), polygons, stars with transformations.
"""

import os
import json
import math
import logging
import re
from collections import OrderedDict
from functools import lru_cache
from typing import List, Dict, Any, Tuple

import cv2
import numpy as np
import torch
from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen
try:
    from fontTools.pens.flattenPen import FlattenPen as FTFlattenPen
except ImportError:  # pragma: no cover - fallback for older fontTools
    FTFlattenPen = None
from shapely import affinity
from shapely.geometry import Polygon, LineString, MultiPolygon, MultiLineString
from shapely.ops import unary_union

# 设置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
FONTS_DIR = os.path.join(BASE_DIR, "fonts")
FRONTEND_CANVAS_SCALE = 0.75  # 与前端 Konva 画布缩放保持一致，用于描边厚度补偿
FRONTEND_STROKE_COMPENSATION = 0.9  # 前端描边补偿因子（Konva 端口中的0.9系数）

class XIS_CreateShape:
    def __init__(self):
        self._text_geometry_cache = OrderedDict()
        self._max_text_geometry_cache = 32

    """
    A custom node for generating geometric shapes with interactive controls.
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
                "width": ("INT", {"default": 512, "min": 64, "max": 4096, "step": 1}),
                "height": ("INT", {"default": 512, "min": 64, "max": 4096, "step": 1}),
                "shape_type": (
                    "COMBO",
                    {
                        "default": "circle",
                        "options": ["circle", "polygon", "star", "heart", "flower", "spiral", "sunburst", "square", "text"]
                    }
                ),
                "shape_color": ("STRING", {"default": "#FF0000"}),
                "bg_color": ("STRING", {"default": "#000000"}),
                "transparent_bg": ("BOOLEAN", {"default": False}),
                "stroke_color": ("STRING", {"default": "#FFFFFF"}),
                "stroke_width": ("INT", {"default": 0, "min": 0, "max": 1000, "step": 1}),
                "shape_canvas": ("WIDGET", {}),
            },
            "optional": {
                "shape_data": ("LIST", {}),  # 新增shape_data端口，支持批量处理
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK", "IMAGE")
    RETURN_NAMES = ("shape_image", "shape_mask", "bg_image")
    FUNCTION = "execute"
    OUTPUT_IS_LIST = (True, True, True)  # 支持批量输出
    CATEGORY = "XISER_Nodes/Visual_Editing"

    def apply_transform(self, coords: List[Tuple[float, float]],
                      scale: Dict[str, float], rotation: float,
                      skew: Dict[str, float], position: Dict[str, float],
                      width: int, height: int, scale_factor: float = 1.0) -> List[Tuple[float, float]]:
        """
        Apply transformations to coordinates in order: scale, rotate, skew, translate.

        Args:
            coords: List of (x, y) coordinates (relative to shape center at 0, 0)
            scale: Scale factors {x, y}
            rotation: Rotation angle in degrees (0° at 3 o'clock)
            skew: Skew factors {x, y}
            position: Normalized position offset from canvas center {x, y}
            width: Canvas width
            height: Canvas height

        Returns:
            Transformed coordinates
        """
        transformed_coords = []
        rotation_rad = math.radians(rotation)

        # 变换矩阵
        sx, sy = scale.get('x', 1.0), scale.get('y', 1.0)
        cos_r = math.cos(rotation_rad)
        sin_r = math.sin(rotation_rad)
        kx, ky = skew.get('x', 0.0), skew.get('y', 0.0)

        # 前端position参数是相对于缩放画布（原始尺寸×0.75）归一化的
        # position.x 和 position.y 是归一化偏移量，相对于画布中心
        # 前端stage尺寸：width * 0.75 × height * 0.75
        # 渲染画布尺寸：width * scale_factor × height * scale_factor

        # 计算前端画布尺寸（缩放后的尺寸）
        frontend_canvas_width = width * 0.75
        frontend_canvas_height = height * 0.75

        # 计算渲染画布中心
        render_center_x = width * scale_factor / 2
        render_center_y = height * scale_factor / 2

        # 将前端归一化位置映射到渲染画布尺寸
        # 前端position是相对于前端画布中心(0,0)的归一化偏移
        # 需要转换为渲染画布上的绝对像素位置
        tx = render_center_x + position.get('x', 0.0) * frontend_canvas_width * scale_factor
        ty = render_center_y + position.get('y', 0.0) * frontend_canvas_height * scale_factor

        logger.info(f"Transform params: width={width}, height={height}, scale_factor={scale_factor}")
        logger.info(f"Position: x={position.get('x', 0.0)}, y={position.get('y', 0.0)}")
        logger.info(f"Frontend canvas: {frontend_canvas_width}x{frontend_canvas_height}")
        logger.info(f"Translation: tx={tx}, ty={ty}")

        for x, y in coords:
            # 1. Scale
            x_s = x * sx
            y_s = y * sy
            # 2. Rotate
            x_r = x_s * cos_r - y_s * sin_r
            y_r = x_s * sin_r + y_s * cos_r
            # 3. Skew
            x_k = x_r + kx * y_r
            y_k = y_r + ky * x_r
            # 4. Translate
            x_t = x_k + tx
            y_t = y_k + ty
            transformed_coords.append((x_t, y_t))

        logger.info(f"Transformed coordinates range: x=[{min(x for x, _ in transformed_coords):.2f}, {max(x for x, _ in transformed_coords):.2f}], y=[{min(y for _, y in transformed_coords):.2f}, {max(y for _, y in transformed_coords):.2f}]")
        return transformed_coords

    def apply_simple_transform(self, coords: List[Tuple[float, float]],
                             scale: Dict[str, float], rotation: float,
                             skew: Dict[str, float], position: Dict[str, float],
                             width: int, height: int, scale_factor: float = 1.0) -> List[Tuple[float, float]]:
        """
        简单的坐标变换方法，直接使用前端计算好的变换参数

        Args:
            coords: 形状坐标（以中心为原点）
            scale: 缩放比例
            rotation: 旋转角度
            skew: 倾斜参数
            position: 位置偏移（前端已经计算好的绝对像素位置）
            width: 画布宽度
            height: 画布高度
            scale_factor: 缩放因子

        Returns:
            变换后的坐标
        """
        transformed_coords = []
        rotation_rad = math.radians(rotation)

        # 变换矩阵参数
        sx, sy = scale.get('x', 1.0), scale.get('y', 1.0)
        cos_r = math.cos(rotation_rad)
        sin_r = math.sin(rotation_rad)
        kx, ky = skew.get('x', 0.0), skew.get('y', 0.0)

        # 计算画布中心
        center_x = width / 2
        center_y = height / 2

        # 前端position是归一化的值（相对于画布中心，范围-0.5到0.5）
        # 前端已经处理了0.75的缩放，发送的是基于原始尺寸的归一化位置
        # 直接使用归一化位置 × 画布宽度/高度
        pos_x = position.get('x', 0.0) * width
        pos_y = position.get('y', 0.0) * height

        logger.info(f"Simple transform: position=({pos_x}, {pos_y}), rotation={rotation}°, scale=({sx}, {sy}), skew=({kx}, {ky})")

        for x, y in coords:
            # 1. 缩放
            x_s = x * sx
            y_s = y * sy

            # 2. 旋转
            x_r = x_s * cos_r - y_s * sin_r
            y_r = x_s * sin_r + y_s * cos_r

            # 3. 倾斜
            x_k = x_r + kx * y_r
            y_k = y_r + ky * x_r

            # 4. 平移（直接使用前端计算的位置）
            x_t = x_k + center_x + pos_x
            y_t = y_k + center_y + pos_y

            transformed_coords.append((x_t, y_t))

        logger.info(f"Simple transformed coordinates range: x=[{min(x for x, _ in transformed_coords):.2f}, {max(x for x, _ in transformed_coords):.2f}], y=[{min(y for _, y in transformed_coords):.2f}, {max(y for _, y in transformed_coords):.2f}]")
        return transformed_coords

    def generate_shape_coordinates(self, shape_type: str, size: float,
                                 params: Dict[str, Any] = None) -> List[Tuple[float, float]]:
        """
        Generate shape coordinates based on type and parameters (before transformations).

        Args:
            shape_type: Type of shape to generate
            size: Shape size in pixels
            params: Dictionary of shape parameters (e.g., angle, inner_radius)

        Returns:
            List of coordinate points (relative to shape center at 0, 0)
        """
        # 使用绝对像素大小，不需要额外缩放（size已经是前端计算的绝对像素大小）
        radius = size / 2
        params = params or {}
        
        cx, cy = 0, 0  # 形状中心为 (0, 0)
        coords = []

        logger.info(f"Generating {shape_type} coordinates with size: {size}, radius: {radius}, sides/points: {params.get('sides') or params.get('points') or 'N/A'}, inner_radius: {params.get('inner_radius', 0)}, angle: {params.get('angle', 360)}")

        if shape_type == "circle":
            angle = params.get("angle", 360)
            # 角度为0时应该等同于360度（完整圆形）
            if angle == 0:
                angle = 360
            inner_radius = params.get("inner_radius", 0) / 100  # 转换为比例
            # 增加段数以提高质量，与前端保持一致
            segments = max(32, min(96, int(angle * 48 / math.pi)))

            if inner_radius > 0:
                # 生成甜甜圈坐标（外圆和内圆）
                outer_coords = []
                inner_coords = []
                angle_rad = math.radians(angle)

                for i in range(segments + 1):
                    theta = angle_rad * i / segments
                    cos_theta = math.cos(theta)
                    sin_theta = math.sin(theta)
                    outer_coords.append((cx + radius * cos_theta, cy + radius * sin_theta))
                    inner_coords.append((cx + radius * inner_radius * cos_theta, cy + radius * inner_radius * sin_theta))

                if angle < 360:
                    # 对于扇形甜甜圈，形成闭合路径：外圆 -> 内圆 -> 回到外圆起点
                    coords = outer_coords + list(reversed(inner_coords)) + [outer_coords[0]]
                    logger.info(f"Sector donut path generated with {len(outer_coords)} outer points, {len(inner_coords)} inner points, angle: {angle}°")
                else:
                    # 对于完整甜甜圈（角度为0或360），返回分离的外圆和内圆坐标
                    # 这样可以使用专门的甜甜圈渲染方法
                    outer_coords.append(outer_coords[0])  # 闭合外圆
                    inner_coords.append(inner_coords[0])  # 闭合内圆
                    # 返回一个特殊标记表示这是甜甜圈几何体
                    coords = {"type": "donut", "outer": outer_coords, "inner": inner_coords}
                    logger.info(f"Full circle donut path generated with {len(outer_coords)} outer points, {len(inner_coords)} inner points")
            else:
                # 普通圆形或扇形
                if angle < 360:
                    coords = self._generate_circle_sector(cx, cy, radius, angle, include_center=True)
                else:
                    coords = self._generate_circle(cx, cy, radius, segments)
        elif shape_type == "polygon":
            sides = params.get("sides", 4)
            coords = self._generate_regular_polygon(cx, cy, radius, sides)
        elif shape_type == "star":
            points = params.get("points", 5)
            inner_ratio = params.get("inner_ratio", 0.4)
            coords = self._generate_star(cx, cy, radius, points, inner_ratio)
        elif shape_type == "heart":
            path_offset = params.get("path_offset", 0)
            coords = self._generate_heart(cx, cy, radius, path_offset)
        elif shape_type == "flower":
            petals = params.get("petals", 5)
            petal_length = params.get("petal_length", 0.5)
            coords = self._generate_flower(cx, cy, radius, petals, petal_length)
        elif shape_type == "spiral":
            spiral_turns = params.get("spiral_turns", 3)
            spiral_density = params.get("spiral_density", 1.0)
            coords = self._generate_spiral(cx, cy, radius, spiral_turns, spiral_density)
        elif shape_type == "sunburst":
            ray_count = params.get("ray_count", 16)
            ray_length = params.get("ray_length", 0.6)
            coords = self._generate_sunburst(cx, cy, radius, ray_count, ray_length)
        elif shape_type == "square":
            aspect_ratio = params.get("aspect_ratio", 50)
            corner_radius = params.get("corner_radius", 0)
            coords = self._generate_square(cx, cy, radius, aspect_ratio, corner_radius)
        else:
            coords = self._generate_circle(cx, cy, radius, params.get("segments", 64))
        
        return coords

    def _generate_circle(self, cx: float, cy: float, radius: float, segments: int) -> List[Tuple[float, float]]:
        """Generate circle coordinates."""
        points = []
        for i in range(segments + 1):
            angle = 2 * math.pi * i / segments
            x = cx + radius * math.cos(angle)
            y = cy + radius * math.sin(angle)
            points.append((x, y))
        return points

    def _generate_circle_sector(self, cx: float, cy: float, radius: float, angle: float, include_center: bool = True) -> List[Tuple[float, float]]:
        """
        Generate circle sector coordinates.

        Args:
            cx: Center x-coordinate
            cy: Center y-coordinate
            radius: Radius of the sector
            angle: Sector angle in degrees (0 to 360)
            include_center: Whether to include the center point in the path

        Returns:
            List of coordinate points
        """
        points = []
        angle_range = angle if angle > 0 else 360
        angle_range_rad = math.radians(angle_range)
        segments = max(32, int(angle_range * 64 / math.pi))  # 增加段数以获得更平滑的曲线
        
        for i in range(segments + 1):
            theta = angle_range_rad * i / segments
            x = cx + radius * math.cos(theta)
            y = cy + radius * math.sin(theta)
            points.append((x, y))
        
        if include_center:
            points.append((cx, cy))
        return points

    def _generate_regular_polygon(self, cx: float, cy: float, radius: float, sides: int) -> List[Tuple[float, float]]:
        """
        Generate regular polygon coordinates, 0° at 3 o'clock.

        Args:
            cx: Center x-coordinate
            cy: Center y-coordinate
            radius: Radius of the polygon
            sides: Number of sides

        Returns:
            List of coordinate points
        """
        points = []
        for i in range(sides):
            angle = 2 * math.pi * i / sides - math.pi / 2  # 偏移到 3 点钟方向
            x = cx + radius * math.cos(angle)
            y = cy + radius * math.sin(angle)
            points.append((x, y))
        return points

    def _generate_star(self, cx: float, cy: float, radius: float, points: int, inner_ratio: float = 0.4) -> List[Tuple[float, float]]:
        """
        Generate star coordinates, 0° at 3 o'clock.

        Args:
            cx: Center x-coordinate
            cy: Center y-coordinate
            radius: Outer radius of the star
            points: Number of star points
            inner_ratio: Ratio of inner radius to outer radius

        Returns:
            List of coordinate points
        """
        coords = []
        for i in range(points * 2):
            angle = math.pi * i / points - math.pi / 2  # 偏移到 3 点钟方向
            r = radius if i % 2 == 0 else radius * inner_ratio
            x = cx + r * math.cos(angle)
            y = cy + r * math.sin(angle)
            coords.append((x, y))
        return coords

    def _generate_rectangle(self, cx: float, cy: float, radius: float,
                          width_ratio: float, height_ratio: float) -> List[Tuple[float, float]]:
        """
        Generate rectangle coordinates.

        Args:
            cx: Center x-coordinate
            cy: Center y-coordinate
            radius: Base radius
            width_ratio: Width ratio relative to radius
            height_ratio: Height ratio relative to radius

        Returns:
            List of coordinate points
        """
        width = radius * 2 * width_ratio
        height = radius * 2 * height_ratio
        half_width = width / 2
        half_height = height / 2

        # Generate rectangle corners (clockwise from top-left)
        coords = [
            (cx - half_width, cy - half_height),  # top-left
            (cx + half_width, cy - half_height),  # top-right
            (cx + half_width, cy + half_height),  # bottom-right
            (cx - half_width, cy + half_height)   # bottom-left
        ]

        logger.info(f"Rectangle generated with width: {width}, height: {height}, "
                   f"width_ratio: {width_ratio}, height_ratio: {height_ratio}")
        return coords

    def _generate_square(self, cx: float, cy: float, radius: float, aspect_ratio: int, corner_radius: float) -> List[Tuple[float, float]]:
        """
        Generate square/rectangle coordinates with aspect ratio and rounded corners.
        Uses proper quarter-circle arcs tangent to the sides for mathematically correct rounded corners.

        Args:
            cx: Center x-coordinate
            cy: Center y-coordinate
            radius: Base radius
            aspect_ratio: Aspect ratio from 1-99 (1:99 to 99:1)
            corner_radius: Corner radius for rounded corners

        Returns:
            List of coordinate points
        """
        # Convert aspect ratio to width and height ratios
        width_ratio = aspect_ratio / 100.0
        height_ratio = 1.0 - width_ratio

        # Ensure minimum size for very extreme ratios
        width_ratio = max(0.01, min(0.99, width_ratio))
        height_ratio = max(0.01, min(0.99, height_ratio))

        width = radius * 2 * width_ratio
        height = radius * 2 * height_ratio
        half_width = width / 2
        half_height = height / 2

        if corner_radius <= 0:
            # Square corners
            coords = [
                (cx - half_width, cy - half_height),  # top-left
                (cx + half_width, cy - half_height),  # top-right
                (cx + half_width, cy + half_height),  # bottom-right
                (cx - half_width, cy + half_height)   # bottom-left
            ]
        else:
            # Rounded corners with proper quarter-circle arcs
            # Limit corner radius to prevent overlap
            max_corner_radius = min(half_width, half_height)
            corner_radius = min(corner_radius, max_corner_radius)
            coords = []

            # Calculate corner arc parameters
            segments = 32  # Number of segments per quarter-circle

            # Top-left corner (starts at 180°, ends at 270°)
            start_angle = math.pi
            end_angle = 3 * math.pi / 2
            center_x = cx - half_width + corner_radius
            center_y = cy - half_height + corner_radius
            for i in range(segments + 1):
                angle = start_angle + (end_angle - start_angle) * i / segments
                x = center_x + corner_radius * math.cos(angle)
                y = center_y + corner_radius * math.sin(angle)
                coords.append((x, y))

            # Top-right corner (starts at 270°, ends at 0°)
            start_angle = 3 * math.pi / 2
            end_angle = 2 * math.pi
            center_x = cx + half_width - corner_radius
            center_y = cy - half_height + corner_radius
            for i in range(segments + 1):
                angle = start_angle + (end_angle - start_angle) * i / segments
                x = center_x + corner_radius * math.cos(angle)
                y = center_y + corner_radius * math.sin(angle)
                coords.append((x, y))

            # Bottom-right corner (starts at 0°, ends at 90°)
            start_angle = 0
            end_angle = math.pi / 2
            center_x = cx + half_width - corner_radius
            center_y = cy + half_height - corner_radius
            for i in range(segments + 1):
                angle = start_angle + (end_angle - start_angle) * i / segments
                x = center_x + corner_radius * math.cos(angle)
                y = center_y + corner_radius * math.sin(angle)
                coords.append((x, y))

            # Bottom-left corner (starts at 90°, ends at 180°)
            start_angle = math.pi / 2
            end_angle = math.pi
            center_x = cx - half_width + corner_radius
            center_y = cy + half_height - corner_radius
            for i in range(segments + 1):
                angle = start_angle + (end_angle - start_angle) * i / segments
                x = center_x + corner_radius * math.cos(angle)
                y = center_y + corner_radius * math.sin(angle)
                coords.append((x, y))

        logger.info(f"Square generated with aspect_ratio: {aspect_ratio}, corner_radius: {corner_radius}, "
                   f"width: {width}, height: {height}")
        return coords

    def _generate_heart(self, cx: float, cy: float, radius: float, path_offset: float) -> List[Tuple[float, float]]:
        """Generate heart shape coordinates with path offset."""
        points = []
        segments = 128  # 增加段数以获得更平滑的曲线
        offset_factor = path_offset * 0.3  # Scale offset for reasonable effect

        for i in range(segments + 1):
            t = i / segments * math.pi * 2

            # Classic heart parametric equations
            x = 16 * math.pow(math.sin(t), 3)
            y = -(13 * math.cos(t) - 5 * math.cos(2*t) - 2 * math.cos(3*t) - math.cos(4*t))

            # Normalize and calculate offset direction
            normalized_x = x / 16
            normalized_y = y / 16

            # Calculate normal vector for offset
            length = math.sqrt(normalized_x * normalized_x + normalized_y * normalized_y)
            offset_x = normalized_x / (length or 1) * offset_factor
            offset_y = normalized_y / (length or 1) * offset_factor

            # Apply offset and scale
            final_x = (normalized_x + offset_x) * radius
            final_y = (normalized_y + offset_y) * radius

            points.append((cx + final_x, cy + final_y))

        logger.info(f"Heart generated with path_offset: {path_offset}")
        return points

    def _generate_flower(self, cx: float, cy: float, radius: float, petals: int, petal_length: float) -> List[Tuple[float, float]]:
        """Generate flower shape coordinates."""
        points = []
        petal_count = max(3, min(12, petals))
        length_factor = max(0.1, min(1.3, petal_length))
        segments = 128  # 增加段数以获得更平滑的曲线

        for i in range(segments + 1):
            t = i / segments * math.pi * 2

            # Flower parametric equation matching frontend exactly
            r = radius * (0.65 + 0.5 * math.sin(petal_count * t) * length_factor)

            x = r * math.cos(t)
            y = r * math.sin(t)

            points.append((cx + x, cy + y))

        logger.info(f"Flower generated with petals: {petal_count}, petal_length: {length_factor}")
        return points

    def _generate_spiral(self, cx: float, cy: float, max_radius: float, turns: int, density: float) -> List[Tuple[float, float]]:
        """Generate spiral coordinates with controlled boundary."""
        points = []
        turns = max(1, min(10, turns))
        density = max(0.1, min(4.0, density))
        segments = 512  # 固定段数确保平滑

        for i in range(segments + 1):
            # 参数化螺旋：角度从0到2π*turns
            angle = 2 * math.pi * turns * i / segments
            # 半径从0线性增加到max_radius，受density控制
            r = max_radius * (i / segments) * density
            # 确保不超过最大边界
            r = min(r, max_radius)

            x = cx + r * math.cos(angle)
            y = cy + r * math.sin(angle)
            points.append((x, y))

        logger.info(f"Spiral generated with {turns} turns, density: {density}, max_radius: {max_radius}")
        return points

    def _generate_sunburst(self, cx: float, cy: float, radius: float, ray_count: int, ray_length: float) -> List[Tuple[float, float]]:
        """Generate sunburst/rays coordinates with controlled boundary."""
        points = []
        ray_count = max(4, min(32, ray_count))
        ray_length = max(0.3, min(5.0, ray_length))

        for i in range(ray_count):
            angle = 2 * math.pi * i / ray_count

            # 射线起点（中心点）
            points.append((cx, cy))

            # 射线终点（尖端）- 使用完整半径，与前端保持一致
            # 前端使用 rayLengthFactor = Math.min(rayLength, 0.9) 限制最大长度
            ray_length_factor = min(ray_length, 5.0)
            r = radius * ray_length_factor
            x = cx + r * math.cos(angle)
            y = cy + r * math.sin(angle)
            points.append((x, y))

        logger.info(f"Sunburst generated with {ray_count} rays, length: {ray_length}")
        return points

    def hex_to_rgb(self, hex_color: str) -> Tuple[int, int, int]:
        """
        Convert hex color to RGB tuple.

        Args:
            hex_color: Hex color string (e.g., "#FF0000")

        Returns:
            Tuple of (r, g, b) values
        """
        # 处理None值或空字符串
        if hex_color is None or hex_color == "":
            logger.warning("Received None or empty hex color, using default #FF0000")
            return (255, 0, 0)

        hex_color = hex_color.lstrip('#')
        if not re.match(r'^[0-9a-fA-F]{3,6}$', hex_color):
            logger.warning(f"Invalid hex color: {hex_color}, using default #FF0000")
            return (255, 0, 0)
        if len(hex_color) == 3:
            hex_color = ''.join([c*2 for c in hex_color])
        return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))

    def merge_properties(self, frontend_props: Dict[str, Any], port_props: Dict[str, Any]) -> Dict[str, Any]:
        """
        合并前端属性和端口属性，端口数据优先

        Args:
            frontend_props: 前端控件属性
            port_props: 端口传入属性

        Returns:
            合并后的属性字典
        """
        merged = frontend_props.copy()

        if port_props:
            # 端口数据优先，但只覆盖非None值
            for key, value in port_props.items():
                if value is not None:
                    merged[key] = value

        return merged

    def _resolve_font_path(self, font_file: str) -> str:
        """
        根据文件名解析字体路径
        """
        if not font_file:
            return None
        candidate = os.path.join(FONTS_DIR, font_file)
        if os.path.isfile(candidate):
            return candidate
        logger.warning(f"Font file not found in fonts directory: {font_file}")
        return None

    @lru_cache(maxsize=16)
    def _load_ttfont(self, font_path: str) -> TTFont:
        return TTFont(font_path)

    def _get_font_units_per_em(self, ttfont: TTFont) -> int:
        try:
            return ttfont['head'].unitsPerEm
        except Exception:
            return 2048

    def _get_font_metrics(self, ttfont: TTFont) -> Tuple[int, int, int]:
        try:
            os2 = ttfont['OS/2']
            return os2.sTypoAscender, os2.sTypoDescender, os2.sTypoLineGap
        except Exception:
            hhea = ttfont['hhea']
            return hhea.ascent, hhea.descent, hhea.lineGap

    class _GlyphPathPen:
        def __init__(self):
            self.paths: List[List[Tuple[float, float]]] = []
            self.current: List[Tuple[float, float]] = []

        def moveTo(self, pt):
            if self.current:
                self.closePath()
            self.current = [pt]

        def lineTo(self, pt):
            if not self.current:
                self.current = [pt]
            self.current.append(pt)

        def curveTo(self, *points):
            if points:
                self.lineTo(points[-1])

        def qCurveTo(self, *points):
            if points:
                self.lineTo(points[-1])

        def closePath(self):
            if self.current:
                if self.current[0] != self.current[-1]:
                    self.current.append(self.current[0])
                if len(self.current) > 2:
                    self.paths.append(self.current)
            self.current = []

        def endPath(self):
            self.closePath()

    class _FallbackFlattenPen(BasePen):
        def __init__(self, glyphSet, out_pen, steps: int = 24):
            super().__init__(glyphSet)
            self.out_pen = out_pen
            self.steps = max(4, steps)

        def _moveTo(self, p0):
            self.out_pen.moveTo(p0)

        def _lineTo(self, p1):
            self.out_pen.lineTo(p1)

        def _curveToOne(self, p1, p2, p3):
            p0 = self._getCurrentPoint()
            for i in range(1, self.steps + 1):
                t = i / self.steps
                x = (1 - t) ** 3 * p0[0] + 3 * (1 - t) ** 2 * t * p1[0] + 3 * (1 - t) * t ** 2 * p2[0] + t ** 3 * p3[0]
                y = (1 - t) ** 3 * p0[1] + 3 * (1 - t) ** 2 * t * p1[1] + 3 * (1 - t) * t ** 2 * p2[1] + t ** 3 * p3[1]
                self.out_pen.lineTo((x, y))

        def _qCurveToOne(self, p1, p2):
            p0 = self._getCurrentPoint()
            for i in range(1, self.steps + 1):
                t = i / self.steps
                x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t ** 2 * p2[0]
                y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t ** 2 * p2[1]
                self.out_pen.lineTo((x, y))

        def _closePath(self):
            self.out_pen.closePath()

    def _load_font(self, font_file: str, font_size: int) -> Tuple[ImageFont.ImageFont, bool]:
        """
        加载字体，若失败则使用默认字体

        Returns:
            (font, is_scalable) - is_scalable 表示字体是否支持自定义字号
        """
        search_paths = []
        font_path = self._resolve_font_path(font_file)
        if font_path:
            search_paths.append(font_path)

        # 尝试常见字体名称（如果系统已安装）
        search_paths.append("DejaVuSans.ttf")
        search_paths.append("Arial.ttf")
        search_paths.append("Arial Unicode.ttf")

        for path in search_paths:
            if not path:
                continue
            try:
                font = ImageFont.truetype(path, font_size)
                return font, True
            except OSError:
                continue

        system_font_dirs = [
            "/System/Library/Fonts",
            "/System/Library/Fonts/Supplemental",
            "/Library/Fonts",
            os.path.expanduser("~/Library/Fonts"),
            "/usr/share/fonts",
            "/usr/local/share/fonts",
            "C:\\Windows\\Fonts"
        ]

        fallback_names = [
            "Arial.ttf",
            "ArialUnicode.ttf",
            "Arial Unicode.ttf",
            "Helvetica.ttf",
            "DejaVuSans.ttf",
            "NotoSans-Regular.ttf",
            "LiberationSans-Regular.ttf"
        ]

        for directory in system_font_dirs:
            if not directory or not os.path.isdir(directory):
                continue

            for name in fallback_names:
                candidate = os.path.join(directory, name)
                if os.path.isfile(candidate):
                    try:
                        font = ImageFont.truetype(candidate, font_size)
                        return font, True
                    except OSError:
                        continue

            # 如果指定名称未命中，则扫描目录中的所有字体文件
            try:
                for filename in os.listdir(directory):
                    if not filename.lower().endswith((".ttf", ".otf", ".ttc")):
                        continue
                    candidate = os.path.join(directory, filename)
                    try:
                        font = ImageFont.truetype(candidate, font_size)
                        return font, True
                    except OSError:
                        continue
            except PermissionError:
                continue

        logger.warning("Falling back to default PIL font (limited glyph support)")
        return ImageFont.load_default(), False

    def _measure_text_line(self, text: str, font: ImageFont.ImageFont, letter_spacing: float) -> float:
        """
        计算一行文本宽度
        """
        if not text:
            text = " "
        width = 0.0
        for idx, char in enumerate(text):
            try:
                bbox = font.getbbox(char)
                glyph_width = bbox[2] - bbox[0]
            except AttributeError:
                glyph_width = font.getsize(char)[0]
            width += glyph_width
            if idx < len(text) - 1:
                width += letter_spacing
        return max(width, 1.0)

    def _create_text_mask(self, text_params: Dict[str, Any], scale_factor: float) -> Image.Image:
        """
        根据文本参数生成单通道蒙版
        """
        content = text_params.get("content", "A")
        uppercase = text_params.get("uppercase", True)
        if not content:
            content = "A"
        if uppercase:
            content = content.upper()
        lines = content.replace("\r", "").split("\n")
        lines = [line if line else " " for line in lines] or [" "]

        font_size_param = max(12, int(text_params.get("font_size", 128)))
        font_size_px = max(12, int(font_size_param * scale_factor))
        letter_spacing_px = float(text_params.get("letter_spacing", 0.0)) * scale_factor
        line_spacing = max(0.5, float(text_params.get("line_spacing", 1.2)))
        font_weight = str(text_params.get("font_weight", "normal")).lower()
        font_style = str(text_params.get("font_style", "normal")).lower()
        underline = bool(text_params.get("underline", False))

        font, scalable_font = self._load_font(text_params.get("font_file"), font_size_px)
        try:
            ascent, descent = font.getmetrics()
        except AttributeError:
            ascent = font_size_px
            descent = int(font_size_px * 0.2)
        base_line_height = max(ascent + descent, 1)
        scale_ratio = 1.0
        if not scalable_font:
            scale_ratio = max(1.0, font_size_px / base_line_height)
        effective_letter_spacing = letter_spacing_px / scale_ratio

        line_widths = [self._measure_text_line(line, font, effective_letter_spacing) for line in lines]
        max_width = max(line_widths) if line_widths else base_line_height
        total_height = len(lines) * base_line_height + max(0, len(lines) - 1) * base_line_height * (line_spacing - 1)
        padding = max(16, int((font_size_px * 0.5) / scale_ratio))

        mask_width = int(max_width + padding * 2)
        mask_height = int(total_height + padding * 2)
        mask = Image.new("L", (mask_width, mask_height), 0)
        draw = ImageDraw.Draw(mask)

        y = padding
        for line_idx, line in enumerate(lines):
            line_width = self._measure_text_line(line, font, effective_letter_spacing)
            x = padding + (max_width - line_width) / 2
            for char_idx, char in enumerate(line):
                draw.text((x, y), char, fill=255, font=font)
                try:
                    bbox = font.getbbox(char)
                    advance = bbox[2] - bbox[0]
                except AttributeError:
                    advance = font.getsize(char)[0]
                x += advance
                if char_idx < len(line) - 1:
                    x += effective_letter_spacing

            if underline:
                underline_thickness = max(1, int((font_size_px * 0.05) / scale_ratio))
                underline_y = y + ascent + underline_thickness
                draw.rectangle(
                    [
                        padding,
                        underline_y,
                        mask_width - padding,
                        underline_y + underline_thickness
                    ],
                    fill=255
                )

            y += base_line_height * line_spacing

        mask_array = np.array(mask)
        if font_weight == "bold":
            kernel = np.ones((3, 3), np.uint8)
            mask_array = cv2.dilate(mask_array, kernel, iterations=1)

        mask = Image.fromarray(mask_array)

        if font_style == "italic":
            shear_factor = 0.3
            offset = int(abs(shear_factor) * mask.height)
            new_width = mask.width + offset
            mask = mask.transform(
                (new_width, mask.height),
                Image.AFFINE,
                (1, shear_factor, -offset if shear_factor < 0 else 0, 0, 1, 0),
                resample=Image.BICUBIC,
                fillcolor=0
            )

        if scale_ratio != 1.0:
            new_width = max(1, int(mask.width * scale_ratio))
            new_height = max(1, int(mask.height * scale_ratio))
            mask = mask.resize((new_width, new_height), Image.BICUBIC)

        return mask

    def _mask_to_geometry(self, mask: Image.Image):
        """
        将文本蒙版转换为Shapely几何体
        """
        mask_array = np.array(mask)
        if mask_array.max() == 0:
            return None

        _, binary = cv2.threshold(mask_array, 1, 255, cv2.THRESH_BINARY)
        contours, hierarchy = cv2.findContours(binary, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)

        if contours is None or len(contours) == 0:
            return None

        if hierarchy is None:
            hierarchy = []
        else:
            hierarchy = hierarchy[0]

        center_x = mask_array.shape[1] / 2.0
        center_y = mask_array.shape[0] / 2.0
        polygons = []

        for idx, contour in enumerate(contours):
            if len(contour) < 3:
                continue

            parent_index = hierarchy[idx][3] if len(hierarchy) > idx else -1
            if parent_index != -1:
                # 只在处理外轮廓时创建多边形，孔将在后续处理
                continue

            exterior = [(float(point[0][0] - center_x), float(point[0][1] - center_y)) for point in contour]
            holes = []
            child_index = hierarchy[idx][2] if len(hierarchy) > idx else -1
            while child_index != -1:
                hole_contour = contours[child_index]
                if len(hole_contour) >= 3:
                    hole = [(float(point[0][0] - center_x), float(point[0][1] - center_y)) for point in hole_contour]
                    holes.append(hole)
                child_index = hierarchy[child_index][0]

            polygon = Polygon(exterior, holes)
            if polygon.is_valid and not polygon.is_empty:
                polygons.append(polygon)

        if not polygons:
            return None

        if len(polygons) == 1:
            return polygons[0]

        return unary_union(polygons)

    def _paths_to_geometry(self, paths: List[List[Tuple[float, float]]]):
        """
        将由字体轮廓生成的路径转换为Shapely几何体
        """
        if not paths:
            return None

        def ensure_closed(points):
            if not points:
                return points
            if points[0] != points[-1]:
                points = points + [points[0]]
            return points

        entries = []
        for raw_pts in paths:
            if not raw_pts or len(raw_pts) < 3:
                continue
            pts = ensure_closed(raw_pts)
            try:
                polygon = Polygon(pts)
                if not polygon.is_valid:
                    polygon = polygon.buffer(0)
                if polygon.is_empty:
                    continue
                entries.append({
                    "coords": pts,
                    "polygon": polygon,
                    "children": [],
                    "parent": None
                })
            except Exception as e:
                logger.debug(f"Failed to convert glyph path to polygon: {e}")
                continue

        if not entries:
            return None

        for idx, entry in enumerate(entries):
            parent = None
            parent_area = None
            for jdx, candidate in enumerate(entries):
                if idx == jdx:
                    continue
                try:
                    if candidate["polygon"].contains(entry["polygon"]):
                        cand_area = candidate["polygon"].area
                        if parent is None or cand_area < parent_area:
                            parent = candidate
                            parent_area = cand_area
                except Exception:
                    continue
            if parent:
                entry["parent"] = parent
                parent["children"].append(entry)

        def build_polygons(node, depth=0):
            results = []
            hole_coords = []
            for child in node["children"]:
                if depth % 2 == 0:
                    hole_coords.append(child["coords"])
                results.extend(build_polygons(child, depth + 1))
            if depth % 2 == 0:
                try:
                    poly = Polygon(node["coords"], [ensure_closed(h) for h in hole_coords if h and len(h) >= 3])
                    if not poly.is_valid:
                        poly = poly.buffer(0)
                    if poly.is_valid and not poly.is_empty:
                        results.insert(0, poly)
                except Exception as e:
                    logger.debug(f"Failed to assemble polygon with hierarchical holes: {e}")
            return results

        polygons = []
        for entry in entries:
            if entry["parent"] is None:
                polygons.extend(build_polygons(entry))

        if not polygons:
            return None

        if len(polygons) == 1:
            return polygons[0]

        try:
            return MultiPolygon(polygons)
        except Exception as e:
            logger.warning(f"Failed to assemble glyph multipolygon: {e}")
            return polygons[0]

    def _generate_stroke_mask(self, fill_mask: np.ndarray, stroke_width: float):
        """
        根据填充蒙版生成像素描边蒙版
        """
        if stroke_width <= 0 or fill_mask.max() == 0:
            return None

        stroke_radius = max(0.5, stroke_width / 2.0)
        fill_binary = (fill_mask > 0).astype(np.uint8)
        background = (1 - fill_binary).astype(np.uint8)

        try:
            dist_out = cv2.distanceTransform(background * 255, cv2.DIST_L2, 5)
            dist_in = cv2.distanceTransform(fill_binary * 255, cv2.DIST_L2, 5)
            outer_ring = np.logical_and(background == 1, dist_out <= stroke_radius)
            inner_ring = np.logical_and(fill_binary == 1, dist_in <= stroke_radius)
            stroke_mask = np.where(np.logical_or(outer_ring, inner_ring), 255, 0).astype(np.uint8)
            return stroke_mask
        except Exception as e:
            logger.warning(f"Failed to compute stroke mask: {e}")
            return None

    def _geometry_to_mask(self, geometry, width: int, height: int) -> Image.Image:
        """
        将Shapely几何体栅格化为单通道蒙版
        """
        mask = Image.new("L", (width, height), 0)
        if geometry is None or geometry.is_empty:
            return mask

        draw = ImageDraw.Draw(mask)
        self._draw_geometry_mask(draw, geometry)
        return mask

    def _draw_geometry_mask(self, draw: ImageDraw.ImageDraw, geometry) -> None:
        if geometry.is_empty:
            return

        if geometry.geom_type == "Polygon":
            exterior = [(round(x), round(y)) for x, y in geometry.exterior.coords]
            if exterior and exterior[0] != exterior[-1]:
                exterior.append(exterior[0])
            draw.polygon(exterior, fill=255, outline=255)

            for interior in geometry.interiors:
                hole = [(round(x), round(y)) for x, y in interior.coords]
                if hole and hole[0] != hole[-1]:
                    hole.append(hole[0])
                draw.polygon(hole, fill=0, outline=0)
        elif geometry.geom_type == "MultiPolygon":
            for poly in geometry.geoms:
                self._draw_geometry_mask(draw, poly)
        elif geometry.geom_type == "LineString":
            coords = [(round(x), round(y)) for x, y in geometry.coords]
            if len(coords) >= 2:
                draw.line(coords, fill=255, width=1)
        elif geometry.geom_type == "MultiLineString":
            for line in geometry.geoms:
                coords = [(round(x), round(y)) for x, y in line.coords]
                if len(coords) >= 2:
                    draw.line(coords, fill=255, width=1)
        elif geometry.geom_type == "GeometryCollection":
            for geom in geometry.geoms:
                self._draw_geometry_mask(draw, geom)

    def _apply_geometry_pixel_layer(self, target_image: Image.Image, geometry,
                                    fill_color: Tuple[int, int, int, int],
                                    stroke_color: Tuple[int, int, int, int],
                                    stroke_width: float) -> None:
        """
        使用像素级描边逻辑将几何体叠加到目标图像
        """
        if geometry is None or geometry.is_empty:
            return

        width, height = target_image.size
        fill_mask_img = self._geometry_to_mask(geometry, width, height)
        fill_mask = np.array(fill_mask_img, dtype=np.uint8)
        stroke_mask = None
        if stroke_color is not None and stroke_width > 0:
            stroke_mask = self._generate_stroke_mask(fill_mask, stroke_width)

        layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))

        if stroke_mask is not None:
            stroke_alpha = Image.fromarray(stroke_mask, mode="L")
            stroke_image = Image.new("RGBA", (width, height), stroke_color)
            stroke_image.putalpha(stroke_alpha)
            layer = Image.alpha_composite(layer, stroke_image)

        if fill_mask.max() > 0:
            fill_alpha = Image.fromarray(fill_mask, mode="L")
            fill_image = Image.new("RGBA", (width, height), fill_color)
            fill_image.putalpha(fill_alpha)
            layer = Image.alpha_composite(layer, fill_image)

        target_image.paste(layer, (0, 0), layer)

    def _build_text_geometry_with_fonttools(self, text_params: Dict[str, Any], scale_factor: float):
        font_path = self._resolve_font_path(text_params.get("font_file"))
        if not font_path:
            return None

        try:
            ttfont = self._load_ttfont(font_path)
        except Exception as e:
            logger.warning(f"fontTools failed to load font {font_path}: {e}")
            return None

        cmap = ttfont.getBestCmap() or {}
        glyph_set = ttfont.getGlyphSet()
        try:
            glyph_names = set(glyph_set.keys())
        except AttributeError:
            glyph_names = set(ttfont.getGlyphOrder())
        units_per_em = self._get_font_units_per_em(ttfont)

        content = text_params.get("content", "A") or "A"
        content = content.replace("\r", "")
        lines = content.split("\n") or [" "]
        if text_params.get("uppercase", True):
            lines = [line.upper() or " " for line in lines]

        font_size_param = max(12, int(text_params.get("font_size", 128)))
        font_size_px = max(12, int(font_size_param * scale_factor))
        scale = font_size_px / units_per_em
        letter_spacing_px = float(text_params.get("letter_spacing", 0.0)) * scale_factor
        letter_spacing_units = letter_spacing_px / scale
        line_spacing = max(0.5, float(text_params.get("line_spacing", 1.2)))
        font_weight = str(text_params.get("font_weight", "normal")).lower()
        font_style = str(text_params.get("font_style", "normal")).lower()
        underline = bool(text_params.get("underline", False))

        ascent_units, descent_units, linegap_units = self._get_font_metrics(ttfont)
        baseline_offset = ascent_units * scale
        line_height_px = (ascent_units - descent_units + linegap_units) * scale * line_spacing

        geom_list = []

        hmtx = ttfont['hmtx'] if 'hmtx' in ttfont else None
        space_advance_units = None
        space_glyph = cmap.get(ord(' ')) or ('space' if 'space' in glyph_names else None)
        if space_glyph and hmtx and space_glyph in hmtx.metrics:
            space_advance_units = hmtx.metrics[space_glyph][0]
        elif space_glyph and hasattr(glyph_set[space_glyph], 'width'):
            space_advance_units = glyph_set[space_glyph].width
        else:
            space_advance_units = units_per_em * 0.5

        for line_index, line in enumerate(lines):
            pen_x_units = 0.0
            y_offset = -line_index * line_height_px

            for char in line:
                glyph_name = cmap.get(ord(char))
                if not glyph_name:
                    if char == ' ':
                        pen_x_units += space_advance_units + letter_spacing_units
                        continue
                    glyph_name = '.notdef' if '.notdef' in glyph_names else None
                if not glyph_name or glyph_name not in glyph_names:
                    pen_x_units += letter_spacing_units
                    continue

                glyph = glyph_set[glyph_name]
                path_pen = self._GlyphPathPen()
                if FTFlattenPen:
                    flatten_pen = FTFlattenPen(path_pen, approximateSegmentLength=2, segmentLines=16)
                else:
                    flatten_pen = self._FallbackFlattenPen(glyph_set, path_pen, steps=24)
                try:
                    glyph.draw(flatten_pen)
                except Exception:
                    pen_x_units += letter_spacing_units
                    continue

                transformed_paths = []
                for pts in path_pen.paths:
                    transformed = []
                    for x, y in pts:
                        px = ((x + pen_x_units) * scale)
                        py = (-y * scale) + y_offset + baseline_offset
                        transformed.append((px, py))
                    if transformed:
                        transformed_paths.append(transformed)

                glyph_geometry = self._paths_to_geometry(transformed_paths)
                if glyph_geometry and not glyph_geometry.is_empty:
                    geom_list.append(glyph_geometry)

                if hmtx and glyph_name in hmtx.metrics:
                    advance_units = hmtx.metrics[glyph_name][0]
                else:
                    advance_units = getattr(glyph, 'width', units_per_em * 0.6)
                pen_x_units += advance_units + letter_spacing_units

            # no additional bookkeeping required per line

        if not geom_list:
            return None

        geometry = unary_union(geom_list)

        if underline:
            underline_height = max(1.0, font_size_px * 0.05)
            underline_y = baseline_offset + underline_height * 0.5
            minx, _, maxx, _ = geometry.bounds
            underline_poly = Polygon([
                (minx, underline_y),
                (maxx, underline_y),
                (maxx, underline_y + underline_height),
                (minx, underline_y + underline_height)
            ])
            geometry = unary_union([geometry, underline_poly])

        if font_weight == "bold":
            bold_strength = max(0.5, font_size_px * 0.02)
            geometry = geometry.buffer(bold_strength)

        if font_style == "italic":
            geometry = affinity.skew(geometry, xs=12, origin=(0, 0))

        minx, miny, maxx, maxy = geometry.bounds
        geometry = affinity.translate(geometry, xoff=-(minx + maxx) / 2, yoff=-(miny + maxy) / 2)

        return geometry

    def _normalize_text_params(self, params: Dict[str, Any]) -> Dict[str, Any]:
        defaults = {
            "content": "A",
            "font_file": None,
            "font_size": 128,
            "letter_spacing": 0.0,
            "line_spacing": 1.2,
            "font_weight": "normal",
            "font_style": "normal",
            "underline": False,
            "uppercase": True
        }
        normalized = defaults.copy()
        if params and isinstance(params, dict):
            for key, value in params.items():
                if value is not None:
                    normalized[key] = value
        return normalized

    def _build_text_geometry(self, text_params: Dict[str, Any], scale_factor: float):
        normalized_params = self._normalize_text_params(text_params)
        cache_key = self._text_geometry_cache_key(normalized_params, scale_factor)
        cached_geometry = self._text_geometry_cache.get(cache_key)
        if cached_geometry is not None:
            return cached_geometry

        geometry = self._build_text_geometry_with_fonttools(normalized_params, scale_factor)
        if geometry is None or geometry.is_empty:
            mask = self._create_text_mask(normalized_params, scale_factor)
            geometry = self._mask_to_geometry(mask)
        if geometry is None or geometry.is_empty:
            logger.warning("Generated text geometry is empty")
        else:
            self._store_text_geometry_cache(cache_key, geometry)
        return geometry

    def _text_geometry_cache_key(self, params: Dict[str, Any], scale_factor: float):
        content = params.get("content", "")
        font_file = params.get("font_file") or ""
        font_size = params.get("font_size", 128)
        letter_spacing = params.get("letter_spacing", 0.0)
        line_spacing = params.get("line_spacing", 1.2)
        font_weight = params.get("font_weight", "normal")
        font_style = params.get("font_style", "normal")
        underline = params.get("underline", False)
        uppercase = params.get("uppercase", True)
        return (
            content,
            font_file,
            font_size,
            letter_spacing,
            line_spacing,
            font_weight,
            font_style,
            underline,
            uppercase,
            round(scale_factor, 4)
        )

    def _store_text_geometry_cache(self, cache_key, geometry):
        if cache_key in self._text_geometry_cache:
            self._text_geometry_cache.move_to_end(cache_key)
        self._text_geometry_cache[cache_key] = geometry
        if len(self._text_geometry_cache) > self._max_text_geometry_cache:
            self._text_geometry_cache.popitem(last=False)

    def _extract_transform(self, shape_canvas: Dict[str, Any]):
        position = {"x": 0.0, "y": 0.0}
        rotation_angle = 0.0
        scale = {"x": 1.0, "y": 1.0}
        skew = {"x": 0.0, "y": 0.0}

        if shape_canvas and isinstance(shape_canvas, dict):
            position = shape_canvas.get("position", position) or position
            rotation_angle = shape_canvas.get("rotation", rotation_angle)
            scale = shape_canvas.get("scale", scale) or scale
            skew = shape_canvas.get("skew", skew) or skew

        return position, rotation_angle, scale, skew

    def _apply_text_transformations(self, geometry, render_width: int, render_height: int,
                                    position: Dict[str, float], rotation_angle: float,
                                    scale: Dict[str, float], skew: Dict[str, float]):
        if geometry is None or geometry.is_empty:
            return geometry

        transformed = geometry
        sx = scale.get("x", 1.0)
        sy = scale.get("y", 1.0)
        if sx != 1.0 or sy != 1.0:
            transformed = affinity.scale(transformed, xfact=sx, yfact=sy, origin=(0, 0))

        if rotation_angle:
            transformed = affinity.rotate(transformed, rotation_angle, origin=(0, 0), use_radians=False)

        skew_x = skew.get("x", 0.0)
        skew_y = skew.get("y", 0.0)

        def shear_to_degrees(value: float) -> float:
            if value == 0:
                return 0.0
            try:
                return math.degrees(math.atan(value))
            except Exception:
                return 0.0

        xs = shear_to_degrees(skew_x)
        ys = shear_to_degrees(skew_y)
        if xs != 0.0 or ys != 0.0:
            transformed = affinity.skew(transformed, xs=xs, ys=ys, origin=(0, 0))

        center_x = render_width / 2.0
        center_y = render_height / 2.0
        pos_x = position.get("x", 0.0) * render_width
        pos_y = position.get("y", 0.0) * render_height

        transformed = affinity.translate(transformed, xoff=center_x + pos_x, yoff=center_y + pos_y)
        return transformed

    def _render_text_to_tensors(self, width: int, height: int, shape_color: str, bg_color: str,
                                transparent_bg: bool, stroke_color: str, stroke_width: int,
                                text_params: Dict[str, Any],
                                position: Dict[str, float], rotation_angle: float,
                                scale: Dict[str, float], skew: Dict[str, float]):
        scale_factor = 4
        render_width = width * scale_factor
        render_height = height * scale_factor

        geometry = self._build_text_geometry(text_params, scale_factor)
        if geometry is None or geometry.is_empty:
            raise ValueError("Text geometry is empty, please check text parameters or font file.")

        transformed_geometry = self._apply_text_transformations(
            geometry, render_width, render_height, position, rotation_angle, scale, skew
        )

        bg_rgb = self.hex_to_rgb(bg_color) + (255,)
        shape_rgb = self.hex_to_rgb(shape_color) + (255,)
        stroke_rgb = self.hex_to_rgb(stroke_color) + (255,) if stroke_width > 0 else None

        avg_scale = (scale.get('x', 1.0) + scale.get('y', 1.0)) / 2.0
        frontend_scale_comp = 1.0 / FRONTEND_CANVAS_SCALE if FRONTEND_CANVAS_SCALE not in (0, None) else 1.0
        compensated_stroke_width = 0
        if stroke_width > 0:
            compensated_stroke_width = stroke_width * scale_factor * avg_scale * frontend_scale_comp * FRONTEND_STROKE_COMPENSATION

        fill_mask_img = self._geometry_to_mask(transformed_geometry, render_width, render_height)
        fill_mask = np.array(fill_mask_img, dtype=np.uint8)

        font_weight_value = str(text_params.get("font_weight", "normal")).lower()
        if font_weight_value == "bold" and fill_mask.max() > 0:
            font_size_param = text_params.get("font_size", 128)
            try:
                font_size_value = float(font_size_param)
            except (TypeError, ValueError):
                font_size_value = 128.0
            bold_kernel = max(1, int(font_size_value * scale_factor * 0.02))
            bold_kernel = max(1, min(bold_kernel + (bold_kernel + 1) % 2, int(scale_factor * 32)))
            try:
                kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (bold_kernel, bold_kernel))
                fill_mask = cv2.dilate(fill_mask, kernel, iterations=1)
            except Exception as e:
                logger.warning(f"Bold mask dilation failed: {e}")

        stroke_mask = None
        if stroke_rgb is not None and compensated_stroke_width > 0 and fill_mask.max() > 0:
            fill_binary = (fill_mask > 0).astype(np.uint8)
            background = (1 - fill_binary).astype(np.uint8)
            stroke_radius = max(0.5, compensated_stroke_width / 2.0)

            try:
                dist_out = cv2.distanceTransform(background * 255, cv2.DIST_L2, 5)
                dist_in = cv2.distanceTransform(fill_binary * 255, cv2.DIST_L2, 5)
                outer_ring = np.logical_and(background == 1, dist_out <= stroke_radius)
                inner_ring = np.logical_and(fill_binary == 1, dist_in <= stroke_radius)
                stroke_mask = np.where(np.logical_or(outer_ring, inner_ring), 255, 0).astype(np.uint8)
            except Exception as e:
                logger.warning(f"Failed to compute text stroke via distance transform: {e}")
                stroke_mask = None

        # 组合填充与描边
        if transparent_bg:
            composite = Image.new("RGBA", (render_width, render_height), (0, 0, 0, 0))
        else:
            composite = Image.new("RGBA", (render_width, render_height), bg_rgb)

        if stroke_mask is not None:
            stroke_alpha = Image.fromarray(stroke_mask, mode="L")
            stroke_image = Image.new("RGBA", (render_width, render_height), stroke_rgb)
            stroke_image.putalpha(stroke_alpha)
            composite = Image.alpha_composite(composite, stroke_image)

        if fill_mask.max() > 0:
            fill_alpha = Image.fromarray(fill_mask, mode="L")
            fill_image = Image.new("RGBA", (render_width, render_height), shape_rgb)
            fill_image.putalpha(fill_alpha)
            composite = Image.alpha_composite(composite, fill_image)

        composite = composite.resize((width, height), Image.LANCZOS)
        image_array = np.array(composite).astype(np.float32) / 255.0
        image_tensor = torch.from_numpy(image_array).unsqueeze(0)

        mask_array = image_array[:, :, 3]
        mask_tensor = torch.from_numpy(mask_array).unsqueeze(0)

        # 背景
        if transparent_bg:
            bg_image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        else:
            bg_image = Image.new("RGBA", (width, height), bg_rgb)
        bg_array = np.array(bg_image).astype(np.float32) / 255.0
        bg_tensor = torch.from_numpy(bg_array).unsqueeze(0)

        return image_tensor, mask_tensor, bg_tensor





    def execute(self, width: int, height: int, shape_type: str, shape_color: str,
               bg_color: str, transparent_bg: bool, stroke_color: str, stroke_width: int,
               shape_canvas: Dict[str, Any], shape_data: List[Dict[str, Any]] = None) -> Tuple[List[torch.Tensor], List[torch.Tensor], List[torch.Tensor]]:
        """
        Execute the shape generation with transformations and anti-aliasing.
        Supports both single shape processing and batch processing via shape_data.

        Args:
            width: Output image width
            height: Output image height
            shape_type: Type of shape to generate
            shape_color: Shape fill color in hex
            bg_color: Background color in hex
            transparent_bg: Whether background should be transparent
            stroke_color: Stroke color in hex
            stroke_width: Stroke width in pixels
            shape_canvas: Canvas data from frontend
            shape_data: List of shape properties for batch processing

        Returns:
            tuple: (image_tensor_list, mask_tensor_list, bg_image_tensor_list)
        """

        # 检查是否有shape_data输入，决定是单次处理还是批量处理
        # 同时检查前端是否标记了有shape_data输入端口连接
        has_shape_data_input = shape_canvas.get("has_shape_data_input", False) if shape_canvas else False

        if (shape_data and isinstance(shape_data, list) and len(shape_data) > 0) or has_shape_data_input:
            # 如果前端标记有shape_data输入端口连接，但实际数据为空，则使用默认数据
            if not shape_data or not isinstance(shape_data, list) or len(shape_data) == 0:
                logger.warning("Frontend indicates shape_data input connected but no data provided, using default single shape")
                shape_data = [{}]  # 使用空字典作为默认数据

            logger.info(f"Batch processing mode: {len(shape_data)} shapes to generate")
            return self._execute_batch(width, height, shape_type, shape_color, bg_color, transparent_bg,
                                     stroke_color, stroke_width, shape_canvas, shape_data)
        else:
            logger.info("Single shape processing mode")
            return self._execute_single(width, height, shape_type, shape_color, bg_color, transparent_bg,
                                      stroke_color, stroke_width, shape_canvas)

    def _execute_single(self, width: int, height: int, shape_type: str, shape_color: str,
                       bg_color: str, transparent_bg: bool, stroke_color: str, stroke_width: int,
                       shape_canvas: Dict[str, Any]) -> Tuple[List[torch.Tensor], List[torch.Tensor], List[torch.Tensor]]:
        """
        Execute single shape generation (original functionality).
        """
        logger.info(f"Executing single shape with shape_type: {shape_type}, params: {shape_canvas.get('shape_params', '{}')}, rotation: {shape_canvas.get('rotation', 0.0)}°, scale: {shape_canvas.get('scale', {'x': 1, 'y': 1})}, skew: {shape_canvas.get('skew', {'x': 0, 'y': 0})}, position: {shape_canvas.get('position', {'x': 0.0, 'y': 0.0})}")

        # 使用超采样抗锯齿 - 提高质量
        scale_factor = 4  # 增加超采样倍数以获得更平滑的曲线
        render_width = width * scale_factor
        render_height = height * scale_factor

        # 始终定义 bg_rgb，即使使用透明背景
        bg_rgb = self.hex_to_rgb(bg_color) + (255,)

        if transparent_bg:
            image = Image.new("RGBA", (render_width, render_height), (0, 0, 0, 0))
        else:
            image = Image.new("RGBA", (render_width, render_height), bg_rgb)


        # 其中stageWidth = width * CANVAS_SCALE_FACTOR, stageHeight = height * CANVAS_SCALE_FACTOR (CANVAS_SCALE_FACTOR=0.75)
        # 后端超采样渲染时，需要匹配前端的视觉比例：min(width, height) * scale_factor * 0.5
        shape_size = min(width, height) * scale_factor * 0.5  # 0.5为固定数字，作为后端图形缩放因子，为了匹配前端图形大小
        logger.info(f"Size calculation: width={width}, height={height}, shape_size={shape_size}, scale_factor={scale_factor}")
        rotation_angle = 0.0
        position = {"x": 0.0, "y": 0.0}
        scale = {"x": 1.0, "y": 1.0}
        skew = {"x": 0.0, "y": 0.0}

        if shape_canvas and isinstance(shape_canvas, dict):
            position = shape_canvas.get("position", {"x": 0.0, "y": 0.0})
            rotation_angle = shape_canvas.get("rotation", 0.0)
            scale = shape_canvas.get("scale", {"x": 1.0, "y": 1.0})
            skew = shape_canvas.get("skew", {"x": 0.0, "y": 0.0})
            logger.info(f"Shape canvas data: position={position}, rotation={rotation_angle}, scale={scale}, skew={skew}")

        params = {}
        try:
            if shape_canvas and isinstance(shape_canvas, dict):
                params = json.loads(shape_canvas.get("shape_params", "{}"))
        except (json.JSONDecodeError, TypeError):
            params = {}

        if shape_type == "text":
            text_params = params if isinstance(params, dict) else {}
            try:
                image_tensor, mask_tensor, bg_tensor = self._render_text_to_tensors(
                    width, height, shape_color, bg_color, transparent_bg,
                    stroke_color, stroke_width,
                    text_params, position, rotation_angle, scale, skew
                )
            except Exception as e:
                logger.error(f"Failed to render text shape: {e}")
                default_image = torch.zeros((1, height, width, 3), dtype=torch.float32)
                default_mask = torch.zeros((1, height, width), dtype=torch.float32)
                default_bg = torch.zeros((1, height, width, 3), dtype=torch.float32)
                return ([default_image], [default_mask], [default_bg])

            return ([image_tensor], [mask_tensor], [bg_tensor])

        # 对于方形，需要缩放圆角半径以匹配前端视觉效果
        if shape_type == "square" and "corner_radius" in params:
            max_frontend_radius = 50
            max_backend_radius = 258

            # 缩放圆角半径：前端值(0-50) -> 后端值(0到max_backend_radius)
            frontend_radius = params["corner_radius"]
            scaled_radius = (frontend_radius / max_frontend_radius) * max_backend_radius
            params["corner_radius"] = scaled_radius
            logger.info(f"Scaled corner radius: frontend={frontend_radius} -> backend={scaled_radius:.2f}, max_backend_radius={max_backend_radius:.2f}")

        # 生成初始形状坐标（以形状中心为原点）
        shape_coords = self.generate_shape_coordinates(shape_type, shape_size, params)
        if isinstance(shape_coords, dict) and shape_coords.get("type") == "donut":
            logger.info(f"Generated donut coordinates: {len(shape_coords['outer'])} outer points, {len(shape_coords['inner'])} inner points")
        else:
            logger.info(f"Generated shape coordinates: {len(shape_coords)} points, first few: {shape_coords[:3] if shape_coords else 'N/A'}")

        shape_rgb = self.hex_to_rgb(shape_color) + (255,)
        stroke_rgb = self.hex_to_rgb(stroke_color) + (255,) if stroke_width > 0 else None

        stroke_only_shape_types = {"sunburst"}
        stroke_only_shape = shape_type in stroke_only_shape_types

        # 检查是否是甜甜圈特殊几何体
        if isinstance(shape_coords, dict) and shape_coords.get("type") == "donut":
            # 分别变换外圆和内圆坐标
            transformed_outer = self.apply_simple_transform(shape_coords["outer"], scale, rotation_angle, skew, position, render_width, render_height, scale_factor)
            transformed_inner = self.apply_simple_transform(shape_coords["inner"], scale, rotation_angle, skew, position, render_width, render_height, scale_factor)
            transformed_coords = {"type": "donut", "outer": transformed_outer, "inner": transformed_inner}
        else:
            # 应用变换到形状坐标
            transformed_coords = self.apply_simple_transform(shape_coords, scale, rotation_angle, skew, position, render_width, render_height, scale_factor)

        # 使用Shapely渲染形状和描边
        # 计算综合缩放因子：超采样因子 × 形状缩放因子（取平均值）
        avg_scale = (scale.get('x', 1.0) + scale.get('y', 1.0)) / 2.0
        frontend_scale_comp = 1.0 / FRONTEND_CANVAS_SCALE if FRONTEND_CANVAS_SCALE not in (0, None) else 1.0
        compensated_stroke_width = stroke_width * scale_factor * avg_scale * frontend_scale_comp * FRONTEND_STROKE_COMPENSATION if stroke_width > 0 else 0

        join_style = 1  # round

        # 检查是否是甜甜圈特殊几何体
        if isinstance(transformed_coords, dict) and transformed_coords.get("type") == "donut":
            self.render_donut_with_shapely(image, transformed_coords["outer"], transformed_coords["inner"],
                                           shape_rgb, stroke_rgb, compensated_stroke_width, join_style,
                                           bg_rgb, transparent_bg)
        else:
            if shape_type == "spiral":
                self.render_spiral_with_shapely(image, transformed_coords, stroke_rgb,
                                                compensated_stroke_width, join_style, bg_rgb, transparent_bg)
            else:
                self.render_shape_with_shapely(image, transformed_coords, shape_rgb, stroke_rgb,
                                               compensated_stroke_width, join_style, stroke_only_shape)

        # 记录坐标范围（对于甜甜圈，记录外圆的范围）
        if isinstance(transformed_coords, dict) and transformed_coords.get("type") == "donut":
            outer_coords = transformed_coords["outer"]
            logger.info(f"Final donut coordinate range - Outer: x=[{min(x for x, _ in outer_coords) if outer_coords else 'N/A'}, {max(x for x, _ in outer_coords) if outer_coords else 'N/A'}], y=[{min(y for _, y in outer_coords) if outer_coords else 'N/A'}, {max(y for _, y in outer_coords) if outer_coords else 'N/A'}]")
        else:
            logger.info(f"Final coordinate range: x=[{min(x for x, _ in transformed_coords) if transformed_coords else 'N/A'}, {max(x for x, _ in transformed_coords) if transformed_coords else 'N/A'}], y=[{min(y for _, y in transformed_coords) if transformed_coords else 'N/A'}, {max(y for _, y in transformed_coords) if transformed_coords else 'N/A'}]")

        # 缩小图像以抗锯齿 - 使用高质量滤波器
        image = image.resize((width, height), Image.LANCZOS)

        image_array = np.array(image).astype(np.float32) / 255.0
        image_tensor = torch.from_numpy(image_array).unsqueeze(0)

        # 生成掩码 - 始终使用透明背景方法
        # 创建单独的透明背景图像用于掩码生成（反向蒙版）
        mask_image = Image.new("RGBA", (render_width, render_height), (0, 0, 0, 0))

        # 检查是否是甜甜圈特殊几何体
        if isinstance(transformed_coords, dict) and transformed_coords.get("type") == "donut":
            self.render_donut_with_shapely(mask_image, transformed_coords["outer"], transformed_coords["inner"],
                                           shape_rgb, stroke_rgb, compensated_stroke_width, join_style,
                                           (0, 0, 0, 255), True)
        else:
            if shape_type == "spiral":
                self.render_spiral_with_shapely(mask_image, transformed_coords, stroke_rgb,
                                                compensated_stroke_width, join_style, (0, 0, 0, 255), True)
            else:
                self.render_shape_with_shapely(mask_image, transformed_coords, shape_rgb, stroke_rgb,
                                               compensated_stroke_width, join_style, stroke_only_shape)

        # 缩小掩码图像
        mask_image = mask_image.resize((width, height), Image.LANCZOS)
        mask_array = np.array(mask_image).astype(np.float32)[:, :, 3] / 255.0

        mask_tensor = torch.from_numpy(mask_array).unsqueeze(0)

        # Generate background image
        if transparent_bg:
            # Create transparent background
            bg_image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        else:
            # Create solid color background
            bg_rgb = self.hex_to_rgb(bg_color) + (255,)
            bg_image = Image.new("RGBA", (width, height), bg_rgb)

        bg_array = np.array(bg_image).astype(np.float32) / 255.0
        bg_tensor = torch.from_numpy(bg_array).unsqueeze(0)

        # 返回列表以保持输出格式一致
        return ([image_tensor], [mask_tensor], [bg_tensor])

    def render_donut_with_shapely(self, image: Image.Image, outer_coords: List[Tuple[float, float]],
                                 inner_coords: List[Tuple[float, float]], shape_color: Tuple[int, int, int, int],
                                 stroke_color: Tuple[int, int, int, int], stroke_width: float, join_style: int = 1,
                                 bg_color: Tuple[int, int, int, int] = (0, 0, 0, 255), transparent_bg: bool = False) -> None:
        """
        使用Shapely渲染甜甜圈形状，确保平滑的描边和正确的背景处理

        Args:
            draw: ImageDraw对象
            outer_coords: 外圆坐标
            inner_coords: 内圆坐标
            shape_color: 填充颜色
            stroke_color: 描边颜色
            stroke_width: 描边宽度
            join_style: 连接样式
        """
        if not outer_coords or not inner_coords or len(outer_coords) < 3 or len(inner_coords) < 3:
            return

        try:
            donut_geometry = Polygon(outer_coords, [inner_coords])
            self.render_geometry_with_shapely(image, donut_geometry, shape_color, stroke_color, stroke_width, join_style)
            logger.info("Donut rendered using unified pixel geometry method")
        except Exception as e:
            logger.error(f"Shapely donut rendering error: {e}")
            try:
                draw = ImageDraw.Draw(image, 'RGBA')
                int_outer_coords = [(round(x), round(y)) for x, y in outer_coords]
                int_inner_coords = [(round(x), round(y)) for x, y in inner_coords]
                if int_outer_coords and int_outer_coords[0] != int_outer_coords[-1]:
                    int_outer_coords.append(int_outer_coords[0])
                if int_inner_coords and int_inner_coords[0] != int_inner_coords[-1]:
                    int_inner_coords.append(int_inner_coords[0])
                draw.polygon(int_outer_coords, fill=shape_color, outline=None)
                draw.polygon(int_inner_coords, fill=(0, 0, 0, 0) if transparent_bg else bg_color, outline=None)
                if stroke_width > 0:
                    stroke_width_int = max(1, round(stroke_width))
                    for i in range(len(int_outer_coords) - 1):
                        draw.line([int_outer_coords[i], int_outer_coords[i + 1]],
                                  fill=stroke_color, width=stroke_width_int)
                    for i in range(len(int_inner_coords) - 1):
                        draw.line([int_inner_coords[i], int_inner_coords[i + 1]],
                                  fill=stroke_color, width=stroke_width_int)
                logger.info("Donut rendered using fallback polygon method")
            except Exception as e2:
                logger.error(f"Fallback donut rendering also failed: {e2}")

    def render_geometry_with_shapely(self, image: Image.Image, geometry,
                                     shape_color: Tuple[int, int, int, int],
                                     stroke_color: Tuple[int, int, int, int],
                                     stroke_width: float, join_style: int = 1) -> None:
        """
        使用统一的像素描边逻辑渲染任意Shapely几何体
        """
        try:
            if geometry is None or geometry.is_empty:
                return

            geom_type = geometry.geom_type
            treat_as_line = geom_type in ("LineString", "MultiLineString") or (hasattr(geometry, "area") and geometry.area == 0)

            if treat_as_line:
                if stroke_color is None or stroke_width <= 0:
                    return
                buffer_width = max(0.5, stroke_width / 2.0)
                try:
                    buffered = geometry.buffer(buffer_width, join_style=join_style, cap_style=1)
                except Exception as buffer_err:
                    logger.warning(f"Line geometry buffer failed: {buffer_err}")
                    buffered = geometry.buffer(buffer_width, cap_style=1)
                if buffered is None or buffered.is_empty:
                    return
                self._apply_geometry_pixel_layer(image, buffered, stroke_color, None, 0)
                return

            self._apply_geometry_pixel_layer(image, geometry, shape_color, stroke_color, stroke_width)
        except Exception as e:
            logger.error(f"Shapely geometry rendering error: {e}")

    def render_shape_with_shapely(self, image: Image.Image, coords: List[Tuple[float, float]],
                                 shape_color: Tuple[int, int, int, int], stroke_color: Tuple[int, int, int, int],
                                 stroke_width: float, join_style: int = 1, stroke_only: bool = False) -> None:
        """
        使用Shapely渲染形状和描边

        Args:
            draw: ImageDraw对象
            coords: 形状坐标
            shape_color: 填充颜色
            stroke_color: 描边颜色
            stroke_width: 描边宽度
            join_style: 连接样式 (1=圆角, 2=斜角, 3=平角)
            cap_style: 端点样式 (1=圆形, 2=扁平, 3=方形)
        """
        if not coords or (not stroke_only and len(coords) < 3):
            return

        try:
            if stroke_only:
                segments = []
                it_range = len(coords) - 1
                for idx in range(0, it_range, 2):
                    start_pt = coords[idx]
                    end_pt = coords[idx + 1] if idx + 1 < len(coords) else None
                    if end_pt is not None:
                        segments.append((start_pt, end_pt))
                if not segments:
                    return
                geometry = MultiLineString(segments)
            else:
                polygon = Polygon(coords)
                geometry = polygon

            self.render_geometry_with_shapely(image, geometry, shape_color, stroke_color, stroke_width, join_style)

        except Exception as e:
            logger.error(f"Shapely rendering error: {e}")
            draw = ImageDraw.Draw(image, 'RGBA')
            if stroke_only:
                stroke_width_int = max(1, round(stroke_width))
                for idx in range(0, len(coords) - 1, 2):
                    start_pt = coords[idx]
                    end_pt = coords[idx + 1] if idx + 1 < len(coords) else None
                    if end_pt is not None:
                        draw.line([start_pt, end_pt], fill=stroke_color, width=stroke_width_int)
            else:
                int_coords = [(round(x), round(y)) for x, y in coords]
                if int_coords and int_coords[0] != int_coords[-1]:
                    int_coords.append(int_coords[0])
                draw.polygon(int_coords, fill=shape_color, outline=None)

    def _draw_shapely_geometry(self, draw: ImageDraw.ImageDraw, geometry, color: Tuple[int, int, int, int],
                             bg_color: Tuple[int, int, int, int] = (0, 0, 0, 255), transparent_bg: bool = False) -> None:
        """绘制Shapely几何体"""
        if geometry.is_empty:
            return

        if geometry.geom_type == 'Polygon':
            # 绘制多边形
            exterior = list(geometry.exterior.coords)
            int_coords = [(round(x), round(y)) for x, y in exterior]
            if int_coords and int_coords[0] != int_coords[-1]:
                int_coords.append(int_coords[0])
            draw.polygon(int_coords, fill=color, outline=None)

            # 绘制孔洞（如果有）
            for interior in geometry.interiors:
                hole_coords = [(round(x), round(y)) for x, y in interior.coords]
                if hole_coords and hole_coords[0] != hole_coords[-1]:
                    hole_coords.append(hole_coords[0])
                # 根据背景设置使用正确颜色填充孔洞
                if transparent_bg:
                    draw.polygon(hole_coords, fill=(0, 0, 0, 0), outline=None)
                else:
                    draw.polygon(hole_coords, fill=bg_color, outline=None)

        elif geometry.geom_type == 'MultiPolygon':
            # 绘制多个多边形
            for polygon in geometry.geoms:
                self._draw_shapely_geometry(draw, polygon, color, bg_color, transparent_bg)

    def render_spiral_with_shapely(self, image: Image.Image, coords: List[Tuple[float, float]],
                                 stroke_color: Tuple[int, int, int, int], stroke_width: float, join_style: int = 1,
                                 bg_color: Tuple[int, int, int, int] = (0, 0, 0, 255), transparent_bg: bool = False) -> None:
        """
        使用Shapely渲染螺旋形状（使用LineString而不是Polygon）
        """
        if not coords or len(coords) < 2:
            return

        try:
            line = LineString(coords)
            self.render_geometry_with_shapely(image, line, (0, 0, 0, 0), stroke_color, stroke_width, join_style)

        except Exception as e:
            logger.error(f"Shapely spiral rendering error: {e}")
            # 出错时回退到简单线条绘制
            draw = ImageDraw.Draw(image, 'RGBA')
            int_coords = [(round(x), round(y)) for x, y in coords]
            stroke_width_int = max(1, round(stroke_width))
            for i in range(len(int_coords) - 1):
                draw.line([int_coords[i], int_coords[i + 1]],
                         fill=stroke_color, width=stroke_width_int)

    def _execute_batch(self, width: int, height: int, shape_type: str, shape_color: str,
                      bg_color: str, transparent_bg: bool, stroke_color: str, stroke_width: int,
                      shape_canvas: Dict[str, Any], shape_data: List[Dict[str, Any]]) -> Tuple[List[torch.Tensor], List[torch.Tensor], List[torch.Tensor]]:
        """
        Execute batch shape generation with multiple shape properties.

        Args:
            width: Output image width
            height: Output image height
            shape_type: Type of shape to generate
            shape_color: Shape fill color in hex
            bg_color: Background color in hex
            transparent_bg: Whether background should be transparent
            stroke_color: Stroke color in hex
            stroke_width: Stroke width in pixels
            shape_canvas: Canvas data from frontend
            shape_data: List of shape properties for batch processing

        Returns:
            tuple: (image_tensor_list, mask_tensor_list, bg_image_tensor_list)
        """
        image_tensors = []
        mask_tensors = []
        bg_tensors = []

        # 转换描边样式参数为Shapely常量
        join_style = 1

        # 使用超采样抗锯齿 - 提高质量
        scale_factor = 4
        render_width = width * scale_factor
        render_height = height * scale_factor

        # 基础形状大小计算
        base_shape_size = min(width, height) * scale_factor * 0.5

        # 解析前端画布数据作为默认属性
        frontend_props = {}
        if shape_canvas and isinstance(shape_canvas, dict):
            frontend_props = {
                "position": shape_canvas.get("position", {"x": 0.0, "y": 0.0}),
                "rotation": shape_canvas.get("rotation", 0.0),
                "scale": shape_canvas.get("scale", {"x": 1.0, "y": 1.0}),
                "skew": shape_canvas.get("skew", {"x": 0.0, "y": 0.0})
            }

        params = {}
        try:
            if shape_canvas and isinstance(shape_canvas, dict):
                params = json.loads(shape_canvas.get("shape_params", "{}"))
        except (json.JSONDecodeError, TypeError):
            params = {}

        # 处理每个形状数据
        for i, shape_props in enumerate(shape_data):
            logger.info(f"Processing shape {i+1}/{len(shape_data)}: {shape_props}")

            try:
                merged_props = self.merge_properties(frontend_props, shape_props)

                position = merged_props.get("position", {"x": 0.0, "y": 0.0})
                rotation_angle = merged_props.get("rotation", 0.0)
                scale = merged_props.get("scale", {"x": 1.0, "y": 1.0})
                skew = merged_props.get("skew", {"x": 0.0, "y": 0.0})

                current_shape_color = shape_props.get("shape_color", shape_color)
                current_bg_color = shape_props.get("bg_color", bg_color)
                current_transparent_bg = shape_props.get("transparent_bg", transparent_bg)
                current_stroke_color = shape_props.get("stroke_color", stroke_color)
                current_stroke_width = shape_props.get("stroke_width", stroke_width)
                current_shape_type = shape_props.get("shape_type", shape_type)

                bg_rgb = self.hex_to_rgb(current_bg_color) + (255,)

                if current_transparent_bg:
                    image = Image.new("RGBA", (render_width, render_height), (0, 0, 0, 0))
                else:
                    image = Image.new("RGBA", (render_width, render_height), bg_rgb)

                current_params = {}
                if isinstance(params, dict):
                    current_params.update(params)

                shape_params_override = shape_props.get("shape_params")
                if isinstance(shape_params_override, str):
                    try:
                        current_params.update(json.loads(shape_params_override))
                    except (json.JSONDecodeError, TypeError):
                        logger.warning(f"Failed to parse shape_params for batch index {i}")
                elif isinstance(shape_params_override, dict):
                    current_params.update(shape_params_override)

                if current_shape_type == "square" and "corner_radius" in current_params:
                    max_frontend_radius = 50
                    max_backend_radius = 258
                    frontend_radius = current_params["corner_radius"]
                    scaled_radius = (frontend_radius / max_frontend_radius) * max_backend_radius
                    current_params["corner_radius"] = scaled_radius

                if current_shape_type == "text":
                    text_params = current_params
                    image_tensor, mask_tensor, bg_tensor = self._render_text_to_tensors(
                        width, height, current_shape_color, current_bg_color, current_transparent_bg,
                        current_stroke_color, current_stroke_width, text_params,
                        position, rotation_angle, scale, skew
                    )
                    image_tensors.append(image_tensor)
                    mask_tensors.append(mask_tensor)
                    bg_tensors.append(bg_tensor)
                    logger.info(f"Text shape {i+1} processed successfully")
                    continue

                shape_coords = self.generate_shape_coordinates(current_shape_type, base_shape_size, current_params)

                shape_rgb = self.hex_to_rgb(current_shape_color) + (255,)
                stroke_rgb = self.hex_to_rgb(current_stroke_color) + (255,) if current_stroke_width > 0 else None

                stroke_only_shape = current_shape_type in {"sunburst"}

                if isinstance(shape_coords, dict) and shape_coords.get("type") == "donut":
                    transformed_outer = self.apply_simple_transform(shape_coords["outer"], scale, rotation_angle, skew, position, render_width, render_height, scale_factor)
                    transformed_inner = self.apply_simple_transform(shape_coords["inner"], scale, rotation_angle, skew, position, render_width, render_height, scale_factor)
                    transformed_coords = {"type": "donut", "outer": transformed_outer, "inner": transformed_inner}
                else:
                    transformed_coords = self.apply_simple_transform(shape_coords, scale, rotation_angle, skew, position, render_width, render_height, scale_factor)

                avg_scale = (scale.get('x', 1.0) + scale.get('y', 1.0)) / 2.0
                frontend_scale_comp = 1.0 / FRONTEND_CANVAS_SCALE if FRONTEND_CANVAS_SCALE not in (0, None) else 1.0
                compensated_stroke_width = current_stroke_width * scale_factor * avg_scale * frontend_scale_comp * FRONTEND_STROKE_COMPENSATION if current_stroke_width > 0 else 0

                if isinstance(transformed_coords, dict) and transformed_coords.get("type") == "donut":
                    self.render_donut_with_shapely(image, transformed_coords["outer"], transformed_coords["inner"],
                                                  shape_rgb, stroke_rgb, compensated_stroke_width, join_style,
                                                  bg_rgb, current_transparent_bg)
                else:
                    if current_shape_type == "spiral":
                        self.render_spiral_with_shapely(image, transformed_coords, stroke_rgb,
                                                        compensated_stroke_width, join_style, bg_rgb, current_transparent_bg)
                    else:
                        self.render_shape_with_shapely(image, transformed_coords, shape_rgb, stroke_rgb,
                                                       compensated_stroke_width, join_style, stroke_only_shape)

                image = image.resize((width, height), Image.LANCZOS)
                image_array = np.array(image).astype(np.float32) / 255.0
                image_tensor = torch.from_numpy(image_array).unsqueeze(0)

                mask_image = Image.new("RGBA", (render_width, render_height), (0, 0, 0, 0))

                if isinstance(transformed_coords, dict) and transformed_coords.get("type") == "donut":
                    self.render_donut_with_shapely(mask_image, transformed_coords["outer"], transformed_coords["inner"],
                                                  shape_rgb, stroke_rgb, compensated_stroke_width, join_style,
                                                  (0, 0, 0, 255), True)
                else:
                    if current_shape_type == "spiral":
                        self.render_spiral_with_shapely(mask_image, transformed_coords, stroke_rgb,
                                                        compensated_stroke_width, join_style, (0, 0, 0, 255), True)
                    else:
                        self.render_shape_with_shapely(mask_image, transformed_coords, shape_rgb, stroke_rgb,
                                                       compensated_stroke_width, join_style, stroke_only_shape)

                mask_image = mask_image.resize((width, height), Image.LANCZOS)
                mask_array = np.array(mask_image).astype(np.float32)[:, :, 3] / 255.0
                mask_tensor = torch.from_numpy(mask_array).unsqueeze(0)

                if current_transparent_bg:
                    bg_image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
                else:
                    bg_rgb = self.hex_to_rgb(current_bg_color) + (255,)
                    bg_image = Image.new("RGBA", (width, height), bg_rgb)

                bg_array = np.array(bg_image).astype(np.float32) / 255.0
                bg_tensor = torch.from_numpy(bg_array).unsqueeze(0)

                image_tensors.append(image_tensor)
                mask_tensors.append(mask_tensor)
                bg_tensors.append(bg_tensor)

                logger.info(f"Shape {i+1} processed successfully")

            except Exception as e:
                logger.error(f"Error processing shape {i+1}: {e}")
                # 出错时添加默认图像
                default_image = torch.zeros((1, height, width, 3), dtype=torch.float32)
                default_mask = torch.zeros((1, height, width), dtype=torch.float32)
                default_bg = torch.zeros((1, height, width, 3), dtype=torch.float32)

                image_tensors.append(default_image)
                mask_tensors.append(default_mask)
                bg_tensors.append(default_bg)

        logger.info(f"Batch processing completed: {len(image_tensors)} images generated")
        return (image_tensors, mask_tensors, bg_tensors)

NODE_CLASS_MAPPINGS = {
    "XIS_CreateShape": XIS_CreateShape
}
