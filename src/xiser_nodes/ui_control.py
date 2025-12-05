from typing import List, Tuple, Dict, Any
from .utils import logger
from comfy_api.latest import io, ComfyExtension
import hashlib

# 自定义类型定义
CanvasConfig = io.Custom("XIS_CANVAS_CONFIG")


# 输入多个提示词并通过开关控制
class XIS_PromptsWithSwitches(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        """Define the v3 schema for the PromptsWithSwitches node."""
        inputs = []
        for i in range(1, 6):
            inputs.append(io.String.Input(f"prompt_{i}", default="", multiline=True, optional=True))
            inputs.append(io.Boolean.Input(f"enable_{i}", default=True, optional=True))

        return io.Schema(
            node_id="XIS_PromptsWithSwitches",
            display_name="Prompts With Switches",
            category="XISER_Nodes/UI_And_Control",
            inputs=inputs,
            outputs=[
                io.String.Output("prompts", display_name="prompts", is_output_list=True),
                io.Boolean.Output("has_prompts", display_name="has_prompts"),
            ],
        )

    @classmethod
    def execute(cls, **kwargs):
        """Execute the PromptsWithSwitches node."""
        prompts = []
        for i in range(1, 6):
            prompt_key = f"prompt_{i}"
            enable_key = f"enable_{i}"
            prompt = kwargs.get(prompt_key, "")
            enable = kwargs.get(enable_key, True)
            if enable and prompt.strip():
                prompts.append(prompt)
        if not prompts:
            return io.NodeOutput(["No prompts to display."], False)
        return io.NodeOutput(prompts, True)

# 输入浮点数并通过滑块控制
class XIS_Float_Slider(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        """Define the v3 schema for the Float Slider node."""
        return io.Schema(
            node_id="XIS_Float_Slider",
            display_name="Float Slider",
            category="XISER_Nodes/UI_And_Control",
            inputs=[
                io.Float.Input("value", default=0.0, min=0.0, max=1.0, step=0.01),
            ],
            outputs=[
                io.Float.Output("value_output", display_name="value_output"),
            ],
        )

    @classmethod
    def execute(cls, **kwargs):
        """Execute the Float Slider node (v3 version)."""
        value = kwargs.get("value", 0.0)
        return io.NodeOutput(value)

# 输入整数并通过滑块控制
class XIS_INT_Slider(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        """Define the v3 schema for the INT Slider node."""
        return io.Schema(
            node_id="XIS_INT_Slider",
            display_name="INT Slider",
            category="XISER_Nodes/UI_And_Control",
            inputs=[
                io.Int.Input("value", default=0, min=0, max=100, step=1),
            ],
            outputs=[
                io.Int.Output("value_output", display_name="value_output"),
            ],
        )

    @classmethod
    def execute(cls, **kwargs):
        """Execute the INT Slider node (v3 version)."""
        value = kwargs.get("value", 0)
        return io.NodeOutput(value)
    


# IPA参数设置节点
class XIS_IPAStyleSettings(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        """Define the v3 schema for the IPA Style Settings node."""
        options = [
            "linear", "ease in", "ease out", "ease in-out", "reverse in-out", "weak input", "weak output",
            "weak middle", "strong middle", "style transfer", "composition", "strong style transfer",
            "style and composition", "style transfer precise", "composition precise"
        ]

        return io.Schema(
            node_id="XIS_IPAStyleSettings",
            display_name="IPA Style Settings",
            category="XISER_Nodes/UI_And_Control",
            inputs=[
                io.Combo.Input("option", default="linear", options=options),
                io.Float.Input("slider", default=0.5, min=0.0, max=1.0, step=0.01),
            ],
            outputs=[
                io.String.Output("option_output", display_name="option_output"),
                io.Float.Output("slider_output", display_name="slider_output"),
            ],
        )

    @classmethod
    def execute(cls, **kwargs):
        """Execute the IPA Style Settings node."""
        option = kwargs.get("option", "linear")
        slider = kwargs.get("slider", 0.5)
        return io.NodeOutput(option, slider)

# 提示词处理器
class XIS_PromptProcessor(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        """Define the v3 schema for the Prompt Processor node."""
        return io.Schema(
            node_id="XIS_PromptProcessor",
            display_name="Prompt Processor",
            category="XISER_Nodes/UI_And_Control",
            inputs=[
                io.String.Input("positive_prompt1", default="", multiline=True),
                io.String.Input("positive_prompt2", default=""),
                io.String.Input("negative_prompt", default="", multiline=True),
                io.Boolean.Input("merge_positive", default=True),
            ],
            outputs=[
                io.String.Output("combined_prompt", display_name="combined_prompt"),
                io.String.Output("negative_prompt_output", display_name="negative_prompt_output"),
                io.Boolean.Output("merge_status", display_name="merge_status"),
            ],
        )

    @classmethod
    def execute(cls, **kwargs):
        """Execute the Prompt Processor node."""
        # 从 kwargs 中获取参数
        positive_prompt1 = kwargs.get("positive_prompt1", "")
        positive_prompt2 = kwargs.get("positive_prompt2", "")
        negative_prompt = kwargs.get("negative_prompt", "")
        merge_positive = kwargs.get("merge_positive", True)

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
        return io.NodeOutput(combined_prompt, negative_prompt, merge_positive)

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # 根据所有输入参数生成唯一的哈希值
        import hashlib
        positive_prompt1 = kwargs.get("positive_prompt1", "")
        positive_prompt2 = kwargs.get("positive_prompt2", "")
        negative_prompt = kwargs.get("negative_prompt", "")
        merge_positive = kwargs.get("merge_positive", True)

        input_hash = hashlib.sha256(
            f"{positive_prompt1}_{positive_prompt2}_{negative_prompt}_{merge_positive}".encode()
        ).hexdigest()
        return input_hash


class XIS_MultiPromptSwitch(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        """Define the v3 schema for the MultiPromptSwitch node."""
        inputs = [
            io.String.Input("positive_prompt1", default="", multiline=True),
            io.String.Input("positive_prompt2", default=""),
            io.Boolean.Input("enable_prompt2", default=True),
            io.String.Input("positive_prompt3", default=""),
            io.Boolean.Input("enable_prompt3", default=True),
            io.String.Input("positive_prompt4", default=""),
            io.Boolean.Input("enable_prompt4", default=True),
            io.String.Input("positive_prompt5", default=""),
            io.Boolean.Input("enable_prompt5", default=True),
            io.String.Input("negative_prompt1", default="", multiline=True),
            io.String.Input("negative_prompt2", default=""),
            io.Boolean.Input("enable_neg_prompt2", default=True),
            io.String.Input("negative_prompt3", default=""),
            io.Boolean.Input("enable_neg_prompt3", default=True),
            io.String.Input("negative_prompt4", default=""),
            io.Boolean.Input("enable_neg_prompt4", default=True),
            io.String.Input("negative_prompt5", default=""),
            io.Boolean.Input("enable_neg_prompt5", default=True),
        ]

        return io.Schema(
            node_id="XIS_MultiPromptSwitch",
            display_name="Multi Prompt Switch",
            category="XISER_Nodes/UI_And_Control",
            inputs=inputs,
            outputs=[
                io.String.Output("combined_positive_prompt", display_name="combined_positive_prompt"),
                io.String.Output("combined_negative_prompt", display_name="combined_negative_prompt"),
            ],
        )

    @classmethod
    def execute(cls, **kwargs):
        """Execute the MultiPromptSwitch node."""
        # 从 kwargs 中获取所有参数
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
    def IS_CHANGED(cls, **kwargs):
        # 根据所有输入参数生成唯一的哈希值
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



# 处理分辨率选择
class XIS_ResolutionSelector(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        """Define the v3 schema for the Resolution Selector node."""
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
            inputs=[
                io.Combo.Input("resolution", default="512x512 (1:1)", options=resolution_options),
                io.Boolean.Input("use_custom_resolution", default=False),
                io.Int.Input("custom_width", default=512, min=1, max=8192, step=1),
                io.Int.Input("custom_height", default=512, min=1, max=8192, step=1),
                io.Boolean.Input("swap_orientation", default=False),
            ],
            outputs=[
                io.Int.Output("width", display_name="width"),
                io.Int.Output("height", display_name="height"),
            ],
        )

    @classmethod
    def execute(cls, **kwargs):
        """Execute the Resolution Selector node."""
        # 从 kwargs 中获取参数
        resolution = kwargs.get("resolution", "512x512 (1:1)")
        use_custom_resolution = kwargs.get("use_custom_resolution", False)
        custom_width = kwargs.get("custom_width", 512)
        custom_height = kwargs.get("custom_height", 512)
        swap_orientation = kwargs.get("swap_orientation", False)

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
    def IS_CHANGED(cls, **kwargs):
        # 根据所有输入参数生成唯一的哈希值
        resolution = kwargs.get("resolution", "512x512 (1:1)")
        use_custom_resolution = kwargs.get("use_custom_resolution", False)
        custom_width = kwargs.get("custom_width", 512)
        custom_height = kwargs.get("custom_height", 512)
        swap_orientation = kwargs.get("swap_orientation", False)

        input_hash = hashlib.sha256(
            f"{resolution}_{use_custom_resolution}_{custom_width}_{custom_height}_{swap_orientation}".encode()
        ).hexdigest()
        return input_hash

# 画布配置节点 - 输出 CANVAS_CONFIG 类型
class XIS_CanvasConfig(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        """Define the v3 schema for the Canvas Config node."""
        return io.Schema(
            node_id="XIS_CanvasConfig",
            display_name="Canvas Config",
            category="XISER_Nodes/UI_And_Control",
            inputs=[
                io.Int.Input("board_width", default=1024, min=256, max=8192, step=16),
                io.Int.Input("board_height", default=1024, min=256, max=8192, step=16),
                io.Combo.Input("canvas_color", default="black", options=["black", "white", "transparent"]),
                io.Combo.Input("auto_size", default="off", options=["off", "on"]),
            ],
            outputs=[
                CanvasConfig.Output("canvas_config", display_name="canvas_config"),
            ],
        )

    @classmethod
    def execute(cls, **kwargs):
        """Execute the Canvas Config node."""
        board_width = kwargs.get("board_width", 1024)
        board_height = kwargs.get("board_height", 1024)
        canvas_color = kwargs.get("canvas_color", "black")
        auto_size = kwargs.get("auto_size", "off")

        config = {
            "board_width": board_width,
            "board_height": board_height,
            "canvas_color": canvas_color,
            "auto_size": auto_size
        }
        logger.info(f"Canvas config created: {config}")
        return io.NodeOutput(config)

# 节点映射 - 注释掉以启用V3注册模式


class XISUIControlExtension(ComfyExtension):
    async def get_node_list(self):
        return [
            XIS_PromptsWithSwitches,
            XIS_Float_Slider,
            XIS_INT_Slider,
            XIS_ResolutionSelector,
            XIS_PromptProcessor,
            XIS_MultiPromptSwitch,
            XIS_IPAStyleSettings,
            XIS_CanvasConfig,
        ]


async def comfy_entrypoint():
    return XISUIControlExtension()