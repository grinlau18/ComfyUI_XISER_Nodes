/**
 * Help overlay module for XIS Shape & Text node.
 * Generates the floating documentation panel and handles drag interactions.
 */

let stylesInjected = false;

function ensureStyles() {
  if (stylesInjected) return;
  const style = document.createElement("style");
  style.textContent = `
    .xiser-help-panel {
      position: fixed;
      top: 140px;
      left: 520px;
      min-width: 320px;
      max-width: 420px;
      max-height: 80%;
      display: none;
      flex-direction: column;
      background: rgba(10, 13, 20, 0.98);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 14px;
      box-shadow: 0 22px 50px rgba(0, 0, 0, 0.6);
      z-index: 9999;
      cursor: default;
    }
    .xiser-help-panel__header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 12px 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      cursor: move;
      gap: 12px;
      user-select: none;
    }
    .xiser-help-panel__title {
      font-size: 15px;
      font-weight: 600;
      color: #f2f4ff;
      margin-bottom: 4px;
      letter-spacing: 0.3px;
    }
    .xiser-help-panel__subtitle {
      font-size: 12px;
      color: rgba(255, 255, 255, 0.7);
    }
    .xiser-help-panel__close {
      background: transparent;
      border: none;
      color: rgba(255, 255, 255, 0.7);
      font-size: 20px;
      width: 30px;
      height: 30px;
      border-radius: 8px;
      cursor: pointer;
    }
    .xiser-help-panel__close:hover {
      background: rgba(255, 255, 255, 0.08);
      color: #fff;
    }
    .xiser-help-panel__body {
      padding: 10px 16px 16px;
      overflow-y: auto;
      max-height: calc(80vh - 70px);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .xiser-help-section {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 10px;
      padding: 10px 12px;
    }
    .xiser-help-section h4 {
      margin: 0 0 6px;
      font-size: 13px;
      color: #f7f9fe;
      letter-spacing: 0.4px;
    }
    .xiser-help-section p {
      margin: 0 0 8px;
      font-size: 12px;
      color: rgba(222, 227, 247, 0.85);
      line-height: 1.5;
    }
    .xiser-help-section ul {
      margin: 0;
      padding-left: 18px;
      font-size: 12px;
      color: rgba(215, 222, 244, 0.95);
      line-height: 1.45;
    }
    .xiser-help-params {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .xiser-help-params li {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 8px;
      padding: 8px 10px;
      color: #dfe3f7;
      font-size: 12px;
      line-height: 1.4;
    }
    .xiser-help-params li strong {
      display: block;
      font-weight: 600;
      color: #ffffff;
      margin-bottom: 2px;
    }
  `;
  document.head.appendChild(style);
  stylesInjected = true;
}

function buildHelpPanelContent() {
  const shapeDataParams = [
    {
      name: "position_x / position_y",
      description: "Normalized canvas coordinates. -1 sticks to the left/top edge, 0 is centered, 1 is the far right/bottom."
    },
    {
      name: "rotation",
      description: "Rotation in degrees. Positive values rotate clockwise."
    },
    {
      name: "scale_x / scale_y",
      description: "Scale multipliers applied before rendering. 1 keeps the original size, 0.5 halves it, 2 doubles it."
    },
    {
      name: "skew_x / skew_y",
      description: "Shear factors (tangent values). Small numbers such as 0.2 create a subtle slant."
    },
    {
      name: "shape_color / bg_color / stroke_color",
      description: "Hex colors such as #ff8844. Missing values fall back to the widget values."
    },
    {
      name: "stroke_width",
      description: "Stroke width in pixels after scaling. 0 means fill only."
    },
    {
      name: "transparent_bg",
      description: "Boolean (true/false). When true, the background image becomes fully transparent."
    },
    {
      name: "mode_selection / shape_type",
      description: "Optional overrides for the active shape family (circle, polygon, star, sunburst, spiral, text, etc.)."
    },
    {
      name: "shape_params",
      description: "JSON string for generator-specific controls (e.g., {\"angle\":180,\"ray_length\":1.2}). Only include keys you want to override."
    },
    {
      name: "shape_state",
      description: "Serialized transform block captured from the canvas. Usually provided automatically; override only if you know the schema."
    }
  ];

  const items = shapeDataParams.map(param => {
    return `<li><strong>${param.name}:</strong><span>${param.description}</span></li>`;
  }).join("");

  return `
    <section class="xiser-help-section">
      <h4>Node Overview</h4>
      <p>The Shape &amp; Text node lets you design geometric primitives and typography directly on the canvas and send the result to downstream compositing workflows or batch renders.</p>
      <ul>
        <li>Live Konva canvas mirrors the final render area.</li>
        <li>Toolbar buttons reset or re-center the active shape, toggle the layout grid, and open these docs.</li>
        <li>Connect a <code>shape_data</code> list to animate or batch multiple poses.</li>
      </ul>
    </section>
    <section class="xiser-help-section">
      <h4>Canvas Controls</h4>
      <ul>
        <li>Click any shape or text block to expose resize, skew, and rotate handles.</li>
        <li>Drag anywhere on the selection to move it. Use the handles to scale freely; hold Shift (ComfyUI default) for constrained proportions.</li>
        <li>Mouse wheel zooms the selected element. Hold Alt while scrolling to rotate around its center.</li>
        <li>Use the transformer anchors to skew horizontally/vertically, then press the toolbar buttons to snap back to center if needed.</li>
        <li>Reset returns to the saved transform, Center Align recenters the element, and the Grid toggle reveals alignment guides.</li>
      </ul>
    </section>
    <section class="xiser-help-section">
      <h4>shape_data Input</h4>
      <p>Attach an <strong>XIS_ShapeData</strong> node (or any list of dictionaries) to the <code>shape_data</code> socket. Each list item describes one pose. Missing properties inherit the values from the widgets or the canvas state.</p>
      <ul class="xiser-help-params">
        ${items}
      </ul>
      <p>Numeric parameters typically use normalized ranges so they remain resolution-independent. Combine them with upstream math nodes to keyframe positions, colors, or text attributes.</p>
    </section>
  `;
}

function clampPosition(panel, left, top) {
  const rect = panel.getBoundingClientRect();
  const width = rect.width || panel.offsetWidth || 320;
  const height = rect.height || panel.offsetHeight || 200;
  const minX = 16;
  const minY = 16;
  const maxX = Math.max(minX, window.innerWidth - width - 16);
  const maxY = Math.max(minY, window.innerHeight - height - 16);
  const clampedLeft = Math.min(Math.max(minX, left), maxX);
  const clampedTop = Math.min(Math.max(minY, top), maxY);
  panel.style.left = `${clampedLeft}px`;
  panel.style.top = `${clampedTop}px`;
  return { left: clampedLeft, top: clampedTop };
}

export function createHelpPanel(node, { onClose, onPositionChange } = {}) {
  ensureStyles();
  const panel = document.createElement("div");
  panel.className = `xiser-help-panel xiser-help-panel-${node.id}`;
  panel.innerHTML = `
    <div class="xiser-help-panel__header">
      <div>
        <div class="xiser-help-panel__title">Shape &amp; Text Guide</div>
        <div class="xiser-help-panel__subtitle">Shortcuts, toolbar hints, and shape_data reference</div>
      </div>
      <button class="xiser-help-panel__close" aria-label="Close help">&times;</button>
    </div>
    <div class="xiser-help-panel__body">
      ${buildHelpPanelContent()}
    </div>
  `;

  document.body.appendChild(panel);

  const header = panel.querySelector(".xiser-help-panel__header");
  const closeButton = panel.querySelector(".xiser-help-panel__close");

  closeButton?.addEventListener("click", () => {
    if (typeof onClose === "function") onClose();
  });

  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  const startDrag = (event) => {
    dragging = true;
    const pointer = event.touches ? event.touches[0] : event;
    offsetX = pointer.clientX - parseFloat(panel.style.left || "0");
    offsetY = pointer.clientY - parseFloat(panel.style.top || "0");
    document.addEventListener("mousemove", handleDrag);
    document.addEventListener("mouseup", stopDrag);
    document.addEventListener("touchmove", handleDrag);
    document.addEventListener("touchend", stopDrag);
  };

  const handleDrag = (event) => {
    if (!dragging) return;
    const pointer = event.touches ? event.touches[0] : event;
    const left = pointer.clientX - offsetX;
    const top = pointer.clientY - offsetY;
    const result = clampPosition(panel, left, top);
    if (typeof onPositionChange === "function") {
      onPositionChange(result);
    }
  };

  const stopDrag = () => {
    dragging = false;
    document.removeEventListener("mousemove", handleDrag);
    document.removeEventListener("mouseup", stopDrag);
    document.removeEventListener("touchmove", handleDrag);
    document.removeEventListener("touchend", stopDrag);
  };

  header?.addEventListener("mousedown", (e) => {
    if ((e.target === closeButton)) return;
    startDrag(e);
  });
  header?.addEventListener("touchstart", (e) => {
    if ((e.target === closeButton)) return;
    startDrag(e);
  });

  return {
    panel,
    setVisibility(show) {
      panel.style.display = show ? "flex" : "none";
    },
    clampPosition(left, top) {
      const targetLeft = left !== undefined ? left : parseFloat(panel.style.left || "520");
      const targetTop = top !== undefined ? top : parseFloat(panel.style.top || "140");
      const result = clampPosition(panel, targetLeft, targetTop);
      if (typeof onPositionChange === "function") {
        onPositionChange(result);
      }
      return result;
    }
  };
}
