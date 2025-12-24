#!/usr/bin/env python3
"""
测试实际行为
"""

# 模拟 PromptsWithSwitches 可能的输出
# 假设有两个字符串列表
test_input = [
    ["图 1 的女人穿着浅绿色连帽衫与灰色瑜伽裤", "在图 2 的现代家居场景中静坐。"],
    ["图 2 的人物穿着白色婚纱与灰色西装", "在图 1 的日落海滩场景中互动。"]
]

print("=== 模拟 PromptsWithSwitches 输出 ===")
print(f"输入结构: {test_input}")
print(f"输入长度: {len(test_input)}")
print(f"第一个子列表: {test_input[0]}")
print(f"第二个子列表: {test_input[1]}")

# 模拟节点处理
separator = "，"
strip_items = True
skip_empty = True

results = []
for str_list in test_input:
    processed_strings = []
    for item in str_list:
        item_str = str(item)
        if strip_items:
            item_str = item_str.strip()
        if skip_empty and not item_str:
            continue
        processed_strings.append(item_str)

    if not processed_strings:
        result = ""
    else:
        result = separator.join(processed_strings)

    results.append(result)

print("\n=== 节点处理结果 ===")
print(f"输出: {results}")
print(f"输出长度: {len(results)}")
print(f"第一个结果: {results[0]}")
print(f"第二个结果: {results[1]}")

# 如果你想要所有字符串合并为一个
print("\n=== 所有字符串合并为一个 ===")
all_strings = []
for str_list in test_input:
    all_strings.extend(str_list)

processed_strings = []
for item in all_strings:
    item_str = str(item)
    if strip_items:
        item_str = item_str.strip()
    if skip_empty and not item_str:
        continue
    processed_strings.append(item_str)

if not processed_strings:
    final_result = ""
else:
    final_result = separator.join(processed_strings)

print(f"所有字符串: {all_strings}")
print(f"合并结果: {final_result}")