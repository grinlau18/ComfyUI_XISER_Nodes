import { app } from "/scripts/app.js";

app.registerExtension({
    name: "XIS_PSDLayerExtractor.Upload",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "XIS_PSDLayerExtractor") {
            nodeType.prototype.onNodeCreated = function () {
                const widget = this.addWidget("button", "Upload PSD File", null, () => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = ".psd";
                    input.onchange = async () => {
                        if (input.files.length > 0) {
                            const file = input.files[0];
                            if (!file.name.toLowerCase().endsWith('.psd')) {
                                alert("Please select a PSD file");
                                return;
                            }
                            const formData = new FormData();
                            formData.append("image", file, file.name);

                            try {
                                const response = await fetch("/upload/image", {
                                    method: "POST",
                                    body: formData,
                                });
                                if (!response.ok) {
                                    const text = await response.text();
                                    console.error("Server response:", text, "Headers:", response.headers);
                                    throw new Error(`HTTP error ${response.status}: ${text}`);
                                }
                                const result = await response.json();
                                if (result.name) {
                                    const input_dir = "input"; // 假设 input 目录
                                    const file_path = `${input_dir}/${result.name}`;
                                    this.widgets.find(w => w.name === "uploaded_file").value = file_path;
                                    app.graph.setDirtyCanvas(true);
                                } else {
                                    console.error("Upload failed:", result);
                                    alert("File upload failed: " + (result.error || "Unknown error"));
                                }
                            } catch (error) {
                                console.error("Upload error:", error);
                                alert("Error uploading file: " + error.message);
                            }
                        }
                    };
                    input.click();
                });
                widget.dynamic = true;
            };
        }
    },
});