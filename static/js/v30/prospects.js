/* ProspUp v30 — Prospects : helpers + state */
(function (global) {
  'use strict';

  var ALL_COLS = [
    { key: 'select', label: 'Sélection', fixed: true },
    { key: 'name', label: 'Nom', fixed: true },
    { key: 'company', label: 'Entreprise' },
    { key: 'statut', label: 'Statut' },
    { key: 'pertinence', label: 'Pertinence' },
    { key: 'push', label: 'Push' },
    { key: 'lastContact', label: 'Dernière action' },
    { key: 'relance', label: 'Relance' },
    { key: 'tags', label: 'Tags' },
    { key: 'actions', label: 'Actions', fixed: true }
  ];
  var SORTABLE_COLS = ['name', 'company', 'statut', 'pertinence', 'lastContact', 'relance'];
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

  var FILTERS_KEY = 'v30.prospects.filters';
  function loadPersistedFilters() {
    try {
      var raw = localStorage.getItem(FILTERS_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      return (obj && typeof obj === 'object') ? obj : null;
    } catch (_) { return null; }
  }
  function savePersistedFilters() {
    try {
      localStorage.setItem(FILTERS_KEY, JSON.stringify({
        q: STATE.q || '',
        filter: STATE.filter || 'all',
        savedViewId: STATE.activeSavedViewId || null,
        filters: STATE.filters || {},
        sort: STATE.sort || { key: '', dir: 'asc' }
      }));
    } catch (_) {}
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
      statutsExclude: [],
      pertMin: 0,
      tags: [],
      relanceFrom: '',
      relanceTo: '',
      callableOnly: false,
      companyId: null
    },
    sort: { key: '', dir: 'asc' },
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

  function nameHue(name) {
    var h = 0, s = String(name || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h) % 6;
  }

  function splitPhones(tel) {
    if (!tel) return [];
    var m = String(tel).match(/\+?\d[\d\s().-]{6,}\d/g);
    if (!m) return [];
    var seen = {};
    return m.map(function (s) { return s.trim().replace(/\s+/g, ' '); })
      .filter(function (s) { if (seen[s]) return false; seen[s] = true; return true; });
  }

  function normTel(p) {
    var plus = String(p).charAt(0) === '+';
    var r = String(p).replace(/[^\d]/g, '');
    return plus ? '+' + r : r;
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
      "Pas d'actions": 'status-idle',
      'Prospecté':     'status-prosp',
      'Appelé':        'status-called',
      'Messagerie':    'status-voicemail',
      'À rappeler':    'status-callback',
      'Rendez-vous':   'status-rdv',
      'Pas intéressé': 'status-cold',
      'Contacté':      'status-contact',
      'Proposition':   'status-proposal',
      'Gagné':         'status-won',
      'Perdu':         'status-lost'
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

  function sortArray(arr, key, dir) {
    return arr.slice().sort(function (a, b) {
      var va, vb;
      switch (key) {
        case 'name':        va = String(a.name || '').toLowerCase();        vb = String(b.name || '').toLowerCase(); break;
        case 'company':     va = String(a.company_groupe || STATE.companies[a.company_id] || '').toLowerCase(); vb = String(b.company_groupe || STATE.companies[b.company_id] || '').toLowerCase(); break;
        case 'statut':      va = String(a.statut || '').toLowerCase();      vb = String(b.statut || '').toLowerCase(); break;
        case 'pertinence':  va = parseInt(a.pertinence, 10) || 0;           vb = parseInt(b.pertinence, 10) || 0;   break;
        case 'lastContact': va = a.lastContact ? String(a.lastContact).slice(0, 10) : '';   vb = b.lastContact ? String(b.lastContact).slice(0, 10) : '';   break;
        case 'relance':     va = a.nextFollowUp ? String(a.nextFollowUp).slice(0, 10) : ''; vb = b.nextFollowUp ? String(b.nextFollowUp).slice(0, 10) : ''; break;
        default: return 0;
      }
      var cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return dir === 'desc' ? -cmp : cmp;
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

  var EMAIL_ICON_MD = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 7 10-7"/></svg>';
  var TEL_ICON_SM = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 17v3a2 2 0 0 1-2 2 19 19 0 0 1-17-17 2 2 0 0 1 2-2h3l2 5-2 1a12 12 0 0 0 6 6l1-2 5 2z"/></svg>';
  var TEL_ICON_MD = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M22 17v3a2 2 0 0 1-2 2 19 19 0 0 1-17-17 2 2 0 0 1 2-2h3l2 5-2 1a12 12 0 0 0 6 6l1-2 5 2z"/></svg>';

  function renderTel(tel) {
    if (!tel) return '<span style="color:var(--text-muted);font-size:11px;">—</span>';
    var phones = splitPhones(tel);
    var badge = '<span class="v30-pp-tel__badge">' + TEL_ICON_SM + '</span>';
    if (phones.length <= 1) {
      var clean = phones.length ? normTel(phones[0]) : String(tel).replace(/\s/g, '');
      var label = phones.length ? phones[0] : String(tel);
      return '<a class="v30-pp-tel" href="tel:' + esc(clean) + '" title="' + esc(label) + '">' + badge + '</a>';
    }
    return '<div class="v30-pp-tel v30-pp-tel--multi" data-v30-tel-multi' +
        ' title="' + phones.length + ' numéros">' +
      badge +
      '<span class="v30-pp-tel__arrow">▾</span>' +
      '<div class="v30-pp-tel-drop" hidden>' +
        phones.map(function (ph) {
          return '<a class="v30-pp-tel-opt" href="tel:' + esc(normTel(ph)) + '">' + esc(ph) + '</a>';
        }).join('') +
      '</div>' +
    '</div>';
  }

  function parseTags(tagsRaw) {
    if (!tagsRaw) return [];
    var tags = [];
    if (Array.isArray(tagsRaw)) tags = tagsRaw;
    else if (typeof tagsRaw === 'string') {
      try { tags = JSON.parse(tagsRaw); } catch (_) { tags = tagsRaw.split(',').map(function (s) { return s.trim(); }); }
    }
    return tags.filter(Boolean);
  }

  function renderTags(tagsRaw) {
    var tags = parseTags(tagsRaw);
    if (!tags.length) return '';
    var first = '<span class="badge"><span style="max-width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(tags[0]) + '</span></span>';
    if (tags.length === 1) return first;
    return first + ' <span class="badge v30-pp-tags-more" data-v30-tags-all="' + esc(JSON.stringify(tags)) + '">+' + (tags.length - 1) + '</span>';
  }

  function renderEmail(email) {
    if (!email) return '<span style="color:var(--text-muted);font-size:11px;">—</span>';
    var clean = String(email).trim();
    return '<a class="v30-pp-email-icon" href="mailto:' + esc(clean) + '" title="' + esc(clean) + '">' +
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 7 10-7"/></svg>' +
    '</a>';
  }

  function renderPushBadges(p) {
    var parts = [];
    if (p.pushEmailSentAt) {
      parts.push('<span class="badge badge-info v30-pp-push-badge" title="Push email · ' + esc(p.pushEmailSentAt) + '">' +
        '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 7 10-7"/></svg>' +
        'Email</span>');
    }
    if (p.pushLinkedInSentAt) {
      parts.push('<span class="badge badge-accent v30-pp-push-badge" title="Push LinkedIn · ' + esc(p.pushLinkedInSentAt) + '">' +
        '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>' +
        'Li</span>');
    }
    if (!parts.length) return '<span style="color:var(--text-muted);font-size:11px;">—</span>';
    return '<div style="display:inline-flex;gap:4px;flex-wrap:wrap;">' + parts.join('') + '</div>';
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
            '<span class="avatar v30-pp-avatar">' + esc(initials(p.name)) + '</span>' +
            '<div style="min-width:0;">' +
              '<div class="v30-pp-name__value truncate">' + esc(p.name || '—') + '</div>' +
              (p.fonction ? '<div class="v30-pp-name__sub truncate">' + esc(p.fonction) + '</div>' : '') +
            '</div>' +
          '</a>' +
        '</td>';
      case 'company':    return '<td class="truncate" style="font-size:12.5px;color:var(--text-2);max-width:130px;">' + esc(coName) + '</td>';
      case 'statut':     return '<td>' + (p.statut ? '<span class="status ' + cls + '">' + esc(p.statut) + '</span>' : '—') + '</td>';
      case 'pertinence': return '<td>' + renderPertinence(p.pertinence) + '</td>';
      case 'push':       return '<td>' + renderPushBadges(p) + '</td>';
      case 'lastContact': return '<td style="color:var(--text-2);">' + esc(relativeDate(p.lastContact)) + '</td>';
      case 'relance':    return '<td class="num mono" style="color:var(--text-2);">' + esc(shortDate(p.nextFollowUp)) + '</td>';
      case 'tags':       return '<td><div class="v30-pp-tags">' + renderTags(p.tags) + '</div></td>';
      case 'actions': {
        var actAi = '<button type="button" class="btn btn-ghost btn-sm btn-icon" data-v30-ai="' + p.id + '" title="Enrichir via IA">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2 4 4 2-4 2-2 4-2-4-4-2 4-2z"/></svg>' +
          '</button>';
        var actTel = '';
        if (p.telephone) {
          var actPhones = splitPhones(p.telephone);
          if (actPhones.length <= 1) {
            var actClean = actPhones.length ? normTel(actPhones[0]) : String(p.telephone).replace(/\s/g, '');
            actTel = '<a class="btn btn-ghost btn-sm btn-icon" href="tel:' + esc(actClean) + '" title="Appeler">' + TEL_ICON_MD + '</a>';
          } else {
            actTel = '<div class="btn btn-ghost btn-sm btn-icon v30-pp-tel--multi" data-v30-tel-multi' +
              ' style="position:relative;" title="' + actPhones.length + ' numéros">' +
              TEL_ICON_MD +
              '<div class="v30-pp-tel-drop v30-pp-tel-drop--right" hidden>' +
                actPhones.map(function (ph) {
                  return '<a class="v30-pp-tel-opt" href="tel:' + esc(normTel(ph)) + '">' + esc(ph) + '</a>';
                }).join('') +
              '</div>' +
            '</div>';
          }
        }
        var actEmail = p.email
          ? '<a class="btn btn-ghost btn-sm btn-icon" href="mailto:' + esc(String(p.email).trim()) + '" title="' + esc(String(p.email).trim()) + '">' + EMAIL_ICON_MD + '</a>'
          : '';
        return '<td><div class="v30-pp-actions">' + actTel + actEmail + actAi + '</div></td>';
      }
      default: return '';
    }
  }

  function activeCols() {
    return ALL_COLS.filter(function (c) { return c.fixed || STATE.cols.indexOf(c.key) >= 0; });
  }

  function renderRow(p) {
    var sel = STATE.selected.has(p.id);
    var cells = activeCols().map(function (c) { return cellFor(p, c.key); }).join('');
    return '<tr class="' + (sel ? 'is-selected' : '') + '" data-id="' + p.id + '" data-v30-open="' + p.id + '">' + cells + '</tr>';
  }

  var COL_WIDTHS = {
    select: 32, name: 200, company: 115, statut: 128, pertinence: 70,
    push: 52, lastContact: 92, relance: 82, tags: 110, actions: 90
  };

  function renderTableHead() {
    var thead = document.querySelector('.v30-pp-table thead tr');
    if (!thead) return;
    var cols = activeCols();
    var sortKey = STATE.sort && STATE.sort.key;
    var sortDir = STATE.sort && STATE.sort.dir;
    var html = cols.map(function (c) {
      var w = COL_WIDTHS[c.key];
      var style = w ? 'width:' + w + 'px;' : '';
      if (c.key === 'select') return '<th style="' + style + 'padding-left:14px;"><input type="checkbox" data-v30-select-all aria-label="Tout sélectionner"></th>';
      if (SORTABLE_COLS.indexOf(c.key) >= 0) {
        var arrow = sortKey === c.key
          ? (sortDir === 'asc' ? ' <span style="opacity:.7;font-size:10px;">↑</span>' : ' <span style="opacity:.7;font-size:10px;">↓</span>')
          : ' <span style="opacity:.25;font-size:10px;">↕</span>';
        return '<th style="' + style + 'cursor:pointer;user-select:none;" data-sort-key="' + c.key + '" title="Trier">' + esc(c.label) + arrow + '</th>';
      }
      return '<th' + (style ? ' style="' + style + '"' : '') + '>' + esc(c.label) + '</th>';
    }).join('');
    thead.innerHTML = html;
  }

  function renderTable() {
    var tbody = document.querySelector('[data-v30-rows]');
    if (!tbody) return;
    renderTableHead();
    var colCount = activeCols().length;
    if (STATE.prospects.length === 0) {
      var extra = '';
      if ((STATE.q || '').trim()) {
        extra = '<div class="v30-pp-restored-banner" style="margin-top:10px;padding:10px 14px;border:1px solid var(--warn);background:color-mix(in oklch, var(--warn) 8%, var(--surface));border-radius:8px;display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap;">' +
          '<span style="font-size:12.5px;">Filtre actif restauré : <b>&laquo; ' + esc(STATE.q) + ' &raquo;</b></span>' +
          '<button type="button" class="btn btn-sm" data-v30-clear-search>Effacer la recherche</button>' +
          '</div>';
      }
      tbody.innerHTML = '<tr><td colspan="' + colCount + '"><div class="v30-pp-empty">Aucun prospect pour ces filtres.</div>' + extra + '</td></tr>';
      return;
    }
    tbody.innerHTML = STATE.prospects.map(renderRow).join('');
  }

  // ─── Rendu Kanban ────────────────────────────────────────────
  // `primary`  : statut appliqué quand on drop une carte dans la colonne.
  // `statuts`  : statuts (y.c. legacy) qui tombent dans la colonne au render.
  var KANBAN_COLS = [
    { primary: "Pas d'actions", statuts: ["Pas d'actions", 'Messagerie', '', null, undefined], t: 'À traiter',   col: 'var(--info)' },
    { primary: 'Appelé',         statuts: ['Appelé', 'Contacté', 'Pas intéressé'],               t: 'Contacté',    col: 'var(--accent)' },
    { primary: 'À rappeler',    statuts: ['À rappeler', 'A rappeler'],                           t: 'À rappeler',  col: 'oklch(0.70 0.14 75)' },
    { primary: 'Rendez-vous',    statuts: ['Rendez-vous'],                                         t: 'RDV',         col: 'oklch(0.55 0.15 280)' },
    { primary: 'Prospecté',      statuts: ['Prospecté'],                                           t: 'Prospecté',   col: 'var(--success)' }
  ];

  function kanbanColIndex(statut) {
    for (var i = 0; i < KANBAN_COLS.length; i++) {
      if (KANBAN_COLS[i].statuts.indexOf(statut) >= 0) return i;
    }
    return 0;
  }

  function renderKanban() {
    var host = document.querySelector('[data-v30-kanban]');
    if (!host) return;
    var buckets = KANBAN_COLS.map(function () { return []; });
    // Utilise filteredAll (liste complète filtrée+triée) et non STATE.prospects
    // qui n'est que la page courante (pagination 50) — sinon les colonnes du
    // kanban affichent des comptes faux (RDV=0, Prospecté=0, ...).
    var pool = STATE.filteredAll || STATE.prospects || [];
    pool.forEach(function (p) {
      buckets[kanbanColIndex(p.statut)].push(p);
    });
    host.innerHTML = KANBAN_COLS.map(function (c, i) {
      var items = buckets[i];
      var cards = items.map(function (p) {
        var coName = (p.company_groupe || STATE.companies[p.company_id] || '').trim();
        return '<div class="v30-pp-kcard" draggable="true"' +
          ' data-v30-open="' + p.id + '"' +
          ' data-v30-kcard-id="' + p.id + '"' +
          ' data-v30-kcard-statut="' + esc(p.statut || '') + '"' +
          ' role="button" tabindex="0">' +
          '<div class="v30-pp-kcard__name truncate">' + esc(p.name || '—') + '</div>' +
          '<div class="v30-pp-kcard__co truncate">' + esc(coName) + '</div>' +
          '<div class="v30-pp-kcard__foot">' +
            renderTags(p.tags) +
            '<span class="v30-spacer"></span>' +
          '</div>' +
        '</div>';
      }).join('');
      var body = '<div class="v30-pp-kcol__body" data-v30-kcol-drop="' + i + '">' +
        (items.length === 0
          ? '<div class="v30-pp-empty v30-pp-kcol__empty">Déposer ici</div>'
          : cards) +
        '</div>';
      return '<div class="v30-pp-kcol" data-v30-kcol-idx="' + i + '" data-v30-kcol-statut="' + esc(c.primary) + '">' +
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
        } else if (filter === 'rdv') {
          if ((p.statut || '').toLowerCase() !== 'rendez-vous') return false;
        } else if (filter === 'prospecte') {
          var s0 = (p.statut || '').toLowerCase();
          if (s0 !== 'prospecté' && s0 !== 'prospecte') return false;
        }
        if (F.statuts && F.statuts.length && F.statuts.indexOf(p.statut) < 0) return false;
        if (F.statutsExclude && F.statutsExclude.length && F.statutsExclude.indexOf(p.statut || '') >= 0) return false;
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
      if (STATE.sort && STATE.sort.key) filtered = sortArray(filtered, STATE.sort.key, STATE.sort.dir);
      STATE.filteredAll = filtered; // liste filtrée+triée complète (avant pagination) — utilisée par Mode Prosp
      // Pagination client-side (utile surtout pour /api/data qui renvoie tout)
      var start = STATE.offset || 0;
      var end = start + (STATE.limit || 50);
      STATE.prospects = filtered.slice(start, end);
      renderAll();
      updatePagination();
      updateCounts();
      updateKpis();
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
    var all = STATE.allForKpis || [];
    var totalEl = document.querySelector('[data-v30-prospects] [data-field="total"]');
    if (totalEl) totalEl.textContent = STATE.total.toLocaleString('fr-FR');
    var allEl = document.querySelector('.v30-pp-views [data-view-filter="all"] [data-field="count"]');
    if (allEl) allEl.textContent = all.length.toLocaleString('fr-FR');
    var relanceEl = document.querySelector('.v30-pp-views [data-view-filter="relance"] [data-field="count"]');
    if (relanceEl) relanceEl.textContent = all.filter(function (p) {
      return /(relanc|relance|À rappeler|A rappeler|rappeler)/i.test(p.statut || '');
    }).length.toLocaleString('fr-FR');
    var rdvEl = document.querySelector('.v30-pp-views [data-view-filter="rdv"] [data-field="count"]');
    if (rdvEl) rdvEl.textContent = all.filter(function (p) {
      return (p.statut || '').toLowerCase() === 'rendez-vous';
    }).length.toLocaleString('fr-FR');
    var prospecteEl = document.querySelector('.v30-pp-views [data-view-filter="prospecte"] [data-field="count"]');
    if (prospecteEl) prospecteEl.textContent = all.filter(function (p) {
      var s = (p.statut || '').toLowerCase();
      return s === 'prospecté' || s === 'prospecte';
    }).length.toLocaleString('fr-FR');
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
      // Même définition que le filtre tab et le backend : statut exact.
      // Ne pas inclure p.rdvDate (un prospect peut avoir une rdvDate même si
      // son statut a changé ensuite — sinon KPI ≠ tab ≠ kanban).
      if (s === 'rendez-vous') rdv++;
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
      // Ne pas naviguer si on clique sur un élément interactif dans la ligne
      if (e.target.closest('button, input, a[href]:not([data-v30-open]), [data-v30-tel-multi]')) return;
      // Ne pas naviguer si on vient de drop une carte kanban (évite l'open fantôme).
      if (KANBAN_DND.suppressClickUntil && Date.now() < KANBAN_DND.suppressClickUntil) return;
      e.preventDefault();
      var id = a.dataset.v30Open;
      sessionStorage.setItem('v30.prospects.from_detail', '1');
      window.location.href = '/v30/prospect/' + encodeURIComponent(id);
    });
  }

  // ─── Kanban : drag & drop ───────────────────────────────────
  var KANBAN_DND = { dragId: null, fromCol: null, suppressClickUntil: 0 };

  function bindKanbanDnd() {
    var host = document.querySelector('[data-v30-kanban]');
    if (!host) return;

    host.addEventListener('dragstart', function (e) {
      var card = e.target.closest('[data-v30-kcard-id]');
      if (!card) return;
      KANBAN_DND.dragId = Number(card.dataset.v30KcardId);
      KANBAN_DND.fromCol = kanbanColIndex(card.dataset.v30KcardStatut || '');
      card.classList.add('is-dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', String(KANBAN_DND.dragId)); } catch (_) {}
      }
    });

    host.addEventListener('dragend', function (e) {
      var card = e.target.closest('[data-v30-kcard-id]');
      if (card) card.classList.remove('is-dragging');
      host.querySelectorAll('.v30-pp-kcol.is-drop-target').forEach(function (el) {
        el.classList.remove('is-drop-target');
      });
      KANBAN_DND.dragId = null;
      KANBAN_DND.fromCol = null;
    });

    host.addEventListener('dragover', function (e) {
      var col = e.target.closest('[data-v30-kcol-idx]');
      if (!col || KANBAN_DND.dragId == null) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      host.querySelectorAll('.v30-pp-kcol.is-drop-target').forEach(function (el) {
        if (el !== col) el.classList.remove('is-drop-target');
      });
      col.classList.add('is-drop-target');
    });

    host.addEventListener('dragleave', function (e) {
      var col = e.target.closest('[data-v30-kcol-idx]');
      if (!col) return;
      // Ne retire le highlight que si on sort vraiment de la colonne.
      if (col.contains(e.relatedTarget)) return;
      col.classList.remove('is-drop-target');
    });

    host.addEventListener('drop', function (e) {
      var col = e.target.closest('[data-v30-kcol-idx]');
      if (!col || KANBAN_DND.dragId == null) return;
      e.preventDefault();
      col.classList.remove('is-drop-target');
      var toIdx = Number(col.dataset.v30KcolIdx);
      var id = KANBAN_DND.dragId;
      var fromIdx = KANBAN_DND.fromCol;
      KANBAN_DND.suppressClickUntil = Date.now() + 400;
      KANBAN_DND.dragId = null;
      KANBAN_DND.fromCol = null;
      if (toIdx === fromIdx) return;
      var newStatut = KANBAN_COLS[toIdx] && KANBAN_COLS[toIdx].primary;
      if (!newStatut) return;
      var p = STATE.prospects.find(function (x) { return Number(x.id) === Number(id); });
      if (!p) return;
      var prevStatut = p.statut;
      p.statut = newStatut;
      renderKanban();
      renderTable();
      fetchPostJSON('/api/prospects/bulk-edit', { ids: [id], field: 'statut', value: newStatut })
        .then(function () {
          toast('Statut → ' + newStatut, 'success');
        })
        .catch(function (err) {
          var target = STATE.prospects.find(function (x) { return Number(x.id) === Number(id); });
          if (target) target.statut = prevStatut;
          renderKanban();
          renderTable();
          toast('Erreur : ' + (err && err.message || err), 'error');
        });
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
      if (action === 'push') {
        if (ids.length !== 1) { toast('Sélectionnez un seul prospect pour lancer un push ciblé', 'warning'); return; }
        if (window.V30PushModal && typeof window.V30PushModal.open === 'function') {
          window.V30PushModal.open(ids[0], 'email');
        } else {
          window.location.href = '/v30/push?ids=' + ids.join(',');
        }
        return;
      }
      if (action === 'vcf') { exportSelectedVcf(ids); return; }
      if (action === 'enrich-ai') { openBulkEnrichAiModal(ids); return; }
      if (action === 'edit') { openBulkEditModal(ids); return; }
      openBulkModal(action, ids);
    });
    var apply = document.querySelector('[data-v30-bulk-apply]');
    if (apply) apply.addEventListener('click', runBulkAction);
  }

  // ─── VCF / vCard export (parité V29) ──────────────────────
  function vcfEscape(s) {
    if (s == null) return '';
    return String(s)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n');
  }
  function prospectToVcf(p) {
    var parts = String(p.name || '').trim().split(/\s+/);
    var lastName = parts.length > 1 ? parts.pop() : '';
    var firstName = parts.join(' ') || p.name || '';
    var coName = (p.company_groupe || STATE.companies[p.company_id] || '').trim();
    var lines = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'N:' + vcfEscape(lastName) + ';' + vcfEscape(firstName) + ';;;',
      'FN:' + vcfEscape(p.name || '')
    ];
    if (coName) lines.push('ORG:' + vcfEscape(coName));
    if (p.fonction) lines.push('TITLE:' + vcfEscape(p.fonction));
    if (p.telephone) {
      var phones = splitPhones(p.telephone);
      if (phones.length) {
        phones.forEach(function (ph, i) {
          var type = i === 0 ? 'WORK' : 'CELL';
          lines.push('TEL;TYPE=' + type + ':' + ph.replace(/\s+/g, ' ').trim());
        });
      } else {
        lines.push('TEL;TYPE=WORK:' + String(p.telephone).trim());
      }
    }
    if (p.email) lines.push('EMAIL;TYPE=INTERNET:' + String(p.email).trim());
    if (p.linkedin) lines.push('URL:' + String(p.linkedin).trim());
    if (p.notes) lines.push('NOTE:' + vcfEscape(p.notes));
    var tags = parseTags(p.tags);
    if (tags.length) lines.push('CATEGORIES:' + tags.map(vcfEscape).join(','));
    lines.push('REV:' + new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z');
    lines.push('END:VCARD');
    return lines.join('\r\n');
  }
  function findProspectById(id) {
    var pool = (STATE.filteredAll || []).concat(STATE.allForKpis || [], STATE.prospects || []);
    for (var i = 0; i < pool.length; i++) {
      if (Number(pool[i].id) === Number(id)) return pool[i];
    }
    return null;
  }
  function exportSelectedVcf(ids) {
    var items = ids.map(findProspectById).filter(Boolean);
    if (!items.length) { toast('Aucun prospect exportable', 'warning'); return; }
    var vcf = items.map(prospectToVcf).join('\r\n');
    var today = new Date().toISOString().slice(0, 10);
    try {
      var blob = new Blob([vcf], { type: 'text/vcard;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = items.length === 1
        ? (String(items[0].name || 'contact').replace(/[^a-zA-Z0-9À-ÿ\s-]/g, '').replace(/\s+/g, '_') || 'contact') + '.vcf'
        : 'Prospects_selection_' + today + '.vcf';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        try { URL.revokeObjectURL(a.href); } catch (_) {}
        try { a.remove(); } catch (_) {}
      }, 1000);
      toast('vCard générée (' + items.length + ')', 'success');
    } catch (err) {
      toast('Erreur VCF : ' + (err && err.message || err), 'error');
    }
  }

  // ─── Bulk Edit (champ + valeur) ───────────────────────────
  var BULK_EDIT_CTX = { ids: [] };
  function renderBulkEditValueInput(field) {
    var wrap = document.querySelector('[data-v30-bulk-edit-value-wrap]');
    if (!wrap) return;
    if (!field) { wrap.innerHTML = ''; return; }
    var html = '<label for="v30-pp-bulk-edit-value">Nouvelle valeur <span class="required" style="color:var(--danger);">*</span></label>';
    if (field === 'statut') {
      html += '<select id="v30-pp-bulk-edit-value" class="select" data-v30-bulk-edit-value>' +
        '<option value="">— Choisir —</option>' +
        STATUS_OPTIONS.map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('') +
        '</select>';
    } else if (field === 'pertinence') {
      html += '<select id="v30-pp-bulk-edit-value" class="select" data-v30-bulk-edit-value>' +
        '<option value="">— Choisir —</option>' +
        ['5','4','3','2','1'].map(function (v) { return '<option value="' + v + '">' + v + '/5</option>'; }).join('') +
        '</select>';
    } else {
      html += '<input id="v30-pp-bulk-edit-value" class="input" type="text" data-v30-bulk-edit-value placeholder="Nouvelle valeur…">';
    }
    wrap.innerHTML = html;
  }
  function openBulkEditModal(ids) {
    BULK_EDIT_CTX = { ids: ids || [] };
    var n = BULK_EDIT_CTX.ids.length;
    var info = document.querySelector('[data-v30-bulk-edit-info]');
    if (info) info.textContent = n + ' prospect' + (n > 1 ? 's' : '') + ' sélectionné' + (n > 1 ? 's' : '');
    var countEl = document.querySelector('[data-v30-bulk-edit-count]');
    if (countEl) countEl.textContent = n;
    var fieldSel = document.querySelector('[data-v30-bulk-edit-field]');
    if (fieldSel) fieldSel.value = '';
    renderBulkEditValueInput('');
    openModal(getModal('bulkEdit'));
  }
  function applyBulkEdit() {
    var ids = BULK_EDIT_CTX.ids || [];
    if (!ids.length) return;
    var fieldSel = document.querySelector('[data-v30-bulk-edit-field]');
    var field = fieldSel ? fieldSel.value : '';
    if (!field) { toast('Choisis un champ', 'warning'); return; }
    var valEl = document.querySelector('[data-v30-bulk-edit-value]');
    var value = valEl ? String(valEl.value || '').trim() : '';
    if (!value) { toast('Saisis une valeur', 'warning'); return; }
    var btn = document.querySelector('[data-v30-bulk-edit-apply]');
    if (btn) btn.disabled = true;
    fetchPostJSON('/api/prospects/bulk-edit', { ids: ids, field: field, value: value })
      .then(function () {
        toast(ids.length + ' prospect(s) mis à jour', 'success');
        STATE.selected.clear();
        closeModal(getModal('bulkEdit'));
        loadProspects();
      })
      .catch(function (err) {
        toast('Erreur : ' + (err && err.message || err), 'error');
      })
      .then(function () {
        if (btn) btn.disabled = false;
      });
  }
  function bindBulkEdit() {
    var fieldSel = document.querySelector('[data-v30-bulk-edit-field]');
    if (fieldSel) fieldSel.addEventListener('change', function () {
      renderBulkEditValueInput(fieldSel.value);
    });
    var applyBtn = document.querySelector('[data-v30-bulk-edit-apply]');
    if (applyBtn) applyBtn.addEventListener('click', applyBulkEdit);
  }

  // ─── Bulk Enrich IA (séquentiel + barre de progression) ──
  var ENRICH_CTX = { ids: [], running: false, cancelled: false };
  function buildBulkEnrichPrompt(p) {
    var coName = (p.company_groupe || STATE.companies[p.company_id] || '').trim();
    return 'Tu es un assistant de prospection B2B. Enrichis les informations du prospect suivant.\n' +
      'Retourne UNIQUEMENT un objet JSON valide avec les clés (optionnelles) : fonction, telephone, email, linkedin, tags (array), pertinence (1-5), notes.\n' +
      'Ne fabrique rien — si tu ne sais pas, omets la clé. Pas de texte autour du JSON.\n' +
      'Prospect : ' + (p.name || '—') + (coName ? ' — ' + coName : '') + (p.fonction ? ' — ' + p.fonction : '') + '\n' +
      (p.email ? 'Email connu : ' + p.email + '\n' : '') +
      (p.telephone ? 'Téléphone connu : ' + p.telephone + '\n' : '') +
      (p.linkedin ? 'LinkedIn connu : ' + p.linkedin + '\n' : '');
  }
  function openBulkEnrichAiModal(ids) {
    ENRICH_CTX = { ids: ids || [], running: false, cancelled: false };
    var m = getModal('enrichAi');
    if (!m) return;
    var countEl = m.querySelector('[data-v30-enrich-count]');
    if (countEl) countEl.textContent = ids.length;
    var prog = m.querySelector('[data-v30-enrich-progress]');
    if (prog) prog.hidden = true;
    var sum = m.querySelector('[data-v30-enrich-summary]');
    if (sum) sum.hidden = true;
    var bar = m.querySelector('[data-v30-enrich-progress-bar]');
    if (bar) bar.style.width = '0%';
    var txt = m.querySelector('[data-v30-enrich-progress-text]');
    if (txt) txt.textContent = '0 / ' + ids.length + ' traités';
    var current = m.querySelector('[data-v30-enrich-current]');
    if (current) current.textContent = '';
    var lines = m.querySelector('[data-v30-enrich-lines]');
    if (lines) lines.textContent = '';
    var startBtn = m.querySelector('[data-v30-enrich-start]');
    if (startBtn) { startBtn.disabled = false; startBtn.textContent = 'Lancer'; }
    openModal(m);
  }
  function runBulkEnrichAi() {
    if (ENRICH_CTX.running) return;
    var ids = ENRICH_CTX.ids || [];
    if (!ids.length) return;
    ENRICH_CTX.running = true;
    ENRICH_CTX.cancelled = false;
    var m = getModal('enrichAi');
    var web = !!(m.querySelector('[data-v30-enrich-web]') || {}).checked;
    var prog = m.querySelector('[data-v30-enrich-progress]');
    if (prog) prog.hidden = false;
    var bar = m.querySelector('[data-v30-enrich-progress-bar]');
    var txt = m.querySelector('[data-v30-enrich-progress-text]');
    var current = m.querySelector('[data-v30-enrich-current]');
    var sum = m.querySelector('[data-v30-enrich-summary]');
    if (sum) sum.hidden = true;
    var startBtn = m.querySelector('[data-v30-enrich-start]');
    if (startBtn) { startBtn.disabled = true; startBtn.textContent = 'IA en cours…'; }
    var total = ids.length;
    var done = 0, ok = 0, ko = 0;
    var summary = [];
    function setProgress() {
      var pct = total ? Math.round(done * 100 / total) : 0;
      if (bar) bar.style.width = pct + '%';
      if (txt) txt.textContent = done + ' / ' + total + ' traités (OK : ' + ok + ', erreurs : ' + ko + ')';
    }
    setProgress();

    function applyJsonToProspect(pid, json) {
      var updates = {};
      ['fonction','telephone','email','linkedin','notes','pertinence'].forEach(function (k) {
        if (json[k] != null && String(json[k]).trim()) updates[k] = String(json[k]).trim();
      });
      var tags = Array.isArray(json.tags) ? json.tags : null;
      var applied = [];
      var chain = Promise.resolve();
      Object.keys(updates).forEach(function (field) {
        if (['statut','pertinence','fonction'].indexOf(field) >= 0) {
          chain = chain.then(function () {
            return fetchPostJSON('/api/prospects/bulk-edit', { ids: [pid], field: field, value: updates[field] })
              .then(function () { applied.push(field); });
          });
        } else if (field === 'email' || field === 'telephone') {
          chain = chain.then(function () {
            return fetchPostJSON('/api/prospects/bulk-field-update', { ids: [pid], field: field, values: [updates[field]] })
              .then(function () { applied.push(field); });
          });
        }
      });
      if (tags && tags.length) {
        chain = chain.then(function () {
          return fetchPostJSON('/api/prospects/bulk-status-tags', { ids: [pid], add_tags: tags })
            .then(function () { applied.push('tags'); });
        });
      }
      return chain.then(function () { return applied; });
    }

    function step(i) {
      if (ENRICH_CTX.cancelled || i >= total) {
        ENRICH_CTX.running = false;
        if (current) current.textContent = '';
        if (sum) sum.hidden = false;
        var okEl = m.querySelector('[data-v30-enrich-ok]');
        var koEl = m.querySelector('[data-v30-enrich-ko]');
        if (okEl) okEl.textContent = ok;
        if (koEl) koEl.textContent = ko;
        var linesEl = m.querySelector('[data-v30-enrich-lines]');
        if (linesEl) linesEl.textContent = summary.join('\n');
        if (startBtn) { startBtn.disabled = false; startBtn.textContent = 'Relancer'; }
        toast('Enrichissement : ' + ok + ' OK, ' + ko + ' erreurs', ko ? 'warning' : 'success');
        if (ok > 0) loadProspects();
        return;
      }
      var pid = ids[i];
      var p = findProspectById(pid);
      if (!p) { ko++; done++; summary.push('#' + pid + ' : introuvable'); setProgress(); step(i + 1); return; }
      if (current) current.textContent = 'En cours : ' + (p.name || ('#' + pid)) + ' (' + (i + 1) + '/' + total + ')';
      var prompt = buildBulkEnrichPrompt(p);
      fetchPostJSON('/api/ollama/generate', { prompt: prompt, web_search: web, timeout: 180 })
        .then(function (res) {
          if (!res || !res.ok) throw new Error((res && res.error) || 'IA indisponible');
          var text = res.text || '';
          var json = extractJsonMaybe(text);
          if (!json) throw new Error('Réponse non JSON');
          return applyJsonToProspect(pid, json).then(function (applied) {
            if (applied.length) { ok++; summary.push((p.name || ('#' + pid)) + ' : ' + applied.join(', ')); }
            else { summary.push((p.name || ('#' + pid)) + ' : aucun champ nouveau'); }
          });
        })
        .catch(function (err) {
          ko++;
          summary.push((p.name || ('#' + pid)) + ' : ' + (err && err.message || err));
        })
        .then(function () {
          done++;
          setProgress();
          // Pause 300ms pour éviter rate limit (parité V29)
          setTimeout(function () { step(i + 1); }, ENRICH_CTX.cancelled ? 0 : 300);
        });
    }
    step(0);
  }
  function bindBulkEnrichAi() {
    var startBtn = document.querySelector('[data-v30-enrich-start]');
    if (startBtn) startBtn.addEventListener('click', runBulkEnrichAi);
    var cancelBtn = document.querySelector('[data-v30-enrich-cancel]');
    if (cancelBtn) cancelBtn.addEventListener('click', function () {
      ENRICH_CTX.cancelled = true;
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
        savePersistedFilters();
        loadProspects();
      }, 200);
    });
    // BUG 6 : bouton "Effacer la recherche" du bandeau d'état vide
    document.addEventListener('click', function (e) {
      if (!e.target.closest('[data-v30-clear-search]')) return;
      STATE.q = '';
      STATE.offset = 0;
      input.value = '';
      savePersistedFilters();
      loadProspects();
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

  // ─── Tri colonnes ────────────────────────────────────────────
  function bindSort() {
    document.addEventListener('click', function (e) {
      var th = e.target.closest('th[data-sort-key]');
      if (!th) return;
      var key = th.dataset.sortKey;
      if (STATE.sort.key === key) {
        STATE.sort.dir = STATE.sort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        STATE.sort.key = key;
        STATE.sort.dir = 'asc';
      }
      STATE.offset = 0;
      savePersistedFilters();
      loadProspects();
    });
  }

  // ─── Pills (Tous / Mes / A relancer / Hot + saved views) ────
  function applyViewFilter(name) {
    STATE.filter = name;
    STATE.q = '';
    STATE.filters = { statuts: [], statutsExclude: [], pertMin: 0, tags: [], relanceFrom: '', relanceTo: '', callableOnly: false, companyId: null };
    STATE.activeSavedViewId = null;
    STATE.offset = 0;
    var inp = document.querySelector('[data-v30-search]');
    if (inp) inp.value = '';
    updateFilterBadge();
    savePersistedFilters();
    loadProspects();
  }

  function bindBuiltinPills() {
    document.querySelectorAll('.v30-pp-views [data-view-filter]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.v30-pp-views [data-view-filter]').forEach(function (b) {
          b.classList.toggle('is-active', b === btn);
        });
        document.querySelectorAll('[data-saved-view-id]').forEach(function (b) { b.classList.remove('is-active'); });
        applyViewFilter(btn.dataset.viewFilter);
        renderSavedPills();
      });
    });
  }

  function renderSavedPills() {
    var host = document.querySelector('[data-v30-saved-views]');
    if (!host) return;
    var activeId = STATE.activeSavedViewId;
    host.innerHTML = (STATE.savedViews || []).map(function (v) {
      var isActive = activeId && String(activeId) === String(v.id);
      var cls = 'v30-pill' + (isActive ? ' is-active' : '');
      // BUG 24 : si actif, le × désactive la vue ; sinon, il supprime (avec confirm)
      var xAttrs = isActive
        ? ' data-saved-view-deactivate="' + v.id + '" aria-label="Désactiver"'
        : ' data-saved-view-delete="' + v.id + '" aria-label="Supprimer"';
      return '<button type="button" class="' + cls + '" data-saved-view-id="' + v.id + '">' +
        esc(v.name) + ' <span class="v30-pill__x"' + xAttrs + '>×</span>' +
      '</button>';
    }).join('');
    if (activeId) {
      document.querySelectorAll('.v30-pp-views [data-view-filter]').forEach(function (b) { b.classList.remove('is-active'); });
    }
    host.querySelectorAll('[data-saved-view-id]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        if (e.target.closest('[data-saved-view-delete]')) return;
        if (e.target.closest('[data-saved-view-deactivate]')) return;
        var v = (STATE.savedViews || []).find(function (x) { return x.id == btn.dataset.savedViewId; });
        if (!v) return;
        var st = v.state || {};
        STATE.q = st.q || '';
        var inp = document.querySelector('[data-v30-search]');
        if (inp) inp.value = STATE.q;
        STATE.filter = st.filter || 'all';
        STATE.filters = {
          statuts: st.statuts || [],
          statutsExclude: st.statutsExclude || [],
          pertMin: st.pertMin || 0,
          tags: st.tags || [],
          relanceFrom: st.relanceFrom || '',
          relanceTo: st.relanceTo || '',
          callableOnly: !!st.callableOnly,
          companyId: st.companyId || null
        };
        STATE.offset = 0;
        STATE.activeSavedViewId = btn.dataset.savedViewId;
        updateFilterBadge();
        savePersistedFilters();
        loadProspects();
        renderSavedPills();
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
    // × sur une vue active → on désactive (reset "Tous") sans supprimer
    host.querySelectorAll('[data-saved-view-deactivate]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        applyViewFilter('all');
        var tousBtn = document.querySelector('.v30-pp-views [data-view-filter="all"]');
        if (tousBtn) {
          document.querySelectorAll('.v30-pp-views [data-view-filter]').forEach(function (b) {
            b.classList.toggle('is-active', b === tousBtn);
          });
        }
        renderSavedPills();
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
          state: {
              q: STATE.q || '',
              filter: STATE.filter || 'all',
              statuts: STATE.filters.statuts || [],
              statutsExclude: STATE.filters.statutsExclude || [],
              pertMin: STATE.filters.pertMin || 0,
              tags: STATE.filters.tags || [],
              relanceFrom: STATE.filters.relanceFrom || '',
              relanceTo: STATE.filters.relanceTo || '',
              callableOnly: !!STATE.filters.callableOnly,
              companyId: STATE.filters.companyId || null
            }
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
  // v30.2 — le champ entreprise est géré par CompanyPicker (autocomplete + création forcée).
  var _addCompanyPicker = null;
  function mountAddCompanyPicker() {
    var input = document.getElementById('v30-pp-add-company');
    if (!input || !window.CompanyPicker) return null;
    if (input._cpAttached) {
      input._cpAttached.clear();
      return input._cpAttached;
    }
    _addCompanyPicker = window.CompanyPicker.attachToInput(input, {});
    return _addCompanyPicker;
  }
  function populateCompanyFilter() {
    var sel = document.querySelector('[data-v30-flt-company]');
    if (!sel) return;
    var cur = String(STATE.filters.companyId || '');
    var ids = Object.keys(STATE.companies).filter(function (id) { return STATE.companies[id]; });
    ids.sort(function (a, b) { return STATE.companies[a].localeCompare(STATE.companies[b], 'fr', { sensitivity: 'base' }); });
    sel.innerHTML = '<option value="">Toutes les entreprises</option>' +
      ids.map(function (id) { return '<option value="' + esc(id) + '">' + esc(STATE.companies[id]) + '</option>'; }).join('');
    if (cur) sel.value = cur;
  }

  function bindAdd() {
    var btn = document.querySelector('[data-v30-add]');
    if (btn) btn.addEventListener('click', function () {
      mountAddCompanyPicker();
      openModal(getModal('add'));
    });
    var save = document.querySelector('[data-v30-pp-add-save]');
    if (save) save.addEventListener('click', function () {
      var val = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
      var name = val('v30-pp-add-name');
      if (!name) { toast('Le nom est obligatoire', 'warning'); return; }
      var picker = _addCompanyPicker || mountAddCompanyPicker();
      var sel = picker && picker.getSelection ? picker.getSelection() : null;
      if (!sel || !sel.id) {
        toast("Sélectionne une entreprise existante ou crée-la via « Ajouter une entreprise »", 'warning');
        var compInput = document.getElementById('v30-pp-add-company');
        if (compInput) compInput.focus();
        return;
      }
      var tagsRaw = val('v30-pp-add-tags');
      var tags = tagsRaw ? tagsRaw.split(',').map(function (t) { return t.trim(); }).filter(Boolean) : [];
      var payload = {
        name: name,
        fonction: val('v30-pp-add-fonction'),
        company_id: sel.id,
        company_groupe: sel.groupe,
        company_site: sel.site,
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
            ['v30-pp-add-name','v30-pp-add-fonction',
             'v30-pp-add-tel','v30-pp-add-email','v30-pp-add-linkedin','v30-pp-add-tags','v30-pp-add-notes']
              .forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ''; });
            if (_addCompanyPicker) _addCompanyPicker.clear();
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
    if (F.statutsExclude && F.statutsExclude.length) n++;
    if (F.pertMin) n++;
    if (F.tags && F.tags.length) n++;
    if (F.relanceFrom || F.relanceTo) n++;
    if (F.callableOnly) n++;
    if (F.companyId) n++;
    return n;
  }
  function updateFilterBadge() {
    var host = document.querySelector('[data-v30-filters] [data-field="active"]');
    var clearBtn = document.querySelector('[data-v30-flt-clear-all]');
    var n = countActiveFilters();
    if (host) { host.hidden = (n === 0); if (n > 0) host.textContent = n; }
    if (clearBtn) clearBtn.hidden = (n === 0);
  }
  function openFiltersModal() {
    var m = getModal('filters');
    if (!m) return;
    var F = STATE.filters;
    m.querySelectorAll('[data-v30-flt-statut] input[type=checkbox]').forEach(function (cb) {
      cb.checked = F.statuts.indexOf(cb.value) >= 0;
    });
    m.querySelectorAll('[data-v30-flt-statut-exclude] input[type=checkbox]').forEach(function (cb) {
      cb.checked = (F.statutsExclude || []).indexOf(cb.value) >= 0;
    });
    var pm = m.querySelector('[data-v30-flt-pert-min]'); if (pm) pm.value = String(F.pertMin || 0);
    var tg = m.querySelector('[data-v30-flt-tags]');   if (tg) tg.value = (F.tags || []).join(', ');
    populateCompanyFilter();
    var cp = m.querySelector('[data-v30-flt-company]'); if (cp) cp.value = String(F.companyId || '');
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
      var statutsExclude = [];
      m.querySelectorAll('[data-v30-flt-statut-exclude] input[type=checkbox]:checked').forEach(function (cb) { statutsExclude.push(cb.value); });
      var tagsRaw = (m.querySelector('[data-v30-flt-tags]') || {}).value || '';
      var tags = tagsRaw.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
      var compEl = m.querySelector('[data-v30-flt-company]');
      STATE.filters = {
        statuts: statuts,
        statutsExclude: statutsExclude,
        pertMin: parseInt((m.querySelector('[data-v30-flt-pert-min]') || {}).value || '0', 10),
        tags: tags,
        relanceFrom: (m.querySelector('[data-v30-flt-relance-from]') || {}).value || '',
        relanceTo: (m.querySelector('[data-v30-flt-relance-to]') || {}).value || '',
        callableOnly: !!(m.querySelector('[data-v30-flt-callable]') || {}).checked,
        companyId: compEl && compEl.value ? Number(compEl.value) : null
      };
      STATE.offset = 0;
      updateFilterBadge();
      closeModal(m);
      savePersistedFilters();
      loadProspects();
    });
    var reset = document.querySelector('[data-v30-flt-reset]');
    if (reset) reset.addEventListener('click', function () {
      STATE.filters = { statuts: [], statutsExclude: [], pertMin: 0, tags: [], relanceFrom: '', relanceTo: '', callableOnly: false, companyId: null };
      STATE.offset = 0;
      updateFilterBadge();
      closeModal(getModal('filters'));
      savePersistedFilters();
      loadProspects();
    });
    var clearAll = document.querySelector('[data-v30-flt-clear-all]');
    if (clearAll) clearAll.addEventListener('click', function (e) {
      e.stopPropagation();
      STATE.filters = { statuts: [], statutsExclude: [], pertMin: 0, tags: [], relanceFrom: '', relanceTo: '', callableOnly: false, companyId: null };
      STATE.q = '';
      var inp = document.querySelector('[data-v30-search]');
      if (inp) inp.value = '';
      STATE.offset = 0;
      updateFilterBadge();
      savePersistedFilters();
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

  // ─── Import (Excel / CSV / Collage / IA) ──────────────────
  var IMP = { rows: [], headers: [], mapping: {}, activeTab: 'file', aiItems: null };
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

  // ─── Parseurs texte ──────────────────────────────────────
  function detectDelimiter(firstLine) {
    var tab = (firstLine.match(/\t/g) || []).length;
    var semi = (firstLine.match(/;/g) || []).length;
    var pipe = (firstLine.match(/\|/g) || []).length;
    var comma = (firstLine.match(/,/g) || []).length;
    // Tab prioritaire si présent
    if (tab > 0 && tab >= Math.max(semi, pipe, comma)) return '\t';
    if (pipe >= Math.max(semi, comma) && pipe > 0) return '|';
    if (semi >= comma && semi > 0) return ';';
    if (comma > 0) return ',';
    return '\t';
  }
  function parseCsvLine(line, sep) {
    var cells = [];
    var cur = '';
    var inQuotes = false;
    for (var j = 0; j < line.length; j++) {
      var c = line[j];
      if (c === '"') {
        // Double quote à l'intérieur → quote littéral
        if (inQuotes && line[j + 1] === '"') { cur += '"'; j++; }
        else inQuotes = !inQuotes;
      } else if (c === sep && !inQuotes) {
        cells.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    cells.push(cur.trim());
    return cells;
  }
  function parseDelimitedText(text, opts) {
    opts = opts || {};
    // Normaliser les fins de ligne, retirer BOM
    var clean = String(text || '').replace(/^\ufeff/, '');
    var lines = clean.split(/\r?\n/).filter(function (l) { return l.trim().length > 0; });
    if (lines.length === 0) return null;
    var sep = opts.separator || detectDelimiter(lines[0]);
    var headers = parseCsvLine(lines[0], sep).map(function (h) { return String(h || '').trim(); });
    var rows = [];
    for (var i = 1; i < lines.length; i++) {
      var cells = parseCsvLine(lines[i], sep);
      if (cells.some(function (c) { return String(c || '').trim().length > 0; })) rows.push(cells);
    }
    return { headers: headers, rows: rows, separator: sep };
  }
  function readFileAsText(file) {
    // Tente UTF-8, puis fallback CP1252 (Windows) si caractères de remplacement détectés
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onerror = function () { reject(new Error('Lecture fichier impossible')); };
      r.onload = function (e) {
        var txt = e.target.result;
        if (typeof txt === 'string' && txt.indexOf('\ufffd') !== -1) {
          // Relecture en CP1252 (windows-1252)
          var r2 = new FileReader();
          r2.onerror = function () { resolve(txt); };
          r2.onload = function (ee) { resolve(ee.target.result); };
          try { r2.readAsText(file, 'windows-1252'); } catch (_) { resolve(txt); }
        } else {
          resolve(txt);
        }
      };
      try { r.readAsText(file, 'utf-8'); } catch (err) { reject(err); }
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
  function showMappingStep() {
    // Cache les 3 panels, affiche l'étape mapping
    ['file','paste','ai'].forEach(function (p) {
      var el = document.querySelector('[data-v30-imp-panel="' + p + '"]');
      if (el) el.hidden = true;
    });
    var tabs = document.querySelector('[data-v30-imp-tabs]');
    if (tabs) tabs.style.display = 'none';
    var map = document.querySelector('[data-v30-imp-step="map"]');
    if (map) map.hidden = false;
    var c = document.querySelector('[data-v30-imp-count]');
    if (c) c.textContent = IMP.rows.length;
    renderImportMapping();
    var run = document.querySelector('[data-v30-imp-run]');
    if (run) run.hidden = false;
  }
  function resetImportModal() {
    IMP = { rows: [], headers: [], mapping: {}, activeTab: 'file', aiItems: null };
    ['map','progress'].forEach(function (s) {
      var el = document.querySelector('[data-v30-imp-step="' + s + '"]');
      if (el) el.hidden = true;
    });
    // Réaffiche les tabs + panel actif = file
    var tabs = document.querySelector('[data-v30-imp-tabs]');
    if (tabs) tabs.style.display = '';
    document.querySelectorAll('[data-v30-imp-tab]').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.v30ImpTab === 'file');
    });
    ['file','paste','ai'].forEach(function (p) {
      var el = document.querySelector('[data-v30-imp-panel="' + p + '"]');
      if (el) el.hidden = (p !== 'file');
    });
    var run = document.querySelector('[data-v30-imp-run]');
    if (run) { run.hidden = true; run.textContent = 'Importer'; run.disabled = false; }
    var file = document.querySelector('[data-v30-imp-file]');
    if (file) file.value = '';
    var paste = document.querySelector('[data-v30-imp-paste-text]');
    if (paste) paste.value = '';
    var pHint = document.querySelector('[data-v30-imp-paste-hint]');
    if (pHint) pHint.textContent = '';
    var aiTa = document.querySelector('[data-v30-imp-ai-json]');
    if (aiTa) aiTa.value = '';
    var aiHint = document.querySelector('[data-v30-imp-ai-hint]');
    if (aiHint) aiHint.textContent = '';
    var aiPrev = document.querySelector('[data-v30-imp-ai-preview]');
    if (aiPrev) aiPrev.hidden = true;
  }

  // ─── Payloads & import run ────────────────────────────────
  function normalizeAiEntry(obj) {
    // Accepte plusieurs alias pour les clés
    if (!obj || typeof obj !== 'object') return null;
    function pick() {
      for (var i = 0; i < arguments.length; i++) {
        var k = arguments[i];
        if (obj[k] != null && String(obj[k]).trim()) return String(obj[k]).trim();
      }
      return '';
    }
    var name = pick('name', 'nom', 'fullname', 'full_name', 'contact');
    var prenom = pick('prenom', 'firstname', 'first_name', 'first');
    if (prenom) name = (prenom + ' ' + name).trim();
    var company = pick('company', 'company_groupe', 'entreprise', 'groupe', 'societe');
    var site = pick('company_site', 'site', 'ville', 'city');
    var fonction = pick('fonction', 'poste', 'title', 'role');
    var tel = pick('telephone', 'tel', 'phone', 'mobile');
    var email = pick('email', 'mail', 'e-mail');
    var linkedin = pick('linkedin', 'li', 'linkedin_url');
    var notes = pick('notes', 'note', 'commentaire');
    var pertinence = pick('pertinence', 'score', 'priority');
    var statut = pick('statut', 'status', 'etat');
    var tagsRaw = obj.tags != null ? obj.tags : (obj.mots_cles != null ? obj.mots_cles : null);
    var tags = [];
    if (Array.isArray(tagsRaw)) tags = tagsRaw.map(function (t) { return String(t).trim(); }).filter(Boolean);
    else if (typeof tagsRaw === 'string') tags = tagsRaw.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
    // Au minimum : name ou company
    if (!name && !company) return null;
    var out = {};
    if (name) out.name = name;
    if (company) out.company_groupe = company;
    if (site) out.company_site = site;
    if (fonction) out.fonction = fonction;
    if (tel) out.telephone = tel;
    if (email) out.email = email;
    if (linkedin) out.linkedin = linkedin;
    if (notes) out.notes = notes;
    if (pertinence) out.pertinence = pertinence;
    if (statut) out.statut = statut;
    if (tags.length) out.tags = tags;
    // Si pas de name mais company, on met company comme name fallback
    if (!out.name && out.company_groupe) out.name = out.company_groupe;
    return out;
  }
  function buildRowPayload(row) {
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
  function runImportPayloads(payloads) {
    var total = payloads.length;
    if (!total) { toast('Aucun prospect à importer', 'warning'); return; }
    // Masquer tous panels + tabs, afficher progress
    ['file','paste','ai'].forEach(function (p) {
      var el = document.querySelector('[data-v30-imp-panel="' + p + '"]');
      if (el) el.hidden = true;
    });
    var tabs = document.querySelector('[data-v30-imp-tabs]');
    if (tabs) tabs.style.display = 'none';
    var mapStep = document.querySelector('[data-v30-imp-step="map"]');
    if (mapStep) mapStep.hidden = true;
    var prog = document.querySelector('[data-v30-imp-step="progress"]');
    if (prog) prog.hidden = false;
    var run = document.querySelector('[data-v30-imp-run]');
    if (run) run.hidden = true;

    var ok = 0, errors = 0, i = 0;
    var bar = document.querySelector('[data-v30-imp-progress-bar]');
    var txt = document.querySelector('[data-v30-imp-progress-text]');
    function setProgress(n) {
      if (bar) bar.style.width = Math.round(n * 100 / total) + '%';
      if (txt) txt.textContent = 'Import : ' + n + ' / ' + total + '  (OK : ' + ok + ', erreurs : ' + errors + ')';
    }
    setProgress(0);
    function next() {
      if (i >= total) {
        toast('Import terminé : ' + ok + ' ajouté(s), ' + errors + ' erreur(s)', errors ? 'warning' : 'success');
        closeModal(getModal('import'));
        loadProspects();
        return;
      }
      var payload = payloads[i];
      if (!payload || !payload.name) { errors++; i++; setProgress(i); setTimeout(next, 0); return; }
      fetchPostJSON('/api/prospects/create', payload)
        .then(function (res) { if (res && res.ok) ok++; else errors++; })
        .catch(function () { errors++; })
        .then(function () { i++; setProgress(i); setTimeout(next, 0); });
    }
    next();
  }

  function bindImport() {
    var btn = document.querySelector('[data-v30-import]');
    if (btn) btn.addEventListener('click', function () {
      resetImportModal();
      openModal(getModal('import'));
    });

    // Switch de tabs
    document.querySelectorAll('[data-v30-imp-tab]').forEach(function (b) {
      b.addEventListener('click', function () {
        var name = b.dataset.v30ImpTab;
        IMP.activeTab = name;
        document.querySelectorAll('[data-v30-imp-tab]').forEach(function (x) {
          x.classList.toggle('is-active', x === b);
        });
        ['file','paste','ai'].forEach(function (p) {
          var el = document.querySelector('[data-v30-imp-panel="' + p + '"]');
          if (el) el.hidden = (p !== name);
        });
      });
    });

    // Onglet fichier : Excel OU CSV selon extension
    var file = document.querySelector('[data-v30-imp-file]');
    if (file) file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (!f) return;
      var nameLower = (f.name || '').toLowerCase();
      var isCsv = /\.csv$/.test(nameLower);
      toast('Chargement du fichier…', 'info');

      if (isCsv) {
        readFileAsText(f).then(function (txt) {
          var raw = parseDelimitedText(txt, {});
          if (!raw || !raw.rows.length) { toast('CSV vide ou illisible', 'warning'); return; }
          IMP.headers = raw.headers;
          IMP.rows = raw.rows;
          IMP.mapping = {};
          IMP.headers.forEach(function (h, i) { IMP.mapping[i] = guessField(h); });
          showMappingStep();
        }).catch(function (err) { toast('Lecture CSV impossible : ' + err.message, 'error'); });
        return;
      }

      // Excel
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
            showMappingStep();
          } catch (err) {
            toast('Lecture impossible : ' + err.message, 'error');
          }
        };
        reader.readAsArrayBuffer(f);
      }).catch(function (err) { toast(err.message, 'error'); });
    });

    // Onglet collage texte
    var pasteParse = document.querySelector('[data-v30-imp-paste-parse]');
    if (pasteParse) pasteParse.addEventListener('click', function () {
      var ta = document.querySelector('[data-v30-imp-paste-text]');
      var hint = document.querySelector('[data-v30-imp-paste-hint]');
      var text = ta ? (ta.value || '') : '';
      if (!text.trim()) { toast('Colle au moins une ligne d\'en-têtes + une ligne de données', 'warning'); return; }
      var raw = parseDelimitedText(text, {});
      if (!raw || !raw.rows.length) {
        if (hint) hint.textContent = '';
        toast('Impossible d\'extraire au moins une ligne de données', 'warning');
        return;
      }
      var sepLabel = raw.separator === '\t' ? 'tabulation' : (raw.separator === '|' ? 'pipe' : raw.separator);
      if (hint) hint.textContent = raw.rows.length + ' ligne(s) — séparateur « ' + sepLabel + ' »';
      IMP.headers = raw.headers;
      IMP.rows = raw.rows;
      IMP.mapping = {};
      IMP.headers.forEach(function (h, i) { IMP.mapping[i] = guessField(h); });
      showMappingStep();
    });

    // Onglet collage IA (JSON)
    var aiParse = document.querySelector('[data-v30-imp-ai-parse]');
    if (aiParse) aiParse.addEventListener('click', function () {
      var ta = document.querySelector('[data-v30-imp-ai-json]');
      var hint = document.querySelector('[data-v30-imp-ai-hint]');
      var prev = document.querySelector('[data-v30-imp-ai-preview]');
      var prevCount = document.querySelector('[data-v30-imp-ai-count]');
      var prevPre = document.querySelector('[data-v30-imp-ai-preview-pre]');
      var text = ta ? (ta.value || '').trim() : '';
      if (!text) { toast('Colle un JSON de prospects', 'warning'); return; }
      // Tente de nettoyer fences markdown
      var cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
      var data;
      try { data = JSON.parse(cleaned); }
      catch (err) {
        // Tente d'extraire le premier array ou object
        var mArr = cleaned.match(/\[[\s\S]*\]/);
        var mObj = cleaned.match(/\{[\s\S]*\}/);
        try { data = JSON.parse((mArr && mArr[0]) || (mObj && mObj[0]) || ''); }
        catch (e2) { toast('JSON invalide : ' + err.message, 'error'); return; }
      }
      var arr = null;
      if (Array.isArray(data)) arr = data;
      else if (data && Array.isArray(data.prospects)) arr = data.prospects;
      else if (data && typeof data === 'object') arr = [data];
      if (!arr || !arr.length) { toast('Aucune entrée exploitable dans le JSON', 'warning'); return; }

      var items = [];
      var skipped = 0;
      arr.forEach(function (it) {
        var n = normalizeAiEntry(it);
        if (n) items.push(n); else skipped++;
      });
      if (!items.length) { toast('Aucune entrée valide (name/company manquants)', 'warning'); return; }

      IMP.aiItems = items;
      if (hint) hint.textContent = items.length + ' prospect(s) prêt(s)' + (skipped ? (' — ' + skipped + ' ignoré(s)') : '');
      if (prev) prev.hidden = false;
      if (prevCount) prevCount.textContent = items.length;
      if (prevPre) prevPre.textContent = JSON.stringify(items.slice(0, 3), null, 2);

      // Reveal bouton importer
      var run = document.querySelector('[data-v30-imp-run]');
      if (run) { run.hidden = false; run.textContent = 'Importer ' + items.length + ' prospect(s)'; }
    });

    // Bouton "Importer" : route selon contexte (mapping ou aiItems)
    var run = document.querySelector('[data-v30-imp-run]');
    if (run) run.addEventListener('click', function () {
      // Collage IA : payloads déjà construits
      if (IMP.activeTab === 'ai' && Array.isArray(IMP.aiItems) && IMP.aiItems.length) {
        runImportPayloads(IMP.aiItems);
        return;
      }
      // Excel / CSV / Collage texte : build depuis mapping
      var rows = IMP.rows || [];
      var payloads = rows.map(buildRowPayload);
      runImportPayloads(payloads);
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
        // Aucune sélection : on prend les prospects filtrés+triés courants (dataset complet non paginé).
        var pool = STATE.filteredAll || STATE.prospects || [];
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

  function bindTagsTip() {
    var tip = document.createElement('div');
    tip.className = 'v30-pp-tags-tip';
    tip.hidden = true;
    document.body.appendChild(tip);
    document.addEventListener('mouseover', function (e) {
      var el = e.target.closest('[data-v30-tags-all]');
      if (!el) { tip.hidden = true; return; }
      var tags = [];
      try { tags = JSON.parse(el.dataset.v30TagsAll || '[]'); } catch (_) {}
      if (!tags.length) return;
      tip.innerHTML = tags.map(function (t) { return '<span class="badge">' + esc(t) + '</span>'; }).join(' ');
      tip.hidden = false;
      var r = el.getBoundingClientRect();
      var th = tip.getBoundingClientRect().height;
      var top = r.top - th - 6;
      if (top < 6) top = r.bottom + 6;
      var left = r.left;
      var tw = tip.getBoundingClientRect().width;
      if (left + tw > window.innerWidth - 8) left = window.innerWidth - tw - 8;
      tip.style.top = top + 'px';
      tip.style.left = left + 'px';
    });
    document.addEventListener('mouseout', function (e) {
      if (e.target.closest('[data-v30-tags-all]') && !tip.contains(e.relatedTarget)) tip.hidden = true;
    });
  }

  function bindTelLog() {
    function closeTelDrops() {
      document.querySelectorAll('.v30-pp-tel-drop').forEach(function (d) { d.hidden = true; });
    }
    document.addEventListener('click', function (e) {
      // Tel link click → close picker + log call
      var link = e.target.closest('a[href^="tel:"]');
      if (link) {
        closeTelDrops();
        var row = link.closest('tr[data-id]');
        var id = row ? Number(row.dataset.id) : 0;
        if (id) {
          fetch('/api/prospect/log-call', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prospect_id: id })
          }).then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) {
              if (!d || !d.ok || !d.lastContact) return;
              var p = STATE.prospects.find(function (x) { return x.id === id; });
              if (p) {
                p.lastContact = d.lastContact;
                var tr = document.querySelector('tr[data-id="' + id + '"]');
                if (tr) tr.outerHTML = renderRow(p);
              }
            }).catch(function () {});
        }
        return;
      }
      // Multi-phone toggle → open/close dropdown
      var multi = e.target.closest('[data-v30-tel-multi]');
      if (multi) {
        e.preventDefault();
        var drop = multi.querySelector('.v30-pp-tel-drop');
        if (!drop) return;
        var wasHidden = drop.hidden;
        closeTelDrops();
        drop.hidden = !wasHidden;
        return;
      }
      // Click elsewhere → close all dropdowns
      closeTelDrops();
    });
  }

  function readUrlFilters() {
    try {
      var params = new URLSearchParams(window.location.search);
      var cid = params.get('company');
      if (cid) STATE.filters.companyId = Number(cid);
    } catch (_) {}
  }

  function restorePersistedFilters() {
    var saved = loadPersistedFilters();
    // Always restore sort preference (column ordering, not a filter)
    if (saved && saved.sort && typeof saved.sort === 'object') {
      STATE.sort = { key: saved.sort.key || '', dir: saved.sort.dir === 'desc' ? 'desc' : 'asc' };
    }
    // Only restore active filters when coming back from a prospect detail page
    var fromDetail = sessionStorage.getItem('v30.prospects.from_detail');
    if (!fromDetail) return;
    sessionStorage.removeItem('v30.prospects.from_detail');
    if (!saved) return;
    if (typeof saved.q === 'string') STATE.q = saved.q;
    if (typeof saved.filter === 'string') STATE.filter = saved.filter === 'hot' ? 'rdv' : saved.filter;
    STATE.activeSavedViewId = saved.savedViewId || null;
    if (saved.filters && typeof saved.filters === 'object') {
      STATE.filters = {
        statuts: Array.isArray(saved.filters.statuts) ? saved.filters.statuts : [],
        statutsExclude: Array.isArray(saved.filters.statutsExclude) ? saved.filters.statutsExclude : [],
        pertMin: Number(saved.filters.pertMin) || 0,
        tags: Array.isArray(saved.filters.tags) ? saved.filters.tags : [],
        relanceFrom: saved.filters.relanceFrom || '',
        relanceTo: saved.filters.relanceTo || '',
        callableOnly: !!saved.filters.callableOnly,
        companyId: saved.filters.companyId || null
      };
    }
  }

  function syncUiFromState() {
    var inp = document.querySelector('[data-v30-search]');
    if (inp) inp.value = STATE.q || '';
    var active = STATE.activeSavedViewId ? null : (STATE.filter || 'all');
    document.querySelectorAll('.v30-pp-views [data-view-filter]').forEach(function (b) {
      b.classList.toggle('is-active', active != null && b.dataset.viewFilter === active);
    });
  }

  function init() {
    restorePersistedFilters();
    readUrlFilters();
    bindViewSwitch();
    bindSelection();
    bindSplit();
    bindOpen();
    bindKanbanDnd();
    bindBulk();
    bindSearch();
    bindPagination();
    bindSort();
    bindBuiltinPills();
    bindSaveView();
    bindModalDismiss();
    bindAdd();
    bindFilters();
    bindColumns();
    bindImport();
    bindExport();
    bindAi();
    bindBulkEdit();
    bindBulkEnrichAi();
    bindModeProsp();
    bindTelLog();
    bindTagsTip();
    syncUiFromState();
    updateFilterBadge();
    loadProspects();
    loadSavedViews();
    // BUG 1 : Ouvrir le modal d'ajout si ?new=1 dans l'URL (depuis la palette)
    try {
      if (new URLSearchParams(window.location.search).get('new') === '1') {
        var addModal = getModal('add');
        if (addModal) {
          mountAddCompanyPicker();
          openModal(addModal);
          history.replaceState(null, '', window.location.pathname);
        }
      }
    } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
