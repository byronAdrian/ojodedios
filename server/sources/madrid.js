/**
 * Ayuntamiento de Madrid traffic cameras — KML from datos.madrid.es
 * (dataset 202088-0-trafico-camaras). Each Placemark carries ExtendedData
 * Numero/Nombre, a Point and an <img src> pointing at the Informo still,
 * refreshed roughly every 10 minutes according to the dataset description.
 * Shape verified against a real export (tests/fixtures/madrid-cameras-sample.kml).
 */
import { decodeXmlEntities, elements, firstText } from './xml.js';
import { lookupSpanishRegion } from '../geo/regionLookup.js';

export const MADRID_CATALOG_URL = 'https://datos.madrid.es/egob/catalogo/202088-0-trafico-camaras.kml';
export const MADRID_ALLOWED_HOSTS = ['datos.madrid.es', 'informo.madrid.es', 'informo.munimadrid.es'];
const IMAGE_URL = /^https?:\/\/informo\.(?:munimadrid|madrid)\.es\/informo\/Camaras\/(Camara[A-Za-z0-9_-]{1,40})\.jpg$/i;
const STEM = /^Camara[A-Za-z0-9_-]{1,40}$/;

/** Upstream frame URL for a validated Madrid stem (e.g. "Camara00032_mdf"). */
export function madridFrameUrl(stem) {
  if (!STEM.test(stem)) return null;
  return `http://informo.munimadrid.es/informo/Camaras/${stem}.jpg`;
}

function extendedValue(placemark, key) {
  for (const data of placemark.matchAll(/<Data\s+name="([^"]+)"\s*>([\s\S]*?)<\/Data>/g)) {
    if (data[1] === key) return firstText(data[2], 'value') || firstText(data[2], 'Value');
  }
  return '';
}

export function parseMadridKml(kml, { checkedAt }) {
  const placemarks = elements(kml, 'Placemark');
  if (!placemarks.length) throw new Error('Formato KML de Madrid no reconocido: sin Placemark');
  const out = [];
  for (const placemark of placemarks) {
    const description = decodeXmlEntities(elements(placemark, 'description')[0] ?? '');
    const src = /<img[^>]*\ssrc\s*=\s*["']?([^"'\s>]+)/i.exec(description)?.[1] ?? '';
    const match = IMAGE_URL.exec(src.trim());
    if (!match) continue;
    const stem = match[1];
    const [lonText, latText] = firstText(placemark, 'coordinates').split(',');
    const lat = Number(latText);
    const lon = Number(lonText);
    const region = lookupSpanishRegion(lat, lon);
    const label = extendedValue(placemark, 'Nombre') || firstText(placemark, 'name');
    out.push({
      id: `madrid:${stem}`,
      name: label ? titleCase(label) : `Cámara ${stem}`,
      countryCode: 'ES',
      communityCode: region?.communityCode ?? 'ES-MD',
      provinceCode: region?.provinceCode ?? 'ES-M',
      city: 'Madrid',
      lat,
      lon,
      category: 'traffic',
      mediaUrl: `/api/frame?id=madrid:${stem}`,
      mediaType: 'image',
      liveness: 'periodic',
      refreshSeconds: 600,
      status: 'listed',
      checkedAt,
    });
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
    .replace(/\bM-(\d+)/gi, 'M-$1')
    .replace(/^Gta\b/, 'Glorieta')
    .replace(/^Pza\b/, 'Plaza');
}
