# Xiser_Nodes

A collection of custom nodes for ComfyUI

## Quickstart

1. Install [ComfyUI](https://docs.comfy.org/get_started).
1. clone this repository under `ComfyUI/custom_nodes`.
1. Restart ComfyUI.

## Node usage instructions

## XIS_CropImage
功能描述
使用蒙版裁剪图像，并支持蒙版反转和背景颜色填充。节点会根据蒙版的非零区域裁剪图像，并在蒙版为 0 的区域填充指定背景色，还可以添加额外的边框宽度。

输入参数
image (IMAGE): 输入图像，ComfyUI 的图像张量格式 [B, H, W, C]。
mask (MASK): 输入蒙版，用于裁剪图像，格式为 [H, W]。
invert_mask (BOOLEAN, 默认: False): 是否反转蒙版（True 表示反转）。
background_color (STRING, 默认: "#000000"): 背景颜色，使用 HEX 格式（如 #FFFFFF 为白色）。
padding_width (INT, 默认: 0, 范围: 0-1024): 添加到裁剪图像周围的边框宽度（像素）。
输出结果
image (IMAGE): 裁剪并填充后的图像，格式为 [1, H_new, W_new, C]。
使用示例
plaintext

收起

自动换行

复制
输入：
- image: 一张 512x512 的 RGB 图像
- mask: 一个 512x512 的蒙版，非零区域为主体部分
- invert_mask: False
- background_color: "#FFFFFF" (白色)
- padding_width: 10

输出：
- image: 裁剪后的图像，主体周围填充白色背景，并有 10 像素的边框

## XIS_IsThereAnyData
功能描述
检查是否有信号输入，并根据输入是否存在选择输出值。如果输入端口未连接，则输出默认值；否则输出输入值。

输入参数
default_int (INT, 默认: 0): 默认整数值。
default_float (FLOAT, 默认: 0.0): 默认浮点数值。
default_boolean (BOOLEAN, 默认: False): 默认布尔值。
int_input (INT, 可选): 输入整数值。
float_input (FLOAT, 可选): 输入浮点数值。
boolean_input (BOOLEAN, 可选): 输入布尔值。
输出结果
int_output (INT): 整数输出（输入或默认值）。
float_output (FLOAT): 浮点数输出（输入或默认值）。
boolean_output (BOOLEAN): 布尔值输出（输入或默认值）。
使用示例
plaintext

收起

自动换行

复制
输入：
- default_int: 10
- default_float: 0.5
- default_boolean: True
- int_input: 未连接
- float_input: 1.2
- boolean_input: False

输出：
- int_output: 10
- float_output: 1.2
- boolean_output: False

## XIS_IfDataIsNone
功能描述
检查输入信号是否为空，并将信号或默认值转换为指定数据类型输出。返回一个布尔值表示信号是否非空，以及对应类型的转换结果。

输入参数
data_type (STRING, 默认: "STRING", 选项: ["INT", "FLOAT", "BOOLEAN", "STRING"]): 目标数据类型。
default_value (STRING, 默认: "0"): 默认值，用于信号为空时。
signal (*, 可选, 默认: None): 输入信号，任意类型。
输出结果
is_not_null (BOOLEAN): 输入信号是否非空。
int_output (INT): 转换为整数的结果（若类型匹配）。
float_output (FLOAT): 转换为浮点数的结果（若类型匹配）。
boolean_output (BOOLEAN): 转换为布尔值的结果（若类型匹配）。
string_output (STRING): 转换为字符串的结果（若类型匹配）。
使用示例
plaintext

收起

自动换行

复制
输入：
- data_type: "FLOAT"
- default_value: "0"
- signal: 3.14

输出：
- is_not_null: True
- int_output: 0
- float_output: 3.14
- boolean_output: False
- string_output: ""

## XIS_ResizeToDivisible
功能描述
将输入的图像或蒙版缩放到最接近的可被指定除数整除的尺寸。

输入参数
divisor (INT, 默认: 64, 范围: 1-1024): 目标尺寸的除数。
image (IMAGE, 可选): 输入图像。
mask (MASK, 可选): 输入蒙版。
输出结果
image_output (IMAGE): 缩放后的图像。
mask_output (MASK): 缩放后的蒙版。
使用示例
plaintext

收起

自动换行

复制
输入：
- divisor: 64
- image: 500x700 的图像
- mask: 未连接

输出：
- image_output: 512x704 的图像（最接近 64 的倍数）
- mask_output: None

## XIS_InvertMask
功能描述
对输入蒙版进行反转处理，支持根据图像生成默认蒙版（全 1）。

输入参数
mask (MASK): 输入蒙版。
invert (BOOLEAN, 默认: True): 是否反转蒙版。
image (IMAGE, 可选): 可选图像，用于生成默认蒙版。
输出结果
mask_output (MASK): 反转后的蒙版。
使用示例
plaintext

收起

自动换行

复制
输入：
- mask: 512x512 的蒙版（0-1 范围）
- invert: True
- image: 未连接

输出：
- mask_output: 反转后的 512x512 蒙版

## XIS_ImageMaskMirror
功能描述
对图像和蒙版进行水平（X 轴）或垂直（Y 轴）镜像翻转。

输入参数
flip_axis (STRING, 默认: "X", 选项: ["X", "Y"]): 翻转轴（X 为水平，Y 为垂直）。
enable_flip (BOOLEAN, 默认: True): 是否启用翻转。
image (IMAGE, 可选): 输入图像。
mask (MASK, 可选): 输入蒙版。
输出结果
image_output (IMAGE): 翻转后的图像。
mask_output (MASK): 翻转后的蒙版。
使用示例
plaintext

收起

自动换行

复制
输入：
- flip_axis: "X"
- enable_flip: True
- image: 512x512 图像
- mask: 未连接

输出：
- image_output: 水平翻转的 512x512 图像
- mask_output: None

## XIS_ResizeImageOrMask
功能描述
对图像或蒙版进行缩放，支持多种缩放模式（如强制缩放、按比例缩放等），并可以参考图像或手动指定尺寸。

输入参数
resize_mode (STRING, 默认: "force_resize", 选项: ["force_resize", "scale_proportionally", "limited_by_canvas", "fill_the_canvas"]): 缩放模式。
scale_condition (STRING, 默认: "always", 选项: ["downscale_only", "upscale_only", "always"]): 缩放条件。
interpolation (STRING, 默认: "bilinear", 选项: ["nearest", "bilinear", "bicubic", "area", "nearest_exact", "lanczos"]): 插值方法。
min_unit (INT, 默认: 16, 范围: 1-64): 最小尺寸单位。
image (IMAGE, 可选): 输入图像。
mask (MASK, 可选): 输入蒙版。
reference_image (IMAGE, 可选): 参考图像，用于确定目标尺寸。
manual_width (INT, 默认: 512, 范围: 1-4096): 手动宽度。
manual_height (INT, 默认: 512, 范围: 1-4096): 手动高度。
fill_hex (STRING, 默认: "#000000"): 填充颜色（HEX 格式）。
输出结果
resized_image (IMAGE): 缩放后的图像。
resized_mask (MASK): 缩放后的蒙版。
width (INT): 输出宽度。
height (INT): 输出高度。
使用示例
plaintext

收起

自动换行

复制
输入：
- resize_mode: "scale_proportionally"
- scale_condition: "always"
- interpolation: "bilinear"
- min_unit: 16
- image: 800x600 图像
- mask: 未连接
- reference_image: 512x512 图像
- manual_width: 未连接
- manual_height: 未连接
- fill_hex: "#000000"

输出：
- resized_image: 按比例缩放到 512x384 的图像
- resized_mask: None
- width: 512
- height: 512

## XIS_PromptsWithSwitches
功能描述
输入多个提示词，并通过开关控制哪些提示词输出。返回启用的非空提示词列表和一个布尔值表示是否有有效提示。

输入参数
prompt_1 - prompt_5 (STRING, 默认: "", 多行): 提示词 1-5。
enable_1 - enable_5 (BOOLEAN, 默认: True): 是否启用提示词 1-5。
输出结果
prompts (STRING, 列表): 启用的非空提示词列表。
has_prompts (BOOLEAN): 是否有有效提示词。
使用示例
plaintext

收起

自动换行

复制
输入：
- prompt_1: "cat"
- enable_1: True
- prompt_2: ""
- enable_2: True
- prompt_3: "dog"
- enable_3: False

输出：
- prompts: ["cat"]
- has_prompts: True

## XIS_Float_Slider
功能描述
通过滑块输入一个浮点数值。

输入参数
value (FLOAT, 默认: 0.0, 范围: 0.0-1.0, 步长: 0.01, 显示: 滑块): 输入浮点数。
输出结果
value (FLOAT): 输入的浮点数值。
使用示例
plaintext

收起

自动换行

复制
输入：
- value: 0.75

输出：
- value: 0.75

## XIS_INT_Slider
功能描述
通过滑块输入一个整数值。

输入参数
value (INT, 默认: 0, 范围: 0-100, 步长: 1, 显示: 滑块): 输入整数。
输出结果
value (INT): 输入的整数值。
使用示例
plaintext

收起

自动换行

复制
输入：
- value: 42

输出：
- value: 42

## XIS_FromListGet1<Type> (Mask, Image, Latent, Cond, Model, Color, String, Int, Float)
功能描述
从输入列表中获取指定索引的单个元素，支持多种数据类型（如 MASK, IMAGE, LATENT 等）。

输入参数
list (<TYPE>, 列表): 输入列表。
index (INT, 默认: 0): 要获取的元素索引。
输出结果
output (<TYPE>): 指定索引处的单个元素。
使用示例
plaintext

收起

自动换行

复制
节点：XIS_FromListGet1String
输入：
- list: ["apple", "banana", "cherry"]
- index: 1

输出：
- output: "banana"

## XIS_ReorderImageMaskGroups
功能描述
重新排序输入的图像和蒙版组，将新的图像-蒙版对插入指定位置。

输入参数
insert_order (INT, 默认: 1, 范围: 1-5): 插入位置（1-5）。
insert_image (IMAGE, 可选): 要插入的图像。
insert_mask (MASK, 可选): 要插入的蒙版。
image_1 - image_4 (IMAGE, 可选): 原有图像 1-4。
mask_1 - mask_4 (MASK, 可选): 原有蒙版 1-4。
输出结果
image_1 - image_5 (IMAGE): 重排后的图像。
mask_1 - mask_5 (MASK): 重排后的蒙版。
使用示例
plaintext

收起

自动换行

复制
输入：
- insert_order: 2
- insert_image: 新图像
- insert_mask: 新蒙版
- image_1: 图像 A
- mask_1: 蒙版 A
- image_2: 图像 B
- mask_2: 蒙版 B

输出：
- image_1: 图像 A
- mask_1: 蒙版 A
- image_2: 新图像
- mask_2: 新蒙版
- image_3: 图像 B
- mask_3: 蒙版 B
- image_4: None
- mask_4: None
- image_5: None
- mask_5: None

## XIS_CompositorProcessor
功能描述
对输入图像进行缩放、旋转并放置到指定画板上，支持中心点定位和背景颜色设置。

输入参数
image (IMAGE): 输入图像。
x (INT, 默认: 0): 中心点 X 坐标。
y (INT, 默认: 0): 中心点 Y 坐标。
width (INT, 默认: 512): 缩放宽度。
height (INT, 默认: 512): 缩放高度。
angle (INT, 默认: 0): 旋转角度（度）。
canvas_width (INT, 默认: 512): 画板宽度。
canvas_height (INT, 默认: 512): 画板高度。
background_color (STRING, 默认: "#FFFFFF"): 画板背景颜色（HEX 格式）。
输出结果
output_image (IMAGE): 处理后的图像。
使用示例
plaintext

收起

自动换行

复制
输入：
- image: 256x256 图像
- x: 256
- y: 256
- width: 128
- height: 128
- angle: 45
- canvas_width: 512
- canvas_height: 512
- background_color: "#FFFFFF"

输出：
- output_image: 512x512 画板，图像缩放到 128x128 并旋转 45 度，位于中心

## XIS_KSamplerSettingsNode
功能描述
打包 KSampler 的采样设置到一个字典中，方便后续解包使用。

输入参数
steps (INT, 默认: 20): 采样步数。
cfg (FLOAT, 默认: 7.5): CFG 强度。
sampler_name (STRING, 默认: "euler"): 采样器名称。
scheduler (STRING, 默认: "normal"): 调度器名称。
start_step (INT, 默认: 0): 开始步数。
end_step (INT, 默认: 20): 结束步数。
model (MODEL, 可选): 模型。
vae (VAE, 可选): VAE。
clip (CLIP, 可选): CLIP。
输出结果
settings_pack (DICT): 打包的设置字典。
使用示例
plaintext

收起

自动换行

复制
输入：
- steps: 30
- cfg: 8.0
- sampler_name: "dpmpp_2m"
- scheduler: "karras"
- start_step: 0
- end_step: 30

输出：
- settings_pack: {"steps": 30, "cfg": 8.0, "sampler_name": "dpmpp_2m", ...}

## XIS_KSamplerSettingsUnpackNode
功能描述
从打包的设置字典中解包 KSampler 参数。

输入参数
settings_pack (DICT): 输入的设置字典。
输出结果
model (MODEL): 模型。
vae (VAE): VAE。
clip (CLIP): CLIP。
steps (INT): 采样步数。
cfg (FLOAT): CFG 强度。
sampler_name (SAMPLER): 采样器名称。
scheduler (SCHEDULER): 调度器名称。
start_step (INT): 开始步数。
end_step (INT): 结束步数。
使用示例
plaintext

收起

自动换行

复制
输入：
- settings_pack: {"steps": 30, "cfg": 8.0, "sampler_name": "dpmpp_2m", ...}

输出：
- steps: 30
- cfg: 8.0
- sampler_name: "dpmpp_2m"
- ...

## XIS_MaskCompositeOperation
功能描述
对两个掩码执行布尔操作（加、减、交、差），并支持模糊、扩充/缩减、反转处理。如果提供参考图像，会生成叠加图像，掩码为 0 的区域保持原图。

输入参数
mask1 (MASK): 主输入蒙版。
operation (STRING, 默认: "add", 选项: ["add", "subtract", "intersect", "difference"]): 布尔操作类型。
blur_radius (FLOAT, 默认: 0.0, 范围: 0.0-100.0): 模糊半径。
expand_shrink (FLOAT, 默认: 0.0, 范围: -100.0-100.0): 扩充（正）或缩减（负）。
invert_mask (BOOLEAN, 默认: False): 是否反转结果蒙版。
overlay_color (STRING, 默认: "#FF0000"): 叠加颜色（HEX 格式）。
opacity (FLOAT, 默认: 0.5, 范围: 0.0-1.0): 叠加透明度。
mask2 (MASK, 可选): 第二蒙版（若为 64x64 全零则视为 None）。
reference_image (IMAGE, 可选): 参考图像。
输出结果
result_mask (MASK): 处理后的蒙版。
overlay_image (IMAGE): 叠加后的图像（若无参考图则为全零张量）。
使用示例
plaintext

收起

自动换行

复制
输入：
- mask1: 512x512 蒙版
- operation: "add"
- blur_radius: 5.0
- expand_shrink: 10.0
- invert_mask: False
- overlay_color: "#00FF00"
- opacity: 0.7
- mask2: 256x256 蒙版（会缩放到 512x512）
- reference_image: 512x512 图像

输出：
- result_mask: 处理后的 512x512 蒙版
- overlay_image: 512x512 图像，蒙版非零区域显示绿色（透明度 0.7）
