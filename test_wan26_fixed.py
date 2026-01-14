#!/usr/bin/env python3
"""修复版的wan2.6-image图文混排测试，正确处理流式响应"""

import json
import requests
import base64
import time
from typing import List, Dict, Any, Tuple

def test_fixed_interleave(api_key: str):
    """
    修复版的wan2.6-image图文混排测试
    正确处理实际的流式响应格式
    """

    print("=" * 70)
    print("wan2.6-image 修复版图文混排测试")
    print("=" * 70)

    # 官方端点
    BASE_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"

    # 测试提示词
    prompt = "给我一个3张图辣椒炒肉教程"

    # 严格按照官方格式构建请求体
    payload = {
        "model": "wan2.6-image",
        "input": {
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "text": prompt
                        }
                    ]
                }
            ]
        },
        "parameters": {
            "max_images": 3,
            "size": "1280*1280",
            "stream": True,
            "enable_interleave": True
        }
    }

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
        "X-DashScope-Sse": "enable"
    }

    print(f"\n📋 请求信息:")
    print(f"  提示词: {prompt}")
    print(f"  最大图像数: {payload['parameters']['max_images']}")

    print("\n" + "=" * 70)
    print("🚀 开始流式接收响应...")
    print("=" * 70)

    try:
        # 发送请求
        response = requests.post(
            BASE_URL,
            json=payload,
            headers=headers,
            stream=True,
            timeout=180
        )

        print(f"📊 HTTP状态码: {response.status_code}")

        if response.status_code != 200:
            print(f"❌ 请求失败: {response.text}")
            return

        # 处理流式响应
        result = process_streaming_response(response)

        print("\n" + "=" * 70)
        print("📊 最终结果")
        print("=" * 70)

        print(f"\n📝 完整文本:")
        print("-" * 50)
        print(result["full_text"])
        print("-" * 50)

        print(f"\n🖼️  图像URLs ({len(result['image_urls'])}张):")
        for i, url in enumerate(result["image_urls"], 1):
            print(f"  图像 #{i}: {url}")

        print(f"\n📈 使用统计:")
        print(f"  总事件数: {result['total_events']}")
        print(f"  内容事件数: {result['content_events']}")
        print(f"  最终token数: {result['final_tokens']}")
        print(f"  最终图像数: {result['final_image_count']}")

    except Exception as e:
        print(f"❌ 测试过程中出错: {e}")
        import traceback
        traceback.print_exc()

def process_streaming_response(response) -> Dict[str, Any]:
    """处理流式响应，返回累积的结果"""

    all_content = []  # 累积所有content项
    image_urls = []   # 图像URL列表
    current_text = "" # 当前正在累积的文本
    event_count = 0
    content_event_count = 0
    final_tokens = 0
    final_image_count = 0

    print(f"\n📥 处理流式响应...")

    for line in response.iter_lines():
        if line:
            event_count += 1
            line_str = line.decode('utf-8')

            # 只显示进度（每50个事件显示一次）
            if event_count % 50 == 0:
                print(f"  已处理 {event_count} 个事件...")

            # 处理SSE格式的数据事件
            # 修复：检查 data: 开头（有或没有空格）
            if line_str.startswith('data:'):
                # 移除 'data:' 前缀
                if line_str.startswith('data: '):
                    data = line_str[6:]  # 移除 'data: '（有空格）
                else:
                    data = line_str[5:]  # 移除 'data:'（没有空格）

                if data == '[DONE]':
                    print(f"✅ 收到 [DONE] 信号")
                    break

                try:
                    result = json.loads(data)
                    content_event_count += 1

                    # 提取内容
                    extracted = extract_content_from_event(result)
                    if extracted:
                        content_type, content_data = extracted

                        if content_type == "text":
                            # 文本是逐字符返回的，需要累积
                            current_text += content_data
                            all_content.append({
                                "type": "text",
                                "text": content_data
                            })

                        elif content_type == "image":
                            # 图像以完整URL返回
                            image_urls.append(content_data)
                            all_content.append({
                                "type": "image",
                                "image": content_data
                            })

                        # 检查是否结束
                        if is_final_event(result):
                            final_tokens = result.get("output", {}).get("usage", {}).get("total_tokens", 0)
                            final_image_count = result.get("output", {}).get("usage", {}).get("image_count", 0)

                except json.JSONDecodeError:
                    # 忽略非JSON数据
                    pass

    print(f"✅ 流式处理完成")
    print(f"  总事件: {event_count}, 内容事件: {content_event_count}")

    return {
        "full_text": current_text,
        "image_urls": image_urls,
        "all_content": all_content,
        "total_events": event_count,
        "content_events": content_event_count,
        "final_tokens": final_tokens,
        "final_image_count": final_image_count
    }

def extract_content_from_event(event_data: Dict[str, Any]) -> Tuple[str, str] or None:
    """从事件数据中提取内容"""

    # 格式: {"output": {"choices": [{"message": {"content": [...]}}]}}
    if "output" in event_data:
        output = event_data["output"]

        if "choices" in output and isinstance(output["choices"], list) and output["choices"]:
            choice = output["choices"][0]

            if "message" in choice and "content" in choice["message"]:
                content_list = choice["message"]["content"]

                if isinstance(content_list, list) and content_list:
                    item = content_list[0]
                    if isinstance(item, dict):
                        item_type = item.get("type")

                        if item_type == "text":
                            text = item.get("text", "")
                            if text:
                                return ("text", text)

                        elif item_type == "image":
                            image_url = item.get("image", "")
                            if image_url:
                                return ("image", image_url)

    return None

def is_final_event(event_data: Dict[str, Any]) -> bool:
    """检查是否是最终事件"""
    if "output" in event_data:
        output = event_data["output"]
        # finished为true表示流结束
        if output.get("finished") == True:
            return True
        # finish_reason不为null也表示结束
        if "choices" in output and output["choices"]:
            choice = output["choices"][0]
            if choice.get("finish_reason") != "null":
                return True
    return False

def create_fixed_provider_code():
    """生成修复后的provider代码"""

    print("\n" + "=" * 70)
    print("💡 修复后的 _invoke_streaming() 方法代码")
    print("=" * 70)

    fixed_code = '''
    def _invoke_streaming(self, endpoint: str, headers: Dict[str, str], payload: Dict[str, Any]) -> Dict[str, Any]:
        """修复版：正确处理wan2.6-image的流式响应"""
        response = requests.post(
            endpoint,
            headers=headers,
            json=payload,
            timeout=self.config.timeout,
            stream=True,
        )
        response.raise_for_status()

        # 累积所有content项
        all_content = []
        event_count = 0

        for line in response.iter_lines():
            if line:
                line_str = line.decode('utf-8')

                # 修复：检查 data: 开头（有或没有空格）
                if line_str.startswith('data:'):
                    # 移除 'data:' 前缀
                    if line_str.startswith('data: '):
                        event_data = line_str[6:]  # 移除 'data: '（有空格）
                    else:
                        event_data = line_str[5:]  # 移除 'data:'（没有空格）

                    if event_data == '[DONE]':
                        break

                    try:
                        event_json = json.loads(event_data)
                        event_count += 1

                        # 提取content
                        if "output" in event_json and "choices" in event_json["output"]:
                            choices = event_json["output"]["choices"]
                            if choices and "message" in choices[0]:
                                content_list = choices[0]["message"].get("content", [])
                                if isinstance(content_list, list) and content_list:
                                    # 每个事件只包含一个content项
                                    all_content.extend(content_list)

                                    # 检查是否结束
                                    if (event_json["output"].get("finished") == True or
                                        choices[0].get("finish_reason") != "null"):
                                        # 这是最后一个事件，包含完整的usage统计
                                        final_usage = event_json["output"].get("usage", {})

                    except json.JSONDecodeError:
                        continue

        # 构建最终的响应结构
        merged_response = {
            "output": {
                "choices": [{
                    "message": {
                        "content": all_content,
                        "role": "assistant"
                    },
                    "finish_reason": "stop"
                }]
            }
        }

        # 添加usage统计（如果最后的事件有）
        if final_usage:
            merged_response["output"]["usage"] = final_usage

        return merged_response
    '''

    print(fixed_code)

    print("\n" + "=" * 70)
    print("🔧 需要修改的 extract_text() 方法")
    print("=" * 70)

    extract_text_code = '''
    def extract_text(self, response: Dict[str, Any]) -> str:
        """修复版：从累积的content列表中提取文本"""
        if "output" in response:
            output = response["output"]
            if "choices" in output:
                choices = output["choices"]
                if choices and "message" in choices[0]:
                    content = choices[0]["message"].get("content", [])
                    if isinstance(content, list):
                        # 提取所有文本项
                        texts = []
                        for item in content:
                            if isinstance(item, dict) and item.get("type") == "text":
                                text = item.get("text", "")
                                if text:
                                    texts.append(text)
                        if texts:
                            return "".join(texts)  # 直接拼接，因为已经是逐字符了
        return ""
    '''

    print(extract_text_code)

def main():
    """主函数"""

    # 使用你的API密钥
    API_KEY = "sk-bba7257f2a2e4ab7bb1bd34aad43f417"

    print(f"🔑 API密钥: {API_KEY[:10]}...{API_KEY[-10:]}")

    # 运行修复版测试
    test_fixed_interleave(API_KEY)

    # 生成修复代码
    create_fixed_provider_code()

if __name__ == "__main__":
    main()