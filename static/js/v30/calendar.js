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
          href  = e.url || (e.id ? '/v30/prospect/' + e.id : '');
          duration = (typeof e.duration === 'number') ? e.duration : 60;
        }
        var entry = {
          type: t, label: label, href: href, time: time,
          duration: duration, teams_url: '', _iso: iso, name: e.name || ''
        };
        // Préserve les infos pour les events custom (créés via /api/calendar_events POST)
        if (e.source === 'custom' || e.custom_event_id) {
          entry.custom_event_id = e.custom_event_id || e.id;
          entry.prospect_id = e.prospect_id || null;
          entry.candidate_id = e.candidate_id || null;
          entry.location = e.location || '';
          entry.notes = e.notes || '';
          entry.statut = e.statut || 'planifie';
        }
        push(iso, entry);
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
  var LS_KEY = 'v30cal_cursor';

  function saveCursorToLS() {
    try { localStorage.setItem(LS_KEY, STATE.cursor.toISOString().slice(0, 10)); } catch (_) {}
  }

  function loadCursorFromLS() {
    try {
      var s = localStorage.getItem(LS_KEY);
      if (s) {
        var d = new Date(s);
        if (!isNaN(d.getTime())) STATE.cursor = d;
      }
    } catch (_) {}
  }

  function navPrev() {
    if (STATE.view === 'day')        STATE.cursor.setDate(STATE.cursor.getDate() - 1);
    else if (STATE.view === 'week')  STATE.cursor.setDate(STATE.cursor.getDate() - 7);
    else STATE.cursor = new Date(STATE.cursor.getFullYear(), STATE.cursor.getMonth() - 1, 1);
    saveCursorToLS();
    render();
  }
  function navNext() {
    if (STATE.view === 'day')        STATE.cursor.setDate(STATE.cursor.getDate() + 1);
    else if (STATE.view === 'week')  STATE.cursor.setDate(STATE.cursor.getDate() + 7);
    else STATE.cursor = new Date(STATE.cursor.getFullYear(), STATE.cursor.getMonth() + 1, 1);
    saveCursorToLS();
    render();
  }
  function navToday() {
    STATE.cursor = new Date();
    saveCursorToLS();
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
    } else if (ev.type === 'rdv' || ev.type === 'relance') {
      // Actions rapides pour RDV et relances prospects
      body += '<div class="v30-cal__popup-actions">';
      if (ev.href) {
        body += '<a class="btn btn-sm btn-accent" href="' + esc(ev.href) + '">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
          'Fiche</a>';
        // Appeler — intent tel: si on a un tel, sinon lien vers fiche
        body += '<a class="btn btn-sm btn-ghost" href="' + esc(ev.href) + '?action=call" title="Appeler">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.1 19.79 19.79 0 0 1 1.61 4.48C1.61 3.37 2.48 2.5 3.56 2.5h3a2 2 0 0 1 2 1.72 12.05 12.05 0 0 0 .66 2.63 2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.18 6.18l.86-.87a2 2 0 0 1 2.11-.45 12.05 12.05 0 0 0 2.63.66 2 2 0 0 1 1.72 2.03z"/></svg>' +
          'Appeler</a>';
        // Notes — lien vers fiche avec ancre notes
        body += '<a class="btn btn-sm btn-ghost" href="' + esc(ev.href) + '#notes" title="Notes">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
          'Notes</a>';
        // Reporter — lien vers fiche avec ancre nextFollowUp
        body += '<a class="btn btn-sm btn-ghost" href="' + esc(ev.href) + '?action=report" title="Reporter">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' +
          'Reporter</a>';
      }
      body += '</div>';
    } else if (ev.href) {
      body += '<a class="btn btn-sm btn-accent" href="' + esc(ev.href) + '" style="display:inline-flex;align-items:center;gap:6px;">Voir la fiche →</a>';
    }

    // Bouton Modifier / Supprimer pour events custom v30
    if (ev.custom_event_id) {
      body += '<div class="v30-cal__popup-actions" style="margin-top:8px;">' +
        '<button type="button" class="btn btn-sm" data-v30-cal-popup-edit="' + iso + ':' + idx + '">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
          ' Modifier</button>' +
        '</div>';
    }

    body += '</div>';
    pop.innerHTML = body;
    document.body.appendChild(pop);
    positionPopup(pop, anchor);
    pop.addEventListener('click', function (e) {
      if (e.target.closest('[data-v30-cal-popup-close]')) closeDayPopup();
      var ed = e.target.closest('[data-v30-cal-popup-edit]');
      if (ed) {
        var ps = ed.getAttribute('data-v30-cal-popup-edit').split(':');
        var i2 = (STATE.events[ps[0]] || [])[parseInt(ps[1], 10) || 0];
        if (i2) {
          closeDayPopup();
          openEventModal({ event: i2, date: ps[0] });
        }
      }
    });
    document.addEventListener('click', outsideClose, true);
    document.addEventListener('keydown', escClose);
  }

  // ─── Modale Nouveau / Édition RDV ────────────────────────────────
  function _modal() { return document.querySelector('[data-v30-cal-modal]'); }
  function $m(sel) { var m = _modal(); return m ? m.querySelector(sel) : null; }

  function openEventModal(opts) {
    opts = opts || {};
    var modal = _modal();
    if (!modal) return;
    var ev = opts.event || null;
    var titleTxt = ev ? 'Modifier RDV' : 'Nouveau RDV';
    var titleEl = modal.querySelector('[data-v30-cal-modal-title-txt]');
    if (titleEl) titleEl.textContent = titleTxt;

    var idEl = modal.querySelector('[data-v30-cal-evt-id]');
    if (idEl) idEl.value = (ev && ev.custom_event_id) ? ev.custom_event_id : '';

    var del = modal.querySelector('[data-v30-cal-evt-delete]');
    if (del) del.hidden = !(ev && ev.custom_event_id);

    var t = ev ? (ev.label || '').replace(/^\d{2}:\d{2}\s·\s/, '') : '';
    var titleInput = $m('#v30-cal-evt-title');
    if (titleInput) titleInput.value = t;

    var dateInput = $m('#v30-cal-evt-date');
    if (dateInput) dateInput.value = (opts.date || (ev && ev._iso) || isoDate(new Date()));

    var timeInput = $m('#v30-cal-evt-time');
    if (timeInput) timeInput.value = (ev && ev.time) || '';

    var durInput = $m('#v30-cal-evt-duration');
    if (durInput) durInput.value = (ev && typeof ev.duration === 'number') ? ev.duration : 60;

    var locInput = $m('#v30-cal-evt-location');
    if (locInput) locInput.value = (ev && ev.location) || '';

    var statusInput = $m('#v30-cal-evt-status');
    if (statusInput) statusInput.value = (ev && ev.statut) || 'planifie';

    var notesInput = $m('#v30-cal-evt-notes');
    if (notesInput) notesInput.value = (ev && ev.notes) || '';

    var pIdInput = modal.querySelector('[data-v30-cal-evt-prospect-id]');
    var pNameInput = $m('#v30-cal-evt-prospect');
    if (pIdInput) pIdInput.value = (ev && ev.prospect_id) || '';
    if (pNameInput) pNameInput.value = (ev && ev.prospect_id && ev.name) ? ev.name : '';
    var sug = modal.querySelector('[data-v30-cal-evt-suggestions]');
    if (sug) { sug.hidden = true; sug.innerHTML = ''; }

    modal.hidden = false;
    setTimeout(function () { if (titleInput) titleInput.focus(); }, 30);
  }

  function closeEventModal() {
    var modal = _modal();
    if (modal) modal.hidden = true;
  }

  var _searchTimer = null;
  function bindProspectSearch() {
    var input = document.querySelector('[data-v30-cal-evt-prospect-search]');
    var sug = document.querySelector('[data-v30-cal-evt-suggestions]');
    var hidden = document.querySelector('[data-v30-cal-evt-prospect-id]');
    if (!input || !sug || !hidden) return;
    input.addEventListener('input', function () {
      hidden.value = '';
      var q = input.value.trim();
      clearTimeout(_searchTimer);
      if (!q) { sug.hidden = true; sug.innerHTML = ''; return; }
      _searchTimer = setTimeout(function () {
        fetchJSON('/api/search?' + new URLSearchParams({ q: q, limit: 8, offset: 0 }).toString())
          .then(function (res) {
            var rows = (res && res.prospects) || [];
            if (!rows.length) { sug.hidden = true; sug.innerHTML = ''; return; }
            sug.innerHTML = rows.map(function (p) {
              return '<button type="button" class="v30-cal-modal__sug-item" data-pid="' + p.id +
                '" data-pname="' + esc(p.name || '') + '">' +
                '<span class="v30-cal-modal__sug-name">' + esc(p.name || '—') + '</span>' +
                '<span class="muted" style="font-size:11px;">' + esc(p.fonction || '') + '</span>' +
                '</button>';
            }).join('');
            sug.hidden = false;
          })
          .catch(function () { sug.hidden = true; });
      }, 220);
    });
    sug.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-pid]');
      if (!btn) return;
      hidden.value = btn.dataset.pid;
      input.value = btn.dataset.pname;
      sug.hidden = true; sug.innerHTML = '';
    });
  }

  function saveEventModal() {
    var modal = _modal();
    if (!modal) return;
    var idVal = (modal.querySelector('[data-v30-cal-evt-id]') || {}).value || '';
    var title = ($m('#v30-cal-evt-title') || {}).value || '';
    var date = ($m('#v30-cal-evt-date') || {}).value || '';
    var time = ($m('#v30-cal-evt-time') || {}).value || '';
    var duration = parseInt(($m('#v30-cal-evt-duration') || {}).value || '60', 10) || 60;
    var location = ($m('#v30-cal-evt-location') || {}).value || '';
    var status = ($m('#v30-cal-evt-status') || {}).value || 'planifie';
    var notes = ($m('#v30-cal-evt-notes') || {}).value || '';
    var prospectId = (modal.querySelector('[data-v30-cal-evt-prospect-id]') || {}).value || '';
    if (!title.trim()) {
      if (window.showToast) window.showToast('Le titre est requis', 'warning', 3000);
      return;
    }
    if (!date) {
      if (window.showToast) window.showToast('La date est requise', 'warning', 3000);
      return;
    }
    var payload = {
      title: title.trim(),
      date: date,
      time: time || null,
      duration: duration,
      location: location || null,
      notes: notes || null,
      status: status,
      prospect_id: prospectId ? parseInt(prospectId, 10) : null
    };
    var url = '/api/calendar_events' + (idVal ? '/' + idVal : '');
    var method = idVal ? 'PUT' : 'POST';
    fetch(url, {
      method: method, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, j: j }; });
    }).then(function (res) {
      if (!res.ok || !res.j.ok) throw new Error((res.j && res.j.error) || 'Erreur');
      closeEventModal();
      if (window.showToast) window.showToast(idVal ? 'RDV mis à jour' : 'RDV créé', 'success', 2500);
      loadAll().then(function () { render(); updateExtBadge(); });
    }).catch(function (err) {
      if (window.showToast) window.showToast('Erreur : ' + (err.message || ''), 'error', 4000);
    });
  }

  function deleteEventModal() {
    var modal = _modal();
    if (!modal) return;
    var idVal = (modal.querySelector('[data-v30-cal-evt-id]') || {}).value || '';
    if (!idVal) return;
    if (!window.confirm('Supprimer ce RDV ?')) return;
    fetch('/api/calendar_events/' + encodeURIComponent(idVal), {
      method: 'DELETE', credentials: 'same-origin'
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function () {
      closeEventModal();
      if (window.showToast) window.showToast('RDV supprimé', 'success', 2500);
      loadAll().then(function () { render(); updateExtBadge(); });
    }).catch(function (err) {
      if (window.showToast) window.showToast('Erreur : ' + (err.message || ''), 'error', 4000);
    });
  }

  // ─── Bind ─────────────────────────────────────────────────────────
  function bind() {
    var prev = document.querySelector('[data-v30-cal-prev]');
    if (prev) prev.addEventListener('click', navPrev);
    var next = document.querySelector('[data-v30-cal-next]');
    if (next) next.addEventListener('click', navNext);
    var tod = document.querySelector('[data-v30-cal-today]');
    if (tod) tod.addEventListener('click', navToday);

    var newBtn = document.querySelector('[data-v30-cal-new]');
    if (newBtn) newBtn.addEventListener('click', function () { openEventModal({}); });

    bindProspectSearch();

    // Double-click sur une cellule jour (vue mois) → nouveau RDV pré-rempli
    document.addEventListener('dblclick', function (e) {
      var cell = e.target.closest('[data-iso]');
      if (cell) {
        var iso = cell.getAttribute('data-iso');
        // On évite d'ouvrir la modale quand on dblclick sur un événement
        if (e.target.closest('[data-v30-cal-ev]') || e.target.closest('[data-v30-cal-more]')) return;
        openEventModal({ date: iso });
      }
    });

    // View switcher + events + more + refresh (délégation unique)
    document.addEventListener('click', function (e) {

      // Modal close
      var closeBtn = e.target.closest('[data-v30-modal-close]');
      if (closeBtn && closeBtn.closest('[data-v30-cal-modal]')) { closeEventModal(); return; }
      var bd = e.target.closest('[data-v30-cal-modal]');
      if (bd && e.target === bd) { closeEventModal(); return; }
      if (e.target.closest('[data-v30-cal-evt-save]')) { saveEventModal(); return; }
      if (e.target.closest('[data-v30-cal-evt-delete]')) { deleteEventModal(); return; }

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

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var m = _modal();
        if (m && !m.hidden) closeEventModal();
      }
    });
  }

  function init() {
    loadCursorFromLS();
    bind();
    render();
    loadAll().then(function () { render(); updateExtBadge(); });
    setInterval(function () {
      loadAll().then(function () { render(); updateExtBadge(); });
    }, 3600000);
    // Auto-refresh quand l'onglet redevient actif
    var lastRefresh = Date.now();
    function maybeRefresh() {
      if (document.hidden) return;
      var now = Date.now();
      if (now - lastRefresh < 5000) return;
      lastRefresh = now;
      loadAll().then(function () { render(); updateExtBadge(); });
    }
    document.addEventListener('visibilitychange', maybeRefresh);
    window.addEventListener('focus', maybeRefresh);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
