"""
描边工具模块
统一处理描边相关的计算和颜色转换
"""

import logging
from typing import Dict, Optional, Tuple

from .color_utils import ColorUtils
from .param_standardizer import ParamStandardizer

logger = logging.getLogger(__name__)


class StrokeUtils:
    """描边工具类"""

    FRONTEND_CANVAS_SCALE = 1.0  # 与 render_utils.py 保持一致
    FRONTEND_STROKE_COMPENSATION = 0.9  # 前端描边补偿因子

    @staticmethod
    def compute_compensated_stroke_width(
        stroke_width: int,
        scale: Dict[str, float],
        shape_type: str,
        scale_factor: float = 1.0
    ) -> float:
        """
        计算补偿后的描边宽度，包含超采样因子

        Args:
            stroke_width: 原始描边宽度（像素）
            scale: 缩放参数 {'x': float, 'y': float}
            shape_type: 形状类型
            scale_factor: 超采样因子（默认1.0）

        Returns:
            补偿后的描边宽度（浮点数）
        """
        if stroke_width <= 0:
            return 0.0

        # 使用参数标准化器计算基础补偿
        base_compensated = ParamStandardizer.standardize_stroke_params(
            stroke_width, scale, shape_type
        )

        # 应用超采样因子
        compensated = base_compensated * scale_factor

        logger.debug(
            f"Stroke width computed for {shape_type}: "
            f"{stroke_width} -> {base_compensated:.2f} (base) -> {compensated:.2f} (with scale_factor={scale_factor})"
        )

        return compensated

    @staticmethod
    def hex_to_stroke_rgba(
        hex_color: str,
        stroke_width: int,
        default_alpha: int = 255
    ) -> Optional[Tuple[int, int, int, int]]:
        """
        将十六进制颜色转换为描边RGBA元组

        Args:
            hex_color: 十六进制颜色字符串
            stroke_width: 描边宽度，如果<=0则返回None
            default_alpha: 默认透明度（0-255）

        Returns:
            (r, g, b, a) 元组，如果描边宽度<=0则返回None
        """
        if stroke_width <= 0:
            return None

        try:
            rgb = ColorUtils.hex_to_rgb(hex_color)
            return rgb + (default_alpha,)
        except Exception as e:
            logger.warning(f"Failed to convert stroke color '{hex_color}': {e}")
            # 返回默认白色描边
            return (255, 255, 255, default_alpha)

    @staticmethod
    def hex_to_fill_rgba(
        hex_color: str,
        default_alpha: int = 255
    ) -> Tuple[int, int, int, int]:
        """
        将十六进制颜色转换为填充RGBA元组

        Args:
            hex_color: 十六进制颜色字符串
            default_alpha: 默认透明度（0-255）

        Returns:
            (r, g, b, a) 元组
        """
        try:
            rgb = ColorUtils.hex_to_rgb(hex_color)
            return rgb + (default_alpha,)
        except Exception as e:
            logger.warning(f"Failed to convert fill color '{hex_color}': {e}")
            # 返回默认蓝色填充
            return (15, 152, 179, default_alpha)

    @staticmethod
    def should_render_stroke(stroke_width: int, stroke_color: Optional[Tuple[int, int, int, int]]) -> bool:
        """
        检查是否应该渲染描边

        Args:
            stroke_width: 描边宽度
            stroke_color: 描边颜色元组或None

        Returns:
            True 如果应该渲染描边
        """
        return stroke_width > 0 and stroke_color is not None

    @staticmethod
    def get_shape_type_for_stroke_compensation(shape_type: str) -> str:
        """
        获取用于描边补偿的形状类型分类

        Args:
            shape_type: 原始形状类型

        Returns:
            用于描边补偿的形状类型
        """
        # 螺旋和太阳光芒使用特殊补偿
        if shape_type in ["spiral", "sunburst"]:
            return shape_type
        # 文本使用"text"类型
        elif shape_type == "text":
            return "text"
        # 其他所有形状使用"general"
        else:
            return "general"