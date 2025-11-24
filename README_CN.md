# ComfyUI_XISER_Nodes

<div align="center">

🌐 **Language Selection / 语言选择**

[**English Documentation**](README.md) • [**中文文档**](README_CN.md)

</div>

欢迎使用 **ComfyUI_XISER_Nodes**，这是一个为 [ComfyUI](https://github.com/comfyanonymous/ComfyUI) 开发的综合性自定义节点包。该扩展提供先进的视觉编辑功能，包括交互式多层画布实时变换、专业的PSD文件导入与图层提取、多样化的几何形状生成与抗锯齿渲染，以及复杂的图像处理工具。支持批量形状创建、蒙版操作、提示词管理、数据流优化和工作流增强工具，为高效的AI图像生成和编辑工作流提供强大支持。

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

### 抠图模型配置
画布中的新抠图功能依赖 BiRefNet 蒙版模型，按以下步骤安装：

1. 下载 `BiRefNet-general-epoch_244.pth` 检查点，并放入 `ComfyUI/models/BiRefNet/pth/`。可使用以下镜像：
   - https://pan.baidu.com/s/12z3qUuqag3nqpN2NJ5pSzg?pwd=ek65
   - https://drive.google.com/drive/folders/1s2Xe0cjq-2ctnJBR24563yMSCOu4CcxM
2. 在 ComfyUI 所在环境中安装推理依赖：`pip install kornia==0.7.2 timm`
3. 重启 ComfyUI，画布上的抠图按钮即可调用 BiRefNet 并将带透明区域的结果保存在界面与输出中。

---

## 核心能力
- 多图层画布编辑，支持 PSD 导入、BiRefNet 抠图、图层变换与蒙版历史管理。
- 可视化节点套件包含曲线/路径/渐变编辑器、图像管理、形状/文本生成、节点配色与标签助手。
- 图像/蒙版/文件工具涵盖调色、裁剪、缩放、重新排序、镜像与 PSD 图层处理。
- 数据与工作流支持包括形状摘要、信号检测、简写序列化、列表抽取与可整除尺寸修正。

### 🖼️ 多图层画布枢纽（XIS_Canvas）
- **精华**：集成 BiRefNet 抠图、PSD 导入、图层变换、蒙版生成与 20 步历史的主控画布。
- **亮点**：
  - 拖拽、缩放、旋转、显隐、叠放与 Alt+滚轮旋转，实时预览画布中每一层。
  - 支持自定义画布尺寸、边框、背景、自动适配、显示缩放以及滚动内容的自定义滚动条，长内容依然流畅可读。
  - BiRefNet 抠图、蒙版生成和 PSD 多图层提取紧密衔接，XIS_CanvasMaskProcessor 保持蒙版与画布状态同步。
  - 只需一键即可输出带透明层的剪裁结果，省去手动裁切流程。

#### 节点界面
![XIS_Canvas节点展示](img/XIS_Canvas_1.jpeg)
#### 导入PSD进行区域重绘的工作流示例
![XIS_Canvas导入PSD进行区域重绘工作流](img/XIS_Canvas_2.jpeg)
#### 图像分层排版后进行区域重绘的工作流示例
![XIS_Canvas图像合成加区域重绘工作流](img/XIS_Canvas_3.jpeg)

### ✨ 可视节点工具包
- **XIS_CurveEditor**：编辑 INT/FLOAT/HEX 曲线，提供可调的贝塞尔点以及 HSV/RGB/LAB 颜色插值。
  - 输出标量序列及可选的彩色列表，以便下游节点复用数值斜坡或调色提示。
  ![XIS_CurveEditor曲线编辑界面](img/XIS_CurveEditor_1.jpeg)  
  ![XIS_CurveEditor分布值生成](img/XIS_CurveEditor_2.jpeg)

- **XIS_CoordinatePath**：绘制线性或曲线路径，可设置段数、分布模式，并直接导出 x/y 坐标与百分比进度列表。
  - 曲线模式通过带虚拟端点的 Catmull-Rom 样条生成平滑轨迹，线性模式支持均匀或缓动间距。
  ![XIS_CoordinatePath坐标路径生成](img/XIS_CoordinatePath.jpeg)

- **XIS_MultiPointGradient**：使用 IDW、径向、Voronoi、软 IDW 或线性插值从控制点生成渐变图像。
  - 后端计算像素权重或 Voronoi 区域，输出可直接用作蒙版、背景或纹理填充的 torch 张量。
  ![XIS_MultiPointGradient渐变图像生成](img/XIS_MultiPointGradient.jpeg)

- **XIS_ImageManager**：管理并重排上传图像，最终输出带预览的 `pack_images`。
  - 记录启用状态、上传顺序、缩略图、确定性 ID 与元数据，确保下游节点看到一致的图像包。
  ![XIS_ImageManager图像管理](img/XIS_ImageManager.jpeg)

- **XIS_ShapeAndText**：生成形状或文本蒙版，支持填充/描边、透明度以及 `shape_data` 批量输入；返回形状图、蒙版与背景。
  - 支持圆、多边形、星、心、花、螺旋、太阳爆发与文本（可加载本地字体），并可调节字距/行距、描边、变换与倾斜。
  ![XIS_ShapeAndText形状生成](img/XIS_ShapeAndText_1.jpeg)  
  ![XIS_ShapeAndText形状变换](img/XIS_ShapeAndText_2.jpeg)

- **changeNodeColor**：可独立修改节点标题与内容的颜色，提升大型流程可读性。
  - 支持输入十六进制或预设色块，可在标题/内容间切换，并锁定配色方案以快速区分。

  ![Node Color Customization](img/changeNodeColor_1.jpeg)  

- **XIS_Label**：双击编辑 HTML/Markdown，切换编辑器、调整背景与文本缩放，并享受统一段距、列表重新换行与智能滚动条。
  - Markdown 支持标题、列表、加粗/斜体、行内代码与链接，解析后渲染出一致的段落与滚动行为。
  ![文本标签功能](img/XIS_Label_1.jpeg)

---

### 🧰 图像、蒙版与文件节点
- **XIS_ImageAdjustAndBlend**：调节亮度/对比/饱和/色相、RGB 增益与混合模式，可混入蒙版和背景。
- **XIS_CropImage**：使用蒙版裁剪，支持蒙版反转与背景色填充，并可设定边距。
- **XIS_ResizeImageOrMask**：多种缩放策略（强制、等比、画布限制）与插值器，支持只放/只缩等条件。
- **XIS_ReorderImageMaskGroups**：最多 5 组图像/蒙版对，支持插入与重新排序。
- **XIS_InvertMask**：一键切换蒙版正负向。
- **XIS_ImageMaskMirror**：沿 X/Y 轴镜像图像与蒙版，保持布局对称。
- **PSD Layer Extract / XIS_ReorderImages**：提取 PSD 图层并排序，辅助图像批量处理。

### ⚙️ 数据与工具助手
- **XIS_ShapeData**：收集位置、旋转、缩放、倾斜、颜色等形状属性，供后续节点复用。
- **XIS_IsThereAnyData**：检查整数/浮点/布尔信号是否存在，没有时返回默认。
- **CreatePointsString**：将六组帧与强度串成多行 shorthand，方便在提示词或蒙版中复用。
- **XIS_FromListGet1…**：从列表中取出单个 Mask/Image/Latent/Conditioning/Model/Color/String/Int/Float。
- **XIS_ResizeToDivisible**：将尺寸修正到可整除格，适配下游需求。

---

## 致谢

- 交互画布部分基于 [Konva](https://konvajs.org/) 构建，感谢 Konva 团队提供稳定的 2D 图形 API。
- 抠图功能依赖 [BiRefNet](https://github.com/tamzi/bi-ref-net)，感谢原作者与 tin2tin/2D_Asset_Generator 社区项目，并同时使用 `kornia` 与 `timm` 的推理支持。
- 感谢 ComfyUI 与社区中所有自定义节点作者对多图层画布、历史记录等功能的持续投入。

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
