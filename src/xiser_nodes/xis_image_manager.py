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

# Log level control
LOG_LEVEL = "warning"  # Set to warning to reduce logging noise

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
                "is_single_mode": ("STRING", {"default": "{}"})
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

    def manage_images(self, pack_images=None, image_order="{}", enabled_layers="{}", node_id="", node_size="[360, 360]", is_reversed="{}", is_single_mode="{}", **kwargs):
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

        images_list = []
        image_paths = []
        image_previews = []

        # Process pack_images
        if pack_images:
            if not isinstance(pack_images, list):
                logger.error(f"Instance {self.instance_id} - Node {node_id}: Invalid pack_images: expected list, got {type(pack_images)}")
                raise ValueError("pack_images must be a list of torch.Tensor")
            for i, img in enumerate(pack_images):
                filename = f"input_image_{i}.png"
                if not isinstance(img, torch.Tensor) or img.shape[-1] != 4:
                    logger.error(f"Instance {self.instance_id} - Node {node_id}: Invalid image format at index {i}: expected RGBA torch.Tensor, got {img.shape}")
                    raise ValueError("All images must be RGBA torch.Tensor")
                images_list.append(img)
                image_paths.append(filename)
                img_array = (img.cpu().numpy() * 255).clip(0, 255).astype(np.uint8)
                pil_img = Image.fromarray(img_array, mode="RGBA")
                preview_b64 = self._generate_base64_thumbnail(pil_img)
                image_previews.append({
                    "index": i,
                    "preview": preview_b64,
                    "width": img.shape[1],
                    "height": img.shape[0],
                    "filename": filename,
                    "originalFilename": filename
                })

        # Load uploaded images - only load images that belong to this specific node instance
        node_dir = self._get_node_output_dir(node_id)
        existing_filenames = {p["filename"] for p in image_previews}
        
        # Load uploaded images for this node, sorted by upload time to preserve order
        uploaded_files = glob.glob(os.path.join(node_dir, "xis_image_manager_*.png"))
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
                # Add to created_files for backward compatibility
                if filename not in self.created_files:
                    self.created_files.add(filename)
                logger.debug(f"Instance {self.instance_id} - Node {node_id}: Loaded uploaded image {filename}")
            except Exception as e:
                logger.error(f"Instance {self.instance_id} - Node {node_id}: Failed to load uploaded image {file}: {e}")
                continue

        self.image_previews = image_previews
        self.image_paths = image_paths

        # Parse image_order
        try:
            order_data = json.loads(image_order) if image_order and image_order != "{}" else {}
            order = order_data.get("order", list(range(len(images_list)))) if isinstance(order_data, dict) else order_data
            order = self._validate_image_order(order, len(images_list))
        except Exception as e:
            logger.error(f"Instance {self.instance_id} - Node {node_id}: Failed to parse image_order: {e}, using default order")
            order = list(range(len(images_list)))

        # Parse enabled_layers and ensure length matches images_list
        try:
            enabled_data = json.loads(enabled_layers) if enabled_layers and enabled_layers != "{}" else {}
            enabled = enabled_data.get("enabled", [True] * len(images_list)) if isinstance(enabled_data, dict) else enabled_data
            if not isinstance(enabled, list) or len(enabled) != len(images_list):
                logger.warning(f"Instance {self.instance_id} - Node {node_id}: Invalid enabled_layers length: {len(enabled)}, expected {len(images_list)}, using default [True] * {len(images_list)}")
                enabled = [True] * len(images_list)
        except Exception as e:
            logger.error(f"Instance {self.instance_id} - Node {node_id}: Failed to parse enabled_layers: {e}, using default [True] * {len(images_list)}")
            enabled = [True] * len(images_list)

        # Enforce single mode
        if is_single_mode_flag and len(images_list):
            true_count = sum(1 for x in enabled if x)
            if true_count != 1:
                logger.warning(f"Instance {self.instance_id} - Node {node_id}: Single mode enabled but {true_count} images selected, enforcing single selection")
                true_index = enabled.index(True) if True in enabled else 0
                enabled = [False] * len(images_list)
                enabled[true_index] = True

        # Generate output
        try:
            reordered_images = [images_list[i] for i in order if enabled[i]]
        except IndexError as e:
            logger.error(f"Instance {self.instance_id} - Node {node_id}: Index error in reordering: {e}, order: {order}, enabled: {enabled}")
            order = list(range(len(images_list)))
            enabled = [True] * len(images_list)
            if is_single_mode_flag:
                enabled = [False] * len(images_list)
                enabled[0] = True
            reordered_images = [images_list[i] for i in order if enabled[i]]

        ui_data = {
            "image_previews": self.image_previews,
            "image_order": [order],  # Ensure iterable
            "enabled_layers": [enabled],  # Ensure iterable
            "node_size": [node_size_list],  # Already a list
            "is_reversed": [is_reversed_flag],  # Ensure iterable
            "is_single_mode": [is_single_mode_flag],  # Ensure iterable
            "full_image_order": order  # For frontend state restoration
        }
        logger.info(f"Instance {self.instance_id} - Node {node_id}: Returning {len(reordered_images)} images, order: {order}, enabled: {enabled}, single_mode: {is_single_mode_flag}, node_size: {node_size_list}")
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
                    "originalFilename": p.get("originalFilename", p["filename"])
                } for p in self.image_previews
            ],
            "image_order": [list(range(len(self.image_previews)))],  # Ensure iterable
            "enabled_layers": [[True] * len(self.image_previews)],  # Ensure iterable
            "node_size": [[360, 360]],  # Ensure iterable
            "is_reversed": [False],  # Ensure iterable
            "is_single_mode": [False]  # Ensure iterable
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
                    "originalFilename": p.get("originalFilename", p["filename"])
                } for p in data.get("image_previews", []) if p.get("filename")
            ]
            self.image_paths = [p["filename"] for p in self.image_previews]
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
                
                # Create a tracking file to mark this image as belonging to the node
                # Store both node_id and the original filename to help with ordering
                try:
                    tracking_file = os.path.join(node_dir, f".{img_filename}.node_{node_id}")
                    with open(tracking_file, 'w') as f:
                        f.write(json.dumps({
                            "node_id": node_id,
                            "original_filename": filename,
                            "upload_time": time.time()
                        }))
                    logger.debug(f"Instance - Created tracking file for {img_filename} to node {node_id}")
                except Exception as e:
                    logger.warning(f"Instance - Could not create tracking file for {img_filename}: {e}")
                
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
