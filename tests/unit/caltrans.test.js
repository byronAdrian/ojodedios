import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseCaltransDistricts,
  loadCaltransDistricts,
  caltransImagePath,
  caltransFrameUrl,
  caltransNativeId,
  caltransDistrictUrl,
  CALTRANS_DISTRICTS,
} from '../../server/sources/caltrans.js';
import { createCamera } from '../../src/domain/camera.js';

const sample = JSON.parse(readFileSync(new URL('../fixtures/caltrans-sample.json', import.meta.url), 'utf8'));
const ctx = { checkedAt: '2026-10-01T00:00:00.000Z' };

test('district file: only in-service cameras with an official still and a Californian position', () => {
  const { rows, notes } = parseCaltransDistricts([{ district: 7, body: sample }], ctx);
  assert.equal(rows.length, 1);
  assert.deepEqual(notes, { records: 5, outOfService: 1, noImage: 2, badLocation: 1 });
  const camera = createCamera(rows[0]);
  assert.ok(camera);
  assert.equal(camera.providerId, 'caltrans');
  assert.equal(camera.countryCode, 'US');
  assert.equal(camera.city, 'Los Angeles');
  assert.equal(camera.refreshSeconds, 120);
  assert.equal(camera.status, 'active');
  assert.match(camera.mediaUrl, /^\/api\/frame\?id=caltrans:[A-Za-z0-9_-]+$/);
  assert.equal(
    caltransFrameUrl(rows[0].id.slice('caltrans:'.length)),
    'https://cwwp2.dot.ca.gov/data/d7/cctv/image/i110196avenue26offramp/i110196avenue26offramp.jpg',
  );
});

test('still URLs: official host and image path only', () => {
  assert.equal(caltransImagePath('http://cwwp2.dot.ca.gov/data/d4/cctv/image/tv101/tv101.jpg'), '/data/d4/cctv/image/tv101/tv101.jpg');
  for (const bad of [
    'Not Reported',
    'https://evil.com/data/d4/cctv/image/a/a.jpg',
    'https://cwwp2.dot.ca.gov.evil.com/data/d4/cctv/image/a/a.jpg',
    'https://cwwp2.dot.ca.gov/data/d13/cctv/image/a/a.jpg',
    'https://cwwp2.dot.ca.gov/data/d4/cctv/cctvStatusD04.json',
    'https://cwwp2.dot.ca.gov/data/d4/cctv/image/a/a.jpg?x=1',
    'https://user@cwwp2.dot.ca.gov/data/d4/cctv/image/a/a.jpg',
    'https://cwwp2.dot.ca.gov:8443/data/d4/cctv/image/a/a.jpg',
  ]) assert.equal(caltransImagePath(bad), null, bad);
});

test('frame ids are decoded and re-validated (closed proxy)', () => {
  for (const path of ['/etc/passwd', '/data/d4/cctv/image/../../x.jpg', '/data/d4/cctv/image/a/a.php', '']) {
    assert.equal(caltransFrameUrl(caltransNativeId(path)), null, path);
  }
  assert.equal(caltransFrameUrl('!!'), null);
});

test('district URLs are built from the fixed list only', () => {
  assert.equal(caltransDistrictUrl(4), 'https://cwwp2.dot.ca.gov/data/d4/cctv/cctvStatusD04.json');
  assert.equal(caltransDistrictUrl(12), 'https://cwwp2.dot.ca.gov/data/d12/cctv/cctvStatusD12.json');
  assert.equal(caltransDistrictUrl(13), null);
  assert.equal(caltransDistrictUrl('4'), null);
});

test('loader: bounded concurrency, a failing district is reported, total failure throws', async () => {
  let active = 0;
  let peak = 0;
  const { files, failed } = await loadCaltransDistricts(async (url) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 2));
    active -= 1;
    if (url.includes('/d5/')) throw new Error('HTTP 503');
    return sample;
  }, { concurrency: 3 });
  assert.equal(files.length, CALTRANS_DISTRICTS.length - 1);
  assert.deepEqual(failed, ['D5: HTTP 503']);
  assert.ok(peak <= 3);
  assert.deepEqual(files.map((f) => f.district), CALTRANS_DISTRICTS.filter((d) => d !== 5));
  await assert.rejects(loadCaltransDistricts(async () => { throw new Error('down'); }), /ningún distrito/);
});
