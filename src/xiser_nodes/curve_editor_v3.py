"""
XIS_CurveEditor V3版本

Custom node for ComfyUI to generate distribution values with visual curve editing.
Supports INT, FLOAT, and HEX data types with various interpolation methods.
V3架构迁移版本
"""

import re
import math
from typing import List, Dict, Any, Union
from comfy_api.v0_0_2 import io, ui


class XIS_CurveEditorV3(io.ComfyNode):
    """
    A custom node for generating distribution values with visual curve editing.
    Supports INT, FLOAT, and HEX data types.
    V3架构版本
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        """
        Defines the input types for the node.

        Returns:
            io.Schema: V3 schema configuration.
        """
        return io.Schema(
            node_id="XIS_CurveEditor",
            display_name="Curve Editor",
            category="XISER_Nodes/Visual_Editing",
            description="Generate distribution values with visual curve editing. Supports INT, FLOAT, and HEX data types with various interpolation methods.",
            inputs=[
                io.Combo.Input("data_type",
                             options=["INT", "FLOAT", "HEX"],
                             default="FLOAT",
                             tooltip="Data type for output values"),
                io.String.Input("start_value",
                              default="0",
                              multiline=False,
                              tooltip="Start value for distribution"),
                io.String.Input("end_value",
                              default="1",
                              multiline=False,
                              tooltip="End value for distribution"),
                io.Int.Input("point_count",
                           default=10,
                           min=2,
                           max=1000,
                           step=1,
                           tooltip="Number of points in distribution"),
                io.Combo.Input("color_interpolation",
                             options=["HSV", "RGB", "LAB"],
                             default="HSV",
                             tooltip="Color interpolation method for HEX data type"),
                io.Custom("WIDGET").Input("curve_editor",
                                        tooltip="Visual curve editor widget")
            ],
            outputs=[
                io.Int.Output(display_name="int", is_output_list=True),
                io.Float.Output(display_name="float", is_output_list=True),
                io.String.Output(display_name="hex", is_output_list=True),
                io.Custom("LIST").Output(display_name="list", is_output_list=False)
            ]
        )

    @staticmethod
    def validate_hex_color(hex_color: str) -> bool:
        """
        Validate HEX color format.

        Args:
            hex_color (str): HEX color string.

        Returns:
            bool: True if valid, False otherwise.
        """
        pattern = r'^#?[0-9a-fA-F]{6}$'
        return bool(re.match(pattern, hex_color))

    @staticmethod
    def hex_to_rgb(hex_color: str) -> List[int]:
        """
        Convert HEX color to RGB.

        Args:
            hex_color (str): HEX color string.

        Returns:
            List[int]: RGB values [r, g, b].
        """
        hex_color = hex_color.lstrip("#")
        if len(hex_color) == 6:
            try:
                r = int(hex_color[0:2], 16)
                g = int(hex_color[2:4], 16)
                b = int(hex_color[4:6], 16)
                return [r, g, b]
            except Exception:
                pass
        return [255, 255, 255]  # Default to white on error

    @staticmethod
    def rgb_to_hex(rgb: List[int]) -> str:
        """
        Convert RGB to HEX color.

        Args:
            rgb (List[int]): RGB values [r, g, b].

        Returns:
            str: HEX color string.
        """
        return "#{:02x}{:02x}{:02x}".format(
            max(0, min(255, rgb[0])),
            max(0, min(255, rgb[1])),
            max(0, min(255, rgb[2]))
        )

    @staticmethod
    def rgb_to_hsv(rgb: List[int]) -> List[float]:
        """
        Convert RGB to HSV color space.

        Args:
            rgb (List[int]): RGB values [r, g, b].

        Returns:
            List[float]: HSV values [h, s, v].
        """
        r, g, b = rgb[0] / 255.0, rgb[1] / 255.0, rgb[2] / 255.0
        max_val = max(r, g, b)
        min_val = min(r, g, b)
        delta = max_val - min_val

        # Hue calculation
        if delta == 0:
            h = 0
        elif max_val == r:
            h = 60 * (((g - b) / delta) % 6)
        elif max_val == g:
            h = 60 * (((b - r) / delta) + 2)
        else:  # max_val == b
            h = 60 * (((r - g) / delta) + 4)

        # Saturation calculation
        s = 0 if max_val == 0 else delta / max_val

        # Value
        v = max_val

        return [h, s, v]

    @staticmethod
    def hsv_to_rgb(hsv: List[float]) -> List[int]:
        """
        Convert HSV to RGB color space.

        Args:
            hsv (List[float]): HSV values [h, s, v].

        Returns:
            List[int]: RGB values [r, g, b].
        """
        h, s, v = hsv[0], hsv[1], hsv[2]

        if s == 0:
            rgb_val = int(v * 255)
            return [rgb_val, rgb_val, rgb_val]

        h = h % 360
        h_60 = h / 60.0
        i = int(h_60)
        f = h_60 - i
        p = v * (1 - s)
        q = v * (1 - s * f)
        t = v * (1 - s * (1 - f))

        if i == 0:
            r, g, b = v, t, p
        elif i == 1:
            r, g, b = q, v, p
        elif i == 2:
            r, g, b = p, v, t
        elif i == 3:
            r, g, b = p, q, v
        elif i == 4:
            r, g, b = t, p, v
        else:  # i == 5
            r, g, b = v, p, q

        return [
            int(max(0, min(255, r * 255))),
            int(max(0, min(255, g * 255))),
            int(max(0, min(255, b * 255)))
        ]

    @staticmethod
    def interpolate_hsv(hsv1: List[float], hsv2: List[float], t: float) -> List[float]:
        """
        Advanced HSV color interpolation for natural and perceptually smooth transitions.

        Args:
            hsv1 (List[float]): Start HSV color.
            hsv2 (List[float]): End HSV color.
            t (float): Interpolation factor (0-1).

        Returns:
            List[float]: Interpolated HSV color.
        """
        h1, s1, v1 = hsv1[0], hsv1[1], hsv1[2]
        h2, s2, v2 = hsv2[0], hsv2[1], hsv2[2]

        # 1. 优化色调插值：选择最短路径并考虑色调感知
        dh = h2 - h1
        if abs(dh) > 180:
            # 选择更短的路径
            if dh > 0:
                h1 += 360
            else:
                h2 += 360

        # 2. 使用感知优化的缓动函数
        # 基于感知的缓动函数，在中间阶段更平滑
        def perceptual_ease(x):
            # 使用正弦函数创建更自然的缓动效果
            return 0.5 - 0.5 * math.cos(x * math.pi)

        # 3. 色调插值：使用感知优化的缓动
        eased_t = perceptual_ease(t)
        h = h1 + (h2 - h1) * eased_t

        # 4. 饱和度插值：智能处理不同饱和度情况
        if s1 < 0.1 or s2 < 0.1:
            # 至少一个颜色接近灰度，使用线性插值
            s = s1 + (s2 - s1) * t
        elif abs(s1 - s2) > 0.5:
            # 饱和度差异很大时，使用缓动避免突变
            s = s1 + (s2 - s1) * eased_t
        else:
            # 正常情况使用二次缓动
            s = s1 + (s2 - s1) * (t * t)

        # 5. 亮度插值：保持视觉一致性
        # 使用平方根插值，使亮度变化更符合人眼感知
        v = math.sqrt(v1 * v1 + (v2 * v2 - v1 * v1) * t)

        # 6. 特殊处理：避免中间颜色过于暗淡
        # 如果两个颜色都很亮，确保中间颜色也保持适当亮度
        if v1 > 0.7 and v2 > 0.7 and v < 0.6:
            v = 0.6 + (v - 0.6) * 0.5

        # 确保值在有效范围内
        h = h % 360
        s = max(0.0, min(1.0, s))
        v = max(0.0, min(1.0, v))

        return [h, s, v]

    @staticmethod
    def interpolate_rgb(rgb1: List[int], rgb2: List[int], t: float) -> List[int]:
        """
        Interpolate between two RGB colors.

        Args:
            rgb1 (List[int]): Start RGB color.
            rgb2 (List[int]): End RGB color.
            t (float): Interpolation factor (0-1).

        Returns:
            List[int]: Interpolated RGB color.
        """
        return [
            int(rgb1[0] + (rgb2[0] - rgb1[0]) * t),
            int(rgb1[1] + (rgb2[1] - rgb1[1]) * t),
            int(rgb1[2] + (rgb2[2] - rgb1[2]) * t)
        ]

    @staticmethod
    def rgb_to_lab(rgb: List[int]) -> List[float]:
        """
        Convert RGB to LAB color space.

        Args:
            rgb (List[int]): RGB values [r, g, b].

        Returns:
            List[float]: LAB values [l, a, b].
        """
        # 首先将RGB转换为XYZ
        r, g, b = rgb[0] / 255.0, rgb[1] / 255.0, rgb[2] / 255.0

        # 应用gamma校正
        r = r if r <= 0.04045 else ((r + 0.055) / 1.055) ** 2.4
        g = g if g <= 0.04045 else ((g + 0.055) / 1.055) ** 2.4
        b = b if b <= 0.04045 else ((b + 0.055) / 1.055) ** 2.4

        # 转换为XYZ
        x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375
        y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750
        z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041

        # D65标准光源
        x /= 0.95047
        z /= 1.08883

        # 转换为LAB
        x = x if x > 0.008856 else (x * 903.3)
        y = y if y > 0.008856 else (y * 903.3)
        z = z if z > 0.008856 else (z * 903.3)

        if x > 0.008856:
            x = x ** (1/3)
        else:
            x = (7.787 * x) + (16 / 116)

        if y > 0.008856:
            y = y ** (1/3)
        else:
            y = (7.787 * y) + (16 / 116)

        if z > 0.008856:
            z = z ** (1/3)
        else:
            z = (7.787 * z) + (16 / 116)

        l = max(0, min(100, (116 * y) - 16))
        a = max(-128, min(127, 500 * (x - y)))
        b_val = max(-128, min(127, 200 * (y - z)))

        return [l, a, b_val]

    @staticmethod
    def lab_to_rgb(lab: List[float]) -> List[int]:
        """
        Convert LAB to RGB color space.

        Args:
            lab (List[float]): LAB values [l, a, b].

        Returns:
            List[int]: RGB values [r, g, b].
        """
        l, a, b_val = lab[0], lab[1], lab[2]

        # 转换为XYZ
        y = (l + 16) / 116
        x = a / 500 + y
        z = y - b_val / 200

        # 立方根反变换
        x = x ** 3 if x ** 3 > 0.008856 else (x - 16/116) / 7.787
        y = y ** 3 if y ** 3 > 0.008856 else (y - 16/116) / 7.787
        z = z ** 3 if z ** 3 > 0.008856 else (z - 16/116) / 7.787

        # D65标准光源
        x *= 0.95047
        z *= 1.08883

        # 转换为RGB
        r = x * 3.2404542 + y * -1.5371385 + z * -0.4985314
        g = x * -0.9692660 + y * 1.8760108 + z * 0.0415560
        b = x * 0.0556434 + y * -0.2040259 + z * 1.0572252

        # 应用gamma校正
        r = r if r <= 0.0031308 else (1.055 * (r ** (1/2.4)) - 0.055)
        g = g if g <= 0.0031308 else (1.055 * (g ** (1/2.4)) - 0.055)
        b = b if b <= 0.0031308 else (1.055 * (b ** (1/2.4)) - 0.055)

        # 钳制到0-255范围
        r = max(0, min(1, r))
        g = max(0, min(1, g))
        b = max(0, min(1, b))

        return [int(r * 255), int(g * 255), int(b * 255)]

    @staticmethod
    def interpolate_lab(lab1: List[float], lab2: List[float], t: float) -> List[float]:
        """
        Interpolate between two LAB colors.

        Args:
            lab1 (List[float]): Start LAB color.
            lab2 (List[float]): End LAB color.
            t (float): Interpolation factor (0-1).

        Returns:
            List[float]: Interpolated LAB color.
        """
        return [
            lab1[0] + (lab2[0] - lab1[0]) * t,
            lab1[1] + (lab2[1] - lab1[1]) * t,
            lab1[2] + (lab2[2] - lab1[2]) * t
        ]

    @staticmethod
    def parse_numeric_value(value: str, data_type: str) -> Union[int, float]:
        """
        Parse numeric value based on data type.

        Args:
            value (str): Input value string.
            data_type (str): Data type ("INT" or "FLOAT").

        Returns:
            Union[int, float]: Parsed numeric value.
        """
        if data_type == "INT":
            return int(float(value))
        else:  # FLOAT
            return float(value)

    @staticmethod
    def safe_float(value: Any, default: float = 0.0) -> float:
        """
        Safely convert a value to float with fallback.
        """
        try:
            return float(value)
        except Exception:
            return default

    @staticmethod
    def clamp01(value: float) -> float:
        """
        Clamp value between 0 and 1.
        """
        return max(0.0, min(1.0, value))

    @staticmethod
    def sanitize_curve_points(curve_points: List[Dict[str, Any]]) -> List[Dict[str, float]]:
        """
        Ensure curve points are valid and sorted.
        """
        sanitized = []
        for point in curve_points or []:
            if not isinstance(point, dict):
                continue
            x = XIS_CurveEditorV3.safe_float(point.get("x", 0.0), 0.0)
            y = XIS_CurveEditorV3.safe_float(point.get("y", 0.0), 0.0)
            sanitized.append({
                "x": XIS_CurveEditorV3.clamp01(x),
                "y": XIS_CurveEditorV3.clamp01(y)
            })

        if len(sanitized) < 2:
            return []

        sanitized.sort(key=lambda p: p["x"])
        return sanitized

    @staticmethod
    def apply_linear_interpolation(t: float, points: List[Dict[str, float]]) -> float:
        """
        Linear interpolation between control points.
        """
        if not points:
            return XIS_CurveEditorV3.clamp01(t)

        if t <= points[0]["x"]:
            return points[0]["y"]
        if t >= points[-1]["x"]:
            return points[-1]["y"]

        for i in range(len(points) - 1):
            p1 = points[i]
            p2 = points[i + 1]
            if p2["x"] == p1["x"]:
                continue
            if p1["x"] <= t <= p2["x"]:
                segment_t = (t - p1["x"]) / (p2["x"] - p1["x"])
                return p1["y"] + (p2["y"] - p1["y"]) * segment_t

        return points[-1]["y"]

    @staticmethod
    def catmull_rom_interpolate(p0: float, p1: float, p2: float, p3: float, t: float) -> float:
        """
        Catmull-Rom spline interpolation.
        """
        t2 = t * t
        t3 = t2 * t
        return 0.5 * (
            (2 * p1) +
            (-p0 + p2) * t +
            (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
            (-p0 + 3 * p1 - 3 * p2 + p3) * t3
        )

    @staticmethod
    def apply_catmull_rom_curve(t: float, points: List[Dict[str, float]]) -> float:
        """
        Apply Catmull-Rom spline interpolation using sorted control points.
        """
        if not points:
            return XIS_CurveEditorV3.clamp01(t)

        if t <= points[0]["x"]:
            return points[0]["y"]
        if t >= points[-1]["x"]:
            return points[-1]["y"]

        for i in range(len(points) - 1):
            p1 = points[i]
            p2 = points[i + 1]
            if p1["x"] <= t <= p2["x"]:
                if p2["x"] == p1["x"]:
                    return p1["y"]
                p0 = points[i - 1] if i > 0 else p1
                p3 = points[i + 2] if i < len(points) - 2 else points[-1]
                segment_t = (t - p1["x"]) / (p2["x"] - p1["x"])
                return XIS_CurveEditorV3.catmull_rom_interpolate(p0["y"], p1["y"], p2["y"], p3["y"], segment_t)

        return points[-1]["y"]

    @staticmethod
    def apply_custom_curve(t: float, points: List[Dict[str, float]], interpolation_algorithm: str) -> float:
        """
        Apply the selected interpolation algorithm to transform t.
        """
        if not points:
            return XIS_CurveEditorV3.clamp01(t)

        if interpolation_algorithm == "linear":
            return XIS_CurveEditorV3.apply_linear_interpolation(t, points)
        else:
            return XIS_CurveEditorV3.apply_catmull_rom_curve(t, points)

    @staticmethod
    def compute_curve_t_values(
        point_count: int,
        curve_points: List[Dict[str, float]],
        interpolation_algorithm: str
    ) -> List[Dict[str, float]]:
        """
        Compute base and transformed t values for each distribution point.
        """
        sanitized_points = XIS_CurveEditorV3.sanitize_curve_points(curve_points)
        t_values = []

        for i in range(point_count):
            base_t = i / max(1, point_count - 1) if point_count > 1 else 0
            if sanitized_points:
                transformed_t = XIS_CurveEditorV3.apply_custom_curve(base_t, sanitized_points, interpolation_algorithm)
            else:
                transformed_t = base_t

            t_values.append({
                "index": i,
                "t": base_t,
                "transformed_t": XIS_CurveEditorV3.clamp01(transformed_t)
            })

        return t_values

    @classmethod
    def execute(
        cls,
        data_type: str,
        start_value: str,
        end_value: str,
        point_count: int,
        color_interpolation: str,
        curve_editor: Dict[str, Any]
    ) -> io.NodeOutput:
        """
        Execute the distribution calculation.

        Args:
            data_type (str): Data type ("INT", "FLOAT", "HEX").
            start_value (str): Start value.
            end_value (str): End value.
            point_count (int): Number of points in distribution.
            curve_editor (Dict[str, Any]): Curve editor data.

        Returns:
            io.NodeOutput: Four outputs (int_list, float_list, hex_list, list_output).
        """
        # Get custom curve points if available
        curve_points = curve_editor.get("curve_points", [])
        interpolation_algorithm = curve_editor.get("interpolation_algorithm", "catmull_rom")
        curve_t_values = cls.compute_curve_t_values(point_count, curve_points, interpolation_algorithm)

        # Initialize result lists
        int_list = []
        float_list = []
        hex_list = []

        # Process based on data type
        if data_type in ["INT", "FLOAT"]:
            start_float = cls.safe_float(start_value, 0.0)
            end_float = cls.safe_float(end_value, 1.0)
            for t_info in curve_t_values:
                transformed_t = t_info["transformed_t"]
                value = start_float + (end_float - start_float) * transformed_t
                if data_type == "INT":
                    int_list.append(int(round(value)))
                else:
                    int_list.append(int(value))
                float_list.append(float(value))
                hex_list.append("#000000")

        elif data_type == "HEX":
            # Normalize HEX colors
            start_hex = start_value if start_value.startswith("#") else "#" + start_value
            end_hex = end_value if end_value.startswith("#") else "#" + end_value

            # Convert to RGB for interpolation
            start_rgb = cls.hex_to_rgb(start_hex)
            end_rgb = cls.hex_to_rgb(end_hex)

            for i in range(point_count):
                transformed_t = curve_t_values[i]["transformed_t"] if i < len(curve_t_values) else i / max(1, point_count - 1) if point_count > 1 else 0

                # 根据选择的颜色过渡方法进行插值
                if color_interpolation == "RGB":
                    # RGB线性插值
                    interp_rgb = cls.interpolate_rgb(start_rgb, end_rgb, transformed_t)
                    interp_hex = cls.rgb_to_hex(interp_rgb)
                elif color_interpolation == "LAB":
                    # LAB颜色空间插值（感知均匀）
                    start_lab = cls.rgb_to_lab(start_rgb)
                    end_lab = cls.rgb_to_lab(end_rgb)
                    interp_lab = cls.interpolate_lab(start_lab, end_lab, transformed_t)
                    interp_rgb = cls.lab_to_rgb(interp_lab)
                    interp_hex = cls.rgb_to_hex(interp_rgb)
                else:  # HSV (默认)
                    # HSV颜色空间插值（自然的颜色过渡）
                    start_hsv = cls.rgb_to_hsv(start_rgb)
                    end_hsv = cls.rgb_to_hsv(end_rgb)
                    interp_hsv = cls.interpolate_hsv(start_hsv, end_hsv, transformed_t)
                    interp_rgb = cls.hsv_to_rgb(interp_hsv)
                    interp_hex = cls.rgb_to_hex(interp_rgb)

                # Add to all lists
                int_list.append(0)
                float_list.append(0.0)
                hex_list.append(interp_hex)

        # 根据数据类型创建LIST输出
        if data_type == "INT":
            list_output = int_list
        elif data_type == "FLOAT":
            list_output = float_list
        elif data_type == "HEX":
            list_output = hex_list
        else:
            list_output = []

        return io.NodeOutput(int_list, float_list, hex_list, list_output)


# V3节点导出
V3_NODE_CLASSES = [XIS_CurveEditorV3]