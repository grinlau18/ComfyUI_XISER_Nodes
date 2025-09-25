"""
XIS_SetColor.py

Custom node for ComfyUI to select and output a color as HEX string.
"""

from typing import Dict, Any

class XIS_SetColor:
    """
    A custom node for selecting and outputting a color as HEX string.
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
                "color_data": ("WIDGET", {}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("hex_color",)
    FUNCTION = "execute"
    CATEGORY = "XISER_Nodes/UI"

    def execute(self, color_data: Dict[str, Any]) -> tuple:
        """
        Execute the color selection.

        Args:
            color_data (Dict[str, Any]): Color data containing selected color.

        Returns:
            tuple: (str) HEX color string.
        """
        # Extract color from widget data, default to white if not provided
        hex_color = color_data.get("color", "#ffffff")

        # Validate hex color format
        if not self.is_valid_hex(hex_color):
            hex_color = "#ffffff"

        return (hex_color,)

    def is_valid_hex(self, hex_color: str) -> bool:
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

NODE_CLASS_MAPPINGS = {
    "XIS_SetColor": XIS_SetColor
}