/**
 * Global search combobox (WAI-ARIA 1.2 combobox + listbox pattern).
 * Debounced, in-memory, keyboard operable; no network per keystroke.
 */
import { h, icon, render, debounce } from './dom.js';
import { search, typeLabel } from '../domain/search.js';

const TYPE_ICON = { country: 'globe', community: 'map', province: 'map', city: 'pin', camera: 'camera', category: 'filter' };

/**
 * @param {{ container: HTMLElement, getIndex: () => import('../domain/search.js').SearchEntry[],
 *           onPick: (entry: import('../domain/search.js').SearchEntry) => void }} deps
 */
export function createSearchBox({ container, getIndex, onPick }) {
  const listId = 'search-results';
  const input = h('input', {
    class: 'search__input',
    id: 'search-input',
    type: 'search',
    role: 'combobox',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: 'Buscar país, comunidad, provincia, ciudad o cámara',
    'aria-label': 'Buscar',
    'aria-autocomplete': 'list',
    'aria-expanded': 'false',
    'aria-controls': listId,
    maxlength: '80',
  });
  const list = h('ul', { class: 'search__results', id: listId, role: 'listbox', 'aria-label': 'Resultados de búsqueda', hidden: true });
  render(container, h('div', { class: 'search__field' }, icon('search'), input), list);

  let results = [];
  let active = -1;

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };

  function paint() {
    if (!input.value.trim() || input.value.trim().length < 2) {
      close();
      return;
    }
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (!results.length) {
      render(list, h('li', { class: 'search__empty', role: 'presentation' }, 'Sin coincidencias. Prueba con otra provincia, ciudad o nombre de cámara.'));
      return;
    }
    render(
      list,
      ...results.map((entry, i) =>
        h(
          'li',
          {
            id: `search-opt-${i}`,
            class: 'search__option',
            role: 'option',
            'aria-selected': String(i === active),
            onMousedown: (event) => event.preventDefault(), // keep focus in the input
            onClick: () => choose(i),
          },
          icon(TYPE_ICON[entry.type] ?? 'pin'),
          h('span', { class: 'search__option-label' }, entry.label, entry.detail ? h('span', { class: 'search__option-detail' }, entry.detail) : null),
          h('span', { class: 'badge' }, typeLabel(entry.type)),
        ),
      ),
    );
    if (active >= 0) {
      input.setAttribute('aria-activedescendant', `search-opt-${active}`);
      list.children[active]?.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function choose(i) {
    const entry = results[i];
    if (!entry) return;
    input.value = '';
    results = [];
    close();
    onPick(entry);
  }

  const run = debounce(() => {
    results = search(getIndex(), input.value);
    active = -1;
    paint();
  }, 160);

  input.addEventListener('input', run);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!results.length) return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      active = (active + step + results.length) % results.length;
      paint();
    } else if (event.key === 'Enter') {
      if (list.hidden) return;
      event.preventDefault();
      run.cancel();
      results = search(getIndex(), input.value);
      choose(active >= 0 ? active : 0);
    } else if (event.key === 'Escape') {
      if (!list.hidden) {
        event.preventDefault();
        close();
      } else {
        input.value = '';
      }
    }
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('focus', () => input.value.trim().length >= 2 && run());

  return { focus: () => input.focus() };
}
