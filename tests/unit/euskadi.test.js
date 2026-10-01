import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseEuskadiPages,
  loadEuskadiPages,
  euskadiImageKey,
  euskadiFrameUrl,
  euskadiNativeId,
  euskadiCoordinates,
  euskadiPageUrl,
} from '../../server/sources/euskadi.js';
import { utmToLatLon } from '../../server/geo/utm.js';
import { createCamera } from '../../src/domain/camera.js';

const sample = JSON.parse(readFileSync(new URL('../fixtures/euskadi-cameras-sample.json', import.meta.url), 'utf8'));
const ctx = { checkedAt: '2026-10-01T00:00:00.000Z' };

test('UTM 30N → WGS84 matches pyproj (EPSG:25830→4326) within a metre', () => {
  // Reference values computed with pyproj 3.x.
  const refs = [
    [507650.15, 4792953.64, 43.289367, -2.905699],
    [499980.63, 4800423.97, 43.356673, -3.000239],
    [582000, 4745000, 42.8531856, -1.9963583],
    [272000, 3940000, 35.577478, -5.5161282],
  ];
  for (const [e, n, lat, lon] of refs) {
    const r = utmToLatLon(e, n, 30);
    assert.ok(Math.abs(r.lat - lat) < 1e-5 && Math.abs(r.lon - lon) < 1e-5, `${e},${n} → ${r.lat},${r.lon}`);
  }
  assert.equal(utmToLatLon(NaN, 1, 30), null);
  assert.equal(utmToLatLon(500000, 4.7e6, 0), null);
  assert.equal(utmToLatLon(5, 4.7e6, 30), null);
});

test('coordinates: degrees pass through, UTM metres are converted, junk is rejected', () => {
  assert.deepEqual(euskadiCoordinates('43.26', '-2.93'), { lat: 43.26, lon: -2.93 });
  assert.deepEqual(euskadiCoordinates('43,26', '-2,93'), { lat: 43.26, lon: -2.93 });
  const utm = euskadiCoordinates('4792953.64', '507650.15');
  assert.ok(Math.abs(utm.lat - 43.289367) < 1e-5 && Math.abs(utm.lon + 2.905699) < 1e-5);
  for (const [a, b] of [['', ''], ['0', '0'], ['x', '1'], [null, undefined]]) assert.equal(euskadiCoordinates(a, b), null);
});

test('real API page: keeps only cameras with an official image, in Bizkaia, proxied by id', () => {
  const { rows, notes } = parseEuskadiPages([sample], ctx);
  const withImage = sample.cameras.filter((c) => c.urlImage).length;
  assert.equal(rows.length, withImage);
  assert.equal(notes.withoutImage, sample.cameras.length - withImage);
  assert.deepEqual(notes.rejectedImageHosts, {});
  for (const row of rows) {
    const camera = createCamera(row);
    assert.ok(camera, `rejected by the domain model: ${row.id}`);
    assert.equal(camera.providerId, 'euskadi');
    assert.equal(camera.provinceCode, 'ES-BI');
    assert.equal(camera.communityCode, 'ES-PV');
    assert.match(camera.mediaUrl, /^\/api\/frame\?id=euskadi:[A-Za-z0-9_-]+$/);
    assert.equal(camera.city, null);
  }
  const first = rows.find((r) => r.name.includes('Kukularra'));
  assert.equal(euskadiFrameUrl(first.id.slice('euskadi:'.length)), 'http://www.bizkaimove.com/camaras/cam1.jpg');
});

test('image URLs must be on official Basque administration domains', () => {
  assert.equal(euskadiImageKey('http://www.bizkaimove.com/camaras/cam1.jpg'), 'www.bizkaimove.com/camaras/cam1.jpg');
  assert.equal(euskadiImageKey('https://camaras.bilbao.eus/img/c1.JPG'), 'camaras.bilbao.eus/img/c1.JPG');
  assert.equal(euskadiImageKey('http://www.trafikoa.net/camaras/1.jpg'), 'www.trafikoa.net/camaras/1.jpg');
  assert.equal(euskadiImageKey('http://www.trafikoa.net.evil.com/1.jpg'), null);
  for (const bad of [
    'http://evil.com/cam.jpg',
    'http://bizkaimove.com.evil.com/cam.jpg',
    'http://evilbizkaimove.com/cam.jpg',
    'http://www.bizkaimove.com:8080/cam.jpg',
    'http://user@www.bizkaimove.com/cam.jpg',
    'http://www.bizkaimove.com/cam.jpg?x=1',
    'http://www.bizkaimove.com/cam.php',
    'ftp://www.bizkaimove.com/cam.jpg',
    'http://169.254.169.254/latest.jpg',
    'not a url',
  ]) {
    assert.equal(euskadiImageKey(bad), null, bad);
  }
});

test('frame ids are re-validated when decoded (closed proxy)', () => {
  const ok = euskadiNativeId('www.bizkaimove.com/camaras/cam3.jpg');
  assert.equal(euskadiFrameUrl(ok), 'http://www.bizkaimove.com/camaras/cam3.jpg');
  for (const key of ['evil.com/x.jpg', '169.254.169.254/latest.jpg', 'www.bizkaimove.com/../x.jpg', 'www.bizkaimove.com', 'a@bizkaimove.com/x.jpg']) {
    assert.equal(euskadiFrameUrl(euskadiNativeId(key)), null, key);
  }
  assert.equal(euskadiFrameUrl('../../x'), null);
  assert.equal(euskadiFrameUrl(''), null);
});

test('unknown image hosts are reported, and an unusable catalog fails loudly', () => {
  const page = {
    cameras: [
      { cameraId: '1', cameraName: 'A', latitude: '43.3', longitude: '-2.9', urlImage: 'http://cams.example.org/1.jpg' },
      { cameraId: '2', cameraName: 'B', latitude: '0', longitude: '0', urlImage: 'http://www.bizkaimove.com/2.jpg' },
    ],
  };
  assert.throws(() => parseEuskadiPages([page], ctx), /ninguna cámara utilizable.*cams\.example\.org/);
  assert.throws(() => parseEuskadiPages([{ cameras: [] }], ctx), /sin cámaras/);
  const mixed = parseEuskadiPages([{ cameras: [...page.cameras, sample.cameras.find((c) => c.urlImage)] }], ctx);
  assert.equal(mixed.rows.length, 1);
  assert.deepEqual(mixed.notes.rejectedImageHosts, { 'cams.example.org': 1 });
  assert.deepEqual(mixed.notes.rejectedImageSamples, { 'cams.example.org': 'http://cams.example.org/1.jpg' });
  assert.equal(mixed.notes.badLocation, 1);
});

test('loadEuskadiPages fetches every page with bounded concurrency and in order', async () => {
  let active = 0;
  let peak = 0;
  const requested = [];
  const getJson = async (url) => {
    requested.push(url);
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 2));
    active -= 1;
    const page = Number(new URL(url).searchParams.get('_page'));
    return { totalPages: 9, currentPage: page, cameras: [{ cameraId: String(page) }] };
  };
  const pages = await loadEuskadiPages(getJson, { concurrency: 3 });
  assert.equal(pages.length, 9);
  assert.deepEqual(pages.map((p) => p.currentPage), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.ok(peak <= 3, `peak concurrency ${peak}`);
  assert.equal(requested[0], euskadiPageUrl(1));
});

test('loadEuskadiPages caps the page count and propagates a failed page', async () => {
  const pages = await loadEuskadiPages(async () => ({ totalPages: 10_000, cameras: [] }), { maxPages: 4 });
  assert.equal(pages.length, 4);
  await assert.rejects(
    loadEuskadiPages(async (url) => {
      if (url.endsWith('_page=3')) throw new Error('boom');
      return { totalPages: 5, cameras: [] };
    }),
    /boom/,
  );
});
