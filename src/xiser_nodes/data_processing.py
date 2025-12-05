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
from comfy_api.latest import io, ComfyExtension

# 自定义类型定义
KSamplerSettings = io.Custom("XIS_KSAMPLER_SETTINGS")

class XIS_PackImages(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="XIS_PackImages",
            display_name="Pack Images",
            category="XISER_Nodes/Data_Processing",
            inputs=[
                io.Boolean.Input("invert_mask", default=False),
                io.Boolean.Input("before_pack_images", default=False),
                io.Image.Input("pack_images_input", optional=True),
                io.Image.Input("image1", optional=True),
                io.Mask.Input("mask1", optional=True),
                io.Image.Input("image2", optional=True),
                io.Mask.Input("mask2", optional=True),
                io.Image.Input("image3", optional=True),
                io.Mask.Input("mask3", optional=True),
                io.Image.Input("image4", optional=True),
                io.Mask.Input("mask4", optional=True),
                io.Image.Input("image5", optional=True),
                io.Mask.Input("mask5", optional=True),
            ],
            outputs=[
                # 显式标记为列表输出，避免下游误判为单张 IMAGE
                io.Image.Output("pack_images", display_name="pack_images"),
            ],
        )

    @classmethod
    def execute(cls, invert_mask, before_pack_images, pack_images_input=None, image1=None, mask1=None,
                image2=None, mask2=None, image3=None, mask3=None, image4=None, mask4=None,
                image5=None, mask5=None):

        def normalize_image_tensor(t: torch.Tensor) -> List[torch.Tensor]:
            """Convert incoming tensor to one or more HWC RGBA float images."""
            out: List[torch.Tensor] = []
            if t.dim() == 4:
                # Possible NHWC batch or NCHW batch
                if t.shape[1] in (3, 4) and t.shape[-1] not in (3, 4):
                    # Assume NCHW
                    t = t.permute(0, 2, 3, 1)
                for i in range(t.shape[0]):
                    out.extend(normalize_image_tensor(t[i]))
                return out

            if t.dim() != 3:
                logger.error(f"Invalid pack_images_input tensor dimensions: {t.shape}")
                return out

            img = t
            # Move to float [0,1]
            if not torch.is_floating_point(img):
                img = img.float()
            if img.max() > 1.0:
                img = img / 255.0
            img = img.clamp(0.0, 1.0)

            # Ensure channels last
            if img.shape[-1] not in (3, 4) and img.shape[0] in (3, 4):
                img = img.permute(1, 2, 0)

            # Ensure RGBA
            if img.shape[-1] == 3:
                alpha = torch.ones_like(img[..., :1])
                img = torch.cat([img, alpha], dim=-1)
            elif img.shape[-1] != 4:
                logger.error(f"Invalid channels in pack_images_input tensor: {img.shape[-1]}")
                return out

            out.append(img)
            return out

        def append_from_pack_input(obj):
            """Normalize objects coming from pack_images_input."""
            if obj is None:
                return
            if isinstance(obj, torch.Tensor):
                normalized_images.extend(normalize_image_tensor(obj))
            elif isinstance(obj, np.ndarray):
                normalized_images.extend(normalize_image_tensor(torch.from_numpy(obj)))
            else:
                logger.error(f"Invalid pack_images_input item type: {type(obj)}")

        # 收集当前节点的图像和蒙版输入
        input_images = [image1, image2, image3, image4, image5]
        input_masks = [mask1, mask2, mask3, mask4, mask5]
        image_mask_pairs = [
            (img, input_masks[idx])
            for idx, img in enumerate(input_images)
            if img is not None
        ]

        # 检查是否有有效的图像输入
        if not image_mask_pairs and (pack_images_input is None or not pack_images_input):
            logger.error("No valid images provided (all image inputs and pack_images_input are None)")
            raise ValueError("At least one valid image must be provided")

        # 初始化输出图像列表
        normalized_images = []

        # 根据 before_pack_images 的值决定添加顺序
        if not before_pack_images:
            # 默认行为：pack_images_input 在前，image1 到 image5 在后
            if pack_images_input is not None:
                    # 支持直接传递张量或列表/元组
                if isinstance(pack_images_input, (list, tuple)):
                    for item in pack_images_input:
                        append_from_pack_input(item)
                else:
                    append_from_pack_input(pack_images_input)

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

        # 如果 before_pack_images 为 True，将 pack_images_input 添加到末尾
        if before_pack_images and pack_images_input is not None:
            if isinstance(pack_images_input, (list, tuple)):
                for item in pack_images_input:
                    append_from_pack_input(item)
            else:
                append_from_pack_input(pack_images_input)

        # 防御：确保最终有有效图像，避免下游收到空列表
        if len(normalized_images) == 0:
            logger.error("XIS_PackImages produced no valid images after processing inputs")
            raise ValueError("No valid images produced in XIS_PackImages")

        logger.info(f"Packed {len(normalized_images)} images for canvas")
        return io.NodeOutput(normalized_images)


class XIS_UnpackImages(io.ComfyNode):
    """
    将 pack_images 数据还原成列表 IMAGE。
    - image_list: 原始的图像列表（每张为 HWC RGBA 张量）
    """

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="XIS_UnpackImages",
            display_name="Unpack Images",
            category="XISER_Nodes/Data_Processing",
            inputs=[
                io.Image.Input("pack_images", optional=True),
            ],
            outputs=[
                # 标记为列表输出，PreviewImage 等普通 IMAGE 输入会自动按元素映射
                io.Image.Output("image_list", display_name="image_list", is_output_list=True),
            ],
        )

    @classmethod
    def execute(cls, pack_images: Optional[List[torch.Tensor]] = None):
        """v1-aligned unpack: keep original sizes for image_list, build a batched tensor."""

        def _unwrap_v3_data(data):
            if data is None:
                return None
            if hasattr(data, "outputs") and isinstance(getattr(data, "outputs"), tuple):
                return data.outputs[0]
            if isinstance(data, tuple) and len(data) == 1:
                return data[0]
            return data

        # Flatten and normalize incoming data to a simple list of HWC tensors.
        def _collect(obj, out: List[torch.Tensor]):
            if obj is None:
                return
            obj = _unwrap_v3_data(obj)
            if obj is None:
                return
            # Handle common (image_list, image_batch) tuple forwarded from upstream
            if (
                isinstance(obj, (list, tuple))
                and len(obj) == 2
                and isinstance(obj[0], (list, tuple))
                and isinstance(obj[1], torch.Tensor)
            ):
                _collect(obj[0], out)
                return
            if isinstance(obj, torch.Tensor):
                if obj.dim() == 4:
                    for i in range(obj.shape[0]):
                        out.append(obj[i])
                elif obj.dim() == 3:
                    out.append(obj)
                else:
                    logger.debug(f"Skipping tensor with unsupported dims: {obj.shape}")
                return
            if isinstance(obj, np.ndarray):
                _collect(torch.from_numpy(obj), out)
                return
            if isinstance(obj, (list, tuple)):
                for sub in obj:
                    _collect(sub, out)
                return
            logger.debug(f"Skipping non-tensor pack_images item: {type(obj)}")

        flattened: List[torch.Tensor] = []
        _collect(pack_images, flattened)

        if len(flattened) == 0:
            logger.warning("XIS_UnpackImages received empty pack_images input")
            return io.NodeOutput([])

        original_images: List[torch.Tensor] = []
        processed_images: List[torch.Tensor] = []

        for idx, img in enumerate(flattened):
            # Normalize value range and channel order; stay in HWC.
            if not torch.is_floating_point(img):
                img = img.float()
            if img.max() > 1.0:
                img = img / 255.0
            img = img.clamp(0, 1)

            if img.dim() == 3 and img.shape[0] in (3, 4) and img.shape[-1] not in (3, 4):
                img = img.permute(1, 2, 0)

            if img.dim() != 3:
                logger.warning(f"pack_images[{idx}] skipped: invalid shape {img.shape}, expected (H, W, C)")
                continue

            if img.shape[-1] not in (3, 4):
                logger.warning(f"pack_images[{idx}] skipped: invalid channel count {img.shape[-1]}, expected 3 or 4")
                continue

            if img.shape[-1] == 3:
                alpha = torch.ones_like(img[..., :1])
                img = torch.cat([img, alpha], dim=-1)

            original_images.append(img)
            processed_images.append(img)

        if len(processed_images) == 0:
            logger.warning("XIS_UnpackImages found no valid images after filtering pack_images")
            return io.NodeOutput([])

        image_list = processed_images  # 只输出有效图片；is_output_list=True 会由框架打包列表

        return io.NodeOutput(image_list)


class XIS_MergePackImages(io.ComfyNode):
    """A custom node to merge up to 5 pack_images inputs into a single pack_images output."""

    def __init__(self):
        """Initialize the node instance."""
        self.instance_id = uuid.uuid4().hex
        logger.info(f"Instance {self.instance_id} - XIS_MergePackImages initialized")

    @classmethod
    def define_schema(cls):
        """Define the v3 schema for the MergePackImages node."""
        return io.Schema(
            node_id="XIS_MergePackImages",
            display_name="Merge Pack Images",
            category="XISER_Nodes/Data_Processing",
            inputs=[
                io.Image.Input("pack_images_1", optional=True),
                io.Image.Input("pack_images_2", optional=True),
                io.Image.Input("pack_images_3", optional=True),
                io.Image.Input("pack_images_4", optional=True),
                io.Image.Input("pack_images_5", optional=True),
            ],
            outputs=[
                io.Image.Output("pack_images", display_name="pack_images", is_output_list=True),
            ],
        )

    @classmethod
    def execute(
        cls,
        pack_images_1: Optional[List[torch.Tensor]] = None,
        pack_images_2: Optional[List[torch.Tensor]] = None,
        pack_images_3: Optional[List[torch.Tensor]] = None,
        pack_images_4: Optional[List[torch.Tensor]] = None,
        pack_images_5: Optional[List[torch.Tensor]] = None,
    ):
        """
        Merge multiple pack_images inputs into a single pack_images output.

        Args:
            pack_images_1 to pack_images_5: Optional list of torch.Tensor, each of shape [H, W, 4] (RGBA).

        Returns:
            A tuple containing:
            - List of merged torch.Tensor images (IMAGE).
        """
        logger.debug(f"XIS_MergePackImages - Merging pack_images inputs")

        # 收集所有非空输入
        input_packs = [
            (i + 1, pack) for i, pack in enumerate([pack_images_1, pack_images_2, pack_images_3, pack_images_4, pack_images_5])
            if pack is not None and isinstance(pack, list) and pack
        ]

        if not input_packs:
            logger.info(f"XIS_MergePackImages - No valid pack_images inputs provided, returning empty outputs")
            return io.NodeOutput([])

        # 验证输入格式并收集图像
        merged_images = []
        image_sizes = []
        for port_idx, pack in input_packs:
            if not all(isinstance(img, torch.Tensor) for img in pack):
                logger.error(f"XIS_MergePackImages - Invalid image type in pack_images_{port_idx}: expected list of torch.Tensor")
                raise ValueError(f"pack_images_{port_idx} must contain torch.Tensor images")
            for j, img in enumerate(pack):
                if len(img.shape) != 3 or img.shape[-1] != 4:
                    logger.error(f"XIS_MergePackImages - Invalid shape for image {j} in pack_images_{port_idx}: expected [H, W, 4], got {img.shape}")
                    raise ValueError(f"Image {j} in pack_images_{port_idx} must be [H, W, 4] (RGBA)")
                merged_images.append(img)
                image_sizes.append(img.shape[:2])  # Record [H, W]
                logger.debug(f"XIS_MergePackImages - Added image {j} from pack_images_{port_idx} with size {img.shape[:2]}")

        if not merged_images:
            logger.info(f"XIS_MergePackImages - No images after validation, returning empty outputs")
            return io.NodeOutput([])

        return io.NodeOutput(merged_images)

    @staticmethod
    def IS_CHANGED(
        pack_images_1: Optional[List[torch.Tensor]] = None,
        pack_images_2: Optional[List[torch.Tensor]] = None,
        pack_images_3: Optional[List[torch.Tensor]] = None,
        pack_images_4: Optional[List[torch.Tensor]] = None,
        pack_images_5: Optional[List[torch.Tensor]] = None,
    ) -> str:
        """Compute a hash to detect changes in inputs."""
        logger.debug(f"IS_CHANGED called for XIS_MergePackImages")
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
            logger.debug(f"IS_CHANGED returning hash: {hash_value}")
            return hash_value
        except Exception as e:
            logger.error(f"IS_CHANGED failed: {e}")
            return str(time.time())

# K采样器设置打包节点
class XIS_KSamplerSettingsNode(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        sampler_options = comfy.samplers.SAMPLER_NAMES
        scheduler_options = comfy.samplers.SCHEDULER_NAMES

        return io.Schema(
            node_id="XIS_KSamplerSettingsNode",
            display_name="KSampler Settings",
            category="XISER_Nodes/Data_Processing",
            inputs=[
                io.Int.Input("steps", default=20, min=0, max=100, step=1),
                io.Float.Input("cfg", default=7.5, min=0.0, max=15.0, step=0.1),
                io.Float.Input("denoise", default=1.0, min=0.0, max=1.0, step=0.01),
                io.Combo.Input("sampler_name", default="euler", options=sampler_options),
                io.Combo.Input("scheduler", default="normal", options=scheduler_options),
                io.Int.Input("start_step", default=0, min=0, max=10000, step=1),
                io.Int.Input("end_step", default=20, min=1, max=10000, step=1),
                io.Model.Input("model", optional=True),
                io.Vae.Input("vae", optional=True),
                io.Clip.Input("clip", optional=True),
            ],
            outputs=[
                KSamplerSettings.Output("settings_pack", display_name="settings_pack"),
            ],
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


class XIS_KSamplerSettingsUnpackNode(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        sampler_options = comfy.samplers.SAMPLER_NAMES
        scheduler_options = comfy.samplers.SCHEDULER_NAMES

        return io.Schema(
            node_id="XIS_KSamplerSettingsUnpackNode",
            display_name="KSampler Settings Unpack",
            category="XISER_Nodes/Data_Processing",
            inputs=[
                KSamplerSettings.Input("settings_pack"),
            ],
            outputs=[
                io.Model.Output("model", display_name="model"),
                io.Vae.Output("vae", display_name="vae"),
                io.Clip.Output("clip", display_name="clip"),
                io.Int.Output("steps", display_name="steps"),
                io.Float.Output("cfg", display_name="cfg"),
                io.Float.Output("denoise", display_name="denoise"),
                io.String.Output("sampler_name", display_name="sampler_name"),
                io.String.Output("scheduler", display_name="scheduler"),
                io.Int.Output("start_step", display_name="start_step"),
                io.Int.Output("end_step", display_name="end_step"),
            ],
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


class XIS_UnpackImages(io.ComfyNode):
    """
    将 pack_images 数据还原成列表和批量 IMAGE。
    - image_list: 原始的图像列表（每张为 HWC RGBA 张量）
    - image_batch: 规范化尺寸后的批量张量 (N, H, W, 4)，会根据首张图尺寸自动调整其他图尺寸
    """

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="XIS_UnpackImages",
            display_name="Unpack Images",
            category="XISER_Nodes/Data_Processing",
            inputs=[
                io.Image.Input("pack_images", optional=True),
            ],
            outputs=[
                io.Image.Output("image_list", display_name="image_list", is_output_list=True),
                io.Image.Output("image_batch", display_name="image_batch"),
            ],
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




class XISDataProcessingExtension(ComfyExtension):
    async def get_node_list(self):
        return [
            XIS_PackImages,
            XIS_MergePackImages,
            XIS_KSamplerSettingsNode,
            XIS_KSamplerSettingsUnpackNode,
            XIS_UnpackImages,
        ]


async def comfy_entrypoint():
    return XISDataProcessingExtension()
