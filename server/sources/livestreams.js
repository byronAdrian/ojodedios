/** Curated YouTube live streams → camera rows (no upstream request needed). */
import entries from './livestreams.data.js';
import { lookupSpanishRegion } from '../geo/regionLookup.js';

export function loadLivestreams({ checkedAt }, list = entries) {
  return list
    .filter((e) => /^[a-z0-9-]{1,60}$/.test(e.id) && /^[\w-]{11}$/.test(e.youtubeId))
    .map((e) => {
      const region = lookupSpanishRegion(e.lat, e.lon);
      return {
        id: `livestream:${e.id}`,
        name: e.name,
        countryCode: e.countryCode ?? 'ES',
        communityCode: region?.communityCode ?? null,
        provinceCode: region?.provinceCode ?? null,
        city: e.city ?? null,
        lat: e.lat,
        lon: e.lon,
        category: e.category ?? 'tourism',
        // Muted autoplay only (never with sound); privacy-enhanced domain.
        mediaUrl: `https://www.youtube-nocookie.com/embed/${e.youtubeId}?autoplay=1&mute=1&playsinline=1&rel=0`,
        mediaType: 'youtube',
        thumbnailUrl: `https://i.ytimg.com/vi/${e.youtubeId}/hqdefault.jpg`,
        pageUrl: e.pageUrl,
        liveness: 'live',
        refreshSeconds: 0,
        status: 'listed',
        checkedAt,
      };
    });
}
