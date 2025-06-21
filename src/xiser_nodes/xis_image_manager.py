"""
xis_image_manager.py

Backend logic for the XIS_ImageManager node in ComfyUI, managing image reordering, enabling/disabling layers, uploading, and deleting images in a node-specific directory.
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
import json
import hashlib
import time
from aiohttp import web
import glob

# Log level control
LOG_LEVEL = "debug"  # Set to debug for detailed logging

# Initialize logger
logger = logging.getLogger("XISER_ImageManager")
logger.setLevel(getattr(logging, LOG_LEVEL.upper(), logging.INFO))

class XIS_ImageManager:
    """A custom node for managing images, including reordering, enabling/disabling layers, and uploading new images."""

    def __init__(self):
        """Initialize the node with properties and output directory."""
        self.properties = {
            "state_version": 0,
            "image_paths": [],
            "image_previews": [],
            "is_single_mode": False,
            "is_reversed": False,
            "image_order": [],
            "enabled_layers": [],
            "deleted_input_images": [],
            "node_size": [360, 360]
        }
        self.output_dir = os.path.join(folder_paths.get_output_directory(), "xis_image_manager")
        os.makedirs(self.output_dir, exist_ok=True)
        self.last_input_hash = None
        self.last_state_hash = None
        self.last_files_hash = None
        self.last_output_hash = None
        self.instance_id = uuid.uuid4().hex
        self.created_files = set()
        self.random_id = str(uuid.uuid4().hex)
        self.id = self.random_id
        logger.info(f"Instance {self.instance_id} - XIS_ImageManager initialized with output directory: {self.output_dir}")

    @classmethod
    def INPUT_TYPES(cls):
        """Define input types for the node, using hidden widgets to prevent UI rendering."""
        return {
            "required": {},
            "optional": {
                "pack_images": ("IMAGE", {"default": None}),
            },
            "hidden": {
                "image_order": ("STRING", {"default": "{}"}),
                "enabled_layers": ("STRING", {"default": "{}"}),
                "node_id": ("STRING", {"default": ""}),
                "single_mode": ("BOOLEAN", {"default": False}),
                "is_reversed": ("BOOLEAN", {"default": False}),
                "node_size": ("STRING", {"default": "[360, 360]"})
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("pack_images",)
    FUNCTION = "manage_images"
    CATEGORY = "XISER_Nodes/ImageManager"
    OUTPUT_NODE = True

    def _generate_base64_thumbnail(self, pil_img, max_size=64, format="PNG"):
        """Generate a scaled thumbnail as Base64 data for the preview."""
        try:
            img_width, img_height = pil_img.size
            scale = min(max_size / img_width, max_size / img_height, 1.0)
            new_size = (int(img_width * scale), int(img_height * scale))
            thumbnail = pil_img.resize(new_size, Image.Resampling.LANCZOS)
            buffered = BytesIO()
            thumbnail.save(buffered, format="PNG")
            base64_str = base64.b64encode(buffered.getvalue()).decode("utf-8")
            logger.debug(f"Instance {self.instance_id} - Generated thumbnail: size={new_size}")
            return base64_str
        except Exception as e:
            logger.error(f"Instance {self.instance_id} - Failed to generate thumbnail: {e}")
            raise ValueError(f"Thumbnail generation failed: {str(e)}")

    def _compute_image_hash(self, images):
        """Compute a lightweight hash for the image list."""
        if not images:
            return "empty_images"
        hasher = hashlib.sha256()
        for i, img in enumerate(images):
            if not isinstance(img, torch.Tensor):
                logger.error(f"Instance {self.instance_id} - Invalid image type at index {i}: {type(img)}")
                return str(time.time())
            hasher.update(str(img.shape).encode('utf-8'))
            sample_data = img.cpu().numpy().flatten()[:100].tobytes()
            hasher.update(sample_data)
        return hasher.hexdigest()

    def _compute_output_hash(self, images, order, enabled):
        """Compute a hash of the effective output (reordered and enabled images)."""
        if not images:
            return "empty_output"
        hasher = hashlib.sha256()
        for idx in order:
            if enabled[idx]:
                img = images[idx]
                hasher.update(str(img.shape).encode('utf-8'))
                sample_data = img.cpu().numpy().flatten()[:100].tobytes()
                hasher.update(sample_data)
        return hasher.hexdigest()

    def _compute_state_hash(self, image_order, enabled_layers, is_single_mode, is_reversed, deleted_input_images, node_size):
        """Compute a hash for the node state, respecting enabled_layers in single_mode."""
        hasher = hashlib.sha256()
        hasher.update(str(image_order).encode('utf-8'))
        hasher.update(str(enabled_layers).encode('utf-8'))
        hasher.update(str(is_single_mode).encode('utf-8'))
        hasher.update(str(is_reversed).encode('utf-8'))
        hasher.update(str(deleted_input_images).encode('utf-8'))
        hasher.update(str(node_size).encode('utf-8'))
        return hasher.hexdigest()

    def _compute_files_hash(self, img_paths, node_id):
        """Compute a hash for the images based on the provided paths."""
        hasher = hashlib.sha256()
        node_dir = self._get_node_output_dir(node_id)
        for img_path in sorted(img_paths):
            full_path = os.path.join(node_dir, img_path) if not os.path.isabs(img_path) else img_path
            if not os.path.exists(full_path):
                continue
            try:
                stats = os.stat(full_path)
                hasher.update(img_path.encode('utf-8'))
                hasher.update(str(stats.st_mtime).encode('utf-8'))
            except Exception as e:
                logger.error(f"Instance {self.instance_id} - Failed to hash image {img_path}: {e}")
                continue
        return hasher.hexdigest()

    def _validate_image_order(self, order, num_images):
        """Validate image order, ensuring all indices are valid."""
        if not isinstance(order, list) or len(order) != num_images or len(set(order)) != num_images:
            logger.warning(f"Instance {self.instance_id} - Invalid image order: {order}, generating default [0...{num_images-1}]")
            return list(range(num_images))
        valid_order = [idx for idx in order if isinstance(idx, int) and 0 <= idx < num_images]
        if len(valid_order) != num_images or len(set(valid_order)) != num_images:
            logger.warning(f"Instance {self.instance_id} - Incomplete or duplicate image order: {order}, generating default [0...{num_images-1}]")
            return list(range(num_images))
        logger.debug(f"Instance {self.instance_id} - Validated order: {valid_order}")
        return valid_order

    def _normalize_images_for_preview(self, image_list):
        """Normalize images to maintain size and RGBA format, returning a batched tensor for UI previews."""
        if not image_list:
            return torch.empty(0, 0, 0, 4)
        shapes = [img.shape for img in image_list]
        max_height = max(s[0] for s in shapes)
        max_width = max(s[1] for s in shapes)
        normalized = []
        for img in image_list:
            if img.shape[0] != max_height or img.shape[1] != max_width:
                padded = torch.zeros(max_height, max_width, 4)
                padded[:img.shape[0], :img.shape[1], :] = img
                normalized.append(padded)
            else:
                normalized.append(img)
        return torch.stack(normalized).cpu().clamp(0, 1)

    def _get_node_output_dir(self, node_id):
        """Get node-specific output directory."""
        if not node_id or node_id in ("", "undefined", "null"):
            node_id = self.random_id
            logger.warning(f"Instance {self.instance_id} - No valid node_id provided, using temporary ID: {node_id}")
        node_dir = os.path.join(self.output_dir, f"node_{node_id}")
        os.makedirs(node_dir, exist_ok=True)
        return node_dir

    def _clean_old_files(self, node_id):
        """Remove old cache files for the node based on age, count, and size."""
        node_dir = self._get_node_output_dir(node_id)
        try:
            files = glob.glob(os.path.join(node_dir, "xis_image_manager_*.png"))
        except Exception as e:
            logger.error(f"Instance {self.instance_id} - Failed to list files in {node_dir}: {e}")
            return

        file_info = []
        total_size = 0
        current_time = time.time()

        for file in files:
            filename = os.path.basename(file)
            if filename not in self.created_files:
                continue
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

        file_info.sort(key=lambda x: x['mtime'])
        files_to_remove = []
        max_file_age = 24 * 60 * 60  # 24 hours
        max_cache_size = 1024 * 1024 * 1024  # 1GB
        max_cache_files = 50

        for info in file_info:
            age = current_time - info['mtime']
            if age > max_file_age:
                files_to_remove.append(info)
                total_size -= info['size']
                self.created_files.discard(info['filename'])
                logger.info(f"Instance {self.instance_id} - File {info['path']} is too old ({age:.2f} seconds), marked for deletion")

        while total_size > max_cache_size and file_info:
            info = file_info.pop(0)
            if info not in files_to_remove:
                files_to_remove.append(info)
                total_size -= info['size']
                self.created_files.discard(info['filename'])
                logger.info(f"Instance {self.instance_id} - Total cache size exceeded, removing {info['path']}")

        while len(file_info) > max_cache_files and file_info:
            info = file_info.pop(0)
            if info not in files_to_remove:
                files_to_remove.append(info)
                total_size -= info['size']
                self.created_files.discard(info['filename'])
                logger.info(f"Instance {self.instance_id} - File count exceeded, removing {info['path']}")

        for info in files_to_remove:
            try:
                os.remove(info['path'])
                logger.info(f"Instance {self.instance_id} - Deleted cache file: {info['path']}")
            except Exception as e:
                logger.error(f"Instance {self.instance_id} - Failed to delete cache file {info['path']}: {e}")

    @staticmethod
    def IS_CHANGED(pack_images=None, image_order="{}", enabled_layers="{}", node_id="", single_mode=False, is_reversed=False, node_size="[360, 360]", **kwargs):
        """Static IS_CHANGED with normalized state hashing to minimize re-executions."""
        logger.debug(f"Node {node_id}: IS_CHANGED called with image_order={image_order}, enabled_layers={enabled_layers}, single_mode={single_mode}, is_reversed={is_reversed}, node_size={node_size}, pack_images_count={len(pack_images or [])}")
        try:
            hasher = hashlib.sha256()
            # Hash pack_images
            num_images = len(pack_images) if pack_images else 0
            hasher.update(str(num_images).encode('utf-8'))
            if pack_images:
                for i, img in enumerate(pack_images):
                    if isinstance(img, torch.Tensor):
                        hasher.update(str(img.shape).encode('utf-8'))
                        sample_data = img.cpu().numpy().flatten()[:100].tobytes()
                        hasher.update(sample_data)
                    else:
                        logger.warning(f"Node {node_id}: Invalid image type at index {i}: {type(img)}")
                        hasher.update(str(i).encode('utf-8'))
            # Normalize image_order
            try:
                order_data = json.loads(image_order) if image_order and image_order.strip() and image_order != "{}" else {}
                order = order_data.get("order", []) if isinstance(order_data, dict) else order_data
                if not isinstance(order, list) or len(order) != num_images or len(set(order)) != num_images:
                    order = list(range(num_images))
                valid_order = [idx for idx in order if isinstance(idx, int) and 0 <= idx < num_images]
                if len(valid_order) != num_images or len(set(valid_order)) != num_images:
                    order = list(range(num_images))
            except Exception as e:
                logger.warning(f"Node {node_id}: Failed to parse image_order: {e}, using default [0...{num_images-1}]")
                order = list(range(num_images))
            hasher.update(str(order).encode('utf-8'))
            # Normalize enabled_layers
            try:
                enabled_data = json.loads(enabled_layers) if enabled_layers and enabled_layers.strip() and enabled_layers != "{}" else {}
                enabled = enabled_data.get("enabled", [True] * num_images) if isinstance(enabled_data, dict) else enabled_data
                if len(enabled) != num_images:
                    enabled = [True] * num_images
            except Exception as e:
                logger.warning(f"Node {node_id}: Failed to parse enabled_layers: {e}, resetting to [True] * {num_images}")
                enabled = [True] * num_images
            hasher.update(str(enabled).encode('utf-8'))
            hasher.update(str(is_reversed).encode('utf-8'))
            # Hash node_size
            try:
                node_size_list = json.loads(node_size) if node_size and node_size.strip() else [360, 360]
                if not isinstance(node_size_list, list) or len(node_size_list) != 2:
                    node_size_list = [360, 360]
            except Exception as e:
                logger.warning(f"Node {node_id}: Failed to parse node_size: {e}, using default [360, 360]")
                node_size_list = [360, 360]
            hasher.update(str(node_size_list).encode('utf-8'))
            # Hash uploaded files
            node_dir = os.path.join(folder_paths.get_output_directory(), "xis_image_manager", f"node_{node_id}")
            files = glob.glob(os.path.join(node_dir, "xis_image_manager_*.png")) if os.path.exists(node_dir) else []
            for f in sorted(files):
                stats = os.stat(f)
                hasher.update(os.path.basename(f).encode('utf-8'))
                hasher.update(str(stats.st_mtime).encode('utf-8'))
            hash_value = hasher.hexdigest()
            logger.debug(f"Node {node_id}: IS_CHANGED returning hash: {hash_value}")
            return hash_value
        except Exception as e:
            logger.error(f"Node {node_id}: Static IS_CHANGED failed: {e}")
            return str(time.time())

    def _validate_ui_output(self, ui_data, node_id):
        """Validate UI output to ensure all values are iterable."""
        for key, value in ui_data.items():
            if not isinstance(value, (list, tuple)):
                logger.error(f"Instance {self.instance_id} - Node {node_id}: UI output key '{key}' has non-iterable value {value} of type {type(value)}")
                raise ValueError(f"UI output '{key}' must be a list or tuple, got {type(value)}")
        return ui_data

    def manage_images(self, pack_images=None, image_order="{}", enabled_layers="{}", node_id="", single_mode=False, is_reversed=False, node_size="[360, 360]", **kwargs):
        """Process and manage images, including reordering, enabling/disabling, and handling uploads."""
        node_id = str(kwargs.get('node_id', node_id) or self.id)
        self.id = node_id

        single_mode = kwargs.get('single_mode', single_mode)
        is_reversed = kwargs.get('is_reversed', is_reversed)
        self.properties["is_single_mode"] = single_mode
        self.properties["is_reversed"] = is_reversed

        try:
            node_size_list = json.loads(node_size) if node_size and node_size.strip() else [360, 360]
            if not isinstance(node_size_list, list) or len(node_size_list) != 2:
                node_size_list = [360, 360]
            self.properties["node_size"] = node_size_list
        except Exception as e:
            logger.warning(f"Instance {self.instance_id} - Node {node_id}: Failed to parse node_size: {e}, using default [360, 360]")
            self.properties["node_size"] = [360, 360]

        self._clean_old_files(node_id)

        images_list = []
        image_paths = []
        image_previews = []
        deleted_input_images = self.properties.get("deleted_input_images", [])

        # Validate deleted_input_images
        if pack_images:
            input_filenames = [f"input_image_{i}.png" for i in range(len(pack_images))]
            valid_deleted_images = [f for f in deleted_input_images if f in input_filenames]
            if len(valid_deleted_images) != len(deleted_input_images):
                logger.debug(f"Instance {self.instance_id} - Node {node_id}: Cleaned deleted_input_images: old={deleted_input_images}, new={valid_deleted_images}")
                deleted_input_images = valid_deleted_images
                self.properties["deleted_input_images"] = deleted_input_images

        # Process pack_images
        if pack_images:
            if not isinstance(pack_images, list):
                logger.error(f"Instance {self.instance_id} - Node {node_id}: Invalid pack_images: expected list, got {type(pack_images)}")
                raise ValueError("pack_images must be a list of torch.Tensor")
            for i, img in enumerate(pack_images):
                filename = f"input_image_{i}.png"
                if filename in deleted_input_images:
                    logger.debug(f"Instance {self.instance_id} - Node {node_id}: Skipping deleted input image: {filename}")
                    continue
                if not isinstance(img, torch.Tensor) or img.shape[-1] != 4:
                    logger.error(f"Instance {self.instance_id} - Node {node_id}: Invalid image format at index {i}: expected RGBA torch.Tensor, got {img.shape}")
                    raise ValueError("All images must be RGBA torch.Tensor")
                images_list.append(img)
                image_paths.append(filename)
                img_array = (img.cpu().numpy() * 255).clip(0, 255).astype(np.uint8)
                pil_img = Image.fromarray(img_array, mode="RGBA")
                preview_b64 = self._generate_base64_thumbnail(pil_img)
                image_previews.append({
                    "index": len(images_list) - 1,
                    "preview": preview_b64,
                    "width": img.shape[1],
                    "height": img.shape[0],
                    "filename": filename,
                    "originalFilename": filename
                })

        # Load uploaded images
        node_dir = self._get_node_output_dir(node_id)
        existing_filenames = {p["filename"] for p in image_previews}
        uploaded_files = glob.glob(os.path.join(node_dir, "xis_image_manager_*.png"))
        for file in uploaded_files:
            filename = os.path.basename(file)
            if filename in existing_filenames:
                continue
            try:
                if filename not in self.created_files:
                    self.created_files.add(filename)
                pil_img = Image.open(file).convert("RGBA")
                img_array = np.array(pil_img).astype(np.float32) / 255.0
                img_tensor = torch.from_numpy(img_array)
                images_list.append(img_tensor)
                image_paths.append(filename)
                preview_b64 = self._generate_base64_thumbnail(pil_img)
                image_previews.append({
                    "index": len(images_list) - 1,
                    "preview": preview_b64,
                    "width": pil_img.width,
                    "height": pil_img.height,
                    "filename": filename,
                    "originalFilename": filename
                })
                logger.debug(f"Instance {self.instance_id} - Node {node_id}: Loaded uploaded image {filename}")
            except Exception as e:
                logger.error(f"Instance {self.instance_id} - Node {node_id}: Failed to load uploaded image {file}: {e}")
                continue

        # Handle empty case
        if not images_list:
            if (self.properties["image_paths"] == [] and
                self.properties["image_previews"] == [] and
                self.properties["is_single_mode"] == single_mode and
                self.properties["is_reversed"] == is_reversed):
                logger.debug(f"Instance {self.instance_id} - Node {node_id}: No changes, returning cached empty state")
                ui_data = {
                    "image_previews": [],
                    "image_order": [],
                    "enabled_layers": [],
                    "state_version": [self.properties["state_version"]],
                    "is_single_mode": [self.properties["is_single_mode"]],
                    "is_reversed": [self.properties["is_reversed"]],
                    "node_size": [self.properties["node_size"]],
                    "deleted_input_images": [deleted_input_images]
                }
                return {
                    "ui": self._validate_ui_output(ui_data, node_id),
                    "result": ([], [])
                }
            self.properties.update({
                "image_paths": [],
                "image_previews": [],
                "image_order": [],
                "enabled_layers": [],
                "is_single_mode": single_mode,
                "is_reversed": is_reversed,
                "node_size": self.properties["node_size"],
                "deleted_input_images": deleted_input_images
            })
            ui_data = {
                "image_previews": [],
                "image_order": [],
                "enabled_layers": [],
                "state_version": [self.properties["state_version"]],
                "is_single_mode": [single_mode],
                "is_reversed": [is_reversed],
                "node_size": [self.properties["node_size"]],
                "deleted_input_images": [deleted_input_images]
            }
            return {
                "ui": self._validate_ui_output(ui_data, node_id),
                "result": ([], [])
            }

        # Parse and validate image_order
        try:
            order_data = json.loads(image_order) if image_order and image_order != "{}" else {}
            order = order_data.get("order", self.properties.get("image_order", [])) if isinstance(order_data, dict) else order_data
            if not isinstance(order, list) or not order:  # Prioritize incoming order
                logger.warning(f"Instance {self.instance_id} - Node {node_id}: Empty or invalid image_order input: {image_order}, using stored order")
                order = self.properties.get("image_order", list(range(len(images_list))))
            order = self._validate_image_order(order, len(images_list))
        except Exception as e:
            logger.error(f"Instance {self.instance_id} - Node {node_id}: Failed to parse image_order: {e}, using stored order")
            order = self.properties.get("image_order", list(range(len(images_list))))
            order = self._validate_image_order(order, len(images_list))

        # Parse and validate enabled_layers
        try:
            enabled_data = json.loads(enabled_layers) if enabled_layers and enabled_layers != "{}" else {}
            enabled = enabled_data.get("enabled", self.properties.get("enabled_layers", [True] * len(images_list))) if isinstance(enabled_data, dict) else enabled_data
            if not isinstance(enabled, list) or len(enabled) != len(images_list):
                logger.warning(f"Instance {self.instance_id} - Node {node_id}: Invalid enabled_layers: {enabled}, resetting to [True] * {len(images_list)}")
                enabled = [True] * len(images_list)
            if single_mode and enabled.count(True) != 1:
                logger.warning(f"Instance {self.instance_id} - Node {node_id}: Single mode enabled but {enabled.count(True)} layers active, keeping current enabled layer")
                true_index = enabled.index(True) if True in enabled else -1
                if true_index < 0:
                    enabled = [False] * len(images_list)
                    enabled[0] = True  # Default to first image if none enabled
        except Exception as e:
            logger.error(f"Instance {self.instance_id} - Node {node_id}: Failed to parse enabled_layers: {e}, resetting")
            enabled = [True] * len(images_list)
            if single_mode:
                enabled = [False] * len(images_list)
                enabled[0] = True

        # Generate outputs
        try:
            reordered_images = [images_list[i] for i in order if enabled[i]]
        except IndexError as e:
            logger.error(f"Instance {self.instance_id} - Node {node_id}: Index error in reordering: {e}, order: {order}, enabled: {enabled}")
            order = list(range(len(images_list)))
            enabled = [True] * len(images_list)
            if single_mode:
                enabled = [False] * len(images_list)
                enabled[0] = True
            reordered_images = [images_list[i] for i in order if enabled[i]]

        # Compute output hash to check if output has changed
        new_output_hash = self._compute_output_hash(images_list, order, enabled)
        new_previews = [p for p in image_previews if p["filename"] not in deleted_input_images]
        new_paths = [p for p in image_paths if p not in deleted_input_images]
        state_changed = (
            self.properties["image_previews"] != new_previews or
            self.properties["image_paths"] != new_paths or
            self.properties["image_order"] != order or
            self.properties["enabled_layers"] != enabled or
            self.properties["is_single_mode"] != single_mode or
            self.properties["is_reversed"] != is_reversed or
            self.properties["node_size"] != self.properties["node_size"] or
            self.properties["deleted_input_images"] != deleted_input_images or
            self.last_output_hash != new_output_hash
        )

        if not state_changed:
            logger.debug(f"Instance {self.instance_id} - Node {node_id}: No state or output changes, returning cached result")
            ui_data = {
                "image_previews": self.properties["image_previews"],
                "image_order": self.properties["image_order"],
                "enabled_layers": self.properties["enabled_layers"],
                "state_version": [self.properties["state_version"]],
                "is_single_mode": [self.properties["is_single_mode"]],
                "is_reversed": [self.properties["is_reversed"]],
                "node_size": [self.properties["node_size"]],
                "deleted_input_images": [deleted_input_images]
            }
            return {
                "ui": self._validate_ui_output(ui_data, node_id),
                "result": (reordered_images,)
            }

        # Update properties only if state or output changed
        self.last_output_hash = new_output_hash
        self.properties.update({
            "image_previews": new_previews,
            "image_paths": new_paths,
            "image_order": order,
            "enabled_layers": enabled,
            "is_single_mode": single_mode,
            "is_reversed": is_reversed,
            "node_size": self.properties["node_size"],
            "state_version": self.properties.get("state_version", 0) + 1,
            "deleted_input_images": deleted_input_images
        })

        ui_data = {
            "image_previews": self.properties["image_previews"],
            "image_order": order,
            "enabled_layers": enabled,
            "state_version": [self.properties["state_version"]],
            "is_single_mode": [single_mode],
            "is_reversed": [is_reversed],
            "node_size": [self.properties["node_size"]],
            "deleted_input_images": [deleted_input_images]
        }
        logger.info(f"Instance {self.instance_id} - Node {node_id}: Returning {len(reordered_images)} images, order: {order}, enabled: {enabled}, single_mode: {single_mode}, is_reversed: {is_reversed}, node_size: {self.properties['node_size']}, deleted_input_images: {len(deleted_input_images)}")
        return {
            "ui": self._validate_ui_output(ui_data, node_id),
            "result": (reordered_images,)
        }

    def get_ui_data(self, node_id: str) -> dict:
        """Retrieve UI data for state persistence."""
        logger.debug(f"Instance {self.instance_id} - Node {node_id}: Getting UI data with {len(self.properties.get('image_previews', []))} previews")
        deleted_input_images = self.properties.get("deleted_input_images", [])
        ui_data = {
            "image_previews": [
                {
                    "index": p["index"],
                    "preview": p["preview"],
                    "width": p["width"],
                    "height": p["height"],
                    "filename": p["filename"],
                    "originalFilename": p.get("originalFilename", p["filename"])
                } for p in self.properties.get("image_previews", [])
                if p["filename"] not in deleted_input_images
            ],
            "image_order": self.properties.get("image_order", []),
            "enabled_layers": self.properties.get("enabled_layers", []),
            "is_single_mode": [self.properties.get("is_single_mode", False)],
            "is_reversed": [self.properties.get("is_reversed", False)],
            "node_size": [self.properties.get("node_size", [360, 360])],
            "state_version": [self.properties.get("state_version", 0)],
            "deleted_input_images": [deleted_input_images]
        }
        return self._validate_ui_output(ui_data, node_id)

    def set_ui_data(self, node_id: str, data: dict) -> None:
        """Restore UI data for state persistence."""
        logger.debug(f"Instance {self.instance_id} - Node {node_id}: Setting UI data with {len(data.get('image_previews', []))} previews, is_single_mode={data.get('is_single_mode', [False])}, is_reversed={data.get('is_reversed', [False])}, received_node_id={data.get('node_id', 'unset')}")
        self.id = node_id
        try:
            deleted_input_images = data.get("deleted_input_images", [[]])[0]
            image_previews = [
                {
                    "index": p["index"],
                    "preview": p.get("preview"),
                    "width": p.get("width"),
                    "height": p.get("height"),
                    "filename": p.get("filename"),
                    "originalFilename": p.get("originalFilename", p["filename"])
                } for p in data.get("image_previews", []) if p.get("filename") and p["filename"] not in deleted_input_images
            ]
            image_order = data.get("image_order", [])
            enabled_layers = data.get("enabled_layers", [])
            num_images = len(image_previews)
            image_order = self._validate_image_order(image_order, num_images)
            if len(enabled_layers) != num_images:
                logger.warning(f"Instance {self.instance_id} - Node {node_id}: enabled_layers length mismatch, resetting to [True] * {num_images}")
                enabled_layers = [True] * num_images
            is_single_mode = bool(data.get("is_single_mode", [False])[0])
            if is_single_mode and num_images > 0 and enabled_layers.count(True) != 1:
                logger.warning(f"Instance {self.instance_id} - Node {node_id}: Single mode enabled but {enabled_layers.count(True)} layers active, enabling first enabled layer")
                true_index = enabled_layers.index(True) if True in enabled_layers else -1
                if true_index < 0:
                    enabled_layers = [False] * num_images
                    enabled_layers[0] = True
            self.properties.update({
                "image_previews": image_previews,
                "image_paths": [p["filename"] for p in image_previews],
                "image_order": image_order,
                "enabled_layers": enabled_layers,
                "is_single_mode": is_single_mode,
                "is_reversed": bool(data.get("is_reversed", [False])[0]),
                "node_size": data.get("node_size", [[360, 360]])[0],
                "state_version": data.get("state_version", [0])[0] + 1,  # Increment state_version
                "deleted_input_images": deleted_input_images
            })
            # Recalculate output hash after setting UI data
            images_list = []
            for p in image_previews:
                if p["filename"].startswith("xis_image_manager_"):
                    try:
                        pil_img = Image.open(os.path.join(self._get_node_output_dir(node_id), p["filename"])).convert("RGBA")
                        img_array = np.array(pil_img).astype(np.float32) / 255.0
                        images_list.append(torch.from_numpy(img_array))
                    except Exception as e:
                        logger.error(f"Instance {self.instance_id} - Node {node_id}: Failed to load image {p['filename']}: {e}")
                        continue
            self.last_output_hash = self._compute_output_hash(images_list, image_order, enabled_layers)
            logger.info(f"Instance {self.instance_id} - Node {node_id}: UI data set successfully, state_version={self.properties['state_version']}")
        except Exception as e:
            logger.error(f"Instance {self.instance_id} - Node {node_id}: Failed to set UI data: {str(e)}")
            raise

    def cleanup(self):
        """Clean up all files created by this instance."""
        for filename in list(self.created_files):
            file_path = os.path.join(self.output_dir, filename)
            try:
                if os.path.exists(file_path):
                    os.remove(file_path)
                    logger.info(f"Instance {self.instance_id} - Deleted file during cleanup: {file_path}")
                self.created_files.discard(filename)
            except Exception as e:
                logger.error(f"Instance {self.instance_id} - Failed to delete file during cleanup {file_path}: {e}")
        self.properties["image_paths"] = []
        self.properties["image_previews"] = []
        self.properties["image_order"] = []
        self.properties["enabled_layers"] = []
        self.properties["is_single_mode"] = False
        self.properties["is_reversed"] = False
        self.properties["node_size"] = [360, 360]
        self.properties["deleted_input_images"] = []
        self.last_output_hash = None

    def __del__(self):
        """Destructor to ensure cleanup of files when the instance is deleted."""
        self.cleanup()

# Register upload endpoint
async def handle_upload(request):
    """Handle image uploads for XIS_ImageManager node."""
    try:
        data = await request.post()
        node_id = data.get('node_id')
        images = []

        if not node_id or node_id in ("undefined", "null", ""):
            node_id = str(uuid.uuid4())
            logger.warning(f"Instance - Invalid node_id received, using temporary ID: {node_id}")

        node_dir = os.path.join(folder_paths.get_output_directory(), "xis_image_manager")
        if node_id:
            node_dir = os.path.join(node_dir, f"node_{node_id}")
        os.makedirs(node_dir, exist_ok=True)

        for file in data.getall('images', []):
            if not hasattr(file, 'file') or not hasattr(file, 'filename'):
                logger.error(f"Instance - Invalid file object: {file}")
                continue
            filename = file.filename
            if not filename.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
                logger.error(f"Instance - Invalid file type for upload: {filename}")
                continue
            try:
                data_bytes = file.file.read()
                pil_img = Image.open(BytesIO(data_bytes)).convert("RGBA")
                img_filename = f"xis_image_manager_{uuid.uuid4().hex}.png"
                img_path = os.path.join(node_dir, img_filename)
                pil_img.save(img_path, format="PNG")
                preview_b64 = XIS_ImageManager()._generate_base64_thumbnail(pil_img)
                images.append({
                    "filename": img_filename,
                    "preview": preview_b64,
                    "width": pil_img.width,
                    "height": pil_img.height,
                    "index": -1,  # Assigned by frontend
                    "originalFilename": filename
                })
                logger.info(f"Instance - Uploaded image {img_filename} for node {node_id}")
            except Exception as e:
                logger.error(f"Instance - Failed to process uploaded image {filename}: {e}")
                continue

        return web.json_response({"images": images})
    except Exception as e:
        logger.error(f"Instance - Failed to handle upload request: {e}")
        return web.json_response({"error": f"Failed to process upload: {e}"}, status=400)

# Register delete endpoint
async def handle_delete(request):
    """Handle image deletion for XIS_ImageManager node."""
    try:
        data = await request.json()
        node_id = data.get('node_id')
        filename = data.get('filename')
        if not filename or not filename.startswith("xis_image_manager_"):
            logger.error(f"Instance - Invalid filename for deletion: {filename}")
            return web.json_response({"error": "Invalid filename"}, status=400)
        node_dir = os.path.join(folder_paths.get_output_directory(), "xis_image_manager")
        if node_id and node_id not in ("undefined", "null", ""):
            node_dir = os.path.join(node_dir, f"node_{node_id}")
        img_path = os.path.join(node_dir, filename)
        if os.path.exists(img_path):
            os.remove(img_path)
            logger.info(f"Instance - Deleted image {filename} for node {node_id}")
        else:
            logger.warning(f"Instance - Image {filename} for node {node_id} not found")
            return web.json_response({"error": f"Image not found: {filename}"}, status=404)
        return web.json_response({"success": True})
    except Exception as e:
        logger.error(f"Instance - Failed to handle delete request: {e}")
        return web.json_response({"error": f"Failed to delete image: {e}"}, status=500)

# Register set_ui_data endpoint
async def handle_set_ui_data(request):
    """Handle setting UI data for XIS_ImageManager node."""
    try:
        data = await request.json()
        node_id = data.get('node_id')
        ui_data = data.get('data')
        if not node_id or not ui_data:
            logger.error(f"Instance - Invalid set_ui_data request: node_id={node_id}, data={ui_data}")
            return web.json_response({"error": "Invalid node_id or data"}, status=400)
        
        # Find or create node instance
        node_instance = None
        for node in PromptServer.instance.node_instances.values():  # Adjust based on actual ComfyUI node storage
            if node.id == node_id:
                node_instance = node
                break
        if not node_instance:
            logger.error(f"Instance - Node {node_id} not found")
            return web.json_response({"error": f"Node {node_id} not found"}, status=404)
        
        node_instance.set_ui_data(node_id, ui_data)
        logger.info(f"Instance - Set UI data for node {node_id}: {ui_data}")
        return web.json_response({"success": True})
    except Exception as e:
        logger.error(f"Instance - Failed to handle set_ui_data request: {e}")
        return web.json_response({"error": f"Failed to set UI data: {e}"}, status=500)

# Register endpoints with ComfyUI
try:
    from server import PromptServer
    PromptServer.instance.app.add_routes([
        web.post('/upload/xis_image_manager', handle_upload),
        web.post('/delete/xis_image_manager', handle_delete),
        web.post('/set_ui_data/xis_image_manager', handle_set_ui_data),
    ])
    logger.info("Registered /upload/xis_image_manager, /delete/xis_image_manager, and /set_ui_data/xis_image_manager endpoints")
except Exception as e:
    logger.error(f"Failed to register endpoints: {e}")

# Node class mappings
NODE_CLASS_MAPPINGS = {
    "XIS_ImageManager": XIS_ImageManager
}

logger.info("XIS_ImageManager node registered")