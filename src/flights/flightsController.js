/**
 * Wires the flight service, layer and panel. Independent of the camera store:
 * the application only tells it when the map exists, when the view moves and
 * when a camera got selected (so the two selections never overlap).
 */
import { createFlightService } from './flightService.js';
import { createFlightDetail } from './flightDetail.js';

/**
 * @param {{ container: HTMLElement, getMap: () => any, createLayer: (globe, opts) => any,
 *   onSelectionChange: (hasFlight: boolean) => void, onStatus: (s: object) => void }} deps
 */
export function createFlightsController({ container, getMap, createLayer, onSelectionChange, onStatus }) {
  let layer = null;
  let selectedHex = null;
  let lastAircraft = [];
  let lastShown = null;
  let attribution = null;

  const detail = createFlightDetail({
    container,
    onClose: () => select(null),
    onCenter: (a) => getMap()?.globe.flyTo({ lat: a.lat, lon: a.lon, km: 40 }),
  });

  const service = createFlightService({
    getView: () => getMap()?.globe.getViewTarget() ?? null,
    onUpdate(state) {
      lastAircraft = state.aircraft;
      if (state.attribution) attribution = state.attribution;
      layer?.setAircraft(state.aircraft);
      if (selectedHex) {
        const a = service.find(selectedHex);
        const trail = service.trail(selectedHex);
        layer?.setSelected(selectedHex, trail);
        if (a) {
          lastShown = a;
          detail.show(a, { trailPoints: trail.length, attribution });
        }
        else if (state.status === 'ready') detail.show(lastShown, { trailPoints: trail.length, lost: true, attribution });
      }
      onStatus({ ...state, count: state.aircraft.length });
    },
  });

  function select(hex) {
    selectedHex = hex;
    const a = hex ? service.find(hex) : null;
    lastShown = a;
    layer?.setSelected(hex, hex ? service.trail(hex) : []);
    detail.show(a, { trailPoints: hex ? service.trail(hex).length : 0, attribution });
    onSelectionChange(Boolean(a));
  }

  return {
    /** Call once the globe exists. */
    attach(globe) {
      layer = createLayer(globe, { onSelect: (hex) => select(hex) });
      layer.setAircraft(lastAircraft);
    },
    setEnabled(on) {
      if (on) service.start();
      else {
        select(null);
        service.stop();
      }
    },
    viewChanged: () => service.refresh(),
    refreshTheme: () => layer?.refreshTheme(),
    clearSelection: () => selectedHex && select(null),
    get selectedHex() {
      return selectedHex;
    },
  };
}
