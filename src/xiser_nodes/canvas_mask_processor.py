import torch


MAX_LAYER_COUNT = 50


class XIS_CanvasMaskProcessor:
    """多蒙版混合节点，支持最多 50 张蒙版。"""

    DEBUG = False  # 调试模式开关

    @classmethod
    def INPUT_TYPES(cls):
        optional_layers = {
            f"Layer_Mask_{i}": ("BOOLEAN", {"default": False})
            for i in range(1, MAX_LAYER_COUNT + 1)
        }
        return {
            "required": {
                "invert_output": ("BOOLEAN", {"default": True}),
                "masks": ("MASK",),
            },
            "optional": optional_layers,
        }

    RETURN_TYPES = ("MASK",)
    RETURN_NAMES = ("output_mask",)
    FUNCTION = "blend_masks"
    CATEGORY = "XISER_Nodes/Image_And_Mask"

    def blend_masks(self, invert_output, masks, **kwargs):
        batch_size = masks.shape[0] if masks.dim() == 3 else 1
        if batch_size < 1:
            raise ValueError("At least one mask must be provided.")

        if torch.isnan(masks).any() or torch.isinf(masks).any():
            raise ValueError("Input masks contain NaN or Inf values.")

        masks = torch.clamp(masks, 0.0, 1.0)

        if self.DEBUG:
            print(f"Input masks shape: {masks.shape}, min: {masks.min().item()}, max: {masks.max().item()}")

        enabled_slots = min(batch_size, MAX_LAYER_COUNT)
        enables = [kwargs.get(f"Layer_Mask_{i+1}", False) for i in range(enabled_slots)]
        if self.DEBUG:
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
            if self.DEBUG:
                print("No layers enabled, returning default mask")
            if invert_output:
                output_mask = torch.ones_like(output_mask)
            return (output_mask,)

        for i, (mask, enable) in enumerate(zip(masks, enables)):
            if enable:
                upper_opacity = torch.zeros_like(mask)
                for j in range(i + 1, batch_size):
                    upper_opacity = torch.max(upper_opacity, masks[j])
                visible_part = mask * (1.0 - upper_opacity)
                if self.DEBUG:
                    print(
                        f"Layer {i+1}, Enable: {enable}, Upper Opacity Max: {upper_opacity.max().item()}, "
                        f"Visible Part Max: {visible_part.max().item()}"
                    )
                output_mask = output_mask + visible_part

        output_mask = torch.clamp(output_mask, 0.0, 1.0)
        if self.DEBUG:
            print(f"Output mask min: {output_mask.min().item()}, max: {output_mask.max().item()}")

        if invert_output:
            output_mask = 1.0 - output_mask

        return (output_mask,)
