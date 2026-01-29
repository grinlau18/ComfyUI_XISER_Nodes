"""模型管理模块 - 统一本地模型扫描和选项管理"""

import os
import logging
from pathlib import Path
from typing import List, Tuple, Dict, Optional, Set

# Import folder_paths for ComfyUI model directory management
try:
    import folder_paths
    HAS_FOLDER_PATHS = True
except ImportError:
    HAS_FOLDER_PATHS = False

from ..utils import logger

# 模型目录路径
# 使用ComfyUI标准目录：models/LLM 和 models/prompt_generator
MODEL_BASE_DIRS: List[str] = []
MODEL_BASE_DIR: str = ""

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

def initialize_model_dirs() -> None:
    """初始化模型目录列表"""
    global MODEL_BASE_DIRS, MODEL_BASE_DIR
    MODEL_BASE_DIRS = []

    if HAS_FOLDER_PATHS:
        # 获取LLM目录，参考ComfyUI-QwenVL项目的实现
        llm_paths = folder_paths.get_folder_paths("LLM") if "LLM" in folder_paths.folder_names_and_paths else []
        if llm_paths:
            MODEL_BASE_DIRS.append(llm_paths[0])
        else:
            # Fallback to default behavior
            MODEL_BASE_DIRS.append(os.path.join(folder_paths.models_dir, "LLM"))

        # 尝试获取prompt_generator目录
        prompt_gen_paths = folder_paths.get_folder_paths("prompt_generator") if "prompt_generator" in folder_paths.folder_names_and_paths else []
        if prompt_gen_paths:
            MODEL_BASE_DIRS.append(prompt_gen_paths[0])
        else:
            # 添加默认的prompt_generator目录
            MODEL_BASE_DIRS.append(os.path.join(folder_paths.models_dir, "prompt_generator"))
    else:
        # Fallback path if folder_paths not available
        # Try to get from environment variable, otherwise use default location in user's home
        comfyui_path = os.environ.get("COMFYUI_PATH", os.path.expanduser("~/ComfyUI"))
        MODEL_BASE_DIRS.append(os.path.join(comfyui_path, "models", "LLM"))
        MODEL_BASE_DIRS.append(os.path.join(comfyui_path, "models", "prompt_generator"))

    # 保留第一个目录作为默认目录用于显示和下载
    MODEL_BASE_DIR = MODEL_BASE_DIRS[0] if MODEL_BASE_DIRS else ""

    logger.debug(f"Model directories initialized: {MODEL_BASE_DIRS}, default: {MODEL_BASE_DIR}")

# 初始化目录
initialize_model_dirs()

def get_model_dirs() -> List[Path]:
    """获取所有可能的模型目录列表，按搜索顺序排列。

    返回:
        List[Path]: 模型目录路径列表，按优先级排序
    """
    model_dirs = []

    for dir_path in MODEL_BASE_DIRS:
        path = Path(dir_path)
        path.mkdir(parents=True, exist_ok=True)
        model_dirs.append(path)

    return model_dirs

def scan_local_models() -> Tuple[List[str], str]:
    """扫描本地模型目录，返回模型路径列表和默认值

    扫描多个模型目录（MODEL_BASE_DIRS），只扫描本地模型，不支持Hugging Face Hub格式模型。
    参考ComfyUI-QwenVL项目，支持Transformers模型格式。
    """
    try:
        model_paths = []

        for model_base_dir in MODEL_BASE_DIRS:
            # 确保目录存在
            os.makedirs(model_base_dir, exist_ok=True)

            if not os.path.isdir(model_base_dir):
                logger.warning(f"Model directory not found: {model_base_dir}")
                continue

            # 递归查找包含config.json的目录（Transformers模型格式）
            for root, dirs, files in os.walk(model_base_dir):
                if "config.json" in files:
                    # 使用相对路径作为显示路径，但加上目录前缀以区分来源
                    rel_path = os.path.relpath(root, model_base_dir)
                    # 如果rel_path是"."（即根目录本身），跳过
                    if rel_path == ".":
                        continue
                    # 避免重复添加相同的相对路径
                    if rel_path not in model_paths:
                        model_paths.append(rel_path)

        # 只返回本地模型，不添加Hugging Face选项
        if model_paths:
            # 按字母排序，确保一致性
            model_paths.sort()
            return model_paths, model_paths[0]  # 第一个本地模型作为默认
        else:
            logger.debug(f"No local models found in any directory: {MODEL_BASE_DIRS}")
            return [], ""  # 返回空列表，没有默认模型

    except Exception as e:
        logger.error(f"Failed to scan model directories: {e}")
        return [], ""  # 返回空列表，没有默认模型

def get_model_options() -> Tuple[List[str], str, Dict[str, str]]:
    """获取模型选项列表，包括完整Qwen系列模型和本地模型状态

    返回:
        (选项列表, 默认选项, 显示名称到模型ID的映射)
        选项格式: "显示名称 [状态]" 显示名称为不带Qwen/前缀的模型名称
        例如: "Qwen3-VL-8B-Instruct [本地]"
    """
    # 扫描本地模型目录
    local_paths, _ = scan_local_models()

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
        display = display_name  # 不显示状态标记，避免选项列表不一致问题
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

class LocalModelScanner:
    """本地模型扫描器"""

    def __init__(self):
        self.local_paths: List[str] = []
        self.local_paths_set: Set[str] = set()
        self._scan_complete = False

    def scan(self) -> None:
        """执行扫描"""
        self.local_paths, _ = scan_local_models()
        self.local_paths_set = set(self.local_paths)
        self._scan_complete = True

    def is_model_local(self, model_id: str) -> bool:
        """检查模型是否在本地"""
        if not self._scan_complete:
            self.scan()
        return model_id in self.local_paths_set

    def get_local_models(self) -> List[str]:
        """获取本地模型列表"""
        if not self._scan_complete:
            self.scan()
        return self.local_paths.copy()

class ModelOptionsBuilder:
    """模型选项构建器"""

    def __init__(self, model_ids: List[str]):
        self.model_ids = model_ids
        self.scanner = LocalModelScanner()

    def build_options(self) -> Tuple[List[str], str, Dict[str, str]]:
        """构建选项列表"""
        options = []
        default_model_id = None
        display_to_model_id = {}
        model_id_to_display = {}

        for model_id in self.model_ids:
            # 提取显示名称（去掉Qwen/前缀）
            if model_id.startswith("Qwen/"):
                display_name = model_id[5:]  # 去掉"Qwen/"
            else:
                display_name = model_id

            is_local = self.scanner.is_model_local(model_id)
            display = display_name  # 不显示状态标记
            options.append(display)
            display_to_model_id[display] = model_id
            model_id_to_display[model_id] = display

            # 优先选择第一个本地模型作为默认
            if is_local and default_model_id is None:
                default_model_id = model_id

        # 如果没有本地模型，则使用第一个模型作为默认
        if default_model_id is None and self.model_ids:
            default_model_id = self.model_ids[0]

        default_display = model_id_to_display.get(default_model_id, options[0] if options else "")

        return options, default_display, display_to_model_id

# 为Qwen3-VL模型创建默认构建器
QWEN_VL_OPTIONS_BUILDER = ModelOptionsBuilder(QWEN_VL_MODELS)