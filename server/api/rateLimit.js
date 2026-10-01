/**
 * Best-effort, per-instance fixed-window limiter. Serverless instances do not
 * share memory, so this only blunts bursts against a warm instance; the real
 * protection is CDN caching of responses (see vercel.json) plus Vercel's
 * firewall. Memory is bounded by MAX_KEYS.
 */
const MAX_KEYS = 5_000;

export function createRateLimiter({ limit, windowMs, now = () => Date.now() }) {
  const hits = new Map();
  return function allow(key) {
    const t = now();
    const entry = hits.get(key);
    if (!entry || t - entry.start >= windowMs) {
      if (!entry && hits.size >= MAX_KEYS) hits.delete(hits.keys().next().value);
      hits.set(key, { start: t, count: 1 });
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  };
}

export function clientKey(request) {
  const forwarded = request.headers.get('x-forwarded-for') || '';
  return forwarded.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
}
