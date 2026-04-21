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

  function init() {
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
