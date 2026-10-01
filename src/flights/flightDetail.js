/** Selected-aircraft panel. Text only via textContent (see ui/dom.js). */
import { h, icon, render, formatNumber } from '../ui/dom.js';

const compass = (deg) => ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(((deg % 360) + 360) % 360 / 45) % 8];

/** @param {{ container: HTMLElement, onClose: () => void, onCenter: (a: object) => void }} deps */
export function createFlightDetail({ container, onClose, onCenter }) {
  let currentHex = null;

  /** @param {object | null} a @param {{ trailPoints?: number, status?: string }} [ctx] */
  function show(a, { trailPoints = 0, lost = false, attribution = null, trace = null } = {}) {
    if (!a) {
      currentHex = null;
      container.hidden = true;
      render(container);
      return;
    }
    const firstRender = currentHex !== a.hex;
    currentHex = a.hex;
    const title = a.callsign || a.registration || a.hex.toUpperCase();
    render(
      container,
      h('header', { class: 'detail__header' },
        h('div', { class: 'detail__titles' },
          h('h2', { class: 'detail__title', id: 'flight-title', tabindex: '-1' }, icon('plane', 'icon icon--sm'), ' ', title),
          h('p', { class: 'detail__subtitle' }, [a.type, a.registration].filter(Boolean).join(' · ') || 'Aeronave')),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Cerrar avión', title: 'Cerrar', onClick: onClose }, icon('close'))),
      h('div', { class: 'detail__body' },
        h('div', { class: 'card__badges' },
          lost
            ? h('span', { class: 'badge badge--warn' }, 'Sin señal reciente')
            : h('span', { class: 'badge badge--ok' }, h('span', { class: 'badge__dot' }), a.onGround ? 'En tierra' : 'En vuelo'),
          h('span', { class: 'badge' }, `Posición hace ${a.seenS} s`)),
        h('dl', { class: 'facts' },
          h('dt', null, 'Indicativo'), h('dd', null, a.callsign || '—'),
          h('dt', null, 'Matrícula'), h('dd', null, a.registration || '—'),
          h('dt', null, 'Modelo'), h('dd', null, a.type || '—'),
          h('dt', null, 'Altitud'), h('dd', null, a.onGround ? 'En tierra' : a.altitudeM === null ? '—' : `${formatNumber(a.altitudeM)} m (${formatNumber(Math.round(a.altitudeM / 0.3048))} ft)`),
          h('dt', null, 'Velocidad'), h('dd', null, a.speedKmh === null ? '—' : `${formatNumber(a.speedKmh)} km/h`),
          h('dt', null, 'Rumbo'), h('dd', null, a.track === null ? '—' : `${Math.round(a.track)}° ${compass(a.track)}`),
          h('dt', null, 'Código ICAO'), h('dd', null, a.hex.toUpperCase()),
          h('dt', null, 'Ruta'), h('dd', null,
            trace?.points?.length
              ? `Trayectoria real del día (${trailPoints} puntos, ${trace.source})`
              : trace?.error
                ? `Trayectoria completa no disponible; se dibuja lo observado en esta sesión (${trailPoints} puntos)`
                : trace ? 'Sin trayectoria registrada hoy' : 'Cargando trayectoria…')),
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn btn--primary btn--sm', onClick: () => onCenter(a) }, icon('target', 'icon icon--sm'), 'Centrar en el mapa')),
        h('p', { class: 'attribution' }, `Datos ADS-B de ${attribution || 'redes comunitarias'}. Pueden estar incompletos o retrasados; no aptos para navegación. Origen y destino no se muestran: las bases de rutas disponibles no permiten su publicación.`)),
    );
    container.hidden = false;
    if (firstRender) container.querySelector('#flight-title')?.focus();
  }

  return { show, get currentHex() { return currentHex; } };
}
