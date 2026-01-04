from typing import List, Tuple, Any
import torch

# 动态图像输入节点
class XIS_DynamicImageInputs:
    MAX_IMAGE_COUNT = 20  # 最大支持20个图像输入

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}, "optional": {"image_1": ("IMAGE",)}}

    RETURN_TYPES = ("IMAGE",)
    OUTPUT_IS_LIST = (True,)  # 输出图像列表
    FUNCTION = "process_images"
    CATEGORY = "XISER_Nodes/Image_Processing"

    def process_images(self, **kwargs):
        """
        处理动态图像输入，收集所有连接的图像并输出为列表

        Args:
            **kwargs: 动态生成的图像输入参数

        Returns:
            tuple: 包含图像列表的元组
        """
        images = []

        # 收集所有连接的图像（动态端口，名称格式为image_1, image_2, ...）
        for key, value in kwargs.items():
            if key.startswith("image_") and value is not None:
                # 确保图像是torch.Tensor类型
                if isinstance(value, torch.Tensor):
                    images.append(value)
                else:
                    # 如果输入不是tensor，尝试转换（但通常ComfyUI会处理这个）
                    try:
                        if hasattr(value, '__len__') and len(value) > 0:
                            images.append(value)
                    except:
                        pass

        # 如果没有图像输入，返回空列表
        if not images:
            return ([],)

        return (images,)

# 节点映射
NODE_CLASS_MAPPINGS = {
    "XIS_DynamicImageInputs": XIS_DynamicImageInputs,
}

# 节点显示名称映射（可选）
NODE_DISPLAY_NAME_MAPPINGS = {
    "XIS_DynamicImageInputs": "XIS Dynamic Image Inputs",
}