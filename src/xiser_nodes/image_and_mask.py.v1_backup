import torch
import torch.nn.functional as F
import numpy as np
from PIL import Image, ImageDraw
import cv2
import os
from typing import Optional, Tuple, Union, List
import math
from .utils import standardize_tensor, hex_to_rgb, resize_tensor, INTERPOLATION_MODES, logger
from .canvas_mask_processor import XIS_CanvasMaskProcessor

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
    CATEGORY = "XISER_Nodes/Image_And_Mask"

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
    CATEGORY = "XISER_Nodes/Image_And_Mask"

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
    CATEGORY = "XISER_Nodes/Image_And_Mask"

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
    CATEGORY = "XISER_Nodes/Image_And_Mask"

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
    CATEGORY = "XISER_Nodes/Image_And_Mask"

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

    CATEGORY = "XISER_Nodes/Image_And_Mask"

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
    CATEGORY = "XISER_Nodes/Image_And_Mask"

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
    CATEGORY = "XISER_Nodes/Image_And_Mask"

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
    

# 这是一个图像合成处理器，能对输入图像执行缩放、旋转等操作，并将处理后的图像放置在指定尺寸和颜色的画布上，最终输出合成结果。
class XIS_CompositorProcessor:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),  # 目标图片输入，ComfyUI 的 IMAGE 类型
                "x": ("INT", {"default": 0, "min": -9999, "max": 9999, "step": 1}),  # 中心点 x 坐标
                "y": ("INT", {"default": 0, "min": -9999, "max": 9999, "step": 1}),  # 中心点 y 坐标
                "width": ("INT", {"default": 512, "min": 1, "max": 4096, "step": 1}),  # 缩放宽度
                "height": ("INT", {"default": 512, "min": 1, "max": 4096, "step": 1}),  # 缩放高度
                "angle": ("INT", {"default": 0, "min": -360, "max": 360, "step": 1}),  # 旋转角度
                "canvas_width": ("INT", {"default": 512, "min": 1, "max": 4096, "step": 1}),  # 画板宽度
                "canvas_height": ("INT", {"default": 512, "min": 1, "max": 4096, "step": 1}),  # 画板高度
                "background_color": ("STRING", {"default": "#FFFFFF"}),  # 画板底色（HEX 值）
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("output_image",)
    FUNCTION = "transform_image"
    CATEGORY = "XISER_Nodes/Image_And_Mask"

    def transform_image(self, image, x, y, width, height, angle, canvas_width, canvas_height, background_color):
        # 将 ComfyUI 的 IMAGE 类型（torch.Tensor）转换为 PIL 图像
        image_tensor = image[0]  # 假设批量大小为 1，取第一张图
        image_np = image_tensor.cpu().numpy() * 255  # 转换为 0-255 范围
        image_np = image_np.astype(np.uint8)
        pil_image = Image.fromarray(image_np)

        # 确保 width 和 height 大于 0
        width = max(1, width)
        height = max(1, height)

        # 创建画板
        try:
            # 验证并转换 HEX 颜色值
            bg_color = tuple(int(background_color.lstrip('#')[i:i+2], 16) for i in (0, 2, 4))
        except ValueError:
            bg_color = (255, 255, 255)  # 默认白色，如果 HEX 值无效
        canvas = Image.new("RGB", (canvas_width, canvas_height), bg_color)

        # 缩放目标图片
        resized_image = pil_image.resize((width, height), Image.Resampling.LANCZOS)

        # 旋转目标图片
        rotated_image = resized_image.rotate(-angle, expand=True, resample=Image.Resampling.BICUBIC)

        # 计算放置位置（x, y 是中心点）
        rot_width, rot_height = rotated_image.size
        paste_x = x - rot_width // 2
        paste_y = y - rot_height // 2

        # 将旋转后的图片粘贴到画板上
        canvas.paste(rotated_image, (paste_x, paste_y), rotated_image if rotated_image.mode == "RGBA" else None)

        # 将 PIL 图像转换回 ComfyUI 的 IMAGE 类型
        output_np = np.array(canvas).astype(np.float32) / 255.0  # 转换为 0-1 范围
        output_tensor = torch.from_numpy(output_np).unsqueeze(0)  # 添加批次维度

        return (output_tensor,)
    

NODE_CLASS_MAPPINGS = {
    "XIS_LoadImage": XIS_LoadImage,
    "XIS_ResizeToDivisible": XIS_ResizeToDivisible,
    "XIS_CropImage": XIS_CropImage,
    "XIS_InvertMask": XIS_InvertMask,
    "XIS_ImageMaskMirror": XIS_ImageMaskMirror,
    "XIS_ReorderImageMaskGroups": XIS_ReorderImageMaskGroups,
    "XIS_MaskCompositeOperation": XIS_MaskCompositeOperation,
    "XIS_MaskBatchProcessor": XIS_MaskBatchProcessor,
    "XIS_CanvasMaskProcessor": XIS_CanvasMaskProcessor,
    "XIS_CompositorProcessor": XIS_CompositorProcessor,
}
