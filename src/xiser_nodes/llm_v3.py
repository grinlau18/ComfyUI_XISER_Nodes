"""LLM Orchestrator Node - V3版本"""

from comfy_api.v0_0_2 import io, ComfyAPI, ComfyAPISync
from typing import Dict, List, Optional, Any, Tuple
import torch
import requests
import time
# import sys  # 调试日志已关闭
from comfy_execution.utils import get_executing_context

from .llm.base import _gather_images, _image_to_base64
from .llm.registry import _validate_inputs, build_default_registry
from .config import get_llm_config_loader
from .llm import SEED_CACHE  # 从llm模块导入缓存
from .key_store import KEY_STORE

# 创建API实例用于进度更新
api = ComfyAPI()
api_sync = ComfyAPISync()

REGISTRY = build_default_registry()

# Seed缓存功能已模块化到 llm.cache 模块
# 通过 from .llm import SEED_CACHE 导入


def _dummy_image_tensor():
    """返回一个虚拟图像张量"""
    return torch.zeros((1, 1, 1, 3), dtype=torch.float32)


def _update_progress(stage: str, progress: float, total_stages: int = 8, node_id: str = ""):
    """更新进度显示

    Args:
        stage: 当前阶段描述
        progress: 当前阶段进度 (0-1)
        total_stages: 总阶段数
        node_id: 节点ID
    """
    try:
        # 阶段映射到索引
        stage_index = {
            "准备": 0, "验证": 1, "连接": 2, "处理": 3,
            "轮询": 4, "流式": 5, "解析": 6, "完成": 7
        }.get(stage, 0)

        # 计算整体进度
        base_progress = (stage_index / total_stages) * 100
        stage_progress = progress * (100 / total_stages)
        total_progress = min(base_progress + stage_progress, 100)

        # 更新进度
        api_sync.execution.set_progress(
            value=total_progress,
            max_value=100.0,
            node_id=node_id
        )
    except Exception as e:
        # 进度更新失败不影响主要功能
        pass


class XIS_LLMOrchestratorV3(io.ComfyNode):
    """LLM编排器节点 - V3版本"""

    @classmethod
    def define_schema(cls) -> io.Schema:
        """定义节点架构"""
        # 使用新的配置系统获取选项
        config_loader = get_llm_config_loader()
        choices = config_loader.get_model_choices_for_ui()

        # 如果配置加载失败，回退到原来的选项
        if not choices:
            choices = REGISTRY.list_grouped_choices() or ["deepseek"]
            # Format choices for schema
            formatted_choices = [{"value": c, "label": c} for c in choices]
        else:
            formatted_choices = choices

        # Extract values for schema
        option_values = [choice["value"] for choice in formatted_choices]
        default_choice = option_values[0] if option_values else "deepseek"

        return io.Schema(
            node_id="XIS_LLMOrchestrator",
            display_name="XIS LLM Orchestrator",
            category="XISER_Nodes/LLM",
            description="""通过选择的LLM提供者处理提示词，支持文本和图像输入输出。

主要功能：
• 支持多种LLM提供者：DeepSeek、Qwen系列、Moonshot、Wan2.6等
• 图像生成和编辑：支持qwen-image-edit-plus、qwen-image-max、wan2.6-image等视觉模型
• 图文混排：wan2.6-image支持interleave模式，可生成图文混合内容
• 多尺寸支持：提供所有视觉模型支持的图像尺寸预设
• 固定种子：默认使用固定种子(42)确保可重复性
• 智能缓存：seed≥0时自动缓存结果，相同参数直接返回缓存内容

使用说明：
1. 选择提供者：根据需求选择文本对话或图像生成模型
2. 配置API密钥：通过"API key management"按钮管理密钥
3. 设置参数：
   - 图像尺寸：不同模型支持的尺寸不同，不支持的尺寸会自动调整
   - 生成模式：seed≥0为固定模式，-1随机，-2递增计数
   - 图像数量：gen_image控制生成数量，max_images控制图文混排最大数量
4. wan2.6-image特殊说明：
   - image_edit模式：需要输入图像，用于图像编辑
   - interleave模式：可无图像输入，生成图文混合内容
5. 缓存机制：
   - 固定seed（≥0）的结果会自动缓存
   - 相同seed、提示词、图像和参数会直接返回缓存结果
   - 缓存最大容量：50个结果（LRU淘汰）
   - 随机seed（-1）和递增seed（-2）不缓存
   - 缓存开关：通过enable_cache参数可启用/禁用缓存功能

注意：不同模型对参数要求不同，请参考各模型文档。""",
            inputs=[
                io.Combo.Input(
                    "provider",
                    options=option_values,
                    default=default_choice,
                    tooltip="选择LLM提供者"
                ),
                io.String.Input(
                    "instruction",
                    default="",
                    multiline=True,
                    tooltip="输入指令或提示词"
                ),
                io.Image.Input(
                    "image",
                    optional=True,
                    tooltip="单张输入图像"
                ),
                io.Image.Input(
                    "pack_images",
                    optional=True,
                    tooltip="多张输入图像包"
                ),
                io.String.Input(
                    "model_override",
                    default="",
                    optional=True,
                    tooltip="覆盖默认模型名称"
                ),
                io.String.Input(
                    "key_profile",
                    default="",
                    optional=True,
                    tooltip="API密钥配置文件"
                ),
                io.Float.Input(
                    "temperature",
                    default=0.35,
                    min=0.0,
                    max=1.0,
                    step=0.01,
                    optional=True,
                    tooltip="温度参数，控制随机性"
                ),
                io.Float.Input(
                    "top_p",
                    default=0.9,
                    min=0.0,
                    max=1.0,
                    step=0.01,
                    optional=True,
                    tooltip="Top-p采样参数"
                ),
                io.Int.Input(
                    "max_tokens",
                    default=512,
                    min=16,
                    max=4096,
                    step=8,
                    optional=True,
                    tooltip="最大生成token数"
                ),
                io.Boolean.Input(
                    "enable_thinking",
                    default=False,
                    optional=True,
                    tooltip="启用思考模式"
                ),
                io.Int.Input(
                    "thinking_budget",
                    default=0,
                    min=0,
                    max=200000,
                    step=1024,
                    optional=True,
                    tooltip="思考预算"
                ),
                io.Int.Input(
                    "seed",
                    default=42,
                    min=-2,
                    max=4294967295,
                    step=1,
                    control_after_generate=True,
                    optional=True,
                    tooltip="随机种子：≥0为固定模式，-1每次随机，-2递增计数"
                ),
                io.String.Input(
                    "negative_prompt",
                    default="",
                    multiline=True,
                    optional=True,
                    tooltip="负面提示词"
                ),
                io.Combo.Input(
                    "image_size",
                    options=[
                        "",  # 自动选择
                        "1024*1024", "1024*1536", "1104*1472", "1120*1440", "1140*1472",
                        "1152*2048", "1152*864", "1152*896", "1248*1872", "1248*832",
                        "1280*1280", "1280*720", "1280*960", "1296*1728", "1328*1328",
                        "1344*1728", "1344*576", "1440*1120", "1472*1104", "1472*1140",
                        "1536*1024", "1536*1536", "1536*864", "1664*928", "1680*720",
                        "1728*1296", "1728*1344", "1872*1248", "2016*864", "2048*1152",
                        "2048*2048", "512*512", "576*1344", "720*1280", "720*1680",
                        "768*768", "832*1248", "864*1152", "864*1536", "864*2016",
                        "896*1152", "928*1664", "960*1280"
                    ],
                    default="",
                    optional=True,
                    tooltip="图像尺寸（空值表示自动）。包含所有视觉模型支持的尺寸。注意：不同模型支持的尺寸不同，不支持的尺寸会被自动调整或报错"
                ),
                io.Int.Input(
                    "gen_image",
                    default=1,
                    min=1,
                    max=4,
                    step=1,
                    optional=True,
                    tooltip="生成图像数量"
                ),
                io.Int.Input(
                    "max_images",
                    default=3,
                    min=1,
                    max=10,
                    step=1,
                    optional=True,
                    tooltip="最大图像数量（用于interleave模式）"
                ),
                io.Boolean.Input(
                    "watermark",
                    default=False,
                    optional=True,
                    tooltip="是否添加水印"
                ),
                io.Boolean.Input(
                    "prompt_extend",
                    default=True,
                    optional=True,
                    tooltip="是否扩展提示词"
                ),
                io.Combo.Input(
                    "mode",
                    options=["image_edit", "interleave", "chat", "reasoner"],  # 包含所有可能的选项
                    default="image_edit",
                    optional=True,
                    tooltip="模式选择：wan2.6-image支持image_edit/interleave，DeepSeek支持chat/reasoner"
                ),
                io.Boolean.Input(
                    "enable_cache",
                    default=True,
                    optional=True,
                    tooltip="启用seed缓存：固定seed（≥0）的结果会自动缓存，相同参数直接返回缓存内容，避免重复调用API。缓存最大容量50个结果（LRU淘汰）。"
                ),
            ],
            outputs=[
                io.String.Output("response", display_name="文本响应"),
                io.Image.Output("images", display_name="图像列表", is_output_list=True),
                io.String.Output("image_urls", display_name="图像URL列表", is_output_list=True),
            ]
        )

    @classmethod
    def execute(
        cls,
        provider: str,
        instruction: str,
        image: Optional[torch.Tensor] = None,
        pack_images: Optional[List[torch.Tensor]] = None,
        model_override: str = "",
        key_profile: str = "",
        temperature: float = 0.35,
        top_p: float = 0.9,
        max_tokens: int = 512,
        enable_thinking: bool = False,
        thinking_budget: int = 0,
        seed: int = 42,
        negative_prompt: str = "",
        image_size: str = "",
        gen_image: int = 1,
        max_images: int = 3,
        watermark: bool = False,
        prompt_extend: bool = True,
        mode: str = "chat",
        enable_cache: bool = True,
    ) -> io.NodeOutput:
        """执行LLM调用"""
        # 获取节点ID用于进度更新
        executing_context = get_executing_context()
        node_id = executing_context.node_id if executing_context else ""


        try:
            # 进度：准备阶段
            _update_progress("准备", 0.1, node_id=node_id)

            # 将分组名称转换为实际的提供者名称
            actual_provider = REGISTRY.get_actual_provider_name(provider)
            provider_impl = REGISTRY.get(actual_provider)

            # 统一使用实际的提供者名称，避免分组名称问题
            # 这样后续代码就不需要区分 provider 和 actual_provider 了
            provider = actual_provider
        except KeyError:
            return io.NodeOutput(
                f"Error: unknown provider '{provider}'",  # response
                [_dummy_image_tensor()],                   # images
                []                                         # image_urls
            )

        if not instruction.strip():
            return io.NodeOutput(
                "Error: instruction is empty. Provide a prompt to run the node.",  # response
                [_dummy_image_tensor()],                                           # images
                []                                                                 # image_urls
            )

        # 进度：验证阶段
        _update_progress("验证", 0.3, node_id=node_id)

        # 获取API密钥
        profile_clean = (key_profile or "").strip()
        resolved_key = KEY_STORE.get_key(profile_clean) if profile_clean else None
        if not resolved_key and not profile_clean:
            # 回退：尝试使用提供者名称作为配置文件
            resolved_key = KEY_STORE.get_key(provider)
            if resolved_key:
                profile_clean = provider
        if not resolved_key:
            return io.NodeOutput(
                "Error: API key is missing. Open 'API key management' and select an API key for this node.",  # response
                [_dummy_image_tensor()],                                                                      # images
                []                                                                                            # image_urls
            )

        # 处理种子：seed已经是整数
        resolved_seed = seed if (seed is not None and seed >= 0) else None

        # 进度：数据处理阶段
        _update_progress("处理", 0.1, node_id=node_id)

        # 收集图像
        gathered = _gather_images(image, pack_images)
        max_provider_images = provider_impl.config.max_images
        if max_provider_images >= 0 and len(gathered) > max_provider_images:
            gathered = gathered[:max_provider_images]

        # 转换图像为Base64
        image_payloads = [_image_to_base64(img) for img in gathered]

        # 进度：数据处理完成
        _update_progress("处理", 0.5, node_id=node_id)

        # 修正image_size值，确保对当前提供者有效（必须在缓存检查前计算）
        config_loader = get_llm_config_loader()
        model_config = config_loader.get_model(provider)
        allowed_sizes = model_config.supported_image_sizes if model_config else []

        # 如果提供者有image_size枚举，确保使用有效的尺寸
        # 对于视觉模型，优先使用非空的尺寸值
        corrected_image_size = image_size
        if allowed_sizes:
            # 查找第一个非空的尺寸值（对于视觉模型很重要）
            non_empty_sizes = [size for size in allowed_sizes if size]

            if image_size and image_size not in allowed_sizes:
                # 当前值存在但不在允许列表中
                if non_empty_sizes:
                    corrected_image_size = non_empty_sizes[0]  # 使用第一个非空尺寸
                else:
                    corrected_image_size = allowed_sizes[0] if allowed_sizes else ""
            elif not image_size and allowed_sizes:
                # 当前值是空字符串
                if non_empty_sizes:
                    corrected_image_size = non_empty_sizes[0]  # 使用第一个非空尺寸
                else:
                    corrected_image_size = ""  # 如果没有非空尺寸，保持空值

        # 特殊处理：对于只允许空image_size的模型，强制设置为空
        # 这可以防止用户从UI选择无效的尺寸
        if allowed_sizes and len(allowed_sizes) == 1 and allowed_sizes[0] == "":
            corrected_image_size = ""

        # 检查缓存（只对固定seed≥0且启用缓存的情况）
        if seed >= 0 and enable_cache:
            # 直接使用输入参数构建缓存参数，避免使用locals()的动态性
            # 对于wan2.6模型，需要确保参数与提供者实际使用的参数一致
            cache_params = {
                'model_override': model_override,
                'key_profile': key_profile,
                'temperature': temperature,
                'top_p': top_p,
                'max_tokens': max_tokens,
                'enable_thinking': enable_thinking,
                'thinking_budget': thinking_budget,
                'negative_prompt': negative_prompt,
                'image_size': corrected_image_size,  # 使用修正后的image_size确保一致性
                'gen_image': gen_image,
                'max_images': max_images,
                'watermark': watermark,
                'prompt_extend': prompt_extend,
                'mode': mode,
                'profile_clean': profile_clean,
                'resolved_seed': resolved_seed,
            }

            # 特殊处理：对于wan2.6-image提供者，需要调整参数名称以匹配实际使用
            if provider == 'wan2.6-image':
                # wan2.6在image_edit模式下使用'n_images'参数，而不是'gen_image'
                # 确保缓存参数与提供者实际使用的参数一致
                if mode == 'image_edit':
                    cache_params['n_images'] = gen_image
                # 对于interleave模式，使用max_images参数

            # 缓存检查
            cached_result = SEED_CACHE.get(
                seed=seed,
                provider=provider,
                instruction=instruction,
                images=gathered,
                **cache_params
            )
            if cached_result:
                # 进度：从缓存返回
                _update_progress("完成", 1.0, node_id=node_id)
                text, images_out, urls_out = cached_result
                return io.NodeOutput(
                    text or "",      # response
                    images_out,      # images
                    urls_out         # image_urls
                )

        # 构建覆盖参数
        overrides: Dict[str, Any] = {
            "system_prompt": provider_impl.config.default_system_prompt,
            "model": model_override or provider_impl.config.model,
            "temperature": temperature,
            "top_p": top_p,
            "max_tokens": max_tokens,
            "enable_thinking": enable_thinking,
            "thinking_budget": thinking_budget,
            "seed": resolved_seed if resolved_seed is not None else -1,
            "negative_prompt": negative_prompt,
            "image_size": corrected_image_size,
            "n_images": gen_image,
            "max_images": max_images,
            "watermark": watermark,
            "prompt_extend": prompt_extend,
            "mode": mode,
        }

        # 验证输入
        validation_error = _validate_inputs(provider, instruction, gathered, overrides)
        if validation_error:
            return io.NodeOutput(
                f"Error: {validation_error}",  # response
                [_dummy_image_tensor()],       # images
                []                             # image_urls
            )

        # 进度：验证完成
        _update_progress("验证", 0.8, node_id=node_id)

        try:
            # 进度：调用提供者
            _update_progress("连接", 0.1, node_id=node_id)

            # 创建进度回调函数
            def progress_callback(stage: str, progress: float):
                _update_progress(stage, progress, node_id=node_id)

            # 调用提供者
            response = provider_impl.invoke(instruction, image_payloads, resolved_key, overrides, progress_callback)

            # 进度：解析响应
            _update_progress("解析", 0.3, node_id=node_id)

            text = provider_impl.extract_text(response)
            images = provider_impl.extract_images(response)
            image_urls = provider_impl.extract_image_urls(response)

            # 进度：解析完成
            _update_progress("解析", 1.0, node_id=node_id)
        except requests.HTTPError as exc:
            err_detail = exc.response.text if exc.response is not None else str(exc)
            text = f"LLM request failed: {exc}: {err_detail}"
            images = []
            image_urls = []
        except Exception as exc:
            text = f"Error: {exc}"
            images = []
            image_urls = []

        # 确保至少返回一个虚拟图像
        images_out = images if images else [_dummy_image_tensor()]
        urls_out = image_urls if image_urls else []

        # 缓存结果（只对固定seed≥0、启用缓存且成功的情况）

        if seed >= 0 and enable_cache and text and not text.startswith("Error:") and not text.startswith("LLM request failed:"):
            try:
                # 使用与缓存检查相同的参数构建方式
                cache_params = {
                    'model_override': model_override,
                    'key_profile': key_profile,
                    'temperature': temperature,
                    'top_p': top_p,
                    'max_tokens': max_tokens,
                    'enable_thinking': enable_thinking,
                    'thinking_budget': thinking_budget,
                    'negative_prompt': negative_prompt,
                    'image_size': corrected_image_size,  # 使用修正后的image_size确保一致性
                    'gen_image': gen_image,
                    'max_images': max_images,
                    'watermark': watermark,
                    'prompt_extend': prompt_extend,
                    'mode': mode,
                    'profile_clean': profile_clean,
                    'resolved_seed': resolved_seed,
                }

                # 特殊处理：对于wan2.6-image提供者，需要调整参数名称以匹配实际使用
                if provider == 'wan2.6-image':
                    # wan2.6在image_edit模式下使用'n_images'参数，而不是'gen_image'
                    # 确保缓存参数与提供者实际使用的参数一致
                    if mode == 'image_edit':
                        cache_params['n_images'] = gen_image
                    # 对于interleave模式，使用max_images参数

                # 调试：计算并显示缓存键信息（临时启用）
                try:
                    # 计算图像哈希
                    image_hash = SEED_CACHE._hash_images(gathered)
                    # 计算参数哈希
                    params_hash = SEED_CACHE._hash_params(**cache_params)
                    # 生成缓存键
                    cache_key = SEED_CACHE._generate_cache_key(seed, provider, instruction, image_hash, params_hash)

                except Exception:
                    pass  # 缓存键计算错误不影响主要功能

                SEED_CACHE.set(
                    seed=seed,
                    provider=provider,
                    instruction=instruction,
                    images=gathered,
                    result=(text, images_out, urls_out),
                    **cache_params
                )
                # 调试信息：记录缓存设置（已关闭）
                # try:
                #     print(f"[XISER LLM] 缓存设置成功，seed={seed}, provider={provider}, 当前缓存大小: {SEED_CACHE.size()}", file=sys.stderr)
                # except:
                #     pass
            except Exception:
                # 缓存失败不影响主要功能
                pass

        # 进度：完成阶段
        _update_progress("完成", 1.0, node_id=node_id)

        return io.NodeOutput(
            text or "",      # response
            images_out,      # images
            urls_out         # image_urls
        )


# V3节点类列表
V3_NODE_CLASSES = [
    XIS_LLMOrchestratorV3,
]