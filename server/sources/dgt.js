/**
 * DGT (Dirección General de Tráfico) camera catalog — DATEX II
 * CCTVSiteTablePublication. Covers the state road network except País Vasco and
 * Cataluña, which manage their own traffic. Record shape verified against a
 * real DGT export (tests/fixtures/dgt-cctv-sample.xml).
 *
 * Frames are http:// JPEGs on infocar.dgt.es, so the browser cannot load them
 * on an https page: they go through the same-origin /api/frame endpoint, which
 * rebuilds the URL from the numeric id (never from client input).
 */
import { elements, firstText } from './xml.js';
import { lookupSpanishRegion } from '../geo/regionLookup.js';

export const DGT_CATALOG_URL =
  'https://infocar.dgt.es/datex2/dgt/CCTVSiteTablePublication/all/content.xml';
export const DGT_ALLOWED_HOSTS = ['infocar.dgt.es', 'nap.dgt.es'];
const FRAME_PATH = /\/etraffic\/data\/camaras\/(\d{1,7})\.jpg$/i;

/** Upstream frame URL for a validated DGT native id. */
export function dgtFrameUrl(nativeId) {
  if (!/^\d{1,7}$/.test(nativeId)) return null;
  return `http://infocar.dgt.es/etraffic/data/camaras/${nativeId}.jpg`;
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
  const records = elements(xml, 'cctvCameraMetadataRecord');
  if (!records.length) {
    throw new Error('Formato DGT no reconocido: no hay registros cctvCameraMetadataRecord');
  }
  const out = [];
  let sampleRejected = '';
  for (const record of records) {
    const imageUrl = firstText(record, 'urlLinkAddress');
    const match = FRAME_PATH.exec(imageUrl);
    if (!match) {
      sampleRejected ||= imageUrl || '(sin urlLinkAddress)';
      continue;
    }
    const nativeId = String(Number(match[1]));
    const lat = Number(firstText(record, 'latitude'));
    const lon = Number(firstText(record, 'longitude'));
    const region = lookupSpanishRegion(lat, lon);
    out.push({
      id: `dgt:${nativeId}`,
      name: prettifyDgtName(firstText(record, 'cctvCameraIdentification'), nativeId),
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
