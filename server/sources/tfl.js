/**
 * Transport for London JamCams (ported from gods-eye-view's TfL adapter).
 * Keyless list endpoint; frames are https JPEGs on TfL's public S3 bucket, so
 * the browser loads them directly. Only rows flagged available=true with an
 * image on the official bucket are kept.
 */
export const TFL_CATALOG_URL = 'https://api.tfl.gov.uk/Place/Type/JamCam';
export const TFL_ALLOWED_HOSTS = ['api.tfl.gov.uk'];
export const TFL_IMAGE_ORIGIN = 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/';

export function tflCatalogUrl(appKey) {
  const key = String(appKey || '').trim();
  return key ? `${TFL_CATALOG_URL}?app_key=${encodeURIComponent(key)}` : TFL_CATALOG_URL;
}

export function parseTflCatalog(places, { checkedAt }) {
  if (!Array.isArray(places)) throw new Error('Formato TfL no reconocido: se esperaba un array');
  const out = [];
  for (const place of places) {
    const props = {};
    for (const p of place?.additionalProperties ?? []) if (p?.key) props[p.key] = p.value;
    if (String(props.available).toLowerCase() !== 'true') continue;
    const imageUrl = String(props.imageUrl || '');
    if (!imageUrl.startsWith(TFL_IMAGE_ORIGIN) || !/\.jpg$/i.test(imageUrl)) continue;
    const nativeId = String(place?.id || '').replace(/^JamCams_/, '');
    if (!/^[\w.-]{1,64}$/.test(nativeId)) continue;
    out.push({
      id: `tfl:${nativeId}`,
      name: String(place?.commonName || `JamCam ${nativeId}`),
      countryCode: 'GB',
      city: 'Londres',
      lat: Number(place?.lat),
      lon: Number(place?.lon),
      category: 'traffic',
      mediaUrl: imageUrl,
      mediaType: 'image',
      liveness: 'periodic',
      refreshSeconds: 0,
      status: 'active',
      checkedAt,
    });
  }
  return out;
}
