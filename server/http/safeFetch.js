/**
 * Outbound HTTP for provider adapters. Every request:
 *  - targets an https/http URL whose host is in the caller's allowlist,
 *  - follows at most MAX_REDIRECTS redirects, and only to allowlisted hosts
 *    (e.g. http→https upgrades or a provider's own domain move),
 *  - has a hard timeout and a response-size ceiling.
 * No user-supplied URL ever reaches this function: adapters build URLs from
 * constants and validated identifiers only (see SECURITY.md).
 */
export class UpstreamError extends Error {
  /** @param {string} message @param {{ status?: number, cause?: unknown }} [info] */
  constructor(message, { status = 502, cause } = {}) {
    super(message, { cause });
    this.name = 'UpstreamError';
    this.status = status;
  }
}

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_BYTES = 15 * 1024 * 1024;
const MAX_REDIRECTS = 2;

/** True when `url` parses and its hostname is exactly one of `allowedHosts`. */
export function isAllowedUrl(url, allowedHosts) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    if (parsed.username || parsed.password) return false;
    if (parsed.port && parsed.port !== '443' && parsed.port !== '80') return false;
    return allowedHosts.includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * @param {string} url
 * @param {{ allowedHosts: string[], headers?: Record<string,string>, timeoutMs?: number,
 *           maxBytes?: number, fetchImpl?: typeof fetch, signal?: AbortSignal,
 *           method?: string, body?: string }} options
 * @returns {Promise<{ body: Uint8Array, contentType: string, status: number, headers: Headers }>}
 */
export async function safeFetch(url, options) {
  const {
    allowedHosts,
    headers = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    fetchImpl = globalThis.fetch,
    signal,
    method = 'GET',
    body: requestBody,
  } = options;
  if (!isAllowedUrl(url, allowedHosts)) {
    throw new UpstreamError(`Host not allowed: ${url}`, { status: 500 });
  }
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let current = url;
  let response;
  for (let hop = 0; ; hop += 1) {
    try {
      response = await fetchImpl(current, {
        headers: {
          'User-Agent': 'worldview-espana/0.1 (+https://github.com/byronAdrian/ojodedios)',
          ...headers,
        },
        redirect: 'manual',
        signal: combined,
        method,
        ...(requestBody === undefined ? {} : { body: requestBody }),
      });
    } catch (cause) {
      const timedOut = timeout.aborted;
      throw new UpstreamError(timedOut ? 'Upstream timeout' : 'Upstream unreachable', {
        status: timedOut ? 504 : 502,
        cause,
      });
    }
    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get('location');
    const next = location ? new URL(location, current).toString() : '';
    if (hop >= MAX_REDIRECTS || !isAllowedUrl(next, allowedHosts)) {
      throw new UpstreamError(`Upstream redirected (${response.status}) outside the allowlist`);
    }
    current = next;
  }
  if (!response.ok) {
    throw new UpstreamError(`Upstream HTTP ${response.status}`, {
      status: response.status === 404 ? 404 : 502,
    });
  }
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new UpstreamError('Upstream response too large');
  }
  const body = await readBounded(response, maxBytes);
  return {
    body,
    contentType: (response.headers.get('content-type') || '').toLowerCase(),
    status: response.status,
    headers: response.headers,
  };
}

async function readBounded(response, maxBytes) {
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      // Not awaited: cancel() on a tee'd body only settles once every branch is cancelled.
      reader.cancel().catch(() => {});
      throw new UpstreamError('Upstream response too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export const decodeText = (bytes) => new TextDecoder('utf-8').decode(bytes);
