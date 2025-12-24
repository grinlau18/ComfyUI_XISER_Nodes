from typing import List, Tuple
from .utils import logger
from typing import Any
import hashlib


# 输入多个提示词并通过开关控制
class XIS_PromptsWithSwitches:
    MAX_PROMPT_COUNT = 50  # 最大支持50个prompt组合

    @classmethod
    def INPUT_TYPES(cls):
        input_config = {}
        for i in range(1, cls.MAX_PROMPT_COUNT + 1):
            input_config[f"prompt_{i}"] = ("STRING", {"default": "", "multiline": True})
            input_config[f"enable_{i}"] = ("BOOLEAN", {"default": True})
        return {"required": {}, "optional": input_config}

    RETURN_TYPES = ("STRING", "BOOLEAN")
    OUTPUT_IS_LIST = (True, False)
    FUNCTION = "process_prompts"
    CATEGORY = "XISER_Nodes/UI_And_Control"

    def process_prompts(self, **kwargs):
        prompts = []
        for i in range(1, self.MAX_PROMPT_COUNT + 1):
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

# 画布配置节点 - 输出 CANVAS_CONFIG 类型
class XIS_CanvasConfig:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "board_width": ("INT", {"default": 1024, "min": 256, "max": 8192, "step": 16}),
                "board_height": ("INT", {"default": 1024, "min": 256, "max": 8192, "step": 16}),
                "canvas_color": (["black", "white", "transparent"], {"default": "black"}),
                "auto_size": (["off", "on"], {"default": "off"}),
            }
        }

    RETURN_TYPES = ("CANVAS_CONFIG",)
    RETURN_NAMES = ("canvas_config",)
    FUNCTION = "create_config"
    CATEGORY = "XISER_Nodes/UI_And_Control"

    def create_config(self, board_width, board_height, canvas_color, auto_size):
        """
        创建画布配置字典，用于传递给 XISER_Canvas 节点的 canvas_config 输入

        注意：border_width 参数已移除，因为前端画板大小无法同步更新
        """
        config = {
            "board_width": board_width,
            "board_height": board_height,
            "canvas_color": canvas_color,
            "auto_size": auto_size
        }
        logger.info(f"Canvas config created: {config}")
        return (config,)

# 字符串列表合并节点
class XIS_StringListMerger:
    """将字符串列表合并为单个字符串，支持自定义连接符"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "string_list": ("STRING", {"forceInput": True}),
                "separator": ("STRING", {"default": ", ", "multiline": False, "placeholder": "输入连接符，如 , 或 \\n"}),
                "strip_items": ("BOOLEAN", {"default": True, "label_on": "去除空白", "label_off": "保留原样"}),
                "skip_empty": ("BOOLEAN", {"default": True, "label_on": "跳过空项", "label_off": "保留空项"}),
            }
        }

    RETURN_TYPES = ("STRING",)
    INPUT_IS_LIST = True
    FUNCTION = "merge_strings"
    CATEGORY = "XISER_Nodes/UI_And_Control"

    def merge_strings(self, string_list, separator, strip_items, skip_empty):
        """
        合并字符串列表

        Args:
            string_list: 输入的字符串列表（由于INPUT_IS_LIST=True，这是一个列表的列表）
            separator: 连接符列表（每个元素相同）
            strip_items: 布尔值列表（每个元素相同）
            skip_empty: 布尔值列表（每个元素相同）

        Returns:
            合并后的单个字符串
        """
        # 由于INPUT_IS_LIST=True，所有输入都是列表
        # 我们只需要第一个元素，因为所有元素都相同
        separator = separator[0] if isinstance(separator, list) and len(separator) > 0 else ", "
        strip_items = strip_items[0] if isinstance(strip_items, list) and len(strip_items) > 0 else True
        skip_empty = skip_empty[0] if isinstance(skip_empty, list) and len(skip_empty) > 0 else True

        # 处理转义字符（如 \n, \t 等）
        separator = separator.encode().decode('unicode_escape')

        # 收集所有字符串（扁平化处理）
        all_strings = []
        for str_list in string_list:
            # 处理输入：str_list 可能是一个列表，也可能是单个字符串
            if isinstance(str_list, str):
                # 如果是单个字符串，直接添加到所有字符串
                all_strings.append(str_list)
                continue

            if not isinstance(str_list, list):
                # 如果不是列表，尝试转换为列表
                str_list = [str(str_list)]

            # 添加所有字符串
            all_strings.extend(str_list)

        # 处理每个字符串
        processed_strings = []
        for item in all_strings:
            # 转换为字符串
            item_str = str(item)

            # 去除空白（如果启用）
            if strip_items:
                item_str = item_str.strip()

            # 跳过空项（如果启用）
            # 注意：空白字符串（如 "   "）在 strip_items=False 时不算空
            if skip_empty:
                if strip_items:
                    # 如果启用了去除空白，那么去除空白后检查是否为空
                    if not item_str.strip():
                        continue
                else:
                    # 如果没有启用去除空白，只检查原始字符串是否为空
                    if not item_str:
                        continue

            processed_strings.append(item_str)

        # 合并所有字符串为一个字符串
        if not processed_strings:
            result = ""
        else:
            result = separator.join(processed_strings)

        return (result,)

# 节点映射
NODE_CLASS_MAPPINGS = {
    "XIS_PromptsWithSwitches": XIS_PromptsWithSwitches,
    "XIS_Float_Slider": XIS_Float_Slider,
    "XIS_INT_Slider": XIS_INT_Slider,
    "XIS_ResolutionSelector": XIS_ResolutionSelector,
    "XIS_PromptProcessor": XIS_PromptProcessor,
    "XIS_MultiPromptSwitch": XIS_MultiPromptSwitch,
    "XIS_IPAStyleSettings": XIS_IPAStyleSettings,
    "XIS_CanvasConfig": XIS_CanvasConfig,
    "XIS_StringListMerger": XIS_StringListMerger,
}