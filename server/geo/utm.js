/**
 * Inverse Transverse Mercator for UTM on GRS80/ETRS89 (≈ WGS84 at map
 * precision). Used for Spanish catalogs published in EPSG:258xx metres.
 * Snyder (USGS PP 1395) series; error < 1 m within a zone.
 */
const A = 6378137;
const F = 1 / 298.257222101;
const K0 = 0.9996;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const E1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
const DEG = 180 / Math.PI;

/**
 * @param {number} easting   metres
 * @param {number} northing  metres (northern hemisphere)
 * @param {number} zone      1–60
 * @returns {{ lat: number, lon: number } | null}
 */
export function utmToLatLon(easting, northing, zone) {
  if (![easting, northing, zone].every(Number.isFinite) || zone < 1 || zone > 60) return null;
  if (easting < 100_000 || easting > 900_000 || northing < 0 || northing > 9_400_000) return null;
  const x = easting - 500_000;
  const m = northing / K0;
  const mu = m / (A * (1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256));
  const phi1 =
    mu +
    ((3 * E1) / 2 - (27 * E1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * E1 ** 2) / 16 - (55 * E1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * E1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * E1 ** 4) / 512) * Math.sin(8 * mu);
  const sin1 = Math.sin(phi1);
  const cos1 = Math.cos(phi1);
  const tan1 = Math.tan(phi1);
  const n1 = A / Math.sqrt(1 - E2 * sin1 ** 2);
  const t1 = tan1 ** 2;
  const c1 = EP2 * cos1 ** 2;
  const r1 = (A * (1 - E2)) / (1 - E2 * sin1 ** 2) ** 1.5;
  const d = x / (n1 * K0);
  const lat =
    phi1 -
    ((n1 * tan1) / r1) *
      (d ** 2 / 2 -
        ((5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * EP2) * d ** 4) / 24 +
        ((61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * EP2 - 3 * c1 ** 2) * d ** 6) / 720);
  const lon =
    (d -
      ((1 + 2 * t1 + c1) * d ** 3) / 6 +
      ((5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * EP2 + 24 * t1 ** 2) * d ** 5) / 120) /
    cos1;
  const centralMeridian = (zone - 1) * 6 - 180 + 3;
  return { lat: lat * DEG, lon: centralMeridian + lon * DEG };
}
