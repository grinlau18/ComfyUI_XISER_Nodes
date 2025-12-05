# src/xiser_nodes/list_processing.py
from .utils import logger
from comfy_api.latest import io, ComfyExtension
import builtins

# Base class for all "FromListGet1" nodes
class XIS_FromListGet1Base(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=cls.__name__,
            display_name=cls.__name__.replace("XIS_", "").replace("Get1", "Get "),
            category="XISER_Nodes/Data_Processing",
            inputs=[
                io.AnyType.Input("list"),
                io.Int.Input("index", default=0, min=-2147483648),
            ],
            outputs=[
                io.AnyType.Output("output", display_name="output"),
            ],
        )

    @classmethod
    def execute(cls, list, index):
        # 解包可能的 NodeOutput/tuple 形式
        if hasattr(list, "outputs") and isinstance(getattr(list, "outputs"), tuple):
            list = list.outputs[0]
        # 兼容自动拆分场景：收到单元素列表，且元素本身才是真正的列表
        if isinstance(list, (builtins.list, builtins.tuple)) and len(list) == 1 and isinstance(list[0], (builtins.list, builtins.tuple)):
            list = list[0]
        if isinstance(list, (builtins.list, builtins.tuple)) and len(list) == 1:
            # 单元素但不是嵌套列表，直接取出
            list = list[0]
        if not isinstance(list, (builtins.list, builtins.tuple)):
            raise TypeError(f"Input list must be list/tuple, got {type(list)}")
        if len(list) == 0:
            raise ValueError("Input list cannot be empty")
        # 兼容可能传入的 list/tuple 型索引（自动映射时可能出现）。如果 index 非法，则回退为 0。
        try:
            if isinstance(index, (builtins.list, builtins.tuple)):
                index = index[0] if len(index) > 0 else 0
        except TypeError:
            index = 0
        # 尝试转为整数
        try:
            index = int(index)
        except Exception:
            raise TypeError(f"Index must be an int, got {type(index)}")

        index = index % len(list)
        item = list[index]
        # 处理可能出现的单元素嵌套列表/元组（某些节点会把单张 IMAGE 再包一层）
        if isinstance(item, (builtins.list, builtins.tuple)) and len(item) == 1:
            item = item[0]
        # 若仍是列表/元组，给出明确错误，避免下游收到非张量
        if isinstance(item, (builtins.list, builtins.tuple)):
            raise TypeError(f"Selected item is still a list/tuple (len={len(item)}), expected a single element.")
        return io.NodeOutput(item)

# Individual node classes (pure v3)
class XIS_FromListGet1Mask(XIS_FromListGet1Base):
    pass

class XIS_FromListGet1Image(XIS_FromListGet1Base):
    pass

class XIS_FromListGet1Latent(XIS_FromListGet1Base):
    pass

class XIS_FromListGet1Cond(XIS_FromListGet1Base):
    pass

class XIS_FromListGet1Model(XIS_FromListGet1Base):
    pass

class XIS_FromListGet1Color(XIS_FromListGet1Base):
    pass

class XIS_FromListGet1String(XIS_FromListGet1Base):
    pass

class XIS_FromListGet1Int(XIS_FromListGet1Base):
    pass

class XIS_FromListGet1Float(XIS_FromListGet1Base):
    pass


class XISListProcessingExtension(ComfyExtension):
    async def get_node_list(self):
        return [
            XIS_FromListGet1Mask,
            XIS_FromListGet1Image,
            XIS_FromListGet1Latent,
            XIS_FromListGet1Cond,
            XIS_FromListGet1Model,
            XIS_FromListGet1Color,
            XIS_FromListGet1String,
            XIS_FromListGet1Int,
            XIS_FromListGet1Float,
        ]

async def comfy_entrypoint():
    return XISListProcessingExtension()
