import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookupSpanishRegion } from '../../server/geo/regionLookup.js';
import { QUICK_ACCESS_CITIES } from '../../src/domain/spain.js';

test('every quick-access city centre resolves to its own province', () => {
  for (const city of QUICK_ACCESS_CITIES) {
    const region = lookupSpanishRegion(city.lat, city.lon);
    assert.equal(region?.provinceCode, city.provinceCode, city.name);
  }
});

test('inland points resolve community through the province', () => {
  assert.deepEqual(lookupSpanishRegion(42.0676, -4.2227), { provinceCode: 'ES-P', communityCode: 'ES-CL' });
  assert.deepEqual(lookupSpanishRegion(39.86, -4.02), { provinceCode: 'ES-TO', communityCode: 'ES-CM' });
});

test('points outside Spain or invalid return null', () => {
  assert.equal(lookupSpanishRegion(48.8566, 2.3522), null); // Paris
  assert.equal(lookupSpanishRegion(38.72, -9.14), null); // Lisbon
  assert.equal(lookupSpanishRegion(Number.NaN, 0), null);
});
