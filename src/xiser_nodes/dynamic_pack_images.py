# 动态打包图像节点 - 支持动态数量的image/mask输入对
import torch
import torch.nn.functional as F
import numpy as np
from typing import Optional, Tuple, Union, List
from .utils import standardize_tensor, hex_to_rgb, resize_tensor, INTERPOLATION_MODES, logger
import hashlib
import uuid
import time
import comfy.samplers

class XIS_DynamicPackImages:
    MAX_PAIRS = 20  # 最大支持20对image/mask输入

    @classmethod
    def INPUT_TYPES(cls):
        """
        定义动态输入类型
        初始只提供一对image/mask输入，前端会根据连接状态动态添加更多对
        """
        return {
            "required": {
                "invert_mask": ("BOOLEAN", {"default": False, "label_on": "Invert", "label_off": "Normal"}),
                "before_pack_images": ("BOOLEAN", {"default": False, "label_on": "on", "label_off": "off"}),
            },
            "optional": {
                "pack_images": ("IMAGE", {"default": None}),
                "image_1": ("IMAGE", {"default": None}),
                "mask_1": ("MASK", {"default": None}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("pack_images",)
    FUNCTION = "pack_images"
    CATEGORY = "XISER_Nodes/Data_Processing"

    def pack_images(self, invert_mask, before_pack_images, **kwargs):
        """
        处理动态图像和蒙版输入，打包成pack_images数据

        Args:
            invert_mask: 是否反转蒙版
            before_pack_images: pack_images输入的位置（前/后）
            **kwargs: 动态生成的image_n和mask_n参数

        Returns:
            tuple: 包含打包图像列表的元组
        """
        # 从kwargs中获取pack_images（如果有）
        pack_images = kwargs.get('pack_images')

        # 收集所有动态的image/mask对
        image_mask_pairs = []

        # 按编号收集所有有效的image/mask对
        for i in range(1, self.MAX_PAIRS + 1):
            img_key = f"image_{i}"
            mask_key = f"mask_{i}"

            if img_key in kwargs:
                img = kwargs[img_key]
                mask = kwargs.get(mask_key)  # mask可能为None

                if img is not None:
                    image_mask_pairs.append((img, mask))

        # 检查是否有有效的图像输入
        if not image_mask_pairs and (pack_images is None or not pack_images):
            logger.error("No valid images provided (all image inputs and pack_images are None)")
            raise ValueError("At least one valid image must be provided")

        # 初始化输出图像列表
        normalized_images = []

        # 根据 before_pack_images 的值决定添加顺序
        if not before_pack_images:
            # 默认行为：pack_images 在前，动态image/mask对在后
            if pack_images is not None:
                if not isinstance(pack_images, (list, tuple)):
                    logger.error(f"Invalid pack_images type: expected list or tuple, got {type(pack_images)}")
                    raise ValueError("pack_images must be a list or tuple")
                normalized_images.extend(pack_images)

        # 规范化当前节点的图像和蒙版
        for img, mask in image_mask_pairs:
            if not isinstance(img, torch.Tensor):
                logger.error(f"Invalid image type: expected torch.Tensor, got {type(img)}")
                raise ValueError("All images must be torch.Tensor")

            # 确保图像维度正确
            if len(img.shape) == 3:  # (H, W, C)
                img = img.unsqueeze(0)  # 转换为 (1, H, W, C)
            elif len(img.shape) != 4:  # (N, H, W, C)
                logger.error(f"Invalid image dimensions: {img.shape}")
                raise ValueError(f"Image has invalid dimensions: {img.shape}")

            # 处理每个批次中的图像
            for i in range(img.shape[0]):
                single_img = img[i]  # (H, W, C)

                # 处理蒙版
                alpha = None
                if mask is not None:
                    if not isinstance(mask, torch.Tensor):
                        logger.error(f"Invalid mask type: expected torch.Tensor, got {type(mask)}")
                        raise ValueError("Mask must be torch.Tensor")

                    # 确保蒙版维度正确
                    mask_dim = len(mask.shape)
                    if mask_dim == 2:  # (H, W)
                        mask = mask.unsqueeze(0)  # 转换为 (1, H, W)
                    elif mask_dim == 3:  # (N, H, W)
                        pass
                    else:
                        logger.error(f"Invalid mask dimensions: {mask.shape}")
                        raise ValueError(f"Mask has invalid dimensions: {mask.shape}")

                    # 获取对应批次的蒙版
                    single_mask = mask[i] if mask.shape[0] > i else mask[0]

                    # 检查是否为 64x64 全 0 蒙版
                    if single_mask.shape == (64, 64) and torch.all(single_mask == 0):
                        alpha = None  # 视为无蒙版输入
                    else:
                        # 自动调整蒙版尺寸以匹配图像尺寸（除非是 64x64 全 0）
                        if single_mask.shape != single_img.shape[:2]:
                            logger.info(f"Resizing mask from {single_mask.shape} to match image size {single_img.shape[:2]}")
                            # 使用双线性插值调整蒙版尺寸
                            single_mask = F.interpolate(
                                single_mask.unsqueeze(0).unsqueeze(0),  # 转换为 (1, 1, H, W)
                                size=single_img.shape[:2],
                                mode='bilinear',
                                align_corners=False
                            ).squeeze(0).squeeze(0)  # 转换回 (H, W)

                        # 规范化蒙版为单通道
                        alpha = single_mask.unsqueeze(-1)  # (H, W, 1)
                        if alpha.max() > 1.0 or alpha.min() < 0.0:
                            alpha = (alpha - alpha.min()) / (alpha.max() - alpha.min() + 1e-8)  # 归一化到 [0,1]

                        # 如果 invert_mask 为 True，进行蒙版反转
                        if invert_mask:
                            alpha = 1.0 - alpha

                # 处理图像通道
                if single_img.shape[-1] == 3:  # RGB
                    if alpha is None:
                        alpha = torch.ones_like(single_img[..., :1])  # 默认全 1 Alpha 通道
                    single_img = torch.cat([single_img, alpha], dim=-1)  # 转换为 RGBA
                elif single_img.shape[-1] == 4:  # RGBA
                    if alpha is not None:
                        # 替换 Alpha 通道
                        single_img = torch.cat([single_img[..., :3], alpha], dim=-1)
                else:
                    logger.error(f"Image has invalid channels: {single_img.shape[-1]}")
                    raise ValueError(f"Image has invalid channels: {single_img.shape[-1]}")

                normalized_images.append(single_img)

        # 如果 before_pack_images 为 True，将 pack_images 添加到末尾
        if before_pack_images and pack_images is not None:
            if not isinstance(pack_images, (list, tuple)):
                logger.error(f"Invalid pack_images type: expected list or tuple, got {type(pack_images)}")
                raise ValueError("pack_images must be a list or tuple")
            normalized_images.extend(pack_images)

        logger.info(f"DynamicPackImages: Packed {len(normalized_images)} images (from {len(image_mask_pairs)} image/mask pairs)")
        return (normalized_images,)


# 节点映射
NODE_CLASS_MAPPINGS = {
    "XIS_DynamicPackImages": XIS_DynamicPackImages,
}

# 节点显示名称映射（可选）
NODE_DISPLAY_NAME_MAPPINGS = {
    "XIS_DynamicPackImages": "XIS Dynamic Pack Images",
}