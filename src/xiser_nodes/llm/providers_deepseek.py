"""DeepSeek provider implementations."""

from __future__ import annotations

from typing import Any, Dict, List, Tuple

from .base import BaseLLMProvider, LLMProviderConfig


class DeepSeekChatProvider(BaseLLMProvider):
    """DeepSeek provider using OpenAI-compatible API."""

    def __init__(self):
        super().__init__(
            LLMProviderConfig(
                name="deepseek",
                label="DeepSeek",
                endpoint="https://api.deepseek.com/v1/chat/completions",
                model="deepseek-chat",
                default_system_prompt="You are DeepSeek, a helpful assistant for visual workflows.",
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
        temperature = overrides.get("temperature", self.config.default_params.get("temperature", 0.3))
        top_p = overrides.get("top_p", self.config.default_params.get("top_p", 0.9))
        max_tokens = overrides.get("max_tokens")

        if image_payloads:
            if not user_prompt.strip():
                raise ValueError("Instruction cannot be empty when sending images to DeepSeek.")
            endpoint = "https://api.deepseek.com/v1/responses"
            content: List[Dict[str, Any]] = []
            if user_prompt.strip():
                content.append({"type": "input_text", "text": user_prompt})
            for encoded in image_payloads:
                content.append({"type": "input_image", "image_base64": encoded})

            inputs: List[Dict[str, Any]] = []
            if system_prompt:
                inputs.append(
                    {
                        "role": "system",
                        "content": [{"type": "input_text", "text": system_prompt}],
                    }
                )
            inputs.append({"role": "user", "content": content})

            payload: Dict[str, Any] = {
                "model": model,
                "input": inputs,
                "temperature": temperature,
                "top_p": top_p,
            }
            if max_tokens:
                payload["max_output_tokens"] = int(max_tokens)
            headers = {"OpenAI-Beta": "responses-v1"}
            return endpoint, payload, headers

        content = []
        if user_prompt.strip():
            content.append({"type": "text", "text": user_prompt})

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": content or user_prompt})

        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "top_p": top_p,
        }
        if max_tokens:
            payload["max_tokens"] = int(max_tokens)
        return self.config.endpoint, payload, {}

    def extract_text(self, response: Dict[str, Any]) -> str:
        def _flatten_content(content: Any) -> str:
            if isinstance(content, list):
                texts = []
                for part in content:
                    if isinstance(part, dict):
                        for key in ("text", "content"):
                            if isinstance(part.get(key), str):
                                texts.append(part[key])
                                break
                        else:
                            nested = _flatten_content(part.get("content"))
                            if nested:
                                texts.append(nested)
                    elif isinstance(part, str):
                        texts.append(part)
                return "\n".join(filter(None, texts))
            if isinstance(content, dict):
                for key in ("text", "content"):
                    value = content.get(key)
                    if isinstance(value, str):
                        return value
                    nested = _flatten_content(value)
                    if nested:
                        return nested
            if isinstance(content, str):
                return content
            return ""

        choices = response.get("choices")
        if not choices:
            output = response.get("output") or {}
            choices = output.get("choices")
        if not choices:
            output_text = response.get("output_text")
            if isinstance(output_text, list):
                return "\n".join(output_text)
            return "DeepSeek did not return any choices."

        choice = choices[0]
        content = None
        if isinstance(choice, dict):
            if "message" in choice:
                content = choice["message"].get("content")
            elif "content" in choice:
                content = choice.get("content")
            elif "output" in choice:
                content = choice["output"].get("content")
        return _flatten_content(content)


__all__ = ["DeepSeekChatProvider"]
