/**
 * Composition root and controller. Owns the store, wires domain logic, the
 * globe and the views, and keeps the URL in sync. Views are dumb renderers;
 * all state transitions happen here.
 */
import { createStore } from '../state/store.js';
import { parseUrlState, serializeUrlState, cameraShareUrl } from '../state/urlState.js';
import { createPreferences } from '../state/preferences.js';
import { applyFilters, summarize, sortCameras, defaultFilters, countActiveFilters, distanceKm } from '../domain/filters.js';
import { buildStaticIndex, buildCameraIndex } from '../domain/search.js';
import { getCommunity, getQuickCity, communityOfProvince, SPAIN_VIEW, CITY_RADIUS_KM } from '../domain/spain.js';
import { createCameraRepository, SCOPE_SOURCES } from '../services/cameraRepository.js';
import { getProvider } from '../domain/camera.js';
import { createThemeController } from '../ui/theme.js';
import { createSearchBox } from '../ui/searchBox.js';
import { createFiltersPanel } from '../ui/filtersPanel.js';
import { createResultsPanel } from '../ui/resultsPanel.js';
import { createCameraDetail } from '../ui/cameraDetail.js';
import { createMapControls, createMapStatus, createBottomNav, createToasts } from '../ui/chrome.js';
import { debounce } from '../ui/dom.js';
import { createFlightsController } from '../flights/flightsController.js';

const DESKTOP = '(min-width: 900px)';

/** Frame a list of cameras: centre of their bbox and a span that fits them. */
export function frameFor(cameras, fallback) {
  if (!cameras.length) return fallback;
  let s = 90, n = -90, w = 180, e = -180;
  for (const c of cameras) {
    s = Math.min(s, c.lat); n = Math.max(n, c.lat);
    w = Math.min(w, c.lon); e = Math.max(e, c.lon);
  }
  const lat = (s + n) / 2;
  const lon = (w + e) / 2;
  const km = Math.max(distanceKm(s, w, n, e) * 1.15, 12);
  return { lat, lon, km: Math.min(km, 4000) };
}

/**
 * @param {{ elements: Record<string, HTMLElement>, createMap: (opts) => Promise<{ globe, layer }>,
 *           fetchImpl?: typeof fetch, env?: { ionToken?: string } }} deps
 */
export async function startApplication({ elements, createMap, fetchImpl, env = {} }) {
  const preferences = createPreferences();
  const repository = createCameraRepository({ fetchImpl });
  const initial = parseUrlState(location.search);
  const isDesktop = () => globalThis.matchMedia?.(DESKTOP).matches ?? true;

  const store = createStore({
    filters: initial.filters,
    onlyInView: false,
    catalog: /** @type {Map<string, import('../domain/camera.js').Camera>} */ (new Map()),
    sources: /** @type {Record<string, import('../services/cameraRepository.js').SourceStatus>} */ ({}),
    selectedId: initial.cameraId,
    availability: /** @type {Map<string, 'online' | 'offline'>} */ (new Map()),
    favorites: preferences.getFavorites(),
    recents: preferences.getRecents(),
    tab: 'results',
    sheet: initial.cameraId && !isDesktop() ? 'detail' : 'none',
    mode: initial.mode,
    flightsOn: initial.flights,
    flightSelected: false,
  });

  const toast = createToasts(elements.toasts);
  let lastFlightInfo = {};
  const flights = createFlightsController({
    container: elements.flightDetail,
    getMap: () => map,
    createLayer: (globe, opts) => map.createFlightLayer(globe, opts),
    onSelectionChange(hasFlight) {
      const s = store.get();
      let sheet = s.sheet;
      if (hasFlight && !isDesktop()) sheet = 'detail';
      else if (!hasFlight && sheet === 'detail' && !s.selectedId) sheet = 'none';
      store.set({ flightSelected: hasFlight, sheet, ...(hasFlight ? { selectedId: null } : {}) });
    },
    onStatus(info) {
      lastFlightInfo = info;
      mapControls?.setFlights(store.get().flightsOn, info);
    },
  });
  let map = null; // { globe, layer } once Cesium is ready
  const staticIndex = buildStaticIndex();
  let searchIndex = staticIndex;
  let pendingDeepLink = initial.cameraId;

  // ---------- derived data (memoized on its inputs) ----------
  let derivedKey = null;
  let derived = { filtered: [], all: [] };
  function getDerived(state) {
    const key = [state.catalog, state.filters, state.availability, state.favorites];
    if (derivedKey && key.every((v, i) => v === derivedKey[i])) return derived;
    const all = [...state.catalog.values()];
    const filtered = sortCameras(applyFilters(all, state.filters, { availability: state.availability, favorites: state.favorites }), state.filters);
    derivedKey = key;
    derived = { all, filtered };
    return derived;
  }

  // ---------- actions ----------
  const setFilters = (patch) => {
    const filters = { ...store.get().filters, ...patch };
    if (patch.province) filters.community = communityOfProvince(patch.province) ?? filters.community;
    store.set({ filters });
  };

  const flyTo = (target) => map?.globe.flyTo(target);
  const scopeCameras = () => getDerived(store.get()).all.filter((c) => c.countryCode === 'ES');

  const pendingAvailability = new Map();
  let availabilityFrame = 0;

  const actions = {
    setFilters(patch) {
      const before = store.get().filters;
      setFilters(patch);
      const after = store.get().filters;
      // Geography changes move the camera; everything else leaves the view alone.
      if (after.province && after.province !== before.province) {
        const inProvince = scopeCameras().filter((c) => c.provinceCode === after.province);
        const community = getCommunity(after.community);
        flyTo(frameFor(inProvince, community ? { lon: community.center[0], lat: community.center[1], km: community.zoomKm / 2 } : SPAIN_VIEW));
      } else if (after.community !== before.community) {
        const community = getCommunity(after.community);
        flyTo(community ? { lon: community.center[0], lat: community.center[1], km: community.zoomKm } : SPAIN_VIEW);
      } else if (after.country && after.country !== before.country) {
        flyTo(frameFor(getDerived(store.get()).all.filter((c) => c.countryCode === after.country), { lat: 30, lon: 0, km: 15000 }));
      }
    },
    resetFilters() {
      store.set({ filters: { ...defaultFilters(), scope: store.get().filters.scope }, onlyInView: false });
    },
    setScope(scope) {
      if (store.get().filters.scope === scope) return;
      store.set({ filters: { ...defaultFilters(), scope }, onlyInView: false });
      if (scope === 'spain') flyTo(SPAIN_VIEW);
      else map?.globe.flyToGlobal();
      loadScope(scope);
    },
    goToSpain() {
      if (store.get().filters.scope !== 'spain') return actions.setScope('spain');
      store.set({ filters: { ...store.get().filters, community: '', province: '', city: '' } });
      flyTo(SPAIN_VIEW);
    },
    goToCity(id) {
      const city = getQuickCity(id);
      if (!city) return;
      store.set({
        filters: {
          ...store.get().filters,
          scope: 'spain',
          community: communityOfProvince(city.provinceCode),
          province: city.provinceCode,
          city: id,
        },
      });
      flyTo({ lat: city.lat, lon: city.lon, km: CITY_RADIUS_KM * 2.2 });
      if (!isDesktop()) store.set({ sheet: 'list' });
    },
    select(id) {
      if (id) flights.clearSelection();
      store.set({ selectedId: id, sheet: isDesktop() ? store.get().sheet : 'detail' });
      if (id) {
        preferences.addRecent(id);
        const camera = store.get().catalog.get(id);
        if (camera) flyTo({ lat: camera.lat, lon: camera.lon, km: 3 });
      }
    },
    close() {
      const id = store.get().selectedId;
      store.set({ selectedId: null, sheet: store.get().sheet === 'detail' ? 'none' : store.get().sheet });
      // Return focus to the card that opened the panel, if visible.
      if (id) document.querySelector('.card[aria-current="true"]')?.focus();
    },
    center(camera) {
      flyTo({ lat: camera.lat, lon: camera.lon, km: 1.5 });
      if (!isDesktop()) store.set({ sheet: 'none' });
    },
    setTab: (tab) => store.set({ tab }),
    setSheet(sheet) {
      if (sheet === 'favorites') store.set({ sheet, tab: 'favorites' });
      else if (sheet === 'list') store.set({ sheet, tab: store.get().tab === 'favorites' ? 'results' : store.get().tab });
      else store.set({ sheet: sheet === store.get().sheet ? 'none' : sheet });
    },
    setOnlyInView(on) {
      store.set({ onlyInView: on, filters: { ...store.get().filters, viewBounds: on ? map?.globe.getViewBounds() ?? null : null } });
    },
    /** Batched: many thumbnails settle at once; one store update (and one re-render) per frame. */
    markAvailability(id, state) {
      if (store.get().availability.get(id) === state && !pendingAvailability.has(id)) return;
      pendingAvailability.set(id, state);
      if (availabilityFrame) return;
      availabilityFrame = requestAnimationFrame(() => {
        availabilityFrame = 0;
        const next = new Map(store.get().availability);
        let changed = false;
        for (const [key, value] of pendingAvailability) {
          if (next.get(key) !== value) {
            next.set(key, value);
            changed = true;
          }
        }
        pendingAvailability.clear();
        if (changed) store.set({ availability: next });
      });
    },
    toggleFavorite: (id) => preferences.toggleFavorite(id),
    isFavorite: (id) => store.get().favorites.has(id),
    shareUrl: (camera) => cameraShareUrl(location.origin, location.pathname, camera),
    clearRecents: () => preferences.clearRecents(),
    setHistorySize: (n) => preferences.setHistorySize(n),
    retrySources() {
      for (const id of SCOPE_SOURCES[store.get().filters.scope]) repository.invalidate(id);
      loadScope(store.get().filters.scope, { force: true });
    },
    toast,
  };

  preferences.subscribe(() => store.set({ favorites: preferences.getFavorites(), recents: preferences.getRecents() }));

  // ---------- data loading ----------
  let loadGeneration = 0;
  async function loadScope(scope, { force = false } = {}) {
    const generation = ++loadGeneration;
    const ids = SCOPE_SOURCES[scope];
    const pending = ids.filter((id) => force || store.get().sources[id]?.state !== 'ready');
    if (!pending.length) return;
    store.set((s) => ({ sources: { ...s.sources, ...Object.fromEntries(pending.map((id) => [id, { state: 'loading', count: 0 }])) } }));
    await Promise.all(
      pending.map(async (id) => {
        const { cameras, status } = await repository.getSource(id);
        store.set((s) => {
          const catalog = new Map(s.catalog);
          for (const camera of cameras) catalog.set(camera.id, camera);
          return { catalog, sources: { ...s.sources, [id]: status } };
        });
      }),
    );
    if (generation !== loadGeneration && !pendingDeepLink) return;
    searchIndex = [...staticIndex, ...buildCameraIndex(getDerived(store.get()).all)];
    resolveDeepLink();
  }

  function resolveDeepLink() {
    if (!pendingDeepLink) return;
    const camera = store.get().catalog.get(pendingDeepLink);
    const stillLoading = Object.values(store.get().sources).some((s) => s.state === 'loading');
    if (camera) {
      pendingDeepLink = null;
      preferences.addRecent(camera.id);
      if (!initial.view) flyTo({ lat: camera.lat, lon: camera.lon, km: 3 });
    } else if (!stillLoading) {
      if (store.get().filters.scope === 'spain' && !pendingDeepLink.startsWith('dgt:') && !pendingDeepLink.startsWith('madrid:')) {
        loadScope('world'); // a shared foreign camera: fetch the world sources once
        return;
      }
      toast('La cámara del enlace ya no está en el catálogo del proveedor.', 4200);
      pendingDeepLink = null;
      store.set({ selectedId: null, sheet: 'none' });
    }
  }

  // ---------- views ----------
  const theme = createThemeController({
    container: elements.themeSwitch,
    cycleButton: elements.themeCycle,
    preferences,
    onChange: (resolved) => {
      map?.globe.setTheme(resolved);
      map?.layer.refreshTheme();
      flights.refreshTheme();
    },
  });
  createSearchBox({
    container: elements.search,
    getIndex: () => searchIndex,
    onPick(entry) {
      if (entry.type === 'country') {
        if (entry.id === 'ES') {
          actions.goToSpain();
        } else {
          actions.setScope('world');
          actions.setFilters({ country: entry.id });
        }
      } else if (entry.type === 'community') {
        actions.setScope('spain');
        actions.setFilters({ community: entry.id, province: '', city: '' });
      } else if (entry.type === 'province') {
        actions.setScope('spain');
        actions.setFilters({ province: entry.id, city: '' });
      } else if (entry.type === 'city') {
        actions.goToCity(entry.id);
      } else if (entry.type === 'category') {
        actions.setFilters({ categories: [entry.id] });
        if (!isDesktop()) store.set({ sheet: 'list' });
      } else if (entry.type === 'camera') {
        actions.select(entry.id);
      }
    },
  });
  const filtersPanel = createFiltersPanel({ container: elements.filtersPane, actions });
  const resultsPanel = createResultsPanel({ container: elements.resultsPane, actions });
  const detail = createCameraDetail({ container: elements.detail, actions });
  const mapStatus = createMapStatus(elements.mapStatus);
  const bottomNav = createBottomNav({ container: elements.bottomNav, onNavigate: (sheet) => actions.setSheet(sheet) });
  const mapControls = createMapControls({
    container: elements.mapControls,
    actions: {
      zoomIn: () => map?.globe.zoom(0.5),
      zoomOut: () => map?.globe.zoom(2),
      resetGlobal: () => map?.globe.flyToGlobal(),
      centerSpain: () => flyTo(SPAIN_VIEW),
      toggleMode: () => store.set({ mode: store.get().mode === '2d' ? '3d' : '2d' }),
      toggleFlights: () => store.set({ flightsOn: !store.get().flightsOn }),
    },
  });

  for (const button of elements.scopeTabs) {
    button.addEventListener('click', () => actions.setScope(button.dataset.scope));
  }
  elements.sidebarToggle.addEventListener('click', () => {
    const collapsed = elements.app.classList.toggle('is-sidebar-collapsed');
    elements.sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
    // Cesium tracks its container size each frame; one render settles the new layout.
    requestAnimationFrame(() => map?.globe.scene.requestRender());
  });
  elements.scrim.addEventListener('click', () => store.set({ sheet: 'none' }));
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (flights.selectedHex) flights.clearSelection();
    else if (store.get().selectedId) actions.close();
    else if (store.get().sheet !== 'none') store.set({ sheet: 'none' });
  });

  // ---------- render loop (store → views) ----------
  const syncUrl = debounce(() => {
    const s = store.get();
    const query = serializeUrlState({
      filters: s.filters,
      cameraId: s.selectedId,
      view: map?.globe.getViewTarget() ?? initial.view,
      mode: s.mode,
      flights: s.flightsOn,
    });
    const next = `${location.pathname}${query ? `?${query}` : ''}`;
    if (next !== `${location.pathname}${location.search}`) history.replaceState(null, '', next);
  }, 400);

  function renderAll(s, prev) {
    const { all, filtered } = getDerived(s);
    const changed = (k) => !prev || s[k] !== prev[k];

    if (changed('filters')) {
      for (const button of elements.scopeTabs) button.setAttribute('aria-pressed', String(button.dataset.scope === s.filters.scope));
    }

    if (changed('filters') || changed('catalog') || changed('onlyInView')) {
      const categoryCounts = new Map();
      const scoped = applyFilters(all, { ...s.filters, categories: [], viewBounds: null, status: 'all', text: '', favoritesOnly: false });
      for (const c of scoped) categoryCounts.set(c.category, (categoryCounts.get(c.category) ?? 0) + 1);
      filtersPanel.update({ filters: s.filters, categoryCounts, onlyInView: s.onlyInView });
    }

    if (['filters', 'catalog', 'availability', 'favorites', 'recents', 'tab', 'selectedId', 'sources', 'onlyInView'].some(changed)) {
      let items = filtered;
      if (s.tab === 'favorites') items = [...s.favorites].map((id) => s.catalog.get(id)).filter(Boolean);
      if (s.tab === 'recents') items = s.recents.map((id) => s.catalog.get(id)).filter(Boolean);
      const statuses = SCOPE_SOURCES[s.filters.scope].map((id) => s.sources[id]);
      resultsPanel.update({
        tab: s.tab,
        items,
        stats: summarize(filtered, s.availability),
        catalogTotal: applyFilters(all, { ...defaultFilters(), scope: s.filters.scope }).length,
        filters: s.filters,
        onlyInView: s.onlyInView,
        selectedId: s.selectedId,
        availability: s.availability,
        loading: statuses.some((x) => !x || x.state === 'loading') && !all.length,
        sourcesFailed: statuses.every((x) => x?.state === 'error'),
        historySize: preferences.getHistorySize(),
        resetPage: changed('filters') || changed('tab'),
      });
      const failed = SCOPE_SOURCES[s.filters.scope].filter((id) => s.sources[id]?.state === 'error').map((id) => getProvider(id).shortName);
      const stale = SCOPE_SOURCES[s.filters.scope].filter((id) => s.sources[id]?.stale).map((id) => getProvider(id).shortName);
      mapStatus.update({ loading: statuses.some((x) => x?.state === 'loading'), failed, stale });
    }

    if (map && (changed('filters') || changed('catalog') || changed('availability') || changed('favorites'))) {
      map.layer.setCameras(filtered);
    }

    if (changed('selectedId') || changed('catalog')) {
      const camera = s.selectedId ? s.catalog.get(s.selectedId) ?? null : null;
      if (camera || !s.selectedId) {
        detail.show(camera, { observed: s.availability.get(s.selectedId) });
        if (camera && changed('selectedId')) detail.focus();
      }
      map?.layer.setSelected(camera ? s.selectedId : null);
    }

    if (changed('sheet') || changed('filters')) {
      elements.app.dataset.sheet = s.sheet;
      elements.scrim.hidden = s.sheet === 'none' || s.sheet === 'detail' || isDesktop();
      bottomNav.update({ sheet: s.sheet, filterCount: countActiveFilters(s.filters) });
    }

    if (changed('flightsOn')) {
      flights.setEnabled(s.flightsOn);
      mapControls.setFlights(s.flightsOn, lastFlightInfo);
    }

    if (changed('mode')) {
      mapControls.setMode(s.mode);
      map?.globe.setMode(s.mode);
    }

    syncUrl();
  }

  store.subscribe(renderAll);
  renderAll(store.get(), null);

  // ---------- map (Cesium) ----------
  try {
    map = await createMap({ theme: theme.resolved, ionToken: env.ionToken, onSelect: (id) => actions.select(id) });
    const s = store.get();
    map.layer.setCameras(getDerived(s).filtered);
    if (s.selectedId) map.layer.setSelected(s.selectedId);
    map.globe.setMode(s.mode);
    if (initial.view) map.globe.flyTo(initial.view, { duration: 0 });
    else if (!initial.cameraId) map.globe.flyTo(s.filters.scope === 'spain' ? SPAIN_VIEW : { lat: 30, lon: -10, km: 15000 }, { duration: 0 });
    const onView = debounce(() => {
      if (store.get().onlyInView) store.set({ filters: { ...store.get().filters, viewBounds: map.globe.getViewBounds() } });
      syncUrl();
    }, 250);
    map.globe.onViewChanged(onView);
    flights.attach(map.globe);
    map.globe.onViewChanged(debounce(() => flights.viewChanged(), 600));
    flights.viewChanged(); // first query as soon as the globe can report its view
  } catch (error) {
    console.error('[globe]', error);
    mapStatus.update({ loading: false, failed: [], stale: [] });
    elements.mapStatus.replaceChildren();
    elements.mapStatus.append(
      Object.assign(document.createElement('div'), {
        className: 'status-pill status-pill--error',
        textContent: 'El globo 3D no está disponible en este navegador (WebGL). El listado sigue funcionando.',
      }),
    );
  }

  await loadScope(initial.filters.scope);
  // A shared camera from another scope (e.g. ?cam=tfl:…) needs its sources too.
  if (pendingDeepLink) resolveDeepLink();

  return { store, actions, getMap: () => map };
}
