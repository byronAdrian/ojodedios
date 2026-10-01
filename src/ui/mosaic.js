/**
 * "Sala de control": a paginated grid of camera stills over the map.
 *
 * - Each tile reloads on its provider's cadence (≥ 60 s), staggered by one
 *   ticker so a page never fires all its requests at once.
 * - Nothing refreshes while the mosaic is closed or the tab is hidden; every
 *   timer/listener is released on hide().
 * - Failed tiles show a clear state (never a black box) and are reported via
 *   markAvailability like the list thumbnails.
 */
import { h, icon, render } from './dom.js';
import { frameSrc } from './cameraDetail.js';
import { locationLabel } from './resultsPanel.js';
import { getProvider } from '../domain/camera.js';
import { ageLabel, isDue, mosaicPageSize } from '../domain/freshness.js';

const TICK_MS = 15_000;
const MAX_RELOADS_PER_TICK = 3;

/**
 * @param {{ container: HTMLElement, actions: { select: (id: string) => void, close: () => void,
 *   markAvailability: (id: string, state: 'online' | 'offline') => void } }} deps
 */
export function createMosaic({ container, actions }) {
  /** @type {Map<string, { camera, img: HTMLImageElement, age: HTMLElement, receivedAt: number | null, loading: boolean }>} */
  let tiles = new Map();
  let items = [];
  let page = 0;
  let ticker = 0;
  let visible = false;

  const onVisibility = () => {
    if (document.visibilityState === 'visible' && visible) tick();
  };

  function loadTile(tile) {
    if (tile.loading || tile.camera.mediaType !== 'image' || !tile.camera.mediaUrl) return;
    tile.loading = true;
    tile.img.src = frameSrc(tile.camera.mediaUrl, tile.camera.refreshSeconds);
  }

  function tick() {
    if (!visible || document.visibilityState !== 'visible') return;
    let reloads = 0;
    for (const tile of tiles.values()) {
      if (tile.camera.mediaType !== 'image') continue; // live video tiles have no "received" age
      tile.age.textContent = tile.receivedAt ? `Recibida ${ageLabel(tile.receivedAt)}` : tile.age.textContent;
      if (reloads < MAX_RELOADS_PER_TICK && tile.receivedAt && isDue(tile.camera, tile.receivedAt)) {
        loadTile(tile);
        reloads += 1;
      }
    }
  }

  function tileFor(camera) {
    const provider = getProvider(camera.providerId);
    const age = h('span', { class: 'mosaic__age' }, 'Cargando…');
    const img = h('img', { alt: `Imagen de la cámara ${camera.name}`, decoding: 'async', referrerpolicy: 'no-referrer' });
    const media = h('div', { class: 'mosaic__media' }, img, age);
    const tile = { camera, img, age, receivedAt: null, loading: false };

    img.addEventListener('load', () => {
      tile.loading = false;
      tile.receivedAt = Date.now();
      media.classList.remove('is-error');
      age.textContent = `Recibida ${ageLabel(tile.receivedAt)}`;
      actions.markAvailability(camera.id, 'online');
    });
    img.addEventListener('error', () => {
      tile.loading = false;
      actions.markAvailability(camera.id, 'offline');
      if (tile.receivedAt) {
        age.textContent = `Sin actualizar · ${ageLabel(tile.receivedAt)}`;
        tile.receivedAt = Date.now(); // retry on the next cadence, not every tick
      } else {
        media.classList.add('is-error');
        age.textContent = 'No disponible ahora';
        img.removeAttribute('src');
      }
    });

    tiles.set(camera.id, tile);
    if (camera.mediaType === 'image' && camera.mediaUrl) loadTile(tile);
    else if (camera.mediaType === 'youtube' && camera.thumbnailUrl) {
      // Video plays in the detail panel; a page of a dozen live players would be too heavy.
      img.src = camera.thumbnailUrl;
      tile.receivedAt = null;
      img.addEventListener('load', () => (age.textContent = '▶ Vídeo en directo · abrir'), { once: true });
    } else age.textContent = 'Sin imagen pública';

    return h(
      'li',
      { class: 'mosaic__item' },
      h('button', { type: 'button', class: 'mosaic__tile', onClick: () => actions.select(camera.id), 'aria-label': `${camera.name}, ${locationLabel(camera)}. Abrir detalle` },
        media,
        h('span', { class: 'mosaic__caption' },
          h('span', { class: 'mosaic__name' }, camera.name),
          h('span', { class: 'mosaic__meta' }, `${locationLabel(camera)} · ${provider?.shortName ?? ''}`))),
    );
  }

  function paint() {
    // Abort downloads of the page being replaced.
    for (const tile of tiles.values()) tile.img.removeAttribute('src');
    tiles = new Map();
    const size = mosaicPageSize(container.clientWidth || window.innerWidth);
    const pages = Math.max(1, Math.ceil(items.length / size));
    page = Math.min(page, pages - 1);
    const slice = items.slice(page * size, page * size + size);
    render(
      container,
      h('header', { class: 'mosaic__header' },
        h('h2', { class: 'mosaic__title', id: 'mosaic-title', tabindex: '-1' }, icon('grid'), ' Sala de control'),
        h('p', { class: 'mosaic__hint' }, 'Imágenes periódicas de las fuentes oficiales; se actualizan solas según la frecuencia de cada proveedor.'),
        h('div', { class: 'mosaic__pager' },
          h('button', { type: 'button', class: 'btn btn--sm', disabled: page === 0, onClick: () => { page -= 1; paint(); } }, 'Anterior'),
          h('span', { class: 'mosaic__page', 'aria-live': 'polite' }, items.length ? `Página ${page + 1} de ${pages} · ${items.length} cámaras` : 'Sin cámaras'),
          h('button', { type: 'button', class: 'btn btn--sm', disabled: page >= pages - 1, onClick: () => { page += 1; paint(); } }, 'Siguiente'),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Cerrar sala de control', title: 'Cerrar', onClick: actions.close }, icon('close')))),
      slice.length
        ? h('ul', { class: 'mosaic__grid' }, ...slice.map(tileFor))
        : h('p', { class: 'empty' }, 'No hay cámaras con los filtros actuales.'),
    );
  }

  return {
    /** @param {import('../domain/camera.js').Camera[]} list */
    show(list, { resetPage = false } = {}) {
      const ids = (arr) => arr.map((c) => c.id).join(',');
      const changed = ids(list) !== ids(items);
      items = list;
      if (resetPage) page = 0;
      if (!visible) {
        visible = true;
        container.hidden = false;
        document.addEventListener('visibilitychange', onVisibility);
        ticker = setInterval(tick, TICK_MS);
        paint();
        container.querySelector('#mosaic-title')?.focus();
      } else if (changed || resetPage) {
        paint();
      }
    },
    hide() {
      if (!visible) return;
      visible = false;
      clearInterval(ticker);
      document.removeEventListener('visibilitychange', onVisibility);
      for (const tile of tiles.values()) tile.img.removeAttribute('src');
      tiles = new Map();
      container.hidden = true;
      render(container);
    },
    get visible() {
      return visible;
    },
  };
}
