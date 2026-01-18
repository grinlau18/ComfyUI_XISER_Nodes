# VGM节点模型添加指南

## 概述
本文档指导如何为VGM Orchestrator节点添加新模型，并避免常见的属性支持问题。

## 问题背景
在切换模型时，如果新模型不支持某些属性（如模板、音频等），而旧模型设置了这些属性的值，会导致验证错误。

## 解决方案架构

### 1. 前端清理机制
- **位置**: `web/vgm_node_ui.js` 中的 `applyProvider` 函数
- **机制**: 当切换模型时，自动清理不支持属性的值
- **辅助函数**: `cleanupWidgetValue(widget, hint, propertyName, defaultValue)`

### 2. 后端验证机制
- **位置**: `src/xiser_nodes/video/providers_wan.py`
- **机制**: 使用通用验证函数 `_validate_model_feature`
- **特点**: 只对非空值进行支持性检查

## 添加新模型的步骤

### 步骤1: 在 `providers_wan.py` 中添加模型配置

```python
"new-model-name": {
    "label": "模型显示名称",
    "provider_type": "i2v",  # 或 "r2v", "kf2v"
    "endpoint": "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis",
    "supported_sizes": [],  # 参考生视频使用
    "supported_resolutions": ["720P", "1080P"],  # 图生视频使用
    "supported_durations": [5, 10],
    "max_reference_videos": 0,
    "max_prompt_length": 1500,
    "max_negative_prompt_length": 500,
    # 功能支持标志（必须正确设置）
    "supports_audio": True,  # 是否支持音频输入
    "supports_multi_shot": True,  # 是否支持多镜头模式
    "supports_prompt_extend": True,  # 是否支持提示词扩展
    "supports_template": True,  # 是否支持特效模板
}
```

### 步骤2: 在 `vgm_node_ui.js` 中添加UI提示

```javascript
"new-model-name": {
    providerType: "i2v",
    hasImageInput: true,
    hasVideoUrlInput: false,
    hasResolution: true,
    hasAudio: true,  // 必须与 supports_audio 一致
    hasPromptExtend: true,  // 必须与 supports_prompt_extend 一致
    hasTemplate: true,  // 必须与 supports_template 一致
    hasShotType: true,  // 必须与 supports_multi_shot 一致
    hasSize: false,
    supportedRegions: ["china", "singapore", "virginia"],
    supportedDurations: [5, 10],
    supportedResolutions: ["720P", "1080P"],
    maxPromptLength: 1500,
}
```

## 属性映射表

| 后端属性 | 前端属性 | 控件名称 | 默认值 | 清理逻辑 |
|---------|---------|---------|--------|----------|
| `supports_audio` | `hasAudio` | `audio_url` | `""` | 空字符串 |
| `supports_template` | `hasTemplate` | `template` | `""` | 空字符串 |
| `supports_multi_shot` | `hasShotType` | `shot_type` | `"single"` | 重置为"single" |
| `supports_prompt_extend` | `hasPromptExtend` | `prompt_extend` | `true` | 重置为true |

## 验证规则

### 1. 前后端一致性规则
- 前端 `hasXxx` 必须与后端 `supports_xxx` 保持一致
- 不一致会导致UI显示错误或验证失败

### 2. 值清理规则
- 字符串属性：清理为空字符串 `""`
- 枚举属性：清理为安全默认值（如 `shot_type` → `"single"`）
- 布尔属性：清理为 `true`（如 `prompt_extend`）

### 3. 验证逻辑规则
- 只有非空值才进行支持性检查
- 空字符串、`false` 布尔值视为空值
- 使用 `_validate_model_feature` 统一验证

## 测试 checklist

添加新模型后，必须测试：

1. **基础功能测试**
   - [ ] 模型能正常加载和显示
   - [ ] 控件可见性正确（支持的功能显示，不支持的功能隐藏）

2. **属性清理测试**
   - [ ] 从支持属性A的模型切换到不支持属性A的模型，属性A的值被清理
   - [ ] 清理后的值不会导致验证错误

3. **验证逻辑测试**
   - [ ] 设置不支持属性的值会得到正确的错误信息
   - [ ] 空值不会触发不支持错误

4. **端到端测试**
   - [ ] 使用新模型能成功生成视频
   - [ ] 所有参数都能正确传递到API

## 常见问题排查

### Q1: "模型 XXX 不支持特效模板" 错误
- **检查**: `supports_template` 和 `hasTemplate` 是否一致
- **检查**: 模板控件值清理逻辑是否生效
- **检查**: `_validate_model_feature` 是否正确处理空字符串

### Q2: 控件显示不正确
- **检查**: `hasXxx` 属性设置是否正确
- **检查**: UI逻辑中的 `switch (w.name)` 是否包含该控件

### Q3: 参数传递失败
- **检查**: payload构建逻辑是否包含该参数
- **检查**: 参数名是否与API文档一致

## 维护建议

### 1. 定期检查
- 每月检查一次所有模型的属性支持状态
- 对照阿里云官方文档更新支持标志

### 2. 添加新属性时
- 同时更新前后端
- 添加清理逻辑
- 更新验证函数

### 3. 代码审查要点
- 前后端属性映射一致性
- 值清理逻辑完整性
- 错误信息清晰度

## 相关文件
- `src/xiser_nodes/video/providers_wan.py` - 模型配置和验证
- `web/vgm_node_ui.js` - UI控件管理
- `src/xiser_nodes/vgm_v3.py` - 主执行逻辑

## 版本历史
- 2025-01-18: 创建文档，解决模板不支持问题
- 2025-01-18: 添加通用验证和清理机制