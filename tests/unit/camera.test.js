import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCamera, isSafeMediaUrl, categoryLabel, CATEGORIES } from '../../src/domain/camera.js';

const base = { id: 'dgt:1', name: 'Test', lat: 40, lon: -3, mediaUrl: '/api/frame?id=dgt:1', mediaType: 'image' };

test('createCamera accepts a valid record and freezes it', () => {
  const cam = createCamera(base);
  assert.equal(cam.providerId, 'dgt');
  assert.equal(cam.countryCode, 'ES');
  assert.equal(cam.category, 'other');
  assert.ok(Object.isFrozen(cam));
});

test('createCamera rejects invalid ids, providers, coordinates and names', () => {
  for (const patch of [
    { id: 'x' }, { id: 'unknown:1' }, { id: 'dgt:<script>' }, { lat: 91 }, { lon: -181 },
    { lat: 0, lon: 0 }, { lat: 'abc' }, { name: '   ' },
  ]) assert.equal(createCamera({ ...base, ...patch }), null, JSON.stringify(patch));
  assert.equal(createCamera(null), null);
});

test('createCamera refuses non-https media and javascript: urls', () => {
  assert.equal(createCamera({ ...base, mediaUrl: 'http://x/y.jpg' }), null);
  assert.equal(createCamera({ ...base, mediaUrl: 'javascript:alert(1)' }), null);
  assert.equal(isSafeMediaUrl('https://a.b/c.jpg'), true);
  assert.equal(isSafeMediaUrl(null), true);
});

test('createCamera without media coerces mediaType to none', () => {
  const cam = createCamera({ ...base, mediaUrl: null });
  assert.equal(cam.mediaType, 'none');
});

test('all 10 requested categories have Spanish labels', () => {
  assert.equal(CATEGORIES.length, 10);
  assert.equal(categoryLabel('port'), 'Puertos');
  assert.equal(categoryLabel('zzz'), 'Otras');
});
