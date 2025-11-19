# ComfyUI_XISER_Nodes

<div align="center">

🌐 **Language Selection / 语言选择**

[**English Documentation**](README.md) • [**中文文档**](README_CN.md)

</div>

欢迎使用 **ComfyUI_XISER_Nodes**，这是一个为 [ComfyUI](https://github.com/comfyanonymous/ComfyUI) 开发的综合性自定义节点包。该扩展提供先进的视觉编辑功能，包括交互式多层画布实时变换、专业的PSD文件导入与图层提取、多样化的几何形状生成与抗锯齿渲染，以及复杂的图像处理工具。支持批量形状创建、蒙版操作、提示词管理、数据流优化和工作流增强工具，为高效的AI图像生成和编辑工作流提供强大支持。

---

## 快速开始

### XIS_Canvas 快速入门
1. **添加 XIS_Canvas 节点**：在 `XISER_Nodes/Visual_Editing` 类别中找到
2. **连接图像**：将图像输入连接到 `pack_images` 端口
3. **配置画布**：设置尺寸、边框和背景颜色
4. **交互式编辑**：使用画布界面定位、缩放和旋转图层
5. **生成输出**：将输出连接到工作流进行进一步处理

### XIS_ShapeAndText 快速入门
1. **添加 XIS_ShapeAndText 节点**：位于 `XISER_Nodes/Visual_Editing` 类别
2. **选择形状类型**：从圆形、多边形、星形、心形等选择
3. **自定义外观**：设置颜色、描边和透明度
4. **应用变换**：使用交互式画布进行定位和缩放
5. **批量处理**：连接形状数据进行多形状生成

---

## 核心功能

### 🎨 高级视觉编辑
- **交互式画布**：支持实时变换的多图层图像编辑
- **形状生成**：创建具有高级变换功能的几何形状
- **渐变工具**：多种插值方法的多点渐变生成

### 🔧 专业工作流工具
- **PSD导入**：专业的PSD文件导入与图层提取
- **图像处理**：高级图像调整、裁剪和缩放
- **数据管理**：高效的数据流优化和列表处理

### 🎛️ 用户体验
- **直观界面**：可折叠面板、实时预览和交互控制
- **自定义功能**：节点颜色自定义和HTML文本标签
- **历史管理**：20步撤销/重做功能

---

## 安装

**通过 ComfyUI 管理器安装**

1. 打开 ComfyUI 管理器
2. 搜索 `ComfyUI_XISER_Nodes` 并安装

**手动安装**

1. 将此仓库克隆到 ComfyUI 安装目录的 `custom_nodes` 文件夹中：
   ```bash
   git clone https://github.com/grinlau18/ComfyUI_XISER_Nodes.git
   ```
2. 在 `ComfyUI_XISER_Nodes` 目录中运行：
   ```bash
   pip install -r requirements.txt
   ```
3. 重启 ComfyUI 以加载新节点
4. 在 ComfyUI 界面的 `XISER_Nodes` 类别下查找节点

**依赖项**：需要 `torch`、`PIL`、`numpy`、`opencv-python` 和 ComfyUI 核心库。

---

## 节点分类概览

### 🎨 视觉编辑节点

#### XIS_Canvas (画布系统)
- **功能**：交互式画布系统，支持多图层图像管理和编辑
- **特性**：
  - 自定义画布尺寸、边框和背景颜色
  - 拖拽、缩放、旋转图像操作，支持实时预览
  - 图层管理，自动置顶和堆叠顺序
  - 精确图像合成的蒙版生成
  - 20步历史的撤销/重做功能
  - 自动尺寸功能，匹配第一张图像尺寸
  - 显示缩放，改善工作流可见性
  - PSD文件导入支持与图层提取
  - 实时变换控制，支持独立缩放
  - 鼠标滚轮缩放和Alt+滚轮旋转精确控制

![XIS_Canvas工作流展示](img/XIS_Canvas_1.jpeg)
![XIS_Canvas图层管理](img/XIS_Canvas_2.jpeg)
![XIS_Canvas图像合成](img/XIS_Canvas_3.jpeg)

#### XIS_CoordinatePath
- **功能**：基于控制点生成坐标路径
- **特性**：
  - 支持线性和曲线路径模式
  - 可配置路径段数和分布模式
  - 输出坐标列表和百分比值

![XIS_CoordinatePath坐标路径生成](img/XIS_CoordinatePath.jpeg)

#### XIS_CurveEditor
- **功能**：可视化曲线编辑器，生成分布值
- **特性**：
  - 支持INT、FLOAT、HEX数据类型
  - 多种插值方法
  - 颜色插值支持HSV、RGB、LAB模式

![XIS_CurveEditor曲线编辑界面](img/XIS_CurveEditor_1.jpeg)
![XIS_CurveEditor分布值生成](img/XIS_CurveEditor_2.jpeg)

#### XIS_MultiPointGradient
- **功能**：基于控制点生成渐变图像
- **特性**：
  - 多种插值方法（IDW、径向、Voronoi等）
  - 线性模式支持固定首尾点
  - 可自定义渐变颜色和位置

![XIS_MultiPointGradient渐变图像生成](img/XIS_MultiPointGradient.jpeg)

#### XIS_ShapeAndText
- **功能**：使用交互控制生成几何形状
- **特性**：
  - 多种形状类型：圆形、多边形、星形、心形、花朵、螺旋、太阳爆发、正方形
  - **字体模式**：Text 模式可将文本转换为矢量图形，支持 fonts 目录自定义字体、字距/行距调节以及粗体、斜体、下划线、大写等样式
  - 可配置颜色、描边、透明度和背景
  - 高级变换：旋转、缩放、倾斜、定位
  - 通过形状数据输入进行批量形状创建
  - 抗锯齿渲染，边缘平滑
  - 分离的形状图像、蒙版和背景输出
  - 带有交互画布小部件的实时预览

![XIS_ShapeAndText形状生成](img/XIS_ShapeAndText_1.jpeg)
![XIS_ShapeAndText形状变换](img/XIS_ShapeAndText_2.jpeg)

> **字体使用方式**：将 `.ttf/.otf/.ttc` 文件放入 `custom_nodes/ComfyUI_XISER_Nodes/fonts` 目录，在 Text 模式面板点击「刷新字体」即可加载；所有文本参数会写入 `shape_params`，批量模式同样生效。

### 🖼️ 图像处理节点

#### XIS_ImageManager
- **功能**：图像管理器，处理图像输入、上传和预览
- **特性**：
  - 图像预览生成和路径管理
  - 支持多图像输入和输出
  - 自动缓存管理

![XIS_ImageManager图像管理](img/XIS_ImageManager.jpeg)

#### XIS_ImageAdjustAndBlend
- **功能**：图像调整和混合
- **特性**：
  - 亮度、对比度、饱和度、色相调整
  - RGB通道增益控制
  - 支持蒙版和背景图像
  - 多种混合模式

#### XIS_CropImage
- **功能**：使用蒙版裁剪图像
- **特性**：
  - 支持蒙版反转
  - 背景颜色填充
  - 可配置边距

#### XIS_ResizeImageOrMask
- **功能**：灵活缩放图像和蒙版
- **特性**：
  - 多种缩放模式（强制缩放、等比缩放、画布限制等）
  - 支持多种插值算法
  - 可配置缩放条件（仅缩小、仅放大、始终缩放）

#### XIS_ReorderImageMaskGroups
- **功能**：重新排序图像和蒙版组
- **特性**：
  - 支持插入和重新排列
  - 最多处理5组图像蒙版对

### 📊 数据处理节点

#### XIS_ShapeData
- **功能**：聚合形状属性数据
- **特性**：
  - 支持位置、旋转、缩放、倾斜、颜色等属性
  - 多输入端口数据合并
  - 属性计数处理

#### XIS_IsThereAnyData
- **功能**：数据存在性检查
- **特性**：
  - 检查输入信号是否存在
  - 支持整数、浮点数、布尔值
  - 无输入时返回默认值

#### XIS_FromListGet1* 系列
- **功能**：从列表中提取单个元素
- **支持类型**：Mask, Image, Latent, Conditioning, Model, Color, String, Int, Float

### 🎛️ UI 控制节点

#### XIS_PromptsWithSwitches
- **功能**：带开关控制的提示词输入
- **特性**：
  - 最多支持5个提示词
  - 每个提示词独立开关控制
  - 输出启用的提示词列表

#### XIS_Float_Slider / XIS_INT_Slider
- **功能**：滑块数值输入
- **特性**：
  - 浮点数和整数滑块
  - 可配置范围和步长

### 🔧 工具节点

#### XIS_ResizeToDivisible
- **功能**：缩放到可整除尺寸
- **特性**：
  - 自动计算最接近的可整除尺寸
  - 支持图像和蒙版

#### XIS_InvertMask
- **功能**：蒙版反转
- **特性**：
  - 支持布尔开关控制
  - 自动处理值域范围

#### XIS_ImageMaskMirror
- **功能**：图像和蒙版镜像翻转
- **特性**：
  - 支持X轴和Y轴翻转
  - 可启用/禁用翻转操作

### 📁 文件处理节点

#### PSD Layer Extract
- **功能**：PSD图层提取
- **特性**：
  - 从PSD文件中提取图层
  - 支持图层蒙版和透明度

#### XIS_ReorderImages
- **功能**：图像重新排序
- **特性**：
  - 基于指定顺序重新排列图像
  - 支持批量图像处理

---

## 使用指南

### XIS_Canvas 操作指南

**图层选择与变换：**
- **选择图层**：点击任意图像图层进行选择
- **移动**：拖动选中的图层重新定位
- **缩放**：使用控制框手柄或鼠标滚轮进行精确缩放
- **旋转**：使用Alt + 鼠标滚轮或控制框旋转手柄
- **独立缩放**：使用角点手柄独立缩放X和Y轴

**图层管理：**
- **图层面板**：使用左上角可折叠图层面板进行图层选择
- **自动置顶**：选中的图层自动置顶
- **取消选择**：点击画布背景取消选择并恢复原始顺序

**画布控制：**
- **自动尺寸**：启用后自动调整画布匹配第一张图像尺寸
- **显示缩放**：调整画布显示大小而不影响输出
- **边框宽度**：配置画布周围边框大小（默认：80px）
- **画布颜色**：选择画布背景颜色（黑色、白色、透明）

**高级功能：**
- **撤销/重做**：所有变换的20步历史记录
- **重置画布**：居中所有图像并恢复默认状态
- **PSD导入**：导入PSD文件并提取图层
- **实时预览**：立即查看变换效果

### XIS_ShapeAndText 操作指南

**形状创建：**
- **形状类型**：圆形、多边形、星形、心形、花朵、螺旋、太阳爆发、正方形
- **交互画布**：带有交互小部件的实时预览
- **批量处理**：通过形状数据输入创建多个形状

**变换功能：**
- **位置**：相对于画布中心的归一化定位
- **旋转**：角度旋转（度）
- **缩放**：独立的X和Y轴缩放
- **倾斜**：水平和垂直倾斜变换

**样式设置：**
- **颜色**：可配置的形状和背景颜色
- **描边**：可自定义的描边宽度、颜色和连接样式
- **透明度**：透明背景选项

---

## 工作流示例

### 图像合成工作流
使用XIS_Canvas和相关节点进行图像合成：
1. 使用XIS_ImageManager加载图像
2. 通过XIS_Canvas进行布局和编辑
3. 使用XIS_CanvasMaskProcessor处理蒙版
4. 输出合成结果

### 视觉编辑工作流
使用可视化编辑节点：
1. XIS_CoordinatePath生成坐标路径
2. XIS_CurveEditor创建分布曲线
3. XIS_MultiPointGradient生成渐变
4. XIS_ShapeAndText创建几何形状

---

## 特殊功能

### 节点颜色自定义
- **功能**：节点颜色自定义
- **使用方法**：右键点击节点，选择"Change Node Color"
- **特性**：可分别修改节点标题和内容区域的背景颜色

![节点颜色自定义](img/changeNodeColor.jpeg)

### 支持HTML的文本标签
- **功能**：支持HTML的文本标签
- **使用方法**：右键点击节点上方，选择"Edit Text"
- **特性**：使用HTML语言输入文字和设置样式

![文本标签功能](img/XIS_Label.jpeg)

---

## 联系与资源

**工作流分享**
https://openart.ai/workflows/profile/grinlau?tab=workflows&sort=latest

**Bilibili空间**
https://space.bilibili.com/123365258

**联系方式**
QQ: 3861103314
Email: grinlau18@gmail.com

---

## 贡献

欢迎贡献！您可以：
- 提交包含新功能或错误修复的拉取请求
- 为建议或问题开启议题

## 许可证

本项目采用 [MIT 许可证](LICENSE)。

---
