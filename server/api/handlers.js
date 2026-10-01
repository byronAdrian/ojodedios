/**
 * Web-standard (Request → Response) handlers shared by the Vercel Functions in
 * /api and the Vite dev middleware. Pure apart from the injected deps, so they
 * are unit/integration-testable without a server.
 */
import { SOURCES, isSourceEnabled, loadCatalog } from '../sources/registry.js';
import { safeFetch, UpstreamError } from '../http/safeFetch.js';
import { createRateLimiter, clientKey } from './rateLimit.js';
import { createOpenSkyClient, openskyTtlMs } from '../sources/opensky.js';
import { FLIGHT_PROVIDERS, TRACE_PROVIDERS, normalizeAdsbLol, quantiseFlightQuery, validHex, traceUrl, parseTrace } from '../sources/flights.js';
import { USGS_FEED_URL, USGS_ALLOWED_HOSTS, USGS_ATTRIBUTION, parseUsgsFeed } from '../sources/usgs.js';
import { FIRMS_HOST, FIRMS_ATTRIBUTION, quantiseFireBbox, firmsUrl, parseFirmsCsv } from '../sources/firms.js';

const CATALOG_TTL_MS = 15 * 60 * 1000;
const FRAME_MAX_BYTES = 3 * 1024 * 1024;
const SECURITY_HEADERS = { 'X-Content-Type-Options': 'nosniff' };

const jsonResponse = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...headers },
  });

const methodGuard = (request) =>
  request.method === 'GET' || request.method === 'HEAD'
    ? null
    : jsonResponse(405, { error: 'method_not_allowed' }, { Allow: 'GET, HEAD' });

/** JPEG, PNG, GIF or WebP signature check — the upstream content-type is not trusted alone. */
export function sniffImageType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

export function createHandlers({ env = process.env, fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
  /** @type {Map<string, { expires: number, value?: object, pending?: Promise<object> }>} */
  const cache = new Map();
  const frameLimiter = createRateLimiter({ limit: Number(env.FRAME_RATE_LIMIT_PER_MIN) || 240, windowMs: 60_000 });

  /** Coalesces concurrent requests and keeps a warm copy per instance. */
  function cachedCatalog(sourceId) {
    const t = now().getTime();
    const hit = cache.get(sourceId);
    if (hit?.value && hit.expires > t) return Promise.resolve(hit.value);
    if (hit?.pending) return hit.pending;
    const pending = loadCatalog(sourceId, { env, fetchImpl, now })
      .then((value) => {
        cache.set(sourceId, { value, expires: now().getTime() + CATALOG_TTL_MS });
        return value;
      })
      .catch((error) => {
        // Serve the last good catalog (stale) rather than nothing.
        if (hit?.value) {
          cache.set(sourceId, { value: hit.value, expires: hit.expires });
          return { ...hit.value, stale: true };
        }
        cache.delete(sourceId);
        throw error;
      });
    cache.set(sourceId, { ...hit, pending, expires: hit?.expires ?? 0 });
    return pending;
  }

  async function cameras(request) {
    const blocked = methodGuard(request);
    if (blocked) return blocked;
    const sourceId = new URL(request.url).searchParams.get('source') || '';
    const source = SOURCES[sourceId];
    if (!source) {
      return jsonResponse(400, { error: 'unknown_source', sources: Object.keys(SOURCES) });
    }
    if (!isSourceEnabled(source, env)) {
      return jsonResponse(200, { sourceId, enabled: false, cameras: [] }, { 'Cache-Control': 'public, s-maxage=300' });
    }
    try {
      const catalog = await cachedCatalog(sourceId);
      return jsonResponse(
        200,
        { enabled: true, ...catalog },
        { 'Cache-Control': 'public, max-age=60, s-maxage=900, stale-while-revalidate=3600' },
      );
    } catch (error) {
      const status = error instanceof UpstreamError ? 502 : 500;
      console.warn(`[cameras:${sourceId}]`, error?.message || error);
      return jsonResponse(
        status,
        {
          error: error instanceof UpstreamError ? 'upstream_unavailable' : 'catalog_unusable',
          sourceId,
          // Upstream/parse messages describe public provider data only; safe to expose for diagnosis.
          message: String(error?.message || error).slice(0, 300),
        },
        { 'Cache-Control': 'public, s-maxage=60' },
      );
    }
  }

  async function frame(request) {
    const blocked = methodGuard(request);
    if (blocked) return blocked;
    if (!frameLimiter(clientKey(request))) {
      return jsonResponse(429, { error: 'rate_limited' }, { 'Retry-After': '60' });
    }
    const id = new URL(request.url).searchParams.get('id') || '';
    const separator = id.indexOf(':');
    const source = separator > 0 ? SOURCES[id.slice(0, separator)] : null;
    // Only providers whose frames need proxying expose frameUrl; it validates
    // the native id strictly and builds the upstream URL from a constant.
    const upstreamUrl = source?.frameUrl?.(id.slice(separator + 1)) ?? null;
    if (!upstreamUrl || !isSourceEnabled(source, env)) {
      return jsonResponse(404, { error: 'unknown_camera' });
    }
    try {
      const { body } = await safeFetch(upstreamUrl, {
        allowedHosts: typeof source.frameHosts === 'function' ? source.frameHosts(upstreamUrl) : source.frameHosts,
        timeoutMs: 8_000,
        maxBytes: FRAME_MAX_BYTES,
        fetchImpl,
        headers: { Accept: 'image/*' },
      });
      const type = sniffImageType(body);
      if (!type) {
        return jsonResponse(502, { error: 'not_an_image', message: `El proveedor devolvió ${body.length} bytes que no son una imagen` }, { 'Cache-Control': 'public, s-maxage=30' });
      }
      return new Response(request.method === 'HEAD' ? null : body, {
        status: 200,
        headers: {
          'Content-Type': type,
          'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=120',
          'Content-Security-Policy': "default-src 'none'",
          ...SECURITY_HEADERS,
        },
      });
    } catch (error) {
      const status = error instanceof UpstreamError && error.status === 404 ? 404 : 502;
      // The reason (e.g. "Upstream HTTP 403", "Upstream timeout") names no secret; it makes provider blocks diagnosable.
      const message = error instanceof UpstreamError ? error.message : 'Error interno';
      return jsonResponse(status, { error: 'frame_unavailable', message }, { 'Cache-Control': 'public, s-maxage=30' });
    }
  }

  /** @type {Map<string, { at: number, body: object }>} */
  const flightCache = new Map();
  const FLIGHT_TTL_MS = 10_000;
  const FLIGHT_STALE_MS = 120_000;
  /** provider id → epoch ms until which it is skipped (after 429/5xx/timeout). */
  const flightCooldown = new Map();
  const FLIGHT_COOLDOWN_MS = 60_000;

  const opensky = createOpenSkyClient({ env, fetchImpl, now: () => now().getTime() });
  /** Shared worldwide snapshot: { at, ttl, body } — one upstream call per TTL per instance. */
  let world = null;
  let worldPending = null;

  async function worldFlights() {
    const t = now().getTime();
    const cacheHeaders = (ttl) => ({ 'Cache-Control': `public, max-age=30, s-maxage=${Math.round(ttl / 1000)}, stale-while-revalidate=${Math.round(ttl / 1000) * 2}` });
    if (world && t - world.at < world.ttl) return jsonResponse(200, world.body, cacheHeaders(world.ttl - (t - world.at)));
    if (t < (flightCooldown.get('opensky') ?? 0)) {
      if (world) return jsonResponse(200, { ...world.body, stale: true }, cacheHeaders(60_000));
      return jsonResponse(503, { error: 'rate_limited', message: 'OpenSky en espera tras un error o límite de uso' }, { 'Retry-After': '120' });
    }
    worldPending ??= opensky
      .snapshot()
      .then(({ aircraft, remaining, authenticated }) => {
        const ttl = openskyTtlMs({ authenticated, remaining });
        world = {
          at: now().getTime(),
          ttl,
          body: {
            enabled: true,
            scope: 'world',
            source: 'opensky',
            attribution: 'The OpenSky Network (uso no comercial)',
            authenticated,
            refreshSeconds: Math.round(ttl / 1000),
            fetchedAt: now().toISOString(),
            fields: ['hex', 'callsign', 'lat', 'lon', 'altitudeM', 'onGround', 'speedKmh', 'track'],
            aircraft,
          },
        };
        return world;
      })
      .finally(() => {
        worldPending = null;
      });
    try {
      const snapshot = await worldPending;
      return jsonResponse(200, snapshot.body, cacheHeaders(snapshot.ttl));
    } catch (error) {
      flightCooldown.set('opensky', t + 5 * 60_000);
      if (world) return jsonResponse(200, { ...world.body, stale: true }, cacheHeaders(60_000));
      return jsonResponse(502, { error: 'upstream_unavailable', message: `OpenSky: ${String(error?.message || error).slice(0, 200)}` }, { 'Cache-Control': 'public, s-maxage=60' });
    }
  }

  async function flights(request) {
    const blocked = methodGuard(request);
    if (blocked) return blocked;
    if (String(env.SOURCE_FLIGHTS_ENABLED ?? '1') === '0') {
      return jsonResponse(200, { enabled: false, aircraft: [] }, { 'Cache-Control': 'public, s-maxage=300' });
    }
    const params = new URL(request.url).searchParams;
    // One URL for the whole planet → the CDN shares it between every visitor.
    if (params.get('scope') === 'world') return worldFlights();
    const query = quantiseFlightQuery(params.get('lat'), params.get('lon'), params.get('dist'));
    if (!query) return jsonResponse(400, { error: 'invalid_query' });
    const key = `${query.lat},${query.lon},${query.dist}`;
    const t = now().getTime();
    const hit = flightCache.get(key);
    const headers = { 'Cache-Control': 'public, max-age=5, s-maxage=10, stale-while-revalidate=20' };
    if (hit && t - hit.at < FLIGHT_TTL_MS) return jsonResponse(200, hit.body, headers);

    const failures = [];
    for (const provider of FLIGHT_PROVIDERS) {
      if (t < (flightCooldown.get(provider.id) ?? 0)) {
        failures.push(`${provider.id}: en espera`);
        continue;
      }
      try {
        const { body } = await safeFetch(provider.url(query), {
          allowedHosts: provider.hosts,
          timeoutMs: 6_000,
          maxBytes: 8 * 1024 * 1024,
          fetchImpl,
          headers: { Accept: 'application/json' },
        });
        const result = {
          enabled: true,
          query,
          source: provider.id,
          attribution: provider.attribution,
          fetchedAt: now().toISOString(),
          aircraft: normalizeAdsbLol(JSON.parse(new TextDecoder().decode(body))),
        };
        if (flightCache.size > 500) flightCache.delete(flightCache.keys().next().value);
        flightCache.set(key, { at: t, body: result });
        return jsonResponse(200, result, headers);
      } catch (error) {
        // Rate limits, outages and malformed payloads all sideline the provider for a while.
        flightCooldown.set(provider.id, t + FLIGHT_COOLDOWN_MS);
        failures.push(`${provider.id}: ${String(error?.message || error).slice(0, 80)}`);
      }
    }
    if (hit && t - hit.at < FLIGHT_STALE_MS) return jsonResponse(200, { ...hit.body, stale: true }, headers);
    return jsonResponse(502, { error: 'upstream_unavailable', message: failures.join(' · ').slice(0, 400) }, { 'Cache-Control': 'public, s-maxage=10' });
  }

  async function flightTrace(request) {
    const blocked = methodGuard(request);
    if (blocked) return blocked;
    const hex = validHex(new URL(request.url).searchParams.get('hex'));
    if (!hex) return jsonResponse(400, { error: 'invalid_hex' });
    const t = now().getTime();
    const failures = [];
    for (const provider of TRACE_PROVIDERS) {
      if (t < (flightCooldown.get(`trace:${provider.id}`) ?? 0)) {
        failures.push(`${provider.id}: en espera`);
        continue;
      }
      try {
        const { body } = await safeFetch(traceUrl(provider.host, hex), {
          allowedHosts: [provider.host],
          timeoutMs: 6_000,
          maxBytes: 4 * 1024 * 1024,
          fetchImpl,
          headers: { Accept: 'application/json' },
        });
        const trace = parseTrace(JSON.parse(new TextDecoder().decode(body)));
        return jsonResponse(200, { hex, source: provider.id, ...trace }, { 'Cache-Control': 'public, max-age=15, s-maxage=30' });
      } catch (error) {
        // A 404 just means this network has no track for the aircraft: try the next one, no cooldown.
        if (!(error instanceof UpstreamError && error.status === 404)) flightCooldown.set(`trace:${provider.id}`, t + FLIGHT_COOLDOWN_MS);
        failures.push(`${provider.id}: ${String(error?.message || error).slice(0, 80)}`);
      }
    }
    return jsonResponse(502, { error: 'trace_unavailable', message: failures.join(' · ').slice(0, 400) }, { 'Cache-Control': 'public, s-maxage=15' });
  }

  // ---------- natural hazards ----------
  const QUAKE_TTL_MS = 120_000;
  const FIRE_TTL_MS = 15 * 60_000;
  /** key → { at, body } ; quakes use the single key "all". */
  const hazardCache = new Map();
  const hazardPending = new Map();

  /** Coalesced, cached fetch of one hazard document; serves the last good copy when upstream fails. */
  async function cachedHazard(key, ttl, load) {
    const t = now().getTime();
    const hit = hazardCache.get(key);
    if (hit && t - hit.at < ttl) return { body: hit.body, age: t - hit.at };
    if (!hazardPending.has(key)) {
      hazardPending.set(key, load().then(
        (body) => {
          if (hazardCache.size > 300) hazardCache.delete(hazardCache.keys().next().value);
          hazardCache.set(key, { at: now().getTime(), body });
          return body;
        },
      ).finally(() => hazardPending.delete(key)));
    }
    try {
      return { body: await hazardPending.get(key), age: 0 };
    } catch (error) {
      if (hit) return { body: { ...hit.body, stale: true }, age: t - hit.at };
      throw error;
    }
  }

  const hazardError = (error, label) => {
    const upstream = error instanceof UpstreamError;
    return jsonResponse(upstream ? 502 : 500, {
      error: upstream ? 'upstream_unavailable' : 'feed_unusable',
      message: `${label}: ${String(error?.message || error).slice(0, 200)}`,
    }, { 'Cache-Control': 'public, s-maxage=60' });
  };

  async function quakes(request) {
    const blocked = methodGuard(request);
    if (blocked) return blocked;
    if (String(env.SOURCE_QUAKES_ENABLED ?? '1') === '0') {
      return jsonResponse(200, { enabled: false, events: [] }, { 'Cache-Control': 'public, s-maxage=300' });
    }
    try {
      const { body } = await cachedHazard('quakes', QUAKE_TTL_MS, async () => {
        const { body: bytes } = await safeFetch(USGS_FEED_URL, { allowedHosts: USGS_ALLOWED_HOSTS, timeoutMs: 10_000, maxBytes: 10 * 1024 * 1024, fetchImpl, headers: { Accept: 'application/geo+json, application/json' } });
        return {
          enabled: true,
          source: 'usgs',
          attribution: USGS_ATTRIBUTION,
          fetchedAt: now().toISOString(),
          refreshSeconds: QUAKE_TTL_MS / 1000,
          events: parseUsgsFeed(JSON.parse(new TextDecoder().decode(bytes))),
        };
      });
      return jsonResponse(200, body, { 'Cache-Control': 'public, max-age=60, s-maxage=120, stale-while-revalidate=600' });
    } catch (error) {
      console.warn('[quakes]', error?.message || error);
      return hazardError(error, 'USGS');
    }
  }

  async function fires(request) {
    const blocked = methodGuard(request);
    if (blocked) return blocked;
    if (String(env.SOURCE_FIRES_ENABLED ?? '1') === '0') {
      return jsonResponse(200, { enabled: false, reason: 'disabled', points: [] }, { 'Cache-Control': 'public, s-maxage=300' });
    }
    const bbox = quantiseFireBbox(new URL(request.url).searchParams.get('bbox'));
    if (!bbox) return jsonResponse(400, { error: 'invalid_bbox', message: 'Zona no válida o demasiado grande: acerca el mapa' });
    const upstreamUrl = firmsUrl(env.FIRMS_MAP_KEY, bbox);
    if (!upstreamUrl) {
      // Missing/invalid key: an honest, cacheable "not configured" — never a fake empty map.
      return jsonResponse(200, { enabled: false, reason: 'missing_key', points: [] }, { 'Cache-Control': 'public, s-maxage=300' });
    }
    const key = `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`;
    try {
      const { body } = await cachedHazard(`fires:${key}`, FIRE_TTL_MS, async () => {
        const { body: bytes } = await safeFetch(upstreamUrl, { allowedHosts: [FIRMS_HOST], timeoutMs: 15_000, maxBytes: 12 * 1024 * 1024, fetchImpl, headers: { Accept: 'text/csv' } });
        return {
          enabled: true,
          source: 'firms',
          attribution: FIRMS_ATTRIBUTION,
          bbox,
          fetchedAt: now().toISOString(),
          refreshSeconds: FIRE_TTL_MS / 1000,
          points: parseFirmsCsv(new TextDecoder().decode(bytes)),
        };
      });
      return jsonResponse(200, body, { 'Cache-Control': 'public, max-age=300, s-maxage=900, stale-while-revalidate=1800' });
    } catch (error) {
      // Never echo anything that could contain the key (e.g. a URL in an error message).
      const redacted = String(error?.message || error).replace(/[A-Za-z0-9]{16,64}/g, '***');
      console.warn('[fires]', redacted);
      const safe = error instanceof UpstreamError ? new UpstreamError(redacted, { status: error.status }) : new Error(redacted);
      return hazardError(safe, 'NASA FIRMS');
    }
  }

  function health(request) {
    const blocked = methodGuard(request);
    if (blocked) return blocked;
    const sources = Object.values(SOURCES).map((s) => ({
      id: s.id,
      region: s.region,
      enabled: isSourceEnabled(s, env),
      proxiedFrames: Boolean(s.frameUrl),
    }));
    return jsonResponse(200, { ok: true, sources }, { 'Cache-Control': 'no-store' });
  }

  return { cameras, frame, flights, flightTrace, quakes, fires, health };
}

let shared;
/** Lazily-created handlers reused across invocations of a warm instance. */
export const sharedHandlers = () => (shared ??= createHandlers());
