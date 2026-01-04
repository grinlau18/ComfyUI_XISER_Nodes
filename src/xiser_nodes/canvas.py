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

# 导入统一的调节工具模块
from .adjustment_utils import AdjustmentUtils
from .adjustment_algorithms import AdjustmentAlgorithms, create_adjusted_image

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
                "border_width": ("INT", {"default": 120, "min": 10, "max": 200, "step": 1}),
                "canvas_color": (["black", "white", "transparent"], {"default": "black"}),
                "display_scale": ("FLOAT", {"default": 0.5, "min": 0.1, "max": 1.0, "step": 0.01}),
                "auto_size": (["off", "on"], {"default": "off"}),
                "image_states": ("STRING", {"default": "[]", "multiline": False}),
            },
            "optional": {
                "file_data": ("FILE_DATA", {"default": None}),
                "canvas_config": ("CANVAS_CONFIG", {}),  # 支持从上游节点传入控件配置
                "layer_data": ("LAYER_DATA", {"default": None}),  # 支持从上游节点传入图层数据
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", "IMAGE", "LAYER_DATA",)
    RETURN_NAMES = ("canvas_image", "masks", "layer_images", "layer_data",)
    FUNCTION = "render"
    CATEGORY = "XISER_Nodes/Visual_Editing"
    OUTPUT_NODE = True

    def _calculate_transformed_dimensions(self, width, height, scale_x, scale_y, rotation):
        """
        Calculate the dimensions of the transformed image using mathematical formulas.
        This matches the frontend's coordinate-based transformation approach.

        Args:
            width (int): Original image width.
            height (int): Original image height.
            scale_x (float): X-axis scale factor.
            scale_y (float): Y-axis scale factor.
            rotation (float): Rotation angle in degrees.

        Returns:
            tuple: (new_width, new_height)
        """
        import math

        # Convert rotation to radians
        rotation_rad = math.radians(rotation)

        # Calculate the bounding box of the rotated and scaled image
        cos_theta = abs(math.cos(rotation_rad))
        sin_theta = abs(math.sin(rotation_rad))

        new_width = int(width * abs(scale_x) * cos_theta + height * abs(scale_y) * sin_theta)
        new_height = int(width * abs(scale_x) * sin_theta + height * abs(scale_y) * cos_theta)

        return new_width, new_height

    def _calculate_transformed_corners(self, width, height, scale_x, scale_y, rotation):
        """
        Calculate the corners of the transformed image for accurate positioning.
        This ensures the transformed image is properly centered.

        Args:
            width (int): Original image width.
            height (int): Original image height.
            scale_x (float): X-axis scale factor.
            scale_y (float): Y-axis scale factor.
            rotation (float): Rotation angle in degrees.

        Returns:
            tuple: (min_x, min_y, max_x, max_y)
        """
        import math

        # Convert rotation to radians
        rotation_rad = math.radians(rotation)
        cos_r = math.cos(rotation_rad)
        sin_r = math.sin(rotation_rad)

        # Original corners relative to center
        half_w = width / 2
        half_h = height / 2
        corners = [
            (-half_w, -half_h),  # top-left
            (half_w, -half_h),   # top-right
            (half_w, half_h),    # bottom-right
            (-half_w, half_h)    # bottom-left
        ]

        # Apply transformations: scale then rotate
        transformed_corners = []
        for x, y in corners:
            # Scale
            x_scaled = x * scale_x
            y_scaled = y * scale_y
            # Rotate
            x_rot = x_scaled * cos_r - y_scaled * sin_r
            y_rot = x_scaled * sin_r + y_scaled * cos_r
            transformed_corners.append((x_rot, y_rot))

        # Calculate bounding box
        x_coords = [x for x, y in transformed_corners]
        y_coords = [y for x, y in transformed_corners]

        min_x = min(x_coords)
        max_x = max(x_coords)
        min_y = min(y_coords)
        max_y = max(y_coords)

        return min_x, min_y, max_x, max_y

    @staticmethod
    def _normalize_state(state, border_width, board_width, board_height):
        default_state = {
            "x": border_width + board_width / 2,
            "y": border_width + board_height / 2,
            "scaleX": 1.0,
            "scaleY": 1.0,
            "rotation": 0.0,
            "skewX": 0.0,
            "skewY": 0.0,
            "brightness": AdjustmentUtils.DEFAULT_BRIGHTNESS,
            "contrast": AdjustmentUtils.DEFAULT_CONTRAST,
            "saturation": AdjustmentUtils.DEFAULT_SATURATION,
            "opacity": AdjustmentUtils.DEFAULT_OPACITY,
            "visible": True,
            "order": None,
            "filename": None,
        }
        if not isinstance(state, dict):
            return default_state

        normalized = default_state.copy()
        normalized["x"] = float(state.get("x", normalized["x"]))
        normalized["y"] = float(state.get("y", normalized["y"]))
        normalized["scaleX"] = float(state.get("scaleX", normalized["scaleX"]))
        normalized["scaleY"] = float(state.get("scaleY", normalized["scaleY"]))
        normalized["rotation"] = float(state.get("rotation", normalized["rotation"]))
        normalized["skewX"] = float(state.get("skewX", normalized["skewX"]))
        normalized["skewY"] = float(state.get("skewY", normalized["skewY"]))

        # 使用统一的调节工具规范化调节参数
        adjustment_state = {
            "brightness": state.get("brightness"),
            "contrast": state.get("contrast"),
            "saturation": state.get("saturation"),
            "opacity": state.get("opacity")
        }
        normalized_adjustment = AdjustmentUtils.normalize_adjustment_state(adjustment_state)

        normalized["brightness"] = normalized_adjustment["brightness"]
        normalized["contrast"] = normalized_adjustment["contrast"]
        normalized["saturation"] = normalized_adjustment["saturation"]
        normalized["opacity"] = normalized_adjustment["opacity"]

        normalized["visible"] = bool(state.get("visible", True))
        if isinstance(state.get("filename"), str):
            normalized["filename"] = state.get("filename")
        try:
            normalized["order"] = int(state.get("order")) if state.get("order") is not None else None
        except (TypeError, ValueError):
            normalized["order"] = None
        return normalized

    def _apply_coordinate_based_transform(self, pil_img, scale_x=1.0, scale_y=1.0, rotation=0.0, skew_x=0.0, skew_y=0.0):
        """
        Apply transformations using optimized coordinate-based approach.
        Uses NumPy vectorization for performance while maintaining frontend-backend consistency.

        Args:
            pil_img (PIL.Image): Input image to transform.
            scale_x (float): X-axis scale factor.
            scale_y (float): Y-axis scale factor.
            rotation (float): Rotation angle in degrees.
            skew_x (float): X-axis skew angle in degrees.
            skew_y (float): Y-axis skew angle in degrees.

        Returns:
            PIL.Image: Transformed image.
        """
        try:
            import math

            # Convert to numpy array
            img_array = np.array(pil_img)
            original_height, original_width = img_array.shape[:2]

            # If no transformations needed, return original image
            if (abs(scale_x - 1.0) < 1e-6 and abs(scale_y - 1.0) < 1e-6 and
                abs(rotation) < 1e-6 and abs(skew_x) < 1e-6 and abs(skew_y) < 1e-6):
                return pil_img

            # Calculate bounding box of transformed image
            min_x, min_y, max_x, max_y = self._calculate_transformed_corners(
                original_width, original_height, scale_x, scale_y, rotation
            )

            # Calculate output dimensions
            output_width = max(1, int(math.ceil(max_x - min_x)))
            output_height = max(1, int(math.ceil(max_y - min_y)))

            # Create coordinate grids for vectorized transformation
            y_out, x_out = np.mgrid[0:output_height, 0:output_width]

            # Convert to coordinates relative to center of transformed image
            x_rel = x_out.astype(np.float32) + min_x
            y_rel = y_out.astype(np.float32) + min_y

            # Convert angles to radians
            rotation_rad = math.radians(rotation)
            skew_x_rad = math.radians(skew_x)
            skew_y_rad = math.radians(skew_y)

            cos_r = math.cos(rotation_rad)
            sin_r = math.sin(rotation_rad)

            # Apply inverse transformations in reverse order using vectorized operations
            # 1. Inverse skew
            if abs(skew_x) > 1e-6 or abs(skew_y) > 1e-6:
                det = 1 - math.tan(skew_x_rad) * math.tan(skew_y_rad)
                if abs(det) > 1e-6:
                    x_skew = (x_rel - math.tan(skew_x_rad) * y_rel) / det
                    y_skew = (y_rel - math.tan(skew_y_rad) * x_rel) / det
                else:
                    x_skew = x_rel
                    y_skew = y_rel
            else:
                x_skew = x_rel
                y_skew = y_rel

            # 2. Inverse rotation
            x_rot = x_skew * cos_r + y_skew * sin_r
            y_rot = -x_skew * sin_r + y_skew * cos_r

            # 3. Inverse scale
            if abs(scale_x) > 1e-6 and abs(scale_y) > 1e-6:
                x_scaled = x_rot / scale_x
                y_scaled = y_rot / scale_y
            else:
                x_scaled = x_rot
                y_scaled = y_rot

            # Convert back to original coordinate system (center to top-left)
            x_orig = x_scaled + original_width / 2
            y_orig = y_scaled + original_height / 2

            # Create mask for pixels within original image bounds
            valid_mask = ((x_orig >= 0) & (x_orig < original_width - 1) &
                         (y_orig >= 0) & (y_orig < original_height - 1))

            # Use scipy for fast interpolation if available, otherwise fallback to simpler method
            try:
                from scipy import ndimage

                # Create output image
                if img_array.shape[-1] == 4:
                    output_img = np.zeros((output_height, output_width, 4), dtype=np.uint8)
                    for channel in range(4):
                        output_img[:, :, channel] = ndimage.map_coordinates(
                            img_array[:, :, channel],
                            [y_orig, x_orig],
                            order=1,
                            mode='constant',
                            cval=0
                        ).astype(np.uint8)
                else:
                    output_img = np.zeros((output_height, output_width, 3), dtype=np.uint8)
                    for channel in range(3):
                        output_img[:, :, channel] = ndimage.map_coordinates(
                            img_array[:, :, channel],
                            [y_orig, x_orig],
                            order=1,
                            mode='constant',
                            cval=0
                        ).astype(np.uint8)

            except ImportError:
                # Fallback to simpler method without scipy
                logger.warning("scipy not available, using fallback transformation method")

                # Create output image
                if img_array.shape[-1] == 4:
                    output_img = np.zeros((output_height, output_width, 4), dtype=np.uint8)
                else:
                    output_img = np.zeros((output_height, output_width, 3), dtype=np.uint8)

                # Get integer coordinates and weights for bilinear interpolation
                x0 = np.floor(x_orig).astype(np.int32)
                y0 = np.floor(y_orig).astype(np.int32)
                x1 = x0 + 1
                y1 = y0 + 1

                wx = x_orig - x0
                wy = y_orig - y0

                # Clamp coordinates to valid range
                x0 = np.clip(x0, 0, original_width - 1)
                x1 = np.clip(x1, 0, original_width - 1)
                y0 = np.clip(y0, 0, original_height - 1)
                y1 = np.clip(y1, 0, original_height - 1)

                # Perform bilinear interpolation for each channel
                channels = img_array.shape[-1]
                for c in range(channels):
                    # Get pixel values at the four corners
                    top_left = img_array[y0, x0, c]
                    top_right = img_array[y0, x1, c]
                    bottom_left = img_array[y1, x0, c]
                    bottom_right = img_array[y1, x1, c]

                    # Interpolate
                    top = (1 - wx) * top_left + wx * top_right
                    bottom = (1 - wx) * bottom_left + wx * bottom_right
                    interpolated = (1 - wy) * top + wy * bottom

                    # Apply valid mask
                    output_img[:, :, c] = np.where(valid_mask, interpolated.astype(np.uint8), 0)

            if img_array.shape[-1] == 4:
                return Image.fromarray(output_img, mode="RGBA")
            else:
                return Image.fromarray(output_img, mode="RGB")

        except Exception as e:
            logger.error(f"Coordinate-based transformation failed: {e}")
            return pil_img

    def _apply_brightness_contrast(self, pil_img, brightness=0.0, contrast=0.0, saturation=0.0):
        """
        应用亮度、对比度、饱和度调整，使用统一的调节算法。
        注意：不处理透明度，透明度将在合成时单独处理，以匹配前端Konva的行为。
        """
        # 使用统一的调节算法
        return AdjustmentAlgorithms.apply_adjustments(
            pil_img,
            brightness=brightness,
            contrast=contrast,
            saturation=saturation
        )

    def _alpha_composite(self, background, foreground, x, y, opacity=1.0):
        """
        使用预乘alpha（pre-multiplied alpha）合成算法将前景图像合成到背景上。
        使用统一的调节算法，确保与前端Konva.js的GPU合成效果一致。

        Args:
            background: PIL.Image (RGBA) 背景图像
            foreground: PIL.Image (RGBA) 前景图像
            x, y: 前景图像在背景上的位置
            opacity: 前景图像的透明度 (0.0-1.0)

        Returns:
            PIL.Image: 合成后的图像
        """
        # 直接使用统一的调节算法中的合成方法
        return AdjustmentAlgorithms.alpha_composite(background, foreground, x, y, opacity)

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

    def render(
        self,
        pack_images,
        board_width: int,
        board_height: int,
        border_width: int,
        canvas_color: str,
        display_scale: float,
        auto_size: str,
        image_states: str,
        file_data=None,
        canvas_config=None,
        layer_data=None,
    ):
        logger.info(
            f"Instance {self.instance_id} - Rendering with inputs: board_width={board_width}, board_height={board_height}, "
            f"border_width={border_width}, canvas_color={canvas_color}, display_scale={display_scale}, auto_size={auto_size}, "
            f"file_data={'present' if file_data else 'None'}, "
            f"canvas_config={'present' if canvas_config else 'None'}, "
            f"layer_data={'present' if layer_data else 'None'}"
        )

        # Normalize file_data into a dict if possible (supports JSON string/bytes wrappers)
        parsed_file_data = file_data
        if parsed_file_data and not isinstance(parsed_file_data, dict):
            try:
                if isinstance(parsed_file_data, (bytes, bytearray)):
                    parsed_file_data = parsed_file_data.decode("utf-8")
                if isinstance(parsed_file_data, str):
                    parsed_file_data = json.loads(parsed_file_data)
                elif isinstance(parsed_file_data, dict) and "content" in parsed_file_data and isinstance(parsed_file_data["content"], str):
                    parsed_file_data = json.loads(parsed_file_data["content"])
            except Exception as e:
                logger.warning(f"Instance {self.instance_id} - Failed to decode file_data, keeping original: {e}")
                parsed_file_data = file_data

        # Validate inputs
        if pack_images is None:
            logger.error(f"Instance {self.instance_id} - images input cannot be None")
            raise ValueError("images input must be provided")

        try:
            display_scale = float(display_scale)
        except (TypeError, ValueError):
            logger.error(f"Instance {self.instance_id} - Invalid display_scale type: {display_scale}")
            raise ValueError("display_scale must be a float")

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
            if "display_scale" in canvas_config:
                try:
                    display_scale = float(canvas_config["display_scale"])
                    display_scale = max(0.1, min(1.0, display_scale))
                    logger.info(f"Instance {self.instance_id} - Updated display_scale from canvas_config: {display_scale}")
                except (ValueError, TypeError):
                    logger.warning(f"Instance {self.instance_id} - Invalid display_scale in canvas_config: {canvas_config['display_scale']}")
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
        if not (0.1 <= display_scale <= 1.0):
            logger.error(f"Instance {self.instance_id} - Invalid display_scale: {display_scale}")
            raise ValueError(f"Invalid display_scale: {display_scale}")
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

        # Extract canvas size from file_data if provided
        file_canvas_width = None
        file_canvas_height = None
        if isinstance(parsed_file_data, dict):
            try:
                canvas_info = parsed_file_data.get("canvas", {})
                if isinstance(canvas_info, dict):
                    cw = canvas_info.get("width")
                    ch = canvas_info.get("height")
                    if cw is not None and ch is not None:
                        file_canvas_width = max(256, min(8192, int(cw)))
                        file_canvas_height = max(256, min(8192, int(ch)))
                        logger.info(
                            f"Instance {self.instance_id} - Detected canvas size from file_data: {file_canvas_width}x{file_canvas_height}"
                        )
            except Exception as e:
                logger.warning(f"Instance {self.instance_id} - Failed to parse canvas size from file_data: {e}")

        # Handle auto_size with priority: file_data canvas > first image dimensions
        if auto_size == "on":
            if file_canvas_width is not None and file_canvas_height is not None:
                board_width = file_canvas_width
                board_height = file_canvas_height
                logger.info(
                    f"Instance {self.instance_id} - Auto-size enabled, using board size {board_width}x{board_height} from file_data canvas"
                )
            elif images_list:
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

        # Handle layer_data from upstream node
        if layer_data:
            logger.info(f"Instance {self.instance_id} - Processing layer_data: {layer_data}")
            # Update parameters from layer_data
            if "canvas_width" in layer_data:
                board_width = max(256, min(8192, int(layer_data["canvas_width"])))
                logger.info(f"Instance {self.instance_id} - Updated board_width from layer_data: {board_width}")
            if "canvas_height" in layer_data:
                board_height = max(256, min(8192, int(layer_data["canvas_height"])))
                logger.info(f"Instance {self.instance_id} - Updated board_height from layer_data: {board_height}")
            if "border_width" in layer_data:
                border_width = max(10, min(200, int(layer_data["border_width"])))
                logger.info(f"Instance {self.instance_id} - Updated border_width from layer_data: {border_width}")

            # Apply layer states from layer_data
            if "layers" in layer_data and layer_data["layers"]:
                logger.info(f"Instance {self.instance_id} - Applying layer states from layer_data")
                new_image_states = []
                sorted_layers = sorted(
                    layer_data["layers"],
                    key=lambda l: l.get("order", layer_data["layers"].index(l))
                )
                for layer_info in sorted_layers:
                    normalized_state = self._normalize_state(layer_info, border_width, board_width, board_height)
                    new_image_states.append(normalized_state)
                image_states = new_image_states
                logger.info(f"Instance {self.instance_id} - Applied {len(image_states)} layer states from layer_data")

        # Only parse image_states if not already processed from layer_data
        if not layer_data or "layers" not in layer_data:
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
            new_image_states = None

            if isinstance(parsed_file_data, dict) and parsed_file_data.get("layers"):
                logger.info(f"Instance {self.instance_id} - Applying layer states from file_data")
                image_states = []
                for i, layer in enumerate(parsed_file_data.get("layers", [])):
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
                            "visible": layer.get("visible", True),
                            "order": layer.get("order", i),
                            "filename": image_paths[i] if i < len(image_paths) else None,
                        }
                    )
                # Pad with default states if fewer layers in file_data
                for i in range(len(parsed_file_data["layers"]), len(image_paths)):
                    image_states.append(
                        {
                            "x": border_width + board_width / 2,
                            "y": border_width + board_height / 2,
                            "scaleX": 1.0,
                            "scaleY": 1.0,
                            "rotation": 0.0,
                            "visible": True,
                            "order": i,
                            "filename": image_paths[i] if i < len(image_paths) else None,
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
                                "visible": True,
                                "order": i,
                                "filename": image_paths[i] if i < len(image_paths) else None,
                            }
                        )
            if new_image_states is not None:
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
                            "visible": True,
                            "order": i,
                            "filename": image_paths[i] if i < len(image_paths) else None,
                        }
                    )
            # Only overwrite if we actually built a replacement list
            if new_image_states is not None:
                image_states = new_image_states
            self.properties["image_states"] = image_states

        image_states = [
            self._normalize_state(state, border_width, board_width, board_height)
            for state in image_states
        ]
        # Ensure order存在，默认按索引，并重排为连续序号
        for idx, state in enumerate(image_states):
            if state.get("order") is None:
                state["order"] = idx
        # Re-sequence orders to avoid duplicates/invalid values
        ordered_indices = sorted(
            range(len(image_states)),
            key=lambda i: image_states[i].get("order", i)
        )
        for new_order, idx in enumerate(ordered_indices):
            image_states[idx]["order"] = new_order
        self.properties["image_states"] = image_states
        logger.info(
            f"Instance {self.instance_id} - Incoming layer states (idx, order, filename): "
            f"{[(i, s.get('order'), s.get('filename')) for i, s in enumerate(image_states)]}"
        )

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
        mask_list = [torch.zeros((board_height, board_width), dtype=torch.float32) for _ in image_states]
        layer_images = [torch.zeros((board_height, board_width, 4), dtype=torch.float32) for _ in image_states]

        # Build rendering order by state order; ignore filename (may change per run)
        render_list = []
        for idx, (path, st) in enumerate(zip(image_paths, image_states)):
            order_val = st.get("order", idx)
            if order_val is None:
                order_val = idx
            render_list.append((order_val, idx, path, st))

        render_list.sort(key=lambda tup: tup[0])
        logger.info(
            f"Instance {self.instance_id} - Render order (order, idx, filename): "
            f"{[(o, idx, st.get('filename')) for o, idx, _, st in render_list]}"
        )

        for _, i, path, state in render_list:
            try:
                if not state.get("visible", True):
                    # 保持占位，但不渲染到画布
                    continue
                img = Image.open(os.path.join(self.output_dir, path)).convert("RGBA")
                brightness = state.get("brightness", 0.0)
                contrast = state.get("contrast", 0.0)
                saturation = state.get("saturation", 0.0)
                opacity = state.get("opacity", 100.0)
                if abs(brightness) > 1e-3 or abs(contrast) > 1e-3 or abs(saturation) > 1e-3:
                    img = self._apply_brightness_contrast(img, brightness, contrast, saturation)
                alpha = img.split()[3]
                mask = Image.new("L", (board_width, board_height), 0)

                # Get transformation parameters
                scale_x = state.get("scaleX", 1.0)
                scale_y = state.get("scaleY", 1.0)
                rotation = state.get("rotation", 0.0)
                skew_x = state.get("skewX", 0.0)
                skew_y = state.get("skewY", 0.0)

                # Calculate transformed dimensions for coordinate-based positioning
                original_width, original_height = img.size
                transformed_width, transformed_height = self._calculate_transformed_dimensions(
                    original_width, original_height, scale_x, scale_y, rotation
                )

                # Apply transformations using coordinate-based approach for perfect consistency
                if scale_x != 1.0 or scale_y != 1.0 or rotation != 0.0 or skew_x != 0.0 or skew_y != 0.0:
                    # Apply transformations to image (no need to reverse rotation direction)
                    img = self._apply_coordinate_based_transform(img, scale_x, scale_y, rotation, skew_x, skew_y)

                    # Apply transformations to alpha channel
                    # Convert alpha to RGBA format for consistent transformation
                    alpha_rgba = Image.merge("RGBA", (alpha, alpha, alpha, alpha))
                    alpha_transformed = self._apply_coordinate_based_transform(alpha_rgba, scale_x, scale_y, rotation, skew_x, skew_y)
                    alpha = alpha_transformed.split()[0]  # Extract the first channel (all channels are same)

                # Calculate paste position (center-based)
                # Frontend coordinates: center of transformed image including border
                # Backend coordinates: top-left of transformed image excluding border
                frontend_x = state.get("x", border_width + board_width / 2)
                frontend_y = state.get("y", border_width + board_height / 2)

                # Convert frontend center coordinates to backend top-left coordinates
                # Remove border offset and convert center to top-left
                backend_x = frontend_x - border_width - img.width / 2
                backend_y = frontend_y - border_width - img.height / 2

                paste_x = int(backend_x)
                paste_y = int(backend_y)

                # Ensure paste area is within canvas
                # Calculate the visible area of the image
                visible_x1 = max(0, -paste_x)
                visible_y1 = max(0, -paste_y)
                visible_x2 = min(img.width, board_width - paste_x)
                visible_y2 = min(img.height, board_height - paste_y)

                # Only crop if there's actually something visible
                if visible_x1 < visible_x2 and visible_y1 < visible_y2:
                    img_cropped = img.crop((visible_x1, visible_y1, visible_x2, visible_y2))
                    alpha_cropped = alpha.crop((visible_x1, visible_y1, visible_x2, visible_y2))
                else:
                    # No visible area, skip this image
                    mask_list.append(torch.zeros((board_height, board_width), dtype=torch.float32))
                    layer_images.append(torch.zeros((board_height, board_width, 4), dtype=torch.float32))
                    continue

                # 使用预乘alpha合成算法将图像合成到画布
                # 使用统一的透明度转换工具
                opacity_value = AdjustmentUtils.opacity_to_alpha(opacity)
                canvas_pil = self._alpha_composite(canvas_pil, img_cropped, max(0, paste_x), max(0, paste_y), opacity_value)

                # 更新mask
                mask.paste(alpha_cropped, (max(0, paste_x), max(0, paste_y)))
                mask_list[i] = torch.from_numpy(np.array(mask, dtype=np.float32) / 255.0)

                # 创建单独的图层图像
                layer_canvas = Image.new("RGBA", (board_width, board_height), (0, 0, 0, 0))
                layer_canvas.paste(img_cropped, (max(0, paste_x), max(0, paste_y)), img_cropped)
                layer_rgba = torch.from_numpy(np.array(layer_canvas).astype(np.float32) / 255.0)
                layer_images[i] = layer_rgba
            except Exception as e:
                logger.error(f"Instance {self.instance_id} - Failed to apply image {i+1}: {e}")
                mask_list[i] = torch.zeros((board_height, board_width), dtype=torch.float32)
                layer_images[i] = torch.zeros((board_height, board_width, 4), dtype=torch.float32)

        # Ensure mask_list is not empty
        if not mask_list:
            logger.warning(f"Instance {self.instance_id} - No valid masks generated, returning default mask")
            mask_list = [torch.zeros((board_height, board_width), dtype=torch.float32)]
        if not layer_images:
            layer_images = [torch.zeros((board_height, board_width, 4), dtype=torch.float32)]

        masks_tensor = (
            torch.stack(mask_list, dim=0)
            if mask_list
            else torch.zeros((1, board_height, board_width), dtype=torch.float32)
        )
        layer_images_tensor = (
            torch.stack(layer_images, dim=0)
            if layer_images
            else torch.zeros((1, board_height, board_width, 4), dtype=torch.float32)
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
            "display_scale": float(display_scale),
        }
        self.properties["image_states"] = image_states
        # Generate layer_data for downstream nodes
        layer_data_output = {
            "version": "1.0",
            "canvas_width": board_width,
            "canvas_height": board_height,
            "border_width": border_width,
            "layers": []
        }

        # Add layer information
        for i, state in enumerate(image_states):
            if not isinstance(state, dict):
                # Handle case where state might not be a dictionary
                logger.warning(f"Instance {self.instance_id} - Invalid state type at index {i}: {type(state)}")
                state = {}

            layer_data_output["layers"].append({
                "index": i,
                "x": state.get("x", border_width + board_width / 2),
                "y": state.get("y", border_width + board_height / 2),
                "scaleX": state.get("scaleX", 1.0),
                "scaleY": state.get("scaleY", 1.0),
                "rotation": state.get("rotation", 0.0),
                "skewX": state.get("skewX", 0.0),
                "skewY": state.get("skewY", 0.0),
                "brightness": state.get("brightness", 0.0),
                "contrast": state.get("contrast", 0.0),
                "saturation": state.get("saturation", 0.0),
                "opacity": state.get("opacity", 100.0),  # Default opacity 100%
                "visible": state.get("visible", True),   # Visibility from state
                "order": state.get("order", i),
                "filename": state.get("filename"),
            })

        logger.info(
            f"Instance {self.instance_id} - Rendering completed: board_size={board_width}x{board_height}, "
            f"image_count={len(image_paths)}, auto_size={auto_size}"
        )
        return {
            "ui": {
                "image_states": image_states,
                "image_base64_chunks": image_base64_chunks,
                "image_paths": image_paths,
                # Wrap scalar values in lists to satisfy UI aggregation expectations
                "board_width": [board_width],
                "board_height": [board_height],
                "border_width": [border_width],
                "auto_size": [auto_size],
            },
            "result": (canvas_tensor, masks_tensor, layer_images_tensor, layer_data_output),
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