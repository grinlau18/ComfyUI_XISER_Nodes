import os
import json
import time
import hashlib
import numpy as np
import torch
from PIL import Image
from io import BytesIO
import glob
import re
from collections import defaultdict
from .constants import logger, get_base_output_dir


def tensor_to_uint8_array(img):
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


def compute_content_hash(arr, fallback_key):
    """Compute deterministic hash for image content."""
    hasher = hashlib.sha256()
    if isinstance(arr, np.ndarray):
        hasher.update(arr.tobytes())
        hasher.update(str(arr.shape).encode("utf-8"))
        hasher.update(str(arr.dtype).encode("utf-8"))
    else:
        hasher.update(str(fallback_key).encode("utf-8"))
    return hasher.hexdigest()


def compose_unique_id(base_hash, occurrence):
    """Compose a stable 16-char ID, adding occurrence suffix for duplicates."""
    if occurrence <= 0:
        return base_hash[:16]
    hasher = hashlib.sha256()
    hasher.update(base_hash.encode("utf-8"))
    hasher.update(str(occurrence).encode("utf-8"))
    return hasher.hexdigest()[:16]


def get_node_output_dir(node_id, fallback_id):
    """Get node-specific output directory."""
    if not node_id or node_id in ("", "undefined", "null"):
        node_id = fallback_id
        logger.warning(f"No valid node_id provided, using temporary ID: {node_id}")
    node_dir = os.path.join(get_base_output_dir(), f"node_{node_id}")
    os.makedirs(node_dir, exist_ok=True)
    return node_dir


def list_node_image_files(node_dir):
    """Return all managed image files (legacy and new naming)."""
    patterns = [
        os.path.join(node_dir, "xis_image_manager_*.png"),
        os.path.join(node_dir, "upload_image_*.png"),
    ]
    files = []
    for pattern in patterns:
        files.extend(glob.glob(pattern))
    return files


def save_image_with_tracking(pil_img, node_dir, filename, node_id, original_filename=None, edited=False, source_hash=None, created_files=None):
    """Persist an image and record metadata."""
    try:
        os.makedirs(node_dir, exist_ok=True)
        img_path = os.path.join(node_dir, filename)
        pil_img.save(img_path, format="PNG")
        if created_files is not None:
            created_files.add(filename)
        tracking_file = os.path.join(node_dir, f".{filename}.node_{node_id}")
        with open(tracking_file, 'w') as f:
            f.write(json.dumps({
                "node_id": node_id,
                "original_filename": original_filename or filename,
                "upload_time": time.time(),
                "edited": edited,
                "source_hash": source_hash
            }))
        logger.debug(f"Saved image {filename} with tracking for node {node_id}")
        return img_path
    except Exception as exc:
        logger.error(f"Failed to save image {filename} for node {node_id}: {exc}")
        return None


def clean_old_files(node_id, created_files):
    """Remove old cache files for the node based on age, count, and size."""
    node_dir = get_node_output_dir(node_id, node_id)
    try:
        files = list_node_image_files(node_dir)
    except Exception as e:
        logger.error(f"Failed to list files in {node_dir}: {e}")
        return

    file_info = []
    total_size = 0
    current_time = time.time()

    for file in files:
        filename = os.path.basename(file)
        if created_files is not None and filename not in created_files:
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
            logger.error(f"Failed to get stats for file {file}: {e}")
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
            if created_files is not None:
                created_files.discard(info['filename'])
            logger.info(f"File {info['path']} is too old ({age:.2f} seconds), marked for deletion")

    while total_size > max_cache_size and file_info:
        info = file_info.pop(0)
        if info not in files_to_remove:
            files_to_remove.append(info)
            total_size -= info['size']
            if created_files is not None:
                created_files.discard(info['filename'])
            logger.info(f"Total cache size exceeded, removing {info['path']}")

    while len(file_info) > max_cache_files and file_info:
        info = file_info.pop(0)
        if info not in files_to_remove:
            files_to_remove.append(info)
            total_size -= info['size']
            if created_files is not None:
                created_files.discard(info['filename'])
            logger.info(f"File count exceeded, removing {info['path']}")

    for info in files_to_remove:
        try:
            os.remove(info['path'])
            logger.info(f"Deleted cache file: {info['path']}")
        except Exception as e:
            logger.error(f"Failed to delete cache file {info['path']}: {e}")


def resolve_node_dir(node_id):
    """Resolve node dir ensuring existence."""
    base_dir = get_base_output_dir()
    if node_id and node_id not in ("undefined", "null", ""):
        base_dir = os.path.join(base_dir, f"node_{node_id}")
    os.makedirs(base_dir, exist_ok=True)
    return base_dir
