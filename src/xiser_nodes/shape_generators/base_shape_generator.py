"""
基础形状生成器模块
包含所有几何形状的坐标生成函数
"""

import math
import logging
from typing import List, Tuple, Dict, Any

logger = logging.getLogger(__name__)


class BaseShapeGenerator:
    """基础形状生成器类"""

    @staticmethod
    def generate_circle(cx: float, cy: float, radius: float, segments: int) -> List[Tuple[float, float]]:
        """生成圆形坐标。"""
        points = []
        for i in range(segments + 1):
            angle = 2 * math.pi * i / segments
            x = cx + radius * math.cos(angle)
            y = cy + radius * math.sin(angle)
            points.append((x, y))
        return points

    @staticmethod
    def generate_circle_sector(cx: float, cy: float, radius: float, angle: float, include_center: bool = True) -> List[Tuple[float, float]]:
        """
        生成圆形扇形坐标。

        Args:
            cx: 中心x坐标
            cy: 中心y坐标
            radius: 扇形半径
            angle: 扇形角度（度）
            include_center: 是否在路径中包含中心点

        Returns:
            坐标点列表
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

    @staticmethod
    def generate_regular_polygon(cx: float, cy: float, radius: float, sides: int,
                                 corner_radius: float = 0.0) -> List[Tuple[float, float]]:
        """
        生成正多边形坐标，0°在3点钟方向。

        Args:
            cx: 中心x坐标
            cy: 中心y坐标
            radius: 多边形半径
            sides: 边数

        Returns:
            坐标点列表
        """
        points: List[Tuple[float, float]] = []
        for i in range(sides):
            angle = 2 * math.pi * i / sides - math.pi / 2  # 偏移到 3 点钟方向
            x = cx + radius * math.cos(angle)
            y = cy + radius * math.sin(angle)
            points.append((x, y))
        if corner_radius and corner_radius > 0:
            return BaseShapeGenerator._round_polygon(points, corner_radius)
        return points

    @staticmethod
    def _round_polygon(points: List[Tuple[float, float]], corner_radius: float) -> List[Tuple[float, float]]:
        """为多边形应用圆角。"""
        if not points or corner_radius <= 0:
            return points

        rounded: List[Tuple[float, float]] = []
        total = len(points)
        epsilon = 1e-5

        for i in range(total):
            prev_point = points[i - 1]
            curr_point = points[i]
            next_point = points[(i + 1) % total]

            v_prev = (curr_point[0] - prev_point[0], curr_point[1] - prev_point[1])
            v_next = (next_point[0] - curr_point[0], next_point[1] - curr_point[1])
            len_prev = math.hypot(v_prev[0], v_prev[1])
            len_next = math.hypot(v_next[0], v_next[1])

            if len_prev < epsilon or len_next < epsilon:
                rounded.append(curr_point)
                continue

            dir_in = (-v_prev[0] / len_prev, -v_prev[1] / len_prev)
            dir_out = (v_next[0] / len_next, v_next[1] / len_next)

            dot = max(-1.0, min(1.0, dir_in[0] * dir_out[0] + dir_in[1] * dir_out[1]))
            angle = math.acos(dot)

            if angle < epsilon:
                rounded.append(curr_point)
                continue

            half_angle = angle / 2.0
            tan_half = math.tan(half_angle)
            max_offset = min(len_prev, len_next) * 0.5

            if abs(tan_half) < epsilon:
                offset = max_offset
            else:
                desired_offset = corner_radius / tan_half
                offset = min(desired_offset, max_offset)

            actual_radius = offset * (tan_half if abs(tan_half) >= epsilon else 1.0)
            start_point = (curr_point[0] + dir_in[0] * offset, curr_point[1] + dir_in[1] * offset)
            end_point = (curr_point[0] + dir_out[0] * offset, curr_point[1] + dir_out[1] * offset)

            bisector = (dir_in[0] + dir_out[0], dir_in[1] + dir_out[1])
            bisector_length = math.hypot(bisector[0], bisector[1])
            if bisector_length < epsilon:
                rounded.append(start_point)
                rounded.append(end_point)
                continue

            bisector_dir = (bisector[0] / bisector_length, bisector[1] / bisector_length)
            sin_half = math.sin(half_angle)
            center_distance = actual_radius / (sin_half if abs(sin_half) >= epsilon else 1.0)
            center = (curr_point[0] + bisector_dir[0] * center_distance,
                      curr_point[1] + bisector_dir[1] * center_distance)

            start_angle = math.atan2(start_point[1] - center[1], start_point[0] - center[0])
            end_angle = math.atan2(end_point[1] - center[1], end_point[0] - center[0])
            sweep = end_angle - start_angle
            if sweep <= 0:
                sweep += 2 * math.pi

            segments = max(4, min(24, int(max(actual_radius, 1.0) / 4)))
            rounded.append(start_point)
            for s in range(1, segments):
                angle_step = start_angle + sweep * (s / segments)
                rounded.append((
                    center[0] + math.cos(angle_step) * actual_radius,
                    center[1] + math.sin(angle_step) * actual_radius
                ))
            rounded.append(end_point)

        return rounded

    @staticmethod
    def generate_star(cx: float, cy: float, radius: float, points: int, inner_ratio: float = 0.4) -> List[Tuple[float, float]]:
        """
        生成星形坐标，0°在3点钟方向。

        Args:
            cx: 中心x坐标
            cy: 中心y坐标
            radius: 星形外半径
            points: 星形点数
            inner_ratio: 内半径与外半径的比例

        Returns:
            坐标点列表
        """
        coords = []
        for i in range(points * 2):
            angle = math.pi * i / points - math.pi / 2  # 偏移到 3 点钟方向
            r = radius if i % 2 == 0 else radius * inner_ratio
            x = cx + r * math.cos(angle)
            y = cy + r * math.sin(angle)
            coords.append((x, y))
        return coords

    @staticmethod
    def generate_heart(cx: float, cy: float, radius: float, path_offset: float) -> List[Tuple[float, float]]:
        """生成心形坐标，带路径偏移。"""
        points = []
        segments = 128  # 增加段数以获得更平滑的曲线
        offset_factor = path_offset * 0.3  # 缩放偏移以获得合理效果

        for i in range(segments + 1):
            t = i / segments * math.pi * 2

            # 经典心形参数方程
            x = 16 * math.pow(math.sin(t), 3)
            y = -(13 * math.cos(t) - 5 * math.cos(2*t) - 2 * math.cos(3*t) - math.cos(4*t))

            # 归一化并计算偏移方向
            normalized_x = x / 16
            normalized_y = y / 16

            # 计算偏移法向量
            length = math.sqrt(normalized_x * normalized_x + normalized_y * normalized_y)
            offset_x = normalized_x / (length or 1) * offset_factor
            offset_y = normalized_y / (length or 1) * offset_factor

            # 应用偏移和缩放
            final_x = (normalized_x + offset_x) * radius
            final_y = (normalized_y + offset_y) * radius

            points.append((cx + final_x, cy + final_y))

        logger.info(f"Heart generated with path_offset: {path_offset}")
        return points

    @staticmethod
    def generate_flower(cx: float, cy: float, radius: float, petals: int, petal_length: float) -> List[Tuple[float, float]]:
        """生成花形坐标。"""
        points = []
        petal_count = max(3, min(12, petals))
        length_factor = max(0.1, min(1.3, petal_length))
        segments = 128  # 增加段数以获得更平滑的曲线

        for i in range(segments + 1):
            t = i / segments * math.pi * 2

            # 花形参数方程，与前端完全匹配
            r = radius * (0.65 + 0.5 * math.sin(petal_count * t) * length_factor)

            x = r * math.cos(t)
            y = r * math.sin(t)

            points.append((cx + x, cy + y))

        logger.info(f"Flower generated with petals: {petal_count}, petal_length: {length_factor}")
        return points
