from typing import List, Tuple
from .utils import logger
from typing import Any
import hashlib


# 输入多个提示词并通过开关控制
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
    CATEGORY = "XISER_Nodes/UI_And_Control"

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
    CATEGORY = "XISER_Nodes/UI_And_Control"

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
    CATEGORY = "XISER_Nodes/UI_And_Control"

    def process_int_slider(self, value):
        return (value,)
    

class XIS_Label:
    @classmethod
    def INPUT_TYPES(cls) -> dict:
        """Returns the input types for the node."""
        return {}  # No input parameters

    RETURN_TYPES = ()  # No return values
    FUNCTION = "execute"  # Node execution function
    CATEGORY = "XISER_Nodes/UI_And_Control"  # Node category

    def execute(self) -> None:
        pass

    def onNodeCreated(self) -> None:
        self.properties = self.properties or {}
        self.properties["textData"] = (
            '<p style="font-size:20px;color:#FFFFFF;">小贴纸</p>'
            '<p style="font-size:12px;color:#999999;">使用右键菜单编辑文字</p>'
        )
        self.color = "#333355"  # Default dark gray

# IPA参数设置节点
class XIS_IPAStyleSettings:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "option": (["linear", "ease in", "ease out", "ease in-out", "reverse in-out", "weak input", "weak output",
                            "weak middle", "strong middle", "style transfer", "composition", "strong style transfer",
                            "style and composition", "style transfer precise", "composition precise"],),
                "slider": ("FLOAT", {"default": 0.5, "min": 0.00, "max": 1.00, "step": 0.01, "display": "slider"}),
            }
        }

    RETURN_TYPES = ("STRING", "FLOAT")
    FUNCTION = "process"
    CATEGORY = "XISER_Nodes/UI_And_Control"

    def process(self, option, slider):
        return (option, slider)

# 提示词处理器      
class XIS_PromptProcessor:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "positive_prompt1": ("STRING", {"default": "", "multiline": True, "placeholder": "输入自定义正向提示词"}),
                "positive_prompt2": ("STRING", {"default": ""}),  # Changed to input interface
                "negative_prompt": ("STRING", {"default": "", "multiline": True, "placeholder": "输入反向提示词"}),
                "merge_positive": ("BOOLEAN", {
                    "default": True,
                    "label_on": "已使用自动反推词",
                    "label_off": "已关闭自动反推词"
                }),
            }
        }

    RETURN_TYPES = ("STRING", "STRING", "BOOLEAN")
    RETURN_NAMES = ("combined_prompt", "negative_prompt", "merge_status")

    FUNCTION = "process_prompt"

    CATEGORY = "XISER_Nodes/UI_And_Control"

    def process_prompt(self, positive_prompt1, positive_prompt2, negative_prompt, merge_positive):
        # 扩展结束符号集合
        end_symbols = {".", "。", ",", "，", ")", "!", "！", "?", "？", ";", "；"}

        # 处理合并逻辑
        if merge_positive and positive_prompt2 and positive_prompt2 != "none":
            # 如果 positive_prompt1 为空，直接使用 positive_prompt2
            if not positive_prompt1.strip():
                combined_prompt = positive_prompt2.strip()
            else:
                # 去除首尾空白
                prompt1_stripped = positive_prompt1.strip()
                # 检查 positive_prompt1 的结尾是否有结束符号
                if prompt1_stripped[-1] not in end_symbols:
                    # 如果没有结束符号，添加“.”并换行
                    combined_prompt = f"{prompt1_stripped}.\n{positive_prompt2.strip()}"
                else:
                    # 如果已有结束符号，仅换行合并
                    combined_prompt = f"{prompt1_stripped}\n{positive_prompt2.strip()}"
        else:
            # 如果不合并，仅使用 positive_prompt1 并去除空白
            combined_prompt = positive_prompt1.strip()

        # 返回三个输出值
        return (combined_prompt, negative_prompt, merge_positive)

    @classmethod
    def IS_CHANGED(cls, positive_prompt1, positive_prompt2, negative_prompt, merge_positive):
        # 根据所有输入参数生成唯一的哈希值
        import hashlib
        input_hash = hashlib.sha256(
            f"{positive_prompt1}_{positive_prompt2}_{negative_prompt}_{merge_positive}".encode()
        ).hexdigest()
        return input_hash

    def __init__(self):
        pass


class XIS_MultiPromptSwitch:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "positive_prompt1": ("STRING", {"default": "", "multiline": True, "placeholder": "输入正向提示词"}),
                "positive_prompt2": ("STRING", {"default": ""}),
                "enable_prompt2": ("BOOLEAN", {"default": True, "label_on": "启用", "label_off": "禁用"}),
                "positive_prompt3": ("STRING", {"default": ""}),
                "enable_prompt3": ("BOOLEAN", {"default": True, "label_on": "启用", "label_off": "禁用"}),
                "positive_prompt4": ("STRING", {"default": ""}),
                "enable_prompt4": ("BOOLEAN", {"default": True, "label_on": "启用", "label_off": "禁用"}),
                "positive_prompt5": ("STRING", {"default": ""}),
                "enable_prompt5": ("BOOLEAN", {"default": True, "label_on": "启用", "label_off": "禁用"}),
                "negative_prompt1": ("STRING", {"default": "", "multiline": True, "placeholder": "输入反向提示词"}),
                "negative_prompt2": ("STRING", {"default": ""}),
                "enable_neg_prompt2": ("BOOLEAN", {"default": True, "label_on": "启用", "label_off": "禁用"}),
                "negative_prompt3": ("STRING", {"default": ""}),
                "enable_neg_prompt3": ("BOOLEAN", {"default": True, "label_on": "启用", "label_off": "禁用"}),
                "negative_prompt4": ("STRING", {"default": ""}),
                "enable_neg_prompt4": ("BOOLEAN", {"default": True, "label_on": "启用", "label_off": "禁用"}),
                "negative_prompt5": ("STRING", {"default": ""}),
                "enable_neg_prompt5": ("BOOLEAN", {"default": True, "label_on": "启用", "label_off": "禁用"}),  
            }
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("combined_positive_prompt", "combined_negative_prompt")

    FUNCTION = "process_prompts"

    CATEGORY = "XISER_Nodes/UI_And_Control"

    def process_prompts(self, positive_prompt1, positive_prompt2, positive_prompt3, positive_prompt4, positive_prompt5,
                        enable_prompt2, enable_prompt3, enable_prompt4, enable_prompt5,
                        negative_prompt1, negative_prompt2, negative_prompt3, negative_prompt4, negative_prompt5,
                        enable_neg_prompt2, enable_neg_prompt3, enable_neg_prompt4, enable_neg_prompt5):
        # 扩展结束符号集合
        end_symbols = {".", "。", ",", "，", ")", "!", "！", "?", "？", ";", "；"}

        # 处理正向提示词合并
        positive_prompts = [positive_prompt1.strip()]
        for prompt, enabled in [
            (positive_prompt2, enable_prompt2),
            (positive_prompt3, enable_prompt3),
            (positive_prompt4, enable_prompt4),
            (positive_prompt5, enable_prompt5)
        ]:
            if enabled and prompt and prompt.strip() != "none":
                positive_prompts.append(prompt.strip())

        combined_positive = ""
        for i, prompt in enumerate(positive_prompts):
            if not prompt:
                continue
            if i == 0:
                combined_positive = prompt
            else:
                prev_prompt = positive_prompts[i-1]
                if prev_prompt and prev_prompt[-1] not in end_symbols:
                    combined_positive += ".\n" + prompt
                else:
                    combined_positive += "\n" + prompt

        # 处理反向提示词合并
        negative_prompts = [negative_prompt1.strip()]
        for prompt, enabled in [
            (negative_prompt2, enable_neg_prompt2),
            (negative_prompt3, enable_neg_prompt3),
            (negative_prompt4, enable_neg_prompt4),
            (negative_prompt5, enable_neg_prompt5)
        ]:
            if enabled and prompt and prompt.strip() != "none":
                negative_prompts.append(prompt.strip())

        combined_negative = ""
        for i, prompt in enumerate(negative_prompts):
            if not prompt:
                continue
            if i == 0:
                combined_negative = prompt
            else:
                prev_prompt = negative_prompts[i-1]
                if prev_prompt and prev_prompt[-1] not in end_symbols:
                    combined_negative += ".\n" + prompt
                else:
                    combined_negative += "\n" + prompt

        return (combined_positive, combined_negative)

    @classmethod
    def IS_CHANGED(cls, positive_prompt1, positive_prompt2, positive_prompt3, positive_prompt4, positive_prompt5,
                   enable_prompt2, enable_prompt3, enable_prompt4, enable_prompt5,
                   negative_prompt1, negative_prompt2, negative_prompt3, negative_prompt4, negative_prompt5,
                   enable_neg_prompt2, enable_neg_prompt3, enable_neg_prompt4, enable_neg_prompt5):
        # 根据所有输入参数生成唯一的哈希值
        input_string = f"{positive_prompt1}_{positive_prompt2}_{positive_prompt3}_{positive_prompt4}_{positive_prompt5}_" \
                       f"{enable_prompt2}_{enable_prompt3}_{enable_prompt4}_{enable_prompt5}_" \
                       f"{negative_prompt1}_{negative_prompt2}_{negative_prompt3}_{negative_prompt4}_{negative_prompt5}_" \
                       f"{enable_neg_prompt2}_{enable_neg_prompt3}_{enable_neg_prompt4}_{enable_neg_prompt5}"
        input_hash = hashlib.sha256(input_string.encode()).hexdigest()
        return input_hash

    def __init__(self):
        pass



# 处理分辨率选择
class XIS_ResolutionSelector:
    @classmethod
    def INPUT_TYPES(cls):
        # 丰富预设分辨率选项
        resolution_options = [
            "256x256 (1:1)", "512x512 (1:1)", "768x768 (1:1)", "1024x1024 (1:1)", "2048x2048 (1:1)",
            "640x480 (4:3)", "800x600 (4:3)", "1024x768 (4:3)", "1280x960 (4:3)",
            "1280x720 (16:9)", "1920x1080 (16:9)", "2560x1440 (16:9)", "3840x2160 (16:9)",
            "720x1280 (9:16)", "1080x1920 (9:16)", "1440x2560 (9:16)", "2160x3840 (9:16)",
            "800x1200 (2:3)", "1200x1800 (2:3)", "1200x800 (3:2)", "1800x1200 (3:2)",
            "960x540 (16:9)", "854x480 (16:9)"
        ]
        
        return {
            "required": {
                "resolution": (resolution_options, {"default": "512x512 (1:1)"}),  # 下拉菜单选择分辨率
                "use_custom_resolution": ("BOOLEAN", {
                    "default": False,
                    "label_on": "使用自定义分辨率",
                    "label_off": "使用预设分辨率"
                }),  # 是否使用自定义分辨率
                "custom_width": ("INT", {
                    "default": 512,
                    "min": 1,
                    "max": 8192,
                    "step": 1,
                    "display": "number"
                }),  # 自定义宽度
                "custom_height": ("INT", {
                    "default": 512,
                    "min": 1,
                    "max": 8192,
                    "step": 1,
                    "display": "number"
                }),  # 自定义高度
                "swap_orientation": ("BOOLEAN", {
                    "default": False,
                    "label_on": "已切换横竖方向",
                    "label_off": "未切换横竖方向"
                })  # 是否切换横竖方向
            }
        }

    RETURN_TYPES = ("INT", "INT")
    RETURN_NAMES = ("width", "height")

    FUNCTION = "select_resolution"

    CATEGORY = "XISER_Nodes/UI_And_Control"

    def select_resolution(self, resolution, use_custom_resolution, custom_width, custom_height, swap_orientation):
        # 解析预设分辨率
        if not use_custom_resolution:
            # 从字符串中提取宽度和高度
            width_str, height_str = resolution.split(" ")[0].split("x")
            width = int(width_str)
            height = int(height_str)
        else:
            # 使用自定义分辨率
            width = custom_width
            height = custom_height

        # 如果需要切换横竖方向
        if swap_orientation:
            width, height = height, width

        # 返回最终的宽度和高度
        return (width, height)

    @classmethod
    def IS_CHANGED(cls, resolution, use_custom_resolution, custom_width, custom_height, swap_orientation):
        # 根据所有输入参数生成唯一的哈希值
        input_hash = hashlib.sha256(
            f"{resolution}_{use_custom_resolution}_{custom_width}_{custom_height}_{swap_orientation}".encode()
        ).hexdigest()
        return input_hash

    def __init__(self):
        pass

# 节点映射
NODE_CLASS_MAPPINGS = {
    "XIS_PromptsWithSwitches": XIS_PromptsWithSwitches,
    "XIS_Float_Slider": XIS_Float_Slider,
    "XIS_INT_Slider": XIS_INT_Slider,
    "XIS_Label": XIS_Label,
    "XIS_ResolutionSelector": XIS_ResolutionSelector,
    "XIS_PromptProcessor": XIS_PromptProcessor,
    "XIS_MultiPromptSwitch": XIS_MultiPromptSwitch,
    "XIS_IPAStyleSettings": XIS_IPAStyleSettings,
}