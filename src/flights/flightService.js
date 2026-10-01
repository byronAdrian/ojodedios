/**
 * Polls /api/flights for the area in view and keeps a bounded, session-only
 * trail (observed positions) per aircraft. Pure apart from the injected
 * fetch/timers, so it is unit-testable without a browser.
 */
export const POLL_MS = 15_000;
export const MAX_VIEW_KM = 1_600; // beyond this span the regional feeds give way to the world snapshot
export const MAX_RENDERED = 4_000; // keeps the globe responsive on mid-range devices
const WORLD_MIN_POLL_MS = 60_000;
export const MAX_TILES = 12;
const TILE_RADIUS_NM = 250;
const TILE_STEP_DEG = 6; // ≈ 667 km: 250 nm circles on this grid overlap and leave no gaps
const TILE_TTL_MS = 30_000;
const TILE_GAP_MS = 700; // spacing between tile requests (provider rate limits)

/**
 * Grid tile centres covering [w,s,e,n], nearest to the view centre first.
 * Centres sit on a fixed grid so every visitor requests the same URLs (CDN-shared).
 */
export function tilesFor(bounds, center, max = MAX_TILES) {
  const [w, s, e, n] = bounds ?? [center.lon - 10, center.lat - 8, center.lon + 10, center.lat + 8];
  const tiles = [];
  const south = Math.max(-84, Math.floor(s / TILE_STEP_DEG) * TILE_STEP_DEG);
  const north = Math.min(84, Math.ceil(n / TILE_STEP_DEG) * TILE_STEP_DEG);
  const east = w <= e ? e : e + 360;
  for (let lat = south; lat <= north; lat += TILE_STEP_DEG) {
    const lonStep = Math.min(60, Math.round((TILE_STEP_DEG / Math.max(0.2, Math.cos((lat * Math.PI) / 180))) * 2) / 2);
    for (let lon = Math.floor(w / lonStep) * lonStep; lon <= east + 1e-9; lon += lonStep) {
      const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
      tiles.push({ lat, lon: Math.round(wrapped * 2) / 2 });
    }
  }
  const d = (t) => (t.lat - center.lat) ** 2 + ((t.lon - center.lon) * Math.cos((center.lat * Math.PI) / 180)) ** 2;
  return tiles.sort((a, b) => d(a) - d(b)).slice(0, max);
}

/** OpenSky world tuples → aircraft objects (fields as declared by the API). */
export function fromWorldTuples(rows) {
  return rows.map(([hex, callsign, lat, lon, altitudeM, onGround, speedKmh, track]) => ({
    hex, callsign, registration: null, type: null, lat, lon, altitudeM, onGround, speedKmh, track, seenS: null,
  }));
}

/** Aircraft inside [w,s,e,n] (antimeridian-aware), capped by even sampling. */
export function inBounds(aircraft, bounds, cap = MAX_RENDERED) {
  const visible = bounds
    ? aircraft.filter((a) => {
        const [w, s, e, n] = bounds;
        if (a.lat < s || a.lat > n) return false;
        return w <= e ? a.lon >= w && a.lon <= e : a.lon >= w || a.lon <= e;
      })
    : aircraft;
  if (visible.length <= cap) return visible;
  const step = visible.length / cap;
  return Array.from({ length: cap }, (_, i) => visible[Math.floor(i * step)]);
}
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
export function createFlightService({ fetchImpl = (...a) => globalThis.fetch(...a), getView, getBounds = () => null, onUpdate, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  let world = null; // { at, refreshMs, aircraft, attribution, stale }
  let worldMode = 'snapshot'; // falls back to 'tiles' for the session if the snapshot fails
  /** tile key → { at, aircraft } */
  const tileCache = new Map();
  let tileRun = 0;
  let nextDelay = POLL_MS;
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
      if (worldMode === 'snapshot') await pollWorld();
      else await pollTiles(view);
      return;
    }
    nextDelay = POLL_MS;
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

  /** Wide views: shared worldwide snapshot, re-fetched no faster than its refresh period. */
  async function pollWorld() {
    const t = now();
    if (!world || t - world.at >= world.refreshMs) {
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetchImpl('/api/flights?scope=world', { signal: controller.signal });
        const body = await response.json().catch(() => null);
        if (!running) return;
        if (response.ok && Array.isArray(body?.aircraft)) {
          world = {
            at: t,
            refreshMs: Math.max(WORLD_MIN_POLL_MS, (Number(body.refreshSeconds) || 60) * 1000),
            aircraft: fromWorldTuples(body.aircraft),
            attribution: body.attribution || null,
            stale: Boolean(body.stale),
          };
        } else if (body?.enabled === false) {
          onUpdate({ status: 'disabled', aircraft: [] });
          return;
        } else {
          worldMode = 'tiles'; // e.g. OpenSky unreachable from the host: cover the view with regional tiles
          await pollTiles(getView());
          return;
        }
      } catch (error) {
        if (error?.name === 'AbortError') return;
        worldMode = 'tiles';
        await pollTiles(getView());
        return;
      }
    }
    aircraft = inBounds(world.aircraft, getBounds());
    onUpdate({ status: 'ready', scope: 'world', aircraft, total: world.aircraft.length, stale: world.stale, attribution: world.attribution, refreshSeconds: world.refreshMs / 1000 });
    nextDelay = Math.max(5_000, world.refreshMs - (now() - world.at));
    schedule();
  }

  /** Wide views without a world snapshot: progressive, rate-limited regional tiles. */
  async function pollTiles(view) {
    if (!view) {
      schedule();
      return;
    }
    const run = ++tileRun;
    const tiles = tilesFor(getBounds(), view);
    const merged = new Map();
    let attribution = null;
    let failures = 0;
    for (const tile of tiles) {
      if (!running || run !== tileRun) return; // view changed: a newer run took over
      const key = `${tile.lat},${tile.lon}`;
      let entry = tileCache.get(key);
      if (!entry || now() - entry.at > TILE_TTL_MS) {
        controller = new AbortController();
        try {
          const params = new URLSearchParams({ lat: String(tile.lat), lon: String(tile.lon), dist: String(TILE_RADIUS_NM) });
          const response = await fetchImpl(`/api/flights?${params}`, { signal: controller.signal });
          const body = await response.json().catch(() => null);
          if (response.ok && Array.isArray(body?.aircraft)) {
            entry = { at: now(), aircraft: body.aircraft, attribution: body.attribution };
            tileCache.set(key, entry);
          } else failures += 1;
        } catch (error) {
          if (error?.name === 'AbortError') return;
          failures += 1;
        }
        if (run === tileRun) await sleep(TILE_GAP_MS);
      }
      if (entry) {
        for (const a of entry.aircraft) merged.set(a.hex, a);
        attribution ||= entry.attribution;
      }
      if (!running || run !== tileRun) return;
      aircraft = inBounds([...merged.values()], getBounds());
      recordTrails(aircraft);
      onUpdate({ status: 'ready', scope: 'tiles', aircraft, attribution, tiles: tiles.length, failures });
    }
    if (tileCache.size > 200) tileCache.delete(tileCache.keys().next().value);
    if (!merged.size && failures) onUpdate({ status: 'error', aircraft, message: 'Fuentes regionales no disponibles' });
    nextDelay = TILE_TTL_MS;
    schedule();
  }

  function schedule() {
    if (running && !timer) timer = setTimer(poll, nextDelay);
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
      tileRun += 1; // cancel an in-progress tile sweep for the old view
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
