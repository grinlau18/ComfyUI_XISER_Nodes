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
logger.setLevel(logging.INFO)  # 移除调试级别，仅保留信息和错误日志

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
                "image_states": ("STRING", {"default": "[]", "multiline": False}),
            }
        }

    RETURN_TYPES = ("IMAGE", "STRING", "MASK",)
    RETURN_NAMES = ("canvas_image", "image_paths", "masks",)
    FUNCTION = "render"
    CATEGORY = "XISER_Nodes/Canvas"
    OUTPUT_NODE = False

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

    def _resize_image_to_fit(self, pil_img, max_width, max_height):
        img_width, img_height = pil_img.size
        scale = min(max_width / img_width, max_height / img_height, 1.0)
        if scale != 1.0:
            return pil_img.resize((int(img_width * scale), int(img_height * scale)), Image.Resampling.LANCZOS)
        return pil_img

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

    def render(self, pack_images, board_width: int, board_height: int, border_width: int, canvas_color: str, image_states: str):
        logger.info(f"Rendering with inputs: board_width={board_width}, board_height={board_height}, border_width={border_width}, canvas_color={canvas_color}")

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

        if len(images_list) > 8:
            logger.error(f"Too many images: {len(images_list)}, maximum 8 allowed")
            raise ValueError("Maximum 8 images allowed")

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
            import json
            image_states = json.loads(image_states) if image_states else []
        except Exception as e:
            logger.error(f"Failed to parse image_states: {e}")
            image_states = []

        if images_list and image_changed:
            image_paths = []
            for i, img_tensor in enumerate(images_list):
                img = (img_tensor.cpu().numpy() * 255).clip(0, 255).astype(np.uint8)
                pil_img = Image.fromarray(img, mode="RGBA")
                pil_img = self._resize_image_to_fit(pil_img, board_width * 0.8, board_height * 0.8)
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
            if not image_states or len(image_states) != len(image_paths):
                image_states = [{"x": border_width + board_width / 2, "y": border_width + board_height / 2, "scaleX": 1, "scaleY": 1, "rotation": 0} for _ in range(len(image_paths))]
                self.properties["image_states"] = image_states
            self._clean_old_files()

        canvas_color_rgb = {"black": (0, 0, 0, 255), "white": (255, 255, 255, 255), "transparent": (0, 0, 0, 0)}[canvas_color]
        canvas_img = np.ones((board_height, board_width, 4), dtype=np.uint8) * np.array(canvas_color_rgb, dtype=np.uint8)
        canvas_pil = Image.fromarray(canvas_img, mode="RGBA")

        mask_list = []
        for i, (path, state) in enumerate(zip(image_paths, image_states)):
            try:
                img = Image.open(os.path.join(self.output_dir, path)).convert("RGBA")
                scale = state.get("scaleX", 1)
                img = img.resize((int(img.width * scale), int(img.height * scale)), Image.Resampling.LANCZOS)
                alpha = img.split()[3]
                mask = Image.new("L", (board_width, board_height), 0)
                rotation = state.get("rotation", 0)
                if rotation != 0:
                    # 使用高质量插值和抗锯齿进行旋转
                    img = img.rotate(-rotation, resample=Image.Resampling.BICUBIC, expand=True)
                    alpha = alpha.rotate(-rotation, resample=Image.Resampling.BICUBIC, expand=True)
                x = state.get("x", border_width + board_width / 2) - border_width
                y = state.get("y", border_width + board_height / 2) - border_width
                paste_x, paste_y = int(x - img.width / 2), int(y - img.height / 2)
                canvas_pil.paste(img, (paste_x, paste_y), img)
                mask.paste(alpha, (paste_x, paste_y))
                mask_list.append(torch.from_numpy(np.array(mask, dtype=np.float32) / 255.0))
            except Exception as e:
                logger.error(f"Failed to apply image {i+1}: {e}")
                mask_list.append(torch.zeros((board_height, board_width), dtype=torch.float32))

        masks_tensor = torch.stack(mask_list, dim=0) if mask_list else torch.zeros((0, board_height, board_width), dtype=torch.float32)
        canvas_tensor = torch.from_numpy(np.array(canvas_pil).astype(np.float32) / 255.0).unsqueeze(0)

        self.properties["ui_config"] = {
            "board_width": board_width,
            "board_height": board_height,
            "border_width": border_width,
            "canvas_color": {"black": "rgb(0, 0, 0)", "white": "rgb(255, 255, 255)", "transparent": "rgba(0, 0, 0, 0)"}[canvas_color],
            "border_color": {"black": "rgb(25, 25, 25)", "white": "rgb(230, 230, 230)", "transparent": "rgba(0, 0, 0, 0)"}[canvas_color],
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