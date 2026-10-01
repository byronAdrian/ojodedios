/**
 * Selected-camera panel with a resilient media viewer.
 *
 * Media states: loading → ready | error (timeout, HTTP error, not an image)
 *               | unsupported (format we don't play) | none (no public media).
 * Never shows an indefinite black box: every path ends in an image or in an
 * explanatory overlay with a link to the original source.
 *
 * Refresh: periodic stills reload no faster than the provider's cadence
 * (min 60 s), only while the panel is open and the tab is visible. All timers
 * and listeners are released on close/destroy.
 */
import { h, icon, render, formatDateTime, formatTime } from './dom.js';
import { categoryLabel, getProvider } from '../domain/camera.js';
import { getCommunity } from '../domain/spain.js';
import { locationLabel, statusBadge } from './resultsPanel.js';

const LOAD_TIMEOUT_MS = 15_000;
const MIN_REFRESH_S = 60;
const DEFAULT_REFRESH_S = 120;

const LIVENESS_LABEL = { live: 'Vídeo en directo', periodic: 'Imagen periódica', archived: 'Contenido archivado' };

/** Append a cache-busting param bucketed to the refresh interval (CDN-friendly). */
export function frameSrc(url, refreshSeconds, now = Date.now()) {
  const bucket = Math.floor(now / (Math.max(MIN_REFRESH_S, refreshSeconds || DEFAULT_REFRESH_S) * 1000));
  return `${url}${url.includes('?') ? '&' : '?'}t=${bucket}`;
}

/**
 * @param {{ container: HTMLElement, actions: {
 *   close: () => void, center: (camera) => void, toggleFavorite: (id: string) => boolean,
 *   isFavorite: (id: string) => boolean, shareUrl: (camera) => string,
 *   markAvailability: (id: string, state: 'online' | 'offline') => void, toast: (msg: string) => void } }} deps
 */
export function createCameraDetail({ container, actions }) {
  let current = null;
  let timers = [];
  let onVisibility = null;

  const clearTimers = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };

  function teardown() {
    clearTimers();
    if (onVisibility) document.removeEventListener('visibilitychange', onVisibility);
    onVisibility = null;
    const img = container.querySelector('.media img');
    if (img) img.src = ''; // stop any in-flight download
  }

  function overlay(kind, camera, retry) {
    const provider = getProvider(camera.providerId);
    const text = {
      error: 'La imagen no está disponible ahora mismo. La cámara puede estar desconectada, en mantenimiento o el proveedor puede impedir mostrarla fuera de su web.',
      unsupported: 'Esta fuente emite en un formato de vídeo que esta versión no reproduce de forma embebida.',
      none: 'El proveedor no publica una imagen que pueda mostrarse aquí.',
    }[kind];
    return h(
      'div',
      { class: 'media__overlay', role: 'alert' },
      icon(kind === 'error' ? 'alert' : 'camera'),
      h('p', null, text),
      h('div', { class: 'actions actions--center' },
        retry ? h('button', { type: 'button', class: 'btn btn--sm', onClick: retry }, icon('refresh', 'icon icon--sm'), 'Reintentar') : null,
        h('a', { class: 'btn btn--sm', href: camera.pageUrl || provider.sourceUrl, target: '_blank', rel: 'noopener noreferrer' }, icon('external', 'icon icon--sm'), 'Abrir fuente')),
    );
  }

  function mountMedia(media, camera) {
    if (camera.mediaType === 'none' || !camera.mediaUrl) {
      render(media, overlay('none', camera));
      return;
    }
    if (camera.mediaType === 'youtube') {
      // Real video. Muted autoplay only; the YouTube player shows its own state
      // (offline, unavailable) and the "Fuente original" link stays available.
      render(media, h('iframe', {
        class: 'media__video',
        src: camera.mediaUrl,
        title: `Vídeo en directo: ${camera.name}`,
        allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
        allowfullscreen: true,
        referrerpolicy: 'strict-origin-when-cross-origin',
        loading: 'lazy',
      }));
      return;
    }
    if (camera.mediaType !== 'image') {
      render(media, overlay('unsupported', camera));
      return;
    }

    const stamp = h('span', { class: 'media__stamp', hidden: true });
    const spinner = h('div', { class: 'media__overlay', 'aria-hidden': 'true' }, h('span', { class: 'spinner' }));
    const img = h('img', { alt: `Imagen de la cámara ${camera.name}`, decoding: 'async', referrerpolicy: 'no-referrer' });
    render(media, img, spinner, stamp);
    let lastFrameAt = null;

    const load = () => {
      clearTimers();
      const timeout = setTimeout(() => fail(), LOAD_TIMEOUT_MS);
      timers.push(timeout);
      img.src = frameSrc(camera.mediaUrl, camera.refreshSeconds);
    };
    const scheduleRefresh = () => {
      const seconds = Math.max(MIN_REFRESH_S, camera.refreshSeconds || DEFAULT_REFRESH_S);
      timers.push(setTimeout(() => document.visibilityState === 'visible' && current?.id === camera.id && load(), seconds * 1000));
    };
    const fail = () => {
      clearTimers();
      actions.markAvailability(camera.id, 'offline');
      if (lastFrameAt) {
        // Keep the last good picture; just say it is stale.
        stamp.textContent = `Última imagen ${formatTime(lastFrameAt)} · sin actualizar`;
        scheduleRefresh();
        return;
      }
      img.removeAttribute('src');
      render(media, overlay('error', camera, () => mountMedia(media, camera)));
    };

    img.addEventListener('load', () => {
      clearTimers();
      lastFrameAt = new Date();
      spinner.remove();
      stamp.hidden = false;
      stamp.textContent = `Recibida ${formatTime(lastFrameAt)}`;
      actions.markAvailability(camera.id, 'online');
      scheduleRefresh();
    });
    img.addEventListener('error', fail);

    onVisibility = () => {
      if (document.visibilityState === 'visible' && current?.id === camera.id) load();
      else clearTimers();
    };
    document.addEventListener('visibilitychange', onVisibility);
    load();
  }

  /** @param {import('../domain/camera.js').Camera | null} camera @param {{ observed?: string }} [ctx] */
  function show(camera, { observed } = {}) {
    if (camera?.id === current?.id && camera) return;
    teardown();
    current = camera;
    if (!camera) {
      container.hidden = true;
      render(container);
      return;
    }
    const provider = getProvider(camera.providerId);
    const favButton = h('button', { type: 'button', class: 'icon-btn' });
    const paintFav = (on) => {
      favButton.setAttribute('aria-pressed', String(on));
      favButton.setAttribute('aria-label', on ? 'Quitar de favoritas' : 'Guardar en favoritas');
      favButton.title = favButton.getAttribute('aria-label');
      render(favButton, icon(on ? 'star-fill' : 'star'));
    };
    paintFav(actions.isFavorite(camera.id));
    favButton.addEventListener('click', () => paintFav(actions.toggleFavorite(camera.id)));

    const media = h('div', { class: 'media' });
    const share = async () => {
      const url = actions.shareUrl(camera);
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        try {
          await navigator.share({ title: camera.name, url });
          return;
        } catch (error) {
          if (error?.name === 'AbortError') return;
        }
      }
      try {
        await navigator.clipboard.writeText(url);
        actions.toast('Enlace copiado');
      } catch {
        window.prompt('Copia el enlace de la cámara:', url);
      }
    };

    render(
      container,
      h(
        'header',
        { class: 'detail__header' },
        h('div', { class: 'detail__titles' },
          h('h2', { class: 'detail__title', id: 'detail-title', tabindex: '-1' }, camera.name),
          h('p', { class: 'detail__subtitle' }, locationLabel(camera))),
        favButton,
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Cerrar cámara', title: 'Cerrar', onClick: actions.close }, icon('close')),
      ),
      h(
        'div',
        { class: 'detail__body' },
        media,
        h('div', { class: 'card__badges' },
          statusBadge(camera, observed),
          h('span', { class: 'badge' }, LIVENESS_LABEL[camera.liveness]),
          h('span', { class: 'badge' }, categoryLabel(camera.category))),
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn btn--primary btn--sm', onClick: () => actions.center(camera) }, icon('target', 'icon icon--sm'), 'Centrar en el mapa'),
          h('a', { class: 'btn btn--sm', href: camera.pageUrl || provider.sourceUrl, target: '_blank', rel: 'noopener noreferrer' }, icon('external', 'icon icon--sm'), 'Fuente original'),
          h('button', { type: 'button', class: 'btn btn--sm', onClick: share }, icon(navigator.share ? 'share' : 'link', 'icon icon--sm'), 'Compartir')),
        h('dl', { class: 'facts' },
          h('dt', null, 'Proveedor'), h('dd', null, provider.name),
          camera.communityCode ? [h('dt', null, 'Comunidad'), h('dd', null, getCommunity(camera.communityCode)?.name ?? '—')] : null,
          h('dt', null, 'Coordenadas'), h('dd', null, `${camera.lat.toFixed(5)}, ${camera.lon.toFixed(5)}`),
          h('dt', null, 'Actualización'), h('dd', null, camera.refreshSeconds ? `Cada ~${Math.round(camera.refreshSeconds / 60)} min (según el proveedor)` : 'No publicada por el proveedor'),
          h('dt', null, 'Catálogo comprobado'), h('dd', null, formatDateTime(camera.checkedAt)),
          h('dt', null, 'Licencia'), h('dd', null, h('a', { href: provider.licenseUrl, target: '_blank', rel: 'noopener noreferrer' }, provider.license))),
        h('p', { class: 'attribution' }, provider.attribution),
      ),
    );
    container.hidden = false;
    mountMedia(media, camera);
  }

  return {
    show,
    get currentId() {
      return current?.id ?? null;
    },
    focus: () => container.querySelector('#detail-title')?.focus(),
    destroy: teardown,
  };
}
