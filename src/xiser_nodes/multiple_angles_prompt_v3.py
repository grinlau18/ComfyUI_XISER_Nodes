"""
XIS_MultipleAnglesPrompt - V3版本

自定义节点，通过设置摄像机参数生成对应的提示词，支持图像预览和实时镜头角度预览。
基于可视化相机提示词HTML页面功能。
"""

from typing import Dict, Any, Optional
import torch

from comfy_api.latest import io, ui
from comfy_api.latest._io import FolderType


class XIS_MultipleAnglesPromptV3(io.ComfyNode):
    """
    通过摄像机参数生成提示词的自定义节点。
    提供图像输入接口来替换图片上传功能，提供prompt输出端口。
    通过three.js实现前端实时预览，提供滑块控件控制相机角度。
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        """
        定义节点的输入输出类型 - V3架构。
        """
        return io.Schema(
            node_id="XIS_MultipleAnglesPrompt",
            display_name="Multiple Angles Prompt",
            category="XISER_Nodes/Visual_Editing",
            description="通过摄像机参数生成提示词，支持图像预览和实时镜头角度预览。",
            inputs=[
                io.Image.Input("image",
                             optional=True,
                             tooltip="可选图像输入，用于3D预览中的参考模型"),
                io.Custom("WIDGET").Input("camera_preview",
                                        tooltip="3D相机预览和交互控件")
            ],
            outputs=[
                io.String.Output(display_name="prompt")
            ],
            is_output_node=True
        )

    @staticmethod
    def _ensure_batched_images(images: torch.Tensor) -> torch.Tensor:
        """Normalize images into a batched tensor."""
        if images is None:
            return None
        if isinstance(images, torch.Tensor):
            if images.dim() == 3:
                return images.unsqueeze(0)  # Add batch dimension
            return images
        # If it's a list or other type, try to convert to tensor
        # For simplicity, assume it's already a tensor
        return images

    @classmethod
    def execute(cls, image: Optional[Any] = None,
                camera_preview: Optional[Dict[str, Any]] = None) -> io.NodeOutput:
        """
        执行节点，输出生成的提示词。

        Args:
            image: 可选图像输入，用于预览
            camera_preview: 相机预览widget数据，包含azimuth、elevation、distance和prompt字段

        Returns:
            io.NodeOutput: 生成的提示词字符串
        """
        # 从widget数据中提取参数和提示词
        prompt = ""
        azimuth = 0.0
        elevation = 0.0
        distance = 1.0

        if camera_preview:
            # 处理可能为JSON字符串的情况
            if isinstance(camera_preview, str):
                try:
                    import json
                    camera_preview = json.loads(camera_preview)
                except:
                    camera_preview = None

            if isinstance(camera_preview, dict):
                # 提取参数
                azimuth = camera_preview.get("azimuth", 0.0)
                elevation = camera_preview.get("elevation", 0.0)
                distance = camera_preview.get("distance", 1.0)
                prompt = camera_preview.get("prompt", "")

        # 如果widget没有提供提示词，则根据参数生成
        if not prompt:
            # 映射角度到预设描述
            azimuth_desc = cls._get_azimuth_description(azimuth)
            elevation_desc = cls._get_elevation_description(elevation)
            distance_desc = cls._get_distance_description(distance)
            prompt = f"<sks> {azimuth_desc} {elevation_desc} {distance_desc}"

        # 处理图像预览
        ui_data = {}
        if image is not None:
            try:
                # 规范化图像张量
                batched_image = cls._ensure_batched_images(image)
                if batched_image is not None:
                    # 保存图像为临时文件
                    preview_results = ui.ImageSaveHelper.save_images(
                        batched_image,
                        filename_prefix="multiple_angles_preview",
                        folder_type=FolderType.temp,
                        cls=cls,
                        compress_level=1,
                    )
                    # 将预览结果添加到UI数据
                    ui_data["xiser_images"] = preview_results
            except Exception as e:
                # 如果图像处理失败，记录错误但继续执行
                print(f"[XIS_MultipleAnglesPrompt] 图像预览处理失败: {e}")
                # 不添加UI数据

        return io.NodeOutput(prompt, ui=ui_data if ui_data else None)

    @classmethod
    def _get_azimuth_description(cls, azimuth: float) -> str:
        """根据水平角度获取描述"""
        # 找到最近的预设角度
        presets = [-180, -135, -90, -45, 0, 45, 90, 135, 180]
        nearest = min(presets, key=lambda x: min(abs(x - azimuth), 360 - abs(x - azimuth)))

        mapping = {
            -180: "back view",
            -135: "back-left quarter view",
            -90: "left side view",
            -45: "front-left quarter view",
            0: "front view",
            45: "front-right quarter view",
            90: "right side view",
            135: "back-right quarter view",
            180: "back view"
        }
        return mapping.get(nearest, "front view")

    @classmethod
    def _get_elevation_description(cls, elevation: float) -> str:
        """根据仰角获取描述"""
        presets = [-30, 0, 30, 60]
        nearest = min(presets, key=lambda x: abs(x - elevation))

        mapping = {
            -30: "low-angle shot",
            0: "eye-level shot",
            30: "elevated shot",
            60: "high-angle shot"
        }
        return mapping.get(nearest, "eye-level shot")

    @classmethod
    def _get_distance_description(cls, distance: float) -> str:
        """根据距离获取描述"""
        presets = [0.6, 1.0, 1.8]
        nearest = min(presets, key=lambda x: abs(x - distance))

        mapping = {
            0.6: "close-up",
            1.0: "medium shot",
            1.8: "wide shot"
        }
        return mapping.get(nearest, "medium shot")


# V3节点导出
V3_NODE_CLASSES = [XIS_MultipleAnglesPromptV3]