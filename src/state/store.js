/**
 * Tiny observable store. State is replaced immutably; subscribers receive
 * (next, previous) and decide what changed, so views only re-render the parts
 * that depend on changed slices.
 *
 * @template T
 * @param {T} initial
 */
export function createStore(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    /** @returns {T} */
    get: () => state,
    /** @param {Partial<T> | ((s: T) => Partial<T>)} patch */
    set(patch) {
      const previous = state;
      const delta = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...delta };
      for (const listener of [...listeners]) listener(state, previous);
    },
    /** @param {(next: T, previous: T) => void} listener @returns {() => void} unsubscribe */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
