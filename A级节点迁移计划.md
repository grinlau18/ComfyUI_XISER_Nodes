# A级节点迁移到v3架构计划

## 概述
本计划详细说明如何将15个A级中等复杂度节点迁移到v3架构。遵循"逐步转向v3，已迁移节点不再兼容legacy"的原则。

## 迁移统计
- **总A级节点数**: 15个
- **已迁移节点**: 0个 (0%)
- **待迁移节点**: 15个 (100%)
- **预计完成时间**: 分3个阶段完成

## A级节点清单

### 1. 图像与蒙版模块 (`image_and_mask.py`)
| 节点名称 | 前端 | 复杂度 | 迁移优先级 | 备注 |
|---------|------|--------|------------|------|
| XIS_LoadImage | 无 | 中等 | 高 | 基础图像加载节点 |
| XIS_ResizeToDivisible | 无 | 中等 | 高 | 尺寸调整节点 |
| XIS_CropImage | 无 | 中等 | 高 | 图像裁剪节点 |
| XIS_InvertMask | 无 | 低 | 中 | 蒙版反转节点 |
| XIS_ImageMaskMirror | 无 | 中等 | 中 | 图像蒙版镜像 |
| XIS_ReorderImageMaskGroups | 无 | 中等 | 中 | 重排序图像蒙版组 |
| XIS_MaskCompositeOperation | 无 | 中等 | 中 | 蒙版合成操作 |
| XIS_MaskBatchProcessor | 无 | 中等 | 中 | 蒙版批处理器 |
| XIS_CompositorProcessor | 无 | 中等 | 中 | 合成器处理器 |

### 2. 独立A级节点
| 文件 | 节点名称 | 前端 | 复杂度 | 迁移优先级 | 备注 |
|------|---------|------|--------|------------|------|
| `resize_image_or_mask.py` | XIS_ResizeImageOrMask | 无 | 中等 | 高 | 通用尺寸调整 |
| `psd_layer_extract.py` | XIS_PSDLayerExtractor | `psd_upload.js` | 高 | 高 | 有前端交互 |
| `adjust_image.py` | XIS_ImageAdjustAndBlend | `adjust_image.js` | 高 | 高 | 有前端交互 |
| `image_puzzle.py` | XIS_ImagePuzzle | 无 | 中等 | 中 | 图像拼图处理 |
| `shape_data.py` | XIS_ShapeData | 无 | 中等 | 中 | 形状数据生成 |
| `sampling.py` | XIS_DynamicKSampler | 无 | 中等 | 高 | 采样相关 |
| `sampling.py` | XIS_LatentBlendNode | 无 | 中等 | 高 | 潜变量混合 |

## 迁移策略

### 1. 总体原则
- **纯v3架构**：所有节点完全转向v3 API，移除legacy兼容代码
- **前端不变**：JS前端保持不变，通过v3自定义类型交互
- **分批迁移**：按优先级分3个阶段完成

### 2. 技术规范
所有A级节点迁移必须遵循以下规范：

#### 2.1 类继承
```python
from comfy_api.latest import io, ComfyExtension

class XIS_NodeName(io.ComfyNode):
    # v3节点实现
```

#### 2.2 Schema定义
```python
@classmethod
def define_schema(cls):
    return io.Schema(
        node_id="XIS_NodeName",
        display_name="XIS Node Name",
        category="XISER_Nodes/Category",
        inputs=[
            # 使用正确的v3类型
            io.Image.Input("image"),
            io.Int.Input("width", default=512, min=1, max=4096),
            io.Combo.Input("mode", options=["option1", "option2"], default="option1"),
        ],
        outputs=[
            # 所有输出必须包含display_name
            io.Image.Output("output_image", display_name="output_image"),
            io.Mask.Output("output_mask", display_name="output_mask"),
        ],
    )
```

#### 2.3 执行方法
```python
@classmethod
def execute(cls, image, width, mode):
    # 处理逻辑
    result = process_image(image, width, mode)
    return io.NodeOutput(result,)
```

#### 2.4 自定义类型（用于前端交互）
对于有前端交互的节点：
```python
# 定义自定义类型
PSDData = io.Custom("XIS_PSD_DATA")
AdjustData = io.Custom("XIS_ADJUST_DATA")

# 在schema中使用
inputs=[
    PSDData.Input("psd_data"),
    AdjustData.Input("adjust_data"),
]
```

#### 2.5 扩展注册
```python
class NodeExtension(ComfyExtension):
    async def get_node_list(self):
        return [XIS_NodeName]

async def comfy_entrypoint():
    return NodeExtension()
```

## 迁移阶段计划

### 阶段1：基础图像处理节点（高优先级）
**目标**：迁移无前端交互的基础节点
**时间**：第1周
**节点**：
1. XIS_LoadImage (`image_and_mask.py`)
2. XIS_ResizeToDivisible (`image_and_mask.py`)
3. XIS_CropImage (`image_and_mask.py`)
4. XIS_ResizeImageOrMask (`resize_image_or_mask.py`)
5. XIS_DynamicKSampler (`sampling.py`)
6. XIS_LatentBlendNode (`sampling.py`)

**验收标准**：
- ✅ 节点在ComfyUI中正常显示
- ✅ 基本功能测试通过
- ✅ 输出格式正确

### 阶段2：中等复杂度节点（中优先级）
**目标**：迁移剩余的无前端节点
**时间**：第2周
**节点**：
1. XIS_InvertMask (`image_and_mask.py`)
2. XIS_ImageMaskMirror (`image_and_mask.py`)
3. XIS_ReorderImageMaskGroups (`image_and_mask.py`)
4. XIS_MaskCompositeOperation (`image_and_mask.py`)
5. XIS_MaskBatchProcessor (`image_and_mask.py`)
6. XIS_CompositorProcessor (`image_and_mask.py`)
7. XIS_ImagePuzzle (`image_puzzle.py`)
8. XIS_ShapeData (`shape_data.py`)

**验收标准**：
- ✅ 所有节点功能测试通过
- ✅ 性能测试通过
- ✅ 边缘情况处理正确

### 阶段3：有前端交互的节点（高优先级但复杂）
**目标**：迁移有JS前端的复杂节点
**时间**：第3周
**节点**：
1. XIS_PSDLayerExtractor (`psd_layer_extract.py`) - 前端：`psd_upload.js`
2. XIS_ImageAdjustAndBlend (`adjust_image.py`) - 前端：`adjust_image.js`

**特殊要求**：
- 需要验证前端与v3自定义类型的交互
- 需要确保序列化数据结构一致
- 需要测试Vue模式和传统模式兼容性

## 技术挑战与解决方案

### 挑战1：图像数据类型处理
**问题**：v3的`io.Image`类型与legacy图像格式可能不同
**解决方案**：
- 使用标准HWC RGBA格式
- 确保float值在[0,1]范围
- 使用列表容器包装图像

### 挑战2：前端交互兼容性
**问题**：JS前端需要与v3自定义类型交互
**解决方案**：
- 保持`addDOMWidget`调用不变
- 确保序列化数据结构一致
- 使用相同的widget名称

### 挑战3：批量处理节点
**问题**：`XIS_MaskBatchProcessor`等节点处理列表输入
**解决方案**：
- 使用`is_list=True`参数
- 确保输出列表格式正确
- 处理空列表边缘情况

## 测试计划

### 1. 单元测试
- 每个节点迁移后立即进行单元测试
- 测试输入输出类型匹配
- 测试边界条件和错误处理

### 2. 集成测试
- 测试节点在ComfyUI中的加载
- 测试节点间的连接和数据流
- 测试工作流保存和加载

### 3. 前端兼容性测试
- 测试有前端节点的JS交互
- 测试Vue模式和传统模式
- 测试序列化和反序列化

### 4. 性能测试
- 测试大图像处理性能
- 测试批量处理性能
- 测试内存使用情况

## 质量保证

### 代码审查清单
- [ ] 继承自`io.ComfyNode`
- [ ] 有`define_schema()`方法
- [ ] 有`@classmethod execute()`方法
- [ ] 输出端口包含`display_name`参数
- [ ] 使用正确的v3类型（`io.Boolean`而非`io.Bool`）
- [ ] 自定义类型定义正确
- [ ] 扩展注册完整
- [ ] 移除所有legacy兼容代码
- [ ] 错误处理完善

### 功能验证清单
- [ ] 节点在ComfyUI中正常显示
- [ ] 输入输出连接正常
- [ ] 基本功能工作正常
- [ ] 前端交互正常（如有）
- [ ] 工作流保存/加载正常
- [ ] 性能可接受

## 风险与缓解

### 风险1：v3 API变化
**影响**：迁移过程中v3 API可能变化
**缓解**：
- 使用`comfy_api.latest`导入
- 定期检查API文档
- 保持代码灵活可适配

### 风险2：前端兼容性问题
**影响**：JS前端在Vue模式下可能有问题
**缓解**：
- 严格遵循前端兼容性规范
- 测试两种界面模式
- 使用DOM相对坐标计算

### 风险3：性能下降
**影响**：v3节点可能比legacy节点慢
**缓解**：
- 进行性能基准测试
- 优化关键路径代码
- 考虑异步处理

## 成功标准

### 技术成功标准
1. ✅ 所有15个A级节点迁移到v3架构
2. ✅ 节点在ComfyUI中正常加载和显示
3. ✅ 所有功能测试通过
4. ✅ 前端交互正常（对于有前端的节点）
5. ✅ 性能在可接受范围内
6. ✅ 代码符合v3 API规范

### 业务成功标准
1. ✅ 用户可以使用所有A级节点
2. ✅ 工作流兼容性保持
3. ✅ 迁移过程对用户透明
4. ✅ 文档更新完成

## 下一步行动

### 立即行动（第1天）
1. 更新迁移进度报告，反映新的加载策略
2. 开始阶段1的第一个节点迁移（XIS_LoadImage）
3. 创建测试用例模板

### 短期行动（第1周）
1. 完成阶段1的6个节点迁移
2. 进行单元测试和集成测试
3. 更新节点清单的schema_version

### 中期行动（第2-3周）
1. 完成阶段2和阶段3的节点迁移
2. 进行全面的测试和验证
3. 更新所有相关文档

### 长期行动
1. 开始S级节点迁移规划
2. 性能优化和代码重构
3. 用户反馈收集和改进

---

**计划制定时间**: 2025-12-04
**计划版本**: v1.0
**状态**: 待执行
**负责人**: AI代理 + 用户验证