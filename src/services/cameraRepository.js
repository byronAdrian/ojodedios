/**
 * Client-side catalog access. Loads provider catalogs from the same-origin
 * API, re-validates every record (defence in depth), caches per session and
 * reports per-source status so the UI can be honest about partial failures.
 */
import { createCamera } from '../domain/camera.js';

/** Which providers each explorer scope needs. */
export const SCOPE_SOURCES = Object.freeze({
  spain: ['dgt', 'madrid', 'livestream'],
  world: ['dgt', 'madrid', 'livestream', 'tfl', 'fintraffic'],
});

/**
 * @typedef {{ state: 'idle' | 'loading' | 'ready' | 'error' | 'disabled', count: number, stale?: boolean, message?: string, checkedAt?: string }} SourceStatus
 */

export function createCameraRepository({ fetchImpl = (...a) => globalThis.fetch(...a), baseUrl = '' } = {}) {
  /** @type {Map<string, Promise<{ cameras: import('../domain/camera.js').Camera[], status: SourceStatus }>>} */
  const inflight = new Map();

  async function loadSource(sourceId, signal) {
    try {
      const response = await fetchImpl(`${baseUrl}/api/cameras?source=${encodeURIComponent(sourceId)}`, {
        signal,
        headers: { Accept: 'application/json' },
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body) {
        return { cameras: [], status: { state: 'error', count: 0, message: body?.message || `HTTP ${response.status}` } };
      }
      if (body.enabled === false) return { cameras: [], status: { state: 'disabled', count: 0 } };
      const cameras = (Array.isArray(body.cameras) ? body.cameras : [])
        .map(createCamera)
        .filter((c) => c && c.providerId === sourceId);
      return {
        cameras,
        status: { state: 'ready', count: cameras.length, stale: Boolean(body.stale), checkedAt: body.checkedAt },
      };
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      return { cameras: [], status: { state: 'error', count: 0, message: 'Sin conexión con el servidor' } };
    }
  }

  return {
    /**
     * Load (or reuse) one source. Successful results are cached for the session;
     * failures are not, so "Reintentar" really retries.
     */
    getSource(sourceId, signal) {
      if (!inflight.has(sourceId)) {
        const promise = loadSource(sourceId, signal).then((result) => {
          if (result.status.state === 'error') inflight.delete(sourceId);
          return result;
        }, (error) => {
          inflight.delete(sourceId);
          throw error;
        });
        inflight.set(sourceId, promise);
      }
      return inflight.get(sourceId);
    },
    invalidate(sourceId) {
      inflight.delete(sourceId);
    },
  };
}
