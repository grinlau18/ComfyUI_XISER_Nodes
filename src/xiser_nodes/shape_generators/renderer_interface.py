"""
渲染器接口和基类
定义统一的渲染器接口
"""

import logging
from typing import List, Tuple, Dict, Any, Optional
import torch
import numpy as np
from PIL import Image


logger = logging.getLogger(__name__)
logger.setLevel(logging.WARNING)  # 关闭INFO级别日志


class BaseRenderer:
    """渲染器基类"""

    def __init__(self):
        """初始化渲染器"""
        pass

    def render(self, width: int, height: int, shape_color: str, bg_color: str,
               transparent_bg: bool, stroke_color: str, stroke_width: int,
               params: Dict[str, Any], position: Dict[str, float],
               rotation: float, scale: Dict[str, float], skew: Dict[str, float],
               canvas_scale_factor: float = 1.0) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """
        渲染方法 - 需要被子类实现

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
        raise NotImplementedError("render method must be implemented by subclasses")


class UnifiedRenderer:
    """统一渲染器 - 协调不同类型的渲染器"""

    def __init__(self):
        """初始化统一渲染器"""
        self.renderers = {}
        self._setup_renderers()

    def _setup_renderers(self):
        """设置渲染器实例"""
        # 动态导入渲染器类以避免循环依赖
        try:
            from .text_renderer import TextRenderer
            from .shape_renderer import ShapeRenderer
            from .spiral_renderer import SpiralRenderer

            self.renderers['text'] = TextRenderer()
            self.renderers['spiral'] = SpiralRenderer()
            # 一般形状使用通用渲染器
            self.renderers['general'] = ShapeRenderer()
        except ImportError:
            # 如果无法导入特定渲染器，则使用通用渲染器
            from .shape_renderer import ShapeRenderer
            generic_renderer = ShapeRenderer()
            self.renderers = {
                'text': generic_renderer,
                'spiral': generic_renderer,
                'general': generic_renderer
            }

    def render_shape(self, shape_type: str, width: int, height: int,
                     shape_color: str, bg_color: str, transparent_bg: bool,
                     stroke_color: str, stroke_width: int, params: Dict[str, Any],
                     position: Dict[str, float], rotation: float, scale: Dict[str, float],
                     skew: Dict[str, float], canvas_scale_factor: float = 1.0) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """
        根据形状类型选择渲染器并渲染

        Args:
            shape_type: 形状类型
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
        # 根据形状类型选择渲染器
        renderer = self.renderers.get(shape_type, self.renderers.get('general'))

        if renderer is None:
            raise ValueError(f"No renderer found for shape type: {shape_type}")

        return renderer.render(width, height, shape_color, bg_color, transparent_bg,
                              stroke_color, stroke_width, params, position, rotation,
                              scale, skew, canvas_scale_factor)