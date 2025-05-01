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

logger = logging.getLogger("XISER_Canvas")
logger.setLevel(logging.DEBUG if os.getenv("COMFYUI_DEBUG") else logging.INFO)

class XISER_Canvas:
    def __init__(self):
        self.properties = {}
        self.output_dir = os.path.join(folder_paths.get_output_directory(), "xiser_canvas")
        os.makedirs(self.output_dir, exist_ok=True)
        self.last_output = None
        # 最大缓存文件数量
        self.max_cache_files = 50
        logger.debug(f"Output directory initialized: {self.output_dir}")

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("XIS_IMAGES", {"default": None}),
                "board_width": ("INT", {"default": 1024, "min": 256, "max": 4096, "step": 16}),
                "board_height": ("INT", {"default": 1024, "min": 256, "max": 4096, "step": 16}),
                "border_width": ("INT", {"default": 40, "min": 10, "max": 200, "step": 1}),
                "canvas_color": (["black", "white", "transparent"], {"default": "black"}),
                "image_states": ("STRING", {"default": "[]", "multiline": False}),
            }
        }

    RETURN_TYPES = ("IMAGE", "STRING", "MASK",)
    RETURN_NAMES = ("canvas_image", "image_paths", "masks",)
    FUNCTION = "render"
    CATEGORY = "XISER"
    OUTPUT_NODE = False

    def _generate_base64_chunks(self, pil_img, format="PNG", quality=10, chunk_size=512*1024):
        if not os.getenv("COMFYUI_DEBUG"):
            return []  # 仅在调试模式下生成 Base64
        buffered = BytesIO()
        try:
            pil_img.save(buffered, format=format, optimize=True, quality=quality)
            base64_data = base64.b64encode(buffered.getvalue()).decode("utf-8")
            chunks = []
            for i in range(0, len(base64_data), chunk_size):
                chunks.append(base64_data[i:i+chunk_size])
            return chunks
        except Exception as e:
            logger.error(f"Failed to generate Base64: {e}")
            return []

    def _resize_image_to_fit(self, pil_img, max_width, max_height):
        img_width, img_height = pil_img.size
        scale = min(max_width / img_width, max_height / img_height, 1.0)
        new_width = int(img_width * scale)
        new_height = int(img_height * scale)
        if scale != 1.0:
            pil_img = pil_img.resize((new_width, new_height), Image.Resampling.LANCZOS)
        return pil_img

    def _clean_old_files(self):
        # 获取所有缓存文件，按修改时间排序
        files = glob.glob(os.path.join(self.output_dir, "xiser_canvas_*.png"))
        if len(files) <= self.max_cache_files:
            return
        # 按修改时间排序（最早的文件优先删除）
        files.sort(key=lambda x: os.path.getmtime(x))
        files_to_delete = files[:len(files) - self.max_cache_files]
        for file in files_to_delete:
            try:
                os.remove(file)
                logger.info(f"Deleted old cache file: {file}")
            except Exception as e:
                logger.error(f"Failed to delete cache file {file}: {e}")

    def render(self, images, board_width: int, board_height: int, border_width: int, canvas_color: str, image_states: str):
        logger.debug(f"Rendering with inputs: board_width={board_width}, board_height={board_height}, border_width={border_width}, canvas_color={canvas_color}")

        # 处理输入的 XIS_IMAGES 类型数据
        if images is None:
            logger.error("images input cannot be None")
            raise ValueError("images input must be provided")
        
        if not isinstance(images, list):
            logger.error(f"Invalid images input: expected list, got {type(images)}")
            raise ValueError("images input must be a list of torch.Tensor")

        images_list = []
        for img in images:
            if not isinstance(img, torch.Tensor):
                logger.error(f"Invalid image in list: expected torch.Tensor, got {type(img)}")
                raise ValueError("All elements in images list must be torch.Tensor")
            # 确保图像是 (H, W, 4) 格式（RGBA）
            if img.shape[-1] != 4:
                logger.error(f"Image has invalid channels: {img.shape[-1]}")
                raise ValueError(f"Image has invalid channels: {img.shape[-1]}")
            images_list.append(img)

        if not images_list:
            logger.error("No valid images provided")
            raise ValueError("At least one image must be provided")

        if len(images_list) > 8:
            logger.error(f"Too many images: {len(images_list)}, maximum 8 allowed")
            raise ValueError("Maximum 8 images allowed")

        # 移除 torch.stack 操作，仅使用 images_list
        # images_tensor = torch.stack(images_list, dim=0) if len(images_list) > 0 else None

        if canvas_color not in ["black", "white", "transparent"]:
            logger.error(f"Invalid canvas_color: {canvas_color}")
            raise ValueError(f"Invalid canvas_color: {canvas_color}")
        if not (256 <= board_width <= 4096 and 256 <= board_height <= 4096 and 10 <= border_width <= 200):
            logger.error(f"Input values out of range: board_width={board_width}, board_height={board_height}, border_width={border_width}")
            raise ValueError("Input values out of allowed range")

        current_params = {
            "board_width": board_width,
            "board_height": board_height,
            "border_width": border_width,
            "canvas_color": canvas_color,
            "image_count": len(images_list)
        }
        image_changed = False
        if self.properties.get("last_params") != current_params:
            self.properties["last_params"] = current_params
            image_changed = True
        if images_list:
            try:
                # 修改哈希计算方式，直接基于 images_list
                image_hashes = [hash(img.cpu().numpy().tobytes()) for img in images_list]
                combined_hash = hash(tuple(image_hashes))
                if self.properties.get("last_image_hash") != combined_hash:
                    image_changed = True
                    self.properties["last_image_hash"] = combined_hash
            except Exception as e:
                logger.error(f"Failed to compute image hash: {e}")
                image_changed = True

        image_paths = []
        image_base64_chunks = []
        try:
            import json
            image_states = json.loads(image_states) if image_states else []
        except Exception as e:
            logger.error(f"Failed to parse image_states: {e}")
            image_states = []

        if images_list and image_changed:
            try:
                for i, img_tensor in enumerate(images_list):
                    img = img_tensor.cpu().numpy()
                    if img.shape[2] != 4:
                        logger.error(f"Image {i+1} has invalid channels after normalization: {img.shape[2]}")
                        raise ValueError(f"Image {i+1} has invalid channels: {img.shape[2]}")
                    img = (img * 255).clip(0, 255).astype(np.uint8)
                    pil_img = Image.fromarray(img, mode="RGBA")
                    pil_img = self._resize_image_to_fit(pil_img, board_width * 0.8, board_height * 0.8)
                    img_filename = f"xiser_canvas_{uuid.uuid4().hex}.png"
                    img_path = os.path.join(self.output_dir, img_filename)
                    pil_img.save(img_path, format="PNG")
                    image_paths.append(img_filename)
                    # 仅在调试模式下生成 Base64
                    chunks = self._generate_base64_chunks(pil_img, format="PNG", quality=10)
                    for j, chunk in enumerate(chunks):
                        image_base64_chunks.append({
                            "filename": img_filename,
                            "chunk_index": j,
                            "total_chunks": len(chunks),
                            "data": chunk
                        })
                self.properties["image_paths"] = image_paths
                if not image_states or len(image_states) != len(image_paths):
                    image_states = [
                        {"x": border_width + board_width / 2, "y": border_width + board_height / 2, "scaleX": 1, "scaleY": 1, "rotation": 0}
                        for _ in range(len(image_paths))
                    ]
                    self.properties["image_states"] = image_states
            except Exception as e:
                logger.error(f"Failed to save images: {e}")
                image_base64_chunks = []
            finally:
                # 清理旧文件
                self._clean_old_files()
        else:
            image_paths = self.properties.get("image_paths", [])

        canvas_color_rgb = {
            "black": (0, 0, 0, 255),
            "white": (255, 255, 255, 255),
            "transparent": (0, 0, 0, 0)
        }[canvas_color]
        canvas_img = np.ones((board_height, board_width, 4), dtype=np.uint8) * np.array(canvas_color_rgb, dtype=np.uint8)
        canvas_pil = Image.fromarray(canvas_img, mode="RGBA")

        # 存储每个图像的透明通道 mask
        mask_list = []

        for i, (path, state) in enumerate(zip(image_paths, image_states)):
            try:
                img_path = os.path.join(self.output_dir, path)
                img = Image.open(img_path).convert("RGBA")
                img_width, img_height = img.size

                # 确保等比缩放
                scale = state.get("scaleX", 1)
                new_width = int(img_width * scale)
                new_height = int(img_height * scale)
                img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)

                # 提取 Alpha 通道
                alpha = img.split()[3]
                mask = Image.new("L", (board_width, board_height), 0)

                # 应用旋转
                rotation = state.get("rotation", 0)
                if rotation != 0:
                    img = img.rotate(-rotation, expand=True)
                    alpha = alpha.rotate(-rotation, expand=True)

                img_width, img_height = img.size
                x = state.get("x", border_width + board_width / 2) - border_width
                y = state.get("y", border_width + board_height / 2) - border_width
                paste_x = int(x - img_width / 2)
                paste_y = int(y - img_height / 2)

                # 完整粘贴图像和 mask，不进行裁剪
                canvas_pil.paste(img, (paste_x, paste_y), img)
                mask.paste(alpha, (paste_x, paste_y))

                # 将 mask 转换为 torch.Tensor，形状为 (H, W)
                mask_array = np.array(mask, dtype=np.float32) / 255.0
                mask_tensor = torch.from_numpy(mask_array)
                mask_list.append(mask_tensor)

            except Exception as e:
                logger.error(f"Failed to apply image {i+1}: {e}")
                mask_array = np.zeros((board_height, board_width), dtype=np.float32)
                mask_tensor = torch.from_numpy(mask_array)
                mask_list.append(mask_tensor)
                continue

        # 将 mask_list 转换为单一的 torch.Tensor，形状为 (N, H, W)
        if mask_list:
            masks_tensor = torch.stack(mask_list, dim=0)
        else:
            masks_tensor = torch.zeros((0, board_height, board_width), dtype=torch.float32)

        canvas_array = np.array(canvas_pil).astype(np.float32) / 255.0
        canvas_tensor = torch.from_numpy(canvas_array).unsqueeze(0)

        self.properties["ui_config"] = {
            "board_width": board_width,
            "board_height": board_height,
            "border_width": border_width,
            "canvas_color": {
                "black": "rgb(0, 0, 0)",
                "white": "rgb(255, 255, 255)",
                "transparent": "rgba(0, 0, 0, 0)"
            }[canvas_color],
            "border_color": {
                "black": "rgb(25, 25, 25)",
                "white": "rgb(230, 230, 230)",
                "transparent": "rgba(0, 0, 0, 0)"
            }[canvas_color],
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