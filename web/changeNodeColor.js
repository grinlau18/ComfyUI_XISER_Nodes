import { app } from "/scripts/app.js";

// 现代预设颜色 - 柔和舒适的色彩选择
const PRESET_COLORS = [
    // 红色系 (柔和的红橙到酒红)
    "#FF8A65", "#FF7043", "#FF5722", "#F4511E", "#E64A19", "#D84315",
    "#C62828", "#B71C1C", "#A21212", "#8D0000", "#781414", "#631F1F",

    // 棕色系 (温暖的棕褐色到深咖啡)
    "#BCAAA4", "#A1887F", "#8D6E63", "#795548", "#6D4C41", "#5D4037",
    "#8B4513", "#7A3D10", "#69350D", "#582D0A", "#472507", "#361D04",

    // 绿色系 (柔和的黄绿到深橄榄)
    "#AED581", "#9CCC65", "#8BC34A", "#7CB342", "#689F38", "#558B2F",
    "#4CAF50", "#43A047", "#388E3C", "#2E7D32", "#1B5E20", "#0D4D16",

    // 蓝色系 (柔和的天空蓝到深海军)
    "#81D4FA", "#4FC3F7", "#29B6F6", "#03A9F4", "#039BE5", "#0288D1",
    "#1976D2", "#1565C0", "#0D47A1", "#083D8C", "#063377", "#042962",

    // 紫红色系 (柔和的粉红到深紫红)
    "#F8BBD0", "#F48FB1", "#F06292", "#EC407A", "#E91E63", "#D81B60",
    "#C2185B", "#AD1457", "#880E4F", "#6A1B5A", "#4A148C", "#38006B",

    // 青色系 (清新的青绿到深青)
    "#80DEEA", "#4DD0E1", "#26C6DA", "#00BCD4", "#00ACC1", "#0097A7",
    "#00838F", "#006F79", "#005B63", "#00474D", "#003337", "#001F21",

    // 紫色系 (柔和的薰衣草到深紫)
    "#CE93D8", "#BA68C8", "#AB47BC", "#9C27B0", "#8E24AA", "#7B1FA2",
    "#6A1B9A", "#5D1782", "#50136A", "#430F52", "#360B3A", "#290722",

    // 黄色系 (柔和的奶油黄到深琥珀)
    "#FFF176", "#FFEE58", "#FFEB3B", "#FDD835", "#FBC02D", "#F9A825",
    "#F57F17", "#E7711B", "#D5631F", "#C35523", "#B14727", "#9F392B",

    // 中性色系 (柔和的灰阶)
    "#FAFAFA", "#F5F5F5", "#EEEEEE", "#E0E0E0", "#BDBDBD", "#9E9E9E",
    "#757575", "#616161", "#424242", "#303030", "#212121", "#121212"
];

function createColorPickerDialog(defaultColor, callback) {
    // 检查主题以适配样式
    const isDarkTheme = document.body.classList.contains("dark-theme");
    const backgroundColor = isDarkTheme ? "#2E2E2E" : "#FFFFFF";
    const textColor = isDarkTheme ? "#FFFFFF" : "#333333";
    const borderColor = isDarkTheme ? "#444444" : "#CCCCCC";
    const buttonBg = isDarkTheme ? "#555555" : "#DDDDDD";
    const confirmBg = isDarkTheme ? "#4CAF50" : "#28A745";
    const cancelBg = isDarkTheme ? "#F44336" : "#DC3545";

    const dialog = document.createElement("div");
    dialog.style.position = "fixed";
    dialog.style.top = "50%";
    dialog.style.left = "50%";
    dialog.style.transform = "translate(-50%, -50%)";
    dialog.style.background = backgroundColor;
    dialog.style.padding = "20px";
    dialog.style.borderRadius = "8px";
    dialog.style.boxShadow = "0 4px 8px rgba(0,0,0,0.5)";
    dialog.style.zIndex = "10000";
    dialog.style.color = textColor;
    dialog.style.fontFamily = "Arial, sans-serif";
    dialog.style.width = "500px";
    dialog.style.maxHeight = "900px";
    dialog.style.overflowY = "auto";

    const title = document.createElement("h3");
    title.textContent = "XIS节点颜色选择器";
    title.style.margin = "0 0 10px";
    title.style.fontSize = "16px";
    dialog.appendChild(title);

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = defaultColor;
    colorInput.style.width = "100%";
    colorInput.style.marginBottom = "10px";
    dialog.appendChild(colorInput);

    // 创建所有色系的分类
    const colorCategories = [
        { name: "红色系", start: 0, end: 11 },
        { name: "棕色系", start: 12, end: 23 },
        { name: "绿色系", start: 24, end: 35 },
        { name: "蓝色系", start: 36, end: 47 },
        { name: "淡蓝色系", start: 48, end: 59 },
        { name: "青色系", start: 60, end: 71 },
        { name: "紫色系", start: 72, end: 83 },
        { name: "黄色系", start: 84, end: 95 },
        { name: "中性色系", start: 96, end: 107 }
    ];

    colorCategories.forEach(category => {
        const categoryLabel = document.createElement("div");
        categoryLabel.textContent = category.name;
        categoryLabel.style.margin = "10px 0 5px";
        categoryLabel.style.fontSize = "14px";
        categoryLabel.style.fontWeight = "bold";
        dialog.appendChild(categoryLabel);

        const categoryContainer = document.createElement("div");
        categoryContainer.style.display = "grid";
        categoryContainer.style.gridTemplateColumns = "repeat(12, 30px)";
        categoryContainer.style.gap = "4px";
        categoryContainer.style.marginBottom = "10px";

        for (let i = category.start; i <= category.end; i++) {
            const color = PRESET_COLORS[i];
            const swatch = document.createElement("div");
            swatch.style.backgroundColor = color;
            swatch.style.width = "30px";
            swatch.style.height = "30px";
            swatch.style.border = `1px solid ${borderColor}`;
            swatch.style.cursor = "pointer";
            swatch.addEventListener("click", () => {
                colorInput.value = color;
                colorInput.dispatchEvent(new Event("change"));
            });
            categoryContainer.appendChild(swatch);
        }

        dialog.appendChild(categoryContainer);
    });

    const eyeDropperButton = document.createElement("button");
    eyeDropperButton.textContent = "吸管";
    eyeDropperButton.style.padding = "8px 16px";
    eyeDropperButton.style.marginRight = "10px";
    eyeDropperButton.style.background = buttonBg;
    eyeDropperButton.style.color = textColor;
    eyeDropperButton.style.border = "none";
    eyeDropperButton.style.borderRadius = "4px";
    eyeDropperButton.style.cursor = "pointer";
    eyeDropperButton.addEventListener("click", async () => {
        if (!window.EyeDropper) {
            alert("浏览器不支持吸管工具，请使用现代浏览器（如 Chrome/Edge）。");
            return;
        }
        const eyeDropper = new EyeDropper();
        try {
            const result = await eyeDropper.open();
            colorInput.value = result.sRGBHex;
            colorInput.dispatchEvent(new Event("change"));
        } catch (e) {
            console.error("[XISER] 吸管工具错误:", e);
        }
    });
    dialog.appendChild(eyeDropperButton);

    const confirmButton = document.createElement("button");
    confirmButton.textContent = "确认";
    confirmButton.style.padding = "8px 16px";
    confirmButton.style.background = confirmBg;
    confirmButton.style.color = "#FFFFFF";
    confirmButton.style.border = "none";
    confirmButton.style.borderRadius = "4px";
    confirmButton.style.cursor = "pointer";
    confirmButton.addEventListener("click", () => {
        callback(colorInput.value);
        document.body.removeChild(dialog);
    });
    dialog.appendChild(confirmButton);

    const cancelButton = document.createElement("button");
    cancelButton.textContent = "取消";
    cancelButton.style.padding = "8px 16px";
    cancelButton.style.background = cancelBg;
    cancelButton.style.color = "#FFFFFF";
    cancelButton.style.border = "none";
    cancelButton.style.borderRadius = "4px";
    cancelButton.style.cursor = "pointer";
    cancelButton.style.marginLeft = "10px";
    cancelButton.addEventListener("click", () => {
        document.body.removeChild(dialog);
    });
    dialog.appendChild(cancelButton);

    document.body.appendChild(dialog);
}

app.registerExtension({
    name: "XISER.ChangeNodeColor",
    async setup() {
        // 检查是否已有类似菜单项
        const existingExtensions = app.extensions.map(ext => ext.name);
        if (existingExtensions.some(name => name.includes("ChangeNodeColor") && name !== "XISER.ChangeNodeColor")) {
            console.warn("[XISER] 检测到其他颜色更改扩展，可能存在冲突");
        }

        const getNodeMenuOptions = app.canvas.getNodeMenuOptions;
        app.canvas.getNodeMenuOptions = function (node) {
            const options = getNodeMenuOptions.call(this, node);
            // 检查是否已有类似菜单项
            const hasColorMenu = options.some(opt => opt?.content?.includes("颜色"));
            if (hasColorMenu) {
                console.log("[XISER] 检测到现有颜色菜单，添加 XISER 专属菜单");
                options.push({
                    content: "XISER 更改节点颜色",
                    has_submenu: true,
                    submenu: {
                        options: [
                            {
                                content: "更改标题背景",
                                callback: async () => {
                                    return new Promise((resolve) => {
                                        createColorPickerDialog(node.color || "#000000", async (color) => {
                                            // 保存到 properties 以持久化
                                            node.properties = node.properties || {};
                                            node.properties["xiser_title_color"] = color;
                                            node.color = color;
                                            app.canvas.setDirty(true);

                                            const message = {
                                                node_id: node.id,
                                                color: color,
                                                color_type: "title"
                                            };
                                            console.log("[XISER] 发送颜色更改请求:", message);

                                            try {
                                                const response = await fetch("/xiser_color", {
                                                    method: "POST",
                                                    headers: { "Content-Type": "application/json" },
                                                    body: JSON.stringify(message)
                                                });
                                                const result = await response.json();
                                                console.log("[XISER] 收到响应:", result);
                                                if (result.type === "xiser_node_color_change_response") {
                                                    console.log(`[XISER] 节点 ${result.node_id} ${result.color_type} 颜色更改为 ${result.color}`);
                                                } else {
                                                    console.error("[XISER] 意外响应:", result);
                                                }
                                            } catch (e) {
                                                console.error("[XISER] 颜色更改请求失败:", e);
                                            }

                                            resolve();
                                        });
                                    });
                                },
                            },
                            {
                                content: "更改内容背景",
                                callback: async () => {
                                    return new Promise((resolve) => {
                                        createColorPickerDialog(node.bgcolor || "#000000", async (color) => {
                                            // 保存到 properties 以持久化
                                            node.properties = node.properties || {};
                                            node.properties["xiser_content_color"] = color;
                                            node.bgcolor = color;
                                            app.canvas.setDirty(true);

                                            const message = {
                                                node_id: node.id,
                                                color: color,
                                                color_type: "content"
                                            };
                                            console.log("[XISER] 发送颜色更改请求:", message);

                                            try {
                                                const response = await fetch("/xiser_color", {
                                                    method: "POST",
                                                    headers: { "Content-Type": "application/json" },
                                                    body: JSON.stringify(message)
                                                });
                                                const result = await response.json();
                                                console.log("[XISER] 收到响应:", result);
                                                if (result.type === "xiser_node_color_change_response") {
                                                    console.log(`[XISER] 节点 ${result.node_id} ${result.color_type} 颜色更改为 ${result.color}`);
                                                } else {
                                                    console.error("[XISER] 意外响应:", result);
                                                }
                                            } catch (e) {
                                                console.error("[XISER] 颜色更改请求失败:", e);
                                            }

                                            resolve();
                                        });
                                    });
                                },
                            },
                        ],
                    },
                });
            } else {
                options.push({
                    content: "XIS-更改节点颜色",
                    has_submenu: true,
                    submenu: {
                        options: [
                            {
                                content: "更改标题背景",
                                callback: async () => {
                                    return new Promise((resolve) => {
                                        createColorPickerDialog(node.color || "#000000", async (color) => {
                                            node.properties = node.properties || {};
                                            node.properties["xiser_title_color"] = color;
                                            node.color = color;
                                            app.canvas.setDirty(true);

                                            const message = {
                                                node_id: node.id,
                                                color: color,
                                                color_type: "title"
                                            };
                                            console.log("[XISER] 发送颜色更改请求:", message);

                                            try {
                                                const response = await fetch("/xiser_color", {
                                                    method: "POST",
                                                    headers: { "Content-Type": "application/json" },
                                                    body: JSON.stringify(message)
                                                });
                                                const result = await response.json();
                                                console.log("[XISER] 收到响应:", result);
                                                if (result.type === "xiser_node_color_change_response") {
                                                    console.log(`[XISER] 节点 ${result.node_id} ${result.color_type} 颜色更改为 ${result.color}`);
                                                } else {
                                                    console.error("[XISER] 意外响应:", result);
                                                }
                                            } catch (e) {
                                                console.error("[XISER] 颜色更改请求失败:", e);
                                            }

                                            resolve();
                                        });
                                    });
                                },
                            },
                            {
                                content: "更改内容背景",
                                callback: async () => {
                                    return new Promise((resolve) => {
                                        createColorPickerDialog(node.bgcolor || "#000000", async (color) => {
                                            node.properties = node.properties || {};
                                            node.properties["xiser_content_color"] = color;
                                            node.bgcolor = color;
                                            app.canvas.setDirty(true);

                                            const message = {
                                                node_id: node.id,
                                                color: color,
                                                color_type: "content"
                                            };
                                            console.log("[XISER] 发送颜色更改请求:", message);

                                            try {
                                                const response = await fetch("/xiser_color", {
                                                    method: "POST",
                                                    headers: { "Content-Type": "application/json" },
                                                    body: JSON.stringify(message)
                                                });
                                                const result = await response.json();
                                                console.log("[XISER] 收到响应:", result);
                                                if (result.type === "xiser_node_color_change_response") {
                                                    console.log(`[XISER] 节点 ${result.node_id} ${result.color_type} 颜色更改为 ${result.color}`);
                                                } else {
                                                    console.error("[XISER] 意外响应:", result);
                                                }
                                            } catch (e) {
                                                console.error("[XISER] 颜色更改请求失败:", e);
                                            }

                                            resolve();
                                        });
                                    });
                                },
                            },
                        ],
                    },
                });
            }
            return options;
        };
    },
});