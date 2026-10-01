import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import rows from '../../src/data/spainPlaces.data.js';
import { registerPlaces, loadPlaces, getPlace, getCityTarget, isPlaceId, resetPlaces, placesReady } from '../../src/domain/places.js';
import { buildStaticIndex, buildPlaceIndex, buildCameraIndex, search } from '../../src/domain/search.js';
import { applyFilters, sortCameras, defaultFilters, nearestCamera } from '../../src/domain/filters.js';
import { parseUrlState, serializeUrlState } from '../../src/state/urlState.js';
import { createCamera } from '../../src/domain/camera.js';
import { getProvince } from '../../src/domain/spain.js';

beforeEach(() => resetPlaces());

const ASPE = [2521510, 'Aspe', 'ES-A', 38.345, -0.767];
const cam = (id, lat, lon, extra = {}) =>
  createCamera({ id, name: id, lat, lon, countryCode: 'ES', communityCode: 'ES-VC', provinceCode: 'ES-A', ...extra });

test('bundled gazetteer is well-formed and includes small towns like Aspe', () => {
  assert.ok(rows.length > 5000, `only ${rows.length} places`);
  const ids = new Set();
  for (const [id, name, province, lat, lon] of rows) {
    assert.ok(Number.isSafeInteger(id) && !ids.has(id), `bad or duplicate id ${id}`);
    ids.add(id);
    assert.ok(typeof name === 'string' && name.length > 0);
    assert.ok(getProvince(province), `unknown province ${province} for ${name}`);
    // Spain incl. Canarias, Ceuta and Melilla.
    assert.ok(lat > 27 && lat < 44.5 && lon > -18.5 && lon < 4.5, `${name} out of Spain`);
  }
  const aspe = rows.find((r) => r[1] === 'Aspe');
  assert.deepEqual(aspe.slice(0, 3), [2521510, 'Aspe', 'ES-A']);
  assert.ok(Math.abs(aspe[3] - 38.345) < 0.01 && Math.abs(aspe[4] + 0.767) < 0.01);
});

test('registerPlaces skips malformed rows and exposes g-prefixed ids', () => {
  const list = registerPlaces([ASPE, ['x', 'Bad', 'ES-A', 1, 1], [1, '', 'ES-A', 1, 1], [2, 'NaN', 'ES-A', NaN, 0], 'junk']);
  assert.equal(list.length, 1);
  assert.equal(getPlace('g2521510').name, 'Aspe');
  assert.equal(getPlace('g1'), null);
  assert.ok(placesReady());
});

test('isPlaceId validates shape only', () => {
  assert.ok(isPlaceId('g2521510'));
  for (const bad of ['', 'madrid', 'g', 'g12345678901', 'G1', 'g1;x', null, 42]) assert.equal(isPlaceId(bad), false, String(bad));
});

test('getCityTarget resolves quick cities and places', () => {
  registerPlaces([ASPE]);
  assert.equal(getCityTarget('alicante').name, 'Alicante');
  assert.equal(getCityTarget('g2521510').name, 'Aspe');
  assert.equal(getCityTarget('g999'), null);
  assert.equal(getCityTarget(''), null);
});

test('loadPlaces loads once, shares the promise and retries after a failure', async () => {
  let calls = 0;
  const failing = () => {
    calls += 1;
    return Promise.reject(new Error('chunk failed'));
  };
  await assert.rejects(loadPlaces(failing));
  await assert.rejects(loadPlaces(failing));
  assert.equal(calls, 2, 'a failed load must not be cached');

  const ok = () => {
    calls += 1;
    return Promise.resolve({ default: [ASPE] });
  };
  const [a, b] = await Promise.all([loadPlaces(ok), loadPlaces(ok)]);
  assert.equal(a, b);
  assert.equal(calls, 3);
  assert.equal(getPlace('g2521510').name, 'Aspe');
});

test('search finds a town by name, accent-insensitive, ranked after provinces', () => {
  const places = registerPlaces(rows);
  const index = [...buildStaticIndex(), ...buildPlaceIndex(places)];
  const [first] = search(index, 'aspe');
  assert.equal(first.type, 'place');
  assert.equal(first.id, 'g2521510');
  assert.equal(first.detail, 'Alicante/Alacant');
  // Province beats a homonymous town on equal match quality.
  assert.equal(search(index, 'cuenca')[0].type, 'province');
  // Accent-insensitive.
  assert.ok(search(index, 'aviles').some((e) => e.type === 'place' && e.label === 'Avilés'));
});

test('quick-access cities are not duplicated as places, and places are capped', () => {
  const places = registerPlaces(rows);
  const index = [...buildStaticIndex(), ...buildPlaceIndex(places)];
  const alicante = search(index, 'alicante').filter((e) => e.label === 'Alicante');
  assert.deepEqual(alicante.map((e) => e.type), ['city']);
  const san = search(index, 'san', { limit: 50, maxPlaces: 6 });
  assert.equal(san.filter((e) => e.type === 'place').length, 6);
});

test('bigger towns rank first among equally good place matches', () => {
  const places = registerPlaces([[1, 'Villa Chica', 'ES-A', 38, -0.5], [2, 'Villa Grande', 'ES-A', 38.1, -0.5]]);
  // Gazetteer order is population order: row 1 is the bigger one.
  const hits = search(buildPlaceIndex(places), 'villa');
  assert.deepEqual(hits.map((e) => e.label), ['Villa Chica', 'Villa Grande']);
});

test('a place acts as a 25 km proximity filter and sorts by distance', () => {
  registerPlaces([ASPE]);
  const near = cam('dgt:near', 38.39, -0.73); // ~6 km
  const mid = cam('dgt:mid', 38.26, -0.70); // ~11 km
  const far = cam('dgt:far', 38.35, -0.45); // ~28 km (Alicante)
  const filters = { ...defaultFilters(), city: 'g2521510' };
  const result = sortCameras(applyFilters([far, mid, near], filters), filters);
  assert.deepEqual(result.map((c) => c.id), ['dgt:near', 'dgt:mid']);
});

test('nearestCamera finds the closest camera or null', () => {
  const a = cam('dgt:a', 38.39, -0.73);
  const b = cam('dgt:b', 40, -3.7);
  const best = nearestCamera([b, a], 38.345, -0.767);
  assert.equal(best.camera.id, 'dgt:a');
  assert.ok(best.km > 3 && best.km < 8);
  assert.equal(nearestCamera([], 0, 0), null);
});

test('URL keeps a place id, and drops malformed ones', () => {
  const filters = { ...defaultFilters(), city: 'g2521510' };
  assert.equal(parseUrlState(serializeUrlState({ filters, cameraId: null, view: null, mode: '3d' })).filters.city, 'g2521510');
  assert.equal(parseUrlState('?city=g12;alert(1)').filters.city, '');
  assert.equal(parseUrlState('?city=atlantis').filters.city, '');
});

test('camera index is unaffected by places', () => {
  const index = buildCameraIndex([createCamera({ id: 'dgt:9', name: 'A-31 Monforte', lat: 38.38, lon: -0.73 })]);
  assert.equal(search(index, 'monforte')[0].id, 'dgt:9');
});
