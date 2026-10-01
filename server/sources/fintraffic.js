/**
 * Fintraffic road-weather cameras via Digitraffic (ported from gods-eye-view).
 * One keyless GeoJSON list; one camera per preset (fixed view). Only stations
 * GATHERING and presets inCollection are kept. Stills are https JPEGs on
 * weathercam.digitraffic.fi, refreshed on the station's ~10 min cadence.
 */
export const FINTRAFFIC_CATALOG_URL = 'https://tie.digitraffic.fi/api/weathercam/v1/stations';
export const FINTRAFFIC_ALLOWED_HOSTS = ['tie.digitraffic.fi'];
export const FINTRAFFIC_IMAGE_ORIGIN = 'https://weathercam.digitraffic.fi/';
/** Digitraffic asks every client to identify itself. */
export const DIGITRAFFIC_HEADERS = { 'Digitraffic-User': 'worldview-espana', Accept: 'application/json' };

const inFinland = (lat, lon) => lat >= 59 && lat <= 70.2 && lon >= 19 && lon <= 31.7;

export function parseFintrafficCatalog(payload, { checkedAt }) {
  const features = payload?.features;
  if (!Array.isArray(features)) throw new Error('Formato Digitraffic no reconocido: sin features');
  const out = [];
  for (const feature of features) {
    const props = feature?.properties ?? {};
    const stationId = String(props.id || '').trim();
    if (!stationId || String(props.collectionStatus).toUpperCase() !== 'GATHERING') continue;
    const [lon, lat] = (feature?.geometry?.coordinates ?? []).map(Number);
    if (!inFinland(lat, lon)) continue;
    for (const preset of props.presets ?? []) {
      if (preset?.inCollection !== true) continue;
      const presetId = String(preset?.id || '').trim();
      // Strict shape (station id + 2-digit view) also guards the synthesized URL.
      if (!/^C\d{7}$/.test(presetId) || !presetId.startsWith(stationId)) continue;
      const station = String(props.name || stationId).replace(/_/g, ' ');
      out.push({
        id: `fintraffic:${presetId}`,
        name: `${station} · vista ${presetId.slice(-2)}`,
        countryCode: 'FI',
        city: null,
        lat,
        lon,
        category: 'weather',
        mediaUrl: `${FINTRAFFIC_IMAGE_ORIGIN}${presetId}.jpg`,
        mediaType: 'image',
        liveness: 'periodic',
        refreshSeconds: 600,
        status: 'active',
        checkedAt,
      });
    }
  }
  return out;
}
