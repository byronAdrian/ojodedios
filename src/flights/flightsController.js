/**
 * Wires the flight service, layer and panel. Independent of the camera store:
 * the application only tells it when the map exists, when the view moves and
 * when a camera got selected (so the two selections never overlap).
 */
import { createFlightService } from './flightService.js';
import { createFlightDetail } from './flightDetail.js';

/**
 * @param {{ container: HTMLElement, getMap: () => any, createLayer: (globe, opts) => any,
 *   onSelectionChange: (hasFlight: boolean) => void, onStatus: (s: object) => void }} deps
 */
export function createFlightsController({ container, getMap, createLayer, onSelectionChange, onStatus, fetchImpl = (...a) => globalThis.fetch(...a) }) {
  /** hex → { points, source } from /api/flight-trace (the day's real flown track). */
  const traces = new Map();
  let traceRequest = null;

  /** Real track first, then positions observed after its last point. */
  function routeOf(hex) {
    const full = traces.get(hex)?.points ?? [];
    const session = service.trail(hex);
    if (!full.length) return session;
    const last = full.at(-1);
    const tailFrom = session.findIndex(([lon, lat]) => lon === last[0] && lat === last[1]);
    return full.concat(tailFrom >= 0 ? session.slice(tailFrom + 1) : session.slice(-1));
  }

  async function loadTrace(hex) {
    traceRequest?.abort();
    traceRequest = new AbortController();
    try {
      const response = await fetchImpl(`/api/flight-trace?hex=${encodeURIComponent(hex)}`, { signal: traceRequest.signal });
      const body = await response.json().catch(() => null);
      if (response.ok && Array.isArray(body?.points)) traces.set(hex, { points: body.points, source: body.source });
      else traces.set(hex, { points: [], error: body?.message || `HTTP ${response.status}` });
    } catch (error) {
      if (error?.name === 'AbortError') return;
      traces.set(hex, { points: [], error: 'Sin conexión' });
    }
    if (selectedHex === hex) refreshSelected();
  }

  function refreshSelected() {
    const a = service.find(selectedHex) ?? lastShown;
    const route = routeOf(selectedHex);
    layer?.setSelected(selectedHex, route);
    if (a) detail.show(a, { trailPoints: route.length, attribution, trace: traces.get(selectedHex), lost: !service.find(selectedHex) });
  }

  let layer = null;
  let selectedHex = null;
  let lastAircraft = [];
  let lastShown = null;
  let attribution = null;

  const detail = createFlightDetail({
    container,
    onClose: () => select(null),
    onCenter: (a) => getMap()?.globe.flyTo({ lat: a.lat, lon: a.lon, km: 40 }),
  });

  const service = createFlightService({
    getView: () => getMap()?.globe.getViewTarget() ?? null,
    getBounds: () => getMap()?.globe.getViewBounds() ?? null,
    onUpdate(state) {
      lastAircraft = state.aircraft;
      if (state.attribution) attribution = state.attribution;
      // World view: no wakes (thousands of polylines would cost more than they say).
      layer?.setAircraft(state.aircraft, state.scope ? () => [] : (hex) => service.trail(hex));
      if (selectedHex) {
        const a = service.find(selectedHex);
        if (a) lastShown = a;
        refreshSelected();
      }
      onStatus({ ...state, count: state.aircraft.length });
    },
  });

  function select(hex) {
    selectedHex = hex;
    const a = hex ? service.find(hex) : null;
    lastShown = a;
    layer?.setSelected(hex, hex ? routeOf(hex) : []);
    detail.show(a, { trailPoints: hex ? routeOf(hex).length : 0, attribution, trace: hex ? traces.get(hex) : null });
    onSelectionChange(Boolean(a));
    if (hex && a && !traces.has(hex)) loadTrace(hex);
    if (!hex) traceRequest?.abort();
  }

  return {
    /** Call once the globe exists. */
    attach(globe) {
      layer = createLayer(globe, { onSelect: (hex) => select(hex) });
      layer.setAircraft(lastAircraft);
    },
    setEnabled(on) {
      if (on) service.start();
      else {
        select(null);
        service.stop();
      }
    },
    viewChanged: () => service.refresh(),
    refreshTheme: () => layer?.refreshTheme(),
    clearSelection: () => selectedHex && select(null),
    get selectedHex() {
      return selectedHex;
    },
  };
}
