/* ProspUp v30 — Focus : 3 colonnes overdue / today / upcoming */
(function () {
  'use strict';

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
  function fetchJSON(url) {
    return fetch(url, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function fmtDateFR() {
    var d = new Date();
    var jour = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'][d.getDay()];
    var mois = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'][d.getMonth()];
    return jour + ' ' + d.getDate() + ' ' + mois;
  }
  // Mapping aligné sur prospects.js (statuts ProspUp réels) — Phase 1.2.
  function statusClass(statut) {
    var m = {
      'Rendez-vous':   'status-rdv',
      'Prospecté':     'status-prosp',
      'Contacté':      'status-called',
      'Appelé':        'status-called',
      'Messagerie':    'status-voicemail',
      'À rappeler':    'status-callback',
      'Pas intéressé': 'status-cold',
      "Pas d'actions": 'status-idle'
    };
    return m[statut] || 'status-idle';
  }

  function row(p, meta) {
    return '<div class="v30-ac__row" data-v30-focus-row data-pid="' + p.id + '">' +
      '<a href="/v30/prospect/' + p.id + '" style="display:flex;align-items:center;gap:10px;min-width:0;flex:1;text-decoration:none;color:inherit;">' +
        '<span class="avatar">' + esc(initials(p.name)) + '</span>' +
        '<div style="min-width:0;">' +
          '<div class="v30-ac__name truncate">' + esc(p.name || '—') + '</div>' +
          '<div class="v30-ac__sub truncate">' + esc(meta || '') + '</div>' +
        '</div>' +
      '</a>' +
      (p.statut ? '<span class="status ' + statusClass(p.statut) + '">' + esc(p.statut) + '</span>' : '<span></span>') +
      '<div style="display:flex;gap:4px;">' +
        '<button type="button" class="btn btn-ghost btn-sm" data-v30-focus-bump="1" title="Reporter +1 jour">+1j</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-v30-focus-bump="7" title="Reporter +7 jours">+7j</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-v30-focus-done title="Marquer fait (efface la relance)">✓</button>' +
      '</div>' +
    '</div>';
  }

  function addDays(iso, days) {
    var d = iso ? new Date(iso) : new Date();
    if (isNaN(d.getTime())) d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function bindFocusRowActions() {
    document.addEventListener('click', function (e) {
      var row = e.target.closest('[data-v30-focus-row]');
      if (!row) return;
      var pid = Number(row.dataset.pid);
      if (!pid) return;
      var bump = e.target.closest('[data-v30-focus-bump]');
      var done = e.target.closest('[data-v30-focus-done]');
      if (!bump && !done) return;
      e.preventDefault();
      e.stopPropagation();
      var t = typeof window.showToast === 'function' ? window.showToast : function () {};
      var todayIso = new Date().toISOString().slice(0, 10);
      if (bump) {
        var days = Number(bump.dataset.v30FocusBump) || 1;
        var nf = addDays(todayIso, days);
        postJSON('/api/prospects/bulk-update', { ids: [pid], nextFollowUp: nf })
          .then(function () { t('Relance reportée de +' + days + 'j', 'success'); load(); })
          .catch(function () { t('Erreur', 'error'); });
      } else if (done) {
        postJSON('/api/prospects/bulk-update', { ids: [pid], nextFollowUp: null })
          .then(function () { t('Relance effacée', 'success'); load(); })
          .catch(function () { t('Erreur', 'error'); });
      }
    });
  }

  function renderCol(key, items, emptyText) {
    var host = document.querySelector('[data-v30-focus-col="' + key + '"] [data-field="rows"]');
    var count = document.querySelector('[data-v30-focus-col="' + key + '"] [data-field="count"]');
    if (count) count.textContent = items.length;
    if (!host) return;
    if (items.length === 0) {
      host.innerHTML = '<div class="empty" style="padding:20px;">' + esc(emptyText) + '</div>';
      return;
    }
    host.innerHTML = items.join('');
  }

  // ─── Bloc Tâches (parité v29 : CRUD complet via modale) ────
  var TASKS = { showDone: false, items: [], prospects: [], candidates: [] };

  function postJSON(url, body) {
    return fetch(url, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
  }
  function todayISO() { return new Date().toISOString().slice(0, 10); }

  function _taskDueBadge(dueDate) {
    if (!dueDate) return '';
    var today = todayISO();
    var cls = 'v30-task-row__due muted mono';
    if (dueDate < today) cls += ' is-overdue';
    else if (dueDate === today) cls += ' is-today';
    var d = new Date(dueDate + 'T00:00:00');
    var label = isNaN(d.getTime()) ? dueDate : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
    return '<span class="' + cls + '">' + esc(label) + '</span>';
  }
  function _taskLinkedNames(linked) {
    if (!linked) return '';
    var parts = [];
    var pIds = linked.prospects || [];
    var cIds = linked.candidates || [];
    if (pIds.length && TASKS.prospects.length) {
      pIds.forEach(function (pid) {
        var p = TASKS.prospects.find(function (x) { return x.id === pid; });
        if (p) parts.push('<span class="v30-task-linked">· ' + esc(p.name) + '</span>');
      });
    }
    if (cIds.length && TASKS.candidates.length) {
      cIds.forEach(function (cid) {
        var c = TASKS.candidates.find(function (x) { return x.id === cid; });
        if (c) parts.push('<span class="v30-task-linked">✧ ' + esc(c.name) + '</span>');
      });
    }
    return parts.join(' ');
  }

  function renderTasks() {
    var host = document.querySelector('[data-v30-tasks-list]');
    var c = document.querySelector('[data-v30-focus-tasks] [data-field="tcount"]');
    if (!host) return;
    var items = TASKS.items.slice();
    if (!TASKS.showDone) items = items.filter(function (t) { return t.status !== 'done'; });
    if (c) c.textContent = items.filter(function (t) { return t.status !== 'done'; }).length;
    if (items.length === 0) {
      host.innerHTML = '<div class="empty" style="padding:20px;font-size:12px;">Aucune tâche. Cliquez sur « Ajouter ».</div>';
      return;
    }
    host.innerHTML = items.map(function (t) {
      var done = t.status === 'done';
      var due = _taskDueBadge(t.due_date);
      var linked = _taskLinkedNames(t.linked_ids);
      var comment = t.comment
        ? ('<div class="v30-task-row__comment muted truncate">' + esc(t.comment) + '</div>')
        : '';
      return '<div class="v30-task-row' + (done ? ' is-done' : '') + '" data-tid="' + t.id + '">' +
        '<input type="checkbox" ' + (done ? 'checked' : '') + ' data-v30-task-done aria-label="Marquer comme fait">' +
        '<div class="v30-task-row__body" data-v30-task-edit>' +
          '<div class="v30-task-row__title">' + esc(t.title || '') + '</div>' +
          comment +
          (linked ? '<div class="v30-task-row__linked">' + linked + '</div>' : '') +
        '</div>' +
        (due || '<span></span>') +
        '<button type="button" class="btn btn-ghost btn-sm btn-icon" data-v30-task-delete ' +
          'aria-label="Supprimer" title="Supprimer">×</button>' +
      '</div>';
    }).join('');
  }

  function loadTasks() {
    return fetchJSON('/api/tasks?status=all').then(function (res) {
      TASKS.items = (res && res.tasks) || [];
      renderTasks();
    }).catch(function (err) {
      console.error('[v30 focus tasks] /api/tasks failed:', err);
      var host = document.querySelector('[data-v30-tasks-list]');
      if (host) host.innerHTML = '<div class="empty" style="padding:20px;font-size:12px;">Erreur de chargement.</div>';
    });
  }

  // Charge prospects + candidats pour peupler la modale et afficher les liens
  function loadPeopleForTasks() {
    fetchJSON('/api/data').then(function (res) {
      TASKS.prospects = ((res && res.prospects) || []).map(function (p) {
        return { id: p.id, name: p.name || '—' };
      });
      return fetchJSON('/api/candidates').then(function (cs) {
        var arr = Array.isArray(cs) ? cs : (cs && cs.candidates) || [];
        TASKS.candidates = arr.map(function (c) { return { id: c.id, name: c.name || '—' }; });
        renderTasks();
      }).catch(function () { TASKS.candidates = []; renderTasks(); });
    }).catch(function () { TASKS.prospects = []; TASKS.candidates = []; renderTasks(); });
  }

  function _getTaskModal() { return document.querySelector('[data-v30-pp-modal="task-edit"]'); }
  function _closeTaskModal() {
    var m = _getTaskModal();
    if (!m) return;
    m.classList.remove('is-open');
    setTimeout(function () { m.hidden = true; }, 160);
  }
  function _openTaskModal(task) {
    var m = _getTaskModal();
    if (!m) return;
    var titleEl = m.querySelector('[data-v30-task-title]');
    var commentEl = m.querySelector('[data-v30-task-comment]');
    var dueEl = m.querySelector('[data-v30-task-due]');
    var idEl = m.querySelector('[data-v30-task-id]');
    var pSel = m.querySelector('[data-v30-task-prospects]');
    var cSel = m.querySelector('[data-v30-task-candidates]');
    var pSearch = m.querySelector('[data-v30-task-prospects-search]');
    var cSearch = m.querySelector('[data-v30-task-candidates-search]');
    var titleLabel = m.querySelector('#v30-task-modal-title');

    if (titleLabel) titleLabel.textContent = task && task.id ? 'Modifier la tâche' : 'Nouvelle tâche';
    if (titleEl) titleEl.value = task ? (task.title || '') : '';
    if (commentEl) commentEl.value = task ? (task.comment || '') : '';
    if (dueEl) dueEl.value = task ? (task.due_date || '') : '';
    if (idEl) idEl.value = task && task.id ? String(task.id) : '';
    if (pSearch) pSearch.value = '';
    if (cSearch) cSearch.value = '';

    var linkedP = (task && task.linked_ids && task.linked_ids.prospects) || [];
    var linkedC = (task && task.linked_ids && task.linked_ids.candidates) || [];
    if (pSel) {
      pSel.innerHTML = TASKS.prospects.slice()
        .sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); })
        .map(function (p) {
          return '<option value="' + p.id + '"' + (linkedP.indexOf(p.id) >= 0 ? ' selected' : '') + '>' + esc(p.name) + '</option>';
        }).join('');
    }
    if (cSel) {
      cSel.innerHTML = TASKS.candidates.slice()
        .sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); })
        .map(function (c) {
          return '<option value="' + c.id + '"' + (linkedC.indexOf(c.id) >= 0 ? ' selected' : '') + '>' + esc(c.name) + '</option>';
        }).join('');
    }
    m.hidden = false; void m.offsetWidth; m.classList.add('is-open');
    if (titleEl) try { titleEl.focus(); } catch (_) {}
  }
  function _filterLinked(searchEl, selectEl) {
    if (!searchEl || !selectEl) return;
    var q = (searchEl.value || '').toLowerCase().trim();
    Array.prototype.forEach.call(selectEl.options, function (opt) {
      var txt = (opt.textContent || '').toLowerCase();
      opt.style.display = (!q || txt.indexOf(q) >= 0 || opt.selected) ? '' : 'none';
    });
  }
  function _saveTask() {
    var m = _getTaskModal();
    if (!m) return;
    var val = function (sel) { var el = m.querySelector(sel); return el ? el.value.trim() : ''; };
    var title = val('[data-v30-task-title]');
    if (!title) { toast('Le titre est obligatoire', 'warning'); return; }
    var comment = val('[data-v30-task-comment]');
    var due = val('[data-v30-task-due]');
    var idRaw = val('[data-v30-task-id]');
    var pSel = m.querySelector('[data-v30-task-prospects]');
    var cSel = m.querySelector('[data-v30-task-candidates]');
    var prospects = pSel ? Array.prototype.map.call(pSel.selectedOptions, function (o) { return Number(o.value); }) : [];
    var candidates = cSel ? Array.prototype.map.call(cSel.selectedOptions, function (o) { return Number(o.value); }) : [];
    var payload = {
      title: title, comment: comment,
      due_date: due || null,
      linked_ids: { prospects: prospects, candidates: candidates }
    };
    if (idRaw) payload.id = Number(idRaw);
    var saveBtn = m.querySelector('[data-v30-task-save]');
    if (saveBtn) saveBtn.disabled = true;
    postJSON('/api/tasks/save', payload)
      .then(function (res) {
        if (!res || !res.ok) throw new Error((res && res.error) || 'Erreur');
        toast(idRaw ? 'Tâche modifiée' : 'Tâche créée', 'success');
        _closeTaskModal();
        loadTasks();
      })
      .catch(function (e) { toast('Erreur : ' + e.message, 'error'); })
      .then(function () { if (saveBtn) saveBtn.disabled = false; });
  }

  function bindTasks() {
    var addBtn = document.querySelector('[data-v30-tasks-add]');
    var toggleDone = document.querySelector('[data-v30-tasks-toggle-done]');

    if (addBtn) addBtn.addEventListener('click', function () { _openTaskModal(null); });
    if (toggleDone) toggleDone.addEventListener('click', function () {
      TASKS.showDone = !TASKS.showDone;
      toggleDone.setAttribute('aria-pressed', TASKS.showDone ? 'true' : 'false');
      toggleDone.classList.toggle('active', TASKS.showDone);
      renderTasks();
    });

    // Delegate : done / delete / edit (clic sur le body de la ligne)
    var list = document.querySelector('[data-v30-tasks-list]');
    if (list) list.addEventListener('click', function (e) {
      var row = e.target.closest('.v30-task-row');
      if (!row) return;
      var tid = row.dataset.tid;
      var delBtn = e.target.closest('[data-v30-task-delete]');
      if (delBtn) {
        if (delBtn.dataset.armed === '1') {
          postJSON('/api/tasks/delete', { id: Number(tid) }).then(loadTasks);
          return;
        }
        delBtn.dataset.armed = '1';
        delBtn.textContent = '✓';
        delBtn.title = 'Cliquer à nouveau pour confirmer';
        setTimeout(function () {
          if (delBtn) { delBtn.dataset.armed = ''; delBtn.textContent = '×'; delBtn.title = 'Supprimer'; }
        }, 2500);
        return;
      }
      if (e.target.closest('[data-v30-task-done]')) return;  // change handler s'en charge
      if (e.target.closest('[data-v30-task-edit]')) {
        var t = TASKS.items.find(function (x) { return String(x.id) === String(tid); });
        if (t) _openTaskModal(t);
      }
    });
    if (list) list.addEventListener('change', function (e) {
      if (!e.target.matches('[data-v30-task-done]')) return;
      var row = e.target.closest('.v30-task-row');
      if (!row) return;
      postJSON('/api/tasks/done', { id: Number(row.dataset.tid), done: e.target.checked ? 1 : 0 })
        .then(loadTasks);
    });

    // Modal wiring : save + fermeture (clic backdrop / x / Escape)
    var m = _getTaskModal();
    if (!m) return;
    var saveBtn = m.querySelector('[data-v30-task-save]');
    if (saveBtn) saveBtn.addEventListener('click', _saveTask);
    m.addEventListener('click', function (e) {
      if (e.target === m) { _closeTaskModal(); return; }
      if (e.target.closest('[data-v30-modal-close]')) { _closeTaskModal(); }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && m && !m.hidden) _closeTaskModal();
    });
    // Filtres de recherche sur les multi-selects
    var pSearch = m.querySelector('[data-v30-task-prospects-search]');
    var pSel = m.querySelector('[data-v30-task-prospects]');
    if (pSearch && pSel) pSearch.addEventListener('input', function () { _filterLinked(pSearch, pSel); });
    var cSearch = m.querySelector('[data-v30-task-candidates-search]');
    var cSel = m.querySelector('[data-v30-task-candidates]');
    if (cSearch && cSel) cSearch.addEventListener('input', function () { _filterLinked(cSearch, cSel); });
  }

  // ─── Alerte export hebdo (jeudi+) ─────────────────────────
  // Affiche la bannière du jeudi au dimanche tant qu'elle n'a pas été dismissée cette semaine.
  function _weekKey() {
    var d = new Date();
    // ISO week: on prend lundi comme jour 1
    var day = d.getDay() === 0 ? 7 : d.getDay();
    var monday = new Date(d);
    monday.setDate(d.getDate() - (day - 1));
    return 'v30.focus.exportAlert.dismissed.' + monday.toISOString().slice(0, 10);
  }
  function bindExportAlert() {
    var el = document.querySelector('[data-v30-export-alert]');
    if (!el) return;
    var dow = new Date().getDay(); // 0=dim, 4=jeudi, 5=ven, 6=sam
    var shouldShow = (dow >= 4 || dow === 0);
    var dismissed = false;
    try { dismissed = localStorage.getItem(_weekKey()) === '1'; } catch (_) {}
    if (shouldShow && !dismissed) el.hidden = false;
    var dismiss = el.querySelector('[data-v30-export-dismiss]');
    if (dismiss) dismiss.addEventListener('click', function () {
      el.hidden = true;
      try { localStorage.setItem(_weekKey(), '1'); } catch (_) {}
    });
  }

  // ─── Bloc Relances filtrables (parité v29) ────────────────
  var RELANCES = { items: [], period: 'today' };
  function _relanceGroup(iso) {
    if (!iso) return 'later';
    var t = todayISO();
    var tomorrow = (function () { var d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })();
    var weekEnd = (function () { var d = new Date(); d.setDate(d.getDate() + (7 - (d.getDay() === 0 ? 7 : d.getDay()))); return d.toISOString().slice(0, 10); })();
    if (iso < t) return 'late';
    if (iso === t) return 'today';
    if (iso === tomorrow) return 'tomorrow';
    if (iso <= weekEnd) return 'week';
    return 'later';
  }
  function renderRelances() {
    var host = document.querySelector('[data-v30-focus-relances-list]');
    var sumEl = document.querySelector('[data-v30-focus-relances-summary]');
    if (!host) return;
    var period = RELANCES.period;
    var items = RELANCES.items.slice();
    var filtered = (period === 'all') ? items : items.filter(function (it) { return _relanceGroup(it.nextFollowUp) === period; });
    // Summary avec les compteurs par groupe
    if (sumEl) {
      var late = items.filter(function (x) { return _relanceGroup(x.nextFollowUp) === 'late'; }).length;
      var today = items.filter(function (x) { return _relanceGroup(x.nextFollowUp) === 'today'; }).length;
      sumEl.textContent = items.length + ' total · ' + late + ' en retard · ' + today + ' aujourd\'hui';
    }
    if (filtered.length === 0) {
      host.innerHTML = '<div class="empty" style="padding:20px;font-size:12px;">Aucune relance pour ce filtre.</div>';
      return;
    }
    host.innerHTML = filtered.map(function (p) {
      var meta = (p.company_groupe ? p.company_groupe + ' · ' : '') + 'Relance ' + (p.nextFollowUp || '—');
      return row(p, meta);
    }).join('');
  }
  function loadRelances() {
    return fetchJSON('/api/focus_queue').then(function (res) {
      RELANCES.items = (res && res.items) || [];
      renderRelances();
    }).catch(function (err) {
      console.error('[v30 focus relances] /api/focus_queue failed:', err);
      var host = document.querySelector('[data-v30-focus-relances-list]');
      if (host) host.innerHTML = '<div class="empty" style="padding:20px;font-size:12px;">Erreur de chargement.</div>';
    });
  }
  function bindRelancesFilter() {
    var sel = document.querySelector('[data-v30-focus-relances-period]');
    if (!sel) return;
    RELANCES.period = sel.value || 'today';
    sel.addEventListener('change', function () {
      RELANCES.period = sel.value || 'today';
      renderRelances();
    });
  }

  function load() {
    return fetchJSON('/api/dashboard').then(function (res) {
      var d = (res && res.data) || {};
      var sub = document.querySelector('[data-v30-focus] [data-field="subtitle"]');
      if (sub) {
        var overdue = (d.pipeline && d.pipeline.overdue) || 0;
        var rdvToday = (d.today_appointments || []).length;
        sub.innerHTML = 'Tu as <b style="color:var(--text);">' + overdue + ' relance' +
          (overdue > 1 ? 's' : '') + '</b> en retard et <b style="color:var(--text);">' +
          rdvToday + ' RDV</b> aujourd\'hui.';
      }
      var dateEl = document.querySelector('[data-field="date"]');
      if (dateEl) dateEl.textContent = fmtDateFR();

      // Overdue
      var overdueList = (d.overdue_list || []).map(function (p) {
        return row(p, 'Retard depuis ' + (p.nextFollowUp || '—'));
      });
      renderCol('overdue', overdueList, 'Pas de relance en retard.');

      // Today (today_appointments = RDV dont rdvDate = aujourd'hui)
      var todayList = (d.today_appointments || []).map(function (r) {
        var p = { id: r.prospect_id, name: r.prospect_name, statut: 'Rendez-vous' };
        return row(p, (r.company_name ? r.company_name + ' · ' : '') + (r.rdvDate || ''));
      });
      renderCol('today', todayList, 'Aucun RDV aujourd\'hui.');

      // Upcoming
      var upcomingList = (d.upcoming_rdv || []).map(function (p) {
        return row(p, 'RDV ' + (p.rdvDate || '—'));
      });
      renderCol('upcoming', upcomingList, 'Aucun RDV à venir.');
    }).catch(function (err) {
      console.error('[v30 focus] /api/dashboard failed:', err);
    });
  }

  function init() {
    bindExportAlert();
    bindTasks();
    loadTasks();
    loadPeopleForTasks();
    bindFocusRowActions();
    bindRelancesFilter();
    loadRelances();
    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
