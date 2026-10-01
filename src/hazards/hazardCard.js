/**
 * Floating card with the facts of one earthquake or fire detection. Only what
 * the source states; links only to the source's own event page.
 */
import { h, icon, render } from '../ui/dom.js';
import { timeAgo, CONFIDENCE_LABEL } from './hazards.js';

const dateTime = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' });
const number = (value, digits = 1) => (Number.isFinite(value) ? value.toLocaleString('es', { maximumFractionDigits: digits }) : '—');

/** @param {{ container: HTMLElement, onClose: () => void }} deps */
export function createHazardCard({ container, onClose }) {
  const close = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Cerrar', title: 'Cerrar', onClick: onClose }, icon('close'));

  function quake(event, attribution) {
    const title = `M ${Number.isFinite(event.mag) ? event.mag.toFixed(1) : '?'}${event.magType ? ` (${event.magType})` : ''}`;
    return [
      h('header', { class: 'hazard-card__header' },
        h('span', { class: 'hazard-card__kind hazard-card__kind--quake' }, 'Terremoto'),
        h('h2', { class: 'hazard-card__title', id: 'hazard-card-title' }, title),
        close),
      h('p', { class: 'hazard-card__place' }, event.place || 'Ubicación no indicada por la fuente'),
      h('dl', { class: 'facts facts--compact' },
        h('dt', null, 'Hora'), h('dd', null, `${dateTime.format(new Date(event.time))} · ${timeAgo(event.time)}`),
        h('dt', null, 'Profundidad'), h('dd', null, Number.isFinite(event.depthKm) ? `${number(event.depthKm)} km` : '—'),
        event.tsunami ? [h('dt', null, 'Tsunami'), h('dd', null, 'La fuente indica posible tsunami: consulta a las autoridades')] : null),
      event.url ? h('a', { class: 'btn btn--sm', href: event.url, target: '_blank', rel: 'noopener noreferrer' }, icon('external', 'icon icon--sm'), 'Ver en USGS') : null,
      h('p', { class: 'attribution' }, attribution || 'U.S. Geological Survey (USGS)'),
    ];
  }

  function fire(point, attribution) {
    return [
      h('header', { class: 'hazard-card__header' },
        h('span', { class: 'hazard-card__kind hazard-card__kind--fire' }, 'Foco de calor'),
        h('h2', { class: 'hazard-card__title', id: 'hazard-card-title' }, 'Detección por satélite'),
        close),
      h('p', { class: 'hazard-card__place' }, 'Puede ser un incendio, una quema agrícola, una industria o actividad volcánica.'),
      h('dl', { class: 'facts facts--compact' },
        h('dt', null, 'Detectado'), h('dd', null, point.acquired ? `${dateTime.format(new Date(point.acquired))} · ${timeAgo(Date.parse(point.acquired))}` : '—'),
        h('dt', null, 'Confianza'), h('dd', null, CONFIDENCE_LABEL[point.confidence] ?? '—'),
        h('dt', null, 'Potencia radiativa'), h('dd', null, Number.isFinite(point.frp) ? `${number(point.frp)} MW` : '—'),
        h('dt', null, 'Satélite'), h('dd', null, [point.satellite, point.daynight === 'N' ? 'noche' : point.daynight === 'D' ? 'día' : ''].filter(Boolean).join(' · ') || '—'),
        h('dt', null, 'Coordenadas'), h('dd', null, `${point.lat.toFixed(3)}, ${point.lon.toFixed(3)}`)),
      h('p', { class: 'attribution' }, attribution || 'NASA FIRMS'),
    ];
  }

  return {
    /** @param {{ kind: 'quake' | 'fire', data: object } | null} pick */
    show(pick, { attribution } = {}) {
      if (!pick) {
        container.hidden = true;
        render(container);
        return;
      }
      container.hidden = false;
      container.setAttribute('aria-labelledby', 'hazard-card-title');
      render(container, ...(pick.kind === 'quake' ? quake(pick.data, attribution) : fire(pick.data, attribution)));
    },
  };
}
