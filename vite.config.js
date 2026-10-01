import { defineConfig } from 'vite';
import { cesiumAssets } from './build/cesiumAssets.js';
import { devApiPlugin } from './server/dev/devApiPlugin.js';

export default defineConfig({
  plugins: [cesiumAssets(), devApiPlugin()],
  build: {
    target: 'es2022',
    sourcemap: false,
    // Cesium's engine is one large lazy chunk by nature; it is not on the critical path.
    chunkSizeWarningLimit: 6000,
  },
  preview: { port: 4173 },
  server: { port: 5173 },
});
