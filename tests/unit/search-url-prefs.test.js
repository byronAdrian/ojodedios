import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStaticIndex, buildCameraIndex, search } from '../../src/domain/search.js';
import { parseUrlState, serializeUrlState, cameraShareUrl } from '../../src/state/urlState.js';
import { createPreferences, createSafeStorage } from '../../src/state/preferences.js';
import { createStore } from '../../src/state/store.js';
import { createCamera } from '../../src/domain/camera.js';
import { defaultFilters } from '../../src/domain/filters.js';

test('search ranks geography and is accent-insensitive', () => {
  const index = [...buildStaticIndex(), ...buildCameraIndex([createCamera({ id: 'dgt:5', name: 'Malagón A-4', lat: 39, lon: -3.8 })])];
  const r = search(index, 'mala');
  assert.equal(r[0].type, 'province');
  assert.equal(r[0].id, 'ES-MA');
  assert.ok(r.some((x) => x.type === 'camera' && x.id === 'dgt:5'));
  assert.equal(search(index, 'pais vasco')[0].id, 'ES-PV');
  assert.equal(search(index, 'puertos')[0].type, 'category');
  assert.deepEqual(search(index, 'm'), []);
});

test('search caps camera results', () => {
  const many = Array.from({ length: 30 }, (_, i) => createCamera({ id: `dgt:${i + 1}`, name: `Zeta ${i}`, lat: 40, lon: -3 }));
  assert.equal(search(buildCameraIndex(many), 'zeta', { maxCameras: 6 }).length, 6);
});

test('URL state round-trips and rejects invalid values', () => {
  const filters = { ...defaultFilters(), province: 'ES-BI', community: 'ES-PV', categories: ['traffic'], text: 'puente', status: 'online' };
  const qs = serializeUrlState({ filters, cameraId: 'dgt:12', view: { lat: 43.2, lon: -2.9, km: 30 }, mode: '2d' });
  const back = parseUrlState(qs);
  assert.deepEqual(back.filters, filters);
  assert.equal(back.cameraId, 'dgt:12');
  assert.equal(back.mode, '2d');
  assert.deepEqual(back.view, { lat: 43.2, lon: -2.9, km: 30 });
  const evil = parseUrlState('?pr=XX&ca=<x>&cat=traffic,evil&st=hack&cam=javascript:alert(1)&at=999,0,1&city=atlantis');
  assert.equal(evil.filters.province, '');
  assert.equal(evil.filters.community, '');
  assert.deepEqual(evil.filters.categories, ['traffic']);
  assert.equal(evil.filters.status, 'all');
  assert.equal(evil.cameraId, null);
  assert.equal(evil.view, null);
  assert.equal(evil.filters.city, '');
  assert.equal(serializeUrlState({ filters: defaultFilters(), cameraId: null, view: null, mode: '3d' }), '');
});

test('province in URL implies its community even if ca is inconsistent', () => {
  assert.equal(parseUrlState('?pr=ES-TF&ca=ES-MD').filters.community, 'ES-CN');
});

test('camera share URL', () => {
  const c = createCamera({ id: 'tfl:1', name: 'x', lat: 51, lon: 0.1 });
  assert.equal(cameraShareUrl('https://a.app', '/', c), 'https://a.app/?cam=tfl%3A1&scope=world');
});

function memoryBackend() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) };
}

test('preferences: theme, favorites, recents with configurable limit', () => {
  const backend = memoryBackend();
  const prefs = createPreferences(createSafeStorage(() => backend));
  assert.equal(prefs.getTheme(), 'system');
  prefs.setTheme('dark');
  prefs.setTheme('neon');
  assert.equal(prefs.getTheme(), 'dark');
  assert.equal(prefs.toggleFavorite('dgt:1'), true);
  assert.equal(prefs.isFavorite('dgt:1'), true);
  assert.equal(prefs.toggleFavorite('dgt:1'), false);
  assert.equal(prefs.toggleFavorite('bad id'), false);
  prefs.setHistorySize(5);
  for (let i = 1; i <= 8; i += 1) prefs.addRecent(`dgt:${i}`);
  prefs.addRecent('dgt:6');
  assert.deepEqual(prefs.getRecents(), ['dgt:6', 'dgt:8', 'dgt:7', 'dgt:5', 'dgt:4']);
  prefs.clearRecents();
  assert.deepEqual(prefs.getRecents(), []);
});

test('preferences survive a throwing/absent localStorage and corrupt JSON', () => {
  const throwing = createSafeStorage(() => { throw new Error('SecurityError'); });
  const prefs = createPreferences(throwing);
  prefs.setTheme('light');
  assert.equal(prefs.getTheme(), 'light');
  const corrupt = createSafeStorage(() => ({ getItem: () => '{not json', setItem() { throw new Error('quota'); } }));
  assert.deepEqual(createPreferences(corrupt).getRecents(), []);
});

test('store notifies with next and previous state', () => {
  const store = createStore({ a: 1, b: 2 });
  const seen = [];
  const off = store.subscribe((n, p) => seen.push([n.a, p.a]));
  store.set({ a: 3 });
  store.set((s) => ({ a: s.a + 1 }));
  off();
  store.set({ a: 9 });
  assert.deepEqual(seen, [[3, 1], [4, 3]]);
  assert.equal(store.get().b, 2);
});

test('URL state: layer switches round-trip, defaults stay out of the URL', () => {
  const base = { filters: defaultFilters(), cameraId: null, view: null, mode: '3d' };
  assert.equal(serializeUrlState(base), '');
  const qs = serializeUrlState({ ...base, cameras: false, quakes: false, fires: true });
  assert.equal(qs, 'cams=0&eq=0&fi=1');
  const back = parseUrlState(qs);
  assert.deepEqual([back.cameras, back.quakes, back.fires], [false, false, true]);
  const defaults = parseUrlState('');
  assert.deepEqual([defaults.cameras, defaults.quakes, defaults.fires], [true, true, false]);
  // Anything but the exact switch values keeps the default.
  const junk = parseUrlState('?cams=no&eq=false&fi=yes');
  assert.deepEqual([junk.cameras, junk.quakes, junk.fires], [true, true, false]);
});
