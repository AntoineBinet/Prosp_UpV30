/* ProspUp v30 — Update checker
   Vérifie toutes les 10 min si un nouveau commit est disponible sur origin/main.
   Injecte une notification dans la cloche topbar (admin uniquement) via
   window._v30NotifExtra + événement 'v30:notif:refresh'. */
(function () {
  'use strict';

  var CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
  var INITIAL_DELAY_MS  = 30 * 1000;      // premier check 30 s après le chargement
  var DISMISS_KEY = 'prospup_upd_dismissed_commit';

  var _currentRemoteCommit = null;

  var ICON_UPDATE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>';

  // ─── Admin guard ─────────────────────────────────────────────
  function _isAdmin() {
    return !!document.querySelector('[data-v30-upd]');
  }

  // ─── Ouvre le popup de mise à jour existant ──────────────────
  function _openUpdatePopup() {
    var trg = document.querySelector('[data-v30-upd-open]');
    if (trg) trg.click();
  }

  // ─── Badge dot sur le bouton version de la sidebar ───────────
  function _setBadge(on) {
    var btn = document.querySelector('[data-v30-upd-open]');
    if (!btn) return;
    btn.classList.toggle('has-update', on);
    if (on && !document.getElementById('v30-uc-badge-css')) {
      var s = document.createElement('style');
      s.id = 'v30-uc-badge-css';
      s.textContent =
        '[data-v30-upd-open].has-update{position:relative;}' +
        '[data-v30-upd-open].has-update::after{content:"";position:absolute;' +
          'top:2px;right:2px;width:7px;height:7px;border-radius:50%;' +
          'background:var(--accent);box-shadow:0 0 0 2px var(--sidebar-bg,var(--surface));}';
      document.head.appendChild(s);
    }
  }

  // ─── Inject / remove dans window._v30NotifExtra ──────────────
  function _injectNotif(remoteCommit) {
    window._v30NotifExtra = window._v30NotifExtra || [];
    // Éviter les doublons
    if (window._v30NotifExtra.some(function (e) { return e.id === 'update'; })) return;

    var html =
      '<div class="v30-notif-item">' +
        '<div class="v30-notif-item__icon v30-notif-item__icon--update">' + ICON_UPDATE + '</div>' +
        '<div class="v30-notif-item__body">' +
          '<div class="v30-notif-item__label">Mise à jour disponible</div>' +
          '<div class="v30-notif-item__sub">Nouveau commit prêt sur <code>origin/main</code>.</div>' +
          '<div class="v30-notif-item__cta" style="display:flex;gap:6px;">' +
            '<button type="button" class="btn btn-sm" data-v30uc-install>Mettre à jour</button>' +
            '<button type="button" class="btn btn-ghost btn-sm" data-v30uc-dismiss>Plus tard</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    window._v30NotifExtra = [{ id: 'update', html: html, remoteCommit: remoteCommit }];
    document.dispatchEvent(new CustomEvent('v30:notif:refresh'));
  }

  function _removeNotif() {
    window._v30NotifExtra = (window._v30NotifExtra || []).filter(function (e) { return e.id !== 'update'; });
    document.dispatchEvent(new CustomEvent('v30:notif:refresh'));
  }

  // ─── Show / dismiss ──────────────────────────────────────────
  function _showNotif(remoteCommit) {
    try {
      if (localStorage.getItem(DISMISS_KEY) === remoteCommit) return;
    } catch (_e) {}
    _injectNotif(remoteCommit);
    _setBadge(true);
  }

  function _dismiss(remoteCommit) {
    _removeNotif();
    try {
      if (remoteCommit) localStorage.setItem(DISMISS_KEY, remoteCommit);
    } catch (_e) {}
    // Le badge reste tant que la mise à jour n'est pas installée
  }

  function _hideAll() {
    _removeNotif();
    _setBadge(false);
    try { localStorage.removeItem(DISMISS_KEY); } catch (_e) {}
  }

  // ─── Délégation de clics (boutons injectés dans innerHTML) ───
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-v30uc-install]')) {
      _openUpdatePopup();
      _dismiss(_currentRemoteCommit);
    } else if (e.target.closest('[data-v30uc-dismiss]')) {
      _dismiss(_currentRemoteCommit);
    }
  });

  // ─── Check API ───────────────────────────────────────────────
  async function _check() {
    if (!_isAdmin()) return;
    try {
      var res = await fetch('/api/deploy/update-check', { credentials: 'same-origin' });
      if (!res.ok) return;
      var data = await res.json();
      if (!data || !data.ok) return;

      if (data.update_available) {
        _currentRemoteCommit = data.remote_commit || null;
        _setBadge(true);
        _showNotif(_currentRemoteCommit);
      } else {
        _currentRemoteCommit = null;
        _hideAll();
      }
    } catch (_e) { /* réseau indisponible — silencieux */ }
  }

  // ─── Init ────────────────────────────────────────────────────
  function init() {
    setTimeout(function () {
      _check();
      setInterval(_check, CHECK_INTERVAL_MS);
    }, INITIAL_DELAY_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
