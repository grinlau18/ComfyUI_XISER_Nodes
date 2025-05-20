import { app } from "/scripts/app.js";

// 96 种预设颜色
const PRESET_COLORS = [
    "#FF0000", "#B71C1C", "#D81B60", "#E91E63", "#F44336", "#FF5252",
    "#FF9800", "#F57C00", "#FF5722", "#FF6E40", "#FF8A65", "#FFA726",
    "#FFFF00", "#FFCA28", "#FFB300", "#FFD740", "#FFEB3B", "#FFF176",
    "#4CAF50", "#2E7D32", "#00C853", "#43A047", "#66BB6A", "#81C784",
    "#00BCD4", "#00838F", "#00695C", "#0097A7", "#26A69A", "#4DD0E1",
    "#2196F3", "#1565C0", "#0288D1", "#1976D2", "#42A5F5", "#90CAF9",
    "#9C27B0", "#6A1B9A", "#7B1FA2", "#AB47BC", "#CE93D8", "#E040FB",
    "#FFFFFF", "#F5F5F5", "#E0E0E0", "#B0BEC5", "#000000", "#212121",
    "#663333", "#5C2E2E", "#4D2626", "#773939", "#6B3333", "#803D3D",
    "#664C33", "#5C442E", "#4D3A26", "#775839", "#6B5033", "#80633D",
    "#666633", "#5C5C2E", "#4D4D26", "#777739", "#6B6B33", "#80803D",
    "#336633", "#2E5C2E", "#264D26", "#397739", "#336B33", "#3D803D",
    "#336666", "#2E5C5C", "#264D4D", "#397777", "#336B6B", "#3D8080",
    "#333366", "#2E2E5C", "#26264D", "#393977", "#33336B", "#3D3D80",
    "#553366", "#4B2E5C", "#3F264D", "#643977", "#59336B", "#6B3D80",
    "#333333", "#2A2A2A", "#222222", "#1A1A1A", "#111111", "#000000"
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
    dialog.style.width = "440px";
    dialog.style.maxHeight = "600px";
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

    // 鲜艳颜色
    const vibrantLabel = document.createElement("div");
    vibrantLabel.textContent = "鲜艳颜色";
    vibrantLabel.style.margin = "10px 0 5px";
    vibrantLabel.style.fontSize = "14px";
    dialog.appendChild(vibrantLabel);

    const vibrantContainer = document.createElement("div");
    vibrantContainer.style.display = "grid";
    vibrantContainer.style.gridTemplateColumns = "repeat(12, 30px)";
    vibrantContainer.style.gap = "4px";
    vibrantContainer.style.marginBottom = "10px";
    PRESET_COLORS.slice(0, 48).forEach(color => {
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
        vibrantContainer.appendChild(swatch);
    });
    dialog.appendChild(vibrantContainer);

    // 低饱和颜色
    const mutedLabel = document.createElement("div");
    mutedLabel.textContent = "低饱和颜色";
    mutedLabel.style.margin = "10px 0 5px";
    mutedLabel.style.fontSize = "14px";
    dialog.appendChild(mutedLabel);

    const mutedContainer = document.createElement("div");
    mutedContainer.style.display = "grid";
    mutedContainer.style.gridTemplateColumns = "repeat(12, 30px)";
    mutedContainer.style.gap = "4px";
    mutedContainer.style.marginBottom = "10px";
    PRESET_COLORS.slice(48, 90).forEach(color => {
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
        mutedContainer.appendChild(swatch);
    });
    dialog.appendChild(mutedContainer);

    // 深灰到黑色
    const darkLabel = document.createElement("div");
    darkLabel.textContent = "深灰到黑色";
    darkLabel.style.margin = "10px 0 5px";
    darkLabel.style.fontSize = "14px";
    dialog.appendChild(darkLabel);

    const darkContainer = document.createElement("div");
    darkContainer.style.display = "grid";
    darkContainer.style.gridTemplateColumns = "repeat(6, 30px)";
    darkContainer.style.gap = "4px";
    darkContainer.style.marginBottom = "10px";
    PRESET_COLORS.slice(90, 96).forEach(color => {
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
        darkContainer.appendChild(swatch);
    });
    dialog.appendChild(darkContainer);

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
                                                color_type: "title",
                                                workflow: app.graph.serialize()
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
                                                color_type: "content",
                                                workflow: app.graph.serialize()
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
                                                color_type: "title",
                                                workflow: app.graph.serialize()
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
                                                color_type: "content",
                                                workflow: app.graph.serialize()
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