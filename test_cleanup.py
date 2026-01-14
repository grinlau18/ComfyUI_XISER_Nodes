#!/usr/bin/env python3
"""验证删除qwen-mt-image和qwen_image模型后的代码完整性"""

import sys
sys.path.insert(0, '.')

def test_imports():
    """测试导入"""
    print("=== 测试导入 ===")

    try:
        from src.xiser_nodes.llm.providers_qwen import (
            QwenChatProvider,
            QwenFlashProvider,
            QwenVLProvider,
            QwenVLPlusProvider,
            QwenVLFlashProvider,
            QwenImageCreateProvider,
            QwenImageMaxProvider,
        )
        print("✅ 成功导入所有Qwen提供者类")

        # 检查不应该导入的类
        try:
            from src.xiser_nodes.llm.providers_qwen import QwenMTImageProvider
            print("❌ QwenMTImageProvider 不应该被导入但被导入了")
            return False
        except ImportError:
            print("✅ QwenMTImageProvider 正确未被导入")

        try:
            from src.xiser_nodes.llm.providers_qwen import QwenImagePlusProvider
            print("❌ QwenImagePlusProvider 不应该被导入但被导入了")
            return False
        except ImportError:
            print("✅ QwenImagePlusProvider 正确未被导入")

    except Exception as e:
        print(f"❌ 导入失败: {e}")
        import traceback
        traceback.print_exc()
        return False

    return True

def test_registry():
    """测试registry"""
    print("\n=== 测试registry ===")

    try:
        from src.xiser_nodes.llm.registry import build_default_registry, PROVIDER_SCHEMA

        # 检查PROVIDER_SCHEMA
        print("检查PROVIDER_SCHEMA中的模型定义:")

        # 检查已删除的模型
        if "qwen-mt-image" in PROVIDER_SCHEMA:
            print("❌ qwen-mt-image 仍在 PROVIDER_SCHEMA 中")
            return False
        else:
            print("✅ qwen-mt-image 已从 PROVIDER_SCHEMA 中删除")

        if "qwen_image_plus" in PROVIDER_SCHEMA:
            print("❌ qwen_image_plus 仍在 PROVIDER_SCHEMA 中")
            return False
        else:
            print("✅ qwen_image_plus 已从 PROVIDER_SCHEMA 中删除")

        # 检查存在的模型
        required_models = [
            "deepseek", "qwen", "qwen-flash", "qwen_vl", "qwen-vl-plus",
            "qwen3-vl-flash", "moonshot", "moonshot_vision",
            "qwen-image-edit-plus", "qwen-image-max", "wan2.6-image"
        ]

        for model in required_models:
            if model in PROVIDER_SCHEMA:
                print(f"✅ {model} 在 PROVIDER_SCHEMA 中")
            else:
                print(f"❌ {model} 不在 PROVIDER_SCHEMA 中")
                return False

        # 检查build_default_registry
        registry = build_default_registry()
        choices = registry.list_choices()

        print(f"\nRegistry中的提供者: {choices}")

        # 检查已删除的提供者
        if "qwen-mt-image" in choices:
            print("❌ qwen-mt-image 仍在 registry 中")
            return False
        else:
            print("✅ qwen-mt-image 已从 registry 中删除")

        if "qwen_image_plus" in choices:
            print("❌ qwen_image_plus 仍在 registry 中")
            return False
        else:
            print("✅ qwen_image_plus 已从 registry 中删除")

        # 检查存在的提供者
        if "qwen-image-max" in choices:
            print("✅ qwen-image-max 在 registry 中")
        else:
            print("❌ qwen-image-max 不在 registry 中")
            return False

    except Exception as e:
        print(f"❌ registry测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False

    return True

def test_qwen_image_max():
    """测试qwen-image-max提供者"""
    print("\n=== 测试qwen-image-max提供者 ===")

    try:
        from src.xiser_nodes.llm.providers_qwen import QwenImageMaxProvider

        provider = QwenImageMaxProvider()
        print(f"✅ 成功创建 QwenImageMaxProvider 实例")
        print(f"   名称: {provider.config.name}")
        print(f"   标签: {provider.config.label}")
        print(f"   模型: {provider.config.model}")
        print(f"   超时: {provider.config.timeout}")

        # 测试build_payload
        endpoint, payload, headers = provider.build_payload(
            "测试提示词",
            [],
            {"image_size": "1664*928"}
        )

        print(f"✅ 成功构建payload")
        print(f"   端点: {endpoint}")
        print(f"   模型: {payload.get('model')}")
        print(f"   尺寸: {payload.get('parameters', {}).get('size')}")
        print(f"   n值: {payload.get('parameters', {}).get('n')}")

        # 检查n值是否为1
        if payload.get("parameters", {}).get("n") == 1:
            print("✅ n值正确设置为1")
        else:
            print(f"❌ n值不正确: {payload.get('parameters', {}).get('n')}")
            return False

        # 测试过长提示词
        try:
            long_prompt = "a" * 801  # 801个字符，超过800限制
            provider.build_payload(long_prompt, [], {"image_size": "1664*928"})
            print("❌ 过长提示词应抛出异常但未抛出")
            return False
        except ValueError as e:
            if "too long" in str(e).lower() or "800" in str(e):
                print("✅ 过长提示词正确抛出异常")
            else:
                print(f"❌ 异常消息不正确: {e}")
                return False

    except Exception as e:
        print(f"❌ qwen-image-max测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False

    return True

def test_validation():
    """测试验证逻辑"""
    print("\n=== 测试验证逻辑 ===")

    try:
        from src.xiser_nodes.llm.registry import _validate_inputs

        # 测试qwen-image-max验证
        print("测试qwen-image-max验证:")

        # 有效尺寸
        valid_sizes = ["1664*928", "1472*1104", "1328*1328", "1104*1472", "928*1664", ""]
        for size in valid_sizes:
            error = _validate_inputs("qwen-image-max", "测试提示词", [], {"image_size": size})
            if error is None:
                print(f"✅ 有效尺寸 '{size}': 通过")
            else:
                print(f"❌ 有效尺寸 '{size}': 失败 - {error}")
                return False

        # 无效尺寸
        invalid_sizes = ["1024*1024", "1472*1140", "9999*9999"]
        for size in invalid_sizes:
            error = _validate_inputs("qwen-image-max", "测试提示词", [], {"image_size": size})
            if error:
                print(f"✅ 无效尺寸 '{size}': 正确失败 - {error}")
            else:
                print(f"❌ 无效尺寸 '{size}': 不应通过但通过了")
                return False

        # 测试已删除的模型
        print("\n测试已删除的模型验证:")

        # qwen-mt-image应该不再有定义
        error = _validate_inputs("qwen-mt-image", "测试提示词", [], {})
        if error is None:
            print("✅ qwen-mt-image 验证返回None（无定义）")
        else:
            print(f"⚠️  qwen-mt-image 验证返回: {error}")

        # qwen_image_plus应该不再有定义
        error = _validate_inputs("qwen_image_plus", "测试提示词", [], {})
        if error is None:
            print("✅ qwen_image_plus 验证返回None（无定义）")
        else:
            print(f"⚠️  qwen_image_plus 验证返回: {error}")

    except Exception as e:
        print(f"❌ 验证测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False

    return True

def main():
    """主测试函数"""
    print("验证删除qwen-mt-image和qwen_image模型后的代码完整性")
    print("=" * 60)

    tests = [
        ("导入测试", test_imports),
        ("registry测试", test_registry),
        ("qwen-image-max提供者测试", test_qwen_image_max),
        ("验证逻辑测试", test_validation),
    ]

    results = []
    for test_name, test_func in tests:
        try:
            success = test_func()
            results.append((test_name, success))
        except Exception as e:
            print(f"❌ {test_name} 执行时发生异常: {e}")
            import traceback
            traceback.print_exc()
            results.append((test_name, False))

    print("\n" + "=" * 60)
    print("测试结果汇总:")

    all_passed = True
    for test_name, success in results:
        status = "✅ 通过" if success else "❌ 失败"
        print(f"  {test_name}: {status}")
        if not success:
            all_passed = False

    if all_passed:
        print("\n🎉 所有测试通过！代码清理成功完成。")
        print("已成功删除:")
        print("  - qwen-mt-image 模型及相关代码")
        print("  - qwen_image_plus 模型及相关代码")
        print("  - 保留了 qwen-image-max 作为替代")
    else:
        print("\n⚠️  部分测试失败，请检查上述错误。")

    return all_passed

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)