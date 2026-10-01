import data from './spainProvinces.data.js';
import { communityOfProvince } from '../../src/domain/spain.js';

/**
 * Point-in-polygon lookup of the Spanish province (and therefore comunidad)
 * containing a coordinate. Polygons are Natural Earth admin-1 simplified to
 * ~0.01° (~1 km), so points within ~1 km of a provincial border or the coast
 * may resolve to the neighbour or to nothing; a nearest-bbox fallback within
 * NEAR_COAST_DEG handles harbour/coastal cameras that fall just offshore.
 */
const NEAR_COAST_DEG = 0.03;

/** Ray-casting test on one ring of [lon, lat] vertices (open or closed). */
function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPolygon(lon, lat, rings) {
  if (!pointInRing(lon, lat, rings[0])) return false;
  for (let h = 1; h < rings.length; h += 1) {
    if (pointInRing(lon, lat, rings[h])) return false;
  }
  return true;
}

const inBbox = (lon, lat, [w, s, e, n], pad = 0) =>
  lon >= w - pad && lon <= e + pad && lat >= s - pad && lat <= n + pad;

/**
 * @param {number} lat
 * @param {number} lon
 * @returns {{ provinceCode: string, communityCode: string } | null}
 */
export function lookupSpanishRegion(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  for (const province of data.provinces) {
    if (!inBbox(lon, lat, province.bbox)) continue;
    if (province.polygons.some((rings) => pointInPolygon(lon, lat, rings))) {
      return { provinceCode: province.iso, communityCode: communityOfProvince(province.iso) };
    }
  }
  // Coastal fallback: unique province whose padded bbox contains the point.
  const near = data.provinces.filter((p) => inBbox(lon, lat, p.bbox, NEAR_COAST_DEG));
  if (near.length === 1) {
    return { provinceCode: near[0].iso, communityCode: communityOfProvince(near[0].iso) };
  }
  return null;
}
