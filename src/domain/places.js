/**
 * Gazetteer of Spanish towns for search and "cerca de …" navigation.
 *
 * The data chunk (~120 KB gzip) is loaded on demand the first time it is
 * needed, so it never weighs on the first paint. A place is a navigation
 * target only: being in the gazetteer never implies that it has cameras.
 *
 * Place ids are `g<GeoNames id>` so they cannot collide with quick-access city
 * ids and can be validated before the data is loaded (e.g. from a URL).
 *
 * @typedef {{ id: string, name: string, provinceCode: string, lat: number, lon: number }} Place
 */
import { getQuickCity } from './spain.js';

export const PLACE_ID = /^g\d{1,10}$/;
export const isPlaceId = (id) => typeof id === 'string' && PLACE_ID.test(id);

/** @type {Map<string, Place>} */
let placesById = new Map();
/** @type {Place[]} */
let placeList = [];
/** @type {Promise<Place[]> | null} */
let loading = null;

/**
 * Registers gazetteer rows ([geonamesId, name, provinceIso, lat, lon]).
 * Malformed rows are skipped rather than trusted.
 * @returns {Place[]}
 */
export function registerPlaces(rows) {
  const list = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const [geonamesId, name, provinceCode, lat, lon] = row;
    if (!Number.isSafeInteger(geonamesId) || typeof name !== 'string' || !name ||
        typeof provinceCode !== 'string' || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    list.push(Object.freeze({ id: `g${geonamesId}`, name, provinceCode, lat, lon }));
  }
  placeList = list;
  placesById = new Map(list.map((p) => [p.id, p]));
  return list;
}

/** Loads the bundled gazetteer once; concurrent callers share the same promise. */
export function loadPlaces(importData = () => import('../data/spainPlaces.data.js')) {
  if (!loading) {
    loading = importData()
      .then((module) => registerPlaces(module.default))
      .catch((error) => {
        loading = null; // allow a retry after a transient chunk-load failure
        throw error;
      });
  }
  return loading;
}

export const getPlace = (id) => placesById.get(id) ?? null;
export const getPlaces = () => placeList;
export const placesReady = () => placesById.size > 0;

/**
 * Resolves the target of the "city" filter: a quick-access city or a place.
 * @returns {{ id: string, name: string, provinceCode: string, lat: number, lon: number } | null}
 */
export function getCityTarget(id) {
  if (!id) return null;
  return getQuickCity(id) ?? getPlace(id);
}

/** Test seam: forget everything registered or loading. */
export function resetPlaces() {
  placesById = new Map();
  placeList = [];
  loading = null;
}
