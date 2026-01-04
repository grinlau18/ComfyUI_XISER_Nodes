"""图像和蒙版处理节点 - V3版本"""

from comfy_api.v0_0_2 import io, ui
import torch
import torch.nn.functional as F
import numpy as np
from PIL import Image, ImageDraw
import cv2
import os
from typing import Optional, Tuple, Union, List
import math
from .utils import standardize_tensor, hex_to_rgb, resize_tensor, INTERPOLATION_MODES, logger

# ============================================================================
# 图像加载节点
# ============================================================================

class XIS_LoadImageV3(io.ComfyNode):
    """
    加载图像并生成蒙版。如果提供 MaskEditor 蒙版，则使用该蒙版；
    否则根据图像的 alpha 通道生成反向蒙版，或生成全 1 蒙版。
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点架构"""
        return io.Schema(
            node_id="XIS_LoadImage",
            display_name="Load Image",
            category="XISER_Nodes/Image_And_Mask",
            description="加载图像并生成蒙版",
            inputs=[
                io.String.Input("image",
                              default="",
                              multiline=False,
                              tooltip="图像文件路径"),
                io.Mask.Input("mask",
                            optional=True,
                            tooltip="可选的蒙版输入")
            ],
            outputs=[
                io.Image.Output(display_name="image"),
                io.Mask.Output(display_name="mask")
            ]
        )

    @classmethod
    def fingerprint_inputs(cls, **kwargs) -> float:
        """替代V1的IS_CHANGED"""
        image = kwargs.get("image", "")
        mask = kwargs.get("mask", None)

        change_id = 0.0
        if os.path.exists(image):
            change_id += os.path.getmtime(image)
        if mask is not None:
            change_id += hash(mask.cpu().numpy().tobytes())
        return change_id

    @classmethod
    def execute(cls, image: str, mask: Optional[torch.Tensor] = None) -> io.NodeOutput:
        """执行方法：加载图像并生成蒙版"""
        img = Image.open(image).convert("RGBA")
        image_np = np.array(img).astype(np.float32) / 255.0
        rgb = image_np[:, :, :3]
        alpha = image_np[:, :, 3]

        if mask is not None:
            output_mask = standardize_tensor(mask, expected_dims=3, is_image=False).squeeze(0)
        else:
            if np.any(alpha < 1.0):
                output_mask = 1.0 - alpha
            else:
                output_mask = np.ones_like(alpha)

        image_tensor = torch.from_numpy(rgb).permute(2, 0, 1).unsqueeze(0)
        mask_tensor = torch.from_numpy(output_mask).unsqueeze(0)
        return io.NodeOutput(image_tensor, mask_tensor)


# ============================================================================
# 缩放到可整除尺寸节点
# ============================================================================

class XIS_ResizeToDivisibleV3(io.ComfyNode):
    """将图片或蒙版缩放到最接近的可整除尺寸"""

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点架构"""
        return io.Schema(
            node_id="XIS_ResizeToDivisible",
            display_name="Resize To Divisible",
            category="XISER_Nodes/Image_And_Mask",
            description="将图片或蒙版缩放到最接近的可整除尺寸",
            inputs=[
                io.Int.Input("divisor",
                           default=64,
                           min=1,
                           max=1024,
                           step=1,
                           tooltip="除数"),
                io.Image.Input("image",
                             optional=True,
                             tooltip="输入图像"),
                io.Mask.Input("mask",
                            optional=True,
                            tooltip="输入蒙版")
            ],
            outputs=[
                io.Image.Output(display_name="image_output"),
                io.Mask.Output(display_name="mask_output")
            ]
        )

    @classmethod
    def execute(cls, divisor: int, image: Optional[torch.Tensor] = None,
                mask: Optional[torch.Tensor] = None) -> io.NodeOutput:
        """执行方法：缩放到可整除尺寸"""
        if image is None and mask is None:
            return io.NodeOutput(None, None)

        image_output = cls._resize_tensor(image, divisor, is_image=True) if image is not None else None
        mask_output = cls._resize_tensor(mask, divisor, is_image=False) if mask is not None else None

        return io.NodeOutput(image_output, mask_output)

    @classmethod
    def _resize_tensor(cls, tensor, divisor, is_image=False):
        """内部方法：调整张量尺寸"""
        if not is_image and tensor.dim() == 2:
            tensor = tensor.unsqueeze(0)
        batch, height, width = tensor.shape[:3]
        channels = tensor.shape[3] if is_image else 1

        target_height = cls._nearest_divisible(height, divisor)
        target_width = cls._nearest_divisible(width, divisor)
        tensor_permuted = tensor.permute(0, 3, 1, 2) if is_image else tensor.unsqueeze(1)
        tensor_resized = F.interpolate(tensor_permuted, size=(target_height, target_width), mode="nearest")
        output = tensor_resized.permute(0, 2, 3, 1) if is_image else tensor_resized.squeeze(1)

        return output.squeeze(0) if not is_image and tensor.dim() == 2 else output

    @classmethod
    def _nearest_divisible(cls, value, divisor):
        """找到最接近的可整除值"""
        quotient = value // divisor
        lower = quotient * divisor
        upper = (quotient + 1) * divisor
        return lower if abs(value - lower) < abs(value - upper) else upper


# ============================================================================
# 图像裁剪节点
# ============================================================================

class XIS_CropImageV3(io.ComfyNode):
    """使用蒙版去底并裁剪，支持蒙版反转和背景颜色填充"""

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点架构"""
        return io.Schema(
            node_id="XIS_CropImage",
            display_name="Crop Image",
            category="XISER_Nodes/Image_And_Mask",
            description="使用蒙版去底并裁剪，支持蒙版反转和背景颜色填充",
            inputs=[
                io.Image.Input("image",
                             tooltip="输入图像"),
                io.Mask.Input("mask",
                            optional=True,
                            tooltip="输入蒙版"),
                io.Boolean.Input("invert_mask",
                               default=False,
                               tooltip="是否反转蒙版"),
                io.String.Input("background_color",
                              default="#000000",
                              tooltip="背景颜色（HEX格式）"),
                io.Int.Input("padding_width",
                           default=0,
                           min=0,
                           max=1024,
                           step=1,
                           tooltip="填充宽度")
            ],
            outputs=[
                io.Image.Output(display_name="cropped_image")
            ]
        )

    @classmethod
    def execute(cls, image: torch.Tensor, mask: Optional[torch.Tensor] = None,
                invert_mask: bool = False, background_color: str = "#000000",
                padding_width: int = 0) -> io.NodeOutput:
        """执行方法：裁剪图像"""
        image = image[0]  # [H, W, C]
        device = image.device

        # 如果 mask 为 None，直接返回原始图像
        if mask is None:
            return io.NodeOutput(image.unsqueeze(0))

        # 确保 mask 是张量且有正确的维度
        if not torch.is_tensor(mask) or mask.ndim == 0:
            return io.NodeOutput(image.unsqueeze(0))

        mask = mask[0]  # [H, W]

        # 标准化蒙版值域到 [0, 1]
        mask = mask.to(device=device, dtype=torch.float32)
        if mask.max() > 1.0:
            mask = mask / 255.0
        mask = mask.clamp(0, 1)

        # 调整蒙版尺寸以匹配图像
        if mask.shape != image.shape[:2]:
            # 确保 mask 是 4D 格式 [N, C, H, W]
            if mask.ndim == 2:  # [H, W]
                mask = mask.unsqueeze(0).unsqueeze(0)  # 转为 [1, 1, H, W]
            elif mask.ndim == 3:  # [C, H, W] 或其他意外格式
                mask = mask.unsqueeze(0)  # 转为 [1, C, H, W]

            mask = F.interpolate(
                mask,
                size=image.shape[:2],
                mode="bilinear",
                antialias=True
            ).squeeze(0).squeeze(0)  # 回到 [H, W]

        # 反转蒙版（如果需要）
        if invert_mask:
            mask = 1 - mask

        # 检查蒙版是否全为 0 或全为 1
        mask_sum = mask.sum()
        if mask_sum == 0:  # 全为 0，返回纯色背景
            rgb_color = cls.hex_to_rgb(background_color).to(device)
            return io.NodeOutput(rgb_color.expand(1, *image.shape))
        elif mask_sum == mask.numel():  # 全为 1，返回原始图像
            return io.NodeOutput(image.unsqueeze(0))

        # 计算裁剪区域
        masked_image = image * mask.unsqueeze(-1)
        nonzero_coords = torch.nonzero(mask > 0, as_tuple=True)
        y_min, y_max = nonzero_coords[0].min(), nonzero_coords[0].max()
        x_min, x_max = nonzero_coords[1].min(), nonzero_coords[1].max()
        cropped_image = masked_image[y_min:y_max+1, x_min:x_max+1]  # [H_crop, W_crop, C]
        cropped_mask = mask[y_min:y_max+1, x_min:x_max+1]           # [H_crop, W_crop]

        # 应用蒙版并合成背景
        rgb_color = cls.hex_to_rgb(background_color).to(device)
        background = rgb_color.expand(*cropped_image.shape)
        output_image = cropped_image * cropped_mask.unsqueeze(-1) + background * (1 - cropped_mask.unsqueeze(-1))

        # 添加空白边框
        if padding_width > 0:
            h_crop, w_crop = output_image.shape[:2]
            new_h, new_w = h_crop + 2 * padding_width, w_crop + 2 * padding_width
            padded_image = torch.full((new_h, new_w, image.shape[-1]), 0.0, device=device, dtype=image.dtype)
            padded_image.copy_(rgb_color.expand(new_h, new_w, image.shape[-1]))
            padded_image[padding_width:padding_width+h_crop, padding_width:padding_width+w_crop] = output_image
            output_image = padded_image

        return io.NodeOutput(output_image.unsqueeze(0))

    @classmethod
    def hex_to_rgb(cls, hex_color):
        """HEX颜色转RGB张量"""
        hex_color = hex_color.lstrip('#')
        return torch.tensor([int(hex_color[i:i+2], 16) for i in (0, 2, 4)], dtype=torch.float32) / 255.0


# ============================================================================
# 蒙版反转节点
# ============================================================================

class XIS_InvertMaskV3(io.ComfyNode):
    """对输入的掩码进行反转处理"""

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点架构"""
        return io.Schema(
            node_id="XIS_InvertMask",
            display_name="Invert Mask",
            category="XISER_Nodes/Image_And_Mask",
            description="对输入的掩码进行反转处理",
            inputs=[
                io.Mask.Input("mask",
                            tooltip="输入蒙版"),
                io.Boolean.Input("invert",
                               default=True,
                               tooltip="是否反转"),
                io.Image.Input("image",
                             optional=True,
                             tooltip="参考图像")
            ],
            outputs=[
                io.Mask.Output(display_name="mask_output")
            ]
        )

    @classmethod
    def execute(cls, mask: torch.Tensor, invert: bool = True,
                image: Optional[torch.Tensor] = None) -> io.NodeOutput:
        """执行方法：反转蒙版"""
        mask = mask.to(dtype=torch.float32)
        is_all_zero = torch.all(mask == 0)
        is_0_to_1_range = mask.max() <= 1.0 and mask.max() > 0

        if is_all_zero and image is not None:
            mask_output = torch.ones_like(image[..., 0], dtype=torch.float32) if is_0_to_1_range else torch.full_like(image[..., 0], 255.0)
        else:
            mask_output = (1.0 - mask) if (invert and is_0_to_1_range) else (255.0 - mask) if invert else mask

        return io.NodeOutput(mask_output)


# ============================================================================
# 图像蒙版镜像翻转节点
# ============================================================================

class XIS_ImageMaskMirrorV3(io.ComfyNode):
    """对输入的图像和蒙版进行镜像翻转操作"""

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点架构"""
        return io.Schema(
            node_id="XIS_ImageMaskMirror",
            display_name="Image Mask Mirror",
            category="XISER_Nodes/Image_And_Mask",
            description="对输入的图像和蒙版进行镜像翻转操作",
            inputs=[
                io.Combo.Input("flip_axis",
                             options=["X", "Y"],
                             default="X",
                             tooltip="翻转轴"),
                io.Boolean.Input("enable_flip",
                               default=True,
                               tooltip="是否启用翻转"),
                io.Image.Input("image",
                             optional=True,
                             tooltip="输入图像"),
                io.Mask.Input("mask",
                            optional=True,
                            tooltip="输入蒙版")
            ],
            outputs=[
                io.Image.Output(display_name="image_output"),
                io.Mask.Output(display_name="mask_output")
            ]
        )

    @classmethod
    def execute(cls, flip_axis: str, enable_flip: bool = True,
                image: Optional[torch.Tensor] = None,
                mask: Optional[torch.Tensor] = None) -> io.NodeOutput:
        """执行方法：镜像翻转"""
        if image is None and mask is None:
            return io.NodeOutput(None, None)

        image_output = image.flip(2 if flip_axis == "X" else 1) if image is not None and enable_flip else image
        mask_output = None

        if mask is not None:
            mask_input = mask.unsqueeze(0) if mask.dim() == 2 else mask
            mask_output = mask_input.flip(2 if flip_axis == "X" else 1) if enable_flip else mask_input
            mask_output = mask_output.squeeze(0) if mask.dim() == 2 else mask_output

        return io.NodeOutput(image_output, mask_output)


# ============================================================================
# 图像蒙版组重排序节点
# ============================================================================

class XIS_ReorderImageMaskGroupsV3(io.ComfyNode):
    """重新对输入的图像和蒙版进行排序"""

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点架构"""
        return io.Schema(
            node_id="XIS_ReorderImageMaskGroups",
            display_name="Reorder Image Mask Groups",
            category="XISER_Nodes/Image_And_Mask",
            description="重新对输入的图像和蒙版进行排序",
            inputs=[
                io.Int.Input("insert_order",
                           default=1,
                           min=1,
                           max=5,
                           step=1,
                           tooltip="插入位置"),
                io.Image.Input("insert_image",
                             optional=True,
                             tooltip="插入图像"),
                io.Mask.Input("insert_mask",
                            optional=True,
                            tooltip="插入蒙版"),
                io.Image.Input("image_1",
                             optional=True,
                             tooltip="图像组1"),
                io.Mask.Input("mask_1",
                            optional=True,
                            tooltip="蒙版组1"),
                io.Image.Input("image_2",
                             optional=True,
                             tooltip="图像组2"),
                io.Mask.Input("mask_2",
                            optional=True,
                            tooltip="蒙版组2"),
                io.Image.Input("image_3",
                             optional=True,
                             tooltip="图像组3"),
                io.Mask.Input("mask_3",
                            optional=True,
                            tooltip="蒙版组3"),
                io.Image.Input("image_4",
                             optional=True,
                             tooltip="图像组4"),
                io.Mask.Input("mask_4",
                            optional=True,
                            tooltip="蒙版组4")
            ],
            outputs=[
                io.Image.Output(display_name="image_1"),
                io.Mask.Output(display_name="mask_1"),
                io.Image.Output(display_name="image_2"),
                io.Mask.Output(display_name="mask_2"),
                io.Image.Output(display_name="image_3"),
                io.Mask.Output(display_name="mask_3"),
                io.Image.Output(display_name="image_4"),
                io.Mask.Output(display_name="mask_4"),
                io.Image.Output(display_name="image_5"),
                io.Mask.Output(display_name="mask_5")
            ]
        )

    @classmethod
    def execute(cls, insert_order: int, insert_image: Optional[torch.Tensor] = None,
                insert_mask: Optional[torch.Tensor] = None, image_1: Optional[torch.Tensor] = None,
                mask_1: Optional[torch.Tensor] = None, image_2: Optional[torch.Tensor] = None,
                mask_2: Optional[torch.Tensor] = None, image_3: Optional[torch.Tensor] = None,
                mask_3: Optional[torch.Tensor] = None, image_4: Optional[torch.Tensor] = None,
                mask_4: Optional[torch.Tensor] = None) -> io.NodeOutput:
        """执行方法：重排序图像蒙版组"""
        # 将输入的四组原始数据放入列表，未连接的输入默认为 None
        images = [image_1, image_2, image_3, image_4]
        masks = [mask_1, mask_2, mask_3, mask_4]

        # 检查插入组是否为空（仅用于判断是否插入 None）
        insert_is_empty = insert_image is None

        # 根据 insert_order 调整顺序
        if insert_order == 1:
            # 插入组放在第一位，原有组顺序不变
            output_images = ([insert_image] if not insert_is_empty else [None]) + images
            output_masks = ([insert_mask] if not insert_is_empty else [None]) + masks
        else:
            # 插入组放在指定位置，前面的组前移，后面的组保持不变
            output_images = images[:insert_order-1] + ([insert_image] if not insert_is_empty else [None]) + images[insert_order-1:]
            output_masks = masks[:insert_order-1] + ([insert_mask] if not insert_is_empty else [None]) + masks[insert_order-1:]

        # 确保输出五组数据（截取前5组）
        output_images = output_images[:5]
        output_masks = output_masks[:5]

        # 直接返回调整后的五组 image 和 mask，不强制转换空值
        return io.NodeOutput(
            output_images[0], output_masks[0],
            output_images[1], output_masks[1],
            output_images[2], output_masks[2],
            output_images[3], output_masks[3],
            output_images[4], output_masks[4]
        )


# ============================================================================
# 蒙版复合操作节点
# ============================================================================

class XIS_MaskCompositeOperationV3(io.ComfyNode):
    """对输入的蒙版进行复合操作，支持多种操作类型"""

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点架构"""
        return io.Schema(
            node_id="XIS_MaskCompositeOperation",
            display_name="Mask Composite Operation",
            category="XISER_Nodes/Image_And_Mask",
            description="对输入的蒙版进行复合操作，支持多种操作类型",
            inputs=[
                io.Mask.Input("mask1",
                            tooltip="主蒙版"),
                io.Combo.Input("operation",
                             options=["add", "subtract", "intersect", "difference"],
                             default="add",
                             tooltip="操作类型"),
                io.Float.Input("blur_radius",
                             default=0.0,
                             min=0.0,
                             max=100.0,
                             step=0.1,
                             tooltip="模糊半径"),
                io.Float.Input("expand_shrink",
                             default=0.0,
                             min=-100.0,
                             max=100.0,
                             step=0.1,
                             tooltip="扩展/收缩量"),
                io.Boolean.Input("invert_mask",
                               default=False,
                               tooltip="是否反转蒙版"),
                io.String.Input("overlay_color",
                              default="#FF0000",
                              tooltip="叠加颜色（HEX格式）"),
                io.Float.Input("opacity",
                             default=0.5,
                             min=0.0,
                             max=1.0,
                             step=0.01,
                             tooltip="不透明度"),
                io.Mask.Input("mask2",
                            optional=True,
                            tooltip="次蒙版"),
                io.Image.Input("reference_image",
                             optional=True,
                             tooltip="参考图像")
            ],
            outputs=[
                io.Mask.Output(display_name="result_mask"),
                io.Image.Output(display_name="overlay_image")
            ]
        )

    @classmethod
    def execute(cls, mask1: torch.Tensor, operation: str, blur_radius: float,
                expand_shrink: float, invert_mask: bool, overlay_color: str,
                opacity: float, mask2: Optional[torch.Tensor] = None,
                reference_image: Optional[torch.Tensor] = None) -> io.NodeOutput:
        """执行方法：应用蒙版复合操作"""
        # 将 mask1 转换为 NumPy 数组并获取尺寸（保持浮点数）
        mask1_np = mask1.squeeze().cpu().numpy().astype(np.float32)
        mask1_height, mask1_width = mask1_np.shape

        # 处理 mask2
        mask2_is_empty = False
        if mask2 is not None:
            mask2_np = mask2.squeeze().cpu().numpy().astype(np.float32)
            if mask2_np.shape == (64, 64) and np.all(mask2_np == 0):
                mask2_is_empty = True
            else:
                if mask2_np.shape != mask1_np.shape:
                    mask2_pil = Image.fromarray((mask2_np * 255).astype(np.uint8))
                    mask2_pil = mask2_pil.resize((mask1_width, mask1_height), Image.LANCZOS)
                    mask2_np = np.array(mask2_pil).astype(np.float32) / 255.0

        # 执行蒙版操作（保持浮点数）
        if mask2 is not None and not mask2_is_empty:
            if operation == "add":
                result_np = np.clip(mask1_np + mask2_np, 0, 1)
            elif operation == "subtract":
                result_np = np.clip(mask1_np - mask2_np, 0, 1)
            elif operation == "intersect":
                result_np = np.minimum(mask1_np, mask2_np)
            elif operation == "difference":
                result_np = np.abs(mask1_np - mask2_np)
        else:
            result_np = mask1_np

        # 形态学操作
        if expand_shrink != 0:
            result_np = cls.morphological_operation(result_np, expand_shrink)
            result_np = np.clip(result_np, 0, 1)  # 确保范围

        # 模糊处理
        if blur_radius > 0:
            result_np = cv2.GaussianBlur(result_np, (0, 0), blur_radius, borderType=cv2.BORDER_REPLICATE)
            result_np = np.clip(result_np, 0, 1)  # 确保范围

        # 反向蒙版
        if invert_mask:
            result_np = 1.0 - result_np
            result_np = np.clip(result_np, 0, 1)  # 确保范围

        # 转换为 PyTorch 张量
        result_mask = torch.from_numpy(result_np).unsqueeze(0)

        # 生成叠加图像
        overlay_tensor = None
        if reference_image is not None:
            ref_img_np = reference_image[0].cpu().numpy()  # [H, W, C], 0-1 范围
            if ref_img_np.shape[:2] != (mask1_height, mask1_width):
                ref_img_pil = Image.fromarray((ref_img_np * 255).astype(np.uint8))
                ref_img_pil = ref_img_pil.resize((mask1_width, mask1_height), Image.LANCZOS)
                ref_img_np = np.array(ref_img_pil).astype(np.float32) / 255.0

            # 创建颜色层（0-1 范围）
            try:
                hex_color = overlay_color.lstrip('#').lower()  # 统一格式
                if len(hex_color) != 6:
                    raise ValueError("Invalid HEX color length")
                rgb = tuple(int(hex_color[i:i+2], 16) / 255.0 for i in (0, 2, 4))
            except (ValueError, IndexError):
                rgb = (1.0, 0.0, 0.0)  # 默认红色
                print(f"Warning: Invalid overlay_color '{overlay_color}', using default red")

            color_layer_np = np.full((mask1_height, mask1_width, 3), rgb, dtype=np.float32)

            # 使用浮点数掩码进行合成
            mask_3d = result_np[..., np.newaxis]  # [H, W, 1]
            overlay_np = (color_layer_np * mask_3d + ref_img_np * (1 - mask_3d)) * opacity + ref_img_np * (1 - opacity)
            overlay_np = np.clip(overlay_np, 0, 1)  # 确保范围

            overlay_tensor = torch.from_numpy(overlay_np).unsqueeze(0)
        else:
            overlay_tensor = torch.zeros_like(result_mask.unsqueeze(-1).expand(-1, -1, -1, 3))

        return io.NodeOutput(result_mask, overlay_tensor)

    @classmethod
    def morphological_operation(cls, np_image, amount):
        """使用 OpenCV 实现形态学操作，保持浮点数"""
        kernel_size = int(abs(amount) * 2 + 1)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))

        if amount > 0:
            processed = cv2.dilate(np_image, kernel, iterations=1, borderType=cv2.BORDER_REPLICATE)
        else:
            processed = cv2.erode(np_image, kernel, iterations=1, borderType=cv2.BORDER_REPLICATE)

        return processed  # 在调用处 clip


# ============================================================================
# 蒙版批量处理节点
# ============================================================================

class XIS_MaskBatchProcessorV3(io.ComfyNode):
    """批量处理蒙版，支持并集、交集、差集操作"""

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点架构"""
        return io.Schema(
            node_id="XIS_MaskBatchProcessor",
            display_name="Mask Batch Processor",
            category="XISER_Nodes/Image_And_Mask",
            description="批量处理蒙版，支持并集、交集、差集操作",
            inputs=[
                io.Mask.Input("masks",
                            tooltip="输入蒙版批次"),
                io.Combo.Input("operation",
                             options=["union", "intersection", "subtract"],
                             default="union",
                             tooltip="操作类型"),
                io.Boolean.Input("invert_output",
                               default=False,
                               tooltip="是否反转输出")
            ],
            outputs=[
                io.Mask.Output(display_name="processed_mask")
            ]
        )

    @classmethod
    def execute(cls, masks: torch.Tensor, operation: str,
                invert_output: bool = False) -> io.NodeOutput:
        """执行方法：批量处理蒙版"""
        # Ensure masks are in correct format (B, H, W)
        if masks.dim() == 4:
            masks = masks.squeeze(1)  # Convert (B, 1, H, W) to (B, H, W)

        # Convert to float32 for high precision
        masks = masks.to(torch.float32)

        # Clamp input masks to [0, 1] to ensure valid range
        masks = torch.clamp(masks, 0.0, 1.0)

        if masks.shape[0] == 0:
            raise ValueError("Empty mask batch received")

        if operation == "union":
            # Union: Take maximum across batch dimension
            result = torch.max(masks, dim=0)[0]

        elif operation == "intersection":
            # Intersection: Take minimum across batch dimension
            result = torch.min(masks, dim=0)[0]

        elif operation == "subtract":
            # Subtract: Start with first mask, subtract others
            result = masks[0].clone()
            for i in range(1, masks.shape[0]):
                result = result * (1.0 - masks[i])

        # Invert the result if requested
        if invert_output:
            result = 1.0 - result

        # Clamp result to [0, 1] to ensure valid mask values
        result = torch.clamp(result, 0.0, 1.0)

        # Add batch and channel dimensions for ComfyUI compatibility
        result = result.unsqueeze(0).unsqueeze(1)  # Shape: (1, 1, H, W)

        return io.NodeOutput(result)


# ============================================================================
# 图像合成处理器节点
# ============================================================================

class XIS_CompositorProcessorV3(io.ComfyNode):
    """图像合成处理器，能对输入图像执行缩放、旋转等操作"""

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点架构"""
        return io.Schema(
            node_id="XIS_CompositorProcessor",
            display_name="Compositor Processor",
            category="XISER_Nodes/Image_And_Mask",
            description="图像合成处理器，能对输入图像执行缩放、旋转等操作",
            inputs=[
                io.Image.Input("image",
                             tooltip="目标图片输入"),
                io.Int.Input("x",
                           default=0,
                           min=-9999,
                           max=9999,
                           step=1,
                           tooltip="中心点 x 坐标"),
                io.Int.Input("y",
                           default=0,
                           min=-9999,
                           max=9999,
                           step=1,
                           tooltip="中心点 y 坐标"),
                io.Int.Input("width",
                           default=512,
                           min=1,
                           max=4096,
                           step=1,
                           tooltip="缩放宽度"),
                io.Int.Input("height",
                           default=512,
                           min=1,
                           max=4096,
                           step=1,
                           tooltip="缩放高度"),
                io.Int.Input("angle",
                           default=0,
                           min=-360,
                           max=360,
                           step=1,
                           tooltip="旋转角度"),
                io.Int.Input("canvas_width",
                           default=512,
                           min=1,
                           max=4096,
                           step=1,
                           tooltip="画板宽度"),
                io.Int.Input("canvas_height",
                           default=512,
                           min=1,
                           max=4096,
                           step=1,
                           tooltip="画板高度"),
                io.String.Input("background_color",
                              default="#FFFFFF",
                              tooltip="画板底色（HEX 值）")
            ],
            outputs=[
                io.Image.Output(display_name="output_image")
            ]
        )

    @classmethod
    def execute(cls, image: torch.Tensor, x: int, y: int, width: int,
                height: int, angle: int, canvas_width: int, canvas_height: int,
                background_color: str) -> io.NodeOutput:
        """执行方法：图像变换和合成"""
        # 将 ComfyUI 的 IMAGE 类型（torch.Tensor）转换为 PIL 图像
        image_tensor = image[0]  # 假设批量大小为 1，取第一张图
        image_np = image_tensor.cpu().numpy() * 255  # 转换为 0-255 范围
        image_np = image_np.astype(np.uint8)
        pil_image = Image.fromarray(image_np)

        # 确保 width 和 height 大于 0
        width = max(1, width)
        height = max(1, height)

        # 创建画板
        try:
            # 验证并转换 HEX 颜色值
            bg_color = tuple(int(background_color.lstrip('#')[i:i+2], 16) for i in (0, 2, 4))
        except ValueError:
            bg_color = (255, 255, 255)  # 默认白色，如果 HEX 值无效
        canvas = Image.new("RGB", (canvas_width, canvas_height), bg_color)

        # 缩放目标图片
        resized_image = pil_image.resize((width, height), Image.Resampling.LANCZOS)

        # 旋转目标图片
        rotated_image = resized_image.rotate(-angle, expand=True, resample=Image.Resampling.BICUBIC)

        # 计算放置位置（x, y 是中心点）
        rot_width, rot_height = rotated_image.size
        paste_x = x - rot_width // 2
        paste_y = y - rot_height // 2

        # 将旋转后的图片粘贴到画板上
        canvas.paste(rotated_image, (paste_x, paste_y), rotated_image if rotated_image.mode == "RGBA" else None)

        # 将 PIL 图像转换回 ComfyUI 的 IMAGE 类型
        output_np = np.array(canvas).astype(np.float32) / 255.0  # 转换为 0-1 范围
        output_tensor = torch.from_numpy(output_np).unsqueeze(0)  # 添加批次维度

        return io.NodeOutput(output_tensor)


# ============================================================================
# 节点列表（用于Extension注册）
# ============================================================================

# 所有V3图像和蒙版处理节点
V3_NODE_CLASSES = [
    XIS_LoadImageV3,
    XIS_ResizeToDivisibleV3,
    XIS_CropImageV3,
    XIS_InvertMaskV3,
    XIS_ImageMaskMirrorV3,
    XIS_ReorderImageMaskGroupsV3,
    XIS_MaskCompositeOperationV3,
    XIS_MaskBatchProcessorV3,
    XIS_CompositorProcessorV3,
]

# 节点ID到类的映射（用于向后兼容或参考）
V3_NODE_MAPPINGS = {
    cls.define_schema().node_id: cls
    for cls in V3_NODE_CLASSES
}