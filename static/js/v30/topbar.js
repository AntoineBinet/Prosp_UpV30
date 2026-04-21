/* ProspUp v30 — Topbar : menu avatar (deconnexion) */
(function () {
  'use strict';

  var menu = document.querySelector('[data-v30-avatar-menu]');
  if (!menu) return;
  var trigger = menu.querySelector('[data-v30-avatar-trigger]');
  var dropdown = menu.querySelector('.v30-avatar-menu__dropdown');
  var logoutBtn = menu.querySelector('[data-v30-logout]');
  if (!trigger || !dropdown) return;

  function open() {
    dropdown.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
  }
  function close() {
    dropdown.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  }
  function toggle() { dropdown.hidden ? open() : close(); }

  trigger.addEventListener('click', function (e) {
    e.stopPropagation();
    toggle();
  });
  document.addEventListener('click', function (e) {
    if (!menu.contains(e.target)) close();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') close();
  });

  if (logoutBtn) {
    logoutBtn.addEventListener('click', function () {
      fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Accept': 'application/json' }
      }).then(function () {
        window.location.href = '/login';
      }).catch(function () {
        // Fallback : redirige quand meme
        window.location.href = '/login';
      });
    });
  }
})();
