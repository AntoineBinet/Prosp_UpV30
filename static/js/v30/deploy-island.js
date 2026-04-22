/* ProspUp v30 — Îlot de validation post-déploiement */
(function () {
  'use strict';

  var _pollInterval = null;
  var _countdownInterval = null;
  var _shown = false;
  var POLL_MS = 5000;

  function _injectStyles() {
    if (document.getElementById('vb-styles')) return;
    var s = document.createElement('style');
    s.id = 'vb-styles';
    s.textContent = [
      '#vb-island{position:fixed;bottom:28px;left:50%;transform:translateX(-50%);z-index:99999;border-radius:24px;padding:2.5px;box-shadow:0 12px 48px rgba(0,0,0,.45),0 2px 8px rgba(0,0,0,.2);animation:vb-rise .45s cubic-bezier(.33,1,.68,1)}',
      '@keyframes vb-rise{from{transform:translateX(-50%) translateY(20px);opacity:0}to{transform:translateX(-50%) translateY(0);opacity:1}}',
      '#vb-island-inner{background:var(--surface);border-radius:22px;padding:14px 18px;display:flex;align-items:center;gap:12px;min-width:360px;max-width:540px}',
      '#vb-island .vb-icon{flex-shrink:0;color:var(--accent);display:flex;align-items:center}',
      '#vb-island .vb-text{flex:1;min-width:0}',
      '#vb-island .vb-title{font-weight:600;font-size:13px;color:var(--text);line-height:1.3}',
      '#vb-island .vb-sub{font-size:11px;color:var(--text-3);margin-top:2px}',
      '#vb-island .vb-cd{font-variant-numeric:tabular-nums;font-size:17px;font-weight:700;color:var(--accent);flex-shrink:0;min-width:42px;text-align:center;transition:color .3s}',
      '#vb-island .vb-cd.urgent{color:var(--danger,oklch(0.58 0.18 25));animation:vb-pulse 1s infinite}',
      '@keyframes vb-pulse{0%,100%{opacity:1}50%{opacity:.35}}',
      '#vb-island .vb-ok{background:var(--success,oklch(0.62 0.14 155));color:#fff;border:none;border-radius:10px;padding:8px 16px;font-size:12.5px;font-weight:600;cursor:pointer;transition:filter .15s,transform .1s;flex-shrink:0;white-space:nowrap;display:inline-flex;align-items:center;gap:5px}',
      '#vb-island .vb-ok:hover{filter:brightness(1.12);transform:translateY(-1px)}',
      '#vb-island .vb-ok:active{transform:translateY(0)}'
    ].join('');
    document.head.appendChild(s);
  }

  function _fmt(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function _icon(name, size) {
    var paths = {
      refreshCw: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
      check: '<path d="M20 6 9 17l-5-5"/>'
    };
    var sz = size || 16;
    return '<svg width="' + sz + '" height="' + sz + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (paths[name] || '') + '</svg>';
  }

  function _updateRing(el, rem, total) {
    var deg = Math.max(0, Math.round(rem / total * 360));
    var col = rem <= 30 ? 'var(--danger, oklch(0.58 0.18 25))' : 'var(--accent)';
    var track = 'var(--surface-3, oklch(0.235 0.014 258))';
    el.style.background = 'conic-gradient(' + col + ' ' + deg + 'deg, ' + track + ' 0deg)';
  }

  function _create(data) {
    _injectStyles();
    var TOTAL = data.timeout_seconds || 180;
    var el = document.createElement('div');
    el.id = 'vb-island';
    el.innerHTML =
      '<div id="vb-island-inner">' +
      '<span class="vb-icon">' + _icon('refreshCw', 17) + '</span>' +
      '<div class="vb-text">' +
        '<div class="vb-title">Mise à jour appliquée</div>' +
        '<div class="vb-sub">Rollback automatique si non confirmée dans le délai imparti</div>' +
      '</div>' +
      '<div class="vb-cd" id="vb-cd">' + _fmt(data.remaining_seconds) + '</div>' +
      '<button class="vb-ok" id="vb-ok">' + _icon('check', 13) + ' L\'app fonctionne</button>' +
      '</div>';

    document.body.appendChild(el);
    _updateRing(el, data.remaining_seconds, TOTAL);

    var rem = data.remaining_seconds;
    var cdEl = document.getElementById('vb-cd');

    _countdownInterval = setInterval(function () {
      rem--;
      if (rem <= 0) {
        clearInterval(_countdownInterval);
        _countdownInterval = null;
        cdEl.textContent = '0:00';
        cdEl.classList.add('urgent');
        _updateRing(el, 0, TOTAL);
        el.querySelector('.vb-title').textContent = 'Rollback en cours…';
        return;
      }
      cdEl.textContent = _fmt(rem);
      if (rem <= 30) cdEl.classList.add('urgent');
      _updateRing(el, rem, TOTAL);
    }, 1000);

    document.getElementById('vb-ok').addEventListener('click', function () {
      fetch('/api/deploy/confirm-validation', { method: 'POST' })
        .then(function () {
          _remove();
          if (window.showToast) window.showToast('Mise à jour confirmée !', 'success', 4000);
          else alert('Mise à jour confirmée !');
        })
        .catch(function () {
          if (window.showToast) window.showToast('Erreur de confirmation', 'error');
        });
    });
  }

  function _remove() {
    var el = document.getElementById('vb-island');
    if (el) el.remove();
    if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
    if (_countdownInterval) { clearInterval(_countdownInterval); _countdownInterval = null; }
    _shown = false;
  }

  function _check() {
    if (window.location.pathname === '/login') return;
    fetch('/api/deploy/validation-status', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data) return;
        if (data.pending && !_shown) { _shown = true; _create(data); }
        else if (!data.pending && _shown) { _remove(); }
      })
      .catch(function () {});
  }

  document.addEventListener('DOMContentLoaded', function () {
    _check();
    _pollInterval = setInterval(_check, POLL_MS);
  });
}());
