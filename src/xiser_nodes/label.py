# 小贴纸节点
from typing import Any

print("注册 XIS_Label 节点")

class XIS_Label:
    @classmethod
    def INPUT_TYPES(cls) -> dict:
        return {}  # 无输入参数

    RETURN_TYPES = ()  # 无返回值
    FUNCTION = "execute"  # 节点执行的函数名
    CATEGORY = "XISER_Nodes/UIControl"  # 节点分类

    def execute(self) -> None:
        """空函数，节点无实际功能"""
        pass

    def onNodeCreated(self):
        """初始化节点属性"""
        self.properties = self.properties or {}
        self.properties["textData"] = '<p style="font-size:20px;color:#FFFFFF;">小贴纸</p><p style="font-size:12px;color:#999999;">使用右键菜单编辑文字</p>'
        self.color = "#333355"  # 默认深灰色

# 节点映射
NODE_CLASS_MAPPINGS = {
    "XIS_Label": XIS_Label,
}