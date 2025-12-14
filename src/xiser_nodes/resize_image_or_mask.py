"""
ResizeImageOrMask 节点 - 图像和蒙版缩放处理
支持单个图像、蒙版以及 pack_images 数据的批量缩放
"""

import torch
import torch.nn.functional as F
import numpy as np
from typing import Optional, Tuple, Union, List
import math
from comfy_api.latest import io, ComfyExtension
from .utils import standardize_tensor, hex_to_rgb, resize_tensor, INTERPOLATION_MODES, logger

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
                "resize_mode": (["force_resize", "scale_proportionally", "limited_by_canvas", "fill_the_canvas", "total_pixels"], {"default": "force_resize"}),
                "scale_condition": (["downscale_only", "upscale_only", "always"], {"default": "always"}),
                "interpolation": (list(INTERPOLATION_MODES.keys()), {"default": "bilinear"}),
                "min_unit": ("INT", {"default": 16, "min": 1, "max": 64, "step": 1}),
            },
            "optional": {
                "image": ("IMAGE",),
                "mask": ("MASK",),
                "pack_images": ("IMAGE",),
                "reference_image": ("IMAGE",),
                "scale_width": ("INT", {"default": 512, "min": 1, "max": 65536, "step": 1}),
                "scale_height": ("INT", {"default": 512, "min": 1, "max": 65536, "step": 1}),
                "fill_hex": ("STRING", {"default": "#000000"}),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK", "INT", "INT", "IMAGE")
    RETURN_NAMES = ("resized_image", "resized_mask", "width", "height", "pack_images")
    OUTPUT_IS_LIST = (True, False, False, False, False)
    FUNCTION = "resize_image_or_mask"
    CATEGORY = "XISER_Nodes/Image_And_Mask"

    def resize_image_or_mask(self, resize_mode: str, scale_condition: str, interpolation: str, min_unit: int,
                            image: Optional[torch.Tensor] = None, mask: Optional[torch.Tensor] = None,
                            pack_images: Optional[List[torch.Tensor]] = None,
                            reference_image: Optional[torch.Tensor] = None, scale_width: Optional[int] = None,
                            scale_height: Optional[int] = None, fill_hex: str = "#000000") -> Tuple:
        """
        调整图像或蒙版的尺寸，并返回调整后的图像、蒙版以及实际的宽度和高度。

        Args:
            resize_mode (str): 调整模式（强制调整、按比例缩放、限制在画布内、填充画布）
            scale_condition (str): 缩放条件（仅缩小、仅放大、总是缩放）
            interpolation (str): 插值方法
            min_unit (int): 最小单位尺寸，用于对齐
            image (Optional[torch.Tensor]): 输入图像，形状为 [B, H, W, C]
            mask (Optional[torch.Tensor]): 输入蒙版，形状为 [H, W] 或 [B, H, W]
            pack_images (Optional[List[torch.Tensor]]): 输入图像包，包含多个图像
            reference_image (Optional[torch.Tensor]): 参考图像，用于确定目标尺寸
            scale_width (Optional[int]): 手动指定的目标宽度
            scale_height (Optional[int]): 手动指定的目标高度
            fill_hex (str): 填充颜色，十六进制格式

        Returns:
            Tuple: (调整后的图像, 调整后的蒙版, 输出宽度, 输出高度, 调整后的图像包, 图像列表)
        """
        # 调试日志：检查输入参数
        logger.debug(f"Input check - image: {image is not None}, mask: {mask is not None}, pack_images: {pack_images is not None}")
        if pack_images is not None:
            logger.debug(f"pack_images type: {type(pack_images)}, length: {len(pack_images) if hasattr(pack_images, '__len__') else 'N/A'}")

        # 处理 v3 节点数据格式
        def _unwrap_v3_data(data):
            """处理 v3 节点返回的数据格式，支持 io.NodeOutput 和原始数据"""
            if data is None:
                return None
            if hasattr(data, 'outputs') and isinstance(data.outputs, tuple):
                # io.NodeOutput 对象
                return data.outputs[0]
            elif isinstance(data, tuple) and len(data) == 1:
                # 可能是 (data,) 格式
                return data[0]
            else:
                # 原始数据
                return data

        # 解包 v3 数据格式
        pack_images = _unwrap_v3_data(pack_images)
        reference_image = _unwrap_v3_data(reference_image) if reference_image is not None else None

        # 处理 pack_images 输入
        resized_pack_images = None
        all_resized_images = []  # 用于存储所有处理后的图像，包括主图像和pack_images

        if pack_images is not None and len(pack_images) > 0:
            if not isinstance(pack_images, (list, tuple)):
                logger.error(f"Invalid pack_images type: expected list or tuple, got {type(pack_images)}")
                raise ValueError("pack_images must be a list or tuple")

            logger.debug(f"Processing pack_images with {len(pack_images)} images")

            # 获取目标尺寸用于 pack_images 处理
            target_width, target_height = self._get_target_size(
                reference_image, scale_width, scale_height
            )

            # 处理每个 pack_images 中的图像
            resized_pack_images = []
            for img in pack_images:
                if not isinstance(img, torch.Tensor):
                    logger.error(f"Invalid image type in pack_images: expected torch.Tensor, got {type(img)}")
                    raise ValueError("All pack_images items must be torch.Tensor")

                # 确保图像是 3D 张量 (H, W, C)
                if len(img.shape) != 3:
                    logger.error(f"Invalid image dimensions in pack_images: {img.shape}, expected (H, W, C)")
                    raise ValueError("Each pack_images item must be a 3D tensor (H, W, C)")

                # 确保图像有 3 或 4 个通道
                if img.shape[-1] not in (3, 4):
                    logger.error(f"Invalid channel count in pack_images: {img.shape[-1]}, expected 3 or 4")
                    raise ValueError("Each pack_images item must have 3 or 4 channels")

                # 转换为 4D 张量用于处理
                img_4d = img.unsqueeze(0)  # (1, H, W, C)

                # 使用现有的图像处理逻辑
                processed_img = self._process_single_image(
                    img_4d, resize_mode, scale_condition, interpolation, min_unit,
                    target_width, target_height, fill_hex
                )

                if processed_img is not None:
                    # 转换回 3D 张量
                    resized_img_3d = processed_img.squeeze(0)
                    # 确保 RGBA
                    if resized_img_3d.shape[-1] == 3:
                        alpha = torch.ones_like(resized_img_3d[..., :1])
                        resized_img_3d = torch.cat([resized_img_3d, alpha], dim=-1)
                    if resized_img_3d.shape[-1] != 4:
                        logger.error(f"Invalid channel count after resize: {resized_img_3d.shape[-1]}")
                        raise ValueError("Resized pack_images items must have 4 channels (RGBA)")
                    resized_img_3d = resized_img_3d.clamp(0.0, 1.0)
                    resized_pack_images.append(resized_img_3d)
                    # 添加到所有图像列表中（保持为4D张量）
                    all_resized_images.append(processed_img)
        else:
            logger.debug(f"pack_images is None or empty: {pack_images is None}, length: {len(pack_images) if pack_images is not None else 0}")

        # 检查是否有任何有效输入
        if image is None and mask is None and (pack_images is None or len(pack_images) == 0):
            raise ValueError("At least one of 'image', 'mask', or 'pack_images' must be provided")

        # 确保 min_unit 不小于 1
        min_unit = max(1, min_unit)

        # 获取目标尺寸
        if reference_image is not None:
            if reference_image.dim() != 4:
                raise ValueError(f"reference_image must be 4D [B, H, W, C], got {reference_image.shape}")
            target_width, target_height = reference_image.shape[2], reference_image.shape[1]
        elif scale_width is not None and scale_height is not None:
            target_width, target_height = scale_width, scale_height
        else:
            raise ValueError("Must provide either reference_image or both scale_width and scale_height")

        raw_target_width, raw_target_height = target_width, target_height
        target_pixels = max(1, raw_target_width * raw_target_height)

        # 确保目标尺寸按 min_unit 对齐
        target_width = max(1, (target_width + min_unit - 1) // min_unit * min_unit)
        target_height = max(1, (target_height + min_unit - 1) // min_unit * min_unit)
        base_fill_rgb = hex_to_rgb(fill_hex)

        def get_fill_color(num_channels: int, device, dtype):
            """Return fill color aligned to channel count (keep alpha if present)."""
            base = base_fill_rgb.to(device=device, dtype=dtype)
            if num_channels == base.numel():
                return base
            if num_channels == 4 and base.numel() == 3:
                # 默认填充为不透明的填充色（Alpha=1）
                return torch.cat([base, torch.ones(1, device=device, dtype=dtype)])
            if base.numel() == 1:
                return base.expand(num_channels)
            return torch.cat([base, torch.zeros(max(0, num_channels - base.numel()), device=device, dtype=dtype)])

        def compute_size(orig_w: int, orig_h: int) -> Tuple[int, int, int, int]:
            """
            计算调整后的尺寸和偏移量。

            Args:
                orig_w (int): 原始宽度
                orig_h (int): 原始高度

            Returns:
                Tuple[int, int, int, int]: (调整宽度, 调整高度, x偏移, y偏移)
            """
            aspect = orig_w / orig_h
            if resize_mode == "force_resize":
                return target_width, target_height, 0, 0
            elif resize_mode in ["scale_proportionally", "limited_by_canvas"]:
                # 以画布为边界按比例缩放，保证 w/h 不超过画布；limited_by_canvas 使用向下取整避免溢出
                scale = min(target_width / orig_w, target_height / orig_h)
                w = orig_w * scale
                h = orig_h * scale
                if resize_mode == "limited_by_canvas":
                    w = max(min_unit, int(math.floor(w / min_unit)) * min_unit)
                    h = max(min_unit, int(math.floor(h / min_unit)) * min_unit)
                    w = min(w, target_width)
                    h = min(h, target_height)
                else:
                    w = (int(round(w / min_unit)) * min_unit)
                    h = (int(round(h / min_unit)) * min_unit)
                return int(w), int(h), (target_width - int(w)) // 2, (target_height - int(h)) // 2
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
            elif resize_mode == "total_pixels":
                orig_pixels = max(1, orig_w * orig_h)
                desired_pixels = target_pixels
                base_scale = math.sqrt(desired_pixels / orig_pixels)
                ideal_w = orig_w * base_scale

                def align_to_unit(value: float) -> int:
                    return max(min_unit, int(round(value / min_unit)) * min_unit)

                candidates = []
                base_w_aligned = align_to_unit(ideal_w)
                # Explore small neighborhood to find closest pixel count while keeping aspect
                for step in (-2, -1, 0, 1, 2):
                    w_candidate = max(min_unit, base_w_aligned + step * min_unit)
                    h_candidate = align_to_unit(w_candidate / aspect)
                    pixels = w_candidate * h_candidate
                    aspect_diff = abs((w_candidate / h_candidate) - aspect)
                    candidates.append((abs(pixels - desired_pixels), aspect_diff, w_candidate, h_candidate))

                candidates.sort(key=lambda x: (x[0], x[1]))
                _, _, w, h = candidates[0]
                return w, h, 0, 0

        def should_resize(orig_w: int, orig_h: int, target_w: int, target_h: int) -> bool:
            """
            判断是否需要调整尺寸。

            Args:
                orig_w (int): 原始宽度
                orig_h (int): 原始高度
                target_w (int): 目标宽度
                target_h (int): 目标高度

            Returns:
                bool: 是否需要调整尺寸
            """
            if resize_mode == "total_pixels":
                orig_pixels = orig_w * orig_h
                desired_pixels = target_pixels
                if scale_condition == "always":
                    return True
                elif scale_condition == "downscale_only":
                    return orig_pixels > desired_pixels
                elif scale_condition == "upscale_only":
                    return orig_pixels < desired_pixels
            else:
                if scale_condition == "always":
                    return True
                elif scale_condition == "downscale_only":
                    return orig_w > target_w or orig_h > target_h
                elif scale_condition == "upscale_only":
                    return orig_w < target_w or orig_h < target_h
            return False

        resized_img = None
        final_width, final_height = target_width, target_height  # 默认值

        if image is not None:
            if image.dim() != 4:
                raise ValueError(f"Image must be 4D [B, H, W, C], got {image.shape}")
            batch_size, orig_h, orig_w, channels = image.shape
            fill_color = get_fill_color(channels, image.device, image.dtype)

            force_canvas = resize_mode == "limited_by_canvas"
            if should_resize(orig_w, orig_h, target_width, target_height) or force_canvas:
                w, h, offset_x, offset_y = compute_size(orig_w, orig_h)
                resized_img = resize_tensor(image, (h, w), INTERPOLATION_MODES[interpolation])
                if resize_mode == "limited_by_canvas":
                    fill = fill_color.view(1, 1, 1, -1).expand(batch_size, target_height, target_width, channels)
                    output = fill.clone()
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

            # 更新 final_width 和 final_height 为实际输出图像的尺寸
            final_width, final_height = resized_img.shape[2], resized_img.shape[1]

            # 将主图像添加到所有图像列表中
            all_resized_images.append(resized_img)

        resized_mask = None
        if mask is not None:
            if mask.dim() not in (2, 3):
                raise ValueError(f"Mask must be 2D [H, W] or 3D [B, H, W], got {mask.shape}")
            mask_input = mask.unsqueeze(0) if mask.dim() == 2 else mask
            batch_size, orig_h, orig_w = mask_input.shape
            mask_fill_value = torch.tensor(0.0, device=mask.device, dtype=mask.dtype)

            force_canvas = resize_mode == "limited_by_canvas"
            if should_resize(orig_w, orig_h, target_width, target_height) or force_canvas:
                w, h, offset_x, offset_y = compute_size(orig_w, orig_h)
                resized_mask = resize_tensor(mask_input.unsqueeze(-1), (h, w), INTERPOLATION_MODES[interpolation]).squeeze(-1)
                if resize_mode == "limited_by_canvas":
                    output = torch.full((batch_size, target_height, target_width), mask_fill_value, device=mask.device, dtype=mask.dtype)
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

            # 确保蒙版与图像尺寸一致（如果有图像输出）
            if resized_img is not None:
                # 检查蒙版和图像的尺寸是否一致
                if resized_mask.shape[-2:] != resized_img.shape[1:3]:
                    logger.warning(f"Mask size {resized_mask.shape[-2:]} does not match image size {resized_img.shape[1:3]}, resizing mask to match")
                    # 调整蒙版尺寸以匹配图像
                    mask_for_resize = resized_mask
                    squeeze_batch = False
                    if mask_for_resize.dim() == 2:
                        mask_for_resize = mask_for_resize.unsqueeze(0)
                        squeeze_batch = True
                    if mask_for_resize.dim() == 3:
                        mask_for_resize = mask_for_resize.unsqueeze(-1)

                    resized_mask = resize_tensor(
                        mask_for_resize,
                        (resized_img.shape[1], resized_img.shape[2]),
                        INTERPOLATION_MODES[interpolation]
                    ).squeeze(-1)

                    if squeeze_batch:
                        resized_mask = resized_mask.squeeze(0)
                # 更新最终尺寸为图像尺寸（确保一致性）
                final_width, final_height = resized_img.shape[2], resized_img.shape[1]
            else:
                # 如果没有图像输出，使用蒙版的尺寸
                final_width, final_height = resized_mask.shape[-1], resized_mask.shape[-2]

        # 如果没有 pack_images 输入，但需要输出，则返回空列表
        if resized_pack_images is None:
            resized_pack_images = []

        # 准备resized_image输出 - 返回列表形式，保持各图像的原始尺寸
        if all_resized_images:
            # 将所有处理后的图像作为列表返回，保持各自的尺寸
            resized_img_list = all_resized_images
        elif resized_img is not None:
            # 如果只有主图像，将其作为单元素列表返回
            resized_img_list = [resized_img]
        else:
            # 如果没有图像输出，返回空列表
            resized_img_list = []

        return (resized_img_list, resized_mask, final_width, final_height, resized_pack_images)

    def _get_target_size(self, reference_image: Optional[torch.Tensor], scale_width: Optional[int], scale_height: Optional[int]) -> Tuple[int, int]:
        """获取目标尺寸"""
        if reference_image is not None:
            if reference_image.dim() != 4:
                raise ValueError(f"reference_image must be 4D [B, H, W, C], got {reference_image.shape}")
            target_width, target_height = reference_image.shape[2], reference_image.shape[1]
        elif scale_width is not None and scale_height is not None:
            target_width, target_height = scale_width, scale_height
        else:
            raise ValueError("Must provide either reference_image or both scale_width and scale_height")
        return target_width, target_height

    def _process_single_image(self, image: torch.Tensor, resize_mode: str, scale_condition: str, interpolation: str,
                            min_unit: int, target_width: int, target_height: int, fill_hex: str) -> Optional[torch.Tensor]:
        """处理单个图像"""
        if image.dim() != 4:
            raise ValueError(f"Image must be 4D [B, H, W, C], got {image.shape}")

        batch_size, orig_h, orig_w, channels = image.shape
        base_fill_rgb = hex_to_rgb(fill_hex)

        def get_fill_color(num_channels: int, device, dtype):
            """Return fill color aligned to channel count (keep alpha if present)."""
            base = base_fill_rgb.to(device=device, dtype=dtype)
            if num_channels == base.numel():
                return base
            if num_channels == 4 and base.numel() == 3:
                # Default to opaque alpha for RGBA fill (alpha=1)
                return torch.cat([base, torch.ones(1, device=device, dtype=dtype)])
            if base.numel() == 1:
                return base.expand(num_channels)
            return torch.cat([base, torch.zeros(max(0, num_channels - base.numel()), device=device, dtype=dtype)])

        def compute_size(orig_w: int, orig_h: int) -> Tuple[int, int, int, int]:
            """
            计算调整后的尺寸和偏移量。

            Args:
                orig_w (int): 原始宽度
                orig_h (int): 原始高度

            Returns:
                Tuple[int, int, int, int]: (调整宽度, 调整高度, x偏移, y偏移)
            """
            aspect = orig_w / orig_h
            if resize_mode == "force_resize":
                return target_width, target_height, 0, 0
            elif resize_mode in ["scale_proportionally", "limited_by_canvas"]:
                # 以画布为边界按比例缩放，保证 w/h 不超过画布；limited_by_canvas 使用向下取整避免溢出
                scale = min(target_width / orig_w, target_height / orig_h)
                w = orig_w * scale
                h = orig_h * scale
                if resize_mode == "limited_by_canvas":
                    w = max(min_unit, int(math.floor(w / min_unit)) * min_unit)
                    h = max(min_unit, int(math.floor(h / min_unit)) * min_unit)
                    w = min(w, target_width)
                    h = min(h, target_height)
                else:
                    w = (int(round(w / min_unit)) * min_unit)
                    h = (int(round(h / min_unit)) * min_unit)
                return int(w), int(h), (target_width - int(w)) // 2, (target_height - int(h)) // 2
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
            elif resize_mode == "total_pixels":
                orig_pixels = max(1, orig_w * orig_h)
                desired_pixels = max(1, target_width * target_height)
                base_scale = math.sqrt(desired_pixels / orig_pixels)
                ideal_w = orig_w * base_scale

                def align_to_unit(value: float) -> int:
                    return max(min_unit, int(round(value / min_unit)) * min_unit)

                candidates = []
                base_w_aligned = align_to_unit(ideal_w)
                # Explore small neighborhood to find closest pixel count while keeping aspect
                for step in (-2, -1, 0, 1, 2):
                    w_candidate = max(min_unit, base_w_aligned + step * min_unit)
                    h_candidate = align_to_unit(w_candidate / aspect)
                    pixels = w_candidate * h_candidate
                    aspect_diff = abs((w_candidate / h_candidate) - aspect)
                    candidates.append((abs(pixels - desired_pixels), aspect_diff, w_candidate, h_candidate))

                candidates.sort(key=lambda x: (x[0], x[1]))
                _, _, w, h = candidates[0]
                return w, h, 0, 0
            else:
                # Default fallback for unknown resize modes
                return target_width, target_height, 0, 0

        def should_resize(orig_w: int, orig_h: int, target_w: int, target_h: int) -> bool:
            """
            判断是否需要调整尺寸。

            Args:
                orig_w (int): 原始宽度
                orig_h (int): 原始高度
                target_w (int): 目标宽度
                target_h (int): 目标高度

            Returns:
                bool: 是否需要调整尺寸
            """
            if resize_mode == "total_pixels":
                orig_pixels = orig_w * orig_h
                desired_pixels = target_w * target_h
                if scale_condition == "always":
                    return True
                elif scale_condition == "downscale_only":
                    return orig_pixels > desired_pixels
                elif scale_condition == "upscale_only":
                    return orig_pixels < desired_pixels
            else:
                if scale_condition == "always":
                    return True
                elif scale_condition == "downscale_only":
                    return orig_w > target_w or orig_h > target_h
                elif scale_condition == "upscale_only":
                    return orig_w < target_w or orig_h < target_h
            return False

        fill_color = get_fill_color(channels, image.device, image.dtype)

        if should_resize(orig_w, orig_h, target_width, target_height):
            w, h, offset_x, offset_y = compute_size(orig_w, orig_h)
            resized_img = resize_tensor(image, (h, w), INTERPOLATION_MODES[interpolation])
            if resize_mode == "limited_by_canvas":
                output = torch.full((batch_size, target_height, target_width, channels), 0, device=image.device, dtype=image.dtype)
                output.copy_(fill_color.view(1, 1, 1, -1).expand(batch_size, target_height, target_width, channels))
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

        return resized_img


class XIS_ResizeImageOrMaskV3(io.ComfyNode):
    """v3 版本：复用 legacy 逻辑，包装为 Comfy API 节点。"""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="XIS_ResizeImageOrMask",
            display_name="XIS ResizeImageOrMask",
            category="XISER_Nodes/Image_And_Mask",
            inputs=[
                io.Combo.Input("resize_mode", options=["force_resize", "scale_proportionally", "limited_by_canvas", "fill_the_canvas", "total_pixels"], default="force_resize", optional=True),
                io.Combo.Input("scale_condition", options=["downscale_only", "upscale_only", "always"], default="always", optional=True),
                io.Combo.Input("interpolation", options=list(INTERPOLATION_MODES.keys()), default="bilinear", optional=True),
                io.Int.Input("min_unit", default=16, min=1, max=64, step=1, optional=True),
                io.Image.Input("image", optional=True),
                io.Mask.Input("mask", optional=True),
                io.Image.Input("pack_images", optional=True),
                io.Image.Input("reference_image", optional=True),
                io.Int.Input("scale_width", default=1024, min=1, max=65536, step=1, optional=True),
                io.Int.Input("scale_height", default=1024, min=1, max=65536, step=1, optional=True),
                io.String.Input("fill_hex", default="#000000", optional=True),
            ],
            outputs=[
                io.Image.Output("resized_image", display_name="resized_image", is_output_list=True),  
                io.Mask.Output("resized_mask", display_name="resized_mask"),
                io.Int.Output("width", display_name="width"),
                io.Int.Output("height", display_name="height"),
                io.AnyType.Output("pack_images_out", display_name="pack_images_out"),
            ],
        )

    @classmethod
    def execute(cls, resize_mode, scale_condition, interpolation, min_unit,
                image=None, mask=None, pack_images=None, reference_image=None,
                scale_width=None, scale_height=None, fill_hex="#000000"):
        # 将 0 视为未填写
        scale_width = scale_width if scale_width and scale_width > 0 else None
        scale_height = scale_height if scale_height and scale_height > 0 else None
        legacy = XIS_ResizeImageOrMask()
        resized_image, resized_mask, width, height, resized_pack = legacy.resize_image_or_mask(
            resize_mode=resize_mode,
            scale_condition=scale_condition,
            interpolation=interpolation,
            min_unit=min_unit,
            image=image,
            mask=mask,
            pack_images=pack_images,
            reference_image=reference_image,
            scale_width=scale_width,
            scale_height=scale_height,
            fill_hex=fill_hex,
        )
        # v1 返回列表，保持列表语义（is_output_list=True）
        if resized_image is None:
            resized_image = []
        elif not isinstance(resized_image, list):
            resized_image = [resized_image]
        return io.NodeOutput(resized_image, resized_mask, width, height, resized_pack)


class XISResizeImageOrMaskExtension(ComfyExtension):
    async def get_node_list(self):
        return [XIS_ResizeImageOrMaskV3]


async def comfy_entrypoint():
    return XISResizeImageOrMaskExtension()


NODE_CLASS_MAPPINGS = None
NODE_DISPLAY_NAME_MAPPINGS = None
