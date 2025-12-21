/* global Konva */

/**
 * @fileoverview Creates the image adjustment controls (brightness, contrast, saturation) and edit affordances for XISER canvas layers.
 * @module canvas_adjust
 */

import { updateHistory } from './canvas_history.js';
import { withAdjustmentDefaults } from './canvas_state.js';
import { persistImageStates } from './layer_store.js';

const BRIGHTNESS_SLIDER_FACTOR = 100;
const SATURATION_RANGE = { min: -100, max: 100 };
const OPACITY_RANGE = { min: 0, max: 100 };

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const toSliderValue = (brightness) => Math.round(clamp(brightness, -1, 1) * BRIGHTNESS_SLIDER_FACTOR);
const fromSliderValue = (value) => clamp(value / BRIGHTNESS_SLIDER_FACTOR, -1, 1);

const ensureSaturationFilter = (() => {
  let initialized = false;
  const rgbToHsv = (r, g, b) => {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const delta = max - min;
    let h = 0;
    if (delta !== 0) {
      if (max === rn) {
        h = ((gn - bn) / delta) % 6;
      } else if (max === gn) {
        h = (bn - rn) / delta + 2;
      } else {
        h = (rn - gn) / delta + 4;
      }
      h *= 60;
      if (h < 0) h += 360;
    }
    const s = max === 0 ? 0 : delta / max;
    const v = max;
    return { h, s, v };
  };

  const hsvToRgb = (h, s, v) => {
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let r1 = 0, g1 = 0, b1 = 0;
    if (h >= 0 && h < 60) {
      r1 = c; g1 = x; b1 = 0;
    } else if (h < 120) {
      r1 = x; g1 = c; b1 = 0;
    } else if (h < 180) {
      r1 = 0; g1 = c; b1 = x;
    } else if (h < 240) {
      r1 = 0; g1 = x; b1 = c;
    } else if (h < 300) {
      r1 = x; g1 = 0; b1 = c;
    } else {
      r1 = c; g1 = 0; b1 = x;
    }
    return {
      r: Math.round((r1 + m) * 255),
      g: Math.round((g1 + m) * 255),
      b: Math.round((b1 + m) * 255),
    };
  };

  return () => {
    if (initialized) return;
    if (!window.Konva || !window.Konva.Filters) return;
    window.Konva.Filters.XiserSaturation = function xiserSaturationFilter(imageData) {
      const rawValue = typeof this?.xiserSaturation === 'number'
        ? this.xiserSaturation
        : parseFloat(this?.xiserSaturation) || 0;
      const percent = clamp(rawValue, SATURATION_RANGE.min, SATURATION_RANGE.max);
      if (Math.abs(percent) < 0.001) return;
      const factor = Math.max(0, (percent + 100) / 100);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const hsv = rgbToHsv(data[i], data[i + 1], data[i + 2]);
        hsv.s = Math.min(1, Math.max(0, hsv.s * factor));
        const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
        data[i] = rgb.r;
        data[i + 1] = rgb.g;
        data[i + 2] = rgb.b;
      }
    };
    initialized = true;
  };
})();

export function initializeAdjustmentControls(node, nodeState, widgetContainer) {
  const logger = nodeState.log || console;
  if (!widgetContainer) {
    logger.warn(`Adjustment controls skipped for node ${node?.id}: missing widget container`);
    return null;
  }
  if (!window.Konva || !nodeState.stage || !nodeState.imageLayer) {
    logger.warn(`Adjustment controls skipped for node ${node?.id}: Konva resources unavailable`);
    return null;
  }
  ensureSaturationFilter();

  let currentLayerIndex = null;
  let panelVisible = false;
  let boundLayer = null;
  let historyTimeout = null;

  const stageLayer = nodeState.imageLayer;
  const editIcon = new Konva.Group({ visible: false, listening: true });
  const iconBackground = new Konva.Circle({
    radius: 28,
    fill: '#000000b2',
  });
  const pathData = [
    'M44,14H23.65c-0.826-2.327-3.043-4-5.65-4s-4.824,1.673-5.65,4H4v4h8.35c0.826,2.327,3.043,4,5.65,4s4.824-1.673,5.65-4H44 V14z',
    'M44,30h-8.35c-0.826-2.327-3.043-4-5.65-4s-4.824,1.673-5.65,4H4v4h20.35c0.826,2.327,3.043,4,5.65,4s4.824-1.673,5.65-4 H44V30z'
  ];
  const glyphs = pathData.map(data => new Konva.Path({
    data,
    fill: '#ffffff',
    listening: false,
    scaleX: 0.8,
    scaleY: 0.8,
    offsetX: 24,
    offsetY: 24,
  }));
  editIcon.add(iconBackground);
  glyphs.forEach(path => editIcon.add(path));
  stageLayer.add(editIcon);
  editIcon.moveToTop();
  nodeState.transformer?.moveToTop();

  const panel = document.createElement('div');
  panel.className = `xiser-adjust-panel-${nodeState.nodeId}`;
  Object.assign(panel.style, {
    position: 'fixed',
    left: '0px',
    top: '0px',
    width: '280px',
    maxWidth: '320px',
    padding: '16px 18px',
    display: 'none',
    flexDirection: 'column',
    gap: '12px',
    background: 'rgba(10, 12, 24, 0.97)',
    borderRadius: '12px',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    boxShadow: '0 18px 45px rgba(0, 0, 0, 0.35)',
    color: '#f5f6ff',
    pointerEvents: 'auto',
    zIndex: 30,
    cursor: 'default',
  });

  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '15px',
    fontWeight: '600',
    letterSpacing: '0.4px',
    cursor: 'grab',
  });
  header.innerHTML = '<span>图像调整</span>';

  const headerButtons = document.createElement('div');
  Object.assign(headerButtons.style, {
    display: 'flex',
    gap: '8px',
  });

  const resetButton = document.createElement('button');
  resetButton.textContent = '重置';
  stylePanelButton(resetButton);

  const closeButton = document.createElement('button');
  closeButton.textContent = '收起';
  stylePanelButton(closeButton);

  headerButtons.appendChild(resetButton);
  headerButtons.appendChild(closeButton);
  header.appendChild(headerButtons);

  const controlsContainer = document.createElement('div');
  Object.assign(controlsContainer.style, {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  });

  const brightnessControl = createSliderControl('亮度', -100, 100, 0);
  const contrastControl = createSliderControl('对比度', -100, 100, 0);
  const saturationControl = createSliderControl('饱和度', -100, 100, 0);
  const opacityControl = createSliderControl('透明度', 0, 100, 100);

  controlsContainer.appendChild(brightnessControl.container);
  controlsContainer.appendChild(contrastControl.container);
  controlsContainer.appendChild(saturationControl.container);
  controlsContainer.appendChild(opacityControl.container);

  panel.appendChild(header);
  panel.appendChild(controlsContainer);
  document.body.appendChild(panel);

  function stylePanelButton(button) {
    Object.assign(button.style, {
      padding: '4px 12px',
      borderRadius: '8px',
      border: '1px solid rgba(255, 255, 255, 0.2)',
      background: 'rgba(255, 255, 255, 0.08)',
      color: '#f5f6ff',
      fontSize: '12px',
      cursor: 'pointer',
    });
    button.onmouseenter = () => (button.style.background = 'rgba(255, 255, 255, 0.18)');
    button.onmouseleave = () => (button.style.background = 'rgba(255, 255, 255, 0.08)');
  }

  function createSliderControl(labelText, min, max, defaultValue) {
    const container = document.createElement('div');
    Object.assign(container.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
    });

    const labelRow = document.createElement('div');
    Object.assign(labelRow.style, {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: '13px',
    });

    const label = document.createElement('span');
    label.textContent = labelText;

    const valueLabel = document.createElement('span');
    valueLabel.textContent = `${defaultValue}`;
    valueLabel.style.fontVariantNumeric = 'tabular-nums';

    labelRow.appendChild(label);
    labelRow.appendChild(valueLabel);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = `${min}`;
    slider.max = `${max}`;
    slider.step = '1';
    slider.value = `${defaultValue}`;
    slider.style.width = '100%';
    slider.style.cursor = 'pointer';

    container.appendChild(labelRow);
    container.appendChild(slider);

    return { container, slider, valueLabel };
  }

  const syncImageStates = () => {
    // 使用标准的持久化函数，确保与其他控件一致
    const imageStatesWidget = node.widgets?.find((w) => w.name === 'image_states');
    persistImageStates(node, nodeState, imageStatesWidget);

    // Debug: log adjustment values for troubleshooting
    if (currentLayerIndex !== null && nodeState.initialStates[currentLayerIndex]) {
      const state = nodeState.initialStates[currentLayerIndex];
      logger.debug(`Adjustment sync: layer=${currentLayerIndex}, brightness=${state.brightness}, contrast=${state.contrast}, saturation=${state.saturation}, opacity=${state.opacity}`);
    }
  };

  const scheduleHistorySave = () => {
    if (historyTimeout) clearTimeout(historyTimeout);
    historyTimeout = setTimeout(() => {
      updateHistory(nodeState, true);
      historyTimeout = null;
    }, 250);
  };

  const applyStateUpdate = (index, partialAdjustments) => {
    if (index === null || index === undefined || !nodeState.initialStates[index]) {
      return;
    }
    nodeState.initialStates[index] = withAdjustmentDefaults({
      ...nodeState.initialStates[index],
      ...partialAdjustments,
    });
    syncImageStates();
    applyStoredAdjustments(index);
    nodeState.imageLayer?.batchDraw();
    scheduleHistorySave();
  };

  const updateSliderDisplays = (state) => {
    const brightness = toSliderValue(state?.brightness ?? 0);
    const contrast = Math.round(state?.contrast ?? 0);
    const saturation = Math.round(state?.saturation ?? 0);
    const opacity = Math.round(state?.opacity ?? 100);
    brightnessControl.slider.value = `${brightness}`;
    brightnessControl.valueLabel.textContent = `${brightness}`;
    contrastControl.slider.value = `${contrast}`;
    contrastControl.valueLabel.textContent = `${contrast}`;
    saturationControl.slider.value = `${saturation}`;
    saturationControl.valueLabel.textContent = `${saturation}`;
    opacityControl.slider.value = `${opacity}`;
    opacityControl.valueLabel.textContent = `${opacity}`;
  };

  const handleSliderInput = () => {
    if (currentLayerIndex === null) return;
    brightnessControl.valueLabel.textContent = brightnessControl.slider.value;
    contrastControl.valueLabel.textContent = contrastControl.slider.value;
    saturationControl.valueLabel.textContent = saturationControl.slider.value;
    opacityControl.valueLabel.textContent = opacityControl.slider.value;
    applyStateUpdate(currentLayerIndex, {
      brightness: fromSliderValue(parseInt(brightnessControl.slider.value, 10)),
      contrast: clamp(parseInt(contrastControl.slider.value, 10), -100, 100),
      saturation: clamp(parseInt(saturationControl.slider.value, 10), SATURATION_RANGE.min, SATURATION_RANGE.max),
      opacity: clamp(parseInt(opacityControl.slider.value, 10), OPACITY_RANGE.min, OPACITY_RANGE.max),
    });
  };

  brightnessControl.slider.addEventListener('input', handleSliderInput);
  contrastControl.slider.addEventListener('input', handleSliderInput);
  saturationControl.slider.addEventListener('input', handleSliderInput);
  opacityControl.slider.addEventListener('input', handleSliderInput);

  resetButton.addEventListener('click', () => {
    brightnessControl.slider.value = '0';
    contrastControl.slider.value = '0';
    saturationControl.slider.value = '0';
    opacityControl.slider.value = '100';
    handleSliderInput();
  });

  closeButton.addEventListener('click', () => {
    hidePanel();
  });

  editIcon.on('click tap', (evt) => {
    evt.cancelBubble = true;
    if (panelVisible) {
      hidePanel();
    } else {
      showPanel();
    }
  });

  const bindLayerEvents = (layer) => {
    if (boundLayer) {
      boundLayer.off('.xiserAdjust');
      boundLayer = null;
    }
    if (layer) {
      boundLayer = layer;
      boundLayer.on('dragmove.xiserAdjust transform.xiserAdjust', () => updateIconPosition());
    }
  };

  let outsideClickHandler = null;
  const dragState = {
    active: false,
    startX: 0,
    startY: 0,
    panelX: 0,
    panelY: 0,
  };

  const reattachIcon = ({ keepHidden = true } = {}) => {
    if (!stageLayer) return;
    if (!editIcon.getParent()) {
      stageLayer.add(editIcon);
    }
    if (keepHidden) {
      editIcon.visible(false);
    }
    editIcon.moveToTop();
    stageLayer.batchDraw();
  };

  const detachIcon = () => {
    if (editIcon.getParent()) {
      editIcon.remove();
    }
    editIcon.visible(false);
  };

  const clampPanelPosition = (left, top) => {
    const panelRect = panel.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const maxLeft = Math.max(0, viewportWidth - panelRect.width - 10);
    const maxTop = Math.max(0, viewportHeight - panelRect.height - 10);
    return {
      left: Math.min(Math.max(-panelRect.width, left), maxLeft),
      top: Math.min(Math.max(0, top), maxTop),
    };
  };

  const getIconClientPosition = () => {
    const target = currentLayerIndex !== null ? nodeState.imageNodes?.[currentLayerIndex] : null;
    const stage = nodeState.stage;
    const stageWrapper = nodeState.stageWrapper;
    if (!target || !stage || !stageWrapper) return null;
    const scale = stage.scaleX?.() || 1;
    const absPos = target.getAbsolutePosition?.() || { x: target.x(), y: target.y() };
    const wrapperRect = stageWrapper.getBoundingClientRect();
    return {
      x: wrapperRect.left + absPos.x * scale,
      y: wrapperRect.top + absPos.y * scale,
    };
  };

  const positionPanelBelowIcon = () => {
    const iconPos = getIconClientPosition();
    if (!iconPos) return;
    panel.style.display = 'flex';
    const panelRect = panel.getBoundingClientRect();
    let desiredLeft = iconPos.x - panelRect.width / 2;
    let desiredTop = iconPos.y + 24;
    const clamped = clampPanelPosition(desiredLeft, desiredTop);
    panel.style.left = `${clamped.left}px`;
    panel.style.top = `${clamped.top}px`;
  };

  const updateIconPosition = () => {
    if (currentLayerIndex === null) return;
    const target = nodeState.imageNodes?.[currentLayerIndex];
    if (!target) return;
    reattachIcon({ keepHidden: false });
    editIcon.position({ x: target.x(), y: target.y() });
    editIcon.visible(true);
    nodeState.transformer?.moveToTop();
    editIcon.moveToTop();
    stageLayer.batchDraw();
  };

  const showIcon = () => {
    if (currentLayerIndex === null) return;
    reattachIcon({ keepHidden: false });
    updateIconPosition();
  };

  const hideIcon = () => {
    editIcon.visible(false);
    stageLayer.batchDraw();
  };

  const showPanel = () => {
    if (currentLayerIndex === null) return;
    const state = withAdjustmentDefaults(nodeState.initialStates[currentLayerIndex] || {});
    updateSliderDisplays(state);
    panel.style.display = 'flex';
    positionPanelBelowIcon();
    attachOutsideHandler();
    panelVisible = true;
  };

  const hidePanel = () => {
    panel.style.display = 'none';
    panelVisible = false;
    detachOutsideHandler();
  };

  const handleOutsidePointer = (evt) => {
    if (!panelVisible) return;
    if (panel.contains(evt.target)) return;
    hidePanel();
  };

  const attachOutsideHandler = () => {
    if (outsideClickHandler) return;
    outsideClickHandler = (evt) => handleOutsidePointer(evt);
    document.addEventListener('pointerdown', outsideClickHandler, true);
  };

  const detachOutsideHandler = () => {
    if (!outsideClickHandler) return;
    document.removeEventListener('pointerdown', outsideClickHandler, true);
    outsideClickHandler = null;
  };

  const onLayerSelected = (index) => {
    currentLayerIndex = index;
    const layer = nodeState.imageNodes?.[index];
    bindLayerEvents(layer);
    showIcon();
    // Always update slider displays when layer is selected, not just when panel is visible
    const state = withAdjustmentDefaults(nodeState.initialStates[index] || {});
    updateSliderDisplays(state);
    if (panelVisible) {
      positionPanelBelowIcon();
    }
  };

  const onLayerDeselected = () => {
    currentLayerIndex = null;
    hideIcon();
    hidePanel();
    bindLayerEvents(null);
  };

  const updateLayout = () => {
    if (panelVisible) {
      positionPanelBelowIcon();
    }
  };

  const applyStoredAdjustments = (index) => {
    // 首先确保状态被规范化并保存
    const state = withAdjustmentDefaults(nodeState.initialStates[index] || {});
    nodeState.initialStates[index] = state;

    // 调试日志：记录调整值
    logger.debug(`applyStoredAdjustments layer=${index}, brightness=${state.brightness}, contrast=${state.contrast}, saturation=${state.saturation}, opacity=${state.opacity}, opacity type=${typeof state.opacity}`);

    // 如果图层不存在，只保存状态，不应用调整
    const layer = nodeState.imageNodes?.[index];
    if (!layer) {
      logger.debug(`applyStoredAdjustments: layer ${index} not found, only saving state`);
      return;
    }

    const filters = [];

    // 亮度滤镜
    if (Math.abs(state.brightness) > 0.001) {
      filters.push(Konva.Filters.Brighten);
      layer.brightness(state.brightness);
    } else {
      layer.brightness(0);
    }

    // 对比度滤镜
    if (Math.abs(state.contrast) > 0.001) {
      filters.push(Konva.Filters.Contrast);
      layer.contrast(state.contrast);
    } else {
      layer.contrast(0);
    }

    // 饱和度滤镜 - 与后端一致的HSV转换
    if (Math.abs(state.saturation) > 0.001 && Konva.Filters.XiserSaturation) {
      filters.push(Konva.Filters.XiserSaturation);
      layer.xiserSaturation = clamp(state.saturation, SATURATION_RANGE.min, SATURATION_RANGE.max);
    } else {
      layer.xiserSaturation = 0;
    }

    // 透明度处理
    const opacity = state.opacity !== undefined ? state.opacity : 100;
    layer.opacity(opacity / 100);

    if (filters.length) {
      layer.cache();
      layer.filters(filters);
    } else {
      layer.filters([]);
      layer.clearCache();
    }
    stageLayer.batchDraw();
  };

  const destroy = () => {
    if (historyTimeout) clearTimeout(historyTimeout);
    boundLayer?.off('.xiserAdjust');
    detachOutsideHandler();
    editIcon.destroy();
    if (panel.parentNode) {
      panel.parentNode.removeChild(panel);
    }
  };

  const onDragMove = (evt) => {
    if (!dragState.active) return;
    const deltaX = evt.clientX - dragState.startX;
    const deltaY = evt.clientY - dragState.startY;
    const clamped = clampPanelPosition(dragState.panelX + deltaX, dragState.panelY + deltaY);
    panel.style.left = `${clamped.left}px`;
    panel.style.top = `${clamped.top}px`;
    evt.preventDefault();
  };

  const endDrag = () => {
    if (!dragState.active) return;
    dragState.active = false;
    document.removeEventListener('pointermove', onDragMove);
    document.removeEventListener('pointerup', endDrag);
    header.style.cursor = 'grab';
  };

  const startDrag = (evt) => {
    if (evt.button !== 0) return;
    if (evt.target.closest('button')) return;
    dragState.active = true;
    dragState.startX = evt.clientX;
    dragState.startY = evt.clientY;
    dragState.panelX = parseFloat(panel.style.left || '0');
    dragState.panelY = parseFloat(panel.style.top || '0');
    header.style.cursor = 'grabbing';
    document.addEventListener('pointermove', onDragMove);
    document.addEventListener('pointerup', endDrag);
    evt.preventDefault();
  };

  header.addEventListener('pointerdown', startDrag);

  return {
    onLayerSelected,
    onLayerDeselected,
    updateLayout,
    applyStoredAdjustments,
    detachIcon,
    reattachIcon,
    destroy,
    showPanel,
  };
}
