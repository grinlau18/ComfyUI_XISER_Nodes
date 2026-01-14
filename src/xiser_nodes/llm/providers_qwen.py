"""Qwen provider implementations."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

import torch

from .base import (
    BaseLLMProvider,
    LLMProviderConfig,
    _download_image_to_tensor,
    _image_to_data_url_from_b64,
)


class QwenChatProvider(BaseLLMProvider):
    """Qwen provider via DashScope compatible OpenAI endpoint (text only)."""

    def __init__(self):
        super().__init__(
            LLMProviderConfig(
                name="qwen",
                label="Qwen (DashScope)",
                endpoint="https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
                model="qwen-plus-2025-07-28",
                default_system_prompt="You are Qwen, a helpful assistant.",
                timeout=120,
                max_images=0,
                default_params={"temperature": 0.35, "top_p": 0.9},
                extra_headers={},
            )
        )

    def build_payload(
        self, user_prompt: str, image_payloads: List[str], overrides: Dict[str, Any]
    ) -> Tuple[str, Dict[str, Any], Dict[str, str]]:
        if image_payloads:
            raise ValueError("Qwen (text) provider does not support image inputs. Use Qwen-VL provider instead.")

        system_prompt = overrides.get("system_prompt", self.config.default_system_prompt)
        model = overrides.get("model", self.config.model)
        temperature = overrides.get("temperature", self.config.default_params.get("temperature", 0.35))
        top_p = overrides.get("top_p", self.config.default_params.get("top_p", 0.9))
        max_tokens = overrides.get("max_tokens")
        enable_thinking = overrides.get("enable_thinking", False)
        thinking_budget = overrides.get("thinking_budget")
        seed = overrides.get("seed")

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": user_prompt})

        payload: Dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "top_p": top_p,
        }
        if max_tokens:
            payload["max_tokens"] = int(max_tokens)
        if seed is not None and seed >= 0:
            payload["seed"] = int(seed)
        if enable_thinking:
            extra = payload.setdefault("extra_body", {})
            extra["enable_thinking"] = True
            if thinking_budget:
                extra["thinking_budget"] = int(thinking_budget)
        return self.config.endpoint, payload, {}

    def extract_text(self, response: Dict[str, Any]) -> str:
        choices = response.get("choices", [])
        if not choices:
            return "Qwen did not return any choices."
        content = choices[0].get("message", {}).get("content")
        return content or ""


class QwenFlashProvider(QwenChatProvider):
    """Qwen flash text provider (faster variant)."""

    def __init__(self):
        super().__init__()
        self.config = LLMProviderConfig(
            name="qwen-flash",
            label="Qwen Flash",
            endpoint="https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
            model="qwen-flash-2025-07-28",
            default_system_prompt="You are Qwen Flash, a fast and concise assistant.",
            timeout=120,
            max_images=0,
            default_params={"temperature": 0.35, "top_p": 0.9},
            extra_headers={},
        )


class QwenVLProvider(BaseLLMProvider):
    """Qwen VL provider (supports image_url content)."""

    def __init__(self):
        super().__init__(
            LLMProviderConfig(
                name="qwen_vl",
                label="Qwen-VL",
                endpoint="https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
                model="qwen3-vl-plus",
                default_system_prompt="You are Qwen-VL, a helpful vision-language assistant.",
                timeout=120,
                max_images=8,
                default_params={"temperature": 0.35, "top_p": 0.9},
                extra_headers={},
            )
        )

    def build_payload(
        self, user_prompt: str, image_payloads: List[str], overrides: Dict[str, Any]
    ) -> Tuple[str, Dict[str, Any], Dict[str, str]]:
        system_prompt = overrides.get("system_prompt", self.config.default_system_prompt)
        model = overrides.get("model", self.config.model)
        temperature = overrides.get("temperature", self.config.default_params.get("temperature", 0.35))
        top_p = overrides.get("top_p", self.config.default_params.get("top_p", 0.9))
        max_tokens = overrides.get("max_tokens")
        enable_thinking = overrides.get("enable_thinking", False)
        thinking_budget = overrides.get("thinking_budget")
        seed = overrides.get("seed")

        content: List[Dict[str, Any]] = []
        for encoded in image_payloads:
            content.append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{encoded}"}})
        if user_prompt.strip():
            content.append({"type": "text", "text": user_prompt})
        else:
            raise ValueError("Instruction cannot be empty when sending images to Qwen-VL.")

        messages: List[Dict[str, Any]] = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": content})

        payload: Dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "top_p": top_p,
        }
        if max_tokens:
            payload["max_tokens"] = int(max_tokens)
        if seed is not None and seed >= 0:
            payload["seed"] = int(seed)
        if enable_thinking:
            extra = payload.setdefault("extra_body", {})
            extra["enable_thinking"] = True
            if thinking_budget:
                extra["thinking_budget"] = int(thinking_budget)
        return self.config.endpoint, payload, {}

    def extract_text(self, response: Dict[str, Any]) -> str:
        choices = response.get("choices", [])
        if not choices:
            return "Qwen-VL did not return any choices."
        content = choices[0].get("message", {}).get("content")
        return content or ""


class QwenVLPlusProvider(QwenVLProvider):
    """Alias provider for Qwen-VL Plus (explicit name)."""

    def __init__(self):
        super().__init__()
        self.config = LLMProviderConfig(
            name="qwen-vl-plus",
            label="Qwen-VL Plus",
            endpoint="https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
            model="qwen3-vl-plus",
            default_system_prompt="You are Qwen-VL Plus, a helpful vision-language assistant.",
            timeout=120,
            max_images=8,
            default_params={"temperature": 0.35, "top_p": 0.9},
            extra_headers={},
        )


class QwenVLFlashProvider(QwenVLProvider):
    """Qwen3 VL Flash provider (fast vision-language)."""

    def __init__(self):
        super().__init__()
        self.config = LLMProviderConfig(
            name="qwen3-vl-flash",
            label="Qwen3-VL Flash",
            endpoint="https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
            model="qwen3-vl-flash",
            default_system_prompt="You are Qwen3-VL Flash, a fast vision-language assistant.",
            timeout=120,
            max_images=8,
            default_params={"temperature": 0.35, "top_p": 0.9},
            extra_headers={},
        )




class QwenImageCreateProvider(BaseLLMProvider):
    """Qwen image edit/enhance provider (qwen-image-edit-plus, accepts reference image)."""

    def __init__(self):
        super().__init__(
            LLMProviderConfig(
                name="qwen-image-edit-plus",
                label="Qwen Image Edit Plus",
                endpoint="https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
                model="qwen-image-edit-plus",
                default_system_prompt="",
                timeout=120,
                max_images=6,
                default_params={},
            )
        )

    def build_payload(
        self, user_prompt: str, image_payloads: List[str], overrides: Dict[str, Any]
    ) -> Tuple[str, Dict[str, Any], Dict[str, str]]:
        if not user_prompt.strip():
            raise ValueError("Instruction cannot be empty for image editing.")
        if not image_payloads:
            raise ValueError("At least one reference image is required for image editing.")

        model = overrides.get("model", self.config.model)
        negative_prompt = overrides.get("negative_prompt", "")
        watermark = bool(overrides.get("watermark", False))
        prompt_extend = bool(overrides.get("prompt_extend", True))
        n_images = int(overrides.get("n_images", 1) or 1)
        n_images = max(1, min(n_images, 6))
        size_raw = str(overrides.get("image_size", "") or "")
        size = size_raw.replace("x", "*").replace("X", "*").strip() if size_raw else ""
        if n_images > 1:
            size = ""  # API only allows size when n==1

        content: List[Dict[str, Any]] = []
        for encoded in image_payloads[: self.config.max_images]:
            content.append({"image": _image_to_data_url_from_b64(encoded)})
        if user_prompt.strip():
            content.append({"text": user_prompt})

        payload: Dict[str, Any] = {
            "model": model,
            "input": {
                "messages": [
                    {
                        "role": "user",
                        "content": content,
                    }
                ]
            },
            "parameters": {
                "negative_prompt": negative_prompt or " ",
                "watermark": watermark,
                "prompt_extend": prompt_extend,
                "n": n_images,
            },
        }
        if size:
            payload["parameters"]["size"] = size
        headers = {"Content-Type": "application/json"}
        return self.config.endpoint, payload, headers

    def extract_text(self, response: Dict[str, Any]) -> str:
        if isinstance(response, dict):
            if "error" in response:
                err = response.get("error", {})
                return f"Qwen image edit error: {err.get('code', '')} {err.get('message', '')}".strip()
            if response.get("code") not in (None, 200):
                return f"Qwen image edit code: {response.get('code')} {response.get('message', '')}"
            output = response.get("output", {}) if isinstance(response, dict) else {}
            choices = output.get("choices") if isinstance(output, dict) else None
            if choices:
                count = 0
                try:
                    content = choices[0].get("message", {}).get("content") or []
                    count = len(content)
                except Exception:
                    count = 0
                rid = response.get("request_id", "")
                return f"Qwen image edit success: {count} image(s). request_id={rid}".strip()
            return f"Qwen image edit: no choices in response. raw={response}"
        return ""

    def extract_images(self, response: Dict[str, Any]) -> List[torch.Tensor]:
        output = response.get("output", {}) if isinstance(response, dict) else {}
        choices = output.get("choices") if isinstance(output, dict) else None
        if not choices:
            return []
        results: List[torch.Tensor] = []
        try:
            content = choices[0].get("message", {}).get("content") or []
        except Exception:
            content = []
        if isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and isinstance(part.get("image"), str):
                    self._fetch_and_append(part["image"], results)
        elif isinstance(content, str) and content.startswith("http"):
            self._fetch_and_append(content, results)
        return results

    def extract_image_urls(self, response: Dict[str, Any]) -> List[str]:
        output = response.get("output", {}) if isinstance(response, dict) else {}
        choices = output.get("choices") if isinstance(output, dict) else None
        urls: List[str] = []
        if isinstance(choices, list) and choices:
            try:
                content = choices[0].get("message", {}).get("content") or []
            except Exception:
                content = []
            if isinstance(content, list):
                for part in content:
                    if isinstance(part, dict) and isinstance(part.get("image"), str):
                        urls.append(part["image"])
            elif isinstance(content, str) and content.startswith("http"):
                urls.append(content)
        return urls

    def _fetch_and_append(self, url: str, results: List[torch.Tensor]):
        tensor = _download_image_to_tensor(url)
        if tensor is not None:
            results.append(tensor)
        return results




class QwenImageMaxProvider(BaseLLMProvider):
    """Qwen image-max generation via compatible chat API (high realism, low AI trace, fine text rendering)."""

    def __init__(self):
        super().__init__(
            LLMProviderConfig(
                name="qwen-image-max",
                label="Qwen Image Max",
                endpoint="https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
                model="qwen-image-max",
                default_system_prompt="",
                timeout=180,  # Longer timeout for high-quality generation
                max_images=0,
                default_params={},
            )
        )

    def build_payload(
        self, user_prompt: str, image_payloads: List[str], overrides: Dict[str, Any]
    ) -> Tuple[str, Dict[str, Any], Dict[str, str]]:
        if not user_prompt.strip():
            raise ValueError("Instruction cannot be empty for image creation.")

        # Validate prompt length (qwen-image-max supports up to 800 characters)
        if len(user_prompt) > 800:
            raise ValueError(f"Prompt too long ({len(user_prompt)} chars). qwen-image-max supports up to 800 characters.")

        model = overrides.get("model", self.config.model)
        size_raw = str(overrides.get("image_size", "1664*928"))
        size = size_raw.replace("x", "*").replace("X", "*").strip()

        # qwen-image-max specific allowed sizes
        allowed_sizes = {"1664*928", "1472*1104", "1328*1328", "1104*1472", "928*1664"}
        if size not in allowed_sizes:
            size = "1664*928"  # Default size for qwen-image-max

        negative_prompt = overrides.get("negative_prompt", "")
        watermark = bool(overrides.get("watermark", False))
        prompt_extend = bool(overrides.get("prompt_extend", True))
        seed = overrides.get("seed")

        # qwen-image-max always generates 1 image
        n_images = 1

        payload: Dict[str, Any] = {
            "model": model,
            "input": {
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": user_prompt},
                        ],
                    }
                ]
            },
            "parameters": {
                "size": size,
                "negative_prompt": negative_prompt,
                "watermark": watermark,
                "prompt_extend": prompt_extend,
                "n": n_images,
            },
        }

        # Add seed if provided (0~2147483647)
        if seed is not None:
            try:
                seed_int = int(seed)
                if 0 <= seed_int <= 2147483647:
                    payload["parameters"]["seed"] = seed_int
            except (ValueError, TypeError):
                pass  # Ignore invalid seed values

        headers = {"Content-Type": "application/json"}
        return self.config.endpoint, payload, headers

    def extract_text(self, response: Dict[str, Any]) -> str:
        if isinstance(response, dict):
            if "error" in response:
                err = response.get("error", {})
                return f"Qwen image-max error: {err.get('code', '')} {err.get('message', '')}".strip()
            if response.get("code") not in (None, 200):
                return f"Qwen image-max code={response.get('code')} msg={response.get('message', '')}".strip()
            out = response.get("output", {}) if isinstance(response.get("output", {}), dict) else {}
            choices = out.get("choices")
            if choices:
                rid = response.get("request_id", "")
                return f"Qwen image-max success. request_id={rid or 'unknown'}".strip()
            return f"Qwen image-max: no choices in response. raw={response}"
        return ""

    def extract_images(self, response: Dict[str, Any]) -> List[torch.Tensor]:
        results: List[torch.Tensor] = []
        output = response.get("output", {}) if isinstance(response, dict) else {}
        choices = output.get("choices") if isinstance(output, dict) else None
        if isinstance(choices, list) and choices:
            try:
                content = choices[0].get("message", {}).get("content")
            except Exception:
                content = None
            if isinstance(content, list):
                for part in content:
                    if not isinstance(part, dict):
                        continue
                    url = part.get("image") if isinstance(part.get("image"), str) else None
                    if url:
                        self._fetch_and_append(url, results)
            elif isinstance(content, str) and content.startswith("http"):
                self._fetch_and_append(content, results)

        return results

    def extract_image_urls(self, response: Dict[str, Any]) -> List[str]:
        urls: List[str] = []
        output = response.get("output", {}) if isinstance(response, dict) else {}
        choices = output.get("choices") if isinstance(output, dict) else None
        if isinstance(choices, list) and choices:
            try:
                content = choices[0].get("message", {}).get("content")
            except Exception:
                content = None
            if isinstance(content, list):
                for part in content:
                    if not isinstance(part, dict):
                        continue
                    image_url = part.get("image")
                    if isinstance(image_url, str):
                        urls.append(image_url)
            elif isinstance(content, str) and content.startswith("http"):
                urls.append(content)
        return urls

    def _fetch_and_append(self, url: str, results: List[torch.Tensor]):
        tensor = _download_image_to_tensor(url)
        if tensor is not None:
            results.append(tensor)
        return results


class Qwen3MaxProvider(BaseLLMProvider):
    """Qwen3-Max provider via OpenAI-compatible endpoint (text only)."""

    def __init__(self):
        super().__init__(
            LLMProviderConfig(
                name="qwen3-max",  # 用户要求的名称
                label="Qwen3-Max",
                endpoint="https://dashscope.aliyuncs.com/compatible-mode/v1",  # 用户指定的端点
                model="qwen3-max",  # 模型名称
                default_system_prompt="You are Qwen3-Max, a helpful assistant.",
                timeout=120,
                max_images=0,  # 纯文本模型，不支持图像
                default_params={"temperature": 0.35, "top_p": 0.9},
                extra_headers={},
            )
        )

    def build_payload(
        self, user_prompt: str, image_payloads: List[str], overrides: Dict[str, Any]
    ) -> Tuple[str, Dict[str, Any], Dict[str, str]]:
        if image_payloads:
            raise ValueError("Qwen3-Max provider does not support image inputs.")

        system_prompt = overrides.get("system_prompt", self.config.default_system_prompt)
        model = overrides.get("model", self.config.model)
        temperature = overrides.get("temperature", self.config.default_params.get("temperature", 0.35))
        top_p = overrides.get("top_p", self.config.default_params.get("top_p", 0.9))
        max_tokens = overrides.get("max_tokens")
        enable_thinking = overrides.get("enable_thinking", False)
        thinking_budget = overrides.get("thinking_budget")
        seed = overrides.get("seed")

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": user_prompt})

        payload: Dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "top_p": top_p,
        }

        if max_tokens:
            payload["max_tokens"] = int(max_tokens)
        if seed is not None and seed >= 0:
            payload["seed"] = int(seed)
        if enable_thinking:
            extra = payload.setdefault("extra_body", {})
            extra["enable_thinking"] = True
            if thinking_budget:
                extra["thinking_budget"] = int(thinking_budget)

        # 拼接完整的端点URL
        full_endpoint = self.config.endpoint + "/chat/completions"
        return full_endpoint, payload, {}

    def extract_text(self, response: Dict[str, Any]) -> str:
        choices = response.get("choices", [])
        if not choices:
            return "Qwen3-Max did not return any choices."
        content = choices[0].get("message", {}).get("content")
        return content or ""


__all__ = [
    "QwenChatProvider",
    "QwenFlashProvider",
    "QwenVLProvider",
    "QwenVLPlusProvider",
    "QwenVLFlashProvider",
    "QwenImageCreateProvider",
    "QwenImageMaxProvider",
    "Qwen3MaxProvider",
]
