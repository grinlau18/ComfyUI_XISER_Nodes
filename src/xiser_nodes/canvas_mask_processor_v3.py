"""v3版本的画布蒙版处理器 - 纯v3架构实现"""

import torch
from comfy_api.latest import io, ComfyExtension

MAX_LAYER_COUNT = 50


class XIS_CanvasMaskProcessor(io.ComfyNode):
    """多蒙版混合节点，支持最多 50 张蒙版。"""

    DEBUG = False  # 调试模式开关

    @classmethod
    def define_schema(cls):
        # 创建可选输入：50个布尔开关
        optional_inputs = []
        for i in range(1, MAX_LAYER_COUNT + 1):
            optional_inputs.append(
                io.Boolean.Input(f"Layer_Mask_{i}", default=False)
            )

        return io.Schema(
            node_id="XIS_CanvasMaskProcessor",
            display_name="XIS Canvas Mask Processor",
            category="XISER_Nodes/Image_And_Mask",
            inputs=[
                io.Boolean.Input("invert_output", default=True),
                io.Mask.Input("masks"),
                *optional_inputs
            ],
            outputs=[
                io.Mask.Output("output_mask", display_name="output_mask"),
            ],
        )

    @classmethod
    def execute(cls, invert_output, masks, **kwargs):
        batch_size = masks.shape[0] if masks.dim() == 3 else 1
        if batch_size < 1:
            raise ValueError("At least one mask must be provided.")

        if torch.isnan(masks).any() or torch.isinf(masks).any():
            raise ValueError("Input masks contain NaN or Inf values.")

        masks = torch.clamp(masks, 0.0, 1.0)

        if cls.DEBUG:
            print(f"Input masks shape: {masks.shape}, min: {masks.min().item()}, max: {masks.max().item()}")

        # 始终使用固定的50个开关，避免索引漂移
        enables = [kwargs.get(f"Layer_Mask_{i+1}", False) for i in range(MAX_LAYER_COUNT)]
        # 只使用前 batch_size 个开关，但保持所有开关状态的稳定性
        enabled_slots = min(batch_size, MAX_LAYER_COUNT)
        if cls.DEBUG:
            print(f"Received kwargs: {list(kwargs.keys())}")
            print(f"Switches: {enables}")

        if masks.dim() == 2:
            masks = masks.unsqueeze(0)

        shape = masks[0].shape
        for mask in masks[1:]:
            if mask.shape != shape:
                raise ValueError("All masks must have the same dimensions.")

        output_mask = torch.zeros_like(masks[0])

        if not any(enables):
            if cls.DEBUG:
                print("No layers enabled, returning default mask")
            if invert_output:
                output_mask = torch.ones_like(output_mask)
            return io.NodeOutput(output_mask,)

        for i, (mask, enable) in enumerate(zip(masks, enables[:enabled_slots])):
            if enable:
                upper_opacity = torch.zeros_like(mask)
                for j in range(i + 1, batch_size):
                    upper_opacity = torch.max(upper_opacity, masks[j])
                visible_part = mask * (1.0 - upper_opacity)
                if cls.DEBUG:
                    print(
                        f"Layer {i+1}, Enable: {enable}, Upper Opacity Max: {upper_opacity.max().item()}, "
                        f"Visible Part Max: {visible_part.max().item()}"
                    )
                output_mask = output_mask + visible_part

        output_mask = torch.clamp(output_mask, 0.0, 1.0)
        if cls.DEBUG:
            print(f"Output mask min: {output_mask.min().item()}, max: {output_mask.max().item()}")

        if invert_output:
            output_mask = 1.0 - output_mask

        return io.NodeOutput(output_mask,)


# ==================== 扩展注册 ====================

class CanvasMaskProcessorExtension(ComfyExtension):
    async def get_node_list(self):
        return [XIS_CanvasMaskProcessor]


async def comfy_entrypoint():
    return CanvasMaskProcessorExtension()