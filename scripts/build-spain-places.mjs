#!/usr/bin/env node
/**
 * Regenerates src/data/spainPlaces.data.js — the offline gazetteer of Spanish
 * towns (≥ 1,000 inhabitants) that lets the search box find any municipality
 * ("Aspe", "Novelda"…) and centre the map on it. It is navigation data only:
 * it never implies that a place has cameras.
 *
 * Source: GeoNames "cities1000" (CC BY 4.0), as packaged by the npm package
 * all-the-cities@3.1.0. The tarball is pinned and its sha512 verified, and it is
 * decoded here (tar + protobuf) without adding any dependency.
 *
 * Usage: npm run data:places [-- <local all-the-cities-3.1.0.tgz>]
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { getProvince } from '../src/domain/spain.js';
import { lookupSpanishRegion } from '../server/geo/regionLookup.js';

const TARBALL = 'https://registry.npmjs.org/all-the-cities/-/all-the-cities-3.1.0.tgz';
const INTEGRITY = 'Jx+mZR7lUVSX+qk785T3MRkAJYMvUpOmeNQSCbUl1WcCNpBUKJsQJ6uZzOl3/bWXVIUx1UhDFs8ASDHSI3rvzg==';
const OUTPUT = fileURLToPath(new URL('../src/data/spainPlaces.data.js', import.meta.url));

/** GeoNames feature codes kept: populated places and seats of administration. */
const KEPT_FEATURES = new Set(['PPL', 'PPLA', 'PPLA2', 'PPLA3', 'PPLA4', 'PPLC']);

/** INE province code (first two digits of the municipality code) → ISO 3166-2:ES. */
const INE_TO_ISO = {
  '01': 'ES-VI', '02': 'ES-AB', '03': 'ES-A', '04': 'ES-AL', '05': 'ES-AV', '06': 'ES-BA', '07': 'ES-PM',
  '08': 'ES-B', '09': 'ES-BU', '10': 'ES-CC', '11': 'ES-CA', '12': 'ES-CS', '13': 'ES-CR', '14': 'ES-CO',
  '15': 'ES-C', '16': 'ES-CU', '17': 'ES-GI', '18': 'ES-GR', '19': 'ES-GU', '20': 'ES-SS', '21': 'ES-H',
  '22': 'ES-HU', '23': 'ES-J', '24': 'ES-LE', '25': 'ES-L', '26': 'ES-LO', '27': 'ES-LU', '28': 'ES-M',
  '29': 'ES-MA', '30': 'ES-MU', '31': 'ES-NA', '32': 'ES-OR', '33': 'ES-O', '34': 'ES-P', '35': 'ES-GC',
  '36': 'ES-PO', '37': 'ES-SA', '38': 'ES-TF', '39': 'ES-S', '40': 'ES-SG', '41': 'ES-SE', '42': 'ES-SO',
  '43': 'ES-T', '44': 'ES-TE', '45': 'ES-TO', '46': 'ES-V', '47': 'ES-VA', '48': 'ES-BI', '49': 'ES-ZA',
  '50': 'ES-Z', '51': 'ES-CE', '52': 'ES-ML',
};

async function loadTarball(localPath) {
  const bytes = localPath
    ? await readFile(localPath)
    : Buffer.from(await (await fetch(TARBALL, { signal: AbortSignal.timeout(120_000) })).arrayBuffer());
  const digest = createHash('sha512').update(bytes).digest('base64');
  if (digest !== INTEGRITY) throw new Error('all-the-cities tarball integrity mismatch');
  return gunzipSync(bytes);
}

/** Minimal ustar reader: returns the contents of the entry whose name ends with `suffix`. */
function extractFromTar(tar, suffix) {
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const name = tar.toString('utf8', offset, offset + 100).replace(/\0.*$/s, '');
    if (!name) break;
    const size = parseInt(tar.toString('utf8', offset + 124, offset + 136).replace(/\0.*$/s, '').trim(), 8);
    const start = offset + 512;
    if (name.endsWith(suffix)) return tar.subarray(start, start + size);
    offset = start + Math.ceil(size / 512) * 512;
  }
  throw new Error(`${suffix} not found in tarball`);
}

/** Decoder for the length-delimited protobuf stream written by all-the-cities' build.js. */
function decodeCities(buf) {
  let pos = 0;
  const varint = () => {
    let result = 0;
    let factor = 1;
    for (;;) {
      const byte = buf[pos++];
      result += (byte & 0x7f) * factor;
      if (byte < 0x80) return result;
      factor *= 128;
    }
  };
  const svarint = () => {
    const n = varint();
    return n % 2 === 0 ? n / 2 : -(n + 1) / 2;
  };
  const string = () => {
    const len = varint();
    pos += len;
    return buf.toString('utf8', pos - len, pos);
  };

  const cities = [];
  let lon = 0;
  let lat = 0;
  while (pos < buf.length) {
    const end = varint() + pos;
    const city = { id: 0, name: '', country: '', muni: '', featureCode: '', population: 0, lat: 0, lon: 0 };
    while (pos < end) {
      const key = varint();
      const tag = Math.floor(key / 8);
      const wire = key % 8;
      if (tag === 1) city.id = svarint();
      else if (tag === 2) city.name = string();
      else if (tag === 3) city.country = string();
      else if (tag === 5) city.muni = string();
      else if (tag === 7) city.featureCode = string();
      else if (tag === 9) city.population = varint();
      else if (tag === 10) city.lon = (lon += svarint()) / 1e5;
      else if (tag === 11) city.lat = (lat += svarint()) / 1e5;
      else if (wire === 0) varint();
      else if (wire === 2) string();
      else throw new Error(`Unsupported wire type ${wire} at byte ${pos}`);
    }
    cities.push(city);
  }
  return cities;
}

const tar = await loadTarball(process.argv[2]);
const all = decodeCities(extractFromTar(tar, 'cities.pbf'));

const byKey = new Map();
let fromPolygon = 0;
let dropped = 0;
for (const city of all) {
  if (city.country !== 'ES' || !KEPT_FEATURES.has(city.featureCode) || !city.name) continue;
  let province = INE_TO_ISO[city.muni.slice(0, 2)];
  if (!province) {
    province = lookupSpanishRegion(city.lat, city.lon)?.provinceCode;
    if (province) fromPolygon += 1;
  }
  if (!province || !getProvince(province)) {
    dropped += 1;
    continue;
  }
  // One entry per name and province: keep the most populated homonym.
  const key = `${city.name}|${province}`;
  const previous = byKey.get(key);
  if (!previous || city.population > previous.population) byKey.set(key, { ...city, province });
}

const rows = [...byKey.values()]
  .sort((a, b) => b.population - a.population || a.id - b.id)
  .map((c) => [c.id, c.name, c.province, Math.round(c.lat * 1e3) / 1e3, Math.round(c.lon * 1e3) / 1e3]);

const header = `/**
 * GENERATED by scripts/build-spain-places.mjs — do not edit by hand.
 * Spanish populated places with ≥ 1,000 inhabitants, sorted by population.
 * Row: [geonamesId, name, provinceIso, lat, lon] (coordinates rounded to ~100 m).
 * Source: GeoNames (https://www.geonames.org), CC BY 4.0, via all-the-cities@3.1.0.
 */
`;
await writeFile(OUTPUT, `${header}export default ${JSON.stringify(rows)};\n`);
console.log(`Wrote ${rows.length} places (${fromPolygon} by polygon fallback, ${dropped} without province) to ${OUTPUT}`);
