import os
import torch
import numpy as np
from PIL import Image
from psd_tools import PSDImage
import folder_paths
import logging

# 设置日志
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class XIS_PSDLayerExtractor:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "uploaded_file": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "dynamicPrompts": False
                }),
            },
        }

    RETURN_TYPES = ("XIS_IMAGES",)
    RETURN_NAMES = ("pack_images",)
    FUNCTION = "extract_layers"
    CATEGORY = "XISER_Nodes/ImageAndMask"

    def extract_layers(self, uploaded_file):
        if not uploaded_file:
            logger.error("No file uploaded")
            raise ValueError("No file uploaded")

        # 构造完整文件路径
        input_dir = folder_paths.get_input_directory()
        file_path = os.path.join(input_dir, os.path.basename(uploaded_file))

        # 验证文件是否存在
        if not os.path.exists(file_path):
            logger.error(f"Uploaded file not found: {file_path}")
            raise ValueError(f"Uploaded file not found: {file_path}")
        
        if not file_path.lower().endswith('.psd'):
            logger.error(f"Invalid file type: {file_path}")
            raise ValueError("Uploaded file must be a PSD file")

        # 使用psd-tools加载PSD文件
        try:
            psd = PSDImage.open(file_path)
            logger.debug(f"Loaded PSD file: {file_path}, canvas size: ({psd.width}, {psd.height})")
        except Exception as e:
            logger.error(f"Failed to load PSD file: {str(e)}")
            raise ValueError(f"Failed to load PSD file: {str(e)}")

        # 存储所有图层的图像数据
        normalized_images = []
        
        # 获取画板尺寸
        canvas_width, canvas_height = psd.width, psd.height
        
        # 遍历PSD文件中的所有图层
        for layer in psd:
            if not layer.is_visible() or not layer.has_pixels():
                logger.debug(f"Skipping invisible or empty layer: {layer.name}")
                continue

            try:
                # 获取图层的像素数据
                pil_image = layer.composite()
                logger.debug(f"Processing layer: {layer.name}, size: {pil_image.size}, offset: {layer.offset}")
                
                # 转换为RGBA格式
                if pil_image.mode != 'RGBA':
                    pil_image = pil_image.convert('RGBA')
                
                # 转换为numpy数组
                image_np = np.array(pil_image).astype(np.float32) / 255.0
                
                # 创建画板尺寸的透明背景张量
                canvas_tensor = torch.zeros((canvas_height, canvas_width, 4), dtype=torch.float32)
                
                # 获取图层偏移量
                offset_x, offset_y = layer.offset
                
                # 计算图层在画板中的边界
                layer_width, layer_height = pil_image.size
                x_start = max(0, offset_x)
                y_start = max(0, offset_y)
                x_end = min(canvas_width, offset_x + layer_width)
                y_end = min(canvas_height, offset_y + layer_height)
                
                # 计算图层图像的有效区域
                src_x_start = max(0, -offset_x)
                src_y_start = max(0, -offset_y)
                src_x_end = src_x_start + (x_end - x_start)
                src_y_end = src_y_start + (y_end - y_start)
                
                # 将图层图像复制到画板张量的正确位置
                if x_end > x_start and y_end > y_start:
                    canvas_tensor[y_start:y_end, x_start:x_end] = torch.from_numpy(
                        image_np[src_y_start:src_y_end, src_x_start:src_x_end]
                    )
                
                # 验证张量格式
                if len(canvas_tensor.shape) != 3 or canvas_tensor.shape[-1] != 4:
                    logger.error(f"Invalid image tensor shape for layer {layer.name}: {canvas_tensor.shape}")
                    raise ValueError(f"Invalid image tensor shape: {canvas_tensor.shape}")
                
                normalized_images.append(canvas_tensor)
                
            except Exception as e:
                logger.warning(f"Failed to process layer {layer.name}: {str(e)}")
                continue

        if not normalized_images:
            logger.error("No valid layers found in PSD file")
            raise ValueError("No valid layers found in PSD file")

        logger.info(f"Extracted {len(normalized_images)} layers from PSD file, each with size: ({canvas_height}, {canvas_width})")
        return (normalized_images,)

NODE_CLASS_MAPPINGS = {
    "XIS_PSDLayerExtractor": XIS_PSDLayerExtractor
}