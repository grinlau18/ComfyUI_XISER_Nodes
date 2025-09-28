# ComfyUI_XISER_Nodes

Welcome to **ComfyUI_XISER_Nodes**, a custom node package for [ComfyUI](https://github.com/comfyanonymous/ComfyUI). This package provides a comprehensive set of tools for image composition, visual editing, data processing, and workflow optimization.

---

## Installation

**Install via ComfyUI's Manager**

1. Open the ComfyUI Manager
2. Search for `ComfyUI_XISER_Nodes` and install it

**Manual installation**

1. Clone this repository into the `custom_nodes` directory of your ComfyUI installation:
   ```bash
   git clone https://github.com/grinlau18/ComfyUI_XISER_Nodes.git
   ```
2. In the `ComfyUI_XISER_Nodes` directory, run:
   ```bash
   pip install -r requirements.txt
   ```
3. Restart ComfyUI to load the new nodes
4. Look for nodes under the `XISER_Nodes` category in the ComfyUI interface

**Dependencies**: Requires `torch`, `PIL`, `numpy`, `opencv-python`, and ComfyUI core libraries.

---

## Node Categories Overview

### 🎨 Visual Editing Nodes

#### XIS_Canvas (Canvas System)
- **功能**: 交互式画布系统，支持多图层图像管理和编辑
- **特性**:
  - 自定义画布尺寸、边框和背景颜色
  - 支持拖拽、缩放、旋转图像操作
  - 图层管理和蒙版生成
  - 撤销/重做功能
  - PSD文件导入支持

![XIS_Canvas工作流展示](img/XIS_Canvas_1.jpeg)
![XIS_Canvas图层管理](img/XIS_Canvas_2.jpeg)
![XIS_Canvas图像合成](img/XIS_Canvas_3.jpeg)

#### XIS_CoordinatePath
- **功能**: 基于控制点生成坐标路径
- **特性**:
  - 支持线性和曲线路径模式
  - 可配置路径段数和分布模式
  - 输出坐标列表和百分比值

![XIS_CoordinatePath坐标路径生成](img/XIS_CoordinatePath.jpeg)

#### XIS_CurveEditor
- **功能**: 可视化曲线编辑器，生成分布值
- **特性**:
  - 支持INT、FLOAT、HEX数据类型
  - 多种插值方法
  - 颜色插值支持HSV、RGB、LAB模式

![XIS_CurveEditor曲线编辑界面](img/XIS_CurveEditor_1.jpeg)
![XIS_CurveEditor分布值生成](img/XIS_CurveEditor_2.jpeg)

#### XIS_MultiPointGradient
- **功能**: 基于控制点生成渐变图像
- **特性**:
  - 多种插值方法（IDW、径向、Voronoi等）
  - 线性模式支持固定首尾点
  - 可自定义渐变颜色和位置

![XIS_MultiPointGradient渐变图像生成](img/XIS_MultiPointGradient.jpeg)

#### XIS_CreateShape
- **功能**: 生成几何形状
- **特性**:
  - 支持圆形、多边形、星形、心形等多种形状
  - 可配置颜色、描边、透明度
  - 支持形状变换（旋转、缩放、倾斜）

![XIS_CreateShape形状生成](img/XIS_CreateShape_1.jpeg)
![XIS_CreateShape形状变换](img/XIS_CreateShape_2.jpeg)

### 🖼️ Image Processing Nodes

#### XIS_ImageManager
- **功能**: 图像管理器，处理图像输入、上传和预览
- **特性**:
  - 图像预览生成和路径管理
  - 支持多图像输入和输出
  - 自动缓存管理

![XIS_ImageManager图像管理](img/XIS_ImageManager.jpeg)

#### XIS_ImageAdjustAndBlend
- **功能**: 图像调整和混合
- **特性**:
  - 亮度、对比度、饱和度、色相调整
  - RGB通道增益控制
  - 支持蒙版和背景图像
  - 多种混合模式

#### XIS_CropImage
- **功能**: 使用蒙版裁剪图像
- **特性**:
  - 支持蒙版反转
  - 背景颜色填充
  - 可配置边距

#### XIS_ResizeImageOrMask
- **功能**: 灵活缩放图像和蒙版
- **特性**:
  - 多种缩放模式（强制缩放、等比缩放、画布限制等）
  - 支持多种插值算法
  - 可配置缩放条件（仅缩小、仅放大、始终缩放）

#### XIS_ReorderImageMaskGroups
- **功能**: 重新排序图像和蒙版组
- **特性**:
  - 支持插入和重新排列
  - 最多处理5组图像蒙版对

### 📊 Data Processing Nodes

#### XIS_ShapeData
- **功能**: 聚合形状属性数据
- **特性**:
  - 支持位置、旋转、缩放、倾斜、颜色等属性
  - 多输入端口数据合并
  - 属性计数处理

#### XIS_IsThereAnyData
- **功能**: 数据存在性检查
- **特性**:
  - 检查输入信号是否存在
  - 支持整数、浮点数、布尔值
  - 无输入时返回默认值

#### XIS_FromListGet1* Series
- **功能**: 从列表中提取单个元素
- **支持类型**: Mask, Image, Latent, Conditioning, Model, Color, String, Int, Float

### 🎛️ UI Control Nodes

#### XIS_PromptsWithSwitches
- **功能**: 带开关控制的提示词输入
- **特性**:
  - 最多支持5个提示词
  - 每个提示词独立开关控制
  - 输出启用的提示词列表

#### XIS_Float_Slider / XIS_INT_Slider
- **功能**: 滑块数值输入
- **特性**:
  - 浮点数和整数滑块
  - 可配置范围和步长

### 🔧 Utility Nodes

#### XIS_ResizeToDivisible
- **功能**: 缩放到可整除尺寸
- **特性**:
  - 自动计算最接近的可整除尺寸
  - 支持图像和蒙版

#### XIS_InvertMask
- **功能**: 蒙版反转
- **特性**:
  - 支持布尔开关控制
  - 自动处理值域范围

#### XIS_ImageMaskMirror
- **功能**: 图像和蒙版镜像翻转
- **特性**:
  - 支持X轴和Y轴翻转
  - 可启用/禁用翻转操作

### 📁 File Processing Nodes

#### PSD Layer Extract
- **功能**: PSD图层提取
- **特性**:
  - 从PSD文件中提取图层
  - 支持图层蒙版和透明度

#### XIS_ReorderImages
- **功能**: 图像重新排序
- **特性**:
  - 基于指定顺序重新排列图像
  - 支持批量图像处理

---

## Special Features

### Node Color Customization
- **功能**: 节点颜色自定义
- **使用方法**: 右键点击节点，选择"Change Node Color"
- **特性**: 可分别修改节点标题和内容区域的背景颜色

![节点颜色自定义](img/changeNodeColor.jpeg)

### Text Label with HTML Support
- **功能**: 支持HTML的文本标签
- **使用方法**: 右键点击节点上方，选择"Edit Text"
- **特性**: 使用HTML语言输入文字和设置样式

![文本标签功能](img/XIS_Label.jpeg)

---

## Workflow Examples

### Image Composition Workflow
使用XIS_Canvas和相关节点进行图像合成：
1. 使用XIS_ImageManager加载图像
2. 通过XIS_Canvas进行布局和编辑
3. 使用XIS_CanvasMaskProcessor处理蒙版
4. 输出合成结果

### Visual Editing Workflow
使用可视化编辑节点：
1. XIS_CoordinatePath生成坐标路径
2. XIS_CurveEditor创建分布曲线
3. XIS_MultiPointGradient生成渐变
4. XIS_CreateShape创建几何形状

---

## Contact & Resources

**Workflow Sharing**
https://openart.ai/workflows/profile/grinlau?tab=workflows&sort=latest

**Bilibili Space**
https://space.bilibili.com/123365258

**Contact**
QQ: 3861103314
Email: grinlau18@gmail.com

---

## Contributing

Contributions are welcome! Feel free to:
- Submit pull requests with new features or bug fixes
- Open issues for suggestions or problems

## License

This project is licensed under the [MIT License](LICENSE).