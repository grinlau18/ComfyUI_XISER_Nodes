#!/usr/bin/env python3
"""
测试对话清理功能
模拟一个接近token限制的对话场景
"""

from conversation_manager_simple import ConversationManagerSimple

def create_large_conversation():
    """创建一个大型对话，模拟接近token限制的情况"""
    messages = []

    # 添加大量消息
    for i in range(50):
        if i % 5 == 0:
            # 重要消息：包含代码
            messages.append({
                "role": "user",
                "content": f"请帮我实现第{i//5+1}个功能，需要处理文件 `/path/to/file_{i//5+1}.py`"
            })
            messages.append({
                "role": "assistant",
                "content": f"```python\n# 功能{i//5+1}实现\ndef function_{i//5+1}():\n    print('这是功能{i//5+1}')\n    return True\n```"
            })
        else:
            # 普通闲聊消息
            messages.append({
                "role": "user",
                "content": f"第{i+1}条消息，这是一些闲聊内容，没有重要信息。"
            })
            messages.append({
                "role": "assistant",
                "content": f"明白了，这是第{i+1}条回复，继续讨论。"
            })

    return messages

def test_cleanup_scenario():
    """测试清理场景"""
    print("=" * 70)
    print("对话清理功能测试 - 模拟大型对话场景")
    print("=" * 70)

    # 创建对话管理器（设置较小的限制以便测试）
    manager = ConversationManagerSimple(max_tokens=5000, safety_margin=0.2)

    # 创建大型对话
    messages = create_large_conversation()

    print(f"\n📈 创建了 {len(messages)} 条消息的对话")

    # 获取统计信息
    stats = manager.get_conversation_stats(messages)

    print("\n📊 初始统计:")
    print(f"   总消息数: {stats['total_messages']}")
    print(f"   总token数: {stats['total_tokens']:,} / {stats['token_limit']:,}")
    print(f"   使用率: {stats['token_usage_percent']:.1f}%")
    print(f"   重要消息: {stats['important_messages']}")
    print(f"   代码块: {stats['code_blocks']}")
    print(f"   文件引用: {stats['file_references']}")

    # 检查是否需要清理
    needs_cleanup = manager.should_cleanup(messages)
    print(f"\n🔍 清理检查: {'需要清理' if needs_cleanup else '无需清理'}")

    if needs_cleanup:
        print(f"   原因: 使用率 {stats['token_usage_percent']:.1f}% > 安全阈值 {(1-manager.safety_margin)*100:.0f}%")

        # 创建清理计划（目标保留60%容量）
        target_tokens = int(manager.max_tokens * 0.6)
        plan = manager.create_cleanup_plan(messages, target_tokens)

        print(f"\n📋 清理计划详情:")
        print(f"   目标token: {target_tokens:,}")
        print(f"   当前token: {plan['current_tokens']:,}")
        print(f"   保留后token: {plan['remaining_tokens']:,}")
        print(f"   保留消息: {len(plan['messages_to_keep'])} 条")
        print(f"   清理消息: {len(plan['messages_to_remove'])} 条")
        print(f"   重要消息保留: {len(plan['important_messages'])} 条")
        print(f"   最近消息保留: {len(plan['recent_messages'])} 条")

        # 分析清理内容
        print(f"\n🔍 清理内容分析:")
        removed_important = sum(1 for idx in plan['messages_to_remove']
                              if idx in plan['important_messages'])
        removed_recent = sum(1 for idx in plan['messages_to_remove']
                           if idx in plan['recent_messages'])

        print(f"   清理的重要消息: {removed_important} 条")
        print(f"   清理的最近消息: {removed_recent} 条")

        # 执行清理
        print(f"\n🔄 执行清理...")
        cleaned_messages = manager.cleanup_conversation(messages, plan)

        # 检查清理结果
        cleaned_stats = manager.get_conversation_stats(cleaned_messages)

        print(f"\n✅ 清理完成!")
        print(f"   原始消息数: {len(messages)} → 清理后: {len(cleaned_messages)}")
        print(f"   原始token: {plan['current_tokens']:,} → 清理后: {cleaned_stats['total_tokens']:,}")
        print(f"   使用率: {stats['token_usage_percent']:.1f}% → {cleaned_stats['token_usage_percent']:.1f}%")

        # 检查清理后的消息内容
        print(f"\n📝 清理后消息摘要:")
        code_blocks_kept = 0
        file_refs_kept = 0

        for i, msg in enumerate(cleaned_messages):
            role = msg.get("role", "unknown")
            content = msg.get("content", "")

            if "```" in content:
                code_blocks_kept += 1
            if any(ref in content for ref in ["/path/to/", "file_"]):
                file_refs_kept += 1

            # 只显示前5条和后5条消息
            if i < 5 or i >= len(cleaned_messages) - 5:
                preview = content[:60] + "..." if len(content) > 60 else content
                marker = "💎" if i in plan['important_messages'] else "   "
                print(f"   {marker} [{i:2d}] {role}: {preview}")

        print(f"\n🔧 关键内容保留情况:")
        print(f"   保留的代码块: {code_blocks_kept} / {stats['code_blocks']}")
        print(f"   保留的文件引用: {file_refs_kept} / {stats['file_references']}")

        # 检查是否有清理总结消息
        has_summary = any(msg.get("role") == "system" and "清理总结" in msg.get("content", "")
                         for msg in cleaned_messages)
        print(f"   清理总结: {'已添加' if has_summary else '未添加'}")

    print("\n" + "=" * 70)
    print("测试完成！")
    print("=" * 70)

def test_manual_commands():
    """测试手动命令功能"""
    print("\n" + "=" * 70)
    print("手动命令功能测试")
    print("=" * 70)

    manager = ConversationManagerSimple(max_tokens=10000)

    # 创建测试对话
    test_messages = [
        {"role": "user", "content": "我想开发一个Web应用"},
        {"role": "assistant", "content": "好的，请描述具体需求。"},
        {"role": "user", "content": "需要处理 `/static/css/style.css` 文件"},
        {"role": "assistant", "content": "```css\n/* 样式文件 */\nbody { margin: 0; }\n```"},
        {"role": "user", "content": "谢谢，很好用"},
    ]

    print("\n💡 模拟命令: /conversation-stats")
    stats = manager.get_conversation_stats(test_messages)

    print(f"""
当前对话统计:
- 总消息数: {stats['total_messages']}
- 总token数: {stats['total_tokens']:,} / {stats['token_limit']:,} ({stats['token_usage_percent']:.1f}%)
- 重要消息: {stats['important_messages']}条
- 代码块: {stats['code_blocks']}个
- 文件引用: {stats['file_references']}个
- 状态: {'⚠️ 建议清理' if stats['needs_cleanup'] else '✅ 正常'}
""")

    print("\n💡 模拟命令: /clean-history 50")
    plan = manager.create_cleanup_plan(test_messages, target_tokens=5000)

    if plan['needs_cleanup']:
        print(f"""
清理计划:
- 目标token: {plan['target_tokens']:,}
- 当前token: {plan['current_tokens']:,}
- 清理后token: {plan['remaining_tokens']:,}
- 保留消息: {len(plan['messages_to_keep'])}条
- 清理消息: {len(plan['messages_to_remove'])}条
""")
    else:
        print("当前无需清理。")

    print("\n" + "=" * 70)

if __name__ == "__main__":
    test_cleanup_scenario()
    test_manual_commands()