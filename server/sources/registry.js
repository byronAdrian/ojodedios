/**
 * Provider registry: the ONLY place that maps a provider id to upstream URLs.
 * Adding a provider = one adapter module + one entry here + one PROVIDERS entry
 * in src/domain/camera.js. Nothing else in the app changes.
 */
import { createCamera } from '../../src/domain/camera.js';
import { safeFetch, decodeText, UpstreamError } from '../http/safeFetch.js';
import { DGT_CATALOG_URLS, DGT_ALLOWED_HOSTS, DGT_FRAME_HOSTS, parseDgtCatalog, dgtFrameUrl } from './dgt.js';
import { MADRID_CATALOG_URL, MADRID_ALLOWED_HOSTS, parseMadridKml, madridFrameUrl } from './madrid.js';
import { loadLivestreams } from './livestreams.js';
import { TFL_ALLOWED_HOSTS, tflCatalogUrl, parseTflCatalog } from './tfl.js';
import {
  FINTRAFFIC_CATALOG_URL,
  FINTRAFFIC_ALLOWED_HOSTS,
  DIGITRAFFIC_HEADERS,
  parseFintrafficCatalog,
} from './fintraffic.js';

/**
 * @typedef {object} SourceDefinition
 * @property {string} id
 * @property {'spain' | 'world'} region      which explorer loads it first
 * @property {string} envFlag                 set to "0" to disable
 * @property {(env: Record<string,string|undefined>, deps: object) => Promise<object[]>} loadRaw
 * @property {((nativeId: string) => string | null) | null} frameUrl  only for proxied (http) providers
 * @property {string[]} frameHosts
 */

const text = async (url, allowedHosts, deps, headers) =>
  decodeText((await safeFetch(url, { allowedHosts, headers, fetchImpl: deps.fetchImpl })).body);
/** Try each official URL in order; only a 404 moves on to the next one. */
async function firstAvailable(urls, allowedHosts, deps) {
  let lastError;
  for (const url of urls) {
    try {
      return await text(url, allowedHosts, deps);
    } catch (error) {
      lastError = error;
      if (!(error instanceof UpstreamError && error.status === 404)) throw error;
    }
  }
  throw lastError;
}
const json = async (url, allowedHosts, deps, headers) => JSON.parse(await text(url, allowedHosts, deps, headers));

/** @type {Record<string, SourceDefinition>} */
export const SOURCES = Object.freeze({
  dgt: {
    id: 'dgt',
    region: 'spain',
    envFlag: 'SOURCE_DGT_ENABLED',
    loadRaw: async (env, deps) => parseDgtCatalog(await firstAvailable(DGT_CATALOG_URLS, DGT_ALLOWED_HOSTS, deps), deps),
    frameUrl: dgtFrameUrl,
    frameHosts: DGT_FRAME_HOSTS,
  },
  madrid: {
    id: 'madrid',
    region: 'spain',
    envFlag: 'SOURCE_MADRID_ENABLED',
    loadRaw: async (env, deps) =>
      parseMadridKml(await text(MADRID_CATALOG_URL, MADRID_ALLOWED_HOSTS, deps), deps),
    frameUrl: madridFrameUrl,
    frameHosts: ['informo.munimadrid.es', 'informo.madrid.es'],
  },
  livestream: {
    id: 'livestream',
    region: 'spain',
    envFlag: 'SOURCE_LIVESTREAM_ENABLED',
    loadRaw: async (env, deps) => loadLivestreams(deps),
    frameUrl: null,
    frameHosts: [],
  },
  tfl: {
    id: 'tfl',
    region: 'world',
    envFlag: 'SOURCE_TFL_ENABLED',
    loadRaw: async (env, deps) =>
      parseTflCatalog(await json(tflCatalogUrl(env.TFL_APP_KEY), TFL_ALLOWED_HOSTS, deps), deps),
    frameUrl: null,
    frameHosts: [],
  },
  fintraffic: {
    id: 'fintraffic',
    region: 'world',
    envFlag: 'SOURCE_FINTRAFFIC_ENABLED',
    loadRaw: async (env, deps) =>
      parseFintrafficCatalog(
        await json(FINTRAFFIC_CATALOG_URL, FINTRAFFIC_ALLOWED_HOSTS, deps, DIGITRAFFIC_HEADERS),
        deps,
      ),
    frameUrl: null,
    frameHosts: [],
  },
});

export const isSourceEnabled = (source, env) => String(env[source.envFlag] ?? '1') !== '0';

/** Load, normalize and de-duplicate one provider's catalog. */
export async function loadCatalog(sourceId, { env = process.env, fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
  const source = SOURCES[sourceId];
  if (!source) throw new Error(`Unknown source: ${sourceId}`);
  const checkedAt = now().toISOString();
  const raw = await source.loadRaw(env, { fetchImpl, checkedAt });
  const seen = new Set();
  const cameras = [];
  let rejected = 0;
  for (const row of raw) {
    const camera = createCamera(row);
    if (!camera || seen.has(camera.id)) {
      rejected += 1;
      continue;
    }
    seen.add(camera.id);
    cameras.push(camera);
  }
  if (!cameras.length) {
    throw new Error(`${sourceId}: el catálogo no contiene cámaras válidas (${raw.length} filas, ${rejected} rechazadas)`);
  }
  return { sourceId, checkedAt, cameras, rejected };
}
