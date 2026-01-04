"""UI控制节点 - V3版本"""

from comfy_api.v0_0_2 import io, ui
from typing import List, Tuple, Any
import hashlib
from .utils import logger

# ============================================================================
# 输入多个提示词并通过开关控制
# ============================================================================

class XIS_PromptsWithSwitchesV3(io.ComfyNode):
    """
    输入多个提示词并通过开关控制
    """
    MAX_PROMPT_COUNT = 50  # 最大支持50个prompt组合

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点架构"""
        inputs = []
        for i in range(1, cls.MAX_PROMPT_COUNT + 1):
            inputs.append(
                io.String.Input(f"prompt_{i}",
                              default="",
                              multiline=True,
                              optional=True,
                              tooltip=f"提示词 {i}")
            )
            inputs.append(
                io.Boolean.Input(f"enable_{i}",
                               default=True,
                               optional=True,
                               tooltip=f"启用开关 {i}")
            )

        return io.Schema(
            node_id="XIS_PromptsWithSwitches",
            display_name="Prompts With Switches",
            category="XISER_Nodes/UI_And_Control",
            description="输入多个提示词并通过开关控制",
            inputs=inputs,
            outputs=[
                io.String.Output(display_name="prompts", is_output_list=True),
                io.Boolean.Output(display_name="has_prompts")
            ]
        )

    @classmethod
    def execute(cls, **kwargs) -> io.NodeOutput:
        """
        执行方法：处理提示词开关
        """
        prompts = []
        for i in range(1, cls.MAX_PROMPT_COUNT + 1):
            prompt_key = f"prompt_{i}"
            enable_key = f"enable_{i}"
            prompt = kwargs.get(prompt_key, "")
            enable = kwargs.get(enable_key, True)
            if enable and prompt and prompt.strip():
                prompts.append(prompt.strip())

        if not prompts:
            return io.NodeOutput(["No prompts to display."], False)
        return io.NodeOutput(prompts, True)


# ============================================================================
# 滑块控制节点
# ============================================================================

class XIS_Float_SliderV3(io.ComfyNode):
    """
    浮点数滑块控制节点
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点架构"""
        return io.Schema(
            node_id="XIS_Float_Slider",
            display_name="Float Slider",
            category="XISER_Nodes/UI_And_Control",
            description="浮点数滑块控制节点",
            inputs=[
                io.Float.Input("value",
                             default=0.0,
                             min=0.0,
                             max=1.0,
                             step=0.01,
                             display_mode=io.NumberDisplay.slider,
                             tooltip="滑块值")
            ],
            outputs=[
                io.Float.Output(display_name="value_output")
            ]
        )

    @classmethod
    def execute(cls, value) -> io.NodeOutput:
        """
        执行方法：返回滑块值
        """
        return io.NodeOutput(value)


class XIS_INT_SliderV3(io.ComfyNode):
    """
    整数滑块控制节点
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点架构"""
        return io.Schema(
            node_id="XIS_INT_Slider",
            display_name="INT Slider",
            category="XISER_Nodes/UI_And_Control",
            description="整数滑块控制节点",
            inputs=[
                io.Int.Input("value",
                           default=0,
                           min=0,
                           max=100,
                           step=1,
                           display_mode=io.NumberDisplay.slider,
                           tooltip="滑块值")
            ],
            outputs=[
                io.Int.Output(display_name="value_output")
            ]
        )

    @classmethod
    def execute(cls, value) -> io.NodeOutput:
        """
        执行方法：返回滑块值
        """
        return io.NodeOutput(value)


# ============================================================================
# IPA参数设置节点
# ============================================================================

class XIS_IPAStyleSettingsV3(io.ComfyNode):
    """
    IPA风格设置节点
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点架构"""
        return io.Schema(
            node_id="XIS_IPAStyleSettings",
            display_name="IPA Style Settings",
            category="XISER_Nodes/UI_And_Control",
            description="IPA风格设置节点",
            inputs=[
                io.Combo.Input("option",
                             options=["linear", "ease in", "ease out", "ease in-out", "reverse in-out",
                                      "weak input", "weak output", "weak middle", "strong middle",
                                      "style transfer", "composition", "strong style transfer",
                                      "style and composition", "style transfer precise", "composition precise"],
                             tooltip="选项"),
                io.Float.Input("slider",
                             default=0.5,
                             min=0.00,
                             max=1.00,
                             step=0.01,
                             display_mode=io.NumberDisplay.slider,
                             tooltip="滑块值")
            ],
            outputs=[
                io.String.Output(display_name="option_output"),
                io.Float.Output(display_name="slider_output")
            ]
        )

    @classmethod
    def execute(cls, option, slider) -> io.NodeOutput:
        """
        执行方法：返回选项和滑块值
        """
        return io.NodeOutput(option, slider)


# ============================================================================
# 提示词处理器
# ============================================================================

class XIS_PromptProcessorV3(io.ComfyNode):
    """
    提示词处理器
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点架构"""
        return io.Schema(
            node_id="XIS_PromptProcessor",
            display_name="Prompt Processor",
            category="XISER_Nodes/UI_And_Control",
            description="提示词处理器",
            inputs=[
                io.String.Input("positive_prompt1",
                              default="",
                              multiline=True,
                              placeholder="输入自定义正向提示词",
                              tooltip="正向提示词1"),
                io.String.Input("positive_prompt2",
                              default="",
                              tooltip="正向提示词2"),
                io.String.Input("negative_prompt",
                              default="",
                              multiline=True,
                              placeholder="输入反向提示词",
                              tooltip="反向提示词"),
                io.Boolean.Input("merge_positive",
                               default=True,
                               label_on="已使用自动反推词",
                               label_off="已关闭自动反推词",
                               tooltip="合并正向提示词")
            ],
            outputs=[
                io.String.Output(display_name="combined_prompt"),
                io.String.Output(display_name="negative_prompt"),
                io.Boolean.Output(display_name="merge_status")
            ]
        )

    @classmethod
    def execute(cls, positive_prompt1, positive_prompt2, negative_prompt, merge_positive) -> io.NodeOutput:
        """
        执行方法：处理提示词合并逻辑
        """
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
                    # 如果没有结束符号，添加"."并换行
                    combined_prompt = f"{prompt1_stripped}.\n{positive_prompt2.strip()}"
                else:
                    # 如果已有结束符号，仅换行合并
                    combined_prompt = f"{prompt1_stripped}\n{positive_prompt2.strip()}"
        else:
            # 如果不合并，仅使用 positive_prompt1 并去除空白
            combined_prompt = positive_prompt1.strip()

        # 返回三个输出值
        return io.NodeOutput(combined_prompt, negative_prompt, merge_positive)

    @classmethod
    def fingerprint_inputs(cls, **kwargs) -> str:
        """
        替代V1的IS_CHANGED：根据所有输入参数生成唯一的哈希值
        """
        positive_prompt1 = kwargs.get("positive_prompt1", "")
        positive_prompt2 = kwargs.get("positive_prompt2", "")
        negative_prompt = kwargs.get("negative_prompt", "")
        merge_positive = kwargs.get("merge_positive", True)

        input_hash = hashlib.sha256(
            f"{positive_prompt1}_{positive_prompt2}_{negative_prompt}_{merge_positive}".encode()
        ).hexdigest()
        return input_hash


# ============================================================================
# 多提示词开关
# ============================================================================

class XIS_MultiPromptSwitchV3(io.ComfyNode):
    """
    多提示词开关
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点架构"""
        return io.Schema(
            node_id="XIS_MultiPromptSwitch",
            display_name="Multi Prompt Switch",
            category="XISER_Nodes/UI_And_Control",
            description="多提示词开关",
            inputs=[
                io.String.Input("positive_prompt1",
                              default="",
                              multiline=True,
                              placeholder="输入正向提示词",
                              tooltip="正向提示词1"),
                io.String.Input("positive_prompt2",
                              default="",
                              tooltip="正向提示词2"),
                io.Boolean.Input("enable_prompt2",
                               default=True,
                               label_on="启用",
                               label_off="禁用",
                               tooltip="启用提示词2"),
                io.String.Input("positive_prompt3",
                              default="",
                              tooltip="正向提示词3"),
                io.Boolean.Input("enable_prompt3",
                               default=True,
                               label_on="启用",
                               label_off="禁用",
                               tooltip="启用提示词3"),
                io.String.Input("positive_prompt4",
                              default="",
                              tooltip="正向提示词4"),
                io.Boolean.Input("enable_prompt4",
                               default=True,
                               label_on="启用",
                               label_off="禁用",
                               tooltip="启用提示词4"),
                io.String.Input("positive_prompt5",
                              default="",
                              tooltip="正向提示词5"),
                io.Boolean.Input("enable_prompt5",
                               default=True,
                               label_on="启用",
                               label_off="禁用",
                               tooltip="启用提示词5"),
                io.String.Input("negative_prompt1",
                              default="",
                              multiline=True,
                              placeholder="输入反向提示词",
                              tooltip="反向提示词1"),
                io.String.Input("negative_prompt2",
                              default="",
                              tooltip="反向提示词2"),
                io.Boolean.Input("enable_neg_prompt2",
                               default=True,
                               label_on="启用",
                               label_off="禁用",
                               tooltip="启用反向提示词2"),
                io.String.Input("negative_prompt3",
                              default="",
                              tooltip="反向提示词3"),
                io.Boolean.Input("enable_neg_prompt3",
                               default=True,
                               label_on="启用",
                               label_off="禁用",
                               tooltip="启用反向提示词3"),
                io.String.Input("negative_prompt4",
                              default="",
                              tooltip="反向提示词4"),
                io.Boolean.Input("enable_neg_prompt4",
                               default=True,
                               label_on="启用",
                               label_off="禁用",
                               tooltip="启用反向提示词4"),
                io.String.Input("negative_prompt5",
                              default="",
                              tooltip="反向提示词5"),
                io.Boolean.Input("enable_neg_prompt5",
                               default=True,
                               label_on="启用",
                               label_off="禁用",
                               tooltip="启用反向提示词5"),
            ],
            outputs=[
                io.String.Output(display_name="combined_positive_prompt"),
                io.String.Output(display_name="combined_negative_prompt")
            ]
        )

    @classmethod
    def execute(cls, positive_prompt1, positive_prompt2, positive_prompt3, positive_prompt4, positive_prompt5,
                enable_prompt2, enable_prompt3, enable_prompt4, enable_prompt5,
                negative_prompt1, negative_prompt2, negative_prompt3, negative_prompt4, negative_prompt5,
                enable_neg_prompt2, enable_neg_prompt3, enable_neg_prompt4, enable_neg_prompt5) -> io.NodeOutput:
        """
        执行方法：处理多提示词合并
        """
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

        return io.NodeOutput(combined_positive, combined_negative)

    @classmethod
    def fingerprint_inputs(cls, **kwargs) -> str:
        """
        替代V1的IS_CHANGED：根据所有输入参数生成唯一的哈希值
        """
        positive_prompt1 = kwargs.get("positive_prompt1", "")
        positive_prompt2 = kwargs.get("positive_prompt2", "")
        positive_prompt3 = kwargs.get("positive_prompt3", "")
        positive_prompt4 = kwargs.get("positive_prompt4", "")
        positive_prompt5 = kwargs.get("positive_prompt5", "")
        enable_prompt2 = kwargs.get("enable_prompt2", True)
        enable_prompt3 = kwargs.get("enable_prompt3", True)
        enable_prompt4 = kwargs.get("enable_prompt4", True)
        enable_prompt5 = kwargs.get("enable_prompt5", True)
        negative_prompt1 = kwargs.get("negative_prompt1", "")
        negative_prompt2 = kwargs.get("negative_prompt2", "")
        negative_prompt3 = kwargs.get("negative_prompt3", "")
        negative_prompt4 = kwargs.get("negative_prompt4", "")
        negative_prompt5 = kwargs.get("negative_prompt5", "")
        enable_neg_prompt2 = kwargs.get("enable_neg_prompt2", True)
        enable_neg_prompt3 = kwargs.get("enable_neg_prompt3", True)
        enable_neg_prompt4 = kwargs.get("enable_neg_prompt4", True)
        enable_neg_prompt5 = kwargs.get("enable_neg_prompt5", True)

        input_string = f"{positive_prompt1}_{positive_prompt2}_{positive_prompt3}_{positive_prompt4}_{positive_prompt5}_" \
                       f"{enable_prompt2}_{enable_prompt3}_{enable_prompt4}_{enable_prompt5}_" \
                       f"{negative_prompt1}_{negative_prompt2}_{negative_prompt3}_{negative_prompt4}_{negative_prompt5}_" \
                       f"{enable_neg_prompt2}_{enable_neg_prompt3}_{enable_neg_prompt4}_{enable_neg_prompt5}"
        input_hash = hashlib.sha256(input_string.encode()).hexdigest()
        return input_hash


# ============================================================================
# 分辨率选择器
# ============================================================================

class XIS_ResolutionSelectorV3(io.ComfyNode):
    """
    分辨率选择器
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点架构"""
        # 丰富预设分辨率选项
        resolution_options = [
            "256x256 (1:1)", "512x512 (1:1)", "768x768 (1:1)", "1024x1024 (1:1)", "2048x2048 (1:1)",
            "640x480 (4:3)", "800x600 (4:3)", "1024x768 (4:3)", "1280x960 (4:3)",
            "1280x720 (16:9)", "1920x1080 (16:9)", "2560x1440 (16:9)", "3840x2160 (16:9)",
            "720x1280 (9:16)", "1080x1920 (9:16)", "1440x2560 (9:16)", "2160x3840 (9:16)",
            "800x1200 (2:3)", "1200x1800 (2:3)", "1200x800 (3:2)", "1800x1200 (3:2)",
            "960x540 (16:9)", "854x480 (16:9)"
        ]

        return io.Schema(
            node_id="XIS_ResolutionSelector",
            display_name="Resolution Selector",
            category="XISER_Nodes/UI_And_Control",
            description="分辨率选择器",
            inputs=[
                io.Combo.Input("resolution",
                             options=resolution_options,
                             default="512x512 (1:1)",
                             tooltip="预设分辨率"),
                io.Boolean.Input("use_custom_resolution",
                               default=False,
                               label_on="使用自定义分辨率",
                               label_off="使用预设分辨率",
                               tooltip="使用自定义分辨率"),
                io.Int.Input("custom_width",
                           default=512,
                           min=1,
                           max=8192,
                           step=1,
                           display_mode=io.NumberDisplay.number,
                           tooltip="自定义宽度"),
                io.Int.Input("custom_height",
                           default=512,
                           min=1,
                           max=8192,
                           step=1,
                           display_mode=io.NumberDisplay.number,
                           tooltip="自定义高度"),
                io.Boolean.Input("swap_orientation",
                               default=False,
                               label_on="已切换横竖方向",
                               label_off="未切换横竖方向",
                               tooltip="切换横竖方向")
            ],
            outputs=[
                io.Int.Output(display_name="width"),
                io.Int.Output(display_name="height")
            ]
        )

    @classmethod
    def execute(cls, resolution, use_custom_resolution, custom_width, custom_height, swap_orientation) -> io.NodeOutput:
        """
        执行方法：选择分辨率
        """
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
        return io.NodeOutput(width, height)

    @classmethod
    def fingerprint_inputs(cls, **kwargs) -> str:
        """
        替代V1的IS_CHANGED：根据所有输入参数生成唯一的哈希值
        """
        resolution = kwargs.get("resolution", "")
        use_custom_resolution = kwargs.get("use_custom_resolution", False)
        custom_width = kwargs.get("custom_width", 512)
        custom_height = kwargs.get("custom_height", 512)
        swap_orientation = kwargs.get("swap_orientation", False)

        input_hash = hashlib.sha256(
            f"{resolution}_{use_custom_resolution}_{custom_width}_{custom_height}_{swap_orientation}".encode()
        ).hexdigest()
        return input_hash


# ============================================================================
# 画布配置节点
# ============================================================================

class XIS_CanvasConfigV3(io.ComfyNode):
    """
    画布配置节点 - 输出 CANVAS_CONFIG 类型
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点架构"""
        return io.Schema(
            node_id="XIS_CanvasConfig",
            display_name="Canvas Config",
            category="XISER_Nodes/UI_And_Control",
            description="画布配置节点",
            inputs=[
                io.Int.Input("board_width",
                           default=1024,
                           min=256,
                           max=8192,
                           step=16,
                           tooltip="画板宽度"),
                io.Int.Input("board_height",
                           default=1024,
                           min=256,
                           max=8192,
                           step=16,
                           tooltip="画板高度"),
                io.Combo.Input("canvas_color",
                             options=["black", "white", "transparent"],
                             default="black",
                             tooltip="画布颜色"),
                io.Combo.Input("auto_size",
                             options=["off", "on"],
                             default="off",
                             tooltip="自动调整大小")
            ],
            outputs=[
                io.Custom("CANVAS_CONFIG").Output(display_name="canvas_config")
            ]
        )

    @classmethod
    def execute(cls, board_width, board_height, canvas_color, auto_size) -> io.NodeOutput:
        """
        执行方法：创建画布配置字典
        """
        config = {
            "board_width": board_width,
            "board_height": board_height,
            "canvas_color": canvas_color,
            "auto_size": auto_size
        }
        logger.info(f"Canvas config created: {config}")
        return io.NodeOutput(config)


# ============================================================================
# 字符串列表合并节点
# ============================================================================

class XIS_StringListMergerV3(io.ComfyNode):
    """
    字符串列表合并节点
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点架构"""
        return io.Schema(
            node_id="XIS_StringListMerger",
            display_name="String List Merger",
            category="XISER_Nodes/UI_And_Control",
            description="将字符串列表合并为单个字符串，支持自定义连接符",
            inputs=[
                io.String.Input("string_list",
                              force_input=True,
                              tooltip="输入字符串列表"),
                io.String.Input("separator",
                              default=", ",
                              multiline=False,
                              placeholder="输入连接符，如 , 或 \\n",
                              tooltip="连接符"),
                io.Boolean.Input("strip_items",
                               default=True,
                               label_on="去除空白",
                               label_off="保留原样",
                               tooltip="去除空白"),
                io.Boolean.Input("skip_empty",
                               default=True,
                               label_on="跳过空项",
                               label_off="保留空项",
                               tooltip="跳过空项")
            ],
            outputs=[
                io.String.Output(display_name="merged_string")
            ],
            is_input_list=True  # 对应 V1 的 INPUT_IS_LIST = True
        )

    @classmethod
    def execute(cls, string_list, separator, strip_items, skip_empty) -> io.NodeOutput:
        """
        执行方法：合并字符串列表

        注意：当 is_input_list=True 时，
        string_list 是列表，separator 也是列表，strip_items 也是列表，skip_empty 也是列表
        """
        # 由于 is_input_list=True，所有输入都是列表
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

        return io.NodeOutput(result)


# ============================================================================
# 节点导出
# ============================================================================

V3_NODE_CLASSES = [
    XIS_PromptsWithSwitchesV3,
    XIS_Float_SliderV3,
    XIS_INT_SliderV3,
    XIS_IPAStyleSettingsV3,
    XIS_PromptProcessorV3,
    XIS_MultiPromptSwitchV3,
    XIS_ResolutionSelectorV3,
    XIS_CanvasConfigV3,
    XIS_StringListMergerV3,
]