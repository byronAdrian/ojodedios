/**
 * Freshness of periodic camera stills. "Recibida" is when this browser got the
 * picture — providers don't publish capture times (many burn them into the image).
 */
export const MIN_REFRESH_S = 60;
export const DEFAULT_REFRESH_S = 120;

/** Effective refresh period: the provider's cadence, never faster than 60 s. */
export const refreshMs = (camera) => Math.max(MIN_REFRESH_S, camera?.refreshSeconds || DEFAULT_REFRESH_S) * 1000;

/** True when a still received at `receivedAt` (ms) should be reloaded. */
export const isDue = (camera, receivedAt, now = Date.now()) => !receivedAt || now - receivedAt >= refreshMs(camera);

/** "ahora mismo" · "hace 3 min" · "hace 2 h" — short Spanish relative age. */
export function ageLabel(receivedAt, now = Date.now()) {
  if (!receivedAt) return '—';
  const s = Math.max(0, Math.round((now - receivedAt) / 1000));
  if (s < 45) return 'ahora mismo';
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  return `hace ${Math.round(m / 60)} h`;
}

/** Tiles per mosaic page for a viewport width (px). */
export const mosaicPageSize = (width) => (width >= 1400 ? 12 : width >= 900 ? 9 : width >= 600 ? 6 : 4);
