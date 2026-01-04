"""画板蒙版处理节点 - V3版本"""

from comfy_api.v0_0_2 import io, ui
import torch

MAX_LAYER_COUNT = 50


class XIS_CanvasMaskProcessorV3(io.ComfyNode):
    """多蒙版混合节点，支持最多 50 张蒙版。"""

    DEBUG = False  # 调试模式开关

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点架构"""
        # 创建动态可选输入
        optional_inputs = []
        for i in range(1, MAX_LAYER_COUNT + 1):
            optional_inputs.append(
                io.Boolean.Input(f"Layer_Mask_{i}",
                               default=False,
                               tooltip=f"启用第 {i} 层蒙版")
            )

        return io.Schema(
            node_id="XIS_CanvasMaskProcessor",
            display_name="Canvas Mask Processor",
            category="XISER_Nodes/Image_And_Mask",
            description="多蒙版混合节点，支持最多 50 张蒙版",
            inputs=[
                io.Boolean.Input("invert_output",
                               default=True,
                               tooltip="是否反转输出蒙版"),
                io.Mask.Input("masks",
                            tooltip="输入蒙版列表"),
                *optional_inputs  # 展开动态可选输入
            ],
            outputs=[
                io.Mask.Output(display_name="output_mask")
            ]
        )

    @classmethod
    def execute(cls, invert_output, masks, **kwargs) -> io.NodeOutput:
        """
        执行方法：混合多个蒙版

        注意：kwargs包含所有动态的Layer_Mask_{i}参数
        """
        batch_size = masks.shape[0] if masks.dim() == 3 else 1
        if batch_size < 1:
            raise ValueError("至少需要提供一个蒙版")

        if torch.isnan(masks).any() or torch.isinf(masks).any():
            raise ValueError("输入蒙版包含NaN或Inf值")

        masks = torch.clamp(masks, 0.0, 1.0)

        if cls.DEBUG:
            print(f"输入蒙版形状: {masks.shape}, 最小值: {masks.min().item()}, 最大值: {masks.max().item()}")

        # 始终使用固定的50个开关，避免索引漂移
        enables = [kwargs.get(f"Layer_Mask_{i+1}", False) for i in range(MAX_LAYER_COUNT)]
        # 只使用前 batch_size 个开关，但保持所有开关状态的稳定性
        enabled_slots = min(batch_size, MAX_LAYER_COUNT)
        if cls.DEBUG:
            print(f"接收到的参数: {list(kwargs.keys())}")
            print(f"开关状态: {enables}")

        if masks.dim() == 2:
            masks = masks.unsqueeze(0)

        shape = masks[0].shape
        for mask in masks[1:]:
            if mask.shape != shape:
                raise ValueError("所有蒙版必须具有相同的尺寸")

        output_mask = torch.zeros_like(masks[0])

        if not any(enables):
            if cls.DEBUG:
                print("没有启用任何层，返回默认蒙版")
            if invert_output:
                output_mask = torch.ones_like(output_mask)
            return io.NodeOutput(output_mask)

        for i, (mask, enable) in enumerate(zip(masks, enables[:enabled_slots])):
            if enable:
                upper_opacity = torch.zeros_like(mask)
                for j in range(i + 1, batch_size):
                    upper_opacity = torch.max(upper_opacity, masks[j])
                visible_part = mask * (1.0 - upper_opacity)
                if cls.DEBUG:
                    print(
                        f"层 {i+1}, 启用: {enable}, 上层不透明度最大值: {upper_opacity.max().item()}, "
                        f"可见部分最大值: {visible_part.max().item()}"
                    )
                output_mask = output_mask + visible_part

        output_mask = torch.clamp(output_mask, 0.0, 1.0)
        if cls.DEBUG:
            print(f"输出蒙版最小值: {output_mask.min().item()}, 最大值: {output_mask.max().item()}")

        if invert_output:
            output_mask = 1.0 - output_mask

        return io.NodeOutput(output_mask)


# ============================================================================
# 节点列表（用于Extension注册）
# ============================================================================

# 所有V3画板蒙版处理节点
V3_NODE_CLASSES = [
    XIS_CanvasMaskProcessorV3,
]

# 节点ID到类的映射（用于向后兼容或参考）
V3_NODE_MAPPINGS = {
    cls.define_schema().node_id: cls
    for cls in V3_NODE_CLASSES
}