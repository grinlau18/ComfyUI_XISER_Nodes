import torch
import torch.nn.functional as F
import numpy as np
from PIL import Image
import logging
from typing import Optional, Tuple

# 设置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("XISER_Nodes")

def hex_to_rgb(hex_str: str, device: str = "cpu") -> torch.Tensor:
    """
    将HEX颜色转换为RGB张量（0-1范围）。

    Args:
        hex_str (str): HEX颜色代码，例如 "#RRGGBB"。
        device (str): 张量设备，默认为 "cpu"。

    Returns:
        torch.Tensor: RGB张量，形状为 [3]，值在 [0, 1]。
    """
    hex_str = hex_str.lstrip('#')
    if len(hex_str) != 6:
        raise ValueError("HEX color must be in #RRGGBB format")
    return torch.tensor([int(hex_str[i:i+2], 16) / 255.0 for i in (0, 2, 4)], dtype=torch.float32, device=device)

def standardize_tensor(tensor: Optional[torch.Tensor], expected_dims: int = 4, is_image: bool = False) -> Optional[torch.Tensor]:
    """
    标准化张量维度，确保符合预期格式，并统一值域。

    Args:
        tensor (torch.Tensor, optional): 输入张量。
        expected_dims (int): 期望的维度数，默认为 4。
        is_image (bool): 是否为图像张量（影响通道数）。

    Returns:
        torch.Tensor: 标准化后的张量，或 None（如果输入为 None）。
    """
    if tensor is None:
        return None
    current_dims = tensor.dim()
    if current_dims == expected_dims:
        if not is_image and tensor.max() > 1.0:
            tensor = tensor / 255.0
        return tensor.clamp(0, 1)
    if is_image and current_dims == 3:
        return tensor.unsqueeze(0)
    if not is_image and current_dims == 2:
        tensor = tensor.unsqueeze(0).unsqueeze(-1)
        if tensor.max() > 1.0:
            tensor = tensor / 255.0
        return tensor.clamp(0, 1)
    raise ValueError(f"Unexpected tensor dimensions: {tensor.shape}, expected {expected_dims}D")

def resize_tensor(tensor: torch.Tensor, size: Tuple[int, int], mode: str = "nearest") -> torch.Tensor:
    """
    调整张量尺寸，支持多种插值模式。

    Args:
        tensor (torch.Tensor): 输入张量，3D 或 4D。
        size (Tuple[int, int]): 目标尺寸 (height, width)。
        mode (str): 插值模式，例如 "nearest", "bilinear", "lanczos"。

    Returns:
        torch.Tensor: 调整后的张量。
    """
    if tensor.dim() not in (3, 4):
        raise ValueError(f"Tensor must be 3D or 4D, got {tensor.shape}")
    needs_squeeze = tensor.dim() == 3 and tensor.shape[-1] in (1, 3, 4)
    if needs_squeeze:
        tensor = tensor.unsqueeze(0)
    tensor_permuted = tensor.permute(0, 3, 1, 2)
    if mode == "lanczos":
        from torchvision.transforms.functional import resize
        resized = resize(tensor_permuted, size=list(size), interpolation=3, antialias=True)
    else:
        resized = F.interpolate(tensor_permuted, size=size, mode=mode, align_corners=False if mode in ["bilinear", "bicubic"] else None)
    output = resized.permute(0, 2, 3, 1)
    return output.squeeze(0) if needs_squeeze else output

INTERPOLATION_MODES = {
    "nearest": "nearest",
    "bilinear": "bilinear",
    "bicubic": "bicubic",
    "area": "area",
    "nearest_exact": "nearest-exact",
    "lanczos": "lanczos",
}