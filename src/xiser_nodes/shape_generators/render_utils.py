"""
渲染和变换工具模块
包含坐标变换、几何体渲染等功能
"""

import math
import logging
from typing import List, Tuple, Dict, Any

import cv2
import numpy as np
from PIL import Image, ImageDraw
from shapely import affinity
from shapely.geometry import Polygon, LineString, MultiPolygon, MultiLineString

logger = logging.getLogger(__name__)

FRONTEND_CANVAS_SCALE = 0.75  # 与前端 Konva 画布缩放保持一致，用于描边厚度补偿
FRONTEND_STROKE_COMPENSATION = 0.9  # 前端描边补偿因子（Konva 端口中的0.9系数）


class RenderUtils:
    """渲染工具类"""

    @staticmethod
    def compute_base_shape_size(width: int, height: int, scale_factor: float, shape_canvas: Dict[str, Any] = None) -> float:
        """
        计算用于渲染的基础形状尺寸，使其与前端画布视觉效果保持一致。
        如果前端提供了 base_shape_size 和 canvas_scale_factor 元数据，则以其为准；
        否则降级为旧的基于图像尺寸的计算方式。
        """
        default_size = min(width, height) * scale_factor * 0.5
        if not shape_canvas or not isinstance(shape_canvas, dict):
            return default_size

        base_shape_size = shape_canvas.get("base_shape_size")
        if base_shape_size is None:
            return default_size

        try:
            base_radius = float(base_shape_size)
        except (TypeError, ValueError):
            return default_size

        if base_radius <= 0:
            return default_size

        canvas_scale = shape_canvas.get("canvas_scale_factor", FRONTEND_CANVAS_SCALE)
        try:
            canvas_scale = float(canvas_scale)
        except (TypeError, ValueError):
            canvas_scale = FRONTEND_CANVAS_SCALE

        if canvas_scale <= 0:
            canvas_scale = FRONTEND_CANVAS_SCALE

        base_output_diameter = (base_radius * 2.0) / canvas_scale
        resolved_size = max(base_output_diameter * scale_factor, 1.0)
        logger.info(f"Resolved shape size from frontend metadata: radius={base_radius}, canvas_scale={canvas_scale}, render_size={resolved_size}")
        return resolved_size

    @staticmethod
    def hex_to_rgb(hex_color: str) -> Tuple[int, int, int]:
        """
        将十六进制颜色转换为RGB元组。

        Args:
            hex_color: 十六进制颜色字符串（例如"#FF0000"）

        Returns:
            (r, g, b) 值元组
        """
        import re
        # 处理None值或空字符串
        if hex_color is None or hex_color == "":
            logger.warning("Received None or empty hex color, using default #FF0000")
            return (255, 0, 0)

        hex_color = hex_color.lstrip('#')
        if not re.match(r'^[0-9a-fA-F]{3,6}$', hex_color):
            logger.warning(f"Invalid hex color: {hex_color}, using default #FF0000")
            return (255, 0, 0)
        if len(hex_color) == 3:
            hex_color = ''.join([c*2 for c in hex_color])
        return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))

    @staticmethod
    def apply_simple_transform(coords: List[Tuple[float, float]],
                             scale: Dict[str, float], rotation: float,
                             skew: Dict[str, float], position: Dict[str, float],
                             width: int, height: int, scale_factor: float = 1.0) -> List[Tuple[float, float]]:
        """
        简单的坐标变换方法，直接使用前端计算好的变换参数

        Args:
            coords: 形状坐标（以中心为原点）
            scale: 缩放比例
            rotation: 旋转角度
            skew: 倾斜参数
            position: 位置偏移（前端已经计算好的绝对像素位置）
            width: 画布宽度
            height: 画布高度
            scale_factor: 缩放因子

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

        # 计算画布中心
        center_x = width / 2
        center_y = height / 2

        # 前端position是归一化的值（相对于画布中心，范围-0.5到0.5）
        # 前端已经处理了0.75的缩放，发送的是基于原始尺寸的归一化位置
        # 直接使用归一化位置 × 画布宽度/高度
        pos_x = position.get('x', 0.0) * width
        pos_y = position.get('y', 0.0) * height

        logger.info(f"Simple transform: position=({pos_x}, {pos_y}), rotation={rotation}°, scale=({sx}, {sy}), skew=({kx}, {ky})")

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

            # 4. 平移（直接使用前端计算的位置）
            x_t = x_k + center_x + pos_x
            y_t = y_k + center_y + pos_y

            transformed_coords.append((x_t, y_t))

        logger.info(f"Simple transformed coordinates range: x=[{min(x for x, _ in transformed_coords):.2f}, {max(x for x, _ in transformed_coords):.2f}], y=[{min(y for _, y in transformed_coords):.2f}, {max(y for _, y in transformed_coords):.2f}]")
        return transformed_coords

    @staticmethod
    def _generate_stroke_mask(fill_mask: np.ndarray, stroke_width: float):
        """根据填充蒙版生成像素描边蒙版"""
        if stroke_width <= 0 or fill_mask.max() == 0:
            return None

        stroke_radius = max(0.5, stroke_width / 2.0)
        fill_binary = (fill_mask > 0).astype(np.uint8)
        background = (1 - fill_binary).astype(np.uint8)

        try:
            dist_out = cv2.distanceTransform(background * 255, cv2.DIST_L2, 5)
            dist_in = cv2.distanceTransform(fill_binary * 255, cv2.DIST_L2, 5)
            outer_ring = np.logical_and(background == 1, dist_out <= stroke_radius)
            inner_ring = np.logical_and(fill_binary == 1, dist_in <= stroke_radius)
            stroke_mask = np.where(np.logical_or(outer_ring, inner_ring), 255, 0).astype(np.uint8)
            return stroke_mask
        except Exception as e:
            logger.warning(f"Failed to compute stroke mask: {e}")
            return None

    @staticmethod
    def _geometry_to_mask(geometry, width: int, height: int) -> Image.Image:
        """将Shapely几何体栅格化为单通道蒙版"""
        mask = Image.new("L", (width, height), 0)
        if geometry is None or geometry.is_empty:
            return mask

        draw = ImageDraw.Draw(mask)
        RenderUtils._draw_geometry_mask(draw, geometry)
        return mask

    @staticmethod
    def _draw_geometry_mask(draw: ImageDraw.ImageDraw, geometry) -> None:
        if geometry.is_empty:
            return

        if geometry.geom_type == "Polygon":
            exterior = [(round(x), round(y)) for x, y in geometry.exterior.coords]
            if exterior and exterior[0] != exterior[-1]:
                exterior.append(exterior[0])
            draw.polygon(exterior, fill=255, outline=255)

            for interior in geometry.interiors:
                hole = [(round(x), round(y)) for x, y in interior.coords]
                if hole and hole[0] != hole[-1]:
                    hole.append(hole[0])
                draw.polygon(hole, fill=0, outline=0)
        elif geometry.geom_type == "MultiPolygon":
            for poly in geometry.geoms:
                RenderUtils._draw_geometry_mask(draw, poly)
        elif geometry.geom_type == "LineString":
            coords = [(round(x), round(y)) for x, y in geometry.coords]
            if len(coords) >= 2:
                draw.line(coords, fill=255, width=1)
        elif geometry.geom_type == "MultiLineString":
            for line in geometry.geoms:
                coords = [(round(x), round(y)) for x, y in line.coords]
                if len(coords) >= 2:
                    draw.line(coords, fill=255, width=1)
        elif geometry.geom_type == "GeometryCollection":
            for geom in geometry.geoms:
                RenderUtils._draw_geometry_mask(draw, geom)

    @staticmethod
    def _apply_geometry_pixel_layer(target_image: Image.Image, geometry,
                                    fill_color: Tuple[int, int, int, int],
                                    stroke_color: Tuple[int, int, int, int],
                                    stroke_width: float) -> None:
        """
        使用像素级描边逻辑将几何体叠加到目标图像
        """
        if geometry is None or geometry.is_empty:
            return

        width, height = target_image.size
        fill_mask_img = RenderUtils._geometry_to_mask(geometry, width, height)
        fill_mask = np.array(fill_mask_img, dtype=np.uint8)
        stroke_mask = None
        if stroke_color is not None and stroke_width > 0:
            stroke_mask = RenderUtils._generate_stroke_mask(fill_mask, stroke_width)

        layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))

        if stroke_mask is not None:
            stroke_alpha = Image.fromarray(stroke_mask, mode="L")
            stroke_image = Image.new("RGBA", (width, height), stroke_color)
            stroke_image.putalpha(stroke_alpha)
            layer = Image.alpha_composite(layer, stroke_image)

        if fill_mask.max() > 0:
            fill_alpha = Image.fromarray(fill_mask, mode="L")
            fill_image = Image.new("RGBA", (width, height), fill_color)
            fill_image.putalpha(fill_alpha)
            layer = Image.alpha_composite(layer, fill_image)

        target_image.paste(layer, (0, 0), layer)

    @staticmethod
    def render_geometry_with_shapely(image: Image.Image, geometry,
                                     shape_color: Tuple[int, int, int, int],
                                     stroke_color: Tuple[int, int, int, int],
                                     stroke_width: float, join_style: int = 1) -> None:
        """
        使用统一的像素描边逻辑渲染任意Shapely几何体
        """
        try:
            if geometry is None or geometry.is_empty:
                return

            geom_type = geometry.geom_type
            treat_as_line = geom_type in ("LineString", "MultiLineString") or (hasattr(geometry, "area") and geometry.area == 0)

            if treat_as_line:
                if stroke_color is None or stroke_width <= 0:
                    return
                buffer_width = max(0.5, stroke_width / 2.0)
                try:
                    buffered = geometry.buffer(buffer_width, join_style=join_style, cap_style=1)
                except Exception as buffer_err:
                    logger.warning(f"Line geometry buffer failed: {buffer_err}")
                    buffered = geometry.buffer(buffer_width, cap_style=1)
                if buffered is None or buffered.is_empty:
                    return
                RenderUtils._apply_geometry_pixel_layer(image, buffered, stroke_color, None, 0)
                return

            RenderUtils._apply_geometry_pixel_layer(image, geometry, shape_color, stroke_color, stroke_width)
        except Exception as e:
            logger.error(f"Shapely geometry rendering error: {e}")

    @staticmethod
    def render_sunburst_with_shapely(image: Image.Image, trapezoids: List[List[Tuple[float, float]]],
                                   shape_color: Tuple[int, int, int, int], stroke_color: Tuple[int, int, int, int],
                                   stroke_width: float, join_style: int = 1) -> None:
        """
        专门渲染放射线图案，处理多个独立的梯形多边形
        确保每个梯形都单独渲染，避免合并导致的细线问题
        """
        if not trapezoids:
            return

        try:
            from shapely.geometry import Polygon, MultiPolygon

            # 创建所有梯形的MultiPolygon
            polygons = []
            for trapezoid in trapezoids:
                if len(trapezoid) >= 3:
                    polygon = Polygon(trapezoid)
                    if not polygon.is_empty:
                        polygons.append(polygon)

            if not polygons:
                return

            # 使用MultiPolygon确保每个梯形都单独渲染
            geometry = MultiPolygon(polygons)

            # 使用统一的几何体渲染方法，确保射线有足够的填充
            RenderUtils.render_geometry_with_shapely(image, geometry, shape_color, stroke_color, stroke_width, join_style)

        except Exception as e:
            logger.error(f"Sunburst rendering error: {e}")
            # 降级到逐个渲染，确保每个梯形都单独填充
            draw = ImageDraw.Draw(image, 'RGBA')
            for trapezoid in trapezoids:
                if len(trapezoid) >= 3:
                    int_coords = [(round(x), round(y)) for x, y in trapezoid]
                    if int_coords and int_coords[0] != int_coords[-1]:
                        int_coords.append(int_coords[0])
                    # 确保每个梯形都单独填充，避免细线问题
                    draw.polygon(int_coords, fill=shape_color, outline=None)
                    # 如果需要描边，单独添加描边
                    if stroke_width > 0 and stroke_color is not None:
                        stroke_width_int = max(1, round(stroke_width))
                        for i in range(len(int_coords) - 1):
                            draw.line([int_coords[i], int_coords[i + 1]],
                                     fill=stroke_color, width=stroke_width_int)

    @staticmethod
    def render_shape_with_shapely(image: Image.Image, coords: List[Tuple[float, float]],
                                 shape_color: Tuple[int, int, int, int], stroke_color: Tuple[int, int, int, int],
                                 stroke_width: float, join_style: int = 1, stroke_only: bool = False) -> None:
        """
        使用Shapely渲染形状和描边

        Args:
            draw: ImageDraw对象
            coords: 形状坐标
            shape_color: 填充颜色
            stroke_color: 描边颜色
            stroke_width: 描边宽度
            join_style: 连接样式 (1=圆角, 2=斜角, 3=平角)
            cap_style: 端点样式 (1=圆形, 2=扁平, 3=方形)
        """
        if not coords or (not stroke_only and len(coords) < 3):
            return

        try:
            if stroke_only:
                segments = []
                it_range = len(coords) - 1
                for idx in range(0, it_range, 2):
                    start_pt = coords[idx]
                    end_pt = coords[idx + 1] if idx + 1 < len(coords) else None
                    if end_pt is not None:
                        segments.append((start_pt, end_pt))
                if not segments:
                    return
                geometry = MultiLineString(segments)
            else:
                polygon = Polygon(coords)
                geometry = polygon

            RenderUtils.render_geometry_with_shapely(image, geometry, shape_color, stroke_color, stroke_width, join_style)

        except Exception as e:
            logger.error(f"Shapely rendering error: {e}")
            draw = ImageDraw.Draw(image, 'RGBA')
            if stroke_only:
                stroke_width_int = max(1, round(stroke_width))
                for idx in range(0, len(coords) - 1, 2):
                    start_pt = coords[idx]
                    end_pt = coords[idx + 1] if idx + 1 < len(coords) else None
                    if end_pt is not None:
                        draw.line([start_pt, end_pt], fill=stroke_color, width=stroke_width_int)
            else:
                int_coords = [(round(x), round(y)) for x, y in coords]
                if int_coords and int_coords[0] != int_coords[-1]:
                    int_coords.append(int_coords[0])
                draw.polygon(int_coords, fill=shape_color, outline=None)

    @staticmethod
    def render_donut_with_shapely(image: Image.Image, outer_coords: List[Tuple[float, float]],
                                 inner_coords: List[Tuple[float, float]], shape_color: Tuple[int, int, int, int],
                                 stroke_color: Tuple[int, int, int, int], stroke_width: float, join_style: int = 1,
                                 bg_color: Tuple[int, int, int, int] = (0, 0, 0, 255), transparent_bg: bool = False) -> None:
        """
        使用Shapely渲染甜甜圈形状，确保平滑的描边和正确的背景处理

        Args:
            draw: ImageDraw对象
            outer_coords: 外圆坐标
            inner_coords: 内圆坐标
            shape_color: 填充颜色
            stroke_color: 描边颜色
            stroke_width: 描边宽度
            join_style: 连接样式
        """
        if not outer_coords or not inner_coords or len(outer_coords) < 3 or len(inner_coords) < 3:
            return

        try:
            donut_geometry = Polygon(outer_coords, [inner_coords])
            RenderUtils.render_geometry_with_shapely(image, donut_geometry, shape_color, stroke_color, stroke_width, join_style)
            logger.info("Donut rendered using unified pixel geometry method")
        except Exception as e:
            logger.error(f"Shapely donut rendering error: {e}")
            try:
                draw = ImageDraw.Draw(image, 'RGBA')
                int_outer_coords = [(round(x), round(y)) for x, y in outer_coords]
                int_inner_coords = [(round(x), round(y)) for x, y in inner_coords]
                if int_outer_coords and int_outer_coords[0] != int_outer_coords[-1]:
                    int_outer_coords.append(int_outer_coords[0])
                if int_inner_coords and int_inner_coords[0] != int_inner_coords[-1]:
                    int_inner_coords.append(int_inner_coords[0])
                draw.polygon(int_outer_coords, fill=shape_color, outline=None)
                draw.polygon(int_inner_coords, fill=(0, 0, 0, 0) if transparent_bg else bg_color, outline=None)
                if stroke_width > 0:
                    stroke_width_int = max(1, round(stroke_width))
                    for i in range(len(int_outer_coords) - 1):
                        draw.line([int_outer_coords[i], int_outer_coords[i + 1]],
                                  fill=stroke_color, width=stroke_width_int)
                    for i in range(len(int_inner_coords) - 1):
                        draw.line([int_inner_coords[i], int_inner_coords[i + 1]],
                                  fill=stroke_color, width=stroke_width_int)
                logger.info("Donut rendered using fallback polygon method")
            except Exception as e2:
                logger.error(f"Fallback donut rendering also failed: {e2}")

    @staticmethod
    def render_spiral_with_shapely(image: Image.Image, coords: List[Tuple[float, float]],
                                 shape_color: Tuple[int, int, int, int], stroke_color: Tuple[int, int, int, int],
                                 stroke_width: float, join_style: int = 1,
                                 bg_color: Tuple[int, int, int, int] = (0, 0, 0, 255), transparent_bg: bool = False) -> None:
        """
        使用Shapely渲染螺旋形状（基于闭合的填充区域）
        """
        if not coords or len(coords) < 3:
            return

        try:
            # 现在螺旋是闭合的填充区域，使用Polygon渲染
            polygon = Polygon(coords)
            RenderUtils.render_geometry_with_shapely(image, polygon, shape_color, stroke_color, stroke_width, join_style)

        except Exception as e:
            logger.error(f"Shapely spiral rendering error: {e}")
            # 出错时回退到简单多边形绘制
            draw = ImageDraw.Draw(image, 'RGBA')
            int_coords = [(round(x), round(y)) for x, y in coords]
            if int_coords and int_coords[0] != int_coords[-1]:
                int_coords.append(int_coords[0])
            # 填充形状
            draw.polygon(int_coords, fill=shape_color, outline=None)
            # 添加描边
            if stroke_width > 0 and stroke_color is not None:
                stroke_width_int = max(1, round(stroke_width))
                for i in range(len(int_coords) - 1):
                    draw.line([int_coords[i], int_coords[i + 1]],
                             fill=stroke_color, width=stroke_width_int)
