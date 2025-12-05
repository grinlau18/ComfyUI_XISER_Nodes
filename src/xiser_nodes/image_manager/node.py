"""
xis_image_manager.py

Backend logic for the XIS_ImageManager node in ComfyUI, handling image input, upload, preview generation, and output.
"""

import os
import uuid
import numpy as np
import torch
from PIL import Image
import base64
from io import BytesIO
import json
import time
import re
import folder_paths
import hashlib
from collections import defaultdict
from .constants import logger
from .storage import (
    get_node_output_dir,
    list_node_image_files,
    save_image_with_tracking,
    clean_old_files,
    resolve_node_dir
)
from .state import parse_image_state_payload, validate_image_order, hash_from_entry
from .processor import process_pack_images, process_uploaded_images
from .editor.core import ImageEditor
# API routes are imported and registered separately to avoid circular imports

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

    def _unwrap_v3_data(self, data):
        """
        处理 v3 节点返回的数据格式，支持 io.NodeOutput 和原始数据

        Args:
            data: 输入数据，可能是 io.NodeOutput、元组或原始数据

        Returns:
            解包后的原始数据
        """
        if data is None:
            return None
        if hasattr(data, 'outputs') and isinstance(data.outputs, tuple):
            # io.NodeOutput 对象
            return data.outputs[0]
        elif isinstance(data, tuple) and len(data) == 1:
            # 可能是 (data,) 格式
            return data[0]
        else:
            # 原始数据
            return data

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
        return tensor_to_uint8_array(img)

    @staticmethod
    def _compute_content_hash(arr, fallback_key):
        return compute_content_hash(arr, fallback_key)

    @staticmethod
    def _compose_unique_id(base_hash, occurrence):
        return compose_unique_id(base_hash, occurrence)

    @staticmethod
    def _parse_image_state_payload(raw_value):
        return parse_image_state_payload(raw_value)

    def _get_node_output_dir(self, node_id):
        return get_node_output_dir(node_id, self.random_id)

    def _save_image_with_tracking(self, pil_img: Image.Image, node_dir: str, filename: str, node_id: str, original_filename: str = None, edited: bool = False, source_hash: str = None):
        return save_image_with_tracking(
            pil_img,
            node_dir,
            filename,
            node_id,
            original_filename=original_filename,
            edited=edited,
            source_hash=source_hash,
            created_files=self.created_files
        )

    @staticmethod
    def _list_node_image_files(node_dir):
        return list_node_image_files(node_dir)

    def _clean_old_files(self, node_id):
        return clean_old_files(node_id, self.created_files)

    def _validate_image_order(self, order, num_images):
        return validate_image_order(order, num_images)

    def manage_images(self, pack_images=None, image_order="{}", enabled_layers="{}", node_id="", node_size="[360, 360]", is_reversed="{}", is_single_mode="{}", image_ids="[]", image_state="[]", **kwargs):
        """Process images based on frontend-provided order and enabled state."""
        # 解包 v3 数据格式
        pack_images = self._unwrap_v3_data(pack_images)

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

        images_list, image_paths, image_previews, new_pack_id_map = process_pack_images(
            self,
            pack_images,
            node_id,
            prev_pack_id_map,
            prev_index_id_map,
            node_dir
        )

        self._pack_id_history = {
            k: [dict(entry) for entry in v]
            for k, v in new_pack_id_map.items()
        }

        images_list, image_paths, image_previews = process_uploaded_images(
            self,
            image_previews,
            images_list,
            node_id,
            node_dir
        )

        self.image_previews = image_previews
        self.image_paths = image_paths

        # If the incoming images differ from cached state (count or hashes), drop stale state to preserve order
        preview_by_id = {p.get("image_id"): p for p in self.image_previews if p.get("image_id")}
        matched_ids = [entry.get("id") for entry in parsed_state_entries if entry.get("id") in preview_by_id]
        state_hash_mismatch = False
        if parsed_state_entries and len(matched_ids) == len(parsed_state_entries) == len(preview_by_id):
            for entry in parsed_state_entries:
                entry_hash = hash_from_entry(entry)
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
            # 处理 v3 节点数据格式 (io.NodeOutput)
            if hasattr(actual, 'outputs') and isinstance(actual.outputs, tuple):
                actual = actual.outputs[0]
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
    return resolve_node_dir(node_id)

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

# API routes are defined in api.py

# Node class mappings
NODE_CLASS_MAPPINGS = {
    "XIS_ImageManager": XIS_ImageManager
}
