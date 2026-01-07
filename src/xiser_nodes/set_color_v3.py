"""
XIS_SetColor.py - V3版本

Custom node for ComfyUI to select and output a color as HEX string.
"""

from typing import Dict, Any

from comfy_api.v0_0_2 import io

class XIS_SetColorV3(io.ComfyNode):
    """
    A custom node for selecting and outputting a color as HEX string.
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        """
        Defines the input types for the node.

        Returns:
            io.Schema: V3架构定义
        """
        return io.Schema(
            node_id="XIS_SetColor",
            display_name="Set Color",
            category="XISER_Nodes/UI_And_Control",
            description="选择并输出HEX颜色字符串。",
            inputs=[
                io.Custom("WIDGET").Input("color_data", tooltip="包含选定颜色的颜色数据")
            ],
            outputs=[
                io.String.Output(display_name="hex_color")
            ]
        )

    @classmethod
    def execute(cls, color_data: Dict[str, Any]) -> io.NodeOutput:
        """
        Execute the color selection.

        Args:
            color_data (Dict[str, Any]): Color data containing selected color.

        Returns:
            io.NodeOutput: HEX颜色字符串输出
        """
        # Extract color from widget data, default to white if not provided
        hex_color = color_data.get("color", "#ffffff")

        # Validate hex color format
        if not cls.is_valid_hex(hex_color):
            hex_color = "#ffffff"

        return io.NodeOutput(hex_color)

    @classmethod
    def is_valid_hex(cls, hex_color: str) -> bool:
        """
        Validate if a string is a valid HEX color.

        Args:
            hex_color (str): HEX color string.

        Returns:
            bool: True if valid, False otherwise.
        """
        if not hex_color.startswith('#'):
            return False

        hex_digits = hex_color[1:]

        # Check if it's 3 or 6 hex digits
        if len(hex_digits) not in [3, 6]:
            return False

        # Check if all characters are valid hex digits
        if not all(c in "0123456789abcdefABCDEF" for c in hex_digits):
            return False

        return True


# V3节点导出
V3_NODE_CLASSES = [XIS_SetColorV3]