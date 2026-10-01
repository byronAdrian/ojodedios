import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDgtCatalog, dgtFrameUrl, prettifyDgtName } from '../../server/sources/dgt.js';
import { parseMadridKml, madridFrameUrl } from '../../server/sources/madrid.js';
import { parseTflCatalog } from '../../server/sources/tfl.js';
import { parseFintrafficCatalog } from '../../server/sources/fintraffic.js';
import { createCamera } from '../../src/domain/camera.js';
import { decodeXmlEntities, elements, firstText } from '../../server/sources/xml.js';

const fixture = (name) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
const ctx = { checkedAt: '2026-10-01T10:00:00.000Z' };

test('xml helpers are namespace-agnostic and decode only safe entities', () => {
  const xml = '<a:x>1</a:x><x attr="y">2</x><xy>no</xy>';
  assert.deepEqual(elements(xml, 'x'), ['1', '2']);
  assert.equal(firstText('<n>A &amp; B &#233; &#x41;</n>', 'n'), 'A & B é A');
  assert.equal(decodeXmlEntities('&foo; <![CDATA[<b>]]>'), '&foo; <b>');
});

test('DGT: parses real records, assigns region by coordinates, skips rows without frame', () => {
  const rows = parseDgtCatalog(fixture('dgt-cctv-sample.xml'), ctx);
  assert.equal(rows.length, 4);
  const cams = rows.map(createCamera);
  assert.ok(cams.every(Boolean));
  const byId = Object.fromEntries(cams.map((c) => [c.id, c]));
  assert.equal(byId['dgt:2'].provinceCode, 'ES-P');
  assert.equal(byId['dgt:2'].communityCode, 'ES-CL');
  assert.equal(byId['dgt:2'].mediaUrl, '/api/frame?id=dgt:2');
  assert.equal(byId['dgt:597'].communityCode, 'ES-MD');
  assert.equal(byId['dgt:215'].provinceCode, 'ES-MA');
  // Managed by "CGT Valencia" but physically in Murcia: we trust coordinates, not the label.
  assert.equal(byId['dgt:122'].provinceCode, 'ES-MU');
  assert.equal(byId['dgt:2'].status, 'listed');
  assert.equal(byId['dgt:2'].city, null, 'DGT does not publish municipality; never invented');
});

test('DGT: unknown format fails loudly instead of returning an empty catalog', () => {
  assert.throws(() => parseDgtCatalog('<html>maintenance</html>', ctx), /no reconocido/);
});

test('DGT frame URL only accepts numeric ids', () => {
  assert.equal(dgtFrameUrl('31'), 'http://infocar.dgt.es/etraffic/data/camaras/31.jpg');
  for (const bad of ['', '../x', '1?a', '12345678', 'http://evil', '1%2F2']) assert.equal(dgtFrameUrl(bad), null, bad);
});

test('DGT names are readable', () => {
  assert.equal(prettifyDgtName('CAMARA-CGT VALLADOLID_2', '2'), 'CGT Valladolid · cámara 2');
  assert.equal(prettifyDgtName('', '9'), 'Cámara DGT 9');
});

test('Madrid KML: real placemarks become Madrid traffic cameras', () => {
  const cams = parseMadridKml(fixture('madrid-cameras-sample.kml'), ctx).map(createCamera);
  assert.equal(cams.length, 3);
  const first = cams[0];
  assert.equal(first.id, 'madrid:Camara00032_mdf');
  assert.equal(first.name, 'Glorieta Alonso Martinez');
  assert.equal(first.city, 'Madrid');
  assert.equal(first.provinceCode, 'ES-M');
  assert.equal(first.refreshSeconds, 600);
  assert.equal(first.mediaUrl, '/api/frame?id=madrid:Camara00032_mdf');
});

test('Madrid frame URL rejects traversal and foreign stems', () => {
  assert.match(madridFrameUrl('Camara00032_mdf'), /^http:\/\/informo\.munimadrid\.es\/informo\/Camaras\/Camara00032_mdf\.jpg$/);
  for (const bad of ['../etc', 'Camara/../x', 'Other01', 'Camara00032.jpg', '']) assert.equal(madridFrameUrl(bad), null, bad);
});

test('TfL keeps only available cameras on the official bucket', () => {
  const cams = parseTflCatalog(JSON.parse(fixture('tfl-sample.json')), ctx).map(createCamera);
  assert.deepEqual(cams.map((c) => c.id), ['tfl:00001.01251']);
  assert.equal(cams[0].status, 'active');
  assert.equal(cams[0].countryCode, 'GB');
  assert.throws(() => parseTflCatalog({}, ctx));
});

test('Fintraffic keeps GATHERING stations and well-formed in-collection presets', () => {
  const cams = parseFintrafficCatalog(JSON.parse(fixture('fintraffic-sample.json')), ctx).map(createCamera);
  assert.deepEqual(cams.map((c) => c.id), ['fintraffic:C0150201']);
  assert.equal(cams[0].mediaUrl, 'https://weathercam.digitraffic.fi/C0150201.jpg');
  assert.equal(cams[0].category, 'weather');
});
