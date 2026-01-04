import { app } from "/scripts/app.js";

const DEBUG = false; // 调试模式开关
const MAX_IMAGE_COUNT = 20; // 最大支持20个图像输入

app.registerExtension({
    name: "XISER.XIS_DynamicImageInputs",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "XIS_DynamicImageInputs") return;

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
                if (!input || !input.name.startsWith('image_')) {
                    if (DEBUG) console.log(`Node ${this.id}: Input at index ${index} is not an image input (name: ${input?.name})`);
                    return; // 不是image输入端口，不处理
                }

                if (!connected) { // 断开连接
                    // 参考impact-pack实现：检查堆栈，避免在程序化断开时删除端口
                    // 注意：loadGraphData已经在方法开始时检查过了
                    if (
                        stackTrace.includes('LGraphNode.prototype.connect') || // 触摸设备
                        stackTrace.includes('LGraphNode.connect') // 鼠标设备
                    ) {
                        if (DEBUG) console.log(`Node ${this.id}: Ignoring programmatic disconnect`);
                        return;
                    }

                    // 确保至少保留一个输入端口
                    const imageInputs = this.inputs.filter(input => input.name.startsWith('image_'));
                    if (imageInputs.length <= 1) {
                        if (DEBUG) console.log(`Node ${this.id}: Cannot remove last image input`);
                        return;
                    }

                    // 移除断开的输入端口 - 防御性编程
                    // 再次检查所有条件，避免ComfyUI内部状态不一致
                    if (index < 0 || index >= this.inputs.length) {
                        if (DEBUG) console.log(`Node ${this.id}: Cannot remove input at invalid index ${index}, inputs length: ${this.inputs.length}`);
                        return;
                    }

                    // 再次确认输入端口仍然存在且是image端口
                    const currentInput = this.inputs[index];
                    if (!currentInput || !currentInput.name.startsWith('image_')) {
                        if (DEBUG) console.log(`Node ${this.id}: Input at index ${index} is no longer an image input (name: ${currentInput?.name})`);
                        return;
                    }

                    // 再次确认至少保留一个端口
                    const currentImageInputs = this.inputs.filter(inp => inp.name.startsWith('image_'));
                    if (currentImageInputs.length <= 1) {
                        if (DEBUG) console.log(`Node ${this.id}: Cannot remove last image input (current count: ${currentImageInputs.length})`);
                        return;
                    }

                    if (DEBUG) console.log(`Node ${this.id}: Removing input ${currentInput.name} at index ${index}`);

                    try {
                        this.removeInput(index);
                    } catch (error) {
                        if (DEBUG) console.log(`Node ${this.id}: Error removing input: ${error.message}`);
                        // 不抛出错误，避免中断ComfyUI流程
                    }

                    // 重新编号所有image输入端口
                    this._renumberImageInputs();
                } else { // 连接建立
                    // 参考impact-pack实现：连接建立时总是添加新端口
                    const imageInputs = this.inputs.filter(input => input.name.startsWith('image_'));

                    // 检查是否已达到最大数量
                    if (imageInputs.length < MAX_IMAGE_COUNT) {
                        const newIndex = this.inputs.length;
                        const newName = `image_${imageInputs.length + 1}`;
                        if (DEBUG) console.log(`Node ${this.id}: Adding new input ${newName} at index ${newIndex}`);
                        this.addInput(newName, "IMAGE");
                    } else {
                        if (DEBUG) console.log(`Node ${this.id}: Maximum image count (${MAX_IMAGE_COUNT}) reached`);
                    }

                    // 重新编号所有image输入端口，确保名称连续
                    this._renumberImageInputs();
                }
            }
        };

        // 辅助方法：重新编号所有image输入端口
        nodeType.prototype._renumberImageInputs = function () {
            const imageInputs = this.inputs.filter(input => input.name.startsWith('image_'));

            // 按当前顺序重新编号
            for (let i = 0; i < imageInputs.length; i++) {
                const newName = `image_${i + 1}`;
                if (imageInputs[i].name !== newName) {
                    if (DEBUG) console.log(`Node ${this.id}: Renaming ${imageInputs[i].name} to ${newName}`);
                    imageInputs[i].name = newName;
                }
            }
        };

        // 节点创建时的初始化
        const origOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            if (origOnNodeCreated) {
                origOnNodeCreated.apply(this);
            }

            if (DEBUG) console.log(`Node ${this.id}: XIS_DynamicImageInputs node created`);

            // 确保至少有一个image输入端口
            const hasImageInput = this.inputs?.some(input => input.name.startsWith('image_'));
            if (!hasImageInput) {
                if (DEBUG) console.log(`Node ${this.id}: Adding initial image_1 input`);
                this.addInput("image_1", "IMAGE");
            }
        };

        // 序列化时保存当前状态
        const origSerialize = nodeType.prototype.serialize;
        nodeType.prototype.serialize = function () {
            const data = origSerialize ? origSerialize.apply(this) : {};

            // 保存当前image输入端口的数量
            const imageInputCount = this.inputs?.filter(input => input.name.startsWith('image_')).length || 1;
            data.properties = data.properties || {};
            data.properties.imageInputCount = imageInputCount;

            if (DEBUG) console.log(`Node ${this.id}: Serialized with ${imageInputCount} image inputs`);
            return data;
        };

        // 加载时恢复状态
        const origOnConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (config) {
            if (origOnConfigure) {
                origOnConfigure.apply(this, [config]);
            }

            // 恢复image输入端口的数量
            const savedCount = config.properties?.imageInputCount;
            if (savedCount && savedCount >= 1) {
                // 确保有正确数量的输入端口
                const currentCount = this.inputs?.filter(input => input.name.startsWith('image_')).length || 1;

                if (DEBUG) console.log(`Node ${this.id}: Configuring - saved: ${savedCount}, current: ${currentCount}`);

                if (currentCount < savedCount) {
                    // 添加缺少的输入端口
                    if (DEBUG) console.log(`Node ${this.id}: Adding ${savedCount - currentCount} missing image inputs`);
                    for (let i = currentCount; i < savedCount; i++) {
                        const newName = `image_${i + 1}`;
                        this.addInput(newName, "IMAGE");
                    }
                }
                // 注意：如果currentCount > savedCount，我们不移除端口
                // 因为可能有些端口正在使用中，移除会导致连接丢失

                // 重新编号所有端口
                this._renumberImageInputs();
            }
        };
    }
});