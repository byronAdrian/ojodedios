import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFlightService, radiusForSpan, MAX_VIEW_KM, inBounds, tilesFor, MAX_TILES } from '../../src/flights/flightService.js';

const plane = (hex, lon, lat) => ({ hex, lon, lat, altitudeM: 10000, onGround: false, callsign: 'X', track: 90, seenS: 1 });

function harness({ view = { lat: 40, lon: -3, km: 300 }, responses = [] } = {}) {
  const updates = [];
  const calls = [];
  let timers = [];
  const queue = [...responses];
  const svc = createFlightService({
    getView: () => view,
    onUpdate: (s) => updates.push(s),
    fetchImpl: async (url) => {
      calls.push(url);
      const next = queue.shift() ?? { ok: true, body: { aircraft: [] } };
      return { ok: next.ok, status: next.ok ? 200 : 502, json: async () => next.body };
    },
    setTimer: (fn) => (timers.push(fn), timers.length),
    clearTimer: () => {},
  });
  const tick = async () => {
    const pending = timers;
    timers = [];
    for (const fn of pending) await fn();
  };
  return { svc, updates, calls, tick, setView: (v) => (view = v) };
}

const settle = () => new Promise((r) => setImmediate(r));

test('radius follows the view span and is capped by the API (250 nm)', () => {
  assert.equal(radiusForSpan(100), 27);
  assert.equal(radiusForSpan(10), 25);
  assert.equal(radiusForSpan(1500), 250);
});

test('polls the view, builds per-aircraft trails, and keeps polling', async () => {
  const h = harness({ responses: [
    { ok: true, body: { aircraft: [plane('aaaaaa', -3, 40)] } },
    { ok: true, body: { aircraft: [plane('aaaaaa', -2.9, 40.1)] } },
  ] });
  h.svc.start();
  await settle();
  assert.match(h.calls[0], /^\/api\/flights\?lat=40\.000&lon=-3\.000&dist=81$/);
  await h.tick();
  await settle();
  assert.deepEqual(h.svc.trail('aaaaaa'), [[-3, 40, 10000], [-2.9, 40.1, 10000]]);
  assert.equal(h.updates.at(-1).status, 'ready');
  assert.equal(h.svc.find('aaaaaa').lon, -2.9);
});

test('wide views use the shared world snapshot, filtered to the view', async () => {
  const updates = [];
  const calls = [];
  const svc = createFlightService({
    getView: () => ({ lat: 40, lon: 0, km: MAX_VIEW_KM + 1 }),
    getBounds: () => [-10, 35, 5, 45],
    onUpdate: (s) => updates.push(s),
    fetchImpl: async (url) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => ({ refreshSeconds: 90, attribution: 'OpenSky', aircraft: [['aaaaaa', 'IN', 40, -3, 1000, false, 800, 90], ['bbbbbb', 'OUT', 10, 100, 1000, false, 800, 90]] }) };
    },
    setTimer: () => 1,
    clearTimer: () => {},
  });
  svc.start();
  await settle();
  assert.deepEqual(calls, ['/api/flights?scope=world']);
  const last = updates.at(-1);
  assert.equal(last.scope, 'world');
  assert.deepEqual(last.aircraft.map((a) => a.hex), ['aaaaaa']);
  assert.equal(last.total, 2);
});

test('inBounds handles the antimeridian and caps by even sampling', () => {
  const list = Array.from({ length: 10 }, (_, i) => ({ hex: String(i), lat: 0, lon: 170 + i * 2 > 180 ? 170 + i * 2 - 360 : 170 + i * 2 }));
  assert.equal(inBounds(list, [175, -1, -175, 1]).length, 5);
  assert.equal(inBounds(list, null, 4).length, 4);
});

test('errors keep the last aircraft and are reported; stop clears state', async () => {
  const h = harness({ responses: [{ ok: true, body: { aircraft: [plane('bbbbbb', 0, 40)] } }, { ok: false, body: { message: 'Upstream HTTP 429' } }] });
  h.svc.start();
  await settle();
  await h.tick();
  await settle();
  const last = h.updates.at(-1);
  assert.equal(last.status, 'error');
  assert.equal(last.message, 'Upstream HTTP 429');
  assert.equal(last.aircraft.length, 1);
  h.svc.stop();
  assert.equal(h.updates.at(-1).status, 'idle');
  assert.equal(h.svc.running, false);
});

test('a disabled feed stops polling', async () => {
  const h = harness({ responses: [{ ok: true, body: { enabled: false, aircraft: [] } }] });
  h.svc.start();
  await settle();
  assert.equal(h.updates.at(-1).status, 'disabled');
  await h.tick();
  assert.equal(h.calls.length, 1);
});

test('tilesFor: fixed grid, nearest-first, capped, antimeridian-safe', () => {
  const europe = tilesFor([-12, 34, 30, 60], { lat: 46, lon: 8 });
  assert.equal(europe.length, MAX_TILES);
  assert.deepEqual(europe[0], { lat: 48, lon: 9 }); // at 48° the lon step is 6/cos(48°) ≈ 9°
  for (const t of europe) {
    assert.equal(t.lat % 6, 0);
    assert.equal((t.lon * 2) % 1, 0, 'lon on the 0.5° grid the server quantises to');
  }
  const pacific = tilesFor([170, -6, -170, 6], { lat: 0, lon: 180 }, 50);
  assert.ok(pacific.every((t) => t.lon >= 168 || t.lon <= -168), JSON.stringify(pacific));
});

test('world snapshot failure falls back to regional tiles, merged by hex', async () => {
  const updates = [];
  const calls = [];
  const svc = createFlightService({
    getView: () => ({ lat: 46, lon: 8, km: MAX_VIEW_KM + 500 }),
    getBounds: () => [-2, 40, 18, 52],
    onUpdate: (s) => updates.push(s),
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.includes('scope=world')) return { ok: false, status: 502, json: async () => ({ message: 'OpenSky: Upstream unreachable' }) };
      return { ok: true, status: 200, json: async () => ({ attribution: 'airplanes.live', aircraft: [plane('aaaaaa', 8, 46), plane('bbbbbb', 9, 47)] }) };
    },
    setTimer: () => 1,
    clearTimer: () => {},
    sleep: async () => {},
  });
  svc.start();
  for (let i = 0; i < 30; i += 1) await settle();
  assert.equal(calls[0], '/api/flights?scope=world');
  assert.ok(calls.length > 2 && calls.slice(1).every((u) => /dist=250$/.test(u)), calls.join('\n'));
  const last = updates.at(-1);
  assert.equal(last.scope, 'tiles');
  assert.deepEqual(last.aircraft.map((a) => a.hex).sort(), ['aaaaaa', 'bbbbbb']);
});
