"""
螺旋形状生成器模块（基于形状填充的新版本）
"""

import math
import logging
from typing import List, Tuple, Dict, Any

logger = logging.getLogger(__name__)


class SpiralGenerator:
    """螺旋形状生成器类（基于形状填充）"""

    @staticmethod
    def generate_spiral_with_width(
        cx: float, cy: float, max_radius: float,
        start_width: float, end_width: float, turns: int,
        points_per_turn: int, smoothness: float, line_length: float = 0.5,
        scale_factor: float = 1.0
    ) -> List[Tuple[float, float]]:
        """
        生成基于形状填充的螺旋坐标
        返回闭合的填充区域边界点
        """
        # 参数验证和限制
        turns = max(1, min(10, turns))
        points_per_turn = max(30, min(100, points_per_turn))
        # 宽度参数已经考虑了超采样因子和额外补偿，所以放宽限制
        start_width = max(0.0, min(200.0, start_width))  # 20 * 4 * 2.5 = 200
        end_width = max(0.0, min(500.0, end_width))     # 50 * 4 * 2.5 = 500
        smoothness = max(0.0, min(1.0, smoothness))

        total_points = turns * points_per_turn
        min_radius = max(start_width / 2, 0.5)

        # 计算匹配前端的螺旋尺寸
        # 前端：maxRadius = size * lineLength
        # 后端：max_radius 是经过特殊处理的size，需要乘以line_length来匹配前端
        frontend_max_radius = max_radius * line_length  # 需要乘以line_length来匹配前端

        # 生成螺旋中心线点
        center_points = SpiralGenerator._generate_center_points(
            cx, cy, frontend_max_radius, min_radius, turns, points_per_turn, start_width, end_width
        )

        # 计算边界点（外侧和内侧）
        boundary_points = SpiralGenerator._calculate_boundary_points(
            center_points, start_width, end_width, smoothness
        )

        # 计算边界范围用于调试
        if boundary_points:
            x_coords = [x for x, y in boundary_points]
            y_coords = [y for x, y in boundary_points]
            min_x, max_x = min(x_coords), max(x_coords)
            min_y, max_y = min(y_coords), max(y_coords)
            actual_width = max_x - min_x
            actual_height = max_y - min_y

            # 调试信息：显示所有关键参数
            logger.info(f"=== SPIRAL DEBUG INFO ===")
            logger.info(f"Input params: cx={cx}, cy={cy}, max_radius={max_radius}")
            logger.info(f"Width params: start_width={start_width}, end_width={end_width}")
            logger.info(f"Shape params: turns={turns}, points_per_turn={points_per_turn}, line_length={line_length}")
            logger.info(f"Calculated: frontend_max_radius={frontend_max_radius}, min_radius={min_radius}")
            logger.info(f"Center points count: {len(center_points)}")
            logger.info(f"Boundary points count: {len(boundary_points)}")
            logger.info(f"Spiral bounds: x=[{min_x:.2f}, {max_x:.2f}], y=[{min_y:.2f}, {max_y:.2f}]")
            logger.info(f"Spiral size: width={actual_width:.2f}, height={actual_height:.2f}")

            # 检查中心点的宽度范围
            if center_points:
                min_width = min(p['width'] for p in center_points)
                max_width = max(p['width'] for p in center_points)
                logger.info(f"Width range in center points: [{min_width:.2f}, {max_width:.2f}]")

            logger.info(f"=== END SPIRAL DEBUG ===")

        return boundary_points

    @staticmethod
    def _generate_center_points(
        cx: float, cy: float, max_radius: float, min_radius: float,
        turns: int, points_per_turn: int, start_width: float, end_width: float
    ) -> List[Dict[str, Any]]:
        """生成螺旋中心线点，包含位置、宽度和切线角度信息"""
        total_points = turns * points_per_turn
        points = []

        for i in range(total_points):
            progress = i / total_points
            angle = (i / points_per_turn) * 2 * math.pi
            radius = min_radius + progress * (max_radius - min_radius)

            # 计算当前点坐标
            x = cx + radius * math.cos(angle)
            y = cy + radius * math.sin(angle)

            # 稳定的切线计算（使用前后点平均）
            prev_i = max(i - 1, 0)
            next_i = min(i + 1, total_points - 1)

            prev_angle = (prev_i / points_per_turn) * 2 * math.pi
            prev_radius = min_radius + (prev_i / total_points) * (max_radius - min_radius)
            prev_x = cx + prev_radius * math.cos(prev_angle)
            prev_y = cy + prev_radius * math.sin(prev_angle)

            next_angle = (next_i / points_per_turn) * 2 * math.pi
            next_radius = min_radius + (next_i / total_points) * (max_radius - min_radius)
            next_x = cx + next_radius * math.cos(next_angle)
            next_y = cy + next_radius * math.sin(next_angle)

            # 切线方向（使用前后点向量）
            tangent_angle = math.atan2(next_y - prev_y, next_x - prev_x)

            points.append({
                'x': x, 'y': y,
                'width': start_width + (end_width - start_width) * progress,
                'tangent_angle': tangent_angle,
                'progress': progress
            })

        return points

    @staticmethod
    def _calculate_boundary_points(
        center_points: List[Dict[str, Any]],
        start_width: float, end_width: float, smoothness: float
    ) -> List[Tuple[float, float]]:
        """计算螺旋的边界点，形成闭合的填充区域"""
        if len(center_points) < 5:
            # 回退到简单圆形
            cx = center_points[0]['x'] if center_points else 0
            cy = center_points[0]['y'] if center_points else 0
            radius = 50
            points = []
            for i in range(36):
                angle = 2 * math.pi * i / 36
                x = cx + radius * math.cos(angle)
                y = cy + radius * math.sin(angle)
                points.append((x, y))
            return points

        # 计算外侧和内侧边界点
        outer_points = []
        inner_points = []

        for point in center_points:
            half_width = point['width'] / 2
            # 外侧点
            outer_x = point['x'] + math.cos(point['tangent_angle'] + math.pi/2) * half_width
            outer_y = point['y'] + math.sin(point['tangent_angle'] + math.pi/2) * half_width
            outer_points.append((outer_x, outer_y))

            # 内侧点
            inner_x = point['x'] + math.cos(point['tangent_angle'] - math.pi/2) * half_width
            inner_y = point['y'] + math.sin(point['tangent_angle'] - math.pi/2) * half_width
            inner_points.append((inner_x, inner_y))

        # 构建闭合路径：外侧路径 + 终点封口 + 内侧路径（反向） + 起点封口
        boundary_points = []

        # 添加外侧路径
        boundary_points.extend(outer_points)

        # 添加终点封口（简化版半圆）
        last_point = center_points[-1]
        last_outer = outer_points[-1]
        last_inner = inner_points[-1]

        # 终点半圆封口
        end_radius = last_point['width'] / 2
        start_angle = last_point['tangent_angle'] + math.pi/2
        end_angle = last_point['tangent_angle'] - math.pi/2

        steps = max(8, int(20 * smoothness))
        for i in range(1, steps):
            angle = start_angle - (start_angle - end_angle) * (i / steps)
            x = last_point['x'] + math.cos(angle) * end_radius
            y = last_point['y'] + math.sin(angle) * end_radius
            boundary_points.append((x, y))

        # 添加内侧路径（反向）
        boundary_points.extend(reversed(inner_points))

        # 添加起点封口（简化版贝塞尔曲线）
        first_point = center_points[0]
        first_outer = outer_points[0]
        first_inner = inner_points[0]

        # 起点贝塞尔封口
        control_x = first_point['x'] - math.cos(first_point['tangent_angle']) * first_point['width'] * 0.3
        control_y = first_point['y'] - math.sin(first_point['tangent_angle']) * first_point['width'] * 0.3

        steps = max(5, int(10 * smoothness))
        for i in range(1, steps):
            t = i / steps
            x = (1-t)**2 * first_inner[0] + 2*(1-t)*t * control_x + t**2 * first_outer[0]
            y = (1-t)**2 * first_inner[1] + 2*(1-t)*t * control_y + t**2 * first_outer[1]
            boundary_points.append((x, y))

        return boundary_points

    # 向后兼容的旧方法
    @staticmethod
    def generate_spiral(cx: float, cy: float, max_radius: float, turns: int, density: float, scale_factor: float = 1.0) -> List[Tuple[float, float]]:
        """向后兼容的旧方法，生成螺旋坐标"""
        # 使用默认参数调用新方法
        return SpiralGenerator.generate_spiral_with_width(
            cx, cy, max_radius,
            start_width=5, end_width=15, turns=turns,
            points_per_turn=80, smoothness=0.7,
            scale_factor=scale_factor
        )