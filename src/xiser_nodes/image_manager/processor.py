import os
import json
import re
import time
import numpy as np
import torch
from collections import defaultdict
from PIL import Image
from concurrent.futures import ThreadPoolExecutor, as_completed
from .constants import logger
from .storage import (
    tensor_to_uint8_array,
    compute_content_hash,
    compose_unique_id,
    save_image_with_tracking,
)


def timeit(func):
    """简单的性能计时装饰器"""
    def wrapper(*args, **kwargs):
        start_time = time.perf_counter()
        result = func(*args, **kwargs)
        elapsed = time.perf_counter() - start_time
        func_name = func.__name__
        logger.debug(f"{func_name} executed in {elapsed:.3f} seconds")
        return result
    return wrapper


def _process_single_image(args):
    """处理单个图像的辅助函数，用于并行处理"""
    i, img, node, node_id, node_dir, prev_pack_id_map, prev_index_id_map, pack_hash_usage, total_images = args

    filename = f"input_image_{i + 1:02d}.png"
    if not isinstance(img, torch.Tensor) or img.shape[-1] != 4:
        raise ValueError(f"Invalid image format at index {i}: expected RGBA torch.Tensor, got {getattr(img, 'shape', None)}")

    array_uint8 = tensor_to_uint8_array(img)
    if array_uint8 is None:
        raise ValueError(f"Failed to convert image at index {i} to uint8 array")

    original_uint8 = np.array(array_uint8, copy=True)
    incoming_hash = compute_content_hash(array_uint8, f"pack_image_{i}")
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
            logger.warning(f"Instance {node.instance_id} - Node {node_id}: Failed to read tracking for {storage_filename}: {exc}")

    pil_img = None
    stored_hash = None
    if use_storage_image and os.path.exists(storage_path):
        try:
            pil_img = Image.open(storage_path).convert("RGBA")
            array_uint8 = np.array(pil_img, dtype=np.uint8)
            stored_hash = compute_content_hash(array_uint8, f"stored_pack_image_{i}")
            # If we lack a tracked source hash, fall back to comparing stored hash with incoming
            mismatch_detected = False
            if tracked_source_hash:
                mismatch_detected = tracked_source_hash != incoming_hash
            elif stored_hash and stored_hash != incoming_hash:
                mismatch_detected = True
            if mismatch_detected:
                logger.info(f"Instance {node.instance_id} - Node {node_id}: Pack image {i} changed upstream, ignoring cached edit")
                pil_img = None
                use_storage_image = False
                array_uint8 = np.array(original_uint8, copy=True)
                stored_hash = None
            else:
                node.created_files.add(storage_filename)
                logger.debug(f"Instance {node.instance_id} - Node {node_id}: Using edited image {storage_filename} for pack index {i}")
        except Exception as exc:
            logger.warning(f"Instance {node.instance_id} - Node {node_id}: Failed to use edited image {storage_filename}: {exc}")

    if pil_img is None:
        pil_img = Image.fromarray(array_uint8, mode="RGBA")
        # 使用批量模式，减少缓存失效次数
        batch_mode = total_images > 1  # 多张图像时使用批量模式
        save_image_with_tracking(pil_img, node_dir, storage_filename, node_id, filename,
                                edited=False, source_hash=incoming_hash,
                                created_files=node.created_files,
                                skip_if_exists=True, batch_mode=batch_mode)
        content_hash = incoming_hash
    else:
        content_hash = stored_hash or compute_content_hash(array_uint8, f"pack_image_{i}")

    img_tensor = torch.from_numpy(array_uint8.astype(np.float32) / 255.0)

    # 处理图像ID分配
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
        image_id = compose_unique_id(content_hash, occurrence)

    preview_b64 = node._generate_base64_thumbnail(pil_img)

    return {
        "index": i,
        "image_tensor": img_tensor,
        "storage_filename": storage_filename,
        "preview_data": {
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
        },
        "content_hash": content_hash,
        "image_id": image_id
    }


@timeit
def process_pack_images(node, pack_images, node_id, prev_pack_id_map, prev_index_id_map, node_dir):
    """Load pack_images into tensors/previews while respecting cached edits."""
    images_list = []
    image_paths = []
    image_previews = []
    new_pack_id_map = defaultdict(list)
    pack_hash_usage = defaultdict(int)

    if pack_images is None:
        return images_list, image_paths, image_previews, new_pack_id_map
    if not isinstance(pack_images, list):
        logger.error(f"Instance {node.instance_id} - Node {node_id}: Invalid pack_images: expected list, got {type(pack_images)}")
        raise ValueError("pack_images must be a list of torch.Tensor")

    # 根据图像数量决定是否使用并行处理
    num_images = len(pack_images)
    use_parallel = num_images > 5  # 超过5张图像时使用并行处理

    if use_parallel:
        # 并行处理图像
        max_workers = min(4, num_images)  # 最多4个线程
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            # 准备任务参数
            tasks = []
            for i, img in enumerate(pack_images):
                task_args = (i, img, node, node_id, node_dir,
                           prev_pack_id_map.copy(), prev_index_id_map.copy(), pack_hash_usage, num_images)
                tasks.append(executor.submit(_process_single_image, task_args))

            # 收集结果
            results = []
            for future in as_completed(tasks):
                try:
                    result = future.result()
                    results.append(result)
                except Exception as e:
                    logger.error(f"Failed to process image: {e}")
                    raise

            # 按索引排序结果
            results.sort(key=lambda x: x["index"])

            # 整理结果
            for result in results:
                images_list.append(result["image_tensor"])
                image_paths.append(result["storage_filename"])
                image_previews.append(result["preview_data"])
                new_pack_id_map[result["content_hash"]].append({
                    "id": result["image_id"],
                    "index": result["index"]
                })
    else:
        # 顺序处理（小批量）
        for i, img in enumerate(pack_images):
            task_args = (i, img, node, node_id, node_dir,
                       prev_pack_id_map, prev_index_id_map, pack_hash_usage, num_images)
            try:
                result = _process_single_image(task_args)
                images_list.append(result["image_tensor"])
                image_paths.append(result["storage_filename"])
                image_previews.append(result["preview_data"])
                new_pack_id_map[result["content_hash"]].append({
                    "id": result["image_id"],
                    "index": result["index"]
                })
            except Exception as e:
                logger.error(f"Failed to process image at index {i}: {e}")
                raise

    logger.debug(f"Processed {len(images_list)} pack images using {'parallel' if use_parallel else 'sequential'} processing")
    return images_list, image_paths, image_previews, new_pack_id_map


def process_uploaded_images(node, image_previews, images_list, node_id, node_dir):
    """Load previously uploaded images belonging to this node."""
    existing_filenames = {
        p.get("storage_filename") or p.get("storageFilename") or p.get("filename")
        for p in image_previews
        if p.get("filename")
    }
    uploaded_hash_usage = defaultdict(int)
    image_paths = []

    uploaded_files = node._list_node_image_files(node_dir)
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
                logger.warning(f"Instance {node.instance_id} - Node {node_id}: Failed to read tracking file for {filename}: {e}")
                files_with_upload_time.append((file, os.path.getmtime(file)))
        else:
            files_with_upload_time.append((file, os.path.getmtime(file)))

    files_with_upload_time.sort(key=lambda x: x[1])
    uploaded_files = [file for file, _ in files_with_upload_time]

    for file in uploaded_files:
        filename = os.path.basename(file)
        if filename in existing_filenames:
            continue
        tracking_file = os.path.join(node_dir, f".{filename}.node_{node_id}")
        if not os.path.exists(tracking_file):
            continue
        try:
            pil_img = Image.open(file).convert("RGBA")
            array_uint8 = np.array(pil_img, dtype=np.uint8)
            base_hash = compute_content_hash(array_uint8, f"uploaded:{filename}")
            occurrence = uploaded_hash_usage[base_hash]
            uploaded_hash_usage[base_hash] += 1
            image_id = compose_unique_id(base_hash, occurrence)
            img_array = array_uint8.astype(np.float32) / 255.0
            img_tensor = torch.from_numpy(img_array)
            images_list.append(img_tensor)
            image_paths.append(filename)
            preview_b64 = node._generate_base64_thumbnail(pil_img)
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
            if filename not in node.created_files:
                node.created_files.add(filename)
                logger.debug(f"Instance {node.instance_id} - Node {node_id}: Added uploaded image {filename} to created_files")
            logger.debug(f"Instance {node.instance_id} - Node {node_id}: Loaded uploaded image {filename}")
        except Exception as e:
            logger.error(f"Instance {node.instance_id} - Node {node_id}: Failed to load uploaded image {file}: {e}")
            continue

    return images_list, image_paths, image_previews
