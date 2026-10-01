/**
 * NASA FIRMS — active fire / thermal anomaly detections (VIIRS S-NPP, near
 * real time). Requires a free MAP_KEY, kept server-side (FIRMS_MAP_KEY).
 *
 * Area API (documented): /api/area/csv/{MAP_KEY}/{SOURCE}/{west,south,east,north}/{days}
 * CSV header for VIIRS: latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,
 *   satellite,instrument,confidence,version,bright_ti5,frp,daynight
 * Docs: https://firms.modaps.eosdis.nasa.gov/api/area/
 *
 * The visitor's view is snapped to a 5° grid and capped in size, so a handful
 * of URLs cover everyone (CDN-shareable) and nobody can request the planet.
 */
export const FIRMS_HOST = 'firms.modaps.eosdis.nasa.gov';
export const FIRMS_SOURCE = 'VIIRS_SNPP_NRT';
export const FIRMS_ATTRIBUTION = 'NASA FIRMS (VIIRS S-NPP NRT) — LANCE/EOSDIS, NASA';
const GRID = 5;
const MAX_SPAN_LON = 40;
const MAX_SPAN_LAT = 30;
const MAX_POINTS = 8000;

const snapDown = (v) => Math.floor(v / GRID) * GRID;
const snapUp = (v) => Math.ceil(v / GRID) * GRID;

/**
 * Validates and snaps a "w,s,e,n" bbox. Returns null when malformed, crossing
 * the antimeridian, or larger than the allowed span (the client asks to zoom in).
 * @returns {{ west: number, south: number, east: number, north: number } | null}
 */
export function quantiseFireBbox(raw) {
  const parts = String(raw ?? '').split(',');
  if (parts.length !== 4 || parts.some((p) => p.trim() === '')) return null;
  const [w, s, e, n] = parts.map(Number);
  if (![w, s, e, n].every(Number.isFinite)) return null;
  if (w < -180 || e > 180 || s < -90 || n > 90 || w >= e || s >= n) return null;
  const bbox = {
    west: Math.max(-180, snapDown(w)),
    south: Math.max(-90, snapDown(s)),
    east: Math.min(180, snapUp(e)),
    north: Math.min(90, snapUp(n)),
  };
  if (bbox.east - bbox.west > MAX_SPAN_LON || bbox.north - bbox.south > MAX_SPAN_LAT) return null;
  return bbox;
}

/** The key only ever appears here, server-side; it never reaches a response. */
export function firmsUrl(mapKey, { west, south, east, north }) {
  if (!/^[A-Za-z0-9]{16,64}$/.test(String(mapKey ?? ''))) return null;
  return `https://${FIRMS_HOST}/api/area/csv/${mapKey}/${FIRMS_SOURCE}/${west},${south},${east},${north}/1`;
}

const CONFIDENCE = { l: 'low', n: 'nominal', h: 'high', low: 'low', nominal: 'nominal', high: 'high' };

/**
 * Header-driven CSV parser (FIRMS has no quoted fields). Unknown columns are
 * ignored; rows without a valid position are dropped.
 * @returns {Array<{ lat: number, lon: number, frp: number | null, confidence: string,
 *   acquired: string, satellite: string, daynight: 'D' | 'N' | '' }>}
 */
export function parseFirmsCsv(csv) {
  const lines = String(csv ?? '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lines.length) return [];
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const col = (name) => header.indexOf(name);
  const iLat = col('latitude');
  const iLon = col('longitude');
  if (iLat < 0 || iLon < 0) {
    // FIRMS answers plain-text errors (e.g. invalid MAP_KEY) with HTTP 200.
    throw new Error(`Respuesta FIRMS no reconocida: ${lines[0].slice(0, 120)}`);
  }
  const iFrp = col('frp');
  const iConf = col('confidence');
  const iDate = col('acq_date');
  const iTime = col('acq_time');
  const iSat = col('satellite');
  const iDn = col('daynight');
  const out = [];
  for (let r = 1; r < lines.length && out.length < MAX_POINTS; r += 1) {
    const cells = lines[r].split(',');
    const lat = Number(cells[iLat]);
    const lon = Number(cells[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const frpText = iFrp >= 0 ? String(cells[iFrp] ?? '').trim() : '';
    const frp = frpText === '' ? NaN : Number(frpText); // Number('') would be 0, not "unknown"
    const date = iDate >= 0 ? String(cells[iDate] ?? '').trim() : '';
    const hhmm = iTime >= 0 ? String(cells[iTime] ?? '').trim().padStart(4, '0') : '';
    const acquired = /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{4}$/.test(hhmm)
      ? `${date}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00Z`
      : '';
    const dn = iDn >= 0 ? String(cells[iDn] ?? '').trim().toUpperCase() : '';
    out.push({
      lat: Math.round(lat * 1e4) / 1e4,
      lon: Math.round(lon * 1e4) / 1e4,
      frp: Number.isFinite(frp) && frp >= 0 && frp < 1e5 ? frp : null,
      confidence: CONFIDENCE[String(cells[iConf] ?? '').trim().toLowerCase()] ?? '',
      acquired,
      satellite: iSat >= 0 ? String(cells[iSat] ?? '').trim().slice(0, 8) : '',
      daynight: dn === 'D' || dn === 'N' ? dn : '',
    });
  }
  return out;
}
