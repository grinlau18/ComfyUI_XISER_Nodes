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
        const imageParams = ["negative_prompt", "image_size", "n_images", "style", "quality", "watermark"];
        const storageKey = "xiser.llm.profileMap"; // nodeId -> profile
        const providerHints = {
            // 图像生成/编辑模型（需要图像参数）
            "qwen-image-edit-plus": {
                hasImageParams: true,
            },
            "qwen_image_plus": {
                sizes: ["1664*928", "1472*1140", "1328*1328", "1140*1472", "928*1664"],
                hasImageParams: true,
            },
            "qwen-mt-image": {
                hasImageParams: true,
            },
            // 视觉语言模型（支持图像输入，但不需要图像生成参数）
            "qwen_vl": {
                hasImageParams: false,
            },
            "qwen-vl-plus": {
                hasImageParams: false,
            },
            "qwen3-vl-flash": {
                hasImageParams: false,
            },
            "moonshot_vision": {
                hasImageParams: false,
            },
            // 纯文本模型（不需要图像参数）
            "qwen": {
                hasImageParams: false,
            },
            "qwen-flash": {
                hasImageParams: false,
            },
            "moonshot": {
                hasImageParams: false,
            },
            "deepseek": {
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

            const origPropChanged = node.onPropertyChanged;
            node.onPropertyChanged = function(name, value) {
                if (origPropChanged) origPropChanged.call(this, name, value);
                if (name === "provider") applyProvider(node, value);
            };
        };

        const applyProvider = (node, providerVal) => {
            // 处理向后兼容的别名
            if (providerVal === "qwen_image") {
                providerVal = "qwen-image-edit-plus";
            }
            const hint = providerHints[providerVal] || {};
            const needImageParams = !!hint.hasImageParams;
            (node.widgets || []).forEach(w => {
                if (!w || !w.name) return;
                if (w.name === "key_profile") return;
                if (imageParams.includes(w.name)) {
                    w.hidden = false;
                    w.disabled = !needImageParams;
                    // Update allowed sizes if widget is image_size
                    if (w.name === "image_size" && hint.sizes) {
                        w.options = w.options || {};
                        w.options.values = hint.sizes;
                        if (!hint.sizes.includes(w.value)) {
                            w.value = hint.sizes[0];
                        }
                    }
                }
            });
            app.graph?.setDirtyCanvas(true, true);
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
