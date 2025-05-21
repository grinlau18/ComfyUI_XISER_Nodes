import os
import logging
import numpy as np
import torch
from PIL import Image
import folder_paths
import base64
from io import BytesIO
import json

logger = logging.getLogger("XISER_ReorderImages")
logger.setLevel(logging.INFO)

class XIS_ReorderImages:
    def __init__(self):
        self.properties = {}
        self.output_dir = os.path.join(folder_paths.get_output_directory(), "xiser_reorder_images")
        os.makedirs(self.output_dir, exist_ok=True)
        self.last_input_hash = None
        self.image_order = []
        logger.info(f"XIS_ReorderImages initialized with output directory: {self.output_dir}")

    @classmethod
    def INPUT_TYPES(cls):
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
    OUTPUT_NODE = False

    def _generate_base64_thumbnail(self, pil_img, max_size=64, format="PNG"):
        """Generate a scaled thumbnail as Base64 data"""
        img_width, img_height = pil_img.size
        scale = min(max_size / img_width, max_size / img_height, 1.0)
        new_size = (int(img_width * scale), int(img_height * scale))
        thumbnail = pil_img.resize(new_size, Image.Resampling.LANCZOS)
        buffered = BytesIO()
        thumbnail.save(buffered, format=format, optimize=True)
        return base64.b64encode(buffered.getvalue()).decode("utf-8")

    def _compute_image_hash(self, images):
        """Compute a hash for the image list based on content"""
        return hash(tuple(hash(img.cpu().numpy().tobytes()) for img in images))

    def _validate_image_order(self, order, num_images, enabled_layers):
        """Validate the image_order array, only include enabled layers"""
        if not isinstance(order, list) or not order:
            logger.warning(f"Invalid image_order: {order}, using enabled layers")
            return [i for i in range(num_images) if enabled_layers[i]]
        valid_order = [idx for idx in order if isinstance(idx, int) and 0 <= idx < num_images and enabled_layers[idx]]
        if not valid_order:
            logger.warning(f"No valid enabled indices in image_order: {order}, using enabled layers")
            return [i for i in range(num_images) if enabled_layers[i]]
        logger.info(f"Validated order: {valid_order}, enabled: {enabled_layers}")
        return valid_order

    def _normalize_images_for_preview(self, image_list):
        """Normalize images to maintain original size and preserve RGBA format for IMAGE type output"""
        if not image_list:
            return None

        # Convert each image to torch.Tensor with original size, preserving RGBA
        normalized_images = []
        for img in image_list:
            # Ensure the tensor is on CPU and in the correct format
            img = img.cpu()
            # Scale to [0, 1] range if not already
            img_normalized = img.clamp(0, 1)  # Ensure values are in [0, 1]
            normalized_images.append(img_normalized)

        # Return as a list of tensors to support variable sizes
        return normalized_images

    def reorder_images(self, pack_images, image_order="[]", enabled_layers="[]"):
        logger.info(f"Received pack_images: {len(pack_images)} images, image_order: {image_order}, enabled_layers: {enabled_layers}")

        # Validate input
        if pack_images is None or not isinstance(pack_images, list):
            logger.error(f"Variable pack_images: expected list, got {type(pack_images)}")
            raise ValueError("pack_images must be provided as a list")
        
        if not pack_images:
            logger.error("No images provided")
            raise ValueError("At least one image must be provided")

        # Warn about potential performance issues with large number of images
        if len(pack_images) > 50:
            logger.warning(f"Large number of images detected: {len(pack_images)}. This may impact performance.")

        for img in pack_images:
            if not isinstance(img, torch.Tensor) or img.shape[-1] != 4:
                logger.error(f"Invalid image format: expected RGBA torch.Tensor, got {img.shape}")
                raise ValueError("All images must be RGBA torch.Tensor")

        # Parse and validate enabled layers
        try:
            enabled = json.loads(enabled_layers) if enabled_layers and enabled_layers != "[]" else [True] * len(pack_images)
            if len(enabled) != len(pack_images):
                logger.warning(f"Invalid enabled_layers length: {len(enabled)}, aligning with pack_images")
                enabled = [True] * len(pack_images)
        except Exception as e:
            logger.error(f"Failed to parse enabled_layers: {e}")
            enabled = [True] * len(pack_images)

        # Parse and validate image order
        try:
            order = json.loads(image_order) if image_order and image_order != "[]" else [i for i in range(len(pack_images)) if enabled[i]]
            logger.info(f"Parsed image_order: {order}")
        except Exception as e:
            logger.error(f"Failed to parse image_order: {e}")
            order = [i for i in range(len(pack_images)) if enabled[i]]

        # Check if image count has changed
        prev_image_count = len(self.properties.get("image_previews", []))
        image_count_changed = prev_image_count != len(pack_images)

        if image_count_changed:
            logger.info(f"Image count changed from {prev_image_count} to {len(pack_images)}, resetting order and enabled layers")
            order = [i for i in range(len(pack_images)) if enabled[i]]
            enabled = [True] * len(pack_images)
        else:
            logger.info(f"Image count unchanged ({len(pack_images)}), preserving order and enabled layers")
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

        # Reorder and filter images for pack_images output
        reordered_images = [pack_images[i] for i in order if enabled[i]]
        logger.info(f"Filtered order: {order}, enabled: {enabled}, output_images: {len(reordered_images)}")

        # Prepare images output (original order and quantity, maintaining original size and RGBA)
        images = self._normalize_images_for_preview(pack_images)

        # Save properties
        self.properties["image_previews"] = image_previews
        self.properties["image_order"] = order
        self.properties["enabled_layers"] = enabled

        logger.info(f"Returning reordered images: order={order}, enabled_layers={enabled}, pack_images_output={len(reordered_images)}, images_output={len(images)}")
        return {
            "ui": {
                "image_previews": image_previews,
                "image_order": order,
                "enabled_layers": enabled
            },
            "result": (reordered_images, images,)
        }

# Register node
NODE_CLASS_MAPPINGS = {
    "XIS_ReorderImages": XIS_ReorderImages
}
logger.info("XIS_ReorderImages node registered")