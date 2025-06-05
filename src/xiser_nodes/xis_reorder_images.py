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

# Log level control
LOG_LEVEL = "error"  # Options: "info", "warning", "error"

# Initialize logger
logger = logging.getLogger("XISER_ReorderImages")
logger.setLevel(getattr(logging, LOG_LEVEL.upper(), logging.ERROR))

class XIS_ReorderImages:
    """A custom node for reordering images with support for single mode and layer toggling."""

    def __init__(self):
        """Initialize the node with properties and output directory.

        Attributes:
            properties (dict): Node properties for state persistence.
            output_dir (str): Directory for storing output files.
            last_input_hash (str): Hash of the last processed input.
            image_order (list): Current image order.
            state_version (int): Version of the node state for synchronization.
        """
        self.properties = {"state_version": 0}
        self.output_dir = os.path.join(folder_paths.get_output_directory(), "xiser_reorder_images")
        os.makedirs(self.output_dir, exist_ok=True)
        self.last_input_hash = None
        self.image_order = []
        if logger.isEnabledFor(logging.INFO):
            logger.info(f"XIS_ReorderImages initialized with output directory: {self.output_dir}")

    @classmethod
    def INPUT_TYPES(cls):
        """Define input types for the node.

        Returns:
            dict: Input specification with required and hidden fields.
        """
        return {
            "required": {
                "pack_images": ("XIS_IMAGES", {"default": None}),
            },
            "hidden": {
                "image_order": ("STRING", {"default": "[]", "multiline": False}),
                "enabled_layers": ("STRING", {"default": "[]", "multiline": False}),
                "node_id": ("STRING", {"default": "", "multiline": False}),
            }
        }

    RETURN_TYPES = ("XIS_IMAGES", "IMAGE",)
    RETURN_NAMES = ("pack_images", "images",)
    FUNCTION = "reorder_images"
    CATEGORY = "XISER_Nodes/Canvas"
    OUTPUT_NODE = True

    def _generate_base64_thumbnail(self, pil_img, max_size=64, format="PNG"):
        """Generate a scaled thumbnail as Base64 data for frontend preview.

        Args:
            pil_img (PIL.Image): Input image.
            max_size (int): Maximum thumbnail size (width or height).
            format (str): Image format (default: PNG).

        Returns:
            str: Base64-encoded thumbnail.
        """
        img_width, img_height = pil_img.size
        scale = min(max_size / img_width, max_size / img_height, 1.0)
        new_size = (int(img_width * scale), int(img_height * scale))
        thumbnail = pil_img.resize(new_size, Image.Resampling.LANCZOS)
        buffered = BytesIO()
        thumbnail.save(buffered, format=format, optimize=True)
        return base64.b64encode(buffered.getvalue()).decode("utf-8")

    def _compute_image_hash(self, images):
        """Compute a hash for the image list based on content.

        Args:
            images (list): List of torch.Tensor images.

        Returns:
            str: SHA256 hash of the image list.
        """
        hasher = hashlib.sha256()
        for img in images:
            hasher.update(img.cpu().numpy().tobytes())
        return hasher.hexdigest()

    def _validate_image_order(self, order, num_images, enabled_layers):
        """Validate image_order, including only enabled layers.

        Args:
            order (list): Proposed image order.
            num_images (int): Number of images.
            enabled_layers (list): Boolean flags for enabled layers.

        Returns:
            list: Validated order of enabled image indices.
        """
        if not isinstance(order, list) or not order:
            if logger.isEnabledFor(logging.WARNING):
                logger.warning(f"Invalid image_order: {order}, using enabled layers")
            return [i for i in range(num_images) if enabled_layers[i]]
        valid_order = [
            idx for idx in order
            if isinstance(idx, int) and 0 <= idx < num_images and enabled_layers[idx]
        ]
        if not valid_order:
            if logger.isEnabledFor(logging.WARNING):
                logger.warning(f"No valid enabled indices in image_order: {order}, using enabled layers")
            return [i for i in range(num_images) if enabled_layers[i]]
        if logger.isEnabledFor(logging.INFO):
            logger.info(f"Validated order: {valid_order}, enabled: {enabled_layers}")
        return valid_order

    def _normalize_images_for_preview(self, image_list):
        """Normalize images to maintain size and RGBA format.

        Args:
            image_list (list): List of torch.Tensor images.

        Returns:
            list: Normalized torch.Tensor images, or None if empty.
        """
        if not image_list:
            return None
        return [img.cpu().clamp(0, 1) for img in image_list]

    def _get_node_output_dir(self, node_id):
        """Get node-specific output directory.

        Args:
            node_id (str): Node identifier.

        Returns:
            str: Path to node-specific output directory.
        """
        node_dir = os.path.join(self.output_dir, f"node_{node_id}")
        os.makedirs(node_dir, exist_ok=True)
        return node_dir

    def reorder_images(self, pack_images, image_order="[]", enabled_layers="[]", node_id=""):
        """Process and reorder images based on image_order and enabled_layers.

        Args:
            pack_images (list): List of torch.Tensor images.
            image_order (str): JSON string of ordered image indices.
            enabled_layers (str): JSON string of boolean flags for enabled layers.
            node_id (str): Unique node identifier.

        Returns:
            dict: UI data and result tuple with reordered images.

        Raises:
            ValueError: If input validation fails.
        """
        if logger.isEnabledFor(logging.INFO):
            logger.info(f"Node {node_id}: Processing {len(pack_images)} images, order: {image_order}, enabled: {enabled_layers}")

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

        # Parse enabled layers
        try:
            enabled = (
                json.loads(enabled_layers)
                if enabled_layers and enabled_layers != "[]"
                else [True] * len(pack_images)
            )
            if len(enabled) != len(pack_images):
                if logger.isEnabledFor(logging.WARNING):
                    logger.warning(f"Node {node_id}: Invalid enabled_layers length: {len(enabled)}")
                enabled = [True] * len(pack_images)
        except Exception as e:
            if logger.isEnabledFor(logging.ERROR):
                logger.error(f"Node {node_id}: Failed to parse enabled_layers: {e}")
            enabled = [True] * len(pack_images)

        # Parse image order
        try:
            order = (
                json.loads(image_order)
                if image_order and image_order != "[]"
                else [i for i in range(len(pack_images)) if enabled[i]]
            )
        except Exception as e:
            if logger.isEnabledFor(logging.ERROR):
                logger.error(f"Node {node_id}: Failed to parse image_order: {e}")
            order = [i for i in range(len(pack_images)) if enabled[i]]

        # Check for input changes
        input_hash = self._compute_image_hash(pack_images)
        image_count_changed = len(self.properties.get("image_previews", [])) != len(pack_images)
        input_changed = input_hash != self.last_input_hash

        if image_count_changed or input_changed:
            if logger.isEnabledFor(logging.INFO):
                logger.info(f"Node {node_id}: Input changed, resetting state")
            enabled = (
                [True] + [False] * (len(pack_images) - 1)
                if self.properties.get("is_single_mode", False)
                else [True] * len(pack_images)
            )
            order = [i for i in range(len(pack_images)) if enabled[i]]
            self.last_input_hash = input_hash
        else:
            order = self._validate_image_order(order, len(pack_images), enabled)

        # Generate previews
        image_previews = []
        for i, img_tensor in enumerate(pack_images):
            img = (img_tensor.cpu().numpy() * 255).clip(0, 255).astype(np.uint8)
            pil_img = Image.fromarray(img, mode="RGBA")
            preview_b64 = self._generate_base64_thumbnail(pil_img)
            image_previews.append({
                "index": i,
                "preview": preview_b64,
                "width": img.shape[1],
                "height": img.shape[0]
            })

        # Reorder and filter images
        reordered_images = [pack_images[i] for i in order if enabled[i]]
        normalized_images = self._normalize_images_for_preview(
            [pack_images[i] for i in order if enabled[i]]
        )

        # Update properties
        self.properties["image_previews"] = image_previews
        self.properties["image_order"] = order
        self.properties["enabled_layers"] = enabled
        self.properties["state_version"] = self.properties.get("state_version", 0) + 1

        if logger.isEnabledFor(logging.INFO):
            logger.info(f"Node {node_id}: Returning {len(reordered_images)} images")
        return {
            "ui": {
                "image_previews": image_previews,              # List of dicts
                "image_order": order,                          # List of integers
                "enabled_layers": enabled,                     # List of booleans
                "state_version": [self.properties["state_version"]]  # Wrapped in list
            },
            "result": (reordered_images, normalized_images,)
        }

    def __del__(self):
        """Clean up node-specific resources."""
        if logger.isEnabledFor(logging.INFO):
            logger.info("Cleaning up XIS_ReorderImages resources")
        # Note: Directory cleanup is avoided to prevent accidental data loss
        # If needed, implement node-specific cleanup here

NODE_CLASS_MAPPINGS = {
    "XIS_ReorderImages": XIS_ReorderImages
}
if logger.isEnabledFor(logging.INFO):
    logger.info("XIS_ReorderImages node registered")