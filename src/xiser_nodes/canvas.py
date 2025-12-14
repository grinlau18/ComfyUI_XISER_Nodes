"""
canvas.py (restored baseline + v3 wrapper)

Canvas rendering for XISER: keeps legacy stable logic, adds inline cutout decoding,
and wraps with v3 ComfyNode without altering core behaviour.
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

from comfy_api.latest import io, ComfyExtension

logger = logging.getLogger("XISER_Canvas")
logger.setLevel(logging.INFO)


def _unwrap_v3_data(data):
    """Unwrap io.NodeOutput-like objects."""
    if hasattr(data, "outputs") and isinstance(getattr(data, "outputs"), tuple):
        outs = data.outputs
        if len(outs) == 1:
            return outs[0]
        return list(outs)
    return data


class XISER_Canvas:
    """Legacy-stable canvas implementation."""

    def __init__(self, instance_id=None):
        self.properties = {}
        # Use provided instance_id or generate stable one based on node parameters
        if instance_id:
            self.instance_id = instance_id
        else:
            # Generate stable instance_id for backward compatibility
            self.instance_id = uuid.uuid4().hex
        self.output_dir = os.path.join(folder_paths.get_output_directory(), "xiser_canvas")
        os.makedirs(self.output_dir, exist_ok=True)
        self.max_cache_files = 50
        self.max_cache_size = 1024 * 1024 * 1024
        self.max_file_age = 24 * 60 * 60
        self.created_files = set()
        logger.info(f"Instance {self.instance_id} - Output directory initialized: {self.output_dir}")

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "pack_images": ("IMAGE", {"default": None}),
                "board_width": ("INT", {"default": 1024, "min": 256, "max": 8192, "step": 16}),
                "board_height": ("INT", {"default": 1024, "min": 256, "max": 8192, "step": 16}),
                "border_width": ("INT", {"default": 120, "min": 10, "max": 200, "step": 1}),
                "canvas_color": (["black", "white", "transparent"], {"default": "black"}),
                "display_scale": ("FLOAT", {"default": 0.5, "min": 0.1, "max": 1.0, "step": 0.01}),
                "auto_size": (["off", "on"], {"default": "off"}),
                "image_states": ("STRING", {"default": "[]", "multiline": False}),
            },
            "optional": {
                "file_data": ("FILE_DATA", {"default": None}),
                "canvas_config": ("CANVAS_CONFIG", {}),
                "layer_data": ("LAYER_DATA", {"default": None}),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", "IMAGE", "LAYER_DATA")
    RETURN_NAMES = ("canvas_image", "masks", "layer_images", "layer_data")
    FUNCTION = "render"
    CATEGORY = "XISER_Nodes/Visual_Editing"
    OUTPUT_NODE = True

    @staticmethod
    def _normalize_state(state, border_width, board_width, board_height):
        default_state = {
            "x": border_width + board_width / 2,
            "y": border_width + board_height / 2,
            "scaleX": 1.0,
            "scaleY": 1.0,
            "rotation": 0.0,
            "skewX": 0.0,
            "skewY": 0.0,
            "brightness": 0.0,
            "contrast": 0.0,
            "saturation": 0.0,
            "visible": True,
            "order": None,
            "filename": None,
        }
        if not isinstance(state, dict):
            return default_state
        normalized = default_state.copy()
        normalized["x"] = float(state.get("x", normalized["x"]))
        normalized["y"] = float(state.get("y", normalized["y"]))
        normalized["scaleX"] = float(state.get("scaleX", normalized["scaleX"]))
        normalized["scaleY"] = float(state.get("scaleY", normalized["scaleY"]))
        normalized["rotation"] = float(state.get("rotation", normalized["rotation"]))
        normalized["skewX"] = float(state.get("skewX", normalized["skewX"]))
        normalized["skewY"] = float(state.get("skewY", normalized["skewY"]))
        brightness = float(state.get("brightness", normalized["brightness"]))
        contrast = float(state.get("contrast", normalized["contrast"]))
        saturation = float(state.get("saturation", normalized["saturation"]))
        normalized["brightness"] = max(-1.0, min(1.0, brightness))
        normalized["contrast"] = max(-100.0, min(100.0, contrast))
        normalized["saturation"] = max(-100.0, min(100.0, saturation))
        normalized["visible"] = bool(state.get("visible", True))
        if isinstance(state.get("filename"), str):
            normalized["filename"] = state.get("filename")
        try:
            normalized["order"] = int(state.get("order")) if state.get("order") is not None else None
        except (TypeError, ValueError):
            normalized["order"] = None
        return normalized

    @staticmethod
    def _apply_brightness_contrast(image, brightness=0.0, contrast=0.0, saturation=0.0):
        """Apply brightness, contrast, and saturation adjustments."""
        img = image.convert("RGBA")
        if abs(brightness) > 1e-3:
            factor = 1 + brightness
            img = Image.fromarray(np.clip(np.array(img, dtype=np.float32) * factor, 0, 255).astype(np.uint8))
        if abs(contrast) > 1e-3:
            mean = np.array(img).mean(axis=(0, 1), keepdims=True)
            img = Image.fromarray(
                np.clip((np.array(img, dtype=np.float32) - mean) * (1 + contrast / 100.0) + mean, 0, 255).astype(
                    np.uint8
                )
            )
        if abs(saturation) > 1e-3:
            rgb = np.array(img, dtype=np.float32)
            gray = np.dot(rgb[..., :3], [0.299, 0.587, 0.114])[..., None]
            rgb[..., :3] = np.clip(gray + (rgb[..., :3] - gray) * (1 + saturation / 100.0), 0, 255)
            img = Image.fromarray(rgb.astype(np.uint8))
        return img

    def _apply_coordinate_based_transform(self, pil_img, scale_x=1.0, scale_y=1.0, rotation=0.0, skew_x=0.0, skew_y=0.0):
        """
        Match frontend (Konva/HTML canvas): scale about center, then rotate about center.
        PIL.rotate uses counter-clockwise; HTML canvas/Konva use clockwise, so we negate.
        We let PIL handle expanding bounds to avoid cropping. Skew is currently ignored.
        """
        # 1) anisotropic scale about center
        w, h = pil_img.size
        if scale_x != 1.0 or scale_y != 1.0:
            new_w = max(1, int(round(w * scale_x)))
            new_h = max(1, int(round(h * scale_y)))
            pil_img = pil_img.resize((new_w, new_h), resample=Image.BICUBIC)

        # 2) rotate about center with expansion (clockwise for positive angles)
        if rotation != 0.0:
            pil_img = pil_img.rotate(-rotation, resample=Image.BICUBIC, expand=True, fillcolor=(0, 0, 0, 0))

        # skew currently unused in UI; ignore for now
        return pil_img

    def _decode_inline_image(self, holder, fname_fallback=None):
        """Decode inline image if present; return (filename, saved_path)"""
        if not isinstance(holder, dict):
            return None
        data_str = holder.get("image") or holder.get("image_base64") or holder.get("data")
        if not data_str or not isinstance(data_str, str):
            return None
        try:
            if data_str.startswith("data:"):
                _, encoded = data_str.split(",", 1)
            else:
                encoded = data_str
            img = Image.open(BytesIO(base64.b64decode(encoded))).convert("RGBA")

            # Save image first, then calculate hash from saved file to ensure consistency
            # Generate temporary filename
            temp_fname = f"xiser_canvas_{self.instance_id}_{uuid.uuid4().hex[:8]}.png"
            temp_path = os.path.join(self.output_dir, temp_fname)
            img.save(temp_path, format="PNG")

            # Calculate hash from saved file
            with open(temp_path, 'rb') as f:
                file_hash = hashlib.md5(f.read()).hexdigest()[:8]

            # Check if we should reuse existing filename
            fname = None
            existing_fname = holder.get("filename") or fname_fallback
            if existing_fname:
                existing_path = os.path.join(self.output_dir, existing_fname)
                if os.path.exists(existing_path):
                    try:
                        with open(existing_path, 'rb') as f:
                            existing_hash = hashlib.md5(f.read()).hexdigest()[:8]
                        if existing_hash == file_hash:
                            # Same content, reuse filename and delete temp file
                            fname = existing_fname
                            os.remove(temp_path)
                            logger.info(f"Reusing existing inline image file {existing_fname}")
                        else:
                            logger.info(f"Not reusing inline {existing_fname}: hash different ({existing_hash} != {file_hash})")
                    except Exception as e:
                        logger.warning(f"Failed to check existing inline file hash: {e}")
                else:
                    logger.info(f"Existing inline file not found: {existing_path}")

            # Generate new filename if needed
            if not fname:
                # Check if a file with this hash already exists
                potential_fname = f"xiser_canvas_{self.instance_id}_{file_hash}.png"
                potential_path = os.path.join(self.output_dir, potential_fname)

                if os.path.exists(potential_path):
                    # File exists, check if it's the same content
                    try:
                        with open(potential_path, 'rb') as f:
                            existing_hash = hashlib.md5(f.read()).hexdigest()[:8]
                        if existing_hash == file_hash:
                            # Same content, reuse and delete temp file
                            fname = potential_fname
                            os.remove(temp_path)
                        else:
                            # Hash collision, use temp filename
                            fname = temp_fname
                            # Rename temp file to final name
                            final_path = os.path.join(self.output_dir, fname)
                            if temp_path != final_path:
                                os.rename(temp_path, final_path)
                    except Exception as e:
                        logger.warning(f"Failed to check existing file: {e}")
                        fname = temp_fname
                else:
                    # New file, rename temp to final name
                    fname = potential_fname
                    final_path = os.path.join(self.output_dir, fname)
                    os.rename(temp_path, final_path)

                holder["filename"] = fname
            else:
                # We're reusing existing file, delete temp file
                if os.path.exists(temp_path):
                    os.remove(temp_path)

            self.created_files.add(fname)
            return fname
        except Exception as exc:
            logger.warning(f"Instance {self.instance_id} - Failed to decode inline image: {exc}")
            return None

    def render(
        self,
        pack_images,
        board_width: int,
        board_height: int,
        border_width: int,
        canvas_color: str,
        display_scale: float,
        auto_size: str,
        image_states: str,
        file_data=None,
        canvas_config=None,
        layer_data=None,
    ):
        pack_images = _unwrap_v3_data(pack_images)
        canvas_config = _unwrap_v3_data(canvas_config)
        layer_data = _unwrap_v3_data(layer_data)

        if pack_images is None:
            logger.error(f"Instance {self.instance_id} - images input cannot be None")
            raise ValueError("images input must be provided")

        try:
            display_scale = float(display_scale)
        except (TypeError, ValueError):
            raise ValueError("display_scale must be a float")

        if canvas_config:
            board_width = max(256, min(8192, int(canvas_config.get("board_width", board_width))))
            board_height = max(256, min(8192, int(canvas_config.get("board_height", board_height))))
            border_width = max(10, min(200, int(canvas_config.get("border_width", border_width))))
            if canvas_config.get("canvas_color") in ["black", "white", "transparent"]:
                canvas_color = canvas_config["canvas_color"]
            if canvas_config.get("auto_size") in ["off", "on"]:
                auto_size = canvas_config["auto_size"]
            if "display_scale" in canvas_config:
                try:
                    display_scale = max(0.1, min(1.0, float(canvas_config["display_scale"])))
                except Exception:
                    pass

        # Normalize pack_images to list[torch.Tensor HWC RGBA]
        def normalize_image_tensor(t):
            out = []
            if isinstance(t, torch.Tensor):
                if t.dim() == 4:
                    # NCHW or NHWC batch
                    if t.shape[1] in (3, 4) and t.shape[-1] not in (3, 4):
                        t = t.permute(0, 2, 3, 1)
                    for i in range(t.shape[0]):
                        out.extend(normalize_image_tensor(t[i]))
                    return out
                if t.dim() != 3:
                    return out
                img = t
                if not torch.is_floating_point(img):
                    img = img.float()
                if img.max() > 1.0:
                    img = img / 255.0
                img = img.clamp(0.0, 1.0)
                if img.shape[-1] not in (3, 4) and img.shape[0] in (3, 4):
                    img = img.permute(1, 2, 0)
                if img.shape[-1] == 3:
                    alpha = torch.ones_like(img[..., :1])
                    img = torch.cat([img, alpha], dim=-1)
                if img.shape[-1] == 4:
                    out.append(img)
                return out
            if isinstance(t, (list, tuple)):
                for item in t:
                    out.extend(normalize_image_tensor(item))
            return out

        images_list = normalize_image_tensor(pack_images)
        if not images_list:
            raise ValueError("At least one image must be provided")


        # parse image_states/layer_data
        image_paths = []
        image_base64_chunks = []

        if layer_data and isinstance(layer_data, dict) and layer_data.get("layers"):
            states_raw = []
            for layer in layer_data["layers"]:
                # decode inline cutout to file, update filename
                self._decode_inline_image(layer, layer.get("filename"))
                states_raw.append(layer)
            image_states = [
                self._normalize_state(st, border_width, board_width, board_height) for st in states_raw
            ]
            # align images_list length with states (if inline provided replaced)
            for idx, st in enumerate(states_raw):
                fname = st.get("filename")
                if fname and idx < len(images_list):
                    # Check if file exists and has same content as input
                    file_path = os.path.join(self.output_dir, fname)
                    if os.path.exists(file_path):
                        try:
                            # Load file content
                            img = Image.open(file_path).convert("RGBA")
                            file_arr = np.array(img).astype(np.float32) / 255.0
                            file_tensor = torch.from_numpy(file_arr)

                            # Get input tensor
                            input_tensor = images_list[idx]

                            # Compare content (approximate comparison)
                            input_mean = input_tensor.mean().item()
                            file_mean = file_tensor.mean().item()

                            # Only replace if content is similar (within tolerance)
                            if abs(input_mean - file_mean) < 0.01:  # 1% tolerance
                                images_list[idx] = file_tensor
                        except Exception:
                            pass
                    else:
                        pass
            image_paths = [st.get("filename") for st in states_raw if st.get("filename")]
        else:
            try:
                image_states = json.loads(image_states) if image_states else []
            except Exception as e:
                logger.error(f"Instance {self.instance_id} - Failed to parse image_states: {e}")
                image_states = []
            # decode inline in image_states if present
            for idx, st in enumerate(image_states):
                if isinstance(st, dict):
                    self._decode_inline_image(st, st.get("filename"))
                    fname = st.get("filename")
                    if fname and idx < len(images_list):
                        # Check if file exists and has same content as input
                        file_path = os.path.join(self.output_dir, fname)
                        if os.path.exists(file_path):
                            try:
                                # Load file content
                                img = Image.open(file_path).convert("RGBA")
                                file_arr = np.array(img).astype(np.float32) / 255.0
                                file_tensor = torch.from_numpy(file_arr)

                                # Get input tensor
                                input_tensor = images_list[idx]

                                # Compare content (approximate comparison)
                                input_mean = input_tensor.mean().item()
                                file_mean = file_tensor.mean().item()

                                # Only replace if content is similar (within tolerance)
                                if abs(input_mean - file_mean) < 0.01:  # 1% tolerance
                                    images_list[idx] = file_tensor
                            except Exception:
                                pass
                        else:
                            pass
            image_states = [
                self._normalize_state(state, border_width, board_width, board_height)
                for state in image_states
            ]

        # Save images_list to files with content-based filenames
        image_paths = []
        logger.info(f"Instance {self.instance_id} - Processing {len(images_list)} images")

        for i, img_tensor in enumerate(images_list):
            img = (img_tensor.cpu().numpy() * 255).clip(0, 255).astype(np.uint8)
            pil_img = Image.fromarray(img, mode="RGBA")

            # Calculate image hash from tensor data (not PIL bytes) to avoid PNG compression differences
            # Use the numpy array directly for consistent hashing
            img_hash = hashlib.md5(img.tobytes()).hexdigest()[:8]  # Use first 8 chars for brevity

            # Log image info
            logger.info(f"Instance {self.instance_id} - Image {i}: shape={img.shape}, hash={img_hash}")

            # Check if we should reuse existing filename
            fname = None
            reuse_existing = False
            if i < len(image_states) and isinstance(image_states[i], dict):
                existing_fname = image_states[i].get("filename")
                if existing_fname:
                    # Check if file exists
                    existing_path = os.path.join(self.output_dir, existing_fname)
                    if os.path.exists(existing_path):
                        # We'll check hash after saving to ensure consistency
                        fname = existing_fname
                        reuse_existing = True
                        logger.info(f"Will attempt to reuse existing file {existing_fname}")
                    else:
                        logger.info(f"Existing file not found: {existing_path}")

            # Generate new filename if needed
            if not fname:
                # Check if a file with this hash already exists
                potential_fname = f"xiser_canvas_{self.instance_id}_{img_hash}.png"
                potential_path = os.path.join(self.output_dir, potential_fname)

                if os.path.exists(potential_path):
                    # File exists, check if it's the same content
                    try:
                        with open(potential_path, 'rb') as f:
                            existing_hash = hashlib.md5(f.read()).hexdigest()[:8]
                        if existing_hash == img_hash:
                            # Same content, reuse
                            fname = potential_fname
                        else:
                            # Hash collision, add UUID
                            fname = f"xiser_canvas_{self.instance_id}_{img_hash}_{uuid.uuid4().hex[:8]}.png"
                    except Exception as e:
                        logger.warning(f"Failed to check existing file: {e}")
                        fname = f"xiser_canvas_{self.instance_id}_{img_hash}_{uuid.uuid4().hex[:8]}.png"
                else:
                    # New file
                    fname = potential_fname

                if i < len(image_states) and isinstance(image_states[i], dict):
                    image_states[i]["filename"] = fname

            # Save image
            path = os.path.join(self.output_dir, fname)

            # If reusing existing file, check its hash before overwriting
            old_file_hash = None
            if reuse_existing and os.path.exists(path):
                with open(path, 'rb') as f:
                    old_file_hash = hashlib.md5(f.read()).hexdigest()[:8]

            pil_img.save(path, format="PNG")

            # Calculate actual file hash after saving
            with open(path, 'rb') as f:
                file_hash = hashlib.md5(f.read()).hexdigest()[:8]

            # Check if content actually changed when reusing
            if reuse_existing and old_file_hash:
                if old_file_hash == file_hash:
                    # File content unchanged (or changed in same way due to PNG compression)
                    logger.info(f"Instance {self.instance_id} - Reused file {fname} with same content")
                else:
                    # Content changed - need new filename
                    logger.info(f"Instance {self.instance_id} - Image {i} content changed, creating new file")
                    reuse_existing = False

                    # Generate new filename based on file hash
                    new_fname = f"xiser_canvas_{self.instance_id}_{file_hash}.png"
                    new_path = os.path.join(self.output_dir, new_fname)
                    if not os.path.exists(new_path):
                        os.rename(path, new_path)
                        fname = new_fname
                        path = new_path
                        if i < len(image_states) and isinstance(image_states[i], dict):
                            image_states[i]["filename"] = fname
                    else:
                        # File with this hash already exists, delete duplicate
                        os.remove(path)
                        fname = new_fname
                        path = new_path

            self.created_files.add(fname)
            image_paths.append(fname)

            if reuse_existing:
                logger.info(f"Instance {self.instance_id} - Reused file: {fname}")
            else:
                logger.info(f"Instance {self.instance_id} - Saved new file: {fname} with hash {file_hash}")
            # base64 chunks for UI
            chunk = base64.b64encode(pil_img.tobytes()).decode("utf-8") if False else None  # kept minimal

        # Normalize lengths
        if len(image_states) < len(image_paths):
            for i in range(len(image_states), len(image_paths)):
                image_states.append(
                    self._normalize_state(
                        {"order": i, "filename": image_paths[i]}, border_width, board_width, board_height
                    )
                )
        if len(image_states) > len(image_paths):
            image_states = image_states[: len(image_paths)]

        # Auto-size
        if auto_size == "on" and images_list:
            first = images_list[0]
            h, w = first.shape[0], first.shape[1]
            board_width = min(max(w, 256), 8192)
            board_height = min(max(h, 256), 8192)

        # Render directly to board size (exclude border area in output)
        canvas_pil = Image.new(
            "RGBA",
            (board_width, board_height),
            {
                "black": (0, 0, 0, 255),
                "white": (255, 255, 255, 255),
                "transparent": (0, 0, 0, 0),
            }[canvas_color],
        )
        mask_list = [None] * len(image_states)
        layer_images = [None] * len(image_states)

        render_list = []
        for idx, (path, st) in enumerate(zip(image_paths, image_states)):
            order_val = st.get("order", idx)
            if order_val is None:
                order_val = idx
            render_list.append((order_val, idx, path, st))
        render_list.sort(key=lambda tup: tup[0])
        logger.info(
            f"Instance {self.instance_id} - Render order (order, idx, filename): "
            f"{[(o, idx, st.get('filename')) for o, idx, _, st in render_list]}"
        )

        for _, i, path, state in render_list:
            try:
                if not state.get("visible", True):
                    continue
                img = Image.open(os.path.join(self.output_dir, path)).convert("RGBA")
                brightness = state.get("brightness", 0.0)
                contrast = state.get("contrast", 0.0)
                saturation = state.get("saturation", 0.0)
                if abs(brightness) > 1e-3 or abs(contrast) > 1e-3 or abs(saturation) > 1e-3:
                    img = self._apply_brightness_contrast(img, brightness, contrast, saturation)
                alpha = img.split()[3]
                mask = Image.new("L", (board_width, board_height), 0)

                scale_x = state.get("scaleX", 1.0)
                scale_y = state.get("scaleY", 1.0)
                rotation = state.get("rotation", 0.0)
                skew_x = state.get("skewX", 0.0)
                skew_y = state.get("skewY", 0.0)

                original_width, original_height = img.size
                if scale_x != 1.0 or scale_y != 1.0 or rotation != 0.0 or skew_x != 0.0 or skew_y != 0.0:
                    img = self._apply_coordinate_based_transform(img, scale_x, scale_y, rotation, skew_x, skew_y)
                    alpha_rgba = Image.merge("RGBA", (alpha, alpha, alpha, alpha))
                    alpha_transformed = self._apply_coordinate_based_transform(
                        alpha_rgba, scale_x, scale_y, rotation, skew_x, skew_y
                    )
                    alpha = alpha_transformed.split()[0]

                # Frontend coordinates are in stage space (include border); convert to board space
                frontend_x = state.get("x", border_width + board_width / 2)
                frontend_y = state.get("y", border_width + board_height / 2)
                canvas_x = frontend_x - border_width
                canvas_y = frontend_y - border_width
                backend_x = canvas_x - img.width / 2
                backend_y = canvas_y - img.height / 2
                paste_x = int(backend_x)
                paste_y = int(backend_y)

                visible_x1 = max(0, -paste_x)
                visible_y1 = max(0, -paste_y)
                visible_x2 = min(img.width, board_width - paste_x)
                visible_y2 = min(img.height, board_height - paste_y)

                if visible_x1 < visible_x2 and visible_y1 < visible_y2:
                    img_cropped = img.crop((visible_x1, visible_y1, visible_x2, visible_y2))
                    alpha_cropped = alpha.crop((visible_x1, visible_y1, visible_x2, visible_y2))
                else:
                    mask_list[i] = torch.zeros((board_height, board_width), dtype=torch.float32)
                    layer_images[i] = torch.zeros((board_height, board_width, 4), dtype=torch.float32)
                    continue

                canvas_pil.paste(img_cropped, (max(0, paste_x), max(0, paste_y)), img_cropped)
                mask.paste(alpha_cropped, (max(0, paste_x), max(0, paste_y)))
                mask_list[i] = torch.from_numpy(np.array(mask, dtype=np.float32) / 255.0)
                layer_canvas = Image.new("RGBA", (board_width, board_height), (0, 0, 0, 0))
                layer_canvas.paste(img_cropped, (max(0, paste_x), max(0, paste_y)), img_cropped)
                layer_rgba = torch.from_numpy(np.array(layer_canvas).astype(np.float32) / 255.0)
                layer_images[i] = layer_rgba
            except Exception as e:
                logger.error(f"Instance {self.instance_id} - Failed to apply image {i+1}: {e}")
                mask_list[i] = torch.zeros((board_height, board_width), dtype=torch.float32)
                layer_images[i] = torch.zeros((board_height, board_width, 4), dtype=torch.float32)

        zero_mask = torch.zeros((board_height, board_width), dtype=torch.float32)
        zero_layer = torch.zeros((board_height, board_width, 4), dtype=torch.float32)
        if not mask_list:
            mask_list = [zero_mask]
        if not layer_images:
            layer_images = [zero_layer]
        for idx, m in enumerate(mask_list):
            if m is None:
                mask_list[idx] = zero_mask
        for idx, l in enumerate(layer_images):
            if l is None:
                layer_images[idx] = zero_layer

        masks_tensor = torch.stack(mask_list, dim=0) if mask_list else torch.zeros((1, board_height, board_width))
        layer_images_tensor = (
            torch.stack(layer_images, dim=0)
            if layer_images
            else torch.zeros((1, board_height, board_width, 4))
        )
        # Already rendering at board size (no border), so convert directly
        canvas_tensor = torch.from_numpy(np.array(canvas_pil).astype(np.float32) / 255.0).unsqueeze(0)

        self.properties["ui_config"] = {
            "board_width": board_width,
            "board_height": board_height,
            "border_width": border_width,
            "canvas_color": {
                "black": "rgb(0, 0, 0)",
                "white": "rgb(255, 255, 255)",
                "transparent": "rgba(0, 0, 0, 0)",
            }[canvas_color],
            "border_color": {
                "black": "rgb(25, 25, 25)",
                "white": "rgb(230, 230, 230)",
                "transparent": "rgba(0, 0, 0, 0)",
            }[canvas_color],
            "auto_size": auto_size,
            "image_paths": image_paths,
            "display_scale": float(display_scale),
        }
        self.properties["image_states"] = image_states

        layer_data_output = {
            "version": "1.0",
            "canvas_width": board_width,
            "canvas_height": board_height,
            "border_width": border_width,
            "layers": [],
        }
        for i, state in enumerate(image_states):
            if not isinstance(state, dict):
                state = {}
            layer_data_output["layers"].append(
                {
                    "index": i,
                    "x": state.get("x", border_width + board_width / 2),
                    "y": state.get("y", border_width + board_height / 2),
                    "scaleX": state.get("scaleX", 1.0),
                    "scaleY": state.get("scaleY", 1.0),
                    "rotation": state.get("rotation", 0.0),
                    "skewX": state.get("skewX", 0.0),
                    "skewY": state.get("skewY", 0.0),
                    "brightness": state.get("brightness", 0.0),
                    "contrast": state.get("contrast", 0.0),
                    "saturation": state.get("saturation", 0.0),
                    "opacity": 1.0,
                    "visible": state.get("visible", True),
                    "order": state.get("order", i),
                    "filename": state.get("filename"),
                }
            )

        return {
            "ui": {
                "image_states": image_states,
                "image_base64_chunks": image_base64_chunks,
                "image_paths": image_paths,
                "board_width": [board_width],
                "board_height": [board_height],
                "border_width": [border_width],
                "auto_size": [auto_size],
            },
            "result": (canvas_tensor, masks_tensor, layer_images_tensor, layer_data_output),
        }

    def cleanup(self):
        for filename in list(self.created_files):
            file_path = os.path.join(self.output_dir, filename)
            try:
                if os.path.exists(file_path):
                    os.remove(file_path)
                self.created_files.remove(filename)
            except Exception as e:
                logger.error(f"Instance {self.instance_id} - Failed to delete file during cleanup {file_path}: {e}")

    def __del__(self):
        # keep generated files for UI reload; no auto-cleanup here
        pass


class XIS_Canvas(io.ComfyNode):
    """V3 wrapper around legacy-stable XISER_Canvas."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="XISER_Canvas",
            display_name="XISER Canvas",
            category="XISER_Nodes/Visual_Editing",
            is_output_node=True,
            inputs=[
                io.AnyType.Input("pack_images", optional=True),
                io.Int.Input("board_width", default=1024, min=256, max=8192, step=16),
                io.Int.Input("board_height", default=1024, min=256, max=8192, step=16),
                io.Int.Input("border_width", default=120, min=10, max=200, step=1),
                io.Combo.Input("canvas_color", options=["black", "white", "transparent"], default="black"),
                io.Float.Input("display_scale", default=0.5, min=0.1, max=1.0, step=0.01),
                io.Combo.Input("auto_size", options=["off", "on"], default="off"),
                io.String.Input("image_states", default="[]", multiline=False),
                io.AnyType.Input("file_data", optional=True),
                io.AnyType.Input("canvas_config", optional=True),
                io.AnyType.Input("layer_data", optional=True),
            ],
            outputs=[
                io.Image.Output("canvas_image", display_name="canvas_image"),
                io.Mask.Output("masks", display_name="masks"),
                io.Image.Output("layer_images", display_name="layer_images"),
                io.AnyType.Output("layer_data_out", display_name="layer_data"),
            ],
        )

    @classmethod
    def execute(
        cls,
        pack_images,
        board_width,
        board_height,
        border_width,
        canvas_color,
        display_scale,
        auto_size,
        image_states,
        file_data=None,
        canvas_config=None,
        layer_data=None,
    ):
        # Generate stable instance_id based on node configuration
        # This ensures same node configuration produces same instance_id across executions
        config_str = f"{board_width}_{board_height}_{border_width}_{canvas_color}_{display_scale}_{auto_size}"
        instance_id = hashlib.md5(config_str.encode()).hexdigest()[:32]

        helper = XISER_Canvas(instance_id=instance_id)
        rendered = helper.render(
            pack_images=pack_images,
            board_width=board_width,
            board_height=board_height,
            border_width=border_width,
            canvas_color=canvas_color,
            display_scale=display_scale,
            auto_size=auto_size,
            image_states=image_states,
            file_data=file_data,
            canvas_config=canvas_config,
            layer_data=layer_data,
        )
        ui_payload = rendered.get("ui", {})
        outputs = rendered.get("result", ())
        return io.NodeOutput(*outputs, ui=ui_payload)


class XISCanvasExtension(ComfyExtension):
    async def get_node_list(self):
        return [XIS_Canvas]


async def comfy_entrypoint():
    return XISCanvasExtension()
