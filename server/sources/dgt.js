/**
 * DGT (Dirección General de Tráfico) camera catalog — DATEX II.
 * Primary: the NAP v3.6 DevicePublication (the legacy infocar
 * CCTVSiteTablePublication answered 404 in production on 2026-10-01; kept as
 * fallback). The v3.6 element names could not be verified from the dev
 * environment, so records are located structurally (see findRecords). Covers the state road network except País Vasco and
 * Cataluña, which manage their own traffic. Record shape verified against a
 * real DGT export (tests/fixtures/dgt-cctv-sample.xml).
 *
 * Frames are http:// JPEGs on infocar.dgt.es, so the browser cannot load them
 * on an https page: they go through the same-origin /api/frame endpoint, which
 * rebuilds the URL from the numeric id (never from client input).
 */
import { elements, firstText } from './xml.js';
import { lookupSpanishRegion } from '../geo/regionLookup.js';

export const DGT_CATALOG_URLS = Object.freeze([
  'https://nap.dgt.es/datex2/v3/dgt/DevicePublication/camaras_datex2_v36.xml',
  'https://infocar.dgt.es/datex2/dgt/CCTVSiteTablePublication/all/content.xml',
]);
export const DGT_ALLOWED_HOSTS = ['infocar.dgt.es', 'nap.dgt.es'];
export const DGT_FRAME_HOSTS = ['etraffic.dgt.es', 'infocar.dgt.es'];
// v3.6 feed (verified in production 2026-10-01): https://etraffic.dgt.es/camarasEtraffic/176130.jpg
const FRAME_V36 = /^https?:\/\/etraffic\.dgt\.es\/camarasEtraffic\/(\d{1,9})\.jpg$/i;
// legacy feed: http://infocar.dgt.es/etraffic/data/camaras/31.jpg → native id "i31"
const FRAME_LEGACY = /^https?:\/\/infocar\.dgt\.es\/etraffic\/data\/camaras\/(\d{1,7})\.jpg$/i;

/** Native id for an accepted DGT image URL, or null. */
export function dgtNativeId(imageUrl) {
  const url = String(imageUrl).trim();
  const v36 = FRAME_V36.exec(url);
  if (v36) return String(Number(v36[1]));
  const legacy = FRAME_LEGACY.exec(url);
  return legacy ? `i${Number(legacy[1])}` : null;
}
const URL_IN_TEXT = /https?:\/\/[^\s"'<>]+?\.jpe?g\b/i;
const OPEN_TAG = /<(?:[A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)[\s>]/g;

/**
 * Locate camera records without depending on one schema version: the repeated
 * element (legacy: cctvCameraMetadataRecord) whose instances carry a latitude,
 * a longitude and an image URL. Prefers the most specific (innermost) match.
 */
export function findRecords(xml) {
  const legacy = elements(xml, 'cctvCameraMetadataRecord');
  if (legacy.length) return legacy;
  const counts = new Map();
  for (const [, name] of String(xml).matchAll(OPEN_TAG)) counts.set(name, (counts.get(name) ?? 0) + 1);
  const candidates = [...counts].filter(([, n]) => n >= 1).sort((a, b) => a[1] - b[1] || 0);
  let best = [];
  for (const [name, count] of candidates) {
    if (count < best.length) continue;
    const found = elements(xml, name);
    const sample = found[0] ?? '';
    if (/latitude/i.test(sample) && /longitude/i.test(sample) && URL_IN_TEXT.test(sample) && found.length >= best.length) {
      // Same count → keep the smaller (innermost) record.
      if (found.length > best.length || sample.length < (best[0]?.length ?? Infinity)) best = found;
    }
  }
  return best;
}

const recordImageUrl = (record) => firstText(record, 'urlLinkAddress') || (record.match(URL_IN_TEXT)?.[0] ?? '');
const recordName = (record) =>
  firstText(record, 'cctvCameraIdentification') ||
  firstText(record, 'value') ||
  firstText(record, 'name') ||
  firstText(record, 'description');

/** Upstream frame URL for a validated DGT native id. */
export function dgtFrameUrl(nativeId) {
  if (/^\d{1,9}$/.test(nativeId)) return `https://etraffic.dgt.es/camarasEtraffic/${nativeId}.jpg`;
  const legacy = /^i(\d{1,7})$/.exec(nativeId);
  return legacy ? `http://infocar.dgt.es/etraffic/data/camaras/${legacy[1]}.jpg` : null;
}

/** "CAMARA-CGT VALLADOLID_2" → "CGT Valladolid · cámara 2" (readable, still faithful). */
export function prettifyDgtName(raw, nativeId) {
  const cleaned = String(raw || '')
    .replace(/^CAMARA[-\s]*/i, '')
    .replace(/_\d+$/, '')
    .trim();
  if (!cleaned) return `Cámara DGT ${nativeId}`;
  const titled = cleaned
    .toLowerCase()
    .replace(/(^|[\s/(-])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase())
    .replace(/\b(Cgt|Dgt|Ap|Mu|Ma|Gr)\b/g, (w) => w.toUpperCase());
  return `${titled} · cámara ${nativeId}`;
}

/**
 * @param {string} xml
 * @param {{ checkedAt: string }} context
 * @returns {object[]} raw camera records for createCamera()
 */
export function parseDgtCatalog(xml, { checkedAt }) {
  const records = findRecords(xml);
  if (!records.length) {
    throw new Error(`Formato DGT no reconocido: sin registros con coordenadas e imagen (inicio: ${String(xml).replace(/\s+/g, ' ').slice(0, 200)})`);
  }
  const out = [];
  let sampleRejected = '';
  for (const record of records) {
    const imageUrl = recordImageUrl(record);
    const nativeId = dgtNativeId(imageUrl);
    if (!nativeId) {
      sampleRejected ||= imageUrl || '(sin urlLinkAddress)';
      continue;
    }
    const lat = Number(firstText(record, 'latitude'));
    const lon = Number(firstText(record, 'longitude'));
    const region = lookupSpanishRegion(lat, lon);
    out.push({
      id: `dgt:${nativeId}`,
      name: prettifyDgtName(recordName(record), nativeId.replace(/^i/, '')),
      countryCode: 'ES',
      communityCode: region?.communityCode ?? null,
      provinceCode: region?.provinceCode ?? null,
      city: null,
      lat,
      lon,
      category: 'traffic',
      mediaUrl: `/api/frame?id=dgt:${nativeId}`,
      mediaType: 'image',
      liveness: 'periodic',
      refreshSeconds: 0,
      status: 'listed',
      checkedAt,
    });
  }
  if (!out.length) {
    throw new Error(`DGT: ${records.length} registros sin imagen reconocible (ejemplo: ${sampleRejected.slice(0, 160)})`);
  }
  return out;
}
