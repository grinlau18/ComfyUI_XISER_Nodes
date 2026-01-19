"""视频生成模型编排器节点 - V3版本"""

from comfy_api.v0_0_2 import io, ComfyAPI, ComfyAPISync
from typing import Dict, List, Optional, Any, Tuple
import torch
import time
import json
import base64
import io as python_io
import hashlib
import pickle
import os
from datetime import datetime, timedelta
from PIL import Image
from comfy_execution.utils import get_executing_context

from .video import _gather_videos, build_default_registry, _validate_inputs
from .key_store import KEY_STORE
from .config import get_config_loader

# 创建API实例用于进度更新
api = ComfyAPI()
api_sync = ComfyAPISync()

# 构建注册表
REGISTRY = build_default_registry()

# 缓存管理
class VideoGenerationCache:
    """视频生成缓存管理器"""

    def __init__(self, cache_dir: str = None):
        """初始化缓存管理器

        Args:
            cache_dir: 缓存目录，默认为 ~/.comfyui_xiser_cache
        """
        if cache_dir is None:
            # 使用用户主目录下的缓存目录
            home_dir = os.path.expanduser("~")
            cache_dir = os.path.join(home_dir, ".comfyui_xiser_cache")

        self.cache_dir = cache_dir
        self.cache_file = os.path.join(cache_dir, "video_generation_cache.pkl")

        # 确保缓存目录存在
        os.makedirs(cache_dir, exist_ok=True)

        # 加载现有缓存
        self.cache = self._load_cache()

    def _load_cache(self) -> Dict[str, Dict]:
        """加载缓存数据"""
        try:
            if os.path.exists(self.cache_file):
                with open(self.cache_file, 'rb') as f:
                    cache_data = pickle.load(f)

                    # 清理过期缓存
                    cleaned_cache = {}
                    current_time = datetime.now()
                    for cache_key, cache_entry in cache_data.items():
                        created_time = cache_entry.get('created_time')
                        if created_time:
                            # 检查是否在24小时内
                            if isinstance(created_time, str):
                                created_time = datetime.fromisoformat(created_time)

                            if current_time - created_time < timedelta(hours=24):
                                cleaned_cache[cache_key] = cache_entry

                    # 如果清理后有变化，保存清理后的缓存
                    if len(cleaned_cache) != len(cache_data):
                        self._save_cache(cleaned_cache)

                    return cleaned_cache
        except Exception as e:
            print(f"[VGM Cache] 加载缓存失败: {e}")

        return {}

    def _save_cache(self, cache_data: Dict[str, Dict]):
        """保存缓存数据"""
        try:
            with open(self.cache_file, 'wb') as f:
                pickle.dump(cache_data, f)
        except Exception as e:
            print(f"[VGM Cache] 保存缓存失败: {e}")

    def generate_cache_key(self, **kwargs) -> str:
        """生成缓存键

        基于所有输入参数生成唯一的MD5哈希值
        """
        # 提取关键参数用于缓存键
        cache_params = {
            'provider': kwargs.get('provider', ''),
            'prompt': kwargs.get('prompt', ''),
            'reference_video_url': kwargs.get('reference_video_url', ''),
            'size': kwargs.get('size', ''),
            'duration': kwargs.get('duration', 0),
            'shot_type': kwargs.get('shot_type', ''),
            'watermark': kwargs.get('watermark', False),
            'seed': kwargs.get('seed', 0),
            'negative_prompt': kwargs.get('negative_prompt', ''),
            'region': kwargs.get('region', ''),
            'audio_url': kwargs.get('audio_url', ''),
            'resolution': kwargs.get('resolution', ''),
            'prompt_extend': kwargs.get('prompt_extend', True),
            'template': kwargs.get('template', ''),
        }

        # 处理图像输入（pack_images）
        pack_images = kwargs.get('pack_images')
        if pack_images is not None:
            # 对于图像张量，使用形状和部分数据生成哈希
            if isinstance(pack_images, torch.Tensor):
                # 使用形状和部分像素值生成哈希
                shape_str = str(tuple(pack_images.shape))
                # 取前100个像素值（如果存在）
                if pack_images.numel() > 0:
                    flat_data = pack_images.flatten()[:100].cpu().numpy()
                    data_hash = hashlib.md5(flat_data.tobytes()).hexdigest()
                    cache_params['pack_images'] = f"{shape_str}_{data_hash}"
                else:
                    cache_params['pack_images'] = shape_str
            elif isinstance(pack_images, (list, tuple)):
                # 对于图像列表，处理每个图像
                image_hashes = []
                for i, img in enumerate(pack_images):
                    if isinstance(img, torch.Tensor):
                        shape_str = str(tuple(img.shape))
                        if img.numel() > 0:
                            flat_data = img.flatten()[:100].cpu().numpy()
                            data_hash = hashlib.md5(flat_data.tobytes()).hexdigest()
                            image_hashes.append(f"{shape_str}_{data_hash}")
                        else:
                            image_hashes.append(shape_str)
                cache_params['pack_images'] = "_".join(image_hashes)

        # 将参数转换为JSON字符串并生成MD5哈希
        param_str = json.dumps(cache_params, sort_keys=True, ensure_ascii=False)
        cache_key = hashlib.md5(param_str.encode('utf-8')).hexdigest()

        return cache_key

    def get(self, cache_key: str) -> Optional[Dict]:
        """获取缓存条目

        Returns:
            缓存条目字典，包含 task_id, video_url, created_time
            如果不存在或已过期则返回None
        """
        cache_entry = self.cache.get(cache_key)
        if not cache_entry:
            return None

        # 检查是否在24小时内
        created_time = cache_entry.get('created_time')
        if created_time:
            if isinstance(created_time, str):
                created_time = datetime.fromisoformat(created_time)

            if datetime.now() - created_time >= timedelta(hours=24):
                # 缓存过期，删除
                del self.cache[cache_key]
                self._save_cache(self.cache)
                return None

        return cache_entry

    def set(self, cache_key: str, task_id: str, video_url: str):
        """设置缓存条目"""
        cache_entry = {
            'task_id': task_id,
            'video_url': video_url,
            'created_time': datetime.now().isoformat()
        }

        self.cache[cache_key] = cache_entry
        self._save_cache(self.cache)

    def clear_expired(self):
        """清理过期缓存（超过24小时）"""
        current_time = datetime.now()
        expired_keys = []

        for cache_key, cache_entry in self.cache.items():
            created_time = cache_entry.get('created_time')
            if created_time:
                if isinstance(created_time, str):
                    created_time = datetime.fromisoformat(created_time)

                if current_time - created_time >= timedelta(hours=24):
                    expired_keys.append(cache_key)

        for key in expired_keys:
            del self.cache[key]

        if expired_keys:
            self._save_cache(self.cache)
            print(f"[VGM Cache] 清理了 {len(expired_keys)} 个过期缓存")


# 创建全局缓存实例
VIDEO_CACHE = VideoGenerationCache()


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
        stage_index = {
            "准备": 0, "验证": 1, "创建任务": 2,
            "轮询": 3, "下载": 4, "完成": 5
        }.get(stage, 0)

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
    except Exception:
        # 进度更新失败不影响主要功能
        pass


def _log_dynamic(message: str, end: str = "\n"):
    """动态日志输出，支持行内更新

    Args:
        message: 日志消息
        end: 结束字符，默认为换行符，使用\r可实现行内更新
    """
    print(f"[VGM] {message}", end=end, flush=True)


def _download_video(video_url: str, progress_callback=None) -> Tuple[torch.Tensor, Dict[str, Any], int, int, float, float, int]:
    """下载视频并转换为张量

    从URL下载视频文件，读取视频帧，转换为ComfyUI图像批次格式

    Args:
        video_url: 视频URL（如阿里云OSS链接）
        progress_callback: 进度回调函数

    Returns:
        Tuple[视频张量, 视频信息字典]
        视频张量形状为 [frames, height, width, channels]，数值范围0-1
        视频信息包含: width, height, fps, frame_count, shape
    """
    import cv2
    import numpy as np
    import tempfile
    import urllib.request
    import os

    if progress_callback:
        progress_callback("下载视频", 0.1)

    # 创建临时文件保存视频
    with tempfile.NamedTemporaryFile(suffix='.mp4', delete=False) as tmp_file:
        tmp_path = tmp_file.name

    try:
        # 1. 下载视频文件
        if progress_callback:
            progress_callback("下载视频", 0.3)

        urllib.request.urlretrieve(video_url, tmp_path)

        # 2. 使用OpenCV读取视频
        if progress_callback:
            progress_callback("读取视频", 0.5)

        cap = cv2.VideoCapture(tmp_path)
        if not cap.isOpened():
            raise Exception(f"无法打开视频文件: {tmp_path}")

        # 获取视频信息
        fps = cap.get(cv2.CAP_PROP_FPS)
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        # 视频信息现在在最终成功提示中显示

        # 3. 读取所有帧
        frames = []
        frame_idx = 0

        while True:
            if progress_callback:
                progress = 0.5 + 0.4 * (frame_idx / frame_count)
                progress_callback("读取视频", progress)

            ret, frame = cap.read()
            if not ret:
                break

            # 转换BGR到RGB
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

            # 归一化到0-1范围
            frame_normalized = frame_rgb.astype(np.float32) / 255.0

            frames.append(frame_normalized)
            frame_idx += 1

        cap.release()

        if not frames:
            raise Exception("视频中没有读取到任何帧")

        # 4. 转换为张量
        if progress_callback:
            progress_callback("转换格式", 0.9)

        # 堆叠所有帧 [frames, height, width, channels]
        video_array = np.stack(frames, axis=0)
        video_tensor = torch.from_numpy(video_array)

        # 收集视频信息
        duration_seconds = frame_count / fps if fps > 0 else 0
        video_info = {
            "width": width,
            "height": height,
            "fps": fps,
            "frame_count": frame_count,
            "shape": video_tensor.shape,
            "duration": duration_seconds
        }

        # 返回视频信息和张量，不在函数内输出日志
        if progress_callback:
            progress_callback("完成", 1.0)

        return video_tensor, video_info, width, height, duration_seconds, fps, frame_count

    except Exception as e:
        print(f"[VGM] 视频下载/转换错误: {e}")
        # 如果出错，返回虚拟张量作为后备
        if progress_callback:
            progress_callback("使用虚拟数据", 1.0)

        # 返回虚拟视频张量作为后备
        # VideoCombine节点期望 [frames, height, width, channels] 格式
        dummy_tensor = torch.rand((30, 720, 1280, 3), dtype=torch.float32)
        dummy_info = {
            "width": 1280,
            "height": 720,
            "fps": 30.0,
            "frame_count": 30,
            "shape": dummy_tensor.shape,
            "duration": 1.0
        }
        return dummy_tensor, dummy_info

    finally:
        # 清理临时文件
        try:
            os.unlink(tmp_path)
        except:
            pass


def _parse_video_urls(reference_video_url: str) -> List[str]:
    """解析视频URL输入（支持多行，每行一个URL）"""
    video_urls = []

    if not reference_video_url or not reference_video_url.strip():
        return video_urls

    # 按行分割URL
    lines = reference_video_url.strip().split('\n')
    for line in lines:
        url = line.strip()
        if url:  # 跳过空行
            if url.startswith(("http://", "https://")):
                video_urls.append(url)
            else:
                raise ValueError(f"无效的视频URL格式：{url}，必须以http://或https://开头")

    # 检查URL数量限制（API最多支持3个）
    if len(video_urls) > 3:
        raise ValueError(f"视频URL数量超过限制：{len(video_urls)}个，最多支持3个")

    return video_urls


def _process_input_image(image_tensor: torch.Tensor) -> str:
    """处理输入图像张量，转换为Base64编码字符串

    Args:
        image_tensor: 图像张量，形状为 [1, channels, height, width] 或 [channels, height, width]

    Returns:
        Base64编码的图像字符串，格式为 data:image/png;base64,{base64_data}
    """
    try:
        # 确保张量在CPU上且为float类型
        if image_tensor.is_cuda:
            image_tensor = image_tensor.cpu()

        # 简化日志
        if image_tensor.ndim == 4:
            # [batch, channels, height, width] - 取第一张
            if image_tensor.shape[0] > 1:
                _log_dynamic(f"⚠ 输入图像有 {image_tensor.shape[0]} 个批次，只使用第一个")
            image_tensor = image_tensor[0]
        elif image_tensor.ndim == 3:
            # [channels, height, width] 或 [height, width, channels] - 直接使用
            pass
        else:
            raise ValueError(f"不支持的图像张量维度：{image_tensor.ndim}，期望3或4维")

        # 确保通道顺序正确（ComfyUI通常使用RGB）
        if image_tensor.shape[0] == 3:
            # [channels, height, width] -> [height, width, channels]
            image_np = image_tensor.permute(1, 2, 0).numpy()
        elif image_tensor.shape[2] == 3:
            # 已经是 [height, width, channels]
            image_np = image_tensor.numpy()
        elif image_tensor.shape[0] == 4:
            # [channels, height, width] 格式的RGBA图像 -> 转换为RGB
            _log_dynamic("↻ 检测到RGBA图像，正在转换为RGB...")
            # 提取RGB通道并去除透明度
            rgb_tensor = image_tensor[:3]  # 取前3个通道（R,G,B）
            image_np = rgb_tensor.permute(1, 2, 0).numpy()
        elif image_tensor.shape[2] == 4:
            # [height, width, channels] 格式的RGBA图像 -> 转换为RGB
            print("[VGM] 检测到RGBA图像（[H,W,C]格式），正在转换为RGB...")
            # 提取RGB通道并去除透明度
            image_np = image_tensor[:, :, :3].numpy()  # 取前3个通道（R,G,B）
        elif image_tensor.shape[0] == 1:
            # [channels, height, width] 格式的灰度图像 -> 转换为RGB
            print("[VGM] 检测到灰度图像（[C,H,W]格式），正在转换为RGB...")
            # 复制灰度通道到3个通道
            rgb_tensor = image_tensor.repeat(3, 1, 1)  # [1, H, W] -> [3, H, W]
            image_np = rgb_tensor.permute(1, 2, 0).numpy()
        elif image_tensor.shape[2] == 1:
            # [height, width, channels] 格式的灰度图像 -> 转换为RGB
            print("[VGM] 检测到灰度图像（[H,W,C]格式），正在转换为RGB...")
            # 复制灰度通道到3个通道
            image_np = image_tensor.repeat(1, 1, 3).numpy()  # [H, W, 1] -> [H, W, 3]
        else:
            raise ValueError(f"不支持的图像通道数：形状{image_tensor.shape}，期望1,3或4通道（格式应为[C,H,W]或[H,W,C]）")

        # 确保值在0-1范围内
        if image_np.max() > 1.0:
            image_np = image_np / 255.0

        # 转换为0-255整数
        image_np = (image_np * 255).astype('uint8')

        # 创建PIL图像
        pil_image = Image.fromarray(image_np)

        # 保存为PNG到内存
        buffer = python_io.BytesIO()
        pil_image.save(buffer, format='PNG')
        buffer.seek(0)

        # 转换为Base64
        image_bytes = buffer.getvalue()
        base64_data = base64.b64encode(image_bytes).decode('utf-8')

        return f"data:image/png;base64,{base64_data}"

    except Exception as e:
        print(f"[VGM] 图像处理错误：{e}")
        raise ValueError(f"图像处理失败：{str(e)}")


def _parse_pack_images(pack_images: Optional[torch.Tensor]) -> List[torch.Tensor]:
    """解析pack_images输入，提取图像列表

    Args:
        pack_images: pack_images输入张量，可以是：
            - None: 无输入
            - 单个图像张量: [H, W, C] 或 [1, H, W, C]
            - 图像列表: List[torch.Tensor] (来自DynamicPackImages节点)

    Returns:
        图像张量列表，每个元素为 [H, W, C] 格式
    """
    if pack_images is None:
        return []

    # 简化日志，只记录基本信息
    if hasattr(pack_images, 'shape'):
        shape_str = str(pack_images.shape)
    else:
        shape_str = "unknown"
    _log_dynamic(f"↻ 解析pack_images输入，形状: {shape_str}")

    # 处理列表或元组输入（来自DynamicPackImages节点）
    if isinstance(pack_images, (list, tuple)):
        images = []
        for i, img in enumerate(pack_images):
            if not isinstance(img, torch.Tensor):
                raise ValueError(f"pack_images中的第{i}个元素不是torch.Tensor: {type(img)}")

            # 确保图像维度正确
            if len(img.shape) == 3:  # [H, W, C] 或 [C, H, W]
                # 检查通道位置
                if img.shape[0] == 3 or img.shape[2] == 3:
                    images.append(img)
                else:
                    # 无法确定格式，尝试猜测
                    _log_dynamic(f"⚠ 警告：无法确定图像格式，形状: {img.shape}")
                    images.append(img)
            elif len(img.shape) == 4:  # [1, H, W, C] 或 [1, C, H, W]
                images.append(img[0])
            else:
                raise ValueError(f"不支持的图像维度: {img.shape}")

        _log_dynamic(f"↻ 从pack_images列表中提取了 {len(images)} 张图像")
        return images

    # 处理单个张量输入
    if not isinstance(pack_images, torch.Tensor):
        raise ValueError(f"pack_images必须是torch.Tensor或列表，实际类型: {type(pack_images)}")

    # 处理不同维度的张量
    if len(pack_images.shape) == 3:  # [H, W, C] 或 [C, H, W]
        # 检查通道位置
        if pack_images.shape[0] == 3 or pack_images.shape[2] == 3:
            return [pack_images]
        else:
            # 无法确定格式，尝试猜测
            print(f"[VGM] 警告：无法确定图像格式，形状: {pack_images.shape}")
            return [pack_images]
    elif len(pack_images.shape) == 4:  # [N, H, W, C] 或 [N, C, H, W]
        # 提取批次中的每个图像
        images = []
        for i in range(pack_images.shape[0]):
            images.append(pack_images[i])
        print(f"[VGM] 从批次张量中提取了 {len(images)} 张图像")
        return images
    else:
        raise ValueError(f"不支持的pack_images维度: {pack_images.shape}")


def _allocate_images_for_model(
    images: List[torch.Tensor],
    provider_type: str,
    model_name: str
) -> Dict[str, str]:
    """根据模型类型分配图像

    Args:
        images: 图像张量列表
        provider_type: 提供者类型 (r2v, i2v, kf2v)
        model_name: 模型名称

    Returns:
        字典，包含分配后的图像URL
    """
    result = {}

    if not images:
        return result

    if provider_type == "r2v":
        # 参考生视频模式不需要图像
        return result

    elif provider_type == "i2v":
        # 图生视频模式：只需要第1张图像作为首帧
        if len(images) >= 1:
            img_url = _process_input_image(images[0])
            result["img_url"] = img_url
        else:
            raise ValueError("图生视频模式需要至少1张图像，但pack_images为空")

    elif provider_type == "kf2v":
        # 首尾帧生视频模式：需要第1张作为首帧，第2张作为尾帧（可选）
        if len(images) >= 1:
            first_frame_url = _process_input_image(images[0])
            result["first_frame_url"] = first_frame_url

            if len(images) >= 2:
                last_frame_url = _process_input_image(images[1])
                result["last_frame_url"] = last_frame_url
            else:
                pass  # 未提供尾帧图像是允许的
        else:
            raise ValueError("首尾帧生视频模式需要至少1张图像作为首帧，但pack_images为空")

    else:
        raise ValueError(f"不支持的提供者类型: {provider_type}")

    return result


def _parse_image_input(input_image: Optional[torch.Tensor], image_url: str) -> str:
    """解析图像输入（张量或URL）

    Args:
        input_image: 图像张量输入
        image_url: 图像URL或Base64字符串

    Returns:
        图像URL或Base64字符串
    """
    # 优先使用图像张量
    if input_image is not None:
        print("[VGM] 使用图像张量输入")
        return _process_input_image(input_image)

    # 使用图像URL
    if image_url and image_url.strip():
        url = image_url.strip()

        # 检查是否是Base64格式
        if url.startswith("data:image/"):
            print("[VGM] 使用Base64图像输入")
            return url

        # 检查是否是有效的URL
        if url.startswith(("http://", "https://")):
            print(f"[VGM] 使用图像URL输入：{url}")
            return url

        # 如果不是Base64也不是URL，尝试作为Base64处理
        try:
            # 检查是否是有效的Base64
            if "base64," in url:
                print("[VGM] 使用Base64图像输入（包含base64,前缀）")
                return url
            else:
                # 尝试解码验证
                base64.b64decode(url, validate=True)
                print("[VGM] 使用纯Base64图像输入")
                return f"data:image/png;base64,{url}"
        except:
            raise ValueError(f"无效的图像输入格式：{url}，必须是有效的URL或Base64编码")

    # 没有图像输入
    return ""


def _create_dummy_videos_for_urls(video_urls: List[str]) -> List[torch.Tensor]:
    """为URL创建虚拟视频张量（临时解决方案）"""
    dummy_videos = []
    for i, url in enumerate(video_urls):
        # 创建虚拟视频张量，实际使用时需要下载视频
        # 这里暂时返回空张量，实际实现需要下载视频
        # VideoCombine节点期望 [frames, height, width, channels] 格式
        dummy_video = torch.zeros((30, 720, 1280, 3), dtype=torch.float32)
        dummy_videos.append(dummy_video)
        print(f"[VGM] 使用视频URL {i+1}: {url}")

    return dummy_videos


def _adapt_video_format(video_tensor: torch.Tensor) -> torch.Tensor:
    """适配视频张量格式

    将不同格式的视频张量转换为VideoCombine节点期望的格式：[frames, height, width, channels]

    Args:
        video_tensor: 输入视频张量，可能是以下格式之一：
            - [frames, height, width, channels] (OpenCV格式，VideoCombine期望格式)
            - [frames, channels, height, width] (ComfyUI标准图像批次格式)
            - [batch, frames, channels, height, width] (批量格式，batch维度通常为1)

    Returns:
        VideoCombine节点期望的视频张量格式：[frames, height, width, channels]
    """
    if video_tensor is None:
        return None

    ndim = video_tensor.ndim

    if ndim == 4:
        # 检查是否是 [frames, height, width, channels] 格式
        if video_tensor.shape[3] == 3 or video_tensor.shape[3] == 4:
            # 已经是 [frames, height, width, channels] 格式 (VideoCombine期望格式)
            return video_tensor
        elif video_tensor.shape[1] == 3 or video_tensor.shape[1] == 4:
            # [frames, channels, height, width] 格式
            # 转换为 [frames, height, width, channels]
            return video_tensor.permute(0, 2, 3, 1)
    elif ndim == 5:
        # [batch, frames, channels, height, width] 格式
        # 移除batch维度，假设batch_size=1
        if video_tensor.shape[0] == 1:
            video_tensor = video_tensor.squeeze(0)
        else:
            # 如果有多个batch，取第一个
            video_tensor = video_tensor[0]

        # 现在形状是 [frames, channels, height, width]
        # 转换为 [frames, height, width, channels]
        return video_tensor.permute(0, 2, 3, 1)

    # 如果格式无法识别，返回原张量
    print(f"[VGM] 警告：无法识别的视频张量形状：{video_tensor.shape}")
    return video_tensor


class XIS_VGMOrchestratorV3(io.ComfyNode):
    """视频生成模型编排器节点 - V3版本"""

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点架构"""
        # 使用新的配置系统获取模型选项
        config_loader = get_config_loader()

        try:
            # 获取UI下拉框选项
            raw_choices = config_loader.get_model_choices_for_ui()

            if not raw_choices:
                print("[VGM] 警告：配置系统返回空选项，使用默认选项")
                choices = ["wan2.6-r2v"]
                default_choice = "wan2.6-r2v"
            else:
                # 提取选项值
                choices = [choice["value"] for choice in raw_choices]
                default_choice = choices[0] if choices else "wan2.6-r2v"

        except Exception as e:
            print(f"[VGM] 警告：配置系统加载失败，使用注册表选项: {e}")
            # 回退到旧的注册表系统
            raw_choices = REGISTRY.list_grouped_choices()

            if not raw_choices:
                choices = ["wan2.6-r2v"]
                default_choice = "wan2.6-r2v"
            elif isinstance(raw_choices[0], dict):
                choices = [choice["value"] for choice in raw_choices]
                default_choice = choices[0] if choices else "wan2.6-r2v"
            else:
                choices = raw_choices
                default_choice = choices[0] if choices else "wan2.6-r2v"

        # 获取尺寸选项和时长选项
        size_options = []
        duration_options = []

        # 默认选项，防止空数组
        default_sizes = ["1280*720", "1920*1080"]
        default_durations = [5, 10]

        for choice in choices:
            provider_name = choice

            try:
                # 使用配置系统获取模型配置
                model_config = config_loader.get_model(provider_name)
                if model_config:
                    # 收集尺寸选项（参考生视频）
                    if model_config.supported_sizes:
                        size_options.extend(model_config.supported_sizes)
                    # 收集时长选项
                    if model_config.supported_durations:
                        duration_options.extend(model_config.supported_durations)
            except Exception as e:
                print(f"[VGM] 警告：获取模型 {provider_name} 配置失败: {e}")
                # 回退到注册表
                provider = REGISTRY.get(provider_name)
                if provider and hasattr(provider, 'config'):
                    if hasattr(provider.config, 'supported_sizes'):
                        size_options.extend(provider.config.supported_sizes)
                    if hasattr(provider.config, 'supported_durations'):
                        duration_options.extend(provider.config.supported_durations)

        # 如果选项为空，使用默认值
        if not size_options:
            size_options = default_sizes
            print(f"[VGM] 使用默认尺寸选项: {size_options}")

        if not duration_options:
            duration_options = default_durations
            print(f"[VGM] 使用默认时长选项: {duration_options}")

        # 去重并排序
        size_options = sorted(list(set(size_options)))
        duration_options = sorted(list(set(duration_options)))

        return io.Schema(
            node_id="XIS_VGMOrchestrator",
            display_name="VGM Orchestrator",
            category="XISER_Nodes/Video",
            description="""视频生成模型编排器，支持参考生视频、图生视频和首尾帧生视频三种模式。

核心功能：
• 参考生视频（r2v）：基于参考视频生成新视频，保留角色形象和音色
• 图生视频（i2v）：基于首帧图像生成视频，支持音频输入和智能改写
• 首尾帧生视频（kf2v）：基于首尾帧图像生成视频，支持特效模板

使用流程：
1. 选择模型提供者（参考生视频、图生视频或首尾帧生视频）
2. 配置API密钥（通过"API key management"按钮）
3. 根据模式输入参考视频URL或图像批次
4. 设置提示词、分辨率、时长等参数
5. 生成视频并自动转换为图像批次输出

输出结果：
• images: 视频转换的图像批次，可直接连接VideoCombine节点
• video_url: 生成视频的原始URL
• task_info: 任务信息（包含任务ID和API请求代码）

提示：详细参数说明请查看各控件的tooltip提示。""",
            inputs=[
                io.Combo.Input(
                    "provider",
                    options=choices,
                    default=default_choice,
                    tooltip="选择视频生成模型提供者：\n• 参考生视频：wan2.6-r2v（基于参考视频生成）\n• 图生视频：wan2.6-i2v/wan2.5-i2v-preview/wan2.2-i2v-flash/wan2.2-i2v-plus/wanx2.1-i2v-plus/wanx2.1-i2v-turbo（基于图像生成）\n• 首尾帧生视频：wan2.2-kf2v-flash/wanx2.1-kf2v-plus（基于首尾帧图像生成）"
                ),
                io.String.Input(
                    "prompt",
                    default="character1在沙发上开心地看电影",
                    multiline=True,
                    tooltip="视频描述提示词：\n• 参考生视频：使用character1、character2等引用参考视频中的角色\n• 图生视频：描述视频内容，支持中英文\n• 长度限制：wan2.6模型不超过1500字符，wan2.2模型不超过800字符\n• 使用技巧：详细描述场景、动作、情感等元素"
                ),
                io.String.Input(
                    "reference_video_url",
                    default="",
                    multiline=True,
                    optional=True,
                    tooltip="参考视频URL（参考生视频模式）：\n• 格式：每行一个URL，最多支持3个视频\n• 角色对应：第1个URL对应character1，第2个对应character2，以此类推\n• 视频要求：mp4/mov格式，2-30秒，不超过100MB\n• 每个视频仅包含一个角色\n• 示例：\nhttps://example.com/video1.mp4\nhttps://example.com/video2.mp4"
                ),
                io.Combo.Input(
                    "size",
                    options=size_options,
                    default="1280*720" if size_options else "",
                    optional=True,
                    tooltip="输出视频分辨率（参考生视频模式）：\n• 格式：宽*高，如1280*720、1920*1080\n• 720P档位：1280*720(16:9)、720*1280(9:16)、960*960(1:1)、1088*832(4:3)、832*1088(3:4)\n• 1080P档位：1920*1080(16:9)、1080*1920(9:16)、1440*1440(1:1)、1632*1248(4:3)、1248*1632(3:4)\n• 注意：分辨率直接影响费用，1080P > 720P"
                ),
                io.Combo.Input(
                    "duration",
                    options=duration_options if duration_options else [5],
                    default=duration_options[0] if duration_options else 5,
                    optional=True,
                    tooltip="输出视频时长（秒）：\n• 参考生视频：5秒或10秒\n• 图生视频：根据模型不同支持3-15秒\n• wan2.6-i2v：5/10/15秒\n• wan2.5-i2v-preview：5/10秒\n• wan2.2-i2v-flash/wan2.2-i2v-plus/wanx2.1-i2v-plus：固定5秒\n• wanx2.1-i2v-turbo：3/4/5秒\n• 注意：时长直接影响费用，按秒计费"
                ),
                io.Combo.Input(
                    "shot_type",
                    options=["single", "multi"],
                    default="multi",
                    optional=True,
                    tooltip="镜头类型：\n• single：单镜头视频，连续拍摄\n• multi：多镜头叙事，包含镜头切换\n• 参数优先级：shot_type > prompt\n• 示例：产品展示用单镜头，故事短片用多镜头"
                ),
                io.Boolean.Input(
                    "watermark",
                    default=False,
                    optional=True,
                    tooltip="是否添加水印：\n• true：添加水印，位于视频右下角，文案为'AI生成'\n• false：不添加水印（默认）\n• 注意：水印不会影响视频质量"
                ),
                io.Int.Input(
                    "seed",
                    default=42,
                    min=0,
                    max=2147483647,
                    step=1,
                    control_after_generate=True,
                    optional=True,
                    tooltip="随机种子：\n• 范围：0-2147483647\n• 固定种子可提升结果可复现性\n• 未指定时系统自动生成随机种子\n• 注意：由于模型生成具有概率性，相同种子不能保证完全一致的结果"
                ),
                io.String.Input(
                    "negative_prompt",
                    default="低分辨率、错误、最差质量",
                    multiline=True,
                    optional=True,
                    tooltip="负面提示词：\n• 描述不希望在视频画面中看到的内容\n• 支持中英文，长度不超过500字符\n• 示例：低分辨率、错误、最差质量、低质量、残缺、多余的手指、比例不良等\n• 可用于限制视频画面，提升生成质量"
                ),
                io.String.Input(
                    "key_profile",
                    default="",
                    optional=True,
                    tooltip="API密钥配置文件：\n• 通过'API key management'按钮管理密钥\n• 支持多配置文件，便于切换不同环境的密钥\n• 密钥存储在本地，确保安全性\n• 注意：使用前需先配置API密钥"
                ),
                io.Combo.Input(
                    "region",
                    options=["china", "singapore", "virginia"],
                    default="china",
                    optional=True,
                    tooltip="API请求地区：\n• china（北京）：所有模型都支持，默认选择\n• singapore（新加坡）：所有模型都支持\n• virginia（弗吉尼亚）：仅支持图生视频-基于首帧和参考生视频模型\n• 注意：不同地区可能影响请求延迟和费用"
                ),
                io.String.Input(
                    "endpoint_override",
                    default="",
                    optional=True,
                    tooltip="覆盖API端点（可选）：\n• 默认使用标准API端点\n• 可指定自定义端点用于测试或特殊环境\n• 格式：完整的API URL，如https://custom-endpoint.com/api/v1\n• 注意：仅在需要时使用，通常保持为空"
                ),
                io.Int.Input(
                    "polling_interval",
                    default=5,
                    min=1,
                    max=60,
                    step=1,
                    optional=True,
                    tooltip="轮询间隔（秒）：\n• 范围：1-60秒\n• 控制查询任务状态的频率\n• 较短间隔可更快获取结果但增加API调用\n• 较长间隔减少API调用但可能延迟获取结果\n• 建议值：5-10秒"
                ),
                io.Int.Input(
                    "max_polling_time",
                    default=600,
                    min=30,
                    max=1800,
                    step=30,
                    optional=True,
                    tooltip="最大轮询时间（秒）：\n• 范围：30-1800秒（0.5-30分钟）\n• 控制任务轮询的最大持续时间\n• 超时后任务将被取消\n• 视频生成通常需要1-5分钟，建议设置5-10分钟\n• 注意：长时间任务可能需要增加此值"
                ),
                # 图像输入参数（统一使用pack_images）
                io.Image.Input(
                    "pack_images",
                    optional=True,
                    tooltip="输入图像批次（所有图像模式）：\n• 接受IMAGE输入，支持多张图像\n• 系统根据选择的模型自动分配图像：\n  • 图生视频（i2v）：使用第1张图像作为首帧\n  • 首尾帧生视频（kf2v）：使用第1张作为首帧，第2张作为尾帧（可选）\n  • 参考生视频（r2v）：不需要图像输入\n• 图像要求：JPEG/PNG格式，360-2000像素，不超过10MB\n• 注意：图像将自动转换为Base64编码发送"
                ),
                io.String.Input(
                    "audio_url",
                    default="",
                    optional=True,
                    tooltip="音频URL（图生视频模式）：\n• 为视频指定背景音乐或配音\n• 支持模型：wan2.6-i2v、wan2.5-i2v-preview\n• 格式：wav、mp3，3-30秒，不超过15MB\n• URL格式：http://或https://开头的音频链接\n• 注意：音频长度超过视频时长时自动截取，不足时超出部分为无声"
                ),
                io.Combo.Input(
                    "resolution",
                    options=["480P", "720P", "1080P"],
                    default="720P",
                    optional=True,
                    tooltip="输出视频分辨率档位（图生视频模式）：\n• 480P：标清，适用于快速预览\n• 720P：高清，平衡质量与速度\n• 1080P：全高清，最佳画质\n• 注意：分辨率直接影响费用，1080P > 720P > 480P\n• 视频宽高比将尽量与输入图像保持一致"
                ),
                io.Boolean.Input(
                    "prompt_extend",
                    default=True,
                    optional=True,
                    tooltip="是否开启prompt智能改写（图生视频模式）：\n• true：开启智能改写，使用大模型优化输入prompt\n• false：不开启智能改写，使用原始prompt\n• 对于较短的prompt生成效果提升明显\n• 开启后会增加处理时间\n• 注意：wan2.6模型无论此参数取值如何，均不返回改写后的prompt"
                ),
                io.String.Input(
                    "template",
                    default="",
                    optional=True,
                    tooltip="视频特效模板（图生视频模式）：\n• 指定特效模板名称，如flying、rotation、squish等\n• 使用模板时prompt参数无效，建议留空\n• 支持模型：wan2.6-i2v、wan2.5-i2v-preview（部分）、wan2.2-i2v-flash（部分）\n• 特效类型：通用特效、单人特效、双人特效、首尾帧特效\n• 注意：调用前请查阅视频特效列表，以免调用失败"
                ),
            ],
            outputs=[
                io.Image.Output("images", display_name="images"),
                io.String.Output("video_url", display_name="视频URL"),
                io.String.Output("task_info", display_name="任务信息"),
            ]
        )

    @classmethod
    def execute(
        cls,
        provider: str,
        prompt: str,
        reference_video_url: str = "",
        size: str = "1280*720",
        duration: int = 5,
        shot_type: str = "multi",
        watermark: bool = False,
        seed: int = 42,
        negative_prompt: str = "低分辨率、错误、最差质量",
        key_profile: str = "",
        region: str = "china",
        endpoint_override: str = "",
        polling_interval: int = 5,
        max_polling_time: int = 600,
        # 图像和音频参数
        pack_images: Optional[torch.Tensor] = None,
        audio_url: str = "",
        resolution: str = "720P",
        prompt_extend: bool = True,
        template: str = "",
    ) -> io.NodeOutput:
        """执行视频生成"""
        # 获取节点ID用于进度更新
        executing_context = get_executing_context()
        node_id = executing_context.node_id if executing_context else ""

        try:
            # 进度：准备阶段
            _update_progress("准备", 0.1, node_id=node_id)

            # 0. 检查缓存
            cache_key = VIDEO_CACHE.generate_cache_key(
                provider=provider,
                prompt=prompt,
                reference_video_url=reference_video_url,
                size=size,
                duration=duration,
                shot_type=shot_type,
                watermark=watermark,
                seed=seed,
                negative_prompt=negative_prompt,
                region=region,
                pack_images=pack_images,
                audio_url=audio_url,
                resolution=resolution,
                prompt_extend=prompt_extend,
                template=template,
            )

            cache_entry = VIDEO_CACHE.get(cache_key)
            if cache_entry:
                _log_dynamic(f"✓ 缓存命中，使用缓存的视频，task_id: {cache_entry['task_id'][:16]}...")
                _update_progress("缓存命中", 0.5, node_id=node_id)

                # 直接使用缓存的视频URL
                video_url = cache_entry['video_url']
                task_id = cache_entry['task_id']

                # 下载视频
                _update_progress("下载", 0.1, node_id=node_id)
                video_tensor, video_info, width, height, duration_seconds, fps, frame_count = _download_video(
                    video_url,
                    progress_callback=lambda stage, progress: _update_progress(
                        "下载", progress, node_id=node_id
                    )
                )

                # 输出合并的完成日志（缓存命中）
                print(" " * 80, end="\r")  # 清除当前行
                seed_display = f"seed值：{seed}" if seed else "seed值：未设置"
                _log_dynamic(f"✓ 任务完成（缓存命中），耗时: 0.0秒 | 尺寸: {width}x{height} | 时长: {duration_seconds:.1f}s | 帧率: {fps:.0f}fps | 使用缓存,{seed_display}")

                # 进度：完成
                _update_progress("完成", 1.0, node_id=node_id)

                # 为缓存命中构建任务信息
                cache_task_info = {
                    "task_id": task_id,
                    "api_request": {
                        "note": "使用缓存视频，无API请求"
                    },
                    "usage_stats": {
                        "total_tokens": 0,
                        "input_tokens": 0,
                        "output_tokens": 0,
                        "image_tokens": 0,
                        "video_tokens": 0,
                        "audio_tokens": 0,
                    }
                }
                cache_task_info_json = json.dumps(cache_task_info, ensure_ascii=False, indent=2)

                return io.NodeOutput(
                    video_tensor,      # 第一个输出：video (图像)
                    video_url,         # 第二个输出：video_url (字符串)
                    cache_task_info_json  # 第三个输出：task_info (字符串)
                )

            _log_dynamic(f"↻ 缓存未命中，生成新任务...")

            # 1. 获取提供者
            video_provider = REGISTRY.get(provider)
            if not video_provider:
                raise ValueError(f"未知的提供者：{provider}")

            # 2. 解析pack_images输入
            _update_progress("准备", 0.2, node_id=node_id)
            images = _parse_pack_images(pack_images)

            # 3. 根据模型类型分配图像
            allocated_images = _allocate_images_for_model(
                images=images,
                provider_type=video_provider.config.provider_type,
                model_name=provider
            )

            # 4. 根据提供者类型处理不同输入
            if video_provider.config.provider_type == "r2v":
                # 参考生视频模式
                _log_dynamic(f"↻ 使用参考生视频模式：{provider}")

                # 处理视频URL输入
                video_urls = _parse_video_urls(reference_video_url)
                if not video_urls:
                    raise ValueError("参考生视频模式需要提供参考视频URL")

                # 创建虚拟视频张量列表（仅用于验证）
                reference_videos = _create_dummy_videos_for_urls(video_urls)
                _log_dynamic(f"↻ 使用 {len(video_urls)} 个参考视频URL")

                # 验证输入参数
                _update_progress("验证", 0.3, node_id=node_id)
                is_valid, error_msg = video_provider.validate_inputs(
                    prompt=prompt,
                    reference_videos=reference_videos,
                    size=size,
                    duration=duration,
                    shot_type=shot_type,
                    seed=seed,
                    negative_prompt=negative_prompt
                )
                if not is_valid:
                    raise ValueError(error_msg)
                _update_progress("验证", 1.0, node_id=node_id)

                # 构建请求载荷
                _update_progress("准备", 0.8, node_id=node_id)
                payload = video_provider.build_payload(
                    prompt=prompt,
                    reference_videos=[],  # 现在只使用video_urls
                    size=size,
                    duration=duration,
                    shot_type=shot_type,
                    watermark=watermark,
                    seed=seed,
                    negative_prompt=negative_prompt,
                    video_urls=video_urls,  # 传递视频URL
                    region=region  # 传递地区参数
                )


            elif video_provider.config.provider_type == "i2v":
                # 图生视频模式

                # 检查图像输入
                img_url = allocated_images.get("img_url")
                if not img_url:
                    raise ValueError("图生视频模式需要提供图像输入（通过pack_images输入）")

                # 验证输入参数
                _update_progress("验证", 0.3, node_id=node_id)
                is_valid, error_msg = video_provider.validate_inputs(
                    prompt=prompt,
                    reference_videos=[],  # 图生视频不需要参考视频
                    size="",  # 图生视频使用resolution参数
                    duration=duration,
                    shot_type=shot_type,
                    seed=seed,
                    negative_prompt=negative_prompt,
                    resolution=resolution  # 传递分辨率参数
                )
                if not is_valid:
                    raise ValueError(error_msg)
                _update_progress("验证", 1.0, node_id=node_id)

                # 构建请求载荷
                _update_progress("准备", 0.8, node_id=node_id)
                payload = video_provider.build_payload(
                    prompt=prompt,
                    reference_videos=[],  # 图生视频不需要参考视频
                    size="",  # 图生视频使用resolution参数
                    duration=duration,
                    shot_type=shot_type,
                    watermark=watermark,
                    seed=seed,
                    negative_prompt=negative_prompt,
                    # 图生视频特有参数
                    img_url=img_url,  # 传递单个Base64字符串
                    audio_url=audio_url,
                    resolution=resolution,
                    prompt_extend=prompt_extend,
                    template=template,
                    region=region  # 传递地区参数
                )

                # 图生视频模式日志已简化

            elif video_provider.config.provider_type == "kf2v":
                # 首尾帧生视频模式

                # 检查图像输入
                first_frame_url = allocated_images.get("first_frame_url")
                last_frame_url = allocated_images.get("last_frame_url", "")

                if not first_frame_url:
                    raise ValueError("首尾帧生视频模式需要提供首帧图像（通过pack_images输入）")

                # 验证输入参数
                _update_progress("验证", 0.3, node_id=node_id)
                is_valid, error_msg = video_provider.validate_inputs(
                    prompt=prompt,
                    reference_videos=[],  # 首尾帧不需要参考视频
                    size="",  # 首尾帧使用resolution参数
                    duration=duration,
                    shot_type="",  # 首尾帧不支持shot_type
                    seed=seed,
                    negative_prompt=negative_prompt,
                    resolution=resolution  # 传递分辨率参数
                )
                if not is_valid:
                    raise ValueError(error_msg)
                _update_progress("验证", 1.0, node_id=node_id)

                # 构建请求载荷
                _update_progress("准备", 0.8, node_id=node_id)
                payload = video_provider.build_payload(
                    prompt=prompt,
                    reference_videos=[],  # 首尾帧不需要参考视频
                    size="",  # 首尾帧使用resolution参数
                    duration=duration,
                    shot_type="",  # 首尾帧不支持shot_type
                    watermark=watermark,
                    seed=seed,
                    negative_prompt=negative_prompt,
                    # 首尾帧特有参数
                    first_frame_url=first_frame_url,
                    last_frame_url=last_frame_url,
                    resolution=resolution,
                    prompt_extend=prompt_extend,
                    template=template,
                    region=region  # 传递地区参数
                )


            else:
                raise ValueError(f"不支持的提供者类型：{video_provider.config.provider_type}")

            # 3. 获取API密钥
            _update_progress("准备", 0.5, node_id=node_id)
            api_key = KEY_STORE.get_key(key_profile) if key_profile else None
            if not api_key:
                raise ValueError("未找到API密钥，请先配置密钥")

            # 4. 创建任务
            _update_progress("创建任务", 0.1, node_id=node_id)
            task_id, request_id = video_provider.create_task(
                api_key=api_key,
                payload=payload,
                progress_callback=lambda stage, progress: _update_progress(
                    "创建任务", progress, node_id=node_id
                )
            )

            # 5. 轮询任务状态
            start_time = time.time()
            polling_count = 0
            last_result = None  # 保存最后一次查询结果

            # 初始化动态日志 - 使用更简洁的格式
            _log_dynamic("↻ 开始轮询任务状态...", end="\r")

            while time.time() - start_time < max_polling_time:
                polling_count += 1
                progress = min(0.9, polling_count * 0.1)  # 最多到90%

                _update_progress("轮询", progress, node_id=node_id)

                # 查询任务状态
                result = video_provider.query_task(
                    api_key=api_key,
                    task_id=task_id,
                    progress_callback=None,  # 移除进度回调，避免与轮询计数进度冲突
                    region=region
                )
                last_result = result  # 保存最后一次结果

                task_status = result.get("output", {}).get("task_status", "")
                elapsed_time = time.time() - start_time

                # 动态更新日志 - 更简洁的格式
                if task_status == "SUCCEEDED":
                    # 先清除动态行
                    print(" " * 80, end="\r")  # 清除当前行
                    _log_dynamic(f"✓ 任务完成，耗时: {elapsed_time:.1f}秒")
                    _update_progress("轮询", 1.0, node_id=node_id)
                    break
                elif task_status in ["FAILED", "CANCELED"]:
                    error_code = result.get("output", {}).get("code", "")
                    error_message = result.get("output", {}).get("message", "")
                    print(" " * 80, end="\r")  # 清除当前行
                    _log_dynamic(f"✗ 任务失败: {task_status}")
                    raise Exception(f"任务失败，状态：{task_status}，错误代码：{error_code}，错误信息：{error_message}")
                else:
                    # PENDING 或 RUNNING 状态，动态更新同一行
                    # 使用更简洁的格式，避免过长
                    status_display = "处理中" if task_status == "RUNNING" else "排队中"
                    _log_dynamic(f"↻ {status_display} ({elapsed_time:.0f}s)", end="\r")

                time.sleep(polling_interval)

            else:
                # 获取最后一次查询的结果，提供更多调试信息
                last_status = "未知"
                if last_result:
                    last_status = last_result.get("output", {}).get("task_status", "未知")

                raise Exception(
                    f"任务超时（{max_polling_time}秒），最后一次状态: {last_status}\n"
                    f"建议：\n"
                    f"1. 检查网络连接和API密钥\n"
                    f"2. 增加最大轮询时间（当前: {max_polling_time}秒）\n"
                    f"3. 检查任务是否在阿里云控制台中正常执行\n"
                    f"4. 对于大尺寸图像或复杂任务，可能需要更长时间"
                )

            # 6. 提取视频URL
            video_url = video_provider.extract_video_url(result)
            if not video_url:
                raise Exception("未找到视频URL")

            # 7. 下载视频
            _update_progress("下载", 0.1, node_id=node_id)
            video_tensor, video_info, width, height, duration_seconds, fps, frame_count = _download_video(
                video_url,
                progress_callback=lambda stage, progress: _update_progress(
                    "下载", progress, node_id=node_id
                )
            )

            # 8. 提取使用信息（包含API请求代码）
            usage_info = video_provider.extract_usage_info(result, payload)
            usage_json = json.dumps(usage_info, ensure_ascii=False, indent=2)

            # 9. 保存到缓存（24小时有效）
            VIDEO_CACHE.set(cache_key, task_id, video_url)

            # 10. 输出合并的完成日志
            print(" " * 80, end="\r")  # 清除当前行
            seed_display = f"seed值：{seed}" if seed else "seed值：未设置"
            _log_dynamic(f"✓ 任务完成，耗时: {elapsed_time:.1f}秒 | 尺寸: {width}x{height} | 时长: {duration_seconds:.1f}s | 帧率: {fps:.0f}fps | 缓存已保存,{seed_display}")

            # 进度：完成
            _update_progress("完成", 1.0, node_id=node_id)

            return io.NodeOutput(
                video_tensor,      # 第一个输出：video (图像)
                video_url,         # 第二个输出：video_url (字符串)
                usage_json         # 第三个输出：task_info (字符串，包含任务ID和API请求信息)
            )

        except Exception as e:
            # 更新错误进度
            _update_progress("完成", 0, node_id=node_id)
            raise e


# V3节点类导出
V3_NODE_CLASSES = [XIS_VGMOrchestratorV3]