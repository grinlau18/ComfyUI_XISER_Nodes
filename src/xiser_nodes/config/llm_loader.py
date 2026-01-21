"""LLM配置加载器 - 统一配置系统"""

import os
import yaml
from typing import Dict, List, Any, Optional, Union
from dataclasses import dataclass, field
from pathlib import Path
import logging

logger = logging.getLogger(__name__)


@dataclass
class LLMModelUIConfig:
    """LLM模型UI配置"""
    has_temperature: bool = False
    has_top_p: bool = False
    has_max_tokens: bool = False
    has_enable_thinking: bool = False
    has_thinking_budget: bool = False
    has_negative_prompt: bool = False
    has_image_size: bool = False
    has_gen_image: bool = False
    has_max_images: bool = False
    has_watermark: bool = False
    has_prompt_extend: bool = False
    has_mode: bool = False
    has_model_override: bool = False
    has_key_profile: bool = False
    has_seed: bool = False
    has_enable_cache: bool = False
    default_temperature: float = 0.7
    default_top_p: float = 0.8
    default_max_tokens: int = 512
    default_enable_thinking: bool = False
    default_thinking_budget: int = 0
    default_negative_prompt: str = ""
    default_image_size: str = ""
    default_gen_image: int = 1
    default_max_images: int = 3
    default_watermark: bool = False
    default_prompt_extend: bool = True
    default_mode: str = "chat"
    default_seed: int = 42
    default_enable_cache: bool = True


@dataclass
class LLMModelConfig:
    """LLM模型配置"""
    # 基本信息
    name: str
    label: str
    provider_type: str  # chat, vision, image_generation
    group: str = "default"

    # API配置
    endpoint: str = ""
    model: str = ""
    timeout: float = 60.0
    max_images: int = 4

    # 功能支持
    supports_vision: bool = False
    supports_image_generation: bool = False
    supports_thinking: bool = False
    supports_streaming: bool = False
    supports_custom_params: bool = False

    # 参数范围
    max_tokens_min: int = 16
    max_tokens_max: int = 4096
    temperature_min: float = 0.0
    temperature_max: float = 1.0
    top_p_min: float = 0.0
    top_p_max: float = 1.0

    # 支持的选项
    supported_image_sizes: List[str] = field(default_factory=list)
    supported_modes: List[str] = field(default_factory=list)

    # UI配置
    ui: LLMModelUIConfig = field(default_factory=LLMModelUIConfig)

    def get_endpoint_for_region(self, region: str, config_loader: 'LLMConfigLoader') -> str:
        """根据地区获取实际的API端点"""
        # 如果endpoint包含模板变量，进行替换
        endpoint = self.endpoint

        # 替换地区变量
        if "{{" in endpoint and "}}" in endpoint:
            # 提取变量名
            var_start = endpoint.find("{{") + 2
            var_end = endpoint.find("}}")
            var_name = endpoint[var_start:var_end].strip()

            # 根据变量名选择端点模板
            endpoint_template = config_loader.global_config.get("endpoint_templates", {}).get(var_name)

            if endpoint_template:
                endpoint = endpoint_template
            else:
                # 回退到默认端点
                endpoint = endpoint.replace(f"{{{{{var_name}}}}}", "")
                logger.warning(f"未找到变量 {var_name} 的端点模板，使用默认端点")

        return endpoint

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典（用于JSON序列化）"""
        return {
            "name": self.name,
            "label": self.label,
            "provider_type": self.provider_type,
            "group": self.group,
            "endpoint": self.endpoint,
            "model": self.model,
            "timeout": self.timeout,
            "max_images": self.max_images,
            "supports_vision": self.supports_vision,
            "supports_image_generation": self.supports_image_generation,
            "supports_thinking": self.supports_thinking,
            "supports_streaming": self.supports_streaming,
            "supports_custom_params": self.supports_custom_params,
            "max_tokens_min": self.max_tokens_min,
            "max_tokens_max": self.max_tokens_max,
            "temperature_min": self.temperature_min,
            "temperature_max": self.temperature_max,
            "top_p_min": self.top_p_min,
            "top_p_max": self.top_p_max,
            "supported_image_sizes": self.supported_image_sizes,
            "supported_modes": self.supported_modes,
            "ui": {
                "has_temperature": self.ui.has_temperature,
                "has_top_p": self.ui.has_top_p,
                "has_max_tokens": self.ui.has_max_tokens,
                "has_enable_thinking": self.ui.has_enable_thinking,
                "has_thinking_budget": self.ui.has_thinking_budget,
                "has_negative_prompt": self.ui.has_negative_prompt,
                "has_image_size": self.ui.has_image_size,
                "has_gen_image": self.ui.has_gen_image,
                "has_max_images": self.ui.has_max_images,
                "has_watermark": self.ui.has_watermark,
                "has_prompt_extend": self.ui.has_prompt_extend,
                "has_mode": self.ui.has_mode,
                "has_model_override": self.ui.has_model_override,
                "has_key_profile": self.ui.has_key_profile,
                "has_seed": self.ui.has_seed,
                "has_enable_cache": self.ui.has_enable_cache,
                "default_temperature": self.ui.default_temperature,
                "default_top_p": self.ui.default_top_p,
                "default_max_tokens": self.ui.default_max_tokens,
                "default_enable_thinking": self.ui.default_enable_thinking,
                "default_thinking_budget": self.ui.default_thinking_budget,
                "default_negative_prompt": self.ui.default_negative_prompt,
                "default_image_size": self.ui.default_image_size,
                "default_gen_image": self.ui.default_gen_image,
                "default_max_images": self.ui.default_max_images,
                "default_watermark": self.ui.default_watermark,
                "default_prompt_extend": self.ui.default_prompt_extend,
                "default_mode": self.ui.default_mode,
                "default_seed": self.ui.default_seed,
                "default_enable_cache": self.ui.default_enable_cache,
            }
        }


@dataclass
class LLMGroupConfig:
    """LLM模型分组配置"""
    name: str
    description: str = ""
    models: List[str] = field(default_factory=list)


@dataclass
class LLMProviderTypeConfig:
    """LLM提供者类型配置"""
    name: str
    description: str = ""
    icon: str = ""
    color: str = ""

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典（用于JSON序列化）"""
        return {
            "name": self.name,
            "description": self.description,
            "icon": self.icon,
            "color": self.color
        }


class LLMConfigLoader:
    """LLM配置加载器"""

    def __init__(self, config_path: Optional[str] = None):
        self.config_path = config_path or self._get_default_config_path()
        self._config_data: Optional[Dict[str, Any]] = None
        self._models: Dict[str, LLMModelConfig] = {}
        self._groups: Dict[str, LLMGroupConfig] = {}
        self._provider_types: Dict[str, LLMProviderTypeConfig] = {}

    def _get_default_config_path(self) -> str:
        """获取默认配置文件路径"""
        # 从当前文件位置计算项目根目录
        current_file = Path(__file__).resolve()
        # src/xiser_nodes/config/loader.py -> 项目根目录
        project_root = current_file.parent.parent.parent.parent
        config_path = project_root / "config" / "llm_models.yaml"

        # 如果不存在，尝试相对路径
        if not config_path.exists():
            # 尝试从当前工作目录查找
            cwd_config = Path.cwd() / "config" / "llm_models.yaml"
            if cwd_config.exists():
                return str(cwd_config)

        return str(config_path)

    def load(self) -> None:
        """加载配置文件"""
        try:
            with open(self.config_path, 'r', encoding='utf-8') as f:
                self._config_data = yaml.safe_load(f)

            if not self._config_data:
                raise ValueError("配置文件为空")

            # 加载全局配置
            self.global_config = self._config_data.get("global", {})

            # 加载模型配置
            models_data = self._config_data.get("models", {})
            for model_name, model_data in models_data.items():
                # 创建UI配置
                ui_data = model_data.get("ui", {})
                ui_config = LLMModelUIConfig(
                    has_temperature=ui_data.get("has_temperature", False),
                    has_top_p=ui_data.get("has_top_p", False),
                    has_max_tokens=ui_data.get("has_max_tokens", False),
                    has_enable_thinking=ui_data.get("has_enable_thinking", False),
                    has_thinking_budget=ui_data.get("has_thinking_budget", False),
                    has_negative_prompt=ui_data.get("has_negative_prompt", False),
                    has_image_size=ui_data.get("has_image_size", False),
                    has_gen_image=ui_data.get("has_gen_image", False),
                    has_max_images=ui_data.get("has_max_images", False),
                    has_watermark=ui_data.get("has_watermark", False),
                    has_prompt_extend=ui_data.get("has_prompt_extend", False),
                    has_mode=ui_data.get("has_mode", False),
                    has_model_override=ui_data.get("has_model_override", False),
                    has_key_profile=ui_data.get("has_key_profile", False),
                    has_seed=ui_data.get("has_seed", False),
                    has_enable_cache=ui_data.get("has_enable_cache", False),
                    default_temperature=ui_data.get("default_temperature", 0.7),
                    default_top_p=ui_data.get("default_top_p", 0.8),
                    default_max_tokens=ui_data.get("default_max_tokens", 512),
                    default_enable_thinking=ui_data.get("default_enable_thinking", False),
                    default_thinking_budget=ui_data.get("default_thinking_budget", 0),
                    default_negative_prompt=ui_data.get("default_negative_prompt", ""),
                    default_image_size=ui_data.get("default_image_size", ""),
                    default_gen_image=ui_data.get("default_gen_image", 1),
                    default_max_images=ui_data.get("default_max_images", 3),
                    default_watermark=ui_data.get("default_watermark", False),
                    default_prompt_extend=ui_data.get("default_prompt_extend", True),
                    default_mode=ui_data.get("default_mode", "chat"),
                    default_seed=ui_data.get("default_seed", 42),
                    default_enable_cache=ui_data.get("default_enable_cache", True),
                )

                # 创建模型配置
                model_config = LLMModelConfig(
                    name=model_data.get("name", model_name),
                    label=model_data.get("label", model_name),
                    provider_type=model_data.get("provider_type", "chat"),
                    group=model_data.get("group", "default"),
                    endpoint=model_data.get("endpoint", ""),
                    model=model_data.get("model", ""),
                    timeout=model_data.get("timeout", 60.0),
                    max_images=model_data.get("max_images", 4),
                    supports_vision=model_data.get("supports_vision", False),
                    supports_image_generation=model_data.get("supports_image_generation", False),
                    supports_thinking=model_data.get("supports_thinking", False),
                    supports_streaming=model_data.get("supports_streaming", False),
                    supports_custom_params=model_data.get("supports_custom_params", False),
                    max_tokens_min=model_data.get("max_tokens_min", 16),
                    max_tokens_max=model_data.get("max_tokens_max", 4096),
                    temperature_min=model_data.get("temperature_min", 0.0),
                    temperature_max=model_data.get("temperature_max", 1.0),
                    top_p_min=model_data.get("top_p_min", 0.0),
                    top_p_max=model_data.get("top_p_max", 1.0),
                    supported_image_sizes=model_data.get("supported_image_sizes", []),
                    supported_modes=model_data.get("supported_modes", []),
                    ui=ui_config,
                )

                self._models[model_name] = model_config

            # 加载分组配置
            groups_data = self._config_data.get("groups", {})
            for group_name, group_data in groups_data.items():
                group_config = LLMGroupConfig(
                    name=group_data.get("name", group_name),
                    description=group_data.get("description", ""),
                    models=group_data.get("models", []),
                )
                self._groups[group_name] = group_config

            # 加载提供者类型配置
            provider_types_data = self._config_data.get("provider_types", {})
            for type_name, type_data in provider_types_data.items():
                provider_type_config = LLMProviderTypeConfig(
                    name=type_data.get("name", type_name),
                    description=type_data.get("description", ""),
                    icon=type_data.get("icon", ""),
                    color=type_data.get("color", ""),
                )
                self._provider_types[type_name] = provider_type_config

            logger.info(f"LLM配置加载成功，共加载 {len(self._models)} 个模型")

        except Exception as e:
            logger.error(f"加载LLM配置文件失败: {e}")
            raise

    def get_model(self, model_name: str) -> Optional[LLMModelConfig]:
        """获取模型配置"""
        return self._models.get(model_name)

    def get_all_models(self) -> Dict[str, LLMModelConfig]:
        """获取所有模型配置"""
        return self._models.copy()

    def get_models_by_group(self, group_name: str) -> List[LLMModelConfig]:
        """获取指定分组的模型"""
        group = self._groups.get(group_name)
        if not group:
            return []

        models = []
        for model_name in group.models:
            model = self.get_model(model_name)
            if model:
                models.append(model)

        return models

    def get_group(self, group_name: str) -> Optional[LLMGroupConfig]:
        """获取分组配置"""
        return self._groups.get(group_name)

    def get_all_groups(self) -> Dict[str, LLMGroupConfig]:
        """获取所有分组配置"""
        return self._groups.copy()

    def get_provider_type(self, type_name: str) -> Optional[LLMProviderTypeConfig]:
        """获取提供者类型配置"""
        return self._provider_types.get(type_name)

    def get_all_provider_types(self) -> Dict[str, LLMProviderTypeConfig]:
        """获取所有提供者类型配置"""
        return self._provider_types.copy()

    def get_model_choices_for_ui(self) -> List[Dict[str, Any]]:
        """获取UI下拉框选项"""
        choices = []

        for group_name, group in self._groups.items():
            for model_name in group.models:
                model = self.get_model(model_name)
                if model:
                    choices.append({
                        "value": model_name,
                        "label": model.label,
                        "group": group.name,
                        "provider_type": model.provider_type,
                    })

        return choices

    def get_ui_config_for_model(self, model_name: str) -> Optional[Dict[str, Any]]:
        """获取模型的UI配置（用于前端）"""
        model = self.get_model(model_name)
        if not model:
            return None

        # 转换为前端需要的格式
        return {
            "providerType": model.provider_type,
            "supportsVision": model.supports_vision,
            "supportsImageGeneration": model.supports_image_generation,
            "supportsThinking": model.supports_thinking,
            "supportsStreaming": model.supports_streaming,
            "supportsCustomParams": model.supports_custom_params,
            "maxTokensMin": model.max_tokens_min,
            "maxTokensMax": model.max_tokens_max,
            "temperatureMin": model.temperature_min,
            "temperatureMax": model.temperature_max,
            "topPMin": model.top_p_min,
            "topPMax": model.top_p_max,
            "supportedImageSizes": model.supported_image_sizes,
            "supportedModes": model.supported_modes,
            "ui": {
                "hasTemperature": model.ui.has_temperature,
                "hasTopP": model.ui.has_top_p,
                "hasMaxTokens": model.ui.has_max_tokens,
                "hasEnableThinking": model.ui.has_enable_thinking,
                "hasThinkingBudget": model.ui.has_thinking_budget,
                "hasNegativePrompt": model.ui.has_negative_prompt,
                "hasImageSize": model.ui.has_image_size,
                "hasGenImage": model.ui.has_gen_image,
                "hasMaxImages": model.ui.has_max_images,
                "hasWatermark": model.ui.has_watermark,
                "hasPromptExtend": model.ui.has_prompt_extend,
                "hasMode": model.ui.has_mode,
                "hasModelOverride": model.ui.has_model_override,
                "hasKeyProfile": model.ui.has_key_profile,
                "hasSeed": model.ui.has_seed,
                "hasEnableCache": model.ui.has_enable_cache,
                "defaultTemperature": model.ui.default_temperature,
                "defaultTopP": model.ui.default_top_p,
                "defaultMaxTokens": model.ui.default_max_tokens,
                "defaultEnableThinking": model.ui.default_enable_thinking,
                "defaultThinkingBudget": model.ui.default_thinking_budget,
                "defaultNegativePrompt": model.ui.default_negative_prompt,
                "defaultImageSize": model.ui.default_image_size,
                "defaultGenImage": model.ui.default_gen_image,
                "defaultMaxImages": model.ui.default_max_images,
                "defaultWatermark": model.ui.default_watermark,
                "defaultPromptExtend": model.ui.default_prompt_extend,
                "defaultMode": model.ui.default_mode,
                "defaultSeed": model.ui.default_seed,
                "defaultEnableCache": model.ui.default_enable_cache,
            }
        }

    def get_all_ui_configs(self) -> Dict[str, Dict[str, Any]]:
        """获取所有模型的UI配置"""
        configs = {}
        for model_name in self._models.keys():
            ui_config = self.get_ui_config_for_model(model_name)
            if ui_config:
                configs[model_name] = ui_config

        return configs

    def validate_model_inputs(self, model_name: str, inputs: Dict[str, Any]) -> tuple[bool, str]:
        """验证模型输入参数"""
        model = self.get_model(model_name)
        if not model:
            return False, f"未知的模型: {model_name}"

        # 验证提示词长度
        instruction = inputs.get("instruction", "")
        if len(instruction) > 10000:  # 假设最大长度为10000
            return False, f"提示词长度超过限制（最大10000字符）"

        # 验证负面提示词长度
        negative_prompt = inputs.get("negative_prompt", "")
        if negative_prompt and len(negative_prompt) > 1000:
            return False, f"负面提示词长度超过限制（最大1000字符）"

        # 验证种子
        seed = inputs.get("seed", 42)
        if seed < -2 or seed > 4294967295:
            return False, f"种子值超出范围（-2 到 4294967295）"

        # 验证max_tokens
        max_tokens = inputs.get("max_tokens", model.ui.default_max_tokens)
        if max_tokens < model.max_tokens_min or max_tokens > model.max_tokens_max:
            return False, f"max_tokens值超出范围（{model.max_tokens_min} 到 {model.max_tokens_max}）"

        # 验证temperature
        temperature = inputs.get("temperature", model.ui.default_temperature)
        if temperature < model.temperature_min or temperature > model.temperature_max:
            return False, f"temperature值超出范围（{model.temperature_min} 到 {model.temperature_max}）"

        # 验证top_p
        top_p = inputs.get("top_p", model.ui.default_top_p)
        if top_p < model.top_p_min or top_p > model.top_p_max:
            return False, f"top_p值超出范围（{model.top_p_min} 到 {model.top_p_max}）"

        # 验证gen_image
        gen_image = inputs.get("gen_image", model.ui.default_gen_image)
        if gen_image < 1 or gen_image > 4:
            return False, f"gen_image值超出范围（1 到 4）"

        # 验证max_images
        max_images = inputs.get("max_images", model.ui.default_max_images)
        if max_images < 1 or max_images > 10:
            return False, f"max_images值超出范围（1 到 10）"

        # 验证图像尺寸
        image_size = inputs.get("image_size", model.ui.default_image_size)
        if image_size and model.supported_image_sizes and image_size not in model.supported_image_sizes:
            return False, f"不支持的图像尺寸: {image_size}，支持的尺寸为{model.supported_image_sizes}"

        # 验证模式
        mode = inputs.get("mode", model.ui.default_mode)
        if mode and model.supported_modes and mode not in model.supported_modes:
            return False, f"不支持的模式: {mode}，支持的模式为{model.supported_modes}"

        return True, "验证通过"


# 全局配置加载器实例
_llm_config_loader: Optional[LLMConfigLoader] = None


def get_llm_config_loader() -> LLMConfigLoader:
    """获取全局LLM配置加载器实例"""
    global _llm_config_loader
    if _llm_config_loader is None:
        _llm_config_loader = LLMConfigLoader()
        _llm_config_loader.load()
    return _llm_config_loader


def reload_llm_config() -> None:
    """重新加载LLM配置"""
    global _llm_config_loader
    if _llm_config_loader:
        _llm_config_loader.load()
