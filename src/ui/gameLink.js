/**
 * External game link in the top bar. The destination is configurable at build
 * time (VITE_GAME_URL, https only); it opens in a new tab with no opener and no
 * referrer, so the external site gets no access to this app.
 */
export const DEFAULT_GAME_URL = 'https://itch.io/games/html5/tag-zombies';

export function resolveGameUrl(value) {
  try {
    const url = new URL(String(value ?? '').trim());
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : DEFAULT_GAME_URL;
  } catch {
    return DEFAULT_GAME_URL;
  }
}
