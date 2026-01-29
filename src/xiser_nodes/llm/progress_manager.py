"""进度管理器 - 统一协调节点和提供者之间的进度更新"""

import logging
from typing import Dict, List, Optional, Callable
from comfy_api.v0_0_2 import ComfyAPISync

from ..utils import logger

# 创建API实例用于进度更新
api_sync = ComfyAPISync()

class StageMapping:
    """阶段映射配置"""

    def __init__(self, stages: List[str], total_stages: Optional[int] = None):
        """
        初始化阶段映射

        Args:
            stages: 阶段名称列表，按顺序排列
            total_stages: 总阶段数，默认为阶段列表长度
        """
        self.stages = stages
        self.stage_to_index = {stage: i for i, stage in enumerate(stages)}
        self.total_stages = total_stages or len(stages)

    def get_stage_index(self, stage: str) -> int:
        """获取阶段索引，如果阶段不存在则返回0"""
        return self.stage_to_index.get(stage, 0)

    def is_valid_stage(self, stage: str) -> bool:
        """检查阶段是否有效"""
        return stage in self.stage_to_index

class ProgressManager:
    """进度管理器"""

    # 预定义阶段映射
    LLM_ORCHESTRATOR_STAGES = ["准备", "验证", "连接", "处理", "轮询", "流式", "解析", "完成"]
    QWEN_VL_LOCAL_STAGES = ["准备", "加载模型", "处理", "推理", "解析", "完成"]

    def __init__(self, node_id: str = "", stage_mapping: Optional[StageMapping] = None):
        """
        初始化进度管理器

        Args:
            node_id: 节点ID，用于进度更新
            stage_mapping: 阶段映射配置，如果为None则使用默认映射
        """
        self.node_id = node_id
        self.stage_mapping = stage_mapping or StageMapping(self.LLM_ORCHESTRATOR_STAGES)
        self._current_stage = ""
        self._current_progress = 0.0

    def update(self, stage: str, progress: float) -> None:
        """
        更新进度

        Args:
            stage: 当前阶段名称
            progress: 当前阶段进度 (0-1)
        """
        try:
            self._current_stage = stage
            self._current_progress = progress

            # 计算整体进度
            stage_index = self.stage_mapping.get_stage_index(stage)
            base_progress = (stage_index / self.stage_mapping.total_stages) * 100
            stage_progress = progress * (100 / self.stage_mapping.total_stages)
            total_progress = min(base_progress + stage_progress, 100)

            # 更新进度
            api_sync.execution.set_progress(
                value=total_progress,
                max_value=100.0,
                node_id=self.node_id
            )

            logger.debug(f"Progress updated: stage={stage}, progress={progress:.2f}, total={total_progress:.1f}%")

        except Exception as e:
            # 进度更新失败不影响主要功能
            logger.debug(f"Progress update failed: {e}")

    def create_callback(self) -> Callable[[str, float], None]:
        """
        创建进度回调函数

        返回:
            回调函数，接受(stage, progress)参数
        """
        return lambda stage, progress: self.update(stage, progress)

    def get_qwen_vl_mapping(self) -> StageMapping:
        """获取Qwen3-VL本地节点的阶段映射"""
        return StageMapping(self.QWEN_VL_LOCAL_STAGES)

    def get_llm_orchestrator_mapping(self) -> StageMapping:
        """获取LLM编排器节点的阶段映射"""
        return StageMapping(self.LLM_ORCHESTRATOR_STAGES)

    @classmethod
    def create_for_qwen_vl(cls, node_id: str = "") -> 'ProgressManager':
        """为Qwen3-VL节点创建进度管理器"""
        stages = cls.QWEN_VL_LOCAL_STAGES
        return cls(node_id, StageMapping(stages))

    @classmethod
    def create_for_llm_orchestrator(cls, node_id: str = "") -> 'ProgressManager':
        """为LLM编排器节点创建进度管理器"""
        stages = cls.LLM_ORCHESTRATOR_STAGES
        return cls(node_id, StageMapping(stages))

    # 兼容旧版_update_progress函数
    @staticmethod
    def update_progress(stage: str, progress: float, total_stages: int = 8, node_id: str = "") -> None:
        """
        静态方法，兼容旧版_update_progress函数

        Args:
            stage: 当前阶段描述
            progress: 当前阶段进度 (0-1)
            total_stages: 总阶段数
            node_id: 节点ID
        """
        try:
            # 创建临时阶段映射（假设阶段索引从0开始）
            # 注意：这个方法不支持阶段名称映射，只支持阶段索引
            stage_index = {
                "准备": 0, "验证": 1, "连接": 2, "处理": 3,
                "轮询": 4, "流式": 5, "解析": 6, "完成": 7
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

        except Exception as e:
            # 进度更新失败不影响主要功能
            logger.debug(f"Progress update failed: {e}")

    @staticmethod
    def update_progress_for_qwen_vl(stage: str, progress: float, node_id: str = "") -> None:
        """
        静态方法，专为Qwen3-VL节点设计的进度更新

        Args:
            stage: 当前阶段描述
            progress: 当前阶段进度 (0-1)
            node_id: 节点ID
        """
        try:
            # Qwen3-VL阶段映射
            stage_index = {
                "准备": 0, "加载模型": 1, "处理": 2, "推理": 3, "解析": 4, "完成": 5
            }.get(stage, 0)
            total_stages = 6

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
            logger.debug(f"Progress update for Qwen-VL failed: {e}")

# 全局进度管理器实例（可选）
_global_progress_manager: Optional[ProgressManager] = None

def get_global_progress_manager() -> ProgressManager:
    """获取全局进度管理器实例"""
    global _global_progress_manager
    if _global_progress_manager is None:
        _global_progress_manager = ProgressManager()
    return _global_progress_manager