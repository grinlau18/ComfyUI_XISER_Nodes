"""LLM package exposing orchestrator and provider registry."""

# Legacy imports for backward compatibility
from .orchestrator import NODE_CLASS_MAPPINGS, REGISTRY, XIS_LLMOrchestrator
from .registry import PROVIDER_SCHEMA

__all__ = [
    "NODE_CLASS_MAPPINGS",
    "REGISTRY",
    "XIS_LLMOrchestrator",
    "PROVIDER_SCHEMA",
]

# v3模式：不导出legacy映射
NODE_CLASS_MAPPINGS = None
NODE_DISPLAY_NAME_MAPPINGS = None
