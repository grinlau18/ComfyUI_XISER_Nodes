import os
import uuid
import logging
import numpy as np
import torch
from PIL import Image
import folder_paths
import base64
from io import BytesIO
import glob
import time
import json

logger = logging.getLogger("XISER_Canvas")
logger.setLevel(logging.INFO)

class XISER_Canvas:
    def __init__(self):
        self.properties = {}
        self.output_dir = os.path.join(folder_paths.get_output_directory(), "xiser_canvas")
        os.makedirs(self.output_dir, exist_ok=True)
        self.last_output = None
        self.max_cache_files = 50
        logger.info(f"Output directory initialized: {self.output_dir}")

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "pack_images": ("XIS_IMAGES", {"default": None}),
                "board_width": ("INT", {"default": 1024, "min": 256, "max": 4096, "step": 16}),
                "board_height": ("INT", {"default": 1024, "min": 256, "max": 4096, "step": 16}),
                "border_width": ("INT", {"default": 40, "min": 10, "max": 200, "step": 1}),
                "canvas_color": (["black", "white", "transparent"], {"default": "black"}),
                "auto_size": (["off", "on"], {"default": "off"}),
                "image_states": ("STRING", {"default": "[]", "multiline": False}),
            }
        }

    RETURN_TYPES = ("IMAGE", "STRING", "MASK",)
    RETURN_NAMES = ("canvas_image", "image_paths", "masks",)
    FUNCTION = "render"
    CATEGORY = "XISER_Nodes/Canvas"
    OUTPUT_NODE = True

    def _generate_base64_chunks(self, pil_img, format="PNG", quality=10, chunk_size=512*1024):
        if not os.getenv("COMFYUI_DEBUG"):
            return []
        buffered = BytesIO()
        try:
            pil_img.save(buffered, format=format, optimize=True, quality=quality)
            base64_data = base64.b64encode(buffered.getvalue()).decode("utf-8")
            return [base64_data[i:i+chunk_size] for i in range(0, len(base64_data), chunk_size)]
        except Exception as e:
            logger.error(f"Failed to generate Base64: {e}")
            return []

    def _clean_old_files(self):
        files = glob.glob(os.path.join(self.output_dir, "xiser_canvas_*.png"))
        if len(files) <= self.max_cache_files:
            return
        files.sort(key=lambda x: os.path.getmtime(x))
        for file in files[:len(files) - self.max_cache_files]:
            try:
                os.remove(file)
                logger.info(f"Deleted old cache file: {file}")
            except Exception as e:
                logger.error(f"Failed to delete cache file {file}: {e}")

    def render(self, pack_images, board_width: int, board_height: int, border_width: int, canvas_color: str, auto_size: str, image_states: str):
        logger.info(f"Rendering with inputs: board_width={board_width}, board_height={board_height}, border_width={border_width}, canvas_color={canvas_color}, auto_size={auto_size}")

        if pack_images is None:
            logger.error("images input cannot be None")
            raise ValueError("images input must be provided")
        
        if not isinstance(pack_images, list):
            logger.error(f"Invalid images input: expected list, got {type(pack_images)}")
            raise ValueError("images input must be a list of torch.Tensor")

        images_list = [img for img in pack_images if isinstance(img, torch.Tensor) and img.shape[-1] == 4]

        if not images_list:
            logger.error("No valid images provided")
            raise ValueError("At least one image must be provided")

        if canvas_color not in ["black", "white", "transparent"]:
            logger.error(f"Invalid canvas_color: {canvas_color}")
            raise ValueError(f"Invalid canvas_color: {canvas_color}")
        if auto_size not in ["off", "on"]:
            logger.error(f"Invalid auto_size: {auto_size}")
            raise ValueError(f"Invalid auto_size: {auto_size}")
        if not (256 <= board_width <= 4096 and 256 <= board_height <= 4096 and 10 <= border_width <= 200):
            logger.error(f"Input values out of range: board_width={board_width}, board_height={board_height}, border_width={border_width}")
            raise ValueError("Input values out of allowed range")

        # 检查第一张图片的尺寸和哈希值
        first_image_size = None
        first_image_hash = None
        if images_list:
            first_img = (images_list[0].cpu().numpy() * 255).clip(0, 255).astype(np.uint8)
            first_pil_img = Image.fromarray(first_img, mode="RGBA")
            first_image_size = (first_pil_img.width, first_pil_img.height)
            first_image_hash = hash(images_list[0].cpu().numpy().tobytes())

        # 获取之前的记录
        last_first_image_size = self.properties.get("last_first_image_size")
        last_first_image_hash = self.properties.get("last_first_image_hash")
        last_auto_size = self.properties.get("last_auto_size", "off")

        # 动态调整 board_width 和 board_height 当 auto_size 为 "on"
        should_reset = False
        if auto_size == "on" and images_list:
            dynamic_board_width = min(max(first_pil_img.width, 256), 4096)
            dynamic_board_height = min(max(first_pil_img.height, 256), 4096)
            # 判断是否需要调整画板尺寸和重置
            if last_auto_size == "on" and last_first_image_size and last_first_image_hash:
                # auto_size 已打开，检查第一张图片是否变化
                first_image_changed = first_image_hash != last_first_image_hash
                size_changed = first_image_size != last_first_image_size
                if first_image_changed and size_changed:
                    # 第一张图片变化且尺寸不同，调整画板并重置
                    logger.info(f"First image changed with different size, adjusting board to {dynamic_board_width}x{dynamic_board_height}")
                    board_width = dynamic_board_width
                    board_height = dynamic_board_height
                    should_reset = True
                elif first_image_changed:
                    # 第一张图片变化但尺寸相同，仅更新图片，不重置
                    logger.info("First image changed but size unchanged, keeping board size")
                else:
                    # 第一张图片未变，仅更新其他图片，不重置
                    logger.info("First image unchanged, keeping board size")
            else:
                # auto_size 刚打开或无历史记录，调整画板并重置
                logger.info(f"Auto-size enabled or no history, adjusting board to {dynamic_board_width}x{dynamic_board_height}")
                board_width = dynamic_board_width
                board_height = dynamic_board_height
                should_reset = True

        # 更新历史记录
        self.properties["last_first_image_size"] = first_image_size
        self.properties["last_first_image_hash"] = first_image_hash
        self.properties["last_auto_size"] = auto_size

        current_params = {
            "board_width": board_width,
            "board_height": board_height,
            "border_width": border_width,
            "canvas_color": canvas_color,
            "auto_size": auto_size,
            "image_count": len(images_list)
        }
        image_changed = self.properties.get("last_params") != current_params
        if images_list and not image_changed:
            image_hashes = [hash(img.cpu().numpy().tobytes()) for img in images_list]
            image_changed = self.properties.get("last_image_hash") != hash(tuple(image_hashes))
        if image_changed:
            self.properties["last_params"] = current_params
            if images_list:
                self.properties["last_image_hash"] = hash(tuple([hash(img.cpu().numpy().tobytes()) for img in images_list]))

        image_paths = self.properties.get("image_paths", [])
        image_base64_chunks = []
        try:
            image_states = json.loads(image_states) if image_states else []
        except Exception as e:
            logger.error(f"Failed to parse image_states: {e}")
            image_states = []

        if images_list and image_changed:
            image_paths = []
            for i, img_tensor in enumerate(images_list):
                img = (img_tensor.cpu().numpy() * 255).clip(0, 255).astype(np.uint8)
                pil_img = Image.fromarray(img, mode="RGBA")
                img_filename = f"xiser_canvas_{uuid.uuid4().hex}.png"
                img_path = os.path.join(self.output_dir, img_filename)
                pil_img.save(img_path, format="PNG")
                image_paths.append(img_filename)
                chunks = self._generate_base64_chunks(pil_img)
                image_base64_chunks.extend([{
                    "filename": img_filename,
                    "chunk_index": j,
                    "total_chunks": len(chunks),
                    "data": chunk
                } for j, chunk in enumerate(chunks)])
            self.properties["image_paths"] = image_paths

            # 根据 should_reset 决定是否重置 image_states
            if auto_size == "on" and should_reset:
                image_states = [{
                    "x": border_width + board_width / 2,
                    "y": border_width + board_height / 2,
                    "scaleX": 1,
                    "scaleY": 1,
                    "rotation": 0
                } for _ in range(len(image_paths))]
                logger.info(f"Auto-size enabled and reset triggered, resetting image_states to center positions")
            elif not image_states or len(image_states) != len(image_paths):
                new_image_states = []
                for i in range(len(image_paths)):
                    if i < len(image_states):
                        new_image_states.append(image_states[i])
                    else:
                        new_image_states.append({
                            "x": border_width + board_width / 2,
                            "y": border_width + board_height / 2,
                            "scaleX": 1,
                            "scaleY": 1,
                            "rotation": 0
                        })
                image_states = new_image_states
            self.properties["image_states"] = image_states
            self._clean_old_files()

        # 确保 image_paths 和 image_states 长度一致
        if len(image_paths) != len(image_states):
            logger.warning(f"Image paths ({len(image_paths)}) and states ({len(image_states)}) length mismatch, adjusting states")
            new_image_states = []
            for i in range(len(image_paths)):
                if i < len(image_states):
                    new_image_states.append(image_states[i])
                else:
                    new_image_states.append({
                        "x": border_width + board_width / 2,
                        "y": border_width + board_height / 2,
                        "scaleX": 1,
                        "scaleY": 1,
                        "rotation": 0
                    })
            image_states = new_image_states
            self.properties["image_states"] = image_states

        # 创建画布并应用 canvas_color
        canvas_color_rgb = {
            "black": (0, 0, 0, 255),
            "white": (255, 255, 255, 255),
            "transparent": (0, 0, 0, 0)
        }[canvas_color]
        canvas_img = np.ones((board_height, board_width, 4), dtype=np.uint8) * np.array(canvas_color_rgb, dtype=np.uint8)
        canvas_pil = Image.fromarray(canvas_img, mode="RGBA")

        mask_list = []
        for i, (path, state) in enumerate(zip(image_paths, image_states)):
            try:
                img = Image.open(os.path.join(self.output_dir, path)).convert("RGBA")
                alpha = img.split()[3]
                mask = Image.new("L", (board_width, board_height), 0)

                # 应用缩放（使用 BICUBIC 插值）
                scale_x = state.get("scaleX", 1.0)
                scale_y = state.get("scaleY", 1.0)
                if scale_x != 1.0 or scale_y != 1.0:
                    new_width = int(img.width * scale_x)
                    new_height = int(img.height * scale_y)
                    img = img.resize((new_width, new_height), resample=Image.Resampling.BICUBIC)
                    alpha = alpha.resize((new_width, new_height), resample=Image.Resampling.BICUBIC)

                # 应用旋转（使用 BICUBIC 插值，填充透明色）
                rotation = state.get("rotation", 0)
                if rotation != 0:
                    img = img.rotate(-rotation, resample=Image.Resampling.BICUBIC, expand=True, fillcolor=(0, 0, 0, 0))
                    alpha = alpha.rotate(-rotation, resample=Image.Resampling.BICUBIC, expand=True)

                # 计算平移位置（基于缩放和旋转后的图像尺寸）
                x = state.get("x", border_width + board_width / 2) - border_width
                y = state.get("y", border_width + board_height / 2) - border_width
                paste_x = int(x - img.width / 2)
                paste_y = int(y - img.height / 2)

                # 确保粘贴区域在画布内
                paste_box = (max(0, paste_x), max(0, paste_y), min(board_width, paste_x + img.width), min(board_height, paste_y + img.height))
                img_cropped = img.crop((max(0, -paste_x), max(0, -paste_y), min(img.width, board_width - paste_x), min(img.height, board_height - paste_y)))
                alpha_cropped = alpha.crop((max(0, -paste_x), max(0, -paste_y), min(alpha.width, board_width - paste_x), min(alpha.height, board_height - paste_y)))

                # 粘贴图像和 Alpha 通道
                canvas_pil.paste(img_cropped, (max(0, paste_x), max(0, paste_y)), img_cropped)
                mask.paste(alpha_cropped, (max(0, paste_x), max(0, paste_y)))
                mask_list.append(torch.from_numpy(np.array(mask, dtype=np.float32) / 255.0))
                logger.debug(f"Mask {i} generated with shape: {mask.size}")
            except Exception as e:
                logger.error(f"Failed to apply image {i+1}: {e}")
                mask_list.append(torch.zeros((board_height, board_width), dtype=torch.float32))

        # 确保 mask_list 非空
        if not mask_list:
            logger.warning("No valid masks generated, returning default mask")
            mask_list = [torch.zeros((board_height, board_width), dtype=torch.float32)]

        masks_tensor = torch.stack(mask_list, dim=0) if mask_list else torch.zeros((1, board_height, board_width), dtype=torch.float32)
        logger.info(f"Returning masks_tensor with shape: {masks_tensor.shape}")
        canvas_tensor = torch.from_numpy(np.array(canvas_pil).astype(np.float32) / 255.0).unsqueeze(0)

        self.properties["ui_config"] = {
            "board_width": board_width,
            "board_height": board_height,
            "border_width": border_width,
            "canvas_color": {"black": "rgb(0, 0, 0)", "white": "rgb(255, 255, 255)", "transparent": "rgba(0, 0, 0, 0)"}[canvas_color],
            "border_color": {"black": "rgb(25, 25, 25)", "white": "rgb(230, 230, 230)", "transparent": "rgba(0, 0, 0, 0)"}[canvas_color],
            "auto_size": auto_size,
            "image_paths": image_paths
        }
        self.properties["image_states"] = image_states
        self.last_output = (canvas_tensor, ",".join(image_paths))

        logger.info(f"Returning UI data: image_states={len(image_states)} items, image_base64_chunks={len(image_base64_chunks)}, image_paths={len(image_paths)} items")
        return {
            "ui": {
                "image_states": image_states,
                "image_base64_chunks": image_base64_chunks,
                "image_paths": image_paths
            },
            "result": (canvas_tensor, ",".join(image_paths), masks_tensor)
        }

NODE_CLASS_MAPPINGS = {
    "XISER_Canvas": XISER_Canvas
}