/**
 * Serves (dev) and copies (build) Cesium's static runtime files — Workers,
 * Assets, ThirdParty, Widgets — under /cesium. The JS itself is bundled by
 * Vite from the 'cesium' ESM package and lazy-loaded, so nothing blocks the
 * first paint (unlike vite-plugin-cesium's render-blocking Cesium.js tag).
 */
import { cpSync, existsSync, createReadStream, statSync } from 'node:fs';
import { join, normalize, extname, sep } from 'node:path';
import { createRequire } from 'node:module';

const DIRS = ['Workers', 'Assets', 'ThirdParty', 'Widgets'];
const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.xml': 'application/xml', '.glb': 'model/gltf-binary', '.ktx2': 'image/ktx2' };

function cesiumBuildDir() {
  const pkg = createRequire(import.meta.url).resolve('cesium/package.json');
  return join(pkg, '..', 'Build', 'Cesium');
}

export function cesiumAssets() {
  let outDir = 'dist';
  const source = cesiumBuildDir();
  return {
    name: 'cesium-static-assets',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    configureServer(server) {
      server.middlewares.use('/cesium', (req, res, next) => {
        const relative = normalize(decodeURIComponent((req.url || '/').split('?')[0])).replace(/^([/\\])+/, '');
        const file = join(source, relative);
        if (!file.startsWith(source + sep) || !DIRS.includes(relative.split(/[/\\]/)[0])) return next();
        if (!existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      for (const dir of DIRS) cpSync(join(source, dir), join(outDir, 'cesium', dir), { recursive: true });
    },
  };
}
