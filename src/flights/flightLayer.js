/**
 * Aircraft on the globe: heading-rotated icons (diffed by ICAO hex, never
 * rebuilt), plus the observed trail and callsign of the selected aircraft.
 */
import {
  CustomDataSource,
  Cartesian3,
  Color,
  ConstantPositionProperty,
  NearFarScalar,
  VerticalOrigin,
  LabelStyle,
  Cartesian2,
  Math as CesiumMath,
} from '@cesium/engine';

const cssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

function planeIcon(fill, stroke) {
  const size = 28;
  const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.round(size * ratio);
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  ctx.translate(size / 2, size / 2);
  // Nose up (north); rotated per aircraft track.
  const p = new Path2D('M0 -12 L2 -4 L11 2 L11 4.5 L2 1.5 L1.5 8 L4.5 10.5 L4.5 12 L0 10.8 L-4.5 12 L-4.5 10.5 L-1.5 8 L-2 1.5 L-11 4.5 L-11 2 L-2 -4 Z');
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = stroke;
  ctx.stroke(p);
  ctx.fillStyle = fill;
  ctx.fill(p);
  return canvas;
}

/**
 * @param {ReturnType<import('../map/globe.js').createGlobe>} globe
 * @param {{ onSelect: (hex: string) => void }} handlers
 */
export function createFlightLayer(globe, { onSelect }) {
  const { viewer, scene } = globe;
  const source = new CustomDataSource('flights');
  viewer.dataSources.add(source);
  /** @type {Map<string, import('@cesium/engine').Entity>} */
  const entities = new Map();
  let selected = null;
  let icons;
  let wakeColor = Color.WHITE.withAlpha(0.35);
  const WAKE_POINTS = 12;
  const trail = source.entities.add({
    id: 'flight-trail',
    show: false,
    polyline: { positions: [], width: 2.5, material: Color.CYAN },
  });

  function paletteIcons() {
    icons = {
      normal: planeIcon(cssVar('--flight', '#2563eb'), cssVar('--marker-ring', '#ffffff')),
      selected: planeIcon(cssVar('--marker-selected', '#e8590c'), cssVar('--marker-ring', '#ffffff')),
      ground: planeIcon(cssVar('--text-3', '#6b7280'), cssVar('--marker-ring', '#ffffff')),
    };
    trail.polyline.material = Color.fromCssColorString(cssVar('--marker-selected', '#e8590c')).withAlpha(0.9);
    wakeColor = Color.fromCssColorString(cssVar('--flight', '#2563eb')).withAlpha(0.45);
  }
  paletteIcons();

  const iconFor = (a) => (a.hex === selected ? icons.selected : a.onGround ? icons.ground : icons.normal);
  const heightOf = (a) => (a.onGround ? 0 : Math.max(0, a.altitudeM ?? 0));

  const removePick = globe.onPick((picked) => {
    const hex = picked?.id?.flightHex;
    if (hex) onSelect(hex);
  });

  return {
    /**
     * @param {object[]} aircraft
     * @param {(hex: string) => Array<[number, number, number]>} [trailOf] short wake per aircraft
     */
    setAircraft(aircraft, trailOf = () => []) {
      const seen = new Set();
      source.entities.suspendEvents();
      try {
        for (const a of aircraft) {
          seen.add(a.hex);
          const position = Cartesian3.fromDegrees(a.lon, a.lat, heightOf(a));
          const rotation = -CesiumMath.toRadians(a.track ?? 0);
          let entity = entities.get(a.hex);
          if (!entity) {
            entity = source.entities.add({
              id: `flight-${a.hex}`,
              position: new ConstantPositionProperty(position),
              billboard: {
                image: iconFor(a),
                rotation,
                verticalOrigin: VerticalOrigin.CENTER,
                scaleByDistance: new NearFarScalar(1e5, 1.1, 6e6, 0.55),
              },
              label: {
                text: a.callsign || a.registration || a.hex.toUpperCase(),
                show: a.hex === selected,
                font: '600 13px system-ui, sans-serif',
                style: LabelStyle.FILL_AND_OUTLINE,
                outlineWidth: 3,
                outlineColor: Color.BLACK.withAlpha(0.7),
                fillColor: Color.WHITE,
                pixelOffset: new Cartesian2(0, -24),
              },
            });
            entity.flightHex = a.hex;
            entity.onGround = a.onGround;
            entity.polyline = { positions: [], width: 1.5, material: wakeColor };
            entities.set(a.hex, entity);
          } else {
            entity.onGround = a.onGround;
            entity.position.setValue(position);
            entity.billboard.rotation = rotation;
            entity.billboard.image = iconFor(a);
          }
          const wake = a.hex === selected ? [] : trailOf(a.hex).slice(-WAKE_POINTS);
          entity.polyline.positions = wake.length > 1 ? Cartesian3.fromDegreesArrayHeights(wake.flat()) : [];
        }
        for (const [hex, entity] of entities) {
          if (seen.has(hex)) continue;
          source.entities.remove(entity);
          entities.delete(hex);
        }
      } finally {
        source.entities.resumeEvents();
      }
      scene.requestRender();
    },

    /** @param {string | null} hex @param {Array<[number, number, number]>} points */
    setSelected(hex, points = []) {
      const previous = selected;
      selected = hex;
      for (const key of [previous, hex]) {
        const entity = key ? entities.get(key) : null;
        if (!entity) continue;
        entity.label.show = key === hex;
        if (key === hex) entity.polyline.positions = []; // the full route replaces the short wake
        entity.billboard.image = key === hex ? icons.selected : entity.onGround ? icons.ground : icons.normal;
      }
      trail.show = Boolean(hex) && points.length > 1;
      trail.polyline.positions = points.length > 1 ? Cartesian3.fromDegreesArrayHeights(points.flat()) : [];
      scene.requestRender();
    },

    refreshTheme() {
      paletteIcons();
      for (const entity of entities.values()) {
        entity.billboard.image = entity.flightHex === selected ? icons.selected : entity.onGround ? icons.ground : icons.normal;
      }
      scene.requestRender();
    },

    destroy() {
      removePick();
      viewer.dataSources.remove(source, true);
      entities.clear();
    },
  };
}
