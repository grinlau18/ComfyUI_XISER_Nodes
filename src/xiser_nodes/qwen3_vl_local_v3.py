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

# 模型目录路径
# 使用ComfyUI标准目录：models/LLM
if HAS_FOLDER_PATHS:
    # 获取LLM目录，参考ComfyUI-QwenVL项目的实现
    llm_paths = folder_paths.get_folder_paths("LLM") if "LLM" in folder_paths.folder_names_and_paths else []
    if llm_paths:
        MODEL_BASE_DIR = llm_paths[0]
    else:
        # Fallback to default behavior
        MODEL_BASE_DIR = os.path.join(folder_paths.models_dir, "LLM")
else:
    # Fallback path if folder_paths not available
    # Try to get from environment variable, otherwise use default location in user's home
    comfyui_path = os.environ.get("COMFYUI_PATH", os.path.expanduser("~/ComfyUI"))
    MODEL_BASE_DIR = os.path.join(comfyui_path, "models", "LLM")

# 完整的Qwen系列视觉模型列表（Hugging Face模型ID）
QWEN_VL_MODELS = [
    "Qwen/Qwen3-VL-2B-Instruct",
    "Qwen/Qwen3-VL-2B-Thinking",
    "Qwen/Qwen3-VL-2B-Instruct-FP8",
    "Qwen/Qwen3-VL-2B-Thinking-FP8",
    "Qwen/Qwen3-VL-4B-Instruct",
    "Qwen/Qwen3-VL-4B-Thinking",
    "Qwen/Qwen3-VL-4B-Instruct-FP8",
    "Qwen/Qwen3-VL-4B-Thinking-FP8",
    "Qwen/Qwen3-VL-8B-Instruct",
    "Qwen/Qwen3-VL-8B-Thinking",
    "Qwen/Qwen3-VL-8B-Instruct-FP8",
    "Qwen/Qwen3-VL-8B-Thinking-FP8",
    "Qwen/Qwen3-VL-32B-Instruct",
    "Qwen/Qwen3-VL-32B-Thinking",
    "Qwen/Qwen3-VL-32B-Instruct-FP8",
    "Qwen/Qwen3-VL-32B-Thinking-FP8",
    "Qwen/Qwen2.5-VL-3B-Instruct",
    "Qwen/Qwen2.5-VL-7B-Instruct",
]

# 最大图像数量（Qwen3-VL支持最多8张图像）
MAX_IMAGES = 8

def _scan_local_models() -> Tuple[List[str], str]:
    """扫描本地模型目录，返回模型路径列表和默认值

    只扫描本地模型，不支持Hugging Face Hub格式模型。
    参考ComfyUI-QwenVL项目，支持Transformers模型格式。
    """
    try:
        # 确保目录存在
        os.makedirs(MODEL_BASE_DIR, exist_ok=True)

        if not os.path.isdir(MODEL_BASE_DIR):
            logger.warning(f"Model directory not found: {MODEL_BASE_DIR}")
            return [], ""  # 返回空列表，没有默认模型

        # 递归查找包含config.json的目录（Transformers模型格式）
        model_paths = []
        for root, dirs, files in os.walk(MODEL_BASE_DIR):
            if "config.json" in files:
                # 使用相对路径作为显示路径
                rel_path = os.path.relpath(root, MODEL_BASE_DIR)
                model_paths.append(rel_path)

        # 只返回本地模型，不添加Hugging Face选项
        if model_paths:
            # 按字母排序，确保一致性
            model_paths.sort()
            return model_paths, model_paths[0]  # 第一个本地模型作为默认
        else:
            logger.debug(f"No local models found in {MODEL_BASE_DIR}")
            return [], ""  # 返回空列表，没有默认模型

    except Exception as e:
        logger.error(f"Failed to scan model directory: {e}")
        return [], ""  # 返回空列表，没有默认模型


def _get_model_options() -> Tuple[List[str], str, Dict[str, str]]:
    """获取模型选项列表，包括完整Qwen系列模型和本地模型状态

    返回:
        (选项列表, 默认选项, 显示名称到模型ID的映射)
        选项格式: "显示名称 [状态]" 显示名称为不带Qwen/前缀的模型名称
        例如: "Qwen3-VL-8B-Instruct [本地]"
    """
    # 扫描本地模型目录
    local_paths, _ = _scan_local_models()

    # 构建本地模型路径集合，用于快速检查
    local_paths_set = set(local_paths)

    options = []
    default_model_id = None
    display_to_model_id = {}
    model_id_to_display = {}

    for model_id in QWEN_VL_MODELS:
        # 提取显示名称（去掉Qwen/前缀）
        if model_id.startswith("Qwen/"):
            display_name = model_id[5:]  # 去掉"Qwen/"
        else:
            display_name = model_id

        # 检查是否为本地模型：检查完整模型ID路径是否在本地路径中
        # 例如：Qwen/Qwen3-VL-8B-Instruct 对应本地路径 Qwen/Qwen3-VL-8B-Instruct
        is_local = model_id in local_paths_set
        status = "[本地]" if is_local else "[需下载]"
        display = f"{display_name} {status}"
        options.append(display)
        display_to_model_id[display] = model_id
        model_id_to_display[model_id] = display

        # 优先选择第一个本地模型作为默认
        if is_local and default_model_id is None:
            default_model_id = model_id

    # 如果没有本地模型，则使用第一个模型作为默认
    if default_model_id is None and QWEN_VL_MODELS:
        default_model_id = QWEN_VL_MODELS[0]

    # 获取默认选项字符串
    default_display = model_id_to_display.get(default_model_id, options[0] if options else "")

    return options, default_display, display_to_model_id




# 进度阶段映射
_STAGE_INDEX = {"准备": 0, "加载模型": 1, "处理": 2, "推理": 3, "解析": 4, "完成": 5}

def _update_progress(stage: str, progress: float, total_stages: int = 6, node_id: str = ""):
    """更新进度显示

    Args:
        stage: 当前阶段描述
        progress: 当前阶段进度 (0-1)
        total_stages: 总阶段数
        node_id: 节点ID
    """
    try:
        # 阶段映射到索引
        stage_index = _STAGE_INDEX.get(stage, 0)

        # 计算整体进度
        base_progress = (stage_index / total_stages) * 100
        stage_progress = progress * (100 / total_stages)
        total_progress = min(base_progress + stage_progress, 100)

        # 更新进度
        api_sync.execution.set_progress(
            value=total_progress,
            max_value=100.0,
            node_id=node_id
        )
    except Exception as e:
        # 进度更新失败不影响主要功能
        logger.debug(f"进度更新失败: {e}")


class XIS_QwenVLInferenceV3(io.ComfyNode):
    """Qwen3-VL Local Node - V3版本

    使用Hugging Face Transformers在本地运行Qwen3-VL视觉语言模型。
    支持图像理解和多模态对话。
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点架构"""
        # 获取完整的模型选项列表，包括本地状态标记和映射
        model_options, default_display, display_to_model_id = _get_model_options()
        logger.debug(f"Available models: {len(model_options)}, default: {default_display}")

        # 存储映射供execute方法使用
        cls._model_display_map = display_to_model_id

        return io.Schema(
            node_id="XIS_QwenVLInference",
            display_name="Qwen VL Inference",
            category="XISER_Nodes/LLM",
            description=f"""本地运行Qwen3-VL视觉语言模型进行图像理解和多模态对话。

功能：本地模型推理、图像描述、视觉问答、文档理解、OCR等。
支持最多8张图像输入，完整的生成参数控制（temperature, top_p, max_tokens等）。
自动扫描模型目录：{MODEL_BASE_DIR}，支持Qwen3-VL系列模型。
首次使用可能需要下载模型权重（约9GB）。

硬件：自动GPU/CPU选择，精度控制，Flash Attention 2加速。
生成参数：temperature（0-2）、top_p（0-1）、max_tokens（16-16384）等。
""",
            inputs=[
                io.String.Input(
                    "instruction",
                    default="Describe this image.",
                    multiline=True,
                    tooltip="输入指令或问题（例如：描述这张图片、图像里有什么？）"
                ),
                io.Image.Input(
                    "image",
                    optional=True,
                    tooltip="单张输入图像"
                ),
                io.Image.Input(
                    "pack_images",
                    optional=True,
                    tooltip="多张输入图像包"
                ),
                io.Combo.Input(
                    "model",
                    options=model_options,
                    default=default_display,
                    optional=True,
                    tooltip="选择模型：自动扫描本地模型或使用Hugging Face模型ID。如果使用Hugging Face模型ID且本地不存在，会自动下载到{os.path.join(MODEL_BASE_DIR, '组织名称/模型名称')}目录，例如：{os.path.join(MODEL_BASE_DIR, 'Qwen/Qwen3-VL-8B-Instruct')}"
                ),
                io.String.Input(
                    "system_prompt",
                    default="You are Qwen3-VL, a helpful vision-language assistant.",
                    multiline=True,
                    optional=True,
                    tooltip="系统提示词，定义助手角色"
                ),
                io.Combo.Input(
                    "device",
                    options=["auto", "cuda", "cpu"],
                    default="auto",
                    optional=True,
                    tooltip="推理设备：auto（自动选择）、cuda（GPU）、cpu"
                ),
                io.Combo.Input(
                    "dtype",
                    options=["auto", "bfloat16", "float16", "float32"],
                    default="auto",
                    optional=True,
                    tooltip="模型精度：auto（自动选择）、bfloat16（GPU推荐）、float16、float32"
                ),
                io.Boolean.Input(
                    "flash_attention_2",
                    default=False,
                    optional=True,
                    tooltip="启用Flash Attention 2加速（需要安装flash-attn库）"
                ),
                io.Boolean.Input(
                    "trust_remote_code",
                    default=True,
                    optional=True,
                    tooltip="信任远程代码（加载自定义模型时需要）"
                ),
                io.Float.Input(
                    "temperature",
                    default=0.7,
                    min=0.0,
                    max=2.0,
                    step=0.05,
                    optional=True,
                    tooltip="温度参数，控制随机性（0.0: 确定性，1.0: 标准，2.0: 高随机性）"
                ),
                io.Float.Input(
                    "top_p",
                    default=0.8,
                    min=0.0,
                    max=1.0,
                    step=0.05,
                    optional=True,
                    tooltip="Top-p采样参数（核采样）"
                ),
                io.Int.Input(
                    "max_tokens",
                    default=1024,
                    min=16,
                    max=16384,
                    step=8,
                    optional=True,
                    tooltip="最大生成token数（Qwen3-VL支持长上下文）"
                ),
                io.Int.Input(
                    "top_k",
                    default=20,
                    min=1,
                    max=100,
                    step=1,
                    optional=True,
                    tooltip="Top-k采样参数"
                ),
                io.Float.Input(
                    "repetition_penalty",
                    default=1.0,
                    min=1.0,
                    max=2.0,
                    step=0.05,
                    optional=True,
                    tooltip="重复惩罚，防止重复生成"
                ),
                io.Float.Input(
                    "presence_penalty",
                    default=1.5,
                    min=1.0,
                    max=2.0,
                    step=0.05,
                    optional=True,
                    tooltip="存在惩罚，鼓励生成新内容"
                ),
                io.Int.Input(
                    "seed",
                    default=42,
                    min=-1,
                    max=4294967295,
                    step=1,
                    control_after_generate=True,
                    optional=True,
                    tooltip="随机种子（≥0为固定模式，-1为随机）"
                ),
                io.Boolean.Input(
                    "enable_cache",
                    default=True,
                    optional=True,
                    tooltip="启用模型缓存，避免重复加载"
                ),
            ],
            outputs=[
                io.String.Output("response", display_name="模型响应"),
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