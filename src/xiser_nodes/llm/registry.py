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
    QwenImageMaxProvider,
    QwenVLFlashProvider,
    QwenVLPlusProvider,
    QwenVLProvider,
    Qwen3MaxProvider,
)
from .providers_wan import (
    WanImageProvider,
)

# Schema describing provider-specific capabilities and UI hints.
PROVIDER_SCHEMA: Dict[str, Dict[str, Any]] = {
    "deepseek": {
        "capabilities": {"text": True, "vision": False, "image_out": False},
        "requirements": {"instruction": True},
        "enums": {
            "image_size": [""],  # 纯文本模型，只允许空值
        },
    },
    "qwen": {
        "capabilities": {"text": True, "vision": False, "image_out": False},
        "requirements": {"instruction": True},
        "enums": {
            "image_size": [""],  # 纯文本模型，只允许空值
        },
    },
    "qwen-flash": {
        "capabilities": {"text": True, "vision": False, "image_out": False},
        "requirements": {"instruction": True},
        "enums": {
            "image_size": [""],  # 纯文本模型，只允许空值
        },
    },
    "qwen_vl": {
        "capabilities": {"text": True, "vision": True, "image_out": False},
        "requirements": {"instruction": True, "image_requires_text": True},
        "enums": {
            "image_size": [""],  # 视觉语言模型，只允许空值
        },
    },
    "qwen-vl-plus": {
        "capabilities": {"text": True, "vision": True, "image_out": False},
        "requirements": {"instruction": True, "image_requires_text": True},
        "enums": {
            "image_size": [""],  # 视觉语言模型，只允许空值
        },
    },
    "qwen3-vl-flash": {
        "capabilities": {"text": True, "vision": True, "image_out": False},
        "requirements": {"instruction": True, "image_requires_text": True},
        "enums": {
            "image_size": [""],  # 视觉语言模型，只允许空值
        },
    },
    "qwen3-max": {
        "capabilities": {"text": True, "vision": False, "image_out": False},
        "requirements": {"instruction": True},
        "enums": {
            "image_size": [""],  # 纯文本模型，只允许空值
        },
    },
    "moonshot": {
        "capabilities": {"text": True, "vision": False, "image_out": False},
        "requirements": {"instruction": True},
        "enums": {
            "image_size": [""],  # 纯文本模型，只允许空值
        },
    },
    "moonshot_vision": {
        "capabilities": {"text": True, "vision": True, "image_out": False},
        "requirements": {"instruction": True, "image_requires_text": True},
        "enums": {
            "image_size": [""],  # 视觉模型但不生成图像，只允许空值
        },
    },
    "qwen-image-edit-plus": {
        "capabilities": {"text": True, "vision": True, "image_out": True},
        "requirements": {"instruction": True, "image_required": True},
        "enums": {
            "image_size": ["", "1664*928", "1472*1140", "1328*1328", "1140*1472", "928*1664", "1024*1024", "512*512", "2048*2048"],
        },  # "" means auto
    },
    "qwen-image-max": {
        "capabilities": {"text": True, "vision": False, "image_out": True},
        "requirements": {"instruction": True},
        "enums": {
            "image_size": ["", "1664*928", "1472*1104", "1328*1328", "1104*1472", "928*1664"],
        },
    },
    "wan2.6-image": {
        "capabilities": {"text": True, "vision": True, "image_out": True},
        "requirements": {"instruction": True, "image_requires_text": True},
        "enums": {
            "image_size": ["", "1280*1280", "1024*1024", "512*512", "2048*2048"],
            "mode": ["image_edit", "interleave"],
        },
        # Note: image_edit mode requires at least one image (validated in provider)
        # interleave mode can generate images without input images
    },
}


def _validate_inputs(provider: str, instruction: str, images: List[torch.Tensor], overrides: Dict[str, Any]) -> str | None:
    schema = PROVIDER_SCHEMA.get(provider, {})
    caps = schema.get("capabilities", {})
    req = schema.get("requirements", {})
    enums = schema.get("enums", {})

    # 检查provider是否支持图像输入
    # DeepSeek提供者会优雅降级处理图片输入，所以跳过验证
    if images and not caps.get("vision", False) and provider != "deepseek":
        return f"Provider '{provider}' does not support image inputs."

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
    registry.register(Qwen3MaxProvider())
    registry.register(MoonshotChatProvider())
    registry.register(MoonshotVisionProvider())
    registry.register(QwenImageCreateProvider())
    registry.register(QwenImageMaxProvider())
    registry.register(WanImageProvider())
    return registry


__all__ = [
    "LLMProviderRegistry",
    "PROVIDER_SCHEMA",
    "_validate_inputs",
    "build_default_registry",
]
