"""Node orchestrator that routes prompts to selected LLM providers."""

from __future__ import annotations

from typing import Dict, List, Optional, Sequence

import requests
import torch

from ..key_store import KEY_STORE
from ..utils import logger
from .base import _gather_images, _image_to_base64
from .registry import _validate_inputs, build_default_registry

REGISTRY = build_default_registry()


class XIS_LLMOrchestrator:
    """Node that routes prompts through the selected LLM provider."""

    CATEGORY = "XISER_Nodes/LLM"
    RETURN_TYPES = ("STRING", "IMAGE", "STRING")
    RETURN_NAMES = ("response", "images", "image_urls")
    OUTPUT_IS_LIST = (False, True, True)
    FUNCTION = "forward"

    _seed_counter = 0
    _last_random_seed: Optional[int] = None
    @classmethod
    def INPUT_TYPES(cls):
        choices = REGISTRY.list_choices() or ["deepseek"]
        # Backward-compatible alias for old workflows
        if "qwen_image" not in choices:
            choices = choices + ["qwen_image"]
        return {
            "required": {
                "provider": (choices, {"default": choices[0]}),
                "instruction": ("STRING", {"default": "", "multiline": True}),
            },
            "optional": {
                "image": ("IMAGE", {"default": None}),
                "pack_images": ("IMAGE", {"default": None}),
                "model_override": ("STRING", {"default": ""}),
                "key_profile": ("STRING", {"default": ""}),
                "temperature": ("FLOAT", {"default": 0.35, "min": 0.0, "max": 1.0, "step": 0.01}),
                "top_p": ("FLOAT", {"default": 0.9, "min": 0.0, "max": 1.0, "step": 0.01}),
                "max_tokens": ("INT", {"default": 512, "min": 16, "max": 4096, "step": 8}),
                "enable_thinking": ("BOOLEAN", {"default": False}),
                "thinking_budget": ("INT", {"default": 0, "min": 0, "max": 200000, "step": 1024}),
                "seed": (
                    "INT",
                    {
                        "default": -1,
                        "min": -2,
                        "max": 2147483647,
                        "step": 1,
                        "randomizable": True,
                        "tooltip": "Seed: -1 random each run, -2 incremental counter, >=0 fixed",
                    },
                ),
                "negative_prompt": ("STRING", {"default": "", "multiline": True}),
                # Empty value means auto (let provider decide). qwen-image-plus accepts only the official sizes.
                "image_size": (
                    ("", "1664*928", "1472*1140", "1328*1328", "1140*1472", "928*1664", "1024x1024", "512x512", "2048x2048"),
                    {"default": ""},
                ),
                "n_images": ("INT", {"default": 1, "min": 1, "max": 4, "step": 1}),
                "style": ("STRING", {"default": "写实"}),
                "quality": ("STRING", {"default": "standard"}),
                "watermark": ("BOOLEAN", {"default": False}),
                "prompt_extend": ("BOOLEAN", {"default": True}),
            },
        }

    def forward(
        self,
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
        image_size: str = "1024x1024",
        n_images: int = 1,
        style: str = "写实",
        quality: str = "standard",
        watermark: bool = False,
        prompt_extend: bool = True,
        **kwargs,
    ):
        # Backward-compatible alias
        if provider == "qwen_image":
            provider = "qwen-image-edit-plus"

        try:
            provider_impl = REGISTRY.get(provider)
        except KeyError:
            logger.error(f"Unknown provider '{provider}'")
            dummy = _dummy_image_tensor()
            return (f"Error: unknown provider '{provider}'", [dummy], [])

        if not instruction.strip():
            dummy = _dummy_image_tensor()
            return ("Error: instruction is empty. Provide a prompt to run the node.", [dummy], [])

        profile_clean = (key_profile or "").strip()
        resolved_key = KEY_STORE.get_key(profile_clean) if profile_clean else None
        if not resolved_key and not profile_clean:
            # Fallback: try a profile named after provider for backward compatibility
            resolved_key = KEY_STORE.get_key(provider)
            if resolved_key:
                profile_clean = provider
        if not resolved_key:
            dummy = _dummy_image_tensor()
            return (
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
            return (f"Error: {validation_error}", [dummy], [])

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
        return (text or "", images_out, urls_out)


def _dummy_image_tensor():
    return torch.zeros((1, 1, 1, 3), dtype=torch.float32)


NODE_CLASS_MAPPINGS = {
    "XIS_LLMOrchestrator": XIS_LLMOrchestrator,
}
