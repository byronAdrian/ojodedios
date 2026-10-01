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
const DGT = 'https://infocar.dgt.es/datex2/dgt/CCTVSiteTablePublication/all/content.xml'; // legacy fallback
const DGT_V36 = 'https://nap.dgt.es/datex2/v3/dgt/DevicePublication/camaras_datex2_v36.xml';

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
  const res = await frame(req('/api/frame?id=dgt:i31'));
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
  assert.equal((await frame(req('/api/frame?id=dgt:i1'))).status, 502);
  assert.equal((await frame(req('/api/frame?id=dgt:i2'))).status, 502);
  assert.ok(!fetchImpl.calls.includes('http://127.0.0.1/admin'));
});

test('frame proxy follows an allowlisted http→https redirect', async () => {
  const fetchImpl = fakeFetch({
    'http://infocar.dgt.es/etraffic/data/camaras/3.jpg': new Response(null, { status: 301, headers: { location: 'https://infocar.dgt.es/etraffic/data/camaras/3.jpg' } }),
    'https://infocar.dgt.es/etraffic/data/camaras/3.jpg': new Response(JPEG),
  });
  const { frame } = createHandlers({ env: {}, fetchImpl });
  assert.equal((await frame(req('/api/frame?id=dgt:i3'))).status, 200);
});

test('frame proxy rate-limits per client', async () => {
  const fetchImpl = fakeFetch({ 'http://infocar.dgt.es/etraffic/data/camaras/4.jpg': new Response(JPEG) });
  const { frame } = createHandlers({ env: { FRAME_RATE_LIMIT_PER_MIN: '2' }, fetchImpl });
  const headers = { 'x-forwarded-for': '203.0.113.9' };
  await frame(req('/api/frame?id=dgt:i4', { headers }));
  await frame(req('/api/frame?id=dgt:i4', { headers }));
  assert.equal((await frame(req('/api/frame?id=dgt:i4', { headers }))).status, 429);
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
  assert.deepEqual(body.sources.map((s) => s.id), ['dgt', 'madrid', 'euskadi', 'livestream', 'tfl', 'fintraffic']);
  assert.equal(fetchImpl.calls.length, 0);
});

test('sniffImageType', () => {
  assert.equal(sniffImageType(JPEG), 'image/jpeg');
  assert.equal(sniffImageType(new TextEncoder().encode('<html>')), null);
});

test('a catalog that parses but yields no valid camera is reported, not served as empty', async () => {
  const xml = '<cctvCameraMetadataRecord><urlLinkAddress>https://x/1.png</urlLinkAddress></cctvCameraMetadataRecord>';
  const { cameras } = createHandlers({ env: {}, fetchImpl: fakeFetch({ [DGT]: new Response(xml) }) });
  const res = await cameras(req('/api/cameras?source=dgt'));
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.error, 'catalog_unusable');
  assert.match(body.message, /sin imagen reconocible/);
});

test('madrid frame ids are decoded and re-validated server-side', async () => {
  const id = Buffer.from('informo.madrid.es/cameras/Camara06303.jpg').toString('base64url');
  const fetchImpl = fakeFetch({ 'http://informo.madrid.es/cameras/Camara06303.jpg': new Response(JPEG) });
  const { frame } = createHandlers({ env: {}, fetchImpl });
  assert.equal((await frame(req(`/api/frame?id=madrid:${id}`))).status, 200);
  const evil = Buffer.from('169.254.169.254/latest.jpg').toString('base64url');
  assert.equal((await frame(req(`/api/frame?id=madrid:${evil}`))).status, 404);
});

test('DGT tries the v3.6 NAP feed first and falls back to the legacy URL only on 404', async () => {
  const both = fakeFetch({ [DGT_V36]: new Response(fixture('dgt-cctv-sample.xml')), [DGT]: new Response('never') });
  await createHandlers({ env: {}, fetchImpl: both }).cameras(req('/api/cameras?source=dgt'));
  assert.deepEqual(both.calls, [DGT_V36]);
  const fallback = fakeFetch({ [DGT]: new Response(fixture('dgt-cctv-sample.xml')) });
  const res = await createHandlers({ env: {}, fetchImpl: fallback }).cameras(req('/api/cameras?source=dgt'));
  assert.equal(res.status, 200);
  assert.deepEqual(fallback.calls, [DGT_V36, DGT]);
  const down = fakeFetch({ [DGT_V36]: new Response('x', { status: 503 }) });
  assert.equal((await createHandlers({ env: {}, fetchImpl: down }).cameras(req('/api/cameras?source=dgt'))).status, 502);
  assert.deepEqual(down.calls, [DGT_V36], 'a 5xx does not silently switch to another feed');
});

test('frame proxy serves v3.6 DGT ids from etraffic.dgt.es over https', async () => {
  const fetchImpl = fakeFetch({ 'https://etraffic.dgt.es/camarasEtraffic/176130.jpg': new Response(JPEG) });
  const { frame } = createHandlers({ env: {}, fetchImpl });
  assert.equal((await frame(req('/api/frame?id=dgt:176130'))).status, 200);
});

test('frame errors explain the upstream reason for diagnosis', async () => {
  const fetchImpl = fakeFetch({ 'https://etraffic.dgt.es/camarasEtraffic/9.jpg': new Response('no', { status: 403 }) });
  const res = await createHandlers({ env: {}, fetchImpl }).frame(req('/api/frame?id=dgt:9'));
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { error: 'frame_unavailable', message: 'Upstream HTTP 403' });
});

test('flights: quantised upstream call, per-key cache, stale on failure, 400 on junk', async () => {
  const url = 'https://api.adsb.lol/v2/lat/40.5/lon/-3.5/dist/100';
  let t = 0;
  let fail = false;
  let hits = 0;
  const fetchImpl = fakeFetch({ [url]: () => { hits += 1; return fail ? new Response('x', { status: 429 }) : new Response(fixture('adsblol-sample.json')); } });
  const { flights } = createHandlers({ env: {}, fetchImpl, now: () => new Date(t) });
  const first = await (await flights(req('/api/flights?lat=40.37&lon=-3.71&dist=80'))).json();
  assert.equal(first.aircraft.length, 2);
  await flights(req('/api/flights?lat=40.4&lon=-3.6&dist=60'));
  assert.equal(hits, 1, 'same quantised key served from cache');
  fail = true;
  t = 11_000;
  const stale = await (await flights(req('/api/flights?lat=40.4&lon=-3.6&dist=60'))).json();
  assert.equal(stale.stale, true);
  assert.equal((await flights(req('/api/flights?lat=abc&lon=1&dist=1'))).status, 400);
  // After adsb.lol's 429 the other networks are tried (404 in this fake), then stale is served.
  assert.deepEqual([...new Set(fetchImpl.calls)], [url, 'https://api.airplanes.live/v2/point/40.5/-3.5/100', 'https://opendata.adsb.fi/api/v2/lat/40.5/lon/-3.5/dist/100']);
});

test('flights fall back to the next ADS-B network on 429 and report which one served', async () => {
  const lol = 'https://api.adsb.lol/v2/lat/40.5/lon/-3.5/dist/100';
  const live = 'https://api.airplanes.live/v2/point/40.5/-3.5/100';
  const fi = 'https://opendata.adsb.fi/api/v2/lat/40.5/lon/-3.5/dist/100';
  const sample = JSON.parse(fixture('adsblol-sample.json'));
  const fetchImpl = fakeFetch({
    [lol]: () => new Response('slow down', { status: 429 }),
    [live]: () => new Response(JSON.stringify({ aircraft: sample.ac })),
  });
  let t = 0;
  const { flights } = createHandlers({ env: {}, fetchImpl, now: () => new Date(t) });
  const body = await (await flights(req('/api/flights?lat=40.4&lon=-3.6&dist=80'))).json();
  assert.equal(body.source, 'airplanes.live');
  assert.equal(body.aircraft.length, 2);
  t = 20_000; // cache expired; adsb.lol still cooling down → not retried
  await flights(req('/api/flights?lat=40.4&lon=-3.6&dist=80'));
  assert.deepEqual(fetchImpl.calls, [lol, live, live]);
  assert.ok(!fetchImpl.calls.includes(fi));
});

test('flights: when every network fails the error lists each reason', async () => {
  const { flights } = createHandlers({ env: {}, fetchImpl: fakeFetch({}) });
  const res = await flights(req('/api/flights?lat=40&lon=-3&dist=50'));
  assert.equal(res.status, 502);
  assert.match((await res.json()).message, /adsb\.lol: Upstream HTTP 404 · airplanes\.live: .* · adsb\.fi: /);
});

test('flight trace: falls through networks without a track (404) and validates the hex', async () => {
  const lol = 'https://globe.adsb.lol/data/traces/d8/trace_full_400cd8.json';
  const live = 'https://globe.airplanes.live/data/traces/d8/trace_full_400cd8.json';
  const fetchImpl = fakeFetch({ [live]: () => new Response(JSON.stringify({ timestamp: 1, trace: [[0, 40, -3, 1000], [10, 40.1, -3.1, 2000]] })) });
  const { flightTrace } = createHandlers({ env: {}, fetchImpl });
  const body = await (await flightTrace(req('/api/flight-trace?hex=400CD8'))).json();
  assert.equal(body.source, 'airplanes.live');
  assert.equal(body.points.length, 2);
  assert.deepEqual(fetchImpl.calls, [lol, live]);
  assert.equal((await flightTrace(req('/api/flight-trace?hex=../../x'))).status, 400);
});

test('world flights: one shared OpenSky snapshot, OAuth when configured, cached by TTL', async () => {
  const token = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
  const states = 'https://opensky-network.org/api/states/all';
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push([url, init.method, init.headers.Authorization ?? null]);
    if (url === token) return new Response(JSON.stringify({ access_token: 'T', expires_in: 1800 }));
    if (url === states) return new Response(JSON.stringify({ time: 10, states: [['400cd8', 'EZY', 'UK', 9, 10, -0.5, 40, 1000, false, 200, 90]] }), { headers: { 'x-rate-limit-remaining': '3900' } });
    return new Response('no', { status: 404 });
  };
  let t = 0;
  const { flights } = createHandlers({ env: { OPENSKY_CLIENT_ID: 'id', OPENSKY_CLIENT_SECRET: 's' }, fetchImpl, now: () => new Date(t) });
  const res = await flights(req('/api/flights?scope=world'));
  const body = await res.json();
  assert.equal(body.source, 'opensky');
  assert.equal(body.authenticated, true);
  assert.equal(body.refreshSeconds, 90);
  assert.deepEqual(body.aircraft, [['400cd8', 'EZY', 40, -0.5, 1000, false, 720, 90]]);
  assert.match(res.headers.get('cache-control'), /s-maxage=90/);
  t = 60_000;
  await flights(req('/api/flights?scope=world'));
  assert.deepEqual(seen.map(([u, m, a]) => [u, m, a]), [[token, 'POST', null], [states, 'GET', 'Bearer T']]);
});

test('world flights: anonymous failure reports OpenSky and backs off', async () => {
  const { flights } = createHandlers({ env: {}, fetchImpl: fakeFetch({}) });
  const res = await flights(req('/api/flights?scope=world'));
  assert.equal(res.status, 502);
  assert.match((await res.json()).message, /^OpenSky: Upstream HTTP 404/);
  assert.equal((await flights(req('/api/flights?scope=world'))).status, 503);
});

test('euskadi: paginated catalog through /api/cameras, with diagnostics notes', async () => {
  const page1 = { ...JSON.parse(fixture('euskadi-cameras-sample.json')), totalPages: 2 };
  const page2 = {
    totalPages: 2,
    currentPage: 2,
    cameras: [{ cameraId: '900', sourceId: '5', cameraName: 'Plaza Moyúa', latitude: '43.2630', longitude: '-2.9350', urlImage: 'http://cams.example.org/x.jpg' }],
  };
  const API = 'https://api.euskadi.eus/traffic/v1.0/cameras?_page=';
  const fetchImpl = fakeFetch({ [`${API}1`]: new Response(JSON.stringify(page1)), [`${API}2`]: new Response(JSON.stringify(page2)) });
  const res = await createHandlers({ env: {}, fetchImpl }).cameras(req('/api/cameras?source=euskadi'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.cameras.length, 7);
  assert.ok(body.cameras.every((c) => c.providerId === 'euskadi' && c.communityCode === 'ES-PV'));
  assert.deepEqual(body.notes.rejectedImageHosts, { 'cams.example.org': 1 });
  assert.deepEqual(fetchImpl.calls.sort(), [`${API}1`, `${API}2`]);
});

test('euskadi frames: only the decoded official host is contacted, others are 404', async () => {
  const id = Buffer.from('www.bizkaimove.com/camaras/cam1.jpg').toString('base64url');
  const fetchImpl = fakeFetch({ 'http://www.bizkaimove.com/camaras/cam1.jpg': new Response(JPEG) });
  const { frame } = createHandlers({ env: {}, fetchImpl });
  assert.equal((await frame(req(`/api/frame?id=euskadi:${id}`))).status, 200);
  for (const key of ['evil.com/x.jpg', '127.0.0.1/x.jpg', 'www.bizkaimove.com.evil.com/x.jpg']) {
    const evil = Buffer.from(key).toString('base64url');
    assert.equal((await frame(req(`/api/frame?id=euskadi:${evil}`))).status, 404, key);
  }
  assert.deepEqual(fetchImpl.calls, ['http://www.bizkaimove.com/camaras/cam1.jpg']);
});

test('euskadi frames: a redirect to another host is refused', async () => {
  const id = Buffer.from('www.bizkaimove.com/camaras/cam1.jpg').toString('base64url');
  const fetchImpl = fakeFetch({
    'http://www.bizkaimove.com/camaras/cam1.jpg': new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254/latest' } }),
  });
  const res = await createHandlers({ env: {}, fetchImpl }).frame(req(`/api/frame?id=euskadi:${id}`));
  assert.equal(res.status, 502);
  assert.deepEqual(fetchImpl.calls, ['http://www.bizkaimove.com/camaras/cam1.jpg']);
});
