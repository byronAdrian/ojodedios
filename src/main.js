import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import { startApplication } from './app/application.js';

const $ = (selector) => document.querySelector(selector);

const elements = {
  app: $('#app'),
  search: $('#search'),
  themeSwitch: $('#theme-switch'),
  themeCycle: $('#theme-cycle'),
  scopeTabs: [...document.querySelectorAll('.scope-tab')],
  sidebarToggle: $('#sidebar-toggle'),
  filtersPane: $('#filters-pane'),
  resultsPane: $('#results-pane'),
  detail: $('#detail'),
  flightDetail: $('#flight-detail'),
  mosaic: $('#mosaic'),
  mapControls: $('#map-controls'),
  mapStatus: $('#map-status'),
  bottomNav: $('#bottom-nav'),
  scrim: $('#scrim'),
  toasts: $('#toasts'),
  globe: $('#globe'),
  credits: $('#credits'),
};

// Bottom sheets must stop below the real top bar, whose height depends on
// fonts, wrapping and safe areas: measure it instead of hard-coding it.
new ResizeObserver(([entry]) => {
  const height = Math.ceil(entry.target.getBoundingClientRect().height);
  document.documentElement.style.setProperty('--mobile-topbar-h', `${height}px`);
}).observe(document.querySelector('.topbar'));

/** Cesium is loaded lazily so the shell (search, filters, list) paints first. */
async function createMap({ theme, ionToken, onSelect }) {
  const [{ createGlobe }, { createCameraLayer }, { createFlightLayer }] = await Promise.all([
    import('./map/globe.js'),
    import('./map/cameraLayer.js'),
    import('./flights/flightLayer.js'),
  ]);
  const globe = createGlobe(elements.globe, { theme, creditContainer: elements.credits, ionToken });
  const layer = createCameraLayer(globe, { onSelect });
  return { globe, layer, createFlightLayer };
}

startApplication({
  elements,
  createMap,
  env: { ionToken: import.meta.env.VITE_CESIUM_ION_TOKEN || '' },
}).catch((error) => {
  console.error('[app] startup failed', error);
});
