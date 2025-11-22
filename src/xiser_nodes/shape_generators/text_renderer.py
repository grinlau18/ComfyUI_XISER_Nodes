"""
文字渲染模块
专门处理文字渲染到张量的功能
"""

import torch
import numpy as np
from PIL import Image
from typing import List, Dict, Any, Tuple
from shapely import affinity

from .text_processor import TextProcessor
from .render_utils import RenderUtils, FRONTEND_CANVAS_SCALE


class TextRenderer:
    """文字渲染器类"""

    def __init__(self):
        self.text_processor = TextProcessor()
        self.render_utils = RenderUtils()

    def _apply_text_transformations(self, geometry, render_width: int, render_height: int,
                                    position: Dict[str, float], rotation_angle: float,
                                    scale: Dict[str, float], skew: Dict[str, float]):
        """应用文字变换"""
        if geometry is None or geometry.is_empty:
            return geometry

        transformed = geometry
        sx = scale.get("x", 1.0)
        sy = scale.get("y", 1.0)
        if sx != 1.0 or sy != 1.0:
            transformed = affinity.scale(transformed, xfact=sx, yfact=sy, origin=(0, 0))

        if rotation_angle:
            transformed = affinity.rotate(transformed, rotation_angle, origin=(0, 0), use_radians=False)

        skew_x = skew.get("x", 0.0)
        skew_y = skew.get("y", 0.0)

        def shear_to_degrees(value: float) -> float:
            if value == 0:
                return 0.0
            try:
                import math
                return math.degrees(math.atan(value))
            except Exception:
                return 0.0

        xs = shear_to_degrees(skew_x)
        ys = shear_to_degrees(skew_y)
        if xs != 0.0 or ys != 0.0:
            transformed = affinity.skew(transformed, xs=xs, ys=ys, origin=(0, 0))

        center_x = render_width / 2.0
        center_y = render_height / 2.0
        pos_x = position.get("x", 0.0) * render_width
        pos_y = position.get("y", 0.0) * render_height

        transformed = affinity.translate(transformed, xoff=center_x + pos_x, yoff=center_y + pos_y)
        return transformed

    def render_text_to_tensors(self, width: int, height: int, shape_color: str, bg_color: str,
                              transparent_bg: bool, stroke_color: str, stroke_width: int,
                              text_params: Dict[str, Any],
                              position: Dict[str, float], rotation_angle: float,
                              scale: Dict[str, float], skew: Dict[str, float],
                              canvas_scale_factor: float = FRONTEND_CANVAS_SCALE) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """
        将文字渲染为张量

        Args:
            width: 输出图像宽度
            height: 输出图像高度
            shape_color: 形状填充颜色
            bg_color: 背景颜色
            transparent_bg: 背景是否透明
            stroke_color: 描边颜色
            stroke_width: 描边宽度
            text_params: 文字参数
            position: 位置
            rotation_angle: 旋转角度
            scale: 缩放
            skew: 倾斜

        Returns:
            (image_tensor, mask_tensor, bg_tensor)
        """
        import logging
        logger = logging.getLogger(__name__)

        scale_factor = 4
        render_width = width * scale_factor
        render_height = height * scale_factor

        geometry = self.text_processor.build_text_geometry(text_params, scale_factor)
        if geometry is None or geometry.is_empty:
            raise ValueError("Text geometry is empty, please check text parameters or font file.")

        try:
            canvas_scale_factor = float(canvas_scale_factor)
        except (TypeError, ValueError):
            canvas_scale_factor = 0.75
        if canvas_scale_factor <= 0:
            canvas_scale_factor = 0.75

        scale_comp = 1.0 / canvas_scale_factor
        if scale_comp != 1.0:
            geometry = affinity.scale(geometry, xfact=scale_comp, yfact=scale_comp, origin=(0, 0))

        transformed_geometry = self._apply_text_transformations(
            geometry, render_width, render_height, position, rotation_angle, scale, skew
        )

        bg_rgb = self.render_utils.hex_to_rgb(bg_color) + (255,)
        shape_rgb = self.render_utils.hex_to_rgb(shape_color) + (255,)
        stroke_rgb = self.render_utils.hex_to_rgb(stroke_color) + (255,) if stroke_width > 0 else None

        avg_scale = (scale.get('x', 1.0) + scale.get('y', 1.0)) / 2.0
        frontend_scale_comp = 1.0 / 0.75 if 0.75 not in (0, None) else 1.0  # FRONTEND_CANVAS_SCALE
        compensated_stroke_width = 0
        if stroke_width > 0:
            compensated_stroke_width = stroke_width * scale_factor * avg_scale * frontend_scale_comp * 0.9  # FRONTEND_STROKE_COMPENSATION

        fill_mask_img = self.render_utils._geometry_to_mask(transformed_geometry, render_width, render_height)
        fill_mask = np.array(fill_mask_img, dtype=np.uint8)

        font_weight_value = str(text_params.get("font_weight", "normal")).lower()
        if font_weight_value == "bold" and fill_mask.max() > 0:
            font_size_param = text_params.get("font_size", 128)
            try:
                font_size_value = float(font_size_param)
            except (TypeError, ValueError):
                font_size_value = 128.0
            bold_kernel = max(1, int(font_size_value * scale_factor * 0.02))
            bold_kernel = max(1, min(bold_kernel + (bold_kernel + 1) % 2, int(scale_factor * 32)))
            try:
                import cv2
                kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (bold_kernel, bold_kernel))
                fill_mask = cv2.dilate(fill_mask, kernel, iterations=1)
            except Exception as e:
                logger.warning(f"Bold mask dilation failed: {e}")

        stroke_mask = None
        if stroke_rgb is not None and compensated_stroke_width > 0 and np.max(fill_mask) > 0:
            fill_binary = (fill_mask > 0).astype(np.uint8)
            background = (1 - fill_binary).astype(np.uint8)
            stroke_radius = max(0.5, compensated_stroke_width / 2.0)

            try:
                import cv2
                dist_out = cv2.distanceTransform(background * 255, cv2.DIST_L2, 5)
                dist_in = cv2.distanceTransform(fill_binary * 255, cv2.DIST_L2, 5)
                outer_ring = np.logical_and(background == 1, dist_out <= stroke_radius)
                inner_ring = np.logical_and(fill_binary == 1, dist_in <= stroke_radius)
                stroke_mask = np.where(np.logical_or(outer_ring, inner_ring), 255, 0).astype(np.uint8)
            except Exception as e:
                logger.warning(f"Failed to compute text stroke via distance transform: {e}")
                stroke_mask = None

        # 组合填充与描边
        if transparent_bg:
            composite = Image.new("RGBA", (render_width, render_height), (0, 0, 0, 0))
        else:
            composite = Image.new("RGBA", (render_width, render_height), bg_rgb)

        if stroke_mask is not None:
            stroke_alpha = Image.fromarray(stroke_mask, mode="L")
            stroke_image = Image.new("RGBA", (render_width, render_height), stroke_rgb)
            stroke_image.putalpha(stroke_alpha)
            composite = Image.alpha_composite(composite, stroke_image)

        if np.max(fill_mask) > 0:
            fill_alpha = Image.fromarray(fill_mask, mode="L")
            fill_image = Image.new("RGBA", (render_width, render_height), shape_rgb)
            fill_image.putalpha(fill_alpha)
            composite = Image.alpha_composite(composite, fill_image)

        composite = composite.resize((width, height), Image.Resampling.LANCZOS)
        image_array = np.array(composite).astype(np.float32) / 255.0
        image_tensor = torch.from_numpy(image_array).unsqueeze(0)

        # Mask should follow text (fill + stroke) only, not the background alpha
        mask_combined = fill_mask.copy()
        if stroke_mask is not None:
            mask_combined = np.maximum(mask_combined, stroke_mask)
        mask_img = Image.fromarray(mask_combined, mode="L").resize((width, height), Image.Resampling.LANCZOS)
        mask_array = np.array(mask_img).astype(np.float32) / 255.0
        mask_tensor = torch.from_numpy(mask_array).unsqueeze(0)

        # 背景
        if transparent_bg:
            bg_image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        else:
            bg_image = Image.new("RGBA", (width, height), bg_rgb)
        bg_array = np.array(bg_image).astype(np.float32) / 255.0
        bg_tensor = torch.from_numpy(bg_array).unsqueeze(0)

        return image_tensor, mask_tensor, bg_tensor
