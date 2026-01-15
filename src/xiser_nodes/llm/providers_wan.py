"""Wan provider implementations."""

from __future__ import annotations

import json
import time
from typing import Any, Dict, List, Optional, Tuple

import requests
import torch

from .base import (
    BaseLLMProvider,
    LLMProviderConfig,
    _download_image_to_tensor,
    _image_to_data_url_from_b64,
)


class WanImageProvider(BaseLLMProvider):
    """Wan 2.6 image provider supporting both image edit and interleave modes."""

    def __init__(self):
        super().__init__(
            LLMProviderConfig(
                name="wan2.6-image",
                label="Wan 2.6 Image",
                endpoint="",  # Will be set dynamically based on mode
                model="wan2.6-image",
                default_system_prompt="You are a helpful AI assistant.",
                timeout=180,
                max_images=4,
                default_params={
                    "temperature": 0.35,
                    "top_p": 0.9,
                    "size": "1280*1280",
                    "prompt_extend": True,
                    "watermark": False,
                    "n": 1,
                    "enable_interleave": False,
                },
                extra_headers={},
            )
        )

    def build_payload(
        self, user_prompt: str, image_payloads: List[str], overrides: Dict[str, Any]
    ) -> Tuple[str, Dict[str, Any], Dict[str, str]]:
        """Build payload for Wan 2.6 API."""
        # Get mode from overrides, default to image_edit
        mode = overrides.get("mode", "image_edit")

        # Validate inputs based on mode
        if mode == "image_edit" and not image_payloads:
            raise ValueError("At least one image is required for image_edit mode.")

        # Get model override
        model = overrides.get("model", self.config.model)

        # Build messages
        messages = []
        content_items = []

        # Add text
        if user_prompt.strip():
            content_items.append({"text": user_prompt.strip()})

        # Add images
        for img_data in image_payloads:
            content_items.append({"image": _image_to_data_url_from_b64(img_data)})

        if content_items:
            messages.append({
                "role": "user",
                "content": content_items
            })

        # Build parameters based on mode
        size_raw = str(overrides.get("image_size", self.config.default_params.get("size", "1280*1280")))

        # Validate image size for wan2.6 constraints
        if size_raw and size_raw != "":
            try:
                # Parse width and height
                if "*" in size_raw:
                    width_str, height_str = size_raw.split("*")
                    width = int(width_str.strip())
                    height = int(height_str.strip())

                    # Calculate total pixels
                    total_pixels = width * height

                    # Validate constraints
                    min_pixels = 589824  # 768×768
                    max_pixels = 1638400  # 1280×1280

                    if total_pixels < min_pixels:
                        raise ValueError(f"Image size {size_raw} has {total_pixels} pixels, which is below the minimum {min_pixels} (768×768)")
                    if total_pixels > max_pixels:
                        raise ValueError(f"Image size {size_raw} has {total_pixels} pixels, which exceeds the maximum {max_pixels} (1280×1280)")

                    # Validate aspect ratio (1:4 to 4:1)
                    aspect_ratio = width / height
                    if aspect_ratio < 0.25 or aspect_ratio > 4.0:
                        raise ValueError(f"Image size {size_raw} has aspect ratio {aspect_ratio:.2f}, which is outside the allowed range 0.25 to 4.0 (1:4 to 4:1)")

            except (ValueError, AttributeError) as e:
                # If validation fails, use default size
                size_raw = "1280*1280"
                # print(f"[Wan2.6] Invalid image size, using default 1280*1280: {e}")  # 调试日志已关闭

        params: Dict[str, Any] = {
            "size": size_raw,
        }

        if mode == "image_edit":
            # Image edit mode parameters
            params.update({
                "prompt_extend": bool(overrides.get("prompt_extend", self.config.default_params.get("prompt_extend", True))),
                "watermark": bool(overrides.get("watermark", self.config.default_params.get("watermark", False))),
                "n": int(overrides.get("n_images", self.config.default_params.get("n", 1))),
                "enable_interleave": False,
            })
        else:  # interleave mode
            # Interleave mode parameters
            params.update({
                "max_images": int(overrides.get("max_images", self.config.max_images)),
                "stream": True,
                "enable_interleave": True,
            })

        # Add optional parameters with type conversion
        temperature = overrides.get("temperature")
        if temperature is not None:
            params["temperature"] = float(temperature)

        top_p = overrides.get("top_p")
        if top_p is not None:
            params["top_p"] = float(top_p)

        max_tokens = overrides.get("max_tokens")
        if max_tokens is not None:
            params["max_tokens"] = int(max_tokens)

        seed = overrides.get("seed")
        if seed is not None:
            try:
                seed_int = int(seed)
                if seed_int >= 0:
                    params["seed"] = seed_int
            except (ValueError, TypeError):
                pass  # Skip invalid seed values

        # Build payload
        payload: Dict[str, Any] = {
            "model": model,
            "input": {"messages": messages},
            "parameters": params,
        }

        # Select endpoint based on mode
        if mode == "image_edit":
            endpoint = "https://dashscope.aliyuncs.com/api/v1/services/aigc/image-generation/generation"
            # Always use async mode for image_edit
            extra_headers = {"X-DashScope-Async": "enable"}
        else:  # interleave mode
            endpoint = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
            # Interleave mode requires SSE streaming
            extra_headers = {"X-DashScope-Sse": "enable"}
            # Note: interleave mode may not support async, using streaming instead

        return endpoint, payload, extra_headers

    def invoke(self, user_prompt: str, image_payloads: List[str], api_key: str, overrides: Optional[Dict[str, Any]] = None, progress_callback: Optional[callable] = None) -> Dict[str, Any]:
        """Override invoke method to handle both async and streaming modes for wan2.6-image."""
        if not api_key:
            raise ValueError("API Key is required")

        overrides = overrides or {}
        mode = overrides.get("mode", "image_edit")
        endpoint, payload, extra_headers = self.build_payload(user_prompt, image_payloads, overrides)
        headers = self._build_headers(api_key)
        headers.update(extra_headers)

        # 进度：连接阶段
        if progress_callback:
            progress_callback("连接", 0.3)

        if mode == "image_edit":
            # Image edit mode uses async task polling
            return self._invoke_async(endpoint, headers, payload, progress_callback)
        else:  # interleave mode
            # Interleave mode uses SSE streaming
            return self._invoke_streaming(endpoint, headers, payload, progress_callback)

    def _invoke_async(self, endpoint: str, headers: Dict[str, str], payload: Dict[str, Any], progress_callback: Optional[callable] = None) -> Dict[str, Any]:
        """Handle async task polling for image_edit mode."""
        # Submit async task
        response = requests.post(
            endpoint,
            headers=headers,
            json=payload,
            timeout=self.config.timeout,
        )
        response.raise_for_status()
        task_response = response.json()

        # 进度：连接完成
        if progress_callback:
            progress_callback("连接", 1.0)

        # Check for task_id
        if "output" not in task_response or "task_id" not in task_response["output"]:
            return task_response

        task_id = task_response["output"]["task_id"]

        # Poll task status
        max_attempts = 30  # 30 attempts * 2 seconds = 60 seconds max
        poll_interval = 2  # seconds

        for attempt in range(max_attempts):
            time.sleep(poll_interval)

            # 进度：轮询阶段
            if progress_callback:
                progress = (attempt + 1) / max_attempts
                progress_callback("轮询", progress)

            # Query task status
            task_url = f"https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}"
            task_resp = requests.get(
                task_url,
                headers=headers,
                timeout=self.config.timeout,
            )
            task_resp.raise_for_status()
            task_status = task_resp.json()

            # Check task status
            if "output" in task_status and "task_status" in task_status["output"]:
                status = task_status["output"]["task_status"]
                if status == "SUCCEEDED":
                    # 进度：轮询完成
                    if progress_callback:
                        progress_callback("轮询", 1.0)
                    return task_status
                elif status in ["FAILED", "CANCELED"]:
                    raise RuntimeError(f"Task {task_id} failed with status: {status}")
                # PENDING or RUNNING - continue polling

            # If no task_status found, assume it's the final response
            if "output" in task_status and "choices" in task_status["output"]:
                # 进度：轮询完成
                if progress_callback:
                    progress_callback("轮询", 1.0)
                return task_status

        raise TimeoutError(f"Task {task_id} did not complete within {max_attempts * poll_interval} seconds")

    def _invoke_streaming(self, endpoint: str, headers: Dict[str, str], payload: Dict[str, Any], progress_callback: Optional[callable] = None) -> Dict[str, Any]:
        """Handle SSE streaming for interleave mode."""
        response = requests.post(
            endpoint,
            headers=headers,
            json=payload,
            timeout=self.config.timeout,
            stream=True,
        )
        response.raise_for_status()

        # 进度：连接完成
        if progress_callback:
            progress_callback("连接", 1.0)

        # 收集所有SSE事件的内容
        all_content = []
        final_usage = {}
        event_count = 0
        content_event_count = 0

        for line in response.iter_lines():
            if line:
                event_count += 1
                line_str = line.decode('utf-8')

                # 进度：流式处理阶段
                if progress_callback and event_count % 10 == 0:  # 每10个事件更新一次进度
                    progress = min(event_count / 100, 0.9)  # 假设最多100个事件
                    progress_callback("流式", progress)

                # 修复：检查 data: 开头（有或没有空格）
                if line_str.startswith('data:'):
                    # 移除 'data:' 前缀
                    if line_str.startswith('data: '):
                        event_data = line_str[6:]  # 移除 'data: '（有空格）
                    else:
                        event_data = line_str[5:]  # 移除 'data:'（没有空格）

                    if event_data == '[DONE]':
                        # 进度：流式处理完成
                        if progress_callback:
                            progress_callback("流式", 1.0)
                        break

                    try:
                        event_json = json.loads(event_data)
                        content_event_count += 1

                        # 提取content
                        if "output" in event_json and "choices" in event_json["output"]:
                            choices = event_json["output"]["choices"]
                            if choices and "message" in choices[0]:
                                content = choices[0]["message"].get("content", [])
                                if isinstance(content, list) and content:
                                    # 每个事件只包含一个content项，需要累积
                                    all_content.extend(content)

                                    # 检查是否结束并保存usage统计
                                    if (event_json["output"].get("finished") == True or
                                        choices[0].get("finish_reason") != "null"):
                                        final_usage = event_json["output"].get("usage", {})
                    except json.JSONDecodeError:
                        continue

        # 构建最终的响应结构
        merged_response = {
            "output": {
                "choices": [{
                    "message": {
                        "content": all_content,
                        "role": "assistant"
                    },
                    "finish_reason": "stop"
                }]
            }
        }

        # 添加usage统计
        if final_usage:
            merged_response["output"]["usage"] = final_usage

        return merged_response

    def extract_text(self, response: Dict[str, Any]) -> str:
        """Extract text from Wan 2.6 response."""

        # Check for output in different response formats
        if "output" in response:
            output = response["output"]
            if "choices" in output:
                choices = output["choices"]
                if choices and "message" in choices[0]:
                    content = choices[0]["message"].get("content", "")
                    if isinstance(content, str):
                        return content
                    elif isinstance(content, list):
                        # Extract text from content list (for interleave mode)
                        texts = []
                        image_count = 0
                        for item in content:
                            if isinstance(item, dict):
                                if item.get("type") == "text":
                                    text = item.get("text", "")
                                    if text:
                                        texts.append(text)
                                elif item.get("type") == "image":
                                    image_count += 1

                        # 如果有文本，返回文本
                        if texts:
                            # 修复：对于逐字符的文本，直接拼接而不是用换行符
                            return "".join(texts)
                        # 如果只有图像，返回描述性文本（类似Qwen图像编辑提供者）
                        elif image_count > 0:
                            request_id = response.get("request_id", "")
                            return f"Wan2.6 image edit success: {image_count} image(s). request_id={request_id}".strip()

        # Fallback: try to find text in response
        if "choices" in response:
            choices = response["choices"]
            if choices and "message" in choices[0]:
                content = choices[0]["message"].get("content", "")
                if isinstance(content, str):
                    return content

        # Check for direct content in response (for streaming)
        if "content" in response and isinstance(response["content"], list):
            texts = []
            image_count = 0
            for item in response["content"]:
                if isinstance(item, dict):
                    if item.get("type") == "text":
                        text = item.get("text", "")
                        if text:
                            texts.append(text)
                    elif item.get("type") == "image":
                        image_count += 1

            if texts:
                # 修复：对于逐字符的文本，直接拼接而不是用换行符
                return "".join(texts)
            elif image_count > 0:
                request_id = response.get("request_id", "")
                return f"Wan2.6 image edit success: {image_count} image(s). request_id={request_id}".strip()

        # 检查错误情况
        if "error" in response:
            err = response.get("error", {})
            return f"Wan2.6 error: {err.get('code', '')} {err.get('message', '')}".strip()

        if response.get("code") not in (None, 200):
            return f"Wan2.6 code: {response.get('code')} {response.get('message', '')}".strip()

        return "Wan2.6: no text content in response"

    def extract_images(self, response: Dict[str, Any]) -> List[torch.Tensor]:
        """Extract images from Wan 2.6 response."""
        images = []

        # Check for image URLs in response (standard format)
        if "output" in response:
            output = response["output"]
            if "choices" in output:
                choices = output["choices"]
                if choices and "message" in choices[0]:
                    content = choices[0]["message"].get("content", [])
                    if isinstance(content, list):
                        for item in content:
                            if isinstance(item, dict) and item.get("type") == "image":
                                image_url = item.get("image")
                                if image_url:
                                    tensor = _download_image_to_tensor(image_url)
                                    if tensor is not None:
                                        images.append(tensor)

        # Check for direct content in response (for streaming/interleave mode)
        if "content" in response and isinstance(response["content"], list):
            for item in response["content"]:
                if isinstance(item, dict) and item.get("type") == "image":
                    image_url = item.get("image")
                    if image_url:
                        tensor = _download_image_to_tensor(image_url)
                        if tensor is not None:
                            images.append(tensor)

        return images

    def extract_image_urls(self, response: Dict[str, Any]) -> List[str]:
        """Extract image URLs from Wan 2.6 response."""
        urls = []

        # Check for image URLs in response (standard format)
        if "output" in response:
            output = response["output"]
            if "choices" in output:
                choices = output["choices"]
                if choices and "message" in choices[0]:
                    content = choices[0]["message"].get("content", [])
                    if isinstance(content, list):
                        for item in content:
                            if isinstance(item, dict) and item.get("type") == "image":
                                image_url = item.get("image")
                                if image_url:
                                    urls.append(image_url)

        # Check for direct content in response (for streaming/interleave mode)
        if "content" in response and isinstance(response["content"], list):
            for item in response["content"]:
                if isinstance(item, dict) and item.get("type") == "image":
                    image_url = item.get("image")
                    if image_url:
                        urls.append(image_url)

        return urls


__all__ = [
    "WanImageProvider",
]