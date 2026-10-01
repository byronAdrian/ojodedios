/**
 * Curated public live streams (real video) that their owners publish on
 * YouTube with embedding enabled. Edit this list to add or remove cameras.
 *
 * Rules: only streams published by their owner, publicly listed, embeddable,
 * showing public space/landscape (no private property, no people-focused
 * framing). Stream ids change when an owner restarts a broadcast: if a camera
 * shows "video unavailable", update or remove its entry.
 *
 * Found 2026-10-01 via web search; NOT verifiable from the dev environment
 * (YouTube is blocked there) — check each one in the preview.
 *
 * Fields: id (stable, [a-z0-9-]), name, lat, lon, city, provinceCode?,
 * category, youtubeId (11 chars), pageUrl (the stream's YouTube page).
 */
export default [
  {
    id: 'lanzarote-puerto-del-carmen',
    name: 'Playa Grande, Puerto del Carmen (Lanzarote)',
    lat: 28.9208,
    lon: -13.6667,
    city: 'Tías',
    category: 'coast',
    youtubeId: 'YlRJXr4fCgM',
    pageUrl: 'https://www.youtube.com/watch?v=YlRJXr4fCgM',
  },
  {
    id: 'benidorm',
    name: 'Benidorm en directo',
    lat: 38.5357,
    lon: -0.1235,
    city: 'Benidorm',
    category: 'coast',
    youtubeId: 'ngOvyL2KbuA',
    pageUrl: 'https://www.youtube.com/watch?v=ngOvyL2KbuA',
  },
];
