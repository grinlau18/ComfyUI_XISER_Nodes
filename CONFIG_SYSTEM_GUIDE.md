# VGM Orchestrator 统一配置系统指南

## 概述

VGM Orchestrator节点现在使用统一的配置系统来管理所有视频生成模型的配置。这个系统解决了之前配置分散在前端和后端的问题，提供了一个单一、可维护的配置源。

## 主要特性

1. **单一配置源**：所有模型配置集中在一个YAML文件中
2. **前后端共享**：前端和后端使用相同的配置数据
3. **动态加载**：前端通过API动态获取配置，无需硬编码
4. **易于扩展**：添加新模型只需修改配置文件
5. **类型安全**：使用Python数据类和验证
6. **缓存机制**：前端缓存配置，减少API调用

## 文件结构

```
ComfyUI_XISER_Nodes/
├── config/
│   └── video_models.yaml          # 统一配置文件
├── src/xiser_nodes/
│   ├── config/                    # 配置模块
│   │   ├── __init__.py
│   │   └── loader.py              # 配置加载器
│   ├── video/
│   │   └── providers_config.py    # 基于配置的提供者
│   └── vgm_v3.py                  # 更新后的主节点
├── web/
│   ├── vgm_node_ui_config.js      # 新的配置驱动UI
│   └── index.js                   # 更新为使用新UI
└── CONFIG_SYSTEM_GUIDE.md         # 本指南
```

## 配置文件格式

### 全局配置 (`global`)

```yaml
global:
  endpoint_templates:
    china: "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis"
    singapore: "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis"
    virginia: "https://dashscope-us.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis"

  kf2v_endpoint_templates:
    china: "https://dashscope.aliyuncs.com/api/v1/services/aigc/image2video/video-synthesis"
    singapore: "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/image2video/video-synthesis"
    virginia: "https://dashscope-us.aliyuncs.com/api/v1/services/aigc/image2video/video-synthesis"
```

### 模型配置 (`models`)

每个模型包含以下部分：

```yaml
模型名称:
  # 基本信息
  name: "模型内部名称"
  label: "显示名称"
  provider_type: "r2v|i2v|k2v"  # 提供者类型
  group: "分组名称"

  # API配置
  endpoint: "{{地区变量}}"  # 支持模板变量

  # 输入限制
  max_prompt_length: 1500
  max_reference_videos: 3

  # 输出配置
  supported_durations: [5, 10]
  supported_sizes: ["1280*720", "1920*1080"]
  supported_resolutions: ["720P", "1080P"]

  # 功能支持
  supports_audio: true
  supports_multi_shot: true
  supports_prompt_extend: true
  supports_template: true

  # UI配置
  ui:
    has_image_input: true
    has_video_url_input: false
    has_resolution: true
    has_audio: true
    has_prompt_extend: true
    has_template: true
    has_shot_type: true
    has_size: false
    supported_regions: ["china", "singapore", "virginia"]
    default_region: "china"
    default_resolution: "720P"
    default_size: "1280*720"
    default_duration: 5
    default_shot_type: "multi"
    default_prompt_extend: true
    default_watermark: false
    default_seed: 42
```

### 分组配置 (`groups`)

```yaml
groups:
  分组名称:
    name: "分组显示名称"
    description: "分组描述"
    models:
      - "模型1名称"
      - "模型2名称"
```

### 提供者类型配置 (`provider_types`)

```yaml
provider_types:
  r2v:
    name: "参考生视频"
    description: "基于参考视频生成新视频，保留角色形象和音色"
    icon: "🎬"
    color: "#1890ff"
```

## 如何添加新模型

### 步骤1：在配置文件中添加模型

在 `config/video_models.yaml` 的 `models` 部分添加新模型：

```yaml
new-model-name:
  name: "new-model-name"
  label: "新模型显示名称"
  provider_type: "i2v"  # 或 r2v/kf2v
  group: "alibaba"
  endpoint: "{{china}}"
  max_prompt_length: 1500
  max_reference_videos: 0
  supported_durations: [5, 10]
  supported_sizes: []
  supported_resolutions: ["720P", "1080P"]
  supports_audio: true
  supports_multi_shot: true
  supports_prompt_extend: true
  supports_template: true
  ui:
    has_image_input: true
    has_video_url_input: false
    has_resolution: true
    has_audio: true
    has_prompt_extend: true
    has_template: true
    has_shot_type: true
    has_size: false
    supported_regions: ["china", "singapore", "virginia"]
    default_region: "china"
    default_resolution: "720P"
    default_duration: 5
    default_shot_type: "multi"
    default_prompt_extend: true
    default_watermark: false
    default_seed: 42
```

### 步骤2：将模型添加到分组

在 `groups` 部分将新模型添加到相应的分组：

```yaml
groups:
  alibaba:
    name: "阿里云万相"
    description: "阿里云通义万相视频生成模型"
    models:
      - "wan2.6-r2v"
      - "wan2.6-i2v"
      # ... 其他模型
      - "new-model-name"  # 添加新模型
```

### 步骤3：重启ComfyUI

重启ComfyUI后，新模型将自动出现在VGM Orchestrator节点的下拉框中。

## API端点

配置系统提供了以下API端点：

### 获取所有配置
```
GET /xiser/vgm/config
```

响应示例：
```json
{
  "success": true,
  "data": {
    "models": {
      "wan2.6-r2v": {
        "providerType": "r2v",
        "hasImageInput": false,
        "hasVideoUrlInput": true,
        // ... 其他配置
      }
    },
    "choices": [
      {
        "value": "wan2.6-r2v",
        "label": "万相2.6参考生视频",
        "group": "alibaba",
        "provider_type": "r2v"
      }
    ],
    "provider_types": {
      "r2v": {
        "name": "参考生视频",
        "description": "基于参考视频生成新视频...",
        "icon": "🎬",
        "color": "#1890ff"
      }
    },
    "timestamp": 1672531200
  }
}
```

### 获取特定模型配置
```
GET /xiser/vgm/config/{model_name}
```

## 开发API

### Python API

```python
from src.xiser_nodes.config import get_config_loader

# 获取配置加载器
loader = get_config_loader()

# 获取所有模型
all_models = loader.get_all_models()

# 获取特定模型
model = loader.get_model("wan2.6-r2v")

# 获取UI配置
ui_config = loader.get_ui_config_for_model("wan2.6-r2v")

# 验证输入
valid, message = loader.validate_model_inputs("wan2.6-r2v", {
    "prompt": "测试提示词",
    "duration": 5,
    "size": "1280*720"
})
```

### JavaScript API (前端)

```javascript
// 加载配置
async function loadConfig() {
    const response = await fetch("/xiser/vgm/config");
    const result = await response.json();
    return result.data;
}

// 获取模型配置
async function getModelConfig(modelName) {
    const config = await loadConfig();
    return config.models[modelName];
}
```

## 迁移指南

### 从旧系统迁移

1. **前端迁移**：
   - 旧的 `web/vgm_node_ui.js` 已删除
   - 新的 `web/vgm_node_ui_config.js` 使用动态配置
   - `web/index.js` 已更新为导入新文件

2. **后端迁移**：
   - 旧的 `providers_wan.py` 已删除
   - 新的 `providers_config.py` 使用统一配置
   - 注册表仅使用新系统

3. **配置迁移**：
   - 所有模型配置已移动到 `config/video_models.yaml`
   - 前后端使用相同的配置源

## 测试

运行测试脚本验证配置系统：

```bash
python test_config.py
```

## 故障排除

### 常见问题

1. **配置文件找不到**
   - 检查 `config/video_models.yaml` 是否存在
   - 检查文件路径权限

2. **配置加载失败**
   - 检查YAML语法是否正确
   - 查看控制台错误日志

3. **前端不显示新模型**
   - 检查模型是否添加到分组
   - 清除浏览器缓存
   - 重启ComfyUI

4. **API端点返回404**
   - 检查路由是否注册成功
   - 查看ComfyUI启动日志

### 日志

配置系统会输出以下日志：
- `[VGM] 使用统一配置系统注册提供者` - 配置系统成功加载
- `[VGM] 错误：注册配置提供者失败` - 配置系统加载失败
- `[VGM UI] 配置加载成功` - 前端配置加载成功
- `[VGM UI] 配置加载失败` - 前端配置加载失败

## 性能考虑

1. **缓存**：前端缓存配置5分钟，减少API调用
2. **懒加载**：配置在需要时加载，不影响启动时间
3. **错误恢复**：系统有多个回退机制确保可用性

## 未来扩展

1. **热重载**：支持配置文件热重载，无需重启
2. **多提供商**：支持多个视频生成服务提供商
3. **配置版本控制**：支持配置版本和迁移
4. **配置验证**：更严格的配置验证和错误提示

## 贡献指南

1. 添加新模型时，确保配置完整且准确
2. 更新配置时，测试前后端功能
3. 保持配置文件的YAML语法正确
4. 更新相关文档

---

**注意**：本配置系统是VGM Orchestrator节点的核心改进，显著提升了可维护性和扩展性。建议所有新模型都通过此系统添加。