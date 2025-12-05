# src/xiser_nodes/logic.py
from typing import Optional, Tuple, Union
from .utils import logger
from comfy_api.latest import io, ComfyExtension

# 判断是否有信号接入，否则输出默认值
class XIS_IsThereAnyData(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        """
        Define the v3 schema for the IsThereAnyData node.
        """
        return io.Schema(
            node_id="XIS_IsThereAnyData",
            display_name="Is There Any Data",
            category="XISER_Nodes/Logic",
            inputs=[
                io.Int.Input("default_int", default=0, min=-2147483648, max=2147483647),
                io.Float.Input("default_float", default=0.0, min=-1e10, max=1e10),
                io.Boolean.Input("default_boolean", default=False),
                io.Int.Input("int_input", optional=True),
                io.Float.Input("float_input", optional=True),
                io.Boolean.Input("boolean_input", optional=True),
            ],
            outputs=[
                io.Int.Output("int_output", display_name="int_output"),
                io.Float.Output("float_output", display_name="float_output"),
                io.Boolean.Output("boolean_output", display_name="boolean_output"),
            ],
        )

    @classmethod
    def execute(cls, default_int, default_float, default_boolean,
                int_input=None, float_input=None, boolean_input=None):
        """
        Execute the IsThereAnyData node (v3 version).
        """
        int_output = int_input if int_input is not None else default_int
        float_output = float_input if float_input is not None else default_float
        boolean_output = boolean_input if boolean_input is not None else default_boolean
        return io.NodeOutput(int_output, float_output, boolean_output)

# 判断数据是否为空
class XIS_IfDataIsNone(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        """
        Define the v3 schema for the IfDataIsNone node.
        """
        return io.Schema(
            node_id="XIS_IfDataIsNone",
            display_name="If Data Is None",
            category="XISER_Nodes/Logic",
            inputs=[
                io.Combo.Input("data_type", default="STRING", options=["INT", "FLOAT", "BOOLEAN", "STRING"]),
                io.String.Input("default_value", default="0"),
                io.AnyType.Input("signal", optional=True),
            ],
            outputs=[
                io.Boolean.Output("is_not_null", display_name="is_not_null"),
                io.Int.Output("int_output", display_name="int_output"),
                io.Float.Output("float_output", display_name="float_output"),
                io.Boolean.Output("boolean_output", display_name="boolean_output"),
                io.String.Output("string_output", display_name="string_output"),
            ],
        )

    @classmethod
    def execute(cls, data_type, default_value, signal=None):
        """
        Execute the IfDataIsNone node (v3 version).
        """
        is_not_null = signal is not None
        value_to_convert = signal if is_not_null else default_value

        # 如果是列表，逐项转换；否则按单一值处理
        if isinstance(value_to_convert, (list, tuple)):
            result = [cls._convert_single_item(item, data_type) for item in value_to_convert]
        else:
            result = cls._convert_single_item(value_to_convert, data_type)

        # 根据 data_type 返回对应类型的输出，其他端口返回默认值
        int_output = result if data_type == "INT" else (0 if not isinstance(result, list) else [0] * len(result))
        float_output = result if data_type == "FLOAT" else (0.0 if not isinstance(result, list) else [0.0] * len(result))
        boolean_output = result if data_type == "BOOLEAN" else (False if not isinstance(result, list) else [False] * len(result))
        string_output = result if data_type == "STRING" else ("" if not isinstance(result, list) else [""] * len(result))

        return io.NodeOutput(is_not_null, int_output, float_output, boolean_output, string_output)

    @classmethod
    def _convert_single_item(cls, value, data_type):
        if data_type == "INT":
            return cls._to_int(value)
        elif data_type == "FLOAT":
            return cls._to_float(value)
        elif data_type == "BOOLEAN":
            return cls._to_boolean(value)
        elif data_type == "STRING":
            return cls._to_string(value)
        return value

    @classmethod
    def _to_int(cls, value):
        try:
            return int(float(value))
        except (ValueError, TypeError):
            return 0

    @classmethod
    def _to_float(cls, value):
        try:
            return float(value)
        except (ValueError, TypeError):
            return 0.0

    @classmethod
    def _to_boolean(cls, value):
        if isinstance(value, bool):
            return value
        try:
            return str(value).lower() in ("true", "1")
        except:
            return False

    @classmethod
    def _to_string(cls, value):
        return str(value)


# 特定类型的开关节点（提供更好的类型安全）
class XIS_ImageSwitch(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        """
        Define the v3 schema for the ImageSwitch node.
        """
        return io.Schema(
            node_id="XIS_ImageSwitch",
            display_name="Image Switch",
            category="XISER_Nodes/Logic",
            inputs=[
                io.Boolean.Input("enable", default=True),
                io.Image.Input("image_input", optional=True),
            ],
            outputs=[
                io.Image.Output("image_output", display_name="image_output"),
            ],
        )

    @classmethod
    def execute(cls, enable, image_input=None):
        """
        Execute the ImageSwitch node (v3 version).
        """
        image_output = image_input if enable else None
        return io.NodeOutput(image_output)

class XIS_MaskSwitch(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        """
        Define the v3 schema for the MaskSwitch node.
        """
        return io.Schema(
            node_id="XIS_MaskSwitch",
            display_name="Mask Switch",
            category="XISER_Nodes/Logic",
            inputs=[
                io.Boolean.Input("enable", default=True),
                io.Mask.Input("mask_input", optional=True),
            ],
            outputs=[
                io.Mask.Output("mask_output", display_name="mask_output"),
            ],
        )

    @classmethod
    def execute(cls, enable, mask_input=None):
        """
        Execute the MaskSwitch node (v3 version).
        """
        mask_output = mask_input if enable else None
        return io.NodeOutput(mask_output)

class XIS_StringSwitch(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        """
        Define the v3 schema for the StringSwitch node.
        """
        return io.Schema(
            node_id="XIS_StringSwitch",
            display_name="String Switch",
            category="XISER_Nodes/Logic",
            inputs=[
                io.Boolean.Input("enable", default=True),
                io.String.Input("string_input", optional=True),
            ],
            outputs=[
                io.String.Output("string_output", display_name="string_output"),
            ],
        )

    @classmethod
    def execute(cls, enable, string_input=None):
        """
        Execute the StringSwitch node (v3 version).
        """
        string_output = string_input if enable else None
        return io.NodeOutput(string_output)

class XIS_IntSwitch(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        """
        Define the v3 schema for the IntSwitch node.
        """
        return io.Schema(
            node_id="XIS_IntSwitch",
            display_name="Int Switch",
            category="XISER_Nodes/Logic",
            inputs=[
                io.Boolean.Input("enable", default=True),
                io.Int.Input("int_input", optional=True),
            ],
            outputs=[
                io.Int.Output("int_output", display_name="int_output"),
            ],
        )

    @classmethod
    def execute(cls, enable, int_input=None):
        """
        Execute the IntSwitch node (v3 version).
        """
        int_output = int_input if enable else None
        return io.NodeOutput(int_output)

class XIS_FloatSwitch(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        """
        Define the v3 schema for the FloatSwitch node.
        """
        return io.Schema(
            node_id="XIS_FloatSwitch",
            display_name="Float Switch",
            category="XISER_Nodes/Logic",
            inputs=[
                io.Boolean.Input("enable", default=True),
                io.Float.Input("float_input", optional=True),
            ],
            outputs=[
                io.Float.Output("float_output", display_name="float_output"),
            ],
        )

    @classmethod
    def execute(cls, enable, float_input=None):
        """
        Execute the FloatSwitch node (v3 version).
        """
        float_output = float_input if enable else None
        return io.NodeOutput(float_output)

class XIS_BooleanSwitch(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        """
        Define the v3 schema for the BooleanSwitch node.
        """
        return io.Schema(
            node_id="XIS_BooleanSwitch",
            display_name="Boolean Switch",
            category="XISER_Nodes/Logic",
            inputs=[
                io.Boolean.Input("enable", default=True),
                io.Boolean.Input("boolean_input", optional=True),
            ],
            outputs=[
                io.Boolean.Output("boolean_output", display_name="boolean_output"),
            ],
        )

    @classmethod
    def execute(cls, enable, boolean_input=None):
        """
        Execute the BooleanSwitch node (v3 version).
        """
        boolean_output = boolean_input if enable else None
        return io.NodeOutput(boolean_output)



class XISLogicExtension(ComfyExtension):
    async def get_node_list(self):
        return [
            XIS_IsThereAnyData,
            XIS_IfDataIsNone,
            XIS_ImageSwitch,
            XIS_MaskSwitch,
            XIS_StringSwitch,
            XIS_IntSwitch,
            XIS_FloatSwitch,
            XIS_BooleanSwitch,
        ]


async def comfy_entrypoint():
    return XISLogicExtension()