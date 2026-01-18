"""万相视频提供者"""

import json
import time
import requests
from typing import Dict, List, Optional, Any, Tuple
import torch

from .base import BaseVideoProvider, VideoProviderConfig


class WanVideoProvider(BaseVideoProvider):
    """万相视频提供者（支持参考生视频和图生视频）"""

    def __init__(self, model_name: str = "wan2.6-r2v"):
        # 根据模型名称确定配置
        config = self._get_config_for_model(model_name)
        super().__init__(config)

    def _get_config_for_model(self, model_name: str) -> VideoProviderConfig:
        """根据模型名称获取配置"""
        # 模型配置映射
        model_configs = {
            # 参考生视频模型
            "wan2.6-r2v": {
                "label": "万相2.6参考生视频",
                "provider_type": "r2v",
                "endpoint": "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis",
                "supported_sizes": [
                    "1280*720", "720*1280", "960*960", "1088*832", "832*1088",
                    "1920*1080", "1080*1920", "1440*1440", "1632*1248", "1248*1632"
                ],
                "supported_durations": [5, 10],
                "max_reference_videos": 3,
                "max_prompt_length": 1500,
                "max_negative_prompt_length": 500,
                "supports_multi_shot": True
            },
            # 图生视频模型
            "wan2.6-i2v": {
                "label": "万相2.6图生视频",
                "provider_type": "i2v",
                "endpoint": "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis",
                "supported_sizes": [],  # 图生视频使用resolution参数
                "supported_resolutions": ["720P", "1080P"],
                "supported_durations": [5, 10, 15],
                "max_reference_videos": 0,  # 图生视频不需要参考视频
                "max_prompt_length": 1500,
                "max_negative_prompt_length": 500,
                "supports_audio": True,
                "supports_multi_shot": True,
                "supports_prompt_extend": True,
                "supports_template": True
            },
            "wan2.5-i2v-preview": {
                "label": "万相2.5图生视频预览版",
                "provider_type": "i2v",
                "endpoint": "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis",
                "supported_sizes": [],
                "supported_resolutions": ["480P", "720P", "1080P"],
                "supported_durations": [5, 10],
                "max_reference_videos": 0,
                "max_prompt_length": 1500,
                "max_negative_prompt_length": 500,
                "supports_audio": True,
                "supports_multi_shot": False,
                "supports_prompt_extend": True,
                "supports_template": False
            },
            "wan2.2-i2v-flash": {
                "label": "万相2.2图生视频极速版",
                "provider_type": "i2v",
                "endpoint": "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis",
                "supported_sizes": [],
                "supported_resolutions": ["480P", "720P", "1080P"],
                "supported_durations": [5],
                "max_reference_videos": 0,
                "max_prompt_length": 800,  # 2.2及以下版本限制800字符
                "max_negative_prompt_length": 500,
                "supports_audio": False,
                "supports_multi_shot": False,
                "supports_prompt_extend": True,
                "supports_template": False
            },
            "wan2.2-i2v-plus": {
                "label": "万相2.2图生视频专业版",
                "provider_type": "i2v",
                "endpoint": "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis",
                "supported_sizes": [],
                "supported_resolutions": ["480P", "1080P"],  # 文档：480P、1080P
                "supported_durations": [5],  # 文档：固定5秒
                "max_reference_videos": 0,
                "max_prompt_length": 800,  # 2.2及以下版本限制800字符
                "max_negative_prompt_length": 500,
                "supports_audio": False,
                "supports_multi_shot": False,
                "supports_prompt_extend": True,
                "supports_template": False
            },
            "wanx2.1-i2v-plus": {
                "label": "万相2.1图生视频专业版",
                "provider_type": "i2v",
                "endpoint": "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis",
                "supported_sizes": [],
                "supported_resolutions": ["720P"],  # 文档：720P
                "supported_durations": [5],  # 文档：固定5秒
                "max_reference_videos": 0,
                "max_prompt_length": 800,  # 2.1版本限制800字符
                "max_negative_prompt_length": 500,
                "supports_audio": False,
                "supports_multi_shot": False,
                "supports_prompt_extend": True,
                "supports_template": True  # 文档显示支持特效模板
            },
            "wanx2.1-i2v-turbo": {
                "label": "万相2.1图生视频极速版",
                "provider_type": "i2v",
                "endpoint": "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis",
                "supported_sizes": [],
                "supported_resolutions": ["480P", "720P"],  # 文档：480P、720P
                "supported_durations": [3, 4, 5],  # 文档：3、4、5秒
                "max_reference_videos": 0,
                "max_prompt_length": 800,  # 2.1版本限制800字符
                "max_negative_prompt_length": 500,
                "supports_audio": False,
                "supports_multi_shot": False,
                "supports_prompt_extend": True,
                "supports_template": True  # 文档显示支持特效模板
            },
            # 图生视频-首尾帧模型
            "wan2.2-kf2v-flash": {
                "label": "万相2.2首尾帧生视频极速版",
                "provider_type": "kf2v",  # 首尾帧特殊类型
                "endpoint": "https://dashscope.aliyuncs.com/api/v1/services/aigc/image2video/video-synthesis",
                "supported_sizes": [],
                "supported_resolutions": ["480P", "720P", "1080P"],
                "supported_durations": [5],  # 首尾帧固定5秒
                "max_reference_videos": 0,
                "max_prompt_length": 800,
                "max_negative_prompt_length": 500,
                "supports_audio": False,
                "supports_multi_shot": False,
                "supports_prompt_extend": True,
                "supports_template": True,  # 首尾帧支持特效模板
                "requires_first_frame": True,
                "requires_last_frame": False  # 尾帧可选
            },
            "wanx2.1-kf2v-plus": {
                "label": "万相2.1首尾帧生视频专业版",
                "provider_type": "kf2v",  # 首尾帧特殊类型
                "endpoint": "https://dashscope.aliyuncs.com/api/v1/services/aigc/image2video/video-synthesis",
                "supported_sizes": [],
                "supported_resolutions": ["720P"],  # 2.1版本只支持720P
                "supported_durations": [5],  # 首尾帧固定5秒
                "max_reference_videos": 0,
                "max_prompt_length": 800,
                "max_negative_prompt_length": 500,
                "supports_audio": False,
                "supports_multi_shot": False,
                "supports_prompt_extend": True,
                "supports_template": True,  # 首尾帧支持特效模板
                "requires_first_frame": True,
                "requires_last_frame": False  # 尾帧可选
            }
        }

        if model_name not in model_configs:
            raise ValueError(f"不支持的模型：{model_name}")

        config_data = model_configs[model_name]

        return VideoProviderConfig(
            name=model_name,
            label=config_data["label"],
            endpoint=config_data["endpoint"],
            model=model_name,
            supported_sizes=config_data.get("supported_sizes", []),
            supported_durations=config_data["supported_durations"],
            max_reference_videos=config_data["max_reference_videos"],
            max_prompt_length=config_data["max_prompt_length"],
            max_negative_prompt_length=config_data["max_negative_prompt_length"],
            provider_type=config_data["provider_type"],
            supported_resolutions=config_data.get("supported_resolutions"),
            supports_audio=config_data.get("supports_audio", False),
            supports_multi_shot=config_data.get("supports_multi_shot", False),
            supports_prompt_extend=config_data.get("supports_prompt_extend", False),
            supports_template=config_data.get("supports_template", False),
            requires_first_frame=config_data.get("requires_first_frame", True),
            requires_last_frame=config_data.get("requires_last_frame", False)
        )

    def build_payload(self,
                     prompt: str,
                     reference_videos: List[torch.Tensor],
                     size: str,
                     duration: int,
                     shot_type: str,
                     watermark: bool,
                     seed: int,
                     negative_prompt: str,
                     **kwargs) -> Dict[str, Any]:
        """构建万相API请求载荷"""
        # 根据提供者类型构建不同的载荷
        if self.config.provider_type == "r2v":
            return self._build_r2v_payload(prompt, reference_videos, size, duration,
                                          shot_type, watermark, seed, negative_prompt, **kwargs)
        elif self.config.provider_type == "i2v":
            return self._build_i2v_payload(prompt, duration, shot_type, watermark,
                                          seed, negative_prompt, **kwargs)
        elif self.config.provider_type == "kf2v":
            return self._build_kf2v_payload(prompt, duration, watermark,
                                           seed, negative_prompt, **kwargs)
        else:
            raise ValueError(f"不支持的提供者类型：{self.config.provider_type}")

    def _build_r2v_payload(self,
                          prompt: str,
                          reference_videos: List[torch.Tensor],
                          size: str,
                          duration: int,
                          shot_type: str,
                          watermark: bool,
                          seed: int,
                          negative_prompt: str,
                          **kwargs) -> Dict[str, Any]:
        """构建参考生视频API请求载荷"""
        # 从kwargs中获取视频URL
        video_urls = kwargs.get("video_urls", [])

        # 添加角色引用到提示词
        # 根据视频URL数量添加 character1, character2, character3
        character_refs = []
        for i in range(len(video_urls)):
            character_refs.append(f"character{i+1}")

        # 如果提示词中没有角色引用，自动添加
        if not any(f"character{i+1}" in prompt for i in range(len(video_urls))):
            # 在提示词开头添加角色引用
            if character_refs:
                prompt = f"{'、'.join(character_refs)} {prompt}"

        # 使用传入的视频URL
        reference_video_urls = video_urls

        # 检查是否有视频输入
        if len(reference_video_urls) == 0:
            raise ValueError("参考生视频模式需要提供参考视频URL")

        # 验证视频URL数量
        if len(reference_video_urls) > 3:
            raise ValueError(f"视频URL数量超过限制：{len(reference_video_urls)}个，最多支持3个")

        payload = {
            "model": self.config.model,
            "input": {
                "prompt": prompt,
                "reference_video_urls": reference_video_urls
            }
        }

        # 添加可选参数
        parameters = {}
        if size:
            parameters["size"] = size
        if duration:
            parameters["duration"] = duration
        if shot_type:
            parameters["shot_type"] = shot_type
        if watermark is not None:
            parameters["watermark"] = watermark
        if seed is not None:
            parameters["seed"] = seed
        if negative_prompt:
            parameters["negative_prompt"] = negative_prompt

        if parameters:
            payload["parameters"] = parameters

        return payload

    def _validate_model_feature(self, feature_name: str, feature_value: Any,
                              supports_feature: bool, error_message: str) -> None:
        """通用模型功能验证

        Args:
            feature_name: 功能名称（用于调试）
            feature_value: 功能值
            supports_feature: 模型是否支持该功能
            error_message: 错误信息模板
        """
        # 只有非空值才需要检查支持性
        if feature_value:
            # 处理字符串类型的值，检查是否非空
            if isinstance(feature_value, str) and not feature_value.strip():
                return
            # 处理布尔类型的值，False视为空值
            if isinstance(feature_value, bool) and not feature_value:
                return

            if not supports_feature:
                raise ValueError(error_message)

    def _build_i2v_payload(self,
                          prompt: str,
                          duration: int,
                          shot_type: str,
                          watermark: bool,
                          seed: int,
                          negative_prompt: str,
                          **kwargs) -> Dict[str, Any]:
        """构建图生视频API请求载荷"""
        # 从kwargs中获取图生视频特有参数
        img_url = kwargs.get("img_url", "")
        audio_url = kwargs.get("audio_url", "")
        resolution = kwargs.get("resolution", "")
        prompt_extend = kwargs.get("prompt_extend", True)
        template = kwargs.get("template", "")

        # 验证必需参数
        if not img_url:
            raise ValueError("图生视频模式需要提供图像URL（img_url）")

        # 验证模型支持的功能（使用通用验证函数）
        self._validate_model_feature(
            "audio_url", audio_url, self.config.supports_audio,
            f"模型 {self.config.model} 不支持音频输入"
        )

        self._validate_model_feature(
            "template", template, self.config.supports_template,
            f"模型 {self.config.model} 不支持特效模板"
        )

        # shot_type特殊处理：只有当值不是"single"时才检查多镜头支持
        if shot_type and shot_type != "single":
            self._validate_model_feature(
                "shot_type", shot_type, self.config.supports_multi_shot,
                f"模型 {self.config.model} 不支持多镜头模式"
            )

        # 构建输入部分
        input_data = {
            "img_url": img_url
        }

        # 添加可选输入参数
        if prompt:
            input_data["prompt"] = prompt
        if audio_url and self.config.supports_audio:
            input_data["audio_url"] = audio_url
        if template and self.config.supports_template:
            input_data["template"] = template
            # 使用模板时，prompt参数无效
            if "prompt" in input_data:
                del input_data["prompt"]

        payload = {
            "model": self.config.model,
            "input": input_data
        }

        # 添加可选参数
        parameters = {}
        if resolution:
            parameters["resolution"] = resolution
        if duration:
            parameters["duration"] = duration
        if prompt_extend is not None:
            parameters["prompt_extend"] = prompt_extend
        if shot_type and self.config.supports_multi_shot:
            parameters["shot_type"] = shot_type
        if watermark is not None:
            parameters["watermark"] = watermark
        if seed is not None:
            parameters["seed"] = seed
        if negative_prompt:
            parameters["negative_prompt"] = negative_prompt

        if parameters:
            payload["parameters"] = parameters

        return payload

    def _build_kf2v_payload(self,
                          prompt: str,
                          duration: int,
                          watermark: bool,
                          seed: int,
                          negative_prompt: str,
                          **kwargs) -> Dict[str, Any]:
        """构建首尾帧生视频API请求载荷"""
        # 从kwargs中获取首尾帧特有参数
        first_frame_url = kwargs.get("first_frame_url", "")
        last_frame_url = kwargs.get("last_frame_url", "")
        resolution = kwargs.get("resolution", "")
        prompt_extend = kwargs.get("prompt_extend", True)
        template = kwargs.get("template", "")

        # 验证必需参数
        if not first_frame_url:
            raise ValueError("首尾帧生视频模式需要提供首帧图像URL（first_frame_url）")

        # 验证模型支持的功能（使用通用验证函数）
        self._validate_model_feature(
            "template", template, self.config.supports_template,
            f"模型 {self.config.model} 不支持特效模板"
        )

        # 构建输入部分
        input_data = {
            "first_frame_url": first_frame_url
        }

        # 添加可选输入参数
        if prompt:
            input_data["prompt"] = prompt
        if last_frame_url:
            input_data["last_frame_url"] = last_frame_url
        if template and self.config.supports_template:
            input_data["template"] = template
            # 使用模板时，prompt参数无效
            if "prompt" in input_data:
                del input_data["prompt"]

        payload = {
            "model": self.config.model,
            "input": input_data
        }

        # 添加可选参数
        parameters = {}
        if resolution:
            parameters["resolution"] = resolution
        if duration:
            parameters["duration"] = duration
        if prompt_extend is not None:
            parameters["prompt_extend"] = prompt_extend
        if watermark is not None:
            parameters["watermark"] = watermark
        if seed is not None:
            parameters["seed"] = seed
        if negative_prompt:
            parameters["negative_prompt"] = negative_prompt

        if parameters:
            payload["parameters"] = parameters

        return payload

    def create_task(self,
                   api_key: str,
                   payload: Dict[str, Any],
                   progress_callback=None,
                   region: str = "china") -> Tuple[str, str]:
        """创建视频生成任务"""
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "X-DashScope-Async": "enable"
        }

        # 根据region参数调整endpoint
        base_endpoint = self.config.endpoint
        if region == "singapore":
            # 替换为新加坡地域
            endpoint = base_endpoint.replace("dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com")
        elif region == "virginia":
            # 替换为弗吉尼亚地域
            endpoint = base_endpoint.replace("dashscope.aliyuncs.com", "dashscope-us.aliyuncs.com")
        else:
            # 默认使用北京地域
            endpoint = base_endpoint

        try:
            if progress_callback:
                progress_callback("创建任务", 0.2)

            response = requests.post(
                endpoint,
                headers=headers,
                json=payload,
                timeout=30
            )

            if progress_callback:
                progress_callback("创建任务", 0.8)

            response.raise_for_status()
            result = response.json()

            if progress_callback:
                progress_callback("创建任务", 1.0)

            task_id = result.get("output", {}).get("task_id", "")
            request_id = result.get("request_id", "")

            if not task_id:
                raise ValueError("API响应中未找到task_id")

            return task_id, request_id

        except requests.exceptions.RequestException as e:
            raise Exception(f"API请求失败: {str(e)}")
        except json.JSONDecodeError as e:
            raise Exception(f"API响应解析失败: {str(e)}")
        except Exception as e:
            raise Exception(f"创建任务失败: {str(e)}")

    def query_task(self,
                  api_key: str,
                  task_id: str,
                  progress_callback=None,
                  region: str = "china") -> Dict[str, Any]:
        """查询任务状态"""
        # 根据API文档，查询URL应该是固定的
        # 北京地域：https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}
        # 新加坡地域：https://dashscope-intl.aliyuncs.com/api/v1/tasks/{task_id}
        # 弗吉尼亚地域：https://dashscope-us.aliyuncs.com/api/v1/tasks/{task_id}

        # 根据region参数确定base_url
        if region == "singapore":
            base_url = "https://dashscope-intl.aliyuncs.com"
        elif region == "virginia":
            base_url = "https://dashscope-us.aliyuncs.com"
        else:
            base_url = "https://dashscope.aliyuncs.com"

        query_url = f"{base_url}/api/v1/tasks/{task_id}"

        headers = {
            "Authorization": f"Bearer {api_key}"
        }

        try:
            if progress_callback:
                progress_callback("查询任务", 0.3)

            response = requests.get(
                query_url,
                headers=headers,
                timeout=30
            )

            if progress_callback:
                progress_callback("查询任务", 0.7)

            response.raise_for_status()
            result = response.json()

            if progress_callback:
                progress_callback("查询任务", 1.0)

            return result

        except requests.exceptions.RequestException as e:
            raise Exception(f"查询任务失败: {str(e)}")
        except json.JSONDecodeError as e:
            raise Exception(f"查询响应解析失败: {str(e)}")

    def extract_video_url(self, result: Dict[str, Any]) -> Optional[str]:
        """从结果中提取视频URL"""
        output = result.get("output", {})
        task_status = output.get("task_status", "")

        if task_status == "SUCCEEDED":
            return output.get("video_url")

        return None

    def extract_usage_info(self, result: Dict[str, Any]) -> Dict[str, Any]:
        """从结果中提取使用信息"""
        usage = result.get("usage", {})
        output = result.get("output", {})

        return {
            "duration": usage.get("duration"),
            "size": usage.get("size"),
            "input_video_duration": usage.get("input_video_duration"),
            "output_video_duration": usage.get("output_video_duration"),
            "video_count": usage.get("video_count"),
            "SR": usage.get("SR"),
            "task_status": output.get("task_status"),
            "task_id": output.get("task_id"),
            "orig_prompt": output.get("orig_prompt")
        }


# 创建并注册提供者
def register_wan_provider(registry):
    """注册万相视频提供者（支持多个模型）"""
    # 支持的模型列表
    supported_models = [
        # 参考生视频模型
        "wan2.6-r2v",
        # 图生视频模型（基于首帧）
        "wan2.6-i2v",
        "wan2.5-i2v-preview",
        "wan2.2-i2v-flash",
        "wan2.2-i2v-plus",
        "wanx2.1-i2v-plus",
        "wanx2.1-i2v-turbo",
        # 图生视频模型（基于首尾帧）
        "wan2.2-kf2v-flash",
        "wanx2.1-kf2v-plus"
    ]

    for model_name in supported_models:
        try:
            provider = WanVideoProvider(model_name)
            registry.register(provider, group="alibaba")
            print(f"[VGM] 已注册模型：{model_name} ({provider.config.label})")
        except Exception as e:
            print(f"[VGM] 警告：注册模型 {model_name} 失败：{e}")