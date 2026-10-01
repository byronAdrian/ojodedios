/**
 * Polls /api/flights for the area in view and keeps a bounded, session-only
 * trail (observed positions) per aircraft. Pure apart from the injected
 * fetch/timers, so it is unit-testable without a browser.
 */
export const POLL_MS = 15_000;
export const MAX_VIEW_KM = 1_600; // beyond this span the feed would be a misleading sample
const MAX_TRAIL_POINTS = 120;
const TRAIL_TTL_MS = 5 * 60_000;
const NM_PER_KM = 1 / 1.852;

/** Radius (nm) covering a view of `km` across, capped by the API maximum. */
export const radiusForSpan = (km) => Math.min(250, Math.max(25, Math.ceil((km / 2) * NM_PER_KM)));

/**
 * @param {{ fetchImpl?: typeof fetch, getView: () => ({ lat: number, lon: number, km: number } | null),
 *   onUpdate: (state: { status: 'idle'|'loading'|'ready'|'zoom'|'error'|'disabled', aircraft: object[], message?: string }) => void,
 *   now?: () => number, setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout }} deps
 */
export function createFlightService({ fetchImpl = (...a) => globalThis.fetch(...a), getView, onUpdate, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout }) {
  /** @type {Map<string, { points: Array<[number, number, number]>, lastSeen: number }>} */
  const trails = new Map();
  let timer = 0;
  let running = false;
  let controller = null;
  let aircraft = [];

  function recordTrails(list) {
    const t = now();
    for (const a of list) {
      const entry = trails.get(a.hex) ?? { points: [], lastSeen: t };
      const last = entry.points.at(-1);
      if (!last || last[0] !== a.lon || last[1] !== a.lat) {
        entry.points.push([a.lon, a.lat, a.altitudeM ?? 0]);
        if (entry.points.length > MAX_TRAIL_POINTS) entry.points.shift();
      }
      entry.lastSeen = t;
      trails.set(a.hex, entry);
    }
    for (const [hex, entry] of trails) if (t - entry.lastSeen > TRAIL_TTL_MS) trails.delete(hex);
  }

  async function poll() {
    timer = 0;
    if (!running) return;
    const view = getView();
    if (!view) {
      schedule();
      return;
    }
    if (view.km > MAX_VIEW_KM) {
      aircraft = [];
      onUpdate({ status: 'zoom', aircraft });
      schedule();
      return;
    }
    controller?.abort();
    controller = new AbortController();
    const params = new URLSearchParams({ lat: view.lat.toFixed(3), lon: view.lon.toFixed(3), dist: String(radiusForSpan(view.km)) });
    try {
      const response = await fetchImpl(`/api/flights?${params}`, { signal: controller.signal });
      const body = await response.json().catch(() => null);
      if (!running) return;
      if (body?.enabled === false) {
        onUpdate({ status: 'disabled', aircraft: [] });
        return; // nothing to poll
      }
      if (!response.ok || !Array.isArray(body?.aircraft)) {
        onUpdate({ status: 'error', aircraft, message: body?.message || `HTTP ${response.status}` });
      } else {
        aircraft = body.aircraft;
        recordTrails(aircraft);
        onUpdate({ status: 'ready', aircraft, stale: Boolean(body.stale), attribution: body.attribution || null });
      }
    } catch (error) {
      if (error?.name === 'AbortError') return;
      onUpdate({ status: 'error', aircraft, message: 'Sin conexión' });
    }
    schedule();
  }

  function schedule() {
    if (running && !timer) timer = setTimer(poll, POLL_MS);
  }

  return {
    start() {
      if (running) return;
      running = true;
      onUpdate({ status: 'loading', aircraft });
      poll();
    },
    stop() {
      running = false;
      if (timer) clearTimer(timer);
      timer = 0;
      controller?.abort();
      aircraft = [];
      onUpdate({ status: 'idle', aircraft });
    },
    /** Re-query now (view changed); keeps the regular cadence afterwards. */
    refresh() {
      if (!running) return;
      if (timer) clearTimer(timer);
      timer = 0;
      poll();
    },
    trail: (hex) => trails.get(hex)?.points ?? [],
    find: (hex) => aircraft.find((a) => a.hex === hex) ?? null,
    get running() {
      return running;
    },
  };
}
