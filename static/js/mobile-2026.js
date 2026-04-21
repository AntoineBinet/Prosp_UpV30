/* ==================================================================
   ProspUp Mobile 2026 — Small runtime helpers
   - Theme toggle (dark | light | auto) persisted in localStorage
   - Body class `m26-enabled` so the new CSS can scope its overrides
   - Optional dynamic island renderer (data-island-label attribute)
   Loaded on every page (desktop + mobile). Main CSS is mobile-gated.
   ================================================================== */
(function () {
  'use strict';

  var STORE_KEY = 'm26.theme'; // 'dark' | 'light' | 'auto'

  function read() {
    try { return localStorage.getItem(STORE_KEY) || 'auto'; }
    catch (e) { return 'auto'; }
  }

  function write(v) {
    try { localStorage.setItem(STORE_KEY, v); } catch (e) {}
  }

  function apply(mode) {
    var html = document.documentElement;
    if (mode === 'dark' || mode === 'light') {
      html.setAttribute('data-theme', mode);
    } else {
      html.removeAttribute('data-theme');
    }
  }

  function currentEffective() {
    var mode = read();
    if (mode === 'dark' || mode === 'light') return mode;
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
      ? 'dark' : 'light';
  }

  // Public API — exposed for Settings page + mobile nav
  window.m26 = {
    get: read,
    set: function (mode) {
      if (mode !== 'dark' && mode !== 'light' && mode !== 'auto') return;
      write(mode);
      apply(mode);
      document.dispatchEvent(new CustomEvent('m26-theme-changed', { detail: { mode: mode } }));
    },
    toggle: function () {
      var eff = currentEffective();
      window.m26.set(eff === 'dark' ? 'light' : 'dark');
    },
    effective: currentEffective
  };

  // Apply the stored preference ASAP (before DOM parse completes).
  apply(read());

  // Tag the body so mobile-2026.css can scope its overrides.
  function tagBody() {
    if (document.body) document.body.classList.add('m26-enabled');
  }
  if (document.body) tagBody();
  else document.addEventListener('DOMContentLoaded', tagBody, { once: true });

  // ── Dynamic island helper ─────────────────────────────────────────
  // Any element with [data-m26-island-label] at page load gets its
  // content rendered in a fixed-position dynamic-island widget. Pages
  // that do not care can ignore this entirely.
  function renderIsland() {
    var tag = document.querySelector('[data-m26-island-label]');
    if (!tag) return;
    var label = tag.getAttribute('data-m26-island-label');
    if (!label) return;
    if (document.getElementById('m26-island')) return;

    var el = document.createElement('div');
    el.id = 'm26-island';
    el.className = 'm26-dynamic-island is-expanded';
    el.innerHTML =
      '<span class="m26-di-dot" aria-hidden="true"></span>' +
      '<span class="m26-di-label"></span>' +
      '<span class="m26-di-live">LIVE</span>';
    el.querySelector('.m26-di-label').textContent = label;
    document.body.appendChild(el);
  }
  if (document.body) renderIsland();
  else document.addEventListener('DOMContentLoaded', renderIsland, { once: true });

})();
