import torch
import torch.nn.functional as F
import numpy as np
from PIL import Image
import cv2
import os
from typing import Optional, Tuple, Union, List
from .utils import standardize_tensor, hex_to_rgb, resize_tensor, INTERPOLATION_MODES, logger

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
}