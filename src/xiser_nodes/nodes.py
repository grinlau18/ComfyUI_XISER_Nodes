print("Loading XISER Nodes...")

import torch
import numpy as np
from PIL import Image
import torch.nn.functional as F
from torchvision.transforms.functional import resize
from typing import List, Union


# 判断是否有信号接入，否则输出默认值（INT、FLOAT、BOOLEAN）
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
        # 判断是否有信号接入并选择输出值
        int_output = int_input if int_input is not None else default_int
        float_output = float_input if float_input is not None else default_float
        boolean_output = boolean_input if boolean_input is not None else default_boolean

        # 调试：打印输出值
        print(f"INT output: {int_output}")
        print(f"FLOAT output: {float_output}")
        print(f"BOOLEAN output: {boolean_output}")

        return (int_output, float_output, boolean_output)

# 将图片或者蒙版缩放到最接近的可整除尺寸
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
        # 如果两个输入都为空，返回 None
        if image is None and mask is None:
            return (None, None)

        # 初始化输出
        image_output = None
        mask_output = None

        # 处理图像
        if image is not None:
            image_output = self._resize_tensor(image, divisor, is_image=True)

        # 处理蒙版
        if mask is not None:
            mask_output = self._resize_tensor(mask, divisor, is_image=False)

        return (image_output, mask_output)

    def _resize_tensor(self, tensor, divisor, is_image=False):
        # 获取原始尺寸
        if is_image:
            batch, height, width, channels = tensor.shape
        else:
            # 对于 mask，可能是 2D 或 3D
            if tensor.dim() == 2:
                tensor = tensor.unsqueeze(0)  # 添加 batch 维度
            batch, height, width = tensor.shape
            channels = 1

        orig_aspect = width / height

        # 计算目标尺寸（宽高需被 divisor 整除）
        target_height = self._nearest_divisible(height, divisor)
        target_width = self._nearest_divisible(width, divisor)
        target_aspect = target_width / target_height

        # 缩放到中间尺寸，保持比例
        if orig_aspect > target_aspect:
            # 原始宽度较宽，按目标高度缩放
            scale = target_height / height
            intermediate_width = int(width * scale)
            intermediate_height = target_height
        else:
            # 原始高度较高，按目标宽度缩放
            scale = target_width / width
            intermediate_height = int(height * scale)
            intermediate_width = target_width

        # 调整张量维度并缩放
        if is_image:
            # image: [batch, height, width, channels] -> [batch, channels, height, width]
            tensor_permuted = tensor.permute(0, 3, 1, 2)
            tensor_resized = F.interpolate(
                tensor_permuted,
                size=(intermediate_height, intermediate_width),
                mode="nearest"
            )
            # 恢复原始维度顺序
            tensor_resized = tensor_resized.permute(0, 2, 3, 1)
        else:
            # mask: [batch, height, width]
            tensor_resized = F.interpolate(
                tensor.unsqueeze(0),  # 添加 channel 维度: [1, batch, height, width]
                size=(intermediate_height, intermediate_width),
                mode="nearest"
            ).squeeze(0)  # 移除 channel 维度

        # 居中裁剪到目标尺寸
        if intermediate_height != target_height or intermediate_width != target_width:
            start_h = (intermediate_height - target_height) // 2
            start_w = (intermediate_width - target_width) // 2
            tensor_resized = tensor_resized[:, start_h:start_h + target_height, start_w:start_w + target_width]

        # 调试：检查输出尺寸
        print(f"Resized tensor shape: {tensor_resized.shape}")

        # 对于 mask，如果输入是 2D，移除 batch 维度
        if not is_image and tensor.dim() == 2:
            tensor_resized = tensor_resized.squeeze(0)

        return tensor_resized

    def _nearest_divisible(self, value, divisor):
        # 找到最接近 value 且能被 divisor 整除的数
        quotient = value // divisor
        lower = quotient * divisor
        upper = (quotient + 1) * divisor
        # 选择最接近原始值的尺寸
        if abs(value - lower) < abs(value - upper):
            return lower
        return upper

# 对输入的掩码进行反转处理，如掩码为空，则输出接入参考图尺寸匹配的全白掩码
class XIS_InvertMask:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "mask": ("MASK",),
                "invert": ("BOOLEAN", {"default": True}),
            }
        }

    RETURN_TYPES = ("MASK",)
    RETURN_NAMES = ("mask_output",)
    FUNCTION = "invert_mask"
    CATEGORY = "XISER_Nodes"

    def invert_mask(self, image, mask, invert):
        # 确保输入掩码是张量
        if not isinstance(mask, torch.Tensor):
            mask = torch.tensor(mask, dtype=torch.float32)

        # 调试：检查输入掩码的原始值范围
        print(f"Input mask range (raw): {mask.min().item()} - {mask.max().item()}")

        # 归一化处理：如果范围是 0-1，则转换为 0-255
        mask_max = mask.max().item()
        if mask_max <= 1.0:
            mask = mask * 255.0  # 转换为 0-255 范围
        # 如果范围已是 0-255，则无需转换

        # 调试：检查归一化后的值范围
        print(f"Input mask range (normalized): {mask.min().item()} - {mask.max().item()}")

        # 检查掩码是否全为 0
        is_all_zero = torch.all(mask == 0)

        if is_all_zero:
            # 掩码全为 0：输出与 image 尺寸匹配的全白掩码 (255)
            mask_output = torch.full_like(image[..., 0], 255)  # 使用 image 的第一个通道作为尺寸参考
        else:
            # 掩码不全为 0：根据 invert 开关处理
            if invert:
                mask_output = 255.0 - mask  # 反转：0变为255，255变为0
            else:
                mask_output = mask  # 保持原始掩码

            # 如果掩码尺寸与 image 不匹配，调整尺寸
            if mask_output.shape[-2:] != image.shape[1:3]:
                mask_output = torch.nn.functional.interpolate(
                    mask_output.unsqueeze(0), size=image.shape[1:3], mode="nearest"
                ).squeeze(0)

        # 调试：检查输出掩码的值范围
        print(f"Mask output range: {mask_output.min().item()} - {mask_output.max().item()}")

        return (mask_output,)

# 对输入的图像和蒙版进行镜像翻转操作，支持水平和垂直翻转
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
        # 如果两个输入都为空，返回空值
        if image is None and mask is None:
            return (None, None)

        # 处理图像
        image_output = None
        if image is not None:
            if enable_flip:
                if flip_axis == "X":
                    image_output = image.flip(2)  # 水平翻转 (宽度维度)
                else:  # Y轴
                    image_output = image.flip(1)  # 垂直翻转 (高度维度)
            else:
                image_output = image

        # 处理蒙版
        mask_output = None
        if mask is not None:
            # 打印蒙版形状以调试
            print(f"Input mask shape: {mask.shape}")
            
            # 确保蒙版维度正确处理
            mask_input = mask
            if mask.dim() == 2:  # [height, width]
                mask_input = mask.unsqueeze(0)  # 添加批量维度变为 [1, height, width]
            
            if enable_flip:
                if flip_axis == "X":
                    mask_output = mask_input.flip(2)  # 水平翻转 (宽度维度)
                else:  # Y轴
                    mask_output = mask_input.flip(1)  # 垂直翻转 (高度维度)
            else:
                mask_output = mask_input
            
            # 如果添加了批量维度，移除它以保持输出一致
            if mask.dim() == 2:
                mask_output = mask_output.squeeze(0)
            
            print(f"Output mask shape: {mask_output.shape}")

        return (image_output, mask_output)



# 对图像和蒙版进行指定的缩放操作，支持多种缩放模式和插值模式
INTERPOLATION_MODES = {
    "nearest": "nearest",
    "bilinear": "bilinear",
    "bicubic": "bicubic",
    "area": "area",
    "nearest_exact": "nearest_exact",  # 修正为正确的模式名称
    "lanczos": "lanczos",
}

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
    CATEGORY = "XISER_Nodes"

    def resize_image_or_mask(self, resize_mode, interpolation, min_unit, image=None, mask=None, reference_image=None, manual_width=None, manual_height=None, fill_hex="#000000"):
        # 检查是否有至少一个输入
        if image is None and mask is None:
            raise ValueError("At least one of 'image' or 'mask' must be provided")

        # HEX 颜色转换为 RGB 值
        fill_rgb = hex_to_rgb(fill_hex)
        img_fill_value = fill_rgb if (image is not None and image.shape[-1] == 3) else (*fill_rgb, 1.0) if image is not None else None
        mask_fill_value = fill_rgb[0]  # 蒙版使用灰度值

        # 处理 IMAGE 输入（如果提供）
        img_batch_size, img_orig_height, img_orig_width = 0, 0, 0
        if image is not None:
            img = image.clone().float()  # B, H, W, C
            img_batch_size, img_orig_height, img_orig_width, img_channels = img.shape
            if img_channels not in [3, 4]:
                raise ValueError("IMAGE input must have 3 or 4 channels")
        else:
            img = None

        # 处理 MASK 输入（如果提供）
        mask_batch_size, mask_orig_height, mask_orig_width = 0, 0, 0
        if mask is not None:
            if mask.dim() == 2:  # H×W
                mask = mask.unsqueeze(0).unsqueeze(-1).float()  # 1×H×W×1
            elif mask.dim() == 3:  # B×H×W
                mask = mask.unsqueeze(-1).float()  # B×H×W×1
            mask_batch_size, mask_orig_height, mask_orig_width, mask_channels = mask.shape
            if mask_channels != 1:
                raise ValueError("MASK input must have 1 channel")
        else:
            mask = None

        # 确定批次大小（取最大值）
        batch_size = max(img_batch_size if image is not None else 0, mask_batch_size if mask is not None else 0)

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

        # 计算 IMAGE 的缩放尺寸（如果提供）
        img_new_width, img_new_height = 0, 0
        if image is not None:
            if resize_mode == "force_resize":
                img_new_width, img_new_height = target_width, target_height
            elif resize_mode == "scale_proportionally":
                aspect_ratio = img_orig_width / img_orig_height
                if target_width / target_height > aspect_ratio:
                    img_new_height = target_height
                    img_new_width = int(img_new_height * aspect_ratio)
                else:
                    img_new_width = target_width
                    img_new_height = int(img_new_width / aspect_ratio)
                img_new_width = ((img_new_width + min_unit - 1) // min_unit) * min_unit
                img_new_height = ((img_new_height + min_unit - 1) // min_unit) * min_unit
            elif resize_mode == "limited_by_canvas":
                aspect_ratio = img_orig_width / img_orig_height
                if target_width / target_height > aspect_ratio:
                    img_new_height = target_height
                    img_new_width = int(img_new_height * aspect_ratio)
                else:
                    img_new_width = target_width
                    img_new_height = int(img_new_width / aspect_ratio)
                img_new_width = ((img_new_width + min_unit - 1) // min_unit) * min_unit
                img_new_height = ((img_new_height + min_unit - 1) // min_unit) * min_unit
            elif resize_mode == "fill_the_canvas":
                aspect_ratio = img_orig_width / img_orig_height
                target_max = max(target_width, target_height)
                if img_orig_width > img_orig_height:
                    img_new_width = max(target_max, int(target_height * aspect_ratio))
                    img_new_height = int(img_new_width / aspect_ratio)
                else:
                    img_new_height = max(target_max, int(target_width / aspect_ratio))
                    img_new_width = int(img_new_height * aspect_ratio)
                img_new_width = ((img_new_width + min_unit - 1) // min_unit) * min_unit
                img_new_height = ((img_new_height + min_unit - 1) // min_unit) * min_unit

        # 计算 MASK 的缩放尺寸（如果提供）
        mask_new_width, mask_new_height = 0, 0
        if mask is not None:
            if resize_mode == "force_resize":
                mask_new_width, mask_new_height = target_width, target_height
            elif resize_mode == "scale_proportionally":
                aspect_ratio = mask_orig_width / mask_orig_height
                if target_width / target_height > aspect_ratio:
                    mask_new_height = target_height
                    mask_new_width = int(mask_new_height * aspect_ratio)
                else:
                    mask_new_width = target_width
                    mask_new_height = int(mask_new_width / aspect_ratio)
                mask_new_width = ((mask_new_width + min_unit - 1) // min_unit) * min_unit
                mask_new_height = ((mask_new_height + min_unit - 1) // min_unit) * min_unit
            elif resize_mode == "limited_by_canvas":
                aspect_ratio = mask_orig_width / mask_orig_height
                if target_width / target_height > aspect_ratio:
                    mask_new_height = target_height
                    mask_new_width = int(mask_new_height * aspect_ratio)
                else:
                    mask_new_width = target_width
                    mask_new_height = int(mask_new_width / aspect_ratio)
                mask_new_width = ((mask_new_width + min_unit - 1) // min_unit) * min_unit
                mask_new_height = ((mask_new_height + min_unit - 1) // min_unit) * min_unit
            elif resize_mode == "fill_the_canvas":
                aspect_ratio = mask_orig_width / mask_orig_height
                target_max = max(target_width, target_height)
                if mask_orig_width > mask_orig_height:
                    mask_new_width = max(target_max, int(target_height * aspect_ratio))
                    mask_new_height = int(mask_new_width / aspect_ratio)
                else:
                    mask_new_height = max(target_max, int(target_width / aspect_ratio))
                    mask_new_width = int(mask_new_height * aspect_ratio)
                mask_new_width = ((mask_new_width + min_unit - 1) // min_unit) * min_unit
                mask_new_height = ((mask_new_height + min_unit - 1) // min_unit) * min_unit

        # 调整 IMAGE 尺寸（如果提供）
        resized_img = None
        if image is not None:
            if interpolation == "lanczos":
                # 使用 torchvision 的 resize 支持 lanczos
                resized_img = resize(
                    img.permute(0, 3, 1, 2),  # B, C, H, W
                    size=[img_new_height, img_new_width],
                    interpolation=3,  # Lanczos 对应 PIL 的 3
                    antialias=True
                ).permute(0, 2, 3, 1)  # B, H, W, C
            else:
                resized_img = F.interpolate(
                    img.permute(0, 3, 1, 2),  # B, C, H, W
                    size=(img_new_height, img_new_width),
                    mode=INTERPOLATION_MODES[interpolation],
                    align_corners=False if interpolation in ["bilinear", "bicubic"] else None
                ).permute(0, 2, 3, 1)  # B, H, W, C

        # 调整 MASK 尺寸（如果提供）
        resized_mask = None
        if mask is not None:
            if interpolation == "lanczos":
                # 使用 torchvision 的 resize 支持 lanczos
                resized_mask = resize(
                    mask.permute(0, 3, 1, 2),  # B, C, H, W
                    size=[mask_new_height, mask_new_width],
                    interpolation=3,  # Lanczos 对应 PIL 的 3
                    antialias=True
                ).permute(0, 2, 3, 1)  # B, H, W, C
            else:
                resized_mask = F.interpolate(
                    mask.permute(0, 3, 1, 2),  # B, C, H, W
                    size=(mask_new_height, mask_new_width),
                    mode=INTERPOLATION_MODES[interpolation],
                    align_corners=False if interpolation in ["bilinear", "bicubic"] else None
                ).permute(0, 2, 3, 1)  # B, H, W, C

        # 处理缩放模式
        if resize_mode == "limited_by_canvas":
            if image is not None:
                offset_y = (target_height - img_new_height) // 2
                offset_x = (target_width - img_new_width) // 2
                img_fill_tensor = torch.tensor(img_fill_value, dtype=torch.float32).view(1, 1, 1, -1).expand(batch_size, target_height, target_width, img_channels)
                img_output = img_fill_tensor.clone()
                img_output[:, offset_y:offset_y + img_new_height, offset_x:offset_x + img_new_width, :] = resized_img
                resized_img = img_output
            if mask is not None:
                offset_y = (target_height - mask_new_height) // 2
                offset_x = (target_width - mask_new_width) // 2
                mask_fill_tensor = torch.tensor(mask_fill_value, dtype=torch.float32).view(1, 1, 1, 1).expand(batch_size, target_height, target_width, 1)
                mask_output = mask_fill_tensor.clone()
                mask_output[:, offset_y:offset_y + mask_new_height, offset_x:offset_x + mask_new_width, :] = resized_mask
                resized_mask = mask_output
        elif resize_mode == "fill_the_canvas":
            if image is not None:
                img_output = torch.zeros(batch_size, target_height, target_width, img_channels, dtype=torch.float32)
                offset_y = (img_new_height - target_height) // 2
                offset_x = (img_new_width - target_width) // 2
                y_start = max(0, offset_y)
                y_end = min(img_new_height, offset_y + target_height)
                x_start = max(0, offset_x)
                x_end = min(img_new_width, offset_x + target_width)
                out_y_start = max(0, -offset_y)
                out_y_end = out_y_start + (y_end - y_start)
                out_x_start = max(0, -offset_x)
                out_x_end = out_x_start + (x_end - x_start)
                img_output[:, out_y_start:out_y_end, out_x_start:out_x_end, :] = resized_img[:, y_start:y_end, x_start:x_end, :]
                resized_img = img_output
            if mask is not None:
                mask_output = torch.zeros(batch_size, target_height, target_width, 1, dtype=torch.float32)
                offset_y = (mask_new_height - target_height) // 2
                offset_x = (mask_new_width - target_width) // 2
                y_start = max(0, offset_y)
                y_end = min(mask_new_height, offset_y + target_height)
                x_start = max(0, offset_x)
                x_end = min(mask_new_width, offset_x + target_width)
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

def hex_to_rgb(hex_str):
    hex_str = hex_str.lstrip('#')
    if len(hex_str) != 6:
        raise ValueError("HEX color must be in #RRGGBB format")
    r, g, b = int(hex_str[0:2], 16), int(hex_str[2:4], 16), int(hex_str[4:6], 16)
    return (r / 255.0, g / 255.0, b / 255.0)


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


# 从列表中获取单个元素,支持多种类型的列表
class GetSingleFromListMeta(type):
    """
    Allows random access too using primitive node!
    Can also use negative indexes to access in reverse.
    """

    def __new__(cls, name, bases, attrs):
        if 'RETURN_TYPES' not in attrs:
            attrs['RETURN_TYPES'] = (attrs["TYPE"].upper(),)

        if 'CATEGORY' not in attrs:
            attrs['CATEGORY'] = 'XISER_Nodes/ListProcessing'

        attrs['FUNCTION'] = 'get_one'
        attrs['INPUT_IS_LIST'] = True

        def get_one(self, list, index):
            index = index[0]
            index = index % len(list)
            return (list[index],)

        def INPUT_TYPES(cls):
            return {
                "required": {
                    "list": (attrs["TYPE"].upper(), {"forceInput": True}),
                    "index": ("INT", {"default": 0, "min": -2147483648})
                }
            }

        attrs['get_one'] = get_one

        if 'INPUT_TYPES' not in attrs:
            attrs['INPUT_TYPES'] = classmethod(INPUT_TYPES)

        return super().__new__(cls, name, bases, attrs)


class XIS_FromListGet1Mask(metaclass=GetSingleFromListMeta):  TYPE = "MASK"
class XIS_FromListGet1Image(metaclass=GetSingleFromListMeta):  TYPE = "IMAGE"
class XIS_FromListGet1Latent(metaclass=GetSingleFromListMeta):  TYPE = "LATENT"
class XIS_FromListGet1Cond(metaclass=GetSingleFromListMeta):  TYPE = "CONDITIONING"
class XIS_FromListGet1Model(metaclass=GetSingleFromListMeta):  TYPE = "MODEL"
class XIS_FromListGet1Color(metaclass=GetSingleFromListMeta):  TYPE = "COLOR"
class XIS_FromListGet1String(metaclass=GetSingleFromListMeta): TYPE = "STRING"
class XIS_FromListGet1Int(metaclass=GetSingleFromListMeta): TYPE = "INT"
class XIS_FromListGet1Float(metaclass=GetSingleFromListMeta): TYPE = "FLOAT"


# 节点类映射
NODE_CLASS_MAPPINGS = {
    "XIS_PromptsWithSwitches": XIS_PromptsWithSwitches,
    "XIS_Float_Slider": XIS_Float_Slider,
    "XIS_INT_Slider": XIS_INT_Slider,
    "XIS_ResizeImageOrMask": XIS_ResizeImageOrMask,
    "XIS_FromListGet1Mask": XIS_FromListGet1Mask,
    "XIS_FromListGet1Image": XIS_FromListGet1Image,
    "XIS_FromListGet1Latent": XIS_FromListGet1Latent,
    "XIS_FromListGet1Cond": XIS_FromListGet1Cond,
    "XIS_FromListGet1Model": XIS_FromListGet1Model,
    "XIS_FromListGet1Color": XIS_FromListGet1Color,
    "XIS_FromListGet1String": XIS_FromListGet1String,
    "XIS_FromListGet1Int": XIS_FromListGet1Int,
    "XIS_FromListGet1Float": XIS_FromListGet1Float,
    "XIS_ImageMaskMirror": XIS_ImageMaskMirror,
    "XIS_InvertMask": XIS_InvertMask,
    "XIS_ResizeToDivisible": XIS_ResizeToDivisible,
    "XIS_IsThereAnyData": XIS_IsThereAnyData,
}

# 节点显示名称映射
NODE_DISPLAY_NAME_MAPPINGS = {
    "XIS_PromptsWithSwitches": "Prompts With Switches",
    "XIS_Float_Slider": "Float Slider",
    "XIS_INT_Slider": "INT Slider",
    "XIS_ResizeImageOrMask": "Resize Image or Mask",
    "XIS_FromListGet1Mask": "From List Get1 Mask",
    "XIS_FromListGet1Image": "From List Get1 Image",
    "XIS_FromListGet1Latent": "From List Get1 Latent",
    "XIS_FromListGet1Cond": "From List Get1 Cond",
    "XIS_FromListGet1Model": "From List Get1 Model",
    "XIS_FromListGet1Color": "From List Get1 Color",
    "XIS_FromListGet1String": "From List Get1 String",
    "XIS_FromListGet1Int": "From List Get1 Int",
    "XIS_FromListGet1Float": "From List Get1 Float",
    "XIS_ImageMaskMirror": "Image Mask Mirror", 
    "XIS_InvertMask": "Invert Mask",
    "XIS_ResizeToDivisible": "Resize To Divisible",
    "XIS_IsThereAnyData": "Is There Any Data",
}