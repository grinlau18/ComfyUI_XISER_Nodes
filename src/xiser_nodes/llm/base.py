"""Shared utilities and base classes for LLM providers."""

from __future__ import annotations

import base64
import io
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple, Union

import numpy as np
import requests
import torch
from PIL import Image

from ..utils import logger


def _ensure_batch(tensor: torch.Tensor) -> torch.Tensor:
    """Normalize IMAGE tensors to [N, H, W, C]."""

    if tensor is None:
        return tensor
    if not isinstance(tensor, torch.Tensor):
        raise TypeError(f"Expected torch.Tensor, received {type(tensor)}")
    if tensor.dim() == 3:
        return tensor.unsqueeze(0)
    if tensor.dim() == 4:
        return tensor
    raise ValueError(f"Unsupported tensor dimensions: {tensor.shape}")


def _to_uint8(image: torch.Tensor) -> np.ndarray:
    """Convert a single image tensor into a uint8 numpy array."""

    img = image.detach().cpu().float().clamp(0, 1)
    img_np = (img * 255.0).round().byte().numpy()
    if img_np.shape[-1] not in (3, 4):
        raise ValueError(f"Unsupported channel count: {img_np.shape[-1]}")
    return img_np


def _download_image_to_tensor(url: str) -> Optional[torch.Tensor]:
    try:
        img_resp = requests.get(url, timeout=30)
        img_resp.raise_for_status()
        pil_img = Image.open(io.BytesIO(img_resp.content)).convert("RGB")
        img_np = np.array(pil_img, dtype=np.float32) / 255.0
        img_np = np.ascontiguousarray(img_np)
        tensor = torch.from_numpy(img_np)
        return tensor.unsqueeze(0)  # [1, H, W, C]
    except Exception as exc:  # noqa
        logger.error(f"Failed to fetch image from {url}: {exc}")
        return None


def _image_to_base64(image: torch.Tensor) -> str:
    """Encode a tensor image to a PNG base64 string."""

    img_np = _to_uint8(image)
    mode = "RGBA" if img_np.shape[-1] == 4 else "RGB"
    pil_img = Image.fromarray(img_np, mode=mode)
    buffer = io.BytesIO()
    pil_img.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


def _gather_images(image: Optional[Union[torch.Tensor, Iterable]], pack_images: Optional[Sequence]) -> List[torch.Tensor]:
    """Collect image tensors from IMAGE and pack_images inputs."""

    gathered: List[torch.Tensor] = []

    def _add_any(obj):
        if obj is None:
            return
        if isinstance(obj, torch.Tensor):
            for img in _ensure_batch(obj):
                gathered.append(img)
            return
        if isinstance(obj, Iterable):
            for item in obj:
                _add_any(item)
            return
        raise TypeError(f"pack_images/image entries must be torch.Tensor; got {type(obj)}")

    _add_any(image)
    _add_any(pack_images)

    return gathered


def _image_to_data_url(image: torch.Tensor) -> str:
    """Encode tensor to data URL (PNG)."""
    img_np = _to_uint8(image)
    mode = "RGBA" if img_np.shape[-1] == 4 else "RGB"
    pil_img = Image.fromarray(img_np, mode=mode)
    buffer = io.BytesIO()
    pil_img.save(buffer, format="PNG")
    b64 = base64.b64encode(buffer.getvalue()).decode("utf-8")
    return f"data:image/png;base64,{b64}"


def _image_to_data_url_from_b64(b64_str: str) -> str:
    """Wrap a bare base64 PNG string into a data URL. If already a data URL, return as-is."""
    if b64_str.startswith("data:image"):
        return b64_str
    return f"data:image/png;base64,{b64_str}"


@dataclass
class LLMProviderConfig:
    name: str
    label: str
    endpoint: str
    model: str
    default_system_prompt: str
    timeout: float = 60.0
    max_images: int = 4
    request_format: str = "openai_chat"
    default_params: Dict[str, Any] = field(default_factory=dict)
    extra_headers: Dict[str, str] = field(default_factory=dict)


class BaseLLMProvider(ABC):
    """Abstract provider interface."""

    def __init__(self, config: LLMProviderConfig):
        self.config = config

    @abstractmethod
    def build_payload(
        self, user_prompt: str, image_payloads: List[str], overrides: Dict[str, Any]
    ) -> Tuple[str, Dict[str, Any], Dict[str, str]]:
        ...

    def _build_headers(self, api_key: str) -> Dict[str, str]:
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        headers.update(self.config.extra_headers)
        return headers

    def invoke(self, user_prompt: str, image_payloads: List[str], api_key: str, overrides: Optional[Dict[str, Any]] = None, progress_callback: Optional[callable] = None) -> Dict[str, Any]:
        if not api_key:
            raise ValueError("API Key is required")
        overrides = overrides or {}
        endpoint, payload, extra_headers = self.build_payload(user_prompt, image_payloads, overrides)
        headers = self._build_headers(api_key)
        headers.update(extra_headers)

        # 进度：连接阶段
        if progress_callback:
            progress_callback("连接", 0.3)

        response = requests.post(
            endpoint,
            headers=headers,
            json=payload,
            timeout=self.config.timeout,
        )
        response.raise_for_status()

        # 进度：连接完成
        if progress_callback:
            progress_callback("连接", 1.0)

        return response.json()

    @abstractmethod
    def extract_text(self, response: Dict[str, Any]) -> str:
        ...

    def extract_images(self, response: Dict[str, Any]) -> List[torch.Tensor]:
        return []

    def extract_image_urls(self, response: Dict[str, Any]) -> List[str]:
        return []


__all__ = [
    "BaseLLMProvider",
    "LLMProviderConfig",
    "_download_image_to_tensor",
    "_gather_images",
    "_image_to_base64",
    "_image_to_data_url",
    "_image_to_data_url_from_b64",
]
