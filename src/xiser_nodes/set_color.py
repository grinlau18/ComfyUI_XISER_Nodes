"""
XIS_SetColor.py

Custom node for ComfyUI to select and output a color as HEX string.
v3 API version.
"""

import logging
import re
from comfy_api.latest import io, ComfyExtension

# 设置日志
logger = logging.getLogger(__name__)
# 默认不显示日志，除非配置了日志级别
logger.addHandler(logging.NullHandler())

# 定义自定义类型
ColorData = io.Custom("XIS_COLOR_DATA")

class XIS_SetColor(io.ComfyNode):
    """
    A custom node for selecting and outputting a color as HEX string.
    v3 API version.
    """

    @classmethod
    def define_schema(cls):
        """
        Define v3 schema for the node.
        """
        return io.Schema(
            node_id="XIS_SetColor",
            display_name="XIS Set Color",
            category="XISER_Nodes/UI_And_Control",
            inputs=[
                ColorData.Input("color_data")
            ],
            outputs=[
                io.String.Output("color", display_name="color")
            ],
        )

    @classmethod
    def execute(cls, color_data):
        """
        Execute the color selection (v3 version).
        Extract color from various formats and return HEX string.
        """
        logger.info(f"[XIS_SetColor] 开始执行，输入数据: {color_data} (类型: {type(color_data)})")
        logger.info(f"[XIS_SetColor] 输入数据详细查看: repr={repr(color_data)}")

        # 从不同格式中提取颜色值
        color = "#ffffff"  # 默认值

        # 处理 None 输入
        if color_data is None:
            logger.info(f"[XIS_SetColor] 输入为 None，使用默认颜色")
        # 首先检查是否是包含字典的数组（可能是 WIDGET 的包装格式）
        elif isinstance(color_data, (list, tuple)) and len(color_data) > 0:
            first_item = color_data[0]
            logger.info(f"[XIS_SetColor] 输入是列表/元组，第一个元素: {first_item} (类型: {type(first_item)})")

            # 如果第一个元素是字典，尝试提取 color 字段
            if isinstance(first_item, dict):
                color = first_item.get("color", "#ffffff")
                logger.info(f"[XIS_SetColor] 从数组中的字典提取颜色: {color}")
            else:
                # 否则按原逻辑处理
                # 如果第一个元素还是列表/元组，继续提取（处理嵌套情况）
                while isinstance(first_item, (list, tuple)) and len(first_item) > 0:
                    first_item = first_item[0]

                # 如果提取后得到字典，从字典中获取颜色
                if isinstance(first_item, dict):
                    color = first_item.get("color", "#ffffff")
                    logger.info(f"[XIS_SetColor] 从嵌套数组中的字典提取颜色: {color}")
                else:
                    color = first_item
                    logger.info(f"[XIS_SetColor] 从列表/元组提取元素: {color}")

        elif isinstance(color_data, dict):
            # 字典格式：{"color": "#700000"}
            color = color_data.get("color", "#ffffff")
            logger.info(f"[XIS_SetColor] 从字典提取颜色: {color}")

        elif isinstance(color_data, str):
            # 字符串格式："#700000"
            color = color_data
            logger.info(f"[XIS_SetColor] 字符串格式: {color}")

        else:
            logger.warning(f"[XIS_SetColor] 未知输入格式: {type(color_data)}，使用默认颜色")

        # 确保是字符串
        color = str(color)
        logger.info(f"[XIS_SetColor] 转换为字符串: {color}")

        # 验证 HEX 格式
        if not is_valid_hex_color(color):
            logger.warning(f"[XIS_SetColor] 颜色格式无效: {color}，使用默认白色")
            color = "#ffffff"

        logger.info(f"[XIS_SetColor] 最终颜色值: {color}")
        logger.info(f"[XIS_SetColor] 返回: io.NodeOutput({color},)")
        # v3 版本使用 io.NodeOutput 包装
        return io.NodeOutput(color,)

def is_valid_hex_color(s):
    """
    Validate if a string is a valid HEX color.
    """
    return bool(re.match(r'^#([0-9a-fA-F]{6})$', s))


# 测试函数
def test_output_format():
    """
    测试输出格式，用于调试
    """
    test_cases = [
        ("字典格式", {"color": "#700000"}),
        ("列表格式", ["#700000"]),
        ("元组格式", ("#700000",)),
        ("字符串格式", "#700000"),
        ("空列表", []),
        ("空字典", {}),
        ("无效颜色", "#xyz123"),
        ("数组包含字典", [{"color": "#700000"}]),
        ("嵌套数组", [["#700000"]]),
    ]

    for name, test_data in test_cases:
        print(f"\n测试用例: {name}")
        print(f"  输入: {test_data} (类型: {type(test_data)})")
        try:
            result = XIS_SetColor.execute(test_data)
            print(f"  输出: {result}")
            print(f"  输出类型: {type(result)}")
            if isinstance(result, tuple) and len(result) > 0:
                print(f"  第一个输出值: {result[0]}")
                print(f"  第一个输出类型: {type(result[0])}")
        except Exception as e:
            print(f"  错误: {e}")

if __name__ == "__main__":
    test_output_format()


# v3 扩展注册
class XISSetColorExtension(ComfyExtension):
    async def get_node_list(self):
        return [XIS_SetColor]

async def comfy_entrypoint():
    return XISSetColorExtension()


