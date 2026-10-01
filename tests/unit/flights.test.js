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
