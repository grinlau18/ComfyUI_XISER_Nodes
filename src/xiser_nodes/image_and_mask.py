import math
import os
from typing import List, Optional, Tuple

import cv2
import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image
from comfy_api.latest import ComfyExtension, io

from .canvas_mask_processor import XIS_CanvasMaskProcessor
from .utils import standardize_tensor

"""
Image and mask processing nodes (pure v3).
"""


class XIS_LoadImage(io.ComfyNode):
    """Load an image from disk and produce an accompanying mask."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="XIS_LoadImage",
            display_name="Load Image",
            category="XISER_Nodes/Image_And_Mask",
            inputs=[
                io.String.Input("image", default=""),
                io.Mask.Input("mask", optional=True),
            ],
            outputs=[
                io.Image.Output("image_out", display_name="image"),
                io.Mask.Output("mask_out", display_name="mask"),
            ],
        )

    @classmethod
    def execute(cls, image: str, mask: Optional[torch.Tensor] = None):
        img = Image.open(image).convert("RGBA")
        image_np = np.array(img).astype(np.float32) / 255.0
        rgb = image_np[:, :, :3]
        alpha = image_np[:, :, 3]

        if mask is not None:
            output_mask = standardize_tensor(mask, expected_dims=3, is_image=False).squeeze(0)
        else:
            output_mask = 1.0 - alpha if np.any(alpha < 1.0) else np.ones_like(alpha)

        image_tensor = torch.from_numpy(rgb).unsqueeze(0)
        mask_tensor = torch.from_numpy(output_mask).unsqueeze(0)
        return io.NodeOutput(image_tensor, mask_tensor)

    @classmethod
    def IS_CHANGED(cls, image: str, mask: Optional[torch.Tensor] = None) -> float:
        change_id = 0.0
        if os.path.exists(image):
            change_id += os.path.getmtime(image)
        if mask is not None:
            change_id += hash(mask.cpu().numpy().tobytes())
        return change_id


class XIS_ResizeToDivisible(io.ComfyNode):
    """Resize image/mask to nearest divisible size."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="XIS_ResizeToDivisible",
            display_name="Resize To Divisible",
            category="XISER_Nodes/Image_And_Mask",
            inputs=[
                io.Int.Input("divisor", default=64, min=1, max=1024, step=1),
                io.Image.Input("image", optional=True),
                io.Mask.Input("mask", optional=True),
            ],
            outputs=[
                io.Image.Output("image_output", display_name="image_output"),
                io.Mask.Output("mask_output", display_name="mask_output"),
            ],
        )

    @classmethod
    def execute(cls, divisor: int, image: Optional[torch.Tensor] = None, mask: Optional[torch.Tensor] = None):
        if image is None and mask is None:
            return io.NodeOutput(None, None)
        image_output = cls._resize_tensor(image, divisor, is_image=True) if image is not None else None
        mask_output = cls._resize_tensor(mask, divisor, is_image=False) if mask is not None else None
        return io.NodeOutput(image_output, mask_output)

    @staticmethod
    def _resize_tensor(tensor: torch.Tensor, divisor: int, is_image: bool = False):
        if not is_image and tensor.dim() == 2:
            tensor = tensor.unsqueeze(0)
        _, height, width = tensor.shape[:3]
        target_height = XIS_ResizeToDivisible._nearest_divisible(height, divisor)
        target_width = XIS_ResizeToDivisible._nearest_divisible(width, divisor)
        tensor_permuted = tensor.permute(0, 3, 1, 2) if is_image else tensor.unsqueeze(1)
        tensor_resized = F.interpolate(tensor_permuted, size=(target_height, target_width), mode="nearest")
        output = tensor_resized.permute(0, 2, 3, 1) if is_image else tensor_resized.squeeze(1)
        return output.squeeze(0) if not is_image and tensor.dim() == 2 else output

    @staticmethod
    def _nearest_divisible(value: int, divisor: int) -> int:
        quotient = value // divisor
        lower = quotient * divisor
        upper = (quotient + 1) * divisor
        return lower if abs(value - lower) < abs(value - upper) else upper


class XIS_CropImage(io.ComfyNode):
    """Crop image by mask with optional inversion and padding."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="XIS_CropImage",
            display_name="Crop Image",
            category="XISER_Nodes/Image_And_Mask",
            inputs=[
                io.Image.Input("image"),
                io.Mask.Input("mask", optional=True),
                io.Boolean.Input("invert_mask", default=False),
                io.String.Input("background_color", default="#000000"),
                io.Int.Input("padding_width", default=0, min=0, max=1024, step=1),
            ],
            outputs=[
                io.Image.Output("output_image", display_name="image"),
            ],
        )

    @classmethod
    def execute(cls, image: torch.Tensor, mask: Optional[torch.Tensor], invert_mask: bool, background_color: str, padding_width: int):
        img = image[0]  # [H, W, C]
        device = img.device

        if mask is None or not torch.is_tensor(mask) or mask.ndim == 0:
            return io.NodeOutput(img.unsqueeze(0))

        mask_tensor = mask[0].to(device=device, dtype=torch.float32)
        if mask_tensor.max() > 1.0:
            mask_tensor = mask_tensor / 255.0
        mask_tensor = mask_tensor.clamp(0, 1)

        if mask_tensor.shape != img.shape[:2]:
            if mask_tensor.ndim == 2:
                mask_tensor = mask_tensor.unsqueeze(0).unsqueeze(0)
            elif mask_tensor.ndim == 3:
                mask_tensor = mask_tensor.unsqueeze(0)
            mask_tensor = F.interpolate(mask_tensor, size=img.shape[:2], mode="bilinear", antialias=True).squeeze(0).squeeze(0)

        if invert_mask:
            mask_tensor = 1 - mask_tensor

        mask_sum = mask_tensor.sum()
        rgb_color = cls._hex_to_rgb_tensor(background_color).to(device)
        if mask_sum == 0:
            return io.NodeOutput(rgb_color.expand(1, *img.shape))
        if mask_sum == mask_tensor.numel():
            return io.NodeOutput(img.unsqueeze(0))

        masked_image = img * mask_tensor.unsqueeze(-1)
        nonzero_coords = torch.nonzero(mask_tensor > 0, as_tuple=True)
        y_min, y_max = nonzero_coords[0].min(), nonzero_coords[0].max()
        x_min, x_max = nonzero_coords[1].min(), nonzero_coords[1].max()
        cropped_image = masked_image[y_min:y_max + 1, x_min:x_max + 1]
        cropped_mask = mask_tensor[y_min:y_max + 1, x_min:x_max + 1]

        background = rgb_color.expand(*cropped_image.shape)
        output_image = cropped_image * cropped_mask.unsqueeze(-1) + background * (1 - cropped_mask.unsqueeze(-1))

        if padding_width > 0:
            h_crop, w_crop = output_image.shape[:2]
            new_h, new_w = h_crop + 2 * padding_width, w_crop + 2 * padding_width
            padded_image = torch.full((new_h, new_w, img.shape[-1]), 0.0, device=device, dtype=img.dtype)
            padded_image.copy_(rgb_color.expand(new_h, new_w, img.shape[-1]))
            padded_image[padding_width:padding_width + h_crop, padding_width:padding_width + w_crop] = output_image
            output_image = padded_image

        return io.NodeOutput(output_image.unsqueeze(0))

    @staticmethod
    def _hex_to_rgb_tensor(hex_color: str) -> torch.Tensor:
        hex_color = hex_color.lstrip("#")
        return torch.tensor([int(hex_color[i:i + 2], 16) for i in (0, 2, 4)], dtype=torch.float32) / 255.0


class XIS_InvertMask(io.ComfyNode):
    """Invert mask values with optional fallback to image dimensions."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="XIS_InvertMask",
            display_name="Invert Mask",
            category="XISER_Nodes/Image_And_Mask",
            inputs=[
                io.Mask.Input("mask"),
                io.Boolean.Input("invert", default=True),
                io.Image.Input("image", optional=True),
            ],
            outputs=[
                io.Mask.Output("mask_output", display_name="mask_output"),
            ],
        )

    @classmethod
    def execute(cls, mask: torch.Tensor, invert: bool, image: Optional[torch.Tensor] = None):
        mask = mask.to(dtype=torch.float32)
        is_all_zero = torch.all(mask == 0)
        is_0_to_1_range = mask.max() <= 1.0 and mask.max() > 0

        if is_all_zero and image is not None:
            base = torch.ones_like(image[..., 0], dtype=torch.float32) if is_0_to_1_range else torch.full_like(image[..., 0], 255.0)
            mask_output = base
        else:
            if invert and is_0_to_1_range:
                mask_output = 1.0 - mask
            elif invert:
                mask_output = 255.0 - mask
            else:
                mask_output = mask
        return io.NodeOutput(mask_output)


class XIS_ImageMaskMirror(io.ComfyNode):
    """Flip image/mask along X or Y axis."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="XIS_ImageMaskMirror",
            display_name="Image Mask Mirror",
            category="XISER_Nodes/Image_And_Mask",
            inputs=[
                io.Combo.Input("flip_axis", options=["X", "Y"], default="X"),
                io.Boolean.Input("enable_flip", default=True),
                io.Image.Input("image", optional=True),
                io.Mask.Input("mask", optional=True),
            ],
            outputs=[
                io.Image.Output("image_output", display_name="image_output"),
                io.Mask.Output("mask_output", display_name="mask_output"),
            ],
        )

    @classmethod
    def execute(cls, flip_axis: str, enable_flip: bool, image: Optional[torch.Tensor] = None, mask: Optional[torch.Tensor] = None):
        if image is None and mask is None:
            return io.NodeOutput(None, None)
        axis = 2 if flip_axis == "X" else 1
        image_output = image.flip(axis) if image is not None and enable_flip else image
        mask_output = None
        if mask is not None:
            mask_input = mask.unsqueeze(0) if mask.dim() == 2 else mask
            flipped = mask_input.flip(axis) if enable_flip else mask_input
            mask_output = flipped.squeeze(0) if mask.dim() == 2 else flipped
        return io.NodeOutput(image_output, mask_output)


class XIS_ReorderImageMaskGroups(io.ComfyNode):
    """Reorder up to five image/mask groups with optional insertion."""

    @classmethod
    def define_schema(cls):
        inputs = [
            io.Int.Input("insert_order", default=1, min=1, max=5, step=1),
            io.Image.Input("insert_image", optional=True),
            io.Mask.Input("insert_mask", optional=True),
        ]
        for i in range(1, 5):
            inputs.append(io.Image.Input(f"image_{i}", optional=True))
            inputs.append(io.Mask.Input(f"mask_{i}", optional=True))

        outputs = []
        for i in range(1, 6):
            outputs.append(io.Image.Output(f"out_image_{i}", display_name=f"image_{i}"))
            outputs.append(io.Mask.Output(f"out_mask_{i}", display_name=f"mask_{i}"))

        return io.Schema(
            node_id="XIS_ReorderImageMaskGroups",
            display_name="Reorder Image Mask Groups",
            category="XISER_Nodes/Image_And_Mask",
            inputs=inputs,
            outputs=outputs,
        )

    @classmethod
    def execute(cls, insert_order: int, insert_image=None, insert_mask=None, **kwargs):
        images = [kwargs.get(f"image_{i}") for i in range(1, 5)]
        masks = [kwargs.get(f"mask_{i}") for i in range(1, 5)]
        insert_is_empty = insert_image is None

        if insert_order == 1:
            output_images = ([insert_image] if not insert_is_empty else [None]) + images
            output_masks = ([insert_mask] if not insert_is_empty else [None]) + masks
        else:
            output_images = images[: insert_order - 1] + ([insert_image] if not insert_is_empty else [None]) + images[insert_order - 1 :]
            output_masks = masks[: insert_order - 1] + ([insert_mask] if not insert_is_empty else [None]) + masks[insert_order - 1 :]

        output_images = output_images[:5]
        output_masks = output_masks[:5]
        return io.NodeOutput(
            output_images[0],
            output_masks[0],
            output_images[1],
            output_masks[1],
            output_images[2],
            output_masks[2],
            output_images[3],
            output_masks[3],
            output_images[4],
            output_masks[4],
        )


class XIS_MaskCompositeOperation(io.ComfyNode):
    """Composite two masks and optionally overlay on a reference image."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="XIS_MaskCompositeOperation",
            display_name="Mask Composite Operation",
            category="XISER_Nodes/Image_And_Mask",
            inputs=[
                io.Mask.Input("mask1"),
                io.Combo.Input("operation", options=["add", "subtract", "intersect", "difference"], default="add"),
                io.Float.Input("blur_radius", default=0.0, min=0.0, max=100.0, step=0.1),
                io.Float.Input("expand_shrink", default=0.0, min=-100.0, max=100.0, step=0.1),
                io.Boolean.Input("invert_mask", default=False),
                io.String.Input("overlay_color", default="#FF0000"),
                io.Float.Input("opacity", default=0.5, min=0.0, max=1.0, step=0.01),
                io.Mask.Input("mask2", optional=True),
                io.Image.Input("reference_image", optional=True),
            ],
            outputs=[
                io.Mask.Output("result_mask", display_name="result_mask"),
                io.Image.Output("overlay_image", display_name="overlay_image"),
            ],
        )

    @classmethod
    def execute(
        cls,
        mask1: torch.Tensor,
        operation: str,
        blur_radius: float,
        expand_shrink: float,
        invert_mask: bool,
        overlay_color: str,
        opacity: float,
        mask2: Optional[torch.Tensor] = None,
        reference_image: Optional[torch.Tensor] = None,
    ):
        mask1_np = mask1.squeeze().cpu().numpy().astype(np.float32)
        mask1_height, mask1_width = mask1_np.shape

        mask2_is_empty = False
        if mask2 is not None:
            mask2_np = mask2.squeeze().cpu().numpy().astype(np.float32)
            if mask2_np.shape == (64, 64) and np.all(mask2_np == 0):
                mask2_is_empty = True
            else:
                if mask2_np.shape != mask1_np.shape:
                    mask2_pil = Image.fromarray((mask2_np * 255).astype(np.uint8))
                    mask2_pil = mask2_pil.resize((mask1_width, mask1_height), Image.LANCZOS)
                    mask2_np = np.array(mask2_pil).astype(np.float32) / 255.0

        if mask2 is not None and not mask2_is_empty:
            if operation == "add":
                result_np = np.clip(mask1_np + mask2_np, 0, 1)
            elif operation == "subtract":
                result_np = np.clip(mask1_np - mask2_np, 0, 1)
            elif operation == "intersect":
                result_np = np.minimum(mask1_np, mask2_np)
            elif operation == "difference":
                result_np = np.abs(mask1_np - mask2_np)
        else:
            result_np = mask1_np

        if expand_shrink != 0:
            result_np = cls.morphological_operation(result_np, expand_shrink)
            result_np = np.clip(result_np, 0, 1)

        if blur_radius > 0:
            result_np = cv2.GaussianBlur(result_np, (0, 0), blur_radius, borderType=cv2.BORDER_REPLICATE)
            result_np = np.clip(result_np, 0, 1)

        if invert_mask:
            result_np = 1.0 - result_np
            result_np = np.clip(result_np, 0, 1)

        result_mask = torch.from_numpy(result_np).unsqueeze(0)

        overlay_tensor = torch.zeros_like(result_mask.unsqueeze(-1).expand(-1, -1, -1, 3))
        if reference_image is not None:
            ref_img_np = reference_image[0].cpu().numpy()
            if ref_img_np.shape[:2] != (mask1_height, mask1_width):
                ref_img_pil = Image.fromarray((ref_img_np * 255).astype(np.uint8))
                ref_img_pil = ref_img_pil.resize((mask1_width, mask1_height), Image.LANCZOS)
                ref_img_np = np.array(ref_img_pil).astype(np.float32) / 255.0

            try:
                hex_color = overlay_color.lstrip("#").lower()
                if len(hex_color) != 6:
                    raise ValueError("Invalid HEX color length")
                rgb = tuple(int(hex_color[i : i + 2], 16) / 255.0 for i in (0, 2, 4))
            except (ValueError, IndexError):
                rgb = (1.0, 0.0, 0.0)
                print(f"Warning: Invalid overlay_color '{overlay_color}', using default red")

            color_layer_np = np.full((mask1_height, mask1_width, 3), rgb, dtype=np.float32)
            mask_3d = result_np[..., np.newaxis]
            overlay_np = (color_layer_np * mask_3d + ref_img_np * (1 - mask_3d)) * opacity + ref_img_np * (1 - opacity)
            overlay_np = np.clip(overlay_np, 0, 1)
            overlay_tensor = torch.from_numpy(overlay_np).unsqueeze(0)

        return io.NodeOutput(result_mask, overlay_tensor)

    @staticmethod
    def morphological_operation(np_image, amount):
        kernel_size = int(abs(amount) * 2 + 1)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
        if amount > 0:
            processed = cv2.dilate(np_image, kernel, iterations=1, borderType=cv2.BORDER_REPLICATE)
        else:
            processed = cv2.erode(np_image, kernel, iterations=1, borderType=cv2.BORDER_REPLICATE)
        return processed


class XIS_MaskBatchProcessor(io.ComfyNode):
    """Batch process masks with union/intersection/subtract."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="XIS_MaskBatchProcessor",
            display_name="Mask Batch Processor",
            category="XISER_Nodes/Image_And_Mask",
            inputs=[
                io.Mask.Input("masks"),
                io.Combo.Input("operation", options=["union", "intersection", "subtract"], default="union"),
                io.Boolean.Input("invert_output", default=False),
            ],
            outputs=[
                io.Mask.Output("processed_mask", display_name="processed_mask"),
            ],
        )

    @classmethod
    def execute(cls, masks, operation: str, invert_output: bool):
        if isinstance(masks, torch.Tensor):
            mask_tensor = masks
        elif isinstance(masks, (list, tuple)):
            if len(masks) == 0:
                raise ValueError("Empty mask batch received")
            mask_list = []
            for m in masks:
                if not isinstance(m, torch.Tensor):
                    raise TypeError("All masks must be torch.Tensor when passing a list/tuple")
                mask_list.append(m)
            mask_tensor = torch.stack(mask_list)
        else:
            raise TypeError("masks must be a tensor or list/tuple of tensors")

        if mask_tensor.dim() == 4:
            mask_tensor = mask_tensor.squeeze(1)

        mask_tensor = torch.clamp(mask_tensor.to(torch.float32), 0.0, 1.0)

        if mask_tensor.shape[0] == 0:
            raise ValueError("Empty mask batch received")

        if operation == "union":
            result = torch.max(mask_tensor, dim=0)[0]
        elif operation == "intersection":
            result = torch.min(mask_tensor, dim=0)[0]
        else:  # subtract
            result = mask_tensor[0].clone()
            for i in range(1, mask_tensor.shape[0]):
                result = result * (1.0 - mask_tensor[i])

        if invert_output:
            result = 1.0 - result

        result = torch.clamp(result, 0.0, 1.0)
        result = result.unsqueeze(0).unsqueeze(1)
        return io.NodeOutput(result)


class XIS_CompositorProcessor(io.ComfyNode):
    """Compose a transformed image onto a canvas."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="XIS_CompositorProcessor",
            display_name="Compositor Processor",
            category="XISER_Nodes/Image_And_Mask",
            inputs=[
                io.Image.Input("image"),
                io.Int.Input("x", default=0, min=-9999, max=9999, step=1),
                io.Int.Input("y", default=0, min=-9999, max=9999, step=1),
                io.Int.Input("width", default=512, min=1, max=4096, step=1),
                io.Int.Input("height", default=512, min=1, max=4096, step=1),
                io.Int.Input("angle", default=0, min=-360, max=360, step=1),
                io.Int.Input("canvas_width", default=512, min=1, max=4096, step=1),
                io.Int.Input("canvas_height", default=512, min=1, max=4096, step=1),
                io.String.Input("background_color", default="#FFFFFF"),
            ],
            outputs=[
                io.Image.Output("output_image", display_name="output_image"),
            ],
        )

    @classmethod
    def execute(cls, image, x, y, width, height, angle, canvas_width, canvas_height, background_color):
        image_tensor = image[0]
        image_np = (image_tensor.cpu().numpy() * 255).astype(np.uint8)
        pil_image = Image.fromarray(image_np)

        width = max(1, width)
        height = max(1, height)

        try:
            bg_color = tuple(int(background_color.lstrip("#")[i : i + 2], 16) for i in (0, 2, 4))
        except ValueError:
            bg_color = (255, 255, 255)
        canvas = Image.new("RGB", (canvas_width, canvas_height), bg_color)

        resized_image = pil_image.resize((width, height), Image.Resampling.LANCZOS)
        rotated_image = resized_image.rotate(-angle, expand=True, resample=Image.Resampling.BICUBIC)

        rot_width, rot_height = rotated_image.size
        paste_x = x - rot_width // 2
        paste_y = y - rot_height // 2
        canvas.paste(rotated_image, (paste_x, paste_y), rotated_image if rotated_image.mode == "RGBA" else None)

        output_np = np.array(canvas).astype(np.float32) / 255.0
        output_tensor = torch.from_numpy(output_np).unsqueeze(0)
        return io.NodeOutput(output_tensor)


class XISImageAndMaskExtension(ComfyExtension):
    async def get_node_list(self):
        return [
            XIS_LoadImage,
            XIS_ResizeToDivisible,
            XIS_CropImage,
            XIS_InvertMask,
            XIS_ImageMaskMirror,
            XIS_ReorderImageMaskGroups,
            XIS_MaskCompositeOperation,
            XIS_MaskBatchProcessor,
            XIS_CanvasMaskProcessor,
            XIS_CompositorProcessor,
        ]


async def comfy_entrypoint():
    return XISImageAndMaskExtension()
