"""
XIS_ShapeData.py - V3版本

Custom node for ComfyUI to aggregate shape property data from multiple input ports.
Supports combining property lists from upstream nodes with proper count handling.
"""

import torch
import math
from typing import List, Dict, Any, Tuple
import logging

from comfy_api.v0_0_2 import io

# 设置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class XIS_ShapeDataV3(io.ComfyNode):
    """
    A custom node for aggregating shape property data from multiple input ports.
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        """
        Defines the input types for the node.

        Returns:
            io.Schema: V3架构定义
        """
        return io.Schema(
            node_id="XIS_ShapeData",
            display_name="Shape Data",
            category="XISER_Nodes/Data_Processing",
            description="聚合来自多个输入端口的形状属性数据。自动计算输出数量，基于所有输入值的最大数量。",
            inputs=[
                # 位置属性接口 - 浮点数坐标（支持列表输入）
                io.AnyType.Input("position_x", optional=True, tooltip="X坐标（支持单个值或列表）"),
                io.AnyType.Input("position_y", optional=True, tooltip="Y坐标（支持单个值或列表）"),

                # 旋转属性接口 - 角度值（支持列表输入）
                io.AnyType.Input("rotation", optional=True, tooltip="旋转角度（支持单个值或列表）"),

                # 缩放属性接口 - 缩放因子（支持列表输入）
                io.AnyType.Input("scale_x", optional=True, tooltip="X轴缩放因子（支持单个值或列表）"),
                io.AnyType.Input("scale_y", optional=True, tooltip="Y轴缩放因子（支持单个值或列表）"),

                # 倾斜属性接口 - 倾斜角度（支持列表输入）
                io.AnyType.Input("skew_x", optional=True, tooltip="X轴倾斜角度（支持单个值或列表）"),
                io.AnyType.Input("skew_y", optional=True, tooltip="Y轴倾斜角度（支持单个值或列表）"),

                # 颜色属性接口 - 字符串颜色值（支持列表输入）
                io.AnyType.Input("shape_color", optional=True, tooltip="形状颜色（支持单个值或列表）"),
                io.AnyType.Input("bg_color", optional=True, tooltip="背景颜色（支持单个值或列表）"),
                io.AnyType.Input("stroke_color", optional=True, tooltip="描边颜色（支持单个值或列表）"),

                # 其他属性接口 - 线宽值（支持列表输入）
                io.AnyType.Input("stroke_width", optional=True, tooltip="描边宽度（支持单个值或列表）"),

                # 新增控制接口 - 透明背景、模式、类型与参数（支持列表输入）
                io.AnyType.Input("transparent_bg", optional=True, tooltip="透明背景标志（支持单个值或列表）"),
                io.AnyType.Input("mode_selection", optional=True, tooltip="模式选择（支持单个值或列表）"),
                io.AnyType.Input("shape_type", optional=True, tooltip="形状类型（支持单个值或列表）"),
                io.AnyType.Input("shape_params", optional=True, tooltip="形状参数（支持单个值或列表）"),
            ],
            outputs=[
                io.Custom("LIST").Output(display_name="shape_data", is_output_list=False)
            ]
            # 注意：移除了is_input_list=True，因为fill_list_to_count方法已经能处理列表输入
            # 设置is_input_list=True会导致所有输入变成列表，可能引起类型转换问题
        )

    @classmethod
    def fill_list_to_count(cls, input_data: Any, count: int) -> List[Any]:
        """
        将输入数据填充到指定数量。

        Args:
            input_data: 输入数据（可以是单个值或列表）
            count: 目标数量

        Returns:
            填充后的列表
        """
        # 如果输入是None，返回None列表
        if input_data is None:
            return [None] * count

        # 如果输入已经是列表，直接处理
        if isinstance(input_data, list):
            if not input_data:
                return [None] * count

            if len(input_data) >= count:
                # 数量足够，取前count个值
                return input_data[:count]
            else:
                # 数量不足，用最后一个值填充剩余位置
                last_value = input_data[-1] if input_data else None
                return input_data + [last_value] * (count - len(input_data))
        else:
            # 如果输入是单个值，转换为重复的列表
            return [input_data] * count

    @classmethod
    def execute(cls, **kwargs) -> io.NodeOutput:
        """
        Execute the shape data aggregation from multiple input ports.
        自动计算输出数量，基于所有输入值的最大数量。

        Args:
            **kwargs: All the property inputs (can be single values or lists from upstream nodes)

        Returns:
            io.NodeOutput: 包含shape_data列表的输出
        """
        logger.info(f"Shape Data aggregation started")
        logger.info(f"Received kwargs keys: {list(kwargs.keys())}")

        # 记录每个传入参数的值和类型
        for key, value in kwargs.items():
            if isinstance(value, list):
                logger.info(f"Parameter {key}: type=list, length={len(value)}, first_3_values={value[:3] if len(value) > 3 else value}")
            else:
                logger.info(f"Parameter {key}: type={type(value).__name__}, value={value}")

        # 1. 计算最大输出数量（基于所有输入列表的最大长度）
        max_count = 1  # 默认至少1个输出
        for key, value in kwargs.items():
            if value is not None:
                if isinstance(value, list):
                    list_length = len(value)
                    if list_length > max_count:
                        max_count = list_length
                        logger.info(f"Found longer list in {key}: length={list_length}")
                else:
                    # 单个值也算作长度为1的列表
                    if max_count == 1:
                        logger.info(f"Found single value in {key}")

        logger.info(f"Maximum output count determined: {max_count}")

        # 定义属性映射
        property_mapping = {
            # 位置属性
            "position": {
                "x": "position_x",
                "y": "position_y"
            },
            # 旋转属性
            "rotation": "rotation",
            # 缩放属性
            "scale": {
                "x": "scale_x",
                "y": "scale_y"
            },
            # 倾斜属性
            "skew": {
                "x": "skew_x",
                "y": "skew_y"
            },
            # 颜色属性
            "shape_color": "shape_color",
            "bg_color": "bg_color",
            "stroke_color": "stroke_color",
            # 其他属性
            "stroke_width": "stroke_width"
        }

        shape_data_list = []

        # 处理每个属性，填充到count数量
        processed_properties = {}

        # 处理简单属性
        simple_properties = [
            "rotation",
            "shape_color",
            "bg_color",
            "stroke_color",
            "stroke_width",
            "transparent_bg",
            "mode_selection",
            "shape_type",
            "shape_params"
        ]

        for prop_name in simple_properties:
            input_data = kwargs.get(prop_name)
            # 只有当输入数据不是None时才处理（None表示没有接入数据）
            if input_data is not None:
                # 使用fill_list_to_count方法处理列表填充
                processed_properties[prop_name] = cls.fill_list_to_count(input_data, max_count)
                logger.info(f"Processed {prop_name}: input_type={type(input_data).__name__}, input_len={len(input_data) if isinstance(input_data, list) else 1}, output_len={len(processed_properties[prop_name])}")
            else:
                processed_properties[prop_name] = [None] * max_count
                logger.info(f"Processed {prop_name}: no input data, using default None values")

        # 处理复合属性（位置、缩放、倾斜）
        compound_properties = ["position", "scale", "skew"]

        for comp_prop in compound_properties:
            comp_data = {}
            prop_config = property_mapping[comp_prop]

            for sub_prop, input_key in prop_config.items():
                input_data = kwargs.get(input_key)
                # 只有当输入数据不是None时才处理（None表示没有接入数据）
                if input_data is not None:
                    # 使用fill_list_to_count方法处理列表填充
                    comp_data[sub_prop] = cls.fill_list_to_count(input_data, max_count)
                    logger.info(f"Processed {comp_prop}.{sub_prop}: input_type={type(input_data).__name__}, input_len={len(input_data) if isinstance(input_data, list) else 1}, output_len={len(comp_data[sub_prop])}")
                else:
                    comp_data[sub_prop] = [None] * max_count
                    logger.info(f"Processed {comp_prop}.{sub_prop}: no input data, using default None values")

            processed_properties[comp_prop] = comp_data

        # 生成最终的shape_data列表
        logger.info(f"Starting to generate {max_count} shape data sets")
        for i in range(max_count):
            shape_props = {}
            logger.info(f"Processing shape {i+1}/{max_count}")

            # 处理位置属性 - 只有当有实际数据时才包含
            position_data = {}
            if "x" in processed_properties["position"] and processed_properties["position"]["x"][i] is not None:
                position_data["x"] = processed_properties["position"]["x"][i]
                logger.info(f"  - position.x: {processed_properties['position']['x'][i]}")
            if "y" in processed_properties["position"] and processed_properties["position"]["y"][i] is not None:
                position_data["y"] = processed_properties["position"]["y"][i]
                logger.info(f"  - position.y: {processed_properties['position']['y'][i]}")

            if position_data:
                shape_props["position"] = position_data

            # 处理缩放属性 - 只有当有实际数据时才包含
            scale_data = {}
            if "x" in processed_properties["scale"] and processed_properties["scale"]["x"][i] is not None:
                scale_data["x"] = processed_properties["scale"]["x"][i]
                logger.info(f"  - scale.x: {processed_properties['scale']['x'][i]}")
            if "y" in processed_properties["scale"] and processed_properties["scale"]["y"][i] is not None:
                scale_data["y"] = processed_properties["scale"]["y"][i]
                logger.info(f"  - scale.y: {processed_properties['scale']['y'][i]}")

            if scale_data:
                shape_props["scale"] = scale_data

            # 处理倾斜属性 - 只有当有实际数据时才包含
            skew_data = {}
            if "x" in processed_properties["skew"] and processed_properties["skew"]["x"][i] is not None:
                skew_data["x"] = processed_properties["skew"]["x"][i]
                logger.info(f"  - skew.x: {processed_properties['skew']['x'][i]}")
            if "y" in processed_properties["skew"] and processed_properties["skew"]["y"][i] is not None:
                skew_data["y"] = processed_properties["skew"]["y"][i]
                logger.info(f"  - skew.y: {processed_properties['skew']['y'][i]}")

            if skew_data:
                shape_props["skew"] = skew_data

            # 处理简单属性 - 只有当有实际数据时才包含
            for prop_name in simple_properties:
                value = processed_properties[prop_name][i]
                if value is not None:
                    if prop_name == "transparent_bg":
                        coerced_value = bool(value)
                    else:
                        coerced_value = value
                    shape_props[prop_name] = coerced_value
                    logger.info(f"  - {prop_name}: {coerced_value}")

            shape_data_list.append(shape_props)

            # 记录生成的属性
            logger.info(f"Generated shape properties {i+1}/{max_count}: {shape_props}")

        logger.info(f"Shape data aggregation completed: {len(shape_data_list)} sets")
        logger.info(f"Final shape_data_list content: {shape_data_list}")
        return io.NodeOutput(shape_data_list)


# V3节点导出
V3_NODE_CLASSES = [XIS_ShapeDataV3]