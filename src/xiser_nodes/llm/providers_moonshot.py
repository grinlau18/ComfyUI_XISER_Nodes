"""Moonshot/Kimi provider implementations."""

from __future__ import annotations

from typing import Any, Dict, List, Tuple

from .base import BaseLLMProvider, LLMProviderConfig


class MoonshotChatProvider(BaseLLMProvider):
    """Moonshot/Kimi text provider (OpenAI-compatible chat)."""

    def __init__(self):
        super().__init__(
            LLMProviderConfig(
                name="moonshot",
                label="Moonshot",
                endpoint="https://api.moonshot.cn/v1/chat/completions",
                model="moonshot-v1-8k",
                default_system_prompt="You are Moonshot (Kimi), a helpful assistant.",
                timeout=120,
                max_images=0,
                default_params={"temperature": 0.35, "top_p": 0.9},
            )
        )

    def build_payload(
        self, user_prompt: str, image_payloads: List[str], overrides: Dict[str, Any]
    ) -> Tuple[str, Dict[str, Any], Dict[str, str]]:
        if image_payloads:
            raise ValueError("Moonshot text provider does not support image inputs. Use Moonshot-Vision.")

        system_prompt = overrides.get("system_prompt", self.config.default_system_prompt)
        model = overrides.get("model", self.config.model)
        temperature = overrides.get("temperature", self.config.default_params.get("temperature", 0.35))
        top_p = overrides.get("top_p", self.config.default_params.get("top_p", 0.9))
        max_tokens = overrides.get("max_tokens")
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
        return self.config.endpoint, payload, {}

    def extract_text(self, response: Dict[str, Any]) -> str:
        choices = response.get("choices", [])
        if not choices:
            return "Moonshot did not return any choices."
        content = choices[0].get("message", {}).get("content")
        return content or ""


class MoonshotVisionProvider(BaseLLMProvider):
    """Moonshot/Kimi vision provider (supports image_url)."""

    def __init__(self):
        super().__init__(
            LLMProviderConfig(
                name="moonshot_vision",
                label="Moonshot-Vision",
                endpoint="https://api.moonshot.cn/v1/chat/completions",
                model="moonshot-v1-vision",
                default_system_prompt="You are Moonshot (Kimi) Vision, a helpful vision-language assistant.",
                timeout=120,
                max_images=8,
                default_params={"temperature": 0.35, "top_p": 0.9},
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
        seed = overrides.get("seed")

        content: List[Dict[str, Any]] = []
        for encoded in image_payloads:
            content.append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{encoded}"}})
        if user_prompt.strip():
            content.append({"type": "text", "text": user_prompt})
        else:
            raise ValueError("Instruction cannot be empty when sending images to Moonshot-Vision.")

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
        return self.config.endpoint, payload, {}

    def extract_text(self, response: Dict[str, Any]) -> str:
        choices = response.get("choices", [])
        if not choices:
            return "Moonshot-Vision did not return any choices."
        content = choices[0].get("message", {}).get("content")
        return content or ""


__all__ = ["MoonshotChatProvider", "MoonshotVisionProvider"]
