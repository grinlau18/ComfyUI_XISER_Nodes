import { withAdjustmentDefaults } from './canvas_state.js';

export const normalizeLayerState = (state = {}, layerId, filename, fallbackOrder = 0) => {
  return withAdjustmentDefaults({
    ...state,
    layer_id: state?.layer_id || layerId,
    filename: state?.filename || filename,
    order: Number.isFinite(state?.order) ? state.order : fallbackOrder,
    visible: typeof state?.visible === 'boolean' ? state.visible : true,
  });
};

export const mergeLayerState = (base = {}, incoming = {}, layerId, filename, fallbackOrder = 0) => {
  return normalizeLayerState(
    {
      ...base,
      ...incoming,
    },
    layerId,
    filename,
    fallbackOrder,
  );
};

export const layerIdOf = (node, idx) => {
  const ids = node?.properties?.ui_config?.layer_ids;
  return Array.isArray(ids) && ids[idx] ? ids[idx] : `layer_${idx}`;
};

export const ensureLayerIds = (node, paths = []) => {
  if (!node.properties) node.properties = {};
  if (!node.properties.ui_config) node.properties.ui_config = {};
  const imgPaths = Array.isArray(node.properties.ui_config.image_paths)
    ? node.properties.ui_config.image_paths
    : paths;
  if (!Array.isArray(node.properties.ui_config.layer_ids) || node.properties.ui_config.layer_ids.length !== imgPaths.length) {
    node.properties.ui_config.layer_ids = imgPaths.map((_, idx) => `layer_${idx}`);
    node.setProperty?.('ui_config', node.properties.ui_config);
  }
  return node.properties.ui_config.layer_ids;
};

export const getLayerOrderList = (node, nodeState) => {
  const targetLen =
    nodeState.imageNodes?.length ||
    nodeState.initialStates?.length ||
    node?.properties?.ui_config?.image_paths?.length ||
    0;
  const stored = Array.isArray(node?.properties?.ui_config?.layer_order)
    ? node.properties.ui_config.layer_order
    : null;
  if (Array.isArray(stored) && stored.length === targetLen) {
    return [...stored];
  }
  return (nodeState.initialStates || [])
    .map((s, idx) => ({
      id: layerIdOf(node, idx),
      order: Number.isFinite(s?.order) ? s.order : idx,
    }))
    .sort((a, b) => a.order - b.order)
    .map((p) => p.id);
};

export const mergeIncomingStates = (node, nodeState, incomingStates, paths) => {
  ensureLayerIds(node, paths);
  // Base map from persisted image_states to preserve order/visible
  const byLayerId = new Map();
  if (Array.isArray(node.properties?.image_states)) {
    node.properties.image_states.forEach((s, idx) => {
      const lid = s?.layer_id || layerIdOf(node, idx);
      if (!lid) return;
      byLayerId.set(lid, normalizeLayerState(s, lid, paths[idx], idx));
    });
  }
  // Overlay current initialStates for transforms while keeping persisted visible/order
  (nodeState.initialStates || []).forEach((s, idx) => {
    const lid = layerIdOf(node, idx);
    const base = byLayerId.get(lid) || withAdjustmentDefaults({});
    byLayerId.set(lid, withAdjustmentDefaults({
      ...base,
      x: s?.x ?? base.x,
      y: s?.y ?? base.y,
      scaleX: s?.scaleX ?? base.scaleX,
      scaleY: s?.scaleY ?? base.scaleY,
      rotation: s?.rotation ?? base.rotation,
      skewX: s?.skewX ?? base.skewX,
      skewY: s?.skewY ?? base.skewY,
      brightness: s?.brightness ?? base.brightness,
      contrast: s?.contrast ?? base.contrast,
      saturation: s?.saturation ?? base.saturation,
      // keep persisted visible unless explicitly set in incoming states later
    }));
  });

  const incomingList = Array.isArray(incomingStates)
    ? incomingStates.map((s) => withAdjustmentDefaults(s || {}))
    : [];
  const incomingByLayerId = new Map(
    incomingList
      .map((s) => [s?.layer_id, s])
      .filter(([k]) => k)
  );
  const layerOrder = Array.isArray(node.properties?.ui_config?.layer_order)
    ? node.properties.ui_config.layer_order
    : getLayerOrderList(node, nodeState);

  return paths.map((path, idx) => {
    const layerId = layerIdOf(node, idx);
    const base = byLayerId.get(layerId) || nodeState.initialStates[idx] || {};
    const incoming = incomingByLayerId.get(layerId)
      || incomingList.find((s) => s.filename === path)
      || incomingList[idx]
      || {};
    const orderFromLayerOrder = Array.isArray(layerOrder) ? layerOrder.indexOf(layerId) : -1;
    const resolvedOrder = Number.isFinite(orderFromLayerOrder) && orderFromLayerOrder >= 0
      ? orderFromLayerOrder
      : (Number.isFinite(incoming.order) ? incoming.order : (Number.isFinite(base.order) ? base.order : idx));

    // visible: incoming > persisted > default true
    const visible =
      typeof incoming.visible === 'boolean'
        ? incoming.visible
        : (typeof base.visible === 'boolean' ? base.visible : true);

    return normalizeLayerState(
      {
        ...base,
        ...incoming,
        order: resolvedOrder,
        visible,
      },
      layerId,
      path,
      resolvedOrder,
    );
  });
};

export const persistImageStates = (node, nodeState, imageStatesWidget, syncWidgetValues) => {
  const filenames = Array.isArray(node.properties?.ui_config?.image_paths)
    ? node.properties.ui_config.image_paths
    : [];
  ensureLayerIds(node, filenames);
  const layerOrder = getLayerOrderList(node, nodeState); // bottom -> top (ids)
  node.properties.image_states = nodeState.initialStates.map((s, idx) => ({
    ...withAdjustmentDefaults(s),
    layer_id: layerIdOf(node, idx),
    order: layerOrder.indexOf(layerIdOf(node, idx)),
    filename: s?.filename || filenames[idx],
  }));
  node.properties.ui_config = {
    ...(node.properties.ui_config || {}),
    image_states: node.properties.image_states,
    layer_order: layerOrder,
    layer_ids: node.properties.ui_config.layer_ids,
  };
  if (imageStatesWidget) {
    imageStatesWidget.value = JSON.stringify(node.properties.image_states);
  }
  node.setProperty?.('image_states', node.properties.image_states);
  node.setProperty?.('ui_config', node.properties.ui_config);
  if (typeof syncWidgetValues === 'function') {
    syncWidgetValues();
  }
};

export const applyLayerOrder = (node, nodeState) => {
  if (!Array.isArray(nodeState.imageNodes)) return;
  ensureLayerIds(node);
  const pairs = nodeState.imageNodes
    .map((imgNode, idx) => ({
      node: imgNode,
      idx,
      order: Number.isFinite(nodeState.initialStates?.[idx]?.order)
        ? nodeState.initialStates[idx].order
        : idx,
    }))
    .filter((p) => p.node)
    .sort((a, b) => a.order - b.order);

  if (pairs.length === 0) return;

  pairs.forEach((p, z) => {
    p.node.zIndex(z);
    p.node.visible(nodeState.initialStates[p.idx]?.visible !== false);
    nodeState.initialStates[p.idx] = withAdjustmentDefaults(nodeState.initialStates[p.idx], { order: z });
  });

  nodeState.defaultLayerOrder = pairs.map((p) => p.node);
  const layerOrder = pairs.map((p) => layerIdOf(node, p.idx));
  node.properties.ui_config = {
    ...(node.properties.ui_config || {}),
    layer_order: layerOrder,
  };
  node.setProperty?.('ui_config', node.properties.ui_config);
  nodeState.imageLayer?.batchDraw();
};
