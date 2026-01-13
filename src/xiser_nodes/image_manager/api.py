import os
import json
import time
import uuid
import base64
import numpy as np
import re
import folder_paths
from io import BytesIO
from PIL import Image
from aiohttp import web
from .constants import logger
from .storage import resolve_node_dir, compute_content_hash
# V1 node import - handle gracefully if not available
XIS_ImageManagerV1 = None
try:
    from .node import XIS_ImageManager as XIS_ImageManagerV1
except ImportError:
    # V1 node not available, use V3 only
    pass
from .editor.core import ImageEditor

# Try to import V3 node class
try:
    from ..image_manager_v3 import XIS_ImageManagerV3
    HAS_V3_NODE = True
except ImportError:
    HAS_V3_NODE = False
    XIS_ImageManagerV3 = None

# Helper functions for compatibility
def _get_list_node_image_files():
    """Get the list_node_image_files function."""
    # Always import from storage module directly
    from .storage import list_node_image_files
    return list_node_image_files

def _get_generate_base64_thumbnail():
    """Get the thumbnail generator."""
    # Use V3 node's method if available, otherwise fallback
    if HAS_V3_NODE:
        return XIS_ImageManagerV3._generate_base64_thumbnail
    else:
        # Fallback to V1 or create a simple implementation
        if XIS_ImageManagerV1 is not None:
            try:
                return XIS_ImageManagerV1._generate_base64_thumbnail
            except AttributeError:
                pass
        # Create a simple fallback implementation
        def simple_thumbnail(pil_img, max_size=64, format="PNG"):
            import base64
            from io import BytesIO
            try:
                img_width, img_height = pil_img.size
                scale = min(max_size / img_width, max_size / img_height, 1.0)
                new_size = (int(img_width * scale), int(img_height * scale))
                thumbnail = pil_img.resize(new_size, Image.Resampling.LANCZOS)
                buffered = BytesIO()
                thumbnail.save(buffered, format="PNG")
                return base64.b64encode(buffered.getvalue()).decode("utf-8")
            except Exception as e:
                logger.error(f"Failed to generate thumbnail: {e}")
                return ""
        return simple_thumbnail


def _find_node_instance(node_id: str):
    try:
        from server import PromptServer
        # Try different attribute names for node instances
        instance = PromptServer.instance
        nodes = None

        # Try common attribute names
        if hasattr(instance, 'nodes'):
            nodes = instance.nodes
        elif hasattr(instance, 'node_instances'):
            nodes = instance.node_instances
        elif hasattr(instance, '_nodes'):
            nodes = instance._nodes

        if nodes:
            for node in nodes.values():
                if getattr(node, "id", None) == node_id:
                    return node
    except Exception as exc:
        logger.error(f"Instance - Failed to find node {node_id}: {exc}")
    return None


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

        # Find the node instance to track created files
        node_instance = _find_node_instance(node_id)
        if node_instance:
            logger.debug(f"Instance - Found node instance for {node_id}, created_files count: {len(node_instance.created_files)}")
        else:
            logger.warning(f"Instance - No node instance found for {node_id}, uploaded files won't be tracked in created_files")

        list_node_image_files_func = _get_list_node_image_files()
        existing_files = list_node_image_files_func(node_dir)
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

                # Add to created_files if node instance exists
                if node_instance:
                    node_instance.created_files.add(img_filename)
                    logger.debug(f"Instance - Added {img_filename} to created_files for node {node_id}")

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

                generate_thumbnail = _get_generate_base64_thumbnail()
                preview_b64 = generate_thumbnail(pil_img)
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
        node_dir = resolve_node_dir(node_id)
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
    """Persist a cropped image and return updated preview metadata using the new ImageEditor module."""
    try:
        data = await request.json()
        node_id = str(data.get("node_id") or "")
        filename = data.get("storage_filename") or data.get("filename")
        image_payload = data.get("image")
        original_filename = data.get("originalFilename") or filename
        incoming_source_hash = data.get("source_hash") or data.get("sourceHash")

        if not filename or not (filename.startswith("upload_image_") or filename.startswith("xis_image_manager_")):
            return web.json_response({"error": "Invalid filename for crop"}, status=400)
        if not image_payload:
            return web.json_response({"error": "Missing image payload"}, status=400)

        node_dir = resolve_node_dir(node_id)
        try:
            if "base64," in image_payload:
                image_payload = image_payload.split("base64,", 1)[1]
            img_bytes = base64.b64decode(image_payload)
        except Exception:
            return web.json_response({"error": "Invalid image data"}, status=400)

        # Use the new ImageEditor module for image processing
        editor = ImageEditor()
        pil_img = Image.open(BytesIO(img_bytes)).convert("RGBA")

        # Apply any additional processing using the editor if needed
        # For now, we just use the basic image, but the editor provides
        # more sophisticated operations for future expansion

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

        content_hash = compute_content_hash(np.array(pil_img, dtype=np.uint8), f"crop:{filename}")
        if node_instance:
            thumbnail_generator = node_instance._generate_base64_thumbnail
        else:
            thumbnail_generator = _get_generate_base64_thumbnail()
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


async def handle_set_ui_data(request):
    """Handle setting UI data for XIS_ImageManager node."""
    try:
        data = await request.json()
        node_id = data.get('node_id')
        ui_data = data.get('data')
        if not node_id or not ui_data:
            logger.error(f"Instance - Invalid set_ui_data request: node_id={node_id}, data={ui_data}")
            return web.json_response({"error": "Invalid node_id or data"}, status=400)

        node_instance = _find_node_instance(node_id)
        if not node_instance:
            logger.error(f"Instance - Node {node_id} not found")
            return web.json_response({"error": f"Node {node_id} not found"}, status=404)

        node_instance.set_ui_data(node_id, ui_data)
        logger.info(f"Instance - Set UI data for node {node_id}: {ui_data}")
        return web.json_response({"success": True})
    except Exception as e:
        logger.error(f"Instance - Failed to handle set_ui_data request: {e}")
        return web.json_response({"error": f"Failed to set UI data: {e}"}, status=500)


def register_routes():
    try:
        from server import PromptServer
        PromptServer.instance.app.add_routes([
            web.post('/upload/xis_image_manager', handle_upload),
            web.post('/fetch_image/xis_image_manager', handle_fetch_image),
            web.post('/crop/xis_image_manager', handle_crop_image),
            web.post('/delete/xis_image_manager', handle_delete),
            web.post('/set_ui_data/xis_image_manager', handle_set_ui_data),
        ])
        logger.info("Registered XIS_ImageManager endpoints")
    except Exception as e:
        logger.error(f"Failed to register endpoints: {e}")
