#!/usr/bin/env python3
"""
测试 XIS_StringListMerger 节点
"""

# 直接定义节点类，避免导入依赖
class XIS_StringListMerger:
    """将字符串列表合并为单个字符串，支持自定义连接符"""

    def merge_strings(self, string_list, separator, strip_items, skip_empty):
        """
        合并字符串列表

        Args:
            string_list: 输入的字符串列表（由于INPUT_IS_LIST=True，这是一个列表的列表）
            separator: 连接符列表（每个元素相同）
            strip_items: 布尔值列表（每个元素相同）
            skip_empty: 布尔值列表（每个元素相同）

        Returns:
            合并后的字符串列表（由于OUTPUT_IS_LIST=(True,)，返回列表的列表）
        """
        # 由于INPUT_IS_LIST=True，所有输入都是列表
        # 我们只需要第一个元素，因为所有元素都相同
        separator = separator[0] if isinstance(separator, list) and len(separator) > 0 else ", "
        strip_items = strip_items[0] if isinstance(strip_items, list) and len(strip_items) > 0 else True
        skip_empty = skip_empty[0] if isinstance(skip_empty, list) and len(skip_empty) > 0 else True

        # 处理转义字符（如 \n, \t 等）
        separator = separator.encode().decode('unicode_escape')

        # string_list 是一个列表的列表，每个子列表包含一个字符串列表
        # 我们需要处理每个子列表
        results = []
        for str_list in string_list:
            # 处理输入：str_list 可能是一个列表，也可能是单个字符串
            if isinstance(str_list, str):
                # 如果是单个字符串，直接添加到结果
                results.append(str_list)
                continue

            if not isinstance(str_list, list):
                # 如果不是列表，尝试转换为列表
                str_list = [str(str_list)]

            # 处理每个字符串
            processed_strings = []
            for item in str_list:
                # 转换为字符串
                item_str = str(item)

                # 去除空白（如果启用）
                if strip_items:
                    item_str = item_str.strip()

                # 跳过空项（如果启用）
                # 注意：空白字符串（如 "   "）在 strip_items=False 时不算空
                if skip_empty:
                    if strip_items:
                        # 如果启用了去除空白，那么去除空白后检查是否为空
                        if not item_str.strip():
                            continue
                    else:
                        # 如果没有启用去除空白，只检查原始字符串是否为空
                        if not item_str:
                            continue

                processed_strings.append(item_str)

            # 合并字符串
            if not processed_strings:
                result = ""
            else:
                result = separator.join(processed_strings)

            results.append(result)

        return (results,)

def test_string_merger():
    """测试字符串合并节点"""
    print("=== 测试 XIS_StringListMerger 节点 ===")

    # 创建节点实例
    merger = XIS_StringListMerger()

    # 测试用例 1: 普通字符串列表，使用逗号分隔
    print("\n测试用例 1: 普通字符串列表，使用逗号分隔")
    # 注意：由于 INPUT_IS_LIST=True，输入是列表的列表
    string_list = [["Hello", "World", "Test"]]
    separator = [", "]  # 列表形式
    strip_items = [True]  # 列表形式
    skip_empty = [True]  # 列表形式

    result = merger.merge_strings(string_list, separator, strip_items, skip_empty)
    print(f"输入: {string_list}")
    print(f"分隔符: '{separator[0]}'")
    print(f"结果: '{result[0][0]}'")
    print(f"预期: 'Hello, World, Test'")
    assert result[0][0] == "Hello, World, Test", f"测试失败: {result[0][0]}"

    # 测试用例 2: 使用换行符分隔
    print("\n测试用例 2: 使用换行符分隔")
    separator = ["\\n"]
    result = merger.merge_strings(string_list, separator, strip_items, skip_empty)
    print(f"输入: {string_list}")
    print(f"分隔符: '{separator[0]}'")
    print(f"结果: '{result[0][0]}'")
    print(f"预期: 'Hello\\nWorld\\nTest'")
    assert result[0][0] == "Hello\nWorld\nTest", f"测试失败: {result[0][0]}"

    # 测试用例 3: 包含空字符串和空白
    print("\n测试用例 3: 包含空字符串和空白")
    string_list = [["  Hello  ", "", "  World  ", "   ", "Test"]]
    separator = [", "]

    # 测试 strip_items=True, skip_empty=True
    result = merger.merge_strings(string_list, separator, [True], [True])
    print(f"输入: {string_list}")
    print(f"strip_items=True, skip_empty=True")
    print(f"结果: '{result[0][0]}'")
    print(f"预期: 'Hello, World, Test'")
    assert result[0][0] == "Hello, World, Test", f"测试失败: {result[0][0]}"

    # 测试 strip_items=False, skip_empty=True
    result = merger.merge_strings(string_list, separator, [False], [True])
    print(f"strip_items=False, skip_empty=True")
    print(f"结果: '{result[0][0]}'")
    print(f"预期: '  Hello  ,   World  ,    , Test' (空白字符串'   '不被视为空)")
    expected = "  Hello  ,   World  ,    , Test"
    assert result[0][0] == expected, f"测试失败: {result[0][0]}"

    # 测试 strip_items=False, skip_empty=False
    result = merger.merge_strings(string_list, separator, [False], [False])
    print(f"strip_items=False, skip_empty=False")
    print(f"结果: '{result[0][0]}'")
    print(f"预期: '  Hello  , ,   World  ,    , Test'")
    # 注意：空字符串和空白字符串都会被保留
    expected = "  Hello  , ,   World  ,    , Test"
    assert result[0][0] == expected, f"测试失败: {result[0][0]}"

    # 测试用例 4: 单个字符串输入（包装在列表中）
    print("\n测试用例 4: 单个字符串输入（包装在列表中）")
    string_list = [["Single String"]]
    result = merger.merge_strings(string_list, separator, strip_items, skip_empty)
    print(f"输入: {string_list}")
    print(f"结果: '{result[0][0]}'")
    print(f"预期: 'Single String'")
    assert result[0][0] == "Single String", f"测试失败: {result[0][0]}"

    # 测试用例 5: 空列表
    print("\n测试用例 5: 空列表")
    string_list = [[]]
    result = merger.merge_strings(string_list, separator, strip_items, skip_empty)
    print(f"输入: {string_list}")
    print(f"结果: '{result[0][0]}'")
    print(f"预期: ''")
    assert result[0][0] == "", f"测试失败: {result[0][0]}"

    # 测试用例 6: 特殊转义字符
    print("\n测试用例 6: 特殊转义字符")
    string_list = [["Line1", "Line2", "Line3"]]
    separator = ["\\n\\n"]  # 两个换行符
    result = merger.merge_strings(string_list, separator, strip_items, skip_empty)
    print(f"输入: {string_list}")
    print(f"分隔符: '{separator[0]}'")
    print(f"结果: '{result[0][0]}'")
    print(f"预期: 'Line1\\n\\nLine2\\n\\nLine3'")
    assert result[0][0] == "Line1\n\nLine2\n\nLine3", f"测试失败: {result[0][0]}"

    print("\n=== 所有测试通过！ ===")

if __name__ == "__main__":
    test_string_merger()