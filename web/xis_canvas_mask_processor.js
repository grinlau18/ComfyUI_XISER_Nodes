import { app } from "/scripts/app.js";
import { ComfyWidgets } from "/scripts/widgets.js";

const DEBUG = false; // 调试模式开关

app.registerExtension({
    name: "XISER.XIS_CanvasMaskProcessor",
    async setup() {
        const style = document.createElement("style");
        style.textContent = `
            div.xis-canvas-mask-buttons {
                display: flex;
                gap: 10px;
                margin: 10px 0;
                width: 100%;
                box-sizing: border-box;
                max-height: 30px !important;
                z-index: 1000;
            }
            div.xis-canvas-mask-buttons button.xis-canvas-mask-button {
                flex: 1;
                padding: 5px;
                background: #444;
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
                background: #555;
            }
        `;
        document.head.appendChild(style);
    },
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "XIS_CanvasMaskProcessor") return;

        nodeType.prototype.layerCount = 8;

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
                        const batchSize = inputData.shape[0] || 1;
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

                const buttonContainer = document.createElement("div");
                buttonContainer.className = "xis-canvas-mask-buttons";
                buttonContainer.dataset.nodeId = this.id;

                const addButton = document.createElement("button");
                addButton.innerText = "Add Layer";
                addButton.className = "xis-canvas-mask-button";
                addButton.onclick = () => {
                    this.layerCount++;
                    this.rebuildWidgets();
                    app.graph.setDirtyCanvas(true, false);
                    if (DEBUG) console.log(`Node ${this.id}: Added layer, total: ${this.layerCount}`);
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

                this.addDOMWidget("buttons", "buttons", buttonContainer, { after: "invert_output" });

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

        // 重建控件，仅更新高度
        nodeType.prototype.rebuildWidgets = function () {
            try {
                const currentValues = this.properties.widgetValues || {};
                this.widgets = this.widgets?.filter(w => !w.name.startsWith("Layer_Mask_")) || [];

                for (let i = 1; i <= this.layerCount; i++) {
                    const widgetName = `Layer_Mask_${i}`;
                    const widget = ComfyWidgets.BOOLEAN(this, widgetName, ["BOOLEAN", { default: false }], app).widget;
                    widget.value = currentValues[widgetName] === true;
                }

                this.properties.widgetValues = this.widgets.reduce((acc, w) => {
                    if (w.name.startsWith("Layer_Mask_")) {
                        acc[w.name] = !!w.value;
                    }
                    return acc;
                }, {});

                const newSize = this.computeSize();
                this.setSize([this.size[0], Math.max(newSize[1], 150)]);
                this.onResize?.();
                app.graph.setDirtyCanvas(true, false);
                if (DEBUG) console.log(`Node ${this.id}: Resized to ${this.size}, Widgets: ${this.widgets.map(w => `${w.name}: ${w.value}`)}`);
            } catch (error) {
                console.error(`Node ${this.id}: Error in rebuildWidgets: ${error.message}`);
            }
        };

        // 序列化节点状态
        const origSerialize = nodeType.prototype.serialize;
        nodeType.prototype.serialize = function () {
            try {
                const data = origSerialize ? origSerialize.apply(this) : {};
                data.properties = data.properties || {};
                data.properties.layerCount = this.layerCount;
                data.properties.width = this.size[0];
                data.properties.widgetValues = this.widgets.reduce((acc, w) => {
                    if (w.name.startsWith("Layer_Mask_")) {
                        acc[w.name] = !!w.value;
                    }
                    return acc;
                }, {});
                data.widgets_values = this.widgets.filter(w => w.name.startsWith("Layer_Mask_")).map(w => w.value);
                if (DEBUG) console.log(`Node ${this.id}: Serialized widgetValues: ${JSON.stringify(data.properties.widgetValues)}, widgets_values: ${data.widgets_values}`);
                return data;
            } catch (error) {
                console.error(`Node ${this.id}: Error in serialize: ${error.message}`);
                return {};
            }
        };

        // 加载节点状态
        const origOnConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (config) {
            try {
                if (origOnConfigure) origOnConfigure.apply(this, [config]);
                if (config.properties) {
                    this.layerCount = config.properties.layerCount || 8;
                    this.properties.widgetValues = config.properties.widgetValues || {};
                    if (config.properties.width) {
                        this.setSize([config.properties.width, this.size[1]]);
                    }
                }
                this.rebuildWidgets();
                for (const widget of this.widgets) {
                    if (widget.name.startsWith("Layer_Mask_") && this.properties.widgetValues[widget.name] !== undefined) {
                        widget.value = !!this.properties.widgetValues[widget.name];
                    }
                }
                if (DEBUG) console.log(`Node ${this.id}: Configured with widgetValues: ${JSON.stringify(this.properties.widgetValues)}, Widgets: ${this.widgets.map(w => `${w.name}: ${w.value}`)}`);
            } catch (error) {
                console.error(`Node ${this.id}: Error in onConfigure: ${error.message}`);
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
                this.widgets_values = this.widgets.filter(w => w.name.startsWith("Layer_Mask_")).map(w => w.value);
                if (DEBUG) console.log(`Node ${this.id}: Executing with widgets_values: ${this.widgets_values}`);
            } catch (error) {
                console.error(`Node ${this.id}: Error in onExecute: ${error.message}`);
            }
        };
    }
});