import os
import torch
import numpy as np
from PIL import Image
from psd_tools import PSDImage
import folder_paths
import logging
import shutil
import math
from comfy_api.latest import io, ComfyExtension

# 设置日志
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


class XIS_PSDLayerExtractorV3(io.ComfyNode):
    """
    A V3 node for extracting layers from a PSD file, outputting images and metadata.

    @class XIS_PSDLayerExtractorV3
    @description Extracts individual layers from a PSD file as images and provides file metadata including canvas size and layer information.
    """

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="XIS_PSDLayerExtractor",
            display_name="XIS PSDLayerExtractor",
            category="XISER_Nodes/Import_Data",
            inputs=[
                io.String.Input("uploaded_file", default="", multiline=False, optional=True),
                io.Boolean.Input("crop_by_canvas", default=False, optional=True),
            ],
            outputs=[
                io.Image.Output("pack_images", display_name="pack_images", is_output_list=True),
                io.AnyType.Output("file_data", display_name="file_data"),
            ],
        )

    @classmethod
    def execute(cls, uploaded_file="", crop_by_canvas=False):
        """
        Extracts layers from a PSD file and returns images and metadata.

        @method execute
        @param {string} uploaded_file - Path to the PSD file (e.g., 'input/psd_files/file.psd')
        @param {boolean} crop_by_canvas - If true, crops images to canvas size; if false, outputs full layer images
        @returns {io.NodeOutput} (pack_images, file_data)
        @returns {list} pack_images - List of image tensors in ComfyUI format (B, H, W, C=4) RGBA
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

        # 生成空白画布图片（用于前端auto_size参考）
        try:
            # 创建透明空白图片张量 (H, W, 4) - 保持RGBA格式
            blank_image_tensor = torch.zeros((canvas_height, canvas_width, 4), dtype=torch.float32)
            normalized_images.append(blank_image_tensor)

            # 在file_data中添加空白画布图层信息
            canvas_layer_info = {
                "name": "Canvas Background",
                "width": canvas_width,
                "height": canvas_height,
                "offset_x": 0,
                "offset_y": 0,
                "rotation": 0.0,
                "scale_x": 1.0,
                "scale_y": 1.0,
                "is_canvas_background": True  # 标记为画布背景
            }
            file_data["layers"].insert(0, canvas_layer_info)
            logger.info(f"Generated blank canvas image and layer info: {canvas_width}x{canvas_height}")
        except Exception as e:
            logger.warning(f"Failed to generate blank canvas image and layer info: {str(e)}")

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

                # 处理图像输出 - 保持RGBA格式
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
                    # 输出完整图层图像 - 保持RGBA格式
                    output_tensor = torch.from_numpy(image_np)

                # 验证张量 - 期望RGBA格式 (H, W, 4)
                if len(output_tensor.shape) != 3 or output_tensor.shape[-1] != 4:
                    logger.error(f"Invalid image tensor shape for layer {layer.name}: {output_tensor.shape}")
                    raise ValueError(f"Invalid image tensor shape: {output_tensor.shape}, expected (H, W, 4)")

                normalized_images.append(output_tensor)

            except Exception as e:
                logger.warning(f"Failed to process layer {layer.name}: {str(e)}")
                continue

        if not normalized_images:
            logger.error("No valid layers found in PSD file")
            raise ValueError("No valid layers found in PSD file")

        logger.info(f"Extracted {len(normalized_images)} layers from PSD file")

        # 调试：记录图像张量信息
        for i, img_tensor in enumerate(normalized_images):
            logger.debug(f"Image {i}: shape={img_tensor.shape}, dtype={img_tensor.dtype}, min={img_tensor.min():.3f}, max={img_tensor.max():.3f}")

        # 确保所有图像张量都是正确的格式 (H, W, 4)
        # 转换为ComfyUI期望的批次格式 (B, H, W, C)
        batch_images = []
        for img_tensor in normalized_images:
            # 确保是3D张量 (H, W, 4)
            if img_tensor.dim() == 3:
                # 添加批次维度 -> (1, H, W, 4)
                batch_img = img_tensor.unsqueeze(0)
                batch_images.append(batch_img)
            else:
                logger.warning(f"Unexpected tensor dimension: {img_tensor.shape}, skipping")

        # 如果没有有效的图像，返回空列表
        if not batch_images:
            return io.NodeOutput([], file_data)

        return io.NodeOutput(batch_images, file_data)


class XISPSDLayerExtractorExtension(ComfyExtension):
    async def get_node_list(self):
        return [XIS_PSDLayerExtractorV3]


async def comfy_entrypoint():
    return XISPSDLayerExtractorExtension()