"""Provider registry and schema validation."""

from __future__ import annotations

from typing import Any, Dict, List

import torch

from .base import BaseLLMProvider
from .providers_deepseek import DeepSeekChatProvider
from .providers_moonshot import MoonshotChatProvider, MoonshotVisionProvider
from .providers_qwen import (
    QwenChatProvider,
    QwenFlashProvider,
    QwenImageCreateProvider,
    QwenImagePlusProvider,
    QwenMTImageProvider,
    QwenVLFlashProvider,
    QwenVLPlusProvider,
    QwenVLProvider,
)

# Schema describing provider-specific capabilities and UI hints.
PROVIDER_SCHEMA: Dict[str, Dict[str, Any]] = {
    "deepseek": {
        "capabilities": {"text": True, "vision": True, "image_out": False},
        "requirements": {"instruction": True, "image_requires_text": True},
        "enums": {},
    },
    "qwen": {
        "capabilities": {"text": True, "vision": True, "image_out": False},
        "requirements": {"instruction": True, "image_requires_text": True},
        "enums": {},
    },
    "qwen-flash": {
        "capabilities": {"text": True, "vision": False, "image_out": False},
        "requirements": {"instruction": True},
        "enums": {},
    },
    "qwen_vl": {
        "capabilities": {"text": True, "vision": True, "image_out": False},
        "requirements": {"instruction": True, "image_requires_text": True},
        "enums": {},
    },
    "qwen-vl-plus": {
        "capabilities": {"text": True, "vision": True, "image_out": False},
        "requirements": {"instruction": True, "image_requires_text": True},
        "enums": {},
    },
    "qwen3-vl-flash": {
        "capabilities": {"text": True, "vision": True, "image_out": False},
        "requirements": {"instruction": True, "image_requires_text": True},
        "enums": {},
    },
    "qwen-mt-image": {
        "capabilities": {"text": True, "vision": True, "image_out": True},
        "requirements": {"instruction": True, "image_requires_text": True},
        "enums": {},
    },
    "moonshot": {
        "capabilities": {"text": True, "vision": False, "image_out": False},
        "requirements": {"instruction": True},
        "enums": {},
    },
    "moonshot_vision": {
        "capabilities": {"text": True, "vision": True, "image_out": False},
        "requirements": {"instruction": True, "image_requires_text": True},
        "enums": {},
    },
    "qwen-image-edit-plus": {
        "capabilities": {"text": True, "vision": False, "image_out": True},
        "requirements": {"instruction": True, "image_required": True},
        "enums": {
            "image_size": ["", "1664*928", "1472*1140", "1328*1328", "1140*1472", "928*1664", "1024x1024", "512x512", "2048x2048"],
        },  # "" means auto
    },
    "qwen_image_plus": {
        "capabilities": {"text": True, "vision": False, "image_out": True},
        "requirements": {"instruction": True},
        "enums": {
            "image_size": ["1664*928", "1472*1140", "1328*1328", "1140*1472", "928*1664"],
        },
    },
}


def _validate_inputs(provider: str, instruction: str, images: List[torch.Tensor], overrides: Dict[str, Any]) -> str | None:
    schema = PROVIDER_SCHEMA.get(provider, {})
    req = schema.get("requirements", {})
    enums = schema.get("enums", {})

    if req.get("instruction") and not instruction.strip():
        return "Instruction is required."
    if req.get("image_requires_text") and images and not instruction.strip():
        return "Images require a non-empty instruction for this provider."
    if req.get("image_required") and not images:
        return "At least one image is required for this provider."

    for field, allowed in enums.items():
        val = str(overrides.get(field, ""))
        if allowed and val and val not in allowed:
            return f"Invalid value for {field}. Allowed: {', '.join(allowed)}"
    return None


class LLMProviderRegistry:
    """Keeps provider implementations discoverable."""

    def __init__(self):
        self._providers: Dict[str, BaseLLMProvider] = {}

    def register(self, provider: BaseLLMProvider) -> None:
        self._providers[provider.config.name] = provider

    def get(self, name: str) -> BaseLLMProvider:
        if name not in self._providers:
            raise KeyError(f"Provider '{name}' is not registered")
        return self._providers[name]

    def list_choices(self) -> List[str]:
        return list(self._providers.keys())

    def get_label(self, key: str) -> str:
        provider = self.get(key)
        return provider.config.label


def build_default_registry() -> LLMProviderRegistry:
    registry = LLMProviderRegistry()
    registry.register(DeepSeekChatProvider())
    registry.register(QwenChatProvider())
    registry.register(QwenFlashProvider())
    registry.register(QwenVLProvider())
    registry.register(QwenVLPlusProvider())
    registry.register(QwenVLFlashProvider())
    registry.register(QwenMTImageProvider())
    registry.register(MoonshotChatProvider())
    registry.register(MoonshotVisionProvider())
    registry.register(QwenImageCreateProvider())
    registry.register(QwenImagePlusProvider())
    return registry


__all__ = [
    "LLMProviderRegistry",
    "PROVIDER_SCHEMA",
    "_validate_inputs",
    "build_default_registry",
]
