/**
 * Shareable state ⇄ URL query string. Only validated values are restored, so
 * a hand-edited or malicious link can never put the app in an invalid state.
 *
 * Params: scope=es|world · ca · pr · city (quick city or place `g…`) · country · cat (comma list) ·
 *         st (status) · q · fav=1 · cam (camera id) · at=lat,lon,km · mode=2d · fl=0 (flights off) · mos=1 (control room)
 */
import { getCommunity, getProvince, getQuickCity, communityOfProvince } from '../domain/spain.js';
import { CATEGORIES, COUNTRY_NAMES } from '../domain/camera.js';
import { defaultFilters } from '../domain/filters.js';
import { isPlaceId } from '../domain/places.js';

const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));
const STATUSES = new Set(['all', 'active', 'online', 'offline']);
const CAMERA_ID = /^[a-z]{2,16}:[A-Za-z0-9._-]{1,240}$/;

/**
 * @typedef {{ lat: number, lon: number, km: number }} ViewTarget
 * @typedef {{ filters: import('../domain/filters.js').FilterState, cameraId: string | null, view: ViewTarget | null, mode: '3d' | '2d', flights?: boolean, mosaic?: boolean }} UrlState
 */

/** @returns {UrlState} */
export function parseUrlState(search) {
  const params = new URLSearchParams(search);
  const filters = defaultFilters();
  filters.scope = params.get('scope') === 'world' ? 'world' : 'spain';

  const province = params.get('pr') || '';
  const community = params.get('ca') || '';
  if (getProvince(province)) {
    filters.province = province;
    filters.community = communityOfProvince(province); // keep hierarchy consistent
  } else if (getCommunity(community)) {
    filters.community = community;
  }
  const city = params.get('city') || '';
  // Place ids are only checked for shape here; the app drops unknown ones once the gazetteer loads.
  if (getQuickCity(city) || isPlaceId(city)) filters.city = city;
  const country = (params.get('country') || '').toUpperCase();
  if (COUNTRY_NAMES[country]) filters.country = country;

  filters.categories = (params.get('cat') || '').split(',').filter((c) => CATEGORY_IDS.has(c));
  const status = params.get('st') || 'all';
  filters.status = STATUSES.has(status) ? status : 'all';
  filters.text = (params.get('q') || '').slice(0, 80);
  filters.favoritesOnly = params.get('fav') === '1';

  const cam = params.get('cam') || '';
  const cameraId = CAMERA_ID.test(cam) ? cam : null;

  let view = null;
  const [lat, lon, km] = (params.get('at') || '').split(',').map(Number);
  if (Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(km) &&
      Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && km > 0.05 && km <= 40_000) {
    view = { lat, lon, km };
  }
  return { filters, cameraId, view, mode: params.get('mode') === '2d' ? '2d' : '3d', flights: params.get('fl') !== '0', mosaic: params.get('mos') === '1' };
}

/** @param {UrlState} state @returns {string} query string without "?" ('' when default) */
export function serializeUrlState({ filters, cameraId, view, mode, flights = true, mosaic = false }) {
  const params = new URLSearchParams();
  if (filters.scope === 'world') params.set('scope', 'world');
  if (filters.scope === 'world' && filters.country) params.set('country', filters.country);
  if (filters.community && !filters.province) params.set('ca', filters.community);
  if (filters.province) params.set('pr', filters.province);
  if (filters.city) params.set('city', filters.city);
  if (filters.categories.length) params.set('cat', filters.categories.join(','));
  if (filters.status !== 'all') params.set('st', filters.status);
  if (filters.text) params.set('q', filters.text);
  if (filters.favoritesOnly) params.set('fav', '1');
  if (cameraId) params.set('cam', cameraId);
  if (view) params.set('at', `${view.lat.toFixed(4)},${view.lon.toFixed(4)},${Math.round(view.km * 10) / 10}`);
  if (mode === '2d') params.set('mode', '2d');
  if (!flights) params.set('fl', '0');
  if (mosaic) params.set('mos', '1');
  return params.toString();
}

/** Absolute shareable link for one camera (keeps nothing else). */
export function cameraShareUrl(origin, pathname, camera) {
  const params = new URLSearchParams({ cam: camera.id });
  if (camera.countryCode !== 'ES') params.set('scope', 'world');
  return `${origin}${pathname}?${params}`;
}
