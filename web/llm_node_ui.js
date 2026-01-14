import { app } from "/scripts/app.js";

function openKeyManager(node) {
    window.__XISER_ACTIVE_NODE_ID = node?.id ?? null;
    const mgr = window.__XISER_KEY_MGR;
    if (mgr && typeof mgr.toggleModal === "function") {
        mgr.restoreSelectionForActiveNode?.();
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
        buttonWidget.label = `API Key (${profileName}) used`;
    } else {
        // 未选择API Key：显示"Please set the API Key"
        buttonWidget.label = "Please set the API Key";
    }
}

app.registerExtension({
    name: "xiser.llm.nodeui",
    setup() {
        const imageParams = ["negative_prompt", "image_size", "gen_image", "max_images", "watermark", "prompt_extend", "mode"];
        const storageKey = "xiser.llm.profileMap"; // nodeId -> profile

        // 高频使用控件（始终显示）
        const highFrequencyWidgets = ["provider", "instruction", "seed", "image_size", "mode"];

        // 低频使用控件（默认隐藏，可通过高级设置按钮显示）
        // 注意：style和quality参数目前不被任何provider使用，已移除
        const lowFrequencyWidgets = [
            "temperature", "top_p", "max_tokens", "enable_thinking", "thinking_budget",
            "negative_prompt", "gen_image", "max_images",
            "watermark", "prompt_extend", "model_override"
        ];

        // 支持思考模式的providers列表
        const thinkingEnabledProviders = [
            "deepseek",           // DeepSeek支持思考模式
            "qwen",               // Qwen系列支持思考模式
            "qwen-flash",         // Qwen Flash支持思考模式
            "qwen_vl",            // Qwen VL支持思考模式
            "qwen-vl-plus",       // Qwen VL Plus支持思考模式
            "qwen3-vl-flash"      // Qwen3 VL Flash支持思考模式
        ];

        // 存储每个节点的高级设置展开状态
        const advancedSettingsKey = "xiser.llm.advancedSettings";
        const providerHints = {
            "qwen-image-edit-plus": {
                sizes: ["", "1664*928", "1472*1140", "1328*1328", "1140*1472", "928*1664", "1024*1024", "512*512", "2048*2048"],
                hasImageParams: true,
            },
            "qwen-image-max": {
                sizes: ["", "1664*928", "1472*1104", "1328*1328", "1104*1472", "928*1664"],
                hasImageParams: true,
            },
            "wan2.6-image": {
                sizes: ["", "1280*1280", "1024*1024", "512*512", "2048*2048"],
                hasImageParams: true,
            },
            // 为其他提供者添加默认尺寸支持
            "deepseek": {
                sizes: [""],  // 视觉模型但不生成图像
                hasImageParams: false,
            },
            "qwen": {
                sizes: [""],  // 视觉模型但不生成图像
                hasImageParams: false,
            },
            "qwen-flash": {
                sizes: [""],  // 纯文本模型
                hasImageParams: false,
            },
            "qwen_vl": {
                sizes: [""],  // 视觉语言模型
                hasImageParams: false,
            },
            "qwen-vl-plus": {
                sizes: [""],  // 视觉语言模型
                hasImageParams: false,
            },
            "qwen3-vl-flash": {
                sizes: [""],  // 视觉语言模型
                hasImageParams: false,
            },
            "moonshot": {
                sizes: [""],  // 纯文本模型
                hasImageParams: false,
            },
            "moonshot_vision": {
                sizes: [""],  // 视觉模型但不生成图像
                hasImageParams: false,
            },
        };

        const attach = async node => {
            if (node?.comfyClass !== "XIS_LLMOrchestrator") return;
            node.widgets = node.widgets || [];

            // 初始化节点的高级设置状态
            const rawSettings = localStorage.getItem(advancedSettingsKey);
            const settingsMap = rawSettings ? JSON.parse(rawSettings) : {};
            const nodeSettings = settingsMap[node.id] || { expanded: false };

            // 保存回本地存储
            settingsMap[node.id] = nodeSettings;
            localStorage.setItem(advancedSettingsKey, JSON.stringify(settingsMap));

            // 添加高级设置按钮
            if (!node.widgets.some(w => w.name === "Advanced Settings")) {
                const toggleAdvancedSettings = () => {
                    // 切换展开状态
                    nodeSettings.expanded = !nodeSettings.expanded;
                    settingsMap[node.id] = nodeSettings;
                    localStorage.setItem(advancedSettingsKey, JSON.stringify(settingsMap));

                    // 更新按钮文本
                    const btn = node.widgets.find(w => w.name === "Advanced Settings");
                    if (btn) {
                        btn.label = nodeSettings.expanded ? "Hide Advanced Settings" : "Show Advanced Settings";
                    }

                    // 应用控件可见性
                    applyAdvancedSettingsVisibility(node, nodeSettings.expanded);
                    app.graph?.setDirtyCanvas(true, true);
                };

                node.addWidget("button", "Advanced Settings",
                    nodeSettings.expanded ? "Hide Advanced Settings" : "Show Advanced Settings",
                    toggleAdvancedSettings);
            }

            // Hide key_profile widget if present and keep it updated from modal selection
            const keyWidget = node.widgets.find(w => w.name === "key_profile");
            if (keyWidget) {
                keyWidget.hidden = true;
                keyWidget.computeSize = () => [0, 0];
                const raw = localStorage.getItem(storageKey);
                const map = raw ? JSON.parse(raw) : {};
                const stored = map[node.id];
                if (stored) {
                    keyWidget.value = stored;
                } else if (node.properties?.provider) {
                    keyWidget.value = node.properties.provider; // fallback to provider-named profile
                }
            }

            // Add key manager button
            if (!node.widgets.some(w => w.name === "API key management")) {
                node.addWidget("button", "API key management", "open", () => openKeyManager(node));
            }
            // 初始化按钮文字（无论按钮是否新创建都需要更新）
            // 注意：必须在key_profile值恢复后调用
            updateApiKeyButtonText(node);

            const providerWidget = node.widgets.find(w => w.name === "provider");
            const modeWidget = node.widgets.find(w => w.name === "mode");
            const readProvider = () => providerWidget?.value || node.properties?.provider;

            if (providerWidget) {
                const origCb = providerWidget.callback;
                providerWidget.callback = function() {
                    if (origCb) origCb.apply(this, arguments);
                    applyProvider(node, readProvider());
                };
                setTimeout(() => applyProvider(node, readProvider()), 10);
            } else {
                applyProvider(node, readProvider());
            }

            // Add callback for mode widget
            if (modeWidget) {
                const origModeCb = modeWidget.callback;
                modeWidget.callback = function() {
                    if (origModeCb) origModeCb.apply(this, arguments);
                    const provider = readProvider();
                    if (provider === "wan2.6-image") {
                        applyModeVisibility(node);
                    } else if (provider === "deepseek") {
                        // DeepSeek不再使用mode控件，enable_thinking控件直接控制模式
                    }
                };
            }

            const origPropChanged = node.onPropertyChanged;
            node.onPropertyChanged = function(name, value) {
                if (origPropChanged) origPropChanged.call(this, name, value);
                const provider = readProvider();
                if (name === "provider") {
                    applyProvider(node, value);
                } else if (name === "mode") {
                    if (provider === "wan2.6-image") {
                        applyModeVisibility(node);
                    } else if (provider === "deepseek") {
                        // DeepSeek不再使用mode控件，enable_thinking控件直接控制模式
                    }
                }
            };

            // 初始化控件可见性
            setTimeout(() => {
                applyAdvancedSettingsVisibility(node, nodeSettings.expanded);
                app.graph?.setDirtyCanvas(true, true);
            }, 50);
        };

        const applyProvider = (node, providerVal) => {
            const hint = providerHints[providerVal] || {};
            const needImageParams = !!hint.hasImageParams;

            // 获取节点的高级设置状态
            const rawSettings = localStorage.getItem(advancedSettingsKey);
            const settingsMap = rawSettings ? JSON.parse(rawSettings) : {};
            const nodeSettings = settingsMap[node.id] || { expanded: false };
            const isAdvancedExpanded = nodeSettings.expanded;

            (node.widgets || []).forEach(w => {
                if (!w || !w.name) return;
                if (w.name === "key_profile") return;

                // 处理思考模式控件
                if (w.name === "enable_thinking") {
                    if (thinkingEnabledProviders.includes(providerVal)) {
                        // 支持思考模式的provider：始终显示enable_thinking控件
                        w.hidden = false;
                        w.disabled = false;
                    } else {
                        // 不支持思考模式的provider：根据高级设置状态显示/隐藏
                        if (!isAdvancedExpanded) {
                            w.hidden = true;
                            w.disabled = true;
                        } else {
                            w.hidden = false;
                            w.disabled = false;
                        }
                    }
                    return;
                }

                if (w.name === "thinking_budget") {
                    // thinking_budget控件始终根据高级设置状态显示/隐藏
                    if (!isAdvancedExpanded) {
                        w.hidden = true;
                        w.disabled = true;
                    } else {
                        w.hidden = false;
                        w.disabled = false;
                    }
                    return;
                }

                if (imageParams.includes(w.name)) {
                    // 如果高级设置未展开，隐藏低频控件
                    if (!isAdvancedExpanded && lowFrequencyWidgets.includes(w.name)) {
                        w.hidden = true;
                        w.disabled = true;
                        return;
                    }

                    w.hidden = false;
                    w.disabled = !needImageParams;
                    // Update allowed sizes if widget is image_size
                    if (w.name === "image_size") {
                        if (hint.sizes) {
                            w.options = w.options || {};
                            w.options.values = hint.sizes;

                            // 对于视觉模型（hasImageParams: true），需要特殊处理空字符串
                            if (needImageParams) {
                                // 视觉模型：优先使用非空的尺寸值
                                const nonEmptySizes = hint.sizes.filter(size => size && size !== "");

                                if (!w.value || w.value === "") {
                                    // 当前值是空字符串，选择第一个非空的尺寸值
                                    if (nonEmptySizes.length > 0) {
                                        w.value = nonEmptySizes[0];
                                    } else {
                                        // 如果没有非空尺寸，使用第一个值（可能是空字符串）
                                        w.value = hint.sizes[0];
                                    }
                                } else if (!hint.sizes.includes(w.value)) {
                                    // 当前值存在但不在允许列表中
                                    if (nonEmptySizes.length > 0) {
                                        w.value = nonEmptySizes[0];  // 使用第一个非空尺寸
                                    } else {
                                        w.value = hint.sizes[0];  // 使用第一个值
                                    }
                                }
                            } else {
                                // 非视觉模型：如果当前值不在允许列表中，重置为第一个值
                                if (!hint.sizes.includes(w.value)) {
                                    w.value = hint.sizes[0];
                                }
                            }
                        } else {
                            // 如果没有指定尺寸，使用节点定义中的默认选项
                            // 但隐藏控件，因为该提供者不支持图像参数
                            w.hidden = true;
                            w.disabled = true;
                        }
                    }
                    // Special handling for mode parameter
                    if (w.name === "mode") {
                        // mode控件现在始终显示（在highFrequencyWidgets中）
                        // 但需要根据提供者设置正确的选项和可见性

                        if (providerVal === "wan2.6-image") {
                            w.hidden = false;
                            w.disabled = false;
                            // 设置wan2.6的选项
                            if (w.options) {
                                w.options.values = ["image_edit", "interleave"];
                            }
                            // 确保当前值有效
                            if (w.value && !["image_edit", "interleave"].includes(w.value)) {
                                w.value = "image_edit";
                            }
                        } else if (providerVal === "deepseek") {
                            // DeepSeek使用enable_thinking控件切换对话和思考模式，隐藏mode控件
                            w.hidden = true;
                            w.disabled = true;
                        } else {
                            // 其他提供者隐藏mode控件
                            w.hidden = true;
                            w.disabled = true;
                        }
                    }
                }
            });

            // Apply mode-specific visibility for wan2.6-image
            if (providerVal === "wan2.6-image") {
                applyModeVisibility(node);
            }

            // Note: enable_thinking and thinking_budget controls are now handled
            // in the main widget loop based on thinkingEnabledProviders list

            app.graph?.setDirtyCanvas(true, true);
        };

        const applyModeVisibility = (node) => {
            const modeWidget = node.widgets?.find(w => w.name === "mode");
            if (!modeWidget) return;

            const mode = modeWidget.value || "image_edit";
            const isInterleaveMode = mode === "interleave";

            // 获取节点的高级设置状态
            const rawSettings = localStorage.getItem(advancedSettingsKey);
            const settingsMap = rawSettings ? JSON.parse(rawSettings) : {};
            const nodeSettings = settingsMap[node.id] || { expanded: false };
            const isAdvancedExpanded = nodeSettings.expanded;

            (node.widgets || []).forEach(w => {
                if (!w || !w.name) return;

                // Show/hide parameters based on mode
                if (w.name === "prompt_extend" || w.name === "watermark") {
                    // watermark和prompt_extend现在在lowFrequencyWidgets中
                    // 如果高级设置未展开，隐藏这些控件
                    if (!isAdvancedExpanded) {
                        w.hidden = true;
                        w.disabled = true;
                    } else {
                        // 高级设置已展开，根据模式显示/隐藏
                        w.hidden = isInterleaveMode;
                        w.disabled = isInterleaveMode;
                    }
                }

                if (w.name === "gen_image") {
                    // gen_image在lowFrequencyWidgets中
                    // 如果高级设置未展开，隐藏这个控件
                    if (!isAdvancedExpanded) {
                        w.hidden = true;
                        w.disabled = true;
                    } else {
                        // 高级设置已展开，根据模式显示/隐藏
                        w.hidden = isInterleaveMode;
                        w.disabled = isInterleaveMode;
                    }
                }

                if (w.name === "max_images") {
                    // max_images在lowFrequencyWidgets中
                    // 如果高级设置未展开，隐藏这个控件
                    if (!isAdvancedExpanded) {
                        w.hidden = true;
                        w.disabled = true;
                    } else {
                        // 高级设置已展开，根据模式显示/隐藏
                        w.hidden = !isInterleaveMode;
                        w.disabled = !isInterleaveMode;
                    }
                }
            });
        };


        const applyAdvancedSettingsVisibility = (node, isExpanded) => {
            // 获取节点的高级设置状态
            const rawSettings = localStorage.getItem(advancedSettingsKey);
            const settingsMap = rawSettings ? JSON.parse(rawSettings) : {};
            const nodeSettings = settingsMap[node.id] || { expanded: false };

            // 实际使用传入的isExpanded参数
            const expanded = isExpanded !== undefined ? isExpanded : nodeSettings.expanded;

            (node.widgets || []).forEach(w => {
                if (!w || !w.name) return;

                // 跳过特殊控件
                if (w.name === "key_profile" || w.name === "API key management" || w.name === "Advanced Settings") {
                    return;
                }

                // 高频控件始终显示
                if (highFrequencyWidgets.includes(w.name)) {
                    w.hidden = false;
                    w.disabled = false;
                    return;
                }

                // 低频控件根据展开状态显示/隐藏
                if (lowFrequencyWidgets.includes(w.name)) {
                    // 获取当前provider
                    const providerWidget = node.widgets.find(w2 => w2.name === "provider");
                    const providerVal = providerWidget?.value || node.properties?.provider;

                    // 对于支持思考模式的providers，enable_thinking控件始终显示
                    if (w.name === "enable_thinking" && thinkingEnabledProviders.includes(providerVal)) {
                        w.hidden = false;
                        w.disabled = false;
                    } else {
                        // thinking_budget和其他低频控件根据高级设置状态显示/隐藏
                        w.hidden = !expanded;
                        w.disabled = !expanded;
                    }
                }
            });

            // 应用提供者特定的可见性（这会覆盖高级设置的状态）
            const providerWidget = node.widgets.find(w => w.name === "provider");
            if (providerWidget) {
                applyProvider(node, providerWidget.value || node.properties?.provider);
            }
        };

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
                // 更新按钮文字
                updateApiKeyButtonText(n);
            });
            app.graph?.setDirtyCanvas(true, true);
        });

        app.onNodeCreated?.push?.(node => attach(node));
        if (app.canvas?.graph) {
            const orig = app.canvas.graph.onNodeAdded;
            app.canvas.graph.onNodeAdded = function(n) {
                if (orig) orig.apply(this, arguments);
                attach(n);
            };
        }
    },
});
