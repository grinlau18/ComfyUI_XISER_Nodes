"""逻辑控制节点 - V3版本"""

from comfy_api.v0_0_2 import io
from typing import Optional, Tuple, Union, List
from .utils import logger

# ============================================================================
# 判断是否有信号接入，否则输出默认值
# ============================================================================

class XIS_IsThereAnyDataV3(io.ComfyNode):
    """
    判断是否有信号接入，否则输出默认值
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点架构"""
        return io.Schema(
            node_id="XIS_IsThereAnyData",
            display_name="Is There Any Data",
            category="XISER_Nodes/Logic",
            description="判断是否有信号接入，否则输出默认值",
            inputs=[
                io.Int.Input("default_int",
                           default=0,
                           min=-2147483648,
                           max=2147483647,
                           step=1,
                           tooltip="默认整数值"),
                io.Float.Input("default_float",
                             default=0.0,
                             min=-1e10,
                             max=1e10,
                             step=0.01,
                             tooltip="默认浮点数值"),
                io.Boolean.Input("default_boolean",
                               default=False,
                               tooltip="默认布尔值"),
                io.Int.Input("int_input",
                           optional=True,
                           tooltip="可选的整数输入"),
                io.Float.Input("float_input",
                             optional=True,
                             tooltip="可选的浮点数输入"),
                io.Boolean.Input("boolean_input",
                               optional=True,
                               tooltip="可选的布尔值输入")
            ],
            outputs=[
                io.Int.Output(display_name="int_output"),
                io.Float.Output(display_name="float_output"),
                io.Boolean.Output(display_name="boolean_output")
            ]
        )

    @classmethod
    def execute(cls, default_int, default_float, default_boolean,
                int_input=None, float_input=None, boolean_input=None) -> io.NodeOutput:
        """
        执行方法：选择输入值或默认值
        """
        int_output = int_input if int_input is not None else default_int
        float_output = float_input if float_input is not None else default_float
        boolean_output = boolean_input if boolean_input is not None else default_boolean

        return io.NodeOutput(int_output, float_output, boolean_output)


# ============================================================================
# 判断数据是否为空
# ============================================================================

class XIS_IfDataIsNoneV3(io.ComfyNode):
    """
    判断数据是否为空，支持多种数据类型转换
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点架构"""
        return io.Schema(
            node_id="XIS_IfDataIsNone",
            display_name="If Data Is None",
            category="XISER_Nodes/Logic",
            description="判断数据是否为空，支持多种数据类型转换",
            inputs=[
                io.Combo.Input("data_type",
                             options=["INT", "FLOAT", "BOOLEAN", "STRING"],
                             default="STRING",
                             tooltip="数据类型"),
                io.String.Input("default_value",
                              default="0",
                              tooltip="默认值"),
                io.AnyType.Input("signal",
                                 optional=True,
                                 tooltip="可选的信号输入")
            ],
            outputs=[
                io.Boolean.Output(display_name="is_not_null"),
                io.Int.Output(display_name="int_output"),
                io.Float.Output(display_name="float_output"),
                io.Boolean.Output(display_name="boolean_output"),
                io.String.Output(display_name="string_output")
            ]
        )

    @classmethod
    def execute(cls, data_type, default_value, signal=None) -> io.NodeOutput:
        """
        执行方法：检查信号并转换为指定类型
        """
        is_not_null = signal is not None
        value_to_convert = signal if is_not_null else default_value

        # 如果是列表，逐项转换；否则按单一值处理
        if isinstance(value_to_convert, (list, tuple)):
            result = [cls.convert_single_item(item, data_type) for item in value_to_convert]
        else:
            result = cls.convert_single_item(value_to_convert, data_type)

        # 根据 data_type 返回对应类型的输出，其他端口返回默认值
        if data_type == "INT":
            int_output = result
            float_output = 0.0 if not isinstance(result, list) else [0.0] * len(result)
            boolean_output = False if not isinstance(result, list) else [False] * len(result)
            string_output = "" if not isinstance(result, list) else [""] * len(result)
        elif data_type == "FLOAT":
            int_output = 0 if not isinstance(result, list) else [0] * len(result)
            float_output = result
            boolean_output = False if not isinstance(result, list) else [False] * len(result)
            string_output = "" if not isinstance(result, list) else [""] * len(result)
        elif data_type == "BOOLEAN":
            int_output = 0 if not isinstance(result, list) else [0] * len(result)
            float_output = 0.0 if not isinstance(result, list) else [0.0] * len(result)
            boolean_output = result
            string_output = "" if not isinstance(result, list) else [""] * len(result)
        else:  # STRING
            int_output = 0 if not isinstance(result, list) else [0] * len(result)
            float_output = 0.0 if not isinstance(result, list) else [0.0] * len(result)
            boolean_output = False if not isinstance(result, list) else [False] * len(result)
            string_output = result

        # 返回NodeOutput
        return io.NodeOutput(
            is_not_null,
            int_output,
            float_output,
            boolean_output,
            string_output
        )


    @classmethod
    def convert_single_item(cls, value, data_type):
        """转换单个值为指定类型"""
        if data_type == "INT":
            return cls.to_int(value)
        elif data_type == "FLOAT":
            return cls.to_float(value)
        elif data_type == "BOOLEAN":
            return cls.to_boolean(value)
        elif data_type == "STRING":
            return cls.to_string(value)
        return value

    @classmethod
    def to_int(cls, value):
        """转换为整数"""
        try:
            return int(float(value))
        except (ValueError, TypeError):
            return 0

    @classmethod
    def to_float(cls, value):
        """转换为浮点数"""
        try:
            return float(value)
        except (ValueError, TypeError):
            return 0.0

    @classmethod
    def to_boolean(cls, value):
        """转换为布尔值"""
        if isinstance(value, bool):
            return value
        try:
            return str(value).lower() in ("true", "1")
        except:
            return False

    @classmethod
    def to_string(cls, value):
        """转换为字符串"""
        return str(value)


# ============================================================================
# 特定类型的开关节点
# ============================================================================

class XIS_ImageSwitchV3(io.ComfyNode):
    """
    图像开关节点
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点架构"""
        return io.Schema(
            node_id="XIS_ImageSwitch",
            display_name="Image Switch",
            category="XISER_Nodes/Logic",
            description="图像开关节点",
            inputs=[
                io.Boolean.Input("enable",
                               default=True,
                               tooltip="启用开关"),
                io.Image.Input("image_input",
                             optional=True,
                             tooltip="可选的图像输入")
            ],
            outputs=[
                io.Image.Output(display_name="image_output")
            ]
        )

    @classmethod
    def execute(cls, enable, image_input=None) -> io.NodeOutput:
        """
        执行方法：根据开关状态返回图像或None
        """
        if enable:
            return io.NodeOutput(image_input)
        else:
            return io.NodeOutput(None)


class XIS_MaskSwitchV3(io.ComfyNode):
    """
    蒙版开关节点
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点架构"""
        return io.Schema(
            node_id="XIS_MaskSwitch",
            display_name="Mask Switch",
            category="XISER_Nodes/Logic",
            description="蒙版开关节点",
            inputs=[
                io.Boolean.Input("enable",
                               default=True,
                               tooltip="启用开关"),
                io.Mask.Input("mask_input",
                            optional=True,
                            tooltip="可选的蒙版输入")
            ],
            outputs=[
                io.Mask.Output(display_name="mask_output")
            ]
        )

    @classmethod
    def execute(cls, enable, mask_input=None) -> io.NodeOutput:
        """
        执行方法：根据开关状态返回蒙版或None
        """
        if enable:
            return io.NodeOutput(mask_input)
        else:
            return io.NodeOutput(None)


class XIS_StringSwitchV3(io.ComfyNode):
    """
    字符串开关节点
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点架构"""
        return io.Schema(
            node_id="XIS_StringSwitch",
            display_name="String Switch",
            category="XISER_Nodes/Logic",
            description="字符串开关节点",
            inputs=[
                io.Boolean.Input("enable",
                               default=True,
                               tooltip="启用开关"),
                io.String.Input("string_input",
                              optional=True,
                              tooltip="可选的字符串输入")
            ],
            outputs=[
                io.String.Output(display_name="string_output")
            ]
        )

    @classmethod
    def execute(cls, enable, string_input=None) -> io.NodeOutput:
        """
        执行方法：根据开关状态返回字符串或None
        """
        if enable:
            return io.NodeOutput(string_input)
        else:
            return io.NodeOutput(None)


class XIS_IntSwitchV3(io.ComfyNode):
    """
    整数开关节点
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点架构"""
        return io.Schema(
            node_id="XIS_IntSwitch",
            display_name="Int Switch",
            category="XISER_Nodes/Logic",
            description="整数开关节点",
            inputs=[
                io.Boolean.Input("enable",
                               default=True,
                               tooltip="启用开关"),
                io.Int.Input("int_input",
                           optional=True,
                           tooltip="可选的整数输入")
            ],
            outputs=[
                io.Int.Output(display_name="int_output")
            ]
        )

    @classmethod
    def execute(cls, enable, int_input=None) -> io.NodeOutput:
        """
        执行方法：根据开关状态返回整数或None
        """
        if enable:
            return io.NodeOutput(int_input)
        else:
            return io.NodeOutput(None)


class XIS_FloatSwitchV3(io.ComfyNode):
    """
    浮点数开关节点
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点架构"""
        return io.Schema(
            node_id="XIS_FloatSwitch",
            display_name="Float Switch",
            category="XISER_Nodes/Logic",
            description="浮点数开关节点",
            inputs=[
                io.Boolean.Input("enable",
                               default=True,
                               tooltip="启用开关"),
                io.Float.Input("float_input",
                             optional=True,
                             tooltip="可选的浮点数输入")
            ],
            outputs=[
                io.Float.Output(display_name="float_output")
            ]
        )

    @classmethod
    def execute(cls, enable, float_input=None) -> io.NodeOutput:
        """
        执行方法：根据开关状态返回浮点数或None
        """
        if enable:
            return io.NodeOutput(float_input)
        else:
            return io.NodeOutput(None)


class XIS_BooleanSwitchV3(io.ComfyNode):
    """
    布尔值开关节点
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点架构"""
        return io.Schema(
            node_id="XIS_BooleanSwitch",
            display_name="Boolean Switch",
            category="XISER_Nodes/Logic",
            description="布尔值开关节点",
            inputs=[
                io.Boolean.Input("enable",
                               default=True,
                               tooltip="启用开关"),
                io.Boolean.Input("boolean_input",
                               optional=True,
                               tooltip="可选的布尔值输入")
            ],
            outputs=[
                io.Boolean.Output(display_name="boolean_output")
            ]
        )

    @classmethod
    def execute(cls, enable, boolean_input=None) -> io.NodeOutput:
        """
        执行方法：根据开关状态返回布尔值或None
        """
        if enable:
            return io.NodeOutput(boolean_input)
        else:
            return io.NodeOutput(None)


# ============================================================================
# 节点导出
# ============================================================================

V3_NODE_CLASSES = [
    XIS_IsThereAnyDataV3,
    XIS_IfDataIsNoneV3,
    XIS_ImageSwitchV3,
    XIS_MaskSwitchV3,
    XIS_StringSwitchV3,
    XIS_IntSwitchV3,
    XIS_FloatSwitchV3,
    XIS_BooleanSwitchV3,
]