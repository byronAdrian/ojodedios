/**
 * OpenSky Network worldwide state vectors — the only open source offering
 * every tracked aircraft in one request. Licence: non-commercial; an
 * operational/commercial deployment needs an agreement with OpenSky.
 *
 * /api/states/all costs 4 credits per call. Budgets (OpenSky docs):
 * anonymous ≈ 400 credits/day, registered account ≈ 4000/day. The handler turns
 * that into a cache TTL so one shared snapshot serves every visitor.
 *
 * State vector (OpenSky REST docs): [icao24, callsign, origin_country,
 * time_position, last_contact, longitude, latitude, baro_altitude (m),
 * on_ground, velocity (m/s), true_track (°), vertical_rate, sensors,
 * geo_altitude, squawk, spi, position_source, category]
 */
import { safeFetch, decodeText } from '../http/safeFetch.js';

export const OPENSKY_STATES_URL = 'https://opensky-network.org/api/states/all';
const OPENSKY_HOSTS = ['opensky-network.org'];
const TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const TOKEN_HOSTS = ['auth.opensky-network.org'];
const MAX_POSITION_AGE_S = 120;

/** TTL from the remaining credit budget (header X-Rate-Limit-Remaining). */
export function openskyTtlMs({ authenticated, remaining }) {
  if (!authenticated) return 15 * 60_000; // ~96 calls/day < 100 anonymous calls
  if (!Number.isFinite(remaining) || remaining > 2000) return 90_000;
  if (remaining > 800) return 180_000;
  return 600_000;
}

/** Compact tuple per aircraft: [hex, callsign, lat, lon, altM, onGround, speedKmh, track]. */
export function normalizeOpenSky(payload) {
  const states = payload?.states;
  if (!Array.isArray(states)) throw new Error('Formato OpenSky no reconocido: sin "states"');
  const now = Number(payload.time) || Math.floor(Date.now() / 1000);
  const out = [];
  for (const s of states) {
    if (!Array.isArray(s)) continue;
    const hex = String(s[0] ?? '').trim().toLowerCase();
    const lon = Number(s[5]);
    const lat = Number(s[6]);
    if (!/^[0-9a-f]{6}$/.test(hex) || s[5] === null || s[6] === null || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (Number.isFinite(Number(s[3])) && now - Number(s[3]) > MAX_POSITION_AGE_S) continue;
    const alt = s[8] ? 0 : Number.isFinite(Number(s[7])) && s[7] !== null ? Math.round(Number(s[7])) : null;
    const speed = s[9] === null || !Number.isFinite(Number(s[9])) ? null : Math.round(Number(s[9]) * 3.6);
    const track = s[10] === null || !Number.isFinite(Number(s[10])) ? null : Math.round(Number(s[10]));
    const callsign = String(s[1] ?? '').trim().replace(/[^\w.-]/g, '').slice(0, 10) || null;
    out.push([hex, callsign, Math.round(lat * 1e4) / 1e4, Math.round(lon * 1e4) / 1e4, alt, Boolean(s[8]), speed, track]);
  }
  return out;
}

/** OAuth2 client-credentials token cache (only when both env vars are set). */
export function createOpenSkyClient({ env, fetchImpl, now }) {
  let token = null;
  let tokenExpiry = 0;
  const hasCredentials = Boolean(env.OPENSKY_CLIENT_ID && env.OPENSKY_CLIENT_SECRET);

  async function accessToken() {
    if (!hasCredentials) return null;
    if (token && now() < tokenExpiry - 60_000) return token;
    const form = new URLSearchParams({ grant_type: 'client_credentials', client_id: env.OPENSKY_CLIENT_ID, client_secret: env.OPENSKY_CLIENT_SECRET });
    const { body } = await safeFetch(TOKEN_URL, {
      allowedHosts: TOKEN_HOSTS,
      method: 'POST',
      body: form.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      fetchImpl,
      timeoutMs: 8_000,
    });
    const data = JSON.parse(decodeText(body));
    if (!data?.access_token) throw new Error('OpenSky: credenciales rechazadas');
    token = data.access_token;
    tokenExpiry = now() + (Number(data.expires_in) || 1800) * 1000;
    return token;
  }

  return {
    hasCredentials,
    /** @returns {Promise<{ aircraft: Array, remaining: number, authenticated: boolean }>} */
    async snapshot() {
      const bearer = await accessToken();
      const { body, headers } = await safeFetch(OPENSKY_STATES_URL, {
        allowedHosts: OPENSKY_HOSTS,
        fetchImpl,
        timeoutMs: 15_000,
        maxBytes: 20 * 1024 * 1024,
        headers: { Accept: 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      });
      return {
        aircraft: normalizeOpenSky(JSON.parse(decodeText(body))),
        remaining: Number(headers.get('x-rate-limit-remaining')),
        authenticated: Boolean(bearer),
      };
    },
  };
}
