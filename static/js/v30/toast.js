/* ProspUp v30 — window.showToast global (CSS inline, indépendant de style.css legacy).
 * Compatible avec les appels `window.showToast(msg, type, duration)` utilisés partout en V30.
 */
(function () {
  'use strict';
  if (typeof window.showToast === 'function') return; // déjà défini (ex: page legacy)

  var STYLE_ID = 'v30-toast-styles';
  var CONTAINER_ID = 'v30-toast-container';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '#' + CONTAINER_ID + '{position:fixed;top:16px;right:16px;z-index:100000;display:flex;flex-direction:column;gap:8px;max-width:380px;pointer-events:none}',
      '#' + CONTAINER_ID + ' .v30-toast{pointer-events:auto;display:flex;align-items:flex-start;gap:10px;padding:10px 14px;border-radius:10px;background:#1e293b;color:#e2e8f0;border:1px solid rgba(148,163,184,.25);box-shadow:0 8px 24px rgba(0,0,0,.35);font:500 13px/1.45 Inter,system-ui,sans-serif;opacity:0;transform:translateX(20px);transition:opacity .22s ease,transform .22s ease}',
      '#' + CONTAINER_ID + ' .v30-toast.is-in{opacity:1;transform:translateX(0)}',
      '#' + CONTAINER_ID + ' .v30-toast.is-out{opacity:0;transform:translateX(20px)}',
      '#' + CONTAINER_ID + ' .v30-toast.success{border-left:3px solid #22c55e}',
      '#' + CONTAINER_ID + ' .v30-toast.error{border-left:3px solid #ef4444}',
      '#' + CONTAINER_ID + ' .v30-toast.warning{border-left:3px solid #f59e0b}',
      '#' + CONTAINER_ID + ' .v30-toast.info{border-left:3px solid #3b82f6}',
      '#' + CONTAINER_ID + ' .v30-toast .v30-toast-msg{flex:1;min-width:0;word-wrap:break-word}',
      '#' + CONTAINER_ID + ' .v30-toast .v30-toast-x{appearance:none;background:transparent;border:0;color:#94a3b8;font-size:18px;line-height:1;cursor:pointer;padding:0 0 0 6px;flex-shrink:0}',
      '#' + CONTAINER_ID + ' .v30-toast .v30-toast-x:hover{color:#e2e8f0}',
      '#' + CONTAINER_ID + ' .v30-toast .v30-toast-action{appearance:none;background:rgba(148,163,184,.15);border:1px solid rgba(148,163,184,.3);color:inherit;font:600 12px/1 Inter,system-ui,sans-serif;padding:6px 10px;border-radius:6px;cursor:pointer;flex-shrink:0;margin-left:4px}',
      '#' + CONTAINER_ID + ' .v30-toast .v30-toast-action:hover{background:rgba(148,163,184,.25)}',
      '[data-theme="light"] #' + CONTAINER_ID + ' .v30-toast{background:#ffffff;color:#0f172a;border:1px solid rgba(15,23,42,.08);box-shadow:0 8px 24px rgba(15,23,42,.12)}',
      '[data-theme="light"] #' + CONTAINER_ID + ' .v30-toast .v30-toast-x{color:#64748b}',
      '[data-theme="light"] #' + CONTAINER_ID + ' .v30-toast .v30-toast-x:hover{color:#0f172a}'
    ].join('');
    document.head.appendChild(s);
  }

  function ensureContainer() {
    injectStyles();
    var c = document.getElementById(CONTAINER_ID);
    if (c) return c;
    c = document.createElement('div');
    c.id = CONTAINER_ID;
    document.body.appendChild(c);
    return c;
  }

  function escHtml(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  window.showToast = function (message, type, duration, options) {
    try {
      type = type || 'info';
      duration = typeof duration === 'number' ? duration : 3500;
      options = options || {};
      var container = ensureContainer();
      var toast = document.createElement('div');
      toast.className = 'v30-toast ' + type;
      var actionHtml = '';
      if (options.action && typeof options.action.label === 'string') {
        actionHtml = '<button type="button" class="v30-toast-action">' + escHtml(options.action.label) + '</button>';
      }
      toast.innerHTML =
        '<span class="v30-toast-msg">' + escHtml(message) + '</span>' +
        actionHtml +
        '<button type="button" class="v30-toast-x" aria-label="Fermer">&times;</button>';
      var close = toast.querySelector('.v30-toast-x');
      close.addEventListener('click', function () { dismiss(toast); });
      var actionBtn = toast.querySelector('.v30-toast-action');
      if (actionBtn && options.action && typeof options.action.onClick === 'function') {
        actionBtn.addEventListener('click', function () {
          toast._v30Actioned = true;
          try { options.action.onClick(); } catch (_) {}
          dismiss(toast);
        });
      }
      container.appendChild(toast);
      requestAnimationFrame(function () { toast.classList.add('is-in'); });
      var timer = setTimeout(function () {
        if (typeof options.onExpire === 'function' && !toast._v30Actioned) {
          try { options.onExpire(); } catch (_) {}
        }
        dismiss(toast);
      }, duration);
      toast._v30Timer = timer;
    } catch (e) { /* silent */ }
  };

  function dismiss(toast) {
    if (!toast || !toast.parentNode) return;
    if (toast._v30Timer) { clearTimeout(toast._v30Timer); toast._v30Timer = null; }
    toast.classList.remove('is-in');
    toast.classList.add('is-out');
    setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 250);
  }
})();
