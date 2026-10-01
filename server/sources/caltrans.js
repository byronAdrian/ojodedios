/**
 * Caltrans CWWP2 — CCTV status files, one JSON per district (keyless, public).
 * https://cwwp2.dot.ca.gov/documentation/cctv/cctv.htm
 *
 * Record shape (documented; verified against a real record):
 *   { cctv: { index, inService: "true", location: { district, locationName,
 *     nearbyPlace, latitude, longitude, county, route, direction },
 *     imageData: { streamingVideoURL, static: { currentImageURL,
 *     currentImageUpdateFrequency } } } }
 *
 * Stills are served from cwwp2.dot.ca.gov under /data/dN/cctv/image/…; the id
 * encodes that path (base64url) and /api/frame re-validates it when decoding.
 */
export const CALTRANS_HOST = 'cwwp2.dot.ca.gov';
export const CALTRANS_ALLOWED_HOSTS = [CALTRANS_HOST];
export const CALTRANS_DISTRICTS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
const IMAGE_PATH = /^\/data\/d(?:[1-9]|1[0-2])\/cctv\/image\/[A-Za-z0-9_.-]{1,80}\/[A-Za-z0-9_.-]{1,80}\.jpe?g$/i;

export function caltransDistrictUrl(district) {
  if (!CALTRANS_DISTRICTS.includes(district)) return null;
  return `https://${CALTRANS_HOST}/data/d${district}/cctv/cctvStatusD${String(district).padStart(2, '0')}.json`;
}

/** Path of an accepted still URL, or null. */
export function caltransImagePath(rawUrl) {
  try {
    const url = new URL(String(rawUrl).trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.hostname.toLowerCase() !== CALTRANS_HOST || url.username || url.password || url.port || url.search || url.hash) return null;
    return IMAGE_PATH.test(url.pathname) && !url.pathname.includes('..') ? url.pathname : null;
  } catch {
    return null;
  }
}

export const caltransNativeId = (path) => Buffer.from(path, 'utf8').toString('base64url');

export function caltransFrameUrl(nativeId) {
  if (!/^[A-Za-z0-9_-]{8,240}$/.test(nativeId)) return null;
  const path = Buffer.from(nativeId, 'base64url').toString('utf8');
  const url = `https://${CALTRANS_HOST}${path}`;
  return caltransImagePath(url) === path ? url : null;
}

const text = (value, max) => (typeof value === 'string' || typeof value === 'number' ? String(value).replace(/\s+/g, ' ').trim().slice(0, max) : '');

/**
 * @param {Array<{ district: number, body: unknown }>} files parsed district files
 * @returns {{ rows: object[], notes: object }}
 */
export function parseCaltransDistricts(files, { checkedAt }) {
  const rows = [];
  let records = 0;
  let outOfService = 0;
  let noImage = 0;
  let badLocation = 0;
  for (const { district, body } of files) {
    const data = Array.isArray(body?.data) ? body.data : [];
    for (const raw of data) {
      records += 1;
      const cctv = raw?.cctv && typeof raw.cctv === 'object' ? raw.cctv : null;
      if (!cctv || cctv.inService !== 'true') {
        outOfService += 1;
        continue;
      }
      const path = caltransImagePath(cctv.imageData?.static?.currentImageURL);
      if (!path) {
        noImage += 1;
        continue;
      }
      const location = cctv.location && typeof cctv.location === 'object' ? cctv.location : {};
      const lat = Number(location.latitude);
      const lon = Number(location.longitude);
      // California and its borders only: a swapped or zero coordinate is dropped, not guessed.
      if (!(lat > 32 && lat < 42.1 && lon > -124.6 && lon < -114)) {
        badLocation += 1;
        continue;
      }
      const minutes = Number(cctv.imageData?.static?.currentImageUpdateFrequency);
      const nativeId = caltransNativeId(path);
      const place = text(location.nearbyPlace, 60);
      rows.push({
        id: `caltrans:${nativeId}`,
        name: text(location.locationName, 120) || `Caltrans D${district}`,
        countryCode: 'US',
        city: place || null,
        lat,
        lon,
        category: 'traffic',
        mediaUrl: `/api/frame?id=caltrans:${nativeId}`,
        mediaType: 'image',
        liveness: 'periodic',
        refreshSeconds: Number.isFinite(minutes) && minutes > 0 && minutes <= 60 ? Math.round(minutes * 60) : 0,
        status: 'active', // the file flags each camera inService="true"
        checkedAt,
      });
    }
  }
  if (!rows.length) throw new Error(`Caltrans: ninguna cámara utilizable (${records} registros)`);
  return { rows, notes: { records, outOfService, noImage, badLocation } };
}

/**
 * Downloads every district file with bounded concurrency. A district that fails
 * is reported in notes instead of hiding the other eleven.
 * @param {(url: string) => Promise<unknown>} getJson
 */
export async function loadCaltransDistricts(getJson, { concurrency = 4 } = {}) {
  const files = [];
  const failed = [];
  const queue = [...CALTRANS_DISTRICTS];
  async function worker() {
    while (queue.length) {
      const district = queue.shift();
      try {
        files.push({ district, body: await getJson(caltransDistrictUrl(district)) });
      } catch (error) {
        failed.push(`D${district}: ${String(error?.message || error).slice(0, 60)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  if (!files.length) throw new Error(`Caltrans: ningún distrito disponible (${failed.join(' · ').slice(0, 200)})`);
  files.sort((a, b) => a.district - b.district);
  return { files, failed };
}
