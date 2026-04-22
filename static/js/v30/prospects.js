/* ProspUp v30 — Prospects : helpers + state */
(function (global) {
  'use strict';

  var ALL_COLS = [
    { key: 'select', label: 'Sélection', fixed: true },
    { key: 'name', label: 'Nom', fixed: true },
    { key: 'company', label: 'Entreprise' },
    { key: 'statut', label: 'Statut' },
    { key: 'pertinence', label: 'Pertinence' },
    { key: 'tel', label: 'Mobile' },
    { key: 'email', label: 'Email' },
    { key: 'push', label: 'Push' },
    { key: 'lastContact', label: 'Dernière action' },
    { key: 'relance', label: 'Prochain RDV' },
    { key: 'tags', label: 'Tags' },
    { key: 'actions', label: 'Actions', fixed: true }
  ];
  var DEFAULT_COLS = ALL_COLS.map(function (c) { return c.key; });
  var STATUS_OPTIONS = ["Pas d'actions", 'Appelé', 'À rappeler', 'Rendez-vous', 'Prospecté', 'Messagerie', 'Pas intéressé'];

  function loadCols() {
    try {
      var raw = localStorage.getItem('v30.prospects.cols');
      if (!raw) return DEFAULT_COLS.slice();
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : DEFAULT_COLS.slice();
    } catch (_) { return DEFAULT_COLS.slice(); }
  }
  function saveCols(arr) {
    try { localStorage.setItem('v30.prospects.cols', JSON.stringify(arr)); } catch (_) {}
  }

  var STATE = {
    q: '',
    limit: 50,
    offset: 0,
    total: 0,
    prospects: [],
    companies: {},
    selected: new Set(),
    filter: 'all',
    cols: loadCols(),
    filters: {
      statuts: [],
      pertMin: 0,
      tags: [],
      relanceFrom: '',
      relanceTo: '',
      callableOnly: false,
      companyId: null
    },
    bulkAction: null
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

  function renderEmail(email) {
    if (!email) return '<span style="color:var(--text-muted);font-size:11px;">—</span>';
    var clean = String(email).trim();
    return '<a class="v30-pp-email truncate" href="mailto:' + esc(clean) + '" title="' + esc(clean) + '" ' +
      'style="display:inline-block;max-width:180px;color:var(--text-2);font-size:12px;">' +
      esc(clean) + '</a>';
  }

  function renderPushBadges(p) {
    var parts = [];
    if (p.pushEmailSentAt) parts.push('<span class="badge" title="Push email envoyé le ' + esc(p.pushEmailSentAt) + '"' +
      ' style="font-size:10px;padding:1px 6px;">✉</span>');
    if (p.pushLinkedInSentAt) parts.push('<span class="badge" title="Push LinkedIn envoyé le ' + esc(p.pushLinkedInSentAt) + '"' +
      ' style="font-size:10px;padding:1px 6px;">in</span>');
    if (!parts.length) return '<span style="color:var(--text-muted);font-size:11px;">—</span>';
    return '<div style="display:inline-flex;gap:3px;">' + parts.join('') + '</div>';
  }

  function cellFor(p, key) {
    var cls = statusClass(p.statut);
    var coName = (p.company_groupe || STATE.companies[p.company_id] || '').trim();
    switch (key) {
      case 'select':
        return '<td style="padding-left:14px;">' +
          '<input type="checkbox" data-v30-row-select' + (STATE.selected.has(p.id) ? ' checked' : '') + ' aria-label="Sélectionner">' +
          '</td>';
      case 'name':
        return '<td>' +
          '<a class="v30-pp-name" href="#" data-v30-open="' + p.id + '">' +
            '<span class="avatar">' + esc(initials(p.name)) + '</span>' +
            '<div>' +
              '<div class="v30-pp-name__value truncate">' + esc(p.name || '—') + '</div>' +
              '<div class="v30-pp-name__role truncate">' + esc(p.fonction || '') + '</div>' +
            '</div>' +
          '</a>' +
        '</td>';
      case 'company':    return '<td class="truncate" style="max-width:160px;">' + esc(coName) + '</td>';
      case 'statut':     return '<td>' + (p.statut ? '<span class="status ' + cls + '">' + esc(p.statut) + '</span>' : '—') + '</td>';
      case 'pertinence': return '<td>' + renderPertinence(p.pertinence) + '</td>';
      case 'tel':        return '<td>' + renderTel(p.telephone) + '</td>';
      case 'email':      return '<td>' + renderEmail(p.email) + '</td>';
      case 'push':       return '<td>' + renderPushBadges(p) + '</td>';
      case 'lastContact': return '<td style="color:var(--text-2);">' + esc(relativeDate(p.lastContact)) + '</td>';
      case 'relance':    return '<td class="num mono" style="color:var(--text-2);">' + esc(shortDate(p.nextFollowUp)) + '</td>';
      case 'tags':       return '<td><div style="display:flex;gap:4px;flex-wrap:wrap;">' + renderTags(p.tags) + '</div></td>';
      case 'actions':
        return '<td><div class="v30-pp-actions">' +
          (p.telephone ? '<a class="btn btn-ghost btn-sm btn-icon" href="tel:' + esc(String(p.telephone).replace(/\s/g, '')) + '" title="Appeler">' +
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M22 17v3a2 2 0 0 1-2 2 19 19 0 0 1-17-17 2 2 0 0 1 2-2h3l2 5-2 1a12 12 0 0 0 6 6l1-2 5 2z"/></svg>' +
          '</a>' : '') +
          '<button type="button" class="btn btn-ghost btn-sm btn-icon" data-v30-ai="' + p.id + '" title="Enrichir via IA">' +
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2 4 4 2-4 2-2 4-2-4-4-2 4-2z"/></svg>' +
          '</button>' +
          '<a class="btn btn-sm" href="/v30/prospect/' + p.id + '" title="Ouvrir la fiche">Voir</a>' +
        '</div></td>';
      default: return '';
    }
  }

  function activeCols() {
    return ALL_COLS.filter(function (c) { return c.fixed || STATE.cols.indexOf(c.key) >= 0; });
  }

  function renderRow(p) {
    var sel = STATE.selected.has(p.id);
    var cells = activeCols().map(function (c) { return cellFor(p, c.key); }).join('');
    return '<tr class="' + (sel ? 'is-selected' : '') + '" data-id="' + p.id + '">' + cells + '</tr>';
  }

  function renderTableHead() {
    var thead = document.querySelector('.v30-pp-table thead tr');
    if (!thead) return;
    var cols = activeCols();
    var html = cols.map(function (c) {
      if (c.key === 'select') return '<th style="width:32px;padding-left:14px;"><input type="checkbox" data-v30-select-all aria-label="Tout sélectionner"></th>';
      if (c.key === 'name') return '<th style="width:240px;">' + esc(c.label) + '</th>';
      if (c.key === 'actions') return '<th style="width:120px;">' + esc(c.label) + '</th>';
      return '<th>' + esc(c.label) + '</th>';
    }).join('');
    thead.innerHTML = html;
  }

  function renderTable() {
    var tbody = document.querySelector('[data-v30-rows]');
    if (!tbody) return;
    renderTableHead();
    var colCount = activeCols().length;
    if (STATE.prospects.length === 0) {
      tbody.innerHTML = '<tr><td colspan="' + colCount + '"><div class="v30-pp-empty">Aucun prospect pour ces filtres.</div></td></tr>';
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
  // Sans query : on liste TOUS les prospects via /api/data.
  // Avec query : on bascule sur /api/search?q= (fuzzy server-side).
  function loadProspects() {
    var q = (STATE.q || '').trim();
    var url = q
      ? '/api/search?' + new URLSearchParams({ q: q, limit: 500, offset: 0 }).toString()
      : '/api/data';
    return fetchJSON(url).then(function (res) {
      var all = (res && res.prospects) || [];
      // Ignore les prospects archivés côté client (comme v29)
      all = all.filter(function (p) { return !p.is_archived && !p.deleted_at; });
      STATE.companies = {};
      ((res && res.companies) || []).forEach(function (c) { STATE.companies[c.id] = c.groupe || c.name || ''; });
      // Filtrage client-side selon le pill actif + filtres modal
      var filter = STATE.filter || 'all';
      var F = STATE.filters || {};
      var todayStr = new Date().toISOString().slice(0, 10);
      var filtered = all.filter(function (p) {
        if (filter === 'relance') {
          if (!/(relanc|relance|À rappeler|A rappeler|rappeler)/i.test(p.statut || '')) return false;
        } else if (filter === 'hot') {
          if (parseInt(p.pertinence, 10) < 4) return false;
        }
        if (F.statuts && F.statuts.length && F.statuts.indexOf(p.statut) < 0) return false;
        if (F.pertMin && parseInt(p.pertinence, 10) < F.pertMin) return false;
        if (F.callableOnly && !/\d/.test(String(p.telephone || ''))) return false;
        if (F.tags && F.tags.length) {
          var tagList = [];
          var raw = p.tags;
          if (Array.isArray(raw)) tagList = raw;
          else if (typeof raw === 'string') {
            try { tagList = JSON.parse(raw); } catch (_) { tagList = raw.split(',').map(function (s) { return s.trim(); }); }
          }
          var lower = tagList.map(function (t) { return String(t).toLowerCase(); });
          for (var ti = 0; ti < F.tags.length; ti++) {
            if (lower.indexOf(F.tags[ti].toLowerCase()) < 0) return false;
          }
        }
        if (F.companyId && Number(p.company_id) !== Number(F.companyId)) return false;
        if (F.relanceFrom || F.relanceTo) {
          var nf = p.nextFollowUp ? String(p.nextFollowUp).slice(0, 10) : '';
          if (!nf) return false;
          if (F.relanceFrom && nf < F.relanceFrom) return false;
          if (F.relanceTo && nf > F.relanceTo) return false;
        }
        return true;
      });
      STATE.total = filtered.length;
      STATE.allForKpis = all; // garde le dataset non filtre pour les KPI
      // Pagination client-side (utile surtout pour /api/data qui renvoie tout)
      var start = STATE.offset || 0;
      var end = start + (STATE.limit || 50);
      STATE.prospects = filtered.slice(start, end);
      renderAll();
      updatePagination();
      updateCounts();
      updateKpis();
      updateOverdueBanner();
    }).catch(function (err) {
      console.error('[v30 prospects] fetch failed:', err);
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

  // Banniere relances en retard (parite v29)
  function updateOverdueBanner() {
    var banner = document.querySelector('[data-v30-pp-banner]');
    if (!banner) return;
    if (sessionStorage.getItem('v30_pp_banner_closed') === '1') { banner.hidden = true; return; }
    var all = STATE.allForKpis || [];
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var overdue = 0;
    for (var i = 0; i < all.length; i++) {
      var nf = all[i].nextFollowUp;
      if (!nf) continue;
      try {
        var d = new Date(nf);
        if (!isNaN(d.getTime()) && d < today) overdue++;
      } catch (_) {}
    }
    if (overdue === 0) { banner.hidden = true; return; }
    banner.hidden = false;
    var c = banner.querySelector('[data-field="count"]');
    if (c) c.textContent = overdue;
    var p = banner.querySelector('[data-field="plural"]');
    if (p) p.textContent = overdue > 1 ? 's' : '';
  }
  function bindBannerClose() {
    var btn = document.querySelector('[data-v30-pp-banner-close]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var banner = document.querySelector('[data-v30-pp-banner]');
      if (banner) banner.hidden = true;
      sessionStorage.setItem('v30_pp_banner_closed', '1');
    });
  }

  // KPI cards : Total / Appelables / RDV / Prospectes (parite v29)
  function isCallable(p) {
    var tel = p && p.telephone ? String(p.telephone) : '';
    return !!tel && /\d/.test(tel);
  }
  function updateKpis() {
    var host = document.querySelector('[data-v30-pp-kpis]');
    if (!host) return;
    var all = STATE.allForKpis || [];
    var total = all.length;
    var callable = 0, rdv = 0, prospectes = 0;
    for (var i = 0; i < all.length; i++) {
      var p = all[i];
      if (isCallable(p)) callable++;
      var s = (p.statut || '').toLowerCase();
      if (s === 'rendez-vous' || p.rdvDate) rdv++;
      if (s === 'prospecté' || s === 'prospecte') prospectes++;
    }
    var fmt = function (n) { return n.toLocaleString('fr-FR'); };
    var set = function (key, v) {
      var el = host.querySelector('[data-kpi="' + key + '"]');
      if (el) el.textContent = fmt(v);
    };
    set('total', total);
    set('callable', callable);
    set('rdv', rdv);
    set('prospectes', prospectes);
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
  function openBulkModal(action, ids) {
    STATE.bulkAction = { action: action, ids: ids };
    var body = document.querySelector('[data-v30-bulk-body]');
    if (!body) return;
    var n = ids.length;
    var html = '';
    if (action === 'statut') {
      html = '<p class="muted" style="font-size:12.5px;margin:0 0 12px;">Mettre à jour le statut de <strong>' + n + '</strong> prospect' + (n > 1 ? 's' : '') + '.</p>' +
        '<div class="v30-field"><label>Nouveau statut</label><select class="select" data-v30-bulk-val>' +
        STATUS_OPTIONS.map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('') +
        '</select></div>';
    } else if (action === 'pertinence') {
      html = '<p class="muted" style="font-size:12.5px;margin:0 0 12px;">Définir la pertinence de <strong>' + n + '</strong> prospect' + (n > 1 ? 's' : '') + '.</p>' +
        '<div class="v30-field"><label>Pertinence</label><select class="select" data-v30-bulk-val>' +
        ['1','2','3','4','5'].map(function (v) { return '<option value="' + v + '">' + v + '/5</option>'; }).join('') +
        '</select></div>';
    } else if (action === 'relance') {
      var today = new Date().toISOString().slice(0, 10);
      html = '<p class="muted" style="font-size:12.5px;margin:0 0 12px;">Planifier une relance pour <strong>' + n + '</strong> prospect' + (n > 1 ? 's' : '') + '.</p>' +
        '<div class="v30-field"><label>Date de relance</label><input type="date" class="input" data-v30-bulk-val value="' + today + '"></div>' +
        '<div class="v30-field"><label class="v30-chip" style="width:fit-content;"><input type="checkbox" data-v30-bulk-clear> <span>Effacer la relance (laisser la date vide)</span></label></div>';
    } else if (action === 'tag') {
      html = '<p class="muted" style="font-size:12.5px;margin:0 0 12px;">Ajouter un ou plusieurs tags à <strong>' + n + '</strong> prospect' + (n > 1 ? 's' : '') + '.</p>' +
        '<div class="v30-field"><label>Tags (séparés par des virgules)</label><input class="input" data-v30-bulk-val placeholder="Ex. CTO, SaaS"></div>';
    } else if (action === 'archive') {
      html = '<p style="margin:0 0 12px;">Archiver <strong>' + n + '</strong> prospect' + (n > 1 ? 's' : '') + ' ?</p>' +
        '<p class="muted" style="font-size:12px;margin:0;">Ils seront masqués du tableau mais conservés en base.</p>';
    } else if (action === 'delete') {
      html = '<p style="margin:0 0 12px;color:var(--danger);font-weight:500;">Supprimer <strong>' + n + '</strong> prospect' + (n > 1 ? 's' : '') + ' ?</p>' +
        '<p class="muted" style="font-size:12px;margin:0;">Suppression réversible sous 10 s via la notification.</p>';
    }
    body.innerHTML = html;
    openModal(getModal('bulk'));
  }

  function runBulkAction() {
    var ctx = STATE.bulkAction;
    if (!ctx) return;
    var ids = ctx.ids;
    var action = ctx.action;
    var m = getModal('bulk');
    var btn = document.querySelector('[data-v30-bulk-apply]');
    if (btn) btn.disabled = true;
    var done = function (msg) {
      if (btn) btn.disabled = false;
      toast(msg || 'Action appliquée', 'success');
      STATE.selected.clear();
      closeModal(m);
      loadProspects();
    };
    var fail = function (err) {
      if (btn) btn.disabled = false;
      toast('Erreur : ' + (err.message || err), 'error');
    };
    var val = m.querySelector('[data-v30-bulk-val]');
    if (action === 'statut') {
      fetchPostJSON('/api/prospects/bulk-edit', { ids: ids, field: 'statut', value: val.value })
        .then(function () { done('Statut mis à jour'); }).catch(fail);
    } else if (action === 'pertinence') {
      fetchPostJSON('/api/prospects/bulk-edit', { ids: ids, field: 'pertinence', value: val.value })
        .then(function () { done('Pertinence mise à jour'); }).catch(fail);
    } else if (action === 'relance') {
      var clear = (m.querySelector('[data-v30-bulk-clear]') || {}).checked;
      fetchPostJSON('/api/prospects/bulk-update', { ids: ids, nextFollowUp: clear ? null : val.value })
        .then(function () { done(clear ? 'Relance effacée' : 'Relance planifiée'); }).catch(fail);
    } else if (action === 'tag') {
      var raw = (val.value || '').split(',').map(function (t) { return t.trim(); }).filter(Boolean);
      if (!raw.length) { if (btn) btn.disabled = false; toast('Saisis au moins un tag', 'warning'); return; }
      fetchPostJSON('/api/prospects/bulk-status-tags', { ids: ids, add_tags: raw })
        .then(function () { done(raw.length + ' tag(s) ajouté(s)'); }).catch(fail);
    } else if (action === 'archive') {
      fetchPostJSON('/api/prospects/bulk-archive', { ids: ids, archive: true })
        .then(function (r) { done((r && r.updated ? r.updated : ids.length) + ' prospect(s) archivé(s)'); }).catch(fail);
    } else if (action === 'delete') {
      bulkFetchLoop(ids, function (id) {
        return fetchPostJSON('/api/prospects/delete', { id: id });
      }).then(function (r) { done(r + ' prospect(s) supprimé(s)'); }).catch(fail);
    }
  }

  function bulkFetchLoop(ids, fn) {
    var done = 0;
    var errors = 0;
    function next(i) {
      if (i >= ids.length) return Promise.resolve(done);
      return fn(ids[i])
        .then(function () { done++; })
        .catch(function () { errors++; })
        .then(function () { return next(i + 1); });
    }
    return next(0);
  }

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
      if (!ids.length) { toast('Aucun prospect sélectionné', 'warning'); return; }
      if (action === 'push') { window.location.href = '/push?ids=' + ids.join(','); return; }
      openBulkModal(action, ids);
    });
    var apply = document.querySelector('[data-v30-bulk-apply]');
    if (apply) apply.addEventListener('click', runBulkAction);
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

  // ─── Pills (Tous / Mes / A relancer / Hot + saved views) ────
  function applyViewFilter(name) {
    // Filtres built-in : on patch STATE.filters puis on reload
    STATE.filter = name;
    STATE.offset = 0;
    loadProspects();
  }

  function bindBuiltinPills() {
    document.querySelectorAll('.v30-pp-views [data-view-filter]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.v30-pp-views [data-view-filter]').forEach(function (b) {
          b.classList.toggle('is-active', b === btn);
        });
        applyViewFilter(btn.dataset.viewFilter);
      });
    });
  }

  function renderSavedPills() {
    var host = document.querySelector('[data-v30-saved-views]');
    if (!host) return;
    host.innerHTML = (STATE.savedViews || []).map(function (v) {
      return '<button type="button" class="v30-pill" data-saved-view-id="' + v.id + '">' +
        esc(v.name) + ' <span class="v30-pill__x" data-saved-view-delete="' + v.id + '" aria-label="Supprimer">×</span>' +
      '</button>';
    }).join('');
    host.querySelectorAll('[data-saved-view-id]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        if (e.target.closest('[data-saved-view-delete]')) return;
        var v = (STATE.savedViews || []).find(function (x) { return x.id == btn.dataset.savedViewId; });
        if (!v) return;
        var st = v.state || {};
        STATE.q = st.q || '';
        var inp = document.querySelector('[data-v30-search]');
        if (inp) inp.value = STATE.q;
        STATE.filter = st.filter || 'all';
        STATE.offset = 0;
        loadProspects();
      });
    });
    host.querySelectorAll('[data-saved-view-delete]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = btn.dataset.savedViewDelete;
        if (!confirm('Supprimer cette vue ?')) return;
        fetch('/api/views/' + id, { method: 'DELETE', credentials: 'same-origin' })
          .then(loadSavedViews);
      });
    });
  }

  function loadSavedViews() {
    return fetchJSON('/api/views?page=prospects').then(function (rows) {
      STATE.savedViews = Array.isArray(rows) ? rows : [];
      renderSavedPills();
    }).catch(function () { STATE.savedViews = []; renderSavedPills(); });
  }

  function bindSaveView() {
    var btn = document.querySelector('[data-v30-save-view]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var name = prompt('Nom de la vue :');
      if (!name) return;
      fetch('/api/views/save', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page: 'prospects',
          name: name,
          state: { q: STATE.q || '', filter: STATE.filter || 'all' }
        })
      }).then(function (r) { return r.json(); })
        .then(function (res) {
          if (res.ok) loadSavedViews();
          else alert('Échec : ' + (res.error || 'inconnu'));
        });
    });
  }

  // ─── Helpers modal / toast ─────────────────────────────────
  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
  }
  function getModal(name) { return document.querySelector('[data-v30-pp-modal="' + name + '"]'); }
  function openModal(modal) {
    if (!modal) return;
    modal.hidden = false;
    void modal.offsetWidth;
    modal.classList.add('is-open');
    var first = modal.querySelector('input:not([type=hidden]), select, textarea, button:not([data-v30-modal-close])');
    if (first) try { first.focus(); } catch (_) {}
  }
  function closeModal(modal) {
    if (!modal) return;
    modal.classList.remove('is-open');
    setTimeout(function () { modal.hidden = true; }, 160);
  }
  function bindModalDismiss() {
    document.addEventListener('click', function (e) {
      var close = e.target.closest('[data-v30-modal-close]');
      if (close) {
        var m = close.closest('[data-v30-pp-modal]');
        if (m) closeModal(m);
        return;
      }
      var bd = e.target.closest('.v30-modal-bd');
      if (bd && e.target === bd && bd.dataset.v30PpModal) closeModal(bd);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      document.querySelectorAll('.v30-modal-bd.is-open[data-v30-pp-modal]').forEach(function (m) {
        closeModal(m);
      });
    });
  }

  // ─── Add prospect ──────────────────────────────────────────
  function populateCompaniesList() {
    var dl = document.querySelector('[data-v30-companies-list]');
    if (!dl) return;
    var names = {};
    Object.keys(STATE.companies).forEach(function (k) {
      var v = STATE.companies[k];
      if (v) names[v] = true;
    });
    dl.innerHTML = Object.keys(names).sort().map(function (n) {
      return '<option value="' + esc(n) + '">';
    }).join('');
  }
  function bindAdd() {
    var btn = document.querySelector('[data-v30-add]');
    if (btn) btn.addEventListener('click', function () {
      populateCompaniesList();
      openModal(getModal('add'));
    });
    var save = document.querySelector('[data-v30-pp-add-save]');
    if (save) save.addEventListener('click', function () {
      var val = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
      var name = val('v30-pp-add-name');
      if (!name) { toast('Le nom est obligatoire', 'warning'); return; }
      var tagsRaw = val('v30-pp-add-tags');
      var tags = tagsRaw ? tagsRaw.split(',').map(function (t) { return t.trim(); }).filter(Boolean) : [];
      var payload = {
        name: name,
        fonction: val('v30-pp-add-fonction'),
        company_groupe: val('v30-pp-add-company'),
        company_site: val('v30-pp-add-site'),
        telephone: val('v30-pp-add-tel'),
        email: val('v30-pp-add-email'),
        linkedin: val('v30-pp-add-linkedin'),
        pertinence: val('v30-pp-add-pertinence'),
        statut: val('v30-pp-add-statut') || "Pas d'actions",
        tags: tags,
        notes: val('v30-pp-add-notes')
      };
      save.disabled = true;
      fetchPostJSON('/api/prospects/create', payload)
        .then(function (res) {
          if (res && res.ok) {
            toast('Prospect ajouté', 'success');
            closeModal(getModal('add'));
            ['v30-pp-add-name','v30-pp-add-fonction','v30-pp-add-company','v30-pp-add-site',
             'v30-pp-add-tel','v30-pp-add-email','v30-pp-add-linkedin','v30-pp-add-tags','v30-pp-add-notes']
              .forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ''; });
            loadProspects();
          } else {
            toast('Erreur : ' + ((res && res.error) || 'création impossible'), 'error');
          }
        })
        .catch(function (e) { toast('Erreur : ' + e.message, 'error'); })
        .then(function () { save.disabled = false; });
    });
  }

  // ─── Filters ──────────────────────────────────────────────
  function countActiveFilters() {
    var F = STATE.filters;
    var n = 0;
    if (F.statuts && F.statuts.length) n++;
    if (F.pertMin) n++;
    if (F.tags && F.tags.length) n++;
    if (F.relanceFrom || F.relanceTo) n++;
    if (F.callableOnly) n++;
    return n;
  }
  function updateFilterBadge() {
    var host = document.querySelector('[data-v30-filters] [data-field="active"]');
    if (!host) return;
    var n = countActiveFilters();
    if (n === 0) { host.hidden = true; return; }
    host.hidden = false;
    host.textContent = n;
  }
  function openFiltersModal() {
    var m = getModal('filters');
    if (!m) return;
    var F = STATE.filters;
    m.querySelectorAll('[data-v30-flt-statut] input[type=checkbox]').forEach(function (cb) {
      cb.checked = F.statuts.indexOf(cb.value) >= 0;
    });
    var pm = m.querySelector('[data-v30-flt-pert-min]'); if (pm) pm.value = String(F.pertMin || 0);
    var tg = m.querySelector('[data-v30-flt-tags]');   if (tg) tg.value = (F.tags || []).join(', ');
    var rf = m.querySelector('[data-v30-flt-relance-from]'); if (rf) rf.value = F.relanceFrom || '';
    var rt = m.querySelector('[data-v30-flt-relance-to]');   if (rt) rt.value = F.relanceTo || '';
    var co = m.querySelector('[data-v30-flt-callable]'); if (co) co.checked = !!F.callableOnly;
    openModal(m);
  }
  function bindFilters() {
    var btn = document.querySelector('[data-v30-filters]');
    if (btn) btn.addEventListener('click', openFiltersModal);
    var apply = document.querySelector('[data-v30-flt-apply]');
    if (apply) apply.addEventListener('click', function () {
      var m = getModal('filters');
      var statuts = [];
      m.querySelectorAll('[data-v30-flt-statut] input[type=checkbox]:checked').forEach(function (cb) { statuts.push(cb.value); });
      var tagsRaw = (m.querySelector('[data-v30-flt-tags]') || {}).value || '';
      var tags = tagsRaw.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
      STATE.filters = {
        statuts: statuts,
        pertMin: parseInt((m.querySelector('[data-v30-flt-pert-min]') || {}).value || '0', 10),
        tags: tags,
        relanceFrom: (m.querySelector('[data-v30-flt-relance-from]') || {}).value || '',
        relanceTo: (m.querySelector('[data-v30-flt-relance-to]') || {}).value || '',
        callableOnly: !!(m.querySelector('[data-v30-flt-callable]') || {}).checked
      };
      STATE.offset = 0;
      updateFilterBadge();
      closeModal(m);
      loadProspects();
    });
    var reset = document.querySelector('[data-v30-flt-reset]');
    if (reset) reset.addEventListener('click', function () {
      STATE.filters = { statuts: [], pertMin: 0, tags: [], relanceFrom: '', relanceTo: '', callableOnly: false };
      STATE.offset = 0;
      updateFilterBadge();
      closeModal(getModal('filters'));
      loadProspects();
    });
  }

  // ─── Columns ──────────────────────────────────────────────
  function renderColsList() {
    var host = document.querySelector('[data-v30-cols-list]');
    if (!host) return;
    host.innerHTML = ALL_COLS.map(function (c) {
      var isOn = STATE.cols.indexOf(c.key) >= 0;
      var disabled = c.fixed ? ' disabled' : '';
      return '<label title="' + (c.fixed ? 'Colonne fixe' : '') + '">' +
        '<input type="checkbox" value="' + esc(c.key) + '"' + (isOn ? ' checked' : '') + disabled + '>' +
        '<span>' + esc(c.label) + '</span>' +
        (c.fixed ? ' <span class="muted" style="font-size:10px;margin-left:auto;">fixe</span>' : '') +
      '</label>';
    }).join('');
    host.querySelectorAll('input[type=checkbox]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var key = cb.value;
        if (cb.checked) {
          if (STATE.cols.indexOf(key) < 0) STATE.cols.push(key);
        } else {
          STATE.cols = STATE.cols.filter(function (k) { return k !== key; });
        }
        saveCols(STATE.cols);
        renderTable();
      });
    });
  }
  function bindColumns() {
    var btn = document.querySelector('[data-v30-columns]');
    if (btn) btn.addEventListener('click', function () {
      renderColsList();
      openModal(getModal('columns'));
    });
    var reset = document.querySelector('[data-v30-cols-reset]');
    if (reset) reset.addEventListener('click', function () {
      STATE.cols = DEFAULT_COLS.slice();
      saveCols(STATE.cols);
      renderColsList();
      renderTable();
    });
  }

  // ─── Export XLSX ──────────────────────────────────────────
  function bindExport() {
    var btn = document.querySelector('[data-v30-export]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      toast('Export en cours…', 'info');
      window.location.href = '/api/export/xlsx';
    });
  }

  // ─── Import Excel ─────────────────────────────────────────
  var IMP = { rows: [], headers: [], mapping: {} };
  var IMP_FIELDS = [
    { value: '', label: '— Ignorer' },
    { value: 'name', label: 'Nom complet' },
    { value: 'prenom', label: 'Prénom (→ concat. avec Nom)' },
    { value: 'company_groupe', label: 'Entreprise' },
    { value: 'company_site', label: 'Site / ville' },
    { value: 'fonction', label: 'Fonction' },
    { value: 'telephone', label: 'Téléphone' },
    { value: 'email', label: 'Email' },
    { value: 'linkedin', label: 'LinkedIn' },
    { value: 'notes', label: 'Notes' },
    { value: 'tags', label: 'Tags' },
    { value: 'pertinence', label: 'Pertinence' },
    { value: 'statut', label: 'Statut' }
  ];
  function guessField(header) {
    var h = String(header || '').toLowerCase().trim();
    if (/^(nom|name|nom complet)$/.test(h) || /nom complet/.test(h)) return 'name';
    if (/(pr[eé]nom|first)/.test(h)) return 'prenom';
    if (/(entreprise|company|soci[eé]t[eé]|groupe|raison sociale)/.test(h)) return 'company_groupe';
    if (/(site|ville|city)/.test(h)) return 'company_site';
    if (/(fonction|poste|titre|job)/.test(h)) return 'fonction';
    if (/(t[eé]l|mobile|phone|gsm)/.test(h)) return 'telephone';
    if (/(e[- ]?mail|mail)/.test(h)) return 'email';
    if (/linkedin|linked.in|li[- ]?url/.test(h)) return 'linkedin';
    if (/(note|commentaire)/.test(h)) return 'notes';
    if (/(tags?|mots[- ]?cl[eé]s?)/.test(h)) return 'tags';
    if (/(pertinence|score|priorit)/.test(h)) return 'pertinence';
    if (/(statut|status|[eé]tat)/.test(h)) return 'statut';
    return '';
  }
  function ensureXLSX() {
    if (typeof window.XLSX !== 'undefined') return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = '/static/js/xlsx.min.js';
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Impossible de charger xlsx.min.js')); };
      document.head.appendChild(s);
    });
  }
  function renderImportMapping() {
    var host = document.querySelector('[data-v30-imp-mapping]');
    if (!host) return;
    var sample = IMP.rows[0] || [];
    host.innerHTML = IMP.headers.map(function (h, i) {
      var current = IMP.mapping[i] || '';
      var sampleVal = sample[i] == null ? '' : String(sample[i]).slice(0, 60);
      var opts = IMP_FIELDS.map(function (f) {
        var sel = f.value === current ? ' selected' : '';
        return '<option value="' + esc(f.value) + '"' + sel + '>' + esc(f.label) + '</option>';
      }).join('');
      return '<div class="hdr" title="' + esc(h) + '">' + esc(h) + '<div class="sample">Ex. ' + esc(sampleVal) + '</div></div>' +
        '<select class="select" data-imp-col="' + i + '">' + opts + '</select>';
    }).join('');
    host.querySelectorAll('select[data-imp-col]').forEach(function (sel) {
      sel.addEventListener('change', function () { IMP.mapping[sel.dataset.impCol] = sel.value; });
    });
  }
  function resetImportModal() {
    IMP = { rows: [], headers: [], mapping: {} };
    ['file','map','progress'].forEach(function (s) {
      var el = document.querySelector('[data-v30-imp-step="' + s + '"]');
      if (el) el.hidden = (s !== 'file');
    });
    var run = document.querySelector('[data-v30-imp-run]');
    if (run) run.hidden = true;
    var file = document.querySelector('[data-v30-imp-file]');
    if (file) file.value = '';
  }
  function bindImport() {
    var btn = document.querySelector('[data-v30-import]');
    if (btn) btn.addEventListener('click', function () {
      resetImportModal();
      openModal(getModal('import'));
    });
    var file = document.querySelector('[data-v30-imp-file]');
    if (file) file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (!f) return;
      toast('Chargement du fichier…', 'info');
      ensureXLSX().then(function () {
        var reader = new FileReader();
        reader.onload = function (e) {
          try {
            var wb = window.XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
            var sheet = wb.Sheets[wb.SheetNames[0]];
            var rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
            if (!rows.length) { toast('Fichier vide', 'warning'); return; }
            IMP.headers = (rows[0] || []).map(function (h) { return String(h || '').trim(); });
            IMP.rows = rows.slice(1).filter(function (r) { return r.some(function (v) { return String(v || '').trim(); }); });
            IMP.mapping = {};
            IMP.headers.forEach(function (h, i) { IMP.mapping[i] = guessField(h); });
            document.querySelector('[data-v30-imp-step="file"]').hidden = true;
            document.querySelector('[data-v30-imp-step="map"]').hidden = false;
            var c = document.querySelector('[data-v30-imp-count]'); if (c) c.textContent = IMP.rows.length;
            renderImportMapping();
            var run = document.querySelector('[data-v30-imp-run]'); if (run) run.hidden = false;
          } catch (err) {
            toast('Lecture impossible : ' + err.message, 'error');
          }
        };
        reader.readAsArrayBuffer(f);
      }).catch(function (err) { toast(err.message, 'error'); });
    });
    var run = document.querySelector('[data-v30-imp-run]');
    if (run) run.addEventListener('click', function () {
      document.querySelector('[data-v30-imp-step="map"]').hidden = true;
      document.querySelector('[data-v30-imp-step="progress"]').hidden = false;
      run.hidden = true;
      var rows = IMP.rows;
      var total = rows.length;
      var ok = 0, errors = 0, i = 0;
      var bar = document.querySelector('[data-v30-imp-progress-bar]');
      var txt = document.querySelector('[data-v30-imp-progress-text]');
      function setProgress(n) {
        if (bar) bar.style.width = Math.round(n * 100 / total) + '%';
        if (txt) txt.textContent = 'Import : ' + n + ' / ' + total + '  (OK : ' + ok + ', erreurs : ' + errors + ')';
      }
      setProgress(0);
      function buildPayload(row) {
        var payload = {};
        var prenom = '';
        Object.keys(IMP.mapping).forEach(function (idx) {
          var field = IMP.mapping[idx];
          if (!field) return;
          var raw = row[idx];
          if (raw == null) return;
          var val = String(raw).trim();
          if (!val) return;
          if (field === 'prenom') { prenom = val; return; }
          if (field === 'tags') {
            payload.tags = val.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
          } else {
            payload[field] = val;
          }
        });
        if (prenom) payload.name = (prenom + ' ' + (payload.name || '')).trim();
        return payload;
      }
      function next() {
        if (i >= total) {
          toast('Import terminé : ' + ok + ' ajouté(s), ' + errors + ' erreur(s)', errors ? 'warning' : 'success');
          closeModal(getModal('import'));
          loadProspects();
          return;
        }
        var payload = buildPayload(rows[i]);
        if (!payload.name) { errors++; i++; setProgress(i); setTimeout(next, 0); return; }
        fetchPostJSON('/api/prospects/create', payload)
          .then(function (res) { if (res && res.ok) ok++; else errors++; })
          .catch(function () { errors++; })
          .then(function () { i++; setProgress(i); setTimeout(next, 0); });
      }
      next();
    });
  }

  // ─── AI scrapping (par ligne) ─────────────────────────────
  var AI_CTX = { pid: null, lastText: '', lastJson: null };
  function buildAiPrompt(p) {
    var coName = (p.company_groupe || STATE.companies[p.company_id] || '').trim();
    return 'Tu es un assistant de prospection B2B. Enrichis les informations du prospect suivant.\n' +
      'Retourne UNIQUEMENT un objet JSON valide (clés autorisées : fonction, telephone, email, linkedin, notes, tags (array), pertinence (1-5)).\n' +
      'Prospect : ' + (p.name || '—') + (coName ? ' — ' + coName : '') + (p.fonction ? ' — ' + p.fonction : '') + '\n' +
      (p.email ? 'Email connu : ' + p.email + '\n' : '') +
      (p.telephone ? 'Téléphone connu : ' + p.telephone + '\n' : '') +
      (p.linkedin ? 'LinkedIn connu : ' + p.linkedin + '\n' : '') +
      'Ne fabrique rien. Si tu ne sais pas, omets la clé. Retourne uniquement le JSON brut.';
  }
  function extractJsonMaybe(text) {
    if (!text) return null;
    var m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch (_) { return null; }
  }
  function openAiModal(pid) {
    var p = STATE.prospects.find(function (x) { return x.id === pid; }) ||
            (STATE.allForKpis || []).find(function (x) { return x.id === pid; });
    if (!p) return;
    AI_CTX = { pid: pid, lastText: '', lastJson: null };
    var m = getModal('ai');
    (m.querySelector('[data-v30-ai-name]') || {}).textContent = p.name || '—';
    var prompt = m.querySelector('[data-v30-ai-prompt]');
    if (prompt) prompt.value = buildAiPrompt(p);
    var web = m.querySelector('[data-v30-ai-web]');
    if (web) web.checked = false;
    var out = m.querySelector('[data-v30-ai-output]');
    if (out) out.hidden = true;
    var apply = m.querySelector('[data-v30-ai-apply]');
    if (apply) apply.hidden = true;
    openModal(m);
  }
  function runAi() {
    var m = getModal('ai');
    var prompt = (m.querySelector('[data-v30-ai-prompt]') || {}).value || '';
    var web = !!(m.querySelector('[data-v30-ai-web]') || {}).checked;
    var run = m.querySelector('[data-v30-ai-run]');
    var apply = m.querySelector('[data-v30-ai-apply]');
    var out = m.querySelector('[data-v30-ai-output]');
    var raw = m.querySelector('[data-v30-ai-raw]');
    if (!prompt.trim()) { toast('Prompt vide', 'warning'); return; }
    if (run) { run.disabled = true; run.textContent = 'IA en cours…'; }
    fetchPostJSON('/api/ollama/generate', { prompt: prompt, web_search: web, timeout: 180 })
      .then(function (res) {
        if (!res || !res.ok) throw new Error((res && res.error) || 'IA indisponible');
        AI_CTX.lastText = res.text || '';
        AI_CTX.lastJson = extractJsonMaybe(AI_CTX.lastText);
        if (out) out.hidden = false;
        if (raw) raw.textContent = AI_CTX.lastText;
        if (apply) apply.hidden = !AI_CTX.lastJson;
        if (!AI_CTX.lastJson) toast('Réponse non JSON — vérifie avant d\'appliquer', 'warning');
        else toast('IA OK — relis puis applique', 'success');
      })
      .catch(function (err) { toast('Erreur IA : ' + err.message, 'error'); })
      .then(function () {
        if (run) { run.disabled = false; run.textContent = 'Relancer l\'IA'; }
      });
  }
  function applyAi() {
    if (!AI_CTX.pid || !AI_CTX.lastJson) return;
    var json = AI_CTX.lastJson;
    var updates = {};
    ['fonction','telephone','email','linkedin','notes','pertinence'].forEach(function (k) {
      if (json[k] != null && String(json[k]).trim()) updates[k] = String(json[k]).trim();
    });
    var tags = Array.isArray(json.tags) ? json.tags : null;
    var m = getModal('ai');
    var apply = m.querySelector('[data-v30-ai-apply]');
    if (apply) apply.disabled = true;
    var chain = Promise.resolve();
    Object.keys(updates).forEach(function (field) {
      if (['statut','pertinence','fonction','fixedMetier'].indexOf(field) >= 0) {
        chain = chain.then(function () {
          return fetchPostJSON('/api/prospects/bulk-edit', { ids: [AI_CTX.pid], field: field, value: updates[field] });
        });
      } else if (field === 'email' || field === 'telephone') {
        chain = chain.then(function () {
          return fetchPostJSON('/api/prospects/bulk-field-update', { ids: [AI_CTX.pid], field: field, values: [updates[field]] });
        });
      }
    });
    if (tags && tags.length) {
      chain = chain.then(function () {
        return fetchPostJSON('/api/prospects/bulk-status-tags', { ids: [AI_CTX.pid], add_tags: tags });
      });
    }
    chain.then(function () {
      toast('Prospect enrichi', 'success');
      closeModal(m);
      loadProspects();
    }).catch(function (err) {
      toast('Erreur application : ' + err.message, 'error');
    }).then(function () {
      if (apply) apply.disabled = false;
    });
  }
  function bindAi() {
    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-v30-ai]');
      if (!t) return;
      var pid = Number(t.dataset.v30Ai);
      if (pid) { e.preventDefault(); openAiModal(pid); }
    });
    var run = document.querySelector('[data-v30-ai-run]');
    if (run) run.addEventListener('click', runAi);
    var apply = document.querySelector('[data-v30-ai-apply]');
    if (apply) apply.addEventListener('click', applyAi);
  }

  // ─── Mode Prosp (deck 3D) ─────────────────────────────────
  function bindModeProsp() {
    var btn = document.querySelector('[data-v30-mode-prosp]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var ids = Array.from(STATE.selected);
      if (!ids.length) {
        // Aucune sélection : on prend tous les prospects filtrés courants (dataset complet non paginé).
        var pool = STATE.allForKpis || STATE.prospects || [];
        ids = pool.map(function (p) { return p.id; });
      }
      if (!ids.length) { toast('Aucun prospect à traiter', 'warning'); return; }
      btn.disabled = true;
      fetchPostJSON('/api/mode-prosp/start', { ids: ids })
        .then(function (res) {
          if (!res || !res.ok || !res.token) throw new Error((res && res.error) || 'Token manquant');
          window.open('/v30/mode-prosp?t=' + encodeURIComponent(res.token), '_blank');
        })
        .catch(function (e) { toast('Mode Prosp : ' + e.message, 'error'); })
        .then(function () { btn.disabled = false; });
    });
  }

  function readUrlFilters() {
    try {
      var params = new URLSearchParams(window.location.search);
      var cid = params.get('company');
      if (cid) STATE.filters.companyId = Number(cid);
    } catch (_) {}
  }

  function init() {
    readUrlFilters();
    bindViewSwitch();
    bindSelection();
    bindSplit();
    bindOpen();
    bindBulk();
    bindSearch();
    bindPagination();
    bindBuiltinPills();
    bindSaveView();
    bindBannerClose();
    bindModalDismiss();
    bindAdd();
    bindFilters();
    bindColumns();
    bindImport();
    bindExport();
    bindAi();
    bindModeProsp();
    updateFilterBadge();
    loadProspects();
    loadSavedViews();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
