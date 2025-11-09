# src/xiser_nodes/logic.py
from typing import Optional, Tuple, Union
from .utils import logger

# 判断是否有信号接入，否则输出默认值
class XIS_IsThereAnyData:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "default_int": ("INT", {"default": 0, "min": -2147483648, "max": 2147483647, "step": 1}),
                "default_float": ("FLOAT", {"default": 0.0, "min": -1e10, "max": 1e10, "step": 0.01}),
                "default_boolean": ("BOOLEAN", {"default": False}),
            },
            "optional": {
                "int_input": ("INT",),
                "float_input": ("FLOAT",),
                "boolean_input": ("BOOLEAN",),
            }
        }

    RETURN_TYPES = ("INT", "FLOAT", "BOOLEAN")
    RETURN_NAMES = ("int_output", "float_output", "boolean_output")
    FUNCTION = "select_value"
    CATEGORY = "XISER_Nodes/Logic"

    def select_value(self, default_int, default_float, default_boolean, 
                     int_input=None, float_input=None, boolean_input=None):
        int_output = int_input if int_input is not None else default_int
        float_output = float_input if float_input is not None else default_float
        boolean_output = boolean_input if boolean_input is not None else default_boolean
        return (int_output, float_output, boolean_output)

# 判断数据是否为空
class XIS_IfDataIsNone:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "data_type": (["INT", "FLOAT", "BOOLEAN", "STRING"], {"default": "STRING"}),  # 移除 NUMBER，避免类型歧义
                "default_value": ("STRING", {"default": "0"}),
            },
            "optional": {
                "signal": ("*", {"default": None}),
            }
        }

    RETURN_TYPES = ("BOOLEAN", "INT", "FLOAT", "BOOLEAN", "STRING")
    RETURN_NAMES = ("is_not_null", "int_output", "float_output", "boolean_output", "string_output")
    FUNCTION = "check_signal"
    CATEGORY = "XISER_Nodes/Logic"

    def check_signal(self, data_type, default_value, signal=None):
        is_not_null = signal is not None
        value_to_convert = signal if is_not_null else default_value

        # 如果是列表，逐项转换；否则按单一值处理
        if isinstance(value_to_convert, (list, tuple)):
            result = [self.convert_single_item(item, data_type) for item in value_to_convert]
        else:
            result = self.convert_single_item(value_to_convert, data_type)

        # 根据 data_type 返回对应类型的输出，其他端口返回默认值
        int_output = result if data_type == "INT" else (0 if not isinstance(result, list) else [0] * len(result))
        float_output = result if data_type == "FLOAT" else (0.0 if not isinstance(result, list) else [0.0] * len(result))
        boolean_output = result if data_type == "BOOLEAN" else (False if not isinstance(result, list) else [False] * len(result))
        string_output = result if data_type == "STRING" else ("" if not isinstance(result, list) else [""] * len(result))

        return (is_not_null, int_output, float_output, boolean_output, string_output)

    def convert_single_item(self, value, data_type):
        if data_type == "INT":
            return self.to_int(value)
        elif data_type == "FLOAT":
            return self.to_float(value)
        elif data_type == "BOOLEAN":
            return self.to_boolean(value)
        elif data_type == "STRING":
            return self.to_string(value)
        return value

    def to_int(self, value):
        try:
            return int(float(value))
        except (ValueError, TypeError):
            return 0

    def to_float(self, value):
        try:
            return float(value)
        except (ValueError, TypeError):
            return 0.0

    def to_boolean(self, value):
        if isinstance(value, bool):
            return value
        try:
            return str(value).lower() in ("true", "1")
        except:
            return False

    def to_string(self, value):
        return str(value)


# 特定类型的开关节点（提供更好的类型安全）
class XIS_ImageSwitch:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "enable": ("BOOLEAN", {"default": True}),
            },
            "optional": {
                "image_input": ("IMAGE",),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "switch_image"
    CATEGORY = "XISER_Nodes/Logic"

    def switch_image(self, enable, image_input=None):
        if enable:
            return (image_input,)
        else:
            return (None,)

class XIS_MaskSwitch:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "enable": ("BOOLEAN", {"default": True}),
            },
            "optional": {
                "mask_input": ("MASK",),
            }
        }

    RETURN_TYPES = ("MASK",)
    FUNCTION = "switch_mask"
    CATEGORY = "XISER_Nodes/Logic"

    def switch_mask(self, enable, mask_input=None):
        if enable:
            return (mask_input,)
        else:
            return (None,)

class XIS_StringSwitch:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "enable": ("BOOLEAN", {"default": True}),
            },
            "optional": {
                "string_input": ("STRING",),
            }
        }

    RETURN_TYPES = ("STRING",)
    FUNCTION = "switch_string"
    CATEGORY = "XISER_Nodes/Logic"

    def switch_string(self, enable, string_input=None):
        if enable:
            return (string_input,)
        else:
            return (None,)

class XIS_IntSwitch:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "enable": ("BOOLEAN", {"default": True}),
            },
            "optional": {
                "int_input": ("INT",),
            }
        }

    RETURN_TYPES = ("INT",)
    FUNCTION = "switch_int"
    CATEGORY = "XISER_Nodes/Logic"

    def switch_int(self, enable, int_input=None):
        if enable:
            return (int_input,)
        else:
            return (None,)

class XIS_FloatSwitch:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "enable": ("BOOLEAN", {"default": True}),
            },
            "optional": {
                "float_input": ("FLOAT",),
            }
        }

    RETURN_TYPES = ("FLOAT",)
    FUNCTION = "switch_float"
    CATEGORY = "XISER_Nodes/Logic"

    def switch_float(self, enable, float_input=None):
        if enable:
            return (float_input,)
        else:
            return (None,)

class XIS_BooleanSwitch:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "enable": ("BOOLEAN", {"default": True}),
            },
            "optional": {
                "boolean_input": ("BOOLEAN",),
            }
        }

    RETURN_TYPES = ("BOOLEAN",)
    FUNCTION = "switch_boolean"
    CATEGORY = "XISER_Nodes/Logic"

    def switch_boolean(self, enable, boolean_input=None):
        if enable:
            return (boolean_input,)
        else:
            return (None,)

NODE_CLASS_MAPPINGS = {
    "XIS_IsThereAnyData": XIS_IsThereAnyData,
    "XIS_IfDataIsNone": XIS_IfDataIsNone,
    "XIS_ImageSwitch": XIS_ImageSwitch,
    "XIS_MaskSwitch": XIS_MaskSwitch,
    "XIS_StringSwitch": XIS_StringSwitch,
    "XIS_IntSwitch": XIS_IntSwitch,
    "XIS_FloatSwitch": XIS_FloatSwitch,
    "XIS_BooleanSwitch": XIS_BooleanSwitch,
}