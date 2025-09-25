"""
XIS_CurveEditor.py

Custom node for ComfyUI to generate distribution values with visual curve editing.
Supports INT, FLOAT, and HEX data types with various interpolation methods.
"""

import re
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
                "point_count": ("INT", {"default": 10, "min": 2, "max": 100, "step": 1}),
                "curve_editor": ("WIDGET", {}),
            }
        }

    RETURN_TYPES = ("INT", "FLOAT", "STRING", "LIST")
    RETURN_NAMES = ("int", "float", "hex", "list")
    OUTPUT_IS_LIST = (True, True, True, False)
    FUNCTION = "execute"
    CATEGORY = "XISER_Nodes/ListProcessing"

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
        Interpolate between two HSV colors.

        Args:
            hsv1 (List[float]): Start HSV color.
            hsv2 (List[float]): End HSV color.
            t (float): Interpolation factor (0-1).

        Returns:
            List[float]: Interpolated HSV color.
        """
        # Handle hue interpolation (circular)
        h1, h2 = hsv1[0], hsv2[0]
        if abs(h2 - h1) > 180:
            if h1 < h2:
                h1 += 360
            else:
                h2 += 360

        h = h1 + (h2 - h1) * t
        s = hsv1[1] + (hsv2[1] - hsv1[1]) * t
        v = hsv1[2] + (hsv2[2] - hsv1[2]) * t

        return [h % 360, max(0, min(1, s)), max(0, min(1, v))]


    def parse_numeric_value(self, value: str, data_type: str) -> Union[int, float]:
        """
        Parse numeric value based on data type.

        Args:
            value (str): Input value string.
            data_type (str): Data type ("INT" or "FLOAT").

        Returns:
            Union[int, float]: Parsed numeric value.
        """
        try:
            if data_type == "INT":
                return int(float(value))
            else:  # FLOAT
                return float(value)
        except (ValueError, TypeError):
            return 0 if data_type == "INT" else 0.0

    def execute(
        self,
        data_type: str,
        start_value: str,
        end_value: str,
        point_count: int,
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
        rgb_list = []

        # Process based on data type
        if data_type in ["INT", "FLOAT"]:
            start_num = self.parse_numeric_value(start_value, data_type)
            end_num = self.parse_numeric_value(end_value, data_type)

            for i in range(point_count):
                t = i / (point_count - 1) if point_count > 1 else 0

                # Apply custom curve if available, otherwise use linear interpolation
                if use_custom_curve:
                    t = self.apply_custom_curve(t, curve_points)
                # else: use linear interpolation (t remains unchanged)

                value = start_num + (end_num - start_num) * t

                # Add to both int and float lists
                int_list.append(int(value))
                float_list.append(float(value))

                # For numeric types, generate default colors
                hex_list.append("#000000")

        elif data_type == "HEX":
            # Validate HEX colors
            if not self.validate_hex_color(start_value):
                start_value = "#000000"
            if not self.validate_hex_color(end_value):
                end_value = "#FFFFFF"

            # Normalize HEX colors
            start_hex = start_value if start_value.startswith("#") else "#" + start_value
            end_hex = end_value if end_value.startswith("#") else "#" + end_value

            # Convert to RGB for interpolation
            start_rgb = self.hex_to_rgb(start_hex)
            end_rgb = self.hex_to_rgb(end_hex)

            # Convert to HSV for natural color interpolation
            start_hsv = self.rgb_to_hsv(start_rgb)
            end_hsv = self.rgb_to_hsv(end_rgb)

            for i in range(point_count):
                t = i / (point_count - 1) if point_count > 1 else 0

                # Apply custom curve if available, otherwise use linear interpolation
                if use_custom_curve:
                    t = self.apply_custom_curve(t, curve_points)
                # else: use linear interpolation (t remains unchanged)

                # Interpolate in HSV space
                interp_hsv = self.interpolate_hsv(start_hsv, end_hsv, t)
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

    def apply_custom_curve(self, t: float, curve_points: List[Dict[str, float]]) -> float:
        """
        Apply custom curve defined by control points.

        Args:
            t (float): Input factor (0-1).
            curve_points (List[Dict[str, float]]): Curve control points.

        Returns:
            float: Modified factor based on custom curve.
        """
        if not curve_points or len(curve_points) < 2:
            return t

        # Sort points by x (input)
        sorted_points = sorted(curve_points, key=lambda p: p["x"])

        # Find the segment containing t
        for i in range(len(sorted_points) - 1):
            p1 = sorted_points[i]
            p2 = sorted_points[i + 1]

            if p1["x"] <= t <= p2["x"]:
                # Linear interpolation between points
                if p2["x"] == p1["x"]:
                    return p1["y"]

                segment_t = (t - p1["x"]) / (p2["x"] - p1["x"])
                return p1["y"] + (p2["y"] - p1["y"]) * segment_t

        # If t is outside the defined range, clamp to nearest point
        if t <= sorted_points[0]["x"]:
            return sorted_points[0]["y"]
        else:
            return sorted_points[-1]["y"]

NODE_CLASS_MAPPINGS = {
    "XIS_CurveEditor": XIS_CurveEditor
}