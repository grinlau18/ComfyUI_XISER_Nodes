"""
批量处理工具模块
处理批量形状生成
"""

import json
import logging
from typing import List, Dict, Any, Tuple

import torch
import numpy as np
from PIL import Image

from .shape_coordinator import ShapeCoordinator
from .render_utils import RenderUtils, FRONTEND_CANVAS_SCALE
from .text_renderer import TextRenderer

logger = logging.getLogger(__name__)


class BatchProcessor:
    """批量处理器类"""

    MODE_TO_SHAPE_TYPE = {
        "circle, sector, doughnut": "circle",
        "circle": "circle",
        "polygon": "polygon",
        "star": "star",
        "heart": "heart",
        "flower": "flower",
        "spiral": "spiral",
        "sunburst": "sunburst",
        "square": "polygon",
        "text": "text"
    }
    SUPPORTED_SHAPES = {"circle", "polygon", "star", "heart", "flower", "spiral", "sunburst", "text"}

    def __init__(self):
        self.shape_coordinator = ShapeCoordinator()
        self.render_utils = RenderUtils()
        self.text_renderer = TextRenderer()

    def merge_properties(self, frontend_props: Dict[str, Any], port_props: Dict[str, Any]) -> Dict[str, Any]:
        """
        合并前端属性和端口属性，端口数据优先

        Args:
            frontend_props: 前端控件属性
            port_props: 端口传入属性

        Returns:
            合并后的属性字典
        """
        merged = frontend_props.copy()

        if port_props:
            # 端口数据优先，但只覆盖非None值
            for key, value in port_props.items():
                if value is not None:
                    merged[key] = value

        return merged

    def _extract_transform(self, shape_canvas: Dict[str, Any]):
        """提取变换参数"""
        position = {"x": 0.0, "y": 0.0}
        rotation_angle = 0.0
        scale = {"x": 1.0, "y": 1.0}
        skew = {"x": 0.0, "y": 0.0}

        if shape_canvas and isinstance(shape_canvas, dict):
            position = shape_canvas.get("position", position) or position
            rotation_angle = shape_canvas.get("rotation", rotation_angle)
            scale = shape_canvas.get("scale", scale) or scale
            skew = shape_canvas.get("skew", skew) or skew

        return position, rotation_angle, scale, skew

    def execute_batch(self, width: int, height: int, shape_type: str, shape_color: str,
                     bg_color: str, transparent_bg: bool, stroke_color: str, stroke_width: int,
                     shape_canvas: Dict[str, Any], shape_data: List[Dict[str, Any]]) -> Tuple[List[torch.Tensor], List[torch.Tensor], List[torch.Tensor]]:
        """
        执行批量形状生成，包含多个形状属性。

        Args:
            width: 输出图像宽度
            height: 输出图像高度
            shape_type: 要生成的形状类型
            shape_color: 形状填充颜色（十六进制）
            bg_color: 背景颜色（十六进制）
            transparent_bg: 背景是否透明
            stroke_color: 描边颜色（十六进制）
            stroke_width: 描边宽度（像素）
            shape_canvas: 前端画布数据
            shape_data: 批量处理的形状属性列表

        Returns:
            tuple: (image_tensor_list, mask_tensor_list, bg_image_tensor_list)
        """
        image_tensors = []
        mask_tensors = []
        bg_tensors = []

        # 转换描边样式参数为Shapely常量
        join_style = 1

        # 使用超采样抗锯齿 - 提高质量
        scale_factor = 4
        render_width = width * scale_factor
        render_height = height * scale_factor

        # 基础形状大小计算（与前端画布保持一致）
        base_shape_size = self.render_utils.compute_base_shape_size(width, height, scale_factor, shape_canvas)

        # 解析前端画布数据作为默认属性
        frontend_props = {}
        if shape_canvas and isinstance(shape_canvas, dict):
            frontend_props = {
                "position": shape_canvas.get("position", {"x": 0.0, "y": 0.0}),
                "rotation": shape_canvas.get("rotation", 0.0),
                "scale": shape_canvas.get("scale", {"x": 1.0, "y": 1.0}),
                "skew": shape_canvas.get("skew", {"x": 0.0, "y": 0.0}),
                "canvas_scale_factor": shape_canvas.get("canvas_scale_factor", FRONTEND_CANVAS_SCALE)
            }

        params = {}
        try:
            if shape_canvas and isinstance(shape_canvas, dict):
                params = json.loads(shape_canvas.get("shape_params", "{}"))
        except (json.JSONDecodeError, TypeError):
            params = {}

        # 处理每个形状数据
        for i, shape_props in enumerate(shape_data):
            logger.info(f"Processing shape {i+1}/{len(shape_data)}: {shape_props}")

            try:
                merged_props = self.merge_properties(frontend_props, shape_props)

                position_raw = merged_props.get("position", {"x": 0.0, "y": 0.0})
                rotation_angle = merged_props.get("rotation", 0.0)
                scale = merged_props.get("scale", {"x": 1.0, "y": 1.0})
                skew = merged_props.get("skew", {"x": 0.0, "y": 0.0})
                canvas_scale_factor = merged_props.get("canvas_scale_factor", FRONTEND_CANVAS_SCALE) or FRONTEND_CANVAS_SCALE
                position = {
                    "x": position_raw.get("x", 0.0) * canvas_scale_factor,
                    "y": position_raw.get("y", 0.0) * canvas_scale_factor
                }

                current_shape_color = shape_props.get("shape_color", shape_color)
                current_bg_color = shape_props.get("bg_color", bg_color)
                current_transparent_bg = shape_props.get("transparent_bg", transparent_bg)
                current_stroke_color = shape_props.get("stroke_color", stroke_color)
                current_stroke_width = shape_props.get("stroke_width", stroke_width)
                mode_value = shape_props.get("mode_selection") or shape_props.get("shape_type") or shape_type
                current_shape_type = self._normalize_shape_type(mode_value)

                bg_rgb = self.render_utils.hex_to_rgb(current_bg_color) + (255,)

                if current_transparent_bg:
                    image = Image.new("RGBA", (render_width, render_height), (0, 0, 0, 0))
                else:
                    image = Image.new("RGBA", (render_width, render_height), bg_rgb)

                current_params = {}
                if isinstance(params, dict):
                    current_params.update(params)

                shape_params_override = shape_props.get("shape_params")
                if isinstance(shape_params_override, str):
                    try:
                        current_params.update(json.loads(shape_params_override))
                    except (json.JSONDecodeError, TypeError):
                        logger.warning(f"Failed to parse shape_params for batch index {i}")
                elif isinstance(shape_params_override, dict):
                    current_params.update(shape_params_override)

                if current_shape_type == "polygon" and "corner_radius" in current_params:
                    max_frontend_radius = 50
                    max_backend_radius = 258
                    frontend_radius = current_params["corner_radius"]
                    scaled_radius = (frontend_radius / max_frontend_radius) * max_backend_radius
                    current_params["corner_radius"] = scaled_radius

                if current_shape_type == "text":
                    text_params = current_params
                    image_tensor, mask_tensor, bg_tensor = self.text_renderer.render_text_to_tensors(
                        width, height, current_shape_color, current_bg_color, current_transparent_bg,
                        current_stroke_color, current_stroke_width, text_params,
                        position, rotation_angle, scale, skew,
                        canvas_scale_factor=canvas_scale_factor
                    )
                    image_tensors.append(image_tensor)
                    mask_tensors.append(mask_tensor)
                    bg_tensors.append(bg_tensor)
                    logger.info(f"Text shape {i+1} processed successfully")
                    continue

                current_shape_size = base_shape_size
                if current_shape_type in {"sunburst", "spiral"}:
                    current_shape_size = base_shape_size * 0.5

                shape_coords = self.shape_coordinator.generate_shape_coordinates(current_shape_type, current_shape_size, current_params)

                shape_rgb = self.render_utils.hex_to_rgb(current_shape_color) + (255,)
                stroke_rgb = self.render_utils.hex_to_rgb(current_stroke_color) + (255,) if current_stroke_width > 0 else None

                # 放射线图案现在使用填充渲染，不再使用描边渲染
                stroke_only_shape = False

                if isinstance(shape_coords, dict) and shape_coords.get("type") == "donut":
                    transformed_outer = self.render_utils.apply_simple_transform(
                        shape_coords["outer"], scale, rotation_angle, skew, position, render_width, render_height, scale_factor)
                    transformed_inner = self.render_utils.apply_simple_transform(
                        shape_coords["inner"], scale, rotation_angle, skew, position, render_width, render_height, scale_factor)
                    transformed_coords = {"type": "donut", "outer": transformed_outer, "inner": transformed_inner}
                elif isinstance(shape_coords, dict) and shape_coords.get("type") == "sunburst":
                    transformed_trapezoids = []
                    for trapezoid in shape_coords.get("trapezoids", []):
                        transformed_trapezoids.append(
                            self.render_utils.apply_simple_transform(
                                trapezoid, scale, rotation_angle, skew, position, render_width, render_height, scale_factor
                            )
                        )
                    transformed_coords = {"type": "sunburst", "trapezoids": transformed_trapezoids}
                else:
                    transformed_coords = self.render_utils.apply_simple_transform(
                        shape_coords, scale, rotation_angle, skew, position, render_width, render_height, scale_factor)

                avg_scale = (scale.get('x', 1.0) + scale.get('y', 1.0)) / 2.0
                frontend_scale_comp = 1.0 / 0.75 if 0.75 not in (0, None) else 1.0  # FRONTEND_CANVAS_SCALE
                compensated_stroke_width = current_stroke_width * scale_factor * avg_scale * frontend_scale_comp * 0.9 if current_stroke_width > 0 else 0  # FRONTEND_STROKE_COMPENSATION

                if isinstance(transformed_coords, dict) and transformed_coords.get("type") == "donut":
                    self.render_utils.render_donut_with_shapely(image, transformed_coords["outer"], transformed_coords["inner"],
                                                              shape_rgb, stroke_rgb, compensated_stroke_width, join_style,
                                                              bg_rgb, current_transparent_bg)
                elif isinstance(transformed_coords, dict) and transformed_coords.get("type") == "sunburst":
                    self.render_utils.render_sunburst_with_shapely(
                        image,
                        transformed_coords.get("trapezoids", []),
                        shape_rgb,
                        stroke_rgb,
                        compensated_stroke_width,
                        join_style
                    )
                else:
                    if current_shape_type == "spiral":
                        self.render_utils.render_spiral_with_shapely(
                            image,
                            transformed_coords,
                            shape_rgb,
                            stroke_rgb,
                            compensated_stroke_width,
                            join_style,
                            bg_rgb,
                            current_transparent_bg
                        )
                    else:
                        self.render_utils.render_shape_with_shapely(image, transformed_coords, shape_rgb, stroke_rgb,
                                                                   compensated_stroke_width, join_style, stroke_only_shape)

                image = image.resize((width, height), Image.Resampling.LANCZOS)
                image_array = np.array(image).astype(np.float32) / 255.0
                image_tensor = torch.from_numpy(image_array).unsqueeze(0)

                mask_image = Image.new("RGBA", (render_width, render_height), (0, 0, 0, 0))

                if isinstance(transformed_coords, dict) and transformed_coords.get("type") == "donut":
                    self.render_utils.render_donut_with_shapely(mask_image, transformed_coords["outer"], transformed_coords["inner"],
                                                              shape_rgb, stroke_rgb, compensated_stroke_width, join_style,
                                                              (0, 0, 0, 255), True)
                elif isinstance(transformed_coords, dict) and transformed_coords.get("type") == "sunburst":
                    self.render_utils.render_sunburst_with_shapely(
                        mask_image,
                        transformed_coords.get("trapezoids", []),
                        (0, 0, 0, 255),
                        (0, 0, 0, 255) if compensated_stroke_width > 0 and stroke_rgb is not None else None,
                        compensated_stroke_width,
                        join_style
                    )
                else:
                    if current_shape_type == "spiral":
                        self.render_utils.render_spiral_with_shapely(
                            mask_image,
                            transformed_coords,
                            (0, 0, 0, 255),
                            (0, 0, 0, 255) if compensated_stroke_width > 0 and stroke_rgb is not None else None,
                            compensated_stroke_width,
                            join_style,
                            (0, 0, 0, 255),
                            True
                        )
                    else:
                        self.render_utils.render_shape_with_shapely(mask_image, transformed_coords, shape_rgb, stroke_rgb,
                                                                   compensated_stroke_width, join_style, stroke_only_shape)

                mask_image = mask_image.resize((width, height), Image.Resampling.LANCZOS)
                mask_array = np.array(mask_image).astype(np.float32)[:, :, 3] / 255.0
                mask_tensor = torch.from_numpy(mask_array).unsqueeze(0)

                if current_transparent_bg:
                    bg_image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
                else:
                    bg_rgb = self.render_utils.hex_to_rgb(current_bg_color) + (255,)
                    bg_image = Image.new("RGBA", (width, height), bg_rgb)

                bg_array = np.array(bg_image).astype(np.float32) / 255.0
                bg_tensor = torch.from_numpy(bg_array).unsqueeze(0)

                image_tensors.append(image_tensor)
                mask_tensors.append(mask_tensor)
                bg_tensors.append(bg_tensor)

                logger.info(f"Shape {i+1} processed successfully")

            except Exception as e:
                logger.error(f"Error processing shape {i+1}: {e}")
                # 出错时添加默认图像
                default_image = torch.zeros((1, height, width, 3), dtype=torch.float32)
                default_mask = torch.zeros((1, height, width), dtype=torch.float32)
                default_bg = torch.zeros((1, height, width, 3), dtype=torch.float32)

                image_tensors.append(default_image)
                mask_tensors.append(default_mask)
                bg_tensors.append(default_bg)

        logger.info(f"Batch processing completed: {len(image_tensors)} images generated")
        return (image_tensors, mask_tensors, bg_tensors)

    def _normalize_shape_type(self, mode_value: Any) -> str:
        if mode_value is None:
            return "circle"
        if isinstance(mode_value, str):
            key = mode_value.strip().lower()
        else:
            key = str(mode_value).strip().lower()
        if not key:
            return "circle"
        mapped = self.MODE_TO_SHAPE_TYPE.get(key, key)
        if mapped not in self.SUPPORTED_SHAPES:
            logger.warning(f"Unsupported shape type '{mode_value}', using circle instead")
            return "circle"
        return mapped
