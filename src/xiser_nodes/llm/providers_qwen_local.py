"""Local Qwen3-VL provider implementations."""

from __future__ import annotations

import os
import warnings
import sys
from typing import Any, Dict, List, Optional, Tuple, Union
from pathlib import Path

import torch
from PIL import Image
import numpy as np

from .base import (
    BaseLLMProvider,
    LLMProviderConfig,
    _gather_images,
    _image_to_base64,
    _download_image_to_tensor,
    _image_to_data_url_from_b64,
)
from ..utils import logger
from .model_manager import get_model_dirs as get_model_dirs_from_manager

# Import folder_paths for ComfyUI model directory management
try:
    import folder_paths
    HAS_FOLDER_PATHS = True
except ImportError:
    HAS_FOLDER_PATHS = False
    logger.warning("folder_paths not available, using fallback paths")

# Import huggingface_hub for model downloading
try:
    from huggingface_hub import snapshot_download
    HAS_HUGGINGFACE_HUB = True
except ImportError:
    HAS_HUGGINGFACE_HUB = False
    logger.warning("huggingface_hub not available, model downloading disabled")

# Try to import tqdm for download progress display
try:
    from tqdm.auto import tqdm
    HAS_TQDM = True
except ImportError:
    HAS_TQDM = False
    logger.debug("tqdm not available, download progress will not be displayed")

# Import requests for handling network errors
try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False
    logger.warning("requests library not available")

# Hugging Face mirror support
HF_MIRRORS = {
    "hf-mirror.com": "https://hf-mirror.com",
    "huggingface.co": "https://huggingface.co",
}
HF_ENDPOINTS = [
    "https://huggingface.co",  # Original endpoint
    "https://hf-mirror.com",   # Chinese mirror
]

# Try to import transformers, but make it optional
try:
    from transformers import AutoModelForVision2Seq, AutoProcessor, AutoTokenizer
    import transformers
    # Check transformers version for Qwen3-VL support
    TRANSFORMERS_VERSION = getattr(transformers, "__version__", "0.0.0")
    # Qwen3-VL requires transformers >= 4.57.0
    from packaging import version
    if version.parse(TRANSFORMERS_VERSION) < version.parse("4.57.0"):
        logger.warning(f"Transformers version {TRANSFORMERS_VERSION} is too old for Qwen3-VL. Need >=4.57.0")
        TRANSFORMERS_AVAILABLE = False
    else:
        TRANSFORMERS_AVAILABLE = True
except ImportError:
    TRANSFORMERS_AVAILABLE = False
    logger.warning("Transformers library not available. Qwen3-VL local provider will not work.")
except Exception as e:
    TRANSFORMERS_AVAILABLE = False
    logger.warning(f"Failed to import Qwen3-VL modules from transformers: {e}. Qwen3-VL local provider will not work.")


def get_model_dirs() -> List[Path]:
    """获取所有可能的模型目录列表，按搜索顺序排列。

    返回:
        List[Path]: 模型目录路径列表，按优先级排序
    """
    # 使用统一的模型管理器获取目录
    return get_model_dirs_from_manager()


def check_model_dir(dir_path: Path) -> bool:
    """检查目录是否包含有效的模型文件"""
    if dir_path.exists() and dir_path.is_dir():
        has_weights = any(dir_path.glob("*.safetensors")) or any(dir_path.glob("*.bin"))
        if has_weights and os.path.exists(dir_path / "config.json"):
            logger.debug(f"Valid model found at: {dir_path}")
            return True
    return False


def find_model_in_dirs(model_id: str, model_dirs: List[Path]) -> Optional[Path]:
    """在多个目录中查找模型

    Args:
        model_id: 模型ID或相对路径
        model_dirs: 搜索目录列表

    Returns:
        Optional[Path]: 找到的模型路径，如果未找到则返回None
    """
    for model_dir in model_dirs:
        if "/" in model_id:
            # 创建完整路径，包括组织名称
            target_dir = model_dir / model_id
        else:
            # 可能是本地模型相对路径（不含组织前缀）
            target_dir = model_dir / model_id

        if check_model_dir(target_dir):
            logger.debug(f"Found model at: {target_dir}")
            return target_dir

    return None


def download_with_mirror_fallback(repo_id: str, target_dir: Path) -> str:
    """下载模型，支持镜像回退

    先尝试使用原始Hugging Face地址，如果失败则尝试使用国内镜像。
    每个endpoint最多重试3次，重试间隔逐渐增加。

    Args:
        repo_id: 模型ID，如"Qwen/Qwen3-VL-8B-Instruct"
        target_dir: 目标目录

    Returns:
        本地模型目录路径
    """
    last_error = None
    last_endpoint = None

    # 下载配置
    max_retries = 3  # 每个endpoint最大重试次数
    base_retry_delay = 5  # 基础重试延迟（秒）
    timeout = 300.0  # 超时时间（秒）

    # 检查用户是否已经设置了HF_ENDPOINT
    user_endpoint = os.environ.get("HF_ENDPOINT")
    endpoints_to_try = []

    if user_endpoint:
        # 用户已经设置了endpoint，只尝试用户设置的
        logger.info(f"User has set HF_ENDPOINT={user_endpoint}, using user's endpoint")
        endpoints_to_try = [user_endpoint]
    else:
        # 用户没有设置endpoint，尝试所有endpoint
        endpoints_to_try = HF_ENDPOINTS
        logger.info(f"No user HF_ENDPOINT set, will try all endpoints: {endpoints_to_try}")

    for endpoint in endpoints_to_try:
        # 为当前endpoint尝试多次重试
        retry_count = 0
        endpoint_success = False

        while retry_count < max_retries and not endpoint_success:
            try:
                if retry_count > 0:
                    logger.info(f"Retry {retry_count}/{max_retries} for endpoint {endpoint}")
                    # 计算指数退避延迟
                    delay = base_retry_delay * (2 ** (retry_count - 1))
                    logger.info(f"Waiting {delay} seconds before retry...")
                    import time
                    time.sleep(delay)

                logger.info(f"Attempting to download from endpoint: {endpoint} (attempt {retry_count + 1}/{max_retries})")
                logger.info(f"Downloading {repo_id} to {target_dir}")

                # 设置环境变量以使用特定的endpoint
                original_env = os.environ.get("HF_ENDPOINT")
                os.environ["HF_ENDPOINT"] = endpoint

                try:
                    download_kwargs = {
                        "repo_id": repo_id,
                        "local_dir": str(target_dir),
                        "local_dir_use_symlinks": False,
                        "ignore_patterns": ["*.md", ".git*", "*.txt"],
                        "timeout": timeout,  # 使用配置的超时时间
                        "resume_download": True,  # 启用断点续传
                        "max_workers": 1,  # 设置为1以减少内存使用，避免崩溃
                    }

                    # 添加进度条显示如果tqdm可用
                    if HAS_TQDM:
                        download_kwargs["tqdm_class"] = tqdm
                        logger.info("Download progress will be displayed with tqdm")

                    snapshot_download(**download_kwargs)
                    logger.info(f"Successfully downloaded from {endpoint} on attempt {retry_count + 1}")
                    logger.debug(f"Model downloaded successfully to: {target_dir}")

                    # 恢复原始环境变量
                    if original_env is not None:
                        os.environ["HF_ENDPOINT"] = original_env
                    else:
                        os.environ.pop("HF_ENDPOINT", None)

                    endpoint_success = True
                    return str(target_dir)
                finally:
                    # 确保环境变量被恢复
                    if original_env is not None:
                        os.environ["HF_ENDPOINT"] = original_env
                    else:
                        os.environ.pop("HF_ENDPOINT", None)

            except Exception as e:
                retry_count += 1
                last_error = e
                last_endpoint = endpoint

                if retry_count < max_retries:
                    logger.warning(f"Attempt {retry_count} failed for endpoint {endpoint}: {e}")
                    # 继续重试
                else:
                    logger.warning(f"All {max_retries} attempts failed for endpoint {endpoint}: {e}")
                    # 跳出循环，尝试下一个endpoint

        # 如果当前endpoint成功，已经返回。如果失败，继续下一个endpoint

    # 所有endpoint都失败了
    if last_error is not None:
        # 提供详细的错误信息
        error_msg = f"Failed to download model {repo_id} from all endpoints after {max_retries} retries per endpoint.\n\n"

        # 检查是否为网络错误
        network_errors = ["timeout", "Timeout", "connection", "Connection", "network", "Network"]
        if any(err in str(last_error) for err in network_errors):
            error_msg += "Network error detected. This could be due to:\n"
            error_msg += "1. Slow or unstable internet connection\n"
            error_msg += "2. Firewall or proxy blocking the connection\n"
            error_msg += "3. Hugging Face servers being temporarily unavailable\n\n"

        error_msg += f"Tried endpoints (each retried {max_retries} times):\n"
        for endpoint in endpoints_to_try:
            error_msg += f"  - {endpoint}\n"
        error_msg += "\n"

        # 针对国内用户的建议
        if "hf-mirror.com" in endpoints_to_try:
            error_msg += "For users in China:\n"
            error_msg += "1. The system automatically tried the Chinese mirror (hf-mirror.com)\n"
            error_msg += "2. If both endpoints failed, please check your network connection\n"
            error_msg += "3. You can also try setting the HF_ENDPOINT environment variable manually:\n"
            error_msg += "   - export HF_ENDPOINT=https://hf-mirror.com\n"
            error_msg += "\n"

        error_msg += "Suggested solutions:\n"
        error_msg += "1. Check your internet connection and try again\n"
        error_msg += "2. Use a VPN if you're in a region with restricted access\n"
        error_msg += "3. Download the model manually:\n"
        error_msg += f"   - Visit: https://huggingface.co/{repo_id} or https://hf-mirror.com/{repo_id}\n"
        error_msg += f"   - Download the model files to: {target_dir}\n"
        error_msg += "   - Required files: config.json, *.safetensors or *.bin files\n"
        error_msg += "4. Try using a smaller model (e.g., Qwen3-VL-2B-Instruct)\n\n"
        error_msg += f"Last error from {last_endpoint}: {str(last_error)}"

        raise RuntimeError(error_msg)
    else:
        raise RuntimeError(f"Failed to download model {repo_id} from all endpoints")


def ensure_model(model_id: str) -> str:
    """确保模型存在，如果本地没有则下载

    参考ComfyUI-QwenVL项目的ensure_model函数实现。
    模型下载到ComfyUI标准目录：models/LLM/{完整模型ID路径}
    支持从多个目录（LLM、prompt_generator）查找模型。

    Args:
        model_id: Hugging Face模型ID（如"Qwen/Qwen3-VL-8B-Instruct"）或本地模型路径

    Returns:
        本地模型目录路径
    """
    # 如果是绝对路径且存在，直接返回
    if os.path.isabs(model_id) and os.path.isdir(model_id):
        if os.path.exists(os.path.join(model_id, "config.json")):
            logger.debug(f"Using existing local model at: {model_id}")
            return model_id

    # 获取所有可能的模型目录
    model_dirs = get_model_dirs()
    if not model_dirs:
        raise ValueError("No model directories configured")

    # 首先尝试在所有目录中查找现有模型
    found_dir = find_model_in_dirs(model_id, model_dirs)
    if found_dir:
        return str(found_dir)

    # 如果没有找到模型且支持下载，从Hugging Face下载
    if HAS_HUGGINGFACE_HUB and "/" in model_id:
        # 使用第一个目录作为默认下载目录
        download_dir = model_dirs[0]
        if "/" in model_id:
            # 创建完整路径，包括组织名称
            target_dir = download_dir / model_id
        else:
            # 可能是本地模型相对路径（不含组织前缀）
            target_dir = download_dir / model_id

        logger.debug(f"Downloading model {model_id} to {target_dir}")
        # 确保目标目录的父目录存在（例如Qwen目录）
        target_dir.parent.mkdir(parents=True, exist_ok=True)

        # 使用镜像回退下载
        return download_with_mirror_fallback(model_id, target_dir)
    else:
        # 不支持下载或不是Hugging Face模型ID
        # 在所有目录中检查是否存在
        for model_dir in model_dirs:
            if "/" in model_id:
                target_dir = model_dir / model_id
            else:
                target_dir = model_dir / model_id

            if target_dir.exists():
                return str(target_dir)

        # 如果没有任何目录存在，报告第一个目录的错误
        target_dir = model_dirs[0] / model_id
        raise ValueError(f"Model directory not found in any location. "
                       f"Expected at: {target_dir} or other directories. "
                       f"Please download the model manually or "
                       f"install huggingface_hub for automatic downloading.")


class Qwen3VLLocalProvider(BaseLLMProvider):
    """Qwen3-VL local provider for running models locally via transformers."""

    def __init__(self):
        super().__init__(
            LLMProviderConfig(
                name="qwen3-vl-local",
                label="Qwen3-VL Local",
                endpoint="",  # Not used for local provider
                model="Qwen/Qwen3-VL-8B-Instruct",  # Default model ID
                default_system_prompt="You are Qwen3-VL, a helpful vision-language assistant.",
                timeout=300,  # Longer timeout for local inference
                max_images=8,
                default_params={
                    "temperature": 0.7,
                    "top_p": 0.8,
                    "max_new_tokens": 1024,
                },
                extra_headers={},
                request_format="transformers_local",  # Custom format for local inference
            )
        )
        self._model = None
        self._processor = None
        self._device = None
        self._dtype = None
        self._current_model_path = None
        self._flash_attention_2 = False

    def build_payload(
        self, user_prompt: str, image_payloads: List[str], overrides: Dict[str, Any]
    ) -> Tuple[str, Dict[str, Any], Dict[str, str]]:
        """Build payload for local inference.

        For local provider, we return a special endpoint and payload containing
        all necessary information for local inference.
        """
        # Extract parameters from overrides
        model_path = overrides.get("model_path", self.config.model)
        system_prompt = overrides.get("system_prompt", self.config.default_system_prompt)
        temperature = overrides.get("temperature", self.config.default_params.get("temperature", 0.7))
        top_p = overrides.get("top_p", self.config.default_params.get("top_p", 0.8))
        max_new_tokens = overrides.get("max_new_tokens", self.config.default_params.get("max_new_tokens", 1024))
        top_k = overrides.get("top_k", 20)
        repetition_penalty = overrides.get("repetition_penalty", 1.0)
        presence_penalty = overrides.get("presence_penalty", 1.5)
        seed = overrides.get("seed")

        # Model loading parameters
        device = overrides.get("device", "auto")
        dtype = overrides.get("dtype", "auto")
        flash_attention_2 = overrides.get("flash_attention_2", False)
        trust_remote_code = overrides.get("trust_remote_code", True)

        # Build messages in Qwen3-VL format
        # Following the exact format from Qwen3-VL documentation
        messages = []

        # Build content list with images and text
        content: List[Dict[str, Any]] = []

        # Add images first (as in the documentation example)
        for encoded in image_payloads:
            # Convert base64 to data URL format (compatible with Qwen3-VL processor)
            content.append({"type": "image", "image": f"data:image/png;base64,{encoded}"})

        # Combine system prompt with user prompt if system prompt is provided
        full_text = user_prompt.strip()
        if system_prompt and system_prompt.strip():
            # Prepend system prompt to user prompt
            full_text = f"{system_prompt.strip()}\n\n{full_text}"

        # Add combined text
        if full_text:
            content.append({"type": "text", "text": full_text})
        else:
            raise ValueError("Instruction cannot be empty when sending images to Qwen3-VL.")

        # Create user message with all content (following documentation example)
        messages.append({"role": "user", "content": content})

        payload: Dict[str, Any] = {
            "model_path": model_path,
            "messages": messages,
            "generation_config": {
                "temperature": temperature,
                "top_p": top_p,
                "max_new_tokens": max_new_tokens,
                "top_k": top_k,
                "repetition_penalty": repetition_penalty,
                "presence_penalty": presence_penalty,
            },
            "model_loading": {
                "device": device,
                "dtype": dtype,
                "flash_attention_2": flash_attention_2,
                "trust_remote_code": trust_remote_code,
            },
        }
        if seed is not None and seed >= 0:
            payload["generation_config"]["seed"] = int(seed)

        # Return a special endpoint identifier for local inference
        return "local://qwen3-vl", payload, {}

    def invoke(self, user_prompt: str, image_payloads: List[str], api_key: str, overrides: Optional[Dict[str, Any]] = None, progress_callback: Optional[callable] = None) -> Dict[str, Any]:
        """Invoke local Qwen3-VL model.

        Overrides the base invoke method to perform local inference instead of HTTP request.
        """
        if not TRANSFORMERS_AVAILABLE:
            return {"error": """Qwen3-VL requires transformers >= 4.57.0 and additional dependencies.

To install the required dependencies, use one of these methods:

1. Install the optional 'qwen-vl' dependencies for this extension:
   pip install "ComfyUI_XISER_Nodes[qwen-vl]"

2. Or install dependencies manually:
   pip install transformers>=4.57.0 torch huggingface-hub safetensors accelerate bitsandbytes pillow numpy

Note: If you already have transformers installed but version < 4.57.0, upgrade it:
   pip install --upgrade transformers>=4.57.0

For more details, see the extension documentation."""}

        overrides = overrides or {}

        # Build payload (contains all inference parameters)
        endpoint, payload, extra_headers = self.build_payload(user_prompt, image_payloads, overrides)

        # Progress: loading model
        if progress_callback:
            progress_callback("准备", 0.2)

        # Load or get cached model
        try:
            model, processor = self._load_model(payload["model_loading"], payload["model_path"])
        except Exception as e:
            logger.error(f"Failed to load Qwen3-VL model: {e}")
            return {"error": f"Failed to load model: {str(e)}"}

        # Progress: model loaded
        if progress_callback:
            progress_callback("准备", 0.5)

        # Prepare inputs for inference
        try:
            # Prepare messages for processor (images are already encoded as data URLs in messages)
            messages = payload["messages"]

            # Debug: log messages content (without full base64 data)
            def simplify_for_log(obj):
                """Create a simplified version of messages for logging."""
                if isinstance(obj, dict):
                    simplified = {}
                    for key, value in obj.items():
                        if key == "image" and isinstance(value, str) and value.startswith("data:image/png;base64,"):
                            # Truncate base64 string for logging
                            truncated = value[:50] + "..." if len(value) > 50 else value
                            simplified[key] = f"[BASE64_IMAGE_TRUNCATED: {len(value)} chars]"
                        elif key == "content" and isinstance(value, list):
                            # Recursively simplify content list
                            simplified[key] = [simplify_for_log(item) for item in value]
                        else:
                            simplified[key] = simplify_for_log(value)
                    return simplified
                elif isinstance(obj, list):
                    return [simplify_for_log(item) for item in obj]
                else:
                    return obj

            simplified_messages = simplify_for_log(messages)
            logger.debug(f"Messages for apply_chat_template: {simplified_messages}")

            # Following the reference implementation from ComfyUI-QwenVL:
            # 1. Extract images and text from messages
            # 2. Convert base64 data URLs to PIL Images
            # 3. Apply chat template with tokenize=False to get formatted chat string
            # 4. Use processor() to process text and images together

            # Extract images and text from messages
            images = []
            text_content = ""

            # messages format: [{"role": "user", "content": [{"type": "image", "image": "data:..."}, {"type": "text", "text": "..."}]}]
            if messages and isinstance(messages, list) and len(messages) > 0:
                first_message = messages[0]
                if isinstance(first_message, dict) and "content" in first_message:
                    content_items = first_message["content"]
                    if isinstance(content_items, list):
                        for item in content_items:
                            if isinstance(item, dict):
                                if item.get("type") == "image":
                                    image_data_url = item.get("image", "")
                                    if image_data_url.startswith("data:image/png;base64,"):
                                        # Convert base64 data URL to PIL Image
                                        try:
                                            import base64
                                            from io import BytesIO
                                            from PIL import Image
                                            base64_str = image_data_url[len("data:image/png;base64,"):]
                                            image_data = base64.b64decode(base64_str)
                                            pil_image = Image.open(BytesIO(image_data)).convert("RGB")
                                            images.append(pil_image)
                                            logger.debug(f"Converted base64 image to PIL, size: {pil_image.size}")
                                        except Exception as e:
                                            logger.error(f"Failed to convert base64 to PIL image: {e}")
                                            raise
                                elif item.get("type") == "text":
                                    text_content = item.get("text", "")

            if not text_content:
                raise ValueError("No text content found in messages")

            # Apply chat template with tokenize=False (following reference implementation)
            logger.debug("Applying chat template with tokenize=False...")
            try:
                chat_text = processor.apply_chat_template(
                    messages,
                    tokenize=False,  # Important: tokenize=False returns formatted string
                    add_generation_prompt=True
                )
                logger.debug(f"Chat template applied successfully, chat text length: {len(chat_text)}")
            except Exception as e:
                logger.error(f"apply_chat_template with tokenize=False failed: {e}")
                # Fallback: try to extract text directly from messages
                logger.warning("Falling back to direct text extraction")
                chat_text = text_content

            # Progress: processing
            if progress_callback:
                progress_callback("处理", 0.3)

            # Use processor to process text and images together
            logger.debug(f"Processing {len(images)} images with text...")
            try:
                processed = processor(
                    text=chat_text,
                    images=images if images else None,
                    return_tensors="pt"
                )
                logger.debug(f"Processor returned type: {type(processed)}")
                if hasattr(processed, "keys"):
                    logger.debug(f"Processed keys: {list(processed.keys())}")
            except Exception as e:
                logger.error(f"Processor call failed: {e}")
                # Try alternative approach without images
                if images:
                    logger.warning("Trying without images...")
                    processed = processor(
                        text=chat_text,
                        return_tensors="pt"
                    )
                else:
                    raise

            # Move processed inputs to model device
            logger.debug(f"Moving processed inputs to device: {model.device}")
            model_inputs = {}
            for key, value in processed.items():
                if torch.is_tensor(value):
                    model_inputs[key] = value.to(model.device)
                else:
                    model_inputs[key] = value
            logger.debug(f"Successfully moved inputs to device, keys: {list(model_inputs.keys())}")

            # Get input_ids from model_inputs for later trimming
            input_ids = model_inputs.get("input_ids")
            if input_ids is None:
                # Try alternative ways to get input_ids
                if hasattr(model_inputs, "get"):
                    input_ids = model_inputs.get("input_ids")
                elif hasattr(model_inputs, "input_ids"):
                    input_ids = model_inputs.input_ids
                elif isinstance(model_inputs, dict) and "input_ids" in model_inputs:
                    input_ids = model_inputs["input_ids"]

            if input_ids is None:
                logger.error(f"Could not find input_ids in model_inputs")
                logger.error(f"model_inputs type: {type(model_inputs)}")
                if isinstance(model_inputs, dict):
                    logger.error(f"Available keys: {list(model_inputs.keys())}")
                raise ValueError("Could not find input_ids in model inputs")

            logger.debug(f"Got input_ids, shape: {input_ids.shape if hasattr(input_ids, 'shape') else 'N/A'}")

            # Generate with parameters
            generation_config = payload["generation_config"]
            logger.debug(f"Generation config: {generation_config}")
            logger.debug(f"Model inputs type: {type(model_inputs)}")

            # Prepare inputs for model.generate()
            generate_kwargs = {}
            if isinstance(model_inputs, dict):
                generate_kwargs.update(model_inputs)
                logger.debug(f"Using model_inputs dict for generate, keys: {list(model_inputs.keys())}")
            elif hasattr(model_inputs, "items"):
                # Convert to dict
                for key, value in model_inputs.items():
                    generate_kwargs[key] = value
                logger.debug(f"Converted model_inputs via items() for generate, keys: {list(generate_kwargs.keys())}")
            else:
                generate_kwargs = model_inputs
                logger.debug(f"Using model_inputs as-is for generate (type: {type(model_inputs)})")

            logger.debug(f"generate_kwargs type: {type(generate_kwargs)}")

            # Set random seed if provided
            seed = generation_config.get("seed")
            if seed is not None:
                logger.debug(f"Setting random seed: {seed}")
                torch.manual_seed(seed)
                # Remove seed from generation_config to avoid passing to model.generate
                generation_config.pop("seed", None)

            with torch.no_grad():
                try:
                    generated_ids = model.generate(
                        **generate_kwargs,
                        max_new_tokens=generation_config["max_new_tokens"],
                        temperature=generation_config["temperature"] if generation_config["temperature"] > 0 else None,
                        top_p=generation_config["top_p"] if generation_config["top_p"] > 0 else None,
                        top_k=generation_config.get("top_k"),
                        repetition_penalty=generation_config.get("repetition_penalty"),
                        do_sample=generation_config["temperature"] > 0,
                    )
                    logger.debug(f"model.generate succeeded")
                except Exception as e:
                    logger.error(f"model.generate failed: {e}")
                    # Try alternative approach
                    logger.debug(f"Trying alternative generate approach")
                    # Extract specific tensors from model_inputs
                    if isinstance(model_inputs, dict):
                        if "input_ids" in model_inputs and "attention_mask" in model_inputs:
                            generated_ids = model.generate(
                                input_ids=model_inputs["input_ids"],
                                attention_mask=model_inputs["attention_mask"],
                                max_new_tokens=generation_config["max_new_tokens"],
                                temperature=generation_config["temperature"] if generation_config["temperature"] > 0 else None,
                                top_p=generation_config["top_p"] if generation_config["top_p"] > 0 else None,
                                top_k=generation_config.get("top_k"),
                                repetition_penalty=generation_config.get("repetition_penalty"),
                                do_sample=generation_config["temperature"] > 0,
                            )
                            logger.info(f"Alternative generate succeeded")
                        else:
                            raise
                    elif hasattr(model_inputs, "input_ids") and hasattr(model_inputs, "attention_mask"):
                        generated_ids = model.generate(
                            input_ids=model_inputs.input_ids,
                            attention_mask=model_inputs.attention_mask,
                            max_new_tokens=generation_config["max_new_tokens"],
                            temperature=generation_config["temperature"] if generation_config["temperature"] > 0 else None,
                            top_p=generation_config["top_p"] if generation_config["top_p"] > 0 else None,
                            top_k=generation_config.get("top_k"),
                            repetition_penalty=generation_config.get("repetition_penalty"),
                            do_sample=generation_config["temperature"] > 0,
                        )
                        logger.info(f"Alternative generate succeeded")
                    else:
                        raise

            logger.info(f"model.generate returned type: {type(generated_ids)}")
            if hasattr(generated_ids, "shape"):
                logger.info(f"generated_ids shape: {generated_ids.shape}")
            else:
                logger.info(f"generated_ids has no shape attribute")

            # Ensure generated_ids is a tensor/list for iteration
            # model.generate() should return a tensor, but handle other cases
            generated_ids_list = None
            if hasattr(generated_ids, "cpu"):
                # It's a tensor
                try:
                    # Convert to list for iteration
                    generated_ids_list = generated_ids.cpu().numpy().tolist()
                except Exception as e:
                    logger.warning(f"Failed to convert tensor to list: {e}, using tensor directly")
                    generated_ids_list = generated_ids
            elif isinstance(generated_ids, (list, tuple)):
                generated_ids_list = generated_ids
            elif isinstance(generated_ids, dict):
                # Try to find the actual tensor in the dict
                logger.warning(f"generated_ids is a dict, looking for output tensor")
                for key, value in generated_ids.items():
                    if hasattr(value, "cpu") or isinstance(value, (list, tuple)):
                        generated_ids_list = value
                        break
                if generated_ids_list is None:
                    # Use the dict as-is
                    generated_ids_list = generated_ids
            else:
                # Try to iterate directly
                generated_ids_list = generated_ids

            # Trim input tokens from output
            logger.info(f"Before trimming - input_ids type: {type(input_ids)}, generated_ids_list type: {type(generated_ids_list)}")

            try:
                # Ensure input_ids is iterable and get length properly
                if hasattr(input_ids, "shape"):
                    # It's a tensor
                    input_ids_list = input_ids.cpu().numpy().tolist()
                    logger.info(f"Converted tensor input_ids to list, shape: {input_ids.shape}")
                elif isinstance(input_ids, (list, tuple)):
                    input_ids_list = input_ids
                else:
                    # Try to iterate directly
                    input_ids_list = input_ids

                # Ensure generated_ids_list is properly formatted
                if hasattr(generated_ids_list, "shape"):
                    # It's a tensor
                    generated_ids_clean = generated_ids_list.cpu().numpy().tolist()
                    logger.info(f"Converted tensor generated_ids to list, shape: {generated_ids_list.shape}")
                elif isinstance(generated_ids_list, (list, tuple)):
                    generated_ids_clean = generated_ids_list
                elif isinstance(generated_ids_list, dict):
                    logger.warning(f"generated_ids_list is still a dict, using as-is")
                    generated_ids_clean = generated_ids_list
                else:
                    generated_ids_clean = generated_ids_list

                # Now attempt the trimming
                generated_ids_trimmed = []
                for in_ids, out_ids in zip(input_ids_list, generated_ids_clean):
                    # Get length of input_ids
                    if hasattr(in_ids, "__len__"):
                        in_len = len(in_ids)
                    elif isinstance(in_ids, (list, tuple)):
                        in_len = len(in_ids)
                    elif hasattr(in_ids, "shape"):
                        in_len = in_ids.shape[0] if len(in_ids.shape) > 0 else 1
                    else:
                        # Fallback: try to convert to list
                        try:
                            in_list = list(in_ids)
                            in_len = len(in_list)
                        except Exception as e:
                            logger.warning(f"Could not get length of in_ids, assuming 0: {type(in_ids)}")
                            in_len = 0

                    # Slice output
                    if hasattr(out_ids, "__getitem__"):
                        # Can be sliced
                        trimmed = out_ids[in_len:]
                        generated_ids_trimmed.append(trimmed)
                    else:
                        # Cannot be sliced, use as-is
                        logger.warning(f"Cannot slice out_ids type: {type(out_ids)}, using as-is")
                        generated_ids_trimmed.append(out_ids)

                logger.info(f"Successfully trimmed {len(generated_ids_trimmed)} sequences")

            except Exception as e:
                logger.error(f"Failed to trim input tokens: {e}, input_ids type: {type(input_ids)}, generated_ids_list type: {type(generated_ids_list)}")
                # Fallback: return generated_ids as-is
                generated_ids_trimmed = generated_ids_list

            # Decode output
            logger.info(f"Before batch_decode - generated_ids_trimmed type: {type(generated_ids_trimmed)}")
            if isinstance(generated_ids_trimmed, (list, tuple)):
                logger.info(f"generated_ids_trimmed length: {len(generated_ids_trimmed)}")
                if len(generated_ids_trimmed) > 0:
                    first_elem = generated_ids_trimmed[0]
                    logger.debug(f"First element type: {type(first_elem)}")
                    if isinstance(first_elem, (list, tuple)):
                        logger.debug(f"First element length: {len(first_elem)}")
                        if len(first_elem) > 0:
                            logger.debug(f"First token in first element: {first_elem[0]}, type: {type(first_elem[0])}")
            elif hasattr(generated_ids_trimmed, "shape"):
                logger.info(f"generated_ids_trimmed shape: {generated_ids_trimmed.shape}")

            decoded_results = processor.batch_decode(
                generated_ids_trimmed, skip_special_tokens=True, clean_up_tokenization_spaces=False
            )

            logger.info(f"batch_decode returned type: {type(decoded_results)}")
            if isinstance(decoded_results, (list, tuple)):
                logger.info(f"decoded_results length: {len(decoded_results)}")

            # Check if decoded_results is a list
            if isinstance(decoded_results, list) and len(decoded_results) > 0:
                output_text = decoded_results[0]
            elif isinstance(decoded_results, str):
                output_text = decoded_results
            else:
                # Try to get the first element if it's indexable
                try:
                    output_text = decoded_results[0]
                except (TypeError, IndexError, KeyError) as e:
                    logger.error(f"Failed to extract output text from decoded_results: {type(decoded_results)} - {decoded_results}")
                    raise ValueError(f"Unexpected output format from batch_decode: {type(decoded_results)}")

            # Progress: completed
            if progress_callback:
                progress_callback("完成", 1.0)

            # Return in OpenAI-compatible format for consistency
            return {
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": output_text
                        }
                    }
                ]
            }

        except Exception as e:
            logger.error(f"Qwen3-VL local inference failed: {e}")
            return {"error": f"Inference failed: {str(e)}"}

    def _try_load_from_path(self, model_path: str, loading_config: Dict[str, Any]) -> Tuple[AutoModelForVision2Seq, AutoProcessor]:
        """尝试从指定路径加载模型和处理器"""
        # Determine device
        device = loading_config.get("device", "auto")
        if device == "auto":
            device = "cuda" if torch.cuda.is_available() else "cpu"

        # Determine dtype
        dtype_str = loading_config.get("dtype", "auto")
        if dtype_str == "auto":
            dtype = torch.bfloat16 if torch.cuda.is_available() and torch.cuda.is_bf16_supported() else torch.float16
        elif dtype_str == "bfloat16":
            dtype = torch.bfloat16
        elif dtype_str == "float16":
            dtype = torch.float16
        elif dtype_str == "float32":
            dtype = torch.float32
        else:
            dtype = torch.float32

        flash_attention_2 = loading_config.get("flash_attention_2", False)
        trust_remote_code = loading_config.get("trust_remote_code", True)

        logger.info(f"Attempting to load model from: {model_path}")

        # Load processor
        processor = AutoProcessor.from_pretrained(
            model_path,
            trust_remote_code=trust_remote_code
        )

        # Load model with appropriate settings
        attn_implementation = "flash_attention_2" if flash_attention_2 else "eager"

        try:
            model = AutoModelForVision2Seq.from_pretrained(
                model_path,
                torch_dtype=dtype,
                device_map=device,
                attn_implementation=attn_implementation,
                trust_remote_code=trust_remote_code,
                use_safetensors=True
            )
        except Exception as e:
            # Fallback to eager attention if flash attention fails
            logger.warning(f"Failed to load with {attn_implementation}, falling back to eager: {e}")
            model = AutoModelForVision2Seq.from_pretrained(
                model_path,
                torch_dtype=dtype,
                device_map=device,
                trust_remote_code=trust_remote_code,
                use_safetensors=True
            )

        return model, processor

    def _load_model(self, loading_config: Dict[str, Any], model_path: str) -> Tuple[AutoModelForVision2Seq, AutoProcessor]:
        """Load or get cached model and processor with retry across multiple directories."""
        # Check if we need to load a new model
        if (self._model is None or self._processor is None or
            self._current_model_path != model_path or
            self._device != loading_config.get("device") or
            self._dtype != loading_config.get("dtype") or
            self._flash_attention_2 != loading_config.get("flash_attention_2", False)):

            logger.info(f"Loading Qwen3-VL model from {model_path}")

            # Clear previous model from memory
            if self._model is not None:
                del self._model
                self._model = None
            if self._processor is not None:
                del self._processor
                self._processor = None
            torch.cuda.empty_cache() if torch.cuda.is_available() else None

            # 尝试从多个目录加载模型
            success = False
            last_error = None

            # 如果是绝对路径，直接尝试加载
            if os.path.isabs(model_path) and os.path.isdir(model_path):
                try:
                    model, processor = self._try_load_from_path(model_path, loading_config)
                    self._model = model
                    self._processor = processor
                    self._current_model_path = model_path
                    success = True
                    logger.info(f"Successfully loaded model from absolute path: {model_path}")
                except Exception as e:
                    last_error = e
                    logger.error(f"Failed to load model from absolute path {model_path}: {e}")
            else:
                # 获取所有可能的模型目录
                model_dirs = get_model_dirs()
                if not model_dirs:
                    raise ValueError("No model directories configured")

                # 首先尝试查找现有模型
                found_paths = []
                for model_dir in model_dirs:
                    if "/" in model_path:
                        # 创建完整路径，包括组织名称
                        candidate_path = model_dir / model_path
                    else:
                        # 可能是本地模型相对路径（不含组织前缀）
                        candidate_path = model_dir / model_path

                    if check_model_dir(candidate_path):
                        found_paths.append(str(candidate_path))
                        logger.debug(f"Found candidate model at: {candidate_path}")

                # 如果找到了现有模型，尝试逐个加载
                if found_paths:
                    logger.info(f"Found {len(found_paths)} candidate model locations: {found_paths}")
                    for candidate_path in found_paths:
                        try:
                            model, processor = self._try_load_from_path(candidate_path, loading_config)
                            self._model = model
                            self._processor = processor
                            self._current_model_path = candidate_path
                            success = True
                            logger.info(f"Successfully loaded model from: {candidate_path}")
                            break
                        except Exception as e:
                            last_error = e
                            logger.warning(f"Failed to load model from {candidate_path}: {e}")
                            # 继续尝试下一个路径

                # 如果没有找到现有模型或所有现有模型都加载失败，尝试ensure_model（可能触发下载）
                if not success:
                    try:
                        actual_model_path = ensure_model(model_path)
                        logger.info(f"Model resolved to: {actual_model_path}")
                        model, processor = self._try_load_from_path(actual_model_path, loading_config)
                        self._model = model
                        self._processor = processor
                        self._current_model_path = actual_model_path
                        success = True
                        logger.info(f"Successfully loaded model after ensure_model: {actual_model_path}")
                    except Exception as e:
                        last_error = e
                        logger.error(f"Failed to load model via ensure_model: {e}")

            if not success:
                if last_error:
                    raise RuntimeError(f"Failed to load model {model_path} from any location: {last_error}")
                else:
                    raise RuntimeError(f"Failed to load model {model_path} from any location")

            # 存储加载配置
            device = loading_config.get("device", "auto")
            if device == "auto":
                device = "cuda" if torch.cuda.is_available() else "cpu"

            dtype_str = loading_config.get("dtype", "auto")
            if dtype_str == "auto":
                self._dtype = torch.bfloat16 if torch.cuda.is_available() and torch.cuda.is_bf16_supported() else torch.float16
            elif dtype_str == "bfloat16":
                self._dtype = torch.bfloat16
            elif dtype_str == "float16":
                self._dtype = torch.float16
            elif dtype_str == "float32":
                self._dtype = torch.float32
            else:
                self._dtype = torch.float32

            self._device = device
            self._flash_attention_2 = loading_config.get("flash_attention_2", False)

            logger.info(f"Qwen3-VL model loaded on {device} with dtype {self._dtype}")

        return self._model, self._processor

    def extract_text(self, response: Dict[str, Any]) -> str:
        """Extract text from response."""
        if "error" in response:
            return f"Error: {response['error']}"

        choices = response.get("choices", [])
        if not choices:
            return "Qwen3-VL did not return any choices."

        content = choices[0].get("message", {}).get("content")
        return content or ""

    def extract_images(self, response: Dict[str, Any]) -> List[torch.Tensor]:
        """Extract images from response (Qwen3-VL doesn't generate images)."""
        return []

    def extract_image_urls(self, response: Dict[str, Any]) -> List[str]:
        """Extract image URLs from response (Qwen3-VL doesn't generate images)."""
        return []


__all__ = [
    "Qwen3VLLocalProvider",
]