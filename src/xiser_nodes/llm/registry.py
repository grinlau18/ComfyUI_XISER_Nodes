"""Provider registry and schema validation using unified configuration system."""

from __future__ import annotations

from typing import Any, Dict, List

import torch

from ..config import get_llm_config_loader, LLMConfigLoader
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

# 获取配置加载器
_config_loader: LLMConfigLoader = get_llm_config_loader()

# 提供者分组映射 - 现在从配置文件加载
def get_provider_groups():
    """从配置加载提供者分组"""
    groups = {}
    all_groups = _config_loader.get_all_groups()
    for group_name, group_config in all_groups.items():
        groups[group_name] = group_config.models
    return groups

PROVIDER_GROUPS = get_provider_groups()

# Schema describing provider-specific capabilities and UI hints - now loaded from config
def get_provider_schema():
    """从配置加载提供者Schema"""
    schema = {}
    all_models = _config_loader.get_all_models()

    for model_name, model_config in all_models.items():
        # 将配置转换为旧版Schema格式以保持兼容性
        schema[model_name] = {
            "capabilities": {
                "text": True,  # 所有LLM都支持文本
                "vision": model_config.supports_vision,
                "image_out": model_config.supports_image_generation,
            },
            "requirements": {
                "instruction": True,
            },
            "enums": {},
        }

        # 添加图像尺寸枚举（如果支持）
        if model_config.supported_image_sizes:
            schema[model_name]["enums"]["image_size"] = model_config.supported_image_sizes

        # 添加模式枚举（如果支持）
        if model_config.supported_modes:
            schema[model_name]["enums"]["mode"] = model_config.supported_modes

    return schema

PROVIDER_SCHEMA = get_provider_schema()


def _validate_inputs(provider: str, instruction: str, images: List[torch.Tensor], overrides: Dict[str, Any]) -> str | None:
    # 使用新的配置系统进行验证
    config_loader = get_llm_config_loader()
    validation_result, message = config_loader.validate_model_inputs(provider, {
        "instruction": instruction,
        "images": images,
        **overrides
    })
    if not validation_result:
        return message
    return None


class LLMProviderRegistry:
    """Keeps provider implementations discoverable using unified configuration system."""

    def __init__(self):
        self._providers: Dict[str, BaseLLMProvider] = {}
        # Load providers based on configuration
        self._load_providers_from_config()

    def _load_providers_from_config(self):
        """根据配置加载提供者"""
        # 这里可以根据配置动态加载提供者
        # 为了向后兼容，我们仍然手动注册现有的提供者
        # 但在未来版本中，可以实现基于配置的动态注册
        pass

    def register(self, provider: BaseLLMProvider) -> None:
        self._providers[provider.config.name] = provider

    def get(self, name: str) -> BaseLLMProvider:
        if name not in self._providers:
            raise KeyError(f"Provider '{name}' is not registered")
        return self._providers[name]

    def list_choices(self) -> List[str]:
        """返回所有提供者的原始名称列表（无分组）"""
        # 从配置加载所有模型名称
        config_loader = get_llm_config_loader()
        all_models = config_loader.get_all_models()
        return list(all_models.keys())

    def list_grouped_choices(self) -> List[str]:
        """返回分组后的提供者名称列表"""
        # 从配置加载分组信息
        config_loader = get_llm_config_loader()
        all_groups = config_loader.get_all_groups()

        grouped_choices = []

        # 按照配置中的分组顺序添加选项
        for group_name, group_config in all_groups.items():
            for model_name in group_config.models:
                # 根据分组名称添加前缀
                if group_name == "alibaba":
                    grouped_choices.append(f"alibaba/{model_name}")
                elif group_name == "moonshot":
                    grouped_choices.append(f"moonshot/{model_name}")
                elif group_name == "other":
                    # other组不加前缀
                    grouped_choices.append(model_name)
                else:
                    # 其他组也加前缀以保持一致性
                    grouped_choices.append(f"{group_name}/{model_name}")

        return grouped_choices

    def get_label(self, key: str) -> str:
        """获取提供者的显示标签（支持分组前缀）"""
        # 如果key包含分组前缀，移除它
        actual_key = self.get_actual_provider_name(key)

        # 从配置获取标签
        config_loader = get_llm_config_loader()
        model_config = config_loader.get_model(actual_key)
        if model_config:
            return model_config.label

        # 如果配置中没有，回退到注册的提供者
        provider = self.get(actual_key)
        return provider.config.label

    def get_actual_provider_name(self, grouped_name: str) -> str:
        """将分组名称转换为实际的提供者名称"""
        if grouped_name.startswith("alibaba/"):
            return grouped_name[8:]  # 移除"alibaba/"前缀
        elif grouped_name.startswith("moonshot/"):
            return grouped_name[9:]  # 移除"moonshot/"前缀
        elif "/" in grouped_name:  # 其他分组
            return grouped_name.split("/", 1)[1]
        return grouped_name


def build_default_registry() -> LLMProviderRegistry:
    registry = LLMProviderRegistry()
    # 保持原有的提供者注册方式以确保向后兼容
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
