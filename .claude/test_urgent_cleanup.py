#!/usr/bin/env python3
"""
紧急清理测试：模拟对话即将超出token限制的场景
"""

from conversation_manager_simple import ConversationManagerSimple

def create_critical_conversation():
    """创建一个即将超出token限制的紧急对话"""
    messages = []

    # 添加大量长消息，模拟长时间开发对话
    for i in range(100):
        # 每条消息都很长，包含大量内容
        if i % 3 == 0:
            # 超长代码消息
            messages.append({
                "role": "assistant",
                "content": f"""```python
# 模块{i//3+1} - 完整实现
{"#" * 80}
# 这是一个非常重要的模块，包含多个类和函数
# 用于处理复杂的业务逻辑和数据转换
{"#" * 80}

import asyncio
import json
import logging
from dataclasses import dataclass
from typing import List, Dict, Any, Optional, Union
from pathlib import Path
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

@dataclass
class DataRecord:
    \"\"\"数据记录类\"\"\"
    id: str
    timestamp: datetime
    value: float
    metadata: Dict[str, Any]
    tags: List[str]

    def to_dict(self) -> Dict[str, Any]:
        return {{
            'id': self.id,
            'timestamp': self.timestamp.isoformat(),
            'value': self.value,
            'metadata': self.metadata,
            'tags': self.tags
        }}

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'DataRecord':
        return cls(
            id=data['id'],
            timestamp=datetime.fromisoformat(data['timestamp']),
            value=data['value'],
            metadata=data['metadata'],
            tags=data['tags']
        )

class DataProcessor:
    \"\"\"数据处理器的核心类\"\"\"

    def __init__(self, config_path: str = "/etc/app/config.json"):
        self.config_path = config_path
        self._load_config()
        self._cache = {{}}
        self._metrics = {{'processed': 0, 'errors': 0}}

    def _load_config(self):
        \"\"\"加载配置文件\"\"\"
        try:
            with open(self.config_path, 'r') as f:
                self.config = json.load(f)
            logger.info(f"配置文件加载成功: {{self.config_path}}")
        except Exception as e:
            logger.error(f"配置文件加载失败: {{e}}")
            self.config = {{'default': True}}

    async def process_batch(self, records: List[DataRecord]) -> List[Dict[str, Any]]:
        \"\"\"批量处理记录\"\"\"
        results = []
        tasks = [self._process_single(record) for record in records]

        for task in asyncio.as_completed(tasks):
            try:
                result = await task
                results.append(result)
                self._metrics['processed'] += 1
            except Exception as e:
                logger.error(f"处理失败: {{e}}")
                self._metrics['errors'] += 1

        return results

    async def _process_single(self, record: DataRecord) -> Dict[str, Any]:
        \"\"\"处理单个记录\"\"\"
        await asyncio.sleep(0.01)  # 模拟处理延迟

        # 复杂的业务逻辑
        processed = {{
            'id': record.id,
            'processed_at': datetime.now().isoformat(),
            'original_value': record.value,
            'transformed_value': record.value * self.config.get('multiplier', 1.0),
            'has_metadata': bool(record.metadata),
            'tag_count': len(record.tags)
        }}

        # 缓存结果
        self._cache[record.id] = {{
            'record': record.to_dict(),
            'processed': processed,
            'timestamp': datetime.now()
        }}

        return processed

    def get_metrics(self) -> Dict[str, Any]:
        \"\"\"获取性能指标\"\"\"
        return {{
            **self._metrics,
            'cache_size': len(self._cache),
            'config_loaded': bool(self.config),
            'uptime': datetime.now() - self._start_time if hasattr(self, '_start_time') else timedelta(0)
        }}

    def cleanup_cache(self, max_age_hours: int = 24):
        \"\"\"清理缓存\"\"\"
        cutoff = datetime.now() - timedelta(hours=max_age_hours)
        to_remove = [
            key for key, value in self._cache.items()
            if value['timestamp'] < cutoff
        ]

        for key in to_remove:
            del self._cache[key]

        logger.info(f"清理了 {{len(to_remove)}} 个过期缓存项")

# 工厂函数
def create_processor(config_path: Optional[str] = None) -> DataProcessor:
    \"\"\"创建处理器实例\"\"\"
    return DataProcessor(config_path or "/etc/app/default_config.json")

# 单元测试
import unittest

class TestDataProcessor(unittest.TestCase):
    \"\"\"单元测试类\"\"\"

    def setUp(self):
        self.processor = create_processor()

    def test_process_single(self):
        \"\"\"测试单个记录处理\"\"\"
        record = DataRecord(
            id="test-1",
            timestamp=datetime.now(),
            value=100.0,
            metadata={{"source": "test"}},
            tags=["test", "unit"]
        )

        # 测试代码...
        self.assertEqual(record.value, 100.0)

    def test_metrics(self):
        \"\"\"测试指标收集\"\"\"
        metrics = self.processor.get_metrics()
        self.assertIn('processed', metrics)
        self.assertIn('errors', metrics)

if __name__ == "__main__":
    # 启动处理器
    processor = create_processor()
    print(f"处理器已启动，配置路径: {{processor.config_path}}")

    # 运行测试
    unittest.main(argv=[''], exit=False)
```
这是第{i//3+1}个完整模块的实现，包含异步处理、配置管理、缓存系统和单元测试。"""
            })
        else:
            # 长文本讨论
            messages.append({
                "role": "user",
                "content": f"""这是第{i+1}条详细讨论消息，我们正在深入探讨一个复杂的技术问题。

问题背景：我们需要设计一个高性能的分布式系统，用于处理实时数据流。系统需要满足以下要求：

1. **可扩展性**：能够水平扩展以处理每秒百万级的事件
2. **容错性**：单个节点故障不影响整体系统运行
3. **低延迟**：端到端延迟小于100毫秒
4. **数据一致性**：确保数据在不同节点间的一致性
5. **监控和告警**：完善的监控体系和实时告警

技术选型考虑：
- 消息队列：Kafka vs RabbitMQ vs Redis Streams
- 数据库：PostgreSQL vs Cassandra vs MongoDB
- 缓存：Redis vs Memcached
- 容器编排：Kubernetes vs Docker Swarm

架构设计要点：
1. 采用微服务架构，每个服务独立部署
2. 使用API网关进行请求路由和负载均衡
3. 实现服务发现和配置中心
4. 建立完善的日志和监控体系
5. 设计自动化部署和回滚机制

具体实现步骤：
1. 搭建基础架构（Kubernetes集群、监控系统）
2. 实现核心服务（数据采集、处理、存储）
3. 开发管理界面和API
4. 进行性能测试和优化
5. 部署到生产环境

这是一个长期项目，预计需要3-6个月完成。我们需要定期review进度，调整技术方案。

当前进展：已完成技术选型和架构设计，开始搭建开发环境。

下一步计划：
1. 搭建开发环境（本周）
2. 实现核心数据模型（下周）
3. 开发第一个微服务（下下周）

请提供具体的技术建议和实现细节。"""
            })

    return messages

def test_critical_scenario():
    """测试紧急清理场景"""
    print("=" * 90)
    print("⚠️ 紧急清理测试：模拟对话即将超出token限制")
    print("=" * 90)

    # 设置较小的token限制以模拟紧急情况
    MAX_TOKENS = 50000  # 较小的限制
    manager = ConversationManagerSimple(max_tokens=MAX_TOKENS, safety_margin=0.1)  # 较小的安全边界

    print(f"\n🎯 测试配置:")
    print(f"   Token限制: {MAX_TOKENS:,}")
    print(f"   安全边界: {manager.safety_margin*100:.0f}%")
    print(f"   清理阈值: {(1-manager.safety_margin)*100:.0f}%")

    # 创建紧急对话
    print(f"\n📥 创建紧急对话场景...")
    messages = create_critical_conversation()

    # 手动设置高token使用（模拟实际情况）
    # 由于我们的估算方法简单，这里直接设置一个高值
    print(f"   创建了 {len(messages)} 条超长消息")

    # 获取统计信息
    stats = manager.get_conversation_stats(messages)

    print(f"\n📊 紧急状态统计:")
    print(f"   📋 总消息数: {stats['total_messages']}")
    print(f"   🧮 总token数: {stats['total_tokens']:,} / {stats['token_limit']:,}")
    print(f"   📈 使用率: {stats['token_usage_percent']:.1f}%")
    print(f"   ⭐ 重要消息: {stats['important_messages']}条")
    print(f"   💻 代码块: {stats['code_blocks']}个")

    # 检查是否需要紧急清理
    needs_cleanup = stats['needs_cleanup']
    CLEANUP_THRESHOLD = (1 - manager.safety_margin) * 100

    if needs_cleanup:
        print(f"\n🚨 紧急状态: 需要立即清理!")
        print(f"   原因: 使用率 {stats['token_usage_percent']:.1f}% > 紧急阈值 {CLEANUP_THRESHOLD:.0f}%")
        print(f"   ⚠️  如果不清理，对话可能随时中断!")

        # 紧急清理计划（目标保留50%容量）
        TARGET_PERCENT = 50
        target_tokens = int(MAX_TOKENS * (TARGET_PERCENT / 100))

        print(f"\n📋 创建紧急清理计划...")
        print(f"   目标: 将使用率降低到 {TARGET_PERCENT}%")
        print(f"   目标token: {target_tokens:,}")

        plan = manager.create_cleanup_plan(messages, target_tokens)

        print(f"\n🔧 清理策略:")
        print(f"   1. 优先清理低重要性消息")
        print(f"   2. 清理早期非关键讨论")
        print(f"   3. 保留所有代码实现")
        print(f"   4. 保留最近的重要决策")

        print(f"\n📊 清理计划详情:")
        print(f"   原始消息: {len(messages)}条")
        print(f"   保留消息: {len(plan['messages_to_keep'])}条")
        print(f"   清理消息: {len(plan['messages_to_remove'])}条")
        print(f"   清理比例: {len(plan['messages_to_remove'])/len(messages)*100:.1f}%")
        print(f"   Token减少: {plan['current_tokens']:,} → {plan['remaining_tokens']:,}")
        print(f"   使用率降低: {plan['current_tokens']/MAX_TOKENS*100:.1f}% → {plan['remaining_tokens']/MAX_TOKENS*100:.1f}%")

        # 执行紧急清理
        print(f"\n🔄 执行紧急清理...")
        cleaned_messages = manager.cleanup_conversation(messages, plan)

        # 验证结果
        cleaned_stats = manager.get_conversation_stats(cleaned_messages)

        print(f"\n✅ 紧急清理完成!")
        print(f"   📦 消息数量: {len(messages)} → {len(cleaned_messages)}")
        print(f"   🧮 Token数量: {plan['current_tokens']:,} → {cleaned_stats['total_tokens']:,}")
        print(f"   📈 使用率: {plan['current_tokens']/MAX_TOKENS*100:.1f}% → {cleaned_stats['token_usage_percent']:.1f}%")

        # 检查关键内容保留情况
        code_messages_before = sum(1 for msg in messages if "```" in msg.get("content", ""))
        code_messages_after = sum(1 for msg in cleaned_messages if "```" in msg.get("content", ""))

        print(f"\n🔍 关键内容保留检查:")
        print(f"   代码块保留: {code_messages_after}/{code_messages_before} ({code_messages_after/code_messages_before*100:.1f}%)")

        # 检查是否有清理总结
        has_summary = any(msg.get("role") == "system" for msg in cleaned_messages)
        print(f"   清理总结: {'已添加' if has_summary else '未添加'}")

        # 最终安全状态
        final_needs_cleanup = manager.should_cleanup(cleaned_messages)

        print(f"\n🎉 最终安全状态:")
        if not final_needs_cleanup:
            print(f"   ✅ 紧急状态解除!")
            print(f"   📊 当前使用率: {cleaned_stats['token_usage_percent']:.1f}%")
            print(f"   🔒 安全边界: {CLEANUP_THRESHOLD - cleaned_stats['token_usage_percent']:.1f}%")
            print(f"   🎯 可以安全继续对话")
        else:
            print(f"   ⚠️  仍需进一步清理")
            print(f"   📊 当前使用率: {cleaned_stats['token_usage_percent']:.1f}%")
            print(f"   🚨 仍超过阈值: {cleaned_stats['token_usage_percent'] - CLEANUP_THRESHOLD:.1f}%")

        # 显示清理后的消息摘要
        print(f"\n📝 清理后对话摘要:")
        for i, msg in enumerate(cleaned_messages[:5]):  # 只显示前5条
            role = msg.get("role", "unknown")
            content = msg.get("content", "")
            preview = content[:80] + "..." if len(content) > 80 else content

            icon = "💎" if "```" in content else "📝"
            print(f"   {icon} [{i:2d}] {role}: {preview}")

        if len(cleaned_messages) > 5:
            print(f"   ... 还有 {len(cleaned_messages)-5} 条消息")

    else:
        print(f"\n✅ 当前状态正常，无需紧急清理")
        print(f"   使用率: {stats['token_usage_percent']:.1f}%")
        print(f"   安全边界: {CLEANUP_THRESHOLD - stats['token_usage_percent']:.1f}%")

    print(f"\n💡 使用建议:")
    print(f"   1. 定期使用 `/conversation-stats` 检查状态")
    print(f"   2. 当使用率超过70%时主动清理")
    print(f"   3. 重要内容使用特定格式标记")
    print(f"   4. 长时间对话分段进行")

    print(f"\n" + "=" * 90)
    print("测试完成！")
    print("=" * 90)

if __name__ == "__main__":
    test_critical_scenario()