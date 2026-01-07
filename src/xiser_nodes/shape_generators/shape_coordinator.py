"""
形状协调器模块
整合所有形状生成器，提供统一的形状坐标生成接口
"""

import math
import logging
from typing import List, Tuple, Dict, Any

from .base_shape_generator import BaseShapeGenerator
from .spiral_generator import SpiralGenerator
from .sunburst_generator import SunburstGenerator

logger = logging.getLogger(__name__)


class ShapeCoordinator:
    """形状协调器类，整合所有形状生成功能"""

    def __init__(self):
        self.base_generator = BaseShapeGenerator()
        self.spiral_generator = SpiralGenerator()
        self.sunburst_generator = SunburstGenerator()

    def generate_shape_coordinates(self, shape_type: str, size: float,
                                 params: Dict[str, Any] = None) -> List[Tuple[float, float]]:
        """
        根据类型和参数生成形状坐标（在变换之前）。

        Args:
            shape_type: 要生成的形状类型
            size: 形状半径（像素）- 前端传递的是基础半径
            params: 形状参数字典（例如角度、内半径）

        Returns:
            坐标点列表（相对于形状中心在0,0）
        """
        # size是前端传递的基础半径，直接使用
        radius = size
        params = params or {}

        cx, cy = 0, 0  # 形状中心为 (0, 0)
        coords = []

        logger.info(f"Generating {shape_type} coordinates with radius: {radius}, "
                   f"sides/points: {params.get('sides') or params.get('points') or 'N/A'}, "
                   f"inner_radius: {params.get('inner_radius', 0)}, angle: {params.get('angle', 360)}")

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
                    logger.info(f"Sector donut path generated with {len(outer_coords)} outer points, "
                               f"{len(inner_coords)} inner points, angle: {angle}°")
                else:
                    # 对于完整甜甜圈（角度为0或360），返回分离的外圆和内圆坐标
                    # 这样可以使用专门的甜甜圈渲染方法
                    outer_coords.append(outer_coords[0])  # 闭合外圆
                    inner_coords.append(inner_coords[0])  # 闭合内圆
                    # 返回一个特殊标记表示这是甜甜圈几何体
                    coords = {"type": "donut", "outer": outer_coords, "inner": inner_coords}
                    logger.info(f"Full circle donut path generated with {len(outer_coords)} outer points, "
                               f"{len(inner_coords)} inner points")
            else:
                # 普通圆形或扇形
                if angle < 360:
                    coords = self.base_generator.generate_circle_sector(cx, cy, radius, angle, include_center=True)
                else:
                    coords = self.base_generator.generate_circle(cx, cy, radius, segments)

        elif shape_type == "polygon":
            sides = params.get("sides", 4)
            corner_radius = params.get("corner_radius", 0)
            coords = self.base_generator.generate_regular_polygon(cx, cy, radius, sides, corner_radius)

        elif shape_type == "star":
            points = params.get("points", 5)
            inner_ratio = params.get("inner_ratio", 0.4)
            coords = self.base_generator.generate_star(cx, cy, radius, points, inner_ratio)

        elif shape_type == "heart":
            path_offset = params.get("path_offset", 0)
            coords = self.base_generator.generate_heart(cx, cy, radius, path_offset)

        elif shape_type == "flower":
            petals = params.get("petals", 5)
            petal_length = params.get("petal_length", 0.5)
            coords = self.base_generator.generate_flower(cx, cy, radius, petals, petal_length)

        elif shape_type == "spiral":
            # 使用新的螺旋参数
            start_width = params.get("startWidth", 15)
            end_width = params.get("endWidth", 15)
            turns = params.get("turns", 4)
            points_per_turn = params.get("pointsPerTurn", 100)
            line_length = params.get("lineLength", 1.0)
            smoothness = 1.0  # 固定平滑度

            # 修复宽度参数：前端传递的是原始值，但后端期望的是乘以超采样因子和补偿因子的值
            # 超采样因子 = 4，额外补偿 = 2.5，总共 = 10倍
            width_scale_factor = 4 * 2.5  # 10倍
            scaled_start_width = start_width * width_scale_factor
            scaled_end_width = end_width * width_scale_factor
            logger.info(f"Spiral width scaling: frontend start={start_width}, end={end_width} -> backend start={scaled_start_width:.1f}, end={scaled_end_width:.1f} (scale={width_scale_factor})")

            coords = self.spiral_generator.generate_spiral_with_width(
                cx, cy, size,  # 使用与其他形状一致的size
                scaled_start_width, scaled_end_width, turns, points_per_turn, smoothness, line_length
            )

        elif shape_type == "sunburst":
            ray_count = params.get("ray_count", 10)
            ray_length = params.get("ray_length", 1.0)
            start_width = params.get("start_width", -1)
            end_width = params.get("end_width", 30)

            # 修复宽度参数：前端传递的是原始值，但后端期望的是乘以超采样因子和补偿因子的值
            # 超采样因子 = 4，额外补偿 = 2.5，总共 = 10倍
            width_scale_factor = 4 * 2.5  # 10倍
            scaled_start_width = start_width * width_scale_factor
            scaled_end_width = end_width * width_scale_factor
            logger.info(f"Sunburst width scaling: frontend start={start_width}, end={end_width} -> backend start={scaled_start_width:.1f}, end={scaled_end_width:.1f} (scale={width_scale_factor})")

            trapezoids = self.sunburst_generator.generate_sunburst(cx, cy, size, ray_count, ray_length,
                                                                  scaled_start_width, scaled_end_width)
            # 返回特殊标记，表示这是射线形状的多边形列表
            coords = {"type": "sunburst", "trapezoids": trapezoids}

        else:
            coords = self.base_generator.generate_circle(cx, cy, radius, params.get("segments", 64))

        rotation_deg = params.get("shape_rotation", 0)
        if rotation_deg not in (None, 0, 0.0):
            coords = self._apply_shape_rotation(coords, rotation_deg)

        return coords

    def _apply_shape_rotation(self, coords, rotation_deg):
        try:
            angle = math.radians(float(rotation_deg))
        except (TypeError, ValueError):
            return coords

        if abs(angle) < 1e-8:
            return coords

        cos_a = math.cos(angle)
        sin_a = math.sin(angle)

        def rotate_points(points):
            rotated = []
            for x, y in points:
                rx = x * cos_a - y * sin_a
                ry = x * sin_a + y * cos_a
                rotated.append((rx, ry))
            return rotated

        if isinstance(coords, dict):
            if coords.get("type") == "donut":
                return {
                    "type": "donut",
                    "outer": rotate_points(coords.get("outer", [])),
                    "inner": rotate_points(coords.get("inner", []))
                }
            if coords.get("type") == "sunburst":
                rotated_traps = []
                for trapezoid in coords.get("trapezoids", []):
                    rotated_traps.append(rotate_points(trapezoid))
                return {"type": "sunburst", "trapezoids": rotated_traps}
            return coords

        if isinstance(coords, list):
            return rotate_points(coords)

        return coords
