"""
形状渲染器
处理通用形状的渲染逻辑
"""

import math
import logging
from typing import Dict, Any, Tuple, List
import torch
import numpy as np
from PIL import Image

from .renderer_interface import BaseRenderer
from .render_utils import RenderUtils
from .param_standardizer import ParamStandardizer
from .stroke_utils import StrokeUtils
from .shape_coordinator import ShapeCoordinator
from .color_utils import ColorUtils


logger = logging.getLogger(__name__)
logger.setLevel(logging.WARNING)  # 关闭INFO级别日志


class ShapeRenderer(BaseRenderer):
    """通用形状渲染器"""

    def __init__(self):
        """初始化形状渲染器"""
        super().__init__()
        self.render_utils = RenderUtils()
        self.coordinator = ShapeCoordinator()

    def render(self, width: int, height: int, shape_color: str, bg_color: str,
               transparent_bg: bool, stroke_color: str, stroke_width: int,
               params: Dict[str, Any], position: Dict[str, float],
               rotation: float, scale: Dict[str, float], skew: Dict[str, float],
               canvas_scale_factor: float = 1.0) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """
        渲染通用形状

        Args:
            width: 输出图像宽度
            height: 输出图像高度
            shape_color: 形状颜色
            bg_color: 背景颜色
            transparent_bg: 是否透明背景
            stroke_color: 描边颜色
            stroke_width: 描边宽度
            params: 形状参数
            position: 位置参数
            rotation: 旋转角度
            scale: 缩放参数
            skew: 倾斜参数
            canvas_scale_factor: 画布缩放因子

        Returns:
            (image_tensor, mask_tensor, bg_tensor)
        """
        # 使用超采样抗锯齿
        scale_factor = 4
        render_width = width * scale_factor
        render_height = height * scale_factor

        # 创建渲染图像
        bg_rgb = ColorUtils.hex_to_rgba(bg_color)
        if transparent_bg:
            image = Image.new("RGBA", (render_width, render_height), (0, 0, 0, 0))
        else:
            image = Image.new("RGBA", (render_width, render_height), bg_rgb)

        # 生成形状坐标
        base_size = min(width, height) * 0.25  # 使用较小边的25%作为基础半径
        size = base_size * scale_factor  # 转换为渲染坐标系

        # 使用协调器生成坐标
        coords = self.coordinator.generate_shape_coordinates("general", size, params)

        # 标准化颜色
        shape_rgb = StrokeUtils.hex_to_fill_rgba(shape_color)
        stroke_rgb = StrokeUtils.hex_to_stroke_rgba(stroke_color, stroke_width)

        # 应用变换
        transformed_coords = self.render_utils.apply_simple_transform(
            coords, scale, rotation, skew, position, render_width, render_height, scale_factor
        )

        # 标准化描边宽度
        compensated_stroke_width = StrokeUtils.compute_compensated_stroke_width(
            stroke_width, scale, "general", scale_factor
        )

        # 渲染形状
        self.render_utils.render_shape_with_shapely(
            image, transformed_coords, shape_rgb, stroke_rgb,
            compensated_stroke_width, join_style=1, stroke_only=False
        )

        # 转换为tensor
        image_array = np.array(image).astype(np.float32) / 255.0
        image_tensor = torch.from_numpy(image_array).unsqueeze(0)

        # 创建掩码
        mask_image = Image.new("RGBA", (render_width, render_height), (0, 0, 0, 0))
        self.render_utils.render_shape_with_shapely(
            mask_image, transformed_coords, shape_rgb, stroke_rgb,
            compensated_stroke_width, join_style=1, stroke_only=False
        )

        # 下采样掩码
        mask_image = mask_image.resize((width, height), Image.Resampling.LANCZOS)
        mask_array = np.array(mask_image).astype(np.float32)[:, :, 3] / 255.0
        mask_tensor = torch.from_numpy(mask_array).unsqueeze(0)

        # 创建背景张量
        if transparent_bg:
            bg_image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        else:
            bg_rgb_final = ColorUtils.hex_to_rgba(bg_color)
            bg_image = Image.new("RGBA", (width, height), bg_rgb_final)

        bg_array = np.array(bg_image).astype(np.float32) / 255.0
        bg_tensor = torch.from_numpy(bg_array).unsqueeze(0)

        return image_tensor, mask_tensor, bg_tensor