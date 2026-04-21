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
    return '<a class="v30-ac__row" href="/v30/prospect/' + p.id + '">' +
      '<span class="avatar">' + esc(initials(p.name)) + '</span>' +
      '<div style="min-width:0;">' +
        '<div class="v30-ac__name truncate">' + esc(p.name || '—') + '</div>' +
        '<div class="v30-ac__sub truncate">' + esc(meta || '') + '</div>' +
      '</div>' +
      (p.statut ? '<span class="status ' + statusClass(p.statut) + '">' + esc(p.statut) + '</span>' : '<span></span>') +
      '<span></span>' +
    '</a>';
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

  function init() {
    bindTasks();
    loadTasks();
    fetchJSON('/api/dashboard').then(function (res) {
      var d = (res && res.data) || {};
      var sub = document.querySelector('[data-v30-focus] [data-field="subtitle"]');
      if (sub) {
        var overdue = (d.pipeline && d.pipeline.overdue) || 0;
        var today = (d.pipeline && d.pipeline.due_today) || 0;
        sub.innerHTML = 'Tu as <b style="color:var(--text);">' + overdue + ' relance' +
          (overdue > 1 ? 's' : '') + '</b> en retard et <b style="color:var(--text);">' +
          today + ' RDV</b> aujourd\'hui.';
      }
      var dateEl = document.querySelector('[data-field="date"]');
      if (dateEl) dateEl.textContent = fmtDateFR();

      // Overdue
      var overdueList = (d.overdue_list || []).map(function (p) {
        return row(p, 'Retard depuis ' + (p.nextFollowUp || '—'));
      });
      renderCol('overdue', overdueList, 'Pas de relance en retard.');

      // Today (feed.rdv = RDV d'aujourd'hui)
      var todayList = ((d.feed && d.feed.rdv) || []).map(function (r) {
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
