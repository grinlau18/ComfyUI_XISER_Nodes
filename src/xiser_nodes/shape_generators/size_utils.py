"""
尺寸计算工具模块
统一处理形状尺寸相关的计算
"""

import logging
from typing import Dict, Any, Tuple

logger = logging.getLogger(__name__)


class SizeUtils:
    """尺寸计算工具类"""

    # 常量定义
    BASE_REFERENCE_SIZE = 512  # 默认参考尺寸
    BASE_SIZE_RATIO = 0.25     # 基础尺寸比例（半径）
    SIZE_ADJUSTMENT_FACTOR = 1.0 / 0.75  # 从75%到100%的调整因子

    @staticmethod
    def compute_base_shape_size(width: int, height: int, shape_canvas: Dict[str, Any] = None) -> float:
        """
        计算基础形状尺寸

        Args:
            width: 输出图像宽度
            height: 输出图像高度
            shape_canvas: 前端传递的画布数据

        Returns:
            基础形状尺寸（半径）
        """
        # 如果前端提供了基础尺寸，需要根据实际输出尺寸进行缩放
        # 前端使用固定的512参考尺寸，但后端应该使用实际输出尺寸
        if shape_canvas and isinstance(shape_canvas, dict):
            base_shape_size = shape_canvas.get("base_shape_size")
            if base_shape_size is not None:
                try:
                    base_radius = float(base_shape_size)
                    if base_radius > 0:
                        logger.info(f"Using frontend base shape size: {base_radius}")
                        # 前端使用固定的512参考尺寸，需要根据实际输出尺寸进行缩放
                        frontend_reference = 512  # 前端使用的固定参考尺寸
                        actual_reference = min(width, height)
                        if actual_reference != frontend_reference:
                            scale_factor = actual_reference / frontend_reference
                            scaled_radius = base_radius * scale_factor
                            logger.info(f"Scaling frontend base size: {base_radius} × ({actual_reference}/{frontend_reference}) = {scaled_radius}")
                            return scaled_radius
                        return base_radius
                except (TypeError, ValueError):
                    pass

        # 使用与前端的计算一致
        # 前端使用固定的512参考尺寸，但后端应该根据实际输出尺寸进行缩放
        # 这样可以确保图形大小与前端显示一致
        frontend_reference = 512  # 前端使用的固定参考尺寸
        actual_reference = min(width, height)

        # 计算缩放因子
        if actual_reference != frontend_reference:
            scale_factor = actual_reference / frontend_reference
            # 前端基础尺寸计算：512 * 0.25 * (1/0.75)
            frontend_base_size = frontend_reference * SizeUtils.BASE_SIZE_RATIO * SizeUtils.SIZE_ADJUSTMENT_FACTOR
            # 根据实际输出尺寸缩放
            base_size = frontend_base_size * scale_factor
            logger.info(f"Scaled base shape size: frontend_ref={frontend_reference}, actual_ref={actual_reference}, "
                       f"scale_factor={scale_factor:.3f}, frontend_base={frontend_base_size:.1f}, result={base_size:.1f}")
        else:
            # 如果输出尺寸正好是512，使用与前端完全相同的计算
            base_size = actual_reference * SizeUtils.BASE_SIZE_RATIO * SizeUtils.SIZE_ADJUSTMENT_FACTOR
            logger.info(f"Computed base shape size (512 reference): reference={actual_reference}, "
                       f"ratio={SizeUtils.BASE_SIZE_RATIO}, "
                       f"adjustment={SizeUtils.SIZE_ADJUSTMENT_FACTOR}, "
                       f"result={base_size}")

        return base_size

    @staticmethod
    def adjust_for_shape_type(base_size: float, shape_type: str) -> float:
        """
        根据形状类型调整尺寸

        Args:
            base_size: 基础尺寸
            shape_type: 形状类型

        Returns:
            调整后的尺寸
        """
        # 螺旋和太阳光芒形状现在使用与前端一致的基础尺寸计算
        # 不再需要额外的0.5缩放因子，因为基础尺寸计算已经与前端对齐
        if shape_type in ["sunburst", "spiral"]:
            logger.info(f"{shape_type} size calculation: base={base_size}, final={base_size}")
            return base_size

        return base_size

    @staticmethod
    def compute_render_size(width: int, height: int, scale_factor: float = 1.0) -> Tuple[int, int]:
        """
        计算渲染尺寸

        Args:
            width: 输出图像宽度
            height: 输出图像高度
            scale_factor: 缩放因子

        Returns:
            (render_width, render_height)
        """
        render_width = int(width * scale_factor)
        render_height = int(height * scale_factor)
        return render_width, render_height

    @staticmethod
    def compute_stroke_width(stroke_width: int, scale: Dict[str, float]) -> float:
        """
        计算补偿后的描边宽度

        Args:
            stroke_width: 原始描边宽度
            scale: 缩放比例

        Returns:
            补偿后的描边宽度
        """
        if stroke_width <= 0:
            return 0.0

        avg_scale = (scale.get('x', 1.0) + scale.get('y', 1.0)) / 2.0
        compensated_stroke_width = stroke_width * avg_scale
        return compensated_stroke_width

    @staticmethod
    def log_size_details(width: int, height: int, base_size: float, final_size: float, shape_type: str):
        """
        记录尺寸计算详情

        Args:
            width: 输出宽度
            height: 输出高度
            base_size: 基础尺寸
            final_size: 最终尺寸
            shape_type: 形状类型
        """
        logger.info(f"Size calculation for {shape_type}:")
        logger.info(f"  Output dimensions: {width}x{height}")
        logger.info(f"  Base shape size: {base_size:.1f}")
        logger.info(f"  Final shape size: {final_size:.1f}")
        logger.info(f"  Size ratio: {final_size / min(width, height) * 100:.1f}% of min dimension")

    @staticmethod
    def validate_dimensions(width: int, height: int, min_size: int = 64, max_size: int = 4096) -> Tuple[int, int]:
        """
        验证输出尺寸

        Args:
            width: 宽度
            height: 高度
            min_size: 最小尺寸
            max_size: 最大尺寸

        Returns:
            验证后的 (width, height)
        """
        width = max(min_size, min(width, max_size))
        height = max(min_size, min(height, max_size))
        return width, height