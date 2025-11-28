# XIS_ImageManager 编辑器坐标系统测试计划

## 概述
新的坐标系统架构已经实现，基于原始图像尺寸进行计算，然后按比例缩放显示。此测试计划用于验证系统在各种图像尺寸下的表现。

## 新坐标系统架构

### 核心变量
- `actualWidth` / `actualHeight`: 原始图像尺寸
- `displayScale`: 显示缩放比例（适应窗口）
- `userZoom`: 用户缩放比例（鼠标滚轮）
- `canvasOffsetX` / `canvasOffsetY`: 画布偏移量（居中显示）

### 坐标转换流程
1. **鼠标坐标 → 显示坐标**
   ```javascript
   const displayX = (rawX - canvasOffsetX) / (displayScale * userZoom);
   const displayY = (rawY - canvasOffsetY) / (displayScale * userZoom);
   ```

2. **显示坐标 → 裁剪框显示位置**
   ```javascript
   const left = crop.x * displayScale * userZoom + canvasOffsetX;
   const top = crop.y * displayScale * userZoom + canvasOffsetY;
   ```

## 测试用例

### 测试1: 小尺寸图像 (小于编辑器窗口)
- **图像尺寸**: 512x512
- **预期行为**: 图像按原始尺寸显示，裁剪框操作正常
- **验证点**:
  - 控制点检测准确
  - 拖拽操作流畅
  - 边界约束正确

### 测试2: 中等尺寸图像 (接近编辑器窗口)
- **图像尺寸**: 1024x768
- **预期行为**: 图像适当缩放以适应窗口，裁剪框操作正常
- **验证点**:
  - 显示缩放比例计算正确
  - 坐标转换准确
  - 鼠标滚轮缩放功能正常

### 测试3: 大尺寸图像 (远大于编辑器窗口)
- **图像尺寸**: 2048x1536
- **预期行为**: 图像显著缩小显示，裁剪框操作正常
- **验证点**:
  - 控制点检测阈值随缩放调整
  - 拖拽操作在缩放状态下准确
  - 边界约束在原始尺寸下正确

### 测试4: 超宽图像
- **图像尺寸**: 2560x800
- **预期行为**: 按宽度缩放，保持宽高比
- **验证点**:
  - 显示比例计算正确
  - 裁剪框位置准确

### 测试5: 超高图像
- **图像尺寸**: 800x2560
- **预期行为**: 按高度缩放，保持宽高比
- **验证点**:
  - 显示比例计算正确
  - 裁剪框位置准确

## 交互功能测试

### 鼠标滚轮缩放
- **正向滚动**: 放大图像和裁剪框
- **反向滚动**: 缩小图像和裁剪框
- **验证点**:
  - 缩放中心保持在鼠标位置
  - 缩放范围限制在 10% - 500%
  - 裁剪框随图像同步缩放

### 控制点操作
- **角点控制**: 可同时调整相邻两边
- **边中点控制**: 只能调整单边
- **验证点**:
  - 控制点检测准确
  - 拖拽操作流畅
  - 最小尺寸约束正确

### 裁剪框移动
- **内部拖拽**: 移动整个裁剪框
- **外部拖拽**: 创建新裁剪框
- **验证点**:
  - 移动操作流畅
  - 边界约束正确
  - 新裁剪框创建准确

## 调试信息

系统在控制台输出详细的调试信息：

```javascript
// 图像加载
log.debug(`Image loaded: ${actualWidth}x${actualHeight}, displayScale=${displayScale.toFixed(3)}, userZoom=${userZoom.toFixed(3)}`);

// 坐标转换
log.debug(`Coordinate conversion: raw=(${rawX},${rawY}) -> display=(${displayX},${displayY}) -> image=(${clampedX},${clampedY})`);

// 控制点检测
log.debug(`Handle detection: pos=(${pos.x},${pos.y}), crop=(${left},${top},${right},${bottom}), threshold=${threshold}`);

// 拖拽操作
log.debug(`ApplyDrag: dragging=${dragging}, startPoint=(${startPoint.x},${startPoint.y}), pos=(${pos.x},${pos.y})`);

// 鼠标滚轮缩放
log.debug(`Mouse wheel zoom: userZoom=${userZoom}, zoomPercent=${Math.round(userZoom * 100)}%`);
```

## 预期结果

1. **统一性**: 无论图像来源（pack_images 或上传），操作体验一致
2. **准确性**: 所有交互操作基于原始图像尺寸，显示缩放不影响操作精度
3. **流畅性**: 鼠标滚轮缩放和拖拽操作流畅自然
4. **稳定性**: 在各种图像尺寸下系统稳定运行

## 验证方法

1. 打开浏览器开发者工具查看控制台输出
2. 使用不同尺寸的图像进行测试
3. 验证所有交互功能正常工作
4. 检查坐标转换的准确性