"""
太阳光芒形状生成器模块
匹配前端梯形射线生成逻辑
"""

import math
import logging
from typing import List, Tuple, Union

logger = logging.getLogger(__name__)


class SunburstGenerator:
    """太阳光芒形状生成器类"""

    @staticmethod
    def generate_sunburst(cx: float, cy: float, size: float, ray_count: int, ray_length: float,
                         start_width: float = -1, end_width: float = 10) -> List[List[Tuple[float, float]]]:
        """
        生成太阳光芒/射线坐标，使用梯形射线匹配前端逻辑。
        返回多个独立的梯形多边形列表。

        Args:
            cx: 中心点x坐标
            cy: 中心点y坐标
            size: 基础尺寸
            ray_count: 射线数量
            ray_length: 射线长度因子
            start_width: 起点宽度（-1表示从中心点开始）
            end_width: 末端宽度

        Returns:
            多个梯形多边形的列表，每个梯形是一个独立的坐标列表
        """
        trapezoids = []
        ray_count = max(4, min(32, ray_count))
        ray_length = max(0.3, min(5.0, ray_length))
        # 宽度参数范围与前端UI保持一致
        start_width = max(-100, min(100, start_width))  # 前端UI范围：-100到100
        end_width = max(1, min(200, end_width))        # 前端UI范围：1到200

        # 计算射线长度（与前端一致）
        # 前端：outerRadius = lengthFactor * maxRadius，其中maxRadius = baseSize
        # 后端：size已经是经过超采样和缩放计算后的尺寸，需要调整
        length_factor = min(ray_length, 5.0)  # 限制防止重叠
        outer_radius = length_factor * size  # 射线长度，使用完整size

        # 移除宽度缩放因子，与前端保持一致
        # 前端没有使用宽度缩放，后端也不应该使用
        scaled_start_width = start_width
        scaled_end_width = end_width

        logger.info(f"Width scaling removed: using original widths start={start_width}, end={end_width}")

        logger.info(f"Sunburst parameters: center=({cx},{cy}), outerRadius={outer_radius:.2f}, "
                   f"startWidth={start_width}->{scaled_start_width:.2f}, endWidth={end_width}->{scaled_end_width:.2f}")

        # 生成每个梯形射线（与前端完全一致的算法）
        for i in range(ray_count):
            angle = 2 * math.pi * i / ray_count
            dx = math.cos(angle)
            dy = math.sin(angle)
            px = -dy  # 垂直于射线方向的向量
            py = dx

            # 计算射线末端坐标
            end_x = cx + dx * outer_radius
            end_y = cy + dy * outer_radius

            # 计算梯形四个顶点（与前端完全一致的算法）
            # 直接从中心点开始，使用与前端相同的公式
            # 使用缩放后的宽度，确保射线有足够的宽度，看起来像明显的射线而不是分割线
            inner_left_x = cx + px * (scaled_start_width / 2)
            inner_left_y = cy + py * (scaled_start_width / 2)
            inner_right_x = cx - px * (scaled_start_width / 2)
            inner_right_y = cy - py * (scaled_start_width / 2)
            outer_left_x = end_x - px * (scaled_end_width / 2)
            outer_left_y = end_y - py * (scaled_end_width / 2)
            outer_right_x = end_x + px * (scaled_end_width / 2)
            outer_right_y = end_y + py * (scaled_end_width / 2)

            # 生成独立的梯形多边形
            trapezoid = [
                (inner_left_x, inner_left_y),
                (outer_left_x, outer_left_y),
                (outer_right_x, outer_right_y),
                (inner_right_x, inner_right_y),
                (inner_left_x, inner_left_y)  # 闭合多边形
            ]
            trapezoids.append(trapezoid)

        logger.info(f"Sunburst generated with {ray_count} trapezoid rays, length: {ray_length}, "
                   f"start_width: {start_width}, end_width: {end_width}")
        return trapezoids