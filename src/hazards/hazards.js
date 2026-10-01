/**
 * Pure helpers for the natural-hazard layers (earthquakes, fires). No DOM, no
 * Cesium: unit-testable on their own.
 */

/** Marker diameter in px for a magnitude: readable for M1, dominant for M7+. */
export function quakeSize(mag) {
  if (!Number.isFinite(mag)) return 6;
  return Math.round(Math.min(30, Math.max(6, 5 + mag * 3.2)));
}

/** Visual weight bucket: 'strong' ≥ 4.5 (felt widely), else 'normal'. */
export const quakeLevel = (mag) => (Number.isFinite(mag) && mag >= 4.5 ? 'strong' : 'normal');

/** Fire marker size from radiative power (MW): 4 px small fires … 10 px large ones. */
export function fireSize(frp) {
  if (!Number.isFinite(frp) || frp <= 0) return 4;
  return Math.round(Math.min(10, 4 + Math.log10(1 + frp) * 2.4));
}

const SPAN_LON = 40;
const SPAN_LAT = 30;

/**
 * The bbox query for /api/fires from the visible bounds, or null when the
 * view is too large (or crosses the antimeridian) and the user must zoom in.
 * Mirrors the server cap so the client never asks for something refused.
 * @param {[number, number, number, number] | null} bounds [w, s, e, n]
 */
export function fireBboxParam(bounds) {
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite)) return null;
  const [w, s, e, n] = bounds;
  if (w >= e || s >= n) return null;
  const west = Math.max(-180, Math.floor(w / 5) * 5);
  const south = Math.max(-90, Math.floor(s / 5) * 5);
  const east = Math.min(180, Math.ceil(e / 5) * 5);
  const north = Math.min(90, Math.ceil(n / 5) * 5);
  if (east - west > SPAN_LON || north - south > SPAN_LAT) return null;
  return `${west},${south},${east},${north}`;
}

const rtf = typeof Intl !== 'undefined' && Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat('es', { numeric: 'auto' }) : null;

/** "hace 12 min", "hace 3 h", "ayer"… relative to `now`. */
export function timeAgo(epochMs, now = Date.now()) {
  if (!Number.isFinite(epochMs)) return '';
  const minutes = Math.round((epochMs - now) / 60_000);
  if (!rtf) return `${Math.abs(minutes)} min`;
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 48) return rtf.format(hours, 'hour');
  return rtf.format(Math.round(hours / 24), 'day');
}

export const CONFIDENCE_LABEL = { high: 'Alta', nominal: 'Media', low: 'Baja' };

/** Status line for the layers panel. */
export function hazardStatusLabel(kind, status) {
  if (!status || status.state === 'off') return 'Desactivado';
  if (status.state === 'loading') return 'Cargando…';
  if (status.state === 'error') return 'Fuente no disponible';
  if (status.state === 'zoom') return 'Acerca el mapa para verlos';
  if (status.state === 'missing_key') return 'Requiere configurar FIRMS_MAP_KEY';
  const n = status.count ?? 0;
  return kind === 'quakes' ? `${n} en las últimas 24 h` : `${n} focos (últimas 24 h)`;
}
