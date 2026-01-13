# V3版本的Data Processing节点
# 将多个图像和蒙版打包成一个 IMAGE 对象
import torch
import torch.nn.functional as F
import numpy as np
from typing import Optional, Tuple, Union, List
from .utils import standardize_tensor, hex_to_rgb, resize_tensor, INTERPOLATION_MODES, logger
import hashlib
import uuid
import time
import comfy.samplers
from comfy_api.v0_0_2 import io, ui

class XIS_PackImagesV3(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="XIS_PackImages",
            display_name="Pack Images",
            category="XISER_Nodes/Data_Processing",
            description="将多个图像和蒙版打包成一个IMAGE对象",
            inputs=[
                io.Boolean.Input("invert_mask",
                    default=False,
                    display_name="Invert Mask",
                    tooltip="是否反转蒙版"
                ),
                io.Boolean.Input("before_pack_images",
                    default=False,
                    display_name="Pack Images Position",
                    tooltip="pack_images输入的位置（True=在前，False=在后）"
                ),
                io.Image.Input("pack_images",
                    optional=True,
                    tooltip="已有的pack_images输入"
                ),
                io.Image.Input("image1",
                    optional=True,
                    tooltip="图像1输入"
                ),
                io.Mask.Input("mask1",
                    optional=True,
                    tooltip="蒙版1输入"
                ),
                io.Image.Input("image2",
                    optional=True,
                    tooltip="图像2输入"
                ),
                io.Mask.Input("mask2",
                    optional=True,
                    tooltip="蒙版2输入"
                ),
                io.Image.Input("image3",
                    optional=True,
                    tooltip="图像3输入"
                ),
                io.Mask.Input("mask3",
                    optional=True,
                    tooltip="蒙版3输入"
                ),
                io.Image.Input("image4",
                    optional=True,
                    tooltip="图像4输入"
                ),
                io.Mask.Input("mask4",
                    optional=True,
                    tooltip="蒙版4输入"
                ),
                io.Image.Input("image5",
                    optional=True,
                    tooltip="图像5输入"
                ),
                io.Mask.Input("mask5",
                    optional=True,
                    tooltip="蒙版5输入"
                )
            ],
            outputs=[
                io.Image.Output(display_name="pack_images")
            ]
        )

    @classmethod
    def execute(cls, invert_mask, before_pack_images, pack_images=None, image1=None, mask1=None,
                image2=None, mask2=None, image3=None, mask3=None, image4=None, mask4=None,
                image5=None, mask5=None):

        # 收集当前节点的图像和蒙版输入
        input_images = [image1, image2, image3, image4, image5]
        input_masks = [mask1, mask2, mask3, mask4, mask5]
        image_mask_pairs = [
            (img, input_masks[idx])
            for idx, img in enumerate(input_images)
            if img is not None
        ]

        # 检查是否有有效的图像输入
        if not image_mask_pairs and (pack_images is None or not pack_images):
            logger.error("No valid images provided (all image inputs and pack_images are None)")
            raise ValueError("At least one valid image must be provided")

        # 初始化输出图像列表
        normalized_images = []

        # 根据 before_pack_images 的值决定添加顺序
        if not before_pack_images:
            # 默认行为：pack_images 在前，image1 到 image5 在后
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

        logger.info(f"Packed {len(normalized_images)} images for canvas")
        return io.NodeOutput(normalized_images)


class XIS_UnpackImagesV3(io.ComfyNode):
    """
    将 pack_images 数据还原成列表和批量 IMAGE。
    - image_list: 原始的图像列表（每张为 HWC RGBA 张量）
    - image_batch: 规范化尺寸后的批量张量 (N, H, W, 4)，会根据首张图尺寸自动调整其他图尺寸
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="XIS_UnpackImages",
            display_name="Unpack Images",
            category="XISER_Nodes/Data_Processing",
            description="将pack_images数据还原成列表和批量IMAGE",
            inputs=[
                io.Image.Input("pack_images",
                    optional=True,
                    tooltip="输入的pack_images数据"
                )
            ],
            outputs=[
                io.Image.Output(display_name="image_list", is_output_list=True),
                io.Image.Output(display_name="image_batch", is_output_list=False)
            ]
        )

    @classmethod
    def execute(cls, pack_images: Optional[List[torch.Tensor]] = None):
        if pack_images is None or not isinstance(pack_images, list) or len(pack_images) == 0:
            logger.warning("XIS_UnpackImages received empty pack_images input")
            return io.NodeOutput([], torch.empty(0, 0, 0, 4))

        original_images: List[torch.Tensor] = []  # HWC RGBA, keep original sizes
        processed_images: List[torch.Tensor] = []  # HWC RGBA for batching

        for idx, img in enumerate(pack_images):
            if not isinstance(img, torch.Tensor):
                logger.error(f"pack_images[{idx}] is not a torch.Tensor: {type(img)}")
                raise ValueError("All pack_images items must be torch.Tensor")
            if len(img.shape) != 3:
                logger.error(f"pack_images[{idx}] has invalid shape {img.shape}, expected (H, W, C)")
                raise ValueError("Each pack_images item must be a 3D tensor (H, W, C)")
            if img.shape[-1] not in (3, 4):
                logger.error(f"pack_images[{idx}] has invalid channel count {img.shape[-1]}, expected 3 or 4")
                raise ValueError("Each pack_images item must have 3 or 4 channels")

            # 保证 RGBA
            if img.shape[-1] == 3:
                alpha = torch.ones_like(img[..., :1])
                img = torch.cat([img, alpha], dim=-1)

            original_images.append(img)
            processed_images.append(img)

        # 构建批量张量，自动调整到首张图尺寸
        target_h, target_w = processed_images[0].shape[:2]
        batch_tensors: List[torch.Tensor] = []
        for idx, img in enumerate(processed_images):
            if img.shape[0] != target_h or img.shape[1] != target_w:
                logger.info(f"Resizing image {idx} from {img.shape[:2]} to {(target_h, target_w)} for batching")
                resized = F.interpolate(
                    img.permute(2, 0, 1).unsqueeze(0),
                    size=(target_h, target_w),
                    mode="bilinear",
                    align_corners=False,
                ).squeeze(0).permute(1, 2, 0)
                batch_tensors.append(resized)
            else:
                batch_tensors.append(img)

        image_batch = torch.stack(batch_tensors, dim=0)
        image_list = [img.unsqueeze(0) for img in original_images]  # each element is a 1-batch IMAGE like MakeImageList
        return io.NodeOutput(image_list, image_batch)

    @classmethod
    def fingerprint_inputs(cls, pack_images: Optional[List[torch.Tensor]] = None) -> str:
        """Lightweight hash to detect changes in pack_images."""
        hasher = hashlib.sha256()
        if pack_images is None or not isinstance(pack_images, list) or len(pack_images) == 0:
            hasher.update("empty".encode("utf-8"))
            return hasher.hexdigest()

        hasher.update(f"len:{len(pack_images)}".encode("utf-8"))
        for idx, img in enumerate(pack_images):
            if isinstance(img, torch.Tensor):
                hasher.update(f"{idx}:{tuple(img.shape)}:{img.dtype}".encode("utf-8"))
                if img.numel() > 0:
                    sample = img.flatten()[:100].cpu().numpy().tobytes()
                    hasher.update(sample)
            else:
                hasher.update(f"{idx}:invalid".encode("utf-8"))
        return hasher.hexdigest()


class XIS_MergePackImagesV3(io.ComfyNode):
    """A custom node to merge up to 5 pack_images inputs into a single pack_images output."""

    @classmethod
    def define_schema(cls) -> io.Schema:
        """Define input types for the node, matching XIS_ImageManager's data type."""
        return io.Schema(
            node_id="XIS_MergePackImages",
            display_name="Merge Pack Images",
            category="XISER_Nodes/Data_Processing",
            description="合并多个pack_images输入为一个输出",
            inputs=[
                io.Image.Input("pack_images_1",
                    optional=True,
                    tooltip="pack_images输入1"
                ),
                io.Image.Input("pack_images_2",
                    optional=True,
                    tooltip="pack_images输入2"
                ),
                io.Image.Input("pack_images_3",
                    optional=True,
                    tooltip="pack_images输入3"
                ),
                io.Image.Input("pack_images_4",
                    optional=True,
                    tooltip="pack_images输入4"
                ),
                io.Image.Input("pack_images_5",
                    optional=True,
                    tooltip="pack_images输入5"
                )
            ],
            outputs=[
                io.Image.Output(display_name="pack_images")
            ],
            is_output_node=True
        )

    @classmethod
    def execute(cls, pack_images_1: Optional[List[torch.Tensor]] = None,
                pack_images_2: Optional[List[torch.Tensor]] = None,
                pack_images_3: Optional[List[torch.Tensor]] = None,
                pack_images_4: Optional[List[torch.Tensor]] = None,
                pack_images_5: Optional[List[torch.Tensor]] = None):
        """
        Merge multiple pack_images inputs into a single pack_images output.

        Args:
            pack_images_1 to pack_images_5: Optional list of torch.Tensor, each of shape [H, W, 4] (RGBA).

        Returns:
            A tuple containing:
            - List of merged torch.Tensor images (IMAGE).
        """
        logger.debug("XIS_MergePackImages - Merging pack_images inputs")

        # 收集所有非空输入
        input_packs = [
            (i + 1, pack) for i, pack in enumerate([pack_images_1, pack_images_2, pack_images_3, pack_images_4, pack_images_5])
            if pack is not None and isinstance(pack, list) and pack
        ]

        if not input_packs:
            logger.info("XIS_MergePackImages - No valid pack_images inputs provided, returning empty outputs")
            return io.NodeOutput([])

        # 验证输入格式并收集图像
        merged_images = []
        for port_idx, pack in input_packs:
            if not all(isinstance(img, torch.Tensor) for img in pack):
                logger.error(f"Invalid image type in pack_images_{port_idx}: expected list of torch.Tensor")
                raise ValueError(f"pack_images_{port_idx} must contain torch.Tensor images")
            for j, img in enumerate(pack):
                if len(img.shape) != 3 or img.shape[-1] != 4:
                    logger.error(f"Invalid shape for image {j} in pack_images_{port_idx}: expected [H, W, 4], got {img.shape}")
                    raise ValueError(f"Image {j} in pack_images_{port_idx} must be [H, W, 4] (RGBA)")
                merged_images.append(img)
                logger.debug(f"Added image {j} from pack_images_{port_idx} with size {img.shape[:2]}")

        if not merged_images:
            logger.info("XIS_MergePackImages - No images after validation, returning empty outputs")
            return io.NodeOutput([])

        return io.NodeOutput(merged_images)

    @classmethod
    def fingerprint_inputs(cls, pack_images_1: Optional[List[torch.Tensor]] = None,
                          pack_images_2: Optional[List[torch.Tensor]] = None,
                          pack_images_3: Optional[List[torch.Tensor]] = None,
                          pack_images_4: Optional[List[torch.Tensor]] = None,
                          pack_images_5: Optional[List[torch.Tensor]] = None) -> str:
        """Compute a hash to detect changes in inputs."""
        logger.debug("fingerprint_inputs called for XIS_MergePackImages")
        try:
            hasher = hashlib.sha256()
            for i, pack in enumerate([pack_images_1, pack_images_2, pack_images_3, pack_images_4, pack_images_5], 1):
                if pack is None or not pack:
                    hasher.update(f"pack_images_{i}_empty".encode('utf-8'))
                    continue
                if not isinstance(pack, list):
                    logger.warning(f"Invalid pack_images_{i} type: {type(pack)}")
                    hasher.update(f"pack_images_{i}_invalid_{id(pack)}".encode('utf-8'))
                    continue
                hasher.update(f"pack_images_{i}_len_{len(pack)}".encode('utf-8'))
                for j, img in enumerate(pack):
                    if isinstance(img, torch.Tensor):
                        hasher.update(str(img.shape).encode('utf-8'))
                        sample_data = img.cpu().numpy().flatten()[:100].tobytes()
                        hasher.update(sample_data)
                    else:
                        logger.warning(f"Invalid image type at index {j} in pack_images_{i}: {type(img)}")
                        hasher.update(f"img_{j}_invalid_{id(img)}".encode('utf-8'))
            hash_value = hasher.hexdigest()
            logger.debug(f"fingerprint_inputs returning hash: {hash_value}")
            return hash_value
        except Exception as e:
            logger.error(f"fingerprint_inputs failed: {e}")
            return str(time.time())


# K采样器设置打包节点
class XIS_KSamplerSettingsNodeV3(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        sampler_options = comfy.samplers.SAMPLER_NAMES
        scheduler_options = comfy.samplers.SCHEDULER_NAMES

        return io.Schema(
            node_id="XIS_KSamplerSettingsNode",
            display_name="KSampler Settings Node",
            category="XISER_Nodes/Data_Processing",
            description="打包K采样器设置参数",
            inputs=[
                io.Int.Input("steps",
                    default=20,
                    min=0,
                    max=100,
                    step=1,
                    display_mode=io.NumberDisplay.slider,
                    tooltip="采样步数"
                ),
                io.Float.Input("cfg",
                    default=7.5,
                    min=0.0,
                    max=15.0,
                    step=0.1,
                    display_mode=io.NumberDisplay.slider,
                    tooltip="CFG缩放因子"
                ),
                io.Float.Input("denoise",
                    default=1.0,
                    min=0.0,
                    max=1.0,
                    step=0.01,
                    display_mode=io.NumberDisplay.slider,
                    tooltip="去噪强度"
                ),
                io.Combo.Input("sampler_name",
                    options=sampler_options,
                    default="euler",
                    tooltip="采样器名称"
                ),
                io.Combo.Input("scheduler",
                    options=scheduler_options,
                    default="normal",
                    tooltip="调度器名称"
                ),
                io.Int.Input("start_step",
                    default=0,
                    min=0,
                    max=10000,
                    step=1,
                    display_mode=io.NumberDisplay.number,
                    tooltip="起始步数"
                ),
                io.Int.Input("end_step",
                    default=20,
                    min=1,
                    max=10000,
                    step=1,
                    display_mode=io.NumberDisplay.number,
                    tooltip="结束步数"
                ),
                io.Model.Input("model",
                    optional=True,
                    tooltip="模型输入"
                ),
                io.Vae.Input("vae",
                    optional=True,
                    tooltip="VAE输入"
                ),
                io.Clip.Input("clip",
                    optional=True,
                    tooltip="CLIP输入"
                )
            ],
            outputs=[
                io.Custom("DICT").Output(display_name="settings_pack")
            ]
        )

    @classmethod
    def execute(cls, steps, cfg, denoise, sampler_name, scheduler, start_step, end_step, model=None, vae=None, clip=None):
        if end_step <= start_step:
            end_step = start_step + 1

        settings_pack = {
            "model": model,
            "vae": vae,
            "clip": clip,
            "steps": steps,
            "cfg": cfg,
            "denoise": denoise,
            "sampler_name": sampler_name,
            "scheduler": scheduler,
            "start_step": start_step,
            "end_step": end_step
        }

        return io.NodeOutput(settings_pack)


class XIS_KSamplerSettingsUnpackNodeV3(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="XIS_KSamplerSettingsUnpackNode",
            display_name="KSampler Settings Unpack Node",
            category="XISER_Nodes/Data_Processing",
            description="解包K采样器设置参数",
            inputs=[
                io.Custom("DICT").Input("settings_pack",
                    tooltip="设置参数包"
                )
            ],
            outputs=[
                io.Model.Output(display_name="model"),
                io.Vae.Output(display_name="vae"),
                io.Clip.Output(display_name="clip"),
                io.Int.Output(display_name="steps"),
                io.Float.Output(display_name="cfg"),
                io.Float.Output(display_name="denoise"),
                io.Custom(comfy.samplers.KSampler.SAMPLERS).Output(display_name="sampler_name"),
                io.Custom(comfy.samplers.KSampler.SCHEDULERS).Output(display_name="scheduler"),
                io.Int.Output(display_name="start_step"),
                io.Int.Output(display_name="end_step")
            ]
        )

    @classmethod
    def execute(cls, settings_pack):
        model = settings_pack.get("model")
        vae = settings_pack.get("vae")
        clip = settings_pack.get("clip")
        steps = settings_pack.get("steps", 20)
        cfg = settings_pack.get("cfg", 7.5)
        denoise = settings_pack.get("denoise", 1.0)
        sampler_name = settings_pack.get("sampler_name", "euler")
        scheduler = settings_pack.get("scheduler", "normal")
        start_step = settings_pack.get("start_step", 0)
        end_step = settings_pack.get("end_step", 20)

        if end_step <= start_step:
            end_step = start_step + 1

        return io.NodeOutput(model, vae, clip, steps, cfg, denoise, sampler_name, scheduler, start_step, end_step)


# V3节点类列表
V3_NODE_CLASSES = [
    XIS_PackImagesV3,
    XIS_UnpackImagesV3,
    XIS_MergePackImagesV3,
    XIS_KSamplerSettingsNodeV3,
    XIS_KSamplerSettingsUnpackNodeV3,
]