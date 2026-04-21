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
    renderPertinence: renderPertinence
  };
})(window);
