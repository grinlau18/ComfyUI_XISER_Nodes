#!/usr/bin/env python3
"""
测试 XIS_StringListMerger 节点的实际行为
直接使用实际的节点类
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from src.xiser_nodes.ui_control import XIS_StringListMerger

def test_string_merger_actual():
    print("=== 测试 XIS_StringListMerger 节点实际行为 ===")

    merger = XIS_StringListMerger()

    # 测试1: 模拟上游节点输出单个字符串列表（没有 OUTPUT_IS_LIST）
    print("\n测试1: 上游节点输出单个字符串列表")
    # ComfyUI 会包装成: [["a", "b", "c"]]
    string_list = [["a", "b", "c"]]
    separator = [", "]
    strip_items = [True]
    skip_empty = [True]

    result = merger.merge_strings(string_list, separator, strip_items, skip_empty)
    print(f"输入 string_list: {string_list}")
    print(f"结果: '{result[0]}'")
    print(f"预期: 'a, b, c'")
    assert result[0] == "a, b, c", f"测试失败: {result[0]}"

    # 测试2: 模拟上游节点输出列表的列表（有 OUTPUT_IS_LIST = (True,)）
    print("\n测试2: 上游节点输出列表的列表")
    # ComfyUI 会包装成: [["a", "b"], ["c", "d"]]
    string_list = [["a", "b"], ["c", "d"]]

    result = merger.merge_strings(string_list, separator, strip_items, skip_empty)
    print(f"输入 string_list: {string_list}")
    print(f"结果: '{result[0]}'")
    print(f"预期: 'a, b, c, d' (扁平化合并)")
    assert result[0] == "a, b, c, d", f"测试失败: {result[0]}"

    # 测试3: 单个字符串（包装在列表中）
    print("\n测试3: 单个字符串")
    string_list = [["single"]]

    result = merger.merge_strings(string_list, separator, strip_items, skip_empty)
    print(f"输入 string_list: {string_list}")
    print(f"结果: '{result[0]}'")
    print(f"预期: 'single'")
    assert result[0] == "single", f"测试失败: {result[0]}"

    # 测试4: 空列表
    print("\n测试4: 空列表")
    string_list = [[]]

    result = merger.merge_strings(string_list, separator, strip_items, skip_empty)
    print(f"输入 string_list: {string_list}")
    print(f"结果: '{result[0]}'")
    print(f"预期: ''")
    assert result[0] == "", f"测试失败: {result[0]}"

    # 测试5: 混合类型（列表和字符串混合）
    print("\n测试5: 混合类型")
    # 注意：实际使用中不会出现这种情况，因为 ComfyUI 会统一包装
    # 但代码中有处理这种情况的逻辑
    string_list = [["list1", "list2"], "string1", ["list3"]]

    result = merger.merge_strings(string_list, separator, strip_items, skip_empty)
    print(f"输入 string_list: {string_list}")
    print(f"结果: '{result[0]}'")
    print(f"预期: 'list1, list2, string1, list3'")
    assert result[0] == "list1, list2, string1, list3", f"测试失败: {result[0]}"

    # 测试6: 使用换行符分隔
    print("\n测试6: 使用换行符分隔")
    string_list = [["line1", "line2", "line3"]]
    separator = ["\\n"]

    result = merger.merge_strings(string_list, separator, strip_items, skip_empty)
    print(f"输入 string_list: {string_list}")
    print(f"分隔符: '\\n'")
    print(f"结果: '{result[0]}'")
    print(f"预期: 'line1\\nline2\\nline3'")
    assert result[0] == "line1\nline2\nline3", f"测试失败: {result[0]}"

    print("\n=== 所有测试通过！ ===")

if __name__ == "__main__":
    test_string_merger_actual()