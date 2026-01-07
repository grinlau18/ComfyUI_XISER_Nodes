/**
 * ComfyUI 扩展，为 Image Adjust and Blend 节点添加重置按钮
 * 简化版本：只控制按钮本身的高度和位置，其他交给ComfyUI管理
 */

import { app } from "/scripts/app.js";

/**
 * 获取调节参数的默认值
 */
function getDefaultValues() {
    return {
        brightness: 0.0,
        contrast: 0.0,
        saturation: 0.0,
        hue: 0.0,
        r_gain: 1.0,
        g_gain: 1.0,
        b_gain: 1.0,
        opacity: 1.0,
        blend_mode: "normal"
    };
}

/**
 * 创建简单的重置按钮
 * 只控制按钮本身，不干预ComfyUI的布局管理
 */
function createSimpleResetButton(node) {
    // 创建最小化的容器，只确保按钮位置正确
    const container = document.createElement("div");

    // 容器样式 - 最小化干预
    Object.assign(container.style, {
        width: "100%",
        height: "24px", // 固定容器高度
        minHeight: "24px", // 确保最小高度
        maxHeight: "24px", // 确保最大高度
        margin: "0",
        padding: "0",
        boxSizing: "border-box",
        display: "block"
    });

    // 创建按钮元素
    const button = document.createElement("button");
    button.textContent = "Reset";
    button.title = "重置所有调节参数";

    // 按钮样式 - 简单固定高度
    Object.assign(button.style, {
        display: "block",
        width: "100%",
        height: "24px", // 固定按钮高度
        background: "rgba(128, 128, 128, 0.15)",
        color: "rgba(220, 220, 220, 0.9)",
        border: "1px solid rgba(180, 180, 180, 0.3)",
        borderRadius: "3px",
        cursor: "pointer",
        fontSize: "11px",
        boxSizing: "border-box",
        textAlign: "center",
        fontFamily: "inherit",
        outline: "none",
        lineHeight: "22px", // 垂直居中
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        userSelect: "none",
        transition: "all 0.2s ease",
        backdropFilter: "blur(2px)",
        margin: "0", // 无外边距
        padding: "0" // 无内边距
    });

    // 悬停效果
    button.addEventListener("mouseenter", () => {
        button.style.background = "rgba(160, 160, 160, 0.25)";
        button.style.borderColor = "rgba(200, 200, 200, 0.4)";
        button.style.color = "rgba(240, 240, 240, 0.95)";
    });

    button.addEventListener("mouseleave", () => {
        button.style.background = "rgba(128, 128, 128, 0.15)";
        button.style.borderColor = "rgba(180, 180, 180, 0.3)";
        button.style.color = "rgba(220, 220, 220, 0.9)";
    });

    button.addEventListener("mousedown", () => {
        button.style.background = "rgba(180, 180, 180, 0.3)";
        button.style.transform = "scale(0.98)";
    });

    button.addEventListener("mouseup", () => {
        button.style.background = "rgba(160, 160, 160, 0.25)";
        button.style.transform = "scale(1)";
    });

    // 点击事件
    button.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        const defaults = getDefaultValues();
        let changed = false;

        // 重置参数
        node.widgets.forEach(widget => {
            if (widget.name in defaults) {
                const oldValue = widget.value;
                const newValue = defaults[widget.name];

                if (oldValue !== newValue) {
                    widget.value = newValue;
                    changed = true;
                    if (widget.callback) {
                        widget.callback(widget.value);
                    }
                }
            }
        });

        // 反馈效果
        if (changed) {
            const originalText = button.textContent;
            button.textContent = "✓ Done";
            button.style.background = "rgba(76, 175, 80, 0.4)";
            button.style.color = "rgba(255, 255, 255, 0.95)";
            button.style.borderColor = "rgba(76, 175, 80, 0.6)";

            setTimeout(() => {
                button.textContent = originalText;
                button.style.background = "rgba(128, 128, 128, 0.15)";
                button.style.color = "rgba(220, 220, 220, 0.9)";
                button.style.borderColor = "rgba(180, 180, 180, 0.3)";
            }, 800);
        }

        app.graph.setDirtyCanvas(true);
    });

    // 将按钮添加到容器
    container.appendChild(button);
    return container;
}

/**
 * 确保节点 ID 有效
 */
async function ensureNodeId(node) {
    let attempts = 0;
    while (node.id === -1 && attempts < 50) {
        await new Promise(resolve => setTimeout(resolve, 20));
        attempts++;
    }
    return node.id !== -1;
}

/**
 * ComfyUI 扩展注册
 */
app.registerExtension({
    name: "xiser.image_adjust_and_blend.reset",

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "XIS_ImageAdjustAndBlend") return;
    },

    async nodeCreated(node) {
        if (node.comfyClass !== "XIS_ImageAdjustAndBlend") return;

        // 等待有效节点 ID
        if (!(await ensureNodeId(node))) {
            return;
        }

        // 创建简单的重置按钮容器
        const resetContainer = createSimpleResetButton(node);

        // 添加到节点 - 让ComfyUI管理布局
        node.addDOMWidget("reset", "Reset", resetContainer, {
            getValue() { return null; },
            setValue() {}
        });

        // 简单清理
        node.onRemoved = () => {
            try {
                resetContainer.remove();
            } catch (error) {
                // 忽略清理错误
            }
        };
    }
});