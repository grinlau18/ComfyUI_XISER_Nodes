(function (factory) {
  // 优先使用 window，其次 self（Web Worker），否则 globalThis
  const root = typeof window !== 'undefined' ? window :
               typeof self !== 'undefined' ? self :
               typeof globalThis !== 'undefined' ? globalThis : {};
  // 确保不覆盖现有 zustand 对象
  root.zustand = root.zustand || factory();
})(function () {
  function create(createState) {
    let state;
    const listeners = new Set();
    const setState = (partial, replace) => {
      const nextState = typeof partial === 'function' ? partial(state) : partial;
      if (!Object.is(nextState, state)) {
        const previousState = state;
        state = replace ? nextState : Object.assign({}, state, nextState);
        listeners.forEach(listener => listener(state, previousState));
      }
    };
    const getState = () => state;
    const subscribe = (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    };
    const destroy = () => listeners.clear();
    const api = { setState, getState, subscribe, destroy };
    state = createState(setState, getState, api);
    return api;
  }

  return { create };
});