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
from .providers_zimage import (
    ZImageProvider,
)

# 提供者分组映射
PROVIDER_GROUPS = {
    # 阿里系模型
    "alibaba": [
        "qwen",
        "qwen-flash",
        "qwen_vl",
        "qwen-vl-plus",
        "qwen3-vl-flash",
        "qwen3-max",
        "qwen-image-edit-plus",
        "qwen-image-max",
        "wan2.6-image",
        "z-image-turbo",
    ],
    # Moonshot分组
    "moonshot": [
        "moonshot",
        "moonshot_vision",
    ],
    # 其他模型（无前缀）
    "other": [
        "deepseek",
    ]
}

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
            "image_size": ["", "1280*1280", "1280*720", "720*1280", "1280*960", "960*1280", "1024*1024", "1152*896", "896*1152", "768*768"],
            "mode": ["image_edit", "interleave"],
        },
        # Note: image_edit mode requires at least one image (validated in provider)
        # interleave mode can generate images without input images
    },
    "z-image-turbo": {
        "capabilities": {"text": True, "vision": False, "image_out": True},
        "requirements": {"instruction": True},
        "enums": {
            "image_size": [
                "",  # 自动选择
                # 总像素1024*1024的推荐分辨率
                "1024*1024", "832*1248", "1248*832", "864*1152", "1152*864",
                "896*1152", "1152*896", "720*1280", "576*1344", "1280*720", "1344*576",
                # 总像素1280*1280的推荐分辨率
                "1280*1280", "1024*1536", "1536*1024", "1104*1472", "1472*1104",
                "1120*1440", "1440*1120", "864*1536", "720*1680", "1536*864", "1680*720",
                # 总像素1536*1536的推荐分辨率
                "1536*1536", "1248*1872", "1872*1248", "1296*1728", "1728*1296",
                "1344*1728", "1728*1344", "1152*2048", "864*2016", "2048*1152", "2016*864",
                # 其他常用分辨率
                "512*512", "768*768", "1024*1536", "1536*1024", "2048*2048"
            ],
        },
    },
}


def _validate_inputs(provider: str, instruction: str, images: List[torch.Tensor], overrides: Dict[str, Any]) -> str | None:
    schema = PROVIDER_SCHEMA.get(provider, {})
    caps = schema.get("capabilities", {})
    req = schema.get("requirements", {})
    enums = schema.get("enums", {})

    # 检查provider是否支持图像输入
    # DeepSeek和Z-Image提供者会优雅降级处理图片输入，所以跳过验证
    if images and not caps.get("vision", False) and provider not in ["deepseek", "z-image-turbo"]:
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
        """返回所有提供者的原始名称列表（无分组）"""
        return list(self._providers.keys())

    def list_grouped_choices(self) -> List[str]:
        """返回分组后的提供者名称列表"""
        grouped_choices = []

        # 首先添加无分组的模型
        for provider_name in self._providers.keys():
            if provider_name in PROVIDER_GROUPS["other"]:
                grouped_choices.append(provider_name)

        # 然后添加Moonshot分组模型（带前缀）
        for provider_name in self._providers.keys():
            if provider_name in PROVIDER_GROUPS["moonshot"]:
                grouped_choices.append(f"moonshot/{provider_name}")

        # 最后添加阿里系模型（带前缀）
        for provider_name in self._providers.keys():
            if provider_name in PROVIDER_GROUPS["alibaba"]:
                grouped_choices.append(f"alibaba/{provider_name}")

        return grouped_choices

    def get_label(self, key: str) -> str:
        """获取提供者的显示标签（支持分组前缀）"""
        # 如果key包含分组前缀，移除它
        actual_key = key
        if key.startswith("alibaba/"):
            actual_key = key[8:]  # 移除"alibaba/"前缀
        elif key.startswith("moonshot/"):
            actual_key = key[9:]  # 移除"moonshot/"前缀

        provider = self.get(actual_key)
        return provider.config.label

    def get_actual_provider_name(self, grouped_name: str) -> str:
        """将分组名称转换为实际的提供者名称"""
        if grouped_name.startswith("alibaba/"):
            return grouped_name[8:]  # 移除"alibaba/"前缀
        elif grouped_name.startswith("moonshot/"):
            return grouped_name[9:]  # 移除"moonshot/"前缀
        return grouped_name


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
    registry.register(ZImageProvider())
    return registry


__all__ = [
    "LLMProviderRegistry",
    "PROVIDER_SCHEMA",
    "_validate_inputs",
    "build_default_registry",
]
