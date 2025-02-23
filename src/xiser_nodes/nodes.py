print("Loading XISER Nodes...")

import torch
import numpy as np
from PIL import Image
import torch.nn.functional as F

# 定义缩放算法映射
INTERPOLATION_MODES = {
    "nearest": "nearest",
    "bilinear": "bilinear",
    "bicubic": "bicubic",
    "area": "area",
    "nearest-exact": "nearest_exact",
    "lanczos": "lanczos",
}

# HEX 颜色转换为 RGB（0-1 范围）
def hex_to_rgb(hex_str):
    hex_str = hex_str.lstrip('#')
    if len(hex_str) != 6:
        raise ValueError("HEX color must be in #RRGGBB format")
    r, g, b = int(hex_str[0:2], 16), int(hex_str[2:4], 16), int(hex_str[4:6], 16)
    return (r / 255.0, g / 255.0, b / 255.0)

class XIS_ResizeImageOrMask:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "resize_mode": (["force_resize", "scale_proportionally", "limited_by_canvas", "fill_the_canvas"], {"default": "force_resize"}),
                "interpolation": (list(INTERPOLATION_MODES.keys()), {"default": "bilinear"}),
                "min_unit": ("INT", {"default": 16, "min": 1, "max": 64, "step": 1}),
            },
            "optional": {
                "image": ("IMAGE", {"tooltip": "Optional IMAGE (RGB/RGBA) to resize"}),
                "mask": ("MASK", {"tooltip": "Optional MASK input to resize"}),
                "reference_image": ("IMAGE",),
                "manual_width": ("INT", {"default": 512, "min": 1, "max": 4096, "step": 1}),
                "manual_height": ("INT", {"default": 512, "min": 1, "max": 4096, "step": 1}),
                "fill_hex": ("STRING", {"default": "#000000", "tooltip": "HEX color code (e.g., #FF0000 for red)"}),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK", "INT", "INT")
    RETURN_NAMES = ("resized_image", "resized_mask", "width", "height")
    FUNCTION = "resize_image_or_mask"
    CATEGORY = "XISER_Nodes/ImageProcessing"

    def resize_image_or_mask(self, resize_mode, interpolation, min_unit, image=None, mask=None, reference_image=None, manual_width=None, manual_height=None, fill_hex="#000000"):
        # 检查是否有至少一个输入
        if image is None and mask is None:
            raise ValueError("At least one of 'image' or 'mask' must be provided")

        # 处理 IMAGE 输入（如果提供）
        batch_size_img = orig_height_img = orig_width_img = channels_img = None
        if image is not None:
            img = image.clone().float()  # B, H, W, C
            batch_size_img, orig_height_img, orig_width_img, channels_img = img.shape
            if channels_img not in [3, 4]:
                raise ValueError("IMAGE input must have 3 or 4 channels")

        # 处理 MASK 输入（如果提供）
        batch_size_mask = orig_height_mask = orig_width_mask = None
        if mask is not None:
            if mask.dim() == 2:  # H×W
                mask = mask.unsqueeze(0).unsqueeze(-1).float()  # 1×H×W×1
            elif mask.dim() == 3:  # B×H×W
                mask = mask.unsqueeze(-1).float()  # B×H×W×1
            batch_size_mask, orig_height_mask, orig_width_mask, mask_channels = mask.shape
            if mask_channels != 1:
                raise ValueError("MASK input must have 1 channel")

        # 确定批次大小（取较大的批次）
        batch_size = max(batch_size_img or 0, batch_size_mask or 0)

        # 确定目标尺寸
        if reference_image is not None:
            _, ref_height, ref_width, _ = reference_image.shape
            target_width, target_height = ref_width, ref_height
        elif manual_width is not None and manual_height is not None:
            target_width, target_height = manual_width, manual_height
        else:
            raise ValueError("Must provide either a reference image or manual width/height")

        # 调整目标尺寸为 min_unit 的倍数
        target_width = ((target_width + min_unit - 1) // min_unit) * min_unit
        target_height = ((target_height + min_unit - 1) // min_unit) * min_unit

        # 将 HEX 颜色转换为 RGB 值
        fill_rgb = hex_to_rgb(fill_hex)
        img_fill_value = fill_rgb if (image is not None and image.shape[-1] == 3) else (*fill_rgb, 1.0) if image is not None else None
        mask_fill_value = fill_rgb[0]  # 蒙版使用灰度值

        # 处理 IMAGE 的缩放尺寸
        new_width_img = new_height_img = None
        if image is not None:
            if resize_mode == "force_resize":
                new_width_img, new_height_img = target_width, target_height
            elif resize_mode == "scale_proportionally":
                aspect_ratio = orig_width_img / orig_height_img
                if target_width / target_height > aspect_ratio:
                    new_height_img = target_height
                    new_width_img = int(new_height_img * aspect_ratio)
                else:
                    new_width_img = target_width
                    new_height_img = int(new_width_img / aspect_ratio)
                new_width_img = ((new_width_img + min_unit - 1) // min_unit) * min_unit
                new_height_img = ((new_height_img + min_unit - 1) // min_unit) * min_unit
            elif resize_mode == "limited_by_canvas":
                aspect_ratio = orig_width_img / orig_height_img
                if target_width / target_height > aspect_ratio:
                    new_height_img = target_height
                    new_width_img = int(new_height_img * aspect_ratio)
                else:
                    new_width_img = target_width
                    new_height_img = int(new_width_img / aspect_ratio)
                new_width_img = ((new_width_img + min_unit - 1) // min_unit) * min_unit
                new_height_img = ((new_height_img + min_unit - 1) // min_unit) * min_unit
            elif resize_mode == "fill_the_canvas":
                aspect_ratio = orig_width_img / orig_height_img
                target_max = max(target_width, target_height)
                if orig_width_img > orig_height_img:  # 宽度是长边
                    new_width_img = max(target_max, int(target_height * aspect_ratio))
                    new_height_img = int(new_width_img / aspect_ratio)
                else:  # 高度是长边或正方形
                    new_height_img = max(target_max, int(target_width / aspect_ratio))
                    new_width_img = int(new_height_img * aspect_ratio)
                new_width_img = ((new_width_img + min_unit - 1) // min_unit) * min_unit
                new_height_img = ((new_height_img + min_unit - 1) // min_unit) * min_unit

        # 处理 MASK 的缩放尺寸
        new_width_mask = new_height_mask = None
        if mask is not None:
            if resize_mode == "force_resize":
                new_width_mask, new_height_mask = target_width, target_height
            elif resize_mode == "scale_proportionally":
                aspect_ratio = orig_width_mask / orig_height_mask
                if target_width / target_height > aspect_ratio:
                    new_height_mask = target_height
                    new_width_mask = int(new_height_mask * aspect_ratio)
                else:
                    new_width_mask = target_width
                    new_height_mask = int(new_width_mask / aspect_ratio)
                new_width_mask = ((new_width_mask + min_unit - 1) // min_unit) * min_unit
                new_height_mask = ((new_height_mask + min_unit - 1) // min_unit) * min_unit
            elif resize_mode == "limited_by_canvas":
                aspect_ratio = orig_width_mask / orig_height_mask
                if target_width / target_height > aspect_ratio:
                    new_height_mask = target_height
                    new_width_mask = int(new_height_mask * aspect_ratio)
                else:
                    new_width_mask = target_width
                    new_height_mask = int(new_width_mask / aspect_ratio)
                new_width_mask = ((new_width_mask + min_unit - 1) // min_unit) * min_unit
                new_height_mask = ((new_height_mask + min_unit - 1) // min_unit) * min_unit
            elif resize_mode == "fill_the_canvas":
                aspect_ratio = orig_width_mask / orig_height_mask
                target_max = max(target_width, target_height)
                if orig_width_mask > orig_height_mask:  # 宽度是长边
                    new_width_mask = max(target_max, int(target_height * aspect_ratio))
                    new_height_mask = int(new_width_mask / aspect_ratio)
                else:  # 高度是长边或正方形
                    new_height_mask = max(target_max, int(target_width / aspect_ratio))
                    new_width_mask = int(new_height_mask * aspect_ratio)
                new_width_mask = ((new_width_mask + min_unit - 1) // min_unit) * min_unit
                new_height_mask = ((new_height_mask + min_unit - 1) // min_unit) * min_unit

        # 调整 IMAGE 尺寸（如果提供）
        resized_img = None
        if image is not None:
            resized_img = F.interpolate(
                img.permute(0, 3, 1, 2),  # B, C, H, W
                size=(new_height_img, new_width_img),
                mode=INTERPOLATION_MODES[interpolation],
                align_corners=False if interpolation in ["bilinear", "bicubic"] else None
            ).permute(0, 2, 3, 1)  # B, H, W, C

        # 调整 MASK 尺寸（如果提供）
        resized_mask = None
        if mask is not None:
            resized_mask = F.interpolate(
                mask.permute(0, 3, 1, 2),  # B, C, H, W
                size=(new_height_mask, new_width_mask),
                mode=INTERPOLATION_MODES[interpolation],
                align_corners=False if interpolation in ["bilinear", "bicubic"] else None
            ).permute(0, 2, 3, 1)  # B, H, W, C

        # 处理缩放模式
        if resize_mode == "limited_by_canvas":
            if image is not None:
                offset_y = (target_height - new_height_img) // 2
                offset_x = (target_width - new_width_img) // 2
                img_fill_tensor = torch.tensor(img_fill_value, dtype=torch.float32).view(1, 1, 1, -1).expand(batch_size, target_height, target_width, channels_img)
                img_output = img_fill_tensor.clone()
                img_output[:, offset_y:offset_y + new_height_img, offset_x:offset_x + new_width_img, :] = resized_img
                resized_img = img_output
            if mask is not None:
                offset_y = (target_height - new_height_mask) // 2
                offset_x = (target_width - new_width_mask) // 2
                mask_fill_tensor = torch.tensor(mask_fill_value, dtype=torch.float32).view(1, 1, 1, 1).expand(batch_size, target_height, target_width, 1)
                mask_output = mask_fill_tensor.clone()
                mask_output[:, offset_y:offset_y + new_height_mask, offset_x:offset_x + new_width_mask, :] = resized_mask
                resized_mask = mask_output
        elif resize_mode == "fill_the_canvas":
            if image is not None:
                img_output = torch.zeros(batch_size, target_height, target_width, channels_img, dtype=torch.float32)
                offset_y = (new_height_img - target_height) // 2
                offset_x = (new_width_img - target_width) // 2
                y_start = max(0, offset_y)
                y_end = min(new_height_img, offset_y + target_height)
                x_start = max(0, offset_x)
                x_end = min(new_width_img, offset_x + target_width)
                out_y_start = max(0, -offset_y)
                out_y_end = out_y_start + (y_end - y_start)
                out_x_start = max(0, -offset_x)
                out_x_end = out_x_start + (x_end - x_start)
                img_output[:, out_y_start:out_y_end, out_x_start:out_x_end, :] = resized_img[:, y_start:y_end, x_start:x_end, :]
                resized_img = img_output
            if mask is not None:
                mask_output = torch.zeros(batch_size, target_height, target_width, 1, dtype=torch.float32)
                offset_y = (new_height_mask - target_height) // 2
                offset_x = (new_width_mask - target_width) // 2
                y_start = max(0, offset_y)
                y_end = min(new_height_mask, offset_y + target_height)
                x_start = max(0, offset_x)
                x_end = min(new_width_mask, offset_x + target_width)
                out_y_start = max(0, -offset_y)
                out_y_end = out_y_start + (y_end - y_start)
                out_x_start = max(0, -offset_x)
                out_x_end = out_x_start + (x_end - x_start)
                mask_output[:, out_y_start:out_y_end, out_x_start:out_x_end, :] = resized_mask[:, y_start:y_end, x_start:x_end, :]
                resized_mask = mask_output

        # 确保输出值在合理范围内
        if resized_img is not None:
            resized_img = resized_img.clamp(0, 1)
        if resized_mask is not None:
            resized_mask = resized_mask.clamp(0, 1).squeeze(-1)  # B×H×W×1 -> B×H×W

        return (resized_img, resized_mask, target_width, target_height)


# 输入多个提示词并通过开关控制是否输出，以列表输出所有开启的提示词，如果无任何提示词开启则输出"No prompts to display."，并且输出一个布尔值来判断提示词是否为空。
class XIS_PromptsWithSwitches:
    @classmethod
    def INPUT_TYPES(cls):
        input_config = {}
        for i in range(1, 6):
            input_config[f"prompt_{i}"] = ("STRING", {"default": "", "multiline": True})
            input_config[f"enable_{i}"] = ("BOOLEAN", {"default": True})

        return {
            "required": {},
            "optional": input_config
        }

    RETURN_TYPES = ("STRING", "BOOLEAN",)
    OUTPUT_IS_LIST = (True, False,)
    FUNCTION = "process_prompts"
    CATEGORY = "XISER_Nodes"

    def process_prompts(self, **kwargs):
        prompts = []
        for i in range(1, 6):
            prompt_key = f"prompt_{i}"
            enable_key = f"enable_{i}"
            prompt = kwargs.get(prompt_key, "")
            enable = kwargs.get(enable_key, True)
            if enable and prompt.strip() != "":
                prompts.append(prompt)

        if len(prompts) == 0:
            prompt_logic = False
            prompts = ["No prompts to display."]
        else:
            prompt_logic = True
        

        return (prompts, prompt_logic)


# 输入一个浮点数并通过滑块控制其值，输出该浮点数。
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

    def process_float_slider(self, **kwargs):
        value = kwargs.get("value", 0.0)
        return (value,)

# 输入一个整数并通过滑块控制其值，输出该整数。
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

    def process_int_slider(self, **kwargs):
        value = kwargs.get("value", 0)
        return (value,)



# 节点类映射
NODE_CLASS_MAPPINGS = {
    "XIS_PromptsWithSwitches": XIS_PromptsWithSwitches,
    "XIS_Float_Slider": XIS_Float_Slider,
    "XIS_INT_Slider": XIS_INT_Slider,
    "XIS_ResizeImageOrMask": XIS_ResizeImageOrMask,
}

# 节点显示名称映射
NODE_DISPLAY_NAME_MAPPINGS = {
    "XIS_PromptsWithSwitches": "Prompts With Switches",
    "XIS_Float_Slider": "Float Slider",
    "XIS_INT_Slider": "INT Slider",
    "XIS_ResizeImageOrMask": "Resize Image or Mask",
}