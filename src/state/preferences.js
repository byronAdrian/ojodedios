/**
 * Local-only user preferences (no account, no personal data): theme, favorite
 * camera ids, recently viewed camera ids and the history size. Storage can be
 * unavailable (private mode, blocked cookies, quota) — every access degrades to
 * in-memory behaviour instead of throwing.
 */
const KEYS = {
  theme: 'wve.theme',
  favorites: 'wve.favorites',
  recents: 'wve.recents',
  historySize: 'wve.historySize',
};
export const THEME_PREFERENCES = Object.freeze(['system', 'light', 'dark']);
export const HISTORY_SIZES = Object.freeze([5, 10, 20, 50]);
const MAX_FAVORITES = 500;
const CAMERA_ID = /^[a-z]{2,16}:[A-Za-z0-9._-]{1,240}$/;

/** Storage wrapper that never throws. */
export function createSafeStorage(getStorage = () => globalThis.localStorage) {
  const memory = new Map();
  const backend = () => {
    try {
      return getStorage() ?? null;
    } catch {
      return null;
    }
  };
  return {
    get(key) {
      try {
        const store = backend();
        return store ? store.getItem(key) : memory.get(key) ?? null;
      } catch {
        return memory.get(key) ?? null;
      }
    },
    set(key, value) {
      memory.set(key, value);
      try {
        backend()?.setItem(key, value);
      } catch {
        /* quota or disabled: keep the in-memory copy */
      }
    },
  };
}

function readIdList(storage, key) {
  try {
    const parsed = JSON.parse(storage.get(key) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string' && CAMERA_ID.test(id)) : [];
  } catch {
    return [];
  }
}

export function createPreferences(storage = createSafeStorage()) {
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn());

  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    getTheme() {
      const value = storage.get(KEYS.theme);
      return THEME_PREFERENCES.includes(value) ? value : 'system';
    },
    setTheme(value) {
      if (!THEME_PREFERENCES.includes(value)) return;
      storage.set(KEYS.theme, value);
      emit();
    },

    getHistorySize() {
      const value = Number(storage.get(KEYS.historySize));
      return HISTORY_SIZES.includes(value) ? value : 10;
    },
    setHistorySize(value) {
      if (!HISTORY_SIZES.includes(value)) return;
      storage.set(KEYS.historySize, String(value));
      storage.set(KEYS.recents, JSON.stringify(readIdList(storage, KEYS.recents).slice(0, value)));
      emit();
    },

    getFavorites: () => new Set(readIdList(storage, KEYS.favorites)),
    isFavorite: (id) => readIdList(storage, KEYS.favorites).includes(id),
    /** @returns {boolean} new favorite state */
    toggleFavorite(id) {
      if (!CAMERA_ID.test(id)) return false;
      const list = readIdList(storage, KEYS.favorites);
      const index = list.indexOf(id);
      if (index >= 0) list.splice(index, 1);
      else list.unshift(id);
      storage.set(KEYS.favorites, JSON.stringify(list.slice(0, MAX_FAVORITES)));
      emit();
      return index < 0;
    },

    getRecents: () => readIdList(storage, KEYS.recents),
    addRecent(id) {
      if (!CAMERA_ID.test(id)) return;
      const list = [id, ...readIdList(storage, KEYS.recents).filter((x) => x !== id)];
      storage.set(KEYS.recents, JSON.stringify(list.slice(0, this.getHistorySize())));
      emit();
    },
    clearRecents() {
      storage.set(KEYS.recents, '[]');
      emit();
    },
  };
}
