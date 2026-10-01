/**
 * Results pane: honest counters, active-filter chips, tabs (Resultados /
 * Favoritas / Recientes) and a paginated card list. Pagination (PAGE_SIZE at a
 * time) keeps DOM and thumbnail requests bounded even with thousands of cameras.
 */
import { h, icon, render, formatNumber } from './dom.js';
import { categoryLabel, countryName, getProvider } from '../domain/camera.js';
import { getCommunity, getProvince, getQuickCity } from '../domain/spain.js';

export const PAGE_SIZE = 40;

const STATUS_LABEL = { active: 'Verificadas por el proveedor', online: 'Imagen comprobada', offline: 'No disponibles' };

/** Location line for a card / detail. Only facts the provider (or polygon lookup) gave us. */
export function locationLabel(camera) {
  const parts = [];
  if (camera.city) parts.push(camera.city);
  const province = getProvince(camera.provinceCode)?.name;
  if (province && province !== camera.city) parts.push(province);
  if (!parts.length && camera.communityCode) parts.push(getCommunity(camera.communityCode)?.name);
  if (camera.countryCode !== 'ES' || !parts.length) parts.push(countryName(camera.countryCode));
  return parts.filter(Boolean).join(' · ');
}

/** Status badge combining catalog status and what we observed this session. */
export function statusBadge(camera, observed) {
  if (observed === 'offline') return h('span', { class: 'badge badge--danger' }, icon('alert', 'icon icon--sm'), 'No disponible');
  if (observed === 'online') return h('span', { class: 'badge badge--ok' }, h('span', { class: 'badge__dot' }), 'Imagen recibida');
  if (camera.status === 'active') return h('span', { class: 'badge badge--ok' }, h('span', { class: 'badge__dot' }), 'Activa (proveedor)');
  return h('span', { class: 'badge' }, 'En catálogo');
}

/**
 * @param {{ container: HTMLElement, actions: {
 *   select: (id: string) => void, setTab: (tab: string) => void, setFilters: (patch: object) => void,
 *   markAvailability: (id: string, state: 'online' | 'offline') => void, retrySources: () => void,
 *   resetFilters: () => void, setOnlyInView: (on: boolean) => void, clearRecents: () => void,
 *   setHistorySize: (n: number) => void } }} deps
 */
export function createResultsPanel({ container, actions }) {
  const header = h('div', { class: 'pane__header' });
  const summary = h('div', { class: 'results__summary', 'aria-live': 'polite' });
  const tabs = h('div', { class: 'results__tabs' });
  const chips = h('div', { class: 'results__active-filters' });
  const list = h('ul', { class: 'results__list', id: 'results-list', tabindex: '-1', 'aria-labelledby': 'results-title' });
  render(container, header, summary, tabs, chips, list);

  let visibleCount = PAGE_SIZE;
  let lastKey = '';

  function card(camera, { selectedId, availability }) {
    const provider = getProvider(camera.providerId);
    const observed = availability.get(camera.id);
    const thumb = h('div', { class: 'card__thumb' }, icon('camera'));
    if (camera.mediaType === 'image' && camera.mediaUrl && observed !== 'offline') {
      const img = h('img', {
        src: camera.mediaUrl,
        alt: '',
        loading: 'lazy',
        decoding: 'async',
        width: '112',
        height: '70',
        referrerpolicy: 'no-referrer',
      });
      img.addEventListener('load', () => actions.markAvailability(camera.id, 'online'), { once: true });
      img.addEventListener('error', () => {
        img.remove();
        actions.markAvailability(camera.id, 'offline');
      }, { once: true });
      thumb.append(img);
    }
    return h(
      'li',
      null,
      h(
        'button',
        {
          type: 'button',
          class: 'card',
          'aria-current': String(camera.id === selectedId),
          onClick: () => actions.select(camera.id),
        },
        thumb,
        h(
          'span',
          { class: 'card__body' },
          h('span', { class: 'card__title' }, camera.name),
          h('span', { class: 'card__meta' }, `${locationLabel(camera)} · ${provider?.shortName ?? camera.providerId}`),
          h('span', { class: 'card__badges' }, statusBadge(camera, observed), h('span', { class: 'badge' }, categoryLabel(camera.category))),
        ),
      ),
    );
  }

  function activeChips(filters, onlyInView) {
    const items = [];
    const add = (label, patch) =>
      items.push(h('button', { type: 'button', class: 'chip chip--removable', 'aria-label': `Quitar filtro ${label}`, onClick: () => actions.setFilters(patch) }, label, icon('close')));
    if (filters.scope === 'world' && filters.country) add(countryName(filters.country), { country: '' });
    if (filters.community) add(getCommunity(filters.community)?.name ?? filters.community, { community: '', province: '' });
    if (filters.province) add(getProvince(filters.province)?.name ?? filters.province, { province: '' });
    if (filters.city) add(`Cerca de ${getQuickCity(filters.city)?.name}`, { city: '' });
    for (const c of filters.categories) add(categoryLabel(c), { categories: filters.categories.filter((x) => x !== c) });
    if (filters.status !== 'all') add(STATUS_LABEL[filters.status], { status: 'all' });
    if (filters.text) add(`“${filters.text}”`, { text: '' });
    if (filters.favoritesOnly) add('Favoritas', { favoritesOnly: false });
    if (onlyInView) items.push(h('button', { type: 'button', class: 'chip chip--removable', 'aria-label': 'Quitar filtro solo en vista', onClick: () => actions.setOnlyInView(false) }, 'En la vista del mapa', icon('close')));
    return items.length ? h('div', { class: 'chip-row' }, ...items) : null;
  }

  function emptyState({ tab, loading, sourcesFailed, filters, onlyInView }) {
    if (loading) return h('li', { class: 'empty' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('p', null, 'Cargando cámaras de las fuentes oficiales…'));
    if (tab === 'favorites') return h('li', { class: 'empty' }, icon('star'), h('p', { class: 'empty__title' }, 'Aún no tienes favoritas'), h('p', null, 'Abre una cámara y pulsa la estrella para guardarla en este dispositivo.'));
    if (tab === 'recents') return h('li', { class: 'empty' }, icon('clock'), h('p', { class: 'empty__title' }, 'Sin historial'), h('p', null, 'Las cámaras que abras aparecerán aquí.'));
    const hasFilters = filters.community || filters.province || filters.city || filters.categories.length || filters.status !== 'all' || filters.text || filters.favoritesOnly || onlyInView;
    return h(
      'li',
      { class: 'empty' },
      icon(sourcesFailed ? 'alert' : 'camera'),
      h('p', { class: 'empty__title' }, sourcesFailed ? 'No se han podido cargar las fuentes' : 'No hay cámaras verificadas aquí'),
      h('p', null, sourcesFailed
        ? 'Los proveedores no responden ahora mismo. No es un problema de tus filtros.'
        : filters.city || filters.community || filters.province
          ? 'Las fuentes integradas no publican cámaras en esta zona todavía. Por ejemplo, País Vasco y Cataluña gestionan su propio tráfico y aún no están conectados.'
          : 'Prueba a quitar algún filtro.'),
      sourcesFailed
        ? h('button', { type: 'button', class: 'btn btn--sm', onClick: actions.retrySources }, icon('refresh', 'icon icon--sm'), 'Reintentar')
        : hasFilters ? h('button', { type: 'button', class: 'btn btn--sm', onClick: actions.resetFilters }, 'Quitar filtros') : null,
    );
  }

  /**
   * @param {{ tab: 'results' | 'favorites' | 'recents', items: import('../domain/camera.js').Camera[],
   *   stats: ReturnType<typeof import('../domain/filters.js').summarize>, catalogTotal: number,
   *   filters: object, onlyInView: boolean, selectedId: string | null, availability: Map<string,string>,
   *   loading: boolean, sourcesFailed: boolean, historySize: number, resetPage: boolean }} state
   */
  function update(state) {
    const { tab, items, stats, catalogTotal } = state;
    const key = `${tab}|${items.length}|${items[0]?.id ?? ''}`;
    if (state.resetPage || key !== lastKey) {
      if (state.resetPage) visibleCount = PAGE_SIZE;
      lastKey = key;
    }

    render(
      header,
      h('h2', { class: 'pane__title', id: 'results-title' }, tab === 'results' ? 'Cámaras' : tab === 'favorites' ? 'Favoritas' : 'Recientes'),
      tab === 'recents'
        ? h('div', { class: 'actions' },
            h('label', { class: 'sr-only', for: 'history-size' }, 'Tamaño del historial'),
            h('select', { id: 'history-size', class: 'select select--compact', onChange: (e) => actions.setHistorySize(Number(e.target.value)) },
              ...[5, 10, 20, 50].map((n) => h('option', { value: String(n), selected: n === state.historySize }, `Últimas ${n}`))),
            items.length ? h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onClick: actions.clearRecents }, 'Borrar') : null)
        : null,
    );

    render(
      summary,
      tab === 'results'
        ? [
            h('span', { class: 'badge badge--accent', title: 'Resultados con los filtros actuales' }, `${formatNumber(stats.total)} de ${formatNumber(catalogTotal)} cámaras`),
            stats.active ? h('span', { class: 'badge badge--ok', title: 'El catálogo del proveedor las marca como activas' }, `${formatNumber(stats.active)} verificadas`) : null,
            h('span', { class: 'badge', title: 'Publican una imagen consultable' }, `${formatNumber(stats.withMedia)} con imagen`),
            stats.offline ? h('span', { class: 'badge badge--danger', title: 'Han fallado al cargar en esta sesión' }, `${formatNumber(stats.offline)} no disponibles`) : null,
          ]
        : [],
    );

    render(
      tabs,
      h('div', { class: 'segmented', role: 'group', 'aria-label': 'Listas' },
        ...[['results', 'Resultados'], ['favorites', 'Favoritas'], ['recents', 'Recientes']].map(([value, label]) =>
          h('button', { type: 'button', 'aria-pressed': String(tab === value), onClick: () => actions.setTab(value) }, label))),
    );

    render(chips, tab === 'results' ? activeChips(state.filters, state.onlyInView) : null);

    const page = items.slice(0, visibleCount);
    render(
      list,
      ...(page.length ? page.map((camera) => card(camera, state)) : [emptyState(state)]),
      items.length > visibleCount
        ? h('li', { class: 'results__more' },
            h('button', { type: 'button', class: 'btn btn--sm', onClick: () => { visibleCount += PAGE_SIZE; update({ ...state, resetPage: false }); } },
              `Mostrar ${formatNumber(Math.min(PAGE_SIZE, items.length - visibleCount))} más`))
        : null,
    );
  }

  return { update, focusList: () => list.focus() };
}
