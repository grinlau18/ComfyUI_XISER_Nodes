import os
import torch
import numpy as np
from PIL import Image
from psd_tools import PSDImage
import folder_paths
import logging
import shutil
import math

# 设置日志
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class XIS_PSDLayerExtractor:
    """
    A node for extracting layers from a PSD file, outputting images and metadata.

    @class XIS_PSDLayerExtractor
    @description Extracts individual layers from a PSD file as images and provides file metadata including canvas size and layer information.
    """

    @classmethod
    def INPUT_TYPES(cls):
        """
        Defines the input types for the node.

        @method INPUT_TYPES
        @returns {Object} Input configuration
        @returns {Object} uploaded_file - Path to the PSD file (string)
        @returns {Object} crop_by_canvas - Whether to crop images to canvas size (boolean)
        """
        return {
            "required": {
                "uploaded_file": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "dynamicPrompts": False
                }),
                "crop_by_canvas": ("BOOLEAN", {
                    "default": False,  # Updated default value
                    "label": "Crop Image by Canvas"
                }),
            },
        }

    RETURN_TYPES = ("IMAGE", "FILE_DATA")
    RETURN_NAMES = ("pack_images", "file_data")
    FUNCTION = "extract_layers"
    CATEGORY = "XISER_Nodes/Import_Data"

    def extract_layers(self, uploaded_file, crop_by_canvas):
        """
        Extracts layers from a PSD file and returns images and metadata.

        @method extract_layers
        @param {string} uploaded_file - Path to the PSD file (e.g., 'input/psd_files/file.psd')
        @param {boolean} crop_by_canvas - If true, crops images to canvas size; if false, outputs full layer images
        @returns {tuple} (pack_images, file_data)
        @returns {list} pack_images - List of image tensors (XIS_IMAGES format)
        @returns {dict} file_data - Metadata including canvas size and layer information (width, height, position, transform)
        @throws {ValueError} If file is invalid or no valid layers are found
        """
        if not uploaded_file:
            logger.error("No file uploaded")
            raise ValueError("No file uploaded")

        # 构造文件路径
        input_dir = folder_paths.get_input_directory()
        psd_dir = os.path.join(input_dir, "psd_files")
        if not os.path.exists(psd_dir):
            os.makedirs(psd_dir, exist_ok=True)
            logger.debug(f"Created directory: {psd_dir}")

        # 规范化路径
        normalized_path = uploaded_file.replace("input/", "").replace("psd_files/", "")
        file_name = os.path.basename(normalized_path)
        file_path = os.path.join(psd_dir, file_name)
        logger.debug(f"Input uploaded_file: {uploaded_file}")
        logger.debug(f"Normalized file path: {file_path}")

        # 检查 input 目录（可能文件保存到 input）
        input_file_path = os.path.join(input_dir, file_name)
        if os.path.exists(input_file_path) and not os.path.exists(file_path):
            try:
                shutil.move(input_file_path, file_path)
                logger.debug(f"Moved file from {input_file_path} to {file_path}")
            except Exception as e:
                logger.error(f"Failed to move file from {input_file_path} to {file_path}: {str(e)}")
                raise ValueError(f"Failed to move file: {str(e)}")

        # 验证文件
        if not os.path.exists(file_path):
            logger.error(f"Uploaded file not found: {file_path}")
            raise ValueError(f"Uploaded file not found: {file_path}")
        if not file_path.lower().endswith('.psd'):
            logger.error(f"Invalid file type: {file_path}")
            raise ValueError("Uploaded file must be a PSD file")

        # 加载 PSD 文件
        try:
            psd = PSDImage.open(file_path)
            logger.debug(f"Loaded PSD file: {file_path}, canvas size: ({psd.width}, {psd.height})")
        except Exception as e:
            logger.error(f"Failed to load PSD file: {str(e)}")
            raise ValueError(f"Failed to load PSD file: {str(e)}")

        # 初始化输出
        normalized_images = []
        file_data = {
            "canvas": {"width": psd.width, "height": psd.height},
            "layers": []
        }
        canvas_width, canvas_height = psd.width, psd.height

        # 遍历图层
        for layer in psd:
            if not layer.is_visible() or not layer.has_pixels():
                logger.debug(f"Skipping invisible or empty layer: {layer.name}")
                continue

            try:
                # 获取图层图像
                pil_image = layer.composite()
                logger.debug(f"Processing layer: {layer.name}, size: {pil_image.size}, offset: {layer.offset}")
                
                # 转换为 RGBA
                if pil_image.mode != 'RGBA':
                    pil_image = pil_image.convert('RGBA')
                
                # 转换为 numpy 数组
                image_np = np.array(pil_image).astype(np.float32) / 255.0
                layer_width, layer_height = pil_image.size
                offset_x, offset_y = layer.offset

                # 初始化图层信息
                layer_info = {
                    "name": layer.name,
                    "width": layer_width,      # 图层实际宽度
                    "height": layer_height,    # 图层实际高度
                    "offset_x": offset_x,
                    "offset_y": offset_y,
                    "rotation": 0.0,  # 默认旋转角度
                    "scale_x": 1.0,   # 默认缩放比例
                    "scale_y": 1.0
                }

                # 尝试提取旋转和缩放（psd-tools 支持有限）
                try:
                    if hasattr(layer, 'transform_matrix'):
                        # 变换矩阵可能包含旋转和缩放
                        matrix = layer.transform_matrix
                        if matrix and len(matrix) >= 6:
                            # 2x3 仿射矩阵: [a, b, c, d, tx, ty]
                            # 旋转角度: atan2(b, a)
                            a, b, _, d, *_ = matrix
                            rotation_rad = math.atan2(b, a)
                            layer_info["rotation"] = math.degrees(rotation_rad)
                            # 缩放: sqrt(a^2 + b^2) for x, sqrt(c^2 + d^2) for y
                            scale_x = math.sqrt(a**2 + b**2)
                            scale_y = math.sqrt(d**2 + (-b)**2)
                            layer_info["scale_x"] = scale_x
                            layer_info["scale_y"] = scale_y
                    elif layer.is_smart_object():
                        # 智能图层可能包含原始尺寸
                        smart_obj = layer.smart_object
                        if hasattr(smart_obj, 'size'):
                            orig_width, orig_height = smart_obj.size
                            layer_info["scale_x"] = layer_width / orig_width if orig_width > 0 else 1.0
                            layer_info["scale_y"] = layer_height / orig_height if orig_height > 0 else 1.0
                except Exception as e:
                    logger.warning(f"Failed to extract transform for layer {layer.name}: {str(e)}")

                file_data["layers"].append(layer_info)

                # 处理图像输出
                if crop_by_canvas:
                    # 裁剪到画布尺寸
                    canvas_tensor = torch.zeros((canvas_height, canvas_width, 4), dtype=torch.float32)
                    x_start = max(0, offset_x)
                    y_start = max(0, offset_y)
                    x_end = min(canvas_width, offset_x + layer_width)
                    y_end = min(canvas_height, offset_y + layer_height)
                    src_x_start = max(0, -offset_x)
                    src_y_start = max(0, -offset_y)
                    src_x_end = src_x_start + (x_end - x_start)
                    src_y_end = src_y_start + (y_end - y_start)
                    if x_end > x_start and y_end > y_start:
                        canvas_tensor[y_start:y_end, x_start:x_end] = torch.from_numpy(
                            image_np[src_y_start:src_y_end, src_x_start:src_x_end]
                        )
                    output_tensor = canvas_tensor
                else:
                    # 输出完整图层图像
                    output_tensor = torch.from_numpy(image_np)

                # 验证张量
                if len(output_tensor.shape) != 3 or output_tensor.shape[-1] != 4:
                    logger.error(f"Invalid image tensor shape for layer {layer.name}: {output_tensor.shape}")
                    raise ValueError(f"Invalid image tensor shape: {output_tensor.shape}")

                normalized_images.append(output_tensor)

            except Exception as e:
                logger.warning(f"Failed to process layer {layer.name}: {str(e)}")
                continue

        if not normalized_images:
            logger.error("No valid layers found in PSD file")
            raise ValueError("No valid layers found in PSD file")

        logger.info(f"Extracted {len(normalized_images)} layers from PSD file")
        return (normalized_images, file_data)

NODE_CLASS_MAPPINGS = {
    "XIS_PSDLayerExtractor": XIS_PSDLayerExtractor
}