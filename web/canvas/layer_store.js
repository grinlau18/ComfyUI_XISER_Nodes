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
    
    // Simplified state merging: prioritize incoming states from backend
    // If backend returned states, use them as base and only merge essential properties
    const baseStates = Array.isArray(incomingStates) && incomingStates.length === paths.length 
        ? incomingStates 
        : (nodeState.initialStates || []);
    
    // Generate merged states for each path
    const result = paths.map((path, idx) => {
        const layerId = layerIdOf(node, idx);
        const baseState = baseStates[idx] || {};
        
        // Create complete state with default values where needed
        const mergedState = normalizeLayerState(
            {
                ...baseState,
                layer_id: baseState.layer_id || layerId,
                filename: baseState.filename || path,
                // Ensure all essential transform and adjustment properties are present
                x: baseState.x ?? (node.properties?.ui_config?.border_width || 120) + (node.properties?.ui_config?.board_width || 1024) / 2,
                y: baseState.y ?? (node.properties?.ui_config?.border_width || 120) + (node.properties?.ui_config?.board_height || 1024) / 2,
                scaleX: baseState.scaleX ?? 1,
                scaleY: baseState.scaleY ?? 1,
                rotation: baseState.rotation ?? 0,
                brightness: baseState.brightness ?? 0,
                contrast: baseState.contrast ?? 0,
                saturation: baseState.saturation ?? 0,
                opacity: baseState.opacity ?? 100,
                visible: typeof baseState.visible === 'boolean' ? baseState.visible : true,
                locked: typeof baseState.locked === 'boolean' ? baseState.locked : false,
                order: Number.isFinite(baseState.order) ? baseState.order : idx
            },
            layerId,
            path,
            baseState.order || idx
        );
        
        return mergedState;
    });
    
    if (nodeState.log) {
        nodeState.log.debug(`mergeIncomingStates: returning ${result.length} simplified merged states`);
    }
    
    return result;
};

export const persistImageStates = (node, nodeState, imageStatesWidget, syncWidgetValues) => {
    const filenames = Array.isArray(node.properties?.ui_config?.image_paths)
        ? node.properties.ui_config.image_paths
        : [];
    ensureLayerIds(node, filenames);
    const layerOrder = getLayerOrderList(node, nodeState); // bottom -> top (ids)
    
    // Ensure all states have complete adjustment parameters
    node.properties.image_states = nodeState.initialStates.map((s, idx) => {
        // Ensure state is complete, including all adjustment parameters
        const completeState = withAdjustmentDefaults({
            ...s,
            layer_id: layerIdOf(node, idx),
            order: layerOrder.indexOf(layerIdOf(node, idx)),
            filename: s?.filename || filenames[idx],
            // Ensure all necessary adjustment parameters are present with reasonable defaults
            brightness: s?.brightness ?? 0,
            contrast: s?.contrast ?? 0,
            saturation: s?.saturation ?? 0,
            opacity: s?.opacity ?? 100,
            visible: typeof s?.visible === 'boolean' ? s.visible : true,
            locked: typeof s?.locked === 'boolean' ? s.locked : false
        });
        return completeState;
    });

    // 调试日志：记录保存的状态
    if (nodeState.log) {
        nodeState.log.debug(`persistImageStates: saving ${node.properties.image_states.length} states`);
        node.properties.image_states.forEach((state, idx) => {
            nodeState.log.debug(`  layer ${idx}: opacity=${state.opacity}, brightness=${state.brightness}, contrast=${state.contrast}, saturation=${state.saturation}, visible=${state.visible}, locked=${state.locked}`);
        });
    }
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
