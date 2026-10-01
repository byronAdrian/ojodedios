/**
 * DOM helpers. All text goes through textContent / attributes — never
 * innerHTML — so provider-supplied strings can't inject markup.
 */

/**
 * h('button', { class: 'btn', onClick: fn, 'aria-label': 'x' }, 'text', child)
 * @param {string} tag
 * @param {Record<string, unknown> | null} [props]
 * @param {...(Node | string | number | null | undefined | false)} children
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'class') {
      el.className = String(value);
    } else if (key === 'dataset') {
      Object.assign(el.dataset, value);
    } else if (key in el && typeof value !== 'string') {
      el[key] = value; // e.g. hidden, disabled, checked, value
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  append(el, children);
  return el;
}

function append(parent, children) {
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Inline icon from the sprite in index.html. */
export function icon(name, className = 'icon') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

/** Replace all children. */
export function render(parent, ...children) {
  parent.replaceChildren();
  append(parent, children);
}

export function debounce(fn, ms) {
  let timer = 0;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}

const timeFormat = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });
const dateTimeFormat = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
export const formatTime = (date) => timeFormat.format(date);
export function formatDateTime(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) || date.getTime() === 0 ? '—' : dateTimeFormat.format(date);
}
export const formatNumber = (n) => new Intl.NumberFormat('es-ES').format(n);
