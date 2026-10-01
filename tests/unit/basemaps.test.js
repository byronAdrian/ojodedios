import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBasemaps, DEFAULT_BASEMAPS } from '../../src/map/basemaps.js';

test('defaults to keyless Esri canvas basemaps for both themes', () => {
  const b = resolveBasemaps({});
  assert.equal(b, DEFAULT_BASEMAPS);
  assert.match(b.light, /World_Light_Gray_Base/);
  assert.match(b.dark, /World_Dark_Gray_Base/);
  assert.ok(!/cartocdn/.test(b.light + b.dark), 'CARTO now requires an API key');
});

test('env override accepts only https {z}/{x}/{y} templates', () => {
  const custom = resolveBasemaps({ VITE_BASEMAP_LIGHT_URL: 'https://t.example/{z}/{x}/{y}.png', VITE_BASEMAP_ATTRIBUTION: '© X' });
  assert.equal(custom.light, 'https://t.example/{z}/{x}/{y}.png');
  assert.equal(custom.dark, custom.light);
  assert.equal(custom.attribution, '© X');
  assert.equal(resolveBasemaps({ VITE_BASEMAP_LIGHT_URL: 'http://insecure/{z}/{x}/{y}' }), DEFAULT_BASEMAPS);
  assert.equal(resolveBasemaps({ VITE_BASEMAP_DARK_URL: 'javascript:alert(1)' }), DEFAULT_BASEMAPS);
});
