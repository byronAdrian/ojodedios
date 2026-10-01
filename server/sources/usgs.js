/**
 * USGS Earthquake Hazards Program — real-time GeoJSON summary feed (public
 * domain). One fixed URL: every visitor shares it through the CDN cache.
 *
 * Feature shape (documented, stable since 2013):
 *   { id, properties: { mag, place, time (ms), updated, url, tsunami, magType,
 *     type, title, status, alert }, geometry: { coordinates: [lon, lat, depthKm] } }
 * Docs: https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php
 */
export const USGS_FEED_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';
export const USGS_ALLOWED_HOSTS = ['earthquake.usgs.gov'];
export const USGS_ATTRIBUTION = 'U.S. Geological Survey (USGS), Earthquake Hazards Program — dominio público';
const MAX_EVENTS = 2000;
const EVENT_PAGE = /^https:\/\/earthquake\.usgs\.gov\/earthquakes\/eventpage\/[A-Za-z0-9_-]{1,40}$/;

const finite = (value, min, max) => (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null);
const text = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/**
 * @param {unknown} body parsed GeoJSON
 * @returns {Array<{ id: string, lat: number, lon: number, depthKm: number | null, mag: number | null,
 *   magType: string, place: string, time: number, tsunami: boolean, url: string | null }>}
 */
export function parseUsgsFeed(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.features)) {
    throw new Error('Formato USGS no reconocido: falta "features"');
  }
  const out = [];
  for (const feature of body.features) {
    if (out.length >= MAX_EVENTS) break;
    const props = feature?.properties ?? {};
    const [lonRaw, latRaw, depthRaw] = Array.isArray(feature?.geometry?.coordinates) ? feature.geometry.coordinates : [];
    const lat = finite(latRaw, -90, 90);
    const lon = finite(lonRaw, -180, 180);
    const time = finite(props.time, 0, 8.64e15);
    const id = text(feature?.id, 40);
    if (lat === null || lon === null || time === null || !/^[A-Za-z0-9_-]{1,40}$/.test(id)) continue;
    // Only earthquakes: the feed also carries quarry blasts and explosions.
    if (props.type && props.type !== 'earthquake') continue;
    const url = text(props.url, 120);
    out.push({
      id,
      lat,
      lon,
      depthKm: finite(depthRaw, -10, 1000),
      mag: finite(props.mag, -2, 10),
      magType: text(props.magType, 8),
      place: text(props.place, 120),
      time,
      tsunami: props.tsunami === 1,
      url: EVENT_PAGE.test(url) ? url : null,
    });
  }
  // Strongest first: the client draws them last so they stay on top.
  return out.sort((a, b) => (a.mag ?? -9) - (b.mag ?? -9));
}
