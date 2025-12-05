## 解决滚轮缩放/旋转与 ComfyUI 画布缩放冲突的要点与可复用方案。

问题现象

在 Vue 版 ComfyUI 中，LiteGraph 的全局滚轮监听会对主画布进行缩放，导致节点自定义画布的滚轮缩放/旋转失效或触发主界面缩放。
捕获阶段不当的事件拦截或重新派发，会让 Konva 收不到正确的原生事件或 LiteGraph 仍然接管事件。
前端处理方案（适用于 Konva 画布类节点）

封装统一的滚轮处理函数 handleWheel(evt)：

获取当前选中图层（nodeState.transformer.nodes()[0]），若无则直接返回。
支持 Alt+滚轮旋转，普通滚轮缩放，限制缩放范围。
实时同步 image_states 到 widgets 与 node.properties，并调用 updateHistory。
在节点容器添加捕获阶段的滚轮拦截：

对节点容器 stageContainer 的 wheel 事件使用 { capture: true, passive: false }。
在回调中 preventDefault/stopPropagation/stopImmediatePropagation，并直接调用 handleWheel(evt)，不再依赖事件冒泡到 Konva 后再处理。
增加全局捕获兜底（窗口级）以屏蔽 LiteGraph：

window.addEventListener('wheel', globalWheelCapture, { capture: true, passive: false })。
若 stageWrapper.contains(evt.target) 则阻断事件并调用 handleWheel(evt)。
在销毁节点时记得移除该全局监听，避免泄漏。
保留 Konva 的 stage.on('wheel') 作为兜底：

对 Konva 监听的回调同样 preventDefault/stopPropagation 并调用 handleWheel(e.evt)，防止漏网事件。
其他事件拦截的原则：

指针/触摸事件在捕获阶段只做 stopPropagation/stopImmediatePropagation，不再重放或改写事件对象，避免干扰 Konva 自身逻辑。
设置容器样式 touchAction: 'none'、userSelect: 'none'，减少浏览器默认手势干扰。

## 后端配合（与前端变换一致）

变换顺序：以图像中心为原点，先缩放再旋转（PIL 用逆时针，需取相反角度匹配 Konva 的顺时针），让 PIL 自行扩展边界避免裁剪。
位置坐标：前端坐标在含边框的舞台坐标系，落到后端时需减去 border_width 转为画布内坐标，再以图像中心计算粘贴位置。
输出：直接输出画布尺寸（不含边框）的图像，避免多余留白。
注意事项

捕获阶段 stopImmediatePropagation 是阻断 LiteGraph 的关键；但事件本身的处理应直接调用自定义逻辑，而不是再派发“假的” Konva 事件。
全局捕获需要在节点销毁时清理监听。
滚轮回调必须 passive: false 才能 preventDefault。
若有多节点同类画布，务必用 contains(evt.target) 限定作用域，避免相互干扰。
这样处理后，可以在自定义画布内安全接管滚轮缩放/旋转，不再触发 ComfyUI 主画布的缩放，同时保持前后端变换一致。

##“按下拖动误移动节点”的要点：

在节点画布容器（stageContainer）上，对 pointerdown/pointermove/pointerup/touchstart/touchmove/touchend 使用捕获阶段监听，回调内 stopPropagation/stopImmediatePropagation，阻断事件继续传到 LiteGraph 节点拖拽逻辑。容器样式设为 pointerEvents: auto、touchAction: none、userSelect: none，避免浏览器默认手势干扰。
Konva 层面：Transformer 选中图层后，拖拽发生在图层自身；通过上述捕获阻断，全局 LiteGraph 就不会“接管”拖拽，避免节点被拖动。
同样的捕获策略适用于滚轮（wheel 捕获+阻断+直接调用 handleWheel）以及其他需要专属处理的鼠标/触摸事件。
这样即可实现：鼠标按下并移动只作用于画布内的图层，不会误触 ComfyUI 节点的移动。