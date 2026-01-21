import { app } from "/scripts/app.js";

// Global variable to store the LLM configuration
window.XISER_LLM_CONFIG = null;

function openKeyManager(node) {
    window.__XISER_ACTIVE_NODE_ID = node?.id ?? null;

    // 获取节点的当前key_profile值
    let currentProfile = "";
    if (node) {
        const keyWidget = node.widgets?.find(w => w.name === "key_profile");
        if (keyWidget && keyWidget.value) {
            currentProfile = keyWidget.value;
        }
    }

    const mgr = window.__XISER_KEY_MGR;
    if (mgr && typeof mgr.toggleModal === "function") {
        // 传递当前profile值给API Key管理面板
        mgr.restoreSelectionForActiveNode?.(currentProfile);
        mgr.toggleModal(true);
    } else {
        alert("LLM key manager not ready. Please reload.");
    }
}

// 更新API Key Management按钮文字
function updateApiKeyButtonText(node) {
    const buttonWidget = node.widgets?.find(w => w.name === "API key management");
    if (!buttonWidget) return;

    const keyWidget = node.widgets?.find(w => w.name === "key_profile");
    const profileName = keyWidget?.value || "";

    if (profileName && profileName.trim() !== "") {
        // 已选择API Key：显示"API Key  (名称) used"
        buttonWidget.label = \`API Key (\${profileName}) used\`;
    } else {
        // 未选择API Key：显示"Please set the API Key"
        buttonWidget.label = "Please set the API Key";
    }
}

// Load LLM configuration from the API
async function loadLLMConfig() {
    try {
        const response = await fetch("/xiser/llm/config");
        const result = await response.json();
        
        if (result.success) {
            window.XISER_LLM_CONFIG = result.data;
            console.log("[XISER LLM UI] 配置加载成功", window.XISER_LLM_CONFIG);
            return true;
        } else {
            console.error("[XISER LLM UI] 配置加载失败:", result.error);
            return false;
        }
    } catch (error) {
        console.error("[XISER LLM UI] 配置加载异常:", error);
        return false;
    }
}

// Get model configuration by name
function getModelConfig(modelName) {
    if (!window.XISER_LLM_CONFIG || !window.XISER_LLM_CONFIG.models) {
        return null;
    }
    return window.XISER_LLM_CONFIG.models[modelName];
}

// Apply model-specific UI changes
function applyModelUI(node, modelName) {
    if (!modelName || !window.XISER_LLM_CONFIG) {
        return;
    }

    const modelConfig = getModelConfig(modelName);
    if (!modelConfig) {
        console.warn(\`[XISER LLM UI] 未找到模型配置: \${modelName}\`);
        return;
    }

    const uiConfig = modelConfig.ui;
    const providerType = modelConfig.providerType;
    
    // Get all widgets
    const widgets = node.widgets || [];
    
    // Update visibility and enabled state based on UI config
    widgets.forEach(widget => {
        switch (widget.name) {
            case "temperature":
                widget.hidden = !uiConfig.hasTemperature;
                widget.disabled = !uiConfig.hasTemperature;
                if (uiConfig.hasTemperature && widget.value === undefined) {
                    widget.value = uiConfig.defaultTemperature;
                }
                break;
            case "top_p":
                widget.hidden = !uiConfig.hasTopP;
                widget.disabled = !uiConfig.hasTopP;
                if (uiConfig.hasTopP && widget.value === undefined) {
                    widget.value = uiConfig.defaultTopP;
                }
                break;
            case "max_tokens":
                widget.hidden = !uiConfig.hasMaxTokens;
                widget.disabled = !uiConfig.hasMaxTokens;
                if (uiConfig.hasMaxTokens && widget.value === undefined) {
                    widget.value = uiConfig.defaultMaxTokens;
                }
                break;
            case "enable_thinking":
                widget.hidden = !uiConfig.hasEnableThinking;
                widget.disabled = !uiConfig.hasEnableThinking;
                if (uiConfig.hasEnableThinking && widget.value === undefined) {
                    widget.value = uiConfig.defaultEnableThinking;
                }
                break;
            case "thinking_budget":
                widget.hidden = !uiConfig.hasThinkingBudget;
                widget.disabled = !uiConfig.hasThinkingBudget;
                if (uiConfig.hasThinkingBudget && widget.value === undefined) {
                    widget.value = uiConfig.defaultThinkingBudget;
                }
                break;
            case "negative_prompt":
                widget.hidden = !uiConfig.hasNegativePrompt;
                widget.disabled = !uiConfig.hasNegativePrompt;
                if (uiConfig.hasNegativePrompt && widget.value === undefined) {
                    widget.value = uiConfig.defaultNegativePrompt;
                }
                break;
            case "image_size":
                widget.hidden = !uiConfig.hasImageSize;
                widget.disabled = !uiConfig.hasImageSize;
                if (uiConfig.hasImageSize) {
                    // Update options based on supported image sizes
                    if (modelConfig.supportedImageSizes && modelConfig.supportedImageSizes.length > 0) {
                        widget.options = widget.options || {};
                        widget.options.values = modelConfig.supportedImageSizes;
                        
                        // Set default value if current value is not in the list
                        if (!modelConfig.supportedImageSizes.includes(widget.value)) {
                            widget.value = uiConfig.defaultImageSize || modelConfig.supportedImageSizes[0];
                        }
                    }
                }
                break;
            case "gen_image":
                widget.hidden = !uiConfig.hasGenImage;
                widget.disabled = !uiConfig.hasGenImage;
                if (uiConfig.hasGenImage && widget.value === undefined) {
                    widget.value = uiConfig.defaultGenImage;
                }
                break;
            case "max_images":
                widget.hidden = !uiConfig.hasMaxImages;
                widget.disabled = !uiConfig.hasMaxImages;
                if (uiConfig.hasMaxImages && widget.value === undefined) {
                    widget.value = uiConfig.defaultMaxImages;
                }
                break;
            case "watermark":
                widget.hidden = !uiConfig.hasWatermark;
                widget.disabled = !uiConfig.hasWatermark;
                if (uiConfig.hasWatermark && widget.value === undefined) {
                    widget.value = uiConfig.defaultWatermark;
                }
                break;
            case "prompt_extend":
                widget.hidden = !uiConfig.hasPromptExtend;
                widget.disabled = !uiConfig.hasPromptExtend;
                if (uiConfig.hasPromptExtend && widget.value === undefined) {
                    widget.value = uiConfig.defaultPromptExtend;
                }
                break;
            case "mode":
                widget.hidden = !uiConfig.hasMode;
                widget.disabled = !uiConfig.hasMode;
                if (uiConfig.hasMode) {
                    // Update options based on supported modes
                    if (modelConfig.supportedModes && modelConfig.supportedModes.length > 0) {
                        widget.options = widget.options || {};
                        widget.options.values = modelConfig.supportedModes;
                        
                        // Set default value if current value is not in the list
                        if (!modelConfig.supportedModes.includes(widget.value)) {
                            widget.value = uiConfig.defaultMode || modelConfig.supportedModes[0];
                        }
                    }
                }
                break;
            case "seed":
                widget.hidden = !uiConfig.hasSeed;
                widget.disabled = !uiConfig.hasSeed;
                if (uiConfig.hasSeed && widget.value === undefined) {
                    widget.value = uiConfig.defaultSeed;
                }
                break;
            case "enable_cache":
                widget.hidden = !uiConfig.hasEnableCache;
                widget.disabled = !uiConfig.hasEnableCache;
                if (uiConfig.hasEnableCache && widget.value === undefined) {
                    widget.value = uiConfig.defaultEnableCache;
                }
                break;
            default:
                // Handle other widgets as needed
                break;
        }
    });
    
    // Special handling for mode-dependent widgets
    if (uiConfig.hasMode) {
        const modeWidget = widgets.find(w => w.name === "mode");
        if (modeWidget) {
            const mode = modeWidget.value;
            applyModeSpecificUI(node, mode);
        }
    }
    
    app.graph?.setDirtyCanvas(true, true);
}

// Apply mode-specific UI changes (for models like wan2.6-image)
function applyModeSpecificUI(node, mode) {
    const widgets = node.widgets || [];
    
    widgets.forEach(widget => {
        switch (widget.name) {
            case "prompt_extend":
            case "watermark":
                // Hide these in interleave mode
                if (mode === "interleave") {
                    widget.hidden = true;
                    widget.disabled = true;
                } else {
                    widget.hidden = false;
                    widget.disabled = false;
                }
                break;
            case "gen_image":
                // Hide this in interleave mode
                if (mode === "interleave") {
                    widget.hidden = true;
                    widget.disabled = true;
                } else {
                    widget.hidden = false;
                    widget.disabled = false;
                }
                break;
            case "max_images":
                // Show this only in interleave mode
                if (mode === "interleave") {
                    widget.hidden = false;
                    widget.disabled = false;
                } else {
                    widget.hidden = true;
                    widget.disabled = true;
                }
                break;
        }
    });
    
    app.graph?.setDirtyCanvas(true, true);
}

// Store advanced settings state in localStorage
const ADVANCED_SETTINGS_KEY = "xiser.llm.advancedSettings";

function getAdvancedSettingsState(nodeId) {
    const rawSettings = localStorage.getItem(ADVANCED_SETTINGS_KEY);
    const settingsMap = rawSettings ? JSON.parse(rawSettings) : {};
    return settingsMap[nodeId] || { expanded: false };
}

function setAdvancedSettingsState(nodeId, expanded) {
    const rawSettings = localStorage.getItem(ADVANCED_SETTINGS_KEY);
    const settingsMap = rawSettings ? JSON.parse(rawSettings) : {};
    settingsMap[nodeId] = { expanded };
    localStorage.setItem(ADVANCED_SETTINGS_KEY, JSON.stringify(settingsMap));
}

// Apply advanced settings visibility
function applyAdvancedSettingsVisibility(node, isExpanded) {
    const widgets = node.widgets || [];
    
    // High frequency widgets (always visible)
    const highFrequencyWidgets = ["provider", "instruction", "seed", "mode"];
    
    // Low frequency widgets (controlled by advanced settings)
    const lowFrequencyWidgets = [
        "temperature", "top_p", "max_tokens", "enable_thinking", "thinking_budget",
        "negative_prompt", "gen_image", "max_images", "image_size",
        "watermark", "prompt_extend", "model_override"
    ];
    
    widgets.forEach(widget => {
        if (!widget || !widget.name) return;
        
        // Skip special widgets
        if (widget.name === "key_profile" || widget.name === "API key management" || widget.name === "Advanced Settings") {
            return;
        }
        
        // High frequency widgets are always visible
        if (highFrequencyWidgets.includes(widget.name)) {
            widget.hidden = false;
            widget.disabled = false;
            return;
        }
        
        // Low frequency widgets are controlled by advanced settings
        if (lowFrequencyWidgets.includes(widget.name)) {
            widget.hidden = !isExpanded;
            widget.disabled = !isExpanded;
        }
    });
    
    // Reapply model-specific settings after advanced settings changes
    const providerWidget = widgets.find(w => w.name === "provider");
    if (providerWidget) {
        applyModelUI(node, providerWidget.value);
    }
}

app.registerExtension({
    name: "xiser.llm.nodeui.config",
    async setup() {
        // Load configuration when extension is set up
        await loadLLMConfig();
    },
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "XIS_LLMOrchestrator") return;
        
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function() {
            if (onNodeCreated) onNodeCreated.apply(this, arguments);
            
            // Wait for configuration to be loaded
            if (!window.XISER_LLM_CONFIG) {
                loadLLMConfig().then(success => {
                    if (success) {
                        // Reinitialize the node after config is loaded
                        this.widgets = this.widgets || [];
                        initializeLLMNode(this);
                    }
                });
            } else {
                this.widgets = this.widgets || [];
                initializeLLMNode(this);
            }
        };
    },
});

function initializeLLMNode(node) {
    // Initialize advanced settings state
    const nodeSettings = getAdvancedSettingsState(node.id);
    
    // Add advanced settings button if not exists
    if (!node.widgets.some(w => w.name === "Advanced Settings")) {
        const toggleAdvancedSettings = () => {
            // Toggle expanded state
            nodeSettings.expanded = !nodeSettings.expanded;
            setAdvancedSettingsState(node.id, nodeSettings.expanded);
            
            // Update button text
            const btn = node.widgets.find(w => w.name === "Advanced Settings");
            if (btn) {
                btn.label = nodeSettings.expanded ? "Hide Advanced Settings" : "Show Advanced Settings";
            }
            
            // Apply visibility settings
            applyAdvancedSettingsVisibility(node, nodeSettings.expanded);
        };
        
        node.addWidget("button", "Advanced Settings",
            nodeSettings.expanded ? "Hide Advanced Settings" : "Show Advanced Settings",
            toggleAdvancedSettings);
    }
    
    // Hide key_profile widget and keep it updated from modal selection
    const keyWidget = node.widgets.find(w => w.name === "key_profile");
    if (keyWidget) {
        keyWidget.hidden = true;
        keyWidget.computeSize = () => [0, 0];
        
        // Restore value from localStorage or set default
        const existingValue = keyWidget.value;
        if (existingValue && existingValue.trim() !== "") {
            // Node already has a value (copy scenario)
        } else {
            const raw = localStorage.getItem("xiser.llm.profileMap");
            const map = raw ? JSON.parse(raw) : {};
            const stored = map[node.id];
            if (stored) {
                keyWidget.value = stored;
            } else if (node.properties?.provider) {
                keyWidget.value = node.properties.provider;
            }
        }
    }
    
    // Add key manager button
    if (!node.widgets.some(w => w.name === "API key management")) {
        node.addWidget("button", "API key management", "open", () => openKeyManager(node));
    }
    
    // Initialize button text
    updateApiKeyButtonText(node);
    
    // Add callback for provider widget
    const providerWidget = node.widgets.find(w => w.name === "provider");
    if (providerWidget) {
        const origCb = providerWidget.callback;
        providerWidget.callback = function() {
            if (origCb) origCb.apply(this, arguments);
            applyModelUI(node, providerWidget.value);
        };
        
        // Apply initial UI based on current provider
        setTimeout(() => applyModelUI(node, providerWidget.value), 10);
    }
    
    // Add callback for mode widget
    const modeWidget = node.widgets.find(w => w.name === "mode");
    if (modeWidget) {
        const origModeCb = modeWidget.callback;
        modeWidget.callback = function() {
            if (origModeCb) origModeCb.apply(this, arguments);
            applyModeSpecificUI(node, modeWidget.value);
        };
    }
    
    // Add property change handler for dynamic updates
    const origPropChanged = node.onPropertyChanged;
    node.onPropertyChanged = function(name, value) {
        if (origPropChanged) origPropChanged.call(this, name, value);
        
        if (name === "provider") {
            applyModelUI(node, value);
        } else if (name === "mode") {
            applyModeSpecificUI(node, value);
        }
    };
    
    // Apply initial advanced settings visibility
    setTimeout(() => {
        applyAdvancedSettingsVisibility(node, nodeSettings.expanded);
        app.graph?.setDirtyCanvas(true, true);
    }, 50);
}

// Sync hidden key_profile when modal selection changes (per-node)
window.addEventListener("xiser-llm-profile-changed", e => {
    const profile = (e.detail && e.detail.profile) || "";
    const nodeId = e.detail?.nodeId;
    const nodes = app?.graph?._nodes || [];
    nodes.forEach(n => {
        if (n?.comfyClass !== "XIS_LLMOrchestrator") return;
        if (nodeId != null && n.id !== nodeId) return;
        const w = n.widgets?.find(x => x.name === "key_profile");
        if (w) w.value = profile;
        // Update button text
        updateApiKeyButtonText(n);
    });
    app.graph?.setDirtyCanvas(true, true);
});
