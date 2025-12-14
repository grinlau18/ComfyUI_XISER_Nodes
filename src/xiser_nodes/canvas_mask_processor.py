import torch
from comfy_api.latest import io, ComfyExtension

MAX_LAYER_COUNT = 50


class XIS_CanvasMaskProcessor(io.ComfyNode):
    """Blend up to 50 masks with individual enable switches."""

    DEBUG = False  # 调试模式开关

    @classmethod
    def define_schema(cls):
        optional_layers = [
            io.Boolean.Input(f"Layer_Mask_{i}", default=False, optional=True, force_input=False)
            for i in range(1, MAX_LAYER_COUNT + 1)
        ]
        return io.Schema(
            node_id="XIS_CanvasMaskProcessor",
            display_name="Canvas Mask Processor",
            category="XISER_Nodes/Image_And_Mask",
            inputs=[
                io.Boolean.Input("invert_output", default=True),
                io.Mask.Input("masks"),
                *optional_layers,
            ],
            outputs=[
                io.Mask.Output("output_mask", display_name="output_mask"),
            ],
        )

    @classmethod
    def execute(cls, invert_output, masks, **kwargs):
        if isinstance(masks, torch.Tensor):
            mask_tensor = masks
        elif isinstance(masks, (list, tuple)):
            if len(masks) == 0:
                raise ValueError("At least one mask must be provided.")
            if any(not isinstance(m, torch.Tensor) for m in masks):
                raise TypeError("All masks must be torch.Tensor")
            mask_tensor = torch.stack(list(masks))
        else:
            raise TypeError("masks must be a tensor or list/tuple of tensors")

        if mask_tensor.dim() == 4:
            mask_tensor = mask_tensor.squeeze(1)
        elif mask_tensor.dim() == 2:
            mask_tensor = mask_tensor.unsqueeze(0)

        batch_size = mask_tensor.shape[0]
        if batch_size < 1:
            raise ValueError("At least one mask must be provided.")

        if torch.isnan(mask_tensor).any() or torch.isinf(mask_tensor).any():
            raise ValueError("Input masks contain NaN or Inf values.")

        mask_tensor = torch.clamp(mask_tensor, 0.0, 1.0)

        enables = [kwargs.get(f"Layer_Mask_{i}", False) for i in range(1, MAX_LAYER_COUNT + 1)]
        enabled_slots = min(batch_size, MAX_LAYER_COUNT)

        shape = mask_tensor[0].shape
        for mask in mask_tensor[1:]:
            if mask.shape != shape:
                raise ValueError("All masks must have the same dimensions.")

        output_mask = torch.zeros_like(mask_tensor[0])

        if not any(enables):
            if invert_output:
                output_mask = torch.ones_like(output_mask)
            return io.NodeOutput(output_mask.unsqueeze(0))

        for i, (mask, enable) in enumerate(zip(mask_tensor, enables[:enabled_slots])):
            if enable:
                upper_opacity = torch.zeros_like(mask)
                for j in range(i + 1, batch_size):
                    upper_opacity = torch.max(upper_opacity, mask_tensor[j])
                visible_part = mask * (1.0 - upper_opacity)
                output_mask = output_mask + visible_part

        output_mask = torch.clamp(output_mask, 0.0, 1.0)

        if invert_output:
            output_mask = 1.0 - output_mask

        return io.NodeOutput(output_mask.unsqueeze(0))


class XISCanvasMaskProcessorExtension(ComfyExtension):
    async def get_node_list(self):
        return [XIS_CanvasMaskProcessor]


async def comfy_entrypoint():
    return XISCanvasMaskProcessorExtension()


NODE_CLASS_MAPPINGS = None
NODE_DISPLAY_NAME_MAPPINGS = None
