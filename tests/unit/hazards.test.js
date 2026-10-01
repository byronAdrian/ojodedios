import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseUsgsFeed } from '../../server/sources/usgs.js';
import { parseFirmsCsv, quantiseFireBbox, firmsUrl } from '../../server/sources/firms.js';
import { quakeSize, quakeLevel, fireSize, fireBboxParam, timeAgo, hazardStatusLabel } from '../../src/hazards/hazards.js';

const fixture = (name) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');

test('USGS feed: earthquakes only, validated fields, strongest last', () => {
  const events = parseUsgsFeed(JSON.parse(fixture('usgs-sample.geojson')));
  assert.deepEqual(events.map((e) => e.id), ['nc75012345', 'ci40912345', 'us7000abcd', 'us7000efgh']);
  const lorca = events.find((e) => e.id === 'us7000abcd');
  assert.deepEqual(
    { lat: lorca.lat, lon: lorca.lon, depthKm: lorca.depthKm, mag: lorca.mag, magType: lorca.magType, tsunami: lorca.tsunami },
    { lat: 37.55, lon: -1.85, depthKm: 10.5, mag: 4.7, magType: 'mb', tsunami: false },
  );
  assert.equal(lorca.url, 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd');
  assert.equal(events.find((e) => e.id === 'us7000efgh').tsunami, true);
  // Off-site links are dropped, a missing magnitude stays null (never invented).
  const geysers = events.find((e) => e.id === 'nc75012345');
  assert.equal(geysers.url, null);
  assert.equal(geysers.mag, null);
});

test('USGS feed: malformed input fails loudly, bad features are skipped', () => {
  assert.throws(() => parseUsgsFeed({}), /features/);
  assert.throws(() => parseUsgsFeed(null), /features/);
  const events = parseUsgsFeed({
    features: [
      { id: 'ok1', properties: { time: 1, mag: 2 }, geometry: { coordinates: [1, 2, 3] } },
      { id: 'bad lat', properties: { time: 1 }, geometry: { coordinates: [1, 200, 3] } },
      { id: 'no-time', properties: {}, geometry: { coordinates: [1, 2, 3] } },
      { id: '../evil', properties: { time: 1 }, geometry: { coordinates: [1, 2, 3] } },
      null,
    ],
  });
  assert.deepEqual(events.map((e) => e.id), ['ok1']);
});

test('FIRMS CSV: header-driven parse, confidence and time normalised', () => {
  const points = parseFirmsCsv(fixture('firms-sample.csv'));
  assert.equal(points.length, 3);
  assert.deepEqual(points[0], {
    lat: 37.8123, lon: -6.1234, frp: 4.8, confidence: 'nominal', acquired: '2026-10-01T13:06:00Z', satellite: 'N', daynight: 'D',
  });
  assert.equal(points[1].acquired, '2026-10-01T01:42:00Z');
  assert.equal(points[1].confidence, 'high');
  assert.equal(points[2].frp, null);
  assert.equal(points[2].confidence, 'low');
  assert.deepEqual(parseFirmsCsv(''), []);
  assert.throws(() => parseFirmsCsv('Invalid MAP_KEY.'), /no reconocida/);
});

test('FIRMS bbox: snapped to 5°, capped, antimeridian and junk refused', () => {
  assert.deepEqual(quantiseFireBbox('-9.4,36.1,3.3,43.8'), { west: -10, south: 35, east: 5, north: 45 });
  assert.equal(quantiseFireBbox('-180,-90,180,90'), null);
  assert.equal(quantiseFireBbox('170,10,-170,20'), null);
  for (const bad of ['', '1,2,3', 'a,b,c,d', '1,2,3,4,5', '-200,0,0,10', '0,0,0,0', null]) assert.equal(quantiseFireBbox(bad), null, String(bad));
});

test('FIRMS url: key validated, built only from constants and the snapped bbox', () => {
  const bbox = { west: -10, south: 35, east: 5, north: 45 };
  assert.equal(
    firmsUrl('a'.repeat(32), bbox),
    `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${'a'.repeat(32)}/VIIRS_SNPP_NRT/-10,35,5,45/1`,
  );
  for (const bad of [undefined, '', 'short', 'x/../y'.padEnd(32, 'z'), 'a'.repeat(65)]) assert.equal(firmsUrl(bad, bbox), null, String(bad));
});

test('client helpers: sizes, levels, bbox param mirrors the server cap', () => {
  assert.equal(quakeSize(null), 6);
  assert.ok(quakeSize(2) < quakeSize(5));
  assert.equal(quakeSize(9.5), 30);
  assert.equal(quakeLevel(4.5), 'strong');
  assert.equal(quakeLevel(4.4), 'normal');
  assert.equal(fireSize(null), 4);
  assert.ok(fireSize(1) < fireSize(500));
  assert.ok(fireSize(1e6) <= 10);
  assert.equal(fireBboxParam([-9.4, 36.1, 3.3, 43.8]), '-10,35,5,45');
  assert.equal(fireBboxParam([-60, 10, 10, 60]), null);
  assert.equal(fireBboxParam(null), null);
  assert.equal(fireBboxParam([10, 0, 5, 1]), null);
  // Same answer as the server for the same view.
  const view = [-4.2, 39.1, 1.7, 41.9];
  const q = quantiseFireBbox(fireBboxParam(view));
  assert.equal(`${q.west},${q.south},${q.east},${q.north}`, fireBboxParam(view));
});

test('relative time and panel status labels', () => {
  const now = Date.UTC(2026, 9, 1, 12);
  assert.match(timeAgo(now - 5 * 60_000, now), /5 minutos/);
  assert.match(timeAgo(now - 3 * 3_600_000, now), /3 horas/);
  assert.equal(timeAgo(NaN, now), '');
  assert.equal(hazardStatusLabel('quakes', { state: 'ready', count: 12 }), '12 en las últimas 24 h');
  assert.equal(hazardStatusLabel('fires', { state: 'missing_key' }), 'Requiere configurar FIRMS_MAP_KEY');
  assert.equal(hazardStatusLabel('fires', { state: 'zoom' }), 'Acerca el mapa para verlos');
  assert.equal(hazardStatusLabel('quakes', { state: 'error' }), 'Fuente no disponible');
});
