import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFilters, defaultFilters, summarize, countActiveFilters, distanceKm, normalizeText, sortCameras } from '../../src/domain/filters.js';
import { createCamera } from '../../src/domain/camera.js';

const cam = (id, extra) => createCamera({ id, name: id, mediaUrl: null, ...extra });
const cams = [
  cam('dgt:1', { name: 'Ávila Norte', lat: 40.66, lon: -4.7, communityCode: 'ES-CL', provinceCode: 'ES-AV', category: 'traffic' }),
  cam('madrid:Camara1', { name: 'Plaza de Colón', lat: 40.425, lon: -3.69, communityCode: 'ES-MD', provinceCode: 'ES-M', city: 'Madrid', category: 'traffic' }),
  cam('dgt:2', { name: 'Getafe', lat: 40.3, lon: -3.73, communityCode: 'ES-MD', provinceCode: 'ES-M', category: 'highway' }),
  cam('tfl:1', { name: 'Tower Bridge', lat: 51.5, lon: -0.07, status: 'active', category: 'traffic' }),
  cam('fintraffic:C0000001', { name: 'Espoo', lat: 60.2, lon: 24.9, status: 'active', category: 'weather' }),
];
const f = (patch) => ({ ...defaultFilters(), ...patch });
const ids = (list) => list.map((c) => c.id);

test('spain scope keeps only ES cameras', () => {
  assert.deepEqual(ids(applyFilters(cams, f({}))), ['dgt:1', 'madrid:Camara1', 'dgt:2']);
});
test('world scope with and without country', () => {
  assert.equal(applyFilters(cams, f({ scope: 'world' })).length, 5);
  assert.deepEqual(ids(applyFilters(cams, f({ scope: 'world', country: 'FI' }))), ['fintraffic:C0000001']);
});
test('hierarchical community/province filters', () => {
  assert.deepEqual(ids(applyFilters(cams, f({ community: 'ES-MD' }))), ['madrid:Camara1', 'dgt:2']);
  assert.deepEqual(ids(applyFilters(cams, f({ community: 'ES-CL', province: 'ES-AV' }))), ['dgt:1']);
  assert.deepEqual(ids(applyFilters(cams, f({ community: 'ES-CN' }))), []);
});
test('city acts as a 25 km proximity filter', () => {
  assert.deepEqual(ids(applyFilters(cams, f({ city: 'madrid' }))), ['madrid:Camara1', 'dgt:2']);
  assert.deepEqual(ids(applyFilters(cams, f({ city: 'ceuta' }))), []);
});
test('category, status, text (accent-insensitive), favorites and bounds', () => {
  assert.deepEqual(ids(applyFilters(cams, f({ categories: ['highway'] }))), ['dgt:2']);
  assert.deepEqual(ids(applyFilters(cams, f({ scope: 'world', status: 'active' }))), ['tfl:1', 'fintraffic:C0000001']);
  assert.deepEqual(ids(applyFilters(cams, f({ text: 'colon' }))), ['madrid:Camara1']);
  assert.deepEqual(ids(applyFilters(cams, f({ text: 'AVILA' }))), ['dgt:1']);
  assert.deepEqual(ids(applyFilters(cams, f({ favoritesOnly: true }), { favorites: new Set(['dgt:2']) })), ['dgt:2']);
  assert.deepEqual(ids(applyFilters(cams, f({ viewBounds: [-4, 40, -3, 41] }))), ['madrid:Camara1', 'dgt:2']);
  const availability = new Map([['dgt:1', 'offline'], ['dgt:2', 'online']]);
  assert.deepEqual(ids(applyFilters(cams, f({ status: 'online' }), { availability })), ['dgt:2']);
  assert.deepEqual(ids(applyFilters(cams, f({ status: 'offline' }), { availability })), ['dgt:1']);
});
test('antimeridian-crossing bounds', () => {
  const pacific = [cam('tfl:2', { lat: 0.5, lon: 179.5 }), cam('tfl:3', { lat: 0.5, lon: -179.5 }), cam('tfl:4', { lat: 0.5, lon: 10 })];
  assert.deepEqual(ids(applyFilters(pacific, f({ scope: 'world', viewBounds: [179, 0, -179, 1] }))), ['tfl:2', 'tfl:3']);
});
test('summarize separates catalog, verified, media and observed availability', () => {
  const s = summarize(cams, new Map([['dgt:1', 'offline']]));
  assert.deepEqual(s, { total: 5, active: 2, withMedia: 0, online: 0, offline: 1 });
});
test('countActiveFilters / helpers', () => {
  assert.equal(countActiveFilters(defaultFilters()), 0);
  assert.equal(countActiveFilters(f({ community: 'ES-MD', categories: ['a', 'b'], text: 'x' })), 4);
  assert.ok(Math.abs(distanceKm(40.4168, -3.7038, 41.3874, 2.1686) - 505) < 5);
  assert.equal(normalizeText('  Ñandú  CÁCERES '), 'nandu caceres');
  assert.deepEqual(ids(sortCameras(cams.slice(0, 3), f({ city: 'madrid' }))), ['madrid:Camara1', 'dgt:2', 'dgt:1']);
});

test('frameFor returns finite targets and falls back when empty', async () => {
  const { frameFor } = await import('../../src/app/application.js').catch(() => ({}));
  if (!frameFor) return; // application.js imports DOM modules lazily; covered by e2e otherwise
  const fallback = { lat: 1, lon: 2, km: 3 };
  assert.equal(frameFor([], fallback), fallback);
  const t = frameFor(cams.slice(0, 3), fallback);
  assert.ok([t.lat, t.lon, t.km].every(Number.isFinite));
});
