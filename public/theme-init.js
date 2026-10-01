// Runs synchronously in <head> before first paint (no theme flash).
// Mirrors src/ui/theme.js resolution; keep the storage key in sync.
(function () {
  var pref = 'system';
  try {
    var stored = localStorage.getItem('wve.theme');
    if (stored === 'light' || stored === 'dark' || stored === 'system') pref = stored;
  } catch (e) {
    /* storage blocked: follow the system */
  }
  var dark = pref === 'dark' || (pref === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme-pref', pref);
})();
