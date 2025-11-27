"""
xis_image_manager.py

Backend logic for the XIS_ImageManager node in ComfyUI, handling image input, upload, preview generation, and output.
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
import re
from collections import defaultdict

# Log level control
LOG_LEVEL = "debug"  # Set to warning to reduce logging noise

# Initialize logger
logger = logging.getLogger("XISER_ImageManager")
logger.setLevel(getattr(logging, LOG_LEVEL.upper(), logging.INFO))

class XIS_ImageManager:
    """A custom node for managing images, handling input, upload, and output based on frontend-provided order and enabled state."""

    def __init__(self):
        """Initialize the node with minimal properties and output directory."""
        self.output_dir = os.path.join(folder_paths.get_output_directory(), "xis_image_manager")
        os.makedirs(self.output_dir, exist_ok=True)
        self.instance_id = uuid.uuid4().hex
        self.created_files = set()
        self.random_id = str(uuid.uuid4().hex)
        self.id = self.random_id
        self.image_previews = []  # Store only previews and paths, not state
        self.image_paths = []
        self._pack_id_history = {}
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
                "node_size": ("STRING", {"default": "[360, 360]"}),
                "is_reversed": ("STRING", {"default": "{}"}),
                "is_single_mode": ("STRING", {"default": "{}"}),
                "image_ids": ("STRING", {"default": "[]"}),
                "image_state": ("STRING", {"default": "[]"})
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("pack_images",)
    FUNCTION = "manage_images"
    CATEGORY = "XISER_Nodes/Visual_Editing"
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

    @staticmethod
    def _tensor_to_uint8_array(img):
        """Convert a tensor or numpy array to uint8 format for hashing."""
        try:
            if isinstance(img, torch.Tensor):
                arr = img.detach().cpu().numpy()
            elif isinstance(img, np.ndarray):
                arr = img
            else:
                return None
            if arr.dtype != np.uint8:
                arr = (arr * 255).clip(0, 255).astype(np.uint8)
            else:
                arr = arr.astype(np.uint8, copy=False)
            return arr
        except Exception:
            return None

    @staticmethod
    def _compute_content_hash(arr, fallback_key):
        """Compute deterministic hash for image content."""
        hasher = hashlib.sha256()
        if isinstance(arr, np.ndarray):
            hasher.update(arr.tobytes())
            hasher.update(str(arr.shape).encode("utf-8"))
            hasher.update(str(arr.dtype).encode("utf-8"))
        else:
            hasher.update(str(fallback_key).encode("utf-8"))
        return hasher.hexdigest()

    @staticmethod
    def _compose_unique_id(base_hash, occurrence):
        """Compose a stable 16-char ID, adding occurrence suffix for duplicates."""
        if occurrence <= 0:
            return base_hash[:16]
        hasher = hashlib.sha256()
        hasher.update(base_hash.encode("utf-8"))
        hasher.update(str(occurrence).encode("utf-8"))
        return hasher.hexdigest()[:16]

    @staticmethod
    def _parse_image_state_payload(raw_value):
        """Parse frontend-provided image_state payload into a list of dict entries."""
        if raw_value is None:
            return []
        data = raw_value
        if isinstance(raw_value, str):
            raw_value = raw_value.strip()
            if not raw_value:
                return []
            try:
                data = json.loads(raw_value)
            except Exception:
                return []
        if isinstance(data, dict):
            images = data.get("images")
            if isinstance(images, list):
                return [entry for entry in images if isinstance(entry, dict)]
            return []
        if isinstance(data, list):
            return [entry for entry in data if isinstance(entry, dict)]
        return []

    def _get_node_output_dir(self, node_id):
        """Get node-specific output directory."""
        if not node_id or node_id in ("", "undefined", "null"):
            node_id = self.random_id
            logger.warning(f"Instance {self.instance_id} - No valid node_id provided, using temporary ID: {node_id}")
        node_dir = os.path.join(self.output_dir, f"node_{node_id}")
        os.makedirs(node_dir, exist_ok=True)
        return node_dir

    def _save_image_with_tracking(self, pil_img: Image.Image, node_dir: str, filename: str, node_id: str, original_filename: str = None, edited: bool = False, source_hash: str = None):
        """Persist an image to the node directory and record metadata for later retrieval."""
        try:
            os.makedirs(node_dir, exist_ok=True)
            img_path = os.path.join(node_dir, filename)
            pil_img.save(img_path, format="PNG")
            self.created_files.add(filename)
            tracking_file = os.path.join(node_dir, f".{filename}.node_{node_id}")
            with open(tracking_file, 'w') as f:
                f.write(json.dumps({
                    "node_id": node_id,
                    "original_filename": original_filename or filename,
                    "upload_time": time.time(),
                    "edited": edited,
                    "source_hash": source_hash
                }))
            logger.debug(f"Instance {self.instance_id} - Saved image {filename} with tracking for node {node_id}")
            return img_path
        except Exception as exc:
            logger.error(f"Instance {self.instance_id} - Failed to save image {filename} for node {node_id}: {exc}")
            return None

    @staticmethod
    def _list_node_image_files(node_dir):
        """Return all managed image files (legacy and new naming)."""
        patterns = [
            os.path.join(node_dir, "xis_image_manager_*.png"),
            os.path.join(node_dir, "upload_image_*.png"),
        ]
        files = []
        for pattern in patterns:
            files.extend(glob.glob(pattern))
        return files

    def _clean_old_files(self, node_id):
        """Remove old cache files for the node based on age, count, and size."""
        node_dir = self._get_node_output_dir(node_id)
        try:
            files = self._list_node_image_files(node_dir)
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

    def manage_images(self, pack_images=None, image_order="{}", enabled_layers="{}", node_id="", node_size="[360, 360]", is_reversed="{}", is_single_mode="{}", image_ids="[]", image_state="[]", **kwargs):
        """Process images based on frontend-provided order and enabled state."""
        node_id = str(kwargs.get('node_id', node_id) or self.id)
        self.id = node_id

        try:
            node_size_list = json.loads(node_size) if node_size and node_size.strip() else [360, 360]
            if not isinstance(node_size_list, list) or len(node_size_list) != 2:
                node_size_list = [360, 360]
        except Exception as e:
            logger.warning(f"Instance {self.instance_id} - Node {node_id}: Failed to parse node_size: {e}, using default [360, 360]")
            node_size_list = [360, 360]

        # Parse is_reversed
        try:
            reverse_data = json.loads(is_reversed) if is_reversed and is_reversed != "{}" else {}
            is_reversed_flag = reverse_data.get("reversed", False) if isinstance(reverse_data, dict) else reverse_data
        except Exception as e:
            logger.error(f"Instance {self.instance_id} - Node {node_id}: Failed to parse is_reversed: {e}, using default False")
            is_reversed_flag = False

        # Parse is_single_mode
        try:
            single_mode_data = json.loads(is_single_mode) if is_single_mode and is_single_mode != "{}" else {}
            is_single_mode_flag = single_mode_data.get("single_mode", False) if isinstance(single_mode_data, dict) else single_mode_data
        except Exception as e:
            logger.error(f"Instance {self.instance_id} - Node {node_id}: Failed to parse is_single_mode: {e}, using default False")
            is_single_mode_flag = False

        self._clean_old_files(node_id)
        node_dir = self._get_node_output_dir(node_id)

        parsed_state_entries = self._parse_image_state_payload(image_state)
        state_enabled_lookup = {}
        state_order_lookup = {}
        if parsed_state_entries:
            for pos, entry in enumerate(parsed_state_entries):
                entry_id = entry.get("id")
                if entry_id:
                    state_enabled_lookup[entry_id] = bool(entry.get("enabled", True))
                    state_order_lookup[entry_id] = pos

        def _hash_from_entry(entry):
            if not entry or not isinstance(entry, dict):
                return None
            return entry.get("content_hash") or entry.get("contentHash")

        def _entry_priority(entry):
            entry_id = entry.get("id")
            if entry_id in state_enabled_lookup:
                enabled_priority = 0 if state_enabled_lookup[entry_id] else 1
                order_priority = state_order_lookup.get(entry_id, float("inf"))
            else:
                enabled_priority = 2
                order_priority = float("inf")
            prev_idx = entry.get("index")
            index_priority = prev_idx if prev_idx is not None else float("inf")
            return (enabled_priority, order_priority, index_priority)

        raw_pack_history = getattr(self, "_pack_id_history", {})
        prev_pack_id_map = {
            content_hash: sorted((dict(entry) for entry in entries), key=_entry_priority)
            for content_hash, entries in raw_pack_history.items()
        }

        # Track previously assigned IDs per input index so we can preserve them when
        # image content changes but the logical slot remains the same. This prevents
        # the frontend from losing its ordering when hashes change after an edit.
        prev_index_id_map = {}
        for preview in self.image_previews:
            if preview.get("source") != "pack_images":
                continue
            prev_idx = preview.get("index")
            prev_id = preview.get("image_id")
            if isinstance(prev_idx, int) and prev_id:
                prev_index_id_map.setdefault(prev_idx, []).append(prev_id)

        images_list = []
        image_paths = []
        image_previews = []
        new_pack_id_map = defaultdict(list)
        pack_hash_usage = defaultdict(int)

        # Process pack_images
        if pack_images:
            if not isinstance(pack_images, list):
                logger.error(f"Instance {self.instance_id} - Node {node_id}: Invalid pack_images: expected list, got {type(pack_images)}")
                raise ValueError("pack_images must be a list of torch.Tensor")
            for i, img in enumerate(pack_images):
                filename = f"input_image_{i + 1:02d}.png"
                if not isinstance(img, torch.Tensor) or img.shape[-1] != 4:
                    logger.error(f"Instance {self.instance_id} - Node {node_id}: Invalid image format at index {i}: expected RGBA torch.Tensor, got {img.shape}")
                    raise ValueError("All images must be RGBA torch.Tensor")
                array_uint8 = self._tensor_to_uint8_array(img)
                if array_uint8 is None:
                    logger.error(f"Instance {self.instance_id} - Node {node_id}: Failed to convert image at index {i} to uint8 array")
                    raise ValueError("Failed to convert image to uint8")
                original_uint8 = np.array(array_uint8, copy=True)
                incoming_hash = self._compute_content_hash(array_uint8, f"pack_image_{i}")
                storage_filename = f"xis_image_manager_{i + 1:02d}.png"
                storage_path = os.path.join(node_dir, storage_filename)
                tracking_file = os.path.join(node_dir, f".{storage_filename}.node_{node_id}")

                # If the user cropped this image, prefer the edited file unless the upstream content changed
                use_storage_image = False
                tracked_source_hash = None
                if os.path.exists(tracking_file):
                    try:
                        with open(tracking_file, "r") as f:
                            tracking_data = json.loads(f.read() or "{}")
                        use_storage_image = bool(tracking_data.get("edited"))
                        tracked_source_hash = tracking_data.get("source_hash")
                    except Exception as exc:
                        logger.warning(f"Instance {self.instance_id} - Node {node_id}: Failed to read tracking for {storage_filename}: {exc}")

                pil_img = None
                stored_hash = None
                if use_storage_image and os.path.exists(storage_path):
                    try:
                        pil_img = Image.open(storage_path).convert("RGBA")
                        array_uint8 = np.array(pil_img, dtype=np.uint8)
                        stored_hash = self._compute_content_hash(array_uint8, f"stored_pack_image_{i}")
                        # If we lack a tracked source hash, fall back to comparing stored hash with incoming
                        mismatch_detected = False
                        if tracked_source_hash:
                            mismatch_detected = tracked_source_hash != incoming_hash
                        elif stored_hash and stored_hash != incoming_hash:
                            mismatch_detected = True
                        if mismatch_detected:
                            logger.info(f"Instance {self.instance_id} - Node {node_id}: Pack image {i} changed upstream, ignoring cached edit")
                            pil_img = None
                            use_storage_image = False
                            array_uint8 = np.array(original_uint8, copy=True)
                        else:
                            self.created_files.add(storage_filename)
                            logger.debug(f"Instance {self.instance_id} - Node {node_id}: Using edited image {storage_filename} for pack index {i}")
                    except Exception as exc:
                        logger.warning(f"Instance {self.instance_id} - Node {node_id}: Failed to use edited image {storage_filename}: {exc}")

                if pil_img is None:
                    pil_img = Image.fromarray(array_uint8, mode="RGBA")
                    self._save_image_with_tracking(pil_img, node_dir, storage_filename, node_id, filename, edited=False, source_hash=incoming_hash)
                    content_hash = incoming_hash
                else:
                    content_hash = stored_hash or self._compute_content_hash(array_uint8, f"pack_image_{i}")
                img_tensor = torch.from_numpy(array_uint8.astype(np.float32) / 255.0)
                reuse_list = prev_pack_id_map.get(content_hash)
                image_id = None
                if reuse_list:
                    chosen_entry = reuse_list.pop(0)
                    image_id = chosen_entry.get("id")
                    if not reuse_list:
                        prev_pack_id_map.pop(content_hash, None)
                if not image_id:
                    prev_ids = prev_index_id_map.get(i)
                    if prev_ids:
                        image_id = prev_ids.pop(0)
                        if not prev_ids:
                            prev_index_id_map.pop(i, None)
                if not image_id:
                    occurrence = pack_hash_usage[content_hash]
                    pack_hash_usage[content_hash] += 1
                    image_id = self._compose_unique_id(content_hash, occurrence)
                new_pack_id_map[content_hash].append({"id": image_id, "index": i})
                images_list.append(img_tensor)
                image_paths.append(storage_filename)
                preview_b64 = self._generate_base64_thumbnail(pil_img)
                image_previews.append({
                    "index": i,
                    "preview": preview_b64,
                    "width": pil_img.width,
                    "height": pil_img.height,
                    "filename": filename,
                    "originalFilename": filename,
                    "image_id": image_id,
                    "source": "pack_images",
                    "content_hash": content_hash,
                    "storage_filename": storage_filename
                })

        self._pack_id_history = {
            k: [dict(entry) for entry in v]
            for k, v in new_pack_id_map.items()
        }

        # Load uploaded images - only load images that belong to this specific node instance
        existing_filenames = {
            p.get("storage_filename") or p.get("storageFilename") or p.get("filename")
            for p in image_previews
            if p.get("filename")
        }
        uploaded_hash_usage = defaultdict(int)
        
        # Load uploaded images for this node, sorted by upload time to preserve order
        uploaded_files = self._list_node_image_files(node_dir)
        # Create list of files with their upload time from tracking files
        files_with_upload_time = []
        for file in uploaded_files:
            filename = os.path.basename(file)
            tracking_file = os.path.join(node_dir, f".{filename}.node_{node_id}")
            if os.path.exists(tracking_file):
                try:
                    with open(tracking_file, 'r') as f:
                        tracking_data = json.loads(f.read())
                    upload_time = tracking_data.get("upload_time", os.path.getmtime(file))
                    files_with_upload_time.append((file, upload_time))
                except Exception as e:
                    logger.warning(f"Instance {self.instance_id} - Node {node_id}: Failed to read tracking file for {filename}: {e}")
                    files_with_upload_time.append((file, os.path.getmtime(file)))
            else:
                files_with_upload_time.append((file, os.path.getmtime(file)))
        
        # Sort files by upload time to preserve upload order
        files_with_upload_time.sort(key=lambda x: x[1])
        uploaded_files = [file for file, _ in files_with_upload_time]
        
        for file in uploaded_files:
            filename = os.path.basename(file)
            if filename in existing_filenames:
                continue
            # Check if this image belongs to this node using tracking files
            tracking_file = os.path.join(node_dir, f".{filename}.node_{node_id}")
            if not os.path.exists(tracking_file):
                continue
            try:
                pil_img = Image.open(file).convert("RGBA")
                array_uint8 = np.array(pil_img, dtype=np.uint8)
                base_hash = self._compute_content_hash(array_uint8, f"uploaded:{filename}")
                occurrence = uploaded_hash_usage[base_hash]
                uploaded_hash_usage[base_hash] += 1
                image_id = self._compose_unique_id(base_hash, occurrence)
                img_array = array_uint8.astype(np.float32) / 255.0
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
                    "originalFilename": filename,
                    "image_id": image_id,
                    "source": "uploaded",
                    "content_hash": base_hash,
                    "storage_filename": filename
                })
                # Add to created_files for backward compatibility
                if filename not in self.created_files:
                    self.created_files.add(filename)
                logger.debug(f"Instance {self.instance_id} - Node {node_id}: Loaded uploaded image {filename}")
            except Exception as e:
                logger.error(f"Instance {self.instance_id} - Node {node_id}: Failed to load uploaded image {file}: {e}")
                continue

        self.image_previews = image_previews
        self.image_paths = image_paths

        # If the incoming images differ from cached state (count or hashes), drop stale state to preserve order
        preview_by_id = {p.get("image_id"): p for p in self.image_previews if p.get("image_id")}
        matched_ids = [entry.get("id") for entry in parsed_state_entries if entry.get("id") in preview_by_id]
        state_hash_mismatch = False
        if parsed_state_entries and len(matched_ids) == len(parsed_state_entries) == len(preview_by_id):
            for entry in parsed_state_entries:
                entry_hash = _hash_from_entry(entry)
                preview_hash = preview_by_id.get(entry.get("id"), {}).get("content_hash")
                if entry_hash and preview_hash and entry_hash != preview_hash:
                    state_hash_mismatch = True
                    break
        else:
            state_hash_mismatch = True

        if state_hash_mismatch:
            parsed_state_entries = []
            state_enabled_lookup = {}
            state_order_lookup = {}

        preview_by_index = {p["index"]: p for p in self.image_previews}
        num_images = len(images_list)
        id_to_index = {}
        for preview in self.image_previews:
            img_id = preview.get("image_id")
            if img_id and isinstance(preview.get("index"), int):
                id_to_index[img_id] = preview["index"]

        order = list(range(num_images))
        enabled_by_index = [True] * num_images

        if parsed_state_entries and id_to_index:
            used_indices = set()
            order = []
            for entry in parsed_state_entries:
                img_id = entry.get("id")
                if not img_id:
                    continue
                idx = id_to_index.get(img_id)
                if idx is None or idx in used_indices or idx < 0 or idx >= num_images:
                    continue
                enabled_by_index[idx] = bool(entry.get("enabled", True))
                order.append(idx)
                used_indices.add(idx)
            for idx in range(num_images):
                if idx not in used_indices:
                    order.append(idx)
        else:
            try:
                order_data = json.loads(image_order) if image_order and image_order != "{}" else {}
                raw_order = order_data.get("order", list(range(num_images))) if isinstance(order_data, dict) else order_data
            except Exception as e:
                logger.error(f"Instance {self.instance_id} - Node {node_id}: Failed to parse image_order: {e}, using default order")
                raw_order = list(range(num_images))
            order = self._validate_image_order(raw_order, num_images)

            try:
                enabled_data = json.loads(enabled_layers) if enabled_layers and enabled_layers != "{}" else {}
                raw_enabled = enabled_data.get("enabled", [True] * num_images) if isinstance(enabled_data, dict) else enabled_data
            except Exception as e:
                logger.error(f"Instance {self.instance_id} - Node {node_id}: Failed to parse enabled_layers: {e}, using default [True] * {num_images}")
                raw_enabled = [True] * num_images

            if isinstance(raw_enabled, list):
                if len(raw_enabled) < num_images:
                    raw_enabled = raw_enabled + [True] * (num_images - len(raw_enabled))
                elif len(raw_enabled) > num_images:
                    logger.warning(f"Instance {self.instance_id} - Node {node_id}: enabled_layers length mismatch {len(raw_enabled)} vs {num_images}, trimming")
                    raw_enabled = raw_enabled[:num_images]
            else:
                raw_enabled = [bool(raw_enabled)] * num_images
            enabled_by_index = [bool(flag) for flag in raw_enabled[:num_images]]

        order = self._validate_image_order(order, num_images) if num_images else []

        if is_single_mode_flag and num_images:
            true_indices = [idx for idx, flag in enumerate(enabled_by_index) if flag]
            if len(true_indices) != 1:
                logger.warning(f"Instance {self.instance_id} - Node {node_id}: Single mode enabled but {len(true_indices)} images selected, enforcing single selection")
                enabled_by_index = [False] * num_images
                fallback_idx = order[0] if order else 0
                if fallback_idx < 0 or fallback_idx >= num_images:
                    fallback_idx = 0
                enabled_by_index[fallback_idx] = True

        try:
            reordered_images = []
            for idx in order:
                if not isinstance(idx, int) or idx < 0 or idx >= num_images:
                    continue
                if enabled_by_index[idx]:
                    reordered_images.append(images_list[idx])
        except Exception as e:
            logger.error(f"Instance {self.instance_id} - Node {node_id}: Error generating reordered images: {e}")
            order = list(range(num_images))
            enabled_by_index = [True] * num_images
            if is_single_mode_flag and num_images:
                enabled_by_index = [False] * num_images
                enabled_by_index[0] = True
            reordered_images = [images_list[i] for i in range(num_images) if enabled_by_index[i]]

        image_state_entries = []
        seen_indices = set()
        for idx in order:
            preview = preview_by_index.get(idx)
            if not preview:
                continue
            enabled_flag = bool(enabled_by_index[idx]) if idx < len(enabled_by_index) else True
            image_state_entries.append({
                "id": preview.get("image_id", ""),
                "enabled": enabled_flag,
                "source": preview.get("source", "pack_images"),
                "filename": preview.get("filename"),
                "originalFilename": preview.get("originalFilename", preview.get("filename")),
                "width": preview.get("width"),
                "height": preview.get("height"),
                "index": idx,
                "contentHash": preview.get("content_hash"),
                "content_hash": preview.get("content_hash")
            })
            seen_indices.add(idx)
        for preview in self.image_previews:
            if preview["index"] in seen_indices:
                continue
            idx = preview["index"]
            enabled_flag = bool(enabled_by_index[idx]) if idx < len(enabled_by_index) else True
            image_state_entries.append({
                "id": preview.get("image_id", ""),
                "enabled": enabled_flag,
                "source": preview.get("source", "pack_images"),
                "filename": preview.get("filename"),
                "originalFilename": preview.get("originalFilename", preview.get("filename")),
                "width": preview.get("width"),
                "height": preview.get("height"),
                "index": idx,
                "contentHash": preview.get("content_hash"),
                "content_hash": preview.get("content_hash")
            })

        ui_data = {
            "image_previews": self.image_previews,
            "image_order": [order],  # Ensure iterable
            "enabled_layers": [enabled_by_index],  # Ensure iterable
            "node_size": [node_size_list],  # Already a list
            "is_reversed": [is_reversed_flag],  # Ensure iterable
            "is_single_mode": [is_single_mode_flag],  # Ensure iterable
            "full_image_order": order,  # For frontend state restoration
            "image_ids": [[preview.get("image_id", "") for preview in self.image_previews]],
            "image_state": [image_state_entries]
        }
        logger.info(f"Instance {self.instance_id} - Node {node_id}: Returning {len(reordered_images)} images, order: {order}, enabled: {enabled_by_index}, single_mode: {is_single_mode_flag}, node_size: {node_size_list}")
        return {
            "ui": ui_data,
            "result": (reordered_images,)
        }

    def get_ui_data(self, node_id: str) -> dict:
        """Retrieve UI data for frontend."""
        logger.debug(f"Instance {self.instance_id} - Node {node_id}: Getting UI data with {len(self.image_previews)} previews")
        return {
            "image_previews": [
                {
                    "index": p["index"],
                    "preview": p["preview"],
                    "width": p["width"],
                    "height": p["height"],
                    "filename": p["filename"],
                    "originalFilename": p.get("originalFilename", p["filename"]),
                    "image_id": p.get("image_id", ""),
                    "source": p.get("source", "pack_images"),
                    "content_hash": p.get("content_hash"),
                    "storage_filename": p.get("storage_filename", p["filename"])
                } for p in self.image_previews
            ],
            "image_order": [list(range(len(self.image_previews)))],  # Ensure iterable
            "enabled_layers": [[True] * len(self.image_previews)],  # Ensure iterable
            "node_size": [[360, 360]],  # Ensure iterable
            "is_reversed": [False],  # Ensure iterable
            "is_single_mode": [False],  # Ensure iterable
            "image_ids": [[p.get("image_id", "") for p in self.image_previews]],
            "image_state": [[
                {
                    "id": p.get("image_id", ""),
                    "enabled": True,
                    "source": p.get("source", "pack_images"),
                    "filename": p.get("filename"),
                    "originalFilename": p.get("originalFilename", p.get("filename")),
                    "width": p.get("width"),
                    "height": p.get("height"),
                    "index": p.get("index"),
                    "contentHash": p.get("content_hash"),
                    "content_hash": p.get("content_hash"),
                    "storageFilename": p.get("storage_filename", p.get("filename")),
                    "storage_filename": p.get("storage_filename", p.get("filename"))
                }
                for p in self.image_previews
            ]]
        }

    def set_ui_data(self, node_id: str, data: dict) -> None:
        """Update image previews and paths based on frontend data."""
        logger.debug(f"Instance {self.instance_id} - Node {node_id}: Setting UI data with {len(data.get('image_previews', []))} previews")
        self.id = node_id
        try:
            self.image_previews = [
                {
                    "index": p["index"],
                    "preview": p.get("preview"),
                    "width": p.get("width"),
                    "height": p.get("height"),
                    "filename": p.get("filename"),
                    "originalFilename": p.get("originalFilename", p["filename"]),
                    "image_id": p.get("image_id", ""),
                    "source": p.get("source", "pack_images"),
                    "content_hash": p.get("content_hash"),
                    "storage_filename": p.get("storage_filename", p.get("filename"))
                } for p in data.get("image_previews", []) if p.get("filename")
            ]
            self.image_paths = [p.get("storage_filename", p["filename"]) for p in self.image_previews]
            pack_id_map = defaultdict(list)
            for preview in self.image_previews:
                if preview.get("source") == "pack_images":
                    content_hash = preview.get("content_hash")
                    image_id = preview.get("image_id")
                    if content_hash and image_id:
                        pack_id_map[content_hash].append({
                            "id": image_id,
                            "index": preview.get("index")
                        })
            self._pack_id_history = {k: list(v) for k, v in pack_id_map.items()}
            logger.info(f"Instance {self.instance_id} - Node {node_id}: UI data set successfully")
        except Exception as e:
            logger.error(f"Instance {self.instance_id} - Node {node_id}: Failed to set UI data: {str(e)}")
            raise

    def cleanup(self):
        """Clean up all files created by this instance."""
        # Clean up image files
        node_dir = self._get_node_output_dir(self.id)
        for filename in list(self.created_files):
            file_path = os.path.join(node_dir, filename)
            try:
                if os.path.exists(file_path):
                    os.remove(file_path)
                    logger.info(f"Instance {self.instance_id} - Deleted file during cleanup: {file_path}")
                # Also remove tracking file
                tracking_file = os.path.join(node_dir, f".{filename}.node_{self.id}")
                if os.path.exists(tracking_file):
                    os.remove(tracking_file)
                    logger.info(f"Instance {self.instance_id} - Deleted tracking file during cleanup: {tracking_file}")
                self.created_files.discard(filename)
            except Exception as e:
                logger.error(f"Instance {self.instance_id} - Failed to delete file during cleanup {file_path}: {e}")
        self.image_previews = []
        self.image_paths = []
        self._pack_id_history = {}

    def __del__(self):
        """Destructor to ensure cleanup of files when the instance is deleted."""
        self.cleanup()

    @classmethod
    def IS_CHANGED(cls, pack_images=None, image_state="[]", image_order="{}", enabled_layers="{}", image_ids="[]", is_reversed="{}", is_single_mode="{}", **kwargs):
        """Compute a fingerprint for caching that ignores node_size changes."""
        import hashlib

        def _normalize_pack_images(value):
            if value is None:
                return []
            actual = value
            if isinstance(actual, tuple):
                if len(actual) == 1:
                    actual = actual[0]
                else:
                    actual = list(actual)
            if actual is None:
                return []
            if isinstance(actual, (list, tuple)):
                return list(actual)
            return [actual]

        def _parse_json(raw_value, default):
            if raw_value is None:
                return default
            if isinstance(raw_value, str):
                raw_value = raw_value.strip()
                if not raw_value:
                    return default
                try:
                    return json.loads(raw_value)
                except Exception:
                    return default
            return raw_value

        def _parse_bool(raw_value):
            data = _parse_json(raw_value, None)
            if isinstance(data, dict):
                data = next(iter(data.values()), None)
            if isinstance(data, bool):
                return data
            if isinstance(data, (int, float)):
                return bool(data)
            if isinstance(data, str):
                lowered = data.strip().lower()
                if lowered in {"true", "1", "yes", "on"}:
                    return True
                if lowered in {"false", "0", "no", "off"}:
                    return False
            return False

        pack_images_list = _normalize_pack_images(pack_images)
        pack_hashes = []
        for idx, img in enumerate(pack_images_list):
            try:
                arr_uint8 = cls._tensor_to_uint8_array(img)
                if isinstance(arr_uint8, np.ndarray):
                    pack_hash = cls._compute_content_hash(arr_uint8, f"pack_image_{idx}")
                else:
                    pack_hash = cls._compute_content_hash(None, f"pack_image_{idx}")
            except Exception:
                pack_hash = cls._compute_content_hash(None, f"pack_image_{idx}")
            pack_hashes.append(pack_hash)

        state_entries = cls._parse_image_state_payload(image_state)
        state_signature = []
        if state_entries:
            for entry in state_entries:
                identifier = (
                    entry.get("id")
                    or entry.get("identifier")
                    or entry.get("filename")
                    or entry.get("originalFilename")
                )
                if not identifier:
                    continue
                state_signature.append((str(identifier), bool(entry.get("enabled", True))))
        else:
            order_data = _parse_json(image_order, {})
            enabled_data = _parse_json(enabled_layers, {})
            ids_data = _parse_json(image_ids, {})

            order = order_data.get("order", []) if isinstance(order_data, dict) else order_data or []
            enabled = enabled_data.get("enabled", []) if isinstance(enabled_data, dict) else enabled_data or []
            identifiers = ids_data.get("image_ids", []) if isinstance(ids_data, dict) else ids_data or []

            if not identifiers:
                identifiers = [f"pack_image_{idx}" for idx in range(len(pack_hashes))]
            if not order:
                order = list(range(len(identifiers)))

            for pos, idx in enumerate(order):
                if not isinstance(idx, int):
                    continue
                if idx < 0 or idx >= len(identifiers):
                    continue
                enabled_flag = enabled[idx] if idx < len(enabled) else True
                state_signature.append((str(identifiers[idx]), bool(enabled_flag)))

        state_signature.sort(key=lambda x: x[0])

        is_reversed_flag = _parse_bool(is_reversed)
        is_single_mode_flag = _parse_bool(is_single_mode)

        hasher = hashlib.sha256()
        hasher.update(f"pack_count:{len(pack_hashes)}".encode("utf-8"))
        for pack_hash in pack_hashes:
            hasher.update(pack_hash.encode("utf-8"))
        hasher.update(f"state_signature:{json.dumps(state_signature)}".encode("utf-8"))
        hasher.update(f"is_reversed:{int(is_reversed_flag)}".encode("utf-8"))
        hasher.update(f"is_single_mode:{int(is_single_mode_flag)}".encode("utf-8"))

        fingerprint = hasher.hexdigest()
        logger.debug(
            "IS_CHANGED fingerprint=%s pack_hashes=%s state=%s reversed=%s single=%s",
            fingerprint,
            pack_hashes,
            state_signature,
            is_reversed_flag,
            is_single_mode_flag,
        )
        return fingerprint

def _resolve_node_dir(node_id: str) -> str:
    """Resolve the node-specific directory, ensuring it exists."""
    base_dir = os.path.join(folder_paths.get_output_directory(), "xis_image_manager")
    if node_id and node_id not in ("undefined", "null", ""):
        base_dir = os.path.join(base_dir, f"node_{node_id}")
    os.makedirs(base_dir, exist_ok=True)
    return base_dir

def _find_node_instance(node_id: str):
    """Locate the XIS_ImageManager node instance by node_id."""
    try:
        from server import PromptServer
        for node in PromptServer.instance.node_instances.values():
            if getattr(node, "id", None) == node_id:
                return node
    except Exception as exc:
        logger.error(f"Instance - Failed to find node {node_id}: {exc}")
    return None

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

        existing_files = XIS_ImageManager._list_node_image_files(node_dir)
        upload_pattern = re.compile(r"upload_image_(\\d+)\\.png$")
        used_numbers = {
            int(match.group(1))
            for path in existing_files
            for match in [upload_pattern.search(os.path.basename(path))]
            if match
        }
        next_index = max(used_numbers) + 1 if used_numbers else 1

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
                current_index = next_index
                while current_index in used_numbers or os.path.exists(os.path.join(node_dir, f"upload_image_{current_index:02d}.png")):
                    current_index += 1
                used_numbers.add(current_index)
                next_index = current_index + 1
                img_filename = f"upload_image_{current_index:02d}.png"
                img_path = os.path.join(node_dir, img_filename)
                pil_img.save(img_path, format="PNG")
                
                # Create a tracking file to mark this image as belonging to the node
                # Store both node_id and the original filename to help with ordering
                try:
                    tracking_file = os.path.join(node_dir, f".{img_filename}.node_{node_id}")
                    with open(tracking_file, 'w') as f:
                        f.write(json.dumps({
                            "node_id": node_id,
                            "original_filename": filename,
                            "upload_time": time.time(),
                            "edited": False
                        }))
                    logger.debug(f"Instance - Created tracking file for {img_filename} to node {node_id}")
                except Exception as e:
                    logger.warning(f"Instance - Could not create tracking file for {img_filename}: {e}")
                
                preview_b64 = XIS_ImageManager()._generate_base64_thumbnail(pil_img)
                images.append({
                    "filename": img_filename,
                    "storageFilename": img_filename,
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

async def handle_fetch_image(request):
    """Return the original image for editing."""
    try:
        data = await request.json()
        node_id = str(data.get("node_id") or "")
        filename = data.get("storage_filename") or data.get("filename")
        if not filename or not (filename.startswith("upload_image_") or filename.startswith("xis_image_manager_")):
            return web.json_response({"error": "Invalid filename"}, status=400)
        node_dir = _resolve_node_dir(node_id)
        img_path = os.path.join(node_dir, filename)
        if not os.path.exists(img_path):
            return web.json_response({"error": "Image not found"}, status=404)
        pil_img = Image.open(img_path).convert("RGBA")
        buffered = BytesIO()
        pil_img.save(buffered, format="PNG")
        img_b64 = base64.b64encode(buffered.getvalue()).decode("utf-8")
        return web.json_response({
            "image": img_b64,
            "width": pil_img.width,
            "height": pil_img.height,
            "filename": filename
        })
    except Exception as exc:
        logger.error(f"Instance - Failed to fetch image: {exc}")
        return web.json_response({"error": f"Failed to fetch image: {exc}"}, status=500)

async def handle_crop_image(request):
    """Persist a cropped image and return updated preview metadata."""
    try:
        data = await request.json()
        node_id = str(data.get("node_id") or "")
        filename = data.get("storage_filename") or data.get("filename")
        image_id = data.get("image_id") or ""
        image_payload = data.get("image")
        original_filename = data.get("originalFilename") or filename
        incoming_source_hash = data.get("source_hash") or data.get("sourceHash")

        if not filename or not (filename.startswith("upload_image_") or filename.startswith("xis_image_manager_")):
            return web.json_response({"error": "Invalid filename for crop"}, status=400)
        if not image_payload:
            return web.json_response({"error": "Missing image payload"}, status=400)

        node_dir = _resolve_node_dir(node_id)
        try:
            if "base64," in image_payload:
                image_payload = image_payload.split("base64,", 1)[1]
            img_bytes = base64.b64decode(image_payload)
        except Exception:
            return web.json_response({"error": "Invalid image data"}, status=400)

        pil_img = Image.open(BytesIO(img_bytes)).convert("RGBA")
        node_instance = _find_node_instance(node_id)
        tracking_file = os.path.join(node_dir, f".{filename}.node_{node_id}")
        existing_source_hash = None
        try:
            if os.path.exists(tracking_file):
                with open(tracking_file, "r") as f:
                    tracking_data = json.loads(f.read() or "{}")
                existing_source_hash = tracking_data.get("source_hash")
        except Exception as exc:
            logger.warning(f"Instance - Failed to read tracking for cropped image {filename}: {exc}")
        source_hash = incoming_source_hash or existing_source_hash

        if node_instance:
            node_instance._save_image_with_tracking(pil_img, node_dir, filename, node_id, original_filename, edited=True, source_hash=source_hash)
        else:
            img_path = os.path.join(node_dir, filename)
            pil_img.save(img_path, format="PNG")
            try:
                with open(tracking_file, 'w') as f:
                    f.write(json.dumps({
                        "node_id": node_id,
                        "original_filename": original_filename or filename,
                        "upload_time": time.time(),
                        "edited": True,
                        "source_hash": source_hash
                    }))
            except Exception as exc:
                logger.warning(f"Instance - Failed to write tracking for cropped image {filename}: {exc}")

        content_hash = XIS_ImageManager._compute_content_hash(np.array(pil_img, dtype=np.uint8), f"crop:{filename}")
        thumbnail_generator = node_instance._generate_base64_thumbnail if node_instance else XIS_ImageManager()._generate_base64_thumbnail
        preview_b64 = thumbnail_generator(pil_img)
        if node_instance:
            node_instance.created_files.add(filename)
        return web.json_response({
            "success": True,
            "preview": preview_b64,
            "width": pil_img.width,
            "height": pil_img.height,
            "filename": filename,
            "storage_filename": filename,
            "content_hash": content_hash
        })
    except Exception as exc:
        logger.error(f"Instance - Failed to handle crop request: {exc}")
        return web.json_response({"error": f"Failed to save cropped image: {exc}"}, status=500)

# Register delete endpoint
async def handle_delete(request):
    """Handle image deletion for XIS_ImageManager node."""
    try:
        data = await request.json()
        node_id = data.get('node_id')
        filename = data.get('filename')
        if not filename or not (filename.startswith("xis_image_manager_") or filename.startswith("upload_image_")):
            logger.error(f"Instance - Invalid filename for deletion: {filename}")
            return web.json_response({"error": "Invalid filename"}, status=400)
        node_dir = os.path.join(folder_paths.get_output_directory(), "xis_image_manager")
        if node_id and node_id not in ("undefined", "null", ""):
            node_dir = os.path.join(node_dir, f"node_{node_id}")
        img_path = os.path.join(node_dir, filename)
        if os.path.exists(img_path):
            os.remove(img_path)
            logger.info(f"Instance - Deleted image {filename} for node {node_id}")
            # Also remove tracking file
            tracking_file = os.path.join(node_dir, f".{filename}.node_{node_id}")
            if os.path.exists(tracking_file):
                os.remove(tracking_file)
                logger.info(f"Instance - Deleted tracking file for image {filename}")
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
        
        node_instance = None
        for node in PromptServer.instance.node_instances.values():
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
        web.post('/fetch_image/xis_image_manager', handle_fetch_image),
        web.post('/crop/xis_image_manager', handle_crop_image),
        web.post('/delete/xis_image_manager', handle_delete),
        web.post('/set_ui_data/xis_image_manager', handle_set_ui_data),
    ])
    logger.info("Registered /upload/xis_image_manager, /fetch_image/xis_image_manager, /crop/xis_image_manager, /delete/xis_image_manager, and /set_ui_data/xis_image_manager endpoints")
except Exception as e:
    logger.error(f"Failed to register endpoints: {e}")

# Node class mappings
NODE_CLASS_MAPPINGS = {
    "XIS_ImageManager": XIS_ImageManager
}
