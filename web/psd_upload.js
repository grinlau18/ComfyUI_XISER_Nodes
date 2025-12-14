/**
 * Extension for uploading PSD files and extracting layers in ComfyUI.
 *
 * @module XIS_PSDLayerExtractor_Upload
 * @description Adds a PSD file uploader with progress bar and file selection combo box to the XIS_PSDLayerExtractor node.
 */

import { app } from "/scripts/app.js";

// 唯一的命名空间前缀
const NAMESPACE = "XIS_PSDLayerExtractor_Upload";

// 添加 CSS 样式
const styles = `
  .${NAMESPACE}_progress_container {
    width: 100%;
    margin-top: 5px;
    display: none;
    position: relative;
  }
  .${NAMESPACE}_progress_container.${NAMESPACE}_progress_container_visible {
    display: block !important;
  }
  .${NAMESPACE}_progress_bar {
    width: 100%;
    height: 20px;
    background-color: #e0e0e0;
    border-radius: 4px;
    overflow: hidden;
  }
  .${NAMESPACE}_progress_fill {
    height: 100%;
    background-color: #4caf50;
    transition: width 0.2s ease-in-out;
  }
  .${NAMESPACE}_progress_text {
    text-align: center;
    font-size: 12px;
    font-family: Arial, sans-serif;
    margin-top: 2px;
    color: #333;
    visibility: visible;
  }
  .${NAMESPACE}_success .${NAMESPACE}_progress_fill {
    background-color: #4caf50;
  }
  .${NAMESPACE}_success .${NAMESPACE}_progress_text {
    color: #4caf50;
  }
  .${NAMESPACE}_error .${NAMESPACE}_progress_fill {
    background-color: #f44336;
  }
  .${NAMESPACE}_error .${NAMESPACE}_progress_text {
    color: #f44336;
  }
`;

app.registerExtension({
  name: NAMESPACE,
  async beforeRegisterNodeDef(nodeType, nodeData, app) {
    if (nodeData.name === "XIS_PSDLayerExtractor") {
      nodeType.prototype.onNodeCreated = function () {
        // 保存节点上下文
        const node = this;

        // 缓存文件列表，避免频繁请求
        let cachedFiles = [];

        /**
         * Fetches the list of PSD files from the server.
         * @async
         * @returns {Promise<string[]>} List of PSD file paths
         */
        async function fetchPsdFiles() {
          try {
            const response = await fetch(`/custom/list_psd_files?t=${Date.now()}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            cachedFiles = data.files || [];
            console.log(`[XIS_PSDLayerExtractor] fetchPsdFiles response:`, cachedFiles);
            return cachedFiles;
          } catch (e) {
            console.error("[XIS_PSDLayerExtractor] Failed to fetch PSD files:", e.message);
            return cachedFiles;
          }
        }

        // 添加下拉列表
        const fileListWidget = node.addWidget("combo", "Select PSD File", "", (value) => {
          // 尝试多种方式设置文件路径值，兼容 v1 和 v3 节点
          let valueSet = false;

          // 方法1: 查找小部件 (v1 兼容)
          const uploadedFileWidget = node.widgets.find(w => w.name === "uploaded_file");
          if (uploadedFileWidget) {
            uploadedFileWidget.value = value;
            valueSet = true;
            console.log(`[XIS_PSDLayerExtractor] Set value via widget: ${value}`);
          }

          // 方法2: 直接设置节点属性 (v3 兼容)
          if (node.properties && typeof node.properties === 'object') {
            node.properties.uploaded_file = value;
            valueSet = true;
            console.log(`[XIS_PSDLayerExtractor] Set value via properties: ${value}`);
          }

          // 方法3: 设置节点输入值
          if (node.inputs && typeof node.inputs === 'object') {
            // 尝试设置输入值
            for (const input of node.inputs) {
              if (input.name === 'uploaded_file' || input.label === 'uploaded_file') {
                input.value = value;
                valueSet = true;
                console.log(`[XIS_PSDLayerExtractor] Set value via inputs: ${value}`);
                break;
              }
            }
          }

          // 方法4: 设置 widgets_values (v3 兼容 - 最重要的方法)
          if (Array.isArray(node.widgets_values)) {
            // 找到 uploaded_file 输入的索引
            let uploadedFileIndex = -1;
            if (node.inputs) {
              for (let i = 0; i < node.inputs.length; i++) {
                if (node.inputs[i].name === 'uploaded_file' || node.inputs[i].label === 'uploaded_file') {
                  uploadedFileIndex = i;
                  break;
                }
              }
            }
            if (uploadedFileIndex >= 0) {
              // 确保 widgets_values 数组足够长
              while (node.widgets_values.length <= uploadedFileIndex) {
                node.widgets_values.push("");
              }
              node.widgets_values[uploadedFileIndex] = value;
              valueSet = true;
              console.log(`[XIS_PSDLayerExtractor] Set value via widgets_values[${uploadedFileIndex}]: ${value}`);
            }
          }

          if (valueSet) {
            app.graph.setDirtyCanvas(true);
            console.log(`[XIS_PSDLayerExtractor] Selected PSD file: ${value}`);
          } else {
            console.warn(`[XIS_PSDLayerExtractor] Failed to set value: ${value}`);
          }
        }, {
          values: () => {
            console.log(`[XIS_PSDLayerExtractor] Combo values function called, returning:`, cachedFiles);
            return cachedFiles;
          },
          multiselect: false
        });

        // 初始加载文件列表
        fetchPsdFiles().then(() => {
          // 更新 cachedFiles，values 函数会自动返回最新值
          // 不需要直接设置 fileListWidget.options.values，因为 values 是一个函数
          app.graph.setDirtyCanvas(true);

          // 确保小部件正确初始化
          setTimeout(() => {
            if (fileListWidget.draw) {
              fileListWidget.draw();
            }
            app.graph.setDirtyCanvas(true, false);

            // 强制刷新combo小部件
            setTimeout(() => {
              if (fileListWidget.draw) {
                fileListWidget.draw();
              }
              app.graph.setDirtyCanvas(true, false);
            }, 50);
          }, 100);
        });

        // 添加上传按钮
        const uploadButton = node.addWidget("button", "Upload PSD File", null, () => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = ".psd";
          input.onchange = () => {
            if (input.files.length === 0) return;
            const file = input.files[0];
            if (!file.name.toLowerCase().endsWith('.psd')) {
              alert("Please select a PSD file");
              return;
            }

            // 移除现有的进度条 widget
            const widgetIndex = node.widgets.findIndex(w => w.name === `${NAMESPACE}_progress`);
            if (widgetIndex !== -1) {
              node.widgets.splice(widgetIndex, 1);
              console.log(`[XIS_PSDLayerExtractor] Removed existing progress widget at index ${widgetIndex}`);
            }

            // 创建进度条容器
            const progressContainer = document.createElement("div");
            progressContainer.className = `${NAMESPACE}_progress_container`;
            const progressBar = document.createElement("div");
            progressBar.className = `${NAMESPACE}_progress_bar`;
            const progressFill = document.createElement("div");
            progressFill.className = `${NAMESPACE}_progress_fill`;
            progressFill.style.width = "0%";
            progressFill.id = `${NAMESPACE}_progress_fill_${Date.now()}`; // 添加唯一ID用于调试
            progressBar.appendChild(progressFill);
            const progressText = document.createElement("div");
            progressText.className = `${NAMESPACE}_progress_text`;
            progressText.id = `${NAMESPACE}_progress_text_${Date.now()}`; // 添加唯一ID用于调试
            progressText.textContent = "Uploading: 0%";
            progressContainer.appendChild(progressBar);
            progressContainer.appendChild(progressText);

            // 调试：确保元素创建成功
            console.log(`[XIS_PSDLayerExtractor] Created progress elements:`, progressContainer, progressBar, progressFill, progressText);

            // 添加样式到文档
            if (!document.getElementById(`${NAMESPACE}_styles`)) {
              const styleElement = document.createElement("style");
              styleElement.id = `${NAMESPACE}_styles`;
              styleElement.textContent = styles;
              document.head.appendChild(styleElement);
            }

            // 添加进度条到节点
            console.log(`[XIS_PSDLayerExtractor] Adding progress DOM widget...`);
            const progressWidget = node.addDOMWidget(
              `${NAMESPACE}_progress`,
              "progress",
              progressContainer,
              { serialize: false }
            );
            console.log(`[XIS_PSDLayerExtractor] progressWidget created:`, progressWidget);
            // 确保进度条容器显示 - 使用CSS类控制显示
            progressContainer.classList.add(`${NAMESPACE}_progress_container_visible`);
            progressContainer.style.display = "block";
            console.log(`[XIS_PSDLayerExtractor] progressContainer display set to block`);

            // 强制重绘画布以确保DOM widget显示
            app.graph.setDirtyCanvas(true, false);
            setTimeout(() => {
              app.graph.setDirtyCanvas(true, false);
            }, 100);

            // 调试：检查节点的小部件列表
            console.log(`[XIS_PSDLayerExtractor] node.widgets after adding progress:`, node.widgets?.length, node.widgets);

            // 使用 XMLHttpRequest 监听上传进度
            const xhr = new XMLHttpRequest();
            xhr.open("POST", "/upload/image?subfolder=psd_files", true);

            xhr.upload.onprogress = (event) => {
              if (event.lengthComputable) {
                const percent = (event.loaded / event.total) * 100;
                // 确保元素仍然存在
                if (progressFill.parentNode && progressText.parentNode) {
                  // 使用 requestAnimationFrame 确保平滑动画
                  requestAnimationFrame(() => {
                    progressFill.style.width = `${percent}%`;
                    progressText.textContent = `Uploading: ${Math.round(percent)}%`;
                    console.log(`[XIS_PSDLayerExtractor] Progress: ${Math.round(percent)}%, fill element:`, progressFill);
                  });
                } else {
                  console.warn(`[XIS_PSDLayerExtractor] Progress elements not found in DOM`);
                }
              }
            };

            xhr.onload = async () => {
              if (xhr.status === 200) {
                try {
                  const result = JSON.parse(xhr.responseText);
                  console.log(`[XIS_PSDLayerExtractor] Upload response:`, result);
                  if (result.name && result.type === "input") {
                    const subfolder = result.subfolder ? result.subfolder : "psd_files";
                    const file_path = `input/${subfolder}/${result.name}`.replace(/\/+/g, "/");

                    // 尝试多种方式设置文件路径值，兼容 v1 和 v3 节点
                    let valueSet = false;

                    // 方法1: 查找小部件 (v1 兼容)
                    const uploadedFileWidget = node.widgets.find(w => w.name === "uploaded_file");
                    if (uploadedFileWidget) {
                      uploadedFileWidget.value = file_path;
                      valueSet = true;
                      console.log(`[XIS_PSDLayerExtractor] Upload success - set value via widget: ${file_path}`);
                    }

                    // 方法2: 直接设置节点属性 (v3 兼容)
                    if (node.properties && typeof node.properties === 'object') {
                      node.properties.uploaded_file = file_path;
                      valueSet = true;
                      console.log(`[XIS_PSDLayerExtractor] Upload success - set value via properties: ${file_path}`);
                    }

                    // 方法3: 设置节点输入值
                    if (node.inputs && typeof node.inputs === 'object') {
                      // 尝试设置输入值
                      for (const input of node.inputs) {
                        if (input.name === 'uploaded_file' || input.label === 'uploaded_file') {
                          input.value = file_path;
                          valueSet = true;
                          console.log(`[XIS_PSDLayerExtractor] Upload success - set value via inputs: ${file_path}`);
                          break;
                        }
                      }
                    }

                    // 方法4: 设置 widgets_values (v3 兼容 - 最重要的方法)
                    if (Array.isArray(node.widgets_values)) {
                      // 找到 uploaded_file 输入的索引
                      let uploadedFileIndex = -1;
                      if (node.inputs) {
                        for (let i = 0; i < node.inputs.length; i++) {
                          if (node.inputs[i].name === 'uploaded_file' || node.inputs[i].label === 'uploaded_file') {
                            uploadedFileIndex = i;
                            break;
                          }
                        }
                      }
                      if (uploadedFileIndex >= 0) {
                        // 确保 widgets_values 数组足够长
                        while (node.widgets_values.length <= uploadedFileIndex) {
                          node.widgets_values.push("");
                        }
                        node.widgets_values[uploadedFileIndex] = file_path;
                        valueSet = true;
                        console.log(`[XIS_PSDLayerExtractor] Upload success - set value via widgets_values[${uploadedFileIndex}]: ${file_path}`);
                      }
                    }

                    if (!valueSet) {
                      console.warn(`[XIS_PSDLayerExtractor] Upload success but failed to set value: ${file_path}`);
                      // 不抛出错误，继续执行
                    } else {
                      app.graph.setDirtyCanvas(true);
                    }

                    // 立即刷新文件列表
                    let attempts = 0;
                    const maxAttempts = 3;
                    while (attempts < maxAttempts) {
                      await fetchPsdFiles();
                      if (cachedFiles.includes(file_path)) {
                        break;
                      }
                      attempts++;
                      console.log(`[XIS_PSDLayerExtractor] Retry fetchPsdFiles (${attempts}/${maxAttempts})`);
                      await new Promise(resolve => setTimeout(resolve, 500));
                    }

                    // 调试：检查fileListWidget对象
                    console.log(`[XIS_PSDLayerExtractor] fileListWidget:`, fileListWidget);
                    console.log(`[XIS_PSDLayerExtractor] fileListWidget.options:`, fileListWidget?.options);
                    console.log(`[XIS_PSDLayerExtractor] cachedFiles:`, cachedFiles);
                    console.log(`[XIS_PSDLayerExtractor] file_path:`, file_path);

                    // 更新下拉列表值 - 不需要设置 options.values，因为 values 是函数
                    if (fileListWidget) {
                      fileListWidget.value = file_path;
                      console.log(`[XIS_PSDLayerExtractor] Updated fileListWidget: values=${cachedFiles.length}, value=${file_path}`);

                      // 尝试触发小部件重绘
                      if (fileListWidget.draw) {
                        fileListWidget.draw();
                        console.log(`[XIS_PSDLayerExtractor] Called fileListWidget.draw()`);
                      }

                      // 强制触发小部件的回调函数
                      if (fileListWidget.callback) {
                        fileListWidget.callback(file_path);
                        console.log(`[XIS_PSDLayerExtractor] Called fileListWidget.callback()`);
                      }

                      // 强制刷新combo小部件的显示
                      setTimeout(() => {
                        // 触发小部件重绘
                        if (fileListWidget.draw) {
                          fileListWidget.draw();
                        }
                        // 如果小部件有值，确保它在选项中
                        if (cachedFiles.includes(file_path)) {
                          fileListWidget.value = file_path;
                          console.log(`[XIS_PSDLayerExtractor] Ensured value is in options: ${file_path}`);
                        }
                        app.graph.setDirtyCanvas(true, false);
                      }, 50);
                    } else {
                      console.warn(`[XIS_PSDLayerExtractor] fileListWidget is null/undefined`);
                    }

                    // 强制刷新界面
                    app.graph.setDirtyCanvas(true, false);
                    console.log(`[XIS_PSDLayerExtractor] Called setDirtyCanvas(true, false)`);

                    // 额外的强制刷新，确保值被正确传递
                    setTimeout(() => {
                      app.graph.setDirtyCanvas(true, true);
                      console.log(`[XIS_PSDLayerExtractor] Called additional setDirtyCanvas(true, true)`);
                    }, 200);

                    // 额外刷新：尝试触发节点重绘
                    if (node.onDraw) {
                      node.onDraw();
                      console.log(`[XIS_PSDLayerExtractor] Called node.onDraw()`);
                    }
                    if (node.setDirty) {
                      node.setDirty();
                      console.log(`[XIS_PSDLayerExtractor] Called node.setDirty()`);
                    }

                    progressContainer.classList.add(`${NAMESPACE}_success`);
                    progressText.textContent = "Upload Successful!";
                    console.log("[XIS_PSDLayerExtractor] Upload successful:", file_path);
                    setTimeout(() => {
                      progressContainer.style.display = "none";
                      const index = node.widgets.indexOf(progressWidget);
                      if (index !== -1) {
                        node.widgets.splice(index, 1);
                        console.log(`[XIS_PSDLayerExtractor] Removed progress widget at index ${index}`);
                      }
                    }, 1500);
                  } else {
                    throw new Error(result.error || "Invalid upload response: No filename or type");
                  }
                } catch (e) {
                  progressContainer.classList.add(`${NAMESPACE}_error`);
                  progressText.textContent = `Error: ${e.message}`;
                  console.error("[XIS_PSDLayerExtractor] Upload error:", e.message);
                  setTimeout(() => {
                    progressContainer.style.display = "none";
                    const index = node.widgets.indexOf(progressWidget);
                    if (index !== -1) {
                      node.widgets.splice(index, 1);
                      console.log(`[XIS_PSDLayerExtractor] Removed progress widget at index ${index}`);
                    }
                  }, 3000);
                }
              } else {
                progressContainer.classList.add(`${NAMESPACE}_error`);
                progressText.textContent = `Error: HTTP ${xhr.status}`;
                console.error("[XIS_PSDLayerExtractor] HTTP error:", xhr.status);
                setTimeout(() => {
                  progressContainer.style.display = "none";
                  const index = node.widgets.indexOf(progressWidget);
                  if (index !== -1) {
                    node.widgets.splice(index, 1);
                    console.log(`[XIS_PSDLayerExtractor] Removed progress widget at index ${index}`);
                  }
                }, 3000);
              }
            };

            xhr.onerror = () => {
              progressContainer.classList.add(`${NAMESPACE}_error`);
              progressText.textContent = "Error: Network error";
              console.error("[XIS_PSDLayerExtractor] Network error");
              setTimeout(() => {
                progressContainer.style.display = "none";
                const index = node.widgets.indexOf(progressWidget);
                if (index !== -1) {
                  node.widgets.splice(index, 1);
                  console.log(`[XIS_PSDLayerExtractor] Removed progress widget at index ${index}`);
                }
              }, 3000);
            };

            const formData = new FormData();
            formData.append("image", file, file.name);
            console.log(`[XIS_PSDLayerExtractor] Uploading file: ${file.name}`);
            xhr.send(formData);
          };
          input.click();
        });

        uploadButton.dynamic = true;
      };
    }
  },
});