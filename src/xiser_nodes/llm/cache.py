"""LLM Seed Cache Module

提供LLM结果的种子缓存功能，避免重复调用API。
"""

from typing import Dict, List, Optional, Tuple, Any
import hashlib
import json
import torch


class SeedCache:
    """Seed结果缓存管理器（增强通用性版本）"""

    def __init__(self, max_size: int = 100, float_precision: int = 10,
                 hash_algorithm: str = 'md5', image_tolerance: float = 1e-6):
        """
        初始化缓存管理器

        Args:
            max_size: 最大缓存容量
            float_precision: 浮点数精度（小数位数）
            hash_algorithm: 哈希算法（目前仅支持'md5'）
            image_tolerance: 图像哈希容差
        """
        self.cache = {}
        self.max_size = max_size
        self.access_order = []  # 用于LRU淘汰
        self.float_precision = float_precision
        self.hash_algorithm = hash_algorithm
        self.image_tolerance = image_tolerance

        # 验证哈希算法
        if hash_algorithm != 'md5':
            raise ValueError(f"不支持的哈希算法: {hash_algorithm}，目前仅支持'md5'")

    def _generate_cache_key(self, seed: int, provider: str, instruction: str,
                           image_hash: str, params_hash: str) -> str:
        """生成缓存键"""
        key_parts = [
            f"seed:{seed}",
            f"provider:{provider}",
            f"instruction:{hashlib.md5(instruction.encode()).hexdigest()[:16]}",
            f"image:{image_hash}",
            f"params:{params_hash}"
        ]
        return "|".join(key_parts)

    def _hash_images(self, images: List[torch.Tensor]) -> str:
        """计算图像数据的哈希值（带容差支持）"""
        if not images:
            return "no_images"

        # 将图像数据转换为可哈希的字节串
        hash_str = ""
        for img in images:
            # 使用图像数据的统计信息作为哈希（避免存储完整图像数据）
            img_np = img.detach().cpu().numpy()

            # 应用容差处理
            mean_val = float(img_np.mean())
            std_val = float(img_np.std())
            min_val = float(img_np.min())
            max_val = float(img_np.max())

            if self.image_tolerance > 0:
                # 对统计值进行容差归一化
                mean_val = round(mean_val / self.image_tolerance) * self.image_tolerance
                std_val = round(std_val / self.image_tolerance) * self.image_tolerance
                min_val = round(min_val / self.image_tolerance) * self.image_tolerance
                max_val = round(max_val / self.image_tolerance) * self.image_tolerance

            stats = {
                'shape': img_np.shape,
                'mean': mean_val,
                'std': std_val,
                'min': min_val,
                'max': max_val
            }
            stats_json = json.dumps(stats, sort_keys=True)
            hash_str += hashlib.md5(stats_json.encode()).hexdigest()[:8]

        return hash_str[:32]  # 限制长度

    def _normalize_value(self, value):
        """递归规范化值，处理所有嵌套结构中的浮点数"""
        if isinstance(value, float):
            # 对浮点数进行四舍五入，避免精度差异
            return round(value, self.float_precision)
        elif isinstance(value, (list, tuple)):
            # 处理列表和元组
            return [self._normalize_value(v) for v in value]
        elif isinstance(value, dict):
            # 处理字典
            return {k: self._normalize_value(v) for k, v in value.items()}
        elif hasattr(value, '__dict__'):
            # 处理自定义对象（转换为字典）
            return self._normalize_value(value.__dict__)
        else:
            # 其他类型直接返回
            return value

    def _hash_params(self, **kwargs) -> str:
        """计算参数的哈希值"""
        # 过滤掉None值
        filtered_params = {}
        for key, value in kwargs.items():
            # 跳过None值
            if value is None:
                continue

            # 规范化值（处理浮点数精度和嵌套结构）
            normalized_value = self._normalize_value(value)
            filtered_params[key] = normalized_value

        # 按key排序确保一致性
        params_json = json.dumps(filtered_params, sort_keys=True)
        return hashlib.md5(params_json.encode()).hexdigest()

    def get(self, seed: int, provider: str, instruction: str,
            images: List[torch.Tensor], **params) -> Optional[Tuple[str, List[torch.Tensor], List[str]]]:
        """从缓存获取结果"""
        if seed < 0:  # 只缓存固定seed（≥0）的结果
            return None

        image_hash = self._hash_images(images)
        params_hash = self._hash_params(**params)
        cache_key = self._generate_cache_key(seed, provider, instruction, image_hash, params_hash)

        if cache_key in self.cache:
            # 更新访问顺序（LRU）
            self.access_order.remove(cache_key)
            self.access_order.append(cache_key)
            return self.cache[cache_key]

        return None

    def set(self, seed: int, provider: str, instruction: str,
            images: List[torch.Tensor], result: Tuple[str, List[torch.Tensor], List[str]], **params):
        """设置缓存结果"""
        if seed < 0:  # 只缓存固定seed（≥0）的结果
            return

        image_hash = self._hash_images(images)
        params_hash = self._hash_params(**params)
        cache_key = self._generate_cache_key(seed, provider, instruction, image_hash, params_hash)

        # 检查缓存大小，执行LRU淘汰
        if len(self.cache) >= self.max_size:
            oldest_key = self.access_order.pop(0)
            del self.cache[oldest_key]

        self.cache[cache_key] = result
        self.access_order.append(cache_key)

    def clear(self):
        """清空缓存"""
        self.cache.clear()
        self.access_order.clear()

    def size(self) -> int:
        """返回缓存大小"""
        return len(self.cache)


# 全局缓存实例（使用增强配置）
SEED_CACHE = SeedCache(
    max_size=50,
    float_precision=10,      # 浮点数精度：10位小数
    hash_algorithm='md5',    # 哈希算法
    image_tolerance=1e-6     # 图像哈希容差
)


__all__ = [
    "SeedCache",
    "SEED_CACHE",
]