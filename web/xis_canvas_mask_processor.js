import { app } from "/scripts/app.js";
import { ComfyWidgets } from "/scripts/widgets.js";

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

        async function ensureNodeId(node) {
            let attempts = 0;
            const maxAttempts = 100;
            while (node.id === -1 && attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 50));
                attempts++;
            }
            if (node.id === -1) throw new Error("Failed to get valid node ID");
            return node.id;
        }

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
                            console.log(`Node ${node.id}: Updated layerCount to ${batchSize} for ${batchSize} masks`);
                        }
                    }
                }
            }
        }

        const origOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = async function () {
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
                app.graph.setDirtyCanvas(true, true);
                console.log(`Node ${this.id}: Added layer, total: ${this.layerCount}`);
            };
            buttonContainer.appendChild(addButton);

            const removeButton = document.createElement("button");
            removeButton.innerText = "Remove Layer";
            removeButton.className = "xis-canvas-mask-button";
            removeButton.onclick = () => {
                if (this.layerCount > 1) {
                    this.layerCount--;
                    this.rebuildWidgets();
                    app.graph.setDirtyCanvas(true, true);
                    console.log(`Node ${this.id}: Removed layer, total: ${this.layerCount}`);
                }
            };
            buttonContainer.appendChild(removeButton);

            this.addDOMWidget("buttons", "buttons", buttonContainer, { after: "invert_output" });

            updateLayerCount(this);
            this.rebuildWidgets();
        };

        const origOnConnectionsChange = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function (type, index, connected, link_info) {
            if (origOnConnectionsChange) origOnConnectionsChange.apply(this, arguments);
            if (type === "input" && link_info?.name === "masks" && connected) {
                updateLayerCount(this);
            }
        };

        nodeType.prototype.rebuildWidgets = function () {
            const currentValues = {};
            for (const widget of this.widgets || []) {
                if (widget.name.startsWith("Layer_Mask_")) {
                    currentValues[widget.name] = widget.value;
                }
            }

            this.widgets = this.widgets?.filter(w => !w.name.startsWith("Layer_Mask_")) || [];

            for (let i = 1; i <= this.layerCount; i++) {
                const widgetName = `Layer_Mask_${i}`;
                const widget = ComfyWidgets.BOOLEAN(this, widgetName, ["BOOLEAN", { default: false }], app).widget;
                if (widgetName in currentValues) {
                    widget.value = currentValues[widgetName];
                }
            }

            // 保存控件状态
            this.properties.widgetValues = currentValues;

            // 仅调整高度，保留宽度
            const newSize = this.computeSize();
            this.setSize([this.size[0], Math.max(newSize[1], 150)]);
            this.onResize?.();
            app.graph.setDirtyCanvas(true, true);
            console.log(`Node ${this.id}: Resized to ${this.size}, Widgets: ${this.widgets.map(w => `${w.name}: ${w.value}`)}`);
        };

        // 序列化节点状态
        const origSerialize = nodeType.prototype.serialize;
        nodeType.prototype.serialize = function () {
            const data = origSerialize ? origSerialize.apply(this) : {};
            data.properties = data.properties || {};
            data.properties.layerCount = this.layerCount;
            data.properties.widgetValues = {};
            for (const widget of this.widgets || []) {
                if (widget.name.startsWith("Layer_Mask_")) {
                    data.properties.widgetValues[widget.name] = widget.value;
                }
            }
            data.widgets_values = this.widgets ? this.widgets.map(w => w.value) : [];
            return data;
        };

        // 加载节点状态
        const origOnConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (config) {
            if (origOnConfigure) origOnConfigure.apply(this, [config]);
            if (config.properties?.layerCount) {
                this.layerCount = config.properties.layerCount;
            }
            if (config.properties?.widgetValues) {
                this.properties.widgetValues = config.properties.widgetValues;
            }
            this.rebuildWidgets();
            if (config.widgets_values && this.widgets) {
                for (let i = 0; i < Math.min(config.widgets_values.length, this.widgets.length); i++) {
                    this.widgets[i].value = config.widgets_values[i];
                }
            }
        };

        const origOnRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            if (origOnRemoved) origOnRemoved.apply(this);
            const container = document.querySelector(`.xis-canvas-mask-buttons[data-nodeId="${this.id}"]`);
            if (container) container.remove();
        };

        // 确保控件值在执行时传递
        const origOnExecute = nodeType.prototype.onExecute;
        nodeType.prototype.onExecute = function () {
            if (origOnExecute) origOnExecute.apply(this);
            this.widgets_values = this.widgets ? this.widgets.map(w => w.value) : [];
            console.log(`Node ${this.id}: Executing with widgets_values: ${this.widgets_values}`);
        };
    }
});