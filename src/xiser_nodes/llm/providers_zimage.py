"""Z-Image provider implementation for text-to-image generation."""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Tuple

import requests
import torch

from .base import (
    BaseLLMProvider,
    LLMProviderConfig,
    _download_image_to_tensor,
    _image_to_data_url_from_b64,
)


class ZImageProvider(BaseLLMProvider):
    """Z-Image Turbo provider for text-to-image generation."""

    def __init__(self):
        super().__init__(
            LLMProviderConfig(
                name="z-image-turbo",
                label="Z-Image Turbo",
                endpoint="https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
                model="z-image-turbo",
                default_system_prompt="You are a helpful AI assistant.",
                timeout=120,
                max_images=1,  # Z-Image固定输出1张图像
                default_params={
                    "temperature": 0.35,
                    "size": "1024*1536",  # 默认分辨率
                    "prompt_extend": False,  # 默认关闭智能改写
                    "seed": None,  # 默认不设置种子
                },
                extra_headers={},
            )
        )

    def build_payload(
        self, user_prompt: str, image_payloads: List[str], overrides: Dict[str, Any]
    ) -> Tuple[str, Dict[str, Any], Dict[str, str]]:
        """Build payload for Z-Image Turbo API.

        Z-Image Turbo API格式：
        {
            "model": "z-image-turbo",
            "input": {
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "text": "prompt text"
                            }
                        ]
                    }
                ]
            },
            "parameters": {
                "prompt_extend": false,
                "size": "1120*1440",
                "seed": 12345
            }
        }
        """
        # Z-Image是纯文生图模型，不支持图像输入
        if image_payloads:
            # print(f"[Z-Image] Warning: Z-Image Turbo does not support image inputs, ignoring {len(image_payloads)} images")  # 调试日志已关闭
            pass

        # 获取模型覆盖
        model = overrides.get("model", self.config.model)

        # 构建消息
        messages = []
        if user_prompt.strip():
            messages.append({
                "role": "user",
                "content": [
                    {
                        "text": user_prompt.strip()
                    }
                ]
            })
        else:
            raise ValueError("Instruction is required for Z-Image Turbo")

        # 获取并验证图像尺寸
        size_raw = str(overrides.get("image_size", self.config.default_params.get("size", "1024*1536")))

        # 验证图像尺寸约束
        if size_raw and size_raw != "":
            try:
                # 解析宽度和高度
                if "*" in size_raw:
                    width_str, height_str = size_raw.split("*")
                    width = int(width_str.strip())
                    height = int(height_str.strip())

                    # 计算总像素
                    total_pixels = width * height

                    # Z-Image约束：总像素在[512*512, 2048*2048]之间
                    min_pixels = 262144  # 512×512
                    max_pixels = 4194304  # 2048×2048

                    if total_pixels < min_pixels:
                        raise ValueError(f"Image size {size_raw} has {total_pixels} pixels, which is below the minimum {min_pixels} (512×512)")
                    if total_pixels > max_pixels:
                        raise ValueError(f"Image size {size_raw} has {total_pixels} pixels, which exceeds the maximum {max_pixels} (2048×2048)")

                    # 推荐分辨率范围：总像素在[1024*1024, 1536*1536]之间
                    recommended_min = 1048576  # 1024×1024
                    recommended_max = 2359296  # 1536×1536

                    if total_pixels < recommended_min or total_pixels > recommended_max:
                        # print(f"[Z-Image] Warning: Image size {size_raw} ({total_pixels} pixels) is outside recommended range [{recommended_min}, {recommended_max}]")  # 调试日志已关闭
                        pass

            except (ValueError, AttributeError) as e:
                # 如果验证失败，使用默认尺寸
                size_raw = "1024*1536"
                # print(f"[Z-Image] Invalid image size, using default 1024*1536: {e}")  # 调试日志已关闭

        # 构建参数
        params: Dict[str, Any] = {
            "size": size_raw,
        }

        # 添加可选参数
        prompt_extend = overrides.get("prompt_extend")
        if prompt_extend is not None:
            params["prompt_extend"] = bool(prompt_extend)
        else:
            params["prompt_extend"] = self.config.default_params.get("prompt_extend", False)

        seed = overrides.get("seed")
        if seed is not None:
            try:
                seed_int = int(seed)
                if 0 <= seed_int <= 2147483647:  # Z-Image种子范围
                    params["seed"] = seed_int
            except (ValueError, TypeError):
                pass  # 跳过无效的种子值

        # 构建完整负载
        payload: Dict[str, Any] = {
            "model": model,
            "input": {"messages": messages},
            "parameters": params,
        }

        # Z-Image使用同步调用，不需要额外头部
        extra_headers = {}

        return self.config.endpoint, payload, extra_headers

    def extract_text(self, response: Dict[str, Any]) -> str:
        """Extract text from Z-Image response.

        Z-Image响应格式：
        {
            "output": {
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {
                            "content": [
                                {
                                    "image": "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/xxx.png?Expires=xxx"
                                },
                                {
                                    "text": "prompt text or extended prompt"
                                }
                            ],
                            "reasoning_content": "",
                            "role": "assistant"
                        }
                    }
                ]
            },
            "usage": {
                "height": 1536,
                "image_count": 1,
                "input_tokens": 0,
                "output_tokens": 0,
                "total_tokens": 0,
                "width": 1024
            },
            "request_id": "abf1645b-b630-433a-92f6-xxxxxx"
        }
        """
        # 检查标准响应格式
        if "output" in response:
            output = response["output"]
            if "choices" in output:
                choices = output["choices"]
                if choices and "message" in choices[0]:
                    content = choices[0]["message"].get("content", [])
                    if isinstance(content, list):
                        # 提取文本内容
                        texts = []
                        for item in content:
                            if isinstance(item, dict):
                                if "text" in item:
                                    texts.append(item["text"])

                        if texts:
                            return "\n".join(texts)

        # 检查错误情况
        if "error" in response:
            err = response.get("error", {})
            return f"Z-Image error: {err.get('code', '')} {err.get('message', '')}".strip()

        if response.get("code") not in (None, 200):
            return f"Z-Image code: {response.get('code')} {response.get('message', '')}".strip()

        # 如果有request_id，返回成功信息
        request_id = response.get("request_id", "")
        if request_id:
            return f"Z-Image image generation success. request_id={request_id}".strip()

        return "Z-Image: no text content in response"

    def extract_images(self, response: Dict[str, Any]) -> List[torch.Tensor]:
        """Extract images from Z-Image response."""
        images = []

        # 检查标准响应格式
        if "output" in response:
            output = response["output"]
            if "choices" in output:
                choices = output["choices"]
                if choices and "message" in choices[0]:
                    content = choices[0]["message"].get("content", [])
                    if isinstance(content, list):
                        for item in content:
                            if isinstance(item, dict) and "image" in item:
                                image_url = item["image"]
                                if image_url:
                                    tensor = _download_image_to_tensor(image_url)
                                    if tensor is not None:
                                        images.append(tensor)

        return images

    def extract_image_urls(self, response: Dict[str, Any]) -> List[str]:
        """Extract image URLs from Z-Image response."""
        urls = []

        # 检查标准响应格式
        if "output" in response:
            output = response["output"]
            if "choices" in output:
                choices = output["choices"]
                if choices and "message" in choices[0]:
                    content = choices[0]["message"].get("content", [])
                    if isinstance(content, list):
                        for item in content:
                            if isinstance(item, dict) and "image" in item:
                                image_url = item["image"]
                                if image_url:
                                    urls.append(image_url)

        return urls


__all__ = [
    "ZImageProvider",
]