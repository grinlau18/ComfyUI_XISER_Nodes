"""列表处理节点 - V3版本"""

from comfy_api.v0_0_2 import io, ui
from typing import List, Any
import torch

# ============================================================================
# 基础列表处理节点类
# ============================================================================

class BaseFromListGetOneV3(io.ComfyNode):
    """从列表中获取单个元素的基础V3节点"""

    # 子类需要覆盖这些属性
    TYPE: str = ""  # 数据类型，如 "IMAGE", "MASK" 等
    IO_TYPE: Any = None  # io类型，如 io.Image, io.Mask 等

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点架构"""
        if not cls.TYPE or not cls.IO_TYPE:
            raise NotImplementedError("子类必须定义TYPE和IO_TYPE属性")

        return io.Schema(
            node_id=f"XIS_FromListGet1{cls.TYPE}",
            display_name=f"From List Get 1 {cls.TYPE}",
            category="XISER_Nodes/Data_Processing",
            description=f"从{cls.TYPE}列表中获取指定索引的元素",
            inputs=[
                cls.IO_TYPE.Input("list", tooltip=f"输入{cls.TYPE}列表"),
                io.Int.Input("index",
                           default=0,
                           min=-2147483648,
                           tooltip="要获取的索引（支持负数）")
            ],
            outputs=[
                cls.IO_TYPE.Output(display_name=f"selected_{cls.TYPE.lower()}")
            ],
            is_input_list=True  # 替代V1的INPUT_IS_LIST = True
        )

    @classmethod
    def execute(cls, input_list, index) -> io.NodeOutput:
        """
        执行方法

        注意：当is_input_list=True时，
        input_list参数是列表，index参数也是列表
        """
        if not input_list:
            raise ValueError("输入列表不能为空")

        # 获取实际索引（V3中index也是列表）
        actual_index = index % len(input_list)
        selected_item = input_list[actual_index]

        return io.NodeOutput(selected_item)

# ============================================================================
# 具体类型的列表处理节点
# ============================================================================

class XIS_FromListGet1MaskV3(BaseFromListGetOneV3):
    """从掩码列表中获取单个掩码"""
    TYPE = "MASK"
    IO_TYPE = io.Mask

class XIS_FromListGet1ImageV3(BaseFromListGetOneV3):
    """从图像列表中获取单个图像"""
    TYPE = "IMAGE"
    IO_TYPE = io.Image

class XIS_FromListGet1LatentV3(BaseFromListGetOneV3):
    """从潜在表示列表中获取单个潜在表示"""
    TYPE = "LATENT"
    IO_TYPE = io.Latent

class XIS_FromListGet1CondV3(BaseFromListGetOneV3):
    """从条件列表中获取单个条件"""
    TYPE = "CONDITIONING"
    IO_TYPE = io.Conditioning

class XIS_FromListGet1ModelV3(BaseFromListGetOneV3):
    """从模型列表中获取单个模型"""
    TYPE = "MODEL"
    IO_TYPE = io.Model

class XIS_FromListGet1StringV3(BaseFromListGetOneV3):
    """从字符串列表中获取单个字符串"""
    TYPE = "STRING"
    IO_TYPE = io.String

class XIS_FromListGet1IntV3(BaseFromListGetOneV3):
    """从整数列表中获取单个整数"""
    TYPE = "INT"
    IO_TYPE = io.Int

class XIS_FromListGet1FloatV3(BaseFromListGetOneV3):
    """从浮点数列表中获取单个浮点数"""
    TYPE = "FLOAT"
    IO_TYPE = io.Float

# ============================================================================
# 节点列表（用于Extension注册）
# ============================================================================

# 所有V3列表处理节点
V3_NODE_CLASSES = [
    XIS_FromListGet1MaskV3,
    XIS_FromListGet1ImageV3,
    XIS_FromListGet1LatentV3,
    XIS_FromListGet1CondV3,
    XIS_FromListGet1ModelV3,
    XIS_FromListGet1StringV3,
    XIS_FromListGet1IntV3,
    XIS_FromListGet1FloatV3,
]

# 节点ID到类的映射（用于向后兼容或参考）
V3_NODE_MAPPINGS = {
    cls.define_schema().node_id: cls
    for cls in V3_NODE_CLASSES
}

