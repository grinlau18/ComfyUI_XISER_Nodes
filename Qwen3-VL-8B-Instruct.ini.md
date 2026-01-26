Qwen3-VL-8B-Instruct
来认识一下Qwen3-VL——迄今为止Qwen系列中最强大的视觉-语言模型。

这一代产品在各方面都实现了全面升级：更出色的文本理解与生成能力、更深入的视觉感知与推理能力、更长的上下文长度、更强的空间和视频动态理解能力，以及更强大的智能体交互能力。

提供密集型和混合专家（MoE）两种架构，可从边缘设备扩展至云端，还具备指令版和增强推理能力的思维版，支持灵活的按需部署。

主要增强功能：
视觉智能体：操作电脑/移动设备图形用户界面——识别元素、理解功能、调用工具、完成任务。

视觉编码增强：从图像/视频生成Draw.io/HTML/CSS/JS。

高级空间感知：判断物体位置、视角和遮挡情况；提供更强的2D定位能力，并支持用于空间推理和具身人工智能的3D定位。

长上下文与视频理解：原生256K上下文，可扩展至100万；能处理书籍和时长数小时的视频，具备完整回忆能力和秒级索引功能。

增强的多模态推理能力：在STEM/数学领域表现出色——擅长因果分析以及提供符合逻辑、基于证据的答案。

升级后的视觉识别：更广泛、更高质量的预训练使其能够“识别万物”——名人、动漫、产品、地标、动植物等。

扩展光学字符识别（OCR）：支持32种语言（此前为19种）；在低光、模糊和倾斜情况下表现稳定；对罕见/古文字和专业术语识别更出色；改进了长文档结构解析能力。

文本理解能力与纯大语言模型相当：无缝的文本-视觉融合，实现无损、统一的理解。

模型架构更新：



交错式MRoPE：通过稳健的位置嵌入在时间、宽度和高度上进行全频率分配，增强长时视频推理能力。

DeepStack：融合多级视觉Transformer（ViT）特征，以捕捉细粒度细节并增强图文对齐。

文本-时间戳对齐： 超越T-RoPE，实现精确的、基于时间戳的事件定位，以增强视频时间建模。

这是Qwen3-VL-8B-Instruct的权重仓库。

模型性能
多模态性能



纯文本性能


快速入门
下面，我们提供简单的示例来展示如何结合🤖魔搭社区（ModelScope）和🤗Transformers使用Qwen3-VL。

Qwen3-VL的代码已包含在最新版的Hugging Face transformers中，建议您使用以下命令从源代码构建：

pip install git+https://github.com/huggingface/transformers
# pip install transformers==4.57.0 # currently, V4.57.0 is not released

使用🤗Transformers进行聊天
下面我们展示一段代码片段，以说明如何将聊天模型与transformers结合使用：

from transformers import Qwen3VLForConditionalGeneration, AutoProcessor

# default: Load the model on the available device(s)
model = Qwen3VLForConditionalGeneration.from_pretrained(
    "Qwen/Qwen3-VL-8B-Instruct", dtype="auto", device_map="auto"
)

# We recommend enabling flash_attention_2 for better acceleration and memory saving, especially in multi-image and video scenarios.
# model = Qwen3VLForConditionalGeneration.from_pretrained(
#     "Qwen/Qwen3-VL-8B-Instruct",
#     dtype=torch.bfloat16,
#     attn_implementation="flash_attention_2",
#     device_map="auto",
# )

processor = AutoProcessor.from_pretrained("Qwen/Qwen3-VL-8B-Instruct")

messages = [
    {
        "role": "user",
        "content": [
            {
                "type": "image",
                "image": "https://qianwen-res.oss-cn-beijing.aliyuncs.com/Qwen-VL/assets/demo.jpeg",
            },
            {"type": "text", "text": "Describe this image."},
        ],
    }
]

# Preparation for inference
inputs = processor.apply_chat_template(
    messages,
    tokenize=True,
    add_generation_prompt=True,
    return_dict=True,
    return_tensors="pt"
)
inputs = inputs.to(model.device)

# Inference: Generation of the output
generated_ids = model.generate(**inputs, max_new_tokens=128)
generated_ids_trimmed = [
    out_ids[len(in_ids) :] for in_ids, out_ids in zip(inputs.input_ids, generated_ids)
]
output_text = processor.batch_decode(
    generated_ids_trimmed, skip_special_tokens=True, clean_up_tokenization_spaces=False
)
print(output_text)

生成超参数
VL
export greedy='false'
export top_p=0.8
export top_k=20
export temperature=0.7
export repetition_penalty=1.0
export presence_penalty=1.5
export out_seq_length=16384

文本
export greedy='false'
export top_p=1.0
export top_k=40
export repetition_penalty=1.0
export presence_penalty=2.0
export temperature=1.0
export out_seq_length=32768

引用
如果您觉得我们的工作有帮助，欢迎引用我们的成果。

@misc{qwen3technicalreport,
      title={Qwen3 Technical Report}, 
      author={Qwen Team},
      year={2025},
      eprint={2505.09388},
      archivePrefix={arXiv},
      primaryClass={cs.CL},
      url={https://arxiv.org/abs/2505.09388}, 
}

@article{Qwen2.5-VL,
  title={Qwen2.5-VL Technical Report},
  author={Bai, Shuai and Chen, Keqin and Liu, Xuejing and Wang, Jialin and Ge, Wenbin and Song, Sibo and Dang, Kai and Wang, Peng and Wang, Shijie and Tang, Jun and Zhong, Humen and Zhu, Yuanzhi and Yang, Mingkun and Li, Zhaohai and Wan, Jianqiang and Wang, Pengfei and Ding, Wei and Fu, Zheren and Xu, Yiheng and Ye, Jiabo and Zhang, Xi and Xie, Tianbao and Cheng, Zesen and Zhang, Hang and Yang, Zhibo and Xu, Haiyang and Lin, Junyang},
  journal={arXiv preprint arXiv:2502.13923},
  year={2025}
}

@article{Qwen2VL,
  title={Qwen2-VL: Enhancing Vision-Language Model's Perception of the World at Any Resolution},
  author={Wang, Peng and Bai, Shuai and Tan, Sinan and Wang, Shijie and Fan, Zhihao and Bai, Jinze and Chen, Keqin and Liu, Xuejing and Wang, Jialin and Ge, Wenbin and Fan, Yang and Dang, Kai and Du, Mengfei and Ren, Xuancheng and Men, Rui and Liu, Dayiheng and Zhou, Chang and Zhou, Jingren and Lin, Junyang},
  journal={arXiv preprint arXiv:2409.12191},
  year={2024}
}

@article{Qwen-VL,
  title={Qwen-VL: A Versatile Vision-Language Model for Understanding, Localization, Text Reading, and Beyond},
  author={Bai, Jinze and Bai, Shuai and Yang, Shusheng and Wang, Shijie and Tan, Sinan and Wang, Peng and Lin, Junyang and Zhou, Chang and Zhou, Jingren},
  journal={arXiv preprint arXiv:2308.12966},
  year={2023}
}



一、页面核心内容总结
Qwen3-VL-8B-Instruct 是 Qwen 系列最新的多模态视觉 - 语言模型，发布于 2025 年 10 月，核心优势与关键信息如下：
核心能力：支持图文理解与生成、视觉推理、长上下文处理（原生 256K，可扩展至 1M）、视频理解、OCR（32 种语言）、空间感知（2D/3D grounding）、视觉代理（操作 GUI）、视觉编码（生成 Draw.io/HTML/CSS/JS）等。
技术架构：采用 Dense/MoE 解码器架构，搭载 Interleaved-MRoPE 位置编码、DeepStack 特征融合、Text-Timestamp Alignment 视频时序建模等优化方案。
性能表现：在 STEM / 数学、通用 VQA、OCR、文档理解、视频分析等任务中表现优异，优于多款同类模型（如 Gemini2.5-Flash、GPT5-Nano），纯文本能力比肩专用 LLM。
调用相关：基于 Hugging Face Transformers 框架，支持 BF16 张量类型，需通过特定 Processor 处理图文输入，推理参数可自定义（temperature、top_p 等）。
二、开发 ComfyUI 自定义节点的核心参考内容
1. 模型加载核心配置
依赖库：必须引入 transformers（需从源码安装最新版）、torch、PIL、safetensors，可选 accelerate（优化部署）、flash_attn_2（加速推理）。
加载类：使用 Qwen3VLForConditionalGeneration 加载模型，AutoProcessor 处理输入（图文统一编码），需指定 trust_remote_code=True。
设备与精度：默认自动适配设备（device_map="auto"），推荐使用 torch.bfloat16 精度，支持 GPU/CPU 部署，显存不足时可启用 4bit/8bit 量化。
缓存机制：模型体积约 9B 参数，需设计全局缓存（如 MODEL_CACHE），避免重复加载占用资源。
2. 输入输出设计依据
输入类型：
视觉输入：支持图片、视频（需处理帧提取与时间戳对齐），ComfyUI 节点需适配其 IMAGE 张量格式（[batch, height, width, channel]，0-1 取值）。
文本输入：支持单轮 / 多轮对话，需遵循模型要求的聊天模板（apply_chat_template），包含 system/user 角色，图文内容需按 {"type": "image"}/{"type": "text"} 结构化传入。
输出类型：以文本为主（模型生成的描述、推理结果、代码等），ComfyUI 节点返回 STRING 类型，可扩展支持结构化输出（如 OCR 结果字典、坐标信息）。
3. 关键参数配置（需暴露给节点用户）
模型相关：本地模型路径（支持自定义目录选择）。
生成参数：
视觉 - 语言任务：temperature=0.7、top_p=0.8、top_k=20、max_new_tokens=16384、repetition_penalty=1.0、presence_penalty=1.5。
纯文本任务：temperature=1.0、top_p=1.0、top_k=40、max_new_tokens=32768、presence_penalty=2.0。
功能开关：是否启用 flash_attention_2（加速）、视频帧采样间隔（处理长视频时）、OCR 语言选择（32 种可选）。
4. 核心技术适配点
图文融合处理：通过 processor 统一编码图片与文本，需调用 apply_chat_template 生成模型可识别的输入格式，添加 add_generation_prompt=True 触发生成。
视频处理：支持小时级视频输入，需处理帧嵌入（Video frame embs）与时间戳对齐（Text-Timestamp Alignment），节点可扩展帧提取与时序建模功能。
OCR 与文档理解：模型支持低光、模糊、倾斜场景及生僻字 / 古文字识别，节点可针对长文档添加分块处理逻辑。
空间感知适配：若需支持 2D/3D grounding 功能，节点需输出坐标信息（如目标检测框、3D 位置），扩展返回类型为 STRING+BOX/POINT。
5. 性能优化参考
启用 flash_attention_2 提升推理速度与显存利用率，尤其适用于多图 / 视频场景。
采用 DeepStack 特征融合逻辑，可优化图片细节捕捉（节点无需额外实现，模型内置）。
长上下文处理：利用模型原生 256K 上下文优势，节点可支持长文档（如书籍）、长视频的批量处理，无需手动分块。