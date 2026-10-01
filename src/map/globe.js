/**
 * Owns the single Cesium Viewer for the app's lifetime. Theme changes swap
 * the base imagery layer in place; scene-mode changes morph the same scene.
 * Nothing here ever destroys and recreates the viewer except destroy().
 */
import './cesiumBase.js';
import '@cesium/engine/Source/Widget/CesiumWidget.css';
// Engine only: the 'cesium' Viewer pulls in Knockout widgets, which call
// eval() and would require 'unsafe-eval' in the CSP. CesiumWidget includes
// entities/dataSources since 1.12x, which is all this app needs.
import {
  CesiumWidget,
  ImageryLayer,
  UrlTemplateImageryProvider,
  Credit,
  Cartesian3,
  Color,
  Math as CesiumMath,
  Rectangle,
  SceneMode,
  Ion,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  defined,
} from '@cesium/engine';
import { resolveBasemaps } from './basemaps.js';

const basemaps = resolveBasemaps(import.meta.env);

/** Cesium renders Credit strings as HTML: escape so a configured attribution can't inject markup. */
const escapeHtml = (text) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const createBasemap = (theme) =>
  new ImageryLayer(
    new UrlTemplateImageryProvider({
      url: basemaps[theme] ?? basemaps.light,
      maximumLevel: basemaps.maximumLevel,
      credit: new Credit(escapeHtml(basemaps.attribution), true),
    }),
  );

const prefersReducedMotion = () =>
  globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Camera height that frames roughly `km` kilometres of ground. */
const heightForSpan = (km) => Math.max(800, km * 1000 * 1.35);

/**
 * @param {HTMLElement} container
 * @param {{ theme: 'light' | 'dark', creditContainer: HTMLElement, ionToken?: string }} options
 */
export function createGlobe(container, { theme, creditContainer, ionToken }) {
  if (ionToken) Ion.defaultAccessToken = ionToken;

  const viewer = new CesiumWidget(container, {
    baseLayer: createBasemap(theme),
    creditContainer,
    // Render only when something changes: big battery/CPU win on mobile.
    requestRenderMode: true,
    maximumRenderTimeChange: Infinity,
    msaaSamples: 1,
  });

  const { scene } = viewer;
  scene.globe.enableLighting = false;
  scene.globe.showGroundAtmosphere = true;
  scene.fog.enabled = true;
  scene.screenSpaceCameraController.minimumZoomDistance = 300;
  scene.screenSpaceCameraController.maximumZoomDistance = 40_000_000;
  // Keep the credit lightbox inside our container instead of the canvas.
  viewer.creditDisplay.container.classList.add('credits__inner');

  let baseLayer = viewer.imageryLayers.get(0);

  const applySceneColors = (mode) => {
    const dark = mode === 'dark';
    scene.backgroundColor = Color.fromCssColorString(dark ? '#050a14' : '#dfe6ee');
    scene.globe.baseColor = Color.fromCssColorString(dark ? '#0b1424' : '#cfd8e3');
    if (scene.skyAtmosphere) scene.skyAtmosphere.show = true;
    if (scene.skyBox) scene.skyBox.show = dark;
    if (scene.sun) scene.sun.show = false;
    if (scene.moon) scene.moon.show = false;
  };
  applySceneColors(theme);

  const flightSeconds = (base) => (prefersReducedMotion() ? 0 : base);

  const api = {
    viewer,
    scene,

    /** Swap basemap + scene colours; the viewer, entities and camera stay put. */
    setTheme(next) {
      const replacement = createBasemap(next);
      viewer.imageryLayers.add(replacement, 0);
      viewer.imageryLayers.remove(baseLayer, true);
      baseLayer = replacement;
      applySceneColors(next);
      scene.requestRender();
    },

    /** @param {{ lat: number, lon: number, km: number }} target */
    flyTo({ lat, lon, km }, { duration = 1.6 } = {}) {
      if (![lat, lon, km].every(Number.isFinite)) {
        console.warn('[globe] flyTo ignored: invalid target', { lat, lon, km });
        return;
      }
      viewer.camera.cancelFlight();
      viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(lon, lat, heightForSpan(km)),
        orientation: { heading: 0, pitch: CesiumMath.toRadians(-90), roll: 0 },
        duration: flightSeconds(duration),
      });
    },

    flyToGlobal() {
      api.flyTo({ lat: 30, lon: -10, km: 15_000 }, { duration: 1.8 });
    },

    zoom(factor) {
      const height = viewer.camera.positionCartographic.height;
      if (factor > 1) viewer.camera.zoomOut(height * (factor - 1));
      else viewer.camera.zoomIn(height * (1 - factor));
      scene.requestRender();
    },

    /** @returns {'3d' | '2d'} */
    getMode: () => (scene.mode === SceneMode.SCENE2D ? '2d' : '3d'),
    setMode(mode) {
      const duration = flightSeconds(1);
      if (mode === '2d' && scene.mode !== SceneMode.SCENE2D) scene.morphTo2D(duration);
      if (mode === '3d' && scene.mode !== SceneMode.SCENE3D) scene.morphTo3D(duration);
    },

    /** Current view as a shareable target (centre + approximate span). */
    getViewTarget() {
      const rect = viewer.camera.computeViewRectangle(scene.globe.ellipsoid, new Rectangle());
      const carto = viewer.camera.positionCartographic;
      if (!rect || !carto) return null;
      const center = Rectangle.center(rect);
      return {
        lat: CesiumMath.toDegrees(center.latitude),
        lon: CesiumMath.toDegrees(center.longitude),
        km: Math.max(0.1, carto.height / 1000 / 1.35),
      };
    },

    /** Visible bounds [w,s,e,n] in degrees, or null when the sky is visible everywhere. */
    getViewBounds() {
      const rect = viewer.camera.computeViewRectangle(scene.globe.ellipsoid, new Rectangle());
      if (!rect) return null;
      return [rect.west, rect.south, rect.east, rect.north].map((r) => CesiumMath.toDegrees(r));
    },

    /** @param {() => void} callback @returns {() => void} */
    onViewChanged(callback) {
      return viewer.camera.moveEnd.addEventListener(callback);
    },

    /**
     * Left-click picking. Receives the picked Cesium object (or undefined).
     * @returns {() => void}
     */
    onPick(callback) {
      const handler = new ScreenSpaceEventHandler(scene.canvas);
      handler.setInputAction((movement) => {
        const picked = scene.pick(movement.position);
        callback(defined(picked) ? picked : undefined);
      }, ScreenSpaceEventType.LEFT_CLICK);
      return () => handler.destroy();
    },

    /** Pointer cursor feedback over pickable objects (desktop only). */
    onHover(callback) {
      const handler = new ScreenSpaceEventHandler(scene.canvas);
      let frame = 0;
      handler.setInputAction((movement) => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => callback(scene.pick(movement.endPosition)));
      }, ScreenSpaceEventType.MOUSE_MOVE);
      return () => {
        cancelAnimationFrame(frame);
        handler.destroy();
      };
    },

    destroy() {
      if (!viewer.isDestroyed()) viewer.destroy();
    },
  };
  return api;
}
