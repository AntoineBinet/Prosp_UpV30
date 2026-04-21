/* ProspUp v30 — Calendrier : grille mois avec events */
(function () {
  'use strict';

  var STATE = { cursor: new Date(), events: {} };

  function esc(s) {
    var t = document.createElement('span');
    t.textContent = s == null ? '' : String(s);
    return t.innerHTML;
  }
  function fetchJSON(url) {
    return fetch(url, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function isoDate(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function fmtMonth(d) {
    var mois = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
    return mois[d.getMonth()] + ' ' + d.getFullYear();
  }

  // ─── Fetch & indexation par jour ─────────────────────────
  function loadEvents() {
    return fetchJSON('/api/calendar_events').then(function (res) {
      STATE.events = {};
      var prospects = (res && res.prospects) || [];
      prospects.forEach(function (p) {
        if (p.rdvDate) push(p.rdvDate.slice(0, 10), {
          type: 'rdv',
          label: p.name + (p.company_groupe ? ' · ' + p.company_groupe : ''),
          href: '/v30/prospect/' + p.id
        });
        if (p.nextFollowUp) push(p.nextFollowUp.slice(0, 10), {
          type: 'relance',
          label: 'Relancer ' + p.name,
          href: '/v30/prospect/' + p.id
        });
      });
      var ec1s = (res && res.ec1) || (res && res.candidate_tabs) || [];
      ec1s.forEach(function (e) {
        var d = (e.date || e.scheduled_at || '').slice(0, 10);
        if (!d) return;
        push(d, {
          type: 'ec1',
          label: 'EC1 · ' + (e.candidate_name || e.name || '—'),
          href: '/v30/candidat/' + (e.candidate_id || '')
        });
      });
    }).catch(function (err) {
      console.error('[v30 calendar] /api/calendar_events failed:', err);
    });
  }
  function push(iso, ev) {
    if (!STATE.events[iso]) STATE.events[iso] = [];
    STATE.events[iso].push(ev);
  }

  // ─── Rendu grille ────────────────────────────────────────
  function renderGrid() {
    var monthEl = document.querySelector('[data-v30-cal-month]');
    if (monthEl) monthEl.textContent = fmtMonth(STATE.cursor);

    var grid = document.querySelector('[data-v30-cal-grid]');
    if (!grid) return;

    var year = STATE.cursor.getFullYear();
    var month = STATE.cursor.getMonth();
    var first = new Date(year, month, 1);
    // Lundi = 1, Dimanche = 0 → on veut décaler pour commencer au lundi
    var shift = (first.getDay() + 6) % 7;
    first.setDate(first.getDate() - shift);

    var todayISO = isoDate(new Date());
    var cells = [];
    for (var i = 0; i < 42; i++) {
      var d = new Date(first.getTime());
      d.setDate(first.getDate() + i);
      var iso = isoDate(d);
      var isOther = d.getMonth() !== month;
      var isToday = iso === todayISO;
      var events = STATE.events[iso] || [];
      var evHtml = events.slice(0, 3).map(function (ev) {
        return '<a class="v30-cal__ev is-' + ev.type + '" href="' + esc(ev.href || '#') +
               '" title="' + esc(ev.label) + '">' + esc(ev.label) + '</a>';
      }).join('');
      var more = events.length > 3 ? '<span class="v30-cal__more">+' + (events.length - 3) + ' autres</span>' : '';
      cells.push(
        '<div class="v30-cal__cell' +
          (isOther ? ' is-other-month' : '') +
          (isToday ? ' is-today' : '') +
          '">' +
          '<span class="v30-cal__num">' + d.getDate() + '</span>' +
          evHtml + more +
        '</div>'
      );
    }
    grid.innerHTML = cells.join('');
  }

  function bind() {
    var prev = document.querySelector('[data-v30-cal-prev]');
    if (prev) prev.addEventListener('click', function () {
      STATE.cursor = new Date(STATE.cursor.getFullYear(), STATE.cursor.getMonth() - 1, 1);
      renderGrid();
    });
    var next = document.querySelector('[data-v30-cal-next]');
    if (next) next.addEventListener('click', function () {
      STATE.cursor = new Date(STATE.cursor.getFullYear(), STATE.cursor.getMonth() + 1, 1);
      renderGrid();
    });
    var today = document.querySelector('[data-v30-cal-today]');
    if (today) today.addEventListener('click', function () {
      STATE.cursor = new Date();
      renderGrid();
    });
  }

  function init() {
    bind();
    renderGrid();
    loadEvents().then(renderGrid);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
