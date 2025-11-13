/**
 * Text mode controls and font manager
 */

import { log } from "./xis_shape_utils.js";

class XISFontManager {
  constructor() {
    this.fonts = [];
    this.loading = false;
    this.request = null;
    this.injected = new Set();
    this.fontReady = new Map();
  }

  async fetchFonts(force = false) {
    if (this.loading && this.request && !force) {
      return this.request;
    }

    if (this.fonts.length && !force) {
      return this.fonts;
    }

    this.loading = true;
    this.request = fetch("/xiser/fonts")
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(await res.text());
        }
        return res.json();
      })
      .then((data) => {
        const fonts = (data?.fonts || []).map((font) => ({
          ...font,
          cssName: this._ensureFontFace(font),
        }));
        this.fonts = fonts;
        this.loading = false;
        return fonts;
      })
      .catch((err) => {
        this.loading = false;
        log.error("Failed to fetch fonts:", err);
        throw err;
      });

    return this.request;
  }

  _ensureFontFace(font) {
    if (!font?.file) return "";
    const cssName = `xiser-font-${font.file.replace(/[^a-zA-Z0-9]/g, "_")}`;
    if (this.injected.has(font.file)) {
      if (!this.fontReady.has(font.file)) {
        this._ensureFontLoaded(cssName, font.file);
      }
      return cssName;
    }

    const style = document.createElement("style");
    const encodedUrl = encodeURI(font.url);
    style.textContent = `
@font-face {
  font-family: "${cssName}";
  src: url("${encodedUrl}");
  font-display: swap;
}
    `.trim();
    document.head.appendChild(style);
    this.injected.add(font.file);
    this._ensureFontLoaded(cssName, font.file);
    return cssName;
  }

  _ensureFontLoaded(cssName, fontFile) {
    if (!document.fonts) {
      this.fontReady.set(fontFile, Promise.resolve());
      return;
    }
    const loadPromise = document.fonts
      .load(`1em "${cssName}"`)
      .catch((err) => {
        log.error(`Failed to load font ${cssName}:`, err);
      });
    this.fontReady.set(fontFile, loadPromise);
  }

  waitForFont(file) {
    if (!file) return Promise.resolve();
    return this.fontReady.get(file) || Promise.resolve();
  }

  getFontFamily(file) {
    if (!file) return "";
    const font = this.fonts.find((item) => item.file === file);
    return font?.cssName || "";
  }
}

const fontManagerInstance = new XISFontManager();

const DEFAULT_TEXT_PARAMS = {
  content: "A",
  font_file: "",
  font_family: "",
  font_size: 128,
  letter_spacing: 0,
  line_spacing: 1.2,
  font_weight: "normal",
  font_style: "normal",
  underline: false,
  uppercase: true,
};

function createField(label, element) {
  const wrapper = document.createElement("label");
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "column";
  wrapper.style.gap = "4px";
  wrapper.style.color = "#ddd";
  wrapper.style.fontSize = "12px";
  wrapper.textContent = label;
  wrapper.appendChild(element);
  return wrapper;
}

function createNumberInput(value, min, max, step, onChange) {
  const input = document.createElement("input");
  input.type = "number";
  input.value = value;
  if (min !== undefined) input.min = min;
  if (max !== undefined) input.max = max;
  input.step = step ?? 1;
  input.style.width = "100%";
  input.style.padding = "6px";
  input.style.borderRadius = "4px";
  input.style.border = "1px solid #444";
  input.style.background = "rgba(0,0,0,0.25)";
  input.style.color = "#fff";
  input.addEventListener("change", () => {
    const val = parseFloat(input.value);
    onChange(Number.isNaN(val) ? value : val);
  });
  return input;
}

function createToggleButton(label, active, onChange) {
  const btn = document.createElement("button");
  btn.textContent = label;
  btn.style.padding = "6px 10px";
  btn.style.borderRadius = "4px";
  btn.style.border = "1px solid #555";
  btn.style.cursor = "pointer";
  btn.style.background = active ? "#2f80ed" : "rgba(0,0,0,0.4)";
  btn.style.color = "#fff";
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    const next = !active;
    active = next;
    btn.style.background = active ? "#2f80ed" : "rgba(0,0,0,0.4)";
    onChange(active);
  });
  return btn;
}

export class TextGenerator {
  static type = "text";

  static generate() {
    return null;
  }

  static getParameterControls(container, shapeParams, onParamChange) {
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "12px";

    const params = { ...DEFAULT_TEXT_PARAMS, ...(shapeParams || {}) };

    const commit = () => {
      onParamChange({ ...params });
    };

    const textarea = document.createElement("textarea");
    textarea.value = params.content || "A";
    textarea.rows = 4;
    textarea.style.width = "100%";
    textarea.style.resize = "vertical";
    textarea.style.padding = "8px";
    textarea.style.borderRadius = "6px";
    textarea.style.border = "1px solid #444";
    textarea.style.background = "rgba(0,0,0,0.25)";
    textarea.style.color = "#fff";
    textarea.addEventListener("input", () => {
      params.content = textarea.value;
      commit();
    });
    container.appendChild(createField("文本内容", textarea));

    const fontRow = document.createElement("div");
    fontRow.style.display = "flex";
    fontRow.style.gap = "8px";
    fontRow.style.alignItems = "center";

    const fontSelect = document.createElement("select");
    fontSelect.style.flex = "1";
    fontSelect.style.padding = "6px";
    fontSelect.style.borderRadius = "4px";
    fontSelect.style.border = "1px solid #444";
    fontSelect.style.background = "rgba(0,0,0,0.25)";
    fontSelect.style.color = "#fff";

    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "默认字体";
    fontSelect.appendChild(defaultOption);

    fontSelect.addEventListener("change", async () => {
      const value = fontSelect.value;
      params.font_file = value;
      params.font_family = fontManagerInstance.getFontFamily(value);
      if (value) {
        await fontManagerInstance.waitForFont(value);
      }
      commit();
    });

    fontRow.appendChild(fontSelect);

    const refreshBtn = document.createElement("button");
    refreshBtn.textContent = "刷新字体";
    refreshBtn.style.padding = "6px 10px";
    refreshBtn.style.borderRadius = "4px";
    refreshBtn.style.border = "1px solid #555";
    refreshBtn.style.background = "rgba(0,0,0,0.4)";
    refreshBtn.style.color = "#fff";
    refreshBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      await loadFonts(true);
    });
    fontRow.appendChild(refreshBtn);

    container.appendChild(createField("字体文件（放入 /fonts 目录）", fontRow));

    const numericGrid = document.createElement("div");
    numericGrid.style.display = "grid";
    numericGrid.style.gridTemplateColumns = "repeat(auto-fit, minmax(120px, 1fr))";
    numericGrid.style.gap = "10px";

    numericGrid.appendChild(createField("字体大小", createNumberInput(params.font_size, 16, 1024, 1, (val) => {
      params.font_size = Math.max(16, Math.min(1024, val));
      commit();
    })));

    numericGrid.appendChild(createField("字间距 (px)", createNumberInput(params.letter_spacing, -20, 200, 0.5, (val) => {
      params.letter_spacing = val;
      commit();
    })));

    numericGrid.appendChild(createField("行距 (倍数)", createNumberInput(params.line_spacing, 0.5, 3, 0.1, (val) => {
      params.line_spacing = Math.max(0.5, val);
      commit();
    })));

    container.appendChild(numericGrid);

    const toggleRow = document.createElement("div");
    toggleRow.style.display = "flex";
    toggleRow.style.flexWrap = "wrap";
    toggleRow.style.gap = "8px";

    const boldBtn = createToggleButton("粗体", params.font_weight === "bold", (val) => {
      params.font_weight = val ? "bold" : "normal";
      commit();
    });
    const italicBtn = createToggleButton("斜体", params.font_style === "italic", (val) => {
      params.font_style = val ? "italic" : "normal";
      commit();
    });
    const underlineBtn = createToggleButton("下划线", Boolean(params.underline), (val) => {
      params.underline = val;
      commit();
    });
    const uppercaseBtn = createToggleButton("大写", Boolean(params.uppercase), (val) => {
      params.uppercase = val;
      commit();
    });

    toggleRow.appendChild(boldBtn);
    toggleRow.appendChild(italicBtn);
    toggleRow.appendChild(underlineBtn);
    toggleRow.appendChild(uppercaseBtn);
    container.appendChild(toggleRow);

    const hint = document.createElement("div");
    hint.style.fontSize = "11px";
    hint.style.color = "#aaa";
    hint.innerHTML = "提示：将 .ttf/.otf 文件放入 <code>custom_nodes/ComfyUI_XISER_Nodes/fonts</code> 后点击刷新字体。";
    container.appendChild(hint);

    async function loadFonts(force = false) {
      fontSelect.disabled = true;
      fontSelect.innerHTML = "";
      const defaultOpt = document.createElement("option");
      defaultOpt.value = "";
      defaultOpt.textContent = "默认字体";
      fontSelect.appendChild(defaultOpt);

      try {
        const fonts = await fontManagerInstance.fetchFonts(force);
        if (!fonts.length) {
          const emptyOpt = document.createElement("option");
          emptyOpt.value = "";
          emptyOpt.textContent = "未找到字体文件";
          fontSelect.appendChild(emptyOpt);
        } else {
          fonts.forEach((font) => {
            const option = document.createElement("option");
            option.value = font.file;
            option.textContent = font.name;
            fontSelect.appendChild(option);
          });
        }
      } catch (err) {
        const errorOpt = document.createElement("option");
        errorOpt.value = "";
        errorOpt.textContent = "字体加载失败";
        fontSelect.appendChild(errorOpt);
      } finally {
        fontSelect.disabled = false;
        fontSelect.value = params.font_file || "";
        if (fontSelect.value) {
          params.font_family = fontManagerInstance.getFontFamily(params.font_file);
          fontManagerInstance.waitForFont(params.font_file).finally(commit);
        } else {
          commit();
        }
      }
    }

    loadFonts();
  }
}

export function getFontManager() {
  return fontManagerInstance;
}
