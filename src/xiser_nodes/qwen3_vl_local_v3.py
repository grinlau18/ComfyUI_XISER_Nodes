"""Qwen3-VL Local Node - V3 version for local vision-language model inference."""

from comfy_api.v0_0_2 import io, ComfyAPISync
from typing import Dict, List, Optional, Any, Tuple
import torch
import os
from comfy_execution.utils import get_executing_context

from .llm.base import _gather_images, _image_to_base64
from .llm.providers_qwen_local import Qwen3VLLocalProvider
from .utils import logger

# Import folder_paths for ComfyUI model directory management
try:
    import folder_paths
    HAS_FOLDER_PATHS = True
except ImportError:
    HAS_FOLDER_PATHS = False
    logger.warning("folder_paths not available, using fallback paths")

# 创建API实例用于进度更新
api_sync = ComfyAPISync()

# 导入模型管理模块
from .llm.model_manager import QWEN_VL_MODELS, QWEN_VL_OPTIONS_BUILDER, MODEL_BASE_DIRS
from .llm.progress_manager import ProgressManager

# 最大图像数量（Qwen3-VL支持最多8张图像）
MAX_IMAGES = 8


# 进度更新函数 - 使用ProgressManager统一处理
def _update_progress(stage: str, progress: float, total_stages: int = 6, node_id: str = ""):
    """更新进度显示 - 兼容旧接口，使用ProgressManager统一处理

    Args:
        stage: 当前阶段描述
        progress: 当前阶段进度 (0-1)
        total_stages: 总阶段数 (已弃用，保留兼容性)
        node_id: 节点ID
    """
    # 使用ProgressManager的统一进度更新
    ProgressManager.update_progress_for_qwen_vl(stage, progress, node_id)


class XIS_QwenVLInferenceV3(io.ComfyNode):
    """Qwen3-VL Local Node - V3 version

    Run Qwen3-VL vision-language model locally using Hugging Face Transformers.
    Supports image understanding and multimodal dialogue.
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点架构"""
        # 获取完整的模型选项列表，包括本地状态标记和映射
        model_options, default_display, display_to_model_id = QWEN_VL_OPTIONS_BUILDER.build_options()
        logger.debug(f"Available models: {len(model_options)}, default: {default_display}")

        # 存储映射供execute方法使用
        cls._model_display_map = display_to_model_id

        return io.Schema(
            node_id="XIS_QwenVLInference",
            display_name="Qwen VL Inference",
            category="XISER_Nodes/LLM",
            description=f"""Run Qwen3-VL vision-language model locally for image understanding and multimodal dialogue.

Features: Local model inference, image captioning, visual question answering, document understanding, OCR, etc.
Supports up to 8 image inputs, complete generation parameter control (temperature, top_p, max_tokens, etc.).
Automatically scans model directories: {', '.join(MODEL_BASE_DIRS)}, supports Qwen3-VL series models.
First-time use may require downloading model weights (approx. 9GB).

Hardware: Automatic GPU/CPU selection, precision control, Flash Attention 2 acceleration.
Generation parameters: temperature (0-2), top_p (0-1), max_tokens (16-16384), etc.
""",
            inputs=[
                io.String.Input(
                    "instruction",
                    default="Describe this image.",
                    multiline=True,
                    tooltip="Input instruction or question (e.g., describe this image, what's in the image?)"
                ),
                io.Image.Input(
                    "image",
                    optional=True,
                    tooltip="Single input image"
                ),
                io.Image.Input(
                    "pack_images",
                    optional=True,
                    tooltip="Multiple input image pack"
                ),
                io.Combo.Input(
                    "model",
                    options=model_options,
                    default=default_display,
                    optional=True,
                    tooltip="Select model: Automatically scans local models (search directories: {', '.join(MODEL_BASE_DIRS)}) or use Hugging Face model ID. If using Hugging Face model ID and not available locally, will automatically download to {os.path.join(MODEL_BASE_DIRS[0], 'organization/model_name')} directory, e.g.: {os.path.join(MODEL_BASE_DIRS[0], 'Qwen/Qwen3-VL-8B-Instruct')}"
                ),
                io.String.Input(
                    "system_prompt",
                    default="You are Qwen3-VL, a helpful vision-language assistant.",
                    multiline=True,
                    optional=True,
                    tooltip="System prompt, defines assistant role"
                ),
                io.Combo.Input(
                    "device",
                    options=["auto", "cuda", "cpu"],
                    default="auto",
                    optional=True,
                    tooltip="Inference device: auto (automatic selection), cuda (GPU), cpu"
                ),
                io.Combo.Input(
                    "dtype",
                    options=["auto", "bfloat16", "float16", "float32"],
                    default="auto",
                    optional=True,
                    tooltip="Model precision: auto (automatic selection), bfloat16 (GPU recommended), float16, float32"
                ),
                io.Boolean.Input(
                    "flash_attention_2",
                    default=False,
                    optional=True,
                    tooltip="Enable Flash Attention 2 acceleration (requires flash-attn library installation)"
                ),
                io.Boolean.Input(
                    "trust_remote_code",
                    default=True,
                    optional=True,
                    tooltip="Trust remote code (required when loading custom models)"
                ),
                io.Float.Input(
                    "temperature",
                    default=0.7,
                    min=0.0,
                    max=2.0,
                    step=0.05,
                    optional=True,
                    tooltip="Temperature parameter, controls randomness (0.0: deterministic, 1.0: standard, 2.0: high randomness)"
                ),
                io.Float.Input(
                    "top_p",
                    default=0.8,
                    min=0.0,
                    max=1.0,
                    step=0.05,
                    optional=True,
                    tooltip="Top-p sampling parameter (nucleus sampling)"
                ),
                io.Int.Input(
                    "max_tokens",
                    default=1024,
                    min=16,
                    max=16384,
                    step=8,
                    optional=True,
                    tooltip="Maximum number of tokens to generate (Qwen3-VL supports long context)"
                ),
                io.Int.Input(
                    "top_k",
                    default=20,
                    min=1,
                    max=100,
                    step=1,
                    optional=True,
                    tooltip="Top-k sampling parameter"
                ),
                io.Float.Input(
                    "repetition_penalty",
                    default=1.0,
                    min=1.0,
                    max=2.0,
                    step=0.05,
                    optional=True,
                    tooltip="Repetition penalty, prevents repetitive generation"
                ),
                io.Float.Input(
                    "presence_penalty",
                    default=1.5,
                    min=1.0,
                    max=2.0,
                    step=0.05,
                    optional=True,
                    tooltip="Presence penalty, encourages generation of new content"
                ),
                io.Int.Input(
                    "seed",
                    default=42,
                    min=-1,
                    max=4294967295,
                    step=1,
                    control_after_generate=True,
                    optional=True,
                    tooltip="Random seed (≥0 for fixed mode, -1 for random)"
                ),
                io.Boolean.Input(
                    "enable_cache",
                    default=True,
                    optional=True,
                    tooltip="Enable model caching to avoid repeated loading"
                ),
            ],
            outputs=[
                io.String.Output("response", display_name="Model Response"),
            ]
        )

    @classmethod
    def execute(
        cls,
        instruction: str,
        image: Optional[torch.Tensor] = None,
        pack_images: Optional[List[torch.Tensor]] = None,
        model: str = "Qwen/Qwen3-VL-8B-Instruct",
        system_prompt: str = "You are Qwen3-VL, a helpful vision-language assistant.",
        device: str = "auto",
        dtype: str = "auto",
        flash_attention_2: bool = False,
        trust_remote_code: bool = True,
        temperature: float = 0.7,
        top_p: float = 0.8,
        max_tokens: int = 1024,
        top_k: int = 20,
        repetition_penalty: float = 1.0,
        presence_penalty: float = 1.5,
        seed: int = 42,
        enable_cache: bool = True,
    ) -> io.NodeOutput:
        """执行Qwen3-VL本地推理"""
        # 获取节点ID用于进度更新
        executing_context = get_executing_context()
        node_id = executing_context.node_id if executing_context else ""

        try:
            # 进度：准备阶段
            _update_progress("准备", 0.1, node_id=node_id)

            # 模型路径处理现在由ensure_model函数处理（在providers_qwen_local.py中）
            # 该函数支持：绝对路径、相对于MODEL_BASE_DIR的路径、Hugging Face模型ID
            # 如果本地不存在，会自动下载（需要huggingface_hub库）

            # 解析模型输入：将显示字符串转换为完整的模型ID
            try:
                # 使用类映射进行转换（如果存在）
                display_map = getattr(cls, "_model_display_map", {})
                if display_map and model in display_map:
                    model_id = display_map[model]
                else:
                    # 映射不存在或输入不在映射中，假定输入已经是完整的模型ID
                    model_id = model
            except Exception as e:
                logger.warning(f"Failed to parse model input, using as-is: {e}")
                model_id = model

            # 记录状态（基于原始输入字符串）
            if "[本地]" in model:
                logger.debug(f"Model {model_id} is available locally")
            elif "[需下载]" in model:
                logger.debug(f"Model {model_id} needs download, will attempt automatic download if enabled")
            else:
                logger.debug(f"Model {model_id} selected")


            # 检查transformers库是否可用
            try:
                from transformers import AutoModelForVision2Seq, AutoProcessor
                import transformers
                # 检查transformers版本
                from packaging import version
                TRANSFORMERS_VERSION = getattr(transformers, "__version__", "0.0.0")
                if version.parse(TRANSFORMERS_VERSION) < version.parse("4.57.0"):
                    return io.NodeOutput(f"""Error: Transformers version {TRANSFORMERS_VERSION} is too old for Qwen3-VL.

Qwen3-VL requires transformers >= 4.57.0. Please upgrade:

1. Install optional 'qwen-vl' dependencies:
   pip install "ComfyUI_XISER_Nodes[qwen-vl]"

2. Or upgrade transformers manually:
   pip install --upgrade transformers>=4.57.0

For full dependency list, see extension documentation.""")
            except ImportError:
                return io.NodeOutput("""Error: Transformers library not available.

Qwen3-VL requires additional dependencies. To install:

1. Install optional 'qwen-vl' dependencies for this extension:
   pip install "ComfyUI_XISER_Nodes[qwen-vl]"

2. Or install dependencies manually:
   pip install transformers>=4.57.0 torch huggingface-hub safetensors accelerate bitsandbytes pillow numpy

For more details, see the extension documentation.""")
            except Exception as e:
                # 可能是版本不兼容或其他导入错误
                return io.NodeOutput(f"""Error: Failed to import Qwen3-VL modules.

Full error: {str(e)}

This may require transformers >= 4.57.0. Please install/upgrade dependencies:

1. Install optional 'qwen-vl' dependencies:
   pip install "ComfyUI_XISER_Nodes[qwen-vl]"

2. Or upgrade manually:
   pip install --upgrade transformers>=4.57.0 torch huggingface-hub safetensors accelerate bitsandbytes

For more details, see the extension documentation.""")

            # 进度：收集图像
            _update_progress("准备", 0.3, node_id=node_id)

            # 收集图像
            gathered = _gather_images(image, pack_images)
            if len(gathered) > MAX_IMAGES:
                gathered = gathered[:MAX_IMAGES]
                logger.warning(f"Too many images ({len(gathered)}), keeping first {MAX_IMAGES}")

            if not gathered and not instruction.strip():
                return io.NodeOutput("Error: at least one image or instruction is required.")

            # 转换图像为Base64
            image_payloads = [_image_to_base64(img) for img in gathered]

            # 进度：数据处理完成
            _update_progress("准备", 0.5, node_id=node_id)

            # 创建提供者实例
            provider = Qwen3VLLocalProvider()

            # 构建覆盖参数
            overrides: Dict[str, Any] = {
                "model_path": model_id,
                "system_prompt": system_prompt,
                "device": device,
                "dtype": dtype,
                "flash_attention_2": flash_attention_2,
                "trust_remote_code": trust_remote_code,
                "temperature": temperature,
                "top_p": top_p,
                "max_new_tokens": max_tokens,
                "top_k": top_k,
                "repetition_penalty": repetition_penalty,
                "presence_penalty": presence_penalty,
                "seed": seed if seed >= 0 else None,
            }

            # 进度：加载模型阶段
            _update_progress("加载模型", 0.1, node_id=node_id)

            # 创建进度回调函数
            def progress_callback(stage: str, progress: float):
                if stage == "准备":
                    _update_progress("加载模型", progress, node_id=node_id)
                elif stage == "连接":
                    _update_progress("处理", progress * 0.5, node_id=node_id)
                elif stage == "处理":
                    _update_progress("推理", progress, node_id=node_id)
                elif stage == "解析":
                    _update_progress("解析", progress, node_id=node_id)
                elif stage == "完成":
                    _update_progress("完成", 1.0, node_id=node_id)

            try:
                # 调用提供者（本地推理）
                # 对于本地提供者，api_key参数不是必需的
                response = provider.invoke(instruction, image_payloads, "", overrides, progress_callback)

                # 提取文本响应
                text = provider.extract_text(response)

                # 进度：完成
                _update_progress("完成", 1.0, node_id=node_id)

                return io.NodeOutput(text or "")

            except Exception as exc:
                logger.error(f"Qwen3-VL local inference failed: {exc}")
                return io.NodeOutput(f"Error: {exc}")

        except Exception as exc:
            logger.error(f"Qwen3-VL node execution error: {exc}")
            return io.NodeOutput(f"Error: {exc}")


# V3节点类列表
V3_NODE_CLASSES = [
    XIS_QwenVLInferenceV3,
]