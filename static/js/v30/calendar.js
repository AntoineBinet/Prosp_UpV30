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
  // /api/calendar_events renvoie { events: [{ date, time, name, company,
  // statut, type: rdv|relance|ec1, id, url? }], ok: true }.
  function loadEvents() {
    return fetchJSON('/api/calendar_events').then(function (res) {
      STATE.events = {};
      var events = (res && res.events) || [];
      events.forEach(function (e) {
        var iso = (e.date || '').slice(0, 10);
        if (!iso) return;
        var t = e.type || 'rdv';
        var timePrefix = e.time ? e.time + ' · ' : '';
        var label, href;
        if (t === 'ec1') {
          label = 'EC1 · ' + (e.name || '—');
          href = e.url || ('/v30/candidat/' + (e.id || ''));
        } else if (t === 'relance') {
          label = 'Relancer ' + (e.name || '—')
            + (e.company ? ' · ' + e.company : '');
          href = e.url || ('/v30/prospect/' + (e.id || ''));
        } else {
          label = timePrefix + (e.name || '—')
            + (e.company ? ' · ' + e.company : '');
          href = e.url || ('/v30/prospect/' + (e.id || ''));
        }
        push(iso, { type: t, label: label, href: href });
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
      var more = events.length > 3
        ? '<button type="button" class="v30-cal__more" data-v30-cal-more="' + iso + '">+' + (events.length - 3) + ' autres</button>'
        : '';
      cells.push(
        '<div class="v30-cal__cell' +
          (isOther ? ' is-other-month' : '') +
          (isToday ? ' is-today' : '') +
          '" data-iso="' + iso + '">' +
          '<span class="v30-cal__num">' + d.getDate() + '</span>' +
          evHtml + more +
        '</div>'
      );
    }
    grid.innerHTML = cells.join('');
  }

  function openDayPopup(iso, anchor) {
    closeDayPopup();
    var events = STATE.events[iso] || [];
    if (!events.length) return;
    var pop = document.createElement('div');
    pop.className = 'v30-cal__popup';
    pop.setAttribute('role', 'dialog');
    pop.innerHTML = '<div class="v30-cal__popup-head">' +
      '<strong>' + esc(new Date(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long' })) + '</strong>' +
      '<button type="button" class="btn btn-ghost btn-sm btn-icon" data-v30-cal-popup-close aria-label="Fermer">×</button>' +
      '</div>' +
      '<div class="v30-cal__popup-body">' +
      events.map(function (ev) {
        return '<a class="v30-cal__ev is-' + ev.type + '" href="' + esc(ev.href || '#') + '">' + esc(ev.label) + '</a>';
      }).join('') +
      '</div>';
    document.body.appendChild(pop);
    var r = anchor.getBoundingClientRect();
    pop.style.position = 'fixed';
    pop.style.zIndex = '90';
    pop.style.top = Math.min(window.innerHeight - 260, r.bottom + 4) + 'px';
    pop.style.left = Math.max(8, Math.min(window.innerWidth - 320, r.left)) + 'px';
    pop.addEventListener('click', function (e) {
      if (e.target.closest('[data-v30-cal-popup-close]')) closeDayPopup();
    });
    document.addEventListener('click', outsideClose, true);
    document.addEventListener('keydown', escClose);
  }
  function closeDayPopup() {
    var pop = document.querySelector('.v30-cal__popup');
    if (pop) pop.remove();
    document.removeEventListener('click', outsideClose, true);
    document.removeEventListener('keydown', escClose);
  }
  function outsideClose(e) {
    if (e.target.closest('.v30-cal__popup') || e.target.closest('[data-v30-cal-more]')) return;
    closeDayPopup();
  }
  function escClose(e) { if (e.key === 'Escape') closeDayPopup(); }

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
    document.addEventListener('click', function (e) {
      var more = e.target.closest('[data-v30-cal-more]');
      if (more) {
        e.preventDefault();
        e.stopPropagation();
        openDayPopup(more.dataset.v30CalMore, more);
      }
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
