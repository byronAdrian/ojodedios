import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMUNITIES, PROVINCES, QUICK_ACCESS_CITIES, provincesOf, communityOfProvince, getCommunity,
} from '../../src/domain/spain.js';

test('Spain has 17 comunidades + 2 ciudades autónomas and 52 provincial units', () => {
  assert.equal(COMMUNITIES.filter((c) => c.kind === 'community').length, 17);
  assert.equal(COMMUNITIES.filter((c) => c.kind === 'autonomous-city').length, 2);
  assert.equal(PROVINCES.length, 52);
  assert.equal(new Set(PROVINCES.map((p) => p.code)).size, 52);
});

test('every province references an existing community', () => {
  for (const p of PROVINCES) assert.ok(getCommunity(p.communityCode), p.code);
});

test('provincesOf narrows by community and returns all without one', () => {
  assert.deepEqual(provincesOf('ES-PV').map((p) => p.code).sort(), ['ES-BI', 'ES-SS', 'ES-VI']);
  assert.equal(provincesOf('ES-AN').length, 8);
  assert.equal(provincesOf('').length, 52);
  assert.equal(provincesOf('ES-XX').length, 0);
});

test('communityOfProvince', () => {
  assert.equal(communityOfProvince('ES-TF'), 'ES-CN');
  assert.equal(communityOfProvince('ES-CE'), 'ES-CE');
  assert.equal(communityOfProvince('nope'), null);
});

test('all 14 requested quick-access cities exist and map to real provinces', () => {
  const expected = ['madrid', 'barcelona', 'valencia', 'alicante', 'sevilla', 'malaga', 'bilbao', 'zaragoza',
    'murcia', 'palma', 'las-palmas', 'santa-cruz-tenerife', 'ceuta', 'melilla'];
  assert.deepEqual(QUICK_ACCESS_CITIES.map((c) => c.id), expected);
  for (const c of QUICK_ACCESS_CITIES) assert.ok(communityOfProvince(c.provinceCode), c.id);
});
