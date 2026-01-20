"""统一配置加载器"""

import os
import yaml
from typing import Dict, List, Any, Optional, Union
from dataclasses import dataclass, field
from pathlib import Path
import logging

logger = logging.getLogger(__name__)


@dataclass
class ModelUIConfig:
    """模型UI配置"""
    has_image_input: bool = False
    has_video_url_input: bool = False
    has_resolution: bool = False
    has_audio: bool = False
    has_prompt_extend: bool = False
    has_template: bool = False
    has_shot_type: bool = False
    has_size: bool = False
    supported_regions: List[str] = field(default_factory=list)
    default_region: str = "china"
    default_resolution: str = "720P"
    default_size: str = "1280*720"
    default_duration: int = 5
    default_shot_type: str = "multi"
    default_prompt_extend: bool = True
    default_watermark: bool = False
    default_seed: int = 42


@dataclass
class ModelConfig:
    """模型配置"""
    # 基本信息
    name: str
    label: str
    provider_type: str  # r2v, i2v, kf2v
    group: str = "default"

    # API配置
    endpoint: str = ""

    # 输入限制
    max_prompt_length: int = 1500
    max_negative_prompt_length: int = 500
    max_reference_videos: int = 0

    # 输出配置
    supported_durations: List[int] = field(default_factory=list)
    supported_sizes: List[str] = field(default_factory=list)
    supported_resolutions: List[str] = field(default_factory=list)

    # 功能支持
    supports_audio: bool = False
    supports_multi_shot: bool = False
    supports_prompt_extend: bool = False
    supports_template: bool = False
    requires_first_frame: bool = True
    requires_last_frame: bool = False

    # UI配置
    ui: ModelUIConfig = field(default_factory=ModelUIConfig)

    def get_endpoint_for_region(self, region: str, config_loader: 'ConfigLoader') -> str:
        """根据地区获取实际的API端点"""
        # 如果endpoint包含模板变量，进行替换
        endpoint = self.endpoint

        # 替换地区变量
        if "{{" in endpoint and "}}" in endpoint:
            # 提取变量名
            var_start = endpoint.find("{{") + 2
            var_end = endpoint.find("}}")
            var_name = endpoint[var_start:var_end].strip()

            # 根据提供者类型选择端点模板
            if self.provider_type == "kf2v":
                endpoint_template = config_loader.global_config.get("kf2v_endpoint_templates", {}).get(region)
            else:
                endpoint_template = config_loader.global_config.get("endpoint_templates", {}).get(region)

            if endpoint_template:
                endpoint = endpoint_template
            else:
                # 回退到默认端点
                endpoint = endpoint.replace(f"{{{{{var_name}}}}}", "")
                logger.warning(f"未找到地区 {region} 的端点模板，使用默认端点")

        return endpoint

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典（用于JSON序列化）"""
        return {
            "name": self.name,
            "label": self.label,
            "provider_type": self.provider_type,
            "group": self.group,
            "endpoint": self.endpoint,
            "max_prompt_length": self.max_prompt_length,
            "max_negative_prompt_length": self.max_negative_prompt_length,
            "max_reference_videos": self.max_reference_videos,
            "supported_durations": self.supported_durations,
            "supported_sizes": self.supported_sizes,
            "supported_resolutions": self.supported_resolutions,
            "supports_audio": self.supports_audio,
            "supports_multi_shot": self.supports_multi_shot,
            "supports_prompt_extend": self.supports_prompt_extend,
            "supports_template": self.supports_template,
            "requires_first_frame": self.requires_first_frame,
            "requires_last_frame": self.requires_last_frame,
            "ui": {
                "has_image_input": self.ui.has_image_input,
                "has_video_url_input": self.ui.has_video_url_input,
                "has_resolution": self.ui.has_resolution,
                "has_audio": self.ui.has_audio,
                "has_prompt_extend": self.ui.has_prompt_extend,
                "has_template": self.ui.has_template,
                "has_shot_type": self.ui.has_shot_type,
                "has_size": self.ui.has_size,
                "supported_regions": self.ui.supported_regions,
                "default_region": self.ui.default_region,
                "default_resolution": self.ui.default_resolution,
                "default_size": self.ui.default_size,
                "default_duration": self.ui.default_duration,
                "default_shot_type": self.ui.default_shot_type,
                "default_prompt_extend": self.ui.default_prompt_extend,
                "default_watermark": self.ui.default_watermark,
                "default_seed": self.ui.default_seed,
            }
        }


@dataclass
class GroupConfig:
    """模型分组配置"""
    name: str
    description: str = ""
    models: List[str] = field(default_factory=list)


@dataclass
class ProviderTypeConfig:
    """提供者类型配置"""
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


class ConfigLoader:
    """配置加载器"""

    def __init__(self, config_path: Optional[str] = None):
        self.config_path = config_path or self._get_default_config_path()
        self._config_data: Optional[Dict[str, Any]] = None
        self._models: Dict[str, ModelConfig] = {}
        self._groups: Dict[str, GroupConfig] = {}
        self._provider_types: Dict[str, ProviderTypeConfig] = {}

    def _get_default_config_path(self) -> str:
        """获取默认配置文件路径"""
        # 从当前文件位置计算项目根目录
        current_file = Path(__file__).resolve()
        # src/xiser_nodes/config/loader.py -> 项目根目录
        project_root = current_file.parent.parent.parent.parent
        config_path = project_root / "config" / "video_models.yaml"

        # 如果不存在，尝试相对路径
        if not config_path.exists():
            # 尝试从当前工作目录查找
            cwd_config = Path.cwd() / "config" / "video_models.yaml"
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
                ui_config = ModelUIConfig(
                    has_image_input=ui_data.get("has_image_input", False),
                    has_video_url_input=ui_data.get("has_video_url_input", False),
                    has_resolution=ui_data.get("has_resolution", False),
                    has_audio=ui_data.get("has_audio", False),
                    has_prompt_extend=ui_data.get("has_prompt_extend", False),
                    has_template=ui_data.get("has_template", False),
                    has_shot_type=ui_data.get("has_shot_type", False),
                    has_size=ui_data.get("has_size", False),
                    supported_regions=ui_data.get("supported_regions", []),
                    default_region=ui_data.get("default_region", "china"),
                    default_resolution=ui_data.get("default_resolution", "720P"),
                    default_size=ui_data.get("default_size", "1280*720"),
                    default_duration=ui_data.get("default_duration", 5),
                    default_shot_type=ui_data.get("default_shot_type", "multi"),
                    default_prompt_extend=ui_data.get("default_prompt_extend", True),
                    default_watermark=ui_data.get("default_watermark", False),
                    default_seed=ui_data.get("default_seed", 42),
                )

                # 创建模型配置
                model_config = ModelConfig(
                    name=model_data.get("name", model_name),
                    label=model_data.get("label", model_name),
                    provider_type=model_data.get("provider_type", "i2v"),
                    group=model_data.get("group", "default"),
                    endpoint=model_data.get("endpoint", ""),
                    max_prompt_length=model_data.get("max_prompt_length", 1500),
                    max_negative_prompt_length=model_data.get("max_negative_prompt_length", 500),
                    max_reference_videos=model_data.get("max_reference_videos", 0),
                    supported_durations=model_data.get("supported_durations", []),
                    supported_sizes=model_data.get("supported_sizes", []),
                    supported_resolutions=model_data.get("supported_resolutions", []),
                    supports_audio=model_data.get("supports_audio", False),
                    supports_multi_shot=model_data.get("supports_multi_shot", False),
                    supports_prompt_extend=model_data.get("supports_prompt_extend", False),
                    supports_template=model_data.get("supports_template", False),
                    requires_first_frame=model_data.get("requires_first_frame", True),
                    requires_last_frame=model_data.get("requires_last_frame", False),
                    ui=ui_config,
                )

                self._models[model_name] = model_config

            # 加载分组配置
            groups_data = self._config_data.get("groups", {})
            for group_name, group_data in groups_data.items():
                group_config = GroupConfig(
                    name=group_data.get("name", group_name),
                    description=group_data.get("description", ""),
                    models=group_data.get("models", []),
                )
                self._groups[group_name] = group_config

            # 加载提供者类型配置
            provider_types_data = self._config_data.get("provider_types", {})
            for type_name, type_data in provider_types_data.items():
                provider_type_config = ProviderTypeConfig(
                    name=type_data.get("name", type_name),
                    description=type_data.get("description", ""),
                    icon=type_data.get("icon", ""),
                    color=type_data.get("color", ""),
                )
                self._provider_types[type_name] = provider_type_config

            # 静默加载配置文件

        except Exception as e:
            logger.error(f"加载配置文件失败: {e}")
            raise

    def get_model(self, model_name: str) -> Optional[ModelConfig]:
        """获取模型配置"""
        return self._models.get(model_name)

    def get_all_models(self) -> Dict[str, ModelConfig]:
        """获取所有模型配置"""
        return self._models.copy()

    def get_models_by_group(self, group_name: str) -> List[ModelConfig]:
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

    def get_group(self, group_name: str) -> Optional[GroupConfig]:
        """获取分组配置"""
        return self._groups.get(group_name)

    def get_all_groups(self) -> Dict[str, GroupConfig]:
        """获取所有分组配置"""
        return self._groups.copy()

    def get_provider_type(self, type_name: str) -> Optional[ProviderTypeConfig]:
        """获取提供者类型配置"""
        return self._provider_types.get(type_name)

    def get_all_provider_types(self) -> Dict[str, ProviderTypeConfig]:
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
            "hasImageInput": model.ui.has_image_input,
            "hasVideoUrlInput": model.ui.has_video_url_input,
            "hasResolution": model.ui.has_resolution,
            "hasAudio": model.ui.has_audio,
            "hasPromptExtend": model.ui.has_prompt_extend,
            "hasTemplate": model.ui.has_template,
            "hasShotType": model.ui.has_shot_type,
            "hasSize": model.ui.has_size,
            "supportedRegions": model.ui.supported_regions,
            "supportedDurations": model.supported_durations,
            "supportedSizes": model.supported_sizes,
            "supportedResolutions": model.supported_resolutions,
            "maxPromptLength": model.max_prompt_length,
            "defaultRegion": model.ui.default_region,
            "defaultResolution": model.ui.default_resolution,
            "defaultSize": model.ui.default_size,
            "defaultDuration": model.ui.default_duration,
            "defaultShotType": model.ui.default_shot_type,
            "defaultPromptExtend": model.ui.default_prompt_extend,
            "defaultWatermark": model.ui.default_watermark,
            "defaultSeed": model.ui.default_seed,
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
        prompt = inputs.get("prompt", "")
        if len(prompt) > model.max_prompt_length:
            return False, f"提示词长度超过限制（最大{model.max_prompt_length}字符）"

        # 验证负面提示词长度
        negative_prompt = inputs.get("negative_prompt", "")
        if negative_prompt and len(negative_prompt) > model.max_negative_prompt_length:
            return False, f"负面提示词长度超过限制（最大{model.max_negative_prompt_length}字符）"

        # 验证时长
        duration = inputs.get("duration", 5)
        if duration not in model.supported_durations:
            return False, f"不支持的时长: {duration}，支持的时长为{model.supported_durations}"

        # 根据提供者类型进行特定验证
        if model.provider_type == "r2v":
            # 验证参考视频数量
            reference_videos = inputs.get("reference_videos", [])
            if len(reference_videos) > model.max_reference_videos:
                return False, f"参考视频数量超过限制（最多{model.max_reference_videos}个）"

            # 验证尺寸
            size = inputs.get("size", "")
            if size and size not in model.supported_sizes:
                return False, f"不支持的尺寸: {size}"

        elif model.provider_type == "i2v":
            # 验证分辨率
            resolution = inputs.get("resolution", "")
            if resolution and model.supported_resolutions:
                if resolution not in model.supported_resolutions:
                    return False, f"不支持的分辨率: {resolution}，支持的分辨率为{model.supported_resolutions}"

            # 验证音频URL（如果模型不支持）
            audio_url = inputs.get("audio_url", "")
            if audio_url and not model.supports_audio:
                return False, f"该模型不支持音频URL参数"

            # 验证模板（如果模型不支持）
            template = inputs.get("template", "")
            if template and not model.supports_template:
                return False, f"该模型不支持特效模板参数"

        elif model.provider_type == "kf2v":
            # 验证分辨率
            resolution = inputs.get("resolution", "")
            if resolution and model.supported_resolutions:
                if resolution not in model.supported_resolutions:
                    return False, f"不支持的分辨率: {resolution}，支持的分辨率为{model.supported_resolutions}"

            # 验证模板（如果模型不支持）
            template = inputs.get("template", "")
            if template and not model.supports_template:
                return False, f"该模型不支持特效模板参数"

        return True, "验证通过"


# 全局配置加载器实例
_config_loader: Optional[ConfigLoader] = None


def get_config_loader() -> ConfigLoader:
    """获取全局配置加载器实例"""
    global _config_loader
    if _config_loader is None:
        _config_loader = ConfigLoader()
        _config_loader.load()
    return _config_loader


def reload_config() -> None:
    """重新加载配置"""
    global _config_loader
    if _config_loader:
        _config_loader.load()


if __name__ == "__main__":
    # 测试配置加载
    loader = ConfigLoader()
    loader.load()

    print("=== 配置加载测试 ===")
    print(f"模型数量: {len(loader.get_all_models())}")

    # 测试获取模型
    model = loader.get_model("wan2.6-r2v")
    if model:
        print(f"\n模型: {model.name}")
        print(f"标签: {model.label}")
        print(f"类型: {model.provider_type}")
        print(f"支持的时长: {model.supported_durations}")
        print(f"支持的尺寸: {model.supported_sizes}")

    # 测试UI配置
    ui_config = loader.get_ui_config_for_model("wan2.6-r2v")
    if ui_config:
        print(f"\nUI配置: {ui_config}")

    print("\n=== 测试完成 ===")