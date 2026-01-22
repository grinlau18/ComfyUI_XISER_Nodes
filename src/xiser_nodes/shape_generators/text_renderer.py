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
from .param_standardizer import ParamStandardizer


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

        # 简化：前端画布与输出图像尺寸相同（100%）
        # 图像中心
        image_center_x = render_width / 2.0
        image_center_y = render_height / 2.0

        # position是归一化的值，相对于图像中心
        pos_x = position.get("x", 0.0) * render_width
        pos_y = position.get("y", 0.0) * render_height

        transformed = affinity.translate(transformed, xoff=image_center_x + pos_x, yoff=image_center_y + pos_y)
        return transformed

    def render_text_to_tensors(self, width: int, height: int, shape_color: str, bg_color: str,
                              transparent_bg: bool, stroke_color: str, stroke_width: int,
                              text_params: Dict[str, Any],
                              position: Dict[str, float], rotation_angle: float,
                              scale: Dict[str, float], skew: Dict[str, float],
                              canvas_scale_factor: float = 1.0) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """
        将文字渲染为张量
        现在使用标准化参数处理

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
            canvas_scale_factor: 画布缩放因子（用于超采样）

        Returns:
            (image_tensor, mask_tensor, bg_tensor)
        """
        import logging
        logger = logging.getLogger(__name__)
        logger.setLevel(logging.INFO)  # 启用INFO级别日志以便调试

        # 使用超采样抗锯齿 - 提高文字渲染质量（与图形渲染保持一致）
        # 注意：canvas_scale_factor是前端画布缩放因子，不是超采样因子
        # 我们使用固定的超采样因子4，与图形渲染保持一致
        supersample_factor = 4
        render_width = width * supersample_factor
        render_height = height * supersample_factor

        # 标准化文字参数
        standardized_params = ParamStandardizer.standardize_text_params(text_params)

        # 调试日志：记录文字参数
        logger.info(f"文字渲染参数: standardized_params={standardized_params}, supersample_factor={supersample_factor}")
        logger.info(f"字体文件参数: font_file={standardized_params.get('font_file')}")

        geometry = self.text_processor.build_text_geometry(standardized_params, supersample_factor)
        if geometry is None or geometry.is_empty:
            logger.warning("Text geometry is empty, creating default empty tensors")

            # 返回带有背景色的图像，而不是空白图像
            bg_rgb = self.render_utils.hex_to_rgb(bg_color) + (255,)

            if transparent_bg:
                composite = Image.new("RGBA", (render_width, render_height), (0, 0, 0, 0))
            else:
                composite = Image.new("RGBA", (render_width, render_height), bg_rgb)

            # 使用高质量下采样（与图形渲染保持一致）
            composite = composite.resize((width, height), Image.Resampling.LANCZOS)
            image_array = np.array(composite).astype(np.float32) / 255.0
            image_tensor = torch.from_numpy(image_array).unsqueeze(0)

            # 掩码应为全0（表示没有前景元素）
            mask_array = np.zeros((height, width), dtype=np.float32)
            mask_tensor = torch.from_numpy(mask_array).unsqueeze(0)

            # 背景
            if transparent_bg:
                bg_image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
            else:
                bg_image = Image.new("RGBA", (width, height), bg_rgb)
            bg_array = np.array(bg_image).astype(np.float32) / 255.0
            bg_tensor = torch.from_numpy(bg_array).unsqueeze(0)

            return image_tensor, mask_tensor, bg_tensor

        # 简化：移除canvas_scale_factor相关的缩放
        transformed_geometry = self._apply_text_transformations(
            geometry, render_width, render_height, position, rotation_angle, scale, skew
        )

        bg_rgb = self.render_utils.hex_to_rgb(bg_color) + (255,)
        shape_rgb = self.render_utils.hex_to_rgb(shape_color) + (255,)
        stroke_rgb = self.render_utils.hex_to_rgb(stroke_color) + (255,) if stroke_width > 0 else None

        # 使用统一的描边宽度补偿计算（与图形渲染保持一致）
        # 使用参数标准化器进行描边宽度处理
        compensated_stroke_width = ParamStandardizer.standardize_stroke_params(
            stroke_width, scale, "text"
        ) * supersample_factor  # 应用超采样因子

        fill_mask_img = self.render_utils._geometry_to_mask(transformed_geometry, render_width, render_height)
        fill_mask = np.array(fill_mask_img, dtype=np.uint8)

        font_weight_value = str(standardized_params.get("font_weight", "normal")).lower()
        if font_weight_value == "bold" and fill_mask.max() > 0:
            font_size_param = standardized_params.get("font_size", 128)
            try:
                font_size_value = float(font_size_param)
            except (TypeError, ValueError):
                font_size_value = 128.0
            bold_kernel = max(1, int(font_size_value * 0.02))  # 简化：移除scale_factor
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

        # 使用高质量下采样（与图形渲染保持一致）
        composite = composite.resize((width, height), Image.Resampling.LANCZOS)
        image_array = np.array(composite).astype(np.float32) / 255.0
        image_tensor = torch.from_numpy(image_array).unsqueeze(0)

        # Mask should follow text (fill + stroke) only, not the background alpha
        mask_combined = fill_mask.copy()
        if stroke_mask is not None:
            mask_combined = np.maximum(mask_combined, stroke_mask)
        mask_img = Image.fromarray(mask_combined, mode="L")
        # 掩码也需要下采样
        mask_img = mask_img.resize((width, height), Image.Resampling.LANCZOS)
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
