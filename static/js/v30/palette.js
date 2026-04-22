/* ProspUp v30 — Command palette : state + render + events */
(function () {
  'use strict';

  var STATE = { q: '', results: { prospects: [], companies: [], candidates: [] }, active: 0, items: [] };

  var ACTIONS = [
    { label: 'Créer un prospect',   sub: '',                         icon: 'plus',     k: 'P', href: '/v30/prospects?new=1' },
    { label: 'Nouvelle campagne',   sub: '',                         icon: 'send',     k: 'N', href: '/v30/push' },
    { label: 'Lancer Mode Prosp',   sub: 'Deck 3D premium',          icon: 'sparkles', k: 'M', action: 'modeProsp' },
    { label: 'Basculer le thème',   sub: 'Clair / sombre',           icon: 'moon',     k: 'T', action: 'theme' }
  ];
  var PAGES = [
    { label: 'Dashboard',   sub: "Vue d'ensemble",       icon: 'home',     href: '/v30/dashboard' },
    { label: 'Prospects',   sub: 'Tous les contacts',    icon: 'users',    href: '/v30/prospects' },
    { label: 'Entreprises', sub: 'Comptes',              icon: 'building', href: '/v30/entreprises' },
    { label: 'Candidats',   sub: 'Pipeline sourcing',    icon: 'user',     href: '/v30/sourcing' },
    { label: 'Push',        sub: 'Campagnes & templates',icon: 'send',     href: '/v30/push' },
    { label: 'Stats',       sub: 'Tableau de bord',      icon: 'chart',    href: '/v30/stats' },
    { label: 'Rapport',     sub: 'Rapport hebdomadaire', icon: 'report',   href: '/v30/rapport' },
    { label: 'Focus',       sub: 'Mode concentration',   icon: 'focus',    href: '/v30/focus' },
    { label: 'Calendrier',  sub: 'RDV & relances',       icon: 'calendar', href: '/v30/calendrier' },
    { label: 'Paramètres',  sub: 'Configuration & compte', icon: 'cog',    href: '/v30/parametres' },
    { label: 'Utilisateurs',sub: 'Gestion des comptes (admin)', icon: 'users', href: '/v30/users' },
    { label: 'Snapshots',   sub: 'Sauvegardes DB (admin)',icon: 'bookmark', href: '/v30/snapshots' },
    { label: 'Activité',    sub: "Journal d'actions (admin)", icon: 'clock', href: '/v30/activity' },
    { label: 'Collaboration', sub: 'Partage entreprises',  icon: 'users', href: '/v30/collab' },
    { label: 'Doublons',    sub: 'Détection & fusion',   icon: 'filter',   href: '/v30/duplicates' },
    { label: 'Métiers IA',  sub: 'Référentiels IA (admin)', icon: 'tag',   href: '/v30/metiers' },
    { label: 'Aide',        sub: 'Guide utilisateur',    icon: 'bulb',     href: '/v30/help' }
  ];

  function esc(s) {
    var t = document.createElement('span');
    t.textContent = s == null ? '' : String(s);
    return t.innerHTML;
  }
  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '??';
    return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }
  function iconSvg(name) {
    var common = 'width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
    var paths = {
      home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9v12h14V9"/>',
      users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6.5 6.5-6.5S15.5 16.4 15.5 20"/><circle cx="17" cy="9" r="3"/><path d="M15 14.3A5 5 0 0 1 21.5 19"/>',
      user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
      building: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/><path d="M10 21v-4h4v4"/>',
      send: '<path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>',
      chart: '<path d="M3 3v18h18"/><path d="M7 14l3-4 4 2 5-7"/>',
      focus: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
      calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
      sparkles: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5 5l3 3M16 16l3 3M5 19l3-3M16 8l3-3"/>'
    };
    return '<svg ' + common + '>' + (paths[name] || '') + '</svg>';
  }

  function fetchJSON(url) {
    return fetch(url, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  function row(opts) {
    var idx = STATE.items.length;
    var active = idx === STATE.active ? ' is-active' : '';
    var main = '<div class="v30-palette__row-main">' +
      '<div class="v30-palette__row-label">' + esc(opts.label) + '</div>' +
      (opts.sub ? '<div class="v30-palette__row-sub truncate">' + esc(opts.sub) + '</div>' : '') +
    '</div>';
    var iconHtml = opts.avatar
      ? '<span class="avatar" style="width:26px;height:26px;">' + esc(opts.avatar) + '</span>'
      : '<span class="v30-palette__row-icon">' + iconSvg(opts.icon || 'arrowR') + '</span>';
    var tail = opts.k
      ? '<span class="kbd">' + esc(opts.k) + '</span>'
      : (opts.tail || '');
    STATE.items.push({ href: opts.href, action: opts.action });
    return '<a class="v30-palette__row' + active + '" data-v30-palette-item="' + idx + '"' +
      (opts.href ? ' href="' + esc(opts.href) + '"' : ' href="#"') + '>' +
      iconHtml + main + tail +
    '</a>';
  }

  function section(title) {
    return '<div class="v30-palette__section-title">' + esc(title) + '</div>';
  }

  function statusClass(statut) {
    var map = {
      'Rendez-vous':  'status-meeting',
      'Contacté':     'status-contact',
      'Proposition':  'status-proposal',
      'Gagné':        'status-won',
      'Perdu':        'status-lost'
    };
    return map[statut] || 'status-new';
  }

  function render() {
    var body = document.querySelector('[data-v30-palette-body]');
    if (!body) return;
    STATE.items = [];
    STATE.active = 0;

    var html = '';

    // Actions rapides (toujours affichées si pas de query, ou si query matche)
    var q = STATE.q.toLowerCase();
    var matchedActions = ACTIONS.filter(function (a) {
      return !q || a.label.toLowerCase().indexOf(q) >= 0 || (a.sub || '').toLowerCase().indexOf(q) >= 0;
    });
    if (matchedActions.length) {
      html += section('Actions rapides');
      html += matchedActions.map(row).join('');
    }

    // Résultats de recherche
    if (q && STATE.results.prospects.length) {
      html += section('Prospects · ' + STATE.results.prospects.length + ' résultat' + (STATE.results.prospects.length > 1 ? 's' : ''));
      html += STATE.results.prospects.slice(0, 5).map(function (p) {
        return row({
          avatar: initials(p.name),
          label: p.name || '—',
          sub: (p.fonction ? p.fonction + ' · ' : '') + (p.company_groupe || ''),
          href: '/v30/prospect/' + p.id,
          tail: p.statut ? '<span class="status ' + statusClass(p.statut) + '">' + esc(p.statut) + '</span>' : ''
        });
      }).join('');
    }
    if (q && STATE.results.companies.length) {
      html += section('Entreprises · ' + STATE.results.companies.length + ' résultat' + (STATE.results.companies.length > 1 ? 's' : ''));
      html += STATE.results.companies.slice(0, 4).map(function (c) {
        return row({
          avatar: initials(c.groupe),
          label: c.groupe || '—',
          sub: c.site || '',
          href: '/v30/entreprise/' + c.id
        });
      }).join('');
    }
    if (q && STATE.results.candidates.length) {
      html += section('Candidats · ' + STATE.results.candidates.length + ' résultat' + (STATE.results.candidates.length > 1 ? 's' : ''));
      html += STATE.results.candidates.slice(0, 4).map(function (c) {
        return row({
          avatar: initials(c.name),
          label: c.name || '—',
          sub: c.role || c.seniority || '',
          href: '/v30/candidat/' + c.id
        });
      }).join('');
    }

    // Pages (toujours affichées si pas de query ou si matche)
    var matchedPages = PAGES.filter(function (p) {
      return !q || p.label.toLowerCase().indexOf(q) >= 0 || (p.sub || '').toLowerCase().indexOf(q) >= 0;
    });
    if (matchedPages.length) {
      html += section('Aller à…');
      html += matchedPages.map(row).join('');
    }

    if (STATE.items.length === 0) {
      html = '<div class="empty" style="padding:40px;">Aucun résultat pour « ' + esc(STATE.q) + ' ».</div>';
    }

    body.innerHTML = html;
  }

  // ─── Fetch debounced ─────────────────────────────────────
  var searchTimer = null;
  function search(q) {
    STATE.q = q;
    clearTimeout(searchTimer);
    if (!q) {
      STATE.results = { prospects: [], companies: [], candidates: [] };
      render();
      return;
    }
    searchTimer = setTimeout(function () {
      fetchJSON('/api/search?q=' + encodeURIComponent(q) + '&limit=10').then(function (res) {
        STATE.results = {
          prospects:  (res && res.prospects) || [],
          companies:  (res && res.companies) || [],
          candidates: (res && res.candidates) || []
        };
        render();
      }).catch(function (err) {
        console.error('[v30 palette] /api/search failed:', err);
      });
    }, 180);
  }

  // ─── Ouverture / fermeture ───────────────────────────────
  function open() {
    var bd = document.querySelector('[data-v30-palette-backdrop]');
    var pl = document.querySelector('[data-v30-palette]');
    if (!pl) return;
    pl.hidden = false;
    // Force reflow pour la transition
    void pl.offsetWidth;
    pl.classList.add('is-open');
    if (bd) bd.classList.add('is-visible');
    var input = document.querySelector('[data-v30-palette-input]');
    if (input) {
      input.value = STATE.q || '';
      setTimeout(function () { input.focus(); input.select(); }, 50);
    }
    render();
  }
  function close() {
    var bd = document.querySelector('[data-v30-palette-backdrop]');
    var pl = document.querySelector('[data-v30-palette]');
    if (!pl) return;
    pl.classList.remove('is-open');
    if (bd) bd.classList.remove('is-visible');
    setTimeout(function () { pl.hidden = true; }, 200);
  }
  function toggle() {
    var pl = document.querySelector('[data-v30-palette]');
    if (!pl) return;
    if (pl.hidden || !pl.classList.contains('is-open')) open();
    else close();
  }

  // ─── Navigation ↑↓ + Enter ───────────────────────────────
  function moveActive(delta) {
    if (!STATE.items.length) return;
    STATE.active = (STATE.active + delta + STATE.items.length) % STATE.items.length;
    document.querySelectorAll('[data-v30-palette-item]').forEach(function (el) {
      el.classList.toggle('is-active', Number(el.dataset.v30PaletteItem) === STATE.active);
    });
    var active = document.querySelector('[data-v30-palette-item].is-active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  function triggerActive(cmdKey) {
    var item = STATE.items[STATE.active];
    if (!item) return;
    if (item.action === 'theme') {
      var cur = document.documentElement.dataset.theme || 'dark';
      var next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('theme', next); } catch (_) {}
      close();
      return;
    }
    if (item.action === 'modeProsp') {
      close();
      // Lance Mode Prosp sur la sélection courante si on est sur /v30/prospects,
      // sinon sur tous les prospects du user (server-side via /api/data).
      var sel = (window.ProspV30 && window.ProspV30.STATE && window.ProspV30.STATE.selected) || null;
      var ids = sel ? Array.from(sel) : [];
      var run = function (prospectIds) {
        if (!prospectIds || !prospectIds.length) {
          if (typeof window.showToast === 'function') window.showToast('Aucun prospect à traiter', 'warning');
          return;
        }
        fetch('/api/mode-prosp/start', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: prospectIds })
        }).then(function (r) { return r.json(); })
          .then(function (res) {
            if (!res || !res.ok || !res.token) throw new Error((res && res.error) || 'Token manquant');
            window.open('/v30/mode-prosp?t=' + encodeURIComponent(res.token), '_blank');
          })
          .catch(function (e) {
            if (typeof window.showToast === 'function') window.showToast('Mode Prosp : ' + e.message, 'error');
          });
      };
      if (ids.length) { run(ids); return; }
      // Pas de sélection : on récupère la liste complète du user.
      fetch('/api/data', { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          var all = (res && res.prospects) || [];
          run(all.filter(function (p) { return !p.is_archived && !p.deleted_at; })
                 .map(function (p) { return p.id; }));
        })
        .catch(function () {
          if (typeof window.showToast === 'function') window.showToast('Impossible de charger les prospects', 'error');
        });
      return;
    }
    if (item.href) {
      if (cmdKey) window.open(item.href, '_blank', 'noopener');
      else window.location.href = item.href;
    }
  }

  function bind() {
    // Triggers d'ouverture
    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        toggle();
      } else if (e.key === 'Escape') {
        var pl = document.querySelector('[data-v30-palette]');
        if (pl && !pl.hidden) { e.preventDefault(); close(); }
      }
    });

    var triggerBtn = document.querySelector('[data-v30-cmdk]');
    if (triggerBtn) triggerBtn.addEventListener('click', open);

    var createBtn = document.querySelector('[data-v30-create]');
    if (createBtn) createBtn.addEventListener('click', open);

    var bd = document.querySelector('[data-v30-palette-backdrop]');
    if (bd) bd.addEventListener('click', close);

    var input = document.querySelector('[data-v30-palette-input]');
    if (input) {
      input.addEventListener('input', function () { search(input.value); });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown') { e.preventDefault(); moveActive(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1); }
        else if (e.key === 'Enter') { e.preventDefault(); triggerActive(e.metaKey || e.ctrlKey); }
      });
    }

    // Clic sur une ligne : navigation (passe par href, sauf si action=theme)
    document.addEventListener('click', function (e) {
      var el = e.target.closest('[data-v30-palette-item]');
      if (!el) return;
      var idx = Number(el.dataset.v30PaletteItem);
      STATE.active = idx;
      var item = STATE.items[idx];
      if (item && item.action === 'theme') {
        e.preventDefault();
        triggerActive(false);
      }
      // sinon, on laisse la navigation naturelle via href
    });
  }

  window.ProspPalette = { open: open, close: close, toggle: toggle };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
