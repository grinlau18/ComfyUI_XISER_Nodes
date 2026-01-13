"""
Label节点模块 - V3版本
提供HTML和Markdown双模式文本编辑功能
"""

from comfy_api.v0_0_2 import io

class XIS_LabelV3(io.ComfyNode):
    """
    Label节点类
    支持HTML和Markdown双模式文本编辑
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点架构"""
        return io.Schema(
            node_id="XIS_Label",
            display_name="Label",
            category="XISER_Nodes/UI_And_Control",
            description="支持HTML和Markdown双模式文本编辑的标签节点。",
            inputs=[],  # 无输入参数
            outputs=[],  # 无返回值
            is_output_node=False
        )

    @classmethod
    def execute(cls) -> io.NodeOutput:
        """节点执行函数"""
        # 这是一个无输出的节点，主要用于UI显示
        return io.NodeOutput()


# V3节点导出
V3_NODE_CLASSES = [XIS_LabelV3]