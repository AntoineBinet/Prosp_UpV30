/* ProspUp v30 — Calendrier : vues Mois / Semaine / Jour + ICS externe */
(function () {
  'use strict';

  var SLOT_H     = 80;   // px par heure
  var HOUR_START = 7;
  var HOUR_END   = 21;
  var TOTAL_H    = (HOUR_END - HOUR_START) * SLOT_H; // 1120px

  var STATE = {
    cursor: new Date(),
    events: {},       // { 'YYYY-MM-DD': [{ type, label, href, time, duration, teams_url }] }
    extStatus: { count: 0, error: null },
    view: 'month',    // 'month' | 'week' | 'day'
  };

  // ─── Utils ───────────────────────────────────────────────────────
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
    var M = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
    return M[d.getMonth()] + ' ' + d.getFullYear();
  }
  function fmtWeekRange(mon) {
    var sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    var M = ['jan.','fév.','mar.','avr.','mai','jun.','jul.','aoû.','sep.','oct.','nov.','déc.'];
    if (mon.getMonth() === sun.getMonth())
      return mon.getDate() + ' – ' + sun.getDate() + ' ' + M[mon.getMonth()] + ' ' + mon.getFullYear();
    return mon.getDate() + ' ' + M[mon.getMonth()] + ' – ' + sun.getDate() + ' ' + M[sun.getMonth()] + ' ' + sun.getFullYear();
  }
  function fmtDay(d) {
    var J = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
    var M = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
    return J[d.getDay()] + ' ' + d.getDate() + ' ' + M[d.getMonth()] + ' ' + d.getFullYear();
  }
  function getMondayOf(d) {
    var diff = (d.getDay() + 6) % 7;
    var m = new Date(d); m.setDate(d.getDate() - diff); m.setHours(0, 0, 0, 0);
    return m;
  }
  function timeToMin(t) {
    if (!t) return -1;
    var p = t.split(':');
    return parseInt(p[0], 10) * 60 + (parseInt(p[1], 10) || 0);
  }
  function push(iso, ev) {
    if (!STATE.events[iso]) STATE.events[iso] = [];
    STATE.events[iso].push(ev);
  }

  // Collision detection : place les events côte à côte quand ils se chevauchent
  function computeLayout(items) {
    var sorted = items.slice().sort(function (a, b) {
      return timeToMin(a.ev.time) - timeToMin(b.ev.time);
    });
    var colEnds = [];
    sorted.forEach(function (it) {
      var s = timeToMin(it.ev.time), e = s + (it.ev.duration || 60);
      var col = -1;
      for (var i = 0; i < colEnds.length; i++) {
        if (colEnds[i] <= s) { col = i; colEnds[i] = e; break; }
      }
      if (col < 0) { col = colEnds.length; colEnds.push(e); }
      it._ci = col;
    });
    sorted.forEach(function (it) {
      var s = timeToMin(it.ev.time), e = s + (it.ev.duration || 60);
      it._cn = 1;
      sorted.forEach(function (o) {
        var os = timeToMin(o.ev.time), oe = os + (o.ev.duration || 60);
        if (os < e && oe > s) it._cn = Math.max(it._cn, o._ci + 1);
      });
    });
    return sorted;
  }

  // ─── Chargement events internes ──────────────────────────────────
  function loadEvents() {
    return fetchJSON('/api/calendar_events').then(function (res) {
      STATE.events = {};
      (res && res.events || []).forEach(function (e) {
        var iso = (e.date || '').slice(0, 10);
        if (!iso) return;
        var t = e.type || 'rdv';
        var time = e.time || '';
        var tp = time ? time + ' · ' : '';
        var label, href, duration;
        if (t === 'ec1') {
          label = 'EC1 · ' + (e.name || '—');
          href  = e.url || '/v30/candidat/' + (e.id || '');
          duration = 60;
        } else if (t === 'ec2') {
          label = 'EC2 · ' + (e.name || '—');
          href  = e.url || '/v30/candidat/' + (e.id || '');
          duration = 0;
        } else if (t === 'relance') {
          label = 'Relancer ' + (e.name || '—') + (e.company ? ' · ' + e.company : '');
          href  = e.url || '/v30/prospect/' + (e.id || '');
          duration = time ? 30 : 0;
        } else {
          label = tp + (e.name || '—') + (e.company ? ' · ' + e.company : '');
          href  = e.url || '/v30/prospect/' + (e.id || '');
          duration = 60;
        }
        push(iso, { type: t, label: label, href: href, time: time, duration: duration, teams_url: '' });
      });
    }).catch(function (err) { console.error('[v30 calendar] events failed:', err); });
  }

  // ─── Chargement ICS externe ───────────────────────────────────────
  function loadExternalEvents() {
    return fetchJSON('/api/settings').then(function (res) {
      var url = res && res.settings && res.settings.calendar_external_ics_url;
      if (!url || !url.trim()) { STATE.extStatus = { count: 0, error: null }; return; }
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
            var time = e.time || '';
            var tp = time ? time + ' · ' : '';
            var dur = typeof e.duration === 'number' ? e.duration : (time ? 60 : 0);
            push(iso, { type: 'external', label: tp + (e.name || '—'),
              href: e.url || '', time: time, duration: dur, teams_url: e.teams_url || '' });
          });
          STATE.extStatus = { count: evts.length, error: null };
        })
        .catch(function (err) { STATE.extStatus = { count: 0, error: err.message || 'Erreur réseau' }; });
    }).catch(function () { STATE.extStatus = { count: 0, error: null }; });
  }

  function loadAll() { return Promise.all([loadEvents(), loadExternalEvents()]); }

  // ─── Badge externe ────────────────────────────────────────────────
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

  // ─── Vue mois ─────────────────────────────────────────────────────
  function renderMonth() {
    updateTitle(fmtMonth(STATE.cursor));
    var body = document.querySelector('[data-v30-cal-body]');
    if (!body) return;

    var year  = STATE.cursor.getFullYear();
    var month = STATE.cursor.getMonth();
    var first = new Date(year, month, 1);
    first.setDate(first.getDate() - (first.getDay() + 6) % 7);

    var todayISO = isoDate(new Date());
    var cells = [];
    var JOURS = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
    var head = JOURS.map(function (j) {
      return '<div class="v30-cal__head-cell">' + j + '</div>';
    }).join('');

    for (var i = 0; i < 42; i++) {
      var d = new Date(first); d.setDate(first.getDate() + i);
      var iso     = isoDate(d);
      var isOther = d.getMonth() !== month;
      var isToday = iso === todayISO;
      var evs = STATE.events[iso] || [];
      var evHtml = evs.slice(0, 3).map(function (ev, idx) {
        return '<button type="button" class="v30-cal__ev is-' + ev.type +
          '" data-v30-cal-ev="' + iso + ':' + idx + '" title="' + esc(ev.label) + '">' +
          esc(ev.label) + '</button>';
      }).join('');
      var more = evs.length > 3
        ? '<button type="button" class="v30-cal__more" data-v30-cal-more="' + iso + '">+' + (evs.length - 3) + ' autres</button>'
        : '';
      cells.push('<div class="v30-cal__cell' + (isOther ? ' is-other-month' : '') +
        (isToday ? ' is-today' : '') + '" data-iso="' + iso + '">' +
        '<span class="v30-cal__num">' + d.getDate() + '</span>' + evHtml + more + '</div>');
    }

    body.innerHTML = '<div class="v30-cal">' +
      '<div class="v30-cal__head">' + head + '</div>' +
      '<div class="v30-cal__grid">' + cells.join('') + '</div>' +
      '</div>';
  }

  // ─── Vue semaine / jour ───────────────────────────────────────────
  function renderWeekOrDay(singleDay) {
    var monday = getMondayOf(STATE.cursor);
    var days = [];
    if (singleDay) {
      days = [new Date(STATE.cursor)];
    } else {
      for (var i = 0; i < 7; i++) {
        var d0 = new Date(monday); d0.setDate(monday.getDate() + i);
        days.push(d0);
      }
    }

    updateTitle(singleDay ? fmtDay(STATE.cursor) : fmtWeekRange(monday));

    var body = document.querySelector('[data-v30-cal-body]');
    if (!body) return;

    var todayISO = isoDate(new Date());
    var JOURS = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];

    // ── En-tête jours ────────────────────────────────────────────
    var headCells = days.map(function (d) {
      var iso = isoDate(d);
      var isT = iso === todayISO;
      return '<div class="v30-cal-wk__head-cell' + (isT ? ' is-today' : '') + '">' +
        '<span class="v30-cal-wk__dname">' + JOURS[d.getDay()] + '</span>' +
        '<span class="v30-cal-wk__dnum' + (isT ? ' is-today' : '') + '">' + d.getDate() + '</span>' +
        '</div>';
    }).join('');

    // ── Rangée "toute la journée" ─────────────────────────────────
    var hasAllDay = false;
    var allDayCols = days.map(function (d) {
      var iso = isoDate(d);
      var evs = (STATE.events[iso] || []).filter(function (ev) { return !ev.time || ev.duration === 0; });
      if (evs.length) hasAllDay = true;
      var html = (STATE.events[iso] || []).reduce(function (acc, ev, idx) {
        if (!ev.time || ev.duration === 0)
          acc += '<button type="button" class="v30-cal__ev is-' + ev.type +
            '" data-v30-cal-ev="' + iso + ':' + idx + '" title="' + esc(ev.label) + '">' +
            esc(ev.label) + '</button>';
        return acc;
      }, '');
      return '<div class="v30-cal-wk__allday-col">' + html + '</div>';
    }).join('');

    var allDayRow = hasAllDay
      ? '<div class="v30-cal-wk__allday"><div class="v30-cal-wk__tc v30-cal-wk__allday-lbl">Journée</div>' + allDayCols + '</div>'
      : '';

    // ── Labels heures (colonne de gauche) ─────────────────────────
    var hourLabels = '';
    for (var h = HOUR_START; h < HOUR_END; h++) {
      hourLabels += '<div class="v30-cal-wk__hlbl" style="top:' + ((h - HOUR_START) * SLOT_H) + 'px;">' +
        String(h).padStart(2, '0') + ':00</div>';
    }

    // ── Colonnes jours avec events positionnés ─────────────────────
    var now = new Date();
    var nowMin = now.getHours() * 60 + now.getMinutes();

    var dayCols = days.map(function (d) {
      var iso = isoDate(d);
      var isT = iso === todayISO;

      // Lignes d'heures
      var hlines = '';
      for (var h2 = HOUR_START; h2 < HOUR_END; h2++) {
        hlines += '<div class="v30-cal-wk__hline" style="top:' + ((h2 - HOUR_START) * SLOT_H) + 'px;"></div>';
        if (h2 < HOUR_END - 1) {
          hlines += '<div class="v30-cal-wk__hline is-half" style="top:' + ((h2 - HOUR_START) * SLOT_H + SLOT_H / 2) + 'px;"></div>';
        }
      }

      // Events timés avec gestion des collisions
      var timedItems = (STATE.events[iso] || []).reduce(function (acc, ev, idx) {
        if (ev.time && ev.duration !== 0) acc.push({ ev: ev, idx: idx });
        return acc;
      }, []);
      var laidOut = computeLayout(timedItems);
      var evHtml = laidOut.reduce(function (acc, item) {
        var ev = item.ev, idx = item.idx;
        var startMin = timeToMin(ev.time);
        if (startMin < HOUR_START * 60 || startMin >= HOUR_END * 60) return acc;
        var top    = (startMin - HOUR_START * 60) / 60 * SLOT_H;
        var height = Math.max(24, ev.duration / 60 * SLOT_H - 2);
        var pct    = 100 / item._cn;
        var lPct   = item._ci * pct;
        var style  = 'top:' + top + 'px;height:' + height + 'px;' +
          'left:calc(' + lPct.toFixed(1) + '% + 2px);width:calc(' + pct.toFixed(1) + '% - 4px);';
        // Titre sans le préfixe heure
        var title = (ev.time && ev.label.indexOf(ev.time + ' · ') === 0)
          ? ev.label.slice(ev.time.length + 3) : ev.label;
        var inner = (height >= 46 && ev.time)
          ? '<span class="v30-cal-wk__ev-t">' + esc(ev.time) + '</span><span class="v30-cal-wk__ev-n">' + esc(title) + '</span>'
          : esc(ev.label);
        return acc + '<button type="button" class="v30-cal__ev v30-cal-wk__ev is-' + ev.type +
          '" data-v30-cal-ev="' + iso + ':' + idx + '" style="' + style + '" title="' + esc(ev.label) + '">' +
          inner + '</button>';
      }, '');

      // Ligne "maintenant" (aujourd'hui uniquement)
      var nowLine = '';
      if (isT && nowMin >= HOUR_START * 60 && nowMin < HOUR_END * 60) {
        var nowTop = (nowMin - HOUR_START * 60) / 60 * SLOT_H;
        nowLine = '<div class="v30-cal-wk__now-line" style="top:' + nowTop + 'px;"></div>';
      }

      return '<div class="v30-cal-wk__day-col' + (isT ? ' is-today' : '') +
        '" style="height:' + TOTAL_H + 'px;">' + hlines + evHtml + nowLine + '</div>';
    }).join('');

    // ── Assemblage final ──────────────────────────────────────────
    body.innerHTML =
      '<div class="v30-cal v30-cal-wk">' +
        '<div class="v30-cal-wk__head">' +
          '<div class="v30-cal-wk__tc"></div>' + headCells +
        '</div>' +
        allDayRow +
        '<div class="v30-cal-wk__scroll" data-v30-wk-scroll>' +
          '<div class="v30-cal-wk__inner" style="height:' + TOTAL_H + 'px;">' +
            '<div class="v30-cal-wk__tc" style="height:' + TOTAL_H + 'px;position:relative;">' + hourLabels + '</div>' +
            dayCols +
          '</div>' +
        '</div>' +
      '</div>';

    // Scroll vers l'heure courante
    setTimeout(function () {
      var scroll = body.querySelector('[data-v30-wk-scroll]');
      if (!scroll) return;
      var target = Math.max(HOUR_START, now.getHours() - 1);
      scroll.scrollTop = (target - HOUR_START) * SLOT_H;
    }, 0);
  }

  // ─── Dispatch render ──────────────────────────────────────────────
  function render() {
    if (STATE.view === 'week')     renderWeekOrDay(false);
    else if (STATE.view === 'day') renderWeekOrDay(true);
    else                           renderMonth();
  }

  function updateTitle(text) {
    var el = document.querySelector('[data-v30-cal-month]');
    if (el) el.textContent = text;
  }

  // ─── Navigation ───────────────────────────────────────────────────
  function navPrev() {
    if (STATE.view === 'day')        STATE.cursor.setDate(STATE.cursor.getDate() - 1);
    else if (STATE.view === 'week')  STATE.cursor.setDate(STATE.cursor.getDate() - 7);
    else STATE.cursor = new Date(STATE.cursor.getFullYear(), STATE.cursor.getMonth() - 1, 1);
    render();
  }
  function navNext() {
    if (STATE.view === 'day')        STATE.cursor.setDate(STATE.cursor.getDate() + 1);
    else if (STATE.view === 'week')  STATE.cursor.setDate(STATE.cursor.getDate() + 7);
    else STATE.cursor = new Date(STATE.cursor.getFullYear(), STATE.cursor.getMonth() + 1, 1);
    render();
  }
  function navToday() {
    STATE.cursor = new Date();
    render();
  }

  // ─── Popups ───────────────────────────────────────────────────────
  function positionPopup(pop, anchor) {
    var r = anchor.getBoundingClientRect();
    pop.style.position = 'fixed';
    pop.style.zIndex   = '90';
    pop.style.top  = Math.min(window.innerHeight - 300, r.bottom + 6) + 'px';
    pop.style.left = Math.max(8, Math.min(window.innerWidth - 320, r.left)) + 'px';
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

  function openDayPopup(iso, anchor) {
    closeDayPopup();
    var evs = STATE.events[iso] || [];
    if (!evs.length) return;
    var pop = document.createElement('div');
    pop.className = 'popover v30-cal__popup';
    pop.setAttribute('role', 'dialog');
    pop.innerHTML = '<div class="v30-cal__popup-head">' +
      '<strong>' + esc(new Date(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long' })) + '</strong>' +
      '<button type="button" class="btn btn-ghost btn-sm btn-icon" data-v30-cal-popup-close aria-label="Fermer">×</button>' +
      '</div><div class="v30-cal__popup-body">' +
      evs.map(function (ev) {
        var cls = 'v30-cal__ev is-' + ev.type;
        return ev.href
          ? '<a class="' + cls + '" href="' + esc(ev.href) + '">' + esc(ev.label) + '</a>'
          : '<span class="' + cls + '">' + esc(ev.label) + '</span>';
      }).join('') + '</div>';
    document.body.appendChild(pop);
    positionPopup(pop, anchor);
    pop.addEventListener('click', function (e) { if (e.target.closest('[data-v30-cal-popup-close]')) closeDayPopup(); });
    document.addEventListener('click', outsideClose, true);
    document.addEventListener('keydown', escClose);
  }

  function openEventPopup(iso, idx, anchor) {
    closeDayPopup();
    var ev = (STATE.events[iso] || [])[idx];
    if (!ev) return;
    var pop = document.createElement('div');
    pop.className = 'popover v30-cal__popup v30-cal__popup--ev';
    pop.setAttribute('role', 'dialog');
    var TYPE_LABELS = { ec1: 'EC1 candidat', ec2: 'EC2 candidat', relance: 'Relance à faire', external: 'Calendrier externe' };
    var typeLabel = TYPE_LABELS[ev.type] || 'Rendez-vous';
    var body =
      '<div class="v30-cal__popup-head">' +
        '<strong>' + esc(new Date(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long' })) + '</strong>' +
        '<button type="button" class="btn btn-ghost btn-sm btn-icon" data-v30-cal-popup-close aria-label="Fermer">×</button>' +
      '</div>' +
      '<div class="v30-cal__popup-body">' +
        '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3);margin-bottom:4px;">' + esc(typeLabel) + '</div>' +
        '<div style="font-size:13px;color:var(--text);margin-bottom:8px;word-break:break-word;">' + esc(ev.label) + '</div>';

    if (ev.type === 'external') {
      body += '<div class="v30-cal__popup-ext-actions">';
      if (ev.teams_url) {
        var tDeep = ev.teams_url.replace('https://teams.microsoft.com/', 'msteams://');
        body += '<a class="btn btn-sm v30-cal__btn-teams" href="' + esc(tDeep) + '">' +
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M21 21v-2a4 4 0 0 0-4-4h-1"/><path d="M10 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M3 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2"/></svg>Rejoindre Teams</a>';
      }
      body += '<a class="btn btn-sm v30-cal__btn-outlook" href="ms-outlook://">' +
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>Ouvrir Outlook</a>';
      body += '</div>';
    } else if (ev.href) {
      body += '<a class="btn btn-sm btn-accent" href="' + esc(ev.href) + '" style="display:inline-flex;align-items:center;gap:6px;">Voir la fiche →</a>';
    }

    body += '</div>';
    pop.innerHTML = body;
    document.body.appendChild(pop);
    positionPopup(pop, anchor);
    pop.addEventListener('click', function (e) { if (e.target.closest('[data-v30-cal-popup-close]')) closeDayPopup(); });
    document.addEventListener('click', outsideClose, true);
    document.addEventListener('keydown', escClose);
  }

  // ─── Bind ─────────────────────────────────────────────────────────
  function bind() {
    var prev = document.querySelector('[data-v30-cal-prev]');
    if (prev) prev.addEventListener('click', navPrev);
    var next = document.querySelector('[data-v30-cal-next]');
    if (next) next.addEventListener('click', navNext);
    var tod = document.querySelector('[data-v30-cal-today]');
    if (tod) tod.addEventListener('click', navToday);

    // View switcher + events + more + refresh (délégation unique)
    document.addEventListener('click', function (e) {

      // Switcher de vue
      var vBtn = e.target.closest('[data-v30-cal-view]');
      if (vBtn) {
        var v = vBtn.dataset.v30CalView;
        if (v && v !== STATE.view) {
          STATE.view = v;
          document.querySelectorAll('[data-v30-cal-view]').forEach(function (b) {
            b.classList.toggle('is-active', b.dataset.v30CalView === v);
          });
          render();
        }
        return;
      }

      // Refresh
      var rfBtn = e.target.closest('[data-v30-cal-refresh]');
      if (rfBtn) {
        if (rfBtn.disabled) return;
        rfBtn.disabled = true;
        rfBtn.classList.add('is-loading');
        loadAll().then(function () {
          render(); updateExtBadge();
          rfBtn.disabled = false;
          rfBtn.classList.remove('is-loading');
        });
        return;
      }

      // More (vue mois)
      var more = e.target.closest('[data-v30-cal-more]');
      if (more) {
        e.preventDefault(); e.stopPropagation();
        openDayPopup(more.dataset.v30CalMore, more);
        return;
      }

      // Clic événement
      var evBtn = e.target.closest('[data-v30-cal-ev]');
      if (evBtn) {
        e.preventDefault(); e.stopPropagation();
        var p = evBtn.dataset.v30CalEv.split(':');
        openEventPopup(p[0], parseInt(p[1], 10) || 0, evBtn);
      }
    });
  }

  function init() {
    bind();
    render();
    loadAll().then(function () { render(); updateExtBadge(); });
    setInterval(function () {
      loadAll().then(function () { render(); updateExtBadge(); });
    }, 3600000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
