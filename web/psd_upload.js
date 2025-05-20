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

        // 获取 PSD 文件列表
        async function fetchPsdFiles() {
          try {
            // 防止缓存
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
          const uploadedFileWidget = node.widgets.find(w => w.name === "uploaded_file");
          if (uploadedFileWidget) {
            uploadedFileWidget.value = value;
            app.graph.setDirtyCanvas(true);
            console.log(`[XIS_PSDLayerExtractor] Selected PSD file: ${value}`);
          }
        }, {
          values: () => cachedFiles, // 使用缓存
          multiselect: false
        });

        // 初始加载文件列表
        fetchPsdFiles().then(() => {
          fileListWidget.options.values = cachedFiles;
          app.graph.setDirtyCanvas(true); // 强制重绘
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
            progressBar.appendChild(progressFill);
            const progressText = document.createElement("div");
            progressText.className = `${NAMESPACE}_progress_text`;
            progressText.textContent = "Uploading: 0%";
            progressContainer.appendChild(progressBar);
            progressContainer.appendChild(progressText);

            // 添加样式到文档
            if (!document.getElementById(`${NAMESPACE}_styles`)) {
              const styleElement = document.createElement("style");
              styleElement.id = `${NAMESPACE}_styles`;
              styleElement.textContent = styles;
              document.head.appendChild(styleElement);
            }

            // 添加进度条到节点
            const progressWidget = node.addDOMWidget(
              `${NAMESPACE}_progress`,
              "progress",
              progressContainer,
              { serialize: false }
            );
            progressContainer.style.display = "block";

            // 使用 XMLHttpRequest 监听上传进度
            const xhr = new XMLHttpRequest();
            xhr.open("POST", "/upload/image?subfolder=psd_files", true);

            xhr.upload.onprogress = (event) => {
              if (event.lengthComputable) {
                const percent = (event.loaded / event.total) * 100;
                progressFill.style.width = `${percent}%`;
                progressText.textContent = `Uploading: ${Math.round(percent)}%`;
                console.log(`[XIS_PSDLayerExtractor] Progress: ${Math.round(percent)}%`);
              }
            };

            xhr.onload = async () => {
              if (xhr.status === 200) {
                try {
                  const result = JSON.parse(xhr.responseText);
                  console.log(`[XIS_PSDLayerExtractor] Upload response:`, result);
                  if (result.name && result.type === "input") {
                    // 处理 subfolder 为空的情况
                    const subfolder = result.subfolder ? result.subfolder : "psd_files";
                    const file_path = `input/${subfolder}/${result.name}`.replace(/\/+/g, "/");
                    const uploadedFileWidget = node.widgets.find(w => w.name === "uploaded_file");
                    if (uploadedFileWidget) {
                      uploadedFileWidget.value = file_path;
                      app.graph.setDirtyCanvas(true);
                    } else {
                      throw new Error("Uploaded file widget not found");
                    }

                    // 立即刷新文件列表，重试最多 3 次
                    let attempts = 0;
                    const maxAttempts = 3;
                    while (attempts < maxAttempts) {
                      await fetchPsdFiles();
                      if (cachedFiles.includes(file_path)) {
                        break;
                      }
                      attempts++;
                      console.log(`[XIS_PSDLayerExtractor] Retry fetchPsdFiles (${attempts}/${maxAttempts})`);
                      await new Promise(resolve => setTimeout(resolve, 500)); // 等待 500ms
                    }

                    // 更新下拉列表
                    fileListWidget.options.values = cachedFiles;
                    fileListWidget.value = file_path;
                    app.graph.setDirtyCanvas(true); // 强制重绘

                    // 显示成功状态
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
                    }, 1500); // 1.5 秒后隐藏
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
                  }, 3000); // 错误状态保持 3 秒
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

            // 发送请求
            const formData = new FormData();
            formData.append("image", file, file.name);
            console.log(`[XIS_PSDLayerExtractor] Uploading file: ${file.name}`);
            xhr.send(formData);
          };
          input.click();
        });

        // 确保按钮始终可见
        uploadButton.dynamic = true;
      };
    }
  },
});