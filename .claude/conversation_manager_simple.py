#!/usr/bin/env python3
"""
Claude Code 对话历史记录管理器（简化版）
不需要外部依赖的版本
"""

import json
import os
import re
from typing import List, Dict, Any, Tuple
from datetime import datetime

class ConversationManagerSimple:
    """对话历史记录管理器（简化版）"""

    def __init__(self, max_tokens: int = 100000, safety_margin: float = 0.1):
        """
        初始化对话管理器

        Args:
            max_tokens: 最大token限制（Claude Sonnet 4.5约128K）
            safety_margin: 安全边界比例（在达到限制前开始清理）
        """
        self.max_tokens = max_tokens
        self.safety_margin = safety_margin

        # 重要内容关键词（这些内容会被优先保留）
        self.important_keywords = [
            "代码", "实现", "修复", "bug", "错误", "功能", "需求",
            "设计", "架构", "方案", "计划", "todo", "任务",
            "文件", "路径", "目录", "结构", "配置",
            "测试", "验证", "检查", "问题", "解决",
            "修改", "更新", "添加", "删除", "重构",
            "import", "def ", "class ", "function", "return",
            "TODO:", "FIXME:", "NOTE:", "WARNING:"
        ]

        # 可清理内容关键词（这些内容可以被清理）
        self.cleanable_keywords = [
            "你好", "谢谢", "请问", "明白了", "理解了",
            "对的", "没错", "是的", "不是", "可能",
            "我觉得", "我认为", "看起来", "似乎",
            "闲聊", "对话", "交流", "讨论"
        ]

    def estimate_tokens(self, text: str) -> int:
        """简化版token估算：使用字符数/4作为近似值"""
        # 英文文本大约1个token对应4个字符
        # 中文文本大约1个token对应2-3个字符
        # 这里使用保守估计：字符数/3
        return len(text) // 3

    def analyze_conversation(self, messages: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        分析对话内容，识别重要信息和可清理内容

        Args:
            messages: 对话消息列表

        Returns:
            分析结果字典
        """
        analysis = {
            "total_tokens": 0,
            "important_messages": [],
            "cleanable_messages": [],
            "code_blocks": [],
            "file_references": [],
            "timeline": []
        }

        for i, msg in enumerate(messages):
            content = msg.get("content", "")
            role = msg.get("role", "")

            # 估算token
            tokens = self.estimate_tokens(content)
            analysis["total_tokens"] += tokens

            # 分析内容重要性
            importance_score = self._calculate_importance(content, role)

            # 识别代码块
            code_blocks = self._extract_code_blocks(content)
            if code_blocks:
                analysis["code_blocks"].extend(code_blocks)

            # 识别文件引用
            file_refs = self._extract_file_references(content)
            if file_refs:
                analysis["file_references"].extend(file_refs)

            # 记录时间线
            analysis["timeline"].append({
                "index": i,
                "role": role,
                "tokens": tokens,
                "importance": importance_score,
                "has_code": len(code_blocks) > 0,
                "has_files": len(file_refs) > 0
            })

            # 分类消息
            if importance_score >= 0.7:
                analysis["important_messages"].append(i)
            elif importance_score <= 0.3:
                analysis["cleanable_messages"].append(i)

        return analysis

    def _calculate_importance(self, content: str, role: str) -> float:
        """计算消息的重要性分数（0-1）"""
        score = 0.5  # 基础分数

        # 角色权重
        if role == "assistant":
            score += 0.1  # 助手的回复通常更重要
        elif role == "user":
            score += 0.05  # 用户的提问

        # 内容特征
        content_lower = content.lower()

        # 检查重要关键词
        for keyword in self.important_keywords:
            if keyword.lower() in content_lower:
                score += 0.05

        # 检查可清理关键词
        for keyword in self.cleanable_keywords:
            if keyword in content:
                score -= 0.03

        # 代码块权重
        if "```" in content:
            score += 0.2

        # 文件路径权重
        if re.search(r'[/\\][\w\-\.]+[/\\]', content):
            score += 0.15

        # 限制在0-1之间
        return max(0.0, min(1.0, score))

    def _extract_code_blocks(self, content: str) -> List[Dict[str, Any]]:
        """从内容中提取代码块"""
        code_blocks = []
        pattern = r'```(?:\w+)?\n(.*?)```'

        for match in re.finditer(pattern, content, re.DOTALL):
            code = match.group(1).strip()
            if code:
                code_blocks.append({
                    "content": code[:100] + "..." if len(code) > 100 else code,
                    "tokens": self.estimate_tokens(code)
                })

        return code_blocks

    def _extract_file_references(self, content: str) -> List[str]:
        """从内容中提取文件引用"""
        # 匹配文件路径模式
        patterns = [
            r'`([/\w\-\.]+\.\w+)`',  # 反引号中的文件名
            r'\[([/\w\-\.]+\.\w+)\]',  # 方括号中的文件名
            r'文件[：:]\s*([/\w\-\.]+\.\w+)',  # "文件: xxx"
            r'path[：:]\s*([/\w\-\./]+)',  # "path: xxx"
        ]

        file_refs = []
        for pattern in patterns:
            for match in re.finditer(pattern, content):
                file_ref = match.group(1)
                file_refs.append(file_ref)

        return file_refs

    def create_cleanup_plan(self, messages: List[Dict[str, Any]],
                           target_tokens: int = None) -> Dict[str, Any]:
        """
        创建清理计划

        Args:
            messages: 对话消息列表
            target_tokens: 目标token数量（默认保留max_tokens的70%）

        Returns:
            清理计划字典
        """
        if target_tokens is None:
            target_tokens = int(self.max_tokens * 0.7)

        analysis = self.analyze_conversation(messages)
        current_tokens = analysis["total_tokens"]

        if current_tokens <= target_tokens:
            return {
                "needs_cleanup": False,
                "current_tokens": current_tokens,
                "target_tokens": target_tokens,
                "messages_to_keep": list(range(len(messages))),
                "messages_to_remove": []
            }

        # 需要清理
        to_remove = []
        to_keep = list(range(len(messages)))

        # 策略1：优先清理低重要性消息
        for msg_idx in analysis["cleanable_messages"]:
            if current_tokens <= target_tokens:
                break

            timeline_info = next(t for t in analysis["timeline"] if t["index"] == msg_idx)
            current_tokens -= timeline_info["tokens"]
            to_remove.append(msg_idx)
            to_keep.remove(msg_idx)

        # 策略2：如果还不够，清理早期非重要消息
        if current_tokens > target_tokens:
            # 按时间顺序（从早到晚）清理非重要消息
            for timeline_info in analysis["timeline"]:
                if current_tokens <= target_tokens:
                    break

                msg_idx = timeline_info["index"]
                if msg_idx in to_keep and timeline_info["importance"] < 0.6:
                    current_tokens -= timeline_info["tokens"]
                    to_remove.append(msg_idx)
                    to_keep.remove(msg_idx)

        # 策略3：保留最近的消息（最后20%）
        recent_cutoff = int(len(messages) * 0.8)
        recent_messages = [i for i in to_keep if i >= recent_cutoff]

        # 确保至少保留一些消息
        if len(to_keep) < 5:
            # 保留最重要的5条消息
            important_indices = sorted(analysis["important_messages"],
                                     key=lambda x: analysis["timeline"][x]["importance"],
                                     reverse=True)[:5]
            for idx in important_indices:
                if idx not in to_keep:
                    to_keep.append(idx)
                    if idx in to_remove:
                        to_remove.remove(idx)

        return {
            "needs_cleanup": True,
            "current_tokens": analysis["total_tokens"],
            "remaining_tokens": current_tokens,
            "target_tokens": target_tokens,
            "messages_to_keep": sorted(to_keep),
            "messages_to_remove": sorted(to_remove),
            "recent_messages": recent_messages,
            "important_messages": analysis["important_messages"]
        }

    def cleanup_conversation(self, messages: List[Dict[str, Any]],
                           plan: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        执行清理计划

        Args:
            messages: 原始消息列表
            plan: 清理计划

        Returns:
            清理后的消息列表
        """
        if not plan["needs_cleanup"]:
            return messages

        # 创建清理后的消息列表
        cleaned_messages = []
        summary_added = False

        for i, msg in enumerate(messages):
            if i in plan["messages_to_keep"]:
                cleaned_messages.append(msg)
            elif not summary_added:
                # 在清理点添加总结消息
                summary_msg = self._create_summary_message(messages, plan)
                cleaned_messages.append(summary_msg)
                summary_added = True

        return cleaned_messages

    def _create_summary_message(self, messages: List[Dict[str, Any]],
                              plan: Dict[str, Any]) -> Dict[str, Any]:
        """创建清理总结消息"""
        removed_count = len(plan["messages_to_remove"])
        kept_count = len(plan["messages_to_keep"])

        summary_content = f"""## 对话历史记录清理总结

为了确保对话不超出token限制，已自动清理历史记录：

### 清理统计
- 原始消息数量: {len(messages)}
- 保留消息数量: {kept_count}
- 清理消息数量: {removed_count}
- Token使用: {plan['current_tokens']:,} → {plan['remaining_tokens']:,}

### 保留内容
- 重要代码修改和实现
- 文件操作和路径引用
- 最近的对话内容
- 关键决策和计划

### 清理内容
- 早期的闲聊和非关键对话
- 重复的解释内容
- 已完成的临时讨论

### 当前状态
对话已优化，可以继续正常工作。如需查看完整历史，请告知。

---
*此消息为自动生成的清理总结*
"""

        return {
            "role": "system",
            "content": summary_content
        }

    def should_cleanup(self, messages: List[Dict[str, Any]]) -> bool:
        """检查是否需要清理"""
        analysis = self.analyze_conversation(messages)
        threshold = self.max_tokens * (1 - self.safety_margin)
        return analysis["total_tokens"] > threshold

    def get_conversation_stats(self, messages: List[Dict[str, Any]]) -> Dict[str, Any]:
        """获取对话统计信息"""
        analysis = self.analyze_conversation(messages)

        return {
            "total_messages": len(messages),
            "total_tokens": analysis["total_tokens"],
            "token_limit": self.max_tokens,
            "token_usage_percent": (analysis["total_tokens"] / self.max_tokens) * 100,
            "important_messages": len(analysis["important_messages"]),
            "code_blocks": len(analysis["code_blocks"]),
            "file_references": len(analysis["file_references"]),
            "needs_cleanup": self.should_cleanup(messages)
        }


def main():
    """测试函数"""
    # 示例用法
    manager = ConversationManagerSimple(max_tokens=100000)

    # 模拟一些消息
    test_messages = [
        {"role": "user", "content": "你好，我想开发一个功能"},
        {"role": "assistant", "content": "好的，请描述你的需求。"},
        {"role": "user", "content": "我需要一个文件管理器，可以处理 `/path/to/file.py`"},
        {"role": "assistant", "content": "```python\nimport os\n\ndef list_files(path):\n    return os.listdir(path)\n```"},
        {"role": "user", "content": "谢谢，这个很好用"},
        {"role": "assistant", "content": "不客气，还有其他问题吗？"},
        {"role": "user", "content": "我想添加一个功能，可以读取 `/Users/grin/Documents/test.txt` 文件"},
        {"role": "assistant", "content": "```python\ndef read_file(filepath):\n    with open(filepath, 'r') as f:\n        return f.read()\n```"},
        {"role": "user", "content": "这个实现很好，谢谢"},
        {"role": "assistant", "content": "还有其他需要帮助的吗？"},
    ]

    print("=" * 60)
    print("对话历史记录管理器测试")
    print("=" * 60)

    # 获取统计信息
    stats = manager.get_conversation_stats(test_messages)
    print("\n📊 对话统计:")
    print(f"   总消息数: {stats['total_messages']}")
    print(f"   总token数: {stats['total_tokens']:,} / {stats['token_limit']:,}")
    print(f"   使用率: {stats['token_usage_percent']:.1f}%")
    print(f"   重要消息: {stats['important_messages']}")
    print(f"   代码块: {stats['code_blocks']}")
    print(f"   文件引用: {stats['file_references']}")

    # 检查是否需要清理
    if manager.should_cleanup(test_messages):
        print(f"\n⚠️  需要清理 (超过安全阈值)")

        # 创建清理计划
        plan = manager.create_cleanup_plan(test_messages, target_tokens=500)

        print(f"\n📋 清理计划:")
        print(f"   原始消息: {len(test_messages)}")
        print(f"   保留消息: {len(plan['messages_to_keep'])}")
        print(f"   清理消息: {len(plan['messages_to_remove'])}")
        print(f"   Token: {plan['current_tokens']:,} → {plan['remaining_tokens']:,}")

        # 执行清理
        cleaned = manager.cleanup_conversation(test_messages, plan)
        print(f"\n✅ 清理完成:")
        print(f"   清理后消息数: {len(cleaned)}")

        # 显示清理后的消息摘要
        print(f"\n📝 清理后消息摘要:")
        for i, msg in enumerate(cleaned):
            role = msg.get("role", "unknown")
            content_preview = msg.get("content", "")[:80] + "..." if len(msg.get("content", "")) > 80 else msg.get("content", "")
            print(f"   [{i}] {role}: {content_preview}")
    else:
        print(f"\n✅ 状态正常 (无需清理)")

    print("\n" + "=" * 60)
    print("测试完成！")
    print("=" * 60)


if __name__ == "__main__":
    main()