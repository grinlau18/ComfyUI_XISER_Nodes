import { app } from "/scripts/app.js";

const MAX_PAIRS = 20; // 最大支持20对image/mask输入

app.registerExtension({
    name: "XISER.XIS_DynamicPackImages",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "XIS_DynamicPackImages") return;

        // 重写onConnectionsChange方法来实现动态端口增减
        const onConnectionsChange = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function (type, index, connected, link_info) {
            // 调用原始方法（如果有）
            if (onConnectionsChange) {
                onConnectionsChange.apply(this, arguments);
            }

            // 参考impact-pack：在加载工作流期间直接返回，避免重复添加端口
            const stackTrace = new Error().stack;
            if (stackTrace.includes('loadGraphData')) {
                if (DEBUG) console.log(`Node ${this.id}: Ignoring connections change during graph load`);
                return;
            }

            // 安全检查：确保this.inputs存在
            if (!this.inputs) {
                if (DEBUG) console.log(`Node ${this.id}: this.inputs is undefined`);
                return;
            }

            if (DEBUG) {
                console.log(`Node ${this.id}: onConnectionsChange called`, {
                    type, index, connected,
                    link_info,
                    inputs: this.inputs?.map(i => ({name: i.name, type: i.type})),
                    stack: stackTrace
                });
            }

            // 如果没有连接信息，直接返回
            if (!link_info) {
                return;
            }

            // type: 1 = input, 2 = output
            if (type === 1) { // 输入连接变化
                // 安全地获取输入端口 - 检查索引是否有效
                if (index < 0 || index >= this.inputs.length) {
                    if (DEBUG) console.log(`Node ${this.id}: Invalid input index ${index}, inputs length: ${this.inputs.length}`);
                    return;
                }

                const input = this.inputs[index];
                if (!input) {
                    if (DEBUG) console.log(`Node ${this.id}: Input at index ${index} is undefined`);
                    return;
                }

                // 只处理image_*端口的连接变化
                if (!input.name.startsWith('image_')) {
                    if (DEBUG) console.log(`Node ${this.id}: Input at index ${index} is not an image input (name: ${input.name})`);
                    return;
                }

                if (!connected) { // 断开连接
                    // 参考impact-pack实现：检查堆栈，避免在程序化断开时删除端口
                    if (
                        stackTrace.includes('LGraphNode.prototype.connect') || // 触摸设备
                        stackTrace.includes('LGraphNode.connect') // 鼠标设备
                    ) {
                        if (DEBUG) console.log(`Node ${this.id}: Ignoring programmatic disconnect`);
                        return;
                    }

                    // 确保至少保留一对image/mask输入
                    const imageInputs = this.inputs.filter(input => input.name.startsWith('image_'));
                    if (imageInputs.length <= 1) {
                        if (DEBUG) console.log(`Node ${this.id}: Cannot remove last image/mask pair`);
                        return;
                    }

                    // 移除断开的image端口和对应的mask端口
                    this._removeImageMaskPair(index);

                    // 重新编号所有image/mask端口对
                    this._renumberImageMaskPairs();
                } else { // 连接建立
                    // 参考impact-pack实现：连接建立时总是添加新端口对
                    const imageInputs = this.inputs.filter(input => input.name.startsWith('image_'));

                    // 检查是否已达到最大数量
                    if (imageInputs.length < MAX_PAIRS) {
                        const newPairIndex = imageInputs.length + 1;
                        if (DEBUG) console.log(`Node ${this.id}: Adding new image/mask pair ${newPairIndex}`);
                        this._addImageMaskPair(newPairIndex);
                    } else {
                        if (DEBUG) console.log(`Node ${this.id}: Maximum image/mask pairs (${MAX_PAIRS}) reached`);
                    }

                    // 重新编号所有image/mask端口对，确保名称连续
                    this._renumberImageMaskPairs();
                }
            }
        };

        // 辅助方法：添加一对image/mask端口
        nodeType.prototype._addImageMaskPair = function (pairIndex) {
            const imageName = `image_${pairIndex}`;
            const maskName = `mask_${pairIndex}`;

            // 添加image端口
            this.addInput(imageName, "IMAGE");

            // 添加对应的mask端口
            this.addInput(maskName, "MASK");

            if (DEBUG) console.log(`Node ${this.id}: Added image/mask pair ${pairIndex}`);
        };

        // 辅助方法：移除一对image/mask端口
        nodeType.prototype._removeImageMaskPair = function (imageIndex) {
            // 获取image端口的名称
            const imageInput = this.inputs[imageIndex];
            if (!imageInput || !imageInput.name.startsWith('image_')) {
                if (DEBUG) console.log(`Node ${this.id}: Cannot find image input at index ${imageIndex}`);
                return;
            }

            // 提取编号
            const pairNumber = parseInt(imageInput.name.split('_')[1]);

            // 查找对应的mask端口
            const maskIndex = this.inputs.findIndex(input =>
                input.name === `mask_${pairNumber}`
            );

            if (DEBUG) console.log(`Node ${this.id}: Removing image/mask pair ${pairNumber} (image at ${imageIndex}, mask at ${maskIndex})`);

            // 先移除mask端口（如果存在）
            if (maskIndex !== -1) {
                try {
                    this.removeInput(maskIndex);
                } catch (error) {
                    if (DEBUG) console.log(`Node ${this.id}: Error removing mask input: ${error.message}`);
                }
            }

            // 再移除image端口
            try {
                this.removeInput(imageIndex);
            } catch (error) {
                if (DEBUG) console.log(`Node ${this.id}: Error removing image input: ${error.message}`);
            }
        };

        // 辅助方法：重新编号所有image/mask端口对
        nodeType.prototype._renumberImageMaskPairs = function () {
            // 收集所有image和mask端口
            const imageInputs = this.inputs.filter(input => input.name.startsWith('image_'));
            const maskInputs = this.inputs.filter(input => input.name.startsWith('mask_'));

            // 按当前顺序重新编号image端口
            for (let i = 0; i < imageInputs.length; i++) {
                const newImageName = `image_${i + 1}`;
                if (imageInputs[i].name !== newImageName) {
                    if (DEBUG) console.log(`Node ${this.id}: Renaming ${imageInputs[i].name} to ${newImageName}`);
                    imageInputs[i].name = newImageName;
                }
            }

            // 按当前顺序重新编号mask端口
            for (let i = 0; i < maskInputs.length; i++) {
                const newMaskName = `mask_${i + 1}`;
                if (maskInputs[i].name !== newMaskName) {
                    if (DEBUG) console.log(`Node ${this.id}: Renaming ${maskInputs[i].name} to ${newMaskName}`);
                    maskInputs[i].name = newMaskName;
                }
            }

            // 确保image和mask端口数量匹配
            if (imageInputs.length !== maskInputs.length) {
                if (DEBUG) console.log(`Node ${this.id}: Warning: image count (${imageInputs.length}) != mask count (${maskInputs.length})`);

                // 如果mask端口少于image端口，添加缺少的mask端口
                for (let i = maskInputs.length; i < imageInputs.length; i++) {
                    const maskName = `mask_${i + 1}`;
                    if (DEBUG) console.log(`Node ${this.id}: Adding missing mask port: ${maskName}`);
                    this.addInput(maskName, "MASK");
                }
            }
        };

        // 节点创建时的初始化
        const origOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            if (origOnNodeCreated) {
                origOnNodeCreated.apply(this);
            }

            if (DEBUG) console.log(`Node ${this.id}: XIS_DynamicPackImages node created`);

            // 确保至少有一对image/mask输入端口
            const hasImageInput = this.inputs?.some(input => input.name.startsWith('image_'));
            if (!hasImageInput) {
                if (DEBUG) console.log(`Node ${this.id}: Adding initial image_1/mask_1 pair`);
                this._addImageMaskPair(1);
            }
        };

        // 序列化时保存当前状态
        const origSerialize = nodeType.prototype.serialize;
        nodeType.prototype.serialize = function () {
            const data = origSerialize ? origSerialize.apply(this) : {};

            // 保存当前image输入端口的数量（mask端口数量会自动匹配）
            const imageInputCount = this.inputs?.filter(input => input.name.startsWith('image_')).length || 1;
            data.properties = data.properties || {};
            data.properties.imageInputCount = imageInputCount;

            if (DEBUG) console.log(`Node ${this.id}: Serialized with ${imageInputCount} image/mask pairs`);
            return data;
        };

        // 加载时恢复状态
        const origOnConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (config) {
            if (origOnConfigure) {
                origOnConfigure.apply(this, [config]);
            }

            // 恢复image/mask端口对的数量
            const savedCount = config.properties?.imageInputCount;
            if (savedCount && savedCount >= 1) {
                // 确保有正确数量的输入端口对
                const currentCount = this.inputs?.filter(input => input.name.startsWith('image_')).length || 1;

                if (DEBUG) console.log(`Node ${this.id}: Configuring - saved: ${savedCount}, current: ${currentCount}`);

                if (currentCount < savedCount) {
                    // 添加缺少的image/mask端口对
                    if (DEBUG) console.log(`Node ${this.id}: Adding ${savedCount - currentCount} missing image/mask pairs`);
                    for (let i = currentCount; i < savedCount; i++) {
                        this._addImageMaskPair(i + 1);
                    }
                }
                // 注意：如果currentCount > savedCount，我们不移除端口对
                // 因为可能有些端口正在使用中，移除会导致连接丢失

                // 重新编号所有端口对
                this._renumberImageMaskPairs();
            }
        };
    }
});