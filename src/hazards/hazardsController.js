/**
 * Natural-hazard layers: fetches /api/quakes and /api/fires while their layer
 * is on and the tab is visible, feeds the map layer and the detail card, and
 * reports a status per layer for the layers panel.
 *
 * Fires depend on the visible area (server-capped bbox); quakes are one global
 * feed. Superseded requests are aborted; nothing polls while hidden or off.
 */
import { fireBboxParam } from './hazards.js';
import { createHazardCard } from './hazardCard.js';

const QUAKE_REFRESH_MS = 2 * 60_000;
const FIRE_REFRESH_MS = 15 * 60_000;
const VIEW_DEBOUNCE_MS = 700;

/**
 * @param {{ container: HTMLElement, getMap: () => any, createLayer: (globe, opts) => any,
 *   onStatus: (kind: 'quakes' | 'fires', status: object) => void, onSelect?: (pick: object | null) => void,
 *   fetchImpl?: typeof fetch }} deps
 */
export function createHazardsController({ container, getMap, createLayer, onStatus, onSelect = () => {}, fetchImpl = (...a) => globalThis.fetch(...a) }) {
  let layer = null;
  const enabled = { quakes: false, fires: false };
  const data = { quakes: [], fires: [] };
  const attribution = { quakes: '', fires: '' };
  const timers = { quakes: 0, fires: 0 };
  const requests = { quakes: null, fires: null };
  let lastFireBbox = null;
  let viewTimer = 0;
  let selected = null;

  const card = createHazardCard({ container, onClose: () => select(null) });

  const status = (kind, value) => onStatus(kind, value);
  const visible = () => document.visibilityState === 'visible';

  function draw(kind) {
    if (!layer) return;
    if (kind === 'quakes') layer.setQuakes(data.quakes, enabled.quakes);
    else layer.setFires(data.fires, enabled.fires);
  }

  async function getJson(kind, url) {
    requests[kind]?.abort();
    const controller = new AbortController();
    requests[kind] = controller;
    const response = await fetchImpl(url, { signal: controller.signal });
    const body = await response.json().catch(() => null);
    if (requests[kind] === controller) requests[kind] = null;
    return { response, body };
  }

  function schedule(kind) {
    clearTimeout(timers[kind]);
    if (!enabled[kind]) return;
    timers[kind] = setTimeout(() => (visible() ? load(kind, { quiet: true }) : schedule(kind)), kind === 'quakes' ? QUAKE_REFRESH_MS : FIRE_REFRESH_MS);
  }

  async function load(kind, { quiet = false } = {}) {
    if (!enabled[kind]) return;
    let url = '/api/quakes';
    if (kind === 'fires') {
      const bbox = fireBboxParam(getMap()?.globe.getViewBounds() ?? null);
      if (!bbox) {
        requests.fires?.abort();
        data.fires = [];
        lastFireBbox = null;
        draw('fires');
        status('fires', { state: 'zoom' });
        return;
      }
      lastFireBbox = bbox;
      url = `/api/fires?bbox=${encodeURIComponent(bbox)}`;
    }
    if (!quiet) status(kind, { state: 'loading' });
    try {
      const { response, body } = await getJson(kind, url);
      if (!enabled[kind]) return;
      if (kind === 'fires' && body?.reason === 'missing_key') {
        status('fires', { state: 'missing_key' });
        return; // configuration, not a transient error: no polling
      }
      if (!response.ok || !body || body.enabled === false) throw new Error(body?.message || `HTTP ${response.status}`);
      data[kind] = kind === 'quakes' ? body.events ?? [] : body.points ?? [];
      attribution[kind] = body.attribution || '';
      draw(kind);
      status(kind, { state: 'ready', count: data[kind].length, stale: Boolean(body.stale) });
    } catch (error) {
      if (error?.name === 'AbortError') return;
      status(kind, { state: 'error', message: String(error?.message || error) });
    }
    schedule(kind);
  }

  function select(pick) {
    selected = pick;
    layer?.setSelected(pick?.data ?? null);
    card.show(pick, { attribution: pick ? attribution[pick.kind === 'quake' ? 'quakes' : 'fires'] : '' });
    onSelect(pick);
  }

  const onVisibility = () => {
    if (!visible()) return;
    for (const kind of ['quakes', 'fires']) if (enabled[kind]) load(kind, { quiet: true });
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    /** Called once Cesium exists. */
    attach(globe) {
      layer = createLayer(globe, { onSelect: select });
      draw('quakes');
      draw('fires');
      globe.onViewChanged(() => {
        if (!enabled.fires) return;
        clearTimeout(viewTimer);
        viewTimer = setTimeout(() => {
          if (fireBboxParam(getMap()?.globe.getViewBounds() ?? null) !== lastFireBbox) load('fires');
        }, VIEW_DEBOUNCE_MS);
      });
      for (const kind of ['quakes', 'fires']) if (enabled[kind]) load(kind);
    },

    /** @param {'quakes' | 'fires'} kind */
    setEnabled(kind, on) {
      if (enabled[kind] === on) return;
      enabled[kind] = on;
      if (!on) {
        clearTimeout(timers[kind]);
        requests[kind]?.abort();
        if (selected && (selected.kind === 'quake') === (kind === 'quakes')) select(null);
        draw(kind);
        status(kind, { state: 'off' });
        return;
      }
      draw(kind);
      if (layer) load(kind);
      else status(kind, { state: 'loading' });
    },

    clearSelection: () => selected && select(null),
    refreshTheme: () => layer?.refreshTheme(),

    destroy() {
      document.removeEventListener('visibilitychange', onVisibility);
      for (const kind of ['quakes', 'fires']) {
        clearTimeout(timers[kind]);
        requests[kind]?.abort();
      }
      clearTimeout(viewTimer);
      layer?.destroy();
    },
  };
}
