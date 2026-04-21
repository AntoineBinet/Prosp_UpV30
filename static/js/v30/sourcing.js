/* ProspUp v30 — Sourcing : fetch candidats, kanban par status + grille */
(function () {
  'use strict';

  // Mapping des statuts DB → colonnes kanban du JSX
  // Les valeurs exactes de `candidates.status` peuvent varier — on garde un
  // mapping défensif et on tombe par défaut dans "Vivier".
  var COLS = [
    { key: 'vivier',       title: 'Vivier',        color: 'var(--info)',              statuses: ['Vivier', 'vivier', 'Actif', null, ''] },
    { key: 'qualifie',     title: 'Qualifié',      color: 'var(--accent)',            statuses: ['Qualifié', 'qualifie', 'Solide'] },
    { key: 'propose',      title: 'Proposé',       color: 'oklch(0.50 0.15 280)',     statuses: ['Proposé', 'propose', 'Contacté', 'contacted'] },
    { key: 'entretien',    title: 'En entretien',  color: 'oklch(0.50 0.14 75)',      statuses: ['En entretien', 'entretien', 'Entretien'] },
    { key: 'place',        title: 'Placé',         color: 'var(--success)',           statuses: ['Placé', 'place', 'Placed'] }
  ];

  var STATE = { candidates: [] };

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
  function parseSkills(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.filter(Boolean);
    try { return JSON.parse(raw) || []; }
    catch (_) { return String(raw).split(',').map(function (s) { return s.trim(); }).filter(Boolean); }
  }
  function fetchJSON(url) {
    return fetch(url, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function findColForStatus(statut) {
    for (var i = 0; i < COLS.length; i++) {
      if (COLS[i].statuses.indexOf(statut) >= 0) return i;
    }
    return 0; // fallback : Vivier
  }

  function renderCard(c) {
    var skills = parseSkills(c.skills || c.tech);
    var shown = skills.slice(0, 3);
    var extra = skills.length - 3;
    var role = c.role || c.seniority || '—';
    var location = c.location || '';
    return '<a class="v30-sc-card" href="/v30/candidat/' + c.id + '">' +
      '<div class="v30-sc-card__head">' +
        '<span class="avatar">' + esc(initials(c.name)) + '</span>' +
        '<div style="flex:1;min-width:0;">' +
          '<div class="v30-sc-card__name truncate">' + esc(c.name || '—') + '</div>' +
          '<div class="v30-sc-card__role truncate">' + esc(role) + '</div>' +
        '</div>' +
      '</div>' +
      (shown.length
        ? '<div class="v30-sc-card__skills">' +
            shown.map(function (s) { return '<span class="badge">' + esc(s) + '</span>'; }).join('') +
            (extra > 0 ? '<span class="badge muted">+' + extra + '</span>' : '') +
          '</div>'
        : '') +
      (location
        ? '<div class="v30-sc-card__meta">' +
            '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>' +
            esc(location) +
          '</div>'
        : '') +
    '</a>';
  }

  function renderPipeline() {
    var host = document.querySelector('[data-v30-sc-kanban]');
    if (!host) return;
    var buckets = COLS.map(function () { return []; });
    STATE.candidates.forEach(function (c) {
      buckets[findColForStatus(c.status)].push(c);
    });
    host.innerHTML = COLS.map(function (col, i) {
      var items = buckets[i];
      var body = items.length === 0
        ? '<div class="v30-pp-empty" style="padding:16px 8px;font-size:12px;">—</div>'
        : items.map(renderCard).join('');
      return '<div class="v30-sc-col">' +
        '<div class="v30-sc-col__head">' +
          '<span class="v30-sc-col__dot" style="background:' + col.color + ';"></span>' +
          '<span class="v30-sc-col__title">' + esc(col.title) + '</span>' +
          '<span class="v30-sc-col__count num">' + items.length + '</span>' +
          '<div class="v30-spacer"></div>' +
        '</div>' + body +
      '</div>';
    }).join('');
  }

  function renderGrid() {
    var host = document.querySelector('[data-v30-sc-grid]');
    if (!host) return;
    if (STATE.candidates.length === 0) {
      host.innerHTML = '<div class="empty" style="grid-column:1/-1;padding:20px;">Aucun candidat.</div>';
      return;
    }
    host.innerHTML = STATE.candidates.map(function (c) {
      var skills = parseSkills(c.skills || c.tech).slice(0, 4);
      return '<div class="card v30-sc-card" style="padding:12px;">' +
        '<div class="v30-sc-card__head">' +
          '<span class="avatar avatar-md">' + esc(initials(c.name)) + '</span>' +
          '<div style="flex:1;min-width:0;">' +
            '<div style="font-size:13px;font-weight:500;" class="truncate">' + esc(c.name || '—') + '</div>' +
            '<div style="font-size:11.5px;color:var(--text-3);" class="truncate">' + esc(c.role || c.seniority || '—') + '</div>' +
          '</div>' +
        '</div>' +
        (skills.length
          ? '<div class="v30-sc-card__skills" style="margin-top:10px;">' +
              skills.map(function (s) { return '<span class="badge">' + esc(s) + '</span>'; }).join('') +
            '</div>'
          : '') +
        (c.location ? '<div class="v30-sc-card__meta" style="margin-top:8px;">' + esc(c.location) + '</div>' : '') +
        '<div style="display:flex;gap:6px;margin-top:10px;">' +
          '<a class="btn btn-sm" href="/v30/candidat/' + c.id + '">Voir fiche</a>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function renderCount() {
    var el = document.querySelector('[data-v30-sourcing] [data-field="count"]');
    if (el) el.textContent = '· ' + STATE.candidates.length + ' actif' + (STATE.candidates.length > 1 ? 's' : '');
  }

  // ─── Vue switch ──────────────────────────────────────────
  function bindViewSwitch() {
    var seg = document.querySelector('[data-v30-sc-view]');
    if (!seg) return;
    seg.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-view]');
      if (!btn) return;
      var v = btn.dataset.view;
      seg.querySelectorAll('button[data-view]').forEach(function (b) {
        var active = (b === btn);
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      document.querySelectorAll('[data-v30-sc-panel]').forEach(function (p) {
        p.hidden = (p.dataset.v30ScPanel !== v);
      });
      if (v === 'grid') renderGrid();
    });
  }

  function bindMatchClose() {
    var btn = document.querySelector('[data-v30-sc-match-close]');
    var banner = document.querySelector('[data-v30-sc-match]');
    if (btn && banner) btn.addEventListener('click', function () { banner.hidden = true; });
  }

  function bindAdd() {
    var btn = document.querySelector('[data-v30-add]');
    if (btn) btn.addEventListener('click', function () {
      // Redirige vers le flux Ajout candidat legacy (modale existante)
      window.location.href = '/sourcing';
    });
  }

  // ─── Init ────────────────────────────────────────────────
  function init() {
    bindViewSwitch();
    bindMatchClose();
    bindAdd();
    fetchJSON('/api/candidates').then(function (res) {
      // /api/candidates renvoie un array direct. Fallback defensif sinon.
      var list = Array.isArray(res)
        ? res
        : ((res && (res.candidates || res.items)) || []);
      // Ignore les candidats archives (comme v29)
      STATE.candidates = list.filter(function (c) {
        return !c.is_archived && !c.deleted_at;
      });
      renderCount();
      renderPipeline();
    }).catch(function (err) {
      console.error('[v30 sourcing] /api/candidates failed:', err);
      var host = document.querySelector('[data-v30-sc-kanban]');
      if (host) host.innerHTML = '<div class="empty" style="grid-column:1/-1;padding:40px;">Erreur de chargement.</div>';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
