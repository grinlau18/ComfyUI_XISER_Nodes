import torch
import torch.nn.functional as F
import numpy as np
from PIL import Image, ImageDraw
import cv2
import os
from typing import Optional, Tuple, Union, List
from .utils import standardize_tensor, hex_to_rgb, resize_tensor, INTERPOLATION_MODES, logger
import hashlib
import uuid
import time

"""
Image and mask processing nodes for XISER, including loading, cropping, stitching, and resizing operations.
"""

class XIS_LoadImage:
    """
    加载图像并生成蒙版。如果提供 MaskEditor 蒙版，则使用该蒙版；
    否则根据图像的 alpha 通道生成反向蒙版，或生成全 1 蒙版。
    """
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("STRING", {"default": "", "multiline": False}),
            },
            "optional": {
                "mask": ("MASK", {"default": None}),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = "load_image"
    CATEGORY = "XISER_Nodes/ImageAndMask"

    def load_image(self, image: str, mask: Optional[torch.Tensor] = None) -> Tuple[torch.Tensor, torch.Tensor]:
        img = Image.open(image).convert("RGBA")
        image_np = np.array(img).astype(np.float32) / 255.0
        rgb = image_np[:, :, :3]
        alpha = image_np[:, :, 3]

        if mask is not None:
            output_mask = standardize_tensor(mask, expected_dims=3, is_image=False).squeeze(0)
        else:
            if np.any(alpha < 1.0):
                output_mask = 1.0 - alpha
            else:
                output_mask = np.ones_like(alpha)

        image_tensor = torch.from_numpy(rgb).permute(2, 0, 1).unsqueeze(0)
        mask_tensor = torch.from_numpy(output_mask).unsqueeze(0)
        return image_tensor, mask_tensor

    @classmethod
    def IS_CHANGED(cls, image: str, mask: Optional[torch.Tensor] = None) -> float:
        change_id = 0.0
        if os.path.exists(image):
            change_id += os.path.getmtime(image)
        if mask is not None:
            change_id += hash(mask.cpu().numpy().tobytes())
        return change_id

class XIS_ImageStitcher:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "main_image": ("IMAGE",),  # 主图，必需
                "layout": (["vertical", "horizontal"], {"default": "vertical"}),  # 拼接方向
                "main_position": (["front", "back"], {"default": "back"}),  # 主图位置
                "background_color": ("STRING", {"default": "#000000"}),  # 画布背景颜色（HEX 值）
                "border_size": ("INT", {"default": 0, "min": 0, "max": 100, "step": 1}),  # 边框像素值
            },
            "optional": {
                "sub_image1": ("IMAGE", {"default": None}),
                "sub_image2": ("IMAGE", {"default": None}),
                "sub_image3": ("IMAGE", {"default": None}),
                "sub_image4": ("IMAGE", {"default": None}),
                "main_mask": ("MASK", {"default": None}),  # 主图掩码，可选
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("stitched_image", "stitched_mask")
    FUNCTION = "stitch_images"
    CATEGORY = "XISER_Nodes/ImageAndMask"

    def stitch_images(self, main_image, layout, main_position, background_color, border_size, sub_image1=None, sub_image2=None, sub_image3=None, sub_image4=None, main_mask=None):
        # 将所有输入图像转换为 PIL 格式
        images = [main_image] + [img for img in [sub_image1, sub_image2, sub_image3, sub_image4] if img is not None]
        pil_images = []
        for img in images:
            img_np = img[0].cpu().numpy() * 255  # 假设批量大小为 1，取第一张图
            img_np = img_np.astype(np.uint8)
            pil_images.append(Image.fromarray(img_np))

        main_img = pil_images[0]  # 主图
        sub_imgs = pil_images[1:]  # 副图列表
        num_sub_imgs = len(sub_imgs)
        b = border_size  # 边框像素值

        # 主图宽高
        w, h = main_img.size

        # 解析背景颜色
        try:
            bg_color = tuple(int(background_color.lstrip('#')[i:i+2], 16) for i in (0, 2, 4))
        except:
            bg_color = (0, 0, 0)  # 默认黑色

        # 处理主图掩码
        if main_mask is None:
            # 如果没有掩码，创建全 1 蒙版
            main_mask_np = np.ones((h, w), dtype=np.float32)
        else:
            # 将 MASK 类型转换为 NumPy 数组
            main_mask_np = main_mask.squeeze().cpu().numpy().astype(np.float32)
            mask_h, mask_w = main_mask_np.shape
            if mask_w != w or mask_h != h:
                # 缩放到主图尺寸
                mask_pil = Image.fromarray((main_mask_np * 255).astype(np.uint8))
                mask_pil = mask_pil.resize((w, h), Image.Resampling.LANCZOS)
                main_mask_np = np.array(mask_pil).astype(np.float32) / 255.0

        # 如果没有副图，直接返回主图和掩码（带边框）
        if num_sub_imgs == 0:
            total_width = w + 2 * b
            total_height = h + 2 * b
            canvas = Image.new("RGB", (total_width, total_height), bg_color)
            canvas.paste(main_img, (b, b))
            final_img = canvas

            # 掩码画布
            mask_canvas_np = np.zeros((total_height, total_width), dtype=np.float32)
            mask_canvas_np[b:b+h, b:b+w] = main_mask_np
            final_mask = torch.from_numpy(mask_canvas_np).unsqueeze(0)
        else:
            # 副图基础大小
            sub_w = w // num_sub_imgs
            sub_h = h // num_sub_imgs

            # 根据布局调整副图大小
            if layout == "vertical":
                sub_w_adjusted = int(sub_w - b * (num_sub_imgs - 1) / num_sub_imgs) if num_sub_imgs > 1 else sub_w
                sub_w_adjusted = max(1, sub_w_adjusted)
                target_long_side = max(sub_w_adjusted, sub_h)
                target_short_side = sub_h
            else:  # horizontal
                sub_h_adjusted = int(sub_h - b * (num_sub_imgs - 1) / num_sub_imgs) if num_sub_imgs > 1 else sub_h
                sub_h_adjusted = max(1, sub_h_adjusted)
                target_long_side = max(sub_w, sub_h_adjusted)
                target_short_side = sub_w

            # 调整副图大小并裁剪
            resized_sub_imgs = []
            for sub_img in sub_imgs:
                fw, fh = sub_img.size
                sub_aspect = fw / fh

                # 等比缩放，短边等于拼接尺寸的长边
                if sub_aspect > 1:  # 宽图
                    new_h = target_long_side
                    new_w = int(new_h * sub_aspect)
                else:  # 高图或正方形
                    new_w = target_long_side
                    new_h = int(new_w / sub_aspect)

                sub_img_resized = sub_img.resize((new_w, new_h), Image.Resampling.LANCZOS)

                # 居中裁剪到调整后的副图大小
                crop_left = (new_w - (sub_w_adjusted if layout == "vertical" else sub_w)) // 2
                crop_top = (new_h - (sub_h if layout == "vertical" else sub_h_adjusted)) // 2
                sub_img_cropped = sub_img_resized.crop((
                    crop_left,
                    crop_top,
                    crop_left + (sub_w_adjusted if layout == "vertical" else sub_w),
                    crop_top + (sub_h if layout == "vertical" else sub_h_adjusted)
                ))
                resized_sub_imgs.append(sub_img_cropped)

            # 根据布局和主图位置计算画布大小和拼接位置
            if layout == "vertical":
                total_width = w + 2 * b
                total_height = h + sub_h + 2 * b + b if num_sub_imgs >= 1 else h + 2 * b
                canvas = Image.new("RGB", (total_width, total_height), bg_color)
                mask_canvas_np = np.zeros((total_height, total_width), dtype=np.float32)

                if main_position == "front":
                    # 主图在 x(b), y(b)
                    canvas.paste(main_img, (b, b))
                    mask_canvas_np[b:b+h, b:b+w] = main_mask_np
                    # 副图在 x(b), y(h+b*2), x(w/n+b*2), y(h+b*2), ...
                    for i, sub_img in enumerate(resized_sub_imgs):
                        canvas.paste(sub_img, (b + i * sub_w_adjusted + i * b, h + 2 * b))
                else:
                    # 主图在 x(b), y(h/n+b*2)
                    canvas.paste(main_img, (b, sub_h + 2 * b))
                    mask_canvas_np[sub_h + 2*b:sub_h + 2*b + h, b:b+w] = main_mask_np
                    # 副图在 x(b), y(b), x(w/n+b*2), y(b), ...
                    for i, sub_img in enumerate(resized_sub_imgs):
                        canvas.paste(sub_img, (b + i * sub_w_adjusted + i * b, b))

            else:  # layout == "horizontal"
                total_width = w + sub_w + 2 * b + b if num_sub_imgs >= 1 else w + 2 * b
                total_height = h + 2 * b
                canvas = Image.new("RGB", (total_width, total_height), bg_color)
                mask_canvas_np = np.zeros((total_height, total_width), dtype=np.float32)

                if main_position == "front":
                    # 主图在 x(b), y(b)
                    canvas.paste(main_img, (b, b))
                    mask_canvas_np[b:b+h, b:b+w] = main_mask_np
                    # 副图在 x(w+b*2), y(b), x(w+b*2), y(h/n+b*2), ...
                    for i, sub_img in enumerate(resized_sub_imgs):
                        canvas.paste(sub_img, (w + 2 * b, b + i * sub_h_adjusted + i * b))
                else:
                    # 主图在 x(w/n+b*2), y(b)
                    canvas.paste(main_img, (sub_w + 2 * b, b))
                    mask_canvas_np[b:b+h, sub_w + 2*b:sub_w + 2*b + w] = main_mask_np
                    # 副图在 x(b), y(b), x(b), y(h/n+b*2), ...
                    for i, sub_img in enumerate(resized_sub_imgs):
                        canvas.paste(sub_img, (b, b + i * sub_h_adjusted + i * b))

            final_img = canvas
            final_mask = torch.from_numpy(mask_canvas_np).unsqueeze(0)

        # 转换为 ComfyUI 的 IMAGE 和 MASK 类型
        output_np = np.array(final_img).astype(np.float32) / 255.0
        output_tensor = torch.from_numpy(output_np).unsqueeze(0)
        return (output_tensor, final_mask)

# 将图片或蒙版缩放到最接近的可整除尺寸
class XIS_ResizeToDivisible:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "divisor": ("INT", {"default": 64, "min": 1, "max": 1024, "step": 1}),
            },
            "optional": {
                "image": ("IMAGE",),
                "mask": ("MASK",),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image_output", "mask_output")
    FUNCTION = "resize_to_divisible"
    CATEGORY = "XISER_Nodes/ImageAndMask"

    def resize_to_divisible(self, divisor, image=None, mask=None):
        if image is None and mask is None:
            return (None, None)
        image_output = self._resize_tensor(image, divisor, is_image=True) if image is not None else None
        mask_output = self._resize_tensor(mask, divisor, is_image=False) if mask is not None else None
        return (image_output, mask_output)

    def _resize_tensor(self, tensor, divisor, is_image=False):
        if not is_image and tensor.dim() == 2:
            tensor = tensor.unsqueeze(0)
        batch, height, width = tensor.shape[:3]
        channels = tensor.shape[3] if is_image else 1
        
        target_height = self._nearest_divisible(height, divisor)
        target_width = self._nearest_divisible(width, divisor)
        tensor_permuted = tensor.permute(0, 3, 1, 2) if is_image else tensor.unsqueeze(1)
        tensor_resized = F.interpolate(tensor_permuted, size=(target_height, target_width), mode="nearest")
        output = tensor_resized.permute(0, 2, 3, 1) if is_image else tensor_resized.squeeze(1)
        
        return output.squeeze(0) if not is_image and tensor.dim() == 2 else output

    def _nearest_divisible(self, value, divisor):
        quotient = value // divisor
        lower = quotient * divisor
        upper = (quotient + 1) * divisor
        return lower if abs(value - lower) < abs(value - upper) else upper

# 使用蒙版去底并裁剪，支持蒙版反转和背景颜色填充
class XIS_CropImage:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "mask": ("MASK", {"default": None}),  # mask 可选，允许 None
                "invert_mask": ("BOOLEAN", {"default": False}),
                "background_color": ("STRING", {"default": "#000000"}),
                "padding_width": ("INT", {"default": 0, "min": 0, "max": 1024, "step": 1}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "process"
    CATEGORY = "XISER_Nodes/ImageAndMask"

    def process(self, image, mask, invert_mask, background_color, padding_width):
        image = image[0]  # [H, W, C]
        device = image.device

        # 如果 mask 为 None，直接返回原始图像
        if mask is None:
            return (image.unsqueeze(0),)

        # 确保 mask 是张量且有正确的维度
        if not torch.is_tensor(mask) or mask.ndim == 0:
            # 如果 mask 不是张量或标量，返回原始图像（或根据需求抛出错误）
            return (image.unsqueeze(0),)

        mask = mask[0]  # [H, W]

        # 标准化蒙版值域到 [0, 1]
        mask = mask.to(device=device, dtype=torch.float32)
        if mask.max() > 1.0:
            mask = mask / 255.0
        mask = mask.clamp(0, 1)

        # 调整蒙版尺寸以匹配图像
        if mask.shape != image.shape[:2]:
            # 确保 mask 是 4D 格式 [N, C, H, W]
            if mask.ndim == 2:  # [H, W]
                mask = mask.unsqueeze(0).unsqueeze(0)  # 转为 [1, 1, H, W]
            elif mask.ndim == 3:  # [C, H, W] 或其他意外格式
                mask = mask.unsqueeze(0)  # 转为 [1, C, H, W]
            
            mask = F.interpolate(
                mask,
                size=image.shape[:2],
                mode="bilinear",
                antialias=True
            ).squeeze(0).squeeze(0)  # 回到 [H, W]

        # 反转蒙版（如果需要）
        if invert_mask:
            mask = 1 - mask

        # 检查蒙版是否全为 0 或全为 1
        mask_sum = mask.sum()
        if mask_sum == 0:  # 全为 0，返回纯色背景
            rgb_color = self.hex_to_rgb(background_color).to(device)
            return (rgb_color.expand(1, *image.shape),)
        elif mask_sum == mask.numel():  # 全为 1，返回原始图像
            return (image.unsqueeze(0),)

        # 计算裁剪区域
        masked_image = image * mask.unsqueeze(-1)
        nonzero_coords = torch.nonzero(mask > 0, as_tuple=True)
        y_min, y_max = nonzero_coords[0].min(), nonzero_coords[0].max()
        x_min, x_max = nonzero_coords[1].min(), nonzero_coords[1].max()
        cropped_image = masked_image[y_min:y_max+1, x_min:x_max+1]  # [H_crop, W_crop, C]
        cropped_mask = mask[y_min:y_max+1, x_min:x_max+1]           # [H_crop, W_crop]

        # 应用蒙版并合成背景
        rgb_color = self.hex_to_rgb(background_color).to(device)
        background = rgb_color.expand(*cropped_image.shape)
        output_image = cropped_image * cropped_mask.unsqueeze(-1) + background * (1 - cropped_mask.unsqueeze(-1))

        # 添加空白边框
        if padding_width > 0:
            h_crop, w_crop = output_image.shape[:2]
            new_h, new_w = h_crop + 2 * padding_width, w_crop + 2 * padding_width
            padded_image = torch.full((new_h, new_w, image.shape[-1]), 0.0, device=device, dtype=image.dtype)
            padded_image.copy_(rgb_color.expand(new_h, new_w, image.shape[-1]))
            padded_image[padding_width:padding_width+h_crop, padding_width:padding_width+w_crop] = output_image
            output_image = padded_image

        return (output_image.unsqueeze(0),)

    def hex_to_rgb(self, hex_color):
        hex_color = hex_color.lstrip('#')
        return torch.tensor([int(hex_color[i:i+2], 16) for i in (0, 2, 4)], dtype=torch.float32) / 255.0  

# 对输入的掩码进行反转处理
class XIS_InvertMask:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "mask": ("MASK",),
                "invert": ("BOOLEAN", {"default": True}),
            },
            "optional": {
                "image": ("IMAGE",),
            }
        }

    RETURN_TYPES = ("MASK",)
    RETURN_NAMES = ("mask_output",)
    FUNCTION = "invert_mask"
    CATEGORY = "XISER_Nodes/ImageAndMask"

    def invert_mask(self, mask, invert, image=None):
        mask = mask.to(dtype=torch.float32)
        is_all_zero = torch.all(mask == 0)
        is_0_to_1_range = mask.max() <= 1.0 and mask.max() > 0

        if is_all_zero and image is not None:
            mask_output = torch.ones_like(image[..., 0], dtype=torch.float32) if is_0_to_1_range else torch.full_like(image[..., 0], 255.0)
        else:
            mask_output = (1.0 - mask) if (invert and is_0_to_1_range) else (255.0 - mask) if invert else mask
        return (mask_output,)

# 对输入的图像和蒙版进行镜像翻转操作
class XIS_ImageMaskMirror:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "flip_axis": (["X", "Y"], {"default": "X"}),
                "enable_flip": ("BOOLEAN", {"default": True}),
            },
            "optional": {
                "image": ("IMAGE",),
                "mask": ("MASK",),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image_output", "mask_output")
    FUNCTION = "mirror_flip"
    CATEGORY = "XISER_Nodes/ImageAndMask"

    def mirror_flip(self, flip_axis, enable_flip, image=None, mask=None):
        if image is None and mask is None:
            return (None, None)
        image_output = image.flip(2 if flip_axis == "X" else 1) if image is not None and enable_flip else image
        mask_output = None
        if mask is not None:
            mask_input = mask.unsqueeze(0) if mask.dim() == 2 else mask
            mask_output = mask_input.flip(2 if flip_axis == "X" else 1) if enable_flip else mask_input
            mask_output = mask_output.squeeze(0) if mask.dim() == 2 else mask_output
        return (image_output, mask_output)

INTERPOLATION_MODES = {
    "nearest": "nearest",
    "bilinear": "bilinear",
    "bicubic": "bicubic",
    "area": "area",
    "nearest_exact": "nearest-exact",
    "lanczos": "lanczos",
}

# 图像或蒙版缩放节点，支持多种缩放模式和插值方法
class XIS_ResizeImageOrMask:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "resize_mode": (["force_resize", "scale_proportionally", "limited_by_canvas", "fill_the_canvas"], {"default": "force_resize"}),
                "scale_condition": (["downscale_only", "upscale_only", "always"], {"default": "always"}),
                "interpolation": (list(INTERPOLATION_MODES.keys()), {"default": "bilinear"}),
                "min_unit": ("INT", {"default": 16, "min": 1, "max": 64, "step": 1}),
            },
            "optional": {
                "image": ("IMAGE",),
                "mask": ("MASK",),
                "reference_image": ("IMAGE",),
                "manual_width": ("INT", {"default": 512, "min": 1, "max": 4096, "step": 1}),
                "manual_height": ("INT", {"default": 512, "min": 1, "max": 4096, "step": 1}),
                "fill_hex": ("STRING", {"default": "#000000"}),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK", "INT", "INT")
    RETURN_NAMES = ("resized_image", "resized_mask", "width", "height")
    FUNCTION = "resize_image_or_mask"
    CATEGORY = "XISER_Nodes/ImageAndMask"

    def resize_image_or_mask(self, resize_mode: str, scale_condition: str, interpolation: str, min_unit: int,
                            image: Optional[torch.Tensor] = None, mask: Optional[torch.Tensor] = None,
                            reference_image: Optional[torch.Tensor] = None, manual_width: Optional[int] = None,
                            manual_height: Optional[int] = None, fill_hex: str = "#000000") -> Tuple:
        if image is None and mask is None:
            raise ValueError("At least one of 'image' or 'mask' must be provided")
        
        # 确保 min_unit 不小于 1
        min_unit = max(1, min_unit)  # 添加保护措施
        
        if reference_image is not None:
            if reference_image.dim() != 4:
                raise ValueError(f"reference_image must be 4D [B, H, W, C], got {reference_image.shape}")
            target_width, target_height = reference_image.shape[2], reference_image.shape[1]
        elif manual_width is not None and manual_height is not None:
            target_width, target_height = manual_width, manual_height
        else:
            raise ValueError("Must provide either reference_image or both manual_width and manual_height")
        
        # 确保目标尺寸有效并按 min_unit 对齐
        target_width = max(1, (target_width + min_unit - 1) // min_unit * min_unit)
        target_height = max(1, (target_height + min_unit - 1) // min_unit * min_unit)
        fill_rgb = hex_to_rgb(fill_hex)

        def compute_size(orig_w: int, orig_h: int) -> Tuple[int, int, int, int]:
            aspect = orig_w / orig_h
            if resize_mode == "force_resize":
                return target_width, target_height, 0, 0
            elif resize_mode in ["scale_proportionally", "limited_by_canvas"]:
                if target_width / target_height > aspect:
                    h = target_height
                    w = int(h * aspect)
                else:
                    w = target_width
                    h = int(w / aspect)
                w = (w + min_unit - 1) // min_unit * min_unit
                h = (h + min_unit - 1) // min_unit * min_unit
                return w, h, (target_width - w) // 2, (target_height - h) // 2
            elif resize_mode == "fill_the_canvas":
                if target_width / target_height < aspect:
                    h = target_height
                    w = int(h * aspect)
                else:
                    w = target_width
                    h = int(w / aspect)
                w = (w + min_unit - 1) // min_unit * min_unit
                h = (h + min_unit - 1) // min_unit * min_unit
                return w, h, (w - target_width) // 2, (h - target_height) // 2

        def should_resize(orig_w: int, orig_h: int, target_w: int, target_h: int) -> bool:
            if scale_condition == "always":
                return True
            elif scale_condition == "downscale_only":
                return orig_w > target_w or orig_h > target_h
            elif scale_condition == "upscale_only":
                return orig_w < target_w or orig_h < target_h
            return False

        resized_img = None
        if image is not None:
            if image.dim() != 4:
                raise ValueError(f"Image must be 4D [B, H, W, C], got {image.shape}")
            batch_size, orig_h, orig_w, channels = image.shape
            
            if should_resize(orig_w, orig_h, target_width, target_height):
                w, h, offset_x, offset_y = compute_size(orig_w, orig_h)
                resized_img = resize_tensor(image, (h, w), INTERPOLATION_MODES[interpolation])
                if resize_mode == "limited_by_canvas":
                    output = torch.full((batch_size, target_height, target_width, channels), 0, device=image.device, dtype=image.dtype)
                    output.copy_(fill_rgb.expand(batch_size, target_height, target_width, channels))
                    output[:, offset_y:offset_y+h, offset_x:offset_x+w] = resized_img
                    resized_img = output
                elif resize_mode == "fill_the_canvas":
                    output = torch.zeros(batch_size, target_height, target_width, channels, device=image.device, dtype=image.dtype)
                    y_start, y_end = max(0, offset_y), min(h, offset_y + target_height)
                    x_start, x_end = max(0, offset_x), min(w, offset_x + target_width)
                    out_h, out_w = y_end - y_start, x_end - x_start
                    output[:, :out_h, :out_w] = resized_img[:, y_start:y_start+out_h, x_start:x_start+out_w]
                    resized_img = output
                resized_img.clamp_(0, 1)
            else:
                resized_img = image

        resized_mask = None
        if mask is not None:
            if mask.dim() not in (2, 3):
                raise ValueError(f"Mask must be 2D [H, W] or 3D [B, H, W], got {mask.shape}")
            mask_input = mask.unsqueeze(0) if mask.dim() == 2 else mask
            batch_size, orig_h, orig_w = mask_input.shape
            
            if should_resize(orig_w, orig_h, target_width, target_height):
                w, h, offset_x, offset_y = compute_size(orig_w, orig_h)
                resized_mask = resize_tensor(mask_input.unsqueeze(-1), (h, w), INTERPOLATION_MODES[interpolation]).squeeze(-1)
                if resize_mode == "limited_by_canvas":
                    output = torch.full((batch_size, target_height, target_width), fill_rgb[0], device=mask.device, dtype=mask.dtype)
                    output[:, offset_y:offset_y+h, offset_x:offset_x+w] = resized_mask
                    resized_mask = output
                elif resize_mode == "fill_the_canvas":
                    output = torch.zeros(batch_size, target_height, target_width, device=mask.device, dtype=mask.dtype)
                    y_start, y_end = max(0, offset_y), min(h, offset_y + target_height)
                    x_start, x_end = max(0, offset_x), min(w, offset_x + target_width)
                    out_h, out_w = y_end - y_start, x_end - x_start
                    output[:, :out_h, :out_w] = resized_mask[:, y_start:y_start+out_h, x_start:x_start+out_w]
                    resized_mask = output
                resized_mask.clamp_(0, 1)
            else:
                resized_mask = mask_input
            
            if mask.dim() == 2:
                resized_mask = resized_mask.squeeze(0)

        return (resized_img, resized_mask, target_width, target_height)

# 重新对输入的图像和蒙版进行排序
class XIS_ReorderImageMaskGroups:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "insert_order": ("INT", {"default": 1, "min": 1, "max": 5, "step": 1}),
            },
            "optional": {
                "insert_image": ("IMAGE",),
                "insert_mask": ("MASK",),
                "image_1": ("IMAGE",),
                "mask_1": ("MASK",),
                "image_2": ("IMAGE",),
                "mask_2": ("MASK",),
                "image_3": ("IMAGE",),
                "mask_3": ("MASK",),
                "image_4": ("IMAGE",),
                "mask_4": ("MASK",),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK", "IMAGE", "MASK", "IMAGE", "MASK", "IMAGE", "MASK", "IMAGE", "MASK")
    RETURN_NAMES = ("image_1", "mask_1", "image_2", "mask_2", "image_3", "mask_3", "image_4", "mask_4", "image_5", "mask_5")

    FUNCTION = "reorder_groups"

    CATEGORY = "XISER_Nodes/ImageAndMask"

    def reorder_groups(self, insert_order, insert_image=None, insert_mask=None, image_1=None, mask_1=None, 
                      image_2=None, mask_2=None, image_3=None, mask_3=None, image_4=None, mask_4=None):
        # 将输入的四组原始数据放入列表，未连接的输入默认为 None
        images = [image_1, image_2, image_3, image_4]
        masks = [mask_1, mask_2, mask_3, mask_4]

        # 检查插入组是否为空（仅用于判断是否插入 None）
        insert_is_empty = insert_image is None

        # 根据 insert_order 调整顺序
        if insert_order == 1:
            # 插入组放在第一位，原有组顺序不变
            output_images = ([insert_image] if not insert_is_empty else [None]) + images
            output_masks = ([insert_mask] if not insert_is_empty else [None]) + masks
        else:
            # 插入组放在指定位置，前面的组前移，后面的组保持不变
            output_images = images[:insert_order-1] + ([insert_image] if not insert_is_empty else [None]) + images[insert_order-1:]
            output_masks = masks[:insert_order-1] + ([insert_mask] if not insert_is_empty else [None]) + masks[insert_order-1:]

        # 确保输出五组数据（截取前5组）
        output_images = output_images[:5]
        output_masks = output_masks[:5]

        # 直接返回调整后的五组 image 和 mask，不强制转换空值
        return (output_images[0], output_masks[0], 
                output_images[1], output_masks[1], 
                output_images[2], output_masks[2], 
                output_images[3], output_masks[3], 
                output_images[4], output_masks[4])

# 对输入的蒙版进行复合操作，支持多种操作类型
class XIS_MaskCompositeOperation:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "mask1": ("MASK",),
                "operation": (["add", "subtract", "intersect", "difference"], {"default": "add"}),
                "blur_radius": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 100.0, "step": 0.1}),
                "expand_shrink": ("FLOAT", {"default": 0.0, "min": -100.0, "max": 100.0, "step": 0.1}),
                "invert_mask": ("BOOLEAN", {"default": False}),
                "overlay_color": ("STRING", {"default": "#FF0000"}),
                "opacity": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.01}),
            },
            "optional": {
                "mask2": ("MASK", {"default": None}),
                "reference_image": ("IMAGE", {"default": None}),
            }
        }

    RETURN_TYPES = ("MASK", "IMAGE")
    RETURN_NAMES = ("result_mask", "overlay_image")
    FUNCTION = "apply_operations"
    CATEGORY = "XISER_Nodes/ImageAndMask"

    def apply_operations(self, mask1, operation, blur_radius, expand_shrink, invert_mask, overlay_color, opacity, mask2=None, reference_image=None):
        # 将 mask1 转换为 NumPy 数组并获取尺寸（保持浮点数）
        mask1_np = mask1.squeeze().cpu().numpy().astype(np.float32)
        mask1_height, mask1_width = mask1_np.shape

        # 处理 mask2
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

        # 执行蒙版操作（保持浮点数）
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

        # 形态学操作
        if expand_shrink != 0:
            result_np = self.morphological_operation(result_np, expand_shrink)
            result_np = np.clip(result_np, 0, 1)  # 确保范围

        # 模糊处理
        if blur_radius > 0:
            result_np = cv2.GaussianBlur(result_np, (0, 0), blur_radius, borderType=cv2.BORDER_REPLICATE)
            result_np = np.clip(result_np, 0, 1)  # 确保范围

        # 反向蒙版
        if invert_mask:
            result_np = 1.0 - result_np
            result_np = np.clip(result_np, 0, 1)  # 确保范围

        # 转换为 PyTorch 张量
        result_mask = torch.from_numpy(result_np).unsqueeze(0)

        # 生成叠加图像
        overlay_tensor = None
        if reference_image is not None:
            ref_img_np = reference_image[0].cpu().numpy()  # [H, W, C], 0-1 范围
            if ref_img_np.shape[:2] != (mask1_height, mask1_width):
                ref_img_pil = Image.fromarray((ref_img_np * 255).astype(np.uint8))
                ref_img_pil = ref_img_pil.resize((mask1_width, mask1_height), Image.LANCZOS)
                ref_img_np = np.array(ref_img_pil).astype(np.float32) / 255.0

            # 创建颜色层（0-1 范围）
            try:
                hex_color = overlay_color.lstrip('#').lower()  # 统一格式
                if len(hex_color) != 6:
                    raise ValueError("Invalid HEX color length")
                rgb = tuple(int(hex_color[i:i+2], 16) / 255.0 for i in (0, 2, 4))
            except (ValueError, IndexError):
                rgb = (1.0, 0.0, 0.0)  # 默认红色
                print(f"Warning: Invalid overlay_color '{overlay_color}', using default red")

            color_layer_np = np.full((mask1_height, mask1_width, 3), rgb, dtype=np.float32)

            # 使用浮点数掩码进行合成
            mask_3d = result_np[..., np.newaxis]  # [H, W, 1]
            overlay_np = (color_layer_np * mask_3d + ref_img_np * (1 - mask_3d)) * opacity + ref_img_np * (1 - opacity)
            overlay_np = np.clip(overlay_np, 0, 1)  # 确保范围

            overlay_tensor = torch.from_numpy(overlay_np).unsqueeze(0)
        else:
            overlay_tensor = torch.zeros_like(result_mask.unsqueeze(-1).expand(-1, -1, -1, 3))

        return (result_mask, overlay_tensor)

    def morphological_operation(self, np_image, amount):
        """使用 OpenCV 实现形态学操作，保持浮点数"""
        kernel_size = int(abs(amount) * 2 + 1)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
        
        if amount > 0:
            processed = cv2.dilate(np_image, kernel, iterations=1, borderType=cv2.BORDER_REPLICATE)
        else:
            processed = cv2.erode(np_image, kernel, iterations=1, borderType=cv2.BORDER_REPLICATE)
        
        return processed  # 在调用处 clip   
    
class XIS_MaskBatchProcessor:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "masks": ("MASK",),
                "operation": (["union", "intersection", "subtract"], {"default": "union"}),
                "invert_output": ("BOOLEAN", {"default": False}),
            }
        }

    RETURN_TYPES = ("MASK",)
    RETURN_NAMES = ("processed_mask",)
    FUNCTION = "process_masks"
    CATEGORY = "XISER_Nodes/ImageAndMask"

    def process_masks(self, masks, operation, invert_output):
        """
        Process a batch of masks with specified operation.
        
        Args:
            masks: Tensor of shape (B, H, W) or (B, 1, H, W)
            operation: One of 'union', 'intersection', 'subtract'
            invert_output: If True, invert the final mask (0->1, 1->0)
        
        Returns:
            Processed mask tensor of shape (1, H, W) with continuous values
        """
        # Ensure masks are in correct format (B, H, W)
        if masks.dim() == 4:
            masks = masks.squeeze(1)  # Convert (B, 1, H, W) to (B, H, W)
        
        # Convert to float32 for high precision
        masks = masks.to(torch.float32)
        
        # Clamp input masks to [0, 1] to ensure valid range
        masks = torch.clamp(masks, 0.0, 1.0)
        
        if masks.shape[0] == 0:
            raise ValueError("Empty mask batch received")
        
        if operation == "union":
            # Union: Take maximum across batch dimension
            result = torch.max(masks, dim=0)[0]
        
        elif operation == "intersection":
            # Intersection: Take minimum across batch dimension
            result = torch.min(masks, dim=0)[0]
        
        elif operation == "subtract":
            # Subtract: Start with first mask, subtract others
            result = masks[0].clone()
            for i in range(1, masks.shape[0]):
                result = result * (1.0 - masks[i])
        
        # Invert the result if requested
        if invert_output:
            result = 1.0 - result
        
        # Clamp result to [0, 1] to ensure valid mask values
        result = torch.clamp(result, 0.0, 1.0)
        
        # Add batch and channel dimensions for ComfyUI compatibility
        result = result.unsqueeze(0).unsqueeze(1)  # Shape: (1, 1, H, W)
        
        return (result,)
    

# 多蒙版混合节点，支持最多 8 张蒙版
class XIS_CanvasMaskProcessor:
    DEBUG = False  # 调试模式开关

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "invert_output": ("BOOLEAN", {"default": True}),
                "masks": ("MASK",),
            },
            "optional": {
                "Layer_Mask_1": ("BOOLEAN", {"default": False}),
                "Layer_Mask_2": ("BOOLEAN", {"default": False}),
                "Layer_Mask_3": ("BOOLEAN", {"default": False}),
                "Layer_Mask_4": ("BOOLEAN", {"default": False}),
                "Layer_Mask_5": ("BOOLEAN", {"default": False}),
                "Layer_Mask_6": ("BOOLEAN", {"default": False}),
                "Layer_Mask_7": ("BOOLEAN", {"default": False}),
                "Layer_Mask_8": ("BOOLEAN", {"default": False}),
                "Layer_Mask_9": ("BOOLEAN", {"default": False}),
                "Layer_Mask_10": ("BOOLEAN", {"default": False}),
                "Layer_Mask_11": ("BOOLEAN", {"default": False}),
                "Layer_Mask_12": ("BOOLEAN", {"default": False}),
                "Layer_Mask_13": ("BOOLEAN", {"default": False}),
                "Layer_Mask_14": ("BOOLEAN", {"default": False}),
                "Layer_Mask_15": ("BOOLEAN", {"default": False}),
                "Layer_Mask_16": ("BOOLEAN", {"default": False}),
            }
        }

    RETURN_TYPES = ("MASK",)
    RETURN_NAMES = ("output_mask",)
    FUNCTION = "blend_masks"
    CATEGORY = "XISER_Nodes/ImageAndMask"

    def blend_masks(self, invert_output, masks, **kwargs):
        batch_size = masks.shape[0] if masks.dim() == 3 else 1
        if batch_size < 1:
            raise ValueError("At least one mask must be provided.")
        
        if torch.isnan(masks).any() or torch.isinf(masks).any():
            raise ValueError("Input masks contain NaN or Inf values.")
        masks = torch.clamp(masks, 0.0, 1.0)
        
        if self.DEBUG:
            print(f"Input masks shape: {masks.shape}, min: {masks.min().item()}, max: {masks.max().item()}")
        
        enables = [kwargs.get(f"Layer_Mask_{i+1}", False) for i in range(batch_size)]
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
                    print(f"Layer {i+1}, Enable: {enable}, Upper Opacity Max: {upper_opacity.max().item()}, Visible Part Max: {visible_part.max().item()}")
                output_mask = output_mask + visible_part
        
        output_mask = torch.clamp(output_mask, 0.0, 1.0)
        if self.DEBUG:
            print(f"Output mask min: {output_mask.min().item()}, max: {output_mask.max().item()}")
        
        if invert_output:
            output_mask = 1.0 - output_mask
        
        return (output_mask,)

# 将多个图像和蒙版打包成一个 IMAGE 对象
class XIS_PackImages:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "invert_mask": ("BOOLEAN", {"default": False, "label_on": "Invert", "label_off": "Normal"}),
                "before_pack_images": ("BOOLEAN", {"default": False, "label_on": "on", "label_off": "off"}),
            },
            "optional": {
                "pack_images": ("IMAGE", {"default": None}),
                "image1": ("IMAGE", {"default": None}),
                "mask1": ("MASK", {"default": None}),
                "image2": ("IMAGE", {"default": None}),
                "mask2": ("MASK", {"default": None}),
                "image3": ("IMAGE", {"default": None}),
                "mask3": ("MASK", {"default": None}),
                "image4": ("IMAGE", {"default": None}),
                "mask4": ("MASK", {"default": None}),
                "image5": ("IMAGE", {"default": None}),
                "mask5": ("MASK", {"default": None}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("pack_images",)
    FUNCTION = "pack_images"
    CATEGORY = "XISER_Nodes/Canvas"

    def pack_images(self, invert_mask, before_pack_images, image1=None, pack_images=None, 
                    mask1=None, image2=None, mask2=None, image3=None, mask3=None, 
                    image4=None, mask4=None, image5=None, mask5=None):
        
        # 收集当前节点的图像和蒙版输入
        input_images = [image1, image2, image3, image4, image5]
        input_masks = [mask1, mask2, mask3, mask4, mask5]
        
        # 过滤掉 None 的图像输入
        images = [img for img in input_images if img is not None]
        
        # 检查是否有有效的图像输入
        if not images and (pack_images is None or not pack_images):
            logger.error("No valid images provided (all image inputs and pack_images are None)")
            raise ValueError("At least one valid image must be provided")

        # 初始化输出图像列表
        normalized_images = []

        # 根据 before_pack_images 的值决定添加顺序
        if not before_pack_images:
            # 默认行为：pack_images 在前，image1 到 image5 在后
            if pack_images is not None:
                if not isinstance(pack_images, (list, tuple)):
                    logger.error(f"Invalid pack_images type: expected list or tuple, got {type(pack_images)}")
                    raise ValueError("pack_images must be a list or tuple")
                normalized_images.extend(pack_images)
        
        # 规范化当前节点的图像和蒙版
        for idx, img in enumerate(images):
            if not isinstance(img, torch.Tensor):
                logger.error(f"Invalid image type: expected torch.Tensor, got {type(img)}")
                raise ValueError("All images must be torch.Tensor")

            # 确保图像维度正确
            if len(img.shape) == 3:  # (H, W, C)
                img = img.unsqueeze(0)  # 转换为 (1, H, W, C)
            elif len(img.shape) != 4:  # (N, H, W, C)
                logger.error(f"Invalid image dimensions: {img.shape}")
                raise ValueError(f"Image has invalid dimensions: {img.shape}")

            # 获取对应蒙版
            mask = input_masks[idx]

            # 处理每个批次中的图像
            for i in range(img.shape[0]):
                single_img = img[i]  # (H, W, C)
                
                # 处理蒙版
                alpha = None
                if mask is not None:
                    if not isinstance(mask, torch.Tensor):
                        logger.error(f"Invalid mask type: expected torch.Tensor, got {type(mask)}")
                        raise ValueError("Mask must be torch.Tensor")
                    
                    # 确保蒙版维度正确
                    mask_dim = len(mask.shape)
                    if mask_dim == 2:  # (H, W)
                        mask = mask.unsqueeze(0)  # 转换为 (1, H, W)
                    elif mask_dim == 3:  # (N, H, W)
                        pass
                    else:
                        logger.error(f"Invalid mask dimensions: {mask.shape}")
                        raise ValueError(f"Mask has invalid dimensions: {mask.shape}")

                    # 获取对应批次的蒙版
                    single_mask = mask[i] if mask.shape[0] > i else mask[0]
                    
                    # 检查是否为 64x64 全 0 蒙版
                    if single_mask.shape == (64, 64) and torch.all(single_mask == 0):
                        alpha = None  # 视为无蒙版输入
                    else:
                        # 确保蒙版尺寸与图像匹配（除非是 64x64 全 0）
                        if single_mask.shape != single_img.shape[:2]:
                            logger.error(f"Mask size {single_mask.shape} does not match image size {single_img.shape[:2]}")
                            raise ValueError("Mask size must match image size")
                        
                        # 规范化蒙版为单通道
                        alpha = single_mask.unsqueeze(-1)  # (H, W, 1)
                        if alpha.max() > 1.0 or alpha.min() < 0.0:
                            alpha = (alpha - alpha.min()) / (alpha.max() - alpha.min() + 1e-8)  # 归一化到 [0,1]
                        
                        # 如果 invert_mask 为 True，进行蒙版反转
                        if invert_mask:
                            alpha = 1.0 - alpha

                # 处理图像通道
                if single_img.shape[-1] == 3:  # RGB
                    if alpha is None:
                        alpha = torch.ones_like(single_img[..., :1])  # 默认全 1 Alpha 通道
                    single_img = torch.cat([single_img, alpha], dim=-1)  # 转换为 RGBA
                elif single_img.shape[-1] == 4:  # RGBA
                    if alpha is not None:
                        # 替换 Alpha 通道
                        single_img = torch.cat([single_img[..., :3], alpha], dim=-1)
                else:
                    logger.error(f"Image has invalid channels: {single_img.shape[-1]}")
                    raise ValueError(f"Image has invalid channels: {single_img.shape[-1]}")
                
                normalized_images.append(single_img)

        # 如果 before_pack_images 为 True，将 pack_images 添加到末尾
        if before_pack_images and pack_images is not None:
            if not isinstance(pack_images, (list, tuple)):
                logger.error(f"Invalid pack_images type: expected list or tuple, got {type(pack_images)}")
                raise ValueError("pack_images must be a list or tuple")
            normalized_images.extend(pack_images)

        logger.info(f"Packed {len(normalized_images)} images for canvas")
        return (normalized_images,)


class XIS_MergePackImages:
    """A custom node to merge up to 5 pack_images inputs into a single pack_images output."""

    def __init__(self):
        """Initialize the node instance."""
        self.instance_id = uuid.uuid4().hex
        logger.info(f"Instance {self.instance_id} - XIS_MergePackImages initialized")

    @classmethod
    def INPUT_TYPES(cls) -> dict:
        """Define input types for the node, matching XIS_ImageManager's data type."""
        return {
            "optional": {
                "pack_images_1": ("IMAGE", {"default": None}),
                "pack_images_2": ("IMAGE", {"default": None}),
                "pack_images_3": ("IMAGE", {"default": None}),
                "pack_images_4": ("IMAGE", {"default": None}),
                "pack_images_5": ("IMAGE", {"default": None}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("pack_images",)
    FUNCTION = "merge_images"
    CATEGORY = "XISER_Nodes/Canvas"
    OUTPUT_NODE = True

    def merge_images(
        self,
        pack_images_1: Optional[List[torch.Tensor]] = None,
        pack_images_2: Optional[List[torch.Tensor]] = None,
        pack_images_3: Optional[List[torch.Tensor]] = None,
        pack_images_4: Optional[List[torch.Tensor]] = None,
        pack_images_5: Optional[List[torch.Tensor]] = None,
    ) -> Tuple[List[torch.Tensor], torch.Tensor]:
        """
        Merge multiple pack_images inputs into a single pack_images output.

        Args:
            pack_images_1 to pack_images_5: Optional list of torch.Tensor, each of shape [H, W, 4] (RGBA).

        Returns:
            A tuple containing:
            - List of merged torch.Tensor images (IMAGE).
            - torch.Tensor of merged images (IMAGE) if all images have the same size, else empty tensor.
        """
        logger.debug(f"Instance {self.instance_id} - Merging pack_images inputs")

        # 收集所有非空输入
        input_packs = [
            (i + 1, pack) for i, pack in enumerate([pack_images_1, pack_images_2, pack_images_3, pack_images_4, pack_images_5])
            if pack is not None and isinstance(pack, list) and pack
        ]

        if not input_packs:
            logger.info(f"Instance {self.instance_id} - No valid pack_images inputs provided, returning empty outputs")
            return ([], torch.empty(0, 0, 0, 4))

        # 验证输入格式并收集图像
        merged_images = []
        image_sizes = []
        for port_idx, pack in input_packs:
            if not all(isinstance(img, torch.Tensor) for img in pack):
                logger.error(f"Instance {self.instance_id} - Invalid image type in pack_images_{port_idx}: expected list of torch.Tensor")
                raise ValueError(f"pack_images_{port_idx} must contain torch.Tensor images")
            for j, img in enumerate(pack):
                if len(img.shape) != 3 or img.shape[-1] != 4:
                    logger.error(f"Instance {self.instance_id} - Invalid shape for image {j} in pack_images_{port_idx}: expected [H, W, 4], got {img.shape}")
                    raise ValueError(f"Image {j} in pack_images_{port_idx} must be [H, W, 4] (RGBA)")
                merged_images.append(img)
                image_sizes.append(img.shape[:2])  # Record [H, W]
                logger.debug(f"Instance {self.instance_id} - Added image {j} from pack_images_{port_idx} with size {img.shape[:2]}")

        if not merged_images:
            logger.info(f"Instance {self.instance_id} - No images after validation, returning empty outputs")
            return ([], torch.empty(0, 0, 0, 4))

        return (merged_images,)

    @staticmethod
    def IS_CHANGED(
        pack_images_1: Optional[List[torch.Tensor]] = None,
        pack_images_2: Optional[List[torch.Tensor]] = None,
        pack_images_3: Optional[List[torch.Tensor]] = None,
        pack_images_4: Optional[List[torch.Tensor]] = None,
        pack_images_5: Optional[List[torch.Tensor]] = None,
    ) -> str:
        """Compute a hash to detect changes in inputs."""
        logger.debug(f"IS_CHANGED called for XIS_MergePackImages")
        try:
            hasher = hashlib.sha256()
            for i, pack in enumerate([pack_images_1, pack_images_2, pack_images_3, pack_images_4, pack_images_5], 1):
                if pack is None or not pack:
                    hasher.update(f"pack_images_{i}_empty".encode('utf-8'))
                    continue
                if not isinstance(pack, list):
                    logger.warning(f"Invalid pack_images_{i} type: {type(pack)}")
                    hasher.update(f"pack_images_{i}_invalid_{id(pack)}".encode('utf-8'))
                    continue
                hasher.update(f"pack_images_{i}_len_{len(pack)}".encode('utf-8'))
                for j, img in enumerate(pack):
                    if isinstance(img, torch.Tensor):
                        hasher.update(str(img.shape).encode('utf-8'))
                        sample_data = img.cpu().numpy().flatten()[:100].tobytes()
                        hasher.update(sample_data)
                    else:
                        logger.warning(f"Invalid image type at index {j} in pack_images_{i}: {type(img)}")
                        hasher.update(f"img_{j}_invalid_{id(img)}".encode('utf-8'))
            hash_value = hasher.hexdigest()
            logger.debug(f"IS_CHANGED returning hash: {hash_value}")
            return hash_value
        except Exception as e:
            logger.error(f"IS_CHANGED failed: {e}")
            return str(time.time())


NODE_CLASS_MAPPINGS = {
    "XIS_LoadImage": XIS_LoadImage,
    "XIS_ImageStitcher": XIS_ImageStitcher,
    "XIS_ResizeToDivisible": XIS_ResizeToDivisible,
    "XIS_CropImage": XIS_CropImage,
    "XIS_InvertMask": XIS_InvertMask,
    "XIS_ImageMaskMirror": XIS_ImageMaskMirror,
    "XIS_ResizeImageOrMask": XIS_ResizeImageOrMask,
    "XIS_ReorderImageMaskGroups": XIS_ReorderImageMaskGroups,
    "XIS_MaskCompositeOperation": XIS_MaskCompositeOperation,
    "XIS_MaskBatchProcessor": XIS_MaskBatchProcessor,
    "XIS_CanvasMaskProcessor": XIS_CanvasMaskProcessor,
    "XIS_PackImages": XIS_PackImages,
    "XIS_MergePackImages": XIS_MergePackImages,
}