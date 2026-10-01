import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDgtCatalog, dgtFrameUrl, dgtNativeId, prettifyDgtName } from '../../server/sources/dgt.js';
import { parseMadridKml, madridFrameUrl, madridNativeId, madridImageKey } from '../../server/sources/madrid.js';
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
  assert.equal(byId['dgt:i2'].provinceCode, 'ES-P');
  assert.equal(byId['dgt:i2'].communityCode, 'ES-CL');
  assert.equal(byId['dgt:i2'].mediaUrl, '/api/frame?id=dgt:i2');
  assert.equal(byId['dgt:i597'].communityCode, 'ES-MD');
  assert.equal(byId['dgt:i215'].provinceCode, 'ES-MA');
  // Managed by "CGT Valencia" but physically in Murcia: we trust coordinates, not the label.
  assert.equal(byId['dgt:i122'].provinceCode, 'ES-MU');
  assert.equal(byId['dgt:i2'].status, 'listed');
  assert.equal(byId['dgt:i2'].city, null, 'DGT does not publish municipality; never invented');
});

test('DGT: unknown format fails loudly instead of returning an empty catalog', () => {
  assert.throws(() => parseDgtCatalog('<html>maintenance</html>', ctx), /no reconocido/);
  const noImages = '<cctvCameraMetadataRecord><urlLinkAddress>https://nueva.dgt.es/c/1.png</urlLinkAddress></cctvCameraMetadataRecord>';
  assert.throws(() => parseDgtCatalog(noImages, ctx), /1 registros sin imagen reconocible.*nueva\.dgt\.es/);
});

test('DGT frame URLs: v3.6 numeric ids and legacy i-prefixed ids only', () => {
  assert.equal(dgtFrameUrl('176130'), 'https://etraffic.dgt.es/camarasEtraffic/176130.jpg');
  assert.equal(dgtFrameUrl('i31'), 'http://infocar.dgt.es/etraffic/data/camaras/31.jpg');
  for (const bad of ['', '../x', '1?a', '1234567890', 'http://evil', '1%2F2', 'i', 'x31']) assert.equal(dgtFrameUrl(bad), null, bad);
  assert.equal(dgtNativeId('https://etraffic.dgt.es/camarasEtraffic/176130.jpg'), '176130');
  assert.equal(dgtNativeId('https://evil.example/camarasEtraffic/1.jpg'), null);
});

test('DGT: v3.6 production image URLs are accepted (format seen on 2026-10-01)', () => {
  const xml = '<device><value>A-1 PK 12</value><latitude>40.5</latitude><longitude>-3.6</longitude><urlLinkAddress>https://etraffic.dgt.es/camarasEtraffic/176130.jpg</urlLinkAddress></device>'.repeat(1);
  const [cam] = parseDgtCatalog(`<root>${xml}</root>`, ctx).map(createCamera);
  assert.equal(cam.id, 'dgt:176130');
  assert.equal(cam.mediaUrl, '/api/frame?id=dgt:176130');
});

test('DGT names are readable', () => {
  assert.equal(prettifyDgtName('CAMARA-CGT VALLADOLID_2', '2'), 'CGT Valladolid · cámara 2');
  assert.equal(prettifyDgtName('', '9'), 'Cámara DGT 9');
});

test('Madrid KML: real placemarks become Madrid traffic cameras', () => {
  const cams = parseMadridKml(fixture('madrid-cameras-sample.kml'), ctx).map(createCamera);
  assert.equal(cams.length, 3);
  const first = cams[0];
  assert.ok(first, 'valid camera');
  assert.equal(first.id, `madrid:${madridNativeId('informo.munimadrid.es/informo/Camaras/Camara00032_mdf.jpg')}`);
  assert.equal(first.name, 'Glorieta Alonso Martinez');
  assert.equal(first.city, 'Madrid');
  assert.equal(first.provinceCode, 'ES-M');
  assert.equal(first.refreshSeconds, 600);
  assert.equal(first.mediaUrl, `/api/frame?id=${first.id}`);
  assert.equal(madridFrameUrl(first.id.slice('madrid:'.length)), 'http://informo.munimadrid.es/informo/Camaras/Camara00032_mdf.jpg');
});

test('Madrid KML: accepts other image paths on official hosts (format drift)', () => {
  const kml = `<kml><Document>
    <Placemark><description>&lt;img src="https://informo.madrid.es/cameras/Camara06303.jpg"&gt;</description>
      <ExtendedData><Data name="Nombre"><Value>PZA ESPAÑA</Value></Data></ExtendedData>
      <Point><coordinates>-3.7122,40.4233,0</coordinates></Point></Placemark>
    <Placemark><description>sin imagen</description><ExtendedData><Data name="Url"><Value>http://informo.madrid.es/cameras/Camara1.JPG</Value></Data></ExtendedData>
      <Point><coordinates>-3.70,40.42</coordinates></Point></Placemark>
    <Placemark><description>&lt;img src="https://evil.example.com/x.jpg"&gt;</description><Point><coordinates>-3.7,40.4</coordinates></Point></Placemark>
  </Document></kml>`;
  const cams = parseMadridKml(kml, ctx).map(createCamera);
  assert.equal(cams.length, 2);
  assert.equal(cams[0].name, 'Plaza España');
  assert.equal(madridFrameUrl(cams[0].id.split(':')[1]), 'http://informo.madrid.es/cameras/Camara06303.jpg');
});

test('Madrid KML with no usable image fails loudly with a diagnostic sample', () => {
  const kml = '<kml><Placemark><description>&lt;img src="https://otro.example/x.jpg"&gt;</description><Point><coordinates>-3.7,40.4</coordinates></Point></Placemark></kml>';
  assert.throws(() => parseMadridKml(kml, ctx), /1 placemarks sin imagen reconocible.*otro\.example/);
});

test('Madrid frame URL rejects foreign hosts, traversal and junk ids', () => {
  const enc = (s) => Buffer.from(s).toString('base64url');
  for (const bad of [
    enc('evil.com/x.jpg'), enc('informo.madrid.es/../etc/passwd.jpg'), enc('informo.madrid.es/x.exe'),
    enc('informo.madrid.es.evil.com/x.jpg'), '../etc', '', 'short', 'not*base64',
  ]) assert.equal(madridFrameUrl(bad), null, bad);
  assert.equal(madridImageKey('https://informo.madrid.es:8443/a.jpg'), null);
  assert.equal(madridImageKey('https://informo.madrid.es/a.jpg?x=1'), null);
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

test('DGT: v3-style records are found structurally whatever the element names', () => {
  const xml = `<d2:payload xmlns:d2="x"><fac:device id="CAM-31"><fac:name><com:values><com:value lang="es">A-6 PK 20</com:value></com:values></fac:name>
      <loc:pointCoordinates><loc:latitude>40.5</loc:latitude><loc:longitude>-3.9</loc:longitude></loc:pointCoordinates>
      <fac:urlLinkAddress>https://infocar.dgt.es/etraffic/data/camaras/31.jpg</fac:urlLinkAddress></fac:device>
    <fac:device id="CAM-32"><com:value>Sin imagen</com:value><loc:latitude>41</loc:latitude><loc:longitude>-4</loc:longitude><x>https://infocar.dgt.es/etraffic/data/camaras/32.jpg</x></fac:device></d2:payload>`;
  const cams = parseDgtCatalog(xml, ctx).map(createCamera);
  assert.deepEqual(cams.map((c) => c.id), ['dgt:i31', 'dgt:i32']);
  assert.equal(cams[0].name, 'A-6 Pk 20 · cámara 31');
  assert.equal(cams[0].provinceCode, 'ES-M');
});

test('DGT: unrecognised document reports its beginning for diagnosis', () => {
  assert.throws(() => parseDgtCatalog('<foo><bar>1</bar></foo>', ctx), /inicio: <foo>/);
});
