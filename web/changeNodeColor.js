import { app } from "/scripts/app.js";

const COLOR_CONFIG_PATH = "/extensions/ComfyUI_XISER_Nodes/xiser_color_presets.json";
const COLOR_PRESETS_ENDPOINT = "/xiser/color-presets";

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
            { id: "coral_slate", name: { en: "Coral Slate", zh: "珊瑚银灰" }, title: "#FF8A80", content: "#FDF0F0" },
            { id: "sunset_mauve", name: { en: "Sunset Mauve", zh: "暮色莓粉" }, title: "#FF9AA2", content: "#FFF0F5" },
            { id: "emerald_linen", name: { en: "Emerald Linen", zh: "翠羽素布" }, title: "#2E8B57", content: "#F0FFF0" },
            { id: "copper_dawn", name: { en: "Copper Dawn", zh: "晨曦铜光" }, title: "#A85C2D", content: "#FFF7E6" }
        ],
        dark: [
            { id: "slate_neon", name: { en: "Slate Neon", zh: "霓虹石板" }, title: "#00C2B2", content: "#111619" },
            { id: "midnight_copper", name: { en: "Midnight Copper", zh: "铜夜流光" }, title: "#B87333", content: "#1C1A17" },
            { id: "indigo_depths", name: { en: "Indigo Depths", zh: "靛蓝深海" }, title: "#2F3A60", content: "#0F1624" },
            { id: "neon_plum", name: { en: "Neon Plum", zh: "霓虹李紫" }, title: "#6C63FF", content: "#1B1D3A" },
            { id: "ember_glow", name: { en: "Ember Glow", zh: "炽焰余温" }, title: "#FF7043", content: "#1F1411" },
            { id: "arctic_teal", name: { en: "Arctic Teal", zh: "极昼青蓝" }, title: "#00C8C8", content: "#0D1F24" },
            { id: "nebula_plum", name: { en: "Nebula Plum", zh: "星云李紫" }, title: "#B03BFF", content: "#16061F" },
            { id: "teal_midnight", name: { en: "Teal Midnight", zh: "夜海青黛" }, title: "#2F8F9D", content: "#070E16" },
            { id: "crimson_moon", name: { en: "Crimson Moon", zh: "赤月幽光" }, title: "#FF3B54", content: "#211019" }
        ]
    },
    customSets: []
};

const LOCALE_TEXT = {
    en: {
        manageMenu: "XISER Node Color Manager",
        dialogTitle: "XIS Color Presets",
        selectionInfo: count => `Applying to ${count} node${count === 1 ? "" : "s"}`,
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
        titleSwatchLabel: "Title background",
        contentSwatchLabel: "Body background",
        notSetLabel: "Not set",
        presetNamePlaceholder: "Preset name (optional)"
    },
    zh: {
        manageMenu: "XISER 节点颜色管理",
        dialogTitle: "XIS 颜色组合管理",
        selectionInfo: count => `当前将应用到 ${count} 个节点`,
        saveButton: "保存组合",
        closeButton: "关闭",
        defaultSection: "预设主题配色",
        customSection: "我的配色",
        emptyCustom: "暂无自定义组合，先设置后点击“保存组合”。",
        deleteButton: "删除",
        applySetButton: "应用",
        themeSwitcherLabel: "主题风格",
        themeLight: "亮色",
        themeDark: "暗色",
        customPresetName: index => `自定义配色 ${index}`,
        colorCategoriesTitle: theme => (theme === "light" ? "自定义配色名称" : "自定义配色名称"),
        recommendedSection: theme => (theme === "light" ? "亮色主题推荐" : "暗色主题推荐"),
        recommendedEmpty: "暂未提供精选颜色。",
        titleSwatchLabel: "标题背景",
        contentSwatchLabel: "内容背景",
        notSetLabel: "未设置",
        presetNamePlaceholder: "组合名称（可选）"
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
    if (Array.isArray(externalConfig.customSets)) {
        merged.customSets = externalConfig.customSets
            .filter(set => set && (set.title || set.content))
            .map((set, index) => ({
                id: set.id || `custom-${index}`,
                name: set.name || t("customPresetName", index + 1),
                title: set.title,
                content: set.content
            }));
    } else {
        merged.customSets = merged.customSets || [];
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

async function loadSavedColorSets() {
    await loadColorConfigFromFile();
    const stored = Array.isArray(colorConfig.customSets) ? colorConfig.customSets : [];
    return stored
        .filter(set => set && (set.title || set.content))
        .map((set, index) => ({
            id: set.id || `custom-${index}`,
            name: set.name || t("customPresetName", index + 1),
            title: set.title,
            content: set.content
        }));
}

async function persistColorSets(sets) {
    try {
        const response = await fetch(COLOR_PRESETS_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ customSets: sets })
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const result = await response.json();
        if (Array.isArray(result.customSets)) {
            colorConfig.customSets = result.customSets;
            return result.customSets;
        }
        return sets;
    } catch (error) {
        console.error("[XISER] Failed to persist custom presets:", error);
        return sets;
    }
}

function getPickerColors(theme = detectActiveTheme()) {
    const themeKey = theme === "light" ? "light" : "dark";
    return (colorConfig.pickerColors?.[themeKey] || FALLBACK_COLOR_CONFIG.pickerColors[themeKey] || []).slice();
}

function getMonochromeColors(theme = detectActiveTheme()) {
    const themeKey = theme === "light" ? "light" : "dark";
    return (colorConfig.monochrome?.[themeKey] || FALLBACK_COLOR_CONFIG.monochrome[themeKey] || []).slice();
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

async function openColorSetDialog(node) {
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

    const swatchGrid = document.createElement("div");
    swatchGrid.style.display = "grid"; // 保持Grid布局（核心）
    // 关键修改：固定3列，每列宽度平均分配（1fr = 剩余空间等分）
    swatchGrid.style.gridTemplateColumns = "repeat(3, 1fr)"; 
    swatchGrid.style.gap = "12px"; // 保持列/行间距12px（避免元素拥挤）
    swatchGrid.style.flex = "1 1 0"; // 保持在Flex父容器中的自适应（可选，看整体布局）
    // 可选补充：防止元素换行（确保“单行”）
    swatchGrid.style.gridAutoFlow = "row nowrap"; 

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

    swatchGrid.appendChild(titleColorLabel);
    swatchGrid.appendChild(contentColorLabel);

    const saveButton = document.createElement("button");
    saveButton.textContent = t("saveButton");
    saveButton.style.minWidth = "140px";
    saveButton.style.padding = "8px 16px";
    saveButton.style.border = "none";
    saveButton.style.borderRadius = "4px";
    saveButton.style.cursor = "pointer";
    saveButton.style.background = buttonBg;
    saveButton.style.color = textColor;

    const swatchRow = document.createElement("div");
    swatchRow.style.display = "flex";
    swatchRow.style.alignItems = "flex-start";
    swatchRow.style.gap = "12px";
    swatchRow.style.flexWrap = "wrap";
    swatchRow.style.marginBottom = "12px";
    swatchRow.appendChild(swatchGrid);
    dialog.appendChild(swatchRow);

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
    nameInput.style.flex = "1 1 auto";
    nameInput.style.padding = "8px";
    nameInput.style.border = `1px solid ${borderColor}`;
    nameInput.style.borderRadius = "4px";
    nameInput.style.background = "transparent";
    nameInput.style.color = textColor;

    const nameRow = document.createElement("div");
    nameRow.style.display = "flex";
    nameRow.style.alignItems = "center";
    nameRow.style.gap = "8px";
    nameRow.style.marginBottom = "12px";
    nameRow.appendChild(nameInput);
    nameRow.appendChild(saveButton);
    dialog.appendChild(nameRow);

    const applyThemeDefaultsToInputs = () => {
        titleColorInput.value = getDefaultColor("titleColor", presetTheme);
        contentColorInput.value = getDefaultColor("contentColor", presetTheme);
    };

    let savedSets = [];

    const refreshSavedSets = async () => {
        savedSets = await loadSavedColorSets();
        renderCustomSets();
    };

    saveButton.addEventListener("click", async () => {
        const name = nameInput.value.trim() || t("customPresetName", savedSets.length + 1);
        const newSet = {
            id: `custom-${Date.now()}`,
            name,
            title: titleColorInput.value,
            content: contentColorInput.value,
            theme: presetTheme
        };
        savedSets.push(newSet);
        savedSets = await persistColorSets(savedSets);
        nameInput.value = "";
        renderCustomSets();
    });

    const applyCurrentColors = async () => {
        await applyColorSetToNodes(getTargetNodes(node), {
            title: titleColorInput.value,
            content: contentColorInput.value
        });
        updateSelectionInfo();
    };

    const scheduleAutoApply = () => {
        applyCurrentColors().catch(error => {
            console.error("[XISER] Auto-applying colors failed:", error);
        });
    };

    titleColorInput.addEventListener("input", scheduleAutoApply);
    contentColorInput.addEventListener("input", scheduleAutoApply);

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
    customList.style.maxHeight = "260px";
    customList.style.overflowY = "auto";
    customList.style.paddingRight = "4px";
    dialog.appendChild(customList);

    function createColorSetRow(colorSet, allowDelete) {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.alignItems = "center";
        row.style.justifyContent = "space-between";
        row.style.padding = "6px 8px";
        row.style.border = `1px solid ${borderColor}`;
        row.style.borderRadius = "6px";
        row.style.cursor = "pointer";
        row.addEventListener("click", async () => {
            await applyColorSetToNodes(getTargetNodes(node), {
                title: colorSet.title,
                content: colorSet.content
            });
            updateSelectionInfo();
        });

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
            deleteButton.addEventListener("click", async (event) => {
                event.stopPropagation();
                const index = savedSets.findIndex(set => set.id === colorSet.id);
                if (index >= 0) {
                    savedSets.splice(index, 1);
                    savedSets = await persistColorSets(savedSets);
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
    refreshSavedSets();
    document.body.appendChild(dialog);
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
                console.log("[XISER] Existing color menu found, adding XISER entry");
            }
            options.push({
                content: t("manageMenu"),
                callback: () => {
                    openColorSetDialog(node);
                },
            });
            return options;
        };
    },
});
