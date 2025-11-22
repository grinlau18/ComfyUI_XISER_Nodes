import { app } from "/scripts/app.js";
import { ComfyWidgets } from "/scripts/widgets.js";

const DEBUG = false; // 调试模式开关
const BASE_NODE_HEIGHT = 150; // 最小高度
const DEFAULT_SPACER_HEIGHT = 10; // 默认不可见控件高度
const MIN_WIDTH = 280;
const MAX_WIDTH = 800;
const MAX_LAYER_COUNT = 50;

app.registerExtension({
    name: "XISER.XIS_CanvasMaskProcessor",
    async setup() {
        const style = document.createElement("style");
        style.textContent = `
            div.xis-canvas-mask-buttons {
                display: flex;
                gap: 10px;
                margin: 0px 0;
                width: 100%;
                box-sizing: border-box;
                max-height: 30px !important;
                z-index: 1000;
            }
            div.xis-canvas-mask-buttons button.xis-canvas-mask-button {
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
            div.xis-canvas-mask-buttons button.xis-canvas-mask-button:hover {
                background:rgba(255, 255, 255, 0.2);
            }

            /* 为节点内容区域添加底部间距 */
            .node[data-type="XIS_CanvasMaskProcessor"] .content {
                padding-bottom: 0px;
            }

            /* 为Layer_Mask控件添加底部间距 */
            .node[data-type="XIS_CanvasMaskProcessor"] .lg-widget-value[data-name^="Layer_Mask_"]:last-of-type {
                margin-bottom: 0px;
            }
        `;
        document.head.appendChild(style);
    },
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "XIS_CanvasMaskProcessor") return;

        nodeType.prototype.layerCount = 8;

        const getSpacerHeight = (node) => Math.max(0, node.properties?.spacerHeight ?? DEFAULT_SPACER_HEIGHT);
        const getFixedWidth = (node, fallbackWidth) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, node.properties?.fixedWidth || fallbackWidth || MIN_WIDTH));

        // 确保底部有一个透明占位 widget，用高度来撑出下边距（不依赖样式）
        function ensureBottomSpacer(node) {
            node.widgets = node.widgets || [];
            // 移除旧的 spacer，避免多个
            node.widgets = node.widgets.filter(w => w.name !== "__bottom_padding");
            const spacer = node.addWidget("info", "__bottom_padding", "", null, { serialize: false });
            spacer.computeSize = () => [node.size?.[0] || 0, getSpacerHeight(node)];
            spacer.draw = () => {}; // 不绘制，只占高度
            return spacer;
        }

        // 移除透明占位 widget
        function removeBottomSpacer(node) {
            if (!node.widgets) return;
            node.widgets = node.widgets.filter(w => w.name !== "__bottom_padding");
        }

        // 统一的高度计算方法：依赖实际 widget 高度（含 spacer）动态计算
        const origComputeSize = nodeType.prototype.computeSize;
        nodeType.prototype.computeSize = function (out) {
            const base = origComputeSize
                ? origComputeSize.call(this, out ? [0, 0] : undefined)
                : [this.size?.[0] || 0, this.size?.[1] || BASE_NODE_HEIGHT];
            const width = getFixedWidth(this, base?.[0] || this.size?.[0] || MIN_WIDTH);
            const height = Math.max(BASE_NODE_HEIGHT, base?.[1] || BASE_NODE_HEIGHT);
            if (out) {
                out[0] = width;
                out[1] = height;
                return out;
            }
            return [width, height];
        };

        // 保证按钮在最上方，spacer 在最下方，其余按名称排序
        function reorderWidgets(node) {
            if (!node.widgets) return;
            const buttons = node.widgets.filter(w => w.name === "buttons");
            const spacer = node.widgets.filter(w => w.name === "__bottom_padding");
            const others = node.widgets.filter(w => w.name !== "buttons" && w.name !== "__bottom_padding");

            // 对 Layer_Mask 控件按数字排序
            const layerWidgets = others.filter(w => w.name?.startsWith("Layer_Mask_"));
            const otherWidgets = others.filter(w => !w.name?.startsWith("Layer_Mask_"));

            layerWidgets.sort((a, b) => {
                const numA = parseInt(a.name.replace("Layer_Mask_", ""));
                const numB = parseInt(b.name.replace("Layer_Mask_", ""));
                return numA - numB;
            });

            node.widgets = [...buttons, ...otherWidgets, ...layerWidgets, ...spacer];
        }

        // 状态修正机制
        function correctWidgetStates(node) {
            if (!node.widgets || !node.properties.correctWidgetStates) return;

            const correctStates = node.properties.correctWidgetStates;

            // 应用正确的状态到控件
            for (const widget of node.widgets) {
                if ((widget.name === "invert_output" || widget.name?.startsWith("Layer_Mask_")) &&
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

        // 根据输入蒙版数量更新层数
        function updateLayerCount(node) {
            const masksInput = node.inputs?.find(i => i.name === "masks");
            if (masksInput && masksInput.link) {
                const link = app.graph.links[masksInput.link];
                if (link) {
                    const inputNode = app.graph.getNodeById(link.origin_id);
                    const inputData = inputNode?.outputs?.[link.origin_slot]?.value;
                    if (inputData && inputData.shape) {
                        const batchSize = Math.min(inputData.shape[0] || 1, MAX_LAYER_COUNT);
                        if (batchSize > node.layerCount) {
                            node.layerCount = batchSize;
                            node.rebuildWidgets();
                            if (DEBUG) console.log(`Node ${node.id}: Updated layerCount to ${batchSize}`);
                        }
                    }
                }
            }
        }

        const origOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = async function () {
            try {
                if (origOnNodeCreated) origOnNodeCreated.apply(this);
                await ensureNodeId(this);
                this.resizable = false;
                this.properties = this.properties || {};

                const buttonContainer = document.createElement("div");
                buttonContainer.className = "xis-canvas-mask-buttons";
                buttonContainer.dataset.nodeId = this.id;

                const addButton = document.createElement("button");
                addButton.innerText = "Add Layer";
                addButton.className = "xis-canvas-mask-button";
                addButton.onclick = () => {
                    if (this.layerCount < MAX_LAYER_COUNT) {
                        this.layerCount++;
                        this.rebuildWidgets();
                        app.graph.setDirtyCanvas(true, false);
                        if (DEBUG) console.log(`Node ${this.id}: Added layer, total: ${this.layerCount}`);
                    }
                };
                buttonContainer.appendChild(addButton);

                const removeButton = document.createElement("button");
                removeButton.innerText = "Remove Layer";
                removeButton.className = "xis-canvas-mask-button";
                removeButton.onclick = () => {
                    if (this.layerCount > 1) {
                        this.layerCount--;
                        this.rebuildWidgets();
                        app.graph.setDirtyCanvas(true, false);
                        if (DEBUG) console.log(`Node ${this.id}: Removed layer, total: ${this.layerCount}`);
                    }
                };
                buttonContainer.appendChild(removeButton);

                // 添加按钮控件到最上方 - 使用before参数强制在最上方
                this.addDOMWidget("buttons", "buttons", buttonContainer, { before: "invert_output" });

                if (DEBUG) console.log(`Node ${this.id}: Added buttons DOM widget, current widgets:`, this.widgets?.map(w => w.name));

                // 初始化固定宽度与 spacer 高度，但不暴露 UI 控件
                this.properties.fixedWidth = getFixedWidth(this, this.properties.fixedWidth || this.size?.[0] || MIN_WIDTH);
                this.properties.spacerHeight = getSpacerHeight(this);

                ensureBottomSpacer(this);
                reorderWidgets(this);
                this.setSize(this.computeSize());

                updateLayerCount(this);
                this.rebuildWidgets();
            } catch (error) {
                console.error(`Node ${this.id}: Error in onNodeCreated: ${error.message}`);
            }
        };

        const origOnConnectionsChange = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function (type, index, connected, link_info) {
            try {
                if (origOnConnectionsChange) origOnConnectionsChange.apply(this, arguments);
                if (type === "input" && link_info?.name === "masks" && connected) {
                    updateLayerCount(this);
                }
            } catch (error) {
                console.error(`Node ${this.id}: Error in onConnectionsChange: ${error.message}`);
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
                this.layerCount = Math.min(Math.max(1, this.layerCount || 1), MAX_LAYER_COUNT);

                // 1. 计算需要添加和删除的控件
                const existingNumbers = this.widgets
                    ?.filter(w => w.name?.startsWith("Layer_Mask_"))
                    .map(w => parseInt(w.name.replace("Layer_Mask_", "")))
                    .filter(num => !isNaN(num)) || [];

                const toRemove = existingNumbers.filter(num => num > this.layerCount);
                const toAdd = Array.from({length: this.layerCount}, (_, i) => i + 1)
                    .filter(num => !existingNumbers.includes(num))
                    .sort((a, b) => a - b); // 确保按数字顺序添加

                if (DEBUG) {
                    console.log(`Node ${this.id}: Layer count: ${this.layerCount}, Existing: ${existingNumbers}, To remove: ${toRemove}, To add: ${toAdd}`);
                }

                // 2. 批量删除不需要的控件（带清理）- 使用requestAnimationFrame减少闪烁
                if (toRemove.length > 0) {
                    requestAnimationFrame(() => {
                        toRemove.forEach(num => {
                            const widgetName = `Layer_Mask_${num}`;
                            const widgetIndex = this.widgets?.findIndex(w => w.name === widgetName);
                            if (widgetIndex !== -1 && widgetIndex !== undefined) {
                                const widget = this.widgets[widgetIndex];
                                // 清理DOM元素
                                if (widget.element?.parentNode) {
                                    widget.element.parentNode.removeChild(widget.element);
                                }
                                // 清理事件监听器
                                if (widget.callback) {
                                    widget.callback = null;
                                }
                            }
                        });

                        this.widgets = this.widgets?.filter(w =>
                            !w.name?.startsWith("Layer_Mask_") ||
                            !toRemove.includes(parseInt(w.name.replace("Layer_Mask_", "")))
                        ) || [];
                    });
                }

                // 3. 批量添加新控件 - 使用requestAnimationFrame减少闪烁
                if (toAdd.length > 0) {
                    requestAnimationFrame(() => {
                        // 新增前移除 spacer，防止新控件被插到 spacer 下方
                        removeBottomSpacer(this);
                        toAdd.forEach(num => {
                            const widgetName = `Layer_Mask_${num}`;
                            const widget = ComfyWidgets.BOOLEAN(this, widgetName, ["BOOLEAN", { default: false }], app).widget;
                            // 状态将由状态修正机制恢复
                            if (DEBUG) console.log(`Node ${this.id}: Added widget ${widgetName}`);
                        });
                        ensureBottomSpacer(this);
                        reorderWidgets(this);
                    });
                }

                // 4. 确保底部占位 spacer 存在
                ensureBottomSpacer(this);

                // 5. 重新排列widgets数组，确保按钮在上、spacer在下
                reorderWidgets(this);

                // 6. 调整节点大小 - 使用requestAnimationFrame减少闪烁
                requestAnimationFrame(() => {
                    this.setSize(this.computeSize());
                    this.onResize?.();
                    app.graph.setDirtyCanvas(true, false);

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

                // 清理所有Layer_Mask控件 - 使用requestAnimationFrame减少闪烁
                requestAnimationFrame(() => {
                    removeBottomSpacer(this);
                    this.widgets = this.widgets?.filter(w => !w.name?.startsWith("Layer_Mask_")) || [];

                    // 重新创建所有控件 - 按数字顺序
                    for (let i = 1; i <= this.layerCount; i++) {
                        const widgetName = `Layer_Mask_${i}`;
                        ComfyWidgets.BOOLEAN(this, widgetName, ["BOOLEAN", { default: false }], app);
                    }

                    ensureBottomSpacer(this);
                    reorderWidgets(this);

                    // 调整节点大小
                    this.setSize(this.computeSize());
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
                    this.layerCount = 8;
                    this.properties = this.properties || {};
                    this.widgets = this.widgets?.filter(w => !w.name?.startsWith("Layer_Mask_")) || [];

                    // 创建默认控件 - 按数字顺序
                    for (let i = 1; i <= this.layerCount; i++) {
                        ComfyWidgets.BOOLEAN(this, `Layer_Mask_${i}`, ["BOOLEAN", { default: false }], app);
                    }

                    ensureBottomSpacer(this);
                    reorderWidgets(this);

                    // 重置节点大小
                    this.setSize(this.computeSize());
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
                data.properties.layerCount = this.layerCount;
                data.properties.width = this.size[0];
                data.properties.fixedWidth = this.properties?.fixedWidth || this.size[0];
                data.properties.spacerHeight = this.properties?.spacerHeight ?? DEFAULT_SPACER_HEIGHT;

                // 记录正确的控件状态用于修正
                const correctStates = {};

                // 记录 invert_output 状态
                const invertOutputWidget = this.widgets.find(w => w.name === "invert_output");
                if (invertOutputWidget) {
                    correctStates["invert_output"] = invertOutputWidget.value;
                }

                // 记录 Layer_Mask 状态
                for (let i = 1; i <= this.layerCount; i++) {
                    const widgetName = `Layer_Mask_${i}`;
                    const widget = this.widgets.find(w => w.name === widgetName);
                    if (widget) {
                        correctStates[widgetName] = widget.value;
                    }
                }
                data.properties.correctWidgetStates = correctStates;

                // 重新启用 widgets_values，但确保顺序正确
                // 按数字顺序序列化 Layer_Mask 控件状态
                const layerWidgets = Array.from({length: this.layerCount}, (_, i) => i + 1)
                    .map(num => `Layer_Mask_${num}`)
                    .map(name => this.widgets.find(w => w.name === name))
                    .filter(w => w !== undefined);

                data.widgets_values = layerWidgets.map(w => w.value);

                if (DEBUG) console.log(`Node ${this.id}: Serialized correctWidgetStates: ${JSON.stringify(data.properties.correctWidgetStates)}, widgets_values: ${data.widgets_values}`);
                return data;
            } catch (error) {
                console.error(`Node ${this.id}: Error in serialize: ${error.message}`);
                // 返回最小化的有效数据
                return {
                    properties: {
                        layerCount: this.layerCount || 8,
                        width: this.size[0],
                        fixedWidth: this.properties?.fixedWidth || this.size[0],
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
                    this.layerCount = Math.min(MAX_LAYER_COUNT, Math.max(1, parseInt(config.properties.layerCount) || 8));
                    this.properties.fixedWidth = getFixedWidth(this, parseInt(config.properties.fixedWidth) || this.size?.[0] || MIN_WIDTH);
                    this.properties.spacerHeight = Math.max(0, parseInt(config.properties.spacerHeight) || DEFAULT_SPACER_HEIGHT);

                    if (config.properties.width) {
                        const width = parseInt(config.properties.width);
                        if (width > 0) {
                            const size = this.computeSize([width, 0]);
                            this.setSize([width, size[1]]);
                        } else {
                            this.setSize(this.computeSize());
                        }
                    } else {
                        this.setSize(this.computeSize());
                    }
                }

                // 延迟重建以确保DOM已准备好
                setTimeout(() => {
                    try {
                        this.rebuildWidgets();

                        // 执行状态修正 - 这会修正所有控件的状态
                        correctWidgetStates(this);

                        if (DEBUG) console.log(`Node ${this.id}: Configured with correctWidgetStates: ${JSON.stringify(config.properties?.correctWidgetStates)}, Widgets: ${this.widgets.map(w => `${w.name}: ${w.value}`)}`);
                    } catch (rebuildError) {
                        console.error(`Node ${this.id}: Error during rebuild in onConfigure:`, rebuildError);
                    }
                }, 50);

            } catch (error) {
                console.error(`Node ${this.id}: Error in onConfigure: ${error.message}`);
                // 尝试基本恢复
                try {
                    this.layerCount = 8;
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
                const container = document.querySelector(`.xis-canvas-mask-buttons[data-nodeId="${this.id}"]`);
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
                const layerWidgets = Array.from({length: this.layerCount}, (_, i) => i + 1)
                    .map(num => `Layer_Mask_${num}`)
                    .map(name => this.widgets.find(w => w.name === name))
                    .filter(w => w !== undefined);

                this.widgets_values = layerWidgets.map(w => w.value);
                if (DEBUG) console.log(`Node ${this.id}: Executing with widgets_values: ${this.widgets_values}`);
            } catch (error) {
                console.error(`Node ${this.id}: Error in onExecute: ${error.message}`);
            }
        };
    }
});
