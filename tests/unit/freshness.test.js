import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refreshMs, isDue, ageLabel, mosaicPageSize } from '../../src/domain/freshness.js';

test('refresh follows provider cadence but never faster than 60 s', () => {
  assert.equal(refreshMs({ refreshSeconds: 600 }), 600_000);
  assert.equal(refreshMs({ refreshSeconds: 10 }), 60_000);
  assert.equal(refreshMs({ refreshSeconds: 0 }), 120_000);
  assert.equal(isDue({ refreshSeconds: 600 }, 1000, 1000 + 599_000), false);
  assert.equal(isDue({ refreshSeconds: 600 }, 1000, 1000 + 600_000), true);
  assert.equal(isDue({}, null), true);
});

test('age labels', () => {
  const t = 10_000_000;
  assert.equal(ageLabel(t - 10_000, t), 'ahora mismo');
  assert.equal(ageLabel(t - 3 * 60_000, t), 'hace 3 min');
  assert.equal(ageLabel(t - 2 * 3_600_000, t), 'hace 2 h');
  assert.equal(ageLabel(null, t), '—');
});

test('mosaic page size by viewport', () => {
  assert.deepEqual([320, 700, 1000, 1600].map(mosaicPageSize), [4, 6, 9, 12]);
});
