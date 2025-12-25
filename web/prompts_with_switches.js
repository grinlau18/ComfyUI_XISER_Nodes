import { app } from "/scripts/app.js";
import { ComfyWidgets } from "/scripts/widgets.js";

const DEBUG = false; // 调试模式开关
const DEFAULT_SPACER_HEIGHT = 10; // 默认不可见控件高度
const MAX_PROMPT_COUNT = 50; // 与后端保持一致

app.registerExtension({
    name: "XISER.XIS_PromptsWithSwitches",
    async setup() {
        const style = document.createElement("style");
        style.textContent = `
            div.xis-prompts-buttons {
                display: flex;
                gap: 10px;
                margin: 0px 0;
                width: 100%;
                box-sizing: border-box;
                max-height: 30px !important;
                z-index: 1000;
            }
            div.xis-prompts-buttons button.xis-prompts-button {
                flex: 1;
                padding: 5px;
                background: rgba(220, 220, 220, 0.1);
                color: #fff;
                border: 1px solid #666;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
                text-align: center;
                line-height: 20px;
                height: 30px;
                box-sizing: border-box;
            }
            div.xis-prompts-buttons button.xis-prompts-button:hover {
                background:rgba(255, 255, 255, 0.2);
            }

            /* 为节点内容区域添加底部间距 */
            .node[data-type="XIS_PromptsWithSwitches"] .content {
                padding-bottom: 0px;
            }

            /* 为prompt控件添加底部间距 */
            .node[data-type="XIS_PromptsWithSwitches"] .lg-widget-value[data-name^="prompt_"]:last-of-type {
                margin-bottom: 0px;
            }

            /* 确保隐藏的控件不会响应点击 */
            .node[data-type="XIS_PromptsWithSwitches"] .lg-widget-value.hidden {
                pointer-events: none !important;
                opacity: 0 !important;
                height: 0 !important;
                margin: 0 !important;
                padding: 0 !important;
                overflow: hidden !important;
            }
        `;
        document.head.appendChild(style);
    },
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "XIS_PromptsWithSwitches") return;

        nodeType.prototype.promptCount = 5; // 默认显示5个prompt组合

        const getSpacerHeight = (node) => Math.max(0, node.properties?.spacerHeight ?? DEFAULT_SPACER_HEIGHT);

        // 确保底部有一个透明占位 widget，用高度来撑出下边距（不依赖样式）
        function ensureBottomSpacer(node) {
            node.widgets = node.widgets || [];
            // 移除旧的 spacer，避免多个
            node.widgets = node.widgets.filter(w => w.name !== "__bottom_padding");
            const spacer = node.addWidget("info", "__bottom_padding", "", () => {}, { serialize: false });
            spacer.computeSize = () => [node.size?.[0] || 0, getSpacerHeight(node)];
            spacer.draw = () => {}; // 不绘制，只占高度
            return spacer;
        }

        // 确保按钮下方有一个透明占位 widget，增加间距
        function ensureButtonSpacer(node) {
            node.widgets = node.widgets || [];
            // 移除旧的 spacer，避免多个
            node.widgets = node.widgets.filter(w => w.name !== "__button_spacing");
            const spacer = node.addWidget("info", "__button_spacing", "", () => {}, { serialize: false });
            spacer.computeSize = () => [node.size?.[0] || 0, 10]; // 10像素间距
            spacer.draw = () => {}; // 不绘制，只占高度
            return spacer;
        }

        // 移除透明占位 widget
        function removeBottomSpacer(node) {
            if (!node.widgets) return;
            node.widgets = node.widgets.filter(w => w.name !== "__bottom_padding");
        }

        // 移除按钮占位 widget
        function removeButtonSpacer(node) {
            if (!node.widgets) return;
            node.widgets = node.widgets.filter(w => w.name !== "__button_spacing");
        }

        // 清理控件的DOM元素
        function cleanupWidgetDOM(widget) {
            if (!widget) return;

            // 清理DOM元素
            if (widget.element?.parentNode) {
                try {
                    widget.element.parentNode.removeChild(widget.element);
                } catch (e) {
                    // 忽略移除错误
                }
            }

            // 清理事件监听器
            if (widget.callback) {
                widget.callback = null;
            }

            // 清理其他可能的DOM引用
            if (widget.inputEl?.parentNode) {
                try {
                    widget.inputEl.parentNode.removeChild(widget.inputEl);
                } catch (e) {
                    // 忽略移除错误
                }
            }

            // 清理ComfyUI可能添加的其他属性
            if (widget.options?.inputEl?.parentNode) {
                try {
                    widget.options.inputEl.parentNode.removeChild(widget.options.inputEl);
                } catch (e) {
                    // 忽略移除错误
                }
            }
        }


        // 更新控件可见性状态的辅助函数
        function updateWidgetVisibility(node) {
            if (!node.widgets) return;

            node.widgets?.forEach(widget => {
                if (widget.name?.startsWith("prompt_") || widget.name?.startsWith("enable_")) {
                    // 提取数字部分
                    const match = widget.name.match(/(prompt|enable)_(\d+)/);
                    if (match) {
                        const num = parseInt(match[2]);
                        const shouldBeVisible = num <= node.promptCount;

                        // 更新DOM元素的类
                        if (widget.element) {
                            if (shouldBeVisible) {
                                widget.element.classList.remove('hidden');
                            } else {
                                widget.element.classList.add('hidden');
                            }
                        }
                    }
                }
            });
        }

        // 确保控件可见性状态正确（在每次绘制时调用）
        const origOnDrawForeground = nodeType.prototype.onDrawForeground;
        nodeType.prototype.onDrawForeground = function (ctx) {
            if (origOnDrawForeground) origOnDrawForeground.apply(this, [ctx]);
            updateWidgetVisibility(this);
        };

        // 保证按钮在最上方，按钮spacer在按钮下方，底部spacer在最下方，其余按名称排序
        function reorderWidgets(node) {
            if (!node.widgets) return;
            const buttons = node.widgets.filter(w => w.name === "buttons");
            const buttonSpacer = node.widgets.filter(w => w.name === "__button_spacing");
            const bottomSpacer = node.widgets.filter(w => w.name === "__bottom_padding");
            const others = node.widgets.filter(w => w.name !== "buttons" && w.name !== "__button_spacing" && w.name !== "__bottom_padding");

            // 对prompt和enable控件按数字排序
            const promptWidgets = others.filter(w => w.name?.startsWith("prompt_") || w.name?.startsWith("enable_"));
            const otherWidgets = others.filter(w => !w.name?.startsWith("prompt_") && !w.name?.startsWith("enable_"));

            // 按数字排序，确保prompt和对应的enable控件在一起
            promptWidgets.sort((a, b) => {
                const getNum = (name) => {
                    const match = name.match(/(prompt|enable)_(\d+)/);
                    return match ? parseInt(match[2]) : 0;
                };
                return getNum(a.name) - getNum(b.name);
            });

            node.widgets = [...buttons, ...buttonSpacer, ...otherWidgets, ...promptWidgets, ...bottomSpacer];
        }

        // 状态修正机制
        function correctWidgetStates(node) {
            if (!node.widgets || !node.properties.correctWidgetStates) return;

            const correctStates = node.properties.correctWidgetStates;

            // 应用正确的状态到控件
            for (const widget of node.widgets) {
                if ((widget.name?.startsWith("prompt_") || widget.name?.startsWith("enable_")) &&
                    correctStates[widget.name] !== undefined) {
                    const correctValue = correctStates[widget.name];
                    if (widget.value !== correctValue) {
                        if (DEBUG) console.log(`Node ${node.id}: Correcting ${widget.name} from ${widget.value} to ${correctValue}`);
                        widget.value = correctValue;
                    }
                }
            }

            // 清除修正状态，避免重复修正
            delete node.properties.correctWidgetStates;
        }

        // 确保节点 ID 有效
        async function ensureNodeId(node) {
            let attempts = 0;
            const maxAttempts = 100;
            while (node.id === -1 && attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 50));
                attempts++;
            }
            if (node.id === -1) {
                throw new Error(`Node ${node.id}: Failed to get valid node ID`);
            }
            return node.id;
        }


        // 创建自定义按钮widget的辅助函数
        function createButtonsWidget(node) {
            // 创建按钮容器
            const container = document.createElement("div");
            container.className = "xis-prompts-buttons";
            container.style.cssText = `
                display: flex;
                gap: 10px;
                width: 100%;
                box-sizing: border-box;
                max-height: 30px !important;
                height: 30px !important;
                min-height: 30px !important;
                flex-shrink: 0 !important;
                flex-grow: 0 !important;
                z-index: 1000;
                overflow: hidden;
            `;

            // 创建添加按钮
            const addButton = document.createElement("button");
            addButton.innerText = "Add Prompt";
            addButton.className = "xis-prompts-button";
            addButton.style.cssText = `
                flex: 1;
                padding: 5px;
                background: rgba(220, 220, 220, 0.1);
                color: #fff;
                border: 1px solid #666;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
                text-align: center;
                line-height: 20px;
                height: 30px;
                box-sizing: border-box;
            `;
            addButton.onclick = () => {
                if (node.promptCount < MAX_PROMPT_COUNT) {
                    node.promptCount++;
                    node.rebuildWidgets();
                    app.graph.setDirtyCanvas(true, false);
                    if (DEBUG) console.log(`Node ${node.id}: Added prompt, total: ${node.promptCount}`);
                }
            };
            container.appendChild(addButton);

            // 创建删除按钮
            const removeButton = document.createElement("button");
            removeButton.innerText = "Remove Prompt";
            removeButton.className = "xis-prompts-button";
            removeButton.style.cssText = addButton.style.cssText;
            removeButton.onclick = () => {
                if (node.promptCount > 1) {
                    node.promptCount--;
                    node.rebuildWidgets();
                    app.graph.setDirtyCanvas(true, false);
                    if (DEBUG) console.log(`Node ${node.id}: Removed prompt, total: ${node.promptCount}`);
                }
            };
            container.appendChild(removeButton);

            return container;
        }

        const origOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = async function () {
            try {
                if (origOnNodeCreated) origOnNodeCreated.apply(this);
                await ensureNodeId(this);
                this.properties = this.properties || {};

                // 创建按钮容器
                const buttonContainer = createButtonsWidget(this);

                // 添加DOM widget
                const buttonsWidget = this.addDOMWidget("buttons", "buttons", buttonContainer, { before: "prompt_1" });

                // 重写computeSize方法，固定高度
                if (buttonsWidget) {
                    // 保存原始computeSize的引用
                    const widgetRef = buttonsWidget;
                    const originalComputeSize = widgetRef.computeSize;

                    if (originalComputeSize) {
                        widgetRef.computeSize = function(width) {
                            // 调用原始computeSize，但固定高度为30
                            const originalSize = originalComputeSize.call(widgetRef, width);
                            return [originalSize[0], 30]; // 固定30像素高度
                        };
                    } else {
                        // 如果没有computeSize方法，直接创建一个
                        widgetRef.computeSize = function(width) {
                            return [width, 30]; // 固定30像素高度
                        };
                    }
                }

                if (DEBUG) console.log(`Node ${this.id}: Added buttons widget`);

                // 在按钮下方添加一个隐藏的spacer，增加间距
                ensureButtonSpacer(this);

                // 初始化 spacer 高度，但不暴露 UI 控件
                this.properties.spacerHeight = getSpacerHeight(this);

                ensureBottomSpacer(this);
                reorderWidgets(this);

                // 只在节点创建时设置初始大小，如果已经有大小则保持
                if (!this.size || this.size[0] === 0 || this.size[1] === 0) {
                    this.setSize(this.computeSize());
                }

                this.rebuildWidgets();

                // 初始控件可见性设置
                updateWidgetVisibility(this);
            } catch (error) {
                console.error(`Node ${this.id}: Error in onNodeCreated: ${error.message}`);
            }
        };

        // 优化重建控件逻辑 - 增量更新
        nodeType.prototype.rebuildWidgets = function () {
            try {
                if (this._rebuildingWidgets) {
                    if (DEBUG) console.log(`Node ${this.id}: rebuildWidgets already in progress, skipping`);
                    return;
                }
                this._rebuildingWidgets = true;
                this.properties = this.properties || {};
                this.promptCount = Math.min(Math.max(1, this.promptCount || 5), MAX_PROMPT_COUNT);

                // 1. 计算需要添加和删除的控件
                const existingNumbers = this.widgets
                    ?.filter(w => w.name?.startsWith("prompt_") || w.name?.startsWith("enable_"))
                    .map(w => {
                        const match = w.name.match(/(prompt|enable)_(\d+)/);
                        return match ? parseInt(match[2]) : 0;
                    })
                    .filter(num => num > 0)
                    .filter((num, index, self) => self.indexOf(num) === index) || []; // 去重

                const toRemove = existingNumbers.filter(num => num > this.promptCount);
                const toAdd = Array.from({length: this.promptCount}, (_, i) => i + 1)
                    .filter(num => !existingNumbers.includes(num))
                    .sort((a, b) => a - b); // 确保按数字顺序添加

                if (DEBUG) {
                    console.log(`Node ${this.id}: Prompt count: ${this.promptCount}, Existing: ${existingNumbers}, To remove: ${toRemove}, To add: ${toAdd}`);
                }

                // 2. 批量删除不需要的控件（带清理）- 使用requestAnimationFrame减少闪烁
                if (toRemove.length > 0) {
                    requestAnimationFrame(() => {
                        toRemove.forEach(num => {
                            const promptWidgetName = `prompt_${num}`;
                            const enableWidgetName = `enable_${num}`;

                            [promptWidgetName, enableWidgetName].forEach(widgetName => {
                                const widgetIndex = this.widgets?.findIndex(w => w.name === widgetName);
                                if (widgetIndex !== -1 && widgetIndex !== undefined) {
                                    const widget = this.widgets[widgetIndex];
                                    // 清理控件的DOM元素
                                    cleanupWidgetDOM(widget);
                                }
                            });
                        });

                        this.widgets = this.widgets?.filter(w => {
                            // 如果不是prompt或enable控件，保留
                            if (!w.name?.startsWith("prompt_") && !w.name?.startsWith("enable_")) {
                                return true;
                            }

                            // 提取数字部分
                            const match = w.name.match(/(prompt|enable)_(\d+)/);
                            if (!match) {
                                return true; // 如果格式不对，保留（可能是其他控件）
                            }

                            const num = parseInt(match[2]);
                            // 如果数字在toRemove列表中，删除
                            return !toRemove.includes(num);
                        }) || [];
                    });
                }

                // 3. 在添加新控件之前，确保所有要添加的控件都被完全清理
                // 这可以防止控件重复创建
                if (toAdd.length > 0) {
                    requestAnimationFrame(() => {
                        // 新增前移除 spacer，防止新控件被插到 spacer 下方
                        removeButtonSpacer(this);
                        removeBottomSpacer(this);

                        // 首先，清理所有要添加的控件（确保没有残留）
                        toAdd.forEach(num => {
                            const promptWidgetName = `prompt_${num}`;
                            const enableWidgetName = `enable_${num}`;

                            // 查找并清理可能存在的控件
                            const existingPromptWidget = this.widgets?.find(w => w.name === promptWidgetName);
                            const existingEnableWidget = this.widgets?.find(w => w.name === enableWidgetName);

                            if (existingPromptWidget) {
                                cleanupWidgetDOM(existingPromptWidget);
                            }
                            if (existingEnableWidget) {
                                cleanupWidgetDOM(existingEnableWidget);
                            }
                        });

                        // 从widgets数组中移除这些控件
                        this.widgets = this.widgets?.filter(w => {
                            if (!w.name?.startsWith("prompt_") && !w.name?.startsWith("enable_")) {
                                return true;
                            }
                            const match = w.name.match(/(prompt|enable)_(\d+)/);
                            if (!match) return true;
                            const num = parseInt(match[2]);
                            return !toAdd.includes(num);
                        }) || [];

                        // 现在安全地添加新控件
                        toAdd.forEach(num => {
                            // 添加prompt输入框 - 设置多行文本的初始高度
                            const promptWidget = ComfyWidgets.STRING(this, `prompt_${num}`, ["STRING", { default: "", multiline: true, height: 100 }], app).widget;
                            // 添加enable开关
                            const enableWidget = ComfyWidgets.BOOLEAN(this, `enable_${num}`, ["BOOLEAN", { default: true }], app).widget;
                            if (DEBUG) console.log(`Node ${this.id}: Added widgets prompt_${num} and enable_${num}`);
                        });

                        // 立即确保spacer存在并重新排列（与canvas_mask_processor保持一致）
                        ensureButtonSpacer(this);
                        ensureBottomSpacer(this);
                        reorderWidgets(this);
                    });
                }

                // 4. 确保底部占位 spacer 存在（如果toAdd为空）
                if (toAdd.length === 0) {
                    ensureButtonSpacer(this);
                    ensureBottomSpacer(this);
                    reorderWidgets(this);
                }

                // 6. 调整节点大小 - 使用requestAnimationFrame减少闪烁
                requestAnimationFrame(() => {
                    // 保持当前宽度，只更新高度以适应控件
                    const currentWidth = this.size && this.size[0] > 0 ? this.size[0] : null;
                    const computedSize = this.computeSize();
                    if (DEBUG) console.log(`Node ${this.id}: computeSize() returned: [${computedSize[0]}, ${computedSize[1]}]`);
                    const newWidth = currentWidth || computedSize[0];

                    // 重新计算高度，不保持当前高度
                    const newHeight = computedSize[1];
                    if (DEBUG) console.log(`Node ${this.id}: Using computed height: ${newHeight}`);

                    this.setSize([newWidth, newHeight]);
                    this.onResize?.();
                    app.graph.setDirtyCanvas(true, false);

                    // 确保控件可见性正确
                    updateWidgetVisibility(this);

                    if (DEBUG) {
                        console.log(`Node ${this.id}: Incremental rebuild completed - Added: ${toAdd.length}, Removed: ${toRemove.length}`);
                    }
                });

            } catch (error) {
                console.error(`Node ${this.id}: Error in rebuildWidgets:`, error);
                // 错误恢复：回退到全量重建
                this._rebuildFallback();
            } finally {
                this._rebuildingWidgets = false;
            }
        };

        // 错误恢复方法 - 全量重建
        nodeType.prototype._rebuildFallback = function () {
            try {
                if (DEBUG) console.log(`Node ${this.id}: Using fallback rebuild`);
                this.properties = this.properties || {};

                // 清理所有prompt和enable控件 - 使用requestAnimationFrame减少闪烁
                requestAnimationFrame(() => {
                    removeButtonSpacer(this);
                    removeBottomSpacer(this);

                    // 先清理所有prompt和enable控件的DOM元素
                    this.widgets?.forEach(widget => {
                        if (widget.name?.startsWith("prompt_") || widget.name?.startsWith("enable_")) {
                            cleanupWidgetDOM(widget);
                        }
                    });

                    // 然后从widgets数组中移除
                    this.widgets = this.widgets?.filter(w => !w.name?.startsWith("prompt_") && !w.name?.startsWith("enable_")) || [];

                    // 重新创建所有控件 - 按数字顺序
                    for (let i = 1; i <= this.promptCount; i++) {
                        // 确保没有残留的控件
                        const existingPromptWidget = this.widgets?.find(w => w.name === `prompt_${i}`);
                        const existingEnableWidget = this.widgets?.find(w => w.name === `enable_${i}`);

                        if (existingPromptWidget) {
                            cleanupWidgetDOM(existingPromptWidget);
                        }
                        if (existingEnableWidget) {
                            cleanupWidgetDOM(existingEnableWidget);
                        }

                        // 创建新控件
                        const promptWidget = ComfyWidgets.STRING(this, `prompt_${i}`, ["STRING", { default: "", multiline: true, height: 100 }], app).widget;
                        const enableWidget = ComfyWidgets.BOOLEAN(this, `enable_${i}`, ["BOOLEAN", { default: true }], app).widget;
                    }

                    ensureButtonSpacer(this);
                    ensureBottomSpacer(this);
                    reorderWidgets(this);

                    // 调整节点大小 - 保持当前宽度
                    const currentWidth = this.size && this.size[0] > 0 ? this.size[0] : null;
                    const computedSize = this.computeSize();
                    const newWidth = currentWidth || computedSize[0];

                    // 重新计算高度，不保持当前高度
                    const newHeight = computedSize[1];
                    if (DEBUG) console.log(`Node ${this.id}: Fallback - Using computed height: ${newHeight}`);

                    this.setSize([newWidth, newHeight]);
                    app.graph.setDirtyCanvas(true, false);

                    if (DEBUG) console.log(`Node ${this.id}: Fallback rebuild completed successfully`);
                });

                } catch (fallbackError) {
                console.error(`Node ${this.id}: Fallback rebuild also failed:`, fallbackError);
                // 终极恢复：重置到默认状态
                this._ultimateRecovery();
            }
        };

        // 终极恢复方法
        nodeType.prototype._ultimateRecovery = function () {
            try {
                if (DEBUG) console.log(`Node ${this.id}: Using ultimate recovery`);

                // 重置到默认状态 - 使用requestAnimationFrame减少闪烁
                requestAnimationFrame(() => {
                    this.promptCount = 5;
                    this.properties = this.properties || {};

                    // 先清理所有prompt和enable控件的DOM元素
                    this.widgets?.forEach(widget => {
                        if (widget.name?.startsWith("prompt_") || widget.name?.startsWith("enable_")) {
                            cleanupWidgetDOM(widget);
                        }
                    });

                    // 然后从widgets数组中移除
                    this.widgets = this.widgets?.filter(w => !w.name?.startsWith("prompt_") && !w.name?.startsWith("enable_")) || [];

                    // 创建默认控件 - 按数字顺序
                    for (let i = 1; i <= this.promptCount; i++) {
                        const promptWidget = ComfyWidgets.STRING(this, `prompt_${i}`, ["STRING", { default: "", multiline: true }], app).widget;
                        const enableWidget = ComfyWidgets.BOOLEAN(this, `enable_${i}`, ["BOOLEAN", { default: true }], app).widget;
                    }

                    ensureButtonSpacer(this);
                    ensureBottomSpacer(this);
                    reorderWidgets(this);

                    // 重置节点大小 - 保持当前宽度
                    const currentWidth = this.size && this.size[0] > 0 ? this.size[0] : null;
                    const computedSize = this.computeSize();
                    const newWidth = currentWidth || computedSize[0];

                    // 重新计算高度，不保持当前高度
                    const newHeight = computedSize[1];
                    if (DEBUG) console.log(`Node ${this.id}: Ultimate recovery - Using computed height: ${newHeight}`);

                    this.setSize([newWidth, newHeight]);
                    app.graph.setDirtyCanvas(true, false);

                    if (DEBUG) console.log(`Node ${this.id}: Ultimate recovery completed`);
                });

            } catch (ultimateError) {
                console.error(`Node ${this.id}: Ultimate recovery failed:`, ultimateError);
            }
        };

        // 序列化节点状态
        const origSerialize = nodeType.prototype.serialize;
        nodeType.prototype.serialize = function () {
            try {
                this.properties = this.properties || {};
                const data = origSerialize ? origSerialize.apply(this) : {};
                data.properties = data.properties || {};
                data.properties.promptCount = this.promptCount;
                data.properties.spacerHeight = this.properties?.spacerHeight ?? DEFAULT_SPACER_HEIGHT;
                // 只保存节点宽度，不保存高度（高度由控件动态计算）
                if (this.size && this.size.length >= 2 && this.size[0] > 0) {
                    data.properties.width = this.size[0];
                }

                // 记录正确的控件状态用于修正 - 只记录当前显示的控件
                const correctStates = {};

                // 只记录当前显示的 prompt 和 enable 状态
                for (let i = 1; i <= this.promptCount; i++) {
                    const promptWidgetName = `prompt_${i}`;
                    const enableWidgetName = `enable_${i}`;

                    const promptWidget = this.widgets.find(w => w.name === promptWidgetName);
                    const enableWidget = this.widgets.find(w => w.name === enableWidgetName);

                    if (promptWidget && promptWidget.value !== undefined) {
                        correctStates[promptWidgetName] = promptWidget.value;
                    }
                    if (enableWidget && enableWidget.value !== undefined) {
                        correctStates[enableWidgetName] = enableWidget.value;
                    }
                }
                data.properties.correctWidgetStates = correctStates;

                // 重新启用 widgets_values，但只包含当前显示的控件
                // 按数字顺序序列化控件状态
                const widgetValues = [];
                for (let i = 1; i <= this.promptCount; i++) {
                    const promptWidget = this.widgets.find(w => w.name === `prompt_${i}`);
                    const enableWidget = this.widgets.find(w => w.name === `enable_${i}`);

                    if (promptWidget && promptWidget.value !== undefined) {
                        widgetValues.push(promptWidget.value);
                    } else {
                        widgetValues.push(""); // 默认值
                    }

                    if (enableWidget && enableWidget.value !== undefined) {
                        widgetValues.push(enableWidget.value);
                    } else {
                        widgetValues.push(true); // 默认值
                    }
                }

                data.widgets_values = widgetValues;

                if (DEBUG) console.log(`Node ${this.id}: Serialized correctWidgetStates: ${JSON.stringify(data.properties.correctWidgetStates)}, widgets_values: ${data.widgets_values}`);
                return data;
            } catch (error) {
                console.error(`Node ${this.id}: Error in serialize: ${error.message}`);
                // 返回最小化的有效数据
                return {
                    properties: {
                        promptCount: this.promptCount || 5,
                        spacerHeight: this.properties?.spacerHeight ?? DEFAULT_SPACER_HEIGHT,
                        correctWidgetStates: {}
                    },
                    widgets_values: []
                };
            }
        };

        // 加载节点状态
        const origOnConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (config) {
            try {
                if (origOnConfigure) origOnConfigure.apply(this, [config]);
                this.properties = this.properties || {};

                if (config.properties) {
                    // 验证和清理配置数据
                    this.promptCount = Math.min(MAX_PROMPT_COUNT, Math.max(1, parseInt(config.properties.promptCount) || 5));
                    this.properties.spacerHeight = Math.max(0, parseInt(config.properties.spacerHeight) || DEFAULT_SPACER_HEIGHT);

                    // 只恢复节点宽度，高度由控件动态计算
                    if (config.properties.width) {
                        const width = parseInt(config.properties.width);
                        if (!isNaN(width) && width > 0) {
                            // 保持当前高度，只设置宽度
                            const currentHeight = this.size && this.size[1] > 0 ? this.size[1] : this.computeSize()[1];
                            this.setSize([width, currentHeight]);
                            if (DEBUG) console.log(`Node ${this.id}: Restored width from config: ${width}, height: ${currentHeight}`);
                        }
                    }
                }

                // 延迟重建以确保DOM已准备好
                setTimeout(() => {
                    try {
                        this.rebuildWidgets();

                        // 执行状态修正 - 这会修正所有控件的状态
                        correctWidgetStates(this);

                        // 更新控件可见性
                        updateWidgetVisibility(this);

                        if (DEBUG) console.log(`Node ${this.id}: Configured with correctWidgetStates: ${JSON.stringify(config.properties?.correctWidgetStates)}, Widgets: ${this.widgets.map(w => `${w.name}: ${w.value}`)}`);
                    } catch (rebuildError) {
                        console.error(`Node ${this.id}: Error during rebuild in onConfigure:`, rebuildError);
                    }
                }, 50);

            } catch (error) {
                console.error(`Node ${this.id}: Error in onConfigure: ${error.message}`);
                // 尝试基本恢复
                try {
                    this.promptCount = 5;
                    this.rebuildWidgets();
                } catch (recoveryError) {
                    console.error(`Node ${this.id}: Recovery also failed:`, recoveryError);
                }
            }
        };

        const origOnRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            try {
                if (origOnRemoved) origOnRemoved.apply(this);
                const container = document.querySelector(`.xis-prompts-buttons[data-nodeId="${this.id}"]`);
                if (container) container.remove();
            } catch (error) {
                console.error(`Node ${this.id}: Error in onRemoved: ${error.message}`);
            }
        };

        // 确保执行时传递控件值
        const origOnExecute = nodeType.prototype.onExecute;
        nodeType.prototype.onExecute = function () {
            try {
                if (origOnExecute) origOnExecute.apply(this);
                // 重新启用 widgets_values 用于执行
                const widgetValues = [];
                for (let i = 1; i <= this.promptCount; i++) {
                    const promptWidget = this.widgets.find(w => w.name === `prompt_${i}`);
                    const enableWidget = this.widgets.find(w => w.name === `enable_${i}`);

                    if (promptWidget) widgetValues.push(promptWidget.value);
                    if (enableWidget) widgetValues.push(enableWidget.value);
                }

                this.widgets_values = widgetValues;
                if (DEBUG) console.log(`Node ${this.id}: Executing with widgets_values: ${this.widgets_values}`);
            } catch (error) {
                console.error(`Node ${this.id}: Error in onExecute: ${error.message}`);
            }
        };
    }
});