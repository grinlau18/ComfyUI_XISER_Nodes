#!/usr/bin/env python3
"""
Claude Code 自动对话清理Hook
在每次命令执行前检查对话token使用情况，自动清理历史记录
"""

import sys
import os
import json
from pathlib import Path

# 添加项目路径以便导入对话管理器
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root / ".claude"))

try:
    from conversation_manager import ConversationManager
    IMPORT_SUCCESS = True
except ImportError as e:
    IMPORT_SUCCESS = False
    print(f"[Hook Warning] 无法导入对话管理器: {e}")

def pre_command_hook(context):
    """
    Claude Code pre-command hook
    在命令执行前自动检查并清理对话历史

    Args:
        context: Claude Code提供的上下文对象
    """
    if not IMPORT_SUCCESS:
        return context

    try:
        # 获取当前对话消息
        # 注意：实际实现中需要从Claude Code API获取消息
        # 这里使用模拟数据演示逻辑
        messages = get_conversation_messages(context)

        if not messages:
            return context

        # 初始化对话管理器（根据使用的Claude模型调整）
        # Claude Sonnet 4.5: 128K tokens
        # Claude Opus 4.5: 200K tokens
        # Claude Haiku: 200K tokens
        manager = ConversationManager(max_tokens=128000, safety_margin=0.15)

        # 检查是否需要清理
        if manager.should_cleanup(messages):
            print("[自动清理] 检测到对话接近token限制，开始清理...")

            # 获取统计信息
            stats = manager.get_conversation_stats(messages)
            print(f"[自动清理] 当前使用: {stats['total_tokens']:,} tokens ({stats['token_usage_percent']:.1f}%)")

            # 创建清理计划（目标保留70%容量）
            target_tokens = int(manager.max_tokens * 0.7)
            plan = manager.create_cleanup_plan(messages, target_tokens)

            if plan["needs_cleanup"]:
                # 执行清理
                cleaned_messages = manager.cleanup_conversation(messages, plan)

                print(f"[自动清理] 完成清理: {len(messages)} → {len(cleaned_messages)} 条消息")
                print(f"[自动清理] Token减少: {plan['current_tokens']:,} → {plan['remaining_tokens']:,}")

                # 更新对话消息
                # 注意：实际实现中需要调用Claude Code API更新消息
                update_conversation_messages(context, cleaned_messages)

                # 添加用户提示
                add_user_notification(context, plan)

    except Exception as e:
        print(f"[Hook Error] 自动清理失败: {e}")
        import traceback
        traceback.print_exc()

    return context

def get_conversation_messages(context):
    """
    从Claude Code上下文获取对话消息

    注意：这是一个示例实现，实际需要根据Claude Code API调整
    """
    # 这里应该调用Claude Code的API获取当前对话消息
    # 由于Claude Code的API可能有限制，这里返回空列表
    # 实际使用时需要根据Claude Code的文档实现

    # 示例：从环境变量或文件读取消息
    messages_file = Path.home() / ".claude_code" / "current_conversation.json"
    if messages_file.exists():
        try:
            with open(messages_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            pass

    return []

def update_conversation_messages(context, messages):
    """
    更新Claude Code对话消息

    注意：这是一个示例实现，实际需要根据Claude Code API调整
    """
    # 这里应该调用Claude Code的API更新对话消息
    # 实际使用时需要根据Claude Code的文档实现

    # 示例：保存到文件
    messages_file = Path.home() / ".claude_code" / "current_conversation.json"
    messages_file.parent.mkdir(parents=True, exist_ok=True)

    try:
        with open(messages_file, 'w', encoding='utf-8') as f:
            json.dump(messages, f, ensure_ascii=False, indent=2)
    except:
        pass

def add_user_notification(context, plan):
    """
    添加用户通知消息
    """
    notification = f"""🤖 **自动对话清理完成**

为了确保对话不中断，已自动清理历史记录：

📊 **清理统计**
- 清理消息: {len(plan['messages_to_remove'])} 条
- 保留消息: {len(plan['messages_to_keep'])} 条
- Token使用: {plan['current_tokens']:,} → {plan['remaining_tokens']:,}

🔧 **清理策略**
- 保留了所有代码修改和文件操作
- 保留了重要决策和最近对话
- 清理了早期闲聊和重复内容

💡 **建议**
- 使用 `/conversation-stats` 查看当前状态
- 使用 `/clean-history` 手动清理
- 重要内容请明确标记以便优先保留

对话已优化，可以继续工作！"""

    # 这里应该将通知添加到对话中
    # 实际实现取决于Claude Code的API

def manual_check_command():
    """
    手动检查命令，可在需要时直接调用
    """
    if not IMPORT_SUCCESS:
        print("错误: 无法导入对话管理器")
        return

    try:
        manager = ConversationManager(max_tokens=128000)

        # 这里需要获取实际对话消息
        messages = []

        if messages:
            stats = manager.get_conversation_stats(messages)

            print("=" * 50)
            print("对话状态检查")
            print("=" * 50)
            print(f"总消息数: {stats['total_messages']}")
            print(f"Token使用: {stats['total_tokens']:,} / {stats['token_limit']:,}")
            print(f"使用率: {stats['token_usage_percent']:.1f}%")
            print(f"重要消息: {stats['important_messages']}")
            print(f"代码块: {stats['code_blocks']}")
            print(f"文件引用: {stats['file_references']}")

            if stats['needs_cleanup']:
                print(f"⚠️  建议清理 (超过安全阈值)")
                print(f"   使用命令: /clean-history")
            else:
                print(f"✅ 状态正常")
            print("=" * 50)

    except Exception as e:
        print(f"检查失败: {e}")

if __name__ == "__main__":
    # 测试模式
    manual_check_command()