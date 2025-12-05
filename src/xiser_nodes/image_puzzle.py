from PIL import Image
import torch
import numpy as np
from typing import Optional, List, Tuple

class XIS_ImagePuzzle:
    """
    ImagePuzzle 是基于 PIL 库开发的图片拼接工具，支持四种核心拼接布局：
    左主右副、右主左副、上主下副、下主上副。
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "pack_images": ("IMAGE", {"default": None}),
                "main_count": ("INT", {"default": 1, "min": 1, "max": 10, "step": 1}),
                "layout_type": (["left-main", "right-main", "top-main", "bottom-main"], {"default": "left-main"}),
                "gap": ("INT", {"default": 0, "min": 0, "max": 100, "step": 1}),
                "main_base_width": ("INT", {"default": 800, "min": 100, "max": 4096, "step": 10}),
                "bg_color": ("STRING", {"default": "#FFFFFF"}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "generate_puzzle"
    CATEGORY = "XISER_Nodes/Image_Processing"

    def __init__(self):
        pass

    def get_image_info(self, img_tensor: torch.Tensor) -> Tuple[Image.Image, int, int, float]:
        """
        从张量获取图片信息（尺寸、宽高比）
        """
        # 将张量转换为 PIL 图像
        img_np = img_tensor.cpu().numpy() * 255
        img_np = img_np.astype(np.uint8)

        if img_tensor.shape[-1] == 4:  # RGBA
            img = Image.fromarray(img_np, 'RGBA')
        else:  # RGB
            img = Image.fromarray(img_np, 'RGB').convert("RGBA")

        w, h = img.size
        ratio = w / h
        return img, w, h, ratio

    def calc_main_image_size(self, ratio: float, main_base_width: int) -> Tuple[int, int]:
        """
        计算主图展示尺寸（统一基准宽度，高度按比例）
        """
        display_w = main_base_width
        display_h = int(main_base_width / ratio)
        return display_w, display_h

    def combine_sub_vertical(self, sub_imgs_info: List[Tuple[Image.Image, int, int, float]],
                           main_base_width: int, gap: int, bg_color: Tuple[int, int, int]) -> Tuple[Optional[Image.Image], int, int]:
        """
        副图竖向组合（图间间距=gap）→ 适配左主右副/右主左副
        """
        if not sub_imgs_info:
            return None, 0, 0

        sub_w = main_base_width
        sub_imgs_resized = []
        total_height = 0

        # 调整副图尺寸
        for img, _, _, ratio in sub_imgs_info:
            resize_h = int(sub_w / ratio)
            img_resized = img.resize((sub_w, resize_h), Image.Resampling.LANCZOS)
            sub_imgs_resized.append(img_resized)
            total_height += resize_h + gap  # 副图间间距

        # 减去最后一个间距
        if sub_imgs_resized:
            total_height -= gap

        # 创建副图长图画布
        sub_long_img = Image.new("RGBA", (sub_w, total_height), bg_color)

        # 拼接副图
        current_y = 0
        for img in sub_imgs_resized:
            sub_long_img.paste(img, (0, current_y), img)
            current_y += img.height + gap

        return sub_long_img, sub_w, total_height

    def combine_sub_horizontal(self, sub_imgs_info: List[Tuple[Image.Image, int, int, float]],
                              main_base_width: int, gap: int, bg_color: Tuple[int, int, int]) -> Tuple[Optional[Image.Image], int, int]:
        """
        副图横向组合（图间间距=gap）→ 适配上主下副/下主上副
        """
        if not sub_imgs_info:
            return None, 0, 0

        # 副图高度=第一张主图的高度
        main_img_ratio = sub_imgs_info[0][3] if sub_imgs_info else 1
        sub_h = int(main_base_width / main_img_ratio)
        sub_imgs_resized = []
        total_width = 0

        # 调整副图尺寸
        for img, _, _, ratio in sub_imgs_info:
            resize_w = int(sub_h * ratio)
            img_resized = img.resize((resize_w, sub_h), Image.Resampling.LANCZOS)
            sub_imgs_resized.append(img_resized)
            total_width += resize_w + gap  # 副图间间距

        # 减去最后一个间距
        if sub_imgs_resized:
            total_width -= gap

        # 创建副图长图画布
        sub_long_img = Image.new("RGBA", (total_width, sub_h), bg_color)

        # 拼接副图
        current_x = 0
        for img in sub_imgs_resized:
            sub_long_img.paste(img, (current_x, 0), img)
            current_x += img.width + gap

        return sub_long_img, total_width, sub_h

    def resize_image_keep_ratio(self, img: Image.Image, target_h: Optional[int] = None,
                               target_w: Optional[int] = None) -> Tuple[Image.Image, int, int]:
        """
        等比缩放图片
        """
        img_w, img_h = img.size

        if target_h is not None:
            scale = target_h / img_h
            new_w = int(img_w * scale)
            new_h = target_h
        elif target_w is not None:
            scale = target_w / img_w
            new_w = target_w
            new_h = int(img_h * scale)
        else:
            return img, img_w, img_h

        resized_img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
        return resized_img, new_w, new_h

    def combine_main_vertical(self, main_imgs_info: List[Tuple[Image.Image, int, int, float]],
                             main_base_width: int, gap: int, bg_color: Tuple[int, int, int]) -> Tuple[Image.Image, int, int]:
        """
        主图竖向组合（图间间距=gap）→ 适配左右布局
        """
        if not main_imgs_info:
            return Image.new("RGBA", (0, 0), bg_color), 0, 0

        main_w = main_base_width
        main_imgs_resized = []
        total_height = 0

        # 调整主图尺寸
        for img_info in main_imgs_info:
            img, _, _, ratio = img_info
            resize_w, resize_h = self.calc_main_image_size(ratio, main_base_width)
            img_resized = img.resize((resize_w, resize_h), Image.Resampling.LANCZOS)
            main_imgs_resized.append(img_resized)
            total_height += resize_h + gap  # 主图间间距

        # 减去最后一个间距
        if main_imgs_resized:
            total_height -= gap

        # 创建主图长图画布
        main_long_img = Image.new("RGBA", (main_w, total_height), bg_color)

        # 拼接主图
        current_y = 0
        for img in main_imgs_resized:
            main_long_img.paste(img, (0, current_y), img)
            current_y += img.height + gap

        return main_long_img, main_w, total_height

    def combine_main_horizontal(self, main_imgs_info: List[Tuple[Image.Image, int, int, float]],
                               main_base_width: int, gap: int, bg_color: Tuple[int, int, int]) -> Tuple[Image.Image, int, int]:
        """
        主图横向组合（图间间距=gap）→ 适配上下布局
        """
        if not main_imgs_info:
            return Image.new("RGBA", (0, 0), bg_color), 0, 0

        # 计算主图统一高度
        main_h = 0
        for img_info in main_imgs_info:
            img, _, _, ratio = img_info
            resize_w, resize_h = self.calc_main_image_size(ratio, main_base_width)
            main_h = max(main_h, resize_h)

        main_imgs_resized = []
        total_width = 0

        # 调整主图尺寸
        for img_info in main_imgs_info:
            img, _, _, ratio = img_info
            resize_w, resize_h = self.calc_main_image_size(ratio, main_base_width)
            # 等比缩放到统一高度
            scale = main_h / resize_h
            final_w = int(resize_w * scale)
            img_resized = img.resize((final_w, main_h), Image.Resampling.LANCZOS)
            main_imgs_resized.append(img_resized)
            total_width += final_w + gap  # 主图间间距

        # 减去最后一个间距
        if main_imgs_resized:
            total_width -= gap

        # 创建主图长图画布
        main_long_img = Image.new("RGBA", (total_width, main_h), bg_color)

        # 拼接主图
        current_x = 0
        for img in main_imgs_resized:
            main_long_img.paste(img, (current_x, 0), img)
            current_x += img.width + gap

        return main_long_img, total_width, main_h

    def layout_left_main(self, main_imgs_info: List[Tuple[Image.Image, int, int, float]],
                        sub_long_img: Optional[Image.Image], sub_long_w: int, sub_long_h: int,
                        main_base_width: int, gap: int, bg_color: Tuple[int, int, int]) -> Image.Image:
        """
        左主右副拼接（主图竖向拼接，对齐宽度，有间距）
        """
        # 1. 主图竖向拼接（对齐宽度，有间距）
        main_long_img, main_area_w, main_area_h = self.combine_main_vertical(
            main_imgs_info, main_base_width, gap, bg_color
        )

        # 2. 副图长图等比缩放到与主图区域高度一致
        if sub_long_img is not None and sub_long_h > 0:
            sub_long_img, sub_long_w, sub_long_h = self.resize_image_keep_ratio(
                sub_long_img, target_h=main_area_h
            )

        # 3. 计算最终拼图尺寸
        final_w = main_area_w + gap + sub_long_w  # 主宽 + 间距 + 副宽
        final_h = main_area_h  # 高度=主图区高度

        # 4. 创建最终拼图画布
        final_img = Image.new("RGBA", (final_w, final_h), bg_color)

        # 5. 拼接主图长图
        final_img.paste(main_long_img, (0, 0), main_long_img)

        # 6. 拼接副图长图
        if sub_long_img is not None:
            sub_start_x = main_area_w + gap  # 主宽 + 间距
            final_img.paste(sub_long_img, (sub_start_x, 0), sub_long_img)

        return final_img

    def layout_right_main(self, main_imgs_info: List[Tuple[Image.Image, int, int, float]],
                         sub_long_img: Optional[Image.Image], sub_long_w: int, sub_long_h: int,
                         main_base_width: int, gap: int, bg_color: Tuple[int, int, int]) -> Image.Image:
        """
        右主左副拼接（主图竖向拼接，对齐宽度，有间距）
        """
        # 1. 主图竖向拼接（对齐宽度，有间距）
        main_long_img, main_area_w, main_area_h = self.combine_main_vertical(
            main_imgs_info, main_base_width, gap, bg_color
        )

        # 2. 副图长图等比缩放
        if sub_long_img is not None and sub_long_h > 0:
            sub_long_img, sub_long_w, sub_long_h = self.resize_image_keep_ratio(
                sub_long_img, target_h=main_area_h
            )

        # 3. 最终拼图尺寸
        final_w = sub_long_w + gap + main_area_w
        final_h = main_area_h

        # 4. 创建画布
        final_img = Image.new("RGBA", (final_w, final_h), bg_color)

        # 5. 拼接副图长图
        if sub_long_img is not None:
            final_img.paste(sub_long_img, (0, 0), sub_long_img)

        # 6. 拼接主图长图
        main_start_x = sub_long_w + gap  # 主副间距
        final_img.paste(main_long_img, (main_start_x, 0), main_long_img)

        return final_img

    def layout_top_main(self, main_imgs_info: List[Tuple[Image.Image, int, int, float]],
                       sub_long_img: Optional[Image.Image], sub_long_w: int, sub_long_h: int,
                       main_base_width: int, gap: int, bg_color: Tuple[int, int, int]) -> Image.Image:
        """
        上主下副拼接（主图横向拼接，对齐高度，有间距）
        """
        # 1. 主图横向拼接（对齐高度，有间距）
        main_long_img, main_area_w, main_area_h = self.combine_main_horizontal(
            main_imgs_info, main_base_width, gap, bg_color
        )

        # 2. 副图长图等比缩放到与主图区域宽度一致
        if sub_long_img is not None and sub_long_w > 0:
            sub_long_img, sub_long_w, sub_long_h = self.resize_image_keep_ratio(
                sub_long_img, target_w=main_area_w
            )

        # 3. 最终拼图尺寸
        final_w = main_area_w
        final_h = main_area_h + gap + sub_long_h

        # 4. 创建画布
        final_img = Image.new("RGBA", (final_w, final_h), bg_color)

        # 5. 拼接主图长图
        final_img.paste(main_long_img, (0, 0), main_long_img)

        # 6. 拼接副图长图
        if sub_long_img is not None:
            sub_start_y = main_area_h + gap  # 主高 + 间距
            final_img.paste(sub_long_img, (0, sub_start_y), sub_long_img)

        return final_img

    def layout_bottom_main(self, main_imgs_info: List[Tuple[Image.Image, int, int, float]],
                          sub_long_img: Optional[Image.Image], sub_long_w: int, sub_long_h: int,
                          main_base_width: int, gap: int, bg_color: Tuple[int, int, int]) -> Image.Image:
        """
        下主上副拼接（主图横向拼接，对齐高度，有间距）
        """
        # 1. 主图横向拼接（对齐高度，有间距）
        main_long_img, main_area_w, main_area_h = self.combine_main_horizontal(
            main_imgs_info, main_base_width, gap, bg_color
        )

        # 2. 副图长图等比缩放到与主图区域宽度一致
        if sub_long_img is not None and sub_long_w > 0:
            sub_long_img, sub_long_w, sub_long_h = self.resize_image_keep_ratio(
                sub_long_img, target_w=main_area_w
            )

        # 3. 最终拼图尺寸
        final_w = main_area_w
        final_h = sub_long_h + gap + main_area_h

        # 4. 创建画布
        final_img = Image.new("RGBA", (final_w, final_h), bg_color)

        # 5. 拼接副图长图
        if sub_long_img is not None:
            final_img.paste(sub_long_img, (0, 0), sub_long_img)

        # 6. 拼接主图长图
        main_start_y = sub_long_h + gap  # 副高 + 间距
        final_img.paste(main_long_img, (0, main_start_y), main_long_img)

        return final_img

    def add_outer_border(self, img: Image.Image, gap: int, bg_color: Tuple[int, int, int]) -> Image.Image:
        """
        为最终拼图添加外扩边框（宽度=gap，背景色）
        """
        if gap <= 0:
            return img

        # 计算新尺寸（原图尺寸 + 2*gap）
        new_w = img.width + 2 * gap
        new_h = img.height + 2 * gap

        # 创建带背景色的新画布
        border_img = Image.new("RGBA", (new_w, new_h), bg_color)
        # 将原图粘贴到画布中央（外扩gap边框）
        border_img.paste(img, (gap, gap), img)

        return border_img

    def hex_to_rgb(self, hex_color: str) -> Tuple[int, int, int]:
        """
        将 HEX 颜色转换为 RGB 元组
        """
        hex_color = hex_color.lstrip('#')
        if len(hex_color) == 6:
            r = int(hex_color[0:2], 16)
            g = int(hex_color[2:4], 16)
            b = int(hex_color[4:6], 16)
            return (r, g, b)
        elif len(hex_color) == 3:
            r = int(hex_color[0:1] * 2, 16)
            g = int(hex_color[1:2] * 2, 16)
            b = int(hex_color[2:3] * 2, 16)
            return (r, g, b)
        else:
            return (255, 255, 255)  # 默认白色

    # 处理 v3 节点数据格式
    def _unwrap_v3_data(self, data):
        """处理 v3 节点返回的数据格式，支持 io.NodeOutput 和原始数据"""
        if data is None:
            return None
        if hasattr(data, 'outputs') and isinstance(data.outputs, tuple):
            # io.NodeOutput 对象
            return data.outputs[0]
        elif isinstance(data, tuple) and len(data) == 1:
            # 可能是 (data,) 格式
            return data[0]
        else:
            # 原始数据
            return data

    def generate_puzzle(self, pack_images: List[torch.Tensor], main_count: int, layout_type: str,
                       gap: int, main_base_width: int, bg_color: str) -> Tuple[torch.Tensor]:
        """
        生成拼图主函数
        """
        # 解包 v3 数据格式
        pack_images = self._unwrap_v3_data(pack_images)

        # 验证输入
        if not pack_images:
            raise ValueError("pack_images 输入为空，请提供至少一张图片")

        # 转换背景色
        bg_rgb = self.hex_to_rgb(bg_color)

        # 1. 解析图片信息
        all_imgs_info = []
        for img_tensor in pack_images:
            all_imgs_info.append(self.get_image_info(img_tensor))

        # 2. 分离主副图
        if main_count > len(all_imgs_info):
            main_count = len(all_imgs_info)

        main_imgs_info = all_imgs_info[:main_count]
        sub_imgs_info = all_imgs_info[main_count:]

        # 3. 无副图时
        if not sub_imgs_info:
            main_imgs_resized = []

            # 处理主图
            for img_info in main_imgs_info:
                img, _, _, ratio = img_info
                resize_w, resize_h = self.calc_main_image_size(ratio, main_base_width)
                img_resized = img.resize((resize_w, resize_h), Image.Resampling.LANCZOS)
                main_imgs_resized.append(img_resized)

            # 根据布局类型决定主图堆叠方式
            if layout_type in ["left-main", "right-main"]:
                # 左右布局：主图垂直堆叠
                total_height = sum(img.height for img in main_imgs_resized)
                main_w = main_base_width

                # 创建主图画布
                final_img = Image.new("RGBA", (main_w, total_height), bg_rgb)
                current_y = 0
                for img in main_imgs_resized:
                    final_img.paste(img, (0, current_y), img)
                    current_y += img.height
            else:
                # 上下布局：主图水平堆叠
                total_width = sum(img.width for img in main_imgs_resized)
                main_h = max(img.height for img in main_imgs_resized)

                # 创建主图画布
                final_img = Image.new("RGBA", (total_width, main_h), bg_rgb)
                current_x = 0
                for img in main_imgs_resized:
                    final_img.paste(img, (current_x, 0), img)
                    current_x += img.width

            # 添加外扩边框
            final_img = self.add_outer_border(final_img, gap, bg_rgb)
        else:
            # 4. 组合副图长图
            sub_long_img, sub_long_w, sub_long_h = None, 0, 0
            if layout_type in ["left-main", "right-main"]:
                sub_long_img, sub_long_w, sub_long_h = self.combine_sub_vertical(
                    sub_imgs_info, main_base_width, gap, bg_rgb
                )
            else:
                sub_long_img, sub_long_w, sub_long_h = self.combine_sub_horizontal(
                    sub_imgs_info, main_base_width, gap, bg_rgb
                )

            # 5. 最终拼接
            if layout_type == "left-main":
                final_img = self.layout_left_main(
                    main_imgs_info, sub_long_img, sub_long_w, sub_long_h,
                    main_base_width, gap, bg_rgb
                )
            elif layout_type == "right-main":
                final_img = self.layout_right_main(
                    main_imgs_info, sub_long_img, sub_long_w, sub_long_h,
                    main_base_width, gap, bg_rgb
                )
            elif layout_type == "top-main":
                final_img = self.layout_top_main(
                    main_imgs_info, sub_long_img, sub_long_w, sub_long_h,
                    main_base_width, gap, bg_rgb
                )
            elif layout_type == "bottom-main":
                final_img = self.layout_bottom_main(
                    main_imgs_info, sub_long_img, sub_long_w, sub_long_h,
                    main_base_width, gap, bg_rgb
                )
            else:
                # 默认使用左主右副布局
                final_img = self.layout_left_main(
                    main_imgs_info, sub_long_img, sub_long_w, sub_long_h,
                    main_base_width, gap, bg_rgb
                )

            # 6. 添加外扩边框
            final_img = self.add_outer_border(final_img, gap, bg_rgb)

        # 7. 转换为 ComfyUI IMAGE 格式
        final_img_np = np.array(final_img).astype(np.float32) / 255.0
        final_tensor = torch.from_numpy(final_img_np).unsqueeze(0)

        return (final_tensor,)


NODE_CLASS_MAPPINGS = {
    "XIS_ImagePuzzle": XIS_ImagePuzzle,
}