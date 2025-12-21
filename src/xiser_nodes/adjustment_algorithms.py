"""
adjustment_algorithms.py

统一的图像调节算法模块，提供前后端一致的调节算法实现。
确保预览和最终渲染结果完全一致。
"""

import numpy as np
from PIL import Image
from .adjustment_utils import AdjustmentUtils


class AdjustmentAlgorithms:
    """图像调节算法类"""

    @staticmethod
    def apply_brightness(rgb_array, brightness):
        """
        应用亮度调整

        Args:
            rgb_array (np.ndarray): RGB图像数组，形状为 (H, W, 3)，值范围 0-255
            brightness (float): 亮度值（-1.0 到 1.0）

        Returns:
            np.ndarray: 调整后的RGB数组
        """
        if abs(brightness) < 1e-3:
            return rgb_array

        # 使用更细腻的亮度调整算法（与前端一致）
        # 当brightness > 0时，使用S曲线增强中间调
        # 当brightness < 0时，使用更平缓的暗化曲线
        gamma = 1.0 / (1.0 + brightness * 0.5)  # 调整伽马值

        # 归一化到0-1范围
        normalized = rgb_array.astype(np.float32) / 255.0

        # 应用伽马校正
        adjusted = np.power(normalized, gamma)

        # 转换回0-255范围
        adjusted = np.clip(adjusted * 255.0, 0, 255)

        return adjusted.astype(np.uint8)

    @staticmethod
    def apply_contrast(rgb_array, contrast):
        """
        应用对比度调整

        Args:
            rgb_array (np.ndarray): RGB图像数组，形状为 (H, W, 3)，值范围 0-255
            contrast (float): 对比度值（-100 到 100）

        Returns:
            np.ndarray: 调整后的RGB数组
        """
        if abs(contrast) < 1e-3:
            return rgb_array

        # 使用更细腻的对比度调整算法（与前端一致）
        # 将contrast从-100到100映射到更平滑的因子范围
        normalized_contrast = contrast / 100.0  # -1 到 1

        # 使用Sigmoid-like函数，让中间值变化更平缓
        if normalized_contrast >= 0:
            # 增强对比度：使用更平缓的曲线
            factor = 1.0 + normalized_contrast * 0.5  # 最大1.5倍
        else:
            # 降低对比度：使用更敏感的曲线
            factor = 1.0 / (1.0 - normalized_contrast * 0.8)  # 最小约0.56倍

        # 归一化到0-1范围，应用对比度，再还原到0-255
        normalized = rgb_array.astype(np.float32) / 255.0
        normalized = (normalized - 0.5) * factor + 0.5
        adjusted = np.clip(normalized * 255.0, 0, 255)

        return adjusted.astype(np.uint8)

    @staticmethod
    def apply_saturation(rgb_array, saturation):
        """
        应用饱和度调整

        Args:
            rgb_array (np.ndarray): RGB图像数组，形状为 (H, W, 3)，值范围 0-255
            saturation (float): 饱和度值（-100 到 100）

        Returns:
            np.ndarray: 调整后的RGB数组
        """
        if abs(saturation) < 1e-3:
            return rgb_array

        # 使用更细腻的饱和度调整算法（与前端一致）
        normalized_saturation = saturation / 100.0  # -1 到 1

        # 使用PIL进行HSV转换
        pil_img = Image.fromarray(rgb_array, mode="RGB")
        hsv_img = pil_img.convert("HSV")
        hsv_array = np.array(hsv_img).astype(np.float32)

        # 调整饱和度通道（索引1），归一化到0-1
        saturation_channel = hsv_array[:, :, 1] / 255.0

        # 根据原始饱和度值调整变化幅度（与前端算法一致）
        if normalized_saturation >= 0:
            # 增加饱和度：使用S曲线，让变化更自然
            base_factor = 1.0 + normalized_saturation * 0.8  # 最大1.8倍
            # 根据原始饱和度调整：低饱和度区域变化更明显，高饱和度区域变化更平缓
            adaptive_factor = 1.0 + (base_factor - 1.0) * (1.0 - saturation_channel * 0.5)
            factor = adaptive_factor
        else:
            # 降低饱和度：使用更平缓的曲线
            reduction = -normalized_saturation  # 0 到 1
            # 使用平方根函数让变化更平缓
            factor = 1.0 - np.sqrt(reduction) * 0.8  # 最小约0.2倍

        # 应用饱和度调整
        adjusted_saturation = np.clip(saturation_channel * factor, 0, 1) * 255.0
        hsv_array[:, :, 1] = adjusted_saturation

        # 转换回RGB
        hsv_array = np.clip(hsv_array, 0, 255).astype(np.uint8)
        adjusted_img = Image.fromarray(hsv_array, mode="HSV").convert("RGB")

        return np.array(adjusted_img)

    @staticmethod
    def apply_adjustments(pil_img, brightness=0.0, contrast=0.0, saturation=0.0):
        """
        应用亮度、对比度、饱和度调整到PIL图像

        Args:
            pil_img (PIL.Image): 输入图像（RGB或RGBA模式）
            brightness (float): 亮度值
            contrast (float): 对比度值
            saturation (float): 饱和度值

        Returns:
            PIL.Image: 调整后的图像
        """
        # 确保图像是RGB模式
        original_mode = pil_img.mode
        if original_mode == "RGBA":
            # 分离RGB和Alpha通道
            rgb_img = pil_img.convert("RGB")
            alpha_channel = pil_img.split()[3]
        else:
            rgb_img = pil_img.convert("RGB")
            alpha_channel = None

        # 转换为numpy数组
        rgb_array = np.array(rgb_img)

        # 按顺序应用调整：亮度 -> 对比度 -> 饱和度
        # 与前端应用顺序一致
        if abs(brightness) >= 1e-3:
            rgb_array = AdjustmentAlgorithms.apply_brightness(rgb_array, brightness)

        if abs(contrast) >= 1e-3:
            rgb_array = AdjustmentAlgorithms.apply_contrast(rgb_array, contrast)

        if abs(saturation) >= 1e-3:
            rgb_array = AdjustmentAlgorithms.apply_saturation(rgb_array, saturation)

        # 转换回PIL图像
        adjusted_img = Image.fromarray(rgb_array, mode="RGB")

        # 如果有Alpha通道，重新组合
        if alpha_channel is not None:
            adjusted_img = adjusted_img.convert("RGBA")
            r, g, b, _ = adjusted_img.split()
            adjusted_img = Image.merge("RGBA", (r, g, b, alpha_channel))
        elif original_mode == "RGBA":
            # 原始是RGBA但没有Alpha通道？转换为RGBA
            adjusted_img = adjusted_img.convert("RGBA")

        return adjusted_img

    @staticmethod
    def alpha_composite(background, foreground, x, y, opacity=1.0):
        """
        使用预乘alpha合成算法将前景图像合成到背景上

        Args:
            background (PIL.Image): 背景图像（RGBA）
            foreground (PIL.Image): 前景图像（RGBA）
            x, y (int): 前景图像在背景上的位置（左上角坐标）
            opacity (float): 前景图像的透明度（0.0-1.0）

        Returns:
            PIL.Image: 合成后的图像
        """
        # 确保图像都是RGBA模式
        if background.mode != "RGBA":
            background = background.convert("RGBA")
        if foreground.mode != "RGBA":
            foreground = foreground.convert("RGBA")

        # 获取图像尺寸
        bg_width, bg_height = background.size
        fg_width, fg_height = foreground.size

        # 计算实际粘贴区域
        paste_x = max(0, x)
        paste_y = max(0, y)

        # 计算前景图像在背景中的可见区域
        fg_x1 = max(0, -x)
        fg_y1 = max(0, -y)
        fg_x2 = min(fg_width, bg_width - x)
        fg_y2 = min(fg_height, bg_height - y)

        # 如果没有可见区域，直接返回背景
        if fg_x1 >= fg_x2 or fg_y1 >= fg_y2:
            return background

        # 裁剪前景图像的可见部分
        fg_cropped = foreground.crop((fg_x1, fg_y1, fg_x2, fg_y2))

        # 获取背景对应区域
        bg_x1 = paste_x
        bg_y1 = paste_y
        bg_x2 = min(bg_width, paste_x + (fg_x2 - fg_x1))
        bg_y2 = min(bg_height, paste_y + (fg_y2 - fg_y1))

        bg_region = background.crop((bg_x1, bg_y1, bg_x2, bg_y2))

        # 转换为numpy数组进行高效计算
        bg_array = np.array(bg_region, dtype=np.float32) / 255.0
        fg_array = np.array(fg_cropped, dtype=np.float32) / 255.0

        # 提取alpha通道
        bg_alpha = bg_array[..., 3:4]
        fg_alpha = fg_array[..., 3:4]

        # 应用透明度
        fg_alpha_adjusted = fg_alpha * opacity

        # 计算合成后的alpha
        out_alpha = fg_alpha_adjusted + bg_alpha * (1.0 - fg_alpha_adjusted)
        out_alpha_clamped = np.where(out_alpha > 0, out_alpha, 1.0)

        # 预乘alpha合成
        bg_premult = bg_array[..., :3] * bg_alpha
        fg_premult = fg_array[..., :3] * fg_alpha_adjusted

        # 合成颜色
        out_rgb = (fg_premult + bg_premult * (1.0 - fg_alpha_adjusted)) / out_alpha_clamped

        # 组合结果
        out_array = np.concatenate([out_rgb, out_alpha], axis=-1)
        out_array = np.clip(out_array * 255.0, 0, 255).astype(np.uint8)

        # 创建合成后的区域图像
        out_region = Image.fromarray(out_array, mode="RGBA")

        # 将合成后的区域粘贴回背景
        result = background.copy()
        result.paste(out_region, (bg_x1, bg_y1))

        return result


def create_adjusted_image(pil_img, adjustment_state):
    """
    创建应用了调节效果的图像

    Args:
        pil_img (PIL.Image): 原始图像
        adjustment_state (dict): 调节状态，包含brightness、contrast、saturation、opacity

    Returns:
        tuple: (调整后的图像, 应用的调节状态)
    """
    # 规范化调节状态
    normalized_state = AdjustmentUtils.normalize_adjustment_state(adjustment_state)

    # 应用亮度、对比度、饱和度调整
    adjusted_img = AdjustmentAlgorithms.apply_adjustments(
        pil_img,
        brightness=normalized_state["brightness"],
        contrast=normalized_state["contrast"],
        saturation=normalized_state["saturation"]
    )

    return adjusted_img, normalized_state