/**
 * Earthquake and fire markers. Plain PointPrimitiveCollections: thousands of
 * fire points stay cheap, and each point carries its datum for picking.
 */
import { PointPrimitiveCollection, Cartesian3, Color, NearFarScalar } from '@cesium/engine';
import { quakeSize, quakeLevel, fireSize } from './hazards.js';

const cssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/**
 * @param {ReturnType<import('../map/globe.js').createGlobe>} globe
 * @param {{ onSelect: (pick: { kind: 'quake' | 'fire', data: object } | null) => void }} handlers
 */
export function createHazardLayer(globe, { onSelect }) {
  const { scene } = globe;
  const quakes = scene.primitives.add(new PointPrimitiveCollection());
  const fires = scene.primitives.add(new PointPrimitiveCollection());
  let palette = readPalette();
  let lastQuakes = [];
  let lastFires = [];
  let selected = null; // the datum currently highlighted

  function readPalette() {
    return {
      quake: Color.fromCssColorString(cssVar('--quake', '#ffd84d')),
      strong: Color.fromCssColorString(cssVar('--quake-strong', '#ff6b6b')),
      fire: Color.fromCssColorString(cssVar('--fire', '#ff7a1a')),
      ring: Color.fromCssColorString(cssVar('--marker-ring', '#000000')),
      selected: Color.fromCssColorString(cssVar('--marker-selected', '#ffffff')),
    };
  }

  const scale = new NearFarScalar(2e5, 1.15, 1.2e7, 0.6);

  function drawQuakes(events) {
    quakes.removeAll();
    for (const event of events) {
      const strong = quakeLevel(event.mag) === 'strong';
      quakes.add({
        position: Cartesian3.fromDegrees(event.lon, event.lat),
        pixelSize: quakeSize(event.mag),
        color: (strong ? palette.strong : palette.quake).withAlpha(0.85),
        outlineColor: event === selected ? palette.selected : palette.ring,
        outlineWidth: event === selected ? 3 : 1.5,
        scaleByDistance: scale,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        id: { hazard: 'quake', data: event },
      });
    }
  }

  function drawFires(points) {
    fires.removeAll();
    for (const point of points) {
      fires.add({
        position: Cartesian3.fromDegrees(point.lon, point.lat),
        pixelSize: fireSize(point.frp),
        color: palette.fire.withAlpha(0.85),
        outlineColor: point === selected ? palette.selected : palette.ring,
        outlineWidth: point === selected ? 2.5 : 0.8,
        scaleByDistance: scale,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        id: { hazard: 'fire', data: point },
      });
    }
  }

  const removePick = globe.onPick((picked) => {
    const tag = picked?.id;
    if (tag && (tag.hazard === 'quake' || tag.hazard === 'fire')) onSelect({ kind: tag.hazard, data: tag.data });
  });

  return {
    setQuakes(events, visible) {
      lastQuakes = events;
      quakes.show = visible;
      drawQuakes(visible ? events : []);
      scene.requestRender();
    },
    setFires(points, visible) {
      lastFires = points;
      fires.show = visible;
      drawFires(visible ? points : []);
      scene.requestRender();
    },
    /** Highlight one datum (or none) by redrawing with its outline. */
    setSelected(datum) {
      selected = datum;
      if (quakes.show) drawQuakes(lastQuakes);
      if (fires.show) drawFires(lastFires);
      scene.requestRender();
    },
    refreshTheme() {
      palette = readPalette();
      if (quakes.show) drawQuakes(lastQuakes);
      if (fires.show) drawFires(lastFires);
      scene.requestRender();
    },
    destroy() {
      removePick();
      scene.primitives.remove(quakes);
      scene.primitives.remove(fires);
    },
  };
}
