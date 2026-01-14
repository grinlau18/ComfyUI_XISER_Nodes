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

        # 获取参数
        temperature = overrides.get("temperature", self.config.default_params.get("temperature", 0.35))
        top_p = overrides.get("top_p", self.config.default_params.get("top_p", 0.9))
        max_tokens = overrides.get("max_tokens")
        seed = overrides.get("seed")
        enable_thinking = overrides.get("enable_thinking", False)
        thinking_budget = overrides.get("thinking_budget")

        # 模型选择逻辑
        base_model = overrides.get("model", self.config.model)

        # 如果用户通过model参数指定了模型，使用用户指定的
        # 否则根据enable_thinking选择模型
        if overrides.get("model"):
            # 用户明确指定了模型，使用用户指定的
            model = base_model
        elif enable_thinking:
            # enable_thinking为True时，使用思考模式模型
            model = "deepseek-reasoner"
        else:
            # 默认使用聊天模型
            model = "deepseek-chat"

        # DeepSeek API 目前不支持图像输入，优雅降级：忽略图片并添加提示
        image_warning = ""
        if image_payloads:
            image_warning = " (注：DeepSeek模型不支持图片输入，已自动忽略图片，仅处理文本)"

        # 构建用户消息，如果有图片警告则添加到提示中
        final_user_prompt = user_prompt
        if image_warning:
            if user_prompt.strip():
                # 如果有用户提示，将警告附加到提示后
                final_user_prompt = user_prompt + image_warning
            else:
                # 如果用户提示为空，使用警告作为提示
                final_user_prompt = "用户上传了图片" + image_warning

        content = []
        if final_user_prompt.strip():
            content.append({"type": "text", "text": final_user_prompt})

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": content or final_user_prompt})

        payload = {
            "model": model,
            "messages": messages,
        }

        # DeepSeek思考模式下，temperature和top_p参数不生效，但为了兼容性仍然发送
        payload["temperature"] = temperature
        payload["top_p"] = top_p

        if max_tokens:
            payload["max_tokens"] = int(max_tokens)

        # 添加种子参数（如果提供）
        if seed is not None:
            try:
                seed_int = int(seed)
                if seed_int >= 0:
                    payload["seed"] = seed_int
            except (ValueError, TypeError):
                pass  # 忽略无效的种子值

        # 处理思考模式
        # deepseek-reasoner模型自动启用思考模式
        # 当使用deepseek-reasoner模型且有thinking_budget时，添加thinking参数
        if model == "deepseek-reasoner" and thinking_budget:
            extra_body = payload.setdefault("extra_body", {})
            extra_body["thinking"] = {"type": "enabled", "budget": int(thinking_budget)}

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
        reasoning_content = None

        if isinstance(choice, dict):
            if "message" in choice:
                message = choice["message"]
                content = message.get("content")
                # 提取思考链内容（如果存在）
                reasoning_content = message.get("reasoning_content")
            elif "content" in choice:
                content = choice.get("content")
            elif "output" in choice:
                content = choice["output"].get("content")

        # 如果有思考链内容，将其与最终回答合并
        final_text = _flatten_content(content)
        if reasoning_content:
            return f"思考过程：\n{reasoning_content}\n\n最终回答：\n{final_text}"
        return final_text


__all__ = ["DeepSeekChatProvider"]
