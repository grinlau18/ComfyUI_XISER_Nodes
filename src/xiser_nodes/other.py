import torch
from typing import Dict, Tuple, Optional
from PIL import Image
import numpy as np
import hashlib
import comfy.samplers
from .utils import standardize_tensor, hex_to_rgb, logger

"""
Miscellaneous nodes for XISER, including image transformation, sampler settings, prompt processing, and resolution selection.
"""

# Compositor 处理器
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
    CATEGORY = "XISER_Nodes/Other"

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
                    "min": 0,
                    "max": 100,
                    "step": 1,
                    "display": "slider"
                }),
                "cfg": ("FLOAT", {
                    "default": 7.5,
                    "min": 0.0,
                    "max": 15.0,
                    "step": 0.1,
                    "display": "slider"
                }),
                "denoise": ("FLOAT", {
                    "default": 1.0,
                    "min": 0.0,
                    "max": 1.0,
                    "step": 0.01,
                    "display": "slider"
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
                "model": ("MODEL",),
                "vae": ("VAE",),
                "clip": ("CLIP",),
            }
        }

    RETURN_TYPES = ("DICT",)
    RETURN_NAMES = ("settings_pack",)
    
    FUNCTION = "get_settings"
    CATEGORY = "XISER_Nodes/Other"

    def get_settings(self, steps, cfg, denoise, sampler_name, scheduler, start_step, end_step, model=None, vae=None, clip=None):
        if end_step <= start_step:
            end_step = start_step + 1
            
        settings_pack = {
            "model": model,
            "vae": vae,
            "clip": clip,
            "steps": steps,
            "cfg": cfg,
            "denoise": denoise,
            "sampler_name": sampler_name,
            "scheduler": scheduler,
            "start_step": start_step,
            "end_step": end_step
        }
        
        return (settings_pack,)


class XIS_KSamplerSettingsUnpackNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "settings_pack": ("DICT", {})
            }
        }

    RETURN_TYPES = ("MODEL", "VAE", "CLIP", "INT", "FLOAT", "FLOAT", comfy.samplers.KSampler.SAMPLERS, comfy.samplers.KSampler.SCHEDULERS, "INT", "INT")
    RETURN_NAMES = ("model", "vae", "clip", "steps", "cfg", "denoise", "sampler_name", "scheduler", "start_step", "end_step")
    
    FUNCTION = "unpack_settings"
    CATEGORY = "XISER_Nodes/Other"

    def unpack_settings(self, settings_pack):
        model = settings_pack.get("model")
        vae = settings_pack.get("vae")
        clip = settings_pack.get("clip")
        steps = settings_pack.get("steps", 20)
        cfg = settings_pack.get("cfg", 7.5)
        denoise = settings_pack.get("denoise", 1.0)
        sampler_name = settings_pack.get("sampler_name", "euler")
        scheduler = settings_pack.get("scheduler", "normal")
        start_step = settings_pack.get("start_step", 0)
        end_step = settings_pack.get("end_step", 20)
        
        if end_step <= start_step:
            end_step = start_step + 1
            
        return (model, vae, clip, steps, cfg, denoise, sampler_name, scheduler, start_step, end_step)

# IPA参数设置节点
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
    CATEGORY = "XISER_Nodes/Other"

    def process(self, option, slider):
        return (option, slider)

# 提示词处理器      
class XIS_PromptProcessor:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "positive_prompt1": ("STRING", {"default": "", "multiline": True, "placeholder": "输入自定义正向提示词"}),
                "positive_prompt2": ("STRING", {"default": ""}),  # Changed to input interface
                "negative_prompt": ("STRING", {"default": "", "multiline": True, "placeholder": "输入反向提示词"}),
                "merge_positive": ("BOOLEAN", {
                    "default": True,
                    "label_on": "已使用自动反推词",
                    "label_off": "已关闭自动反推词"
                }),
            }
        }

    RETURN_TYPES = ("STRING", "STRING", "BOOLEAN")
    RETURN_NAMES = ("combined_prompt", "negative_prompt", "merge_status")

    FUNCTION = "process_prompt"

    CATEGORY = "XISER_Nodes/Other"

    def process_prompt(self, positive_prompt1, positive_prompt2, negative_prompt, merge_positive):
        # 扩展结束符号集合
        end_symbols = {".", "。", ",", "，", ")", "!", "！", "?", "？", ";", "；"}

        # 处理合并逻辑
        if merge_positive and positive_prompt2 and positive_prompt2 != "none":
            # 如果 positive_prompt1 为空，直接使用 positive_prompt2
            if not positive_prompt1.strip():
                combined_prompt = positive_prompt2.strip()
            else:
                # 去除首尾空白
                prompt1_stripped = positive_prompt1.strip()
                # 检查 positive_prompt1 的结尾是否有结束符号
                if prompt1_stripped[-1] not in end_symbols:
                    # 如果没有结束符号，添加“.”并换行
                    combined_prompt = f"{prompt1_stripped}.\n{positive_prompt2.strip()}"
                else:
                    # 如果已有结束符号，仅换行合并
                    combined_prompt = f"{prompt1_stripped}\n{positive_prompt2.strip()}"
        else:
            # 如果不合并，仅使用 positive_prompt1 并去除空白
            combined_prompt = positive_prompt1.strip()

        # 返回三个输出值
        return (combined_prompt, negative_prompt, merge_positive)

    @classmethod
    def IS_CHANGED(cls, positive_prompt1, positive_prompt2, negative_prompt, merge_positive):
        # 根据所有输入参数生成唯一的哈希值
        import hashlib
        input_hash = hashlib.sha256(
            f"{positive_prompt1}_{positive_prompt2}_{negative_prompt}_{merge_positive}".encode()
        ).hexdigest()
        return input_hash

    def __init__(self):
        pass


class XIS_MultiPromptSwitch:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "positive_prompt1": ("STRING", {"default": "", "multiline": True, "placeholder": "输入正向提示词"}),
                "positive_prompt2": ("STRING", {"default": ""}),
                "enable_prompt2": ("BOOLEAN", {"default": True, "label_on": "启用", "label_off": "禁用"}),
                "positive_prompt3": ("STRING", {"default": ""}),
                "enable_prompt3": ("BOOLEAN", {"default": True, "label_on": "启用", "label_off": "禁用"}),
                "positive_prompt4": ("STRING", {"default": ""}),
                "enable_prompt4": ("BOOLEAN", {"default": True, "label_on": "启用", "label_off": "禁用"}),
                "positive_prompt5": ("STRING", {"default": ""}),
                "enable_prompt5": ("BOOLEAN", {"default": True, "label_on": "启用", "label_off": "禁用"}),
                "negative_prompt1": ("STRING", {"default": "", "multiline": True, "placeholder": "输入反向提示词"}),
                "negative_prompt2": ("STRING", {"default": ""}),
                "enable_neg_prompt2": ("BOOLEAN", {"default": True, "label_on": "启用", "label_off": "禁用"}),
                "negative_prompt3": ("STRING", {"default": ""}),
                "enable_neg_prompt3": ("BOOLEAN", {"default": True, "label_on": "启用", "label_off": "禁用"}),
                "negative_prompt4": ("STRING", {"default": ""}),
                "enable_neg_prompt4": ("BOOLEAN", {"default": True, "label_on": "启用", "label_off": "禁用"}),
                "negative_prompt5": ("STRING", {"default": ""}),
                "enable_neg_prompt5": ("BOOLEAN", {"default": True, "label_on": "启用", "label_off": "禁用"}),  
            }
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("combined_positive_prompt", "combined_negative_prompt")

    FUNCTION = "process_prompts"

    CATEGORY = "XISER_Nodes/Other"

    def process_prompts(self, positive_prompt1, positive_prompt2, positive_prompt3, positive_prompt4, positive_prompt5,
                        enable_prompt2, enable_prompt3, enable_prompt4, enable_prompt5,
                        negative_prompt1, negative_prompt2, negative_prompt3, negative_prompt4, negative_prompt5,
                        enable_neg_prompt2, enable_neg_prompt3, enable_neg_prompt4, enable_neg_prompt5):
        # 扩展结束符号集合
        end_symbols = {".", "。", ",", "，", ")", "!", "！", "?", "？", ";", "；"}

        # 处理正向提示词合并
        positive_prompts = [positive_prompt1.strip()]
        for prompt, enabled in [
            (positive_prompt2, enable_prompt2),
            (positive_prompt3, enable_prompt3),
            (positive_prompt4, enable_prompt4),
            (positive_prompt5, enable_prompt5)
        ]:
            if enabled and prompt and prompt.strip() != "none":
                positive_prompts.append(prompt.strip())

        combined_positive = ""
        for i, prompt in enumerate(positive_prompts):
            if not prompt:
                continue
            if i == 0:
                combined_positive = prompt
            else:
                prev_prompt = positive_prompts[i-1]
                if prev_prompt and prev_prompt[-1] not in end_symbols:
                    combined_positive += ".\n" + prompt
                else:
                    combined_positive += "\n" + prompt

        # 处理反向提示词合并
        negative_prompts = [negative_prompt1.strip()]
        for prompt, enabled in [
            (negative_prompt2, enable_neg_prompt2),
            (negative_prompt3, enable_neg_prompt3),
            (negative_prompt4, enable_neg_prompt4),
            (negative_prompt5, enable_neg_prompt5)
        ]:
            if enabled and prompt and prompt.strip() != "none":
                negative_prompts.append(prompt.strip())

        combined_negative = ""
        for i, prompt in enumerate(negative_prompts):
            if not prompt:
                continue
            if i == 0:
                combined_negative = prompt
            else:
                prev_prompt = negative_prompts[i-1]
                if prev_prompt and prev_prompt[-1] not in end_symbols:
                    combined_negative += ".\n" + prompt
                else:
                    combined_negative += "\n" + prompt

        return (combined_positive, combined_negative)

    @classmethod
    def IS_CHANGED(cls, positive_prompt1, positive_prompt2, positive_prompt3, positive_prompt4, positive_prompt5,
                   enable_prompt2, enable_prompt3, enable_prompt4, enable_prompt5,
                   negative_prompt1, negative_prompt2, negative_prompt3, negative_prompt4, negative_prompt5,
                   enable_neg_prompt2, enable_neg_prompt3, enable_neg_prompt4, enable_neg_prompt5):
        # 根据所有输入参数生成唯一的哈希值
        input_string = f"{positive_prompt1}_{positive_prompt2}_{positive_prompt3}_{positive_prompt4}_{positive_prompt5}_" \
                       f"{enable_prompt2}_{enable_prompt3}_{enable_prompt4}_{enable_prompt5}_" \
                       f"{negative_prompt1}_{negative_prompt2}_{negative_prompt3}_{negative_prompt4}_{negative_prompt5}_" \
                       f"{enable_neg_prompt2}_{enable_neg_prompt3}_{enable_neg_prompt4}_{enable_neg_prompt5}"
        input_hash = hashlib.sha256(input_string.encode()).hexdigest()
        return input_hash

    def __init__(self):
        pass



# 处理分辨率选择
class XIS_ResolutionSelector:
    @classmethod
    def INPUT_TYPES(cls):
        # 丰富预设分辨率选项
        resolution_options = [
            "256x256 (1:1)", "512x512 (1:1)", "768x768 (1:1)", "1024x1024 (1:1)", "2048x2048 (1:1)",
            "640x480 (4:3)", "800x600 (4:3)", "1024x768 (4:3)", "1280x960 (4:3)",
            "1280x720 (16:9)", "1920x1080 (16:9)", "2560x1440 (16:9)", "3840x2160 (16:9)",
            "720x1280 (9:16)", "1080x1920 (9:16)", "1440x2560 (9:16)", "2160x3840 (9:16)",
            "800x1200 (2:3)", "1200x1800 (2:3)", "1200x800 (3:2)", "1800x1200 (3:2)",
            "960x540 (16:9)", "854x480 (16:9)"
        ]
        
        return {
            "required": {
                "resolution": (resolution_options, {"default": "512x512 (1:1)"}),  # 下拉菜单选择分辨率
                "use_custom_resolution": ("BOOLEAN", {
                    "default": False,
                    "label_on": "使用自定义分辨率",
                    "label_off": "使用预设分辨率"
                }),  # 是否使用自定义分辨率
                "custom_width": ("INT", {
                    "default": 512,
                    "min": 1,
                    "max": 8192,
                    "step": 1,
                    "display": "number"
                }),  # 自定义宽度
                "custom_height": ("INT", {
                    "default": 512,
                    "min": 1,
                    "max": 8192,
                    "step": 1,
                    "display": "number"
                }),  # 自定义高度
                "swap_orientation": ("BOOLEAN", {
                    "default": False,
                    "label_on": "已切换横竖方向",
                    "label_off": "未切换横竖方向"
                })  # 是否切换横竖方向
            }
        }

    RETURN_TYPES = ("INT", "INT")
    RETURN_NAMES = ("width", "height")

    FUNCTION = "select_resolution"

    CATEGORY = "XISER_Nodes/Other"

    def select_resolution(self, resolution, use_custom_resolution, custom_width, custom_height, swap_orientation):
        # 解析预设分辨率
        if not use_custom_resolution:
            # 从字符串中提取宽度和高度
            width_str, height_str = resolution.split(" ")[0].split("x")
            width = int(width_str)
            height = int(height_str)
        else:
            # 使用自定义分辨率
            width = custom_width
            height = custom_height

        # 如果需要切换横竖方向
        if swap_orientation:
            width, height = height, width

        # 返回最终的宽度和高度
        return (width, height)

    @classmethod
    def IS_CHANGED(cls, resolution, use_custom_resolution, custom_width, custom_height, swap_orientation):
        # 根据所有输入参数生成唯一的哈希值
        input_hash = hashlib.sha256(
            f"{resolution}_{use_custom_resolution}_{custom_width}_{custom_height}_{swap_orientation}".encode()
        ).hexdigest()
        return input_hash

    def __init__(self):
        pass



NODE_CLASS_MAPPINGS = {
    "XIS_CompositorProcessor": XIS_CompositorProcessor,
    "XIS_KSamplerSettingsNode": XIS_KSamplerSettingsNode,
    "XIS_KSamplerSettingsUnpackNode": XIS_KSamplerSettingsUnpackNode,
    "XIS_IPAStyleSettings": XIS_IPAStyleSettings,
    "XIS_PromptProcessor": XIS_PromptProcessor,
    "XIS_ResolutionSelector": XIS_ResolutionSelector,
    "XIS_MultiPromptSwitch": XIS_MultiPromptSwitch,
}