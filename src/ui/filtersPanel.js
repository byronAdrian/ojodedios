/**
 * Filters pane: Spain hierarchy (comunidad → provincia → ciudad), country for
 * world scope, categories, status, favourites, "solo en vista", quick cities.
 * Stateless view: re-rendered from store state; emits intent callbacks.
 */
import { h, icon, render } from './dom.js';
import { COMMUNITIES, provincesOf, QUICK_ACCESS_CITIES, CITY_RADIUS_KM } from '../domain/spain.js';
import { CATEGORIES, COUNTRY_NAMES } from '../domain/camera.js';
import { countActiveFilters } from '../domain/filters.js';

const STATUS_OPTIONS = [
  { value: 'all', label: 'Todas' },
  { value: 'active', label: 'Verificadas por el proveedor' },
  { value: 'online', label: 'Imagen comprobada (esta sesión)' },
  { value: 'offline', label: 'No disponibles (esta sesión)' },
];

/**
 * @param {{ container: HTMLElement, actions: {
 *   setFilters: (patch: object) => void, resetFilters: () => void, goToCity: (id: string) => void,
 *   goToSpain: () => void, setOnlyInView: (on: boolean) => void } }} deps
 */
export function createFiltersPanel({ container, actions }) {
  function select(id, label, value, options, onChange, { disabled = false, placeholder } = {}) {
    return h(
      'label',
      { class: 'field', for: id },
      h('span', { class: 'field__label' }, label),
      h(
        'select',
        { class: 'select', id, disabled, onChange: (e) => onChange(e.target.value) },
        h('option', { value: '' }, placeholder),
        ...options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)),
      ),
    );
  }

  /** @param {{ filters: import('../domain/filters.js').FilterState, categoryCounts: Map<string, number>, onlyInView: boolean }} state */
  function update({ filters, categoryCounts, onlyInView }) {
    // Re-rendering replaces nodes; remember focus so keyboard users keep their place.
    const focused = container.contains(document.activeElement) ? focusKey(document.activeElement) : null;
    const spain = filters.scope === 'spain';
    const active = countActiveFilters(filters);

    const geography = spain
      ? [
          h(
            'div',
            { class: 'field-row' },
            select('f-community', 'Comunidad autónoma', filters.community,
              COMMUNITIES.map((c) => ({ value: c.code, label: c.name })),
              (value) => actions.setFilters({ community: value, province: '' }),
              { placeholder: 'Toda España' }),
            select('f-province', 'Provincia', filters.province,
              provincesOf(filters.community).map((p) => ({ value: p.code, label: p.name }))
                .sort((a, b) => a.label.localeCompare(b.label, 'es')),
              (value) => actions.setFilters({ province: value }),
              { placeholder: filters.community ? 'Todas' : 'Todas las provincias' }),
          ),
          h(
            'div',
            { class: 'field' },
            h('span', { class: 'field__label', id: 'quick-cities-label' }, 'Ciudades'),
            h(
              'div',
              { class: 'quick-cities', role: 'group', 'aria-labelledby': 'quick-cities-label' },
              ...QUICK_ACCESS_CITIES.map((city) =>
                h('button', {
                  type: 'button',
                  class: 'chip',
                  'aria-pressed': String(filters.city === city.id),
                  onClick: () => (filters.city === city.id ? actions.setFilters({ city: '' }) : actions.goToCity(city.id)),
                }, city.name),
              ),
            ),
            h('p', { class: 'hint' }, `Una ciudad centra el mapa y muestra cámaras en un radio de ${CITY_RADIUS_KM} km. No implica que existan cámaras en ella.`),
          ),
        ]
      : [
          select('f-country', 'País', filters.country,
            Object.entries(COUNTRY_NAMES).map(([value, label]) => ({ value, label })),
            (value) => actions.setFilters({ country: value }),
            { placeholder: 'Todos los países con fuentes' }),
        ];

    render(
      container,
      h(
        'div',
        { class: 'pane__header' },
        h('h2', { class: 'pane__title', id: 'filters-title' }, active ? `Filtros · ${active}` : 'Filtros'),
        h('div', { class: 'actions' },
          spain ? h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onClick: actions.goToSpain }, icon('target', 'icon icon--sm'), 'Ver España') : null,
          active ? h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onClick: actions.resetFilters }, 'Limpiar') : null,
        ),
      ),
      h(
        'div',
        { class: 'filters' },
        ...geography,
        h(
          'div',
          { class: 'field' },
          h('span', { class: 'field__label', id: 'categories-label' }, 'Categoría'),
          h(
            'div',
            { class: 'chip-row', role: 'group', 'aria-labelledby': 'categories-label' },
            ...CATEGORIES.map((category) => {
              const count = categoryCounts.get(category.id) ?? 0;
              const pressed = filters.categories.includes(category.id);
              // Categories without cameras are still listed but disabled — never implied as covered.
              return h('button', {
                type: 'button',
                class: 'chip',
                'aria-pressed': String(pressed),
                disabled: !count && !pressed,
                title: count ? undefined : 'Sin cámaras de esta categoría en las fuentes actuales',
                onClick: () => actions.setFilters({
                  categories: pressed ? filters.categories.filter((c) => c !== category.id) : [...filters.categories, category.id],
                }),
              }, category.label, h('span', { class: 'chip__count' }, String(count)));
            }),
          ),
        ),
        select('f-status', 'Estado', filters.status === 'all' ? '' : filters.status,
          STATUS_OPTIONS.slice(1), (value) => actions.setFilters({ status: value || 'all' }), { placeholder: STATUS_OPTIONS[0].label }),
        h('label', { class: 'toggle' },
          h('input', { id: 'f-fav', type: 'checkbox', checked: filters.favoritesOnly, onChange: (e) => actions.setFilters({ favoritesOnly: e.target.checked }) }),
          'Solo favoritas'),
        h('label', { class: 'toggle' },
          h('input', { id: 'f-inview', type: 'checkbox', checked: onlyInView, onChange: (e) => actions.setOnlyInView(e.target.checked) }),
          'Solo cámaras visibles en el mapa'),
      ),
    );
    if (focused) restoreFocus(focused);
  }

  const focusKey = (el) => el.id || `${el.tagName}|${el.textContent}`;
  function restoreFocus(key) {
    const target =
      container.querySelector(`#${CSS.escape(key)}`) ??
      [...container.querySelectorAll('button, input')].find((el) => `${el.tagName}|${el.textContent}` === key);
    target?.focus({ preventScroll: true });
  }

  return { update };
}
