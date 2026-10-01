#!/usr/bin/env node
/**
 * End-to-end checks against the production build served by `vite preview`
 * (which applies vercel.json headers, including the CSP).
 *
 * Provider APIs are intercepted with catalogs produced by the real adapters
 * from tests/fixtures, so the run is deterministic and works offline. Basemap
 * tiles are stubbed. Screenshots land in test-results/.
 *
 * Env: CHROMIUM_PATH (default: Playwright's bundled path or /opt/pw-browsers/chromium).
 */
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { parseDgtCatalog } from '../../server/sources/dgt.js';
import { parseMadridKml } from '../../server/sources/madrid.js';
import { parseTflCatalog } from '../../server/sources/tfl.js';
import { parseFintrafficCatalog } from '../../server/sources/fintraffic.js';
import { createCamera } from '../../src/domain/camera.js';
import { normalizeAdsbLol } from '../../server/sources/flights.js';

const root = new URL('../../', import.meta.url);
const fixture = (n) => readFileSync(new URL(`tests/fixtures/${n}`, root), 'utf8');
const ctx = { checkedAt: new Date().toISOString() };
const catalogs = {
  dgt: parseDgtCatalog(fixture('dgt-cctv-sample.xml'), ctx).map(createCamera),
  madrid: parseMadridKml(fixture('madrid-cameras-sample.kml'), ctx).map(createCamera),
  tfl: parseTflCatalog(JSON.parse(fixture('tfl-sample.json')), ctx).map(createCamera),
  fintraffic: parseFintrafficCatalog(JSON.parse(fixture('fintraffic-sample.json')), ctx).map(createCamera),
};
const aircraft = normalizeAdsbLol(JSON.parse(fixture('adsblol-sample.json')));
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const base = '/opt/pw-browsers';
  if (existsSync(base)) {
    const dir = readdirSync(base).find((d) => /^chromium-\d+$/.test(d));
    if (dir) return `${base}/${dir}/chrome-linux/chrome`;
  }
  return undefined; // let playwright-core resolve its own install
}

async function startPreview(port) {
  const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--strictPort'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('preview did not start')), 20_000);
    child.stdout.on('data', (d) => d.toString().includes(String(port)) && (clearTimeout(timer), resolve()));
    child.on('exit', (code) => reject(new Error(`preview exited ${code}`)));
  });
  return child;
}

const results = [];
async function step(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name} (${Date.now() - started} ms)`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log(`  ✗ ${name}\n    ${String(error?.message || error).split('\n').join('\n    ')}`);
  }
}

async function main() {
  if (!existsSync(new URL('dist/index.html', root))) throw new Error('Run `npm run build` first.');
  mkdirSync(new URL('test-results/', root), { recursive: true });
  const port = 4300 + Math.floor(Math.random() * 500);
  const base = `http://localhost:${port}`;
  const server = await startPreview(port);
  const browser = await chromium.launch({
    executablePath: findChromium(),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });

  /** Fresh context with API + tile interception and console/CSP capture. */
  async function open(path = '/', { viewport = { width: 1440, height: 900 }, colorScheme = 'light', failSource, failFrame, storage } = {}) {
    const context = await browser.newContext({ viewport, colorScheme, hasTouch: viewport.width < 900, isMobile: viewport.width < 900 });
    if (storage) await context.addInitScript((s) => Object.entries(s).forEach(([k, v]) => localStorage.setItem(k, v)), storage);
    const page = await context.newPage();
    page.problems = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') page.problems.push(`console: ${msg.text()}`);
    });
    page.on('pageerror', (err) => page.problems.push(`pageerror: ${err.message}`));
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`));
    });
    await page.route('**/api/cameras?source=*', (route) => {
      const source = new URL(route.request().url()).searchParams.get('source');
      if (source === failSource) return route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"upstream_unavailable","message":"Upstream HTTP 503"}' });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ enabled: true, sourceId: source, checkedAt: ctx.checkedAt, cameras: catalogs[source] ?? [] }) });
    });
    await page.route('**/api/flights?*', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ enabled: true, aircraft }) }));
    await page.route('**/api/frame?*', (route) => {
      const id = new URL(route.request().url()).searchParams.get('id');
      if (id === failFrame) return route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"frame_unavailable"}' });
      return route.fulfill({ contentType: 'image/jpeg', body: JPEG });
    });
    await page.route(/arcgisonline\.com|amazonaws\.com|digitraffic\.fi/, (route) =>
      route.fulfill({ contentType: /arcgisonline/.test(route.request().url()) ? 'image/png' : 'image/jpeg', body: /arcgisonline/.test(route.request().url()) ? PNG : JPEG }),
    );
    await page.goto(`${base}${path}`);
    // On mobile the list lives in a closed bottom sheet: wait for it to be populated, not visible.
    await page.waitForSelector('.card, .empty__title', { state: 'attached', timeout: 20_000 });
    return page;
  }
  const close = (page) => page.context().close();
  const count = (page) => page.locator('.results__summary .badge--accent').innerText();
  const noProblems = (page) => assert.deepEqual(page.problems.filter((p) => !/Failed to load resource/.test(p)), []);

  console.log('E2E — production build + vercel.json headers');

  await step('desktop loads Spain view, globe initialises, no console/CSP errors', async () => {
    const page = await open('/');
    await page.waitForSelector('#globe canvas', { timeout: 30_000 });
    await page.waitForTimeout(1500);
    assert.equal(await page.locator('.scope-tab[data-scope="spain"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await count(page), '7 de 7 cámaras');
    assert.equal(await page.locator('#map-status .status-pill--error').count(), 0, 'globe/WebGL must start');
    assert.ok((await page.locator('#credits').innerText()).includes('Esri'), 'basemap attribution visible');
    await page.screenshot({ path: 'test-results/desktop-light.png' });
    noProblems(page);
    await close(page);
  });

  await step('theme switch keeps the same globe canvas and persists without flash', async () => {
    const page = await open('/');
    await page.waitForSelector('#globe canvas', { timeout: 30_000 });
    await page.evaluate(() => (document.querySelector('#globe canvas').dataset.probe = 'same'));
    await page.locator('.card').first().click();
    await page.getByRole('radio', { name: 'Tema oscuro' }).click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    assert.equal(await page.evaluate(() => document.querySelector('#globe canvas').dataset.probe), 'same');
    assert.equal(await page.locator('#detail').isVisible(), true, 'selection survives theme change');
    await page.waitForTimeout(800);
    await page.screenshot({ path: 'test-results/desktop-dark-detail.png' });
    const reloaded = await page.context().newPage();
    await reloaded.goto(`${base}/`, { waitUntil: 'commit' });
    await reloaded.waitForSelector('html[data-theme="dark"]', { timeout: 5000 });
    assert.equal(await reloaded.evaluate(() => document.documentElement.dataset.themePref), 'dark');
    noProblems(page);
    await close(page);
  });

  await step('mobile theme toggle cycles light → dark → automatic', async () => {
    const page = await open('/', { viewport: { width: 390, height: 844 } });
    const button = page.locator('#theme-cycle');
    assert.equal(await button.isVisible(), true);
    await button.click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.themePref), 'light');
    await button.click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await close(page);
  });

  await step('automatic theme follows the system preference', async () => {
    const page = await open('/', { colorScheme: 'dark' });
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await close(page);
  });

  await step('hierarchical Spain filters (comunidad → provincia) and honest empty state', async () => {
    const page = await open('/');
    await page.selectOption('#f-community', 'ES-MD');
    const provinces = await page.locator('#f-province option').allInnerTexts();
    assert.deepEqual(provinces, ['Todas', 'Madrid']);
    assert.equal(await count(page), '4 de 7 cámaras');
    await page.selectOption('#f-community', 'ES-CL');
    assert.equal(await page.locator('#f-province option').count(), 10);
    await page.selectOption('#f-province', 'ES-P');
    assert.equal(await count(page), '1 de 7 cámaras');
    await page.waitForURL(/pr=ES-P/); // URL sync is debounced
    await page.selectOption('#f-community', 'ES-PV');
    assert.match(await page.locator('.empty').innerText(), /País Vasco y Cataluña/);
    await page.getByRole('button', { name: 'Quitar filtros' }).click();
    assert.equal(await count(page), '7 de 7 cámaras');
    noProblems(page);
    await close(page);
  });

  await step('quick city acts as geographic navigation + 25 km filter, shareable in URL', async () => {
    const page = await open('/');
    await page.getByRole('button', { name: 'Madrid', exact: true }).click();
    assert.equal(await count(page), '4 de 7 cámaras');
    await page.waitForURL(/city=madrid/);
    await page.getByRole('button', { name: 'Ceuta', exact: true }).click();
    assert.equal(await count(page), '0 de 7 cámaras');
    await close(page);
  });

  await step('selecting a camera shows media, metadata, source link and updates URL', async () => {
    const page = await open('/');
    await page.locator('.card', { hasText: 'Plaza de Colon' }).click();
    await page.waitForSelector('.media__stamp:not([hidden])', { timeout: 10_000 });
    assert.match(await page.locator('.media__stamp').innerText(), /Recibida/);
    assert.match(await page.locator('#detail').innerText(), /Ayuntamiento de Madrid/);
    assert.equal(await page.locator('#detail a', { hasText: 'Fuente original' }).getAttribute('rel'), 'noopener noreferrer');
    await page.waitForURL(new RegExp(`cam=madrid%3A${Buffer.from('informo.munimadrid.es/informo/Camaras/Camara00019_mdf.jpg').toString('base64url')}`));
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#detail').isVisible(), false);
    noProblems(page);
    await close(page);
  });

  await step('failing frame shows a clear error with retry and original-source link (no black box)', async () => {
    const page = await open('/', { failFrame: 'dgt:i2' });
    await page.locator('.card').filter({ has: page.getByText('CGT Valladolid · cámara 2', { exact: true }) }).click();
    await page.waitForSelector('.media__overlay[role="alert"]', { timeout: 10_000 });
    const text = await page.locator('.media__overlay[role="alert"]').innerText();
    assert.match(text, /no está disponible/);
    assert.match(text, /Abrir fuente/);
    assert.match(await page.locator('.results__summary').innerText(), /1 no disponibles/);
    await close(page);
  });

  await step('shared camera link restores the camera (deep link)', async () => {
    const page = await open('/?cam=dgt%3Ai215');
    await page.waitForSelector('#detail:not([hidden])');
    assert.match(await page.locator('#detail-title').innerText(), /Malaga · cámara 215/);
    await close(page);
  });

  await step('foreign shared camera loads world sources automatically', async () => {
    const page = await open('/?cam=fintraffic%3AC0150201');
    await page.waitForSelector('#detail:not([hidden])', { timeout: 10_000 });
    assert.match(await page.locator('#detail-title').innerText(), /Espoo/);
    await close(page);
  });

  await step('global search: keyboard selection of a province', async () => {
    const page = await open('/');
    await page.locator('#search-input').fill('bizk');
    await page.waitForSelector('.search__option');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#f-province').inputValue(), 'ES-BI');
    assert.equal(await page.locator('#f-community').inputValue(), 'ES-PV');
    await close(page);
  });

  await step('favorites and recents persist locally', async () => {
    const page = await open('/');
    await page.locator('.card').first().click();
    await page.getByRole('button', { name: 'Guardar en favoritas' }).click();
    await page.getByRole('button', { name: 'Cerrar cámara' }).click();
    await page.locator('.results__tabs').getByRole('button', { name: 'Favoritas' }).click();
    assert.equal(await page.locator('.results__list .card').count(), 1);
    await page.locator('.results__tabs').getByRole('button', { name: 'Recientes' }).click();
    assert.equal(await page.locator('.results__list .card').count(), 1);
    await close(page);
  });

  await step('world scope adds international sources; country filter', async () => {
    const page = await open('/');
    await page.locator('.scope-tab[data-scope="world"]').click();
    await page.waitForFunction(() => document.querySelector('.results__summary .badge--accent')?.textContent === '9 de 9 cámaras');
    await page.selectOption('#f-country', 'GB');
    assert.equal(await count(page), '1 de 9 cámaras');
    await close(page);
  });

  await step('a failing provider is reported, others keep working', async () => {
    const page = await open('/', { failSource: 'dgt' });
    await page.waitForSelector('#map-status .status-pill--error');
    assert.match(await page.locator('#map-status').innerText(), /DGT/);
    assert.equal(await count(page), '3 de 3 cámaras');
    await close(page);
  });

  for (const [name, viewport] of [['mobile', { width: 390, height: 844 }], ['tablet', { width: 820, height: 1180 }], ['small-mobile', { width: 320, height: 640 }]]) {
    await step(`${name}: bottom nav, sheets, no horizontal overflow`, async () => {
      const page = await open('/', { viewport, colorScheme: name === 'mobile' ? 'dark' : 'light' });
      // body has overflow:hidden, so scrollWidth alone would hide clipping: check real boxes.
      const clipped = await page.evaluate(() => [...document.querySelectorAll('.topbar *, .bottom-nav *, .pane--filters *')]
        .filter((el) => el.offsetParent && el.getClientRects().length)
        .filter((el) => { const r = el.getBoundingClientRect(); return r.right > window.innerWidth + 1 || r.left < -1; })
        .map((el) => `${el.tagName}.${el.className}`).slice(0, 5));
      assert.deepEqual(clipped, [], 'elements outside the viewport');
      const topbar = await page.locator('.topbar').boundingBox();
      assert.ok(topbar.height <= 125, `mobile top bar should be two rows, got ${topbar.height}px`);
      assert.equal(await page.locator('#bottom-nav').isVisible(), true);
      await page.getByRole('button', { name: 'Lista' }).click();
      await page.waitForTimeout(350);
      assert.equal(await page.locator('.pane--results').isVisible(), true);
      await page.screenshot({ path: `test-results/${name}-list.png` });
      await page.locator('.card').first().click();
      await page.waitForSelector('.app[data-sheet="detail"] #detail:not([hidden])');
      await page.waitForTimeout(400);
      await page.screenshot({ path: `test-results/${name}-detail.png` });
      const box = await page.locator('#detail').boundingBox();
      const nav = await page.locator('#bottom-nav').boundingBox();
      assert.ok(box.y + box.height <= nav.y + 1, 'detail sheet must not hide behind the bottom nav');
      assert.ok(box.y >= topbar.y + topbar.height - 1, 'detail sheet must not cover the search bar');
      await page.getByRole('button', { name: 'Filtros' }).click();
      await page.waitForTimeout(350);
      assert.equal(await page.locator('#f-community').isVisible(), true);
      await page.screenshot({ path: `test-results/${name}-filters.png` });
      const small = await page.evaluate(() => [...document.querySelectorAll('.bottom-nav__item, .chip, .icon-btn')]
        .filter((el) => el.offsetParent && el.getBoundingClientRect().height < 32).length);
      assert.equal(small, 0, 'touch targets ≥ 32px (44px where possible)');
      noProblems(page);
      await close(page);
    });
  }

  await step('live flights: on by default, counted on the map control, toggle persisted in the URL', async () => {
    const page = await open('/');
    const toggle = page.locator('.flights-toggle');
    await page.waitForFunction(() => document.querySelector('.flights-toggle__count')?.textContent === '2', null, { timeout: 20_000 });
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
    assert.match(await toggle.getAttribute('aria-label'), /2 en vista/);
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
    await page.waitForURL(/fl=0/);
    noProblems(page);
    await close(page);
  });

  await step('keyboard: skip link, focus visible on cards, Enter opens detail', async () => {
    const page = await open('/');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'skip-link');
    await page.locator('.card').first().focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('#detail:not([hidden])');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'detail-title');
    await close(page);
  });

  await browser.close();
  server.kill();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
