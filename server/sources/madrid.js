/**
 * Ayuntamiento de Madrid traffic cameras — KML from datos.madrid.es
 * (dataset 202088-0-trafico-camaras). Each Placemark carries ExtendedData
 * Numero/Nombre, a Point and an image URL (in the <description> <img src>,
 * refreshed roughly every 10 minutes according to the dataset description).
 *
 * The image path has changed over the years (…/informo/Camaras/CamaraNNNNN_mdf.jpg
 * in older exports), so any image path on an official Informo host is accepted.
 * The camera id encodes host+path (base64url); /api/frame decodes it and
 * re-validates host and path, so the proxy stays closed to arbitrary URLs.
 */
import { decodeXmlEntities, elements, firstText } from './xml.js';
import { lookupSpanishRegion } from '../geo/regionLookup.js';

export const MADRID_CATALOG_URL = 'https://datos.madrid.es/egob/catalogo/202088-0-trafico-camaras.kml';
export const MADRID_IMAGE_HOSTS = ['informo.madrid.es', 'informo.munimadrid.es'];
export const MADRID_ALLOWED_HOSTS = ['datos.madrid.es', ...MADRID_IMAGE_HOSTS];
const SAFE_PATH = /^\/(?!.*\.\.)[A-Za-z0-9/_.-]{1,160}\.(?:jpe?g|png)$/i;
const URL_IN_TEXT = /https?:\/\/[^\s"'<>]+?\.(?:jpe?g|png)\b/gi;

const toBase64Url = (text) => Buffer.from(text, 'utf8').toString('base64url');
const fromBase64Url = (text) => Buffer.from(text, 'base64url').toString('utf8');

/** "host/path" of an accepted official image URL, or null. */
export function madridImageKey(rawUrl) {
  try {
    const url = new URL(String(rawUrl).trim());
    const host = url.hostname.toLowerCase();
    if (!MADRID_IMAGE_HOSTS.includes(host) || url.username || url.port || url.search) return null;
    if (!SAFE_PATH.test(url.pathname)) return null;
    return `${host}${url.pathname}`;
  } catch {
    return null;
  }
}

export const madridNativeId = (key) => toBase64Url(key);

/** Upstream frame URL for a native id produced by madridNativeId, or null. */
export function madridFrameUrl(nativeId) {
  if (!/^[A-Za-z0-9_-]{8,240}$/.test(nativeId)) return null;
  const key = fromBase64Url(nativeId);
  const slash = key.indexOf('/');
  if (slash < 0) return null;
  const host = key.slice(0, slash);
  const path = key.slice(slash);
  if (!MADRID_IMAGE_HOSTS.includes(host) || !SAFE_PATH.test(path)) return null;
  // http: Informo historically serves plain http; safeFetch follows an
  // allowlisted http→https redirect if the host upgrades.
  return `http://${host}${path}`;
}

function extendedValue(placemark, key) {
  for (const data of placemark.matchAll(/<Data\s+name="([^"]+)"\s*>([\s\S]*?)<\/Data>/g)) {
    if (data[1] === key) return firstText(data[2], 'value') || firstText(data[2], 'Value');
  }
  return '';
}

/** Every image-looking URL in the placemark, <img src> first. */
function candidateImageUrls(placemark) {
  const description = decodeXmlEntities(elements(placemark, 'description')[0] ?? '');
  const fromImg = /<img[^>]*\ssrc\s*=\s*["']?([^"'\s>]+)/i.exec(description)?.[1];
  const loose = [...decodeXmlEntities(placemark).matchAll(URL_IN_TEXT)].map((m) => m[0]);
  return [fromImg, ...loose].filter(Boolean);
}

export function parseMadridKml(kml, { checkedAt }) {
  const placemarks = elements(kml, 'Placemark');
  if (!placemarks.length) throw new Error('Formato KML de Madrid no reconocido: sin Placemark');
  const out = [];
  let sampleRejected = '';
  for (const placemark of placemarks) {
    const candidates = candidateImageUrls(placemark);
    const key = candidates.map(madridImageKey).find(Boolean);
    if (!key) {
      sampleRejected ||= candidates[0] || '(sin URL de imagen)';
      continue;
    }
    const [lonText, latText] = firstText(placemark, 'coordinates').split(',');
    const lat = Number(latText);
    const lon = Number(lonText);
    const region = lookupSpanishRegion(lat, lon);
    const label = extendedValue(placemark, 'Nombre') || firstText(placemark, 'name');
    const nativeId = madridNativeId(key);
    out.push({
      id: `madrid:${nativeId}`,
      name: label ? titleCase(label) : `Cámara ${extendedValue(placemark, 'Numero') || ''}`.trim(),
      countryCode: 'ES',
      communityCode: region?.communityCode ?? 'ES-MD',
      provinceCode: region?.provinceCode ?? 'ES-M',
      city: 'Madrid',
      lat,
      lon,
      category: 'traffic',
      mediaUrl: `/api/frame?id=madrid:${nativeId}`,
      mediaType: 'image',
      liveness: 'periodic',
      refreshSeconds: 600,
      status: 'listed',
      checkedAt,
    });
  }
  if (!out.length) {
    throw new Error(`KML de Madrid: ${placemarks.length} placemarks sin imagen reconocible (ejemplo: ${sampleRejected.slice(0, 160)})`);
  }
  return out;
}

const LOWER_WORDS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'el', 'a', 'con', 'en']);
function titleCase(text) {
  return String(text)
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => (i > 0 && LOWER_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
    .replace(/^Gta\b/, 'Glorieta')
    .replace(/^Pza\b/, 'Plaza');
}
