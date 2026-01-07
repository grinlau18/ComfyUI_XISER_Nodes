"""
颜色工具模块
统一处理颜色相关的操作
"""

import re
import logging
from typing import Tuple, Optional

logger = logging.getLogger(__name__)


class ColorUtils:
    """颜色工具类"""

    @staticmethod
    def hex_to_rgb(hex_color: str) -> Tuple[int, int, int]:
        """
        将十六进制颜色转换为RGB元组

        Args:
            hex_color: 十六进制颜色字符串（例如"#FF0000"）

        Returns:
            (r, g, b) 值元组
        """
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
    def hex_to_rgba(hex_color: str, alpha: int = 255) -> Tuple[int, int, int, int]:
        """
        将十六进制颜色转换为RGBA元组

        Args:
            hex_color: 十六进制颜色字符串
            alpha: 透明度值（0-255）

        Returns:
            (r, g, b, a) 值元组
        """
        rgb = ColorUtils.hex_to_rgb(hex_color)
        return rgb + (alpha,)

    @staticmethod
    def validate_color(color: str, default: str = "#FF0000") -> str:
        """
        验证颜色字符串是否有效

        Args:
            color: 颜色字符串
            default: 无效时的默认颜色

        Returns:
            有效的颜色字符串
        """
        if not color or not isinstance(color, str):
            return default

        color = color.strip()
        if color.startswith('#'):
            # 检查十六进制格式
            hex_part = color[1:]
            if re.match(r'^[0-9a-fA-F]{3,6}$', hex_part):
                return color
        elif color.lower() in ['transparent', 'none']:
            return color

        logger.warning(f"Invalid color format: {color}, using default: {default}")
        return default

    @staticmethod
    def normalize_color(color: str) -> str:
        """
        标准化颜色字符串

        Args:
            color: 颜色字符串

        Returns:
            标准化的颜色字符串
        """
        color = ColorUtils.validate_color(color)
        if not color.startswith('#'):
            return color

        # 确保十六进制颜色是6位格式
        hex_part = color[1:]
        if len(hex_part) == 3:
            hex_part = ''.join([c*2 for c in hex_part])
            return f"#{hex_part}"

        return color.lower()

    @staticmethod
    def rgba_string_to_tuple(rgba_string: str) -> Tuple[int, int, int, int]:
        """
        将RGBA字符串转换为元组

        Args:
            rgba_string: RGBA字符串，如"rgba(255, 0, 0, 255)"

        Returns:
            (r, g, b, a) 值元组
        """
        if not rgba_string or not isinstance(rgba_string, str):
            return (255, 0, 0, 255)

        try:
            # 提取数字部分
            match = re.search(r'rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d+))?\)', rgba_string)
            if match:
                r = int(match.group(1))
                g = int(match.group(2))
                b = int(match.group(3))
                a = int(match.group(4)) if match.group(4) else 255
                return (r, g, b, a)
        except (ValueError, AttributeError):
            pass

        logger.warning(f"Invalid RGBA string: {rgba_string}, using default")
        return (255, 0, 0, 255)

    @staticmethod
    def tuple_to_hex(rgb_tuple: Tuple[int, int, int]) -> str:
        """
        将RGB元组转换为十六进制颜色字符串

        Args:
            rgb_tuple: (r, g, b) 值元组

        Returns:
            十六进制颜色字符串
        """
        try:
            r, g, b = rgb_tuple
            return f"#{r:02x}{g:02x}{b:02x}"
        except (ValueError, TypeError):
            logger.warning(f"Invalid RGB tuple: {rgb_tuple}, using default")
            return "#ff0000"

    @staticmethod
    def get_default_color(color_type: str = "shape") -> str:
        """
        获取默认颜色

        Args:
            color_type: 颜色类型（shape, bg, stroke）

        Returns:
            默认颜色字符串
        """
        defaults = {
            "shape": "#0f98b3",    # 形状填充颜色
            "bg": "#000000",       # 背景颜色
            "stroke": "#FFFFFF",   # 描边颜色
            "grid": "#333333",     # 网格颜色
            "text": "#FFFFFF"      # 文字颜色
        }
        return defaults.get(color_type, "#FF0000")