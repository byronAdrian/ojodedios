/**
 * Small presentational pieces: map controls, map status pill, mobile bottom
 * navigation and toasts.
 */
import { h, icon, render } from './dom.js';

/** @param {{ container: HTMLElement, actions: { zoomIn, zoomOut, resetGlobal, centerSpain, toggleMode, toggleFlights } }} deps */
export function createMapControls({ container, actions }) {
  const modeButton = h('button', { type: 'button', class: 'icon-btn', onClick: actions.toggleMode });
  const flightsButton = h('button', { type: 'button', class: 'icon-btn flights-toggle', onClick: actions.toggleFlights });
  render(
    container,
    h('div', { class: 'control-group', role: 'group', 'aria-label': 'Zoom' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Acercar', title: 'Acercar', onClick: actions.zoomIn }, icon('plus')),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Alejar', title: 'Alejar', onClick: actions.zoomOut }, icon('minus'))),
    h('div', { class: 'control-group', role: 'group', 'aria-label': 'Vista' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Centrar en España', title: 'Centrar en España', onClick: actions.centerSpain }, icon('target')),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Vista global del planeta', title: 'Vista global', onClick: actions.resetGlobal }, icon('globe')),
      modeButton),
    h('div', { class: 'control-group', role: 'group', 'aria-label': 'Capas' }, flightsButton),
  );
  return {
    /** @param {boolean} on @param {{ status?: string, count?: number }} [info] */
    setFlights(on, { status, count = 0 } = {}) {
      const detail = !on ? 'desactivados' : status === 'error' ? 'fuente no disponible' : `${count} en vista`;
      const label = `Vuelos en directo: ${detail}`;
      flightsButton.setAttribute('aria-pressed', String(on));
      flightsButton.setAttribute('aria-label', label);
      flightsButton.title = label;
      render(flightsButton, icon('plane'), on && status === 'ready' ? h('span', { class: 'flights-toggle__count', 'aria-hidden': 'true' }, count > 999 ? '999+' : String(count)) : null);
    },
    setMode(mode) {
      const label = mode === '2d' ? 'Cambiar a globo 3D' : 'Cambiar a mapa 2D';
      modeButton.setAttribute('aria-label', label);
      modeButton.title = label;
      render(modeButton, h('span', { class: 'control-label', 'aria-hidden': 'true' }, mode === '2d' ? '3D' : '2D'));
    },
  };
}

/** @param {HTMLElement} container */
export function createMapStatus(container) {
  return {
    /** @param {{ loading: boolean, failed: string[], stale: string[] }} state */
    update({ loading, failed, stale }) {
      if (loading) {
        render(container, h('div', { class: 'status-pill' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Cargando cámaras…'));
      } else if (failed.length) {
        render(container, h('div', { class: 'status-pill status-pill--error' }, icon('alert', 'icon icon--sm'), `Fuente no disponible: ${failed.join(', ')}`));
      } else if (stale.length) {
        render(container, h('div', { class: 'status-pill' }, icon('clock', 'icon icon--sm'), `Catálogo en caché: ${stale.join(', ')}`));
      } else {
        render(container);
      }
    },
  };
}

const NAV_ITEMS = [
  { sheet: 'none', label: 'Mapa', icon: 'map' },
  { sheet: 'list', label: 'Lista', icon: 'list' },
  { sheet: 'filters', label: 'Filtros', icon: 'filter' },
  { sheet: 'favorites', label: 'Favoritas', icon: 'star' },
];

/** @param {{ container: HTMLElement, onNavigate: (sheet: string) => void }} deps */
export function createBottomNav({ container, onNavigate }) {
  return {
    /** @param {{ sheet: string, filterCount: number }} state */
    update({ sheet, filterCount }) {
      render(
        container,
        ...NAV_ITEMS.map((item) => {
          const current = sheet === item.sheet || (item.sheet === 'none' && sheet === 'detail');
          return h(
            'button',
            { type: 'button', class: 'bottom-nav__item', 'aria-current': current ? 'page' : undefined, onClick: () => onNavigate(item.sheet) },
            icon(item.icon),
            item.label,
            item.sheet === 'filters' && filterCount ? h('span', { class: 'bottom-nav__badge' }, String(filterCount), h('span', { class: 'sr-only' }, ' filtros activos')) : null,
          );
        }),
      );
    },
  };
}

/** @param {HTMLElement} container */
export function createToasts(container) {
  return (message, ms = 2600) => {
    const toast = h('div', { class: 'toast' }, message);
    container.append(toast);
    setTimeout(() => toast.remove(), ms);
  };
}
