"""
Label节点模块
提供HTML和Markdown双模式文本编辑功能
"""

from comfy_api.latest import io, ComfyExtension


class XIS_Label(io.ComfyNode):
    """
    Label节点类
    支持HTML和Markdown双模式文本编辑
    """

    @classmethod
    def INPUT_TYPES(cls) -> dict:
        """返回节点的输入类型（legacy兼容性）"""
        return {}  # 无输入参数

    RETURN_TYPES = ()  # 无返回值
    FUNCTION = "execute"  # 节点执行函数
    CATEGORY = "XISER_Nodes/UI_And_Control"  # 节点分类

    @classmethod
    def define_schema(cls):
        """
        Define the v3 schema for the label node.
        Label节点没有输入输出，主要用于显示。
        """
        return io.Schema(
            node_id="XIS_Label",
            display_name="Label",
            category="XISER_Nodes/UI_And_Control",
            inputs=[],  # 无输入
            outputs=[],  # 无输出
        )

    def execute(self) -> None:
        """节点执行函数（legacy兼容性）"""
        pass

    @classmethod
    def execute(cls):
        """
        Execute the label node (v3 version).
        Label节点没有实际执行逻辑。
        """
        return io.NodeOutput(())

    def onNodeCreated(self) -> None:
        """节点创建时的初始化"""
        self.properties = self.properties or {}
        # 初始化HTML数据
        self.properties["htmlData"] = (
            '<div style="font-size: 20px; font-weight: bold;">小贴纸</div>'
            '<div style="font-size: 16px; font-weight: normal;">使用鼠标左键双击打开编辑器</div>'
            '<div style="font-size: 16px; font-weight: normal; color: #B0C4FF;">Double-click with the left mouse button to open the editor</div>'
        )
        self.properties["markdownData"] = (
            "# 小贴纸\n\n"
            "使用鼠标左键双击打开编辑器\n\n"
            "# Label Node\n\n"
            "Double-click with the left mouse button to open the editor"
        )
        # 默认编辑器模式
        self.properties["editorMode"] = "html"
        # 默认节点颜色
        self.color = "#333355"
        # 只有在没有设置节点大小时才设置默认尺寸
        # 避免在复制节点时覆盖已继承的大小
        if "node_size" not in self.properties:
            self.properties["node_size"] = [360, 360]


# 导出节点类映射 - 注释掉以启用V3注册模式


class XISLabelExtension(ComfyExtension):
    async def get_node_list(self):
        return [XIS_Label]


async def comfy_entrypoint():
    return XISLabelExtension()
