"""
Label节点模块
提供HTML和Markdown双模式文本编辑功能
"""


class XIS_Label:
    """
    Label节点类
    支持HTML和Markdown双模式文本编辑
    """

    @classmethod
    def INPUT_TYPES(cls) -> dict:
        """返回节点的输入类型"""
        return {}  # 无输入参数

    RETURN_TYPES = ()  # 无返回值
    FUNCTION = "execute"  # 节点执行函数
    CATEGORY = "XISER_Nodes/UI_And_Control"  # 节点分类

    def execute(self) -> None:
        """节点执行函数"""
        pass

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


# 导出节点类映射
NODE_CLASS_MAPPINGS = {
    "XIS_Label": XIS_Label,
}
