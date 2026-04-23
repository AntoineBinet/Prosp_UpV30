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
  function statusClass(statut) {
    var m = { 'Rendez-vous': 'status-meeting', 'Contacté': 'status-contact',
              'À rappeler': 'status-proposal', 'Proposition': 'status-proposal',
              'Gagné': 'status-won', 'Perdu': 'status-lost' };
    return m[statut] || 'status-new';
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

  // ─── Bloc Tâches (parite v29 : CRUD manuel) ───────────────
  var TASKS = { showDone: false, items: [] };

  function postJSON(url, body) {
    return fetch(url, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
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
      var due = t.due_date ? new Date(t.due_date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '';
      return '<div class="v30-task-row' + (done ? ' is-done' : '') + '" data-tid="' + t.id + '">' +
        '<input type="checkbox" ' + (done ? 'checked' : '') + ' data-v30-task-done aria-label="Marquer comme fait">' +
        '<span class="v30-task-row__title">' + esc(t.title || '') + '</span>' +
        (due ? '<span class="v30-task-row__due muted mono">' + esc(due) + '</span>' : '<span></span>') +
        '<button type="button" class="btn btn-ghost btn-sm btn-icon" data-v30-task-delete ' +
          'aria-label="Supprimer" title="Supprimer">×</button>' +
      '</div>';
    }).join('');
  }

  function loadTasks() {
    fetchJSON('/api/tasks?status=all').then(function (res) {
      TASKS.items = (res && res.tasks) || [];
      renderTasks();
    }).catch(function (err) {
      console.error('[v30 focus tasks] /api/tasks failed:', err);
      var host = document.querySelector('[data-v30-tasks-list]');
      if (host) host.innerHTML = '<div class="empty" style="padding:20px;font-size:12px;">Erreur de chargement.</div>';
    });
  }

  function bindTasks() {
    var form = document.querySelector('[data-v30-tasks-form]');
    var titleInput = document.querySelector('[data-v30-tasks-title]');
    var dueInput = document.querySelector('[data-v30-tasks-due]');
    var addBtn = document.querySelector('[data-v30-tasks-add]');
    var cancelBtn = document.querySelector('[data-v30-tasks-cancel]');
    var toggleDone = document.querySelector('[data-v30-tasks-toggle-done]');

    if (addBtn) addBtn.addEventListener('click', function () {
      form.hidden = false;
      titleInput.value = ''; dueInput.value = '';
      titleInput.focus();
    });
    if (cancelBtn) cancelBtn.addEventListener('click', function () { form.hidden = true; });
    if (form) form.addEventListener('submit', function (e) {
      e.preventDefault();
      var title = titleInput.value.trim();
      if (!title) return;
      postJSON('/api/tasks/save', { title: title, due_date: dueInput.value || null })
        .then(function () { form.hidden = true; loadTasks(); });
    });
    if (toggleDone) toggleDone.addEventListener('click', function () {
      TASKS.showDone = !TASKS.showDone;
      toggleDone.setAttribute('aria-pressed', TASKS.showDone ? 'true' : 'false');
      toggleDone.classList.toggle('active', TASKS.showDone);
      renderTasks();
    });

    // Delegate done + delete
    var list = document.querySelector('[data-v30-tasks-list]');
    if (list) list.addEventListener('click', function (e) {
      var row = e.target.closest('.v30-task-row');
      if (!row) return;
      var tid = row.dataset.tid;
      if (e.target.matches('[data-v30-task-delete]')) {
        // Double-clic pour confirmer la suppression (evite confirm() bloquant)
        if (e.target.dataset.armed === '1') {
          postJSON('/api/tasks/delete', { id: Number(tid) }).then(loadTasks);
          return;
        }
        e.target.dataset.armed = '1';
        e.target.textContent = '✓';
        e.target.title = 'Cliquer à nouveau pour confirmer';
        setTimeout(function () {
          if (e.target) { e.target.dataset.armed = ''; e.target.textContent = '×'; e.target.title = 'Supprimer'; }
        }, 2500);
      }
    });
    if (list) list.addEventListener('change', function (e) {
      if (!e.target.matches('[data-v30-task-done]')) return;
      var row = e.target.closest('.v30-task-row');
      if (!row) return;
      postJSON('/api/tasks/done', { id: Number(row.dataset.tid), done: e.target.checked ? 1 : 0 })
        .then(loadTasks);
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
    bindTasks();
    loadTasks();
    bindFocusRowActions();
    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
