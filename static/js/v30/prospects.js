/* ProspUp v30 — Prospects : helpers + state */
(function (global) {
  'use strict';

  var STATE = {
    q: '',
    limit: 50,
    offset: 0,
    total: 0,
    prospects: [],
    companies: {},
    selected: new Set()
  };

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

  function shortDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    } catch (_) { return iso; }
  }

  function statusClass(statut) {
    var map = {
      'Rendez-vous':  'status-meeting',
      'Prospecté':    'status-new',
      "Pas d'actions": 'status-new',
      'Contacté':     'status-contact',
      'À rappeler':   'status-proposal',
      'Proposition':  'status-proposal',
      'Gagné':        'status-won',
      'Perdu':        'status-lost'
    };
    return map[statut] || '';
  }

  function fetchJSON(url, opts) {
    return fetch(url, Object.assign({
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    }, opts || {})).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function fetchPostJSON(url, body) {
    return fetchJSON(url, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
  }

  // ─── Rendu Table ────────────────────────────────────────────
  function renderPertinence(n) {
    n = Math.max(0, Math.min(5, Number(n) || 0));
    var html = '<span class="v30-pertinence" aria-label="Pertinence ' + n + '/5">';
    for (var i = 1; i <= 5; i++) {
      var on = i <= n ? ' is-on' : '';
      html += '<span class="v30-pertinence__bar' + on + '" style="height:' + (10 + i * 1.3) + 'px;"></span>';
    }
    return html + '</span>';
  }

  function renderTel(tel) {
    if (!tel) return '<span style="color:var(--text-muted);font-size:11px;">—</span>';
    var clean = String(tel).replace(/\s/g, '');
    return '<a class="v30-pp-tel" href="tel:' + esc(clean) + '" title="Appeler">' +
      '<span class="v30-pp-tel__badge">' +
        '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 17v3a2 2 0 0 1-2 2 19 19 0 0 1-17-17 2 2 0 0 1 2-2h3l2 5-2 1a12 12 0 0 0 6 6l1-2 5 2z"/></svg>' +
      '</span>' +
      '<span class="v30-pp-tel__number">' + esc(tel) + '</span>' +
    '</a>';
  }

  function renderTags(tagsRaw) {
    if (!tagsRaw) return '';
    var tags = [];
    if (Array.isArray(tagsRaw)) tags = tagsRaw;
    else if (typeof tagsRaw === 'string') {
      try { tags = JSON.parse(tagsRaw); } catch (_) { tags = tagsRaw.split(',').map(function (s) { return s.trim(); }); }
    }
    tags = tags.filter(Boolean);
    if (!tags.length) return '';
    var shown = tags.slice(0, 2);
    var extra = tags.length - 2;
    var html = shown.map(function (t) { return '<span class="badge">' + esc(t) + '</span>'; }).join(' ');
    if (extra > 0) html += ' <span class="badge muted">+' + extra + '</span>';
    return html;
  }

  function renderRow(p) {
    var sel = STATE.selected.has(p.id);
    var cls = statusClass(p.statut);
    var coName = (p.company_groupe || STATE.companies[p.company_id] || '').trim();
    return '<tr class="' + (sel ? 'is-selected' : '') + '" data-id="' + p.id + '">' +
      '<td style="padding-left:14px;">' +
        '<input type="checkbox" data-v30-row-select' + (sel ? ' checked' : '') + ' aria-label="Sélectionner">' +
      '</td>' +
      '<td>' +
        '<a class="v30-pp-name" href="#" data-v30-open="' + p.id + '">' +
          '<span class="avatar">' + esc(initials(p.name)) + '</span>' +
          '<div>' +
            '<div class="v30-pp-name__value truncate">' + esc(p.name || '—') + '</div>' +
            '<div class="v30-pp-name__role truncate">' + esc(p.fonction || '') + '</div>' +
          '</div>' +
        '</a>' +
      '</td>' +
      '<td class="truncate" style="max-width:160px;">' + esc(coName) + '</td>' +
      '<td>' + (p.statut ? '<span class="status ' + cls + '">' + esc(p.statut) + '</span>' : '—') + '</td>' +
      '<td>' + renderPertinence(p.pertinence) + '</td>' +
      '<td>' + renderTel(p.telephone) + '</td>' +
      '<td style="color:var(--text-2);">' + esc(relativeDate(p.lastContact)) + '</td>' +
      '<td class="num mono" style="color:var(--text-2);">' + esc(shortDate(p.nextFollowUp)) + '</td>' +
      '<td><div style="display:flex;gap:4px;flex-wrap:wrap;">' + renderTags(p.tags) + '</div></td>' +
      '<td><div class="v30-pp-actions">' +
        (p.telephone ? '<a class="btn btn-ghost btn-sm btn-icon" href="tel:' + esc(String(p.telephone).replace(/\s/g, '')) + '" title="Appeler">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M22 17v3a2 2 0 0 1-2 2 19 19 0 0 1-17-17 2 2 0 0 1 2-2h3l2 5-2 1a12 12 0 0 0 6 6l1-2 5 2z"/></svg>' +
        '</a>' : '') +
        '<button type="button" class="btn btn-ghost btn-sm btn-icon" data-v30-push="' + p.id + '" title="Pousser">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>' +
        '</button>' +
      '</div></td>' +
    '</tr>';
  }

  function renderTable() {
    var tbody = document.querySelector('[data-v30-rows]');
    if (!tbody) return;
    if (STATE.prospects.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10"><div class="v30-pp-empty">Aucun prospect pour ces filtres.</div></td></tr>';
      return;
    }
    tbody.innerHTML = STATE.prospects.map(renderRow).join('');
  }

  // ─── Rendu Kanban ────────────────────────────────────────────
  var KANBAN_COLS = [
    { statuts: ["Pas d'actions", 'Prospecté'], t: 'Prospecter',  col: 'var(--info)' },
    { statuts: ['Contacté'],                     t: 'Contacté',    col: 'var(--accent)' },
    { statuts: ['Rendez-vous'],                  t: 'RDV',          col: 'oklch(0.50 0.15 280)' },
    { statuts: ['Proposition', 'À rappeler'],   t: 'Proposition', col: 'oklch(0.50 0.14 75)' },
    { statuts: ['Gagné'],                        t: 'Gagné',        col: 'var(--success)' }
  ];

  function renderKanban() {
    var host = document.querySelector('[data-v30-kanban]');
    if (!host) return;
    var buckets = KANBAN_COLS.map(function () { return []; });
    STATE.prospects.forEach(function (p) {
      var idx = KANBAN_COLS.findIndex(function (c) { return c.statuts.indexOf(p.statut) >= 0; });
      if (idx < 0) idx = 0;
      buckets[idx].push(p);
    });
    host.innerHTML = KANBAN_COLS.map(function (c, i) {
      var items = buckets[i];
      var body = items.length === 0
        ? '<div class="v30-pp-empty" style="padding:16px 8px;font-size:12px;">—</div>'
        : items.map(function (p) {
            var coName = (p.company_groupe || STATE.companies[p.company_id] || '').trim();
            return '<a class="v30-pp-kcard" href="#" data-v30-open="' + p.id + '">' +
              '<div class="v30-pp-kcard__name truncate">' + esc(p.name || '—') + '</div>' +
              '<div class="v30-pp-kcard__co truncate">' + esc(coName) + '</div>' +
              '<div class="v30-pp-kcard__foot">' +
                renderTags(p.tags) +
                '<span class="v30-spacer"></span>' +
              '</div>' +
            '</a>';
          }).join('');
      return '<div class="v30-pp-kcol">' +
        '<div class="v30-pp-kcol__head">' +
          '<span class="v30-pp-kcol__dot" style="background:' + c.col + ';"></span>' +
          '<span class="v30-pp-kcol__title">' + esc(c.t) + '</span>' +
          '<span class="v30-pp-kcol__count num">' + items.length + '</span>' +
        '</div>' +
        body +
      '</div>';
    }).join('');
  }

  // ─── Rendu Split (liste + panel) ────────────────────────────
  function renderSplit() {
    var list = document.querySelector('[data-v30-split-list]');
    if (!list) return;
    if (STATE.prospects.length === 0) {
      list.innerHTML = '<div class="v30-pp-empty">Aucun prospect.</div>';
      return;
    }
    list.innerHTML = STATE.prospects.map(function (p, i) {
      var cls = statusClass(p.statut);
      var coName = (p.company_groupe || STATE.companies[p.company_id] || '').trim();
      return '<a class="v30-pp-split__row" href="#" data-v30-split-open="' + p.id + '">' +
        '<span class="avatar">' + esc(initials(p.name)) + '</span>' +
        '<div style="flex:1;min-width:0;">' +
          '<div class="truncate" style="font-size:12.5px;font-weight:500;">' + esc(p.name || '—') + '</div>' +
          '<div class="truncate" style="font-size:11px;color:var(--text-3);">' + esc(coName) + '</div>' +
        '</div>' +
        (p.statut ? '<span class="status ' + cls + '" style="font-size:10px;padding:1px 6px;">' + esc(p.statut) + '</span>' : '') +
      '</a>';
    }).join('');
  }

  function renderSplitDetail(p) {
    var host = document.querySelector('[data-v30-split-detail]');
    if (!host) return;
    if (!p) {
      host.innerHTML = '<div class="empty">Sélectionne un prospect dans la liste pour voir le détail.</div>';
      return;
    }
    var coName = (p.company_groupe || STATE.companies[p.company_id] || '').trim();
    host.innerHTML =
      '<div style="display:flex;align-items:center;gap:12px;padding-bottom:12px;border-bottom:1px solid var(--border);">' +
        '<span class="avatar avatar-lg">' + esc(initials(p.name)) + '</span>' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-size:18px;font-weight:500;">' + esc(p.name || '—') + '</div>' +
          '<div style="font-size:12px;color:var(--text-3);">' + esc(p.fonction || '') + (coName ? ' · ' + esc(coName) : '') + '</div>' +
        '</div>' +
      '</div>' +
      '<div style="margin-top:16px;display:grid;grid-template-columns:1fr 240px;gap:16px;">' +
        '<div>' +
          '<div class="label">Notes</div>' +
          '<div class="card" style="padding:12px;font-size:12.5px;color:var(--text-2);">' +
            (p.notes ? esc(p.notes) : '<span class="muted">Aucune note.</span>') +
          '</div>' +
          '<div class="label" style="margin-top:14px;">Statut</div>' +
          '<div>' + (p.statut ? '<span class="status ' + statusClass(p.statut) + '">' + esc(p.statut) + '</span>' : '—') + '</div>' +
        '</div>' +
        '<div class="stack gap-2">' +
          '<div class="card" style="padding:12px;">' +
            '<div class="label">Contact</div>' +
            '<div style="font-size:12px;color:var(--text-2);display:grid;gap:6px;">' +
              (p.email ? '<div>' + esc(p.email) + '</div>' : '') +
              (p.telephone ? '<div class="mono">' + esc(p.telephone) + '</div>' : '') +
              (p.linkedin ? '<div class="truncate"><a href="' + esc(p.linkedin) + '" target="_blank" rel="noopener">LinkedIn</a></div>' : '') +
            '</div>' +
          '</div>' +
          '<div class="card" style="padding:12px;">' +
            '<div class="label">Tags</div>' +
            '<div style="display:flex;gap:4px;flex-wrap:wrap;">' + renderTags(p.tags) + '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  // ─── Bulk bar ────────────────────────────────────────────────
  function renderBulk() {
    var bar = document.querySelector('[data-v30-bulk]');
    if (!bar) return;
    var n = STATE.selected.size;
    bar.hidden = (n === 0);
    var count = bar.querySelector('[data-field="n"]');
    if (count) count.textContent = n;
  }

  // Export
  global.ProspV30 = {
    STATE: STATE,
    esc: esc,
    initials: initials,
    relativeDate: relativeDate,
    shortDate: shortDate,
    statusClass: statusClass,
    fetchJSON: fetchJSON,
    fetchPostJSON: fetchPostJSON,
    renderTable: renderTable,
    renderPertinence: renderPertinence,
    renderKanban: renderKanban,
    renderSplit: renderSplit,
    renderSplitDetail: renderSplitDetail,
    renderBulk: renderBulk
  };

  // ─── Fetch + orchestration ──────────────────────────────────
  function loadProspects() {
    var params = new URLSearchParams({
      q: STATE.q || '',
      limit: STATE.limit,
      offset: STATE.offset
    });
    return fetchJSON('/api/search?' + params.toString()).then(function (res) {
      STATE.prospects = (res && res.prospects) || [];
      STATE.companies = {};
      ((res && res.companies) || []).forEach(function (c) { STATE.companies[c.id] = c.groupe || c.name || ''; });
      STATE.total = (res && res.counts && res.counts.prospects) || STATE.prospects.length;
      renderAll();
      updatePagination();
      updateCounts();
    }).catch(function (err) {
      console.error('[v30 prospects] /api/search failed:', err);
    });
  }

  function renderAll() {
    renderTable();
    renderKanban();
    renderSplit();
    renderBulk();
  }

  function updatePagination() {
    var host = document.querySelector('[data-v30-pagination]');
    if (!host) return;
    var range = host.querySelector('[data-field="range"]');
    if (range) {
      var to = Math.min(STATE.offset + STATE.prospects.length, STATE.total);
      range.textContent = STATE.prospects.length === 0 ? '0 sur ' + STATE.total : (STATE.offset + 1) + '–' + to + ' sur ' + STATE.total;
    }
    var prev = host.querySelector('[data-field="prev"]');
    var next = host.querySelector('[data-field="next"]');
    if (prev) prev.disabled = (STATE.offset <= 0);
    if (next) next.disabled = (STATE.offset + STATE.limit >= STATE.total);
  }

  function updateCounts() {
    var totalEl = document.querySelector('[data-v30-prospects] [data-field="total"]');
    if (totalEl) totalEl.textContent = STATE.total.toLocaleString('fr-FR');
    var allEl = document.querySelector('.v30-pp-views [data-view-filter="all"] [data-field="count"]');
    if (allEl) allEl.textContent = STATE.total.toLocaleString('fr-FR');
  }

  // ─── View switch (table / kanban / split) ───────────────────
  function bindViewSwitch() {
    var seg = document.querySelector('[data-v30-view]');
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
      document.querySelectorAll('[data-v30-view-panel]').forEach(function (p) {
        p.hidden = (p.dataset.v30ViewPanel !== v);
      });
    });
  }

  // ─── Sélection (table checkboxes + split open) ──────────────
  function bindSelection() {
    document.addEventListener('change', function (e) {
      var cb = e.target.closest('[data-v30-row-select]');
      if (cb) {
        var tr = cb.closest('tr');
        var id = Number(tr && tr.dataset.id);
        if (!id) return;
        if (cb.checked) STATE.selected.add(id);
        else STATE.selected.delete(id);
        tr.classList.toggle('is-selected', cb.checked);
        renderBulk();
        return;
      }
      if (e.target.matches('[data-v30-select-all]')) {
        var all = e.target.checked;
        STATE.selected.clear();
        if (all) STATE.prospects.forEach(function (p) { STATE.selected.add(p.id); });
        renderTable();
        renderBulk();
      }
    });
  }

  // ─── Split : clic ligne → charge détail depuis STATE ────────
  function bindSplit() {
    document.addEventListener('click', function (e) {
      var a = e.target.closest('[data-v30-split-open]');
      if (!a) return;
      e.preventDefault();
      var id = Number(a.dataset.v30SplitOpen);
      var p = STATE.prospects.find(function (x) { return x.id === id; });
      document.querySelectorAll('[data-v30-split-open]').forEach(function (row) {
        row.classList.toggle('is-selected', Number(row.dataset.v30SplitOpen) === id);
      });
      renderSplitDetail(p);
    });
  }

  // ─── Ouvrir fiche (table + kanban) → redirige vers legacy ───
  function bindOpen() {
    document.addEventListener('click', function (e) {
      var a = e.target.closest('[data-v30-open]');
      if (!a) return;
      e.preventDefault();
      var id = a.dataset.v30Open;
      window.location.href = '/v30/prospect/' + encodeURIComponent(id);
    });
  }

  // ─── Bulk bar actions ───────────────────────────────────────
  function bindBulk() {
    var bar = document.querySelector('[data-v30-bulk]');
    if (!bar) return;
    bar.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;
      var ids = Array.from(STATE.selected);
      if (action === 'clear') {
        STATE.selected.clear();
        renderTable();
        renderBulk();
        return;
      }
      if (!ids.length) return;
      if (action === 'tag') {
        var tag = prompt('Tag à ajouter aux ' + ids.length + ' prospects :');
        if (!tag) return;
        fetchPostJSON('/api/prospects/bulk-status-tags', { ids: ids, add_tags: [tag] })
          .then(function () { STATE.selected.clear(); loadProspects(); })
          .catch(function (err) { alert('Échec : ' + err.message); });
      } else if (action === 'push') {
        // Pas de bulk-push natif — on ouvre la page Push avec les ids
        window.location.href = '/push?ids=' + ids.join(',');
      } else {
        alert('Action "' + action + '" : à brancher dans un commit futur.');
      }
    });
  }

  // ─── Recherche (debounced) ──────────────────────────────────
  function bindSearch() {
    var input = document.querySelector('[data-v30-search]');
    if (!input) return;
    var t = null;
    input.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () {
        STATE.q = input.value.trim();
        STATE.offset = 0;
        loadProspects();
      }, 200);
    });
  }

  // ─── Pagination ─────────────────────────────────────────────
  function bindPagination() {
    document.addEventListener('click', function (e) {
      var prev = e.target.closest('[data-v30-pagination] [data-field="prev"]');
      var next = e.target.closest('[data-v30-pagination] [data-field="next"]');
      if (prev && !prev.disabled) {
        STATE.offset = Math.max(0, STATE.offset - STATE.limit);
        loadProspects();
      } else if (next && !next.disabled) {
        STATE.offset += STATE.limit;
        loadProspects();
      }
    });
  }

  function init() {
    bindViewSwitch();
    bindSelection();
    bindSplit();
    bindOpen();
    bindBulk();
    bindSearch();
    bindPagination();
    loadProspects();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
