#!/usr/bin/env node
/**
 * Environment check: Node version, installed dependencies, required files and
 * environment variables. Exits non-zero on blocking problems only.
 */
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const problems = [];
const notes = [];
const ok = (msg) => console.log(`  ✓ ${msg}`);

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 20 || (major === 20 && minor < 19) || major >= 25) problems.push(`Node ${process.versions.node} no soportado (se requiere >=20.19 <25)`);
else ok(`Node ${process.versions.node}`);

const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
for (const dep of [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]) {
  if (!existsSync(new URL(`node_modules/${dep}/package.json`, root))) problems.push(`Falta la dependencia ${dep}: ejecuta npm ci`);
}
if (!problems.some((p) => p.includes('dependencia'))) ok('Dependencias instaladas');

const cesium = JSON.parse(readFileSync(new URL('node_modules/cesium/package.json', root), 'utf8'));
const engine = JSON.parse(readFileSync(new URL('node_modules/@cesium/engine/package.json', root), 'utf8'));
const bundled = cesium.dependencies?.['@cesium/engine'];
if (bundled && !bundled.includes(engine.version)) problems.push(`@cesium/engine ${engine.version} no coincide con el de cesium (${bundled}); los Workers no casarían`);
else ok(`cesium ${cesium.version} / @cesium/engine ${engine.version}`);

for (const file of ['vercel.json', 'server/geo/spainProvinces.data.js', 'public/theme-init.js', '.env.example']) {
  if (!existsSync(new URL(file, root))) problems.push(`Falta ${file}`);
}
ok('Archivos de configuración presentes');

if (!process.env.VITE_CESIUM_ION_TOKEN) notes.push('VITE_CESIUM_ION_TOKEN vacío: correcto, el mapa base no lo necesita.');
if (!process.env.TFL_APP_KEY) notes.push('TFL_APP_KEY vacío: TfL funciona sin clave con límite anónimo.');

for (const n of notes) console.log(`  · ${n}`);
if (problems.length) {
  for (const p of problems) console.log(`  ✗ ${p}`);
  process.exit(1);
}
console.log('Entorno listo.');
