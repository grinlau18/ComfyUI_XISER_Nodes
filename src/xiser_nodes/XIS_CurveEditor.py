"""
XIS_CurveEditor.py

Custom node for ComfyUI to generate distribution values with visual curve editing.
Supports INT, FLOAT, and HEX data types with various interpolation methods.
"""

import re
import math
from typing import List, Dict, Any, Union

class XIS_CurveEditor:
    """
    A custom node for generating distribution values with visual curve editing.
    Supports INT, FLOAT, and HEX data types.
    """

    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Any]:
        """
        Defines the input types for the node.

        Returns:
            Dict[str, Any]: Input types configuration.
        """
        return {
            "required": {
                "data_type": (["INT", "FLOAT", "HEX"], {"default": "FLOAT"}),
                "start_value": ("STRING", {"default": "0", "multiline": False}),
                "end_value": ("STRING", {"default": "1", "multiline": False}),
                "point_count": ("INT", {"default": 10, "min": 2, "max": 1000, "step": 1}),
                "color_interpolation": (["HSV", "RGB", "LAB"], {"default": "HSV"}),
                "curve_editor": ("WIDGET", {}),
            }
        }

    RETURN_TYPES = ("INT", "FLOAT", "STRING", "LIST")
    RETURN_NAMES = ("int", "float", "hex", "list")
    OUTPUT_IS_LIST = (True, True, True, False)
    FUNCTION = "execute"
    CATEGORY = "XISER_Nodes/Visual_Editing"

    def validate_hex_color(self, hex_color: str) -> bool:
        """
        Validate HEX color format.

        Args:
            hex_color (str): HEX color string.

        Returns:
            bool: True if valid, False otherwise.
        """
        pattern = r'^#?[0-9a-fA-F]{6}$'
        return bool(re.match(pattern, hex_color))


    def hex_to_rgb(self, hex_color: str) -> List[int]:
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

    def rgb_to_hex(self, rgb: List[int]) -> str:
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

    def rgb_to_hsv(self, rgb: List[int]) -> List[float]:
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

    def hsv_to_rgb(self, hsv: List[float]) -> List[int]:
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

    def interpolate_hsv(self, hsv1: List[float], hsv2: List[float], t: float) -> List[float]:
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

    def interpolate_rgb(self, rgb1: List[int], rgb2: List[int], t: float) -> List[int]:
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

    def rgb_to_lab(self, rgb: List[int]) -> List[float]:
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

    def lab_to_rgb(self, lab: List[float]) -> List[int]:
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

    def interpolate_lab(self, lab1: List[float], lab2: List[float], t: float) -> List[float]:
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


    def parse_numeric_value(self, value: str, data_type: str) -> Union[int, float]:
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

    def execute(
        self,
        data_type: str,
        start_value: str,
        end_value: str,
        point_count: int,
        color_interpolation: str,
        curve_editor: Dict[str, Any]
    ) -> tuple:
        """
        Execute the distribution calculation.

        Args:
            data_type (str): Data type ("INT", "FLOAT", "HEX").
            start_value (str): Start value.
            end_value (str): End value.
            point_count (int): Number of points in distribution.
            curve_editor (Dict[str, Any]): Curve editor data.

        Returns:
            tuple: Four lists (int_list, float_list, hex_list, list_output).
        """
        # Get custom curve points if available
        curve_points = curve_editor.get("curve_points", [])
        use_custom_curve = len(curve_points) > 0

        # Initialize result lists
        int_list = []
        float_list = []
        hex_list = []

        # Process based on data type
        if data_type in ["INT", "FLOAT"]:
            # 直接使用前端计算好的数值列表
            if use_custom_curve and "distribution_values" in curve_editor:
                # 前端已经计算好所有分布点的实际数值
                distribution_values = curve_editor["distribution_values"]
                for i in range(min(point_count, len(distribution_values))):
                    value = distribution_values[i]
                    int_list.append(int(value))
                    float_list.append(float(value))
                    hex_list.append("#000000")
            else:
                # 线性插值作为回退
                start_num = self.parse_numeric_value(start_value, data_type)
                end_num = self.parse_numeric_value(end_value, data_type)
                for i in range(point_count):
                    transformed_t = (i + 1) / point_count
                    value = start_num + (end_num - start_num) * transformed_t
                    int_list.append(int(value))
                    float_list.append(float(value))
                    hex_list.append("#000000")

        elif data_type == "HEX":
            # Normalize HEX colors
            start_hex = start_value if start_value.startswith("#") else "#" + start_value
            end_hex = end_value if end_value.startswith("#") else "#" + end_value

            # Convert to RGB for interpolation
            start_rgb = self.hex_to_rgb(start_hex)
            end_rgb = self.hex_to_rgb(end_hex)

            # 直接使用前端计算好的百分比序列值进行颜色渐变
            for i in range(point_count):
                # 前端已经计算好所有分布点的变换后t值
                if use_custom_curve and "distribution_t_values" in curve_editor:
                    # 使用前端计算好的变换后t值
                    if i < len(curve_editor["distribution_t_values"]):
                        transformed_t = curve_editor["distribution_t_values"][i]["transformed_t"]
                    else:
                        # 如果前端数据不完整，使用线性插值作为回退
                        transformed_t = (i + 1) / point_count
                else:
                    # 线性插值
                    transformed_t = (i + 1) / point_count

                # 根据选择的颜色过渡方法进行插值
                if color_interpolation == "RGB":
                    # RGB线性插值
                    interp_rgb = self.interpolate_rgb(start_rgb, end_rgb, transformed_t)
                    interp_hex = self.rgb_to_hex(interp_rgb)
                elif color_interpolation == "LAB":
                    # LAB颜色空间插值（感知均匀）
                    start_lab = self.rgb_to_lab(start_rgb)
                    end_lab = self.rgb_to_lab(end_rgb)
                    interp_lab = self.interpolate_lab(start_lab, end_lab, transformed_t)
                    interp_rgb = self.lab_to_rgb(interp_lab)
                    interp_hex = self.rgb_to_hex(interp_rgb)
                else:  # HSV (默认)
                    # HSV颜色空间插值（自然的颜色过渡）
                    start_hsv = self.rgb_to_hsv(start_rgb)
                    end_hsv = self.rgb_to_hsv(end_rgb)
                    interp_hsv = self.interpolate_hsv(start_hsv, end_hsv, transformed_t)
                    interp_rgb = self.hsv_to_rgb(interp_hsv)
                    interp_hex = self.rgb_to_hex(interp_rgb)

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

        return (int_list, float_list, hex_list, list_output)


NODE_CLASS_MAPPINGS = {
    "XIS_CurveEditor": XIS_CurveEditor
}