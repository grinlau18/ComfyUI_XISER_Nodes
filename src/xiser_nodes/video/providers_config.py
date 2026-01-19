"""基于统一配置的视频提供者"""

import json
import time
import requests
from typing import Dict, List, Optional, Any, Tuple
import torch
import logging

from .base import BaseVideoProvider, VideoProviderConfig
from ..config import get_config_loader, ModelConfig

logger = logging.getLogger(__name__)


class ConfigBasedVideoProvider(BaseVideoProvider):
    """基于统一配置的视频提供者"""

    def __init__(self, model_name: str):
        # 从统一配置加载模型配置
        config_loader = get_config_loader()
        model_config = config_loader.get_model(model_name)

        if not model_config:
            raise ValueError(f"未找到模型配置: {model_name}")

        # 将ModelConfig转换为VideoProviderConfig
        provider_config = self._convert_to_provider_config(model_config)
        super().__init__(provider_config)

        # 保存原始模型配置
        self.model_config = model_config
        self.model_name = model_name

    def _convert_to_provider_config(self, model_config: ModelConfig) -> VideoProviderConfig:
        """将ModelConfig转换为VideoProviderConfig"""
        return VideoProviderConfig(
            name=model_config.name,
            label=model_config.label,
            endpoint=model_config.endpoint,
            model=model_config.name,
            supported_sizes=model_config.supported_sizes,
            supported_durations=model_config.supported_durations,
            max_reference_videos=model_config.max_reference_videos,
            max_prompt_length=model_config.max_prompt_length,
            max_negative_prompt_length=model_config.max_negative_prompt_length,
            provider_type=model_config.provider_type,
            supported_resolutions=model_config.supported_resolutions,
            supports_audio=model_config.supports_audio,
            supports_multi_shot=model_config.supports_multi_shot,
            supports_prompt_extend=model_config.supports_prompt_extend,
            supports_template=model_config.supports_template,
            requires_first_frame=model_config.requires_first_frame,
            requires_last_frame=model_config.requires_last_frame,
        )

    def get_endpoint_for_region(self, region: str) -> str:
        """根据地区获取实际的API端点"""
        from ..config import get_config_loader
        config_loader = get_config_loader()
        return self.model_config.get_endpoint_for_region(region, config_loader)

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
        """构建API请求载荷"""
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
        """构建参考生视频载荷"""
        # 构建参考视频URL列表
        reference_video_urls = kwargs.get("reference_video_urls", [])

        payload = {
            "model": self.model_name,
            "input": {
                "prompt": prompt,
                "reference_video_urls": reference_video_urls
            },
            "parameters": {
                "size": size,
                "duration": duration,
                "shot_type": shot_type,
                "watermark": watermark,
                "seed": seed
            }
        }

        # 添加负面提示词（如果提供）
        if negative_prompt and negative_prompt.strip():
            payload["input"]["negative_prompt"] = negative_prompt.strip()

        return payload

    def _build_i2v_payload(self,
                          prompt: str,
                          duration: int,
                          shot_type: str,
                          watermark: bool,
                          seed: int,
                          negative_prompt: str,
                          **kwargs) -> Dict[str, Any]:
        """构建图生视频载荷"""
        # 获取图像输入 - 支持img_url参数（单个Base64字符串）或images参数（列表）
        img_url = kwargs.get("img_url")
        images = kwargs.get("images", [])

        # 优先使用img_url参数，如果没有则使用images列表中的第一个
        if img_url:
            image_data = img_url
        elif images:
            image_data = images[0] if isinstance(images, list) else images
        else:
            raise ValueError("图生视频模式需要图像输入")

        # 构建基础载荷
        payload = {
            "model": self.model_name,
            "input": {
                "prompt": prompt,
                "img_url": image_data  # 使用单数img_url字段
            },
            "parameters": {
                "duration": duration,
                "watermark": watermark,
                "seed": seed
            }
        }

        # 添加负面提示词
        if negative_prompt and negative_prompt.strip():
            payload["input"]["negative_prompt"] = negative_prompt.strip()

        # 添加分辨率（如果支持）
        resolution = kwargs.get("resolution")
        if resolution and self.config.supported_resolutions:
            payload["parameters"]["resolution"] = resolution

        # 添加音频URL（如果支持）
        audio_url = kwargs.get("audio_url")
        if audio_url and self.config.supports_audio:
            payload["input"]["audio_url"] = audio_url

        # 添加prompt扩展（如果支持）
        prompt_extend = kwargs.get("prompt_extend")
        if prompt_extend is not None and self.config.supports_prompt_extend:
            payload["parameters"]["prompt_extend"] = prompt_extend

        # 添加模板（如果支持）
        template = kwargs.get("template")
        if template and self.config.supports_template:
            payload["parameters"]["template"] = template

        # 添加镜头类型（如果支持）
        if shot_type and self.config.supports_multi_shot:
            payload["parameters"]["shot_type"] = shot_type

        return payload

    def _build_kf2v_payload(self,
                           prompt: str,
                           duration: int,
                           watermark: bool,
                           seed: int,
                           negative_prompt: str,
                           **kwargs) -> Dict[str, Any]:
        """构建首尾帧生视频载荷"""
        # 获取图像输入 - 支持first_frame_url和last_frame_url参数或images参数
        first_frame_url = kwargs.get("first_frame_url")
        last_frame_url = kwargs.get("last_frame_url")
        images = kwargs.get("images", [])

        # 优先使用单独的frame_url参数
        if first_frame_url:
            first_frame = first_frame_url
        elif images:
            first_frame = images[0] if isinstance(images, list) else images
        else:
            raise ValueError("首尾帧生视频模式需要首帧图像输入")

        # 构建基础载荷
        payload = {
            "model": self.model_name,
            "input": {
                "prompt": prompt,
                "first_frame_url": first_frame  # 使用单数first_frame_url字段
            },
            "parameters": {
                "duration": duration,
                "watermark": watermark,
                "seed": seed
            }
        }

        # 添加尾帧（如果提供）
        if last_frame_url:
            payload["input"]["last_frame_url"] = last_frame_url
        elif len(images) >= 2 and self.config.requires_last_frame:
            payload["input"]["last_frame_url"] = images[1] if isinstance(images, list) else images

        # 添加负面提示词
        if negative_prompt and negative_prompt.strip():
            payload["input"]["negative_prompt"] = negative_prompt.strip()

        # 添加分辨率
        resolution = kwargs.get("resolution")
        if resolution and self.config.supported_resolutions:
            payload["parameters"]["resolution"] = resolution

        # 添加prompt扩展
        prompt_extend = kwargs.get("prompt_extend")
        if prompt_extend is not None and self.config.supports_prompt_extend:
            payload["parameters"]["prompt_extend"] = prompt_extend

        # 添加模板
        template = kwargs.get("template")
        if template and self.config.supports_template:
            payload["parameters"]["template"] = template

        return payload

    def _sanitize_payload_for_logging(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """清理payload中的敏感信息，用于日志记录

        Args:
            payload: 原始请求载荷

        Returns:
            清理后的安全载荷
        """
        import copy

        # 创建深拷贝以避免修改原始数据
        safe_payload = copy.deepcopy(payload)

        # 需要清理的敏感字段
        sensitive_fields = [
            "img_url",  # Base64图像数据可能很大
            "first_frame_url",
            "last_frame_url",
            "audio_url",
            "reference_video_urls",
            "video_urls"
        ]

        # 清理敏感字段
        for field in sensitive_fields:
            if field in safe_payload.get("input", {}):
                if safe_payload["input"][field]:
                    # 保留字段名但隐藏内容
                    if isinstance(safe_payload["input"][field], list):
                        safe_payload["input"][field] = [f"[{field}数据，长度:{len(data) if isinstance(data, str) else 'N/A'}]"
                                                       for data in safe_payload["input"][field]]
                    else:
                        data = safe_payload["input"][field]
                        length = len(data) if isinstance(data, str) else "N/A"
                        safe_payload["input"][field] = f"[{field}数据，长度:{length}]"

        return safe_payload

    def _sanitize_result_for_logging(self, result: Dict[str, Any]) -> Dict[str, Any]:
        """清理响应结果中的敏感信息，用于日志记录

        Args:
            result: 原始响应结果

        Returns:
            清理后的安全结果
        """
        import copy

        # 创建深拷贝以避免修改原始数据
        safe_result = copy.deepcopy(result)

        # 需要清理的敏感字段
        sensitive_fields = [
            "video_url",  # 视频URL可能包含敏感信息
            "audio_url",
            "img_url",
            "first_frame_url",
            "last_frame_url"
        ]

        # 清理output中的敏感字段
        if "output" in safe_result:
            for field in sensitive_fields:
                if field in safe_result["output"]:
                    if safe_result["output"][field]:
                        data = safe_result["output"][field]
                        if isinstance(data, str):
                            # 如果是URL，只显示域名部分
                            if data.startswith(("http://", "https://")):
                                from urllib.parse import urlparse
                                try:
                                    parsed = urlparse(data)
                                    safe_result["output"][field] = f"[URL: {parsed.netloc}{parsed.path[:50]}...]"
                                except:
                                    safe_result["output"][field] = f"[{field}数据，长度:{len(data)}]"
                            else:
                                safe_result["output"][field] = f"[{field}数据，长度:{len(data)}]"

        return safe_result

    def create_task(self,
                   api_key: str,
                   payload: Dict[str, Any],
                   progress_callback=None) -> Tuple[str, str]:
        """创建视频生成任务"""
        # 获取地区
        region = payload.get("region", "china")
        endpoint = self.get_endpoint_for_region(region)

        # 准备请求头
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "X-DashScope-Async": "enable"
        }

        # 发送请求
        try:
            if progress_callback:
                progress_callback("正在创建视频生成任务...", 0.3)

            # 记录请求信息（极简版）- 只显示模型和关键信息
            safe_payload = self._sanitize_payload_for_logging(payload)
            model = safe_payload.get("model", "unknown")
            input_data = safe_payload.get("input", {})

            # 提取关键信息
            has_template = "template" in input_data
            has_img_url = "img_url" in input_data
            has_prompt = "prompt" in input_data

            mode_info = []
            if has_template:
                mode_info.append(f"特效:{input_data.get('template')}")
            if has_img_url:
                mode_info.append("图生视频")
            if has_prompt and not has_template:
                # 只显示前50个字符
                prompt_preview = input_data.get("prompt", "")[:50]
                if len(input_data.get("prompt", "")) > 50:
                    prompt_preview += "..."
                mode_info.append(f'提示:"{prompt_preview}"')

            mode_str = " | ".join(mode_info) if mode_info else "普通模式"

            response = requests.post(
                endpoint,
                headers=headers,
                json=payload,
                timeout=30
            )

            if response.status_code != 200:
                error_msg = f"API请求失败: {response.status_code} - {response.text}"
                logger.error(error_msg)
                raise Exception(error_msg)

            result = response.json()
            task_id = result.get("output", {}).get("task_id")
            request_id = result.get("request_id")

            # 记录创建任务响应（极简版）
            safe_result = self._sanitize_result_for_logging(result)
            task_id = safe_result.get("output", {}).get("task_id", "unknown")
            task_status = safe_result.get("output", {}).get("task_status", "unknown")
            # 只显示任务ID前8位
            short_task_id = task_id[:8] + "..." if len(task_id) > 8 else task_id
            # 合并日志输出：POST信息和任务创建成功信息
            logger.info(f"[VGM API] POST {model} - {mode_str} | 任务创建成功，ID: {short_task_id}")

            if not task_id:
                error_msg = f"未获取到任务ID: {result}"
                logger.error(error_msg)
                raise Exception(error_msg)

            if progress_callback:
                progress_callback(f"任务创建成功，任务ID: {task_id}", 1.0)

            return task_id, request_id

        except requests.exceptions.RequestException as e:
            error_msg = f"网络请求失败: {e}"
            logger.error(error_msg)
            raise Exception(error_msg)

    def query_task(self,
                  api_key: str,
                  task_id: str,
                  progress_callback=None,
                  region: str = "china") -> Dict[str, Any]:
        """查询任务状态"""
        # 构建查询任务端点
        # 查询任务使用固定端点：/api/v1/tasks/{task_id}
        # 地区映射到不同的域名
        region_domains = {
            "china": "https://dashscope.aliyuncs.com",
            "singapore": "https://dashscope-intl.aliyuncs.com",
            "virginia": "https://dashscope-us.aliyuncs.com"
        }

        base_url = region_domains.get(region, region_domains["china"])
        endpoint = f"{base_url}/api/v1/tasks/{task_id}"

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

        try:
            # 记录查询请求（简化版）
            logger.debug(f"[VGM API] 查询任务请求 - 任务ID: {task_id}")

            response = requests.get(endpoint, headers=headers, timeout=10)

            # 记录响应状态（调试级别）
            logger.debug(f"[VGM API] 查询任务响应 - 状态码: {response.status_code}")

            if response.status_code != 200:
                error_msg = f"查询任务失败: {response.status_code} - {response.text}"
                logger.error(error_msg)
                raise Exception(error_msg)

            result = response.json()
            task_status = result.get("output", {}).get("task_status")

            # 记录查询结果（极简版）- 只在最终状态时记录
            safe_result = self._sanitize_result_for_logging(result)
            task_status = safe_result.get("output", {}).get("task_status", "unknown")

            # 只在最终成功/失败时记录，其他状态由轮询动态日志显示
            if task_status in ["SUCCEEDED", "FAILED", "CANCELED"]:
                # 提取视频URL（如果成功）
                video_url = safe_result.get("output", {}).get("video_url", "")
                if task_status == "SUCCEEDED" and video_url:
                    # 提取域名信息
                    from urllib.parse import urlparse
                    try:
                        parsed_url = urlparse(video_url)
                        domain = parsed_url.netloc
                        # 简化域名显示
                        if "dashscope-result" in domain:
                            domain_display = "阿里云OSS"
                        else:
                            domain_display = domain.split('.')[-2] if '.' in domain else domain
                        logger.info(f"[VGM API] 任务完成 - 视频已生成 ({domain_display})")
                    except:
                        logger.info(f"[VGM API] 任务完成 - 视频已生成")
                else:
                    logger.info(f"[VGM API] 任务{task_status.lower()}")
            else:
                # 其他状态不记录，由轮询动态日志显示
                pass

            if progress_callback:
                if task_status == "PENDING":
                    progress_callback("任务排队中...", 0.1)
                elif task_status == "RUNNING":
                    progress_callback("任务处理中...", 0.5)
                elif task_status == "SUCCEEDED":
                    progress_callback("任务完成！", 1.0)
                elif task_status == "FAILED":
                    progress_callback("任务失败", 0.0)

            return result

        except requests.exceptions.RequestException as e:
            error_msg = f"查询任务网络失败: {e}"
            logger.error(error_msg)
            raise Exception(error_msg)

    def extract_video_url(self, result: Dict[str, Any]) -> Optional[str]:
        """从结果中提取视频URL"""
        output = result.get("output", {})
        if output.get("task_status") == "SUCCEEDED":
            video_url = output.get("video_url")
            if video_url:
                return video_url

        return None

    def extract_usage_info(self, result: Dict[str, Any], payload: Dict[str, Any] = None) -> Dict[str, Any]:
        """从结果中提取使用信息，包括API请求代码"""
        usage = result.get("usage", {})

        # 构建API请求代码信息
        api_request_info = {
            "task_id": result.get("output", {}).get("task_id", ""),
            "api_request": {
                "method": "POST",
                "endpoint": self.config.endpoint,
                "headers": {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer YOUR_API_KEY",
                    "X-DashScope-Async": "enable"
                },
                "payload": payload if payload else {}
            },
            "usage_stats": {
                "total_tokens": usage.get("total_tokens", 0),
                "input_tokens": usage.get("input_tokens", 0),
                "output_tokens": usage.get("output_tokens", 0),
                "image_tokens": usage.get("image_tokens", 0),
                "video_tokens": usage.get("video_tokens", 0),
                "audio_tokens": usage.get("audio_tokens", 0),
            }
        }

        return api_request_info


def register_config_based_providers(registry) -> None:
    """注册基于配置的提供者"""
    from ..config import get_config_loader
    config_loader = get_config_loader()

    # 获取所有模型
    all_models = config_loader.get_all_models()

    for model_name, model_config in all_models.items():
        try:
            # 创建提供者实例
            provider = ConfigBasedVideoProvider(model_name)

            # 注册到注册表
            registry.register(provider, group=model_config.group)

            logger.info(f"注册模型提供者: {model_name} ({model_config.label})")

        except Exception as e:
            logger.error(f"注册模型提供者失败 {model_name}: {e}")
            continue