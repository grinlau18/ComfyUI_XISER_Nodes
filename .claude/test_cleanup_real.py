#!/usr/bin/env python3
"""
真实场景测试：模拟接近token限制的对话
"""

from conversation_manager_simple import ConversationManagerSimple

def create_very_large_conversation():
    """创建一个非常大的对话，确保超过token限制"""
    messages = []

    # 添加大量内容丰富的消息
    for i in range(200):  # 200条消息
        if i % 10 == 0:
            # 非常重要的消息：长代码块
            messages.append({
                "role": "user",
                "content": f"重要功能请求 #{i//10+1}：请实现一个完整的类来处理 `/project/src/module_{i//10+1}.py` 文件。需要包含错误处理、日志记录和单元测试。"
            })
            messages.append({
                "role": "assistant",
                "content": f"""```python
# module_{i//10+1}.py - 重要功能实现
import os
import logging
from typing import List, Dict, Optional

logger = logging.getLogger(__name__)

class Module{i//10+1}:
    \"\"\"处理文件操作的重要类\"\"\"

    def __init__(self, base_path: str = "/project/src"):
        self.base_path = base_path
        self._cache = {{}}

    def process_file(self, filename: str) -> Dict[str, any]:
        \"\"\"处理文件的核心方法\"\"\"
        filepath = os.path.join(self.base_path, filename)

        if not os.path.exists(filepath):
            logger.error(f"文件不存在: {{filepath}}")
            raise FileNotFoundError(f"文件不存在: {{filepath}}")

        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()

            # 复杂的处理逻辑
            result = {{
                'filename': filename,
                'path': filepath,
                'size': len(content),
                'lines': content.count('\\n'),
                'processed': True
            }}

            self._cache[filename] = result
            logger.info(f"成功处理文件: {{filename}}")
            return result

        except Exception as e:
            logger.exception(f"处理文件失败: {{filename}}")
            raise

    def get_stats(self) -> Dict[str, any]:
        \"\"\"获取统计信息\"\"\"
        return {{
            'total_files': len(self._cache),
            'cache_size': sum(item['size'] for item in self._cache.values()),
            'status': 'active'
        }}

# 单元测试
def test_module_{i//10+1}():
    \"\"\"单元测试\"\"\"
    module = Module{i//10+1}()
    # 测试代码...
    assert module.get_stats()['status'] == 'active'
    print("测试通过")

if __name__ == "__main__":
    test_module_{i//10+1}()
```
这是第{i//10+1}个重要功能的完整实现，包含错误处理、日志记录和单元测试。"""
            })
        elif i % 5 == 0:
            # 中等重要消息：文件操作
            messages.append({
                "role": "user",
                "content": f"请检查 `/var/log/app_{i//5+1}.log` 文件，分析其中的错误信息。"
            })
            messages.append({
                "role": "assistant",
                "content": f"已分析 `/var/log/app_{i//5+1}.log` 文件，发现3个警告和1个错误。建议检查配置文件 `/etc/app/config_{i//5+1}.yml`。"
            })
        else:
            # 闲聊消息（可清理）
            messages.append({
                "role": "user",
                "content": f"第{i+1}次交流，今天天气不错，我们来讨论一些轻松的话题。你觉得这个方案怎么样？我认为可能需要进一步考虑，但总体方向是对的。"
            })
            messages.append({
                "role": "assistant",
                "content": f"是的，我同意你的看法。第{i+1}条回复：这个方向确实值得探讨，我们可以继续深入讨论细节。不过具体实施还需要更多考虑。"
            })

    return messages

def test_real_scenario():
    """测试真实场景"""
    print("=" * 80)
    print("真实场景测试：模拟Claude Code长时间对话")
    print("=" * 80)

    # 使用真实的Claude Sonnet 4.5 token限制
    MAX_TOKENS = 128000  # Claude Sonnet 4.5的token限制
    manager = ConversationManagerSimple(max_tokens=MAX_TOKENS, safety_margin=0.15)

    # 创建对话
    print("\n📥 创建模拟对话...")
    messages = create_very_large_conversation()

    print(f"   创建了 {len(messages)} 条消息")

    # 获取统计信息
    stats = manager.get_conversation_stats(messages)

    print("\n📊 对话统计:")
    print(f"   📋 总消息数: {stats['total_messages']}")
    print(f"   🧮 总token数: {stats['total_tokens']:,} / {stats['token_limit']:,}")
    print(f"   📈 使用率: {stats['token_usage_percent']:.1f}%")
    print(f"   ⭐ 重要消息: {stats['important_messages']}条")
    print(f"   💻 代码块: {stats['code_blocks']}个")
    print(f"   📁 文件引用: {stats['file_references']}个")

    # 检查状态
    SAFETY_THRESHOLD = (1 - manager.safety_margin) * 100
    print(f"\n🔐 安全设置:")
    print(f"   Token限制: {MAX_TOKENS:,}")
    print(f"   安全边界: {manager.safety_margin*100:.0f}%")
    print(f"   清理阈值: {SAFETY_THRESHOLD:.0f}%")

    needs_cleanup = stats['needs_cleanup']
    status_icon = "⚠️" if needs_cleanup else "✅"
    status_text = "需要清理" if needs_cleanup else "状态正常"

    print(f"\n{status_icon} 状态检查: {status_text}")

    if needs_cleanup:
        print(f"   原因: 使用率 {stats['token_usage_percent']:.1f}% > 清理阈值 {SAFETY_THRESHOLD:.0f}%")

        # 创建清理计划
        print(f"\n📋 创建清理计划...")
        TARGET_PERCENT = 70  # 目标保留70%容量
        target_tokens = int(MAX_TOKENS * (TARGET_PERCENT / 100))

        plan = manager.create_cleanup_plan(messages, target_tokens)

        print(f"\n🎯 清理目标:")
        print(f"   目标使用率: {TARGET_PERCENT}%")
        print(f"   目标token: {target_tokens:,}")

        print(f"\n📊 清理计划详情:")
        print(f"   原始消息: {len(messages)}条")
        print(f"   保留消息: {len(plan['messages_to_keep'])}条 ({len(plan['messages_to_keep'])/len(messages)*100:.1f}%)")
        print(f"   清理消息: {len(plan['messages_to_remove'])}条 ({len(plan['messages_to_remove'])/len(messages)*100:.1f}%)")
        print(f"   Token减少: {plan['current_tokens']:,} → {plan['remaining_tokens']:,}")
        print(f"   使用率降低: {plan['current_tokens']/MAX_TOKENS*100:.1f}% → {plan['remaining_tokens']/MAX_TOKENS*100:.1f}%")

        # 分析清理策略效果
        print(f"\n🔍 清理策略分析:")

        # 重要消息保留率
        important_kept = sum(1 for idx in plan['messages_to_keep']
                           if idx in plan['important_messages'])
        important_total = len(plan['important_messages'])
        important_ratio = important_kept / important_total * 100 if important_total > 0 else 0

        print(f"   重要消息保留: {important_kept}/{important_total} ({important_ratio:.1f}%)")

        # 代码块保留率
        code_messages = [i for i, msg in enumerate(messages) if "```" in msg.get("content", "")]
        code_kept = sum(1 for idx in plan['messages_to_keep'] if idx in code_messages)
        code_ratio = code_kept / len(code_messages) * 100 if code_messages else 0

        print(f"   代码消息保留: {code_kept}/{len(code_messages)} ({code_ratio:.1f}%)")

        # 执行清理
        print(f"\n🔄 执行清理操作...")
        cleaned_messages = manager.cleanup_conversation(messages, plan)

        # 验证结果
        cleaned_stats = manager.get_conversation_stats(cleaned_messages)

        print(f"\n✅ 清理完成!")
        print(f"   📦 消息数量: {len(messages)} → {len(cleaned_messages)}")
        print(f"   🧮 Token数量: {plan['current_tokens']:,} → {cleaned_stats['total_tokens']:,}")
        print(f"   📈 使用率: {plan['current_tokens']/MAX_TOKENS*100:.1f}% → {cleaned_stats['token_usage_percent']:.1f}%")

        # 检查清理总结
        summary_count = sum(1 for msg in cleaned_messages
                          if msg.get("role") == "system" and "清理总结" in msg.get("content", ""))

        print(f"\n📝 清理总结: {'已添加' if summary_count > 0 else '未添加'}")

        if summary_count > 0:
            summary_msg = next(msg for msg in cleaned_messages
                             if msg.get("role") == "system" and "清理总结" in msg.get("content", ""))
            summary_preview = summary_msg.get("content", "")[:100] + "..."
            print(f"   总结预览: {summary_preview}")

        # 最终状态
        print(f"\n🎉 最终状态:")
        final_needs_cleanup = manager.should_cleanup(cleaned_messages)

        if not final_needs_cleanup:
            print(f"   ✅ 对话已优化，可以安全继续")
            print(f"   📊 当前使用率: {cleaned_stats['token_usage_percent']:.1f}%")
            print(f"   🔒 安全边界: {SAFETY_THRESHOLD - cleaned_stats['token_usage_percent']:.1f}%")
        else:
            print(f"   ⚠️  仍需进一步清理")
            print(f"   📊 当前使用率: {cleaned_stats['token_usage_percent']:.1f}%")
            print(f"   🚨 仍超过阈值: {cleaned_stats['token_usage_percent'] - SAFETY_THRESHOLD:.1f}%")

    print("\n" + "=" * 80)
    print("测试完成！")
    print("=" * 80)

def demonstrate_usage():
    """演示实际使用方法"""
    print("\n" + "=" * 80)
    print("实际使用演示")
    print("=" * 80)

    print("""
在Claude Code中，你可以通过以下方式使用对话清理功能：

1. **手动检查状态**:
   ```
   /conversation-stats
   ```

2. **手动清理历史**:
   ```
   /clean-history 70
   ```

3. **自动清理** (通过hook):
   - 当对话接近token限制时自动触发
   - 保留重要内容，清理闲聊
   - 添加清理总结保持连贯性

4. **最佳实践**:
   - 定期检查对话状态
   - 在开始大型任务前主动清理
   - 使用特定格式标记重要内容

示例标记:
   ```
   [重要] 关键架构决策
   [文件] /path/to/important.py
   [代码] 核心功能实现
   ```
""")

    print("\n" + "=" * 80)

if __name__ == "__main__":
    test_real_scenario()
    demonstrate_usage()