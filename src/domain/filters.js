/**
 * Pure filtering/summary logic. No DOM, no Cesium — fully unit-testable.
 *
 * @typedef {'all' | 'active' | 'online' | 'offline'} StatusFilter
 *   all     → everything in the catalogs
 *   active  → provider flags it as collecting (catalog-verified)
 *   online  → its image loaded in this session
 *   offline → its image failed to load in this session
 *
 * @typedef {object} FilterState
 * @property {'spain' | 'world'} scope
 * @property {string} country       ISO alpha-2 or ''
 * @property {string} community     ISO 3166-2:ES or ''
 * @property {string} province      ISO 3166-2:ES or ''
 * @property {string} city          quick-access city id or ''
 * @property {string[]} categories  empty = all
 * @property {StatusFilter} status
 * @property {string} text          free text over name/city
 * @property {boolean} favoritesOnly
 * @property {[number, number, number, number] | null} viewBounds  [w,s,e,n] when "solo en vista"
 */
import { getQuickCity, CITY_RADIUS_KM } from './spain.js';

/** @returns {FilterState} */
export const defaultFilters = () => ({
  scope: 'spain',
  country: '',
  community: '',
  province: '',
  city: '',
  categories: [],
  status: 'all',
  text: '',
  favoritesOnly: false,
  viewBounds: null,
});

/** Lower-case, accent-free, collapsed whitespace — for matching only. */
export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const EARTH_RADIUS_KM = 6371;
const toRad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance in km. */
export function distanceKm(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

function inBounds(camera, [w, s, e, n]) {
  if (camera.lat < s || camera.lat > n) return false;
  // Rectangle may cross the antimeridian (w > e).
  return w <= e ? camera.lon >= w && camera.lon <= e : camera.lon >= w || camera.lon <= e;
}

/**
 * @param {ReadonlyArray<import('./camera.js').Camera>} cameras
 * @param {FilterState} filters
 * @param {{ availability?: ReadonlyMap<string, 'online' | 'offline'>, favorites?: ReadonlySet<string> }} [context]
 */
export function applyFilters(cameras, filters, { availability = new Map(), favorites = new Set() } = {}) {
  const text = normalizeText(filters.text);
  const categories = filters.categories.length ? new Set(filters.categories) : null;
  const city = filters.city ? getQuickCity(filters.city) : null;
  const country = filters.scope === 'spain' ? 'ES' : filters.country;

  return cameras.filter((camera) => {
    if (country && camera.countryCode !== country) return false;
    if (filters.scope === 'spain') {
      if (filters.community && camera.communityCode !== filters.community) return false;
      if (filters.province && camera.provinceCode !== filters.province) return false;
      if (city && distanceKm(city.lat, city.lon, camera.lat, camera.lon) > CITY_RADIUS_KM) return false;
    }
    if (categories && !categories.has(camera.category)) return false;
    if (filters.favoritesOnly && !favorites.has(camera.id)) return false;
    if (filters.status === 'active' && camera.status !== 'active') return false;
    if (filters.status === 'online' && availability.get(camera.id) !== 'online') return false;
    if (filters.status === 'offline' && availability.get(camera.id) !== 'offline') return false;
    if (filters.viewBounds && !inBounds(camera, filters.viewBounds)) return false;
    if (text && !normalizeText(`${camera.name} ${camera.city ?? ''}`).includes(text)) return false;
    return true;
  });
}

/**
 * Honest counters: catalog total vs provider-verified vs with an image
 * resource vs observed failing in this session.
 */
export function summarize(cameras, availability = new Map()) {
  let active = 0;
  let withMedia = 0;
  let online = 0;
  let offline = 0;
  for (const camera of cameras) {
    if (camera.status === 'active') active += 1;
    if (camera.mediaType !== 'none') withMedia += 1;
    const seen = availability.get(camera.id);
    if (seen === 'online') online += 1;
    else if (seen === 'offline') offline += 1;
  }
  return { total: cameras.length, active, withMedia, online, offline };
}

/** Number of active (non-default) filters, for the "Filtros (n)" badge. */
export function countActiveFilters(filters) {
  return (
    (filters.community ? 1 : 0) +
    (filters.province ? 1 : 0) +
    (filters.city ? 1 : 0) +
    (filters.scope === 'world' && filters.country ? 1 : 0) +
    filters.categories.length +
    (filters.status !== 'all' ? 1 : 0) +
    (filters.text ? 1 : 0) +
    (filters.favoritesOnly ? 1 : 0) +
    (filters.viewBounds ? 1 : 0)
  );
}

/** Sort: selected city proximity first when a city is active, else by name. */
export function sortCameras(cameras, filters) {
  const city = filters.city ? getQuickCity(filters.city) : null;
  const copy = cameras.slice();
  if (city) {
    const d = new Map(copy.map((c) => [c.id, distanceKm(city.lat, city.lon, c.lat, c.lon)]));
    return copy.sort((a, b) => d.get(a.id) - d.get(b.id));
  }
  const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
  return copy.sort((a, b) => collator.compare(a.name, b.name));
}
