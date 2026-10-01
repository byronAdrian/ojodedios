/**
 * Basemap configuration (pure, testable). Default: Esri "Canvas" light/dark
 * gray basemaps, served keyless from services.arcgisonline.com with required
 * attribution. CARTO's public tiles now answer "API KEY REQUIRED", so they are
 * no longer the default.
 *
 * Override at build time (public values, visible in the bundle):
 *   VITE_BASEMAP_LIGHT_URL / VITE_BASEMAP_DARK_URL  — {z}/{x}/{y} templates
 *   VITE_BASEMAP_ATTRIBUTION                        — plain text credit
 * A custom host must also be added to img-src/connect-src in vercel.json.
 */
const ESRI = 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas';

export const DEFAULT_BASEMAPS = Object.freeze({
  light: `${ESRI}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
  dark: `${ESRI}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
  attribution: 'Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS user community',
  maximumLevel: 16,
});

const isTemplate = (value) =>
  typeof value === 'string' && /^https:\/\/[^\s]+$/.test(value) && value.includes('{z}') && value.includes('{x}') && value.includes('{y}');

/** @returns {{ light: string, dark: string, attribution: string, maximumLevel: number }} */
export function resolveBasemaps(env = {}) {
  const light = isTemplate(env.VITE_BASEMAP_LIGHT_URL) ? env.VITE_BASEMAP_LIGHT_URL : null;
  const dark = isTemplate(env.VITE_BASEMAP_DARK_URL) ? env.VITE_BASEMAP_DARK_URL : null;
  if (!light && !dark) return DEFAULT_BASEMAPS;
  return {
    light: light ?? dark,
    dark: dark ?? light,
    attribution: String(env.VITE_BASEMAP_ATTRIBUTION || '© OpenStreetMap contributors').slice(0, 200),
    maximumLevel: 18,
  };
}
