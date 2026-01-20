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

from comfy_api.v0_0_2 import io, ComfyExtension

# 导入统一的调节工具模块
from .adjustment_utils import AdjustmentUtils
from .adjustment_algorithms import AdjustmentAlgorithms

logger = logging.getLogger("XISER_Canvas")
logger.setLevel(logging.ERROR)


def _unwrap_v3_data(data):
    """Unwrap io.NodeOutput-like objects."""
    if hasattr(data, "outputs") and isinstance(getattr(data, "outputs"), tuple):
        outs = data.outputs
        if len(outs) == 1:
            return outs[0]
        return list(outs)
    return data


# Canvas缓存清理机制（简化版）
# 移除了复杂的全局清理线程，依赖实例级清理和系统清理


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
        self.created_files = set()  # 跟踪当前实例创建的文件
        logger.info(f"Instance {self.instance_id} - Canvas initialized with output directory: {self.output_dir}")

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
            "brightness": AdjustmentUtils.DEFAULT_BRIGHTNESS,
            "contrast": AdjustmentUtils.DEFAULT_CONTRAST,
            "saturation": AdjustmentUtils.DEFAULT_SATURATION,
            "opacity": AdjustmentUtils.DEFAULT_OPACITY,
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

        # 使用统一的调节工具规范化调节参数
        adjustment_state = {
            "brightness": state.get("brightness"),
            "contrast": state.get("contrast"),
            "saturation": state.get("saturation"),
            "opacity": state.get("opacity")
        }
        normalized_adjustment = AdjustmentUtils.normalize_adjustment_state(adjustment_state)

        normalized["brightness"] = normalized_adjustment["brightness"]
        normalized["contrast"] = normalized_adjustment["contrast"]
        normalized["saturation"] = normalized_adjustment["saturation"]
        normalized["opacity"] = normalized_adjustment["opacity"]

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
        """Apply brightness, contrast, and saturation adjustments using unified algorithms."""
        # 使用统一的调节算法
        return AdjustmentAlgorithms.apply_adjustments(
            image,
            brightness=brightness,
            contrast=contrast,
            saturation=saturation
        )

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

    def _decode_inline_image(self, holder, fname_fallback=None, layer_index=None):
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

            # Calculate hash from image data
            img_bytes = BytesIO()
            img.save(img_bytes, format="PNG")
            img_data = img_bytes.getvalue()

            # Use layer_index if provided to ensure unique filenames for same content in different layers
            if layer_index is not None:
                combined_data = img_data + str(layer_index).encode()
                file_hash = hashlib.md5(combined_data).hexdigest()[:8]
            else:
                file_hash = hashlib.md5(img_data).hexdigest()[:8]

            # Generate filename
            fname = f"xiser_cutout_{file_hash}.png"
            path = os.path.join(self.output_dir, fname)

            # Check if file exists
            if os.path.exists(path):
                # File exists, reuse it
                logger.info(f"Instance {self.instance_id} - Reusing inline image cache: {fname}")
            else:
                # Save new file
                with open(path, 'wb') as f:
                    f.write(img_data)
                logger.info(f"Instance {self.instance_id} - Saved new inline image: {fname}")

            # Update holder with filename
            holder["filename"] = fname
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

        logger.info(f"Instance {self.instance_id} - Normalized {len(images_list)} images from pack_images")


        # parse image_states/layer_data/file_data
        image_paths = []
        image_base64_chunks = []

        # 首先处理file_data（PSD图层数据）
        if file_data and isinstance(file_data, dict):
            logger.info(f"Instance {self.instance_id} - Processing file_data from PSD")
            logger.debug(f"Instance {self.instance_id} - file_data keys: {list(file_data.keys())}")

            # 提取PSD画布尺寸
            psd_canvas = file_data.get("canvas", {})
            psd_width = psd_canvas.get("width", board_width)
            psd_height = psd_canvas.get("height", board_height)
            logger.debug(f"Instance {self.instance_id} - PSD canvas size: {psd_width}x{psd_height}")

            # 如果auto_size为on，使用PSD画布尺寸
            if auto_size == "on":
                board_width = min(max(psd_width, 256), 8192)
                board_height = min(max(psd_height, 256), 8192)
                logger.info(f"Instance {self.instance_id} - Auto-sized canvas to PSD dimensions: {board_width}x{board_height}")
            else:
                # 如果auto_size为off，但PSD画布尺寸与当前画布尺寸不同
                # 需要缩放图层坐标
                if psd_width != board_width or psd_height != board_height:
                    scale_x = board_width / psd_width if psd_width > 0 else 1.0
                    scale_y = board_height / psd_height if psd_height > 0 else 1.0
                    logger.debug(f"Instance {self.instance_id} - Scaling PSD coordinates: scale_x={scale_x}, scale_y={scale_y}")
                    # 在图层处理时会应用这个缩放

            # 转换PSD图层数据为Canvas格式
            psd_layers = file_data.get("layers", [])
            logger.debug(f"Instance {self.instance_id} - Found {len(psd_layers)} PSD layers")
            logger.debug(f"Instance {self.instance_id} - Images list has {len(images_list)} images")

            # 调试：打印所有图层信息
            for i, layer in enumerate(psd_layers):
                if isinstance(layer, dict):
                    logger.debug(f"Instance {self.instance_id} - PSD layer {i}: name={layer.get('name')}, "
                               f"size={layer.get('width')}x{layer.get('height')}, "
                               f"offset=({layer.get('offset_x')},{layer.get('offset_y')}), "
                               f"is_canvas_background={layer.get('is_canvas_background', False)}")

            converted_layers = []

            for idx, psd_layer in enumerate(psd_layers):
                if not isinstance(psd_layer, dict):
                    continue

                # 提取PSD图层信息（包括背景图）
                layer_name = psd_layer.get("name", f"Layer_{idx}")
                layer_width = psd_layer.get("width", 0)
                layer_height = psd_layer.get("height", 0)
                offset_x = psd_layer.get("offset_x", 0)
                offset_y = psd_layer.get("offset_y", 0)
                rotation = psd_layer.get("rotation", 0.0)
                scale_x = psd_layer.get("scale_x", 1.0)
                scale_y = psd_layer.get("scale_y", 1.0)

                logger.debug(f"Instance {self.instance_id} - Processing PSD layer {idx} '{layer_name}': "
                           f"size={layer_width}x{layer_height}, offset=({offset_x},{offset_y}), "
                           f"rotation={rotation}, scale=({scale_x},{scale_y})")

                # 简单转换：直接使用PSD的偏移和缩放
                # PSD坐标系统：左上角为原点
                # Canvas坐标系统：中心点坐标

                # 如果auto_size为off且画布尺寸不同，需要缩放坐标
                if auto_size == "off" and (psd_width != board_width or psd_height != board_height):
                    scale_factor_x = board_width / psd_width if psd_width > 0 else 1.0
                    scale_factor_y = board_height / psd_height if psd_height > 0 else 1.0
                    # 缩放偏移和尺寸
                    offset_x = offset_x * scale_factor_x
                    offset_y = offset_y * scale_factor_y
                    layer_width = layer_width * scale_factor_x
                    layer_height = layer_height * scale_factor_y
                    # 缩放比例也需要调整
                    scale_x = scale_x * scale_factor_x
                    scale_y = scale_y * scale_factor_y

                # 计算图层中心点（相对于PSD画布）
                layer_center_x = offset_x + layer_width / 2
                layer_center_y = offset_y + layer_height / 2

                # 转换为Canvas坐标（加上边框偏移）
                x = border_width + layer_center_x
                y = border_width + layer_center_y

                # 构建Canvas兼容的图层数据
                canvas_layer = {
                    "name": layer_name,
                    "x": float(x),
                    "y": float(y),
                    "scaleX": float(scale_x),
                    "scaleY": float(scale_y),
                    "rotation": float(rotation),
                    "skewX": 0.0,
                    "skewY": 0.0,
                    "brightness": 0.0,
                    "contrast": 0.0,
                    "saturation": 0.0,
                    "opacity": 100.0,
                    "visible": True,
                    "order": idx,  # 保持原始顺序
                    "filename": None,
                }

                converted_layers.append(canvas_layer)
                logger.debug(f"Instance {self.instance_id} - Converted PSD layer {layer_name}: "
                          f"offset({offset_x},{offset_y}) -> pos({x},{y})")

            # 使用转换后的图层数据作为layer_data
            if converted_layers:
                layer_data = {
                    "layers": converted_layers,
                    "source": "psd_file_data"
                }
                logger.info(f"Instance {self.instance_id} - Converted {len(converted_layers)} PSD layers to Canvas format")

        # 然后处理layer_data（如果存在）
        logger.debug(f"Instance {self.instance_id} - Checking layer_data: exists={layer_data is not None}, "
                   f"type={type(layer_data) if layer_data else 'None'}")

        if layer_data and isinstance(layer_data, dict) and layer_data.get("layers"):
            logger.info(f"Instance {self.instance_id} - Processing {len(layer_data['layers'])} layers from layer_data")
            logger.debug(f"Instance {self.instance_id} - layer_data source: {layer_data.get('source', 'unknown')}")
            states_raw = []
            for idx, layer in enumerate(layer_data["layers"]):
                # decode inline cutout to file, update filename with layer index
                self._decode_inline_image(layer, layer.get("filename"), layer_index=idx)
                states_raw.append(layer)
            image_states = [
                self._normalize_state(st, border_width, board_width, board_height) for st in states_raw
            ]
            # align images_list length with states (if inline provided replaced)
            for idx, st in enumerate(states_raw):
                fname = st.get("filename")
                # 如果有inline image数据（抠图后的图像），总是使用inline image
                has_inline_image = st.get("image") or st.get("image_base64") or st.get("data")
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

                            # 如果有inline image数据，总是使用文件中的图像，忽略pack_images输入
                            if has_inline_image:
                                images_list[idx] = file_tensor
                                logger.info(f"Instance {self.instance_id} - Using inline/cutout image for layer {idx} (ignoring pack_images input)")
                            # 如果没有inline image数据，但内容相似，也使用文件中的图像
                            elif abs(input_tensor.mean().item() - file_tensor.mean().item()) < 0.01:
                                images_list[idx] = file_tensor
                                logger.info(f"Instance {self.instance_id} - Using similar image from file for layer {idx}")
                        except Exception as e:
                            logger.warning(f"Instance {self.instance_id} - Failed to load inline image for layer {idx}: {e}")
                    else:
                        logger.warning(f"Instance {self.instance_id} - Inline image file not found: {file_path}")
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
                    self._decode_inline_image(st, st.get("filename"), layer_index=idx)
                    fname = st.get("filename")
                    # 如果有inline image数据（抠图后的图像），总是使用inline image
                    has_inline_image = st.get("image") or st.get("image_base64") or st.get("data")
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

                                # 如果有inline image数据，总是使用文件中的图像，忽略pack_images输入
                                if has_inline_image:
                                    images_list[idx] = file_tensor
                                    logger.info(f"Instance {self.instance_id} - Using inline/cutout image for layer {idx} (ignoring pack_images input)")
                                # 如果没有inline image数据，但内容相似，也使用文件中的图像
                                elif abs(input_tensor.mean().item() - file_tensor.mean().item()) < 0.01:
                                    images_list[idx] = file_tensor
                                    logger.info(f"Instance {self.instance_id} - Using similar image from file for layer {idx}")
                            except Exception as e:
                                logger.warning(f"Instance {self.instance_id} - Failed to load inline image for layer {idx}: {e}")
                        else:
                            logger.warning(f"Instance {self.instance_id} - Inline image file not found: {file_path}")
            image_states = [
                self._normalize_state(state, border_width, board_width, board_height)
                for state in image_states
            ]

        # Save images_list to files with content+index based filenames
        image_paths = []
        logger.info(f"Instance {self.instance_id} - Processing {len(images_list)} images")

        for i, img_tensor in enumerate(images_list):
            img = (img_tensor.cpu().numpy() * 255).clip(0, 255).astype(np.uint8)
            pil_img = Image.fromarray(img, mode="RGBA")

            # Calculate combined hash: image content + layer index
            # This ensures same content in different layers get different filenames
            combined_data = img.tobytes() + str(i).encode()
            file_hash = hashlib.md5(combined_data).hexdigest()[:8]

            # Log image info
            logger.info(f"Instance {self.instance_id} - Image {i}: shape={img.shape}, hash={file_hash}")

            # Generate filename with content+index hash
            final_fname = f"xiser_image_{file_hash}.png"
            final_path = os.path.join(self.output_dir, final_fname)

            # Check if file already exists
            if os.path.exists(final_path):
                # File exists, reuse it
                logger.info(f"Instance {self.instance_id} - Reusing cached file: {final_fname}")
            else:
                # Save new file
                pil_img.save(final_path, format="PNG")
                logger.info(f"Instance {self.instance_id} - Saved new file: {final_fname}")

            # Update image_states with final filename
            if i < len(image_states) and isinstance(image_states[i], dict):
                image_states[i]["filename"] = final_fname

            self.created_files.add(final_fname)
            image_paths.append(final_fname)

        # Normalize lengths and ensure complete states
        if len(image_states) < len(image_paths):
            for i in range(len(image_states), len(image_paths)):
                # Generate complete default state for new images
                default_state = self._normalize_state(
                    {"order": i, "filename": image_paths[i]}, 
                    border_width, 
                    board_width, 
                    board_height
                )
                # Ensure all adjustment parameters are present with default values
                default_state.update({
                    "brightness": AdjustmentUtils.DEFAULT_BRIGHTNESS,
                    "contrast": AdjustmentUtils.DEFAULT_CONTRAST,
                    "saturation": AdjustmentUtils.DEFAULT_SATURATION,
                    "opacity": AdjustmentUtils.DEFAULT_OPACITY,
                    "visible": True,
                    "locked": False
                })
                image_states.append(default_state)
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
                opacity = state.get("opacity", 100.0)
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

                # 使用预乘alpha合成算法将图像合成到画布
                # 使用统一的透明度转换工具
                opacity_value = AdjustmentUtils.opacity_to_alpha(opacity)
                canvas_pil = AdjustmentAlgorithms.alpha_composite(canvas_pil, img_cropped, max(0, paste_x), max(0, paste_y), opacity_value)

                mask.paste(alpha_cropped, (max(0, paste_x), max(0, paste_y)))
                mask_list[i] = torch.from_numpy(np.array(mask, dtype=np.float32) / 255.0)

                # 创建单独的图层图像（带透明度）
                layer_canvas = Image.new("RGBA", (board_width, board_height), (0, 0, 0, 0))
                layer_canvas = AdjustmentAlgorithms.alpha_composite(layer_canvas, img_cropped, max(0, paste_x), max(0, paste_y), opacity_value)
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
                    "opacity": state.get("opacity", 100.0),  # Default opacity 100%
                    "visible": state.get("visible", True),
                    "order": state.get("order", i),
                    "filename": state.get("filename"),
                }
            )

        return {
            "ui": {
                "image_states": image_states,  # 返回完整的状态，包括所有调整参数
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
        """简化版清理：删除当前实例创建的所有文件"""
        if not hasattr(self, 'created_files') or not self.created_files:
            return

        logger.info(f"Instance {self.instance_id} - Cleaning up {len(self.created_files)} files")

        removed_count = 0
        for filename in list(self.created_files):
            file_path = os.path.join(self.output_dir, filename)
            try:
                if os.path.exists(file_path):
                    os.remove(file_path)
                    removed_count += 1
                    logger.debug(f"Instance {self.instance_id} - Removed file: {filename}")
            except Exception as e:
                logger.warning(f"Instance {self.instance_id} - Failed to remove {filename}: {e}")

        self.created_files.clear()
        logger.info(f"Instance {self.instance_id} - Cleanup completed: {removed_count} files removed")

    def __del__(self):
        """析构函数：可选地自动清理"""
        # 注意：自动清理可能导致刷新后文件丢失
        # 保持文件以便UI重新加载，依赖外部系统清理
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


# V3节点类导出列表
V3_NODE_CLASSES = [XIS_Canvas]
