/**
 * Administrative geography of Spain (shared by client and server).
 *
 * Codes are ISO 3166-2:ES. Province → comunidad membership follows the
 * Constitution/Estatutos de Autonomía; it is static reference data, not camera
 * data. Coordinates in QUICK_ACCESS_CITIES are city-centre navigation targets
 * only — they never imply camera coverage.
 */

/** @typedef {{ code: string, name: string, kind: 'community' | 'autonomous-city', center: [number, number], zoomKm: number }} Community */
/** @typedef {{ code: string, name: string, communityCode: string }} Province */
/** @typedef {{ id: string, name: string, provinceCode: string, lat: number, lon: number }} QuickCity */

/** @type {ReadonlyArray<Community>} center = [lon, lat] */
export const COMMUNITIES = Object.freeze([
  { code: 'ES-AN', name: 'Andalucía', kind: 'community', center: [-4.58, 37.46], zoomKm: 520 },
  { code: 'ES-AR', name: 'Aragón', kind: 'community', center: [-0.66, 41.52], zoomKm: 420 },
  { code: 'ES-AS', name: 'Principado de Asturias', kind: 'community', center: [-5.99, 43.29], zoomKm: 220 },
  { code: 'ES-IB', name: 'Illes Balears', kind: 'community', center: [2.9, 39.57], zoomKm: 320 },
  { code: 'ES-CN', name: 'Canarias', kind: 'community', center: [-15.6, 28.33], zoomKm: 560 },
  { code: 'ES-CB', name: 'Cantabria', kind: 'community', center: [-4.03, 43.2], zoomKm: 160 },
  { code: 'ES-CL', name: 'Castilla y León', kind: 'community', center: [-4.78, 41.75], zoomKm: 520 },
  { code: 'ES-CM', name: 'Castilla-La Mancha', kind: 'community', center: [-3.0, 39.58], zoomKm: 480 },
  { code: 'ES-CT', name: 'Cataluña', kind: 'community', center: [1.53, 41.8], zoomKm: 320 },
  { code: 'ES-VC', name: 'Comunitat Valenciana', kind: 'community', center: [-0.55, 39.4], zoomKm: 380 },
  { code: 'ES-EX', name: 'Extremadura', kind: 'community', center: [-6.15, 39.19], zoomKm: 380 },
  { code: 'ES-GA', name: 'Galicia', kind: 'community', center: [-7.91, 42.75], zoomKm: 300 },
  { code: 'ES-MD', name: 'Comunidad de Madrid', kind: 'community', center: [-3.7, 40.49], zoomKm: 170 },
  { code: 'ES-MC', name: 'Región de Murcia', kind: 'community', center: [-1.48, 38.0], zoomKm: 200 },
  { code: 'ES-NC', name: 'Comunidad Foral de Navarra', kind: 'community', center: [-1.65, 42.67], zoomKm: 220 },
  { code: 'ES-PV', name: 'País Vasco', kind: 'community', center: [-2.62, 43.04], zoomKm: 180 },
  { code: 'ES-RI', name: 'La Rioja', kind: 'community', center: [-2.52, 42.28], zoomKm: 140 },
  { code: 'ES-CE', name: 'Ceuta', kind: 'autonomous-city', center: [-5.32, 35.89], zoomKm: 14 },
  { code: 'ES-ML', name: 'Melilla', kind: 'autonomous-city', center: [-2.95, 35.29], zoomKm: 14 },
]);

/** @type {ReadonlyArray<Province>} */
export const PROVINCES = Object.freeze([
  // Andalucía
  { code: 'ES-AL', name: 'Almería', communityCode: 'ES-AN' },
  { code: 'ES-CA', name: 'Cádiz', communityCode: 'ES-AN' },
  { code: 'ES-CO', name: 'Córdoba', communityCode: 'ES-AN' },
  { code: 'ES-GR', name: 'Granada', communityCode: 'ES-AN' },
  { code: 'ES-H', name: 'Huelva', communityCode: 'ES-AN' },
  { code: 'ES-J', name: 'Jaén', communityCode: 'ES-AN' },
  { code: 'ES-MA', name: 'Málaga', communityCode: 'ES-AN' },
  { code: 'ES-SE', name: 'Sevilla', communityCode: 'ES-AN' },
  // Aragón
  { code: 'ES-HU', name: 'Huesca', communityCode: 'ES-AR' },
  { code: 'ES-TE', name: 'Teruel', communityCode: 'ES-AR' },
  { code: 'ES-Z', name: 'Zaragoza', communityCode: 'ES-AR' },
  // Uniprovinciales y archipiélagos
  { code: 'ES-O', name: 'Asturias', communityCode: 'ES-AS' },
  { code: 'ES-PM', name: 'Illes Balears', communityCode: 'ES-IB' },
  { code: 'ES-GC', name: 'Las Palmas', communityCode: 'ES-CN' },
  { code: 'ES-TF', name: 'Santa Cruz de Tenerife', communityCode: 'ES-CN' },
  { code: 'ES-S', name: 'Cantabria', communityCode: 'ES-CB' },
  // Castilla y León
  { code: 'ES-AV', name: 'Ávila', communityCode: 'ES-CL' },
  { code: 'ES-BU', name: 'Burgos', communityCode: 'ES-CL' },
  { code: 'ES-LE', name: 'León', communityCode: 'ES-CL' },
  { code: 'ES-P', name: 'Palencia', communityCode: 'ES-CL' },
  { code: 'ES-SA', name: 'Salamanca', communityCode: 'ES-CL' },
  { code: 'ES-SG', name: 'Segovia', communityCode: 'ES-CL' },
  { code: 'ES-SO', name: 'Soria', communityCode: 'ES-CL' },
  { code: 'ES-VA', name: 'Valladolid', communityCode: 'ES-CL' },
  { code: 'ES-ZA', name: 'Zamora', communityCode: 'ES-CL' },
  // Castilla-La Mancha
  { code: 'ES-AB', name: 'Albacete', communityCode: 'ES-CM' },
  { code: 'ES-CR', name: 'Ciudad Real', communityCode: 'ES-CM' },
  { code: 'ES-CU', name: 'Cuenca', communityCode: 'ES-CM' },
  { code: 'ES-GU', name: 'Guadalajara', communityCode: 'ES-CM' },
  { code: 'ES-TO', name: 'Toledo', communityCode: 'ES-CM' },
  // Cataluña
  { code: 'ES-B', name: 'Barcelona', communityCode: 'ES-CT' },
  { code: 'ES-GI', name: 'Girona', communityCode: 'ES-CT' },
  { code: 'ES-L', name: 'Lleida', communityCode: 'ES-CT' },
  { code: 'ES-T', name: 'Tarragona', communityCode: 'ES-CT' },
  // Comunitat Valenciana
  { code: 'ES-A', name: 'Alicante/Alacant', communityCode: 'ES-VC' },
  { code: 'ES-CS', name: 'Castellón/Castelló', communityCode: 'ES-VC' },
  { code: 'ES-V', name: 'Valencia/València', communityCode: 'ES-VC' },
  // Extremadura
  { code: 'ES-BA', name: 'Badajoz', communityCode: 'ES-EX' },
  { code: 'ES-CC', name: 'Cáceres', communityCode: 'ES-EX' },
  // Galicia
  { code: 'ES-C', name: 'A Coruña', communityCode: 'ES-GA' },
  { code: 'ES-LU', name: 'Lugo', communityCode: 'ES-GA' },
  { code: 'ES-OR', name: 'Ourense', communityCode: 'ES-GA' },
  { code: 'ES-PO', name: 'Pontevedra', communityCode: 'ES-GA' },
  // Uniprovinciales
  { code: 'ES-M', name: 'Madrid', communityCode: 'ES-MD' },
  { code: 'ES-MU', name: 'Murcia', communityCode: 'ES-MC' },
  { code: 'ES-NA', name: 'Navarra', communityCode: 'ES-NC' },
  // País Vasco
  { code: 'ES-VI', name: 'Araba/Álava', communityCode: 'ES-PV' },
  { code: 'ES-BI', name: 'Bizkaia', communityCode: 'ES-PV' },
  { code: 'ES-SS', name: 'Gipuzkoa', communityCode: 'ES-PV' },
  { code: 'ES-LO', name: 'La Rioja', communityCode: 'ES-RI' },
  // Ciudades autónomas
  { code: 'ES-CE', name: 'Ceuta', communityCode: 'ES-CE' },
  { code: 'ES-ML', name: 'Melilla', communityCode: 'ES-ML' },
]);

/** Navigation shortcuts requested for the Spain view. @type {ReadonlyArray<QuickCity>} */
export const QUICK_ACCESS_CITIES = Object.freeze([
  { id: 'madrid', name: 'Madrid', provinceCode: 'ES-M', lat: 40.4168, lon: -3.7038 },
  { id: 'barcelona', name: 'Barcelona', provinceCode: 'ES-B', lat: 41.3874, lon: 2.1686 },
  { id: 'valencia', name: 'Valencia', provinceCode: 'ES-V', lat: 39.4699, lon: -0.3763 },
  { id: 'alicante', name: 'Alicante', provinceCode: 'ES-A', lat: 38.3452, lon: -0.481 },
  { id: 'sevilla', name: 'Sevilla', provinceCode: 'ES-SE', lat: 37.3891, lon: -5.9845 },
  { id: 'malaga', name: 'Málaga', provinceCode: 'ES-MA', lat: 36.7213, lon: -4.4214 },
  { id: 'bilbao', name: 'Bilbao', provinceCode: 'ES-BI', lat: 43.263, lon: -2.935 },
  { id: 'zaragoza', name: 'Zaragoza', provinceCode: 'ES-Z', lat: 41.6488, lon: -0.8891 },
  { id: 'murcia', name: 'Murcia', provinceCode: 'ES-MU', lat: 37.9922, lon: -1.1307 },
  { id: 'palma', name: 'Palma', provinceCode: 'ES-PM', lat: 39.5696, lon: 2.6502 },
  { id: 'las-palmas', name: 'Las Palmas de Gran Canaria', provinceCode: 'ES-GC', lat: 28.1235, lon: -15.4363 },
  { id: 'santa-cruz-tenerife', name: 'Santa Cruz de Tenerife', provinceCode: 'ES-TF', lat: 28.4636, lon: -16.2518 },
  { id: 'ceuta', name: 'Ceuta', provinceCode: 'ES-CE', lat: 35.8894, lon: -5.3213 },
  { id: 'melilla', name: 'Melilla', provinceCode: 'ES-ML', lat: 35.2923, lon: -2.9381 },
]);

/** Whole-country framing: peninsula + Balearics; Canarias via its own shortcut. */
export const SPAIN_VIEW = Object.freeze({ lon: -3.7, lat: 40.0, zoomKm: 1250 });

/** Radius used when a quick-access city acts as a proximity filter. */
export const CITY_RADIUS_KM = 25;

const communityByCode = new Map(COMMUNITIES.map((c) => [c.code, c]));
const provinceByCode = new Map(PROVINCES.map((p) => [p.code, p]));
const cityById = new Map(QUICK_ACCESS_CITIES.map((c) => [c.id, c]));

export const getCommunity = (code) => communityByCode.get(code) ?? null;
export const getProvince = (code) => provinceByCode.get(code) ?? null;
export const getQuickCity = (id) => cityById.get(id) ?? null;

/** Provinces belonging to a community (all provinces when no community is given). */
export function provincesOf(communityCode) {
  if (!communityCode) return PROVINCES;
  return PROVINCES.filter((p) => p.communityCode === communityCode);
}

/** Community code for a province code, or null. */
export function communityOfProvince(provinceCode) {
  return provinceByCode.get(provinceCode)?.communityCode ?? null;
}
