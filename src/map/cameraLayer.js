/**
 * Camera markers on the globe. Diff-updates a single CustomDataSource (no
 * rebuild on filter change), clusters nearby markers by screen distance
 * (re-evaluated on zoom), and highlights the selected camera.
 */
import {
  CustomDataSource,
  Cartesian3,
  VerticalOrigin,
  HeightReference,
  NearFarScalar,
  BoundingSphere,
  HeadingPitchRange,
  Math as CesiumMath,
} from '@cesium/engine';

const MARKER_SIZE = 22;
const SELECTED_SIZE = 34;

/** Canvas-drawn icons, cached per colour/size/count so we draw each once. */
function createIconCache() {
  const cache = new Map();
  const draw = (key, size, paint) => {
    if (!cache.has(key)) {
      const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = Math.round(size * ratio);
      const ctx = canvas.getContext('2d');
      ctx.scale(ratio, ratio);
      paint(ctx, size);
      cache.set(key, canvas);
    }
    return cache.get(key);
  };
  return {
    marker(fill, ring, size) {
      return draw(`m:${fill}:${ring}:${size}`, size, (ctx, s) => {
        const r = s / 2;
        ctx.beginPath();
        ctx.arc(r, r, r - 1.5, 0, Math.PI * 2);
        ctx.fillStyle = ring;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(r, r, r - 4, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();
        // tiny lens glyph
        ctx.beginPath();
        ctx.arc(r, r, Math.max(2, r * 0.28), 0, Math.PI * 2);
        ctx.fillStyle = ring;
        ctx.fill();
      });
    },
    cluster(count, fill, ring, text) {
      const label = count >= 1000 ? `${Math.floor(count / 1000)}k` : String(count);
      const size = count >= 1000 ? 50 : count >= 100 ? 44 : count >= 10 ? 38 : 32;
      return draw(`c:${label}:${fill}:${ring}:${text}`, size, (ctx, s) => {
        const r = s / 2;
        ctx.beginPath();
        ctx.arc(r, r, r - 1, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.globalAlpha = 0.28;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(r, r, r - 6, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = ring;
        ctx.stroke();
        ctx.fillStyle = text;
        ctx.font = `600 ${s >= 44 ? 14 : 12}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, r, r + 0.5);
      });
    },
  };
}

const cssVar = (name, fallback) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/**
 * @param {ReturnType<import('./globe.js').createGlobe>} globe
 * @param {{ onSelect: (cameraId: string) => void }} handlers
 */
export function createCameraLayer(globe, { onSelect }) {
  const { viewer, scene } = globe;
  const source = new CustomDataSource('cameras');
  const icons = createIconCache();
  /** @type {Map<string, import('cesium').Entity>} */
  const entities = new Map();
  let selectedId = null;
  let palette = readPalette();

  function readPalette() {
    return {
      marker: cssVar('--marker', '#00808a'),
      ring: cssVar('--marker-ring', '#ffffff'),
      selected: cssVar('--marker-selected', '#e8590c'),
      clusterText: cssVar('--accent-contrast', '#ffffff'),
    };
  }

  const markerImage = (id) =>
    id === selectedId
      ? icons.marker(palette.selected, palette.ring, SELECTED_SIZE)
      : icons.marker(palette.marker, palette.ring, MARKER_SIZE);

  source.clustering.enabled = true;
  source.clustering.pixelRange = 42;
  source.clustering.minimumClusterSize = 3;
  source.clustering.clusterEvent.addEventListener((clustered, cluster) => {
    cluster.label.show = false;
    cluster.billboard.show = true;
    cluster.billboard.id = clustered; // picked.id → array of member entities (see pick handler)
    cluster.billboard.verticalOrigin = VerticalOrigin.CENTER;
    cluster.billboard.image = icons.cluster(clustered.length, palette.marker, palette.ring, palette.clusterText);
  });
  viewer.dataSources.add(source);

  const removePick = globe.onPick((picked) => {
    const id = picked?.id;
    if (!id) return;
    // A single camera entity carries our camera id on `cameraId`.
    if (id.cameraId) {
      onSelect(id.cameraId);
      return;
    }
    // Cluster billboard: Cesium exposes the clustered entities on picked.id as an array.
    const members = Array.isArray(id) ? id : null;
    if (members?.length) zoomToEntities(members);
  });

  const removeHover = globe.onHover((picked) => {
    scene.canvas.style.cursor = picked?.id ? 'pointer' : '';
  });

  function zoomToEntities(members) {
    const positions = members.map((e) => e.position?.getValue?.(viewer.clock.currentTime)).filter(Boolean);
    if (!positions.length) return;
    const sphere = BoundingSphere.fromPoints(positions);
    viewer.camera.flyToBoundingSphere(sphere, {
      offset: new HeadingPitchRange(0, CesiumMath.toRadians(-90), Math.max(sphere.radius * 3.2, 2500)),
      duration: globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 1.2,
    });
  }

  return {
    /** Diff the rendered markers against `cameras`. */
    setCameras(cameras) {
      const next = new Set();
      source.entities.suspendEvents();
      try {
        for (const camera of cameras) {
          next.add(camera.id);
          if (entities.has(camera.id)) continue;
          const entity = source.entities.add({
            id: `cam-${camera.id}`,
            position: Cartesian3.fromDegrees(camera.lon, camera.lat),
            billboard: {
              image: markerImage(camera.id),
              verticalOrigin: VerticalOrigin.CENTER,
              heightReference: HeightReference.NONE,
              scaleByDistance: new NearFarScalar(2e5, 1, 8e6, 0.7),
            },
          });
          entity.cameraId = camera.id;
          entities.set(camera.id, entity);
        }
        for (const [id, entity] of entities) {
          if (next.has(id)) continue;
          source.entities.remove(entity);
          entities.delete(id);
        }
      } finally {
        source.entities.resumeEvents();
      }
      scene.requestRender();
    },

    /** Show or hide every camera marker (layers panel). */
    setVisible(on) {
      source.show = on;
      scene.requestRender();
    },

    setSelected(id) {
      const previous = selectedId;
      selectedId = id;
      for (const changed of [previous, id]) {
        const entity = changed ? entities.get(changed) : null;
        if (entity) entity.billboard.image = markerImage(changed);
      }
      scene.requestRender();
    },

    /** Re-read theme colours and redraw every marker/cluster icon. */
    refreshTheme() {
      palette = readPalette();
      for (const [id, entity] of entities) entity.billboard.image = markerImage(id);
      // Toggling forces the cluster event to re-run with the new palette.
      source.clustering.enabled = false;
      source.clustering.enabled = true;
      scene.requestRender();
    },

    destroy() {
      removePick();
      removeHover();
      viewer.dataSources.remove(source, true);
      entities.clear();
    },
  };
}
