/* ProspUp v30 — Opt-in/out UI mode toggle (client-only, SPEC §5.3)
   Charge-le sur legacy pages et v30 pages. Sur legacy : affiche une
   bannière discrète "Essayer la nouvelle interface v30" (dismissible).
   Sur v30 : intercepte clic [data-v30-opt-out] → stocke le choix et
   redirige. Pas de backend — pure localStorage pour rester non destructif.
*/
(function () {
  'use strict';

  var KEY = 'prospup_ui_mode';    // 'v30' | 'v29' | null
  var DISMISS_KEY = 'prospup_v30_banner_dismissed';

  function getMode() {
    try { return localStorage.getItem(KEY); } catch (_) { return null; }
  }
  function setMode(m) {
    try { localStorage.setItem(KEY, m); } catch (_) {}
  }

  function isV30Page() {
    return location.pathname.indexOf('/v30/') === 0;
  }

  // ─── Sidebar v30 : bouton "v29" ───────────────────────────
  function bindOptOut() {
    var btn = document.querySelector('[data-v30-opt-out]');
    if (!btn) return;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      setMode('v29');
      // Redirige vers l'équivalent legacy
      var path = location.pathname;
      var target = '/dashboard';
      if      (path.indexOf('/v30/prospects') === 0)    target = '/';
      else if (path.indexOf('/v30/prospect/') === 0)    target = '/?prospect=' + path.split('/').pop();
      else if (path.indexOf('/v30/entreprises') === 0)  target = '/entreprises';
      else if (path.indexOf('/v30/sourcing') === 0)     target = '/sourcing';
      else if (path.indexOf('/v30/candidat/') === 0)    target = '/candidate?id=' + path.split('/').pop();
      else if (path.indexOf('/v30/push') === 0)         target = '/push';
      else if (path.indexOf('/v30/stats') === 0)        target = '/stats';
      else if (path.indexOf('/v30/dashboard') === 0)    target = '/dashboard';
      else if (path.indexOf('/v30/rapport') === 0)      target = '/rapport';
      else if (path.indexOf('/v30/users') === 0)        target = '/users';
      else if (path.indexOf('/v30/parametres') === 0)   target = '/parametres';
      else if (path.indexOf('/v30/snapshots') === 0)    target = '/snapshots';
      else if (path.indexOf('/v30/activity') === 0)     target = '/activity';
      else if (path.indexOf('/v30/collab') === 0)       target = '/collab';
      else if (path.indexOf('/v30/duplicates') === 0)   target = '/duplicates';
      else if (path.indexOf('/v30/metiers') === 0)      target = '/metiers';
      else if (path.indexOf('/v30/help') === 0)         target = '/help';
      else if (path.indexOf('/v30/dc') === 0)           target = '/dc-generator' + (path.split('/').pop() && /^\d+$/.test(path.split('/').pop()) ? '?candidate=' + path.split('/').pop() : '');
      else if (path.indexOf('/v30/focus') === 0)        target = '/focus';
      else if (path.indexOf('/v30/calendrier') === 0)   target = '/calendar';
      window.location.href = target;
    });
  }

  // ─── Mapping legacy → v30 (miroir de bindOptOut) ─────────
  function legacyToV30(path, search) {
    var q = new URLSearchParams(search || '');
    var pid = q.get('prospect');
    var cid = q.get('id');
    if (path === '/' || path === '/index.html') {
      return pid ? '/v30/prospect/' + pid : '/v30/prospects';
    }
    if (path === '/dashboard')        return '/v30/dashboard';
    if (path === '/entreprises')      return '/v30/entreprises';
    if (path === '/sourcing')         return '/v30/sourcing';
    if (path === '/candidat' && cid)  return '/v30/candidat/' + cid;
    if (path === '/push')             return '/v30/push';
    if (path === '/stats')            return '/v30/stats';
    if (path === '/rapport')          return '/v30/rapport';
    if (path === '/users')            return '/v30/users';
    if (path === '/parametres')       return '/v30/parametres';
    if (path === '/snapshots')        return '/v30/snapshots';
    if (path === '/activity')         return '/v30/activity';
    if (path === '/collab')           return '/v30/collab';
    if (path === '/duplicates')       return '/v30/duplicates';
    if (path === '/metiers')          return '/v30/metiers';
    if (path === '/help')             return '/v30/help';
    if (path === '/focus')            return '/v30/focus';
    if (path === '/calendrier')       return '/v30/calendrier';
    return null;
  }

  // ─── Redirect auto legacy → v30 (sauf si opt-out v29) ────
  function autoRedirectToV30() {
    if (isV30Page()) return false;
    var q = new URLSearchParams(location.search || '');
    // Escape hatch : ?force_v29=1 sur l'URL laisse l'utilisateur en legacy
    if (q.get('force_v29') === '1') return false;
    if (getMode() === 'v29') return false; // user a explicite v29
    var target = legacyToV30(location.pathname, location.search);
    if (!target) return false;
    setMode('v30');
    // Preserve les query params utiles (change_password, etc.)
    if (q.toString()) target += (target.indexOf('?') >= 0 ? '&' : '?') + q.toString();
    window.location.replace(target);
    return true;
  }

  // ─── Legacy : bannière opt-in discrète (fallback si pas de mapping) ──
  function renderLegacyBanner() {
    if (isV30Page()) return;
    if (getMode() === 'v29') return; // utilisateur a explicitement choisi v29
    var dismissed = false;
    try { dismissed = localStorage.getItem(DISMISS_KEY) === '1'; } catch (_) {}
    if (dismissed) return;

    // Ne pas afficher sur login, pages d'erreur, mode prosp
    var path = location.pathname;
    if (path === '/login' || path === '/' && !document.querySelector('body[data-page="home"]')) {
      // On reste prudent : on n'affiche la bannière que sur les pages principales
    }
    if (path.indexOf('/static/') === 0) return;

    var bar = document.createElement('div');
    bar.className = 'prospup-v30-banner';
    bar.setAttribute('role', 'status');
    bar.style.cssText = [
      'position:fixed',
      'left:50%',
      'bottom:20px',
      'transform:translateX(-50%)',
      'background:#0f172a',
      'color:#e2e8f0',
      'padding:10px 16px',
      'border-radius:12px',
      'box-shadow:0 12px 40px rgba(0,0,0,.35), 0 4px 12px rgba(0,0,0,.2)',
      'z-index:9999',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
      'font-size:13px',
      'display:inline-flex',
      'align-items:center',
      'gap:12px',
      'max-width:calc(100vw - 32px)'
    ].join(';');
    bar.innerHTML =
      '<span style="display:inline-flex;align-items:center;gap:6px;">' +
        '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#818cf8;"></span>' +
        'Nouvelle interface <b>v30</b> disponible' +
      '</span>' +
      '<a href="/v30/dashboard" style="background:#818cf8;color:#fff;text-decoration:none;padding:4px 10px;border-radius:6px;font-weight:500;font-size:12.5px;">Essayer</a>' +
      '<button type="button" aria-label="Fermer" style="background:transparent;border:0;color:#94a3b8;cursor:pointer;padding:4px;font-size:18px;line-height:1;">×</button>';
    document.body.appendChild(bar);

    var openLink = bar.querySelector('a');
    if (openLink) openLink.addEventListener('click', function () { setMode('v30'); });
    var closeBtn = bar.querySelector('button');
    if (closeBtn) closeBtn.addEventListener('click', function () {
      try { localStorage.setItem(DISMISS_KEY, '1'); } catch (_) {}
      bar.remove();
    });

    // Auto-hide après 15 s
    setTimeout(function () {
      if (bar.parentNode) bar.remove();
    }, 15000);
  }

  function init() {
    if (isV30Page()) {
      setMode('v30');
      bindOptOut();
      return;
    }
    // Page legacy : tente de rediriger vers v30 (sauf opt-out).
    // Si la redirection est faite, on arrete ici (la page va recharger).
    if (autoRedirectToV30()) return;
    // Sinon (pas de mapping, ou opt-out v29) : affiche la banniere opt-in.
    renderLegacyBanner();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
