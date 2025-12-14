"""
Image preview node with optional saving and Vue-powered UI layout hints.
"""

from __future__ import annotations

import os
from typing import Iterable, List, Sequence

import torch
from comfy_api.latest import io, ui, ComfyExtension
from comfy_api.latest._io import FolderType


def _ensure_batched_images(images: torch.Tensor | Sequence[torch.Tensor] | None) -> torch.Tensor | Sequence[torch.Tensor]:
    """Normalize images into a batched collection without altering data."""
    if images is None:
        return []
    if isinstance(images, torch.Tensor):
        return images.unsqueeze(0) if images.dim() == 3 else images
    return images


def _to_image_list(images: torch.Tensor | Sequence[torch.Tensor] | None) -> List[torch.Tensor]:
    """Convert image data to a plain list for output wiring."""
    if images is None:
        return []
    if isinstance(images, torch.Tensor):
        return list(images)
    if isinstance(images, Iterable):
        return list(images)
    return [images]  # Fallback


class XIS_ImagePreview(io.ComfyNode):
    """Preview images with optional disk save and UI layout selection."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="XIS_ImagePreview",
            display_name="XIS Image Preview",
            category="XISER_Nodes/Image_And_Mask",
            enable_expand=True,
            inputs=[
                io.Image.Input("images"),
                io.Boolean.Input("save_images", default=False, optional=True, tooltip="Save images to the output directory"),
                io.String.Input("save_prefix", default="XIS_Preview", optional=True, tooltip="Prefix or subfolder/prefix under /output"),
            ],
            outputs=[],
            is_output_node=True,
            description="Preview images with optional saving and a Vue UI that can switch between paged and grid layouts.",
        )

    @classmethod
    def execute(cls, images, save_images=False, save_prefix="XIS_Preview"):
        batched_images = _ensure_batched_images(images)
        image_list = _to_image_list(batched_images)

        if not image_list:
            return io.NodeOutput([], [], ui=None)

        # Build save prefix with optional subfolder support
        safe_prefix = save_prefix.strip() or "XIS_Preview"
        safe_prefix = safe_prefix.replace("\\", "/")
        safe_prefix = safe_prefix.lstrip("/")

        # 生成临时预览文件但不用默认 PreviewImage key，避免前端默认预览
        # 尝试禁用预览生成
        preview_results = ui.ImageSaveHelper.save_images(
            batched_images,
            filename_prefix="ComfyUI_temp_preview",
            folder_type=FolderType.temp,
            cls=cls,
            compress_level=1,
        )
        if save_images:
            save_ui = ui.ImageSaveHelper.get_save_images_ui(batched_images, filename_prefix=safe_prefix, cls=cls)  # type: ignore[attr-defined]
            # 保存文件但不返回路径
            _ = [
                os.path.join(result.subfolder, result.filename) if result.subfolder else result.filename
                for result in save_ui.results
            ]

        # 自定义 UI 字段，前端读取 xiser_images，默认预览不会触发
        # 同时设置 images 和 animated 为空数组，防止默认预览机制触发
        custom_ui = {"xiser_images": preview_results, "images": [], "animated": []}

        return io.NodeOutput(ui=custom_ui)


class XISImagePreviewExtension(ComfyExtension):
    async def get_node_list(self):
        return [XIS_ImagePreview]


async def comfy_entrypoint():
    return XISImagePreviewExtension()


NODE_CLASS_MAPPINGS = None
NODE_DISPLAY_NAME_MAPPINGS = None
