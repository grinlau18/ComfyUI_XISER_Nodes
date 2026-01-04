# Claude Code 对话历史记录管理指南

## 问题描述

在使用Claude Code进行长时间开发对话时，可能会遇到以下问题：
1. **对话超出token限制**：Claude模型有token限制（如Sonnet 4.5约128K），超出会导致对话中断
2. **开发过程不连续**：项目修改到一半时对话被截断，需要重新开始
3. **重要信息丢失**：早期的关键决策和代码修改可能被遗忘

## 解决方案

本项目提供了一套完整的对话历史记录管理方案，包括：

### 1. 核心组件

#### 对话管理器 (`conversation_manager.py`)
- **Token估算**：使用与Claude相同的tokenizer（cl100k_base）
- **智能分析**：自动识别重要内容（代码、文件引用、关键决策）
- **清理策略**：按重要性分数和时间顺序智能清理
- **统计监控**：实时监控对话状态

#### Claude Code集成
- **自动清理Hook**：在对话接近限制时自动清理
- **Slash命令**：手动管理和监控命令
- **配置管理**：根据使用模型调整参数

### 2. 可用命令

#### `/conversation-stats`
显示当前对话统计信息：
- Token使用量和百分比
- 重要消息数量
- 代码块和文件引用统计
- 清理建议

#### `/clean-history [target_percent]`
智能清理历史记录：
- 参数：目标token使用百分比（默认70%）
- 功能：保留重要内容，清理闲聊和重复信息
- 安全：确保不会过度清理关键信息

### 3. 自动清理机制

#### 触发条件
当对话token使用量超过安全阈值（默认85%）时自动触发。

#### 清理策略
1. **重要性优先**：清理低重要性消息（闲聊、重复解释）
2. **时间优先**：清理早期非重要消息
3. **保留最近**：保留最近20%的对话
4. **关键保留**：至少保留最重要的5条消息
5. **总结添加**：添加清理总结保持对话连贯性

### 4. 配置说明

#### 模型参数调整
根据使用的Claude模型调整`max_tokens`参数：

```python
# Claude Sonnet 4.5: 128,000 tokens
manager = ConversationManager(max_tokens=128000)

# Claude Opus 4.5: 200,000 tokens
manager = ConversationManager(max_tokens=200000)

# Claude Haiku: 200,000 tokens
manager = ConversationManager(max_tokens=200000)
```

#### 安全边界配置
```python
# 安全边界比例（达到85%时开始清理）
manager = ConversationManager(max_tokens=128000, safety_margin=0.15)
```

### 5. 使用建议

#### 最佳实践
1. **定期检查**：每50-100条消息使用`/conversation-stats`检查状态
2. **主动清理**：在开始大型任务前使用`/clean-history`
3. **重要标记**：使用特定格式标记重要内容以便优先保留
4. **分段对话**：大型项目分解为多个独立对话

#### 内容标记建议
```markdown
## 重要决策
[重要] 这里记录关键架构决策

## 代码实现
```python
# [关键代码] 核心功能实现
def important_function():
    pass
```

## 文件操作
[文件] /path/to/important/file.py
```

### 6. 技术实现

#### Token估算
使用OpenAI的tiktoken库，与Claude使用相同的tokenizer：
- 编码器：`cl100k_base`
- 准确率：与Claude API的token计数一致

#### 重要性评分算法
基于多个因素计算消息重要性分数（0-1）：
- 内容特征：代码块、文件引用、关键词
- 角色权重：助手回复 vs 用户提问
- 时间因素：最近消息权重更高

#### 清理优先级
```python
清理优先级（从高到低）：
1. 重要性分数 < 0.3 的消息
2. 早期（前50%）非重要消息
3. 重复的解释内容
4. 简单的确认和闲聊

保留优先级（从高到低）：
1. 包含代码块的消息
2. 包含文件引用的消息
3. 重要性分数 > 0.7 的消息
4. 最近20%的消息
```

### 7. 故障排除

#### 常见问题
1. **导入失败**：确保tiktoken库已安装 `pip install tiktoken`
2. **权限问题**：检查.claude目录的读写权限
3. **配置错误**：验证settings.local.json中的权限设置

#### 调试方法
```bash
# 测试对话管理器
cd /Users/grin/Documents/comfy/ComfyUI/custom_nodes/ComfyUI_XISER_Nodes
python .claude/conversation_manager.py

# 测试hook
python .claude/hooks/pre_command.py
```

### 8. 扩展开发

#### 自定义清理策略
继承`ConversationManager`类并重写相关方法：

```python
class CustomConversationManager(ConversationManager):
    def _calculate_importance(self, content: str, role: str) -> float:
        # 自定义重要性计算逻辑
        pass

    def create_cleanup_plan(self, messages, target_tokens):
        # 自定义清理计划
        pass
```

#### 添加新命令
在`.claude/commands/`目录下创建新的markdown文件。

#### 集成其他工具
可以将对话管理器与其他工具集成，如：
- 对话导出功能
- 统计分析报告
- 自动备份机制

## 总结

本方案提供了完整的对话历史记录管理功能，确保Claude Code对话的连续性和稳定性。通过智能清理和实时监控，可以有效避免因token限制导致的对话中断问题。

**核心优势**：
- ✅ 智能识别重要内容
- ✅ 自动防止对话中断
- ✅ 保持开发过程连续性
- ✅ 易于使用和配置
- ✅ 可扩展和自定义