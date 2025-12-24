#!/usr/bin/env python3
"""
简单测试 XIS_StringListMerger 节点逻辑
不导入依赖，直接复制节点逻辑
"""

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
            合并后的单个字符串
        """
        # 由于INPUT_IS_LIST=True，所有输入都是列表
        # 我们只需要第一个元素，因为所有元素都相同
        separator = separator[0] if isinstance(separator, list) and len(separator) > 0 else ", "
        strip_items = strip_items[0] if isinstance(strip_items, list) and len(strip_items) > 0 else True
        skip_empty = skip_empty[0] if isinstance(skip_empty, list) and len(skip_empty) > 0 else True

        # 处理转义字符（如 \n, \t 等）
        separator = separator.encode().decode('unicode_escape')

        # 收集所有字符串（扁平化处理）
        all_strings = []
        for str_list in string_list:
            # 处理输入：str_list 可能是一个列表，也可能是单个字符串
            if isinstance(str_list, str):
                # 如果是单个字符串，直接添加到所有字符串
                all_strings.append(str_list)
                continue

            if not isinstance(str_list, list):
                # 如果不是列表，尝试转换为列表
                str_list = [str(str_list)]

            # 添加所有字符串
            all_strings.extend(str_list)

        # 处理每个字符串
        processed_strings = []
        for item in all_strings:
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

        # 合并所有字符串为一个字符串
        if not processed_strings:
            result = ""
        else:
            result = separator.join(processed_strings)

        return (result,)

def test_string_merger_logic():
    print("=== 测试 XIS_StringListMerger 节点逻辑 ===")

    merger = XIS_StringListMerger()

    # 测试1: 正常情况 - 列表的列表
    print("\n测试1: 列表的列表（模拟 ComfyUI 包装）")
    string_list = [["a", "b", "c"]]  # ComfyUI 包装成列表的列表
    separator = [", "]
    strip_items = [True]
    skip_empty = [True]

    result = merger.merge_strings(string_list, separator, strip_items, skip_empty)
    print(f"输入: {string_list}")
    print(f"结果: '{result[0]}'")
    print(f"预期: 'a, b, c'")
    assert result[0] == "a, b, c", f"测试失败: {result[0]}"

    # 测试2: 多个子列表（上游节点有 OUTPUT_IS_LIST = (True,)）
    print("\n测试2: 多个子列表")
    string_list = [["a", "b"], ["c", "d"]]

    result = merger.merge_strings(string_list, separator, strip_items, skip_empty)
    print(f"输入: {string_list}")
    print(f"结果: '{result[0]}'")
    print(f"预期: 'a, b, c, d' (扁平化合并)")
    assert result[0] == "a, b, c, d", f"测试失败: {result[0]}"

    # 测试3: 验证 INPUT_IS_LIST = True 的行为
    print("\n测试3: 验证所有输入都是列表")
    # separator, strip_items, skip_empty 都是列表
    separator = [" | "]
    strip_items = [False]  # 不去除空白
    skip_empty = [False]   # 不跳过空项

    string_list = [["  hello  ", "", "  world  "]]
    result = merger.merge_strings(string_list, separator, strip_items, skip_empty)
    print(f"输入: {string_list}")
    print(f"分隔符: ' | '")
    print(f"strip_items: False, skip_empty: False")
    print(f"结果: '{result[0]}'")
    print(f"预期: '  hello   |  |   world  ' (保留空白和空项)")
    assert result[0] == "  hello   |  |   world  ", f"测试失败: {result[0]}"

    # 测试4: 转义字符处理
    print("\n测试4: 转义字符处理")
    string_list = [["line1", "line2", "line3"]]
    separator = ["\\n"]  # 转义字符

    result = merger.merge_strings(string_list, separator, [True], [True])
    print(f"输入: {string_list}")
    print(f"分隔符: '\\\\n' (字符串表示)")
    print(f"结果: '{result[0]}'")
    print(f"预期: 'line1\\nline2\\nline3'")
    assert result[0] == "line1\nline2\nline3", f"测试失败: {result[0]}"

    # 测试5: 空输入
    print("\n测试5: 空输入")
    string_list = [[]]

    result = merger.merge_strings(string_list, separator, [True], [True])
    print(f"输入: {string_list}")
    print(f"结果: '{result[0]}'")
    print(f"预期: ''")
    assert result[0] == "", f"测试失败: {result[0]}"

    print("\n=== 所有测试通过！ ===")
    print("\n结论: 节点逻辑正确，符合 INPUT_IS_LIST = True 的行为")
    print("1. 所有输入都是列表")
    print("2. string_list 是列表的列表")
    print("3. 输出是单个字符串")
    print("4. 支持扁平化合并多个子列表")

if __name__ == "__main__":
    test_string_merger_logic()