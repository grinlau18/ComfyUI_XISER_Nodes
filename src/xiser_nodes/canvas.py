"""
canvas.py

Main backend logic for the XISER_Canvas node in ComfyUI, handling image rendering and canvas configuration.
Supports receiving pack_images and optional file_data to adjust layer properties.
"""

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
import json
import time

logger = logging.getLogger("XISER_Canvas")
logger.setLevel(logging.INFO)


class XISER_Canvas:
    """Node for rendering images onto a canvas with configurable size, color, and layer properties."""

    def __init__(self):
        """Initialize the XISER_Canvas node with output directory and properties."""
        self.properties = {}
        self.instance_id = uuid.uuid4().hex  # Unique identifier for this instance
        self.output_dir = os.path.join(folder_paths.get_output_directory(), "xiser_canvas")
        os.makedirs(self.output_dir, exist_ok=True)
        self.last_output = None
        self.max_cache_files = 50  # Maximum number of cache files per instance
        self.max_cache_size = 1024 * 1024 * 1024  # Maximum cache size in bytes (1GB) for all files
        self.max_file_age = 24 * 60 * 60  # Maximum file age in seconds (24 hours)
        self.created_files = set()  # Track files created by this instance
        logger.info(f"Instance {self.instance_id} - Output directory initialized: {self.output_dir}")

    @classmethod
    def INPUT_TYPES(cls):
        """
        Defines the input types for the XISER_Canvas node.

        Returns:
            dict: Input configuration with required and optional parameters.
        """
        return {
            "required": {
                "pack_images": ("IMAGE", {"default": None}),
                "board_width": ("INT", {"default": 1024, "min": 256, "max": 8192, "step": 16}),
                "board_height": ("INT", {"default": 1024, "min": 256, "max": 8192, "step": 16}),
                "border_width": ("INT", {"default": 40, "min": 10, "max": 200, "step": 1}),
                "canvas_color": (["black", "white", "transparent"], {"default": "black"}),
                "auto_size": (["off", "on"], {"default": "off"}),
                "image_states": ("STRING", {"default": "[]", "multiline": False}),
            },
            "optional": {
                "file_data": ("FILE_DATA", {"default": None}),
                "canvas_config": ("CANVAS_CONFIG", {}),  # 支持从上游节点传入控件配置
            },
        }

    RETURN_TYPES = ("IMAGE", "STRING", "MASK",)
    RETURN_NAMES = ("canvas_image", "image_paths", "masks",)
    FUNCTION = "render"
    CATEGORY = "XISER_Nodes/Visual_Editing"
    OUTPUT_NODE = True

    def _generate_base64_chunks(self, pil_img, format="PNG", quality=10, chunk_size=512 * 1024):
        """
        Generates Base64 chunks for an image if debug mode is enabled.

        Args:
            pil_img (PIL.Image): Image to convert to Base64.
            format (str): Image format (default: "PNG").
            quality (int): Compression quality (default: 10).
            chunk_size (int): Size of each Base64 chunk (default: 512KB).

        Returns:
            list: List of Base64 chunks, or empty list if not in debug mode or on error.
        """
        if not os.getenv("COMFYUI_DEBUG"):
            return []
        buffered = BytesIO()
        try:
            pil_img.save(buffered, format=format, optimize=True, quality=quality)
            base64_data = base64.b64encode(buffered.getvalue()).decode("utf-8")
            return [
                base64_data[i : i + chunk_size]
                for i in range(0, len(base64_data), chunk_size)
            ]
        except Exception as e:
            logger.error(f"Instance {self.instance_id} - Failed to generate Base64: {e}")
            return []

    def _clean_old_files(self):
        """
        Removes old cache files based on multiple criteria to optimize resource usage.

        Deletes files based on the following rules:
        - File age: Files older than max_file_age (24 hours) are removed.
        - Total size: If the total size exceeds max_cache_size (1GB), oldest files are removed until the size is under the limit.
        - File count: If the number of files created by this instance exceeds max_cache_files (50), oldest files are removed until the count is under the limit.
        - Only deletes files created by this instance (tracked in self.created_files).
        """
        files = glob.glob(os.path.join(self.output_dir, "xiser_canvas_*.png"))
        if not files:
            logger.debug(f"Instance {self.instance_id} - No cache files to clean")
            return

        # Collect file metadata (path, modification time, size) for files created by this instance
        file_info = []
        total_size = 0
        current_time = time.time()
        
        for file in files:
            filename = os.path.basename(file)
            if filename not in self.created_files:
                continue  # Skip files not created by this instance
            try:
                stats = os.stat(file)
                file_info.append({
                    "path": file,
                    "filename": filename,
                    "mtime": stats.st_mtime,
                    "size": stats.st_size,
                })
                total_size += stats.st_size
            except Exception as e:
                logger.error(f"Instance {self.instance_id} - Failed to get stats for file {file}: {e}")
                continue

        # Sort files by modification time (oldest first)
        file_info.sort(key=lambda x: x["mtime"])

        # Rule 1: Remove files older than max_file_age
        files_to_remove = []
        for info in file_info:
            age = current_time - info["mtime"]
            if age > self.max_file_age:
                files_to_remove.append(info)
                total_size -= info["size"]
                self.created_files.remove(info["filename"])
                logger.info(f"Instance {self.instance_id} - File {info['path']} is too old ({age:.2f} seconds), marked for deletion")

        # Rule 2: Remove oldest files if total size exceeds max_cache_size
        # Note: This applies to all files in the directory, not just this instance
        all_files = glob.glob(os.path.join(self.output_dir, "xiser_canvas_*.png"))
        all_file_info = []
        for file in all_files:
            try:
                stats = os.stat(file)
                all_file_info.append({
                    "path": file,
                    "filename": os.path.basename(file),
                    "mtime": stats.st_mtime,
                    "size": stats.st_size,
                })
                if os.path.basename(file) not in self.created_files:
                    total_size += stats.st_size  # Include size of other files for total limit
            except Exception as e:
                logger.error(f"Instance {self.instance_id} - Failed to get stats for file {file}: {e}")
                continue

        all_file_info.sort(key=lambda x: x["mtime"])
        while total_size > self.max_cache_size and all_file_info:
            info = all_file_info.pop(0)  # Remove the oldest file
            if info["filename"] in self.created_files and info not in files_to_remove:
                files_to_remove.append(info)
                self.created_files.remove(info["filename"])
                total_size -= info["size"]
                logger.info(f"Instance {self.instance_id} - Total cache size exceeded ({total_size / (1024 * 1024):.2f} MB), removing {info['path']}")
            elif info["filename"] not in self.created_files:
                # File belongs to another instance, remove it from total_size but not from disk
                total_size -= info["size"]

        # Rule 3: Remove oldest files if file count exceeds max_cache_files (for this instance)
        while len(file_info) > self.max_cache_files and file_info:
            info = file_info.pop(0)  # Remove the oldest file
            if info not in files_to_remove:
                files_to_remove.append(info)
                total_size -= info["size"]
                self.created_files.remove(info["filename"])
                logger.info(f"Instance {self.instance_id} - File count exceeded ({len(file_info)}), removing {info['path']}")

        # Execute deletion
        for info in files_to_remove:
            try:
                os.remove(info["path"])
                logger.info(f"Instance {self.instance_id} - Deleted cache file: {info['path']}")
            except Exception as e:
                logger.error(f"Instance {self.instance_id} - Failed to delete cache file {info['path']}: {e}")

        # Log final state
        remaining_files = len([f for f in self.created_files if os.path.exists(os.path.join(self.output_dir, f))])
        logger.debug(f"Instance {self.instance_id} - Cache cleanup completed: {remaining_files} files remaining for this instance, total size: {total_size / (1024 * 1024):.2f} MB")

    def render(
        self,
        pack_images,
        board_width: int,
        board_height: int,
        border_width: int,
        canvas_color: str,
        auto_size: str,
        image_states: str,
        file_data=None,
        canvas_config=None,
    ):
        logger.info(
            f"Instance {self.instance_id} - Rendering with inputs: board_width={board_width}, board_height={board_height}, "
            f"border_width={border_width}, canvas_color={canvas_color}, auto_size={auto_size}, "
            f"file_data={'present' if file_data else 'None'}, "
            f"canvas_config={'present' if canvas_config else 'None'}"
        )

        # Validate inputs
        if pack_images is None:
            logger.error(f"Instance {self.instance_id} - images input cannot be None")
            raise ValueError("images input must be provided")

        # Handle canvas_config from upstream node
        if canvas_config:
            logger.info(f"Instance {self.instance_id} - Processing canvas_config: {canvas_config}")
            # Update parameters from canvas_config
            if "board_width" in canvas_config:
                board_width = max(256, min(8192, int(canvas_config["board_width"])))
                logger.info(f"Instance {self.instance_id} - Updated board_width from canvas_config: {board_width}")
            if "board_height" in canvas_config:
                board_height = max(256, min(8192, int(canvas_config["board_height"])))
                logger.info(f"Instance {self.instance_id} - Updated board_height from canvas_config: {board_height}")
            if "border_width" in canvas_config:
                border_width = max(10, min(200, int(canvas_config["border_width"])))
                logger.info(f"Instance {self.instance_id} - Updated border_width from canvas_config: {border_width}")
            if "canvas_color" in canvas_config and canvas_config["canvas_color"] in ["black", "white", "transparent"]:
                canvas_color = canvas_config["canvas_color"]
                logger.info(f"Instance {self.instance_id} - Updated canvas_color from canvas_config: {canvas_color}")
            if "auto_size" in canvas_config and canvas_config["auto_size"] in ["off", "on"]:
                auto_size = canvas_config["auto_size"]
                logger.info(f"Instance {self.instance_id} - Updated auto_size from canvas_config: {auto_size}")

        if not isinstance(pack_images, list):
            logger.error(f"Instance {self.instance_id} - Invalid images input: expected list, got {type(pack_images)}")
            raise ValueError("images input must be a list of torch.Tensor")

        images_list = [
            img for img in pack_images if isinstance(img, torch.Tensor) and img.shape[-1] == 4
        ]

        if not images_list:
            logger.error(f"Instance {self.instance_id} - No valid images provided")
            raise ValueError("At least one image must be provided")

        if canvas_color not in ["black", "white", "transparent"]:
            logger.error(f"Instance {self.instance_id} - Invalid canvas_color: {canvas_color}")
            raise ValueError(f"Invalid canvas_color: {canvas_color}")
        if auto_size not in ["off", "on"]:
            logger.error(f"Instance {self.instance_id} - Invalid auto_size: {auto_size}")
            raise ValueError(f"Invalid auto_size: {auto_size}")
        if not (256 <= board_width <= 8192 and 256 <= board_height <= 8192 and 10 <= border_width <= 200):
            logger.error(
                f"Instance {self.instance_id} - Input values out of range: board_width={board_width}, "
                f"board_height={board_height}, border_width={border_width}"
            )
            raise ValueError("Input values out of allowed range")

        # Check first image dimensions
        first_image_size = None
        if images_list:
            first_img = (images_list[0].cpu().numpy() * 255).clip(0, 255).astype(np.uint8)
            first_pil_img = Image.fromarray(first_img, mode="RGBA")
            first_image_size = (first_pil_img.width, first_pil_img.height)
            logger.info(f"Instance {self.instance_id} - First image dimensions: {first_image_size}")

        # Handle auto_size based on first image dimensions only
        if auto_size == "on" and images_list:
            # Use first image dimensions
            board_width = min(max(first_pil_img.width, 256), 8192)
            board_height = min(max(first_pil_img.height, 256), 8192)
            logger.info(
                f"Instance {self.instance_id} - Auto-size enabled, using board size {board_width}x{board_height} from first image"
            )

        # Check for image or parameter changes
        current_params = {
            "board_width": board_width,
            "board_height": board_height,
            "border_width": border_width,
            "canvas_color": canvas_color,
            "auto_size": auto_size,
            "image_count": len(images_list),
        }
        image_changed = self.properties.get("last_params") != current_params
        if images_list and not image_changed:
            image_hashes = [hash(img.cpu().numpy().tobytes()) for img in images_list]
            image_changed = self.properties.get("last_image_hash") != hash(tuple(image_hashes))
        if image_changed:
            self.properties["last_params"] = current_params
            if images_list:
                self.properties["last_image_hash"] = hash(
                    tuple([hash(img.cpu().numpy().tobytes()) for img in images_list])
                )

        image_paths = self.properties.get("image_paths", [])
        image_base64_chunks = []
        try:
            image_states = json.loads(image_states) if image_states else []
        except Exception as e:
            logger.error(f"Instance {self.instance_id} - Failed to parse image_states: {e}")
            image_states = []

        # Update image paths and states
        if images_list and image_changed:
            # Clean up old files created by this instance before adding new ones
            self._clean_old_files()

            image_paths = []
            for i, img_tensor in enumerate(images_list):
                img = (img_tensor.cpu().numpy() * 255).clip(0, 255).astype(np.uint8)
                pil_img = Image.fromarray(img, mode="RGBA")
                img_filename = f"xiser_canvas_{self.instance_id}_{uuid.uuid4().hex}.png"
                img_path = os.path.join(self.output_dir, img_filename)
                pil_img.save(img_path, format="PNG")
                self.created_files.add(img_filename)  # Track this file
                image_paths.append(img_filename)
                chunks = self._generate_base64_chunks(pil_img)
                image_base64_chunks.extend(
                    [
                        {
                            "filename": img_filename,
                            "chunk_index": j,
                            "total_chunks": len(chunks),
                            "data": chunk,
                        }
                        for j, chunk in enumerate(chunks)
                    ]
                )
            self.properties["image_paths"] = image_paths
            logger.info(f"Instance {self.instance_id} - Updated image_paths: {image_paths}")

            # Handle image_states based on file_data
            if file_data and file_data.get("layers"):
                logger.info(f"Instance {self.instance_id} - Applying layer states from file_data")
                image_states = []
                for i, layer in enumerate(file_data.get("layers", [])):
                    if i >= len(image_paths):
                        break
                    img = Image.open(os.path.join(self.output_dir, image_paths[i])).convert(
                        "RGBA"
                    )
                    # Convert top-left coordinates to center coordinates
                    center_x = layer.get("offset_x", 0) + img.width / 2
                    center_y = layer.get("offset_y", 0) + img.height / 2
                    image_states.append(
                        {
                            "x": center_x + border_width,  # Adjust for border
                            "y": center_y + border_width,  # Adjust for border
                            "scaleX": layer.get("scale_x", 1.0),
                            "scaleY": layer.get("scale_y", 1.0),
                            "rotation": layer.get("rotation", 0.0),
                        }
                    )
                # Pad with default states if fewer layers in file_data
                for i in range(len(file_data["layers"]), len(image_paths)):
                    image_states.append(
                        {
                            "x": border_width + board_width / 2,
                            "y": border_width + board_height / 2,
                            "scaleX": 1.0,
                            "scaleY": 1.0,
                            "rotation": 0.0,
                        }
                    )
            elif not image_states or len(image_states) != len(image_paths):
                new_image_states = []
                for i in range(len(image_paths)):
                    if i < len(image_states):
                        new_image_states.append(image_states[i])
                    else:
                        new_image_states.append(
                            {
                                "x": border_width + board_width / 2,
                                "y": border_width + board_height / 2,
                                "scaleX": 1.0,
                                "scaleY": 1.0,
                                "rotation": 0.0,
                            }
                        )
                image_states = new_image_states
            self.properties["image_states"] = image_states

        # Ensure image_paths and image_states lengths match
        if len(image_paths) != len(image_states):
            logger.warning(
                f"Instance {self.instance_id} - Image paths ({len(image_paths)}) and states ({len(image_states)}) length mismatch, adjusting states"
            )
            new_image_states = []
            for i in range(len(image_paths)):
                if i < len(image_states):
                    new_image_states.append(image_states[i])
                else:
                    new_image_states.append(
                        {
                            "x": border_width + board_width / 2,
                            "y": border_width + board_height / 2,
                            "scaleX": 1.0,
                            "scaleY": 1.0,
                            "rotation": 0.0,
                        }
                    )
            image_states = new_image_states
            self.properties["image_states"] = image_states

        # Create canvas with specified color
        canvas_color_rgb = {
            "black": (0, 0, 0, 255),
            "white": (255, 255, 255, 255),
            "transparent": (0, 0, 0, 0),
        }[canvas_color]
        canvas_img = (
            np.ones((board_height, board_width, 4), dtype=np.uint8)
            * np.array(canvas_color_rgb, dtype=np.uint8)
        )
        canvas_pil = Image.fromarray(canvas_img, mode="RGBA")

        # Apply images to canvas
        mask_list = []
        for i, (path, state) in enumerate(zip(image_paths, image_states)):
            try:
                img = Image.open(os.path.join(self.output_dir, path)).convert("RGBA")
                alpha = img.split()[3]
                mask = Image.new("L", (board_width, board_height), 0)

                # Apply scaling
                scale_x = state.get("scaleX", 1.0)
                scale_y = state.get("scaleY", 1.0)
                if scale_x != 1.0 or scale_y != 1.0:
                    new_width = int(img.width * scale_x)
                    new_height = int(img.height * scale_y)
                    img = img.resize(
                        (new_width, new_height), resample=Image.Resampling.BICUBIC
                    )
                    alpha = alpha.resize(
                        (new_width, new_height), resample=Image.Resampling.BICUBIC
                    )

                # Apply rotation
                rotation = state.get("rotation", 0)
                if rotation != 0:
                    img = img.rotate(
                        -rotation,
                        resample=Image.Resampling.BICUBIC,
                        expand=True,
                        fillcolor=(0, 0, 0, 0),
                    )
                    alpha = alpha.rotate(
                        -rotation, resample=Image.Resampling.BICUBIC, expand=True
                    )

                # Calculate paste position (center-based)
                x = state.get("x", border_width + board_width / 2) - border_width
                y = state.get("y", border_width + board_height / 2) - border_width
                paste_x = int(x - img.width / 2)
                paste_y = int(y - img.height / 2)

                # Ensure paste area is within canvas
                paste_box = (
                    max(0, paste_x),
                    max(0, paste_y),
                    min(board_width, paste_x + img.width),
                    min(board_height, paste_y + img.height),
                )
                img_cropped = img.crop(
                    (
                        max(0, -paste_x),
                        max(0, -paste_y),
                        min(img.width, board_width - paste_x),
                        min(img.height, board_height - paste_y),
                    )
                )
                alpha_cropped = alpha.crop(
                    (
                        max(0, -paste_x),
                        max(0, -paste_y),
                        min(alpha.width, board_width - paste_x),
                        min(alpha.height, board_height - paste_y),
                    )
                )

                # Paste image and alpha channel
                canvas_pil.paste(
                    img_cropped, (max(0, paste_x), max(0, paste_y)), img_cropped
                )
                mask.paste(alpha_cropped, (max(0, paste_x), max(0, paste_y)))
                mask_list.append(
                    torch.from_numpy(np.array(mask, dtype=np.float32) / 255.0)
                )
                logger.debug(f"Instance {self.instance_id} - Mask {i} generated with shape: {mask.size}")
            except Exception as e:
                logger.error(f"Instance {self.instance_id} - Failed to apply image {i+1}: {e}")
                mask_list.append(torch.zeros((board_height, board_width), dtype=torch.float32))

        # Ensure mask_list is not empty
        if not mask_list:
            logger.warning(f"Instance {self.instance_id} - No valid masks generated, returning default mask")
            mask_list = [torch.zeros((board_height, board_width), dtype=torch.float32)]

        masks_tensor = (
            torch.stack(mask_list, dim=0)
            if mask_list
            else torch.zeros((1, board_height, board_width), dtype=torch.float32)
        )
        logger.info(f"Instance {self.instance_id} - Returning masks_tensor with shape: {masks_tensor.shape}")
        canvas_tensor = torch.from_numpy(np.array(canvas_pil).astype(np.float32) / 255.0).unsqueeze(0)

        # Update properties
        self.properties["ui_config"] = {
            "board_width": board_width,
            "board_height": board_height,
            "border_width": border_width,
            "canvas_color": {
                "black": "rgb(0, 0, 0)",
                "white": "rgb(255, 255, 255)",
                "transparent": "rgba(0, 0, 0, 0)",
            }[canvas_color],
            "border_color": {
                "black": "rgb(25, 25, 25)",
                "white": "rgb(230, 230, 230)",
                "transparent": "rgba(0, 0, 0, 0)",
            }[canvas_color],
            "auto_size": auto_size,
            "image_paths": image_paths,
            "display_scale": 1.0,  # Default value for consistency with frontend
            "height_adjustment": 130,  # Default value for consistency with frontend
        }
        self.properties["image_states"] = image_states
        self.last_output = (canvas_tensor, ",".join(image_paths))

        logger.info(
            f"Instance {self.instance_id} - Rendering completed: board_size={board_width}x{board_height}, "
            f"image_count={len(image_paths)}, auto_size={auto_size}"
        )
        return {
            "ui": {
                "image_states": image_states,
                "image_base64_chunks": image_base64_chunks,
                "image_paths": image_paths,
            },
            "result": (canvas_tensor, ",".join(image_paths), masks_tensor),
        }

    def cleanup(self):
        """
        Cleans up all files created by this instance.
        """
        for filename in list(self.created_files):
            file_path = os.path.join(self.output_dir, filename)
            try:
                if os.path.exists(file_path):
                    os.remove(file_path)
                    logger.info(f"Instance {self.instance_id} - Deleted file during cleanup: {file_path}")
                self.created_files.remove(filename)
            except Exception as e:
                logger.error(f"Instance {self.instance_id} - Failed to delete file during cleanup {file_path}: {e}")

    def __del__(self):
        """Destructor to ensure cleanup of files when the instance is deleted."""
        self.cleanup()


NODE_CLASS_MAPPINGS = {
    "XISER_Canvas": XISER_Canvas,
}