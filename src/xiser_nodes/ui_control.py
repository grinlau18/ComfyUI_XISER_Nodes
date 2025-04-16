# src/xiser_nodes/ui_control.py
from typing import List, Tuple
from .utils import logger

# 输入多个提示词并通过开关控制输出
class XIS_PromptsWithSwitches:
    @classmethod
    def INPUT_TYPES(cls):
        input_config = {}
        for i in range(1, 6):
            input_config[f"prompt_{i}"] = ("STRING", {"default": "", "multiline": True})
            input_config[f"enable_{i}"] = ("BOOLEAN", {"default": True})
        return {"required": {}, "optional": input_config}

    RETURN_TYPES = ("STRING", "BOOLEAN")
    OUTPUT_IS_LIST = (True, False)
    FUNCTION = "process_prompts"
    CATEGORY = "XISER_Nodes/UIControl"

    def process_prompts(self, **kwargs):
        prompts = []
        for i in range(1, 6):
            prompt_key = f"prompt_{i}"
            enable_key = f"enable_{i}"
            prompt = kwargs.get(prompt_key, "")
            enable = kwargs.get(enable_key, True)
            if enable and prompt.strip():
                prompts.append(prompt)
        if not prompts:
            return (["No prompts to display."], False)
        return (prompts, True)

# 输入浮点数并通过滑块控制
class XIS_Float_Slider:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "value": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.01, "display": "slider"}),
            }
        }

    RETURN_TYPES = ("FLOAT",)
    FUNCTION = "process_float_slider"
    CATEGORY = "XISER_Nodes/UIControl"

    def process_float_slider(self, value):
        return (value,)

# 输入整数并通过滑块控制
class XIS_INT_Slider:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "value": ("INT", {"default": 0, "min": 0, "max": 100, "step": 1, "display": "slider"}),
            }
        }

    RETURN_TYPES = ("INT",)
    FUNCTION = "process_int_slider"
    CATEGORY = "XISER_Nodes/UIControl"

    def process_int_slider(self, value):
        return (value,)

NODE_CLASS_MAPPINGS = {
    "XIS_PromptsWithSwitches": XIS_PromptsWithSwitches,
    "XIS_Float_Slider": XIS_Float_Slider,
    "XIS_INT_Slider": XIS_INT_Slider,
}