/**
 * Common camera model. Every provider adapter (server/sources/*) normalizes its
 * upstream rows into this shape; the client only ever consumes this shape.
 *
 * Provider-level facts (attribution, licence, homepage) live once in
 * PROVIDERS instead of being repeated on every camera.
 *
 * @typedef {'traffic' | 'highway' | 'port' | 'airport' | 'weather' | 'coast' | 'mountain' | 'public-space' | 'tourism' | 'other'} CameraCategory
 * @typedef {'image' | 'hls' | 'youtube' | 'none'} MediaType
 * @typedef {'live' | 'periodic' | 'archived'} Liveness
 * @typedef {'active' | 'listed'} CatalogStatus
 *   active = the provider's catalog flags it as currently collecting/available;
 *   listed = it is in the catalog but the provider publishes no health flag.
 *
 * @typedef {object} Camera
 * @property {string} id              `${providerId}:${nativeId}` — stable, URL-safe (≤240 chars)
 * @property {string} providerId
 * @property {string} name
 * @property {string} countryCode     ISO 3166-1 alpha-2
 * @property {string | null} communityCode  ISO 3166-2:ES comunidad (Spain only)
 * @property {string | null} provinceCode   ISO 3166-2:ES provincia (Spain only)
 * @property {string | null} city     only when the provider states it
 * @property {number} lat
 * @property {number} lon
 * @property {CameraCategory} category
 * @property {string | null} mediaUrl  https URL or same-origin /api/frame path
 * @property {MediaType} mediaType
 * @property {Liveness} liveness
 * @property {number} refreshSeconds  provider capture cadence (0 = unknown)
 * @property {CatalogStatus} status
 * @property {string} checkedAt       ISO timestamp of the catalog fetch
 * @property {string | null} pageUrl   per-camera public page (overrides the provider's)
 * @property {string | null} thumbnailUrl  https preview when mediaUrl is not an image
 */

/** @type {ReadonlyArray<{ id: CameraCategory, label: string }>} */
export const CATEGORIES = Object.freeze([
  { id: 'traffic', label: 'Tráfico y carreteras' },
  { id: 'highway', label: 'Autopistas y autovías' },
  { id: 'port', label: 'Puertos' },
  { id: 'airport', label: 'Aeropuertos' },
  { id: 'weather', label: 'Meteorología y paisaje' },
  { id: 'coast', label: 'Playas y costas' },
  { id: 'mountain', label: 'Montañas y estaciones de esquí' },
  { id: 'public-space', label: 'Plazas y espacios públicos' },
  { id: 'tourism', label: 'Webcams turísticas' },
  { id: 'other', label: 'Otras cámaras públicas verificadas' },
]);

const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));
const categoryLabels = new Map(CATEGORIES.map((c) => [c.id, c.label]));
export const categoryLabel = (id) => categoryLabels.get(id) ?? 'Otras';

export const COUNTRY_NAMES = Object.freeze({
  ES: 'España',
  GB: 'Reino Unido',
  FI: 'Finlandia',
  US: 'Estados Unidos',
});
export const countryName = (code) => COUNTRY_NAMES[code] ?? code;

/**
 * Provider registry. `sourceUrl` is the public page users can open to see the
 * camera at its origin; attribution text is what the licence asks us to show.
 */
export const PROVIDERS = Object.freeze({
  dgt: {
    id: 'dgt',
    name: 'DGT — Dirección General de Tráfico',
    shortName: 'DGT',
    countryCode: 'ES',
    attribution: 'Fuente: Dirección General de Tráfico (DGT) — Punto de Acceso Nacional nap.dgt.es',
    license: 'Datos abiertos DGT (NAP) — CC BY 4.0, atribución requerida',
    licenseUrl: 'https://nap.dgt.es/dataset/camaras-dgt-datex2-v3-6-nuevo',
    sourceUrl: 'https://infocar.dgt.es/etraffic/',
  },
  madrid: {
    id: 'madrid',
    name: 'Ayuntamiento de Madrid — Informo',
    shortName: 'Ayto. Madrid',
    countryCode: 'ES',
    attribution: 'Fuente: Ayuntamiento de Madrid — datos.madrid.es',
    license: 'Condiciones de uso de datos.madrid.es — reutilización con atribución',
    licenseUrl: 'https://datos.madrid.es/egob/catalogo/aviso-legal',
    sourceUrl: 'https://informo.madrid.es/',
  },
  tfl: {
    id: 'tfl',
    name: 'Transport for London — JamCams',
    shortName: 'TfL',
    countryCode: 'GB',
    attribution: 'Powered by TfL Open Data. Contains OS data © Crown copyright and database rights',
    license: 'TfL Open Data terms — atribución requerida',
    licenseUrl: 'https://tfl.gov.uk/info-for/open-data-users/',
    sourceUrl: 'https://tfl.gov.uk/traffic/status/',
  },
  caltrans: {
    id: 'caltrans',
    name: 'Caltrans — California Department of Transportation (CWWP2)',
    shortName: 'Caltrans',
    countryCode: 'US',
    attribution: 'Fuente: California Department of Transportation (Caltrans), CWWP2',
    license: 'Datos públicos de Caltrans CWWP2 — uso con atribución',
    licenseUrl: 'https://cwwp2.dot.ca.gov/documentation/cctv/cctv.htm',
    sourceUrl: 'https://quickmap.dot.ca.gov/',
  },
  euskadi: {
    id: 'euskadi',
    name: 'Open Data Euskadi — Tráfico',
    shortName: 'Euskadi',
    countryCode: 'ES',
    attribution:
      'Fuente: Open Data Euskadi — Gobierno Vasco, diputaciones forales y ayuntamientos de Bilbao, Vitoria-Gasteiz y Donostia',
    license: 'Open Data Euskadi — reutilización con atribución',
    licenseUrl: 'https://opendata.euskadi.eus/catalogo/-/camaras-de-trafico-de-las-administraciones-publicas-de-euskadi/',
    sourceUrl: 'https://opendata.euskadi.eus/catalogo/-/camaras-de-trafico-de-las-administraciones-publicas-de-euskadi/',
  },
  livestream: {
    id: 'livestream',
    name: 'Webcams en directo (YouTube)',
    shortName: 'Directo',
    countryCode: 'ES',
    attribution: 'Emisión pública en YouTube de su propietario; se muestra con el reproductor oficial de YouTube.',
    license: 'Condiciones de YouTube (inserción permitida por el emisor)',
    licenseUrl: 'https://www.youtube.com/t/terms',
    sourceUrl: 'https://www.youtube.com/',
  },
  fintraffic: {
    id: 'fintraffic',
    name: 'Fintraffic — Digitraffic weathercams',
    shortName: 'Fintraffic',
    countryCode: 'FI',
    attribution: 'Fintraffic / digitraffic.fi, licencia CC BY 4.0',
    license: 'CC BY 4.0',
    licenseUrl: 'https://www.digitraffic.fi/en/terms-of-service/',
    sourceUrl: 'https://liikennetilanne.fintraffic.fi/',
  },
});

export const getProvider = (id) => PROVIDERS[id] ?? null;

const ID_PATTERN = /^[a-z]{2,16}:[A-Za-z0-9._-]{1,240}$/;
const MEDIA_TYPES = new Set(['image', 'hls', 'youtube', 'none']);
const YOUTUBE_EMBED = /^https:\/\/www\.youtube-nocookie\.com\/embed\/[\w-]{11}(\?[\w=&-]*)?$/;
const LIVENESS = new Set(['live', 'periodic', 'archived']);
const STATUSES = new Set(['active', 'listed']);

/** True when `url` is https or a same-origin /api/frame path. */
export function isSafeMediaUrl(url) {
  if (url === null) return true;
  if (typeof url !== 'string') return false;
  if (url.startsWith('/api/frame?')) return true;
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

const isLatitude = (v) => Number.isFinite(v) && v >= -90 && v <= 90;
const isLongitude = (v) => Number.isFinite(v) && v >= -180 && v <= 180;

/**
 * Validate and freeze a camera record. Returns null for anything that does not
 * satisfy the contract, so one bad upstream row never breaks a whole catalog.
 *
 * @param {Partial<Camera>} raw
 * @returns {Readonly<Camera> | null}
 */
export function createCamera(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id ?? '');
  if (!ID_PATTERN.test(id)) return null;
  const providerId = id.slice(0, id.indexOf(':'));
  if (!PROVIDERS[providerId]) return null;
  const lat = Number(raw.lat);
  const lon = Number(raw.lon);
  if (!isLatitude(lat) || !isLongitude(lon) || (lat === 0 && lon === 0)) return null;
  const name = String(raw.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
  if (!name) return null;
  const mediaUrl = raw.mediaUrl ?? null;
  if (!isSafeMediaUrl(mediaUrl)) return null;
  const mediaType = MEDIA_TYPES.has(raw.mediaType) ? raw.mediaType : 'none';
  // Only privacy-enhanced YouTube embeds may be framed.
  if (mediaType === 'youtube' && !YOUTUBE_EMBED.test(String(mediaUrl))) return null;
  const httpsOrNull = (v) => {
    try {
      return v && new URL(v).protocol === 'https:' ? String(v) : null;
    } catch {
      return null;
    }
  };

  return Object.freeze({
    id,
    providerId,
    name,
    countryCode: String(raw.countryCode ?? PROVIDERS[providerId].countryCode).toUpperCase(),
    communityCode: raw.communityCode ?? null,
    provinceCode: raw.provinceCode ?? null,
    city: raw.city ? String(raw.city) : null,
    lat: Math.round(lat * 1e6) / 1e6,
    lon: Math.round(lon * 1e6) / 1e6,
    category: CATEGORY_IDS.has(raw.category) ? raw.category : 'other',
    mediaUrl: mediaType === 'none' ? null : mediaUrl,
    mediaType: mediaUrl ? mediaType : 'none',
    liveness: LIVENESS.has(raw.liveness) ? raw.liveness : 'periodic',
    refreshSeconds: Number.isFinite(raw.refreshSeconds) ? Math.max(0, raw.refreshSeconds) : 0,
    status: STATUSES.has(raw.status) ? raw.status : 'listed',
    checkedAt: String(raw.checkedAt ?? new Date(0).toISOString()),
    pageUrl: httpsOrNull(raw.pageUrl),
    thumbnailUrl: httpsOrNull(raw.thumbnailUrl),
  });
}
