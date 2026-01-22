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
        修复：增加螺旋线条粗度以匹配前端视觉效果
        """
        # 参数验证和限制
        turns = max(1, min(10, turns))
        points_per_turn = max(30, min(100, points_per_turn))
        # 直接使用原始值，但为了匹配前端视觉效果，大幅度增加宽度
        start_width = max(0.0, float(start_width))
        end_width = max(0.0, float(end_width))
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

        # 为了匹配前端视觉效果，大幅放大宽度参数以克服渲染引擎差异
        # 螺旋的宽度应该随着螺旋位置变化，保持起始和结束宽度的相对比例
        amplified_start_width = max(5.0, start_width * 4)  # 大幅放大以匹配前端粗度
        amplified_end_width = max(5.0, end_width * 4)    # 大幅放大以匹配前端粗度

        # 计算边界点（外侧和内侧）
        boundary_points = SpiralGenerator._calculate_boundary_points(
            center_points, amplified_start_width, amplified_end_width, smoothness
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
            logger.info(f"Original width params: start_width={start_width}, end_width={end_width}")
            logger.info(f"Amplified width params: start_width={amplified_start_width}, end_width={amplified_end_width}")
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
        """计算螺旋的边界点，形成闭合的填充区域
        修复：确保螺旋两端都有自然的半圆形封口
        """
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

        # 获取螺旋的中心点（假设螺旋是从中心开始的）
        cx = center_points[0]['x'] if center_points else 0
        cy = center_points[0]['y'] if center_points else 0

        # 计算外侧和内侧边界点
        outer_points = []
        inner_points = []

        for i, point in enumerate(center_points):
            # 根据螺旋进展插值宽度
            current_width = start_width + (end_width - start_width) * point['progress']
            half_width = current_width / 2

            # 对螺旋起始部分应用更平滑的渐进式处理，避免高曲率导致的自相交
            # 在螺旋起始处，逐渐增大偏移距离，而不是立即应用全宽度
            progress_factor = point['progress']

            # 使用更平滑的余弦过渡函数来创建无缝过渡效果
            # 在起始处缓慢增加宽度影响，在后续部分正常应用宽度
            if progress_factor < 0.15:  # 在前15%的部分应用渐进式处理
                # 使用平滑的余弦过渡函数，提供更自然的过渡
                adjusted_factor = 0.5 * (1 - math.cos(progress_factor * math.pi / 0.15))  # 余弦过渡
                effective_half_width = half_width * adjusted_factor
            else:
                effective_half_width = half_width

            # 当有效半宽度很小时，直接使用中心点避免浮点误差
            if effective_half_width < 0.001:
                # 直接使用中心点，确保内外侧点完全相同
                center_point = (point['x'], point['y'])
                outer_points.append(center_point)
                inner_points.append(center_point)
            else:
                # 外侧点 - 垂直于切线方向向外
                outer_x = point['x'] + math.cos(point['tangent_angle'] + math.pi/2) * effective_half_width
                outer_y = point['y'] + math.sin(point['tangent_angle'] + math.pi/2) * effective_half_width
                outer_points.append((outer_x, outer_y))

                # 内侧点 - 垂直于切线方向向内
                inner_x = point['x'] + math.cos(point['tangent_angle'] - math.pi/2) * effective_half_width
                inner_y = point['y'] + math.sin(point['tangent_angle'] - math.pi/2) * effective_half_width
                inner_points.append((inner_x, inner_y))

        # 构建闭合路径：外侧路径 + 终点封口 + 内侧路径（反向）+ 起点封口（贝塞尔曲线过渡）
        boundary_points = []

        # 添加外侧路径
        boundary_points.extend(outer_points)

        # 添加终点封口（半圆形封口，与前端保持一致）
        if len(outer_points) > 0 and len(inner_points) > 0:
            last_point_info = center_points[-1]
            last_tangent_angle = last_point_info['tangent_angle']

            # 从最后外侧点到最后内侧点画半圆封口
            last_outer = outer_points[-1]
            last_inner = inner_points[-1]

            # 计算半圆的参数
            end_radius = abs(end_width) / 2
            end_steps = max(4, int(8 * smoothness))  # 平滑度影响封口点数

            # 使用中心点和角度来画半圆封口
            # 中心点在内外两点的中点
            center_x = (last_outer[0] + last_inner[0]) / 2
            center_y = (last_outer[1] + last_inner[1]) / 2

            # 半圆从外侧开始，沿着切线垂直方向转180度到内侧
            start_angle = last_tangent_angle + math.pi/2  # 从外侧开始
            end_angle = last_tangent_angle - math.pi/2    # 到达内侧

            for i in range(end_steps + 1):
                angle_ratio = i / end_steps
                current_angle = start_angle + (end_angle - start_angle) * angle_ratio
                x = center_x + math.cos(current_angle) * end_radius
                y = center_y + math.sin(current_angle) * end_radius
                boundary_points.append((x, y))

        # 添加内侧路径（反向，确保路径连续）
        boundary_points.extend(reversed(inner_points))

        # 添加起点封口（使用贝塞尔曲线进行平滑过渡，模仿前端实现）
        # 注意：需要考虑到渐进式处理的起始点
        if len(outer_points) > 0 and len(inner_points) > 0:
            first_point_info = center_points[0] if center_points else None
            first_outer = outer_points[0]
            first_inner = inner_points[0]

            # 只有first_point_info存在时才添加起点封口
            if first_point_info:
                # 使用与inner_points/outer_points相同的渐进式处理逻辑计算有效宽度
                progress_factor = first_point_info['progress']
                current_width = start_width + (end_width - start_width) * progress_factor
                half_width = current_width / 2

                # 应用与边界点生成相同的渐进式处理
                # 添加最小调整因子，避免宽度为0导致的薄区域
                if progress_factor < 0.15:
                    adjusted_factor = 0.5 * (1 - math.cos(progress_factor * math.pi / 0.15))
                    # 确保最小调整因子，避免宽度为0
                    adjusted_factor = max(0.01, adjusted_factor)
                    effective_half_width = half_width * adjusted_factor
                else:
                    effective_half_width = half_width

                # 只有当有效宽度足够大时才添加半圆形封口
                # 使用与边界点生成相同的阈值（0.001）
                if effective_half_width > 0.001:
                    # 使用半圆形封口，与终点封口保持一致
                    first_tangent_angle = first_point_info['tangent_angle']
                    start_radius = effective_half_width
                    start_steps = max(4, int(8 * smoothness))  # 平滑度影响封口点数

                    # 使用中心点和角度来画半圆封口
                    # 中心点在内外两点的中点
                    center_x = (first_inner[0] + first_outer[0]) / 2
                    center_y = (first_inner[1] + first_outer[1]) / 2

                    # 半圆从内侧开始，沿着切线垂直方向转180度到外侧
                    # 注意方向：内侧在切线负垂直方向，外侧在切线正垂直方向
                    start_angle = first_tangent_angle - math.pi/2  # 从内侧开始
                    end_angle = first_tangent_angle + math.pi/2    # 到达外侧

                    for i in range(start_steps + 1):
                        angle_ratio = i / start_steps
                        current_angle = start_angle + (end_angle - start_angle) * angle_ratio
                        x = center_x + math.cos(current_angle) * start_radius
                        y = center_y + math.sin(current_angle) * start_radius
                        boundary_points.append((x, y))
                else:
                    # 有效宽度太小，跳过封口
                    # 直接确保路径闭合：将最后一个点设置为第一个点（first_outer）
                    if boundary_points:
                        boundary_points[-1] = first_outer

        # 确保多边形精确闭合（第一个点和最后一个点相同）
        if boundary_points and boundary_points[0] != boundary_points[-1]:
            # 直接设置最后一个点为第一个点，确保精确闭合
            boundary_points[-1] = boundary_points[0]

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