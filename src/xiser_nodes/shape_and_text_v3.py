"""
形状和文字生成节点 - V3版本
用于生成各种几何形状和文字，具有交互式控件。
支持圆形（带可选内半径的甜甜圈形状）、多边形、星形等变换。
"""

import json
import logging
import os
import sys
from dataclasses import dataclass
from typing import List, Dict, Any, Tuple, Optional

import torch
import numpy as np
from PIL import Image

from comfy_api.v0_0_2 import io, ui

# 添加当前目录到 Python 路径以确保可以导入 shape_generators
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

try:
    from shape_generators.shape_coordinator import ShapeCoordinator
    from shape_generators.render_utils import RenderUtils, FRONTEND_CANVAS_SCALE
    from shape_generators.text_renderer import TextRenderer
    from shape_generators.batch_processor import BatchProcessor
except ImportError:
    # 如果直接导入失败，尝试相对导入
    from .shape_generators.shape_coordinator import ShapeCoordinator
    from .shape_generators.render_utils import RenderUtils, FRONTEND_CANVAS_SCALE
    from .shape_generators.text_renderer import TextRenderer
    from .shape_generators.batch_processor import BatchProcessor

# 设置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@dataclass
class TransformParams:
    position: Dict[str, float]
    scaled_position: Dict[str, float]
    rotation: float
    scale: Dict[str, float]
    skew: Dict[str, float]
    canvas_scale: float


@dataclass
class ShapeRequest:
    width: int
    height: int
    shape_type: str
    shape_color: str
    bg_color: str
    transparent_bg: bool
    stroke_color: str
    stroke_width: int
    transform: TransformParams
    shape_canvas: Dict[str, Any]
    shape_params: Dict[str, Any]


class XIS_ShapeAndTextV3(io.ComfyNode):
    """
    用于生成几何形状和文字的自定义节点，具有交互式控件 - V3版本。
    """

    MODE_TO_SHAPE_TYPE = {
        "circle, sector, doughnut": "circle",
        "circle": "circle",
        "polygon": "polygon",
        "star": "star",
        "heart": "heart",
        "flower": "flower",
        "spiral": "spiral",
        "sunburst": "sunburst",
        "square": "polygon",  # legacy support
        "text": "text"
    }
    SUPPORTED_SHAPES = {"circle", "polygon", "star", "heart", "flower", "spiral", "sunburst", "text"}

    @classmethod
    def define_schema(cls) -> io.Schema:
        """
        定义节点的输入类型 - V3架构。
        """
        return io.Schema(
            node_id="XIS_ShapeAndText",
            display_name="Shape And Text",
            category="XISER_Nodes/Visual_Editing",
            description="生成各种几何形状和文字，具有交互式控件",
            inputs=[
                io.Int.Input("width",
                           default=512,
                           min=64,
                           max=4096,
                           step=1,
                           tooltip="输出图像宽度"),
                io.Int.Input("height",
                           default=512,
                           min=64,
                           max=4096,
                           step=1,
                           tooltip="输出图像高度"),
                io.Combo.Input("mode_selection",
                             options=["circle, sector, doughnut", "polygon", "star", "heart", "flower", "spiral", "sunburst", "text"],
                             default="circle, sector, doughnut",
                             tooltip="选择要生成的形状类型"),
                io.String.Input("shape_color",
                              default="#0f98b3",
                              tooltip="形状填充颜色（十六进制）"),
                io.String.Input("bg_color",
                              default="#000000",
                              tooltip="背景颜色（十六进制）"),
                io.Boolean.Input("transparent_bg",
                               default=False,
                               tooltip="背景是否透明"),
                io.String.Input("stroke_color",
                              default="#FFFFFF",
                              tooltip="描边颜色（十六进制）"),
                io.Int.Input("stroke_width",
                           default=0,
                           min=0,
                           max=1000,
                           step=1,
                           tooltip="描边宽度（像素）"),
                io.Custom("WIDGET").Input("shape_canvas",
                                        tooltip="交互式画布控件"),
                io.Custom("LIST").Input("shape_data",
                                      optional=True,
                                      tooltip="批量处理的形状属性列表")
            ],
            outputs=[
                io.Image.Output(display_name="shape_image", is_output_list=True),
                io.Mask.Output(display_name="shape_mask", is_output_list=True),
                io.Image.Output(display_name="bg_image", is_output_list=True)
            ]
        )

    # 注意：V3架构中__init__方法不会影响节点功能
    # 所有实例变量应该在execute方法中创建
    # 这里移除__init__方法，避免在不可变实例上设置属性

    @classmethod
    def _extract_transform(cls, shape_canvas: Dict[str, Any]):
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

    @classmethod
    def _normalize_mode_selection(cls, mode_selection: str) -> str:
        """
        将前端的mode_selection值转换为后端可识别的shape_type。
        同时兼容旧的shape_type取值（如square）。
        """
        if not mode_selection:
            return "circle"

        if isinstance(mode_selection, str):
            key = mode_selection.strip().lower()
        else:
            key = str(mode_selection).strip().lower()

        if not key:
            return "circle"

        mapped = cls.MODE_TO_SHAPE_TYPE.get(key, key)
        if mapped not in cls.SUPPORTED_SHAPES:
            logger.warning(f"Unsupported mode_selection '{mode_selection}', falling back to circle")
            return "circle"
        return mapped

    @classmethod
    def execute(cls, width: int, height: int, mode_selection: str, shape_color: str,
               bg_color: str, transparent_bg: bool, stroke_color: str, stroke_width: int,
               shape_canvas: Optional[Dict[str, Any]] = None,
               shape_data: Optional[List[Dict[str, Any]]] = None) -> io.NodeOutput:
        """
        执行形状生成，包含变换和抗锯齿。
        支持通过shape_data进行单次形状处理和批量处理。

        Args:
            width: 输出图像宽度
            height: 输出图像高度
            mode_selection: 前端模式选择（会映射到具体形状类型）
            shape_color: 形状填充颜色（十六进制）
            bg_color: 背景颜色（十六进制）
            transparent_bg: 背景是否透明
            stroke_color: 描边颜色（十六进制）
            stroke_width: 描边宽度（像素）
            shape_canvas: 前端画布数据
            shape_data: 批量处理的形状属性列表

        Returns:
            io.NodeOutput: 包含三个输出的节点输出
        """
        # 在方法内部创建需要的组件实例
        shape_coordinator = ShapeCoordinator()
        render_utils = RenderUtils()
        text_renderer = TextRenderer()
        batch_processor = BatchProcessor()

        # 构建请求
        request = cls._build_request(width, height, mode_selection, shape_color, bg_color,
                                    transparent_bg, stroke_color, stroke_width, shape_canvas)

        has_shape_data_input = request.shape_canvas.get("has_shape_data_input", False)

        if (shape_data and isinstance(shape_data, list) and len(shape_data) > 0) or has_shape_data_input:
            # 如果前端标记有shape_data输入端口连接，但实际数据为空，则使用默认数据
            if not shape_data or not isinstance(shape_data, list) or len(shape_data) == 0:
                logger.warning("Frontend indicates shape_data input connected but no data provided, using default single shape")
                shape_data = [{}]  # 使用空字典作为默认数据

            logger.info(f"Batch processing mode: {len(shape_data)} shapes to generate")
            image_tensors, mask_tensors, bg_tensors = batch_processor.execute_batch(
                width, height, request.shape_type, shape_color, bg_color, transparent_bg,
                stroke_color, stroke_width, request.shape_canvas, shape_data
            )
        else:
            logger.info("Single shape processing mode")
            image_tensors, mask_tensors, bg_tensors = cls._execute_single(
                request, shape_coordinator, render_utils, text_renderer
            )

        # 返回NodeOutput，注意V3中需要返回三个输出
        return io.NodeOutput(image_tensors, mask_tensors, bg_tensors)

    @classmethod
    def _build_request(cls, width: int, height: int, mode_selection: str, shape_color: str,
                      bg_color: str, transparent_bg: bool, stroke_color: str, stroke_width: int,
                      shape_canvas: Optional[Dict[str, Any]] = None) -> ShapeRequest:
        normalized_shape_type = cls._normalize_mode_selection(mode_selection)
        canvas_data = shape_canvas if isinstance(shape_canvas, dict) else {}
        canvas_scale_factor = canvas_data.get("canvas_scale_factor", FRONTEND_CANVAS_SCALE) or FRONTEND_CANVAS_SCALE
        rotation_angle = canvas_data.get("rotation", 0.0)
        scale = canvas_data.get("scale", {"x": 1.0, "y": 1.0}) or {"x": 1.0, "y": 1.0}
        skew = canvas_data.get("skew", {"x": 0.0, "y": 0.0}) or {"x": 0.0, "y": 0.0}
        raw_position = canvas_data.get("position", {"x": 0.0, "y": 0.0}) or {"x": 0.0, "y": 0.0}
        scaled_position = {
            "x": raw_position.get("x", 0.0) * canvas_scale_factor,
            "y": raw_position.get("y", 0.0) * canvas_scale_factor
        }
        try:
            shape_params = json.loads(canvas_data.get("shape_params", "{}")) if canvas_data else {}
        except (json.JSONDecodeError, TypeError):
            shape_params = {}

        transform = TransformParams(
            position=raw_position,
            scaled_position=scaled_position,
            rotation=rotation_angle,
            scale=scale,
            skew=skew,
            canvas_scale=canvas_scale_factor
        )

        return ShapeRequest(
            width=width,
            height=height,
            shape_type=normalized_shape_type,
            shape_color=shape_color,
            bg_color=bg_color,
            transparent_bg=transparent_bg,
            stroke_color=stroke_color,
            stroke_width=stroke_width,
            transform=transform,
            shape_canvas=canvas_data,
            shape_params=shape_params
        )

    @classmethod
    def _execute_single(cls, request: ShapeRequest, shape_coordinator: ShapeCoordinator,
                       render_utils: RenderUtils, text_renderer: TextRenderer) -> Tuple[List[torch.Tensor], List[torch.Tensor], List[torch.Tensor]]:
        """
        执行单次形状生成（原始功能）。
        """
        width = request.width
        height = request.height
        transparent_bg = request.transparent_bg
        shape_canvas = request.shape_canvas
        transform = request.transform
        logger.info(
            "Executing single shape with shape_type: %s, rotation: %.2f°, scale: %s, skew: %s, position: %s, canvas_scale: %.2f",
            request.shape_type,
            transform.rotation,
            transform.scale,
            transform.skew,
            transform.position,
            transform.canvas_scale
        )

        # 使用超采样抗锯齿 - 提高质量
        scale_factor = 4  # 增加超采样倍数以获得更平滑的曲线
        render_width = request.width * scale_factor
        render_height = request.height * scale_factor

        # 始终定义 bg_rgb，即使使用透明背景
        bg_rgb = render_utils.hex_to_rgb(request.bg_color) + (255,)

        if transparent_bg:
            image = Image.new("RGBA", (render_width, render_height), (0, 0, 0, 0))
        else:
            image = Image.new("RGBA", (render_width, render_height), bg_rgb)

        # 其中stageWidth = width * CANVAS_SCALE_FACTOR, stageHeight = height * CANVAS_SCALE_FACTOR (CANVAS_SCALE_FACTOR=0.75)
        # 根据前端画布的基础形状尺寸计算真实渲染尺寸
        base_shape_size = render_utils.compute_base_shape_size(width, height, scale_factor, shape_canvas)
        shape_type = request.shape_type
        shape_size = base_shape_size

        # 螺旋和太阳光芒形状需要特殊处理：整体大小调整（与前端保持相同倍数关系）
        if shape_type == "sunburst":
            shape_size = base_shape_size * 0.5
            logger.info(f"Sunburst special size calculation: base={base_shape_size}, adjusted={shape_size}")
        elif shape_type == "spiral":
            shape_size = base_shape_size * 0.5
            logger.info(f"Spiral special size calculation: base={base_shape_size}, adjusted={shape_size}")

        logger.info(f"Size calculation: width={width}, height={height}, base_shape_size={base_shape_size}, final_shape_size={shape_size}, scale_factor={scale_factor}")
        rotation_angle = 0.0
        position = {"x": 0.0, "y": 0.0}
        scale = {"x": 1.0, "y": 1.0}
        skew = {"x": 0.0, "y": 0.0}

        rotation_angle = transform.rotation
        position = transform.scaled_position
        scale = transform.scale
        skew = transform.skew
        canvas_scale_factor = transform.canvas_scale

        params = request.shape_params

        if shape_type == "text":
            text_params = params if isinstance(params, dict) else {}
            try:
                image_tensor, mask_tensor, bg_tensor = text_renderer.render_text_to_tensors(
                    request.width, request.height, request.shape_color, request.bg_color, request.transparent_bg,
                    request.stroke_color, request.stroke_width,
                    text_params, position, rotation_angle, scale, skew,
                    canvas_scale_factor=canvas_scale_factor
                )
            except Exception as e:
                logger.error(f"Failed to render text shape: {e}")
                default_image = torch.zeros((1, request.height, request.width, 3), dtype=torch.float32)
                default_mask = torch.zeros((1, request.height, request.width), dtype=torch.float32)
                default_bg = torch.zeros((1, request.height, request.width, 3), dtype=torch.float32)
                return ([default_image], [default_mask], [default_bg])

            return ([image_tensor], [mask_tensor], [bg_tensor])

        # 对于多边形，需要缩放圆角半径以匹配前端视觉效果
        if shape_type == "polygon" and "corner_radius" in params:
            max_frontend_radius = 50
            max_backend_radius = 258

            # 缩放圆角半径：前端值(0-50) -> 后端值(0到max_backend_radius)
            frontend_radius = params["corner_radius"]
            scaled_radius = (frontend_radius / max_frontend_radius) * max_backend_radius
            params["corner_radius"] = scaled_radius
            logger.info(f"Scaled corner radius: frontend={frontend_radius} -> backend={scaled_radius:.2f}, max_backend_radius={max_backend_radius:.2f}")

        # 生成初始形状坐标（以形状中心为原点）
        shape_coords = shape_coordinator.generate_shape_coordinates(shape_type, shape_size, params)
        if isinstance(shape_coords, dict) and shape_coords.get("type") == "donut":
            logger.info(f"Generated donut coordinates: {len(shape_coords['outer'])} outer points, {len(shape_coords['inner'])} inner points")
        elif isinstance(shape_coords, dict) and shape_coords.get("type") == "sunburst":
            total_trapezoids = len(shape_coords['trapezoids'])
            total_points = sum(len(trapezoid) for trapezoid in shape_coords['trapezoids'])
            logger.info(f"Generated sunburst coordinates: {total_trapezoids} trapezoids, {total_points} total points")
        else:
            logger.info(f"Generated shape coordinates: {len(shape_coords)} points, first few: {shape_coords[:3] if shape_coords else 'N/A'}")

        shape_rgb = render_utils.hex_to_rgb(request.shape_color) + (255,)
        stroke_rgb = render_utils.hex_to_rgb(request.stroke_color) + (255,) if request.stroke_width > 0 else (0, 0, 0, 255)

        # 放射线图案现在使用填充渲染，不再使用描边渲染
        stroke_only_shape_types = set()
        stroke_only_shape = shape_type in stroke_only_shape_types

        # 检查是否是甜甜圈特殊几何体
        if isinstance(shape_coords, dict) and shape_coords.get("type") == "donut":
            # 分别变换外圆和内圆坐标
            transformed_outer = render_utils.apply_simple_transform(shape_coords["outer"], scale, rotation_angle, skew, position, render_width, render_height, scale_factor)
            transformed_inner = render_utils.apply_simple_transform(shape_coords["inner"], scale, rotation_angle, skew, position, render_width, render_height, scale_factor)
            transformed_coords = {"type": "donut", "outer": transformed_outer, "inner": transformed_inner}
        elif isinstance(shape_coords, dict) and shape_coords.get("type") == "sunburst":
            # 分别变换每个梯形射线
            transformed_trapezoids = []
            for trapezoid in shape_coords["trapezoids"]:
                transformed_trapezoid = render_utils.apply_simple_transform(trapezoid, scale, rotation_angle, skew, position, render_width, render_height, scale_factor)
                transformed_trapezoids.append(transformed_trapezoid)
            transformed_coords = {"type": "sunburst", "trapezoids": transformed_trapezoids}
        else:
            # 应用变换到形状坐标
            transformed_coords = render_utils.apply_simple_transform(shape_coords, scale, rotation_angle, skew, position, render_width, render_height, scale_factor)

        # 使用Shapely渲染形状和描边
        # 计算综合缩放因子：超采样因子 × 形状缩放因子（取平均值）
        avg_scale = (scale.get('x', 1.0) + scale.get('y', 1.0)) / 2.0
        frontend_scale_comp = 1.0 / 0.75 if 0.75 not in (0, None) else 1.0  # FRONTEND_CANVAS_SCALE
        compensated_stroke_width = request.stroke_width * scale_factor * avg_scale * frontend_scale_comp * 0.9 if request.stroke_width > 0 else 0  # FRONTEND_STROKE_COMPENSATION

        join_style = 1  # round

        # 检查是否是甜甜圈特殊几何体
        if isinstance(transformed_coords, dict) and transformed_coords.get("type") == "donut":
            render_utils.render_donut_with_shapely(image, transformed_coords["outer"], transformed_coords["inner"],
                                                       shape_rgb, stroke_rgb, compensated_stroke_width, join_style,
                                                       bg_rgb, transparent_bg)
        elif isinstance(transformed_coords, dict) and transformed_coords.get("type") == "sunburst":
            # 放射线图案使用通用的渲染方法，确保一致性
            # 将多个梯形合并为一个几何体进行渲染
            from shapely.geometry import MultiPolygon, Polygon
            polygons = []
            for trapezoid in transformed_coords["trapezoids"]:
                if len(trapezoid) >= 3:
                    polygon = Polygon(trapezoid)
                    if not polygon.is_empty:
                        polygons.append(polygon)

            if polygons:
                geometry = MultiPolygon(polygons)
                render_utils.render_geometry_with_shapely(image, geometry, shape_rgb, stroke_rgb, compensated_stroke_width, join_style)
        else:
            # 螺旋和其他图形都使用通用的渲染方法
            if isinstance(transformed_coords, list):
                render_utils.render_shape_with_shapely(image, transformed_coords, shape_rgb, stroke_rgb,
                                                           compensated_stroke_width, join_style, stroke_only_shape)

        # 记录坐标范围（对于甜甜圈，记录外圆的范围）
        if isinstance(transformed_coords, dict) and transformed_coords.get("type") == "donut":
            outer_coords = transformed_coords["outer"]
            logger.info(f"Final donut coordinate range - Outer: x=[{min(x for x, _ in outer_coords) if outer_coords else 'N/A'}, {max(x for x, _ in outer_coords) if outer_coords else 'N/A'}], y=[{min(y for _, y in outer_coords) if outer_coords else 'N/A'}, {max(y for _, y in outer_coords) if outer_coords else 'N/A'}]")
        elif isinstance(transformed_coords, dict) and transformed_coords.get("type") == "sunburst":
            # 对于射线形状，计算所有梯形的坐标范围
            all_coords = []
            for trapezoid in transformed_coords["trapezoids"]:
                all_coords.extend(trapezoid)
            if all_coords:
                x_coords = [x for x, _ in all_coords]
                y_coords = [y for _, y in all_coords]
                logger.info(f"Final sunburst coordinate range: x=[{min(x_coords):.2f}, {max(x_coords):.2f}], y=[{min(y_coords):.2f}, {max(y_coords):.2f}]")
            else:
                logger.info("Final sunburst coordinate range: No coordinates")
        else:
            logger.info(f"Final coordinate range: x=[{min(x for x, _ in transformed_coords) if transformed_coords else 'N/A'}, {max(x for x, _ in transformed_coords) if transformed_coords else 'N/A'}], y=[{min(y for _, y in transformed_coords) if transformed_coords else 'N/A'}, {max(y for _, y in transformed_coords) if transformed_coords else 'N/A'}]")

        # 缩小图像以抗锯齿 - 使用高质量滤波器
        image = image.resize((width, height), Image.Resampling.LANCZOS)

        image_array = np.array(image).astype(np.float32) / 255.0
        image_tensor = torch.from_numpy(image_array).unsqueeze(0)

        # 生成掩码 - 始终使用透明背景方法
        # 创建单独的透明背景图像用于掩码生成（反向蒙版）
        mask_image = Image.new("RGBA", (render_width, render_height), (0, 0, 0, 0))

        # 检查是否是甜甜圈特殊几何体
        if isinstance(transformed_coords, dict) and transformed_coords.get("type") == "donut":
            render_utils.render_donut_with_shapely(mask_image, transformed_coords["outer"], transformed_coords["inner"],
                                                       shape_rgb, stroke_rgb, compensated_stroke_width, join_style,
                                                       (0, 0, 0, 255), True)
        elif isinstance(transformed_coords, dict) and transformed_coords.get("type") == "sunburst":
            # 放射线图案使用通用的渲染方法，确保一致性
            # 将多个梯形合并为一个几何体进行渲染
            from shapely.geometry import MultiPolygon, Polygon
            polygons = []
            for trapezoid in transformed_coords["trapezoids"]:
                if len(trapezoid) >= 3:
                    polygon = Polygon(trapezoid)
                    if not polygon.is_empty:
                        polygons.append(polygon)

            if polygons:
                geometry = MultiPolygon(polygons)
                render_utils.render_geometry_with_shapely(mask_image, geometry, shape_rgb, stroke_rgb, compensated_stroke_width, join_style)
        else:
            # 螺旋和其他图形都使用通用的渲染方法
            if isinstance(transformed_coords, list):
                render_utils.render_shape_with_shapely(mask_image, transformed_coords, shape_rgb, stroke_rgb,
                                                           compensated_stroke_width, join_style, stroke_only_shape)

        # 缩小掩码图像
        mask_image = mask_image.resize((request.width, request.height), Image.Resampling.LANCZOS)
        mask_array = np.array(mask_image).astype(np.float32)[:, :, 3] / 255.0

        mask_tensor = torch.from_numpy(mask_array).unsqueeze(0)

        # Generate background image
        if request.transparent_bg:
            # Create transparent background
            bg_image = Image.new("RGBA", (request.width, request.height), (0, 0, 0, 0))
        else:
            # Create solid color background
            bg_rgb = render_utils.hex_to_rgb(request.bg_color) + (255,)
            bg_image = Image.new("RGBA", (request.width, request.height), bg_rgb)

        bg_array = np.array(bg_image).astype(np.float32) / 255.0
        bg_tensor = torch.from_numpy(bg_array).unsqueeze(0)

        # 返回列表以保持输出格式一致
        return ([image_tensor], [mask_tensor], [bg_tensor])


# 导出V3节点类
V3_NODE_CLASSES = [XIS_ShapeAndTextV3]