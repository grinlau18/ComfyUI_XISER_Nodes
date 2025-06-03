import os
import logging
import numpy as np
import torch
from PIL import Image
import folder_paths
import base64
from io import BytesIO
import json

# Log level control
LOG_LEVEL = "error"  # Options: "info", "warning", "error" (default: "error" for production)

# Initialize logger
logger = logging.getLogger("XISER_ReorderImages")
logger.setLevel(getattr(logging, LOG_LEVEL.upper(), logging.ERROR))

class XIS_ReorderImages:
    """A custom node for reordering images with support for single mode and layer toggling."""

    def __init__(self):
        """Initialize the node with properties and output directory."""
        self.properties = {}
        self.output_dir = os.path.join(folder_paths.get_output_directory(), "xiser_reorder_images")
        os.makedirs(self.output_dir, exist_ok=True)
        self.last_input_hash = None
        self.image_order = []
        if logger.isEnabledFor(logging.INFO):
            logger.info(f"XIS_ReorderImages initialized with output directory: {self.output_dir}")

    @classmethod
    def INPUT_TYPES(cls):
        """Define the input types for the node."""
        return {
            "required": {
                "pack_images": ("XIS_IMAGES", {"default": None}),
            },
            "hidden": {
                "image_order": ("STRING", {"default": "[]", "multiline": False}),
                "enabled_layers": ("STRING", {"default": "[]", "multiline": False}),
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
            pil_img (PIL.Image): The input image.
            max_size (int): Maximum size for the thumbnail (width or height).
            format (str): Image format for saving (default: PNG).

        Returns:
            str: Base64-encoded string of the thumbnail.
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
            int: Hash value for the image list.
        """
        return hash(tuple(hash(img.cpu().numpy().tobytes()) for img in images))

    def _validate_image_order(self, order, num_images, enabled_layers):
        """Validate the image_order array, only include enabled layers.

        Args:
            order (list): The proposed image order.
            num_images (int): Number of images in the input.
            enabled_layers (list): List of boolean flags indicating enabled layers.

        Returns:
            list: Validated order of image indices.
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
        """Normalize images to maintain original size and preserve RGBA format.

        Args:
            image_list (list): List of torch.Tensor images.

        Returns:
            list: List of normalized torch.Tensor images, or None if empty.
        """
        if not image_list:
            return None

        normalized_images = []
        for img in image_list:
            img = img.cpu()
            img_normalized = img.clamp(0, 1)
            normalized_images.append(img_normalized)

        return normalized_images

    def reorder_images(self, pack_images, image_order="[]", enabled_layers="[]"):
        """Process and reorder images based on image_order and enabled_layers.

        Args:
            pack_images (list): List of torch.Tensor images.
            image_order (str): JSON string of ordered image indices.
            enabled_layers (str): JSON string of boolean flags for enabled layers.

        Returns:
            dict: Contains UI data and result tuple with reordered pack_images and images.
        """
        if logger.isEnabledFor(logging.INFO):
            logger.info(
                f"Received pack_images: {len(pack_images)} images, "
                f"image_order: {image_order}, enabled_layers: {enabled_layers}"
            )

        # Validate input
        if pack_images is None or not isinstance(pack_images, list):
            if logger.isEnabledFor(logging.ERROR):
                logger.error(f"Invalid pack_images: expected list, got {type(pack_images)}")
            raise ValueError("pack_images must be provided as a list")

        if not pack_images:
            if logger.isEnabledFor(logging.ERROR):
                logger.error("No images provided")
            raise ValueError("At least one image must be provided")

        # Warn about potential performance issues
        if len(pack_images) > 50 and logger.isEnabledFor(logging.WARNING):
            logger.warning(
                f"Large number of images detected: {len(pack_images)}. "
                "This may impact performance."
            )

        for img in pack_images:
            if not isinstance(img, torch.Tensor) or img.shape[-1] != 4:
                if logger.isEnabledFor(logging.ERROR):
                    logger.error(
                        f"Invalid image format: expected RGBA torch.Tensor, got {img.shape}"
                    )
                raise ValueError("All images must be RGBA torch.Tensor")

        # Parse and validate enabled layers
        try:
            enabled = (
                json.loads(enabled_layers)
                if enabled_layers and enabled_layers != "[]"
                else [True] * len(pack_images)
            )
            if len(enabled) != len(pack_images):
                if logger.isEnabledFor(logging.WARNING):
                    logger.warning(
                        f"Invalid enabled_layers length: {len(enabled)}, "
                        "aligning with pack_images"
                    )
                enabled = [True] * len(pack_images)
        except Exception as e:
            if logger.isEnabledFor(logging.ERROR):
                logger.error(f"Failed to parse enabled_layers: {e}")
            enabled = [True] * len(pack_images)

        # Parse and validate image order
        try:
            order = (
                json.loads(image_order)
                if image_order and image_order != "[]"
                else [i for i in range(len(pack_images)) if enabled[i]]
            )
            if logger.isEnabledFor(logging.INFO):
                logger.info(f"Parsed image_order: {order}")
        except Exception as e:
            if logger.isEnabledFor(logging.ERROR):
                logger.error(f"Failed to parse image_order: {e}")
            order = [i for i in range(len(pack_images)) if enabled[i]]

        # Check if image count has changed
        prev_image_count = len(self.properties.get("image_previews", []))
        image_count_changed = prev_image_count != len(pack_images)

        if image_count_changed:
            if logger.isEnabledFor(logging.INFO):
                logger.info(
                    f"Image count changed from {prev_image_count} to {len(pack_images)}, "
                    "resetting order and enabled layers"
                )
            # Initialize enabled_layers based on single_mode
            enabled = (
                [True] + [False] * (len(pack_images) - 1)
                if self.properties.get("is_single_mode", False)
                else [True] * len(pack_images)
            )
            # Initialize order to only include enabled indices
            order = [i for i in range(len(pack_images)) if enabled[i]]
        else:
            if logger.isEnabledFor(logging.INFO):
                logger.info(
                    f"Image count unchanged ({len(pack_images)}), "
                    "preserving order and enabled layers"
                )
            order = self._validate_image_order(order, len(pack_images), enabled)

        # Generate image previews and metadata
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

        # Reorder and filter images for both pack_images and images outputs
        reordered_images = [pack_images[i] for i in order if enabled[i]]
        if logger.isEnabledFor(logging.INFO):
            logger.info(
                f"Filtered order: {order}, enabled: {enabled}, "
                f"output_images: {len(reordered_images)}"
            )

        # Prepare images output (filtered and ordered according to image_order and enabled_layers)
        normalized_images = self._normalize_images_for_preview(
            [pack_images[i] for i in order if enabled[i]]
        )

        # Save properties
        self.properties["image_previews"] = image_previews
        self.properties["image_order"] = order
        self.properties["enabled_layers"] = enabled

        if logger.isEnabledFor(logging.INFO):
            logger.info(
                f"Returning reordered images: order={order}, "
                f"enabled_layers={enabled}, pack_images_output={len(reordered_images)}, "
                f"images_output={len(normalized_images)}"
            )
        return {
            "ui": {
                "image_previews": image_previews,
                "image_order": order,
                "enabled_layers": enabled
            },
            "result": (reordered_images, normalized_images,)
        }

# Register node
NODE_CLASS_MAPPINGS = {
    "XIS_ReorderImages": XIS_ReorderImages
}
if logger.isEnabledFor(logging.INFO):
    logger.info("XIS_ReorderImages node registered")