import os
import json
import re
import numpy as np
import torch
from collections import defaultdict
from PIL import Image
from .constants import logger
from .storage import (
    tensor_to_uint8_array,
    compute_content_hash,
    compose_unique_id,
    save_image_with_tracking,
)


def process_pack_images(node, pack_images, node_id, prev_pack_id_map, prev_index_id_map, node_dir):
    """Load pack_images into tensors/previews while respecting cached edits."""
    images_list = []
    image_paths = []
    image_previews = []
    new_pack_id_map = defaultdict(list)
    pack_hash_usage = defaultdict(int)

    if not pack_images:
        return images_list, image_paths, image_previews, new_pack_id_map
    if not isinstance(pack_images, list):
        logger.error(f"Instance {node.instance_id} - Node {node_id}: Invalid pack_images: expected list, got {type(pack_images)}")
        raise ValueError("pack_images must be a list of torch.Tensor")

    for i, img in enumerate(pack_images):
        filename = f"input_image_{i + 1:02d}.png"
        if not isinstance(img, torch.Tensor) or img.shape[-1] != 4:
            logger.error(f"Instance {node.instance_id} - Node {node_id}: Invalid image format at index {i}: expected RGBA torch.Tensor, got {getattr(img, 'shape', None)}")
            raise ValueError("All images must be RGBA torch.Tensor")
        array_uint8 = tensor_to_uint8_array(img)
        if array_uint8 is None:
            logger.error(f"Instance {node.instance_id} - Node {node_id}: Failed to convert image at index {i} to uint8 array")
            raise ValueError("Failed to convert image to uint8")
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
            save_image_with_tracking(pil_img, node_dir, storage_filename, node_id, filename, edited=False, source_hash=incoming_hash, created_files=node.created_files)
            content_hash = incoming_hash
        else:
            content_hash = stored_hash or compute_content_hash(array_uint8, f"pack_image_{i}")
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
            image_id = compose_unique_id(content_hash, occurrence)
        new_pack_id_map[content_hash].append({"id": image_id, "index": i})
        images_list.append(img_tensor)
        image_paths.append(storage_filename)
        preview_b64 = node._generate_base64_thumbnail(pil_img)
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
            logger.debug(f"Instance {node.instance_id} - Node {node_id}: Loaded uploaded image {filename}")
        except Exception as e:
            logger.error(f"Instance {node.instance_id} - Node {node_id}: Failed to load uploaded image {file}: {e}")
            continue

    return images_list, image_paths, image_previews
