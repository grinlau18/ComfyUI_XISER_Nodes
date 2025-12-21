"""
adjustment_utils.py

统一的图像调节工具模块，提供参数范围定义、验证和转换函数。
确保前后端使用一致的参数范围和算法。
"""

import numpy as np
from PIL import Image


class AdjustmentUtils:
    """图像调节工具类"""

    # 统一的参数范围定义（与前端保持一致）
    BRIGHTNESS_RANGE = (-1.0, 1.0)          # 亮度范围：-1.0 到 1.0
    CONTRAST_RANGE = (-100.0, 100.0)        # 对比度范围：-100 到 100
    SATURATION_RANGE = (-100.0, 100.0)      # 饱和度范围：-100 到 100
    OPACITY_RANGE = (0.0, 100.0)            # 透明度范围：0 到 100

    # 默认值
    DEFAULT_BRIGHTNESS = 0.0
    DEFAULT_CONTRAST = 0.0
    DEFAULT_SATURATION = 0.0
    DEFAULT_OPACITY = 100.0

    @staticmethod
    def clamp(value, min_val, max_val, fallback=None):
        """
        限制值在指定范围内

        Args:
            value: 输入值
            min_val: 最小值
            max_val: 最大值
            fallback: 无效值时的默认值，如果为None则使用min_val和max_val的中间值

        Returns:
            float: 限制后的值
        """
        try:
            num = float(value)
            if np.isnan(num) or np.isinf(num):
                raise ValueError("Invalid number")
            return max(min_val, min(max_val, num))
        except (ValueError, TypeError):
            if fallback is not None:
                return fallback
            # 使用范围中间值作为默认值
            return (min_val + max_val) / 2.0

    @staticmethod
    def normalize_adjustment_state(state):
        """
        规范化调节状态，确保所有调节参数在有效范围内

        Args:
            state (dict): 原始调节状态

        Returns:
            dict: 规范化后的调节状态
        """
        if not isinstance(state, dict):
            state = {}

        return {
            "brightness": AdjustmentUtils.clamp(
                state.get("brightness", AdjustmentUtils.DEFAULT_BRIGHTNESS),
                *AdjustmentUtils.BRIGHTNESS_RANGE,
                AdjustmentUtils.DEFAULT_BRIGHTNESS
            ),
            "contrast": AdjustmentUtils.clamp(
                state.get("contrast", AdjustmentUtils.DEFAULT_CONTRAST),
                *AdjustmentUtils.CONTRAST_RANGE,
                AdjustmentUtils.DEFAULT_CONTRAST
            ),
            "saturation": AdjustmentUtils.clamp(
                state.get("saturation", AdjustmentUtils.DEFAULT_SATURATION),
                *AdjustmentUtils.SATURATION_RANGE,
                AdjustmentUtils.DEFAULT_SATURATION
            ),
            "opacity": AdjustmentUtils.clamp(
                state.get("opacity", AdjustmentUtils.DEFAULT_OPACITY),
                *AdjustmentUtils.OPACITY_RANGE,
                AdjustmentUtils.DEFAULT_OPACITY
            )
        }

    @staticmethod
    def opacity_to_alpha(opacity):
        """
        将透明度百分比转换为alpha值（0-1范围）

        Args:
            opacity (float): 透明度百分比（0-100）

        Returns:
            float: alpha值（0.0-1.0）
        """
        clamped = AdjustmentUtils.clamp(opacity, 0.0, 100.0, 100.0)
        return clamped / 100.0

    @staticmethod
    def alpha_to_opacity(alpha):
        """
        将alpha值转换为透明度百分比

        Args:
            alpha (float): alpha值（0.0-1.0）

        Returns:
            float: 透明度百分比（0-100）
        """
        clamped = AdjustmentUtils.clamp(alpha, 0.0, 1.0, 1.0)
        return clamped * 100.0

    @staticmethod
    def get_default_state():
        """
        获取默认的调节状态

        Returns:
            dict: 默认调节状态
        """
        return {
            "brightness": AdjustmentUtils.DEFAULT_BRIGHTNESS,
            "contrast": AdjustmentUtils.DEFAULT_CONTRAST,
            "saturation": AdjustmentUtils.DEFAULT_SATURATION,
            "opacity": AdjustmentUtils.DEFAULT_OPACITY
        }

    @staticmethod
    def merge_states(base_state, override_state):
        """
        合并两个调节状态，override_state中的值会覆盖base_state

        Args:
            base_state (dict): 基础状态
            override_state (dict): 覆盖状态

        Returns:
            dict: 合并后的状态
        """
        if not isinstance(base_state, dict):
            base_state = {}
        if not isinstance(override_state, dict):
            override_state = {}

        merged = base_state.copy()
        merged.update(override_state)
        return AdjustmentUtils.normalize_adjustment_state(merged)

    @staticmethod
    def is_adjustment_active(state):
        """
        检查是否有激活的调节效果

        Args:
            state (dict): 调节状态

        Returns:
            bool: 是否有激活的调节效果
        """
        if not isinstance(state, dict):
            return False

        normalized = AdjustmentUtils.normalize_adjustment_state(state)

        # 检查是否有非默认值
        return (
            abs(normalized["brightness"] - AdjustmentUtils.DEFAULT_BRIGHTNESS) > 1e-3 or
            abs(normalized["contrast"] - AdjustmentUtils.DEFAULT_CONTRAST) > 1e-3 or
            abs(normalized["saturation"] - AdjustmentUtils.DEFAULT_SATURATION) > 1e-3 or
            abs(normalized["opacity"] - AdjustmentUtils.DEFAULT_OPACITY) > 1e-3
        )


def create_adjustment_slider_config():
    """
    创建ComfyUI滑块控件的配置

    Returns:
        dict: 滑块控件配置
    """
    return {
        "brightness": ("FLOAT", {
            "default": AdjustmentUtils.DEFAULT_BRIGHTNESS,
            "min": AdjustmentUtils.BRIGHTNESS_RANGE[0],
            "max": AdjustmentUtils.BRIGHTNESS_RANGE[1],
            "step": 0.01,
            "display": "slider"
        }),
        "contrast": ("FLOAT", {
            "default": AdjustmentUtils.DEFAULT_CONTRAST,
            "min": AdjustmentUtils.CONTRAST_RANGE[0],
            "max": AdjustmentUtils.CONTRAST_RANGE[1],
            "step": 0.1,
            "display": "slider"
        }),
        "saturation": ("FLOAT", {
            "default": AdjustmentUtils.DEFAULT_SATURATION,
            "min": AdjustmentUtils.SATURATION_RANGE[0],
            "max": AdjustmentUtils.SATURATION_RANGE[1],
            "step": 0.1,
            "display": "slider"
        }),
        "opacity": ("FLOAT", {
            "default": AdjustmentUtils.DEFAULT_OPACITY,
            "min": AdjustmentUtils.OPACITY_RANGE[0],
            "max": AdjustmentUtils.OPACITY_RANGE[1],
            "step": 0.1,
            "display": "slider"
        })
    }