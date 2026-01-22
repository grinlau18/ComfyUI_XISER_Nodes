"""
变换工具模块
统一处理形状的变换参数（位置、旋转、缩放、倾斜）
"""

import math
import logging
from typing import Dict, Any, Tuple, List

from .param_standardizer import ParamStandardizer

logger = logging.getLogger(__name__)
logger.setLevel(logging.WARNING)  # 关闭INFO级别日志


class TransformUtils:
    """变换工具类"""

    @staticmethod
    def extract_transform(shape_canvas: Dict[str, Any]) -> Tuple[Dict[str, float], float, Dict[str, float], Dict[str, float]]:
        """
        从画布数据中提取变换参数
        使用标准化的位置参数处理

        Args:
            shape_canvas: 前端传递的画布数据

        Returns:
            (position, rotation_angle, scale, skew)
        """
        position = {"x": 0.0, "y": 0.0}
        rotation_angle = 0.0
        scale = {"x": 1.0, "y": 1.0}
        skew = {"x": 0.0, "y": 0.0}

        if shape_canvas and isinstance(shape_canvas, dict):
            position = shape_canvas.get("position", position) or position
            rotation_angle = shape_canvas.get("rotation", rotation_angle)
            scale = shape_canvas.get("scale", scale) or scale
            skew = shape_canvas.get("skew", skew) or skew

        # 标准化位置参数
        standardized_position = ParamStandardizer.standardize_coordinate_transform(position)

        return standardized_position, rotation_angle, scale, skew

    @staticmethod
    def apply_transform(coords: List[Tuple[float, float]],
                       scale: Dict[str, float], rotation: float,
                       skew: Dict[str, float], position: Dict[str, float],
                       width: int, height: int) -> List[Tuple[float, float]]:
        """
        应用变换到坐标点
        简化了坐标变换计算

        Args:
            coords: 原始坐标点列表
            scale: 缩放比例
            rotation: 旋转角度（度）
            skew: 倾斜参数
            position: 位置偏移（归一化位置，相对于图像中心）
            width: 输出图像宽度
            height: 输出图像高度

        Returns:
            变换后的坐标点列表
        """
        transformed_coords = []
        rotation_rad = math.radians(rotation)

        # 变换矩阵参数
        sx, sy = scale.get('x', 1.0), scale.get('y', 1.0)
        cos_r = math.cos(rotation_rad)
        sin_r = math.sin(rotation_rad)
        kx, ky = skew.get('x', 0.0), skew.get('y', 0.0)

        # 图像中心
        image_center_x = width / 2
        image_center_y = height / 2

        # position偏移计算：归一化位置 × 图像尺寸
        pos_x = position.get('x', 0.0) * width
        pos_y = position.get('y', 0.0) * height

        logger.debug(f"Transform: position=({pos_x}, {pos_y}), rotation={rotation}°, "
                    f"scale=({sx}, {sy}), skew=({kx}, {ky})")

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

            # 4. 平移（使用图像中心加上位置偏移）
            x_t = x_k + image_center_x + pos_x
            y_t = y_k + image_center_y + pos_y

            transformed_coords.append((x_t, y_t))

        return transformed_coords

    @staticmethod
    def apply_simple_transform(coords: List[Tuple[float, float]],
                             scale: Dict[str, float], rotation: float,
                             skew: Dict[str, float], position: Dict[str, float],
                             width: int, height: int, scale_factor: float = 1.0) -> List[Tuple[float, float]]:
        """
        简化的坐标变换方法，直接使用前端计算好的变换参数
        保持原有功能，同时支持标准化处理
        支持超采样渲染

        Args:
            coords: 形状坐标（以中心为原点）
            scale: 缩放比例
            rotation: 旋转角度
            skew: 倾斜参数
            position: 位置偏移（归一化位置，相对于图像中心）
            width: 渲染图像宽度（可能包含超采样）
            height: 渲染图像高度（可能包含超采样）
            scale_factor: 缩放因子（1=无超采样，4=4倍超采样）

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

        # 简化：使用100%尺寸，前端画布与输出图像尺寸相同
        # position是归一化值，相对于图像中心
        # 注意：前端position范围是-0.5到0.5（相对于图像中心）
        image_center_x = width / 2
        image_center_y = height / 2

        # position偏移计算：归一化位置 × 原始图像尺寸 × 缩放因子
        # 需要将归一化位置转换到渲染坐标系
        original_width = width / scale_factor if scale_factor > 0 else width
        original_height = height / scale_factor if scale_factor > 0 else height
        pos_x = position.get('x', 0.0) * original_width * scale_factor
        pos_y = position.get('y', 0.0) * original_height * scale_factor

        logger.info(f"Simple transform: position=({pos_x}, {pos_y}), rotation={rotation}°, scale=({sx}, {sy}), skew=({kx}, {ky})")

        # 详细日志：坐标变换参数
        logger.info("=== 坐标变换详细参数 ===")
        logger.info(f"输入坐标数量: {len(coords)}")
        logger.info(f"图像尺寸: {width}x{height}")
        logger.info(f"图像中心: ({image_center_x:.1f}, {image_center_y:.1f})")
        logger.info(f"position偏移: ({pos_x:.1f}, {pos_y:.1f})")

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

            # 4. 平移（使用图像中心加上位置偏移）
            x_t = x_k + image_center_x + pos_x
            y_t = y_k + image_center_y + pos_y

            transformed_coords.append((x_t, y_t))

        logger.info(f"Simple transformed coordinates range: x=[{min(x for x, _ in transformed_coords):.2f}, {max(x for x, _ in transformed_coords):.2f}], y=[{min(y for _, y in transformed_coords):.2f}, {max(y for _, y in transformed_coords):.2f}]")
        return transformed_coords

    @staticmethod
    def normalize_position(position: Dict[str, float], canvas_scale_factor: float = 1.0) -> Dict[str, float]:
        """
        标准化位置参数
        使用简化的处理逻辑

        Args:
            position: 原始位置参数
            canvas_scale_factor: 画布缩放因子

        Returns:
            标准化后的位置参数
        """
        if not position:
            return {"x": 0.0, "y": 0.0}

        # 标准化位置参数，移除多余的补偿
        normalized = {
            "x": position.get("x", 0.0),
            "y": position.get("y", 0.0)
        }

        return normalized

    @staticmethod
    def create_transform_dict(position: Dict[str, float], rotation: float,
                            scale: Dict[str, float], skew: Dict[str, float]) -> Dict[str, Any]:
        """
        创建变换参数字典

        Args:
            position: 位置
            rotation: 旋转角度
            scale: 缩放
            skew: 倾斜

        Returns:
            变换参数字典
        """
        return {
            "position": position,
            "rotation": rotation,
            "scale": scale,
            "skew": skew
        }

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

        logger.info(f"Transform details for {shape_type}:")
        logger.info(f"  Position: x={position.get('x', 0.0):.4f}, y={position.get('y', 0.0):.4f}")
        logger.info(f"  Rotation: {rotation:.2f}°")
        logger.info(f"  Scale: x={scale.get('x', 1.0):.2f}, y={scale.get('y', 1.0):.2f}")
        logger.info(f"  Skew: x={skew.get('x', 0.0):.2f}, y={skew.get('y', 0.0):.2f}")