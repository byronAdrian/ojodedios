/**
 * Web-standard (Request → Response) handlers shared by the Vercel Functions in
 * /api and the Vite dev middleware. Pure apart from the injected deps, so they
 * are unit/integration-testable without a server.
 */
import { SOURCES, isSourceEnabled, loadCatalog } from '../sources/registry.js';
import { safeFetch, UpstreamError } from '../http/safeFetch.js';
import { createRateLimiter, clientKey } from './rateLimit.js';

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
        { error: 'upstream_unavailable', sourceId, message: error instanceof UpstreamError ? error.message : 'Catalog parse failed' },
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
        allowedHosts: source.frameHosts,
        timeoutMs: 8_000,
        maxBytes: FRAME_MAX_BYTES,
        fetchImpl,
        headers: { Accept: 'image/*' },
      });
      const type = sniffImageType(body);
      if (!type) return jsonResponse(502, { error: 'not_an_image' }, { 'Cache-Control': 'public, s-maxage=30' });
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
      return jsonResponse(status, { error: 'frame_unavailable' }, { 'Cache-Control': 'public, s-maxage=30' });
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

  return { cameras, frame, health };
}

let shared;
/** Lazily-created handlers reused across invocations of a warm instance. */
export const sharedHandlers = () => (shared ??= createHandlers());
