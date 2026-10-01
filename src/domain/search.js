/**
 * Global search over static geography + loaded cameras + categories.
 * Entirely in-memory: typing never triggers network requests.
 *
 * @typedef {'country' | 'community' | 'province' | 'city' | 'camera' | 'category'} ResultType
 * @typedef {{ type: ResultType, id: string, label: string, detail: string, key: string }} SearchEntry
 */
import { COMMUNITIES, PROVINCES, QUICK_ACCESS_CITIES, getCommunity } from './spain.js';
import { CATEGORIES, COUNTRY_NAMES, countryName } from './camera.js';
import { normalizeText } from './filters.js';

const TYPE_LABEL = {
  country: 'País',
  community: 'Comunidad',
  province: 'Provincia',
  city: 'Ciudad',
  camera: 'Cámara',
  category: 'Categoría',
};
export const typeLabel = (type) => TYPE_LABEL[type] ?? type;

// Geography ranks above cameras on equal match quality.
const TYPE_WEIGHT = { country: 0, community: 1, province: 2, city: 3, category: 4, camera: 5 };

const entry = (type, id, label, detail) => ({ type, id, label, detail, key: normalizeText(label) });

/** Static, camera-independent entries (built once). */
export function buildStaticIndex() {
  return [
    ...Object.entries(COUNTRY_NAMES).map(([code, name]) => entry('country', code, name, '')),
    ...COMMUNITIES.map((c) => entry('community', c.code, c.name, c.kind === 'autonomous-city' ? 'Ciudad autónoma' : 'Comunidad autónoma')),
    ...PROVINCES.map((p) => entry('province', p.code, p.name, getCommunity(p.communityCode)?.name ?? '')),
    ...QUICK_ACCESS_CITIES.map((c) => entry('city', c.id, c.name, 'Navegación geográfica')),
    ...CATEGORIES.map((c) => entry('category', c.id, c.label, '')),
  ];
}

export function buildCameraIndex(cameras) {
  return cameras.map((c) =>
    entry('camera', c.id, c.name, [c.city, countryName(c.countryCode)].filter(Boolean).join(' · ')),
  );
}

function score(key, query) {
  if (key === query) return 0;
  if (key.startsWith(query)) return 1;
  if (key.includes(` ${query}`) || key.includes(`/${query}`)) return 2;
  if (key.includes(query)) return 3;
  return -1;
}

/**
 * @param {ReadonlyArray<SearchEntry>} index
 * @param {string} rawQuery
 * @param {{ limit?: number, maxCameras?: number }} [options]
 * @returns {SearchEntry[]}
 */
export function search(index, rawQuery, { limit = 12, maxCameras = 6 } = {}) {
  const query = normalizeText(rawQuery);
  if (query.length < 2) return [];
  const hits = [];
  for (const item of index) {
    const s = score(item.key, query);
    if (s >= 0) hits.push({ item, s });
  }
  hits.sort(
    (a, b) => a.s - b.s || TYPE_WEIGHT[a.item.type] - TYPE_WEIGHT[b.item.type] || a.item.label.localeCompare(b.item.label, 'es'),
  );
  const out = [];
  let cameras = 0;
  for (const { item } of hits) {
    if (item.type === 'camera') {
      if (cameras >= maxCameras) continue;
      cameras += 1;
    }
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}
