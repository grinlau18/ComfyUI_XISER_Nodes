import { app } from "/scripts/app.js";

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
        const highFrequencyWidgets = ["provider", "instruction", "seed", "mode"];

        // 低频使用控件（默认隐藏，可通过高级设置按钮显示）
        // 注意：style和quality参数目前不被任何provider使用，已移除
        const lowFrequencyWidgets = [
            "temperature", "top_p", "max_tokens", "enable_thinking", "thinking_budget",
            "negative_prompt", "gen_image", "max_images", "image_size",
            "watermark", "prompt_extend", "model_override"
        ];

        // 支持思考模式的providers列表
        const thinkingEnabledProviders = [
            "deepseek",           // DeepSeek支持思考模式
            "qwen",               // Qwen系列支持思考模式
            "qwen-flash",         // Qwen Flash支持思考模式
            "qwen_vl",            // Qwen VL支持思考模式
            "qwen-vl-plus",       // Qwen VL Plus支持思考模式
            "qwen3-vl-flash",     // Qwen3 VL Flash支持思考模式
            "qwen3-max"           // Qwen3-Max支持思考模式
        ];

        // 存储每个节点的高级设置展开状态
        const advancedSettingsKey = "xiser.llm.advancedSettings";
        // 辅助函数：处理分组提供者名称
        const getActualProviderName = (groupedName) => {
            if (groupedName.startsWith("alibaba/")) {
                return groupedName.substring(8); // 移除"alibaba/"前缀
            }
            if (groupedName.startsWith("moonshot/")) {
                return groupedName.substring(9); // 移除"moonshot/"前缀
            }
            return groupedName;
        };

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
                sizes: ["", "1280*1280", "1280*720", "720*1280", "1280*960", "960*1280", "1024*1024", "1152*896", "896*1152", "768*768"],
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
            "qwen3-max": {
                sizes: [""],  // 纯文本模型
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
            "z-image-turbo": {
                sizes: [
                    "",  // 自动选择
                    // 总像素1024*1024的推荐分辨率
                    "1024*1024", "832*1248", "1248*832", "864*1152", "1152*864",
                    "896*1152", "1152*896", "720*1280", "576*1344", "1280*720", "1344*576",
                    // 总像素1280*1280的推荐分辨率
                    "1280*1280", "1024*1536", "1536*1024", "1104*1472", "1472*1104",
                    "1120*1440", "1440*1120", "864*1536", "720*1680", "1536*864", "1680*720",
                    // 总像素1536*1536的推荐分辨率
                    "1536*1536", "1248*1872", "1872*1248", "1296*1728", "1728*1296",
                    "1344*1728", "1728*1344", "1152*2048", "864*2016", "2048*1152", "2016*864",
                    // 其他常用分辨率
                    "512*512", "768*768", "1024*1536", "1536*1024", "2048*2048"
                ],
                hasImageParams: true,
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

                // 检查节点是否已经有key_profile值（复制节点时可能已经设置了）
                const existingValue = keyWidget.value;
                if (existingValue && existingValue.trim() !== "") {
                    // 节点已经有值，保留它（复制节点的情况）
                    // 不需要从localStorage读取
                } else {
                    // 节点没有值，从localStorage读取
                    const raw = localStorage.getItem(storageKey);
                    const map = raw ? JSON.parse(raw) : {};
                    const stored = map[node.id];
                    if (stored) {
                        keyWidget.value = stored;
                    } else if (node.properties?.provider) {
                        keyWidget.value = node.properties.provider; // fallback to provider-named profile
                    }
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
            // 处理分组提供者名称
            const actualProvider = getActualProviderName(providerVal);
            const hint = providerHints[actualProvider] || {};
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
                    if (thinkingEnabledProviders.includes(actualProvider)) {
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
                    // 但对于图像生成模型的gen_image控件，始终显示
                    // 对于支持图像输出的模型的image_size控件，始终显示
                    if (!isAdvancedExpanded && lowFrequencyWidgets.includes(w.name)) {
                        // 检查是否是图像生成模型的gen_image控件
                        if (w.name === "gen_image") {
                            const providerHint = providerHints[actualProvider];
                            const isImageGenerationProvider = providerHint?.hasImageParams === true;
                            if (isImageGenerationProvider) {
                                // 图像生成模型的gen_image始终显示，跳过隐藏逻辑
                            } else {
                                // 非图像生成模型的gen_image，正常隐藏
                                w.hidden = true;
                                w.disabled = true;
                                return;
                            }
                        }
                        // 检查是否是支持图像输出的模型的image_size控件
                        else if (w.name === "image_size") {
                            const providerHint = providerHints[actualProvider];
                            const isImageOutputProvider = providerHint?.hasImageParams === true;
                            if (isImageOutputProvider) {
                                // 支持图像输出的模型的image_size始终显示，跳过隐藏逻辑
                            } else {
                                // 不支持图像输出的模型的image_size，正常隐藏
                                w.hidden = true;
                                w.disabled = true;
                                return;
                            }
                        }
                        else {
                            // 其他低频控件，正常隐藏
                            w.hidden = true;
                            w.disabled = true;
                            return;
                        }
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

                        if (actualProvider === "wan2.6-image") {
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
                        } else if (actualProvider === "deepseek") {
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
            if (actualProvider === "wan2.6-image") {
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
                    // 检查当前提供者是否支持图像生成
                    const providerHint = providerHints[providerVal];
                    const isImageGenerationProvider = providerHint?.hasImageParams === true;

                    if (isImageGenerationProvider) {
                        // 对于图像生成模型，gen_image始终显示（高频控件）
                        // 根据模式显示/隐藏
                        w.hidden = isInterleaveMode;
                        w.disabled = isInterleaveMode;
                    } else {
                        // 对于非图像生成模型，gen_image是低频控件
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
