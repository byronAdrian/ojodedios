/**
 * Open Data Euskadi — Traffic API (https://api.euskadi.eus/traffic/v1.0).
 * Cameras of the Basque Government, the three Diputaciones Forales and the
 * city councils of Bilbao, Vitoria-Gasteiz and Donostia, which the DGT
 * catalog does not cover.
 *
 * Record shape (verified with a real response):
 *   { cameraId, sourceId, cameraName, latitude, longitude, road, kilometer,
 *     address, urlImage? }  — coordinates as strings, either degrees or
 *   ETRS89 / UTM 30N metres (latitude = northing, longitude = easting).
 * Paginated: { totalItems, totalPages, currentPage, cameras: [...] }.
 *
 * Images live on each administration's own host, so only image URLs on
 * official Basque public-administration domains are accepted. The camera id
 * encodes host+path (base64url); /api/frame decodes it and re-validates both,
 * so the proxy never fetches a URL a visitor supplied.
 */
import { lookupSpanishRegion } from '../geo/regionLookup.js';
import { utmToLatLon } from '../geo/utm.js';

export const EUSKADI_API = 'https://api.euskadi.eus/traffic/v1.0';
export const EUSKADI_ALLOWED_HOSTS = ['api.euskadi.eus'];
export const EUSKADI_MAX_PAGES = 120;

/** Registrable domains of the publishing administrations (host = domain or a subdomain). */
export const EUSKADI_IMAGE_DOMAINS = Object.freeze([
  'bizkaimove.com', // Diputación Foral de Bizkaia — seen in the live catalog
  'bizkaia.eus',
  'bizkaia.net',
  'gipuzkoa.eus',
  'gipuzkoa.net',
  'araba.eus',
  'alava.net',
  'euskadi.eus',
  'euskadi.net',
  'trafikoa.eus',
  'trafikoa.net', // Dirección de Tráfico del Gobierno Vasco (legacy domain, seen in the live catalog)
  'bilbao.eus',
  'bilbao.net',
  'vitoria-gasteiz.org',
  'donostia.eus',
  'donostia.org',
]);

const SAFE_PATH = /^\/(?!.*\.\.)[A-Za-z0-9/_.~-]{1,160}\.(?:jpe?g|png)$/i;
const UTM_ZONE = 30;

const isOfficialHost = (host) =>
  EUSKADI_IMAGE_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));

/** "host/path" of an accepted official image URL, or null. */
export function euskadiImageKey(rawUrl) {
  try {
    const url = new URL(String(rawUrl).trim());
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!isOfficialHost(host) || url.username || url.password || url.port || url.search) return null;
    if (!SAFE_PATH.test(url.pathname)) return null;
    return `${host}${url.pathname}`;
  } catch {
    return null;
  }
}

export const euskadiNativeId = (key) => Buffer.from(key, 'utf8').toString('base64url');

/** Upstream frame URL for a native id produced by euskadiNativeId, or null. */
export function euskadiFrameUrl(nativeId) {
  if (!/^[A-Za-z0-9_-]{8,240}$/.test(nativeId)) return null;
  const key = Buffer.from(nativeId, 'base64url').toString('utf8');
  const slash = key.indexOf('/');
  if (slash < 1) return null;
  const host = key.slice(0, slash);
  const path = key.slice(slash);
  if (!/^[a-z0-9.-]{3,100}$/.test(host) || !isOfficialHost(host) || !SAFE_PATH.test(path)) return null;
  // The catalog publishes http URLs; safeFetch follows a same-host upgrade to https.
  return `http://${host}${path}`;
}

/** Allowed hosts for fetching one frame: exactly the host of that frame. */
export const euskadiFrameHosts = (upstreamUrl) => [new URL(upstreamUrl).hostname];

/** Degrees as published, or UTM 30N metres converted; null when unusable. */
export function euskadiCoordinates(latitude, longitude) {
  const a = Number(String(latitude ?? '').replace(',', '.'));
  const b = Number(String(longitude ?? '').replace(',', '.'));
  if (!Number.isFinite(a) || !Number.isFinite(b) || (a === 0 && b === 0)) return null;
  if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return { lat: a, lon: b };
  return utmToLatLon(b, a, UTM_ZONE);
}

export const euskadiPageUrl = (page) => `${EUSKADI_API}/cameras?_page=${page}`;

/**
 * @param {Array<{ cameras?: object[] }>} pages  parsed API pages
 * @returns {{ rows: object[], notes: object }}
 */
export function parseEuskadiPages(pages, { checkedAt }) {
  const records = pages.flatMap((page) => (Array.isArray(page?.cameras) ? page.cameras : []));
  if (!records.length) throw new Error('API de tráfico de Euskadi: respuesta sin cámaras');
  const rows = [];
  const rejectedHosts = new Map();
  const rejectedSamples = new Map(); // first refused URL per host, so a format change can be diagnosed
  let withoutImage = 0;
  let badLocation = 0;
  for (const record of records) {
    const rawImage = String(record?.urlImage ?? '').trim();
    if (!rawImage) {
      withoutImage += 1;
      continue;
    }
    const key = euskadiImageKey(rawImage);
    if (!key) {
      let host = '(URL no válida)';
      try {
        host = new URL(rawImage).hostname || host;
      } catch {}
      rejectedHosts.set(host, (rejectedHosts.get(host) ?? 0) + 1);
      if (!rejectedSamples.has(host)) rejectedSamples.set(host, rawImage.slice(0, 200));
      continue;
    }
    const point = euskadiCoordinates(record?.latitude, record?.longitude);
    const region = point ? lookupSpanishRegion(point.lat, point.lon) : null;
    if (!point || !region) {
      badLocation += 1;
      continue;
    }
    const nativeId = euskadiNativeId(key);
    const road = String(record?.road ?? '').trim();
    const name = String(record?.cameraName ?? '').trim() || [road, record?.kilometer].filter(Boolean).join(' km ') || 'Cámara';
    rows.push({
      id: `euskadi:${nativeId}`,
      name: name.slice(0, 120),
      countryCode: 'ES',
      communityCode: region.communityCode,
      provinceCode: region.provinceCode,
      city: null, // the API names the road and direction, not the municipality
      lat: point.lat,
      lon: point.lon,
      category: 'traffic',
      mediaUrl: `/api/frame?id=euskadi:${nativeId}`,
      mediaType: 'image',
      liveness: 'periodic',
      refreshSeconds: 0,
      status: 'listed',
      checkedAt,
    });
  }
  const notes = {
    records: records.length,
    withoutImage,
    badLocation,
    rejectedImageHosts: Object.fromEntries([...rejectedHosts].sort((x, y) => y[1] - x[1]).slice(0, 10)),
    rejectedImageSamples: Object.fromEntries([...rejectedSamples].slice(0, 10)),
  };
  if (!rows.length) {
    throw new Error(`API de tráfico de Euskadi: ninguna cámara utilizable (${JSON.stringify(notes).slice(0, 220)})`);
  }
  return { rows, notes };
}

/**
 * Fetches every page (bounded concurrency). Any failed page fails the load,
 * so a partial catalog is never presented as complete.
 * @param {(url: string) => Promise<object>} getJson
 */
export async function loadEuskadiPages(getJson, { concurrency = 6, maxPages = EUSKADI_MAX_PAGES } = {}) {
  const first = await getJson(euskadiPageUrl(1));
  const total = Math.min(Math.max(1, Number(first?.totalPages) || 1), maxPages);
  const pages = [first];
  let next = 2;
  async function worker() {
    while (next <= total) {
      const page = next;
      next += 1;
      pages[page - 1] = await getJson(euskadiPageUrl(page));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, total - 1) }, worker));
  return pages;
}
