/* ProspUp v30 — Calendrier : grille mois avec events internes + ICS externe */
(function () {
  'use strict';

  var STATE = { cursor: new Date(), events: {}, extStatus: { count: 0, error: null } };

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
  function push(iso, ev) {
    if (!STATE.events[iso]) STATE.events[iso] = [];
    STATE.events[iso].push(ev);
  }

  // ─── Fetch events internes ───────────────────────────────────
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
          label = 'Relancer ' + (e.name || '—') + (e.company ? ' · ' + e.company : '');
          href = e.url || ('/v30/prospect/' + (e.id || ''));
        } else {
          label = timePrefix + (e.name || '—') + (e.company ? ' · ' + e.company : '');
          href = e.url || ('/v30/prospect/' + (e.id || ''));
        }
        push(iso, { type: t, label: label, href: href });
      });
    }).catch(function (err) {
      console.error('[v30 calendar] /api/calendar_events failed:', err);
    });
  }

  // ─── Fetch events ICS externe (Outlook / Google) ─────────────
  function loadExternalEvents() {
    return fetchJSON('/api/settings').then(function (res) {
      var url = res && res.settings && res.settings.calendar_external_ics_url;
      if (!url || !url.trim()) {
        STATE.extStatus = { count: 0, error: null };
        return;
      }
      return fetchJSON('/api/calendar_events_external?url=' + encodeURIComponent(url.trim()))
        .then(function (data) {
          if (!data || !data.ok) {
            STATE.extStatus = { count: 0, error: (data && data.error) || 'Erreur' };
            return;
          }
          var evts = data.events || [];
          evts.forEach(function (e) {
            var iso = (e.date || '').slice(0, 10);
            if (!iso) return;
            var timePrefix = e.time ? e.time + ' · ' : '';
            push(iso, { type: 'external', label: timePrefix + (e.name || '—'), href: '' });
          });
          STATE.extStatus = { count: evts.length, error: null };
        })
        .catch(function (err) {
          STATE.extStatus = { count: 0, error: err.message || 'Erreur réseau' };
        });
    }).catch(function () {
      STATE.extStatus = { count: 0, error: null };
    });
  }

  function loadAll() {
    return Promise.all([loadEvents(), loadExternalEvents()]);
  }

  // ─── Badge statut externe ────────────────────────────────────
  function updateExtBadge() {
    var badge = document.querySelector('[data-v30-cal-ext-status]');
    if (!badge) return;
    var s = STATE.extStatus;
    if (s.error) {
      badge.hidden = false;
      badge.className = 'v30-cal-ext-badge is-error';
      badge.textContent = 'Calendrier externe : erreur de sync';
      badge.title = s.error;
    } else if (s.count > 0) {
      badge.hidden = false;
      badge.className = 'v30-cal-ext-badge is-ok';
      badge.textContent = 'Outlook · ' + s.count + ' événement' + (s.count > 1 ? 's' : '');
      badge.title = '';
    } else {
      badge.hidden = true;
    }
  }

  // ─── Rendu grille ────────────────────────────────────────────
  function renderGrid() {
    var monthEl = document.querySelector('[data-v30-cal-month]');
    if (monthEl) monthEl.textContent = fmtMonth(STATE.cursor);

    var grid = document.querySelector('[data-v30-cal-grid]');
    if (!grid) return;

    var year = STATE.cursor.getFullYear();
    var month = STATE.cursor.getMonth();
    var first = new Date(year, month, 1);
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
      var evHtml = events.slice(0, 3).map(function (ev, evIdx) {
        return '<button type="button" class="v30-cal__ev is-' + ev.type +
               '" data-v30-cal-ev="' + iso + ':' + evIdx + '"' +
               ' title="' + esc(ev.label) + '">' + esc(ev.label) + '</button>';
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

  // ─── Popups ──────────────────────────────────────────────────
  function positionPopup(pop, anchor) {
    var r = anchor.getBoundingClientRect();
    pop.style.position = 'fixed';
    pop.style.zIndex = '90';
    pop.style.top = Math.min(window.innerHeight - 260, r.bottom + 4) + 'px';
    pop.style.left = Math.max(8, Math.min(window.innerWidth - 320, r.left)) + 'px';
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
        if (ev.href) {
          return '<a class="v30-cal__ev is-' + ev.type + '" href="' + esc(ev.href) + '">' + esc(ev.label) + '</a>';
        }
        return '<span class="v30-cal__ev is-' + ev.type + '">' + esc(ev.label) + '</span>';
      }).join('') +
      '</div>';
    document.body.appendChild(pop);
    positionPopup(pop, anchor);
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

  function openEventPopup(iso, idx, anchor) {
    closeDayPopup();
    var events = STATE.events[iso] || [];
    var ev = events[idx];
    if (!ev) return;
    var pop = document.createElement('div');
    pop.className = 'v30-cal__popup v30-cal__popup--ev';
    pop.setAttribute('role', 'dialog');
    var TYPE_LABELS = { ec1: 'EC1 candidat', relance: 'Relance à faire', external: 'Calendrier externe' };
    var typeLabel = TYPE_LABELS[ev.type] || 'Rendez-vous';
    var body = '<div class="v30-cal__popup-head">' +
      '<strong>' + esc(new Date(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long' })) + '</strong>' +
      '<button type="button" class="btn btn-ghost btn-sm btn-icon" data-v30-cal-popup-close aria-label="Fermer">×</button>' +
      '</div>' +
      '<div class="v30-cal__popup-body">' +
        '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3);margin-bottom:4px;">' + esc(typeLabel) + '</div>' +
        '<div style="font-size:13px;color:var(--text);margin-bottom:8px;word-break:break-word;">' + esc(ev.label) + '</div>';
    if (ev.href) {
      body += '<a class="btn btn-sm btn-accent" href="' + esc(ev.href) + '" style="display:inline-flex;align-items:center;gap:6px;">Voir la fiche →</a>';
    }
    body += '</div>';
    pop.innerHTML = body;
    document.body.appendChild(pop);
    positionPopup(pop, anchor);
    pop.addEventListener('click', function (e) {
      if (e.target.closest('[data-v30-cal-popup-close]')) closeDayPopup();
    });
    document.addEventListener('click', outsideClose, true);
    document.addEventListener('keydown', escClose);
  }

  // ─── Bind ────────────────────────────────────────────────────
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

    var refresh = document.querySelector('[data-v30-cal-refresh]');
    if (refresh) refresh.addEventListener('click', function () {
      if (refresh.disabled) return;
      refresh.disabled = true;
      refresh.classList.add('is-loading');
      loadAll().then(function () {
        renderGrid();
        updateExtBadge();
        refresh.disabled = false;
        refresh.classList.remove('is-loading');
      });
    });

    document.addEventListener('click', function (e) {
      var more = e.target.closest('[data-v30-cal-more]');
      if (more) {
        e.preventDefault();
        e.stopPropagation();
        openDayPopup(more.dataset.v30CalMore, more);
        return;
      }
      var evBtn = e.target.closest('[data-v30-cal-ev]');
      if (evBtn) {
        e.preventDefault();
        e.stopPropagation();
        var parts = evBtn.dataset.v30CalEv.split(':');
        var iso = parts[0];
        var idx = parseInt(parts[1], 10) || 0;
        openEventPopup(iso, idx, evBtn);
      }
    });
  }

  function init() {
    bind();
    renderGrid();
    loadAll().then(function () {
      renderGrid();
      updateExtBadge();
    });
    setInterval(function () {
      loadAll().then(function () {
        renderGrid();
        updateExtBadge();
      });
    }, 3600000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
