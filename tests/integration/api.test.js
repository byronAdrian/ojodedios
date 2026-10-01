import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHandlers, sniffImageType } from '../../server/api/handlers.js';
import { safeFetch, isAllowedUrl } from '../../server/http/safeFetch.js';

const fixture = (name) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);

/** Fake upstream that records every URL requested. */
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push(url);
    assert.equal(init.redirect, 'manual', 'redirects must never be auto-followed');
    const route = routes[url];
    if (!route) return new Response('nope', { status: 404 });
    if (route instanceof Error) throw route;
    return typeof route === 'function' ? route() : route.clone();
  };
  impl.calls = calls;
  return impl;
}

const req = (path, init) => new Request(`https://app.test${path}`, init);
const DGT = 'https://infocar.dgt.es/datex2/dgt/CCTVSiteTablePublication/all/content.xml';

test('GET /api/cameras?source=dgt returns normalized cameras with CDN cache headers', async () => {
  const fetchImpl = fakeFetch({ [DGT]: new Response(fixture('dgt-cctv-sample.xml')) });
  const { cameras } = createHandlers({ env: {}, fetchImpl });
  const res = await cameras(req('/api/cameras?source=dgt'));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control'), /s-maxage=900/);
  const body = await res.json();
  assert.equal(body.cameras.length, 4);
  assert.equal(body.enabled, true);
});

test('catalog is cached per instance and concurrent requests are coalesced', async () => {
  let hits = 0;
  const fetchImpl = fakeFetch({ [DGT]: () => { hits += 1; return new Response(fixture('dgt-cctv-sample.xml')); } });
  const { cameras } = createHandlers({ env: {}, fetchImpl });
  await Promise.all([1, 2, 3].map(() => cameras(req('/api/cameras?source=dgt'))));
  await cameras(req('/api/cameras?source=dgt'));
  assert.equal(hits, 1);
});

test('stale catalog is served when the upstream later fails', async () => {
  let t = 0;
  let fail = false;
  const fetchImpl = fakeFetch({ [DGT]: () => (fail ? new Response('x', { status: 503 }) : new Response(fixture('dgt-cctv-sample.xml'))) });
  const { cameras } = createHandlers({ env: {}, fetchImpl, now: () => new Date(t) });
  await cameras(req('/api/cameras?source=dgt'));
  fail = true;
  t = 16 * 60 * 1000;
  const body = await (await cameras(req('/api/cameras?source=dgt'))).json();
  assert.equal(body.stale, true);
  assert.equal(body.cameras.length, 4);
});

test('upstream failure without cache → 502 with a typed error, never a crash', async () => {
  const { cameras } = createHandlers({ env: {}, fetchImpl: fakeFetch({ [DGT]: new TypeError('boom') }) });
  const res = await cameras(req('/api/cameras?source=dgt'));
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error, 'upstream_unavailable');
});

test('unknown source → 400; disabled source → empty list; POST → 405', async () => {
  const { cameras } = createHandlers({ env: { SOURCE_DGT_ENABLED: '0' }, fetchImpl: fakeFetch({}) });
  assert.equal((await cameras(req('/api/cameras?source=../../etc'))).status, 400);
  const disabled = await (await cameras(req('/api/cameras?source=dgt'))).json();
  assert.deepEqual(disabled.cameras, []);
  assert.equal((await cameras(req('/api/cameras?source=dgt', { method: 'POST' }))).status, 405);
});

test('frame proxy builds the upstream URL itself and validates image bytes', async () => {
  const fetchImpl = fakeFetch({ 'http://infocar.dgt.es/etraffic/data/camaras/31.jpg': new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } }) });
  const { frame } = createHandlers({ env: {}, fetchImpl });
  const res = await frame(req('/api/frame?id=dgt:31'));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(fetchImpl.calls, ['http://infocar.dgt.es/etraffic/data/camaras/31.jpg']);
});

test('frame proxy is not an open proxy (SSRF attempts never reach fetch)', async () => {
  const fetchImpl = fakeFetch({});
  const { frame } = createHandlers({ env: {}, fetchImpl });
  for (const id of ['https://169.254.169.254/latest', 'dgt:../../x', 'dgt:1@evil.com', 'tfl:00001.01251', 'fintraffic:C0150201', 'madrid:../x', 'x', '']) {
    const res = await frame(req(`/api/frame?id=${encodeURIComponent(id)}`));
    assert.equal(res.status, 404, id);
  }
  assert.equal(fetchImpl.calls.length, 0);
});

test('frame proxy rejects HTML served as image and redirects off the allowlist', async () => {
  const fetchImpl = fakeFetch({
    'http://infocar.dgt.es/etraffic/data/camaras/1.jpg': new Response('<html>', { headers: { 'content-type': 'image/jpeg' } }),
    'http://infocar.dgt.es/etraffic/data/camaras/2.jpg': new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } }),
  });
  const { frame } = createHandlers({ env: {}, fetchImpl });
  assert.equal((await frame(req('/api/frame?id=dgt:1'))).status, 502);
  assert.equal((await frame(req('/api/frame?id=dgt:2'))).status, 502);
  assert.ok(!fetchImpl.calls.includes('http://127.0.0.1/admin'));
});

test('frame proxy follows an allowlisted http→https redirect', async () => {
  const fetchImpl = fakeFetch({
    'http://infocar.dgt.es/etraffic/data/camaras/3.jpg': new Response(null, { status: 301, headers: { location: 'https://infocar.dgt.es/etraffic/data/camaras/3.jpg' } }),
    'https://infocar.dgt.es/etraffic/data/camaras/3.jpg': new Response(JPEG),
  });
  const { frame } = createHandlers({ env: {}, fetchImpl });
  assert.equal((await frame(req('/api/frame?id=dgt:3'))).status, 200);
});

test('frame proxy rate-limits per client', async () => {
  const fetchImpl = fakeFetch({ 'http://infocar.dgt.es/etraffic/data/camaras/4.jpg': new Response(JPEG) });
  const { frame } = createHandlers({ env: { FRAME_RATE_LIMIT_PER_MIN: '2' }, fetchImpl });
  const headers = { 'x-forwarded-for': '203.0.113.9' };
  await frame(req('/api/frame?id=dgt:4', { headers }));
  await frame(req('/api/frame?id=dgt:4', { headers }));
  assert.equal((await frame(req('/api/frame?id=dgt:4', { headers }))).status, 429);
});

test('safeFetch enforces host allowlist and size limit', async () => {
  assert.equal(isAllowedUrl('https://infocar.dgt.es.evil.com/x', ['infocar.dgt.es']), false);
  assert.equal(isAllowedUrl('https://user@infocar.dgt.es/x', ['infocar.dgt.es']), false);
  assert.equal(isAllowedUrl('https://infocar.dgt.es:8443/x', ['infocar.dgt.es']), false);
  assert.equal(isAllowedUrl('file:///etc/passwd', ['infocar.dgt.es']), false);
  const big = fakeFetch({ 'https://infocar.dgt.es/big': new Response(new Uint8Array(2048)) });
  await assert.rejects(safeFetch('https://infocar.dgt.es/big', { allowedHosts: ['infocar.dgt.es'], maxBytes: 1024, fetchImpl: big }), /too large/);
});

test('health lists sources without touching upstreams', async () => {
  const fetchImpl = fakeFetch({});
  const body = await createHandlers({ env: {}, fetchImpl }).health(req('/api/health')).json();
  assert.deepEqual(body.sources.map((s) => s.id), ['dgt', 'madrid', 'tfl', 'fintraffic']);
  assert.equal(fetchImpl.calls.length, 0);
});

test('sniffImageType', () => {
  assert.equal(sniffImageType(JPEG), 'image/jpeg');
  assert.equal(sniffImageType(new TextEncoder().encode('<html>')), null);
});
