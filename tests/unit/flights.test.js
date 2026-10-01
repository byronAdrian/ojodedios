import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeAdsbLol, quantiseFlightQuery, adsbLolUrl } from '../../server/sources/flights.js';

const sample = JSON.parse(readFileSync(new URL('../fixtures/adsblol-sample.json', import.meta.url), 'utf8'));

test('adsb.lol records are normalised; stale, invalid and positionless contacts dropped', () => {
  const out = normalizeAdsbLol(sample);
  assert.deepEqual(out.map((a) => a.hex), ['400cd8', '3443c5']);
  assert.deepEqual(out[0], {
    hex: '400cd8', callsign: 'EZY45NK', registration: 'G-EZIY', type: 'A319', lat: 40.12, lon: -0.5,
    altitudeM: 10668, onGround: false, speedKmh: 788, track: 182.4, seenS: 1,
  });
  assert.equal(out[1].onGround, true);
  assert.equal(out[1].altitudeM, 0);
  assert.throws(() => normalizeAdsbLol({}), /no reconocido/);
});

test('flight queries are quantised to a small, safe URL space', () => {
  assert.deepEqual(quantiseFlightQuery('40.37', '-3.71', '80'), { lat: 40.5, lon: -3.5, dist: 100 });
  assert.deepEqual(quantiseFlightQuery('40', '-3', '9999'), { lat: 40, lon: -3, dist: 250 });
  for (const bad of [['x', '0', '50'], ['91', '0', '50'], ['0', '181', '50'], ['', '', '']]) assert.equal(quantiseFlightQuery(...bad), null, bad.join());
  assert.equal(adsbLolUrl({ lat: 40.5, lon: -3.5, dist: 100 }), 'https://api.adsb.lol/v2/lat/40.5/lon/-3.5/dist/100');
});

import { parseTrace, validHex, traceUrl } from '../../server/sources/flights.js';

test('trace: tar1090 rows become [lon, lat, altM]; ground = 0; junk rows skipped', () => {
  const out = parseTrace({ icao: '400cd8', timestamp: 1790856000, trace: [
    [0, 51.47, -0.45, 'ground', 0, null], [60, 51.5, -0.5, 3000, 250, 270], ['x'], [120, 'bad', 1, 1000], [180, 51.6, -0.6, 35000, 450, 260],
  ] });
  assert.equal(out.startedAt, new Date(1790856000 * 1000).toISOString());
  assert.deepEqual(out.points, [[-0.45, 51.47, 0], [-0.5, 51.5, 914], [-0.6, 51.6, 10668]]);
  assert.throws(() => parseTrace({ foo: 1 }), /no reconocido \(claves: foo\)/);
});

test('trace: long tracks are downsampled but keep the last (current) point', () => {
  const trace = Array.from({ length: 2000 }, (_, i) => [i, 40 + i / 1e4, -3, 30000]);
  const { points } = parseTrace({ timestamp: 1, trace });
  assert.ok(points.length <= 601);
  assert.deepEqual(points.at(-1), [-3, 40.1999, 9144]);
});

test('trace: only ICAO hex ids reach the URL', () => {
  assert.equal(validHex(' 400CD8 '), '400cd8');
  assert.equal(validHex('~3412c8'), '~3412c8');
  for (const bad of ['../etc', '400cd', '400cd8/x', '', null]) assert.equal(validHex(bad), null, String(bad));
  assert.equal(traceUrl('globe.adsb.lol', '400cd8'), 'https://globe.adsb.lol/data/traces/d8/trace_full_400cd8.json');
});

import { normalizeOpenSky, openskyTtlMs } from '../../server/sources/opensky.js';

test('OpenSky state vectors become compact tuples; stale/positionless rows dropped', () => {
  const out = normalizeOpenSky({ time: 1000, states: [
    ['400cd8', 'EZY45NK ', 'United Kingdom', 990, 999, -0.5, 40.12, 10668.2, false, 236.4, 182.4, 0, null, 10700, '1000', false, 0, 0],
    ['3443c5', 'IBE3101', 'Spain', 995, 999, -3.57, 40.49, null, true, 3.3, null, null, null, null, null, false, 0, 0],
    ['abcdef', 'OLD', 'X', 100, 999, 1, 1, 1000, false, 1, 1],
    ['123456', 'NOPOS', 'X', 990, 999, null, null, 1000, false, 1, 1],
    ['zzzzzz', 'BAD', 'X', 990, 999, 1, 1],
  ] });
  assert.deepEqual(out, [
    ['400cd8', 'EZY45NK', 40.12, -0.5, 10668, false, 851, 182],
    ['3443c5', 'IBE3101', 40.49, -3.57, 0, true, 12, null],
  ]);
  assert.throws(() => normalizeOpenSky({}), /OpenSky no reconocido/);
});

test('OpenSky cache TTL keeps a day of use inside the credit budget', () => {
  assert.equal(openskyTtlMs({ authenticated: false }), 900_000);
  assert.equal(openskyTtlMs({ authenticated: true, remaining: 3500 }), 90_000);
  assert.equal(openskyTtlMs({ authenticated: true, remaining: 1000 }), 180_000);
  assert.equal(openskyTtlMs({ authenticated: true, remaining: 100 }), 600_000);
});
