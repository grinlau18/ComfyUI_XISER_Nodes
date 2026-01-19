"""视频提供者注册表"""

from typing import Dict, List, Optional, Any, Tuple
from .base import BaseVideoProvider, VideoProviderConfig


class VideoProviderRegistry:
    """视频提供者注册表"""

    def __init__(self):
        self._providers: Dict[str, BaseVideoProvider] = {}
        self._configs: Dict[str, VideoProviderConfig] = {}
        self._groups: Dict[str, List[str]] = {}

    def register(self,
                provider: BaseVideoProvider,
                group: str = "default") -> None:
        """注册提供者"""
        name = provider.config.name
        self._providers[name] = provider
        self._configs[name] = provider.config

        if group not in self._groups:
            self._groups[group] = []
        if name not in self._groups[group]:
            self._groups[group].append(name)

    def get(self, name: str) -> Optional[BaseVideoProvider]:
        """获取提供者"""
        return self._providers.get(name)

    def get_config(self, name: str) -> Optional[VideoProviderConfig]:
        """获取提供者配置"""
        return self._configs.get(name)

    def list_providers(self) -> List[str]:
        """列出所有提供者名称"""
        return list(self._providers.keys())

    def list_grouped_choices(self) -> List[Dict[str, Any]]:
        """列出分组的选择项，用于UI下拉框"""
        choices = []

        for group_name, provider_names in self._groups.items():
            for provider_name in provider_names:
                config = self._configs.get(provider_name)
                if config:
                    choices.append({
                        "value": provider_name,
                        "label": config.label,
                        "group": group_name
                    })

        return choices

    def get_provider_schema(self, provider_name: str) -> Dict[str, Any]:
        """获取提供者的架构信息"""
        config = self.get_config(provider_name)
        if not config:
            return {}

        return {
            "name": config.name,
            "label": config.label,
            "supported_sizes": config.supported_sizes,
            "supported_durations": config.supported_durations,
            "max_reference_videos": config.max_reference_videos,
            "max_prompt_length": config.max_prompt_length,
            "max_negative_prompt_length": config.max_negative_prompt_length
        }


# 全局注册表实例
_REGISTRY = VideoProviderRegistry()


def get_registry() -> VideoProviderRegistry:
    """获取全局注册表"""
    return _REGISTRY


def register_provider(provider: BaseVideoProvider, group: str = "default") -> None:
    """注册提供者到全局注册表"""
    _REGISTRY.register(provider, group)


def build_default_registry() -> VideoProviderRegistry:
    """构建默认注册表"""
    # 导入并注册所有提供者
    try:
        # 首先尝试使用新的配置系统
        from .providers_config import register_config_based_providers
        register_config_based_providers(_REGISTRY)
        print("[VGM] 使用统一配置系统注册提供者")
    except ImportError as e:
        print(f"[VGM] 警告：无法导入配置提供者: {e}")
        # 回退到旧的提供者系统
        try:
            from .providers_wan import register_wan_provider
            register_wan_provider(_REGISTRY)
            print("[VGM] 使用旧的万相提供者系统")
        except ImportError as e2:
            print(f"[VGM] 警告：无法导入万相视频提供者: {e2}")
    except Exception as e:
        print(f"[VGM] 警告：注册提供者时出错: {e}")

    return _REGISTRY


def _validate_inputs(provider_name: str,
                    prompt: str,
                    reference_videos: List,
                    size: str,
                    duration: int,
                    shot_type: str,
                    seed: int,
                    negative_prompt: str) -> Tuple[bool, str]:
    """验证输入参数"""
    provider = _REGISTRY.get(provider_name)
    if not provider:
        return False, f"未知的提供者：{provider_name}"

    return provider.validate_inputs(
        prompt=prompt,
        reference_videos=reference_videos,
        size=size,
        duration=duration,
        shot_type=shot_type,
        seed=seed,
        negative_prompt=negative_prompt
    )