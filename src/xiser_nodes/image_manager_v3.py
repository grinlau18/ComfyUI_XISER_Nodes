"""
XISER Image Manager Node for ComfyUI - V3版本
基于V1版本完全重新实现，支持图像管理、上传、预览生成和输出
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
import logging
import threading

# V3 API imports
from comfy_api.v0_0_2 import io, ui

# Import from existing image_manager modules
from .image_manager.constants import logger as image_manager_logger
from .image_manager.storage import (
    get_node_output_dir,
    list_node_image_files,
    save_image_with_tracking,
    clean_old_files,
    resolve_node_dir
)
from .image_manager.state import parse_image_state_payload, validate_image_order, hash_from_entry
from .image_manager.processor import process_pack_images, process_uploaded_images
from .image_manager.editor.core import ImageEditor

# Log level control
LOG_LEVEL = "error"  # Options: "info", "warning", "error", "debug"

# Initialize logger
logger = logging.getLogger("XISER_ImageManager_V3")
logger.setLevel(getattr(logging, LOG_LEVEL.upper(), logging.ERROR))

class XIS_ImageManagerV3(io.ComfyNode):
    """A custom node for managing images, handling input, upload, and output based on frontend-provided order and enabled state - V3版本。"""

    # Class-level state management
    _node_states = {}  # node_id -> state dict
    _state_lock = threading.Lock()

    @classmethod
    def _get_node_state(cls, node_id):
        """Get or create state for a specific node."""
        with cls._state_lock:
            if node_id not in cls._node_states:
                cls._node_states[node_id] = {
                    "output_dir": os.path.join(folder_paths.get_output_directory(), "xis_image_manager"),
                    "instance_id": uuid.uuid4().hex,
                    "created_files": set(),
                    "random_id": str(uuid.uuid4().hex),
                    "id": "",
                    "image_previews": [],
                    "image_paths": [],
                    "_pack_id_history": {},
                    "logger": logger
                }
                # Create output directory
                os.makedirs(cls._node_states[node_id]["output_dir"], exist_ok=True)
                logger.info(f"Instance {cls._node_states[node_id]['instance_id']} - XIS_ImageManagerV3 initialized with output directory: {cls._node_states[node_id]['output_dir']}")
            return cls._node_states[node_id]

    @classmethod
    def _create_node_adapter(cls, state):
        """Create a node adapter that mimics the V1 node interface for compatibility with existing functions."""
        class NodeAdapter:
            def __init__(self, state_dict):
                self._state = state_dict  # Reference to original state dict
                self.instance_id = state_dict.get("instance_id", "")
                self.id = state_dict.get("id", "")
                self.random_id = state_dict.get("random_id", "")
                self.created_files = state_dict.get("created_files", set())
                self.image_previews = state_dict.get("image_previews", [])
                self.image_paths = state_dict.get("image_paths", [])
                self._pack_id_history = state_dict.get("_pack_id_history", {})
                # Reference to the class for class methods
                self._cls = cls

            def __getattr__(self, name):
                # Allow access to state dict attributes
                if name in self.__dict__:
                    return self.__dict__[name]
                # Try to get from state dict
                if name in self._state:
                    return self._state[name]
                # Try to get class methods
                if hasattr(self._cls, name):
                    return getattr(self._cls, name)
                # Try to get static methods
                if name == '_generate_base64_thumbnail':
                    return self._cls._generate_base64_thumbnail
                if name == '_tensor_to_uint8_array':
                    # Import the function from storage module
                    from .image_manager.storage import tensor_to_uint8_array
                    return tensor_to_uint8_array
                if name == '_compute_content_hash':
                    # Import the function from storage module
                    from .image_manager.storage import compute_content_hash
                    return compute_content_hash
                if name == '_compose_unique_id':
                    # Import the function from storage module
                    from .image_manager.storage import compose_unique_id
                    return compose_unique_id
                if name == '_parse_image_state_payload':
                    return self._cls._parse_image_state_payload
                if name == '_list_node_image_files':
                    # Import the function from storage module
                    from .image_manager.storage import list_node_image_files
                    return list_node_image_files
                if name == '_get_node_output_dir':
                    # Import the function from storage module
                    from .image_manager.storage import get_node_output_dir
                    return lambda node_id: get_node_output_dir(node_id, self.random_id)
                if name == '_save_image_with_tracking':
                    # Import the function from storage module
                    from .image_manager.storage import save_image_with_tracking
                    return lambda pil_img, node_dir, filename, node_id, original_filename=None, edited=False, source_hash=None: save_image_with_tracking(
                        pil_img, node_dir, filename, node_id, original_filename=original_filename, edited=edited, source_hash=source_hash, created_files=self.created_files
                    )
                if name == '_clean_old_files':
                    # Import the function from storage module
                    from .image_manager.storage import clean_old_files
                    return lambda node_id: clean_old_files(node_id, self.created_files)
                if name == '_validate_image_order':
                    # Import the function from state module
                    from .image_manager.state import validate_image_order
                    return validate_image_order
                raise AttributeError(f"NodeAdapter has no attribute '{name}'")

            def sync_to_state(self):
                """Sync adapter attributes back to state dict."""
                self._state["instance_id"] = self.instance_id
                self._state["id"] = self.id
                self._state["random_id"] = self.random_id
                self._state["created_files"] = self.created_files
                self._state["image_previews"] = self.image_previews
                self._state["image_paths"] = self.image_paths
                self._state["_pack_id_history"] = self._pack_id_history

        adapter = NodeAdapter(state)
        return adapter

    @classmethod
    def _generate_base64_thumbnail(cls, pil_img, max_size=64, format="PNG"):
        """Generate a scaled thumbnail as Base64 data for the preview."""
        try:
            img_width, img_height = pil_img.size
            scale = min(max_size / img_width, max_size / img_height, 1.0)
            new_size = (int(img_width * scale), int(img_height * scale))
            thumbnail = pil_img.resize(new_size, Image.Resampling.LANCZOS)
            buffered = BytesIO()
            thumbnail.save(buffered, format="PNG")
            base64_str = base64.b64encode(buffered.getvalue()).decode("utf-8")
            logger.debug(f"Generated thumbnail: size={new_size}")
            return base64_str
        except Exception as e:
            logger.error(f"Failed to generate thumbnail: {e}")
            raise ValueError(f"Thumbnail generation failed: {str(e)}")

    @classmethod
    def _parse_image_state_payload(cls, raw_value):
        """Parse image state payload - wrapper for the imported function."""
        from .image_manager.state import parse_image_state_payload
        return parse_image_state_payload(raw_value)

    @classmethod
    def define_schema(cls) -> io.Schema:
        """Define node schema for V3 architecture."""
        return io.Schema(
            node_id="XIS_ImageManager",
            display_name="Image Manager",
            category="XISER_Nodes/Visual_Editing",
            description="管理图像，支持上传、预览、排序和图层控制",
            inputs=[
                io.Image.Input("pack_images",
                             optional=True,
                             tooltip="输入图像包（可选）"),
                io.String.Input("image_order",
                              default="{}",
                              multiline=False,
                              optional=True,
                              tooltip="图像顺序（JSON格式）"),
                io.String.Input("enabled_layers",
                              default="{}",
                              multiline=False,
                              optional=True,
                              tooltip="启用的图层（JSON格式）"),
                io.String.Input("node_id",
                              default="",
                              multiline=False,
                              optional=True,
                              tooltip="节点ID（可选字段）"),
                io.String.Input("node_size",
                              default="[360, 360]",
                              multiline=False,
                              optional=True,
                              tooltip="节点尺寸（JSON格式）"),
                io.String.Input("is_reversed",
                              default="{}",
                              multiline=False,
                              optional=True,
                              tooltip="是否反转（JSON格式）"),
                io.String.Input("is_single_mode",
                              default="{}",
                              multiline=False,
                              optional=True,
                              tooltip="是否单图模式（JSON格式）"),
                io.String.Input("image_ids",
                              default="[]",
                              multiline=False,
                              optional=True,
                              tooltip="图像ID列表（JSON格式）"),
                io.String.Input("image_state",
                              default="[]",
                              multiline=False,
                              optional=True,
                              tooltip="图像状态（JSON格式）")
            ],
            outputs=[
                io.Image.Output(display_name="pack_images")
            ],
            is_output_node=True
        )

    @classmethod
    def fingerprint_inputs(cls, pack_images=None, image_state="[]", image_order="{}", enabled_layers="{}", image_ids="[]", is_reversed="{}", is_single_mode="{}", **kwargs):
        """Compute a fingerprint for caching that ignores node_size changes."""
        return cls._fingerprint_inputs_optimized(
            pack_images, image_state, image_order, enabled_layers,
            image_ids, is_reversed, is_single_mode, **kwargs
        )

    @classmethod
    def _fingerprint_inputs_optimized(cls, pack_images=None, image_state="[]", image_order="{}", enabled_layers="{}", image_ids="[]", is_reversed="{}", is_single_mode="{}", **kwargs):
        """优化的指纹计算，减少计算开销"""
        import hashlib
        import json

        # 简化的图像计数和状态摘要
        pack_count = 0
        if pack_images is not None:
            if isinstance(pack_images, (list, tuple)):
                pack_count = len(pack_images)
            elif isinstance(pack_images, torch.Tensor):
                pack_count = 1
            else:
                try:
                    # 尝试获取长度
                    pack_count = len(pack_images)
                except:
                    pack_count = 1 if pack_images is not None else 0

        # 简化状态处理 - 只取关键信息
        state_summary = ""
        try:
            if image_state and image_state.strip() and image_state != "[]":
                # 只取前200个字符作为状态摘要
                state_summary = image_state.strip()[:200]
            elif image_order and image_order.strip() and image_order != "{}":
                state_summary = f"order:{image_order.strip()[:100]}"
        except:
            pass

        # 简化布尔值解析
        is_reversed_flag = False
        is_single_mode_flag = False

        try:
            if is_reversed and is_reversed.strip() and is_reversed != "{}":
                rev_data = json.loads(is_reversed)
                if isinstance(rev_data, dict):
                    is_reversed_flag = bool(rev_data.get("reversed", False))
                else:
                    is_reversed_flag = bool(rev_data)
        except:
            pass

        try:
            if is_single_mode and is_single_mode.strip() and is_single_mode != "{}":
                single_data = json.loads(is_single_mode)
                if isinstance(single_data, dict):
                    is_single_mode_flag = bool(single_data.get("single_mode", False))
                else:
                    is_single_mode_flag = bool(single_data)
        except:
            pass

        # 简化的哈希计算
        hasher = hashlib.sha256()
        hasher.update(f"pack_count:{pack_count}".encode("utf-8"))
        hasher.update(f"state:{state_summary}".encode("utf-8"))
        hasher.update(f"reversed:{int(is_reversed_flag)}".encode("utf-8"))
        hasher.update(f"single:{int(is_single_mode_flag)}".encode("utf-8"))

        # 如果有图像数据，添加简化的图像信息
        if pack_count > 0 and pack_images is not None:
            try:
                if isinstance(pack_images, (list, tuple)):
                    for i, img in enumerate(pack_images[:10]):  # 只处理前10张
                        if isinstance(img, torch.Tensor):
                            hasher.update(f"shape_{i}:{tuple(img.shape)}".encode("utf-8"))
                            hasher.update(f"dtype_{i}:{str(img.dtype)}".encode("utf-8"))
                elif isinstance(pack_images, torch.Tensor):
                    hasher.update(f"shape:{tuple(pack_images.shape)}".encode("utf-8"))
                    hasher.update(f"dtype:{str(pack_images.dtype)}".encode("utf-8"))
            except Exception as e:
                logger.debug(f"Error adding image info to hash: {e}")

        fingerprint = hasher.hexdigest()
        logger.debug(
            "Optimized fingerprint: %s (pack_count=%s, state_len=%s, reversed=%s, single=%s)",
            fingerprint[:16],
            pack_count,
            len(state_summary),
            is_reversed_flag,
            is_single_mode_flag,
        )
        return fingerprint

    @classmethod
    def execute(cls, pack_images=None, image_order="{}", enabled_layers="{}", node_id="", node_size="[360, 360]", is_reversed="{}", is_single_mode="{}", image_ids="[]", image_state="[]", **kwargs):
        """Process images based on frontend-provided order and enabled state."""
        import time
        total_start = time.perf_counter()

        # Get or create node state
        state = cls._get_node_state(node_id)

        # Update node_id in state if provided
        if node_id and node_id != state["id"]:
            state["id"] = node_id
            state["random_id"] = str(uuid.uuid4().hex)

        node_id = state["id"] or str(uuid.uuid4().hex)
        state["id"] = node_id

        try:
            node_size_list = json.loads(node_size) if node_size and node_size.strip() else [360, 360]
            if not isinstance(node_size_list, list) or len(node_size_list) != 2:
                node_size_list = [360, 360]
        except Exception as e:
            logger.warning(f"Instance {state['instance_id']} - Node {node_id}: Failed to parse node_size: {e}, using default [360, 360]")
            node_size_list = [360, 360]

        # Parse is_reversed
        try:
            reverse_data = json.loads(is_reversed) if is_reversed and is_reversed != "{}" else {}
            is_reversed_flag = reverse_data.get("reversed", False) if isinstance(reverse_data, dict) else reverse_data
        except Exception as e:
            logger.error(f"Instance {state['instance_id']} - Node {node_id}: Failed to parse is_reversed: {e}, using default False")
            is_reversed_flag = False

        # Parse is_single_mode
        try:
            single_mode_data = json.loads(is_single_mode) if is_single_mode and is_single_mode != "{}" else {}
            is_single_mode_flag = single_mode_data.get("single_mode", False) if isinstance(single_mode_data, dict) else single_mode_data
        except Exception as e:
            logger.error(f"Instance {state['instance_id']} - Node {node_id}: Failed to parse is_single_mode: {e}, using default False")
            is_single_mode_flag = False

        # Create node adapter for compatibility with existing functions
        node_adapter = cls._create_node_adapter(state)

        # Clean old files - use adapter method
        node_adapter._clean_old_files(node_id)
        node_dir = node_adapter._get_node_output_dir(node_id)

        parsed_state_entries = parse_image_state_payload(image_state)
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

        raw_pack_history = state.get("_pack_id_history", {})
        prev_pack_id_map = {
            content_hash: sorted((dict(entry) for entry in entries), key=_entry_priority)
            for content_hash, entries in raw_pack_history.items()
        }

        # Track previously assigned IDs per input index
        prev_index_id_map = {}
        for preview in state["image_previews"]:
            if preview.get("source") != "pack_images":
                continue
            prev_idx = preview.get("index")
            prev_id = preview.get("image_id")
            if isinstance(prev_idx, int) and prev_id:
                prev_index_id_map.setdefault(prev_idx, []).append(prev_id)

        # Process pack images
        images_list, image_paths, image_previews, new_pack_id_map = process_pack_images(
            node_adapter,
            pack_images,
            node_id,
            prev_pack_id_map,
            prev_index_id_map,
            node_dir
        )

        # Update adapter with new data
        node_adapter.image_previews = image_previews
        node_adapter.image_paths = image_paths
        node_adapter._pack_id_history = new_pack_id_map

        # Process uploaded images
        images_list, image_paths, image_previews = process_uploaded_images(
            node_adapter,
            image_previews,
            images_list,
            node_id,
            node_dir
        )

        # Update adapter again
        node_adapter.image_previews = image_previews
        node_adapter.image_paths = image_paths

        # Sync adapter data back to state
        node_adapter.sync_to_state()

        # If the incoming images differ from cached state (count or hashes), drop stale state to preserve order
        preview_by_id = {p.get("image_id"): p for p in state["image_previews"] if p.get("image_id")}
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

        preview_by_index = {p["index"]: p for p in state["image_previews"]}
        num_images = len(images_list)
        id_to_index = {}
        for preview in state["image_previews"]:
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
                logger.error(f"Instance {state['instance_id']} - Node {node_id}: Failed to parse image_order: {e}, using default order")
                raw_order = list(range(num_images))
            order = validate_image_order(raw_order, num_images)

            try:
                enabled_data = json.loads(enabled_layers) if enabled_layers and enabled_layers != "{}" else {}
                raw_enabled = enabled_data.get("enabled", [True] * num_images) if isinstance(enabled_data, dict) else enabled_data
            except Exception as e:
                logger.error(f"Instance {state['instance_id']} - Node {node_id}: Failed to parse enabled_layers: {e}, using default [True] * {num_images}")
                raw_enabled = [True] * num_images

            if isinstance(raw_enabled, list):
                if len(raw_enabled) < num_images:
                    raw_enabled = raw_enabled + [True] * (num_images - len(raw_enabled))
                elif len(raw_enabled) > num_images:
                    logger.warning(f"Instance {state['instance_id']} - Node {node_id}: enabled_layers length mismatch {len(raw_enabled)} vs {num_images}, trimming")
                    raw_enabled = raw_enabled[:num_images]
            else:
                raw_enabled = [bool(raw_enabled)] * num_images
            enabled_by_index = [bool(flag) for flag in raw_enabled[:num_images]]

        order = validate_image_order(order, num_images) if num_images else []

        if is_single_mode_flag and num_images:
            true_indices = [idx for idx, flag in enumerate(enabled_by_index) if flag]
            if len(true_indices) != 1:
                logger.warning(f"Instance {state['instance_id']} - Node {node_id}: Single mode enabled but {len(true_indices)} images selected, enforcing single selection")
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
            logger.error(f"Instance {state['instance_id']} - Node {node_id}: Error generating reordered images: {e}")
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
        for preview in state["image_previews"]:
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

        # Prepare UI data for frontend
        ui_data = {
            "image_previews": state["image_previews"],
            "image_order": [order],  # Ensure iterable
            "enabled_layers": [enabled_by_index],  # Ensure iterable
            "node_size": [node_size_list],  # Already a list
            "is_reversed": [is_reversed_flag],  # Ensure iterable
            "is_single_mode": [is_single_mode_flag],  # Ensure iterable
            "full_image_order": order,  # For frontend state restoration
            "image_ids": [[preview.get("image_id", "") for preview in state["image_previews"]]],
            "image_state": [image_state_entries]
        }

        total_time = time.perf_counter() - total_start
        logger.info(f"Instance {state['instance_id']} - Node {node_id}: Returning {len(reordered_images)} images, order: {order}, enabled: {enabled_by_index}, single_mode: {is_single_mode_flag}, node_size: {node_size_list}")
        logger.info(f"Instance {state['instance_id']} - Node {node_id}: Total execution time: {total_time:.3f} seconds")

        # Return with UI data
        return io.NodeOutput(reordered_images, ui=ui_data)

# Export V3 node classes
V3_NODE_CLASSES = [XIS_ImageManagerV3]