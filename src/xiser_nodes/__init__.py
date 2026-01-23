"""XISER Nodes Core Module - V3 Architecture"""

__version__ = "1.4.2"
__author__ = "XISER"
__email__ = "grinlau18@gmail.com"
__license__ = "MIT"  # 补充许可证（可选但推荐）
__description__ = "This extension integrates interactive multi-layer canvas editing, multimodal LLM intelligent processing (supporting mainstream models like DeepSeek, Qwen, Kimi, Wan), professional-grade image processing toolchains, video generation orchestration systems (supporting Wansiang series reference-based video, image-to-video, and keyframe-to-video generation), and visual data tools, providing end-to-end support for AI image and video generation workflows from creative conception to fine editing. With advanced PSD import, BiRefNet intelligent matting, real-time layer transformations, unified configuration-based video generation orchestration, and secure API key management, it significantly enhances creative efficiency and output quality. Additionally, it offers workflow customization features like node color management and label nodes to improve visual organization and personalization of complex workflows."

# V1节点注册已完全移除 - 所有节点已迁移到V3架构
# 此文件不再包含任何V1节点注册，所有节点通过V3 Extension注册

# 空映射 - V1架构不再使用
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
