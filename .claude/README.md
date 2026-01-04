# Claude Code 对话历史记录管理解决方案

## 问题背景

在使用Claude Code进行长时间开发对话时，经常遇到以下问题：
1. **对话超出token限制**：Claude模型有token限制（如Sonnet 4.5约128K），超出会导致对话中断
2. **开发过程不连续**：项目修改到一半时对话被截断，需要重新开始
3. **重要信息丢失**：早期的关键决策和代码修改可能被遗忘

## 解决方案概述

本方案提供了一套完整的对话历史记录管理系统，包括：

### 核心功能
- ✅ **智能token估算**：准确估算对话token使用量
- ✅ **重要性分析**：自动识别重要内容（代码、文件引用、关键决策）
- ✅ **自动清理**：在接近token限制时智能清理历史记录
- ✅ **手动管理**：提供方便的slash命令进行手动管理
- ✅ **安全保护**：确保重要内容不被误清理

### 系统架构
```
.claude/
├── conversation_manager.py      # 完整版对话管理器（需要tiktoken）
├── conversation_manager_simple.py # 简化版对话管理器（无依赖）
├── hooks/
│   └── pre_command.py          # 自动清理hook
├── commands/
│   ├── conversation-stats.md   # 统计命令
│   └── clean-history.md        # 清理命令
├── CONVERSATION_MANAGEMENT.md  # 详细指南
└── README.md                   # 本文件
```

## 快速开始

### 1. 安装依赖（可选）
完整版需要tiktoken库：
```bash
pip install tiktoken
```

简化版无需额外依赖，可直接使用。

### 2. 使用命令

#### 检查对话状态
```
/conversation-stats
```
显示当前对话的token使用情况和统计信息。

#### 清理历史记录
```
/clean-history [目标百分比]
```
示例：
```
/clean-history 70    # 将token使用量降低到最大限制的70%
```

### 3. 自动清理

系统会在以下情况下自动触发清理：
- 对话token使用量超过安全阈值（默认85%）
- 保留重要内容，清理闲聊和重复信息
- 添加清理总结保持对话连贯性

## 详细功能说明

### 智能清理策略

清理算法按以下优先级进行：

#### 保留优先级（从高到低）：
1. **代码块**：包含```python、```javascript等代码块的消息
2. **文件引用**：包含文件路径（如`/path/to/file.py`）的消息
3. **高重要性消息**：重要性分数>0.7的消息
4. **最近消息**：最近20%的对话内容
5. **关键决策**：包含特定关键词（如"重要"、"关键"、"决策"）的消息

#### 清理优先级（从高到低）：
1. **低重要性消息**：重要性分数<0.3的消息
2. **早期非重要消息**：时间较早且重要性<0.6的消息
3. **闲聊内容**：包含"你好"、"谢谢"、"闲聊"等关键词的消息
4. **重复解释**：内容相似度高的消息

### 重要性评分算法

基于多个因素计算消息重要性分数（0-1）：
- **内容特征**：代码块(+0.2)、文件引用(+0.15)、关键词匹配
- **角色权重**：助手回复(+0.1)、用户提问(+0.05)
- **时间因素**：最近消息权重更高

### Token估算方法

#### 完整版（推荐）
使用OpenAI的tiktoken库，与Claude使用相同的tokenizer：
- 编码器：`cl100k_base`
- 准确率：与Claude API的token计数一致

#### 简化版
使用字符数/3作为近似值，适合快速估算。

## 配置说明

### 模型参数调整
根据使用的Claude模型调整参数：

```python
# Claude Sonnet 4.5: 128,000 tokens
manager = ConversationManager(max_tokens=128000)

# Claude Opus 4.5: 200,000 tokens
manager = ConversationManager(max_tokens=200000)

# Claude Haiku: 200,000 tokens
manager = ConversationManager(max_tokens=200000)
```

### 安全边界配置
```python
# 安全边界比例（达到85%时开始清理）
manager = ConversationManager(max_tokens=128000, safety_margin=0.15)
```

## 最佳实践

### 1. 定期检查
每50-100条消息使用`/conversation-stats`检查状态。

### 2. 主动清理
在开始大型任务前主动使用`/clean-history`命令。

### 3. 重要内容标记
使用特定格式标记重要内容以便优先保留：

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

### 4. 分段对话
将大型项目分解为多个独立对话：
- 架构设计阶段
- 核心功能实现
- 测试和优化
- 部署和维护

## 故障排除

### 常见问题

#### 1. 导入失败
**问题**：`ModuleNotFoundError: No module named 'tiktoken'`
**解决**：
```bash
pip install tiktoken
```
或使用简化版：
```python
from conversation_manager_simple import ConversationManagerSimple
```

#### 2. 清理效果不明显
**问题**：所有消息都被标记为重要，没有可清理内容
**解决**：
- 调整重要性评分参数
- 添加更多可清理关键词
- 手动标记不重要内容

#### 3. Hook不生效
**问题**：自动清理hook没有触发
**解决**：
- 检查`.claude/hooks/`目录权限
- 验证Claude Code的hook配置
- 查看系统日志

### 调试方法

```bash
# 测试对话管理器
cd /Users/grin/Documents/comfy/ComfyUI/custom_nodes/ComfyUI_XISER_Nodes
python .claude/conversation_manager_simple.py

# 测试清理场景
python .claude/test_cleanup.py
python .claude/test_urgent_cleanup.py
```

## 扩展开发

### 自定义清理策略
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

### 添加新命令
在`.claude/commands/`目录下创建新的markdown文件。

### 集成其他工具
可以将对话管理器与其他工具集成，如：
- 对话导出功能
- 统计分析报告
- 自动备份机制

## 性能优化建议

### 1. 缓存优化
- 缓存重要性评分结果
- 预计算token数量
- 使用LRU缓存策略

### 2. 算法优化
- 使用更高效的正则表达式
- 批量处理消息
- 并行计算重要性分数

### 3. 内存优化
- 流式处理大型对话
- 使用生成器减少内存占用
- 及时清理临时数据

## 安全注意事项

### 1. 数据保护
- 对话历史本地存储加密
- 敏感信息自动过滤
- 清理操作可追溯

### 2. 权限控制
- Hook执行权限限制
- 命令访问控制
- 配置文件保护

### 3. 错误处理
- 优雅降级机制
- 异常情况恢复
- 详细错误日志

## 版本兼容性

### 支持的Claude Code版本
- Claude Code 1.0+
- 支持hook和slash命令的版本

### Python版本要求
- Python 3.8+
- 简化版：Python 3.6+

### 依赖库
- 完整版：tiktoken >= 0.5.0
- 简化版：无外部依赖

## 贡献指南

### 代码规范
- 使用PEP 8代码风格
- 添加类型注解
- 编写单元测试

### 测试要求
- 覆盖所有主要功能
- 模拟真实使用场景
- 性能基准测试

### 文档要求
- 更新README.md
- 添加API文档
- 提供使用示例

## 许可证

本项目采用MIT许可证。详见LICENSE文件。

## 支持与反馈

如有问题或建议，请：
1. 查看[CONVERSATION_MANAGEMENT.md](CONVERSATION_MANAGEMENT.md)详细指南
2. 运行测试脚本验证功能
3. 提交Issue或Pull Request

## 更新日志

### v1.0.0 (2026-01-02)
- 初始版本发布
- 完整对话管理功能
- 自动清理hook
- Slash命令支持
- 详细文档

---

**开始使用**：运行 `/conversation-stats` 检查当前对话状态，或使用 `/clean-history 70` 进行主动清理。

**记住**：定期清理，保持对话健康！ 🚀