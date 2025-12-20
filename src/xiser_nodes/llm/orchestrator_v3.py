"""
LLM Orchestrator V3 module - V3 version of LLM orchestrator node.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Sequence

import requests
import torch

from comfy_api.latest import ComfyExtension, io, ui

from ..key_store import KEY_STORE
from ..utils import logger
from .base import _gather_images, _image_to_base64
from .registry import _validate_inputs, build_default_registry

REGISTRY = build_default_registry()


def _unwrap_v3_data(data):
    """
    处理 v3 节点返回的数据格式，支持 io.NodeOutput 和原始数据
    """
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


def _dummy_image_tensor():
    return torch.zeros((1, 1, 1, 3), dtype=torch.float32)


class XIS_LLMOrchestratorV3(io.ComfyNode):
    """V3 version: Node that routes prompts through the selected LLM provider."""

    @classmethod
    def define_schema(cls):
        choices = REGISTRY.list_choices() or ["deepseek"]
        # Backward-compatible alias for old workflows
        if "qwen_image" not in choices:
            choices = choices + ["qwen_image"]

        return io.Schema(
            node_id="XIS_LLMOrchestrator",
            display_name="XIS LLMOrchestrator",
            category="XISER_Nodes/LLM",
            description="Route prompts to selected LLM providers with optional image inputs",
            inputs=[
                io.Combo.Input("provider", options=choices, default=choices[0]),
                io.String.Input("instruction", default="", multiline=True),
                io.Image.Input("image", optional=True),
                io.Image.Input("pack_images", optional=True),
                io.String.Input("model_override", default="", optional=True),
                io.String.Input("key_profile", default="", optional=True),
                io.Float.Input("temperature", default=0.35, min=0.0, max=1.0, step=0.01, optional=True),
                io.Float.Input("top_p", default=0.9, min=0.0, max=1.0, step=0.01, optional=True),
                io.Int.Input("max_tokens", default=512, min=16, max=4096, step=8, optional=True),
                io.Boolean.Input("enable_thinking", default=False, optional=True),
                io.Int.Input("thinking_budget", default=0, min=0, max=200000, step=1024, optional=True),
                io.Int.Input("seed", default=-1, min=-2, max=2147483647, step=1, optional=True,
                           tooltip="Seed: -1 random each run, -2 incremental counter, >=0 fixed",
                           control_after_generate=True,
                           display_mode=io.NumberDisplay.number),
                io.String.Input("negative_prompt", default="", multiline=True, optional=True),
                io.Combo.Input("image_size", options=["", "1664*928", "1472*1140", "1328*1328",
                                                    "1140*1472", "928*1664", "1024x1024",
                                                    "512x512", "2048x2048"], default="", optional=True),
                io.Int.Input("n_images", default=1, min=1, max=4, step=1, optional=True),
                io.String.Input("style", default="写实", optional=True),
                io.String.Input("quality", default="standard", optional=True),
                io.Boolean.Input("watermark", default=False, optional=True),
                io.Boolean.Input("prompt_extend", default=True, optional=True),
            ],
            outputs=[
                io.String.Output("response", display_name="response"),
                io.Image.Output("images", display_name="images", is_output_list=True),
                io.String.Output("image_urls", display_name="image_urls", is_output_list=True),
            ],
        )

    @classmethod
    def execute(
        cls,
        provider: str,
        instruction: str,
        image: Optional[torch.Tensor] = None,
        pack_images: Optional[Sequence[torch.Tensor]] = None,
        model_override: str = "",
        key_profile: str = "",
        temperature: float = 0.35,
        top_p: float = 0.9,
        max_tokens: int = 512,
        enable_thinking: bool = False,
        thinking_budget: int = 0,
        seed: int = -1,
        negative_prompt: str = "",
        image_size: str = "",
        n_images: int = 1,
        style: str = "写实",
        quality: str = "standard",
        watermark: bool = False,
        prompt_extend: bool = True,
    ):
        # 解包 v3 数据格式
        pack_images = _unwrap_v3_data(pack_images)

        # Backward-compatible alias
        if provider == "qwen_image":
            provider = "qwen-image-edit-plus"

        try:
            provider_impl = REGISTRY.get(provider)
        except KeyError:
            logger.error(f"Unknown provider '{provider}'")
            dummy = _dummy_image_tensor()
            return io.NodeOutput(
                f"Error: unknown provider '{provider}'",
                [dummy],
                []
            )

        if not instruction.strip():
            dummy = _dummy_image_tensor()
            return io.NodeOutput(
                "Error: instruction is empty. Provide a prompt to run the node.",
                [dummy],
                []
            )

        profile_clean = (key_profile or "").strip()
        resolved_key = KEY_STORE.get_key(profile_clean) if profile_clean else None
        if not resolved_key and not profile_clean:
            # Fallback: try a profile named after provider for backward compatibility
            resolved_key = KEY_STORE.get_key(provider)
            if resolved_key:
                profile_clean = provider
        if not resolved_key:
            dummy = _dummy_image_tensor()
            return io.NodeOutput(
                "Error: API key is missing. Open 'API key management' and select an API key for this node.",
                [dummy],
                [],
            )

        resolved_seed = seed if (seed is not None and seed >= 0) else None
        gathered = _gather_images(image, pack_images)
        max_images = provider_impl.config.max_images
        if max_images >= 0 and len(gathered) > max_images:
            logger.warning(
                f"Provider {provider} supports up to {max_images} images. Received {len(gathered)}, truncating."
            )
            gathered = gathered[:max_images]

        image_payloads = [_image_to_base64(img) for img in gathered]
        overrides: Dict[str, object] = {
            "system_prompt": provider_impl.config.default_system_prompt,
            "model": model_override or provider_impl.config.model,
            "temperature": temperature,
            "top_p": top_p,
            "max_tokens": max_tokens,
            "enable_thinking": enable_thinking,
            "thinking_budget": thinking_budget,
            "seed": resolved_seed if resolved_seed is not None else -1,
            "negative_prompt": negative_prompt,
            "image_size": image_size,
            "n_images": n_images,
            "style": style,
            "quality": quality,
            "watermark": watermark,
            "prompt_extend": prompt_extend,
        }

        validation_error = _validate_inputs(provider, instruction, gathered, overrides)
        if validation_error:
            dummy = _dummy_image_tensor()
            return io.NodeOutput(f"Error: {validation_error}", [dummy], [])

        try:
            response = provider_impl.invoke(instruction, image_payloads, resolved_key, overrides)
            text = provider_impl.extract_text(response)
            images = provider_impl.extract_images(response)
            image_urls = provider_impl.extract_image_urls(response)
        except requests.HTTPError as exc:
            err_detail = exc.response.text if exc.response is not None else str(exc)
            logger.error(f"LLM request failed: {exc} | {err_detail}")
            text = f"LLM request failed: {exc}: {err_detail}"
            images = []
            image_urls = []
        except Exception as exc:  # pylint: disable=broad-except
            logger.error(f"Failed to contact provider {provider}: {exc}")
            text = f"Error: {exc}"
            images = []
            image_urls = []

        images_out = images if images else [_dummy_image_tensor()]
        urls_out = image_urls if image_urls else []
        return io.NodeOutput(text or "", images_out, urls_out)

    @classmethod
    def fingerprint_inputs(
        cls,
        provider: str,
        instruction: str,
        image: Optional[torch.Tensor] = None,
        pack_images: Optional[Sequence[torch.Tensor]] = None,
        model_override: str = "",
        key_profile: str = "",
        temperature: float = 0.35,
        top_p: float = 0.9,
        max_tokens: int = 512,
        enable_thinking: bool = False,
        thinking_budget: int = 0,
        seed: int = -1,
        negative_prompt: str = "",
        image_size: str = "",
        n_images: int = 1,
        style: str = "写实",
        quality: str = "standard",
        watermark: bool = False,
        prompt_extend: bool = True,
    ):
        """
        生成输入指纹，确保节点在输入变化时重新执行。
        对于seed=-1（随机）的情况，返回随机指纹确保每次执行。
        对于seed=-2（递增）的情况，需要特殊处理。
        """
        import hashlib
        import json

        # 创建指纹数据
        fingerprint_data = {
            "provider": provider,
            "instruction": instruction[:100],  # 只取前100字符避免过长
            "model_override": model_override,
            "key_profile": key_profile,
            "temperature": temperature,
            "top_p": top_p,
            "max_tokens": max_tokens,
            "enable_thinking": enable_thinking,
            "thinking_budget": thinking_budget,
            "seed": seed,
            "negative_prompt": negative_prompt,
            "image_size": image_size,
            "n_images": n_images,
            "style": style,
            "quality": quality,
            "watermark": watermark,
            "prompt_extend": prompt_extend,
        }

        # 处理特殊seed值
        if seed == -1:
            # 随机seed，确保每次执行都不同
            import time
            fingerprint_data["_timestamp"] = time.time()
            fingerprint_data["_random"] = hash(str(time.time()))
        elif seed == -2:
            # 递增seed，需要特殊处理 - 使用计数器
            # 这里简化处理，使用时间戳
            import time
            fingerprint_data["_incremental"] = int(time.time() * 1000)

        # 添加图像信息（如果有）
        if image is not None:
            try:
                # 使用图像形状和部分数据作为指纹
                fingerprint_data["image_shape"] = str(image.shape)
                # 取图像的一小部分数据作为指纹
                if image.numel() > 0:
                    sample = image.flatten()[:100].cpu().numpy().tobytes()
                    fingerprint_data["image_sample"] = hashlib.md5(sample).hexdigest()
            except:
                pass

        if pack_images is not None:
            try:
                fingerprint_data["pack_images_count"] = len(pack_images)
                if len(pack_images) > 0:
                    sample_img = pack_images[0]
                    fingerprint_data["pack_image_shape"] = str(sample_img.shape)
            except:
                pass

        # 生成指纹
        fingerprint_str = json.dumps(fingerprint_data, sort_keys=True)
        return hashlib.md5(fingerprint_str.encode()).hexdigest()


class XISLLMOrchestratorExtension(ComfyExtension):
    async def get_node_list(self):
        return [XIS_LLMOrchestratorV3]


async def comfy_entrypoint():
    return XISLLMOrchestratorExtension()