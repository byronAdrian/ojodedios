import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFlightService, radiusForSpan, MAX_VIEW_KM } from '../../src/flights/flightService.js';

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

test('too wide a view reports "zoom" instead of fetching a misleading sample', async () => {
  const h = harness({ view: { lat: 40, lon: -3, km: MAX_VIEW_KM + 1 } });
  h.svc.start();
  await settle();
  assert.equal(h.calls.length, 0);
  assert.equal(h.updates.at(-1).status, 'zoom');
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
