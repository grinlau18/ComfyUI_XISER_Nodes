"""动态图像输入节点 - V3版本"""

from comfy_api.v0_0_2 import io, ui
from typing import Dict, Any, List
import torch

class XIS_DynamicImageInputsV3(io.ComfyNode):
    """动态图像输入节点 - V3版本"""

    MAX_IMAGE_COUNT = 20  # 最大支持20个图像输入

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点架构"""
        return io.Schema(
            node_id="XIS_DynamicImageInputs",
            display_name="Dynamic Image Inputs",
            category="XISER_Nodes/Image_Processing",
            description="收集所有连接的图像并输出为列表，支持动态输入端口",
            inputs=[
                # 动态输入：第一个图像输入
                io.Image.Input("image_1",
                             optional=True,
                             tooltip="图像输入 1（可选）")
            ],
            outputs=[
                io.Image.Output(display_name="image_list",
                              is_output_list=True)  # 替代V1的OUTPUT_IS_LIST = (True,)
            ]
        )

    @classmethod
    def execute(cls, **kwargs) -> io.NodeOutput:
        """
        处理动态图像输入，收集所有连接的图像并输出为列表

        Args:
            **kwargs: 动态生成的图像输入参数

        Returns:
            io.NodeOutput: 包含图像列表的输出
        """
        images = []

        # 收集所有连接的图像（动态端口，名称格式为image_1, image_2, ...）
        for key, value in kwargs.items():
            if key.startswith("image_") and value is not None:
                # 确保图像是torch.Tensor类型
                if isinstance(value, torch.Tensor):
                    images.append(value)
                else:
                    # 如果输入不是tensor，尝试转换
                    try:
                        if hasattr(value, '__len__') and len(value) > 0:
                            images.append(value)
                    except:
                        pass

        # 如果没有图像输入，返回空列表
        if not images:
            return io.NodeOutput([])

        return io.NodeOutput(images)


# ============================================================================
# 节点列表（用于Extension注册）
# ============================================================================

# 所有V3动态图像输入节点
V3_NODE_CLASSES = [
    XIS_DynamicImageInputsV3,
]

# 节点ID到类的映射
V3_NODE_MAPPINGS = {
    cls.define_schema().node_id: cls
    for cls in V3_NODE_CLASSES
}

