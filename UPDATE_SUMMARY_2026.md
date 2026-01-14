# ComfyUI_XISER_Nodes 项目更新说明 (2026年1月)

## 主要更新内容

### ✅ V3架构迁移
- 后端全面采用ComfyUI最新API标准
- 所有节点升级到V3架构，提升性能和稳定性

### ✅ 新增核心节点
- **XIS_ImagePreview** - 图像预览节点，支持布局切换和保存功能
- **XIS_DynamicPackImages** - 动态打包图像节点，支持最多20对图像/蒙版输入
- **XIS_DynamicImageInputs** - 动态图像输入节点，支持最多20个图像输入

### ✅ 删除冗余节点
- 移除与`image manager`功能重叠的`reorder images`节点
- 使用`XIS_ImageManager`作为替代方案

### ✅ LLM Orchestrator增强
- 新增Wan 2.6模型支持，提供专业的图像编辑功能
- 支持图像编辑模式和图文混排（interleave）模式
- 增强多模态处理能力

### ✅ 性能优化
- 改进节点交互和系统性能
- 优化图像处理算法和内存管理

---

**更新日期**: 2026年1月14日
**版本**: v3.0.0