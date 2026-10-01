/**
 * Live aircraft from adsb.lol (community ADS-B network, ODbL 1.0, keyless).
 * Point API: https://api.adsb.lol/v2/lat/{lat}/lon/{lon}/dist/{nm} (≤ 250 nm).
 * Response shape as consumed by gods-eye-view's adsbLolFallback.js:
 * { now, ac: [{ hex, flight, r, t, lat, lon, alt_baro ('ground' | ft), gs (kt),
 *   track (°), seen_pos (s), category }] }.
 *
 * The query is quantised (0.5° grid, fixed radii) so that the URL space is
 * tiny, CDN-cacheable and impossible to steer anywhere but this endpoint.
 */
export const ADSB_LOL_HOSTS = ['api.adsb.lol'];

/**
 * Community ADS-B networks exposing the same readsb "v2" JSON. Tried in order;
 * a 429/5xx/timeout on one moves to the next, each with its own cooldown.
 * Endpoint shapes per each provider's public API docs (not verifiable from the
 * dev environment). All are keyless for light, non-commercial use.
 */
export const FLIGHT_PROVIDERS = Object.freeze([
  {
    id: 'adsb.lol',
    hosts: ['api.adsb.lol'],
    url: ({ lat, lon, dist }) => `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${dist}`,
    attribution: 'adsb.lol (ODbL 1.0)',
  },
  {
    id: 'airplanes.live',
    hosts: ['api.airplanes.live'],
    url: ({ lat, lon, dist }) => `https://api.airplanes.live/v2/point/${lat}/${lon}/${dist}`,
    attribution: 'airplanes.live (uso no comercial)',
  },
  {
    id: 'adsb.fi',
    hosts: ['opendata.adsb.fi'],
    url: ({ lat, lon, dist }) => `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${dist}`,
    attribution: 'adsb.fi Open Data (uso personal no comercial)',
  },
]);
export const FLIGHT_RADII_NM = Object.freeze([50, 100, 250]);
const MAX_POSITION_AGE_S = 60;
const FOOT_TO_M = 0.3048;
const KNOT_TO_KMH = 1.852;

/** Validate + quantise a client query; null when invalid. */
export function quantiseFlightQuery(latRaw, lonRaw, distRaw) {
  if ([latRaw, lonRaw].some((v) => v === null || v === undefined || String(v).trim() === '')) return null;
  const lat = Number(latRaw);
  const lon = Number(lonRaw);
  const dist = Number(distRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -85 || lat > 85 || lon < -180 || lon > 180) return null;
  const radius = FLIGHT_RADII_NM.find((r) => r >= dist) ?? FLIGHT_RADII_NM.at(-1);
  return { lat: Math.round(lat * 2) / 2, lon: Math.round(lon * 2) / 2, dist: radius };
}

export const adsbLolUrl = ({ lat, lon, dist }) => `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${dist}`;

const num = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** Compact, validated aircraft records; stale or positionless contacts dropped. */
export function normalizeAdsbLol(payload) {
  // readsb v2 uses "ac"; some mirrors name the array "aircraft".
  const list = Array.isArray(payload?.ac) ? payload.ac : Array.isArray(payload?.aircraft) ? payload.aircraft : null;
  if (!list) throw new Error('Formato ADS-B no reconocido: sin "ac"');
  const out = [];
  for (const a of list) {
    const hex = String(a?.hex ?? '').trim().toLowerCase();
    if (!/^~?[0-9a-f]{6}$/.test(hex)) continue;
    const lat = num(a.lat);
    const lon = num(a.lon);
    if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const seen = num(a.seen_pos) ?? num(a.seen) ?? 0;
    if (seen > MAX_POSITION_AGE_S) continue;
    const onGround = a.alt_baro === 'ground';
    const altFt = onGround ? 0 : num(a.alt_baro) ?? num(a.alt_geom);
    const gs = num(a.gs);
    const clean = (v, max) => String(v ?? '').trim().replace(/[^\w .-]/g, '').slice(0, max) || null;
    out.push({
      hex,
      callsign: clean(a.flight, 10),
      registration: clean(a.r, 12),
      type: clean(a.t, 8),
      lat: Math.round(lat * 1e5) / 1e5,
      lon: Math.round(lon * 1e5) / 1e5,
      altitudeM: altFt === null ? null : Math.round(altFt * FOOT_TO_M),
      onGround,
      speedKmh: gs === null ? null : Math.round(gs * KNOT_TO_KMH),
      track: num(a.track),
      seenS: Math.round(seen),
    });
  }
  return out;
}
