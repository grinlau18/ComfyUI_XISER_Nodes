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

    # 按修改时间排序（旧文件在前）
    file_info.sort(key=lambda x: x['mtime'])

    files_to_remove = []
    max_file_age = 24 * 60 * 60  # 24 hours
    max_cache_size = 1024 * 1024 * 1024  # 1GB
    max_cache_files = 50

    # 先按年龄清理
    remaining_files = []
    for info in file_info:
        age = current_time - info['mtime']
        if age > max_file_age:
            files_to_remove.append(info)
            total_size -= info['size']
            if created_files is not None:
                created_files.discard(info['filename'])
            logger.info(f"File {info['path']} is too old ({age:.2f} seconds), marked for deletion")
        else:
            remaining_files.append(info)

    # 再按文件数量清理
    if len(remaining_files) > max_cache_files:
        # 需要删除的文件数量
        to_remove_count = len(remaining_files) - max_cache_files
        for i in range(to_remove_count):
            info = remaining_files[i]
            files_to_remove.append(info)
            total_size -= info['size']
            if created_files is not None:
                created_files.discard(info['filename'])
            logger.info(f"File count exceeded, removing {info['path']}")
        remaining_files = remaining_files[to_remove_count:]

    # 最后按总大小清理
    current_total_size = sum(info['size'] for info in remaining_files)
    if current_total_size > max_cache_size:
        # 计算需要删除的大小
        size_to_remove = current_total_size - max_cache_size
        removed_size = 0

        for info in remaining_files:
            if removed_size >= size_to_remove:
                break
            files_to_remove.append(info)
            removed_size += info['size']
            total_size -= info['size']
            if created_files is not None:
                created_files.discard(info['filename'])
            logger.info(f"Total cache size exceeded, removing {info['path']} to free {removed_size} bytes")

    for info in files_to_remove:
        try:
            os.remove(info['path'])
            logger.info(f"Deleted cache file: {info['path']}")
        except Exception as e:
            logger.error(f"Failed to delete cache file {info['path']}: {e}")

    # 新增：检查并清理其他节点的旧目录
    try:
        cleanup_old_node_dirs()
    except Exception as e:
        logger.error(f"Failed to cleanup old node directories: {e}")


def cleanup_old_node_dirs(max_dir_age=7 * 24 * 60 * 60):
    """清理旧的节点目录（超过指定时间的目录）"""
    import shutil
    import time

    base_dir = get_base_output_dir()
    current_time = time.time()

    if not os.path.exists(base_dir):
        return

    for item in os.listdir(base_dir):
        if item.startswith("node_") and os.path.isdir(os.path.join(base_dir, item)):
            dir_path = os.path.join(base_dir, item)
            try:
                dir_mtime = os.path.getmtime(dir_path)
                if current_time - dir_mtime > max_dir_age:
                    # 检查目录是否为空
                    is_empty = True
                    for root, dirs, files in os.walk(dir_path):
                        if files:
                            is_empty = False
                            break

                    if is_empty:
                        shutil.rmtree(dir_path, ignore_errors=True)
                        logger.info(f"Removed empty old node directory: {dir_path}")
                    else:
                        # 非空目录，记录但不删除
                        logger.debug(f"Old node directory not empty, skipping: {dir_path}")
            except Exception as e:
                logger.error(f"Failed to process node directory {dir_path}: {e}")


def resolve_node_dir(node_id):
    """Resolve node dir ensuring existence."""
    base_dir = get_base_output_dir()
    if node_id and node_id not in ("undefined", "null", ""):
        base_dir = os.path.join(base_dir, f"node_{node_id}")
    os.makedirs(base_dir, exist_ok=True)
    return base_dir


def cleanup_all_xiser_cache():
    """清理所有XISER相关的缓存目录和文件"""
    import time
    import glob
    import shutil

    base_output_dir = get_base_output_dir()
    xiser_patterns = [
        "xiser_canvas",
        "xiser_image_manager",
        "xiser_images",
        "xiser_gradient",
        "xiser_painter",
        "xiser_paint",
        "xiser_reorder_images*",
        "xiser_cutouts"
    ]

    current_time = time.time()
    max_file_age = 24 * 60 * 60  # 24小时
    total_removed = 0
    total_freed = 0

    logger.info(f"Starting global XISER cache cleanup in {base_output_dir}")

    # 第一步：清理根目录下的XISER相关文件
    try:
        for filename in os.listdir(base_output_dir):
            if filename.startswith("xiser_") and filename.endswith(".png"):
                file_path = os.path.join(base_output_dir, filename)
                if os.path.isfile(file_path):
                    try:
                        stats = os.stat(file_path)
                        age = current_time - stats.st_mtime

                        if age > max_file_age:
                            file_size = stats.st_size
                            os.remove(file_path)
                            total_removed += 1
                            total_freed += file_size
                            logger.info(f"Removed old root file: {file_path} (age: {age:.0f}s)")
                    except Exception as e:
                        logger.warning(f"Failed to process root file {file_path}: {e}")
    except Exception as e:
        logger.error(f"Failed to cleanup root files: {e}")

    # 第二步：清理XISER相关目录
    for pattern in xiser_patterns:
        # 查找匹配的目录
        dir_pattern = os.path.join(base_output_dir, pattern)
        matching_dirs = glob.glob(dir_pattern)

        for dir_path in matching_dirs:
            if not os.path.isdir(dir_path):
                continue

            try:
                # 获取目录中的所有文件
                all_files = []
                for root, dirs, files in os.walk(dir_path):
                    for file in files:
                        if file.endswith('.png'):
                            file_path = os.path.join(root, file)
                            try:
                                stats = os.stat(file_path)
                                age = current_time - stats.st_mtime

                                if age > max_file_age:
                                    file_size = stats.st_size
                                    os.remove(file_path)
                                    total_removed += 1
                                    total_freed += file_size
                                    logger.debug(f"Removed old file: {file_path} (age: {age:.0f}s)")
                            except Exception as e:
                                logger.warning(f"Failed to process file {file_path}: {e}")

                # 检查目录是否为空，如果是则删除空目录
                try:
                    if not os.listdir(dir_path):
                        shutil.rmtree(dir_path, ignore_errors=True)
                        logger.info(f"Removed empty directory: {dir_path}")
                except Exception as e:
                    logger.warning(f"Failed to remove directory {dir_path}: {e}")

            except Exception as e:
                logger.error(f"Failed to cleanup directory {dir_path}: {e}")

    logger.info(f"Global XISER cache cleanup completed: {total_removed} files removed, {total_freed / (1024*1024):.2f} MB freed")
    return total_removed, total_freed


def cleanup_old_cache_files():
    """清理旧的缓存文件（向后兼容的包装函数）"""
    return cleanup_all_xiser_cache()
