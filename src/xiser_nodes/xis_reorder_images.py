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

# Log level control
LOG_LEVEL = "error"  # Options: "info", "warning", "error"

# Initialize logger
logger = logging.getLogger("XISER_ReorderImages")
logger.setLevel(getattr(logging, LOG_LEVEL.upper(), logging.ERROR))

# Cleanup threshold for old files (7 days)
CLEANUP_THRESHOLD_SECONDS = 7 * 24 * 60 * 60

class XIS_ReorderImages:
    """A custom node for reordering images with frontend-managed state."""

    def __init__(self):
        """Initialize the node with properties and output directory."""
        self.properties = {}  # Initialize properties dictionary
        self.output_dir = os.path.join(folder_paths.get_output_directory(), "xiser_reorder_images")
        os.makedirs(self.output_dir, exist_ok=True)
        self.last_input_hash = None
        if logger.isEnabledFor(logging.INFO):
            logger.info(f"XIS_ReorderImages initialized with output directory: {self.output_dir}")
        self._cleanup_old_files()

    @classmethod
    def INPUT_TYPES(cls):
        """Define input types for the node."""
        return {
            "required": {
                "pack_images": ("IMAGE", {"default": None}),
            },
            "hidden": {
                "image_order": ("STRING", {"default": "[]", "multiline": False}),
                "node_id": ("STRING", {"default": "", "multiline": False}),
            }
        }

    @classmethod
    def IS_CHANGED(cls, pack_images, image_order="[]", node_id="", **kwargs):
        """Compute a hash to determine if node execution is needed."""
        hasher = hashlib.sha256()
        # Hash pack_images
        if pack_images is not None and isinstance(pack_images, list):
            for img in pack_images:
                if isinstance(img, torch.Tensor):
                    hasher.update(img.cpu().numpy().tobytes())
        # Hash image_order
        hasher.update(image_order.encode('utf-8'))
        # Hash properties from instance (if available)
        instance = kwargs.get('instance', {})
        properties = instance.get('properties', {})
        hasher.update(json.dumps({
            'enabled_layers': properties.get('enabled_layers', []),
            'is_single_mode': properties.get('is_single_mode', False)
        }, sort_keys=True).encode('utf-8'))
        return hasher.hexdigest()

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("pack_images",)
    FUNCTION = "reorder_images"
    CATEGORY = "XISER_Nodes/Canvas"
    OUTPUT_NODE = True

    def _generate_base64_thumbnail(self, pil_img, max_size=64, format="PNG"):
        """Generate a scaled thumbnail as Base64 data for frontend preview."""
        img_width, img_height = pil_img.size
        scale = min(max_size / img_width, max_size / img_height, 1.0)
        new_size = (int(img_width * scale), int(img_height * scale))
        thumbnail = pil_img.resize(new_size, Image.Resampling.LANCZOS)
        buffered = BytesIO()
        thumbnail.save(buffered, format=format, optimize=True)
        return base64.b64encode(buffered.getvalue()).decode("utf-8")

    def _compute_image_hash(self, images):
        """Compute a hash for the image list based on content."""
        hasher = hashlib.sha256()
        for img in images:
            hasher.update(img.cpu().numpy().tobytes())
        return hasher.hexdigest()

    def _validate_image_order(self, order, num_images):
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

    def _get_node_output_dir(self, node_id):
        """Get node-specific output directory."""
        node_dir = os.path.join(self.output_dir, f"node_{node_id}")
        os.makedirs(node_dir, exist_ok=True)
        return node_dir

    def _cleanup_old_files(self):
        """Clean up old files in output directory."""
        current_time = time.time()
        try:
            for node_dir in os.listdir(self.output_dir):
                node_path = os.path.join(self.output_dir, node_dir)
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

    def reorder_images(self, pack_images, image_order="[]", node_id=""):
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

        # Parse frontend order
        try:
            order = json.loads(image_order) if image_order and image_order != "[]" else [i for i in range(len(pack_images))]
            order = self._validate_image_order(order, len(pack_images))
        except Exception as e:
            if logger.isEnabledFor(logging.ERROR):
                logger.error(f"Node {node_id}: Failed to parse image_order: {e}")
            order = [i for i in range(len(pack_images))]

        # Generate previews
        image_previews = []
        input_hash = self._compute_image_hash(pack_images)
        if input_hash != self.last_input_hash or not self.properties.get("image_previews"):
            self.last_input_hash = input_hash
            for i, img_tensor in enumerate(pack_images):
                img = (img_tensor.cpu().numpy() * 255).clip(0, 255).astype(np.uint8)
                pil_img = Image.fromarray(img, mode="RGBA")
                preview_b64 = self._generate_base64_thumbnail(pil_img)
                image_previews.append({
                    "id": i,  # Box number
                    "preview": preview_b64,
                    "width": img.shape[1],
                    "height": img.shape[0]
                })
            self.properties["image_previews"] = image_previews
        else:
            image_previews = self.properties.get("image_previews", [])

        # Reordered images
        reordered_images = [pack_images[i] for i in order if i < len(pack_images)]

        if logger.isEnabledFor(logging.INFO):
            logger.info(f"Node {node_id}: Returning {len(reordered_images)} images")
        return {
            "ui": {
                "image_previews": image_previews,
            },
            "result": (reordered_images,)
        }

    def __del__(self):
        """Clean up node-specific resources."""
        if logger.isEnabledFor(logging.INFO):
            logger.info("Cleaning up XIS_ReorderImages resources")
        self._cleanup_old_files()

NODE_CLASS_MAPPINGS = {
    "XIS_ReorderImages": XIS_ReorderImages
}
if logger.isEnabledFor(logging.INFO):
    logger.info("XIS_ReorderImages node registered")