"""
参数标准化模块
统一处理形状参数的标准化和验证
"""

import math
import logging
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)  # 启用INFO级别日志以便调试


class ParamStandardizer:
    """参数标准化器类"""

    @staticmethod
    def standardize_spiral_params(params: Dict[str, Any], scale_factor: float = 1.0) -> Dict[str, Any]:
        """
        标准化螺旋参数

        Args:
            params: 原始参数字典
            scale_factor: 缩放因子

        Returns:
            标准化后的参数字典
        """
        standardized = params.copy()

        # 统一螺旋参数处理 - 移除复杂的补偿逻辑
        # 简化宽度参数处理
        start_width = params.get("startWidth", params.get("start_width", 15))
        end_width = params.get("endWidth", params.get("end_width", 15))

        # 直接使用原始值，不应用额外的补偿
        standardized["start_width"] = max(0.0, float(start_width))
        standardized["end_width"] = max(0.0, float(end_width))

        # 标准化其他螺旋参数
        standardized["turns"] = max(1, min(10, int(params.get("turns", 4))))
        standardized["points_per_turn"] = max(30, min(200, int(params.get("pointsPerTurn", 100))))
        standardized["line_length"] = max(0.1, min(3.0, float(params.get("lineLength", 1.0))))
        standardized["smoothness"] = max(0.0, min(1.0, float(params.get("smoothness", 1.0))))

        logger.info(f"Spiral params standardized: start_width={standardized['start_width']}, "
                   f"end_width={standardized['end_width']}, turns={standardized['turns']}")

        return standardized

    @staticmethod
    def standardize_text_params(params: Dict[str, Any]) -> Dict[str, Any]:
        """
        标准化文本参数

        Args:
            params: 原始参数字典

        Returns:
            标准化后的参数字典
        """
        # 只保留文字相关字段，过滤掉其他形状的参数
        text_keys = {"content", "font_file", "font_size", "letter_spacing", "line_spacing",
                    "font_weight", "font_style", "underline", "uppercase", "text_align"}

        standardized = {}

        # 标准化文本内容
        content = params.get("content", "A")
        if content is None:
            content = "A"
        standardized["content"] = str(content)

        # 标准化字体大小
        font_size = max(12, int(params.get("font_size", 128)))
        standardized["font_size"] = font_size

        # 标准化间距参数
        standardized["letter_spacing"] = float(params.get("letter_spacing", 0.0))
        standardized["line_spacing"] = max(0.5, float(params.get("line_spacing", 1.2)))

        # 标准化样式参数
        standardized["font_weight"] = str(params.get("font_weight", "normal")).lower()
        standardized["font_style"] = str(params.get("font_style", "normal")).lower()
        standardized["underline"] = bool(params.get("underline", False))
        standardized["uppercase"] = bool(params.get("uppercase", True))

        # 标准化对齐方式
        text_align = str(params.get("text_align", "center")).lower()
        standardized["text_align"] = "center" if text_align not in ("left", "right") else text_align

        # 标准化字体文件
        standardized["font_file"] = params.get("font_file", "") or ""

        logger.info(f"Text params standardized: content='{standardized['content'][:20]}...', "
                   f"font_size={standardized['font_size']}, font_weight={standardized['font_weight']}")

        return standardized

    @staticmethod
    def standardize_general_shape_params(params: Dict[str, Any], shape_type: str) -> Dict[str, Any]:
        """
        标准化通用形状参数

        Args:
            params: 原始参数字典
            shape_type: 形状类型

        Returns:
            标准化后的参数字典
        """
        standardized = params.copy()

        if shape_type == "circle":
            # 圆形参数标准化
            angle = params.get("angle", 360)
            if angle == 0:
                angle = 360
            standardized["angle"] = max(0, min(360, float(angle)))

            inner_radius_percent = params.get("inner_radius", 0)
            standardized["inner_radius"] = max(0, min(100, float(inner_radius_percent)))

        elif shape_type == "polygon":
            # 多边形参数标准化
            sides = max(3, min(100, int(params.get("sides", 4))))
            standardized["sides"] = sides

            corner_radius = max(0, float(params.get("corner_radius", 0)))
            standardized["corner_radius"] = corner_radius

        elif shape_type == "star":
            # 星形参数标准化
            points = max(3, min(50, int(params.get("points", 5))))
            standardized["points"] = points

            inner_ratio = max(0.01, min(0.99, float(params.get("inner_ratio", 0.4))))
            standardized["inner_ratio"] = inner_ratio

        elif shape_type == "sunburst":
            # 太阳光芒参数标准化
            ray_count = max(3, min(100, int(params.get("ray_count", 10))))
            standardized["ray_count"] = ray_count

            ray_length = max(0.1, min(3.0, float(params.get("ray_length", 1.0))))
            standardized["ray_length"] = ray_length

            # 标准化光芒宽度参数，不使用补偿
            start_width = params.get("start_width", -1)
            end_width = params.get("end_width", 30)

            standardized["start_width"] = float(start_width)
            standardized["end_width"] = float(end_width)

        elif shape_type == "heart":
            # 心形参数标准化
            path_offset = float(params.get("path_offset", 0))
            standardized["path_offset"] = path_offset

        elif shape_type == "flower":
            # 花朵参数标准化
            petals = max(1, min(50, int(params.get("petals", 5))))
            standardized["petals"] = petals

            petal_length = max(0.1, min(2.0, float(params.get("petal_length", 0.5))))
            standardized["petal_length"] = petal_length

        # 统一旋转参数处理
        shape_rotation = params.get("shape_rotation", 0)
        try:
            standardized["shape_rotation"] = float(shape_rotation)
        except (TypeError, ValueError):
            standardized["shape_rotation"] = 0.0

        return standardized

    @staticmethod
    def standardize_stroke_params(stroke_width: int, scale: Dict[str, float],
                                shape_type: str = "general") -> float:
        """
        标准化描边参数，修复螺旋和太阳光芒描边过细的问题

        Args:
            stroke_width: 原始描边宽度
            scale: 缩放参数
            shape_type: 形状类型

        Returns:
            标准化后的描边宽度
        """
        if stroke_width <= 0:
            return 0.0

        # 统一的描边补偿机制 - 遵活处理不同类型形状
        avg_scale = (scale.get('x', 1.0) + scale.get('y', 1.0)) / 2.0

        # 针对螺旋和太阳光芒形状特殊处理，避免过度减小描边
        if shape_type in ["spiral", "sunburst"]:
            # 螺旋和太阳光芒使用较少的补偿，保持描边可见性
            compensation_factor = 1.0  # 基本不补偿
        else:
            # 其他形状使用正常的补偿
            compensation_factor = 0.9  # 原有的补偿

        compensated_stroke_width = stroke_width * avg_scale * compensation_factor

        logger.debug(f"Stroke width standardized for {shape_type}: {stroke_width} * avg_scale({avg_scale:.2f}) * comp({compensation_factor}) = {compensated_stroke_width:.2f}")

        return compensated_stroke_width

    @staticmethod
    def standardize_coordinate_transform(position: Dict[str, float],
                                       canvas_scale_factor: float = 1.0) -> Dict[str, float]:
        """
        标准化坐标变换参数

        Args:
            position: 位置参数
            canvas_scale_factor: 画布缩放因子

        Returns:
            标准化后的位置参数
        """
        if not position:
            return {"x": 0.0, "y": 0.0}

        # 标准化位置参数，移除多余的补偿
        standardized = {
            "x": position.get("x", 0.0),
            "y": position.get("y", 0.0)
        }

        return standardized

    @staticmethod
    def validate_params(params: Dict[str, Any], shape_type: str) -> Dict[str, Any]:
        """
        验证并标准化参数

        Args:
            params: 原始参数字典
            shape_type: 形状类型

        Returns:
            验证并标准化后的参数字典
        """
        if params is None:
            params = {}

        if not isinstance(params, dict):
            params = {}

        # 根据形状类型进行标准化
        if shape_type == "spiral":
            standardized = ParamStandardizer.standardize_spiral_params(params)
        elif shape_type == "text":
            standardized = ParamStandardizer.standardize_text_params(params)
        else:
            standardized = ParamStandardizer.standardize_general_shape_params(params, shape_type)

        return standardized