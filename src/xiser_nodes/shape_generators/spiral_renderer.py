"""
螺旋渲染器
处理螺旋形状的特殊渲染逻辑
"""

import logging
from typing import Dict, Any, Tuple
import torch
import numpy as np
from PIL import Image

from .renderer_interface import BaseRenderer
from .spiral_generator import SpiralGenerator
from .render_utils import RenderUtils
from .param_standardizer import ParamStandardizer


logger = logging.getLogger(__name__)
logger.setLevel(logging.WARNING)  # 关闭INFO级别日志


class SpiralRenderer(BaseRenderer):
    """螺旋形状渲染器"""

    def __init__(self):
        """初始化螺旋渲染器"""
        super().__init__()
        self.render_utils = RenderUtils()
        self.generator = SpiralGenerator()

    def render(self, width: int, height: int, shape_color: str, bg_color: str,
               transparent_bg: bool, stroke_color: str, stroke_width: int,
               params: Dict[str, Any], position: Dict[str, float],
               rotation: float, scale: Dict[str, float], skew: Dict[str, float],
               canvas_scale_factor: float = 1.0) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """
        渲染螺旋形状

        Args:
            width: 输出图像宽度
            height: 输出图像高度
            shape_color: 形状颜色
            bg_color: 背景颜色
            transparent_bg: 是否透明背景
            stroke_color: 描边颜色
            stroke_width: 描边宽度
            params: 螺旋参数
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
        bg_rgb = self.render_utils.hex_to_rgb(bg_color) + (255,)
        if transparent_bg:
            image = Image.new("RGBA", (render_width, render_height), (0, 0, 0, 0))
        else:
            image = Image.new("RGBA", (render_width, render_height), bg_rgb)

        # 标准化螺旋参数
        standardized_params = ParamStandardizer.standardize_spiral_params(params)

        # 计算基础形状尺寸
        base_size = width * 0.25  # 使用输出宽度的25%作为基础半径
        size = base_size * scale_factor  # 转换为渲染坐标系

        # 生成螺旋坐标
        coords = self.generator.generate_spiral_with_width(
            cx=0, cy=0, max_radius=size,
            start_width=standardized_params["start_width"],
            end_width=standardized_params["end_width"],
            turns=standardized_params["turns"],
            points_per_turn=standardized_params["points_per_turn"],
            smoothness=standardized_params["smoothness"],
            line_length=standardized_params["line_length"],
            scale_factor=scale_factor
        )

        # 标准化颜色
        shape_rgb = self.render_utils.hex_to_rgb(shape_color) + (255,)
        stroke_rgb = self.render_utils.hex_to_rgb(stroke_color) + (255,) if stroke_width > 0 else (0, 0, 0, 255)

        # 应用变换
        transformed_coords = self.render_utils.apply_simple_transform(
            coords, scale, rotation, skew, position, render_width, render_height, scale_factor
        )

        # 标准化描边宽度
        compensated_stroke_width = ParamStandardizer.standardize_stroke_params(
            stroke_width, scale, "spiral"
        ) * scale_factor  # 应用超采样因子

        # 渲染螺旋形状
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
            bg_rgb_final = self.render_utils.hex_to_rgb(bg_color) + (255,)
            bg_image = Image.new("RGBA", (width, height), bg_rgb_final)

        bg_array = np.array(bg_image).astype(np.float32) / 255.0
        bg_tensor = torch.from_numpy(bg_array).unsqueeze(0)

        return image_tensor, mask_tensor, bg_tensor