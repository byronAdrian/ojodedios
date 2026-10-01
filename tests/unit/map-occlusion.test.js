import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * Regression guard: an infinite disableDepthTestDistance makes markers on the
 * far side of the globe render *through* the Earth (they appear to slide the
 * wrong way when you rotate). Cesium's default already draws markers on top of
 * the surface and hides them behind the horizon, so no layer may override it.
 */
test('no map layer disables depth testing at every distance', () => {
  const dirs = ['src/map', 'src/flights', 'src/hazards'];
  const offenders = [];
  for (const dir of dirs) {
    for (const file of readdirSync(new URL(`../../${dir}/`, import.meta.url))) {
      if (!file.endsWith('.js')) continue;
      const source = readFileSync(new URL(`../../${dir}/${file}`, import.meta.url), 'utf8');
      if (/disableDepthTestDistance\s*[:=]\s*(Number\.POSITIVE_INFINITY|Infinity)/.test(source)) offenders.push(`${dir}/${file}`);
    }
  }
  assert.deepEqual(offenders, []);
});
