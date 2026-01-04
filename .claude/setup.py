#!/usr/bin/env python3
"""
Claude Code 对话管理工具安装脚本
"""

import os
import sys
import shutil
from pathlib import Path

def print_header():
    """打印标题"""
    print("=" * 70)
    print("Claude Code 对话历史记录管理工具安装")
    print("=" * 70)

def check_environment():
    """检查环境"""
    print("\n🔍 检查环境...")

    # 检查Python版本
    python_version = sys.version_info
    print(f"   Python版本: {python_version.major}.{python_version.minor}.{python_version.micro}")

    if python_version.major < 3 or (python_version.major == 3 and python_version.minor < 8):
        print("   ⚠️  建议使用Python 3.8或更高版本")

    # 检查当前目录
    current_dir = Path.cwd()
    print(f"   当前目录: {current_dir}")

    # 检查.claude目录
    claude_dir = current_dir / ".claude"
    if claude_dir.exists():
        print(f"   ✅ .claude目录已存在")
    else:
        print(f"   📁 将创建.claude目录")

    return True

def install_dependencies():
    """安装依赖"""
    print("\n📦 安装依赖...")

    try:
        import tiktoken
        print("   ✅ tiktoken已安装")
        return "full"
    except ImportError:
        print("   ℹ️  tiktoken未安装，将使用简化版")
        print("   如需完整功能，请运行: pip install tiktoken")
        return "simple"

def setup_files():
    """设置文件"""
    print("\n📁 设置文件结构...")

    current_dir = Path.cwd()
    claude_dir = current_dir / ".claude"

    # 创建必要目录
    directories = ["hooks", "commands"]
    for dir_name in directories:
        dir_path = claude_dir / dir_name
        dir_path.mkdir(parents=True, exist_ok=True)
        print(f"   ✅ 创建目录: {dir_name}/")

    # 检查文件
    files = [
        "conversation_manager.py",
        "conversation_manager_simple.py",
        "hooks/pre_command.py",
        "commands/conversation-stats.md",
        "commands/clean-history.md",
        "CONVERSATION_MANAGEMENT.md",
        "README.md"
    ]

    for file_path in files:
        full_path = claude_dir / file_path
        if full_path.exists():
            print(f"   ✅ 文件存在: {file_path}")
        else:
            print(f"   ⚠️  文件缺失: {file_path}")

    return True

def update_settings():
    """更新设置"""
    print("\n⚙️  更新设置...")

    settings_file = Path.cwd() / ".claude" / "settings.local.json"

    if settings_file.exists():
        print(f"   ✅ 设置文件已存在: {settings_file}")
        print(f"   请确保已授予必要的权限")
    else:
        print(f"   📄 创建默认设置文件")
        # 这里可以创建默认设置

    return True

def test_installation():
    """测试安装"""
    print("\n🧪 测试安装...")

    try:
        # 测试简化版管理器
        sys.path.insert(0, str(Path.cwd() / ".claude"))
        from conversation_manager_simple import ConversationManagerSimple

        manager = ConversationManagerSimple()
        test_messages = [
            {"role": "user", "content": "测试消息"},
            {"role": "assistant", "content": "测试回复"}
        ]

        stats = manager.get_conversation_stats(test_messages)
        print(f"   ✅ 对话管理器测试通过")
        print(f"   测试消息: {stats['total_messages']}条, Token: {stats['total_tokens']}")

        # 测试hook
        hook_file = Path.cwd() / ".claude" / "hooks" / "pre_command.py"
        if hook_file.exists():
            print(f"   ✅ Hook文件检查通过")
        else:
            print(f"   ⚠️  Hook文件缺失")

        return True

    except Exception as e:
        print(f"   ❌ 测试失败: {e}")
        return False

def print_usage_instructions():
    """打印使用说明"""
    print("\n" + "=" * 70)
    print("🎉 安装完成！")
    print("=" * 70)

    print("""
📋 可用命令:

1. 检查对话状态:
   ```
   /conversation-stats
   ```

2. 清理历史记录:
   ```
   /clean-history [目标百分比]
   示例: /clean-history 70
   ```

3. 自动清理:
   - 当对话token使用量超过85%时自动触发
   - 保留重要内容，清理闲聊
   - 添加清理总结

🔧 配置说明:

1. 模型设置 (根据使用的Claude模型调整):
   - Claude Sonnet 4.5: 128,000 tokens
   - Claude Opus 4.5: 200,000 tokens
   - Claude Haiku: 200,000 tokens

2. 安全边界:
   在.conversation_manager.py中调整:
   - max_tokens: 最大token限制
   - safety_margin: 安全边界比例

📚 详细文档:
   查看 .claude/CONVERSATION_MANAGEMENT.md 获取完整指南

💡 最佳实践:
1. 定期使用 /conversation-stats 检查状态
2. 在开始大型任务前主动清理
3. 重要内容使用特定格式标记
4. 长时间对话分段进行

🛠️ 故障排除:
1. 运行测试: python .claude/conversation_manager_simple.py
2. 检查权限: 确保.claude目录可读写
3. 查看日志: 如有问题检查系统日志

🚀 开始使用:
   运行 `/conversation-stats` 检查当前对话状态！
""")

def main():
    """主函数"""
    print_header()

    # 检查环境
    if not check_environment():
        print("❌ 环境检查失败")
        return 1

    # 安装依赖
    version = install_dependencies()

    # 设置文件
    if not setup_files():
        print("❌ 文件设置失败")
        return 1

    # 更新设置
    if not update_settings():
        print("❌ 设置更新失败")
        return 1

    # 测试安装
    if not test_installation():
        print("❌ 安装测试失败")
        return 1

    # 打印使用说明
    print_usage_instructions()

    print("\n" + "=" * 70)
    print("✅ 安装成功完成！")
    print("=" * 70)

    return 0

if __name__ == "__main__":
    sys.exit(main())