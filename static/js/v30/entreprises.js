/* ProspUp v30 — Entreprises : fetch + agrégation + rendu */
(function () {
  'use strict';

  var STATE = { companies: [], prospects: [], filtered: [] };

  function $(s) { return document.querySelector(s); }
  function $$(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }

  function esc(s) {
    var t = document.createElement('span');
    t.textContent = s == null ? '' : String(s);
    return t.innerHTML;
  }

  function initials(name) {
    var n = String(name || '').trim();
    if (!n) return '—';
    return n.slice(0, 2).toUpperCase();
  }

  function relativeDate(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(iso);
      var diffJ = Math.floor((Date.now() - d.getTime()) / 86400000);
      if (diffJ <= 0) return "aujourd'hui";
      if (diffJ === 1) return 'hier';
      if (diffJ < 7) return 'il y a ' + diffJ + ' j';
      if (diffJ < 60) return 'il y a ' + Math.floor(diffJ / 7) + ' sem';
      return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
    } catch (_) { return iso; }
  }

  function parseTags(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.filter(Boolean);
    try { return JSON.parse(raw) || []; }
    catch (_) { return String(raw).split(',').map(function (s) { return s.trim(); }).filter(Boolean); }
  }

  function fetchJSON(url) {
    return fetch(url, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
  }

  // ─── Agrégation ────────────────────────────────────────────
  var PIPED = ['Rendez-vous', 'Proposition', 'À rappeler'];

  function buildRows() {
    var byCid = {};
    STATE.prospects.forEach(function (p) {
      var cid = p.company_id;
      if (!cid) return;
      if (!byCid[cid]) byCid[cid] = { total: 0, piped: 0, won: 0, lastContact: '' };
      byCid[cid].total++;
      if (PIPED.indexOf(p.statut) >= 0) byCid[cid].piped++;
      if (p.statut === 'Gagné') byCid[cid].won++;
      var lc = p.lastContact || '';
      if (lc > byCid[cid].lastContact) byCid[cid].lastContact = lc;
    });
    return STATE.companies.map(function (c) {
      var agg = byCid[c.id] || { total: 0, piped: 0, won: 0, lastContact: '' };
      return {
        id: c.id,
        groupe: c.groupe || '',
        site: c.site || '',
        tags: parseTags(c.tags),
        total: agg.total,
        piped: agg.piped,
        won: agg.won,
        lastContact: agg.lastContact
      };
    }).sort(function (a, b) {
      // Tri : piped > total prospects > nom
      if (b.piped !== a.piped) return b.piped - a.piped;
      if (b.total !== a.total) return b.total - a.total;
      return (a.groupe || '').localeCompare(b.groupe || '');
    });
  }

  // ─── KPIs ─────────────────────────────────────────────────
  function renderKPIs(rows) {
    var total = rows.length;
    var piped = rows.filter(function (r) { return r.piped > 0; }).length;
    var prospectsTotal = rows.reduce(function (s, r) { return s + r.total; }, 0);
    var thresholdMs = Date.now() - 30 * 86400000;
    var active = rows.filter(function (r) {
      return r.lastContact && new Date(r.lastContact).getTime() >= thresholdMs;
    }).length;
    var set = function (k, v) {
      var el = document.querySelector('[data-kpi="' + k + '"]');
      if (el) el.textContent = v.toLocaleString('fr-FR');
    };
    set('total', total);
    set('piped', piped);
    set('prospects', prospectsTotal);
    set('last', active);
    var totalH = document.querySelector('[data-v30-entreprises] [data-field="total"]');
    if (totalH) totalH.textContent = total.toLocaleString('fr-FR');
  }

  // ─── Tags (2 + extra) ─────────────────────────────────────
  function renderTags(tags) {
    if (!tags || !tags.length) return '';
    var shown = tags.slice(0, 2);
    var extra = tags.length - 2;
    var html = shown.map(function (t) { return '<span class="badge">' + esc(t) + '</span>'; }).join(' ');
    if (extra > 0) html += ' <span class="badge muted">+' + extra + '</span>';
    return html;
  }

  // ─── Table ────────────────────────────────────────────────
  function renderRows(rows) {
    var tbody = document.querySelector('[data-v30-rows]');
    if (!tbody) return;
    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8"><div class="v30-pp-empty">Aucune entreprise pour ce filtre.</div></td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function (r) {
      return '<tr data-id="' + r.id + '">' +
        '<td style="padding-left:14px;">' +
          '<a href="/v30/entreprise/' + r.id + '" style="display:flex;align-items:center;gap:8px;text-decoration:none;color:inherit;">' +
            '<span style="width:28px;height:28px;border-radius:6px;background:var(--surface-2);border:1px solid var(--border);display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;">' + esc(initials(r.groupe)) + '</span>' +
            '<span style="font-weight:500;" class="truncate">' + esc(r.groupe || '—') + '</span>' +
          '</a>' +
        '</td>' +
        '<td class="truncate" style="max-width:180px;color:var(--text-2);">' + esc(r.site || '—') + '</td>' +
        '<td class="num"><span style="color:var(--accent);font-weight:500;">' + r.total + '</span></td>' +
        '<td class="num">' + (r.piped || '—') + '</td>' +
        '<td class="num">' + (r.won || '—') + '</td>' +
        '<td style="color:var(--text-2);">' + esc(relativeDate(r.lastContact)) + '</td>' +
        '<td><div style="display:flex;gap:4px;flex-wrap:wrap;">' + renderTags(r.tags) + '</div></td>' +
        '<td></td>' +
      '</tr>';
    }).join('');
  }

  function renderPagination(rows) {
    var host = document.querySelector('[data-v30-pagination] [data-field="range"]');
    if (host) {
      host.textContent = rows.length === 0
        ? '0 entreprise'
        : rows.length + ' entreprise' + (rows.length > 1 ? 's' : '');
    }
  }

  // ─── Vue Cartes (parite v29) ─────────────────────────────
  function renderCards(rows) {
    var host = document.querySelector('[data-v30-ent-panel="cards"]');
    if (!host) return;
    if (rows.length === 0) {
      host.innerHTML = '<div class="v30-pp-empty" style="padding:40px;text-align:center;">Aucune entreprise pour ce filtre.</div>';
      return;
    }
    host.innerHTML = rows.map(function (r) {
      var tagsHtml = (r.tags || []).slice(0, 3).map(function (t) {
        return '<span class="badge" style="font-size:10px;">' + esc(t) + '</span>';
      }).join(' ');
      var extra = (r.tags || []).length - 3;
      if (extra > 0) tagsHtml += ' <span class="badge muted" style="font-size:10px;">+' + extra + '</span>';
      return '<a class="v30-ent-card" href="/v30/entreprise/' + r.id + '">' +
        '<div class="v30-ent-card__head">' +
          '<span class="v30-ent-card__logo">' + esc(initials(r.groupe)) + '</span>' +
          '<div class="v30-ent-card__title-box">' +
            '<div class="v30-ent-card__title truncate">' + esc(r.groupe || '—') + '</div>' +
            '<div class="v30-ent-card__site truncate">' + esc(r.site || '—') + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="v30-ent-card__stats">' +
          '<div class="v30-ent-card__stat"><span class="v30-ent-card__stat-v num">' + r.total + '</span><span class="v30-ent-card__stat-l">prosp</span></div>' +
          '<div class="v30-ent-card__stat"><span class="v30-ent-card__stat-v num">' + (r.piped || 0) + '</span><span class="v30-ent-card__stat-l">RDV/propale</span></div>' +
          '<div class="v30-ent-card__stat"><span class="v30-ent-card__stat-v num">' + (r.won || 0) + '</span><span class="v30-ent-card__stat-l">gagnés</span></div>' +
        '</div>' +
        (tagsHtml ? '<div class="v30-ent-card__tags">' + tagsHtml + '</div>' : '') +
        '<div class="v30-ent-card__foot muted">' + esc(relativeDate(r.lastContact)) + '</div>' +
      '</a>';
    }).join('');
  }

  function bindViewSwitch() {
    var seg = document.querySelector('[data-v30-ent-view]');
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
      document.querySelectorAll('[data-v30-ent-panel]').forEach(function (p) {
        p.hidden = (p.dataset.v30EntPanel !== v);
      });
      if (v === 'cards') renderCards(STATE.filtered);
    });
  }

  // ─── Recherche ────────────────────────────────────────────
  function applyFilter(q) {
    q = (q || '').trim().toLowerCase();
    STATE.filtered = !q ? STATE.rows.slice() : STATE.rows.filter(function (r) {
      return (r.groupe || '').toLowerCase().indexOf(q) >= 0
          || (r.site || '').toLowerCase().indexOf(q) >= 0
          || (r.tags || []).some(function (t) { return t.toLowerCase().indexOf(q) >= 0; });
    });
    renderRows(STATE.filtered);
    var cardsPanel = document.querySelector('[data-v30-ent-panel="cards"]');
    if (cardsPanel && !cardsPanel.hidden) renderCards(STATE.filtered);
    renderPagination(STATE.filtered);
  }

  function bindSearch() {
    var input = document.querySelector('[data-v30-search]');
    if (!input) return;
    var t = null;
    input.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () { applyFilter(input.value); }, 150);
    });
  }

  // ─── Init ─────────────────────────────────────────────────
  function init() {
    bindSearch();
    bindViewSwitch();
    fetchJSON('/api/data').then(function (res) {
      STATE.companies = (res && res.companies) || [];
      STATE.prospects = (res && res.prospects) || [];
      STATE.rows = buildRows();
      STATE.filtered = STATE.rows.slice();
      renderKPIs(STATE.rows);
      renderRows(STATE.filtered);
      renderPagination(STATE.filtered);
    }).catch(function (err) {
      console.error('[v30 entreprises] /api/data failed:', err);
      var tbody = document.querySelector('[data-v30-rows]');
      if (tbody) tbody.innerHTML = '<tr><td colspan="8"><div class="v30-pp-empty">Erreur de chargement. Réessayez.</div></td></tr>';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
