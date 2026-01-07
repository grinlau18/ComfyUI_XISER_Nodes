"""
XISER Reorder Images Node for ComfyUI - V3版本
Manages image reordering with frontend-managed state
"""

import os
import logging
import numpy as np
import torch
from PIL import Image
import folder_paths
import base64
from io import BytesIO
import json
import hashlib
import time
import shutil
import threading
from concurrent.futures import ThreadPoolExecutor

from comfy_api.v0_0_2 import io

# Log level control
LOG_LEVEL = "info"  # Options: "info", "warning", "error", "debug"

# Initialize logger
logger = logging.getLogger("XISER_ReorderImages")
logger.setLevel(getattr(logging, LOG_LEVEL.upper(), logging.ERROR))

# Cleanup threshold for old files (7 days)
CLEANUP_THRESHOLD_SECONDS = 7 * 24 * 60 * 60
CLEANUP_INTERVAL_SECONDS = 24 * 60 * 60  # Run cleanup every 24 hours

# State version tracking removed - now handled through widget system

class XIS_ReorderImagesV3(io.ComfyNode):
    """A custom node for reordering images with frontend-managed state."""

    @classmethod
    def define_schema(cls) -> io.Schema:
        """Define input types for the node."""
        return io.Schema(
            node_id="XIS_ReorderImages",
            display_name="Reorder Images",
            category="XISER_Nodes/Visual_Editing",
            description="管理图像重排序，支持前端管理的状态。",
            inputs=[
                io.Image.Input("pack_images", tooltip="要重新排序的图像列表"),
            ],
            hidden=[
                io.String.Input("image_order", default="[]", multiline=False, tooltip="图像顺序（JSON格式）"),
                io.String.Input("node_id", default="", multiline=False, tooltip="节点ID")
            ],
            outputs=[
                io.Image.Output(display_name="pack_images")
            ],
            is_output_node=True
        )

    @classmethod
    def fingerprint_inputs(cls, pack_images, image_order="[]", node_id="", **kwargs):
        """Compute a lightweight hash to determine if node execution is needed."""
        # fingerprint_inputs is called BEFORE node execution and should only depend on input parameters
        # not on any node state that gets updated during execution

        hasher = hashlib.sha256()

        # Hash pack_images input - this is the primary source of changes
        if pack_images is not None and isinstance(pack_images, list):
            image_count = len(pack_images)
            hasher.update(f"count:{image_count}".encode('utf-8'))
            for i, img in enumerate(pack_images):
                if isinstance(img, torch.Tensor):
                    # Hash tensor metadata and a content sample
                    hasher.update(f"{i}:{tuple(img.shape)}:{img.dtype}:{img.device}".encode('utf-8'))
                    if img.numel() > 0:
                        # Sample content for change detection
                        sample_size = min(10, img.numel())
                        step = max(1, img.numel() // sample_size)
                        sample_indices = torch.arange(0, img.numel(), step)[:sample_size]
                        sample_values = img.view(-1)[sample_indices]
                        hasher.update(sample_values.cpu().numpy().tobytes())
        else:
            hasher.update("none".encode('utf-8'))

        # IMPORTANT: Do NOT hash widget values (image_order)
        # Widget values change after execution due to frontend state updates and would
        # prevent proper caching. The frontend state should be managed separately
        # from the execution caching logic.

        # DEBUG: Log basic information for troubleshooting
        if logger.isEnabledFor(logging.DEBUG):
            logger.debug(f"fingerprint_inputs pack_images count: {len(pack_images) if pack_images else 0}")

        return hasher.hexdigest()

    @classmethod
    def execute(cls, pack_images, image_order="[]", node_id="") -> io.NodeOutput:
        """Process images, generate previews, and reorder based on frontend order."""
        if logger.isEnabledFor(logging.INFO):
            logger.info(f"Node {node_id}: Processing {len(pack_images)} images, order: {image_order}")

        # Validate input
        if pack_images is None or not isinstance(pack_images, list):
            if logger.isEnabledFor(logging.ERROR):
                logger.error(f"Node {node_id}: Invalid pack_images: expected list, got {type(pack_images)}")
            raise ValueError("pack_images must be provided as a list")
        if not pack_images:
            if logger.isEnabledFor(logging.ERROR):
                logger.error(f"Node {node_id}: No images provided")
            raise ValueError("At least one image must be provided")
        if len(pack_images) > 50 and logger.isEnabledFor(logging.WARNING):
            logger.warning(f"Node {node_id}: Large number of images: {len(pack_images)}")
        for img in pack_images:
            if not isinstance(img, torch.Tensor) or img.shape[-1] != 4:
                if logger.isEnabledFor(logging.ERROR):
                    logger.error(f"Node {node_id}: Invalid image format: expected RGBA torch.Tensor, got {img.shape}")
                raise ValueError("All images must be RGBA torch.Tensor")

        # Parse frontend order (this is the filtered order containing only enabled images)
        try:
            filtered_order = json.loads(image_order) if image_order and image_order != "[]" else [i for i in range(len(pack_images))]
            filtered_order = cls._validate_image_order(filtered_order, len(pack_images))
        except Exception as e:
            if logger.isEnabledFor(logging.ERROR):
                logger.error(f"Node {node_id}: Failed to parse image_order: {e}")
            filtered_order = [i for i in range(len(pack_images))]

        # Get or initialize the full order (all images, not just enabled ones)
        # Note: In V3, we need to manage state differently since we can't store instance state
        # We'll use a class-level cache for this node's state
        full_order = cls._get_node_state(node_id, "full_image_order")
        if full_order is None or len(full_order) != len(pack_images):
            # Initialize or update full order when image count changes
            if full_order is not None and len(full_order) > 0:
                # Preserve existing order for existing images, add new ones to end
                valid_order = [idx for idx in full_order if isinstance(idx, int) and idx < len(pack_images)]
                missing_indices = sorted(set(range(len(pack_images))) - set(valid_order))
                full_order = valid_order + missing_indices
            else:
                full_order = [i for i in range(len(pack_images))]

            cls._set_node_state(node_id, "full_image_order", full_order)
            if logger.isEnabledFor(logging.INFO):
                logger.info(f"Node {node_id}: Updated full order for {len(pack_images)} images: {full_order}")

        # Use the filtered order for output (contains only enabled images)
        order = filtered_order

        # Generate previews with caching
        image_previews = []
        input_hash = cls._compute_image_hash(pack_images)

        # DEBUG: Log hash comparison
        if logger.isEnabledFor(logging.DEBUG):
            logger.debug(f"Node {node_id}: input_hash={input_hash}, last_input_hash={cls._get_node_state(node_id, 'last_input_hash')}")

        # Check if we need to regenerate previews
        last_input_hash = cls._get_node_state(node_id, "last_input_hash")
        cached_previews = cls._get_node_state(node_id, "image_previews")

        need_new_previews = (input_hash != last_input_hash or
                           not cached_previews or
                           len(cached_previews) != len(pack_images))

        if need_new_previews:
            cls._set_node_state(node_id, "last_input_hash", input_hash)

            # DEBUG: Log hash update
            if logger.isEnabledFor(logging.DEBUG):
                logger.debug(f"Node {node_id}: Updating last_input_hash to {input_hash}")

            with ThreadPoolExecutor() as executor:
                futures = []
                for i, img_tensor in enumerate(pack_images):
                    img = (img_tensor.cpu().numpy() * 255).clip(0, 255).astype(np.uint8)
                    pil_img = Image.fromarray(img, mode="RGBA")
                    futures.append(executor.submit(cls._generate_base64_thumbnail, pil_img))
                image_previews = [
                    {
                        "id": idx,
                        "preview": future.result(),
                        "width": img.shape[1],
                        "height": img.shape[0]
                    } for idx, (img, future) in enumerate(zip(pack_images, futures))
                ]
            cls._set_node_state(node_id, "image_previews", image_previews)
        else:
            image_previews = cached_previews

        # Reordered images - use the filtered order directly
        # image_order parameter already contains only enabled images in the correct order
        reordered_images = [pack_images[i] for i in order if i < len(pack_images)]

        if logger.isEnabledFor(logging.INFO):
            logger.info(f"Node {node_id}: Returning {len(reordered_images)} images")

        # Return with UI data
        ui_data = {
            "image_previews": image_previews,
            "full_image_order": full_order  # Send full order back to frontend for state maintenance
        }

        return io.NodeOutput(reordered_images, ui=ui_data)

    @classmethod
    def _generate_base64_thumbnail(cls, pil_img, max_size=64, format="WEBP"):
        """Generate a scaled thumbnail as Base64 data for frontend preview."""
        # Simple caching at class level
        img_key = hashlib.sha256(pil_img.tobytes()).hexdigest()

        # Check class-level cache
        if not hasattr(cls, '_preview_cache'):
            cls._preview_cache = {}

        if img_key in cls._preview_cache:
            return cls._preview_cache[img_key]

        img_width, img_height = pil_img.size
        scale = min(max_size / img_width, max_size / img_height, 1.0)
        new_size = (int(img_width * scale), int(img_height * scale))
        thumbnail = pil_img.resize(new_size, Image.Resampling.LANCZOS)
        buffered = BytesIO()
        thumbnail.save(buffered, format=format, optimize=True, quality=85)
        b64_data = base64.b64encode(buffered.getvalue()).decode("utf-8")
        cls._preview_cache[img_key] = b64_data
        return b64_data

    @classmethod
    def _compute_image_hash(cls, images):
        """Compute a content-based hash for the image list."""
        hasher = hashlib.sha256()

        if images is not None and isinstance(images, list):
            image_count = len(images)
            hasher.update(f"count:{image_count}".encode('utf-8'))
            for i, img in enumerate(images):
                if isinstance(img, torch.Tensor):
                    # Include detailed tensor information for content-based change detection
                    hasher.update(f"{i}:{tuple(img.shape)}:{img.dtype}:{img.device}".encode('utf-8'))
                    # Include a small sample of tensor data for content-based change detection
                    if img.numel() > 0:
                        sample_size = min(10, img.numel())
                        # Use deterministic sampling for consistent hashing
                        step = max(1, img.numel() // sample_size)
                        sample_indices = torch.arange(0, img.numel(), step)[:sample_size]
                        sample_values = img.view(-1)[sample_indices]
                        hasher.update(sample_values.cpu().numpy().tobytes())
        else:
            hasher.update("none".encode('utf-8'))

        return hasher.hexdigest()

    @classmethod
    def _validate_image_order(cls, order, num_images):
        """Validate image_order, ensuring all indices are valid."""
        if not isinstance(order, list):
            if logger.isEnabledFor(logging.WARNING):
                logger.warning(f"Invalid image_order type: {type(order)}, resetting")
            return [i for i in range(num_images)]
        valid_order = [idx for idx in order if isinstance(idx, int) and 0 <= idx < num_images]
        if not valid_order:
            if logger.isEnabledFor(logging.WARNING):
                logger.warning(f"No valid indices in image_order: {order}, resetting")
            return [i for i in range(num_images)]
        return valid_order

    @classmethod
    def _get_node_state(cls, node_id, key):
        """Get node state from class-level cache."""
        if not hasattr(cls, '_node_state_cache'):
            cls._node_state_cache = {}

        node_cache = cls._node_state_cache.get(node_id, {})
        return node_cache.get(key)

    @classmethod
    def _set_node_state(cls, node_id, key, value):
        """Set node state in class-level cache."""
        if not hasattr(cls, '_node_state_cache'):
            cls._node_state_cache = {}

        if node_id not in cls._node_state_cache:
            cls._node_state_cache[node_id] = {}

        cls._node_state_cache[node_id][key] = value

    @classmethod
    def _get_output_dir(cls):
        """Get output directory."""
        output_dir = os.path.join(folder_paths.get_output_directory(), "xiser_reorder_images")
        os.makedirs(output_dir, exist_ok=True)
        return output_dir

    @classmethod
    def _cleanup_old_files(cls):
        """Clean up old files in output directory."""
        current_time = time.time()
        try:
            output_dir = cls._get_output_dir()
            for node_dir in os.listdir(output_dir):
                node_path = os.path.join(output_dir, node_dir)
                if os.path.isdir(node_path):
                    for file in os.listdir(node_path):
                        file_path = os.path.join(node_path, file)
                        if os.path.isfile(file_path):
                            file_mtime = os.path.getmtime(file_path)
                            if current_time - file_mtime > CLEANUP_THRESHOLD_SECONDS:
                                os.remove(file_path)
                                if logger.isEnabledFor(logging.INFO):
                                    logger.info(f"Removed old file: {file_path}")
                    if not os.listdir(node_path):
                        shutil.rmtree(node_path)
                        if logger.isEnabledFor(logging.INFO):
                            logger.info(f"Removed empty directory: {node_path}")
        except Exception as e:
            if logger.isEnabledFor(logging.ERROR):
                logger.error(f"Failed to clean up output directory: {e}")


# V3节点导出
V3_NODE_CLASSES = [XIS_ReorderImagesV3]

if logger.isEnabledFor(logging.INFO):
    logger.info("XIS_ReorderImagesV3 node registered")