import { app } from "/scripts/app.js";

const COLOR_CONFIG_PATH = "/extensions/ComfyUI_XISER_Nodes/xiser_color_presets.json";
const COLOR_SET_STORAGE_KEY = "xiser_saved_color_sets_v1";

const FALLBACK_LIGHT_PICKER_COLORS = [
    "#FFF7F0", "#FFE4E0", "#FFD8E8", "#FBD9FF",
    "#EECFFF", "#DEC4FF", "#C9C5FF", "#B2D0FF",
    "#9BE0FF", "#8EF2FF", "#8CFEE8", "#9CFDD1",
    "#BAFAC0", "#D7FBC2", "#FFF6C2", "#FFE3A1",
    "#FFC07A", "#FF9860", "#FF7A7A", "#FF8BA7",
    "#FFABCC", "#FFD4EB", "#F6EEF8", "#E9F5F8",
    "#D9EEEF", "#C8E4E3", "#B6D9D6", "#A4CEC8",
    "#93C2B9", "#88B6AB", "#8CA8FF", "#A190FF",
    "#C184FF", "#E078FF", "#FF71EA", "#FF72C0",
    "#FF7F98", "#FF9C7C", "#FFBE6A", "#FFE563",
    "#C6FF70", "#9DFF97", "#7DF5C3", "#74E7EF",
    "#78C6FF", "#8AA8FF", "#B39BFF", "#E0A8FF"
];

const FALLBACK_DARK_PICKER_COLORS = [
    "#1F232B", "#262B34", "#2E323D", "#353946",
    "#3D4150", "#45485A", "#4D5064", "#55586E",
    "#0E1A2B", "#142236", "#1A2A42", "#21334D",
    "#273C58", "#2D4463", "#334C6E", "#3A5579",
    "#301F2A", "#3D1F36", "#4A1E41", "#571E4C",
    "#631F57", "#702162", "#7D2D6F", "#8B3C7C",
    "#1D2C28", "#1F3A2F", "#224836", "#25573D",
    "#276544", "#2A734B", "#2F8252", "#36905B",
    "#1F1A12", "#2C2116", "#38291B", "#453020",
    "#523825", "#60302E", "#7A2A34", "#FF5E5B",
    "#FF8C42", "#FFC857", "#2A1C1C", "#2F262D",
    "#34303E", "#394A5A", "#3E5467", "#436074"
];

const FALLBACK_LIGHT_MONO = ["#FFFFFF", "#F7F7F7", "#EFEFEF", "#E0E0E0", "#C7CBD1", "#A0A6B1"];
const FALLBACK_DARK_MONO = ["#000000", "#090B10", "#12151E", "#1C2130", "#262C3F", "#31354B"];

const FALLBACK_COLOR_CONFIG = {
    defaults: {
        common: {
            titleColor: "#4A4A4A",
            contentColor: "#1E1E1E"
        },
        light: {
            titleColor: "#E7E4DB",
            contentColor: "#FFFFFF"
        },
        dark: {
            titleColor: "#3B3B3B",
            contentColor: "#1C1C1C"
        }
    },
    pickerColors: {
        light: FALLBACK_LIGHT_PICKER_COLORS,
        dark: FALLBACK_DARK_PICKER_COLORS
    },
    monochrome: {
        light: FALLBACK_LIGHT_MONO,
        dark: FALLBACK_DARK_MONO
    },
    colorSets: {
        light: [
            { id: "pastel_sand", name: { en: "Pastel Sand", zh: "柔沙亮卡" }, title: "#F4D8C6", content: "#FFF9F2" },
            { id: "glacier_mint", name: { en: "Glacier Mint", zh: "清爽薄荷" }, title: "#D4F1E6", content: "#FFFFFF" },
            { id: "lilac_breeze", name: { en: "Lilac Breeze", zh: "淡紫微风" }, title: "#E7E0FF", content: "#FAF9FF" },
            { id: "solar_citrus", name: { en: "Solar Citrus", zh: "暖阳柑橘" }, title: "#FFB347", content: "#FFF4CC" },
            { id: "aqua_pop", name: { en: "Aqua Pop", zh: "水光薄荷" }, title: "#4FC3F7", content: "#E5FBFF" },
            { id: "coral_slate", name: { en: "Coral Slate", zh: "珊瑚银灰" }, title: "#FF8A80", content: "#FDF0F0" }
        ],
        dark: [
            { id: "slate_neon", name: { en: "Slate Neon", zh: "霓虹石板" }, title: "#00C2B2", content: "#111619" },
            { id: "midnight_copper", name: { en: "Midnight Copper", zh: "铜夜流光" }, title: "#B87333", content: "#1C1A17" },
            { id: "indigo_depths", name: { en: "Indigo Depths", zh: "靛蓝深海" }, title: "#2F3A60", content: "#0F1624" },
            { id: "neon_plum", name: { en: "Neon Plum", zh: "霓虹李紫" }, title: "#6C63FF", content: "#1B1D3A" },
            { id: "ember_glow", name: { en: "Ember Glow", zh: "炽焰余温" }, title: "#FF7043", content: "#1F1411" },
            { id: "arctic_teal", name: { en: "Arctic Teal", zh: "极昼青蓝" }, title: "#00C8C8", content: "#0D1F24" }
        ]
    }
};

const LOCALE_TEXT = {
    en: {
        colorPickerTitle: "XIS Color Picker",
        manageMenu: "XISER Node Colors",
        changeTitleBg: "Change Title Background",
        changeContentBg: "Change Body Background",
        managePresets: "Preset Manager (Batch)",
        dialogTitle: "XIS Color Presets",
        selectionInfo: count => `Applying to ${count} node${count === 1 ? "" : "s"}`,
        applyButton: "Apply to selection",
        saveButton: "Save preset",
        closeButton: "Close",
        defaultSection: "Curated presets",
        customSection: "My presets",
        emptyCustom: "No custom presets saved yet.",
        deleteButton: "Delete",
        applySetButton: "Apply",
        themeSwitcherLabel: "Preset theme",
        themeLight: "Light",
        themeDark: "Dark",
        customPresetName: index => `Custom preset ${index}`,
        colorCategoriesTitle: theme => (theme === "light" ? "Light-safe palette" : "Dark-safe palette"),
        recommendedSection: theme => (theme === "light" ? "Light theme picks" : "Dark theme picks"),
        recommendedEmpty: "No curated colors available.",
        eyeDropper: "Eyedropper",
        confirm: "Apply",
        cancel: "Cancel",
        titleSwatchLabel: "Title background",
        contentSwatchLabel: "Body background",
        notSetLabel: "Not set",
        presetNamePlaceholder: "Preset name (optional)",
        eyeDropperUnsupported: "Eyedropper API is not available in this browser. Please use Chrome or Edge."
    },
    zh: {
        colorPickerTitle: "XIS 节点颜色选择器",
        manageMenu: "XISER 节点颜色",
        changeTitleBg: "更改标题背景",
        changeContentBg: "更改内容背景",
        managePresets: "管理颜色组合（批量）",
        dialogTitle: "XIS 颜色组合管理",
        selectionInfo: count => `当前将应用到 ${count} 个节点`,
        applyButton: "应用到选中节点",
        saveButton: "保存组合",
        closeButton: "关闭",
        defaultSection: "默认配色",
        customSection: "我的配色",
        emptyCustom: "暂无自定义组合，先设置后点击“保存组合”。",
        deleteButton: "删除",
        applySetButton: "应用",
        themeSwitcherLabel: "预设主题",
        themeLight: "亮色",
        themeDark: "暗色",
        customPresetName: index => `自定义配色 ${index}`,
        colorCategoriesTitle: theme => (theme === "light" ? "亮色配色建议" : "暗色配色建议"),
        recommendedSection: theme => (theme === "light" ? "亮色主题推荐" : "暗色主题推荐"),
        recommendedEmpty: "暂未提供精选颜色。",
        eyeDropper: "吸管",
        confirm: "确认",
        cancel: "取消",
        titleSwatchLabel: "标题背景",
        contentSwatchLabel: "内容背景",
        notSetLabel: "未设置",
        presetNamePlaceholder: "组合名称（可选）",
        eyeDropperUnsupported: "浏览器不支持吸管功能，请使用现代浏览器（Chrome/Edge）。"
    }
};

function getLocale() {
    try {
        const comfyLocale = app?.ui?.settings?.getSettingValue?.("Comfy.Locale");
        if (typeof comfyLocale === "string" && comfyLocale.trim()) {
            return comfyLocale.toLowerCase();
        }
    } catch (error) {
        console.warn("[XISER] Unable to read Comfy locale from settings:", error);
    }
    const stored = localStorage?.getItem("Comfy.Locale");
    if (stored) return stored.toLowerCase();
    const nav = navigator?.language?.split("-")[0];
    return (nav || "en").toLowerCase();
}

function t(key, ...params) {
    const locale = getLocale();
    const bundle = LOCALE_TEXT[locale] || LOCALE_TEXT.en;
    const raw = (bundle[key] !== undefined ? bundle[key] : LOCALE_TEXT.en[key]) || key;
    return typeof raw === "function" ? raw(...params) : raw;
}

function resolveLabel(label) {
    const locale = getLocale();
    if (!label) return "";
    if (typeof label === "string") return label;
    if (typeof label === "object") {
        return label[locale] || label.en || Object.values(label)[0] || "";
    }
    return String(label);
}

function detectActiveTheme() {
    return document.body.classList.contains("dark-theme") ? "dark" : "light";
}

function makeDialogDraggable(dialog, handle) {
    if (!dialog || !handle) return () => {};
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    const onMouseDown = (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        isDragging = true;
        const rect = dialog.getBoundingClientRect();
        dialog.style.left = `${rect.left}px`;
        dialog.style.top = `${rect.top}px`;
        dialog.style.transform = "none";
        startX = event.clientX;
        startY = event.clientY;
        initialLeft = rect.left;
        initialTop = rect.top;
        document.body.classList.add("xiser-dialog-dragging");
    };

    const onMouseMove = (event) => {
        if (!isDragging) return;
        const deltaX = event.clientX - startX;
        const deltaY = event.clientY - startY;
        dialog.style.left = `${initialLeft + deltaX}px`;
        dialog.style.top = `${initialTop + deltaY}px`;
    };

    const endDrag = () => {
        if (!isDragging) return;
        isDragging = false;
        document.body.classList.remove("xiser-dialog-dragging");
    };

    handle.style.cursor = "move";
    handle.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", endDrag);

    return () => {
        handle.removeEventListener("mousedown", onMouseDown);
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", endDrag);
        document.body.classList.remove("xiser-dialog-dragging");
    };
}

let colorConfig = deepClone(FALLBACK_COLOR_CONFIG);

function deepClone(obj) {
    try {
        return structuredClone(obj);
    } catch (error) {
        return JSON.parse(JSON.stringify(obj));
    }
}

function mergeColorConfig(externalConfig) {
    const merged = deepClone(FALLBACK_COLOR_CONFIG);
    if (!externalConfig || typeof externalConfig !== "object") {
        return merged;
    }
    if (externalConfig.defaults && typeof externalConfig.defaults === "object") {
        merged.defaults = {
            ...merged.defaults,
            common: {
                ...(merged.defaults?.common || {}),
                ...(externalConfig.defaults?.common || {})
            },
            light: {
                ...(merged.defaults?.light || {}),
                ...(externalConfig.defaults?.light || {})
            },
            dark: {
                ...(merged.defaults?.dark || {}),
                ...(externalConfig.defaults?.dark || {})
            }
        };
    }
    if (externalConfig.pickerColors && typeof externalConfig.pickerColors === "object") {
        merged.pickerColors = {
            light: Array.isArray(externalConfig.pickerColors.light) && externalConfig.pickerColors.light.length
                ? externalConfig.pickerColors.light
                : merged.pickerColors.light,
            dark: Array.isArray(externalConfig.pickerColors.dark) && externalConfig.pickerColors.dark.length
                ? externalConfig.pickerColors.dark
                : merged.pickerColors.dark
        };
    }
    if (externalConfig.monochrome && typeof externalConfig.monochrome === "object") {
        merged.monochrome = {
            light: Array.isArray(externalConfig.monochrome.light) && externalConfig.monochrome.light.length
                ? externalConfig.monochrome.light
                : merged.monochrome.light,
            dark: Array.isArray(externalConfig.monochrome.dark) && externalConfig.monochrome.dark.length
                ? externalConfig.monochrome.dark
                : merged.monochrome.dark
        };
    }
    if (externalConfig.colorSets && typeof externalConfig.colorSets === "object") {
        merged.colorSets = merged.colorSets || {};
        Object.entries(externalConfig.colorSets).forEach(([theme, sets]) => {
            if (!Array.isArray(sets)) return;
            merged.colorSets[theme] = sets
                .filter(set => set && (set.title || set.content))
                .map((set, index) => ({
                    id: set.id || `${theme}-preset-${index}`,
                    name: set.name || { en: `Preset ${index + 1}` },
                    title: set.title,
                    content: set.content
                }));
        });
    } else if (Array.isArray(externalConfig.colorSets)) {
        merged.colorSets = {
            light: externalConfig.colorSets
                .filter(set => set && (set.title || set.content))
                .map((set, index) => ({
                    id: set.id || `legacy-light-${index}`,
                    name: set.name || { en: `Preset ${index + 1}` },
                    title: set.title,
                    content: set.content
                }))
        };
    }
    return merged;
}

async function loadColorConfigFromFile() {
    try {
        const response = await fetch(`${COLOR_CONFIG_PATH}?_=${Date.now()}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        colorConfig = mergeColorConfig(data);
        console.log("[XISER] Custom color presets loaded");
    } catch (error) {
        console.warn("[XISER] Failed to load custom presets, falling back to built-ins:", error);
    }
}

loadColorConfigFromFile();

function getBuiltinColorSets(theme = detectActiveTheme()) {
    const themeKey = theme === "light" ? "light" : "dark";
    const sets =
        colorConfig.colorSets?.[themeKey] ||
        FALLBACK_COLOR_CONFIG.colorSets?.[themeKey] ||
        [];
    return sets.map((set, index) => ({
        id: set.id || `${themeKey}-preset-${index}`,
        name: resolveLabel(set.name) || set.name || `Preset ${index + 1}`,
        title: set.title,
        content: set.content
    }));
}

function getDefaultColor(key, theme = detectActiveTheme()) {
    const themed = colorConfig.defaults?.[theme]?.[key];
    if (themed) return themed;
    const common = colorConfig.defaults?.common?.[key];
    if (common) return common;
    const fallbackThemed = FALLBACK_COLOR_CONFIG.defaults?.[theme]?.[key];
    if (fallbackThemed) return fallbackThemed;
    const fallbackCommon = FALLBACK_COLOR_CONFIG.defaults?.common?.[key];
    return fallbackCommon || "#000000";
}

function loadSavedColorSets() {
    try {
        const stored = localStorage.getItem(COLOR_SET_STORAGE_KEY);
        const parsed = stored ? JSON.parse(stored) : [];
        if (Array.isArray(parsed)) {
            return parsed
                .filter(set => set && (set.title || set.content))
                .map((set, index) => ({
                    id: set.id || `custom-${index}`,
                    name: set.name || t("customPresetName", index + 1),
                    title: set.title,
                    content: set.content
                }));
        }
    } catch (error) {
        console.warn("[XISER] Failed to read saved presets:", error);
    }
    return [];
}

function getPickerColors(theme = detectActiveTheme()) {
    const themeKey = theme === "light" ? "light" : "dark";
    return (colorConfig.pickerColors?.[themeKey] || FALLBACK_COLOR_CONFIG.pickerColors[themeKey] || []).slice();
}

function getMonochromeColors(theme = detectActiveTheme()) {
    const themeKey = theme === "light" ? "light" : "dark";
    return (colorConfig.monochrome?.[themeKey] || FALLBACK_COLOR_CONFIG.monochrome[themeKey] || []).slice();
}

function saveColorSets(sets) {
    try {
        localStorage.setItem(COLOR_SET_STORAGE_KEY, JSON.stringify(sets));
    } catch (error) {
        console.warn("[XISER] Failed to persist color presets:", error);
    }
}

function getTargetNodes(node) {
    const canvas = app?.canvas;
    if (!canvas) {
        return [node];
    }
    const selectedNodes = canvas.selected_nodes || {};
    const selectedCount = Object.keys(selectedNodes).length;
    if (selectedCount > 1 && selectedNodes[node?.id]) {
        return Object.values(selectedNodes).filter(Boolean);
    }
    if (selectedCount === 1 && selectedNodes[node?.id]) {
        return [node];
    }
    return [node];
}

function updateNodeColorProperties(node, color, colorType) {
    node.properties = node.properties || {};
    if (colorType === "title") {
        node.properties["xiser_title_color"] = color;
        node.color = color;
    } else {
        node.properties["xiser_content_color"] = color;
        node.bgcolor = color;
    }
}

async function notifyServerAboutColor(node, color, colorType) {
    const message = {
        node_id: node.id,
        color: color,
        color_type: colorType
    };
    console.log("[XISER] Sending color update:", message);
    try {
        const response = await fetch("/xiser_color", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(message)
        });
        const result = await response.json();
        if (result.type !== "xiser_node_color_change_response") {
            console.error("[XISER] Unexpected server response:", result);
        }
    } catch (error) {
        console.error(`[XISER] Failed to update node ${node.id} color:`, error);
    }
}

async function applyColorToNodes(nodes, color, colorType) {
    if (!nodes.length) return;
    nodes.forEach(target => updateNodeColorProperties(target, color, colorType));
    app.canvas?.setDirty(true);
    await Promise.all(nodes.map(target => notifyServerAboutColor(target, color, colorType)));
    console.log(`[XISER] Applied ${colorType} color ${color} to ${nodes.length} node(s)`);
}

async function applyColorSetToNodes(nodes, colorSet) {
    const tasks = [];
    if (colorSet.title) {
        tasks.push(applyColorToNodes(nodes, colorSet.title, "title"));
    }
    if (colorSet.content) {
        tasks.push(applyColorToNodes(nodes, colorSet.content, "content"));
    }
    await Promise.all(tasks);
}

function hydrateNodeAppearance(node) {
    if (!node) return;
    if (node?.properties?.xiser_title_color) {
        node.color = node.properties.xiser_title_color;
    }
    if (node?.properties?.xiser_content_color) {
        node.bgcolor = node.properties.xiser_content_color;
    }
}

function createColorPickerDialog(colorType = "title", callback, currentColor = null) {
    const isDarkTheme = document.body.classList.contains("dark-theme");
    const backgroundColor = isDarkTheme ? "#2E2E2E" : "#FFFFFF";
    const textColor = isDarkTheme ? "#FFFFFF" : "#333333";
    const borderColor = isDarkTheme ? "#444444" : "#CCCCCC";
    let paletteTheme = detectActiveTheme();

    const dialog = document.createElement("div");
    dialog.style.position = "fixed";
    dialog.style.top = "50%";
    dialog.style.left = "50%";
    dialog.style.transform = "translate(-50%, -50%)";
    dialog.style.background = backgroundColor;
    dialog.style.padding = "16px 16px 12px 16px";
    dialog.style.borderRadius = "8px";
    dialog.style.boxShadow = "0 4px 8px rgba(0,0,0,0.5)";
    dialog.style.zIndex = "10000";
    dialog.style.color = textColor;
    dialog.style.fontFamily = "Arial, sans-serif";
    dialog.style.width = "500px";
    dialog.style.maxHeight = "900px";
    dialog.style.overflowY = "auto";
    dialog.style.boxSizing = "border-box";

    const title = document.createElement("h3");
    title.textContent = t("colorPickerTitle");
    title.style.margin = "0 0 10px";
    title.style.fontSize = "16px";
    dialog.appendChild(title);
    const detachDrag = makeDialogDraggable(dialog, title);
    const removeDialog = () => {
        detachDrag();
        if (dialog.parentNode) {
            dialog.parentNode.removeChild(dialog);
        }
    };

    const closeIcon = document.createElement("button");
    closeIcon.innerHTML = "&times;";
    closeIcon.setAttribute("aria-label", t("closeButton"));
    closeIcon.style.position = "absolute";
    closeIcon.style.top = "8px";
    closeIcon.style.right = "10px";
    closeIcon.style.border = "none";
    closeIcon.style.background = "transparent";
    closeIcon.style.color = textColor;
    closeIcon.style.fontSize = "20px";
    closeIcon.style.cursor = "pointer";
    closeIcon.addEventListener("click", removeDialog);
    dialog.appendChild(closeIcon);

    // 当前颜色显示 - 使用标准颜色输入框
    const currentColorSection = document.createElement("div");
    currentColorSection.style.display = "flex";
    currentColorSection.style.alignItems = "center";
    currentColorSection.style.justifyContent = "space-between";
    currentColorSection.style.marginBottom = "12px";
    currentColorSection.style.padding = "8px";
    currentColorSection.style.border = `1px solid ${borderColor}`;
    currentColorSection.style.borderRadius = "6px";
    currentColorSection.style.background = isDarkTheme ? "#1E1E1E" : "#F8F8F8";

    const currentColorLabel = document.createElement("span");
    currentColorLabel.textContent = colorType === "title" ? t("titleSwatchLabel") : t("contentSwatchLabel");
    currentColorLabel.style.fontSize = "13px";
    currentColorLabel.style.fontWeight = "bold";

    // 使用标准的颜色输入框
    const currentColorInput = document.createElement("input");
    currentColorInput.type = "color";
    currentColorInput.value = currentColor || "#000000";
    currentColorInput.style.width = "40px";
    currentColorInput.style.height = "40px";
    currentColorInput.style.borderRadius = "6px";
    currentColorInput.style.border = `2px solid ${borderColor}`;
    currentColorInput.style.cursor = "pointer";

    // 监听颜色变化
    currentColorInput.addEventListener("change", () => {
        const newColor = currentColorInput.value;
        callback(newColor);
    });

    currentColorSection.appendChild(currentColorLabel);
    currentColorSection.appendChild(currentColorInput);
    dialog.appendChild(currentColorSection);

    const themeRow = document.createElement("div");
    themeRow.style.display = "flex";
    themeRow.style.alignItems = "center";
    themeRow.style.justifyContent = "space-between";
    themeRow.style.margin = "4px 0 8px";

    const themeLabel = document.createElement("span");
    themeLabel.textContent = t("themeSwitcherLabel");
    themeLabel.style.fontSize = "12px";
    themeLabel.style.opacity = "0.75";
    themeRow.appendChild(themeLabel);

    const themeButtonsWrapper = document.createElement("div");
    themeButtonsWrapper.style.display = "flex";
    themeButtonsWrapper.style.gap = "6px";

    const createThemeButton = (themeKey, label) => {
        const btn = document.createElement("button");
        btn.textContent = label;
        btn.style.padding = "4px 10px";
        btn.style.borderRadius = "6px";
        btn.style.border = `1px solid ${borderColor}`;
        btn.style.background = "transparent";
        btn.style.color = textColor;
        btn.style.cursor = "pointer";
        btn.addEventListener("click", () => {
            if (paletteTheme === themeKey) return;
            paletteTheme = themeKey;
            syncThemeButtons();
            recommendedTitle.textContent = t("recommendedSection", paletteTheme);
            renderRecommended();
        });
        return btn;
    };

    const lightButton = createThemeButton("light", t("themeLight"));
    const darkButton = createThemeButton("dark", t("themeDark"));

    function syncThemeButtons() {
        [lightButton, darkButton].forEach(btn => {
            const isActive = (btn === lightButton && paletteTheme === "light") || (btn === darkButton && paletteTheme === "dark");
            btn.style.background = isActive ? (isDarkTheme ? "#3C5A78" : "#E0ECFF") : "transparent";
            btn.style.borderColor = isActive ? (isDarkTheme ? "#5DA0FF" : "#5C8DFF") : borderColor;
        });
    }
    syncThemeButtons();

    themeButtonsWrapper.appendChild(lightButton);
    themeButtonsWrapper.appendChild(darkButton);
    themeRow.appendChild(themeButtonsWrapper);
    dialog.appendChild(themeRow);

    const recommendedWrapper = document.createElement("div");
    recommendedWrapper.style.margin = "8px 0 16px";
    recommendedWrapper.style.border = `1px dashed ${borderColor}`;
    recommendedWrapper.style.borderRadius = "6px";
    recommendedWrapper.style.padding = "8px";

    const recommendedTitle = document.createElement("div");
    recommendedTitle.textContent = t("recommendedSection", paletteTheme);
    recommendedTitle.style.fontSize = "12px";
    recommendedTitle.style.opacity = "0.85";
    recommendedTitle.style.marginBottom = "6px";
    recommendedWrapper.appendChild(recommendedTitle);

    const recommendedList = document.createElement("div");
    recommendedList.style.display = "flex";
    recommendedList.style.flexWrap = "wrap";
    recommendedList.style.gap = "6px";
    recommendedWrapper.appendChild(recommendedList);
    dialog.appendChild(recommendedWrapper);

    const createSwatchButton = (color, titleText, size = 28) => {
        const swatch = document.createElement("button");
        swatch.style.width = `${size}px`;
        swatch.style.height = `${size}px`;
        swatch.style.borderRadius = "6px";
        swatch.style.border = `1px solid ${borderColor}`;
        swatch.style.background = color;
        swatch.style.cursor = "pointer";
        swatch.title = titleText || color;
        swatch.addEventListener("click", () => {
            callback(color);
            // 同步更新当前颜色输入框的值
            currentColorInput.value = color;
        });
        return swatch;
    };

    function renderRecommended() {
        recommendedList.innerHTML = "";
        const seen = new Set();
        const presetSets = getBuiltinColorSets(paletteTheme);
        presetSets.forEach(set => {
            const value = colorType === "content" ? set.content : set.title;
            if (!value || seen.has(value)) return;
            seen.add(value);
            recommendedList.appendChild(
                createSwatchButton(value, `${resolveLabel(set.name)} · ${value}`)
            );
        });

        const paletteColors = getPickerColors(paletteTheme);
        paletteColors.forEach(color => {
            if (seen.has(color)) return;
            seen.add(color);
            recommendedList.appendChild(createSwatchButton(color));
        });

        const monoColors = getMonochromeColors(paletteTheme);
        monoColors.forEach(color => {
            if (seen.has(color)) return;
            seen.add(color);
            recommendedList.appendChild(createSwatchButton(color, color, 32));
        });

        if (!recommendedList.childElementCount) {
            const empty = document.createElement("div");
            empty.textContent = t("recommendedEmpty");
            empty.style.fontSize = "12px";
            empty.style.opacity = "0.7";
            recommendedList.appendChild(empty);
        }
    }
    renderRecommended();


    document.body.appendChild(dialog);
}

function openColorSetDialog(node) {
    const isDarkTheme = document.body.classList.contains("dark-theme");
    const backgroundColor = isDarkTheme ? "#2E2E2E" : "#FFFFFF";
    const textColor = isDarkTheme ? "#FFFFFF" : "#333333";
    const borderColor = isDarkTheme ? "#444444" : "#CCCCCC";
    const buttonBg = isDarkTheme ? "#555555" : "#E0E0E0";
    let presetTheme = detectActiveTheme();

    const dialog = document.createElement("div");
    dialog.style.position = "fixed";
    dialog.style.top = "50%";
    dialog.style.left = "50%";
    dialog.style.transform = "translate(-50%, -50%)";
    dialog.style.background = backgroundColor;
    dialog.style.padding = "16px";
    dialog.style.borderRadius = "10px";
    dialog.style.boxShadow = "0 8px 24px rgba(0,0,0,0.45)";
    dialog.style.zIndex = "10000";
    dialog.style.color = textColor;
    dialog.style.fontFamily = "Arial, sans-serif";
    dialog.style.width = "480px";
    dialog.style.maxHeight = "80vh";
    dialog.style.overflowY = "auto";
    let detachDrag = () => {};
    const closeDialog = () => {
        detachDrag();
        if (dialog.parentNode) {
            dialog.parentNode.removeChild(dialog);
        }
    };

    const title = document.createElement("h3");
    title.textContent = t("dialogTitle");
    title.style.margin = "0 0 10px";
    dialog.appendChild(title);
    detachDrag = makeDialogDraggable(dialog, title);

    const closeIcon = document.createElement("button");
    closeIcon.innerHTML = "&times;";
    closeIcon.setAttribute("aria-label", t("closeButton"));
    closeIcon.style.position = "absolute";
    closeIcon.style.top = "8px";
    closeIcon.style.right = "10px";
    closeIcon.style.border = "none";
    closeIcon.style.background = "transparent";
    closeIcon.style.color = textColor;
    closeIcon.style.fontSize = "20px";
    closeIcon.style.cursor = "pointer";
    closeIcon.addEventListener("click", closeDialog);
    dialog.appendChild(closeIcon);

    const selectionInfo = document.createElement("div");
    selectionInfo.style.fontSize = "13px";
    selectionInfo.style.marginBottom = "10px";
    const updateSelectionInfo = () => {
        const count = getTargetNodes(node).length;
        selectionInfo.textContent = t("selectionInfo", count);
    };
    updateSelectionInfo();
    dialog.appendChild(selectionInfo);

    const themeRow = document.createElement("div");
    themeRow.style.display = "flex";
    themeRow.style.alignItems = "center";
    themeRow.style.justifyContent = "space-between";
    themeRow.style.marginBottom = "10px";

    const themeLabel = document.createElement("span");
    themeLabel.textContent = t("themeSwitcherLabel");
    themeLabel.style.fontSize = "12px";
    themeLabel.style.opacity = "0.75";
    themeRow.appendChild(themeLabel);

    const themeButtonsWrapper = document.createElement("div");
    themeButtonsWrapper.style.display = "flex";
    themeButtonsWrapper.style.gap = "6px";

    const createThemeButton = (themeKey, label) => {
        const btn = document.createElement("button");
        btn.textContent = label;
        btn.style.padding = "4px 10px";
        btn.style.borderRadius = "6px";
        btn.style.border = `1px solid ${borderColor}`;
        btn.style.background = "transparent";
        btn.style.color = textColor;
        btn.style.cursor = "pointer";
        btn.addEventListener("click", () => {
            if (presetTheme === themeKey) {
                return;
            }
            presetTheme = themeKey;
            syncThemeButtons();
            paletteHint.textContent = t("colorCategoriesTitle", presetTheme);
            applyThemeDefaultsToInputs();
            renderDefaultSets();
        });
        return btn;
    };

    const lightButton = createThemeButton("light", t("themeLight"));
    const darkButton = createThemeButton("dark", t("themeDark"));

    function syncThemeButtons() {
        [lightButton, darkButton].forEach(btn => {
            const isActive = (btn === lightButton && presetTheme === "light") || (btn === darkButton && presetTheme === "dark");
            btn.style.background = isActive ? (isDarkTheme ? "#3C5A78" : "#E0ECFF") : "transparent";
            btn.style.borderColor = isActive ? (isDarkTheme ? "#5DA0FF" : "#5C8DFF") : borderColor;
        });
    }
    syncThemeButtons();

    themeButtonsWrapper.appendChild(lightButton);
    themeButtonsWrapper.appendChild(darkButton);
    themeRow.appendChild(themeButtonsWrapper);
    dialog.appendChild(themeRow);

    const formContainer = document.createElement("div");
    formContainer.style.display = "grid";
    formContainer.style.gridTemplateColumns = "repeat(auto-fit, minmax(180px, 1fr))";
    formContainer.style.gap = "12px";
    formContainer.style.marginBottom = "12px";

    const titleColorLabel = document.createElement("label");
    titleColorLabel.style.fontSize = "13px";
    titleColorLabel.textContent = t("titleSwatchLabel");
    const titleColorInput = document.createElement("input");
    titleColorInput.type = "color";
    titleColorInput.value = node.properties?.xiser_title_color || node.color || getDefaultColor("titleColor", presetTheme);
    titleColorInput.style.width = "100%";
    titleColorInput.style.height = "38px";
    titleColorLabel.appendChild(titleColorInput);

    const contentColorLabel = document.createElement("label");
    contentColorLabel.style.fontSize = "13px";
    contentColorLabel.textContent = t("contentSwatchLabel");
    const contentColorInput = document.createElement("input");
    contentColorInput.type = "color";
    contentColorInput.value = node.properties?.xiser_content_color || node.bgcolor || getDefaultColor("contentColor", presetTheme);
    contentColorInput.style.width = "100%";
    contentColorInput.style.height = "38px";
    contentColorLabel.appendChild(contentColorInput);

    formContainer.appendChild(titleColorLabel);
    formContainer.appendChild(contentColorLabel);
    dialog.appendChild(formContainer);

    const paletteHint = document.createElement("div");
    paletteHint.style.fontSize = "12px";
    paletteHint.style.opacity = "0.75";
    paletteHint.style.marginBottom = "8px";
    paletteHint.textContent = t("colorCategoriesTitle", presetTheme);
    dialog.appendChild(paletteHint);

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = t("presetNamePlaceholder");
    nameInput.style.width = "100%";
    nameInput.style.padding = "8px";
    nameInput.style.marginBottom = "12px";
    nameInput.style.border = `1px solid ${borderColor}`;
    nameInput.style.borderRadius = "4px";
    nameInput.style.background = "transparent";
    nameInput.style.color = textColor;
    dialog.appendChild(nameInput);

    const applyThemeDefaultsToInputs = () => {
        titleColorInput.value = getDefaultColor("titleColor", presetTheme);
        contentColorInput.value = getDefaultColor("contentColor", presetTheme);
    };

    const buttonRow = document.createElement("div");
    buttonRow.style.display = "flex";
    buttonRow.style.flexWrap = "wrap";
    buttonRow.style.gap = "8px";
    buttonRow.style.marginBottom = "16px";

    const applyButton = document.createElement("button");
    applyButton.textContent = t("applyButton");
    applyButton.style.flex = "1 1 140px";
    applyButton.style.padding = "8px";
    applyButton.style.border = "none";
    applyButton.style.borderRadius = "4px";
    applyButton.style.cursor = "pointer";
    applyButton.style.background = "#4CAF50";
    applyButton.style.color = "#FFFFFF";
    applyButton.addEventListener("click", async () => {
        await applyColorSetToNodes(getTargetNodes(node), {
            title: titleColorInput.value,
            content: contentColorInput.value
        });
        updateSelectionInfo();
    });

    const saveButton = document.createElement("button");
    saveButton.textContent = t("saveButton");
    saveButton.style.flex = "1 1 120px";
    saveButton.style.padding = "8px";
    saveButton.style.border = "none";
    saveButton.style.borderRadius = "4px";
    saveButton.style.cursor = "pointer";
    saveButton.style.background = buttonBg;
    saveButton.style.color = textColor;

    const savedSets = loadSavedColorSets();

    saveButton.addEventListener("click", () => {
        const name = nameInput.value.trim() || t("customPresetName", savedSets.length + 1);
        const newSet = {
            id: `custom-${Date.now()}`,
            name,
            title: titleColorInput.value,
            content: contentColorInput.value
        };
        savedSets.push(newSet);
        saveColorSets(savedSets);
        nameInput.value = "";
        renderCustomSets();
    });

    buttonRow.appendChild(applyButton);
    buttonRow.appendChild(saveButton);
    dialog.appendChild(buttonRow);

    const defaultSectionTitle = document.createElement("h4");
    defaultSectionTitle.textContent = `${t("defaultSection")} · ${presetTheme === "light" ? t("themeLight") : t("themeDark")}`;
    defaultSectionTitle.style.margin = "8px 0 4px";
    defaultSectionTitle.style.fontSize = "14px";
    dialog.appendChild(defaultSectionTitle);

    const defaultList = document.createElement("div");
    defaultList.style.display = "grid";
    defaultList.style.gridTemplateColumns = "repeat(auto-fill, minmax(140px, 1fr))";
    defaultList.style.gap = "6px";
    dialog.appendChild(defaultList);

    const customSectionTitle = document.createElement("h4");
    customSectionTitle.textContent = t("customSection");
    customSectionTitle.style.margin = "12px 0 4px";
    customSectionTitle.style.fontSize = "14px";
    dialog.appendChild(customSectionTitle);

    const customList = document.createElement("div");
    customList.style.display = "flex";
    customList.style.flexDirection = "column";
    customList.style.gap = "4px";
    dialog.appendChild(customList);

    function createColorSetRow(colorSet, allowDelete) {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.alignItems = "center";
        row.style.justifyContent = "space-between";
        row.style.padding = "6px 8px";
        row.style.border = `1px solid ${borderColor}`;
        row.style.borderRadius = "6px";
        row.style.cursor = allowDelete ? "default" : "pointer";
        if (!allowDelete) {
            row.addEventListener("click", async () => {
                await applyColorSetToNodes(getTargetNodes(node), {
                    title: colorSet.title,
                    content: colorSet.content
                });
                updateSelectionInfo();
            });
        }

        const info = document.createElement("div");
        info.style.display = "flex";
        info.style.alignItems = "center";
        info.style.gap = "8px";

        const swatches = document.createElement("div");
        swatches.style.display = "flex";
        swatches.style.gap = "4px";

        const titleSwatch = document.createElement("div");
        titleSwatch.style.width = "22px";
        titleSwatch.style.height = "22px";
        titleSwatch.style.borderRadius = "4px";
        titleSwatch.style.background = colorSet.title || "transparent";
        titleSwatch.style.border = `1px solid ${borderColor}`;
        const titleLabel = t("titleSwatchLabel");
        const contentLabel = t("contentSwatchLabel");
        const notSetLabel = t("notSetLabel");

        titleSwatch.title = `${titleLabel}: ${colorSet.title || notSetLabel}`;
        swatches.appendChild(titleSwatch);

        const contentSwatch = document.createElement("div");
        contentSwatch.style.width = "22px";
        contentSwatch.style.height = "22px";
        contentSwatch.style.borderRadius = "4px";
        contentSwatch.style.background = colorSet.content || "transparent";
        contentSwatch.style.border = `1px solid ${borderColor}`;
        contentSwatch.title = `${contentLabel}: ${colorSet.content || notSetLabel}`;
        swatches.appendChild(contentSwatch);

        const name = document.createElement("span");
        name.textContent = colorSet.name;
        name.style.fontSize = "13px";

        info.appendChild(swatches);
        info.appendChild(name);

        const actionRow = document.createElement("div");
        actionRow.style.display = "flex";
        actionRow.style.gap = "4px";

        if (allowDelete) {
            const deleteButton = document.createElement("button");
            deleteButton.textContent = t("deleteButton");
            deleteButton.style.padding = "6px 8px";
            deleteButton.style.border = `1px solid ${borderColor}`;
            deleteButton.style.borderRadius = "4px";
            deleteButton.style.cursor = "pointer";
            deleteButton.style.background = "transparent";
            deleteButton.style.color = textColor;
            deleteButton.addEventListener("click", () => {
                const index = savedSets.findIndex(set => set.id === colorSet.id);
                if (index >= 0) {
                    savedSets.splice(index, 1);
                    saveColorSets(savedSets);
                    renderCustomSets();
                }
            });
            actionRow.appendChild(deleteButton);
        }

        row.appendChild(info);
        row.appendChild(actionRow);
        return row;
    }

    function renderDefaultSets() {
        defaultList.innerHTML = "";
        const sets = getBuiltinColorSets(presetTheme);
        defaultSectionTitle.textContent = `${t("defaultSection")} · ${presetTheme === "light" ? t("themeLight") : t("themeDark")}`;
        if (!sets.length) {
            const empty = document.createElement("div");
            empty.textContent = t("emptyCustom");
            empty.style.fontSize = "12px";
            empty.style.opacity = "0.7";
            defaultList.appendChild(empty);
            return;
        }
        sets.forEach(set => defaultList.appendChild(createColorSetRow(set, false)));
    }

    function renderCustomSets() {
        customList.innerHTML = "";
        if (!savedSets.length) {
            const empty = document.createElement("div");
            empty.textContent = t("emptyCustom");
            empty.style.fontSize = "12px";
            empty.style.opacity = "0.7";
            customList.appendChild(empty);
            return;
        }
        savedSets.forEach(set => customList.appendChild(createColorSetRow(set, true)));
    }

    renderDefaultSets();
    renderCustomSets();
    document.body.appendChild(dialog);
}

function buildColorMenuOptions(node) {
    return [
        {
            content: t("changeTitleBg"),
            callback: () => {
                return new Promise((resolve) => {
                    createColorPickerDialog("title", async (color) => {
                        await applyColorToNodes(getTargetNodes(node), color, "title");
                        resolve();
                    }, node.color || getDefaultColor("titleColor"));
                });
            }
        },
        {
            content: t("changeContentBg"),
            callback: () => {
                return new Promise((resolve) => {
                    createColorPickerDialog("content", async (color) => {
                        await applyColorToNodes(getTargetNodes(node), color, "content");
                        resolve();
                    }, node.bgcolor || getDefaultColor("contentColor"));
                });
            }
        },
        {
            content: t("managePresets"),
            callback: () => {
                openColorSetDialog(node);
            }
        }
    ];
}

app.registerExtension({
    name: "XISER.ChangeNodeColor",
    async setup() {
        const existingExtensions = app.extensions.map(ext => ext.name);
        if (existingExtensions.some(name => name.includes("ChangeNodeColor") && name !== "XISER.ChangeNodeColor")) {
            console.warn("[XISER] Another color extension detected, there may be conflicts");
        }

        if (app.graph) {
            const hydrateAllNodes = () => {
                const nodes = app.graph?._nodes || app.graph?.nodes || [];
                if (Array.isArray(nodes)) {
                    nodes.forEach(hydrateNodeAppearance);
                }
            };

            const originalOnNodeAdded = app.graph.onNodeAdded;
            app.graph.onNodeAdded = function (node) {
                hydrateNodeAppearance(node);
                if (typeof originalOnNodeAdded === "function") {
                    return originalOnNodeAdded.apply(this, arguments);
                }
            };

            hydrateAllNodes();
        }

        const getNodeMenuOptions = app.canvas.getNodeMenuOptions;
        app.canvas.getNodeMenuOptions = function (node) {
            const options = getNodeMenuOptions.call(this, node);
            const hasColorMenu = options.some(opt => typeof opt?.content === "string" && opt.content.includes("XISER"));
            if (hasColorMenu) {
                console.log("[XISER] Existing color menu found, adding XISER submenu");
            }
            options.push({
                content: t("manageMenu"),
                has_submenu: true,
                submenu: {
                    options: buildColorMenuOptions(node),
                },
            });
            return options;
        };
    },
});
