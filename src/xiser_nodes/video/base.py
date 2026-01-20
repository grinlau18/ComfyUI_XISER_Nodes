"""视频提供者基础类"""

from abc import ABC, abstractmethod
from typing import Dict, List, Optional, Any, Tuple
import torch
from dataclasses import dataclass


@dataclass
class VideoProviderConfig:
    """视频提供者配置"""
    name: str  # 内部名称
    label: str  # 显示名称
    endpoint: str  # API端点
    model: str  # 模型名称
    supported_sizes: List[str]  # 支持的尺寸
    supported_durations: List[int]  # 支持的时长
    max_reference_videos: int  # 最大参考视频数量
    max_prompt_length: int  # 最大提示词长度
    max_negative_prompt_length: int  # 最大负面提示词长度
    # 图生视频特有配置
    provider_type: str = "r2v"  # 提供者类型：r2v（参考生视频）、i2v（图生视频-基于首帧）、kf2v（图生视频-基于首尾帧）
    supported_resolutions: List[str] = None  # 支持的分辨率档位（图生视频）
    supports_audio: bool = False  # 是否支持音频输入
    supports_multi_shot: bool = False  # 是否支持多镜头
    supports_prompt_extend: bool = False  # 是否支持prompt智能改写
    supports_template: bool = False  # 是否支持视频特效模板
    # 首尾帧特有配置
    requires_first_frame: bool = True  # 是否需要首帧图像（首尾帧模型必选）
    requires_last_frame: bool = False  # 是否需要尾帧图像（首尾帧模型可选）


class BaseVideoProvider(ABC):
    """视频提供者基础类"""

    def __init__(self, config: VideoProviderConfig):
        self.config = config

    @abstractmethod
    def build_payload(self,
                     prompt: str,
                     reference_videos: List[torch.Tensor],
                     size: str,
                     duration: int,
                     shot_type: str,
                     watermark: bool,
                     seed: int,
                     negative_prompt: str,
                     **kwargs) -> Dict[str, Any]:
        """构建API请求载荷"""
        pass

    @abstractmethod
    def create_task(self,
                   api_key: str,
                   payload: Dict[str, Any],
                   progress_callback=None) -> Tuple[str, str]:
        """创建视频生成任务"""
        pass

    @abstractmethod
    def query_task(self,
                  api_key: str,
                  task_id: str,
                  progress_callback=None) -> Dict[str, Any]:
        """查询任务状态"""
        pass

    @abstractmethod
    def extract_video_url(self, result: Dict[str, Any]) -> Optional[str]:
        """从结果中提取视频URL"""
        pass

    @abstractmethod
    def extract_usage_info(self, result: Dict[str, Any], payload: Dict[str, Any] = None) -> Dict[str, Any]:
        """从结果中提取使用信息，包括API请求代码"""
        pass

    def validate_inputs(self,
                       prompt: str,
                       reference_videos: List[torch.Tensor],
                       size: str,
                       duration: int,
                       shot_type: str,
                       seed: int,
                       negative_prompt: str,
                       **kwargs) -> Tuple[bool, str]:
        """验证输入参数"""
        # 验证提示词长度
        if len(prompt) > self.config.max_prompt_length:
            return False, f"提示词长度超过限制（最大{self.config.max_prompt_length}字符）"

        # 验证负面提示词长度
        if negative_prompt and len(negative_prompt) > self.config.max_negative_prompt_length:
            return False, f"负面提示词长度超过限制（最大{self.config.max_negative_prompt_length}字符）"

        # 根据提供者类型进行不同验证
        if self.config.provider_type == "r2v":
            # 参考生视频验证
            # 验证参考视频数量
            if len(reference_videos) > self.config.max_reference_videos:
                return False, f"参考视频数量超过限制（最多{self.config.max_reference_videos}个）"

            # 验证尺寸
            if size and size not in self.config.supported_sizes:
                return False, f"不支持的尺寸：{size}"

            # 验证镜头类型
            if shot_type not in ["single", "multi"]:
                return False, f"不支持的镜头类型：{shot_type}，支持 single 或 multi"
        elif self.config.provider_type == "i2v":
            # 图生视频验证
            # 验证分辨率（如果提供）
            resolution = kwargs.get("resolution")
            if resolution and self.config.supported_resolutions:
                if resolution not in self.config.supported_resolutions:
                    return False, f"不支持的分辨率：{resolution}，支持的分辨率为{self.config.supported_resolutions}"

            # 验证多镜头（如果模型不支持）
            if shot_type == "multi" and not self.config.supports_multi_shot:
                # 对于不支持多镜头的模型，忽略shot_type参数
                # 前端已经隐藏了shot_type控件，这里直接通过验证
                pass

            # 验证音频URL（如果模型不支持）
            audio_url = kwargs.get("audio_url")
            if audio_url and not self.config.supports_audio:
                return False, f"该模型不支持音频URL参数"

            # 验证模板（如果模型不支持）
            template = kwargs.get("template")
            if template and not self.config.supports_template:
                return False, f"该模型不支持特效模板参数"

        # 通用验证
        # 验证时长
        if duration not in self.config.supported_durations:
            return False, f"不支持的时长：{duration}，支持的时长为{self.config.supported_durations}"

        # 验证种子
        if seed < 0 or seed > 2147483647:
            return False, f"种子值超出范围（0-2147483647）"

        return True, "验证通过"


def _video_to_base64(video_tensor: torch.Tensor) -> str:
    """将视频张量转换为Base64字符串（简化版本，实际需要视频编码）"""
    # TODO: 实现视频编码为Base64
    # 这里暂时返回空字符串，实际需要实现视频编码
    return ""


def _gather_videos(video_input: Optional[torch.Tensor]) -> List[torch.Tensor]:
    """收集视频输入"""
    from ..vgm_v3 import _adapt_video_format

    videos = []

    if video_input is not None:
        # 适配视频格式
        adapted_video = _adapt_video_format(video_input)
        # 单视频输入
        videos.append(adapted_video)

    return videos