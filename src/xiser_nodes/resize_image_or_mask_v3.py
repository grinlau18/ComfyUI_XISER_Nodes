"""图像和蒙版缩放处理节点 - V3版本
支持单个图像、蒙版以及 pack_images 数据的批量缩放
"""

from comfy_api.v0_0_2 import io, ui
import torch
import torch.nn.functional as F
import numpy as np
from typing import Optional, Tuple, Union, List
import math
from .utils import standardize_tensor, hex_to_rgb, resize_tensor, INTERPOLATION_MODES, logger

INTERPOLATION_MODES = {
    "nearest": "nearest",
    "bilinear": "bilinear",
    "bicubic": "bicubic",
    "area": "area",
    "nearest_exact": "nearest-exact",
    "lanczos": "lanczos",
}


class XIS_ResizeImageOrMaskV3(io.ComfyNode):
    """图像或蒙版缩放节点，支持多种缩放模式和插值方法"""

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点架构"""
        return io.Schema(
            node_id="XIS_ResizeImageOrMask",
            display_name="Resize Image Or Mask",
            category="XISER_Nodes/Image_And_Mask",
            description="图像和蒙版缩放处理，支持多种缩放模式和插值方法",
            inputs=[
                io.Combo.Input("resize_mode",
                             options=["force_resize", "scale_proportionally", "limited_by_canvas", "fill_the_canvas", "total_pixels"],
                             default="force_resize",
                             tooltip="调整模式"),
                io.Combo.Input("scale_condition",
                             options=["downscale_only", "upscale_only", "always"],
                             default="always",
                             tooltip="缩放条件"),
                io.Combo.Input("interpolation",
                             options=list(INTERPOLATION_MODES.keys()),
                             default="bilinear",
                             tooltip="插值方法"),
                io.Int.Input("min_unit",
                           default=16,
                           min=1,
                           max=64,
                           step=1,
                           tooltip="最小单位尺寸"),
                io.Image.Input("image",
                             optional=True,
                             tooltip="输入图像"),
                io.Mask.Input("mask",
                            optional=True,
                            tooltip="输入蒙版"),
                io.Image.Input("pack_images",
                             optional=True,
                             tooltip="输入图像包"),
                io.Image.Input("reference_image",
                             optional=True,
                             tooltip="参考图像"),
                io.Int.Input("manual_width",
                           default=512,
                           min=1,
                           max=4096,
                           step=1,
                           optional=True,
                           tooltip="手动指定宽度"),
                io.Int.Input("manual_height",
                           default=512,
                           min=1,
                           max=4096,
                           step=1,
                           optional=True,
                           tooltip="手动指定高度"),
                io.String.Input("fill_hex",
                              default="#000000",
                              tooltip="填充颜色（HEX格式）")
            ],
            outputs=[
                io.Image.Output(display_name="resized_image", is_output_list=True),  # 第一个输出是列表
                io.Mask.Output(display_name="resized_mask"),
                io.Int.Output(display_name="width"),
                io.Int.Output(display_name="height"),
                io.Image.Output(display_name="pack_images")
            ]
        )

    @classmethod
    def execute(cls, resize_mode: str, scale_condition: str, interpolation: str, min_unit: int,
                image: Optional[torch.Tensor] = None, mask: Optional[torch.Tensor] = None,
                pack_images: Optional[List[torch.Tensor]] = None,
                reference_image: Optional[torch.Tensor] = None, manual_width: Optional[int] = None,
                manual_height: Optional[int] = None, fill_hex: str = "#000000") -> io.NodeOutput:
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
            manual_width (Optional[int]): 手动指定的目标宽度
            manual_height (Optional[int]): 手动指定的目标高度
            fill_hex (str): 填充颜色，十六进制格式

        Returns:
            io.NodeOutput: (调整后的图像列表, 调整后的蒙版, 输出宽度, 输出高度, 调整后的图像包)
        """
        # 调试日志：检查输入参数
        logger.debug(f"Input check - image: {image is not None}, mask: {mask is not None}, pack_images: {pack_images is not None}")
        if pack_images is not None:
            logger.debug(f"pack_images type: {type(pack_images)}, length: {len(pack_images) if hasattr(pack_images, '__len__') else 'N/A'}")

        # 处理 pack_images 输入
        resized_pack_images = None
        all_resized_images = []  # 用于存储所有处理后的图像，包括主图像和pack_images

        if pack_images is not None and len(pack_images) > 0:
            if not isinstance(pack_images, (list, tuple)):
                logger.error(f"Invalid pack_images type: expected list or tuple, got {type(pack_images)}")
                raise ValueError("pack_images must be a list or tuple")

            logger.debug(f"Processing pack_images with {len(pack_images)} images")

            # 获取目标尺寸用于 pack_images 处理
            target_width, target_height = cls._get_target_size(
                reference_image, manual_width, manual_height
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
                processed_img = cls._process_single_image(
                    img_4d, resize_mode, scale_condition, interpolation, min_unit,
                    target_width, target_height, fill_hex
                )

                if processed_img is not None:
                    # 转换回 3D 张量
                    resized_img_3d = processed_img.squeeze(0)
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
        elif manual_width is not None and manual_height is not None:
            target_width, target_height = manual_width, manual_height
        else:
            raise ValueError("Must provide either reference_image or both manual_width and manual_height")

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
                # Default to transparent alpha for RGBA to preserve transparency
                return torch.cat([base, torch.zeros(1, device=device, dtype=dtype)])
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

            if should_resize(orig_w, orig_h, target_width, target_height):
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

        return io.NodeOutput(
            resized_img_list,  # 列表输出
            resized_mask,      # 单个蒙版输出
            final_width,       # 单个整数输出
            final_height,      # 单个整数输出
            resized_pack_images  # 图像包输出
        )

    @classmethod
    def _get_target_size(cls, reference_image: Optional[torch.Tensor], manual_width: Optional[int], manual_height: Optional[int]) -> Tuple[int, int]:
        """获取目标尺寸"""
        if reference_image is not None:
            if reference_image.dim() != 4:
                raise ValueError(f"reference_image must be 4D [B, H, W, C], got {reference_image.shape}")
            target_width, target_height = reference_image.shape[2], reference_image.shape[1]
        elif manual_width is not None and manual_height is not None:
            target_width, target_height = manual_width, manual_height
        else:
            raise ValueError("Must provide either reference_image or both manual_width and manual_height")
        return target_width, target_height

    @classmethod
    def _process_single_image(cls, image: torch.Tensor, resize_mode: str, scale_condition: str, interpolation: str,
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
                # Default to transparent alpha for RGBA to preserve transparency
                return torch.cat([base, torch.zeros(1, device=device, dtype=dtype)])
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


# ============================================================================
# 节点列表（用于Extension注册）
# ============================================================================

# 所有V3图像缩放节点
V3_NODE_CLASSES = [
    XIS_ResizeImageOrMaskV3,
]

# 节点ID到类的映射（用于向后兼容或参考）
V3_NODE_MAPPINGS = {
    cls.define_schema().node_id: cls
    for cls in V3_NODE_CLASSES
}