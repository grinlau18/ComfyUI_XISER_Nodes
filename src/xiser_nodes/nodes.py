print("Loading XISER Nodes...")

import torch
import torch.nn.functional as F
from torchvision.transforms.functional import resize
from typing import List, Union, Tuple, Optional
import logging
import numpy as np
import comfy.samplers
import comfy.utils
from PIL import Image, ImageFilter, ImageOps
import cv2

# 设置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("XISER_Nodes")

# 通用工具函数
def hex_to_rgb(hex_str: str) -> torch.Tensor:
    """将HEX颜色转换为RGB张量（0-1范围）。"""
    hex_str = hex_str.lstrip('#')
    if len(hex_str) != 6:
        raise ValueError("HEX color must be in #RRGGBB format")
    return torch.tensor([int(hex_str[i:i+2], 16) / 255.0 for i in (0, 2, 4)], dtype=torch.float32)


# 使用蒙版去底并裁剪，支持蒙版反转和背景颜色填充
class XIS_CropImage:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "mask": ("MASK",),
                "invert_mask": ("BOOLEAN", {"default": False}),
                "background_color": ("STRING", {"default": "#000000"}),
                "padding_width": ("INT", {"default": 0, "min": 0, "max": 1024, "step": 1}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "process"
    CATEGORY = "XISER_Nodes"

    def process(self, image, mask, invert_mask, background_color, padding_width):
        image = image[0]  # [H, W, C]
        mask = mask[0]    # [H, W]
        device = image.device

        # 标准化蒙版值域到 [0, 1]
        mask = mask.to(device=device, dtype=torch.float32)
        if mask.max() > 1.0:
            mask = mask / 255.0
        mask = mask.clamp(0, 1)

        # 调整蒙版尺寸以匹配图像
        if mask.shape != image.shape[:2]:
            mask = F.interpolate(
                mask.unsqueeze(0).unsqueeze(0),
                size=image.shape[:2],
                mode="bilinear",
                antialias=True
            ).squeeze(0).squeeze(0)

        # 反转蒙版（如果需要）
        if invert_mask:
            mask = 1 - mask

        # 检查蒙版是否全为 0 或全为 1
        mask_sum = mask.sum()
        if mask_sum == 0:  # 全为 0，返回纯色背景
            rgb_color = hex_to_rgb(background_color).to(device)
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
        rgb_color = hex_to_rgb(background_color).to(device)
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

# 判断是否有信号接入，否则输出默认值
class XIS_IsThereAnyData:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "default_int": ("INT", {"default": 0, "min": -2147483648, "max": 2147483647, "step": 1}),
                "default_float": ("FLOAT", {"default": 0.0, "min": -1e10, "max": 1e10, "step": 0.01}),
                "default_boolean": ("BOOLEAN", {"default": False}),
            },
            "optional": {
                "int_input": ("INT",),
                "float_input": ("FLOAT",),
                "boolean_input": ("BOOLEAN",),
            }
        }

    RETURN_TYPES = ("INT", "FLOAT", "BOOLEAN")
    RETURN_NAMES = ("int_output", "float_output", "boolean_output")
    FUNCTION = "select_value"
    CATEGORY = "XISER_Nodes"

    def select_value(self, default_int, default_float, default_boolean, 
                     int_input=None, float_input=None, boolean_input=None):
        int_output = int_input if int_input is not None else default_int
        float_output = float_input if float_input is not None else default_float
        boolean_output = boolean_input if boolean_input is not None else default_boolean
        return (int_output, float_output, boolean_output)



class XIS_IfDataIsNone:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "data_type": (["INT", "FLOAT", "BOOLEAN", "STRING"], {"default": "STRING"}),  # 移除 NUMBER，避免类型歧义
                "default_value": ("STRING", {"default": "0"}),
            },
            "optional": {
                "signal": ("*", {"default": None}),
            }
        }

    RETURN_TYPES = ("BOOLEAN", "INT", "FLOAT", "BOOLEAN", "STRING")
    RETURN_NAMES = ("is_not_null", "int_output", "float_output", "boolean_output", "string_output")
    FUNCTION = "check_signal"
    CATEGORY = "XISER_Nodes"

    def check_signal(self, data_type, default_value, signal=None):
        is_not_null = signal is not None
        value_to_convert = signal if is_not_null else default_value

        # 如果是列表，逐项转换；否则按单一值处理
        if isinstance(value_to_convert, (list, tuple)):
            result = [self.convert_single_item(item, data_type) for item in value_to_convert]
        else:
            result = self.convert_single_item(value_to_convert, data_type)

        # 根据 data_type 返回对应类型的输出，其他端口返回默认值
        int_output = result if data_type == "INT" else (0 if not isinstance(result, list) else [0] * len(result))
        float_output = result if data_type == "FLOAT" else (0.0 if not isinstance(result, list) else [0.0] * len(result))
        boolean_output = result if data_type == "BOOLEAN" else (False if not isinstance(result, list) else [False] * len(result))
        string_output = result if data_type == "STRING" else ("" if not isinstance(result, list) else [""] * len(result))

        return (is_not_null, int_output, float_output, boolean_output, string_output)

    def convert_single_item(self, value, data_type):
        if data_type == "INT":
            return self.to_int(value)
        elif data_type == "FLOAT":
            return self.to_float(value)
        elif data_type == "BOOLEAN":
            return self.to_boolean(value)
        elif data_type == "STRING":
            return self.to_string(value)
        return value

    def to_int(self, value):
        try:
            return int(float(value))
        except (ValueError, TypeError):
            return 0

    def to_float(self, value):
        try:
            return float(value)
        except (ValueError, TypeError):
            return 0.0

    def to_boolean(self, value):
        if isinstance(value, bool):
            return value
        try:
            return str(value).lower() in ("true", "1")
        except:
            return False

    def to_string(self, value):
        return str(value)



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
    CATEGORY = "XISER_Nodes"

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
    CATEGORY = "XISER_Nodes"

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
    CATEGORY = "XISER_Nodes"

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

# 对图像和蒙版进行指定的缩放操作
def resize_tensor(tensor: torch.Tensor, size: Tuple[int, int], mode: str = "nearest") -> torch.Tensor:
    """调整张量尺寸，支持多种插值模式。"""
    if tensor.dim() not in (3, 4):
        raise ValueError(f"Tensor must be 3D or 4D, got {tensor.shape}")
    needs_squeeze = tensor.dim() == 3 and tensor.shape[-1] in (1, 3, 4)
    if needs_squeeze:
        tensor = tensor.unsqueeze(0)
    tensor_permuted = tensor.permute(0, 3, 1, 2)
    if mode == "lanczos":
        resized = resize(tensor_permuted, size=list(size), interpolation=3, antialias=True)
    else:
        resized = F.interpolate(tensor_permuted, size=size, mode=mode, align_corners=False if mode in ["bilinear", "bicubic"] else None)
    output = resized.permute(0, 2, 3, 1)
    return output.squeeze(0) if needs_squeeze else output

INTERPOLATION_MODES = {
    "nearest": "nearest",
    "bilinear": "bilinear",
    "bicubic": "bicubic",
    "area": "area",
    "nearest_exact": "nearest-exact",
    "lanczos": "lanczos",
}

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
    CATEGORY = "XISER_Nodes"

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


# 输入多个提示词并通过开关控制输出
class XIS_PromptsWithSwitches:
    @classmethod
    def INPUT_TYPES(cls):
        input_config = {}
        for i in range(1, 6):
            input_config[f"prompt_{i}"] = ("STRING", {"default": "", "multiline": True})
            input_config[f"enable_{i}"] = ("BOOLEAN", {"default": True})
        return {"required": {}, "optional": input_config}

    RETURN_TYPES = ("STRING", "BOOLEAN")
    OUTPUT_IS_LIST = (True, False)
    FUNCTION = "process_prompts"
    CATEGORY = "XISER_Nodes"

    def process_prompts(self, **kwargs):
        prompts = []
        for i in range(1, 6):
            prompt_key = f"prompt_{i}"
            enable_key = f"enable_{i}"
            prompt = kwargs.get(prompt_key, "")
            enable = kwargs.get(enable_key, True)
            if enable and prompt.strip():
                prompts.append(prompt)
        if not prompts:
            return (["No prompts to display."], False)
        return (prompts, True)

# 输入浮点数并通过滑块控制
class XIS_Float_Slider:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "value": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.01, "display": "slider"}),
            }
        }

    RETURN_TYPES = ("FLOAT",)
    FUNCTION = "process_float_slider"
    CATEGORY = "XISER_Nodes"

    def process_float_slider(self, value):
        return (value,)

# 输入整数并通过滑块控制
class XIS_INT_Slider:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "value": ("INT", {"default": 0, "min": 0, "max": 100, "step": 1, "display": "slider"}),
            }
        }

    RETURN_TYPES = ("INT",)
    FUNCTION = "process_int_slider"
    CATEGORY = "XISER_Nodes"

    def process_int_slider(self, value):
        return (value,)

# 从列表中获取单个元素
class GetSingleFromListMeta(type):
    def __new__(cls, name, bases, attrs):
        attrs.update({
            "RETURN_TYPES": (attrs["TYPE"].upper(),),
            "CATEGORY": "XISER_Nodes/ListProcessing",
            "FUNCTION": "get_one",
            "INPUT_IS_LIST": True,
            "INPUT_TYPES": classmethod(lambda cls: {
                "required": {
                    "list": (attrs["TYPE"].upper(), {"forceInput": True}),
                    "index": ("INT", {"default": 0, "min": -2147483648})
                }
            })
        })

        def get_one(self, list, index):
            if not list:
                raise ValueError("Input list cannot be empty")
            index = index[0] % len(list)
            return (list[index],)

        attrs["get_one"] = get_one
        return super().__new__(cls, name, bases, attrs)

class XIS_FromListGet1Mask(metaclass=GetSingleFromListMeta): TYPE = "MASK"
class XIS_FromListGet1Image(metaclass=GetSingleFromListMeta): TYPE = "IMAGE"
class XIS_FromListGet1Latent(metaclass=GetSingleFromListMeta): TYPE = "LATENT"
class XIS_FromListGet1Cond(metaclass=GetSingleFromListMeta): TYPE = "CONDITIONING"
class XIS_FromListGet1Model(metaclass=GetSingleFromListMeta): TYPE = "MODEL"
class XIS_FromListGet1Color(metaclass=GetSingleFromListMeta): TYPE = "COLOR"
class XIS_FromListGet1String(metaclass=GetSingleFromListMeta): TYPE = "STRING"
class XIS_FromListGet1Int(metaclass=GetSingleFromListMeta): TYPE = "INT"
class XIS_FromListGet1Float(metaclass=GetSingleFromListMeta): TYPE = "FLOAT"

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

    CATEGORY = "XISER_Nodes"

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
    CATEGORY = "XISER_Nodes"

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


# K采样器设置打包节点
class XIS_KSamplerSettingsNode:
    @classmethod
    def INPUT_TYPES(cls):
        sampler_options = comfy.samplers.SAMPLER_NAMES
        scheduler_options = comfy.samplers.SCHEDULER_NAMES
        
        return {
            "required": {
                "steps": ("INT", {
                    "default": 20,
                    "min": 1,
                    "max": 10000,
                    "step": 1,
                    "display": "number"
                }),
                "cfg": ("FLOAT", {
                    "default": 7.5,
                    "min": 0.0,
                    "max": 100.0,
                    "step": 0.1,
                    "display": "number"
                }),
                "sampler_name": (sampler_options, {
                    "default": "euler"
                }),
                "scheduler": (scheduler_options, {
                    "default": "normal"
                }),
                "start_step": ("INT", {
                    "default": 0,
                    "min": 0,
                    "max": 10000,
                    "step": 1,
                    "display": "number"
                }),
                "end_step": ("INT", {
                    "default": 20,
                    "min": 1,
                    "max": 10000,
                    "step": 1,
                    "display": "number"
                })
            },
            "optional": {
                "model": ("MODEL",),  # 改为可选输入
                "vae": ("VAE",),      # 改为可选输入
                "clip": ("CLIP",),    # 改为可选输入
            }
        }

    RETURN_TYPES = ("DICT",)
    RETURN_NAMES = ("settings_pack",)
    
    FUNCTION = "get_settings"
    CATEGORY = "XISER_Nodes"

    def get_settings(self, steps, cfg, sampler_name, scheduler, start_step, end_step, model=None, vae=None, clip=None):
        if end_step <= start_step:
            end_step = start_step + 1
            
        settings_pack = {
            "model": model,
            "vae": vae,
            "clip": clip,
            "steps": steps,
            "cfg": cfg,
            "sampler_name": sampler_name,
            "scheduler": scheduler,
            "start_step": start_step,
            "end_step": end_step
        }
        
        return (settings_pack,)

# K采样器设置解包节点
class XIS_KSamplerSettingsUnpackNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "settings_pack": ("DICT", {})
            }
        }

    RETURN_TYPES = ("MODEL", "VAE", "CLIP", "INT", "FLOAT", comfy.samplers.KSampler.SAMPLERS, comfy.samplers.KSampler.SCHEDULERS, "INT", "INT")
    RETURN_NAMES = ("model", "vae", "clip", "steps", "cfg", "sampler_name", "scheduler", "start_step", "end_step")
    
    FUNCTION = "unpack_settings"
    CATEGORY = "XISER_Nodes"

    def unpack_settings(self, settings_pack):
        model = settings_pack.get("model")  # 无默认值，保持为 None 如果未提供
        vae = settings_pack.get("vae")      # 无默认值，保持为 None 如果未提供
        clip = settings_pack.get("clip")    # 无默认值，保持为 None 如果未提供
        steps = settings_pack.get("steps", 20)
        cfg = settings_pack.get("cfg", 7.5)
        sampler_name = settings_pack.get("sampler_name", "euler")
        scheduler = settings_pack.get("scheduler", "normal")
        start_step = settings_pack.get("start_step", 0)
        end_step = settings_pack.get("end_step", 20)
        
        if end_step <= start_step:
            end_step = start_step + 1
            
        return (model, vae, clip, steps, cfg, sampler_name, scheduler, start_step, end_step)
    

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
    CATEGORY = "XISER_Nodes"

    def apply_operations(self, mask1, operation, blur_radius, expand_shrink, invert_mask, overlay_color, opacity, mask2=None, reference_image=None):
        # 将 mask1 转换为 NumPy 数组并获取尺寸
        mask1_np = mask1.squeeze().cpu().numpy()
        mask1_height, mask1_width = mask1_np.shape

        # 检查 mask2 是否存在且是否为 64x64 全零掩码
        mask2_is_empty = False
        if mask2 is not None:
            mask2_np = mask2.squeeze().cpu().numpy()
            # 检查是否为 64x64 全零掩码
            if mask2_np.shape == (64, 64) and np.all(mask2_np == 0):
                mask2_is_empty = True
            else:
                # 如果 mask2 非空且尺寸与 mask1 不一致，缩放到 mask1 尺寸
                if mask2_np.shape != mask1_np.shape:
                    mask2_pil = Image.fromarray((mask2_np * 255).astype(np.uint8))
                    mask2_pil = mask2_pil.resize((mask1_width, mask1_height), Image.LANCZOS)
                    mask2_np = np.array(mask2_pil).astype(np.float32) / 255.0

        # 如果 mask2 存在且非空，执行蒙版操作
        if mask2 is not None and not mask2_is_empty:
            # 执行蒙版操作
            if operation == "add":
                result_np = np.clip(mask1_np + mask2_np, 0, 1)
            elif operation == "subtract":
                result_np = np.clip(mask1_np - mask2_np, 0, 1)
            elif operation == "intersect":
                result_np = np.minimum(mask1_np, mask2_np)
            elif operation == "difference":
                result_np = np.abs(mask1_np - mask2_np)
        else:
            # 如果 mask2 为 None 或全零掩码，直接使用 mask1
            result_np = mask1_np

        # 转换为 PIL 图像
        result = Image.fromarray((result_np * 255).astype(np.uint8))

        # 形态学操作（扩展/收缩）
        if expand_shrink != 0:
            result = self.morphological_operation(result, expand_shrink)

        # 模糊处理
        if blur_radius > 0:
            result = result.filter(ImageFilter.GaussianBlur(blur_radius))

        # 反向蒙版
        if invert_mask:
            result = ImageOps.invert(result)

        # 转换为 PyTorch 张量
        result_mask = torch.from_numpy(np.array(result).astype(np.float32) / 255.0).unsqueeze(0)

        # 生成叠加图像（仅当 reference_image 存在时）
        overlay_tensor = None
        if reference_image is not None:
            # 转换参考图像为 PIL 格式（取第一张图）
            ref_img_np = reference_image[0].cpu().numpy()  # [H, W, C]
            ref_img_pil = Image.fromarray((ref_img_np * 255).astype(np.uint8))

            # 调整参考图尺寸与 mask1 一致
            if ref_img_pil.size != result.size:
                ref_img_pil = ref_img_pil.resize((mask1_width, mask1_height), Image.LANCZOS)

            # 创建纯色叠加层并合成
            overlay_img = self.apply_mask_composite(ref_img_pil, overlay_color, result, opacity)
            overlay_tensor = torch.from_numpy(np.array(overlay_img).astype(np.float32) / 255.0).unsqueeze(0)
        else:
            # 无参考图时返回与掩码尺寸一致的全零张量
            overlay_tensor = torch.zeros_like(result_mask.unsqueeze(-1).expand(-1, -1, -1, 3))

        return (result_mask, overlay_tensor)

    def morphological_operation(self, image, amount):
        """使用 OpenCV 实现形态学操作"""
        np_image = np.array(image)
        kernel_size = int(abs(amount) * 2 + 1)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
        
        if amount > 0:
            processed = cv2.dilate(np_image, kernel, iterations=1)
        else:
            processed = cv2.erode(np_image, kernel, iterations=1)
            
        return Image.fromarray(processed)

    def create_color_layer(self, size, hex_color):
        """创建指定颜色的图层"""
        try:
            rgb = tuple(int(hex_color.lstrip('#')[i:i+2], 16) for i in (0, 2, 4))
        except:
            rgb = (255, 0, 0)  # 默认红色
        return Image.new("RGB", size, rgb)

    def apply_mask_composite(self, base_img, hex_color, mask, opacity):
        """应用蒙版合成图像，确保掩码为 0 的区域显示原始图像"""
        # 创建纯色图层
        color_layer = self.create_color_layer(base_img.size, hex_color)
        
        # 将掩码转换为 L 模式（灰度）
        mask = mask.convert("L")
        
        # 将基础图像和颜色层转换为 RGB 模式
        base_rgb = base_img.convert("RGB")
        color_rgb = color_layer.convert("RGB")
        
        # 使用 Image.composite，根据掩码合成图像
        composite = Image.composite(color_rgb, base_rgb, mask)
        
        # 应用透明度，仅对掩码非零区域生效
        final_img = Image.blend(base_rgb, composite, opacity)
        
        return final_img
    

class XIS_IPAStyleSettings:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "option": (["linear", "ease in", "ease out", "ease in-out", "reverse in-out", "weak input", "weak output",
                            "weak middle", "strong middle", "style transfer", "composition", "strong style transfer",
                            "style and composition", "style transfer precise", "composition precise"],),
                "slider": ("FLOAT", {"default": 0.5, "min": 0.00, "max": 1.00, "step": 0.01, "display": "slider"}),
            }
        }

    RETURN_TYPES = ("STRING", "FLOAT")
    FUNCTION = "process"
    CATEGORY = "XISER_Nodes"

    def process(self, option, slider):
        return (option, slider)



# 节点类映射
NODE_CLASS_MAPPINGS = {
    "XIS_CropImage": XIS_CropImage,
    "XIS_IsThereAnyData": XIS_IsThereAnyData,
    "XIS_ResizeToDivisible": XIS_ResizeToDivisible,
    "XIS_InvertMask": XIS_InvertMask,
    "XIS_ImageMaskMirror": XIS_ImageMaskMirror,
    "XIS_ResizeImageOrMask": XIS_ResizeImageOrMask,
    "XIS_PromptsWithSwitches": XIS_PromptsWithSwitches,
    "XIS_Float_Slider": XIS_Float_Slider,
    "XIS_INT_Slider": XIS_INT_Slider,
    "XIS_FromListGet1Mask": XIS_FromListGet1Mask,
    "XIS_FromListGet1Image": XIS_FromListGet1Image,
    "XIS_FromListGet1Latent": XIS_FromListGet1Latent,
    "XIS_FromListGet1Cond": XIS_FromListGet1Cond,
    "XIS_FromListGet1Model": XIS_FromListGet1Model,
    "XIS_FromListGet1Color": XIS_FromListGet1Color,
    "XIS_FromListGet1String": XIS_FromListGet1String,
    "XIS_FromListGet1Int": XIS_FromListGet1Int,
    "XIS_FromListGet1Float": XIS_FromListGet1Float,
    "XIS_ReorderImageMaskGroups": XIS_ReorderImageMaskGroups,
    "XIS_IfDataIsNone": XIS_IfDataIsNone,
    "XIS_CompositorProcessor": XIS_CompositorProcessor,
    "XIS_KSamplerSettingsNode": XIS_KSamplerSettingsNode,
    "XIS_KSamplerSettingsUnpackNode": XIS_KSamplerSettingsUnpackNode,
    "XIS_MaskCompositeOperation": XIS_MaskCompositeOperation,
    "XIS_IPAStyleSettings": XIS_IPAStyleSettings,
}

# 节点显示名称映射
NODE_DISPLAY_NAME_MAPPINGS = {
    "XIS_CropImage": "Crop Image",
    "XIS_IsThereAnyData": "Is There Any Data",
    "XIS_ResizeToDivisible": "Resize To Divisible",
    "XIS_InvertMask": "Invert Mask",
    "XIS_ImageMaskMirror": "Image Mask Mirror",
    "XIS_ResizeImageOrMask": "Resize Image or Mask",
    "XIS_PromptsWithSwitches": "Prompts With Switches",
    "XIS_Float_Slider": "Float Slider",
    "XIS_INT_Slider": "INT Slider",
    "XIS_FromListGet1Mask": "From List Get1 Mask",
    "XIS_FromListGet1Image": "From List Get1 Image",
    "XIS_FromListGet1Latent": "From List Get1 Latent",
    "XIS_FromListGet1Cond": "From List Get1 Cond",
    "XIS_FromListGet1Model": "From List Get1 Model",
    "XIS_FromListGet1Color": "From List Get1 Color",
    "XIS_FromListGet1String": "From List Get1 String",
    "XIS_FromListGet1Int": "From List Get1 Int",
    "XIS_FromListGet1Float": "From List Get1 Float",
    "XIS_ReorderImageMaskGroups": "Reorder Image Mask Groups",
    "XIS_IfDataIsNone": "If Data Is None",
    "XIS_CompositorProcessor": "Compositor Processor",
    "XIS_KSamplerSettingsNode": "KSampler Settings Node",
    "XIS_KSamplerSettingsUnpackNode": "KSampler Settings Unpack Node",
    "XIS_MaskCompositeOperation": "Mask Composite Operation",
    "XIS_IPAStyleSettings": "IPA Style Settings",
}