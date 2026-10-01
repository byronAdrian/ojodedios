/**
 * Appearance: light / dark / automatic (system). The initial attribute is set
 * by public/theme-init.js before paint; this module keeps it in sync, listens
 * to system changes in "automatic" mode and notifies the globe so it can swap
 * its basemap without being recreated.
 */
import { h, icon, render } from './dom.js';

const OPTIONS = [
  { value: 'light', label: 'Claro', icon: 'sun' },
  { value: 'dark', label: 'Oscuro', icon: 'moon' },
  { value: 'system', label: 'Automático', icon: 'auto' },
];

export function resolveTheme(preference, systemDark) {
  if (preference === 'light' || preference === 'dark') return preference;
  return systemDark ? 'dark' : 'light';
}

/**
 * @param {{ container: HTMLElement, preferences: ReturnType<import('../state/preferences.js').createPreferences>,
 *           onChange: (resolved: 'light' | 'dark') => void }} deps
 */
export function createThemeController({ container, cycleButton, preferences, onChange }) {
  const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
  const root = document.documentElement;
  let resolved = root.dataset.theme === 'dark' ? 'dark' : 'light';

  function apply() {
    const preference = preferences.getTheme();
    const next = resolveTheme(preference, media?.matches ?? false);
    root.dataset.themePref = preference;
    if (next !== resolved || root.dataset.theme !== next) {
      root.dataset.theme = next;
      resolved = next;
      onChange(next);
    }
    paint(preference);
  }

  function paint(preference) {
    if (cycleButton) {
      const index = OPTIONS.findIndex((o) => o.value === preference);
      const current = OPTIONS[index];
      const next = OPTIONS[(index + 1) % OPTIONS.length];
      const label = `Tema: ${current.label.toLowerCase()}. Cambiar a ${next.label.toLowerCase()}`;
      cycleButton.setAttribute('aria-label', label);
      cycleButton.title = label;
      render(cycleButton, icon(current.icon));
    }
    render(
      container,
      ...OPTIONS.map((option) =>
        h(
          'button',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(option.value === preference),
            'aria-label': `Tema ${option.label.toLowerCase()}`,
            title: `Tema ${option.label.toLowerCase()}`,
            tabindex: option.value === preference ? '0' : '-1',
            dataset: { value: option.value },
            onClick: () => {
              preferences.setTheme(option.value);
              apply();
            },
          },
          icon(option.icon),
        ),
      ),
    );
  }

  // Roving tabindex for the radiogroup (arrow keys).
  container.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const index = OPTIONS.findIndex((o) => o.value === preferences.getTheme());
    const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    const next = OPTIONS[(index + step + OPTIONS.length) % OPTIONS.length];
    preferences.setTheme(next.value);
    apply();
    container.querySelector(`[data-value="${next.value}"]`)?.focus();
  });

  cycleButton?.addEventListener('click', () => {
    const index = OPTIONS.findIndex((o) => o.value === preferences.getTheme());
    preferences.setTheme(OPTIONS[(index + 1) % OPTIONS.length].value);
    apply();
  });
  media?.addEventListener?.('change', apply);
  paint(preferences.getTheme());

  return {
    get resolved() {
      return resolved;
    },
    destroy: () => media?.removeEventListener?.('change', apply),
  };
}
