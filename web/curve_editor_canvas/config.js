import { MIN_NODE_WIDTH, MIN_NODE_HEIGHT, NODE_UI_WIDTH, NODE_UI_HEIGHT } from "../XIS_CurveEditor.js";

const LOG_LEVEL = "error";
const CANVAS_WIDTH = 540;
const CANVAS_HEIGHT = 306;
const POINT_COUNT_WIDGET_INDEX = 3;
const POINT_COUNT_MIN = 2;
const POINT_COUNT_MAX = 100;
const DEFAULT_POINT_COUNT = 10;

const log = {
  info: (...args) => { if (LOG_LEVEL === "info") console.log(...args); },
  warning: (...args) => { if (LOG_LEVEL === "warning" || LOG_LEVEL === "info") console.warn(...args); },
  error: (...args) => { if (LOG_LEVEL === "error" || LOG_LEVEL === "warning" || LOG_LEVEL === "info") console.error(...args); }
};

function createNodeDebounce(wait) {
  const timeouts = new Map();
  return function(node, ...args) {
    const nodeId = node?.id;
    if (nodeId === undefined || nodeId === -1) {
      if (typeof args[0] === "function") {
        args[0]();
      }
      return;
    }

    if (timeouts.has(nodeId)) {
      cancelAnimationFrame(timeouts.get(nodeId));
    }

    const timeoutId = requestAnimationFrame(() => {
      setTimeout(() => {
        if (typeof args[0] === "function") {
          args[0]();
        }
        timeouts.delete(nodeId);
      }, wait);
    });

    timeouts.set(nodeId, timeoutId);
  };
}

const nodeDebounce = createNodeDebounce(16);

export {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  DEFAULT_POINT_COUNT,
  log,
  MIN_NODE_HEIGHT,
  MIN_NODE_WIDTH,
  NODE_UI_HEIGHT,
  NODE_UI_WIDTH,
  POINT_COUNT_MAX,
  POINT_COUNT_MIN,
  POINT_COUNT_WIDGET_INDEX,
  nodeDebounce
};
