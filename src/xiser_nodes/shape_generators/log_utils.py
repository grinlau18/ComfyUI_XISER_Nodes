"""
日志工具模块
统一管理形状生成相关的日志记录
"""

import logging
from typing import Any, Dict, List, Tuple

logger = logging.getLogger(__name__)


class LogUtils:
    """日志工具类"""

    # 日志级别配置
    LOG_LEVEL_INFO = logging.INFO
    LOG_LEVEL_DEBUG = logging.DEBUG
    LOG_LEVEL_WARNING = logging.WARNING
    LOG_LEVEL_ERROR = logging.ERROR

    @staticmethod
    def set_log_level(level: int = logging.INFO):
        """
        设置日志级别

        Args:
            level: 日志级别
        """
        logger.setLevel(level)

    @staticmethod
    def log_transform_details(transform: Dict[str, Any], shape_type: str = "unknown"):
        """
        记录变换参数详情

        Args:
            transform: 变换参数字典
            shape_type: 形状类型
        """
        position = transform.get("position", {})
        rotation = transform.get("rotation", 0.0)
        scale = transform.get("scale", {})
        skew = transform.get("skew", {})

        logger.info(f"Transform for {shape_type}:")
        logger.info(f"  Position: x={position.get('x', 0.0):.4f}, y={position.get('y', 0.0):.4f}")
        logger.info(f"  Rotation: {rotation:.2f}°")
        logger.info(f"  Scale: x={scale.get('x', 1.0):.2f}, y={scale.get('y', 1.0):.2f}")
        logger.info(f"  Skew: x={skew.get('x', 0.0):.2f}, y={skew.get('y', 0.0):.2f}")

    @staticmethod
    def log_coordinate_details(coords: List[Tuple[float, float]], label: str = "coordinates"):
        """
        记录坐标详情

        Args:
            coords: 坐标列表
            label: 坐标标签
        """
        if not coords:
            logger.debug(f"{label}: empty")
            return

        if isinstance(coords, dict) and coords.get("type") == "donut":
            outer_coords = coords.get("outer", [])
            inner_coords = coords.get("inner", [])
            logger.debug(f"{label} (donut): {len(outer_coords)} outer points, {len(inner_coords)} inner points")
        elif isinstance(coords, dict) and coords.get("type") == "sunburst":
            trapezoids = coords.get("trapezoids", [])
            total_points = sum(len(t) for t in trapezoids)
            logger.debug(f"{label} (sunburst): {len(trapezoids)} trapezoids, {total_points} total points")
        else:
            logger.debug(f"{label}: {len(coords)} points")

    @staticmethod
    def log_size_calculation(width: int, height: int, base_size: float, final_size: float, shape_type: str):
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
        logger.info(f"  Output: {width}x{height}")
        logger.info(f"  Base size: {base_size:.1f}")
        logger.info(f"  Final size: {final_size:.1f}")

    @staticmethod
    def log_shape_generation(shape_type: str, params: Dict[str, Any], size: float):
        """
        记录形状生成详情

        Args:
            shape_type: 形状类型
            params: 形状参数
            size: 形状尺寸
        """
        logger.info(f"Generating {shape_type} with size: {size:.1f}")
        if params:
            # 只记录重要的参数
            important_params = ["sides", "points", "inner_radius", "angle", "corner_radius", "turns"]
            for key in important_params:
                if key in params:
                    logger.info(f"  {key}: {params[key]}")

    @staticmethod
    def log_color_details(shape_color: str, bg_color: str, stroke_color: str, stroke_width: int):
        """
        记录颜色详情

        Args:
            shape_color: 形状颜色
            bg_color: 背景颜色
            stroke_color: 描边颜色
            stroke_width: 描边宽度
        """
        logger.debug(f"Colors - Shape: {shape_color}, BG: {bg_color}, Stroke: {stroke_color} ({stroke_width}px)")

    @staticmethod
    def log_rendering_start(shape_type: str, width: int, height: int):
        """
        记录渲染开始

        Args:
            shape_type: 形状类型
            width: 宽度
            height: 高度
        """
        logger.info(f"Starting {shape_type} rendering: {width}x{height}")

    @staticmethod
    def log_rendering_complete(shape_type: str):
        """
        记录渲染完成

        Args:
            shape_type: 形状类型
        """
        logger.info(f"{shape_type} rendering completed")

    @staticmethod
    def log_error(error_type: str, message: str, details: Any = None):
        """
        记录错误信息

        Args:
            error_type: 错误类型
            message: 错误消息
            details: 错误详情
        """
        logger.error(f"{error_type}: {message}")
        if details:
            logger.debug(f"Error details: {details}")

    @staticmethod
    def log_warning(warning_type: str, message: str):
        """
        记录警告信息

        Args:
            warning_type: 警告类型
            message: 警告消息
        """
        logger.warning(f"{warning_type}: {message}")

    @staticmethod
    def log_debug(message: str, data: Any = None):
        """
        记录调试信息

        Args:
            message: 调试消息
            data: 调试数据
        """
        if data:
            logger.debug(f"{message}: {data}")
        else:
            logger.debug(message)