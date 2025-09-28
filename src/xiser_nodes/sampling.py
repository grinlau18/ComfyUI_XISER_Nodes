# src/xiser_nodes/sampling.py
import torch
import numpy as np
from typing import Dict, Tuple, List
from scipy.interpolate import interp1d
from tqdm import tqdm
import comfy.samplers
from .utils import logger

# 自定义动态去噪采样器
class XIS_DynamicKSampler:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "latent_image": ("LATENT",),
                "positive": ("CONDITIONING",),
                "negative": ("CONDITIONING",),
                "start_denoise": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01}),
                "end_denoise": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01}),
                "denoise_curve_type": (
                    ["linear", "quadratic", "cubic", "exponential", "logarithmic", "sigmoid", "sine", "step"],
                    {"default": "linear"}
                ),
                "steps": ("INT", {"default": 20, "min": 1, "max": 100, "step": 1}),
                "start_cfg": ("FLOAT", {"default": 7.0, "min": 0.0, "max": 20.0, "step": 0.1}),
                "end_cfg": ("FLOAT", {"default": 7.0, "min": 0.0, "max": 20.0, "step": 0.1}),
                "CFG_curve_type": (
                    ["linear", "quadratic", "cubic", "exponential", "logarithmic", "sigmoid", "sine", "step"],
                    {"default": "linear"}
                ),
                "sampler_name": (comfy.samplers.KSampler.SAMPLERS, {"default": "dpmpp_sde"}),
                "scheduler": (comfy.samplers.KSampler.SCHEDULERS, {"default": "karras"}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
            },
            "optional": {
                "denoise_list": ("LIST",),
                "CFG_list": ("LIST",),
            }
        }

    RETURN_TYPES = ("LATENT",)
    RETURN_NAMES = ("latent",)
    FUNCTION = "sample"
    CATEGORY = "XISER_Nodes/Sampling"

    def compute_interpolated_values(self, start_val, end_val, batch_size, curve_type, min_clip=0.0, max_clip=1.0):
        if batch_size <= 0:
            return []

        t = np.linspace(0, 1, batch_size)

        if curve_type == "linear":
            values = start_val + (end_val - start_val) * t
        elif curve_type == "quadratic":
            values = start_val + (end_val - start_val) * t**2
        elif curve_type == "cubic":
            values = start_val + (end_val - start_val) * t**3
        elif curve_type == "exponential":
            values = start_val + (end_val - start_val) * (np.exp(t * 3) - 1) / (np.exp(3) - 1)
        elif curve_type == "logarithmic":
            values = start_val + (end_val - start_val) * np.log1p(t * (np.e - 1)) / np.log(np.e)
        elif curve_type == "sigmoid":
            values = start_val + (end_val - start_val) / (1 + np.exp(-10 * (t - 0.5)))
        elif curve_type == "sine":
            values = start_val + (end_val - start_val) * np.sin(np.pi / 2 * t)
        elif curve_type == "step":
            steps = 5
            values = start_val + (end_val - start_val) * np.floor(t * steps) / (steps - 1)

        return np.clip(values, min_clip, max_clip).tolist()

    def compute_denoise_values(self, start_denoise, end_denoise, batch_size, curve_type):
        return self.compute_interpolated_values(start_denoise, end_denoise, batch_size, curve_type, 0.0, 1.0)

    def compute_cfg_values(self, start_cfg, end_cfg, batch_size, curve_type):
        return self.compute_interpolated_values(start_cfg, end_cfg, batch_size, curve_type, 0.0, 20.0)

    def sample(self, model, latent_image, positive, negative, start_denoise, end_denoise, denoise_curve_type, steps, start_cfg, end_cfg, CFG_curve_type, sampler_name, scheduler, seed, denoise_list=None, CFG_list=None):
        latents = latent_image["samples"]
        batch_size = latents.shape[0]
        if batch_size == 0:
            raise ValueError("Input latent batch is empty")

        # 计算去噪值：优先使用denoise_list，如果没有则使用曲线计算
        if denoise_list is not None and len(denoise_list) > 0:
            denoise_values = []
            for i in range(batch_size):
                if i < len(denoise_list):
                    denoise_values.append(denoise_list[i])
                else:
                    denoise_values.append(denoise_list[-1])  # 重复最后一个值
            print(f"Using denoise_list values: {denoise_values}")
        else:
            denoise_values = self.compute_denoise_values(start_denoise, end_denoise, batch_size, denoise_curve_type)
            print(f"Computed denoise values: {denoise_values}")

        # 计算CFG值：优先使用CFG_list，如果没有则使用曲线计算
        if CFG_list is not None and len(CFG_list) > 0:
            cfg_values = []
            for i in range(batch_size):
                if i < len(CFG_list):
                    cfg_values.append(CFG_list[i])
                else:
                    cfg_values.append(CFG_list[-1])  # 重复最后一个值
            print(f"Using CFG_list values: {cfg_values}")
        else:
            cfg_values = self.compute_cfg_values(start_cfg, end_cfg, batch_size, CFG_curve_type)
            print(f"Computed CFG values: {cfg_values}")

        print(f"Denoise values: {denoise_values}")

        device = model.device if hasattr(model, 'device') else torch.device("cuda" if torch.cuda.is_available() else "cpu")
        latents = latents.to(device)

        output_latents = []
        ksampler = comfy.samplers.KSampler(
            model=model,
            steps=steps,
            device=device,
            sampler=sampler_name,
            scheduler=scheduler,
            denoise=1.0,  # 占位符，无实际影响
            model_options={}
        )

        # 添加批次进度条
        for i in tqdm(range(batch_size), desc="Sampling latents", unit="latent"):
            current_latent = latents[i:i+1]
            current_denoise = denoise_values[i]
            current_cfg = cfg_values[i]

            if abs(current_denoise) < 1e-6:
                output_latents.append(current_latent)
                print(f"Latent {i}: denoise=0, returning original latent")
                continue

            # 动态噪声尺度
            noise_scale = min(current_denoise * 2.0, 1.0)
            torch.manual_seed(seed + i)
            noise = torch.randn_like(current_latent).to(device)
            input_latent = current_latent + current_denoise * noise_scale * noise

            # 跳过早期去噪步骤
            start_step = int((1.0 - current_denoise) * steps) if current_denoise < 1.0 else 0

            try:
                sampled_latent = ksampler.sample(
                    noise=noise,
                    positive=positive,
                    negative=negative,
                    cfg=current_cfg,
                    latent_image=input_latent,
                    start_step=start_step,
                    disable_pbar=False,  # 启用 KSampler 进度条
                    seed=seed + i
                )
                print(f"Latent {i}: denoise={current_denoise:.3f}, cfg={current_cfg:.3f}, noise_scale={noise_scale:.3f}, start_step={start_step}, sampled, input mean={input_latent.mean().item():.4f}, output mean={sampled_latent.mean().item():.4f}")
            except Exception as e:
                print(f"Error sampling latent {i}: {e}")
                raise

            output_latents.append(sampled_latent)

        final_latent = torch.cat(output_latents, dim=0)
        return ({"samples": final_latent},)

# Latent动态混合节点
class XIS_LatentBlendNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "latent1": ("LATENT", {"tooltip": "First latent input"}),
                "latent2": ("LATENT", {"tooltip": "Second latent input"}),
                "start_strength": ("FLOAT", {
                    "default": 0.0,
                    "min": 0.0,
                    "max": 1.0,
                    "step": 0.01,
                    "tooltip": "Starting blend strength (0 = fully latent1, 1 = fully latent2)"
                }),
                "end_strength": ("FLOAT", {
                    "default": 1.0,
                    "min": 0.0,
                    "max": 1.0,
                    "step": 0.01,
                    "tooltip": "Ending blend strength (0 = fully latent1, 1 = fully latent2)"
                }),
                "batch_size": ("INT", {
                    "default": 16,
                    "min": 1,
                    "max": 100,
                    "step": 1,
                    "tooltip": "Number of output latent frames"
                }),
                "blend_mode": (["linear", "sigmoid", "ease_in", "ease_out", "ease_in_out"], {
                    "default": "linear",
                    "tooltip": "Blending mode for strength transition"
                }),
            }
        }

    RETURN_TYPES = ("LATENT",)
    RETURN_NAMES = ("latent_batch",)
    FUNCTION = "blend_latents"
    CATEGORY = "XISER_Nodes/Sampling"

    def blend_latents(self, latent1, latent2, start_strength, end_strength, batch_size, blend_mode):
        # Extract latent tensors
        latent1_samples = latent1["samples"]  # Shape: (batch, channels, height, width)
        latent2_samples = latent2["samples"]

        # Validate input shapes
        if latent1_samples.shape != latent2_samples.shape:
            raise ValueError("Latent1 and Latent2 must have the same shape")

        # Ensure batch_size is at least 1
        batch_size = max(1, batch_size)

        # Calculate blend weights based on blend_mode
        if batch_size == 1:
            weights = [start_strength]
        else:
            t = np.linspace(0, 1, batch_size)
            if blend_mode == "linear":
                weights = start_strength + (end_strength - start_strength) * t
            elif blend_mode == "sigmoid":
                # Sigmoid curve: smooth transition
                weights = 1 / (1 + np.exp(-10 * (t - 0.5)))  # Scaled to [0,1]
                weights = start_strength + (end_strength - start_strength) * weights
            elif blend_mode == "ease_in":
                # Quadratic ease-in
                weights = t ** 2
                weights = start_strength + (end_strength - start_strength) * weights
            elif blend_mode == "ease_out":
                # Quadratic ease-out
                weights = 1 - (1 - t) ** 2
                weights = start_strength + (end_strength - start_strength) * weights
            elif blend_mode == "ease_in_out":
                # Cubic ease-in-out
                weights = (t ** 3) * (t * (t * 6 - 15) + 10)
                weights = start_strength + (end_strength - start_strength) * weights

        # Initialize output tensor
        output_latents = []

        # Perform blending for each weight
        device = latent1_samples.device
        for weight in weights:
            weight = float(weight)  # Ensure weight is a scalar
            blended = latent1_samples * (1 - weight) + latent2_samples * weight
            output_latents.append(blended)

        # Stack output latents
        output_tensor = torch.cat(output_latents, dim=0)  # Shape: (batch_size, channels, height, width)

        # Return in ComfyUI LATENT format
        return ({"samples": output_tensor},)

NODE_CLASS_MAPPINGS = {
    "XIS_DynamicKSampler": XIS_DynamicKSampler,
    "XIS_LatentBlendNode": XIS_LatentBlendNode,
}