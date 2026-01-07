"""
XIS_ImageAdjustAndBlend V3 版本

ComfyUI 节点，用于调整图像的亮度、对比度、饱和度、色相、RGB 通道和透明度，支持蒙版和背景图。
V3 架构迁移版本。
"""

import os
import uuid
import torch
import numpy as np
from PIL import Image, ImageEnhance
import folder_paths
import logging
import torch.nn.functional as F

# 使用稳定的 V3 API 版本（删除前端ui导入）
from comfy_api.v0_0_2 import io

# 导入统一的调节工具模块
from .adjustment_utils import AdjustmentUtils, create_adjustment_slider_config
from .adjustment_algorithms import AdjustmentAlgorithms

# 设置日志
logger = logging.getLogger("XIS_ImageAdjustAndBlend")


class XIS_ImageAdjustAndBlendV3(io.ComfyNode):
    """
    ComfyUI 节点，用于调整图像的亮度、对比度、饱和度、色相、RGB 通道和透明度，支持蒙版和背景图。
    V3 架构版本。
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        """
        定义节点的 V3 架构。

        Returns:
            io.Schema: V3 架构对象。
        """
        # 使用统一的调节参数配置
        adjustment_config = create_adjustment_slider_config()

        # 提取配置参数（adjustment_config返回的是元组("FLOAT", dict)）
        brightness_config = adjustment_config["brightness"][1]
        contrast_config = adjustment_config["contrast"][1]
        saturation_config = adjustment_config["saturation"][1]

        return io.Schema(
            node_id="XIS_ImageAdjustAndBlend",
            display_name="Image Adjust and Blend",
            category="XISER_Nodes/Image_And_Mask",
            description="调整图像的亮度、对比度、饱和度、色相、RGB通道和透明度，支持蒙版抠图和背景图合并。",
            inputs=[
                io.Image.Input("image", tooltip="输入图像"),
                io.Float.Input("brightness",
                             default=brightness_config["default"],
                             min=brightness_config["min"],
                             max=brightness_config["max"],
                             step=brightness_config["step"],
                             display_mode=io.NumberDisplay.slider,
                             tooltip="亮度调整值（-1.0 到 1.0，0.0 为原始亮度）"),
                io.Float.Input("contrast",
                             default=contrast_config["default"],
                             min=contrast_config["min"],
                             max=contrast_config["max"],
                             step=contrast_config["step"],
                             display_mode=io.NumberDisplay.slider,
                             tooltip="对比度调整值（-100 到 100，0.0 为原始对比度）"),
                io.Float.Input("saturation",
                             default=saturation_config["default"],
                             min=saturation_config["min"],
                             max=saturation_config["max"],
                             step=saturation_config["step"],
                             display_mode=io.NumberDisplay.slider,
                             tooltip="饱和度调整值（-100 到 100，0.0 为原始饱和度）"),
                io.Float.Input("hue",
                             default=0.0,
                             min=-0.5,
                             max=0.5,
                             step=0.01,
                             display_mode=io.NumberDisplay.slider,
                             tooltip="色相调整因子（-0.5 到 0.5）"),
                io.Float.Input("r_gain",
                             default=1.0,
                             min=0.0,
                             max=2.0,
                             step=0.01,
                             display_mode=io.NumberDisplay.slider,
                             tooltip="红色通道增益（0.0 到 2.0）"),
                io.Float.Input("g_gain",
                             default=1.0,
                             min=0.0,
                             max=2.0,
                             step=0.01,
                             display_mode=io.NumberDisplay.slider,
                             tooltip="绿色通道增益（0.0 到 2.0）"),
                io.Float.Input("b_gain",
                             default=1.0,
                             min=0.0,
                             max=2.0,
                             step=0.01,
                             display_mode=io.NumberDisplay.slider,
                             tooltip="蓝色通道增益（0.0 到 2.0）"),
                io.Float.Input("opacity",
                             default=1.0,
                             min=0.0,
                             max=1.0,
                             step=0.01,
                             display_mode=io.NumberDisplay.slider,
                             tooltip="透明度因子（0.0 完全透明，1.0 不透明）"),
                io.Mask.Input("mask",
                            optional=True,
                            tooltip="单通道蒙版，用于抠图"),
                io.Image.Input("background_image",
                             optional=True,
                             tooltip="背景图像，用于合并"),
                io.Combo.Input("blend_mode",
                             options=["normal", "overlay", "screen", "add", "multiply", "soft_light", "hard_light"],
                             default="normal",
                             tooltip="混合模式")
            ],
            outputs=[
                io.Image.Output(display_name="adjusted_image"),
                io.String.Output(display_name="image_paths")
            ],
            is_output_node=True  # 对应 V1 的 OUTPUT_NODE = True
        )

    @classmethod
    def execute(cls, image, brightness=0.0, contrast=0.0, saturation=0.0, hue=0.0,
               r_gain=1.0, g_gain=1.0, b_gain=1.0, opacity=1.0,
               mask=None, background_image=None, blend_mode="normal") -> io.NodeOutput:
        """
        调整图像的亮度、对比度、饱和度、色相、RGB 通道和透明度，支持蒙版抠图和背景图合并。
        使用统一的调节参数范围，确保与Canvas节点一致。

        Args:
            image (torch.Tensor): 输入图像张量，形状为 (B, H, W, C)。
            brightness (float): 亮度调整值（-1.0 到 1.0，0.0 为原始亮度）。
            contrast (float): 对比度调整值（-100 到 100，0.0 为原始对比度）。
            saturation (float): 饱和度调整值（-100 到 100，0.0 为原始饱和度）。
            hue (float): 色相调整因子（-0.5 到 0.5）。
            r_gain (float): 红色通道增益（0.0 到 2.0）。
            g_gain (float): 绿色通道增益（0.0 到 2.0）。
            b_gain (float): 蓝色通道增益（0.0 到 2.0）。
            opacity (float): 透明度因子（0.0 完全透明，1.0 不透明）。
            mask (torch.Tensor, optional): 单通道蒙版，形状为 (B, H, W, 1)。
            background_image (torch.Tensor, optional): 背景图像，形状为 (B, H, W, C)。
            blend_mode (str): 混合模式

        Returns:
            io.NodeOutput: 包含调整后的图像和保存的图像路径
        """
        try:
            # 创建实例以访问实例方法
            instance = cls._create_instance()

            # 处理批次图像
            batch_size = image.shape[0]
            output_images = []
            output_filenames = []

            logger.info(f"Processing batch of {batch_size} images, input shape: {image.shape}")

            for i in range(batch_size):
                # 将 torch.Tensor 转换为 PIL.Image
                image_np = image[i].cpu().numpy()
                logger.info(f"Image {i} numpy shape: {image_np.shape}, range: [{image_np.min():.3f}, {image_np.max():.3f}]")
                image_np = (image_np * 255).astype(np.uint8)
                pil_image = Image.fromarray(image_np, mode="RGB")
                image_size = pil_image.size  # (width, height)

                # 处理蒙版
                pil_mask = None
                if mask is not None:
                    mask_idx = min(i, mask.shape[0] - 1)  # 使用对应的蒙版或最后一个
                    mask_np = mask[mask_idx].cpu().numpy()
                    # 调整蒙版大小与图像一致
                    if mask_np.shape[:2] != image_np.shape[:2]:
                        mask_np = F.interpolate(
                            torch.from_numpy(mask_np)[None, None, ...],
                            size=image_np.shape[:2],
                            mode="nearest"
                        )[0, 0].numpy()
                    # 转换为 8 位灰度
                    mask_np = (mask_np * 255).astype(np.uint8)
                    pil_mask = Image.fromarray(mask_np, mode="L")
                    # 应用蒙版，转换为 RGBA
                    pil_image = pil_image.convert("RGBA")
                    pil_image.putalpha(pil_mask)

                # 调整背景图大小
                pil_background = None
                if background_image is not None:
                    bg_idx = min(i, background_image.shape[0] - 1)  # 使用对应的背景图或最后一个
                    bg_np = background_image[bg_idx].cpu().numpy()
                    bg_np = (bg_np * 255).astype(np.uint8)
                    pil_background = Image.fromarray(bg_np, mode="RGB")
                    if pil_background.size != image_size:
                        pil_background = pil_background.resize(image_size, Image.BILINEAR)

                # 应用亮度、对比度、饱和度调整（使用统一的调节算法）
                # 注意：这里需要将contrast和saturation从百分比转换为因子
                # 对于contrast：0表示无变化，需要转换为1.0
                # 对于saturation：0表示无变化，需要转换为1.0

                # 首先应用亮度、对比度、饱和度
                if abs(brightness) > 0.001 or abs(contrast) > 0.001 or abs(saturation) > 0.001:
                    # 使用统一的调节算法
                    pil_image = AdjustmentAlgorithms.apply_adjustments(
                        pil_image,
                        brightness=brightness,
                        contrast=contrast,
                        saturation=saturation
                    )
                    if pil_mask is not None:
                        pil_image = pil_image.convert("RGBA")
                        pil_image.putalpha(pil_mask)

                if hue != 0:
                    pil_image = pil_image.convert("HSV")
                    h, s, v = pil_image.split()
                    h_np = np.array(h).astype(np.float32)
                    h_np = (h_np + hue * 255) % 255
                    h = Image.fromarray(h_np.astype(np.uint8))
                    pil_image = Image.merge("HSV", (h, s, v)).convert("RGB")
                    if pil_mask is not None:
                        pil_image = pil_image.convert("RGBA")
                        pil_image.putalpha(pil_mask)

                if r_gain != 1.0 or g_gain != 1.0 or b_gain != 1.0:
                    r, g, b = pil_image.convert("RGB").split()
                    r = Image.fromarray((np.array(r) * r_gain).clip(0, 255).astype(np.uint8))
                    g = Image.fromarray((np.array(g) * g_gain).clip(0, 255).astype(np.uint8))
                    b = Image.fromarray((np.array(b) * b_gain).clip(0, 255).astype(np.uint8))
                    pil_image = Image.merge("RGB", (r, g, b))
                    if pil_mask is not None:
                        pil_image = pil_image.convert("RGBA")
                        pil_image.putalpha(pil_mask)

                # 应用透明度
                if opacity < 1.0 or pil_mask is not None:
                    if pil_image.mode != "RGBA":
                        pil_image = pil_image.convert("RGBA")
                    if pil_mask is None:
                        pil_mask = Image.new("L", image_size, 255)
                    # 使用统一的透明度处理
                    alpha_np = np.array(pil_mask).astype(np.float32) * opacity
                    alpha_np = np.clip(alpha_np, 0, 255).astype(np.uint8)
                    pil_image.putalpha(Image.fromarray(alpha_np, mode="L"))

                # 合并背景图
                if pil_background is not None:
                    if pil_image.mode != "RGBA":
                        pil_image = pil_image.convert("RGBA")
                    pil_background = pil_background.convert("RGBA")

                    # 应用混合模式
                    if blend_mode != "normal":
                        pil_image = instance._apply_blend_mode(pil_background, pil_image, blend_mode)
                    else:
                        pil_image = Image.alpha_composite(pil_background, pil_image)

                    pil_image = pil_image.convert("RGB")  # 最终输出为 RGB

                # 保存调整后的图像
                filename = f"xis_image_adjust_and_blend_{uuid.uuid4().hex}.png"
                filepath = os.path.join(instance.output_dir, filename)
                pil_image.save(filepath, format="PNG")
                logger.info(f"Image {i+1}/{batch_size} saved to: {filepath}, mode: {pil_image.mode}, size: {pil_image.size}")

                # 转换为 torch.Tensor 输出
                output_image = np.array(pil_image).astype(np.float32) / 255.0
                output_images.append(torch.from_numpy(output_image).unsqueeze(0))  # Add batch dimension
                output_filenames.append(filename)

            # 合并所有处理后的图像
            output_image = torch.cat(output_images, dim=0)

            # 清理旧文件
            instance._clean_old_files()

            # 返回 V3 格式的输出（删除前端预览）
            return io.NodeOutput(
                output_image,
                ",".join(output_filenames)
            )

        except Exception as e:
            logger.error(f"Image adjustment failed: {str(e)}")
            raise

    @classmethod
    def _create_instance(cls):
        """创建节点实例以访问实例方法"""
        # V3 架构中，ComfyNode 实例不可变，但我们可以创建一个简单的实例来访问实例方法
        class Instance:
            def __init__(self):
                self.output_dir = os.path.join(folder_paths.get_output_directory(), "xis_nodes_cached", "xis_image_adjust_and_blend")
                os.makedirs(self.output_dir, exist_ok=True)

            # 定义实例方法，直接调用静态方法
            def _apply_blend_mode(self, background, foreground, blend_mode):
                return cls._apply_blend_mode(background, foreground, blend_mode)

            def _clean_old_files(self, max_files=50):
                return cls._clean_old_files(max_files)

        return Instance()

    @staticmethod
    def _apply_blend_mode(background, foreground, blend_mode):
        """
        应用混合模式到前景图像。

        Args:
            background (PIL.Image): 背景图像
            foreground (PIL.Image): 前景图像
            blend_mode (str): 混合模式

        Returns:
            PIL.Image: 混合后的图像
        """
        bg_np = np.array(background).astype(np.float32) / 255.0
        fg_np = np.array(foreground).astype(np.float32) / 255.0

        # 分离RGB和Alpha通道
        bg_rgb = bg_np[..., :3]
        bg_alpha = bg_np[..., 3:]
        fg_rgb = fg_np[..., :3]
        fg_alpha = fg_np[..., 3:]

        # 应用混合模式
        if blend_mode == "overlay":
            # Overlay: 根据背景亮度选择 multiply 或 screen
            result = np.where(bg_rgb < 0.5, 2 * bg_rgb * fg_rgb, 1 - 2 * (1 - bg_rgb) * (1 - fg_rgb))
        elif blend_mode == "screen":
            # Screen: 1 - (1 - A) * (1 - B)
            result = 1 - (1 - bg_rgb) * (1 - fg_rgb)
        elif blend_mode == "add":
            # Add: A + B
            result = bg_rgb + fg_rgb
        elif blend_mode == "multiply":
            # Multiply: A * B
            result = bg_rgb * fg_rgb
        elif blend_mode == "soft_light":
            # Soft Light: (1 - 2*B) * A^2 + 2*B*A
            result = (1 - 2 * fg_rgb) * bg_rgb**2 + 2 * fg_rgb * bg_rgb
        elif blend_mode == "hard_light":
            # Hard Light: 根据前景亮度选择 multiply 或 screen
            result = np.where(fg_rgb < 0.5, 2 * bg_rgb * fg_rgb, 1 - 2 * (1 - bg_rgb) * (1 - fg_rgb))
        else:
            # Normal: 直接使用前景
            result = fg_rgb

        # 限制范围并重新组合Alpha通道
        result = np.clip(result, 0, 1)
        result_rgba = np.concatenate([result, fg_alpha], axis=-1)

        return Image.fromarray((result_rgba * 255).astype(np.uint8), mode="RGBA")

    @staticmethod
    def _clean_old_files(max_files=50):
        """
        清理旧的缓存文件，限制最大文件数量。

        Args:
            max_files (int): 最大缓存文件数量。
        """
        # 获取输出目录
        output_dir = os.path.join(folder_paths.get_output_directory(), "xis_nodes_cached", "xis_image_adjust_and_blend")
        os.makedirs(output_dir, exist_ok=True)

        files = [f for f in os.listdir(output_dir) if f.startswith("xis_image_adjust_and_blend_")]
        if len(files) > max_files:
            files.sort(key=lambda x: os.path.getmtime(os.path.join(output_dir, x)))
            for file in files[:len(files) - max_files]:
                try:
                    os.remove(os.path.join(output_dir, file))
                    logger.info(f"Deleted old file: {file}")
                except Exception as e:
                    logger.warning(f"Failed to delete file {file}: {str(e)}")


# V3 节点导出
V3_NODE_CLASSES = [XIS_ImageAdjustAndBlendV3]