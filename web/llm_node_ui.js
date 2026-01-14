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

app.registerExtension({
    name: "xiser.llm.nodeui",
    setup() {
        const imageParams = ["negative_prompt", "image_size", "gen_image", "max_images", "style", "quality", "watermark", "prompt_extend", "mode"];
        const storageKey = "xiser.llm.profileMap"; // nodeId -> profile
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

            // Add key manager button
            if (!node.widgets.some(w => w.name === "API key management")) {
                node.addWidget("button", "API key management", "open", () => openKeyManager(node));
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
        };

        const applyProvider = (node, providerVal) => {
            const hint = providerHints[providerVal] || {};
            const needImageParams = !!hint.hasImageParams;
            (node.widgets || []).forEach(w => {
                if (!w || !w.name) return;
                if (w.name === "key_profile") return;
                if (imageParams.includes(w.name)) {
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

            // Ensure DeepSeek thinking controls are visible
            if (providerVal === "deepseek") {
                applyDeepSeekMode(node);
            }

            app.graph?.setDirtyCanvas(true, true);
        };

        const applyModeVisibility = (node) => {
            const modeWidget = node.widgets?.find(w => w.name === "mode");
            if (!modeWidget) return;

            const mode = modeWidget.value || "image_edit";
            const isInterleaveMode = mode === "interleave";

            (node.widgets || []).forEach(w => {
                if (!w || !w.name) return;

                // Show/hide parameters based on mode
                if (w.name === "prompt_extend" || w.name === "watermark" || w.name === "gen_image") {
                    w.hidden = isInterleaveMode;
                    w.disabled = isInterleaveMode;
                }

                if (w.name === "max_images") {
                    w.hidden = !isInterleaveMode;
                    w.disabled = !isInterleaveMode;
                }
            });
        };

        const applyDeepSeekMode = (node) => {
            // DeepSeek不再使用mode控件，enable_thinking控件直接控制模式
            // 这个函数现在只确保enable_thinking和thinking_budget控件可见
            (node.widgets || []).forEach(w => {
                if (!w || !w.name) return;

                if (w.name === "enable_thinking" || w.name === "thinking_budget") {
                    w.hidden = false;
                    w.disabled = false;
                }
            });
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
