"""
文字处理模块
包含字体加载、文字渲染、几何体转换等功能
"""

import os
import json
import math
import logging
import re
from collections import OrderedDict
from functools import lru_cache
from typing import List, Dict, Any, Tuple, Optional

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen
try:
    from fontTools.pens.flattenPen import FlattenPen as FTFlattenPen
except ImportError:  # pragma: no cover - fallback for older fontTools
    FTFlattenPen = None
from shapely import affinity
from shapely.geometry import Polygon, LineString, MultiPolygon, MultiLineString
from shapely.ops import unary_union

logger = logging.getLogger(__name__)

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
FONTS_DIR = os.path.join(BASE_DIR, "fonts")
FRONTEND_CANVAS_SCALE = 0.75  # 与前端 Konva 画布缩放保持一致，用于描边厚度补偿
FRONTEND_STROKE_COMPENSATION = 0.9  # 前端描边补偿因子（Konva 端口中的0.9系数）


class TextProcessor:
    """文字处理器类"""

    def __init__(self):
        self._text_geometry_cache = OrderedDict()
        self._max_text_geometry_cache = 32

    def _resolve_font_path(self, font_file: str) -> str:
        """根据文件名解析字体路径"""
        if not font_file:
            return None
        candidate = os.path.join(FONTS_DIR, font_file)
        if os.path.isfile(candidate):
            return candidate
        logger.warning(f"Font file not found in fonts directory: {font_file}")
        return None

    @lru_cache(maxsize=16)
    def _load_ttfont(self, font_path: str) -> TTFont:
        return TTFont(font_path)

    def _get_font_units_per_em(self, ttfont: TTFont) -> int:
        try:
            return ttfont['head'].unitsPerEm
        except Exception:
            return 2048

    def _get_font_metrics(self, ttfont: TTFont) -> Tuple[int, int, int]:
        try:
            os2 = ttfont['OS/2']
            return os2.sTypoAscender, os2.sTypoDescender, os2.sTypoLineGap
        except Exception:
            hhea = ttfont['hhea']
            return hhea.ascent, hhea.descent, hhea.lineGap

    class _GlyphPathPen:
        def __init__(self):
            self.paths: List[List[Tuple[float, float]]] = []
            self.current: List[Tuple[float, float]] = []

        def moveTo(self, pt):
            if self.current:
                self.closePath()
            self.current = [pt]

        def lineTo(self, pt):
            if not self.current:
                self.current = [pt]
            self.current.append(pt)

        def curveTo(self, *points):
            if points:
                self.lineTo(points[-1])

        def qCurveTo(self, *points):
            if points:
                self.lineTo(points[-1])

        def closePath(self):
            if self.current:
                if self.current[0] != self.current[-1]:
                    self.current.append(self.current[0])
                if len(self.current) > 2:
                    self.paths.append(self.current)
            self.current = []

        def endPath(self):
            self.closePath()

    class _FallbackFlattenPen(BasePen):
        def __init__(self, glyphSet, out_pen, steps: int = 24):
            super().__init__(glyphSet)
            self.out_pen = out_pen
            self.steps = max(4, steps)

        def _moveTo(self, p0):
            self.out_pen.moveTo(p0)

        def _lineTo(self, p1):
            self.out_pen.lineTo(p1)

        def _curveToOne(self, p1, p2, p3):
            p0 = self._getCurrentPoint()
            for i in range(1, self.steps + 1):
                t = i / self.steps
                x = (1 - t) ** 3 * p0[0] + 3 * (1 - t) ** 2 * t * p1[0] + 3 * (1 - t) * t ** 2 * p2[0] + t ** 3 * p3[0]
                y = (1 - t) ** 3 * p0[1] + 3 * (1 - t) ** 2 * t * p1[1] + 3 * (1 - t) * t ** 2 * p2[1] + t ** 3 * p3[1]
                self.out_pen.lineTo((x, y))

        def _qCurveToOne(self, p1, p2):
            p0 = self._getCurrentPoint()
            for i in range(1, self.steps + 1):
                t = i / self.steps
                x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t ** 2 * p2[0]
                y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t ** 2 * p2[1]
                self.out_pen.lineTo((x, y))

        def _closePath(self):
            self.out_pen.closePath()

    def _load_font(self, font_file: str, font_size: int) -> Tuple[ImageFont.ImageFont, bool]:
        """
        加载字体，若失败则使用默认字体

        Returns:
            (font, is_scalable) - is_scalable 表示字体是否支持自定义字号
        """
        search_paths = []
        font_path = self._resolve_font_path(font_file)
        if font_path:
            search_paths.append(font_path)

        # 尝试常见字体名称（如果系统已安装）
        search_paths.append("DejaVuSans.ttf")
        search_paths.append("Arial.ttf")
        search_paths.append("Arial Unicode.ttf")

        for path in search_paths:
            if not path:
                continue
            try:
                font = ImageFont.truetype(path, font_size)
                return font, True
            except OSError:
                continue

        system_font_dirs = [
            "/System/Library/Fonts",
            "/System/Library/Fonts/Supplemental",
            "/Library/Fonts",
            os.path.expanduser("~/Library/Fonts"),
            "/usr/share/fonts",
            "/usr/local/share/fonts",
            "C:\\Windows\\Fonts"
        ]

        fallback_names = [
            "Arial.ttf",
            "ArialUnicode.ttf",
            "Arial Unicode.ttf",
            "Helvetica.ttf",
            "DejaVuSans.ttf",
            "NotoSans-Regular.ttf",
            "LiberationSans-Regular.ttf"
        ]

        for directory in system_font_dirs:
            if not directory or not os.path.isdir(directory):
                continue

            for name in fallback_names:
                candidate = os.path.join(directory, name)
                if os.path.isfile(candidate):
                    try:
                        font = ImageFont.truetype(candidate, font_size)
                        return font, True
                    except OSError:
                        continue

            # 如果指定名称未命中，则扫描目录中的所有字体文件
            try:
                for filename in os.listdir(directory):
                    if not filename.lower().endswith((".ttf", ".otf", ".ttc")):
                        continue
                    candidate = os.path.join(directory, filename)
                    try:
                        font = ImageFont.truetype(candidate, font_size)
                        return font, True
                    except OSError:
                        continue
            except PermissionError:
                continue

        logger.warning("Falling back to default PIL font (limited glyph support)")
        return ImageFont.load_default(), False

    def _measure_text_line(self, text: str, font: ImageFont.ImageFont, letter_spacing: float) -> float:
        """计算一行文本宽度"""
        if not text:
            text = " "
        width = 0.0
        for idx, char in enumerate(text):
            try:
                bbox = font.getbbox(char)
                glyph_width = bbox[2] - bbox[0]
            except AttributeError:
                glyph_width = font.getsize(char)[0]
            width += glyph_width
            if idx < len(text) - 1:
                width += letter_spacing
        return max(width, 1.0)

    def _create_text_mask(self, text_params: Dict[str, Any], scale_factor: float) -> Image.Image:
        """根据文本参数生成单通道蒙版"""
        content = text_params.get("content", "A")
        uppercase = text_params.get("uppercase", True)
        if not content:
            content = "A"
        if uppercase:
            content = content.upper()
        lines = content.replace("\r", "").split("\n")
        lines = [line if line else " " for line in lines] or [" "]

        # 匹配前端文字尺寸：前端使用固定fontSize，后端需要应用相同的尺寸计算
        # 前端画布尺寸 = 输出尺寸 * CANVAS_SCALE_FACTOR (0.75)
        # 但字体大小计算应该直接使用前端参数，不需要额外缩放
        font_size_param = max(12, int(text_params.get("font_size", 128)))
        font_size_px = max(12, int(font_size_param * scale_factor))
        letter_spacing_px = float(text_params.get("letter_spacing", 0.0)) * scale_factor
        line_spacing = max(0.5, float(text_params.get("line_spacing", 1.2)))
        font_weight = str(text_params.get("font_weight", "normal")).lower()
        font_style = str(text_params.get("font_style", "normal")).lower()
        underline = bool(text_params.get("underline", False))
        text_align = str(text_params.get("text_align", "center")).lower()
        if text_align not in ("left", "center", "right"):
            text_align = "center"

        font, scalable_font = self._load_font(text_params.get("font_file"), font_size_px)
        try:
            ascent, descent = font.getmetrics()
        except AttributeError:
            ascent = font_size_px
            descent = int(font_size_px * 0.2)
        base_line_height = max(ascent + descent, 1)
        scale_ratio = 1.0
        if not scalable_font:
            scale_ratio = max(1.0, font_size_px / base_line_height)
        effective_letter_spacing = letter_spacing_px / scale_ratio

        line_widths = [self._measure_text_line(line, font, effective_letter_spacing) for line in lines]
        max_width = max(line_widths) if line_widths else base_line_height
        total_height = len(lines) * base_line_height + max(0, len(lines) - 1) * base_line_height * (line_spacing - 1)
        padding = max(16, int((font_size_px * 0.5) / scale_ratio))

        mask_width = int(max_width + padding * 2)
        mask_height = int(total_height + padding * 2)
        mask = Image.new("L", (mask_width, mask_height), 0)
        draw = ImageDraw.Draw(mask)

        y = padding
        for line_idx, line in enumerate(lines):
            line_width = self._measure_text_line(line, font, effective_letter_spacing)
            if text_align == "left":
                x = padding
            elif text_align == "right":
                x = padding + (max_width - line_width)
            else:
                x = padding + (max_width - line_width) / 2
            for char_idx, char in enumerate(line):
                draw.text((x, y), char, fill=255, font=font)
                try:
                    bbox = font.getbbox(char)
                    advance = bbox[2] - bbox[0]
                except AttributeError:
                    advance = font.getsize(char)[0]
                x += advance
                if char_idx < len(line) - 1:
                    x += effective_letter_spacing

            if underline:
                underline_thickness = max(1, int((font_size_px * 0.05) / scale_ratio))
                underline_y = y + ascent + underline_thickness
                draw.rectangle(
                    [
                        padding,
                        underline_y,
                        mask_width - padding,
                        underline_y + underline_thickness
                    ],
                    fill=255
                )

            y += base_line_height * line_spacing

        mask_array = np.array(mask)
        if font_weight == "bold":
            kernel = np.ones((3, 3), np.uint8)
            mask_array = cv2.dilate(mask_array, kernel, iterations=1)

        mask = Image.fromarray(mask_array)

        if font_style == "italic":
            shear_factor = 0.3
            offset = int(abs(shear_factor) * mask.height)
            new_width = mask.width + offset
            mask = mask.transform(
                (new_width, mask.height),
                Image.AFFINE,
                (1, shear_factor, -offset if shear_factor < 0 else 0, 0, 1, 0),
                resample=Image.BICUBIC,
                fillcolor=0
            )

        if scale_ratio != 1.0:
            new_width = max(1, int(mask.width * scale_ratio))
            new_height = max(1, int(mask.height * scale_ratio))
            mask = mask.resize((new_width, new_height), Image.BICUBIC)

        return mask

    def _mask_to_geometry(self, mask: Image.Image):
        """将文本蒙版转换为Shapely几何体"""
        mask_array = np.array(mask)
        if mask_array.max() == 0:
            return None

        _, binary = cv2.threshold(mask_array, 1, 255, cv2.THRESH_BINARY)
        contours, hierarchy = cv2.findContours(binary, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)

        if contours is None or len(contours) == 0:
            return None

        if hierarchy is None:
            hierarchy = []
        else:
            hierarchy = hierarchy[0]

        center_x = mask_array.shape[1] / 2.0
        center_y = mask_array.shape[0] / 2.0
        polygons = []

        for idx, contour in enumerate(contours):
            if len(contour) < 3:
                continue

            parent_index = hierarchy[idx][3] if len(hierarchy) > idx else -1
            if parent_index != -1:
                # 只在处理外轮廓时创建多边形，孔将在后续处理
                continue

            exterior = [(float(point[0][0] - center_x), float(point[0][1] - center_y)) for point in contour]
            holes = []
            child_index = hierarchy[idx][2] if len(hierarchy) > idx else -1
            while child_index != -1:
                hole_contour = contours[child_index]
                if len(hole_contour) >= 3:
                    hole = [(float(point[0][0] - center_x), float(point[0][1] - center_y)) for point in hole_contour]
                    holes.append(hole)
                child_index = hierarchy[child_index][0]

            polygon = Polygon(exterior, holes)
            if polygon.is_valid and not polygon.is_empty:
                polygons.append(polygon)

        if not polygons:
            return None

        if len(polygons) == 1:
            return polygons[0]

        return unary_union(polygons)

    def _paths_to_geometry(self, paths: List[List[Tuple[float, float]]]):
        """将由字体轮廓生成的路径转换为Shapely几何体"""
        if not paths:
            return None

        def ensure_closed(points):
            if not points:
                return points
            if points[0] != points[-1]:
                points = points + [points[0]]
            return points

        entries = []
        for raw_pts in paths:
            if not raw_pts or len(raw_pts) < 3:
                continue
            pts = ensure_closed(raw_pts)
            try:
                polygon = Polygon(pts)
                if not polygon.is_valid:
                    polygon = polygon.buffer(0)
                if polygon.is_empty:
                    continue
                entries.append({
                    "coords": pts,
                    "polygon": polygon,
                    "children": [],
                    "parent": None
                })
            except Exception as e:
                logger.debug(f"Failed to convert glyph path to polygon: {e}")
                continue

        if not entries:
            return None

        for idx, entry in enumerate(entries):
            parent = None
            parent_area = None
            for jdx, candidate in enumerate(entries):
                if idx == jdx:
                    continue
                try:
                    if candidate["polygon"].contains(entry["polygon"]):
                        cand_area = candidate["polygon"].area
                        if parent is None or cand_area < parent_area:
                            parent = candidate
                            parent_area = cand_area
                except Exception:
                    continue
            if parent:
                entry["parent"] = parent
                parent["children"].append(entry)

        def build_polygons(node, depth=0):
            results = []
            hole_coords = []
            for child in node["children"]:
                if depth % 2 == 0:
                    hole_coords.append(child["coords"])
                results.extend(build_polygons(child, depth + 1))
            if depth % 2 == 0:
                try:
                    poly = Polygon(node["coords"], [ensure_closed(h) for h in hole_coords if h and len(h) >= 3])
                    if not poly.is_valid:
                        poly = poly.buffer(0)
                    if poly.is_valid and not poly.is_empty:
                        results.insert(0, poly)
                except Exception as e:
                    logger.debug(f"Failed to assemble polygon with hierarchical holes: {e}")
            return results

        polygons = []
        for entry in entries:
            if entry["parent"] is None:
                polygons.extend(build_polygons(entry))

        if not polygons:
            return None

        if len(polygons) == 1:
            return polygons[0]

        try:
            return MultiPolygon(polygons)
        except Exception as e:
            logger.warning(f"Failed to assemble glyph multipolygon: {e}")
            return polygons[0]

    def _build_text_geometry_with_fonttools(self, text_params: Dict[str, Any], scale_factor: float):
        font_path = self._resolve_font_path(text_params.get("font_file"))
        if not font_path:
            return None

        try:
            ttfont = self._load_ttfont(font_path)
        except Exception as e:
            logger.warning(f"fontTools failed to load font {font_path}: {e}")
            return None

        cmap = ttfont.getBestCmap() or {}
        glyph_set = ttfont.getGlyphSet()
        try:
            glyph_names = set(glyph_set.keys())
        except AttributeError:
            glyph_names = set(ttfont.getGlyphOrder())
        units_per_em = self._get_font_units_per_em(ttfont)

        content = text_params.get("content", "A") or "A"
        content = content.replace("\r", "")
        lines = content.split("\n") or [" "]
        if text_params.get("uppercase", True):
            lines = [line.upper() or " " for line in lines]

        font_size_param = max(12, int(text_params.get("font_size", 128)))
        font_size_px = max(12, int(font_size_param * scale_factor))
        scale = font_size_px / units_per_em
        letter_spacing_px = float(text_params.get("letter_spacing", 0.0)) * scale_factor
        letter_spacing_units = letter_spacing_px / scale
        line_spacing = max(0.5, float(text_params.get("line_spacing", 1.2)))
        font_weight = str(text_params.get("font_weight", "normal")).lower()
        font_style = str(text_params.get("font_style", "normal")).lower()
        underline = bool(text_params.get("underline", False))
        text_align = str(text_params.get("text_align", "center")).lower()
        if text_align not in ("left", "center", "right"):
            text_align = "center"

        ascent_units, descent_units, linegap_units = self._get_font_metrics(ttfont)
        baseline_offset = ascent_units * scale
        line_height_px = (ascent_units - descent_units + linegap_units) * scale * line_spacing

        geom_list = []

        hmtx = ttfont['hmtx'] if 'hmtx' in ttfont else None
        space_advance_units = None
        space_glyph = cmap.get(ord(' ')) or ('space' if 'space' in glyph_names else None)
        if space_glyph and hmtx and space_glyph in hmtx.metrics:
            space_advance_units = hmtx.metrics[space_glyph][0]
        elif space_glyph and hasattr(glyph_set[space_glyph], 'width'):
            space_advance_units = glyph_set[space_glyph].width
        else:
            space_advance_units = units_per_em * 0.5

        def measure_line_width_units(line_text: str) -> float:
            pen_units = 0.0
            for char in line_text:
                glyph_name = cmap.get(ord(char))
                if not glyph_name:
                    if char == ' ':
                        pen_units += space_advance_units + letter_spacing_units
                        continue
                    glyph_name = '.notdef' if '.notdef' in glyph_names else None
                if not glyph_name or glyph_name not in glyph_names:
                    pen_units += letter_spacing_units
                    continue
                if hmtx and glyph_name in hmtx.metrics:
                    advance_units = hmtx.metrics[glyph_name][0]
                else:
                    glyph_obj = glyph_set[glyph_name]
                    advance_units = getattr(glyph_obj, 'width', units_per_em * 0.6)
                pen_units += advance_units + letter_spacing_units
            return pen_units

        line_widths_units = [measure_line_width_units(line) for line in lines]
        line_widths_px = [width_units * scale for width_units in line_widths_units]
        max_line_width_px = max(line_widths_px) if line_widths_px else 0.0

        def compute_line_offset(line_idx: int) -> float:
            if not line_widths_px:
                return 0.0
            line_width_px = line_widths_px[line_idx]
            if text_align == "left":
                return 0.0
            if text_align == "right":
                return max_line_width_px - line_width_px
            return (max_line_width_px - line_width_px) / 2.0

        for line_index, line in enumerate(lines):
            pen_x_units = 0.0
            y_offset = line_index * line_height_px
            line_offset_px = compute_line_offset(line_index)

            for char in line:
                glyph_name = cmap.get(ord(char))
                if not glyph_name:
                    if char == ' ':
                        pen_x_units += space_advance_units + letter_spacing_units
                        continue
                    glyph_name = '.notdef' if '.notdef' in glyph_names else None
                if not glyph_name or glyph_name not in glyph_names:
                    pen_x_units += letter_spacing_units
                    continue

                glyph = glyph_set[glyph_name]
                path_pen = self._GlyphPathPen()
                if FTFlattenPen:
                    flatten_pen = FTFlattenPen(path_pen, approximateSegmentLength=2, segmentLines=16)
                else:
                    flatten_pen = self._FallbackFlattenPen(glyph_set, path_pen, steps=24)
                try:
                    glyph.draw(flatten_pen)
                except Exception:
                    pen_x_units += letter_spacing_units
                    continue

                transformed_paths = []
                for pts in path_pen.paths:
                    transformed = []
                    for x, y in pts:
                        px = ((x + pen_x_units) * scale) + line_offset_px
                        py = (-y * scale) + y_offset + baseline_offset
                        transformed.append((px, py))
                    if transformed:
                        transformed_paths.append(transformed)

                glyph_geometry = self._paths_to_geometry(transformed_paths)
                if glyph_geometry and not glyph_geometry.is_empty:
                    geom_list.append(glyph_geometry)

                if hmtx and glyph_name in hmtx.metrics:
                    advance_units = hmtx.metrics[glyph_name][0]
                else:
                    advance_units = getattr(glyph, 'width', units_per_em * 0.6)
                pen_x_units += advance_units + letter_spacing_units

            # no additional bookkeeping required per line

        if not geom_list:
            return None

        geometry = unary_union(geom_list)

        if underline:
            underline_height = max(1.0, font_size_px * 0.05)
            underline_y = baseline_offset + underline_height * 0.5
            minx, _, maxx, _ = geometry.bounds
            underline_poly = Polygon([
                (minx, underline_y),
                (maxx, underline_y),
                (maxx, underline_y + underline_height),
                (minx, underline_y + underline_height)
            ])
            geometry = unary_union([geometry, underline_poly])

        if font_weight == "bold":
            bold_strength = max(0.5, font_size_px * 0.02)
            geometry = geometry.buffer(bold_strength)

        if font_style == "italic":
            geometry = affinity.skew(geometry, xs=12, origin=(0, 0))

        minx, miny, maxx, maxy = geometry.bounds
        geometry = affinity.translate(geometry, xoff=-(minx + maxx) / 2, yoff=-(miny + maxy) / 2)

        return geometry

    def _normalize_text_params(self, params: Dict[str, Any]) -> Dict[str, Any]:
        defaults = {
            "content": "A",
            "font_file": None,
            "font_size": 128,
            "letter_spacing": 0.0,
            "line_spacing": 1.2,
            "font_weight": "normal",
            "font_style": "normal",
            "underline": False,
            "uppercase": True,
            "text_align": "center"
        }
        normalized = defaults.copy()
        if params and isinstance(params, dict):
            for key, value in params.items():
                if value is not None:
                    normalized[key] = value
        return normalized

    def _text_geometry_cache_key(self, params: Dict[str, Any], scale_factor: float):
        content = params.get("content", "")
        font_file = params.get("font_file") or ""
        font_size = params.get("font_size", 128)
        letter_spacing = params.get("letter_spacing", 0.0)
        line_spacing = params.get("line_spacing", 1.2)
        font_weight = params.get("font_weight", "normal")
        font_style = params.get("font_style", "normal")
        underline = params.get("underline", False)
        uppercase = params.get("uppercase", True)
        text_align = params.get("text_align", "center")
        return (
            content,
            font_file,
            font_size,
            letter_spacing,
            line_spacing,
            font_weight,
            font_style,
            underline,
            uppercase,
            text_align,
            round(scale_factor, 4)
        )

    def _store_text_geometry_cache(self, cache_key, geometry):
        if cache_key in self._text_geometry_cache:
            self._text_geometry_cache.move_to_end(cache_key)
        self._text_geometry_cache[cache_key] = geometry
        if len(self._text_geometry_cache) > self._max_text_geometry_cache:
            self._text_geometry_cache.popitem(last=False)

    def build_text_geometry(self, text_params: Dict[str, Any], scale_factor: float):
        """构建文本几何体"""
        normalized_params = self._normalize_text_params(text_params)
        cache_key = self._text_geometry_cache_key(normalized_params, scale_factor)
        cached_geometry = self._text_geometry_cache.get(cache_key)
        if cached_geometry is not None:
            return cached_geometry

        geometry = self._build_text_geometry_with_fonttools(normalized_params, scale_factor)
        if geometry is None or geometry.is_empty:
            mask = self._create_text_mask(normalized_params, scale_factor)
            geometry = self._mask_to_geometry(mask)
        if geometry is None or geometry.is_empty:
            logger.warning("Generated text geometry is empty")
        else:
            self._store_text_geometry_cache(cache_key, geometry)
        return geometry
