/**
 * VGM Orchestrator节点UI增强 - 配置驱动版本
 * 基于统一配置系统，动态加载模型配置
 */

import { app } from "/scripts/app.js";

// 配置缓存
let configCache = {
    models: {},
    choices: [],
    providerTypes: {},
    lastUpdated: 0,
    cacheDuration: 5 * 60 * 1000 // 5分钟缓存
};

// API Key管理函数（保持不变）
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
        alert("VGM API Key manager not ready. Please reload.");
    }
}

// 更新API Key Management按钮文字（保持不变）
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

// 辅助函数：处理分组提供者名称（保持不变）
function getActualProviderName(groupedName) {
    if (groupedName.startsWith("alibaba/")) {
        return groupedName.substring(8); // 移除"alibaba/"前缀
    }
    return groupedName;
}

// 加载配置
async function loadConfig() {
    const now = Date.now();

    // 检查缓存是否有效
    if (configCache.lastUpdated && (now - configCache.lastUpdated) < configCache.cacheDuration) {
        console.log("[VGM UI] 使用缓存的配置");
        return configCache;
    }

    try {
        console.log("[VGM UI] 正在加载配置...");
        const response = await fetch("/xiser/vgm/config");

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || "配置加载失败");
        }

        // 更新缓存
        configCache = {
            models: result.data.models || {},
            choices: result.data.choices || [],
            providerTypes: result.data.providerTypes || {},
            lastUpdated: now,
            cacheDuration: configCache.cacheDuration
        };

        console.log(`[VGM UI] 配置加载成功，加载了 ${Object.keys(configCache.models).length} 个模型`);
        return configCache;

    } catch (error) {
        console.error("[VGM UI] 配置加载失败:", error);

        // 如果配置加载失败，使用默认配置
        return {
            models: getDefaultConfig(),
            choices: getDefaultChoices(),
            provider_types: {},  // 统一使用 provider_types
            lastUpdated: now,
            cacheDuration: configCache.cacheDuration
        };
    }
}

// 获取特定模型的配置
async function getModelConfig(modelName) {
    const config = await loadConfig();
    const actualName = getActualProviderName(modelName);
    return config.models[actualName] || null;
}

// 默认配置（回退方案）
function getDefaultConfig() {
    // 提供所有模型的默认配置，基于旧的硬编码配置
    return {
        "wan2.6-r2v": {
            providerType: "r2v",
            hasImageInput: false,
            hasVideoUrlInput: true,
            hasResolution: false,
            hasAudio: false,
            hasPromptExtend: false,
            hasTemplate: false,
            hasShotType: true,
            hasSize: true,
            supportedRegions: ["china", "singapore", "virginia"],
            supportedDurations: [5, 10],
            supportedSizes: [
                "1280*720", "720*1280", "960*960", "1088*832", "832*1088",
                "1920*1080", "1080*1920", "1440*1440", "1632*1248", "1248*1632"
            ],
            maxPromptLength: 1500,
        },
        "wan2.6-i2v": {
            providerType: "i2v",
            hasImageInput: true,
            hasVideoUrlInput: false,
            hasResolution: true,
            hasAudio: true,
            hasPromptExtend: true,
            hasTemplate: true,
            hasShotType: true,
            hasSize: false,
            supportedRegions: ["china", "singapore", "virginia"],
            supportedDurations: [5, 10, 15],
            supportedResolutions: ["720P", "1080P"],
            maxPromptLength: 1500,
        },
        "wan2.5-i2v-preview": {
            providerType: "i2v",
            hasImageInput: true,
            hasVideoUrlInput: false,
            hasResolution: true,
            hasAudio: true,
            hasPromptExtend: true,
            hasTemplate: false,
            hasShotType: false,
            hasSize: false,
            supportedRegions: ["china", "singapore", "virginia"],
            supportedDurations: [5, 10],
            supportedResolutions: ["480P", "720P", "1080P"],
            maxPromptLength: 1500,
        },
        "wan2.2-i2v-flash": {
            providerType: "i2v",
            hasImageInput: true,
            hasVideoUrlInput: false,
            hasResolution: true,
            hasAudio: false,
            hasPromptExtend: true,
            hasTemplate: false,
            hasShotType: false,
            hasSize: false,
            supportedRegions: ["china", "singapore", "virginia"],
            supportedDurations: [5],
            supportedResolutions: ["480P", "720P", "1080P"],
            maxPromptLength: 800,
        },
        "wan2.2-i2v-plus": {
            providerType: "i2v",
            hasImageInput: true,
            hasVideoUrlInput: false,
            hasResolution: true,
            hasAudio: false,
            hasPromptExtend: true,
            hasTemplate: false,
            hasShotType: false,
            hasSize: false,
            supportedRegions: ["china", "singapore", "virginia"],
            supportedDurations: [5],
            supportedResolutions: ["480P", "1080P"],
            maxPromptLength: 800,
        },
        "wanx2.1-i2v-plus": {
            providerType: "i2v",
            hasImageInput: true,
            hasVideoUrlInput: false,
            hasResolution: true,
            hasAudio: false,
            hasPromptExtend: true,
            hasTemplate: true,
            hasShotType: false,
            hasSize: false,
            supportedRegions: ["china", "singapore", "virginia"],
            supportedDurations: [5],
            supportedResolutions: ["720P"],
            maxPromptLength: 800,
        },
        "wanx2.1-i2v-turbo": {
            providerType: "i2v",
            hasImageInput: true,
            hasVideoUrlInput: false,
            hasResolution: true,
            hasAudio: false,
            hasPromptExtend: true,
            hasTemplate: true,
            hasShotType: false,
            hasSize: false,
            supportedRegions: ["china", "singapore", "virginia"],
            supportedDurations: [3, 4, 5],
            supportedResolutions: ["480P", "720P"],
            maxPromptLength: 800,
        },
        "wan2.2-kf2v-flash": {
            providerType: "kf2v",
            hasImageInput: true,
            hasVideoUrlInput: false,
            hasResolution: true,
            hasAudio: false,
            hasPromptExtend: true,
            hasTemplate: true,
            hasShotType: false,
            hasSize: false,
            supportedRegions: ["china", "singapore"],
            supportedDurations: [5],
            supportedResolutions: ["480P", "720P", "1080P"],
            maxPromptLength: 800,
        },
        "wanx2.1-kf2v-plus": {
            providerType: "kf2v",
            hasImageInput: true,
            hasVideoUrlInput: false,
            hasResolution: true,
            hasAudio: false,
            hasPromptExtend: true,
            hasTemplate: true,
            hasShotType: false,
            hasSize: false,
            supportedRegions: ["china", "singapore"],
            supportedDurations: [5],
            supportedResolutions: ["720P"],
            maxPromptLength: 800,
        }
    };
}

function getDefaultChoices() {
    return [
        { value: "wan2.6-r2v", label: "万相2.6参考生视频", group: "alibaba", provider_type: "r2v" },
        { value: "wan2.6-i2v", label: "万相2.6图生视频", group: "alibaba", provider_type: "i2v" },
        { value: "wan2.5-i2v-preview", label: "万相2.5图生视频预览版", group: "alibaba", provider_type: "i2v" },
        { value: "wan2.2-i2v-flash", label: "万相2.2图生视频极速版", group: "alibaba", provider_type: "i2v" },
        { value: "wan2.2-i2v-plus", label: "万相2.2图生视频专业版", group: "alibaba", provider_type: "i2v" },
        { value: "wanx2.1-i2v-plus", label: "万相2.1图生视频专业版", group: "alibaba", provider_type: "i2v" },
        { value: "wanx2.1-i2v-turbo", label: "万相2.1图生视频极速版", group: "alibaba", provider_type: "i2v" },
        { value: "wan2.2-kf2v-flash", label: "万相2.2首尾帧生视频极速版", group: "alibaba", provider_type: "kf2v" },
        { value: "wanx2.1-kf2v-plus", label: "万相2.1首尾帧生视频专业版", group: "alibaba", provider_type: "kf2v" }
    ];
}

// 属性清理辅助函数
function cleanupWidgetValue(widget, hint, propertyName, defaultValue = "") {
    if (!hint[propertyName] && widget.value && widget.value !== defaultValue) {
        widget.value = defaultValue;
        console.log(`[VGM UI] 清理控件 ${widget.name}: 从 "${widget.value}" 重置为 "${defaultValue}"`);
    }
}

// 应用提供者配置
async function applyProvider(node, providerVal) {
    // 处理分组提供者名称
    const actualProvider = getActualProviderName(providerVal);

    // 加载模型配置
    const hint = await getModelConfig(actualProvider);

    if (!hint) {
        console.warn(`[VGM UI] 未找到模型配置: ${actualProvider}`);
        return;
    }

    const isR2V = hint.providerType === "r2v";
    const isI2V = hint.providerType === "i2v";
    const isKf2V = hint.providerType === "kf2v";

    // 获取节点的高级设置状态
    const advancedSettingsKey = "xiser.vgm.advancedSettings";
    const rawSettings = localStorage.getItem(advancedSettingsKey);
    const settingsMap = rawSettings ? JSON.parse(rawSettings) : {};
    const nodeSettings = settingsMap[node.id] || { expanded: false };
    const isAdvancedExpanded = nodeSettings.expanded;

    // 高频使用控件（始终显示）
    const highFrequencyWidgets = ["provider", "prompt", "seed"];

    // 低频使用控件（默认隐藏，可通过高级设置按钮显示）
    const lowFrequencyWidgets = [
        "negative_prompt", "watermark", "endpoint_override",
        "polling_interval", "max_polling_time", "region"
    ];

    (node.widgets || []).forEach(w => {
        if (!w || !w.name) return;
        if (w.name === "key_profile" || w.name === "API key management" || w.name === "Advanced Settings") {
            return;
        }

        // 关键修复：确保每个控件的options都是有效的对象（ComboWidget要求）
        if (w.options === undefined || w.options === null || typeof w.options !== 'object') {
            w.options = {};
        }
        // 确保options对象有values属性（如果是数组控件）
        if (!w.options.values) {
            w.options.values = [];
        }

        // 高频控件始终显示
        if (highFrequencyWidgets.includes(w.name)) {
            w.hidden = false;
            w.disabled = false;
            return;
        }

        // 低频控件根据高级设置状态显示/隐藏
        if (lowFrequencyWidgets.includes(w.name)) {
            w.hidden = !isAdvancedExpanded;
            w.disabled = !isAdvancedExpanded;
            return;
        }

        // 根据提供者类型控制控件可见性
        switch (w.name) {
            // 参考生视频相关控件
            case "reference_video_url":
                w.hidden = !isR2V;
                w.disabled = !isR2V;
                break;
            case "size":
                w.hidden = !isR2V;
                w.disabled = !isR2V;
                // 更新尺寸选项 - 使用正确的ComboWidget格式
                if (!w.hidden && hint.supportedSizes && Array.isArray(hint.supportedSizes)) {
                    w.options = w.options || {};
                    w.options.values = hint.supportedSizes.slice();
                    if (!hint.supportedSizes.includes(w.value)) {
                        w.value = hint.supportedSizes[0] || "1280*720";
                    }
                }
                break;
            case "shot_type":
                w.hidden = !hint.hasShotType;
                w.disabled = !hint.hasShotType;
                // 如果不支持多镜头，重置为单镜头
                if (!hint.hasShotType && w.value === "multi") {
                    w.value = "single";
                }
                break;

            // 图生视频相关控件
            case "pack_images":
                const shouldShowImages = isI2V || isKf2V;
                w.hidden = !shouldShowImages;
                w.disabled = !shouldShowImages;
                break;
            case "audio_url":
                w.hidden = !hint.hasAudio;
                w.disabled = !hint.hasAudio;
                // 使用辅助函数清理值
                cleanupWidgetValue(w, hint, "hasAudio", "");
                break;
            case "resolution":
                w.hidden = !hint.hasResolution;
                w.disabled = !hint.hasResolution;
                // 更新分辨率选项 - 使用正确的ComboWidget格式
                if (!w.hidden && hint.supportedResolutions && Array.isArray(hint.supportedResolutions)) {
                    w.options = w.options || {};
                    w.options.values = hint.supportedResolutions.slice();
                    if (!hint.supportedResolutions.includes(w.value)) {
                        w.value = hint.supportedResolutions[0] || "720P";
                    }
                }
                break;
            case "prompt_extend":
                w.hidden = !hint.hasPromptExtend;
                w.disabled = !hint.hasPromptExtend;
                // 使用辅助函数清理值（默认为true）
                if (!hint.hasPromptExtend && w.value === false) {
                    w.value = true;
                }
                break;
            case "template":
                w.hidden = !hint.hasTemplate;
                w.disabled = !hint.hasTemplate;
                // 使用辅助函数清理值
                cleanupWidgetValue(w, hint, "hasTemplate", "");
                break;

            // 时长控件
            case "duration":
                w.hidden = false;
                w.disabled = false;
                // 更新时长选项 - 使用正确的ComboWidget格式
                if (hint.supportedDurations && Array.isArray(hint.supportedDurations)) {
                    w.options = w.options || {};
                    w.options.values = hint.supportedDurations.slice();
                    if (!hint.supportedDurations.includes(w.value)) {
                        w.value = hint.supportedDurations[0] || 5;
                    }
                }
                break;

            // 地区控件
            case "region":
                // 根据高级设置状态控制可见性
                w.hidden = !isAdvancedExpanded;
                w.disabled = !isAdvancedExpanded;
                // 更新地区选项 - 使用正确的ComboWidget格式
                if (!w.hidden && hint.supportedRegions && Array.isArray(hint.supportedRegions)) {
                    w.options = w.options || {};
                    // 过滤选项，只保留支持的地区
                    const currentValues = w.options.values || [];
                    const filteredValues = currentValues.filter(option =>
                        hint.supportedRegions.includes(option)
                    );
                    w.options.values = filteredValues.slice();
                    if (!hint.supportedRegions.includes(w.value)) {
                        w.value = hint.defaultRegion || "china";
                    }
                }
                break;
        }
    });

    app.graph?.setDirtyCanvas(true, true);
}

// 应用高级设置可见性
function applyAdvancedSettingsVisibility(node, isExpanded) {
    // 获取节点的高级设置状态
    const advancedSettingsKey = "xiser.vgm.advancedSettings";
    const rawSettings = localStorage.getItem(advancedSettingsKey);
    const settingsMap = rawSettings ? JSON.parse(rawSettings) : {};
    const nodeSettings = settingsMap[node.id] || { expanded: false };

    // 实际使用传入的isExpanded参数
    const expanded = isExpanded !== undefined ? isExpanded : nodeSettings.expanded;

    // 高频使用控件（始终显示）
    const highFrequencyWidgets = ["provider", "prompt", "seed"];

    // 低频使用控件（默认隐藏，可通过高级设置按钮显示）
    const lowFrequencyWidgets = [
        "negative_prompt", "watermark", "endpoint_override",
        "polling_interval", "max_polling_time", "region"
    ];

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
            w.hidden = !expanded;
            w.disabled = !expanded;
        }
    });

    // 应用提供者特定的可见性（这会覆盖高级设置的状态）
    const providerWidget = node.widgets.find(w => w.name === "provider");
    if (providerWidget) {
        applyProvider(node, providerWidget.value || node.properties?.provider);
    }
}

// 主扩展注册
app.registerExtension({
    name: "XISER_Nodes.VideoUI_Config",
    async setup() {
        console.log("[VGM UI] 初始化配置驱动UI扩展");

        // 预加载配置
        try {
            await loadConfig();
            console.log("[VGM UI] 配置预加载成功");
        } catch (error) {
            console.warn("[VGM UI] 配置预加载失败，将在使用时动态加载:", error);
        }

        // 高频使用控件（始终显示）
        const highFrequencyWidgets = ["provider", "prompt", "seed"];

        // 低频使用控件（默认隐藏，可通过高级设置按钮显示）
        const lowFrequencyWidgets = [
            "negative_prompt", "watermark", "endpoint_override",
            "polling_interval", "max_polling_time", "region"
        ];

        // 存储每个节点的高级设置展开状态
        const advancedSettingsKey = "xiser.vgm.advancedSettings";
        const storageKey = "xiser.vgm.profileMap"; // nodeId -> profile

        const attach = async node => {
            if (node?.comfyClass !== "XIS_VGMOrchestrator") return;
            node.widgets = node.widgets || [];

            // 关键修复：在节点附加时立即初始化所有控件的options属性
            // 这是防止ComboWidget错误的关键步骤
            node.widgets.forEach(w => {
                if (!w || !w.name) return;
                // 确保所有控件的options都是有效的对象（ComboWidget要求）
                if (w.options === undefined || w.options === null || typeof w.options !== 'object') {
                    w.options = {};
                }
                // 确保options对象有values属性（如果是数组控件）
                if (!w.options.values) {
                    w.options.values = [];
                }
            });

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

            // 隐藏key_profile控件
            const keyWidget = node.widgets.find(w => w.name === "key_profile");
            if (keyWidget) {
                keyWidget.hidden = true;
                keyWidget.computeSize = () => [0, 0];

                // 检查节点是否已经有key_profile值
                const existingValue = keyWidget.value;
                if (existingValue && existingValue.trim() !== "") {
                    // 节点已经有值，保留它
                } else {
                    // 节点没有值，从localStorage读取
                    const raw = localStorage.getItem(storageKey);
                    const map = raw ? JSON.parse(raw) : {};
                    const stored = map[node.id];
                    if (stored) {
                        keyWidget.value = stored;
                    }
                }
            }

            // 添加API Key管理按钮
            if (!node.widgets.some(w => w.name === "API key management")) {
                node.addWidget("button", "API key management", "open", () => openKeyManager(node));
            }

            // 初始化按钮文字
            updateApiKeyButtonText(node);

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
                if (name === "provider") {
                    applyProvider(node, value);
                }
            };

            // 初始化控件可见性
            setTimeout(() => {
                applyAdvancedSettingsVisibility(node, nodeSettings.expanded);
                app.graph?.setDirtyCanvas(true, true);
            }, 50);
        };

        // 监听API Key选择变化事件
        window.addEventListener("xiser-llm-profile-changed", e => {
            const profile = (e.detail && e.detail.profile) || "";
            const nodeId = e.detail?.nodeId;
            const nodes = app?.graph?._nodes || [];
            nodes.forEach(n => {
                if (n?.comfyClass !== "XIS_VGMOrchestrator") return;
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