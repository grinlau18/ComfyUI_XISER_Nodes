# V3 Migration

> How to migrate your existing V1 nodes to the new V3 schema.

## Overview

The ComfyUI V3 schema introduces a more organized way of defining nodes, and future extensions to node features will only be added to V3 schema. You can use this guide to help you migrate your existing V1 nodes to the new V3 schema.

## Core Concepts

The V3 schema is kept on the new versioned Comfy API, meaning future revisions to the schema will be backwards compatible. `comfy_api.latest` will point to the latest numbered API that is still under development; the version before latest is what can be considered 'stable'. Version `v0_0_2` is the current (and first) API version so more changes will be made to it without warning. Once it is considered stable, a new version `v0_0_3` will be created for `latest` to point at.

```python  theme={null}
# use latest ComfyUI API
from comfy_api.latest import ComfyExtension, io, ui

# use a specific version of ComfyUI API
from comfy_api.v0_0_2 import ComfyExtension, io, ui
```

### V1 vs V3 Architecture

The biggest changes in V3 schema are:

* Inputs and Outputs defined by objects instead of a dictionary.
* The execution method is fixed to the name 'execute' and is a class method.
* `def comfy_entrypoint()` function that returns a ComfyExtension object defines exposed nodes instead of NODE\_CLASS\_MAPPINGS/NODE\_DISPLAY\_NAME\_MAPPINGS
* Node objects do not expose 'state' - `def __init__(self)` will have no effect on what is exposed in the node's functions, as all of them are class methods. The node class is sanitized before execution as well.

#### V1 (Legacy)

```python  theme={null}
class MyNode:
    @classmethod
    def INPUT_TYPES(s):
        return {"required": {...}}

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "execute"
    CATEGORY = "my_category"

    def execute(self, ...):
        return (result,)

NODE_CLASS_MAPPINGS = {"MyNode": MyNode}
```

#### V3 (Modern)

```python  theme={null}
from comfy_api.latest import ComfyExtension, io

class MyNode(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="MyNode",
            display_name="My Node",
            category="my_category",
            inputs=[...],
            outputs=[...]
        )

    @classmethod
    def execute(cls, ...) -> io.NodeOutput:
        return io.NodeOutput(result)

class MyExtension(ComfyExtension):
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [MyNode]

async def comfy_entrypoint() -> ComfyExtension:
    return MyExtension()
```

## Migration Steps

Going from V1 to V3 should be simple in most cases and is simply a syntax change.

### Step 1: Change Base Class

All V3 Schema nodes should inherit from `ComfyNode`. Multiple layers of inheritance are okay as long as at the top of the chain there is a `ComfyNode` parent.

**V1:**

```python  theme={null}
class Example:
    def __init__(self):
        pass
```

**V3:**

```python  theme={null}
from comfy_api.latest import io

class Example(io.ComfyNode):
    # No __init__ needed
```

### Step 2: Convert INPUT\_TYPES to define\_schema

Node properties like node id, display name, category, etc. that were assigned in different places in code such as dictionaries and class properties are now kept together via the `Schema` class.

The `define_schema(cls)` function is expected to return a `Schema` object in much the same way INPUT\_TYPES(s) worked in V1.

Supported core Input/Output types are stored and documented in `comfy_api/{version}` in `_io.py`, which is namespaced as `io` by default. Since Inputs/Outputs are defined by classes now instead of dictionaries or strings, custom types are supported by either defining your own class or using the helper function `Custom` in `io`.

Custom types are elaborated on in a section further below.

A type class has the following properties:

* `class Input` for Inputs (i.e. `Model.Input(...)`)
* `class Output` for Outputs (i.e. `Model.Output(...)`). Note that all types may not support being an output.
* `Type` for getting a typehint of the type (i.e. `Model.Type`). Note that some typehints are just `any`, which may be updated in the future. These typehints are not enforced and just act as useful documentation.

**V1:**

```python  theme={null}
@classmethod
def INPUT_TYPES(s):
    return {
        "required": {
            "image": ("IMAGE",),
            "int_field": ("INT", {
                "default": 0,
                "min": 0,
                "max": 4096,
                "step": 64,
                "display": "number"
            }),
            "string_field": ("STRING", {
                "multiline": False,
                "default": "Hello"
            }),
            # V1 handling of arbitrary types
            "custom_field": ("MY_CUSTOM_TYPE",),
        },
        "optional": {
            "mask": ("MASK",)
        }
    }
```

**V3:**

```python  theme={null}
@classmethod
def define_schema(cls) -> io.Schema:
    return io.Schema(
        node_id="Example",
        display_name="Example Node",
        category="examples",
        description="Node description here",
        inputs=[
            io.Image.Input("image"),
            io.Int.Input("int_field",
                default=0,
                min=0,
                max=4096,
                step=64,
                display_mode=io.NumberDisplay.number
            ),
            io.String.Input("string_field",
                default="Hello",
                multiline=False
            ),
            # V3 handling of arbitrary types
            io.Custom("my_custom_type").Input("custom_input"),
            io.Mask.Input("mask", optional=True)
        ],
        outputs=[
            io.Image.Output()
        ]
    )
```

### Step 3: Update Execute Method

All execution functions in v3 are named `execute` and are class methods.

**V1:**

```python  theme={null}
def test(self, image, string_field, int_field):
    # Process
    image = 1.0 - image
    return (image,)
```

**V3:**

```python  theme={null}
@classmethod
def execute(cls, image, string_field, int_field) -> io.NodeOutput:
    # Process
    image = 1.0 - image

    # Return with optional UI preview
    return io.NodeOutput(image, ui=ui.PreviewImage(image, cls=cls))
```

### Step 4: Convert Node Properties

Here are some examples of property names; see the source code in `comfy_api.latest._io` for more details.

| V1 Property    | V3 Schema Field             | Notes                       |
| -------------- | --------------------------- | --------------------------- |
| `RETURN_TYPES` | `outputs` in Schema         | List of Output objects      |
| `RETURN_NAMES` | `display_name` in Output    | Per-output display names    |
| `FUNCTION`     | Always `execute`            | Method name is standardized |
| `CATEGORY`     | `category` in Schema        | String value                |
| `OUTPUT_NODE`  | `is_output_node` in Schema  | Boolean flag                |
| `DEPRECATED`   | `is_deprecated` in Schema   | Boolean flag                |
| `EXPERIMENTAL` | `is_experimental` in Schema | Boolean flag                |

### Step 5: Handle Special Methods

The same special methods are supported as in v1, but either lowercased or renamed entirely to be more clear. Their usage remains the same.

#### Validation (V1 → V3)

The input validation function was renamed to `validate_inputs`.

**V1:**

```python  theme={null}
@classmethod
def VALIDATE_INPUTS(s, **kwargs):
    # Validation logic
    return True
```

**V3:**

```python  theme={null}
@classmethod
def validate_inputs(cls, **kwargs) -> bool | str:
    # Return True if valid, error string if not
    if error_condition:
        return "Error message"
    return True
```

#### Lazy Evaluation (V1 → V3)

The `check_lazy_status` function is class method, remains the same otherwise.

**V1:**

```python  theme={null}
def check_lazy_status(self, image, string_field, ...):
    if condition:
        return ["string_field"]
    return []
```

**V3:**

```python  theme={null}
@classmethod
def check_lazy_status(cls, image, string_field, ...):
    if condition:
        return ["string_field"]
    return []
```

#### Cache Control (V1 → V3)

The functionality of cache control remains the same as in V1, but the original name was very misleading as to how it operated.

V1's `IS_CHANGED` function signals execution not to trigger rerunning the node if the return value is the SAME as the last time the node was ran.

Thus, the function `IS_CHANGED` was renamed to `fingerprint_inputs`. One of the most common mistakes by developers was thinking if you return `True`, the node would always re-run. Because `True` would always be returned, it would have the opposite effect of only making the node run once and reuse cached values.

An example of using this function is the LoadImage node. It returns the hash of the selected file, so that if the file changes, the node will be forced to rerun.

**V1:**

```python  theme={null}
@classmethod
def IS_CHANGED(s, **kwargs):
    return "unique_value"
```

**V3:**

```python  theme={null}
@classmethod
def fingerprint_inputs(cls, **kwargs):
    return "unique_value"
```

### Step 6: Create Extension and Entry Point

Instead of defining dictionaries to link node id to node class/display name, there is now a `ComfyExtension` class and an expected `comfy_entrypoint` function to be defined.

In the future, more functions may be added to ComfyExtension to register more than just nodes via `get_node_list`.

`comfy_entrypoint` can be either async or not, but `get_node_list` must be defined as async.

**V1:**

```python  theme={null}
NODE_CLASS_MAPPINGS = {
    "Example": Example
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "Example": "Example Node"
}
```

**V3:**

```python  theme={null}
from comfy_api.latest import ComfyExtension

class MyExtension(ComfyExtension):
    # must be declared as async
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [
            Example,
            # Add more nodes here
        ]

# can be declared async or not, both will work
async def comfy_entrypoint() -> MyExtension:
    return MyExtension()
```

## Input Type Reference

Already explained in step 2, but here are some type reference comparisons in V1 vs V3. See `comfy_api.latest._io` for the full type declarations.

### Basic Types

| V1 Type     | V3 Type              | Example                                                      |
| ----------- | -------------------- | ------------------------------------------------------------ |
| `"INT"`     | `io.Int.Input()`     | `io.Int.Input("count", default=1, min=0, max=100)`           |
| `"FLOAT"`   | `io.Float.Input()`   | `io.Float.Input("strength", default=1.0, min=0.0, max=10.0)` |
| `"STRING"`  | `io.String.Input()`  | `io.String.Input("text", multiline=True)`                    |
| `"BOOLEAN"` | `io.Boolean.Input()` | `io.Boolean.Input("enabled", default=True)`                  |

### ComfyUI Types

| V1 Type          | V3 Type                   | Example                                          |
| ---------------- | ------------------------- | ------------------------------------------------ |
| `"IMAGE"`        | `io.Image.Input()`        | `io.Image.Input("image", tooltip="Input image")` |
| `"MASK"`         | `io.Mask.Input()`         | `io.Mask.Input("mask", optional=True)`           |
| `"LATENT"`       | `io.Latent.Input()`       | `io.Latent.Input("latent")`                      |
| `"CONDITIONING"` | `io.Conditioning.Input()` | `io.Conditioning.Input("positive")`              |
| `"MODEL"`        | `io.Model.Input()`        | `io.Model.Input("model")`                        |
| `"VAE"`          | `io.VAE.Input()`          | `io.VAE.Input("vae")`                            |
| `"CLIP"`         | `io.CLIP.Input()`         | `io.CLIP.Input("clip")`                          |

### Combo (Dropdowns/Selection Lists)

Combo types in V3 require explicit class definition.

**V1:**

```python  theme={null}
"mode": (["option1", "option2", "option3"],)
```

**V3:**

```python  theme={null}
io.Combo.Input("mode", options=["option1", "option2", "option3"])
```

### AnyType 和 Custom 类型

在V3中，`io.AnyType` 和 `io.Custom("*")` 是等价的，都表示可以接受任意类型的输入。但在使用上有重要区别：

#### AnyType 类型

`io.AnyType` 是预定义的通配符类型，用于接受任意类型的输入：

**V3:**

```python  theme={null}
io.AnyType.Input("signal", optional=True, tooltip="可选的信号输入")
```

#### Custom 类型

`io.Custom("*")` 创建的自定义类型与 `io.AnyType` 功能相同：

**V3:**

```python  theme={null}
io.Custom("*").Input("signal", optional=True, tooltip="可选的信号输入")
```

#### 重要限制：不支持 default 参数

**关键发现**：`io.AnyType.Input()` 和 `io.Custom("*").Input()` **不支持** `default` 参数。这是因为：

1. `AnyType`/`Custom("*")` 的 `Input` 类继承自 `io.Input` 基类，而不是 `io.WidgetInput`
2. `io.Input` 基类只支持以下参数：`id`, `display_name`, `optional`, `tooltip`, `lazy`, `extra_dict`
3. `io.WidgetInput` 类才支持 `default` 参数

**错误示例：**
```python  theme={null}
# ❌ 错误：AnyType/Custom输入不支持default参数
io.AnyType.Input("signal", optional=True, default=None)  # TypeError!
io.Custom("*").Input("signal", optional=True, default=None)  # TypeError!
```

**正确做法：**
1. **在Input定义中不使用default参数**
2. **在execute方法中处理默认值**

**V3正确实现：**

```python  theme={null}
@classmethod
def define_schema(cls) -> io.Schema:
    return io.Schema(
        node_id="Example",
        inputs=[
            io.AnyType.Input("signal", optional=True, tooltip="可选输入"),
            io.String.Input("default_value", default="default")  # ✅ 标准类型支持default
        ],
        outputs=[io.String.Output()]
    )

@classmethod
def execute(cls, signal=None, default_value="default"):
    """在execute方法中处理默认值"""
    result = signal if signal is not None else default_value
    return io.NodeOutput(result)
```

#### 类型选择建议

1. **优先使用 `io.AnyType`**：语义更清晰，代码更易读
2. **避免使用 `default` 参数**：对于AnyType/Custom类型，在execute方法中处理默认值
3. **标准类型仍可使用default**：`io.Int.Input()`, `io.String.Input()` 等标准类型支持 `default` 参数

#### 类型大小写规范

在V3 API中，类型的大小写规则需要特别注意：

**正确的大小写形式**：
- `io.Boolean`, `io.Int`, `io.Float`, `io.String` - 首字母大写
- `io.Image`, `io.Mask`, `io.Latent`, `io.Model` - 首字母大写
- `io.Vae`, `io.Clip` - **首字母大写，其余小写**（常见错误点）
- `io.Conditioning` - 首字母大写

**常见错误**：
```python
# ❌ 错误：VAE和CLIP使用全大写
io.VAE.Input("vae")  # AttributeError: no attribute 'VAE'
io.CLIP.Input("clip")  # AttributeError: no attribute 'CLIP'

# ✅ 正确：使用正确的大小写
io.Vae.Input("vae")    # 注意：Vae不是VAE
io.Clip.Input("clip")  # 注意：Clip不是CLIP
```

**大小写检查方法**：
1. 查看错误信息提示，如 `Did you mean: 'Vae'?`
2. 参考ComfyUI官方文档或已成功运行的V3节点
3. 使用小写形式测试常见类型（Boolean, Int, Float, String, Image, Mask等）
4. 对于特殊类型（Vae, Clip），记住它们的大小写规则

**迁移时的注意事项**：
- V1中的 `"VAE"` 类型对应 V3 的 `io.Vae`
- V1中的 `"CLIP"` 类型对应 V3 的 `io.Clip`
- 其他类型通常保持首字母大写即可

## Advanced Features

### UI Integration

V3 provides built-in UI helpers to avoid common boilerplate of saving files.

```python  theme={null}
from comfy_api.latest import ui

@classmethod
def execute(cls, images) -> io.NodeOutput:
    # Show preview in node
    return io.NodeOutput(images, ui=ui.PreviewImage(images, cls=cls))
```

### Output Nodes

For nodes that produce side effects (like saving files). Same as in V1, marking a node as output will display a `run` play button in the node's context window, allowing for partial execution of the graph.

```python  theme={null}
@classmethod
def define_schema(cls) -> io.Schema:
    return io.Schema(
        node_id="SaveNode",
        inputs=[...],
        outputs=[],  # Does not need to be empty.
        is_output_node=True  # Mark as output node
    )
```

### Custom Types

Create custom input/output types either via class definition of `Custom` helper function.

```python  theme={null}
from comfy_api.latest import io

# Method 1: Using decorator with class
@io.comfytype(io_type="MY_CUSTOM_TYPE")
class MyCustomType:
    Type = torch.Tensor  # Python type hint

    class Input(io.Input):
        def __init__(self, id: str, **kwargs):
            super().__init__(id, **kwargs)

    class Output(io.Output):
        def __init__(self, **kwargs):
            super().__init__(**kwargs)

# Method 2: Using Custom helper
# The helper can be used directly without saving to a variable first for convenience as well
MyCustomType = io.Custom("MY_CUSTOM_TYPE")
```


---

# ComfyUI 列表处理：input_is_list 和 output_is_list 详解

## 概述

在ComfyUI中，`input_is_list`和`output_is_list`是用于处理批量数据（列表）的重要机制。它们允许节点一次处理多个输入或输出多个结果，这对于批量处理、数据转换和流水线操作非常有用。

在ComfyUI的工作流中，数据通常以单个值的形式在节点间传递。但有些场景需要：
- 批量处理多个图像
- 从列表中提取特定元素
- 将单个输入转换为多个输出
- 合并多个输入为一个输出

列表处理机制允许节点以列表形式接收或返回数据。

### input_is_list 的作用

当 `INPUT_IS_LIST = True` 时：
- 节点的所有输入都会以列表形式传递
- 即使只有一个输入连接，也会被包装在列表中
- 适用于需要批量处理输入的节点

**典型用例**：
- 从列表中获取特定索引的元素
- 批量应用相同的操作到多个输入
- 合并多个输入

### output_is_list 的作用

`OUTPUT_IS_LIST` 可以是一个布尔值或元组：
- 单个布尔值：所有输出都是列表
- 元组：每个输出独立控制是否为列表

**典型用例**：
- 生成多个变体
- 拆分输入为多个部分
- 批量处理并返回多个结果

## V1架构中的实现

### 类属性定义

在V1架构中，列表处理通过类属性实现：

```python
# 示例：列表处理节点
class XIS_FromListGet1Image:
    # 标记所有输入为列表
    INPUT_IS_LIST = True

    # 定义输入类型
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "list": ("IMAGE", {"forceInput": True}),
                "index": ("INT", {"default": 0, "min": -2147483648})
            }
        }

    # 定义返回类型
    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "get_one"
    CATEGORY = "XISER_Nodes/Data_Processing"

    def get_one(self, list, index):
        """从列表中获取单个元素"""
        if not list:
            raise ValueError("Input list cannot be empty")
        # 注意：当INPUT_IS_LIST=True时，list是列表的列表
        # index也是列表（所有输入都是列表）
        actual_list = list[0]  # 获取实际的图像列表
        actual_index = index[0] % len(actual_list)  # 获取索引
        return (actual_list[actual_index],)
```

### output_is_list 的多种形式

```python
# 示例1：所有输出都是列表
class XIS_DynamicImageInputs:
    RETURN_TYPES = ("IMAGE",)
    OUTPUT_IS_LIST = (True,)  # 单个输出为列表

    def process_images(self, **kwargs):
        images = []
        # 收集所有连接的图像
        for key, value in kwargs.items():
            if key.startswith("image_") and value is not None:
                images.append(value)
        return (images,)  # 返回列表

# 示例2：混合输出类型
class XIS_CoordinatePath:
    RETURN_TYPES = ("INT", "INT", "FLOAT", "FLOAT", "LIST", "LIST")
    OUTPUT_IS_LIST = (True, True, True, True, False, False)
    # 前4个输出是列表，后2个是单个值
```

### 执行方法中的处理

当使用列表功能时，执行方法需要特殊处理：

```python
def execute(self, string_list, separator, strip_items, skip_empty):
    """
    合并字符串列表

    由于INPUT_IS_LIST=True，所有输入都是列表
    我们只需要第一个元素，因为所有元素都相同
    """
    # 提取实际参数（列表的第一个元素）
    separator = separator[0] if isinstance(separator, list) and len(separator) > 0 else ", "
    strip_items = strip_items[0] if isinstance(strip_items, list) and len(strip_items) > 0 else True
    skip_empty = skip_empty[0] if isinstance(skip_empty, list) and len(skip_empty) > 0 else True

    # 处理字符串列表（string_list是列表的列表）
    result_strings = []
    for strings in string_list:
        processed = self._process_strings(strings, separator, strip_items, skip_empty)
        result_strings.append(processed)

    return (result_strings,)
```

## V3架构中的实现

### 架构变化

V3架构对列表处理进行了重构：
- `is_input_list`：移动到`Schema`类中
- `is_output_list`：保留在`Output`类中，但参数名更明确

### Schema 类定义

```python
# 来自 comfy_api/latest/_io.py
@dataclass
class Schema:
    """Definition of V3 node properties."""

    node_id: str
    display_name: str = None
    category: str = "sd"
    inputs: list[Input] = field(default_factory=list)
    outputs: list[Output] = field(default_factory=list)
    hidden: list[Hidden] = field(default_factory=list)
    description: str = ""

    # 关键变化：is_input_list 移动到 Schema 级别
    is_input_list: bool = False
    """A flag indicating if this node implements the additional code necessary to deal with OUTPUT_IS_LIST nodes.

    All inputs of ``type`` will become ``list[type]``, regardless of how many items are passed in. This also affects ``check_lazy_status``.
    """

    is_output_node: bool = False
    is_deprecated: bool = False
    is_experimental: bool = False
    is_api_node: bool = False
    not_idempotent: bool = False
    enable_expand: bool = False
```

### Output 类定义

```python
# 来自 comfy_api/latest/_io.py
class Output(_IO_V3):
    def __init__(self, id: str=None, display_name: str=None, tooltip: str=None,
                 is_output_list=False):  # 参数名更明确
        self.id = id
        self.display_name = display_name
        self.tooltip = tooltip
        self.is_output_list = is_output_list  # 存储为实例属性
```

### V3节点示例

```python
from comfy_api.latest import io

class XIS_FromListGet1ImageV3(io.ComfyNode):
    """V3版本的列表获取节点"""

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="XIS_FromListGet1Image",
            display_name="From List Get 1 Image",
            category="XISER_Nodes/Data_Processing",
            description="从图像列表中获取指定索引的图像",
            inputs=[
                io.Image.Input("list", tooltip="输入图像列表"),
                io.Int.Input("index",
                           default=0,
                           min=-2147483648,
                           tooltip="要获取的索引（支持负数）")
            ],
            outputs=[
                io.Image.Output(display_name="selected_image")
            ],
            is_input_list=True  # 对应 V1 的 INPUT_IS_LIST = True
        )

    @classmethod
    def execute(cls, image_list, index):
        """
        执行方法

        注意：当 is_input_list=True 时，
        image_list 是列表，index 也是列表
        """
        if not image_list:
            raise ValueError("Input list cannot be empty")

        # 获取实际索引（V3中索引也是列表）
        actual_index = index % len(image_list)
        selected_image = image_list[actual_index]

        return io.NodeOutput(selected_image)
```

### 混合输出类型示例

```python
class XIS_CoordinatePathV3(io.ComfyNode):
    """V3版本的坐标路径节点"""

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="XIS_CoordinatePath",
            display_name="Coordinate Path",
            category="XISER_Nodes/Visual_Editing",
            description="生成坐标路径，支持批量输出",
            inputs=[
                # ... 输入定义
            ],
            outputs=[
                io.Int.Output(display_name="x_coordinate", is_output_list=True),
                io.Int.Output(display_name="y_coordinate", is_output_list=True),
                io.Float.Output(display_name="x_percent", is_output_list=True),
                io.Float.Output(display_name="y_percent", is_output_list=True),
                io.Custom("LIST").Output(display_name="x_list", is_output_list=False),
                io.Custom("LIST").Output(display_name="y_list", is_output_list=False)
            ]
            # 注意：这里没有 is_input_list，因为输入不是列表
        )

    @classmethod
    def execute(cls, control_points, segments, distribution_mode):
        """生成坐标路径"""
        # 生成路径点
        path_points = cls.calculate_path(control_points, segments, distribution_mode)

        # 提取坐标
        x_coords = [point["x"] for point in path_points]
        y_coords = [point["y"] for point in path_points]
        x_percents = [point["x_percent"] for point in path_points]
        y_percents = [point["y_percent"] for point in path_points]

        return io.NodeOutput(
            x_coords,      # 列表输出
            y_coords,      # 列表输出
            x_percents,    # 列表输出
            y_percents,    # 列表输出
            x_coords,      # 单个列表输出
            y_coords       # 单个列表输出
        )
```


# ComfyUI V3 API 核心文件解析

/Users/grin/Documents/comfy/ComfyUI/comfy_api/latest/_io.py, 这个文件是 ComfyUI API V3 的核心输入/输出类型定义文件。

## 核心内容

1. 类型系统定义• 基础类型类: _ComfyType (第90行) - 所有 ComfyUI 类型的基类• 类型装饰器: comfytype() (第96行) - 用于标记嵌套类为 ComfyType• 输入/输出基类: Input, WidgetInput, Output (第165-234行)
2. 数据类型枚举• 文件夹类型: FolderType (第35行) - input/output/temp• 上传类型: UploadType (第41行) - image/audio/video/model• 数字显示方式: NumberDisplay (第75行) - number/slider
3. 具体数据类型类文件定义了大量的 ComfyUI 数据类型，包括：• 基础类型: Boolean, Int, Float, String (第247-340行)• 组合类型: Combo, MultiCombo (第341-416行)• AI相关类型: Image, Mask, Latent, Conditioning (第417-576行)• 模型类型: Model, VAE, CLIP, ControlNet 等 (第595-644行)• 多媒体类型: Audio, Video, SVG (第645-660行)• 3D类型: Voxel, Mesh, Load3D (第671-738行)• 特殊类型: AnyType, MultiType, MatchType (第761-877行)
4. 动态输入类型• Autogrow (第901-1004行): 自动增长的输入类型• DynamicCombo (第1005-1056行): 动态组合输入• DynamicSlot (第1057-1102行): 动态插槽输入• DynamicInput, DynamicOutput (第878-900行): 动态输入/输出的抽象基类
5. 节点架构• Schema类 (第1202-1386行): 定义 V3 节点的属性• ComfyNode基类 (第1749-1795行): 所有 V3 节点的基类• NodeOutput类 (第1797-1829行): 标准化的节点输出
6. 隐藏变量系统• Hidden枚举 (第1149-1165行): 定义可请求的隐藏变量• HiddenHolder类 (第1115-1148行): 隐藏变量的持有者
7. 版本兼容性• V1/V3信息类: NodeInfoV1, NodeInfoV3 (第1168-1200行)• 向后兼容方法: 提供 V1 API 的兼容性支持


## 主要作用

1. 类型安全: 为 ComfyUI 节点提供强类型的输入/输出定义
2. API标准化: 统一 V3 API 的数据类型和节点接口
3. 动态扩展: 支持动态输入/输出，允许节点根据运行时条件改变接口
4. 向后兼容: 提供从 V1 到 V3 的平滑迁移路径
5. 元数据管理: 管理节点的显示名称、工具提示、类别等元数据
6. 验证系统: 提供输入验证、模式验证等功能

## 关键特性
• 装饰器模式: 使用 @comfytype 装饰器定义新类型
• 动态类型系统: 支持运行时动态扩展的输入/输出
• 模式验证: 通过 Schema.validate() 确保节点定义的正确性
• 资源管理: 通过 Resources 和 ResourcesLocal 管理节点资源
• 懒加载支持: 通过 check_lazy_status() 支持懒加载输入

这个文件是 ComfyUI V3 API 的核心基础设施，为构建可扩展、类型安全的自定义节点提供了完整的框架。

---

# 迁移常见问题与解决方案

## 问题1：类型大小写错误（VAE/CLIP等）

### 错误现象
```
AttributeError: module 'comfy_api.latest._io_public' has no attribute 'VAE'. Did you mean: 'Vae'?
AttributeError: module 'comfy_api.latest._io_public' has no attribute 'CLIP'. Did you mean: 'Clip'?
```

### 原因分析
- ComfyUI V3 API中某些类型使用特定的大小写规则
- `VAE` 和 `CLIP` 类型在V3中为 `Vae` 和 `Clip`（首字母大写，其余小写）
- 直接从V1的字符串类型（如 `"VAE"`、`"CLIP"`）迁移时容易忽略大小写差异

### 解决方案

**错误代码：**
```python
# ❌ 错误：使用全大写
io.VAE.Input("vae", optional=True)
io.CLIP.Input("clip", optional=True)
io.VAE.Output(display_name="vae")
io.CLIP.Output(display_name="clip")
```

**正确代码：**
```python
# ✅ 正确：使用正确的大小写
io.Vae.Input("vae", optional=True)    # 注意：Vae不是VAE
io.Clip.Input("clip", optional=True)  # 注意：Clip不是CLIP
io.Vae.Output(display_name="vae")
io.Clip.Output(display_name="clip")
```

### 正确的大小写规则
- **首字母大写，其余小写**：`io.Vae`, `io.Clip`
- **首字母大写**：`io.Boolean`, `io.Int`, `io.Float`, `io.String`
- **首字母大写**：`io.Image`, `io.Mask`, `io.Latent`, `io.Model`, `io.Conditioning`

### 快速检查清单
1. ✅ 所有 `io.VAE` 改为 `io.Vae`
2. ✅ 所有 `io.CLIP` 改为 `io.Clip`
3. ✅ 其他类型保持首字母大写

## 问题2：AnyType/Custom类型不支持default参数

### 错误现象
```
TypeError: Input.__init__() got an unexpected keyword argument 'default'
```

### 原因分析
- `io.AnyType.Input()` 和 `io.Custom("*").Input()` 返回的是 `Input` 基类实例
- `Input` 基类不支持 `default` 参数，只支持：`id`, `display_name`, `optional`, `tooltip`, `lazy`, `extra_dict`
- 只有 `WidgetInput` 派生类（如 `io.Int.Input`, `io.String.Input` 等）才支持 `default` 参数

### 解决方案

**错误代码：**
```python
# ❌ 错误：AnyType/Custom输入不支持default参数
io.AnyType.Input("signal", optional=True, default=None)
io.Custom("*").Input("signal", optional=True, default=None)
```

**正确代码：**
```python
# ✅ 正确：在Input定义中不使用default参数
io.AnyType.Input("signal", optional=True, tooltip="可选输入")

# ✅ 正确：在execute方法中处理默认值
@classmethod
def execute(cls, signal=None, default_value="default"):
    result = signal if signal is not None else default_value
    return io.NodeOutput(result)
```

### 最佳实践
1. **优先使用 `io.AnyType`** 而不是 `io.Custom("*")`，语义更清晰
2. **对于可选输入**，在 `execute` 方法中使用参数默认值处理
3. **标准类型**（Int, Float, String等）仍可使用 `default` 参数

## 问题3：类型选择困惑

### 何时使用 AnyType vs Custom
- **`io.AnyType`**：预定义的通配符类型，接受任意类型输入
- **`io.Custom("*")`**：功能与 `AnyType` 相同，但使用自定义类型语法
- **建议**：统一使用 `io.AnyType`，代码更易读

### 示例对比
```python
# 功能相同，但AnyType更清晰
io.AnyType.Input("input1", optional=True)          # ✅ 推荐
io.Custom("*").Input("input1", optional=True)      # ⚠️ 功能相同但不推荐
```

## 问题4：execute方法参数默认值处理

### V1 vs V3 处理方式差异
**V1 方式：**
```python
def execute(self, signal=None):
    # signal可能来自default参数
    result = signal if signal is not None else "default"
    return (result,)
```

**V3 正确方式：**
```python
@classmethod
def execute(cls, signal=None):  # 在方法参数中设置默认值
    result = signal if signal is not None else "default"
    return io.NodeOutput(result)
```

## 问题5：类型继承关系混淆

### V3 API 类型继承体系
```
_ComfyType (基类)
├── ComfyTypeIO (有Input/Output的类型)
│   ├── Boolean, Int, Float, String (WidgetInput派生类，支持default)
│   ├── Image, Mask, Latent (标准类型)
│   └── AnyType (Input基类，不支持default)
├── Input (基类，不支持default)
└── WidgetInput (Input派生类，支持default)
```

### 关键记忆点
1. **只有 `WidgetInput` 派生类支持 `default` 参数**
2. **`AnyType` 的 `Input` 继承自 `Input` 基类，不是 `WidgetInput`**
3. **迁移时检查所有 `io.Custom` 和 `io.AnyType` 输入，移除 `default` 参数**

## 快速检查清单

在完成V3迁移后，检查以下项目：

1. ✅ 所有 `io.VAE` 改为 `io.Vae`，所有 `io.CLIP` 改为 `io.Clip`
2. ✅ 所有 `io.AnyType.Input()` 和 `io.Custom("*").Input()` 移除了 `default` 参数
3. ✅ 可选输入的默认值在 `execute` 方法参数中设置
4. ✅ 优先使用 `io.AnyType` 而不是 `io.Custom("*")`
5. ✅ 标准类型（Int, Float等）正确使用 `default` 参数
6. ✅ 所有节点都能通过 `define_schema()` 测试

通过遵循这些指南，可以避免常见的迁移错误，确保V3节点正确加载和运行。