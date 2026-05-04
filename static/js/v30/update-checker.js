/* ProspUp v30 — Update checker
   Vérifie toutes les 10 min si un nouveau commit est disponible sur origin/main.
   Affiche une notification flottante (admin uniquement) avec un bouton
   "Mettre à jour" qui ouvre le popup de déploiement existant. */
(function () {
  'use strict';

  var CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
  var INITIAL_DELAY_MS  = 30 * 1000;      // premier check 30 s après le chargement
  var DISMISS_KEY = 'prospup_upd_dismissed_commit';

  var _notifEl = null;
  var _currentRemoteCommit = null;

  // ─── Admin guard ─────────────────────────────────────────────
  // Le popup de mise à jour n'est rendu que pour les admins.
  // S'il n'existe pas dans le DOM, on n'affiche pas la notif.
  function _isAdmin() {
    return !!document.querySelector('[data-v30-upd]');
  }

  // ─── Ouvre le popup de mise à jour existant ──────────────────
  function _openUpdatePopup() {
    var trg = document.querySelector('[data-v30-upd-open]');
    if (trg) trg.click();
  }

  // ─── Badge "mise à jour" sur le bouton version de la sidebar ─
  function _setBadge(on) {
    var btn = document.querySelector('[data-v30-upd-open]');
    if (!btn) return;
    btn.classList.toggle('has-update', on);
  }

  // ─── Notification flottante ───────────────────────────────────
  function _injectStyles() {
    if (document.getElementById('v30-uc-css')) return;
    var s = document.createElement('style');
    s.id = 'v30-uc-css';
    s.textContent =
      '@keyframes v30ucIn{from{transform:translateY(12px);opacity:0}to{transform:translateY(0);opacity:1}}' +
      '#v30-update-notif{position:fixed;bottom:24px;right:24px;z-index:9998;' +
        'background:var(--surface);border:1px solid var(--border);' +
        'border-left:3px solid var(--accent);border-radius:var(--r-xl,10px);' +
        'padding:14px 16px;box-shadow:0 8px 32px rgba(0,0,0,.28);' +
        'display:flex;align-items:center;gap:14px;max-width:340px;' +
        'font-size:13px;color:var(--text);animation:v30ucIn .3s ease;}' +
      '#v30-update-notif .v30uc-body{flex:1;min-width:0;}' +
      '#v30-update-notif .v30uc-title{font-weight:600;margin-bottom:3px;}' +
      '#v30-update-notif .v30uc-sub{font-size:11.5px;color:var(--text-3);}' +
      '#v30-update-notif .v30uc-actions{display:flex;flex-direction:column;gap:6px;flex-shrink:0;}' +
      '#v30-update-notif .v30uc-btn-install{white-space:nowrap;font-size:12px;font-weight:500;' +
        'padding:7px 13px;background:var(--accent);color:var(--accent-fg,#fff);' +
        'border:none;border-radius:var(--r-md,6px);cursor:pointer;transition:filter .15s;}' +
      '#v30-update-notif .v30uc-btn-install:hover{filter:brightness(1.12);}' +
      '#v30-update-notif .v30uc-btn-later{white-space:nowrap;font-size:11px;' +
        'padding:4px 8px;background:transparent;color:var(--text-3);' +
        'border:1px solid var(--border);border-radius:var(--r-md,6px);cursor:pointer;}' +
      // Badge dot sur le bouton version de la sidebar
      '[data-v30-upd-open].has-update{position:relative;}' +
      '[data-v30-upd-open].has-update::after{content:"";position:absolute;' +
        'top:2px;right:2px;width:7px;height:7px;border-radius:50%;' +
        'background:var(--accent);box-shadow:0 0 0 2px var(--sidebar-bg,var(--surface));}';
    document.head.appendChild(s);
  }

  function _showNotif(remoteCommit) {
    // Ne pas ré-afficher si déjà visible ou si le commit a déjà été ignoré
    if (_notifEl) return;
    try {
      if (localStorage.getItem(DISMISS_KEY) === remoteCommit) return;
    } catch (_e) {}

    _injectStyles();

    var el = document.createElement('div');
    el.id = 'v30-update-notif';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML =
      '<div class="v30uc-body">' +
        '<div class="v30uc-title">Mise à jour disponible</div>' +
        '<div class="v30uc-sub">Nouveau commit sur <code>origin/main</code>.</div>' +
      '</div>' +
      '<div class="v30uc-actions">' +
        '<button class="v30uc-btn-install" type="button">Mettre à jour</button>' +
        '<button class="v30uc-btn-later" type="button">Plus tard</button>' +
      '</div>';

    el.querySelector('.v30uc-btn-install').addEventListener('click', function () {
      _openUpdatePopup();
      _dismiss(remoteCommit);
    });
    el.querySelector('.v30uc-btn-later').addEventListener('click', function () {
      _dismiss(remoteCommit);
    });

    document.body.appendChild(el);
    _notifEl = el;
    _setBadge(true);
  }

  function _dismiss(remoteCommit) {
    if (_notifEl) {
      _notifEl.style.transition = 'opacity .2s,transform .2s';
      _notifEl.style.opacity = '0';
      _notifEl.style.transform = 'translateY(8px)';
      var el = _notifEl;
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
      _notifEl = null;
    }
    try {
      if (remoteCommit) localStorage.setItem(DISMISS_KEY, remoteCommit);
    } catch (_e) {}
    // Ne pas retirer le badge sidebar — il reste jusqu'à la mise à jour effective
  }

  function _hideNotif() {
    if (_notifEl && _notifEl.parentNode) _notifEl.parentNode.removeChild(_notifEl);
    _notifEl = null;
    _setBadge(false);
    try { localStorage.removeItem(DISMISS_KEY); } catch (_e) {}
  }

  // ─── Check ────────────────────────────────────────────────────
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
        _hideNotif();
      }
    } catch (_e) { /* réseau indisponible — silencieux */ }
  }

  // ─── Init ─────────────────────────────────────────────────────
  function init() {
    // Attente courte au démarrage pour ne pas ralentir le chargement
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
