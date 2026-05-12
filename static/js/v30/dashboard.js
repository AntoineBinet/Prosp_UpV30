/* ============================================================
   ProspUp v30 — Dashboard hydration
   Branche le template skeleton de templates/v30/dashboard.html
   sur les endpoints existants :
     GET /api/dashboard                  → hero KPIs, goals, feed
     GET /api/dashboard/pipeline-stages  → pipeline + priorités IA
     GET /api/tasks?status=pending       → action center "À faire"
   Aucune dépendance externe (vanilla JS).
   ============================================================ */
(function () {
  'use strict';

  var ICONS = {
    arrowR: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
  };

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '??';
    return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }

  function fmtDateFR(iso) {
    try {
      var d = iso ? new Date(iso) : new Date();
      var jour = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'][d.getDay()];
      var mois = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'][d.getMonth()];
      var week = (function(){
        var target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        var day = target.getUTCDay() || 7;
        target.setUTCDate(target.getUTCDate() + 4 - day);
        var y1 = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
        return Math.ceil(((target - y1) / 86400000 + 1) / 7);
      })();
      return jour + ' ' + d.getDate() + ' ' + mois + ' · Semaine ' + week;
    } catch (_) { return ''; }
  }

  function delta(current, prev) {
    if (typeof current !== 'number' || typeof prev !== 'number') return { label: '', neg: false };
    var d = current - prev;
    var sign = d > 0 ? '+' : (d < 0 ? '−' : '±');
    return { label: sign + Math.abs(d), neg: d < 0 };
  }

  function relativeTime(iso) {
    if (!iso) return '';
    try {
      var t = new Date(iso).getTime();
      var diffMin = Math.floor((Date.now() - t) / 60000);
      if (diffMin < 1) return "à l'instant";
      if (diffMin < 60) return 'il y a ' + diffMin + ' min';
      var diffH = Math.floor(diffMin / 60);
      if (diffH < 24) return 'il y a ' + diffH + ' h';
      var diffJ = Math.floor(diffH / 24);
      if (diffJ === 1) return 'hier';
      if (diffJ < 7) return 'il y a ' + diffJ + ' j';
      return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
    } catch (_) { return ''; }
  }

  function timeHHmm(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    } catch (_) { return ''; }
  }

  // ─── Hero ─────────────────────────────────────────────────────────
  function renderHero(data) {
    var eyebrow = $('[data-v30-dash="hero-date"]');
    if (eyebrow) eyebrow.textContent = fmtDateFR();

    var subtitle = $('[data-v30-dash="hero-subtitle"]');
    if (subtitle) {
      var overdue = (data && data.pipeline && data.pipeline.overdue) || 0;
      // "RDV aujourd'hui" = nb prospects dont rdvDate tombe aujourd'hui,
      // pas relances dues (qui s'affichent déjà via "X relances en retard").
      var rdvToday = (data && data.week && data.week.rdv_today != null)
        ? data.week.rdv_today
        : ((data && data.today_appointments && data.today_appointments.length) || 0);
      subtitle.innerHTML = 'Tu as <b>' + overdue + ' relance' + (overdue > 1 ? 's' : '') +
        '</b> en retard et <b>' + rdvToday + ' RDV</b> aujourd\'hui.';
    }

    // KPI "RDV sem." = RDV programmés (rdvDate) cette semaine — c'est ce
    // qu'attend l'utilisateur. `rdv_total` reste réservé à la gamification
    // (events rdv_taken) et au breakdown Performance.
    var kpis = [
      { key: 'rdv',      cur: data.week && (data.week.rdv_scheduled != null ? data.week.rdv_scheduled : data.week.rdv_total), prev: null },
      { key: 'push',     cur: data.week && data.week.push_total,  prev: data.prev_week && data.prev_week.push_total },
      { key: 'contacts', cur: data.pipeline && data.pipeline.total, prev: null }
    ];
    kpis.forEach(function (k) {
      var row = $('[data-v30-dash="hero-kpis"] [data-kpi="' + k.key + '"]');
      if (!row) return;
      var v = row.querySelector('[data-field="value"]');
      var d = row.querySelector('[data-field="delta"]');
      if (v) v.textContent = (k.cur == null ? '—' : k.cur);
      if (d) {
        if (k.prev == null) { d.textContent = ''; return; }
        var dd = delta(k.cur, k.prev);
        d.textContent = dd.label + ' vs sem-1';
        d.classList.toggle('is-neg', dd.neg);
      }
    });

    var streak = $('[data-v30-dash="streak"]');
    if (streak) {
      // Streak = nb de jours OUVRÉS actifs cette semaine (sam/dim/JF ignorés).
      // Le backend pose `is_working_day` sur chaque entrée week.days.
      var days = (data.week && data.week.days) || [];
      var active = days.filter(function (d) {
        if (d.is_working_day === false) return false;
        return (d.push || 0) + (d.rdv || 0) + (d.notes || 0) + (d.calls || 0) > 0;
      }).length;
      streak.innerHTML = active + ' jour' + (active > 1 ? 's' : '') +
        ' <span class="muted">cette semaine</span>';
    }
  }

  // ─── Action center ────────────────────────────────────────────────
  // Mapping aligné sur prospects.js (statuts ProspUp réels).
  // Les libellés hors mapping retombent sur le statut neutre `.status`.
  function statusPill(statut) {
    var map = {
      'Rendez-vous':  { cls: 'status-rdv',      label: statut },
      'Prospecté':    { cls: 'status-prosp',    label: statut },
      'Contacté':     { cls: 'status-called',   label: statut },
      'Appelé':       { cls: 'status-called',   label: statut },
      'Messagerie':   { cls: 'status-voicemail', label: statut },
      'À rappeler':   { cls: 'status-callback', label: statut },
      'Pas intéressé':{ cls: 'status-cold',     label: statut },
      "Pas d'actions":{ cls: 'status-idle',     label: statut }
    };
    return map[statut] || { cls: 'status', label: statut || '—' };
  }

  function acRow(opts) {
    var p = statusPill(opts.pill);
    var safe = function (s) {
      var t = document.createElement('span'); t.textContent = s; return t.innerHTML;
    };
    return '<a class="v30-ac__row" href="' + (opts.href || '#') + '">' +
      '<span class="avatar">' + safe(initials(opts.name)) + '</span>' +
      '<div style="min-width:0;">' +
        '<div class="v30-ac__name truncate">' + safe(opts.name) + '</div>' +
        '<div class="v30-ac__sub truncate">' + safe(opts.co || '') + (opts.time ? ' · ' + safe(opts.time) : '') + '</div>' +
      '</div>' +
      '<span class="status ' + p.cls + '">' + safe(opts.label || p.label) + '</span>' +
      '<span class="btn btn-ghost btn-sm btn-icon" aria-hidden="true">' + ICONS.arrowR + '</span>' +
    '</a>';
  }

  function renderActionCenter(data, tasks) {
    var tabs = $('[data-v30-ac]');
    var card = tabs && tabs.closest('.card');
    if (!card) return;

    var todos = (tasks && tasks.tasks) || [];
    // "RDV aujourd'hui" = prospects dont rdvDate tombe aujourd'hui (rendez-vous
    // programmés). `data.today_appointments` est calculé côté backend à partir
    // de prospects.rdvDate. On évite `feed.rdv` qui ne contient que les events
    // `rdv_taken` (= transitions de statut), donc serait vide même quand un
    // RDV existe pour aujourd'hui.
    var rdvList = data.today_appointments || [];
    var overdue = data.overdue_list || [];

    function fillCount(tab, n) {
      var btn = tabs.querySelector('button[data-tab="' + tab + '"] [data-field="count"]');
      if (btn) btn.textContent = n;
    }
    fillCount('todo', todos.length);
    fillCount('rdv',  rdvList.length);
    fillCount('late', overdue.length);

    var panels = {
      todo: card.querySelector('[data-panel="todo"]'),
      rdv:  card.querySelector('[data-panel="rdv"]'),
      late: card.querySelector('[data-panel="late"]')
    };

    if (panels.todo) {
      panels.todo.innerHTML = todos.length === 0
        ? '<div class="empty">Aucune tâche en cours.</div>'
        : todos.slice(0, 6).map(function (t) {
            return acRow({
              name: t.title || 'Tâche',
              co: t.comment || '',
              time: t.due_date ? 'Échéance ' + t.due_date : '',
              pill: 'À rappeler',
              label: 'Tâche',
              href: '#'
            });
          }).join('');
    }

    if (panels.rdv) {
      panels.rdv.innerHTML = rdvList.length === 0
        ? '<div class="empty">Aucun RDV aujourd\'hui.</div>'
        : rdvList.slice(0, 6).map(function (r) {
            return acRow({
              name: r.prospect_name || '',
              co: r.company_name || '',
              time: r.rdvDate ? 'RDV ' + r.rdvDate : '',
              pill: 'Rendez-vous',
              href: '/?prospect=' + encodeURIComponent(r.prospect_id || '')
            });
          }).join('');
    }

    if (panels.late) {
      panels.late.innerHTML = overdue.length === 0
        ? '<div class="empty">Pas de relance en retard.</div>'
        : overdue.slice(0, 6).map(function (p) {
            return acRow({
              name: p.name || '',
              co: '',
              time: p.nextFollowUp ? 'Retard depuis ' + p.nextFollowUp : '',
              pill: p.statut,
              href: '/?prospect=' + encodeURIComponent(p.id)
            });
          }).join('');
    }

    if (!tabs._v30Bound) {
      tabs.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-tab]');
        if (!btn) return;
        var key = btn.dataset.tab;
        $$('button[data-tab]', tabs).forEach(function (b) {
          var act = (b === btn);
          b.classList.toggle('active', act);
          b.setAttribute('aria-selected', act ? 'true' : 'false');
        });
        Object.keys(panels).forEach(function (k) {
          if (panels[k]) panels[k].hidden = (k !== key);
        });
      });
      tabs._v30Bound = true;
    }

    // Sélectionne automatiquement le premier onglet non vide
    // (évite la carte "Aucune tâche en cours" sur l'onglet 1 si un autre a du contenu)
    var counts = { todo: todos.length, rdv: rdvList.length, late: overdue.length };
    var anyActiveCount = counts.todo + counts.rdv + counts.late;
    if (anyActiveCount > 0) {
      var activeTab = $('button[data-tab].active', tabs);
      var activeKey = activeTab ? activeTab.dataset.tab : 'todo';
      if (counts[activeKey] === 0) {
        var fallback = counts.late > 0 ? 'late' : (counts.rdv > 0 ? 'rdv' : 'todo');
        $$('button[data-tab]', tabs).forEach(function (b) {
          var act = (b.dataset.tab === fallback);
          b.classList.toggle('active', act);
          b.setAttribute('aria-selected', act ? 'true' : 'false');
        });
        Object.keys(panels).forEach(function (k) {
          if (panels[k]) panels[k].hidden = (k !== fallback);
        });
      }
    }
  }

  // ─── Pipeline ─────────────────────────────────────────────────────
  function renderPipeline(stages, total) {
    var host = $('[data-v30-pipeline]');
    if (!host) return;

    // Mapping clé SQL/API → label + couleur (aligné sur api_dashboard_pipeline_stages)
    var order = [
      { key: 'appel',        label: 'À prospecter', bg: 'var(--info-soft)',            fg: 'var(--info)' },
      { key: 'rdv',          label: 'RDV',          bg: 'var(--accent-soft)',          fg: 'var(--accent)' },
      { key: 'besoin',       label: 'Besoin',       bg: 'oklch(0.92 0.05 280)',        fg: 'oklch(0.50 0.15 280)' },
      { key: 'reunion_tech', label: 'Réunion tech', bg: 'var(--warn-soft)',            fg: 'oklch(0.50 0.14 75)' },
      { key: 'contrat',      label: 'Gagné',        bg: 'var(--success-soft)',         fg: 'var(--success)' }
    ];
    var counts = stages || {};
    var max = Math.max(1, Math.max.apply(null, order.map(function (o) { return counts[o.key] || 0; })));

    var totalEl = host.querySelector('[data-field="total"]');
    if (totalEl) totalEl.textContent = (total || 0) + ' prospects actifs';

    var rowsEl = host.querySelector('[data-field="rows"]');
    if (!rowsEl) return;
    rowsEl.innerHTML = order.map(function (o) {
      var n = counts[o.key] || 0;
      var pct = Math.round((n / max) * 100);
      return '<div class="v30-pipeline__row">' +
        '<span class="v30-pipeline__stage">' + o.label + '</span>' +
        '<div class="v30-pipeline__bar">' +
          '<div class="v30-pipeline__fill" style="width:' + pct + '%;background:' + o.bg + ';"></div>' +
          '<span class="v30-pipeline__num num" style="color:' + o.fg + ';">' + n + '</span>' +
        '</div>' +
        '<span class="v30-pipeline__pct mono num">' + pct + '%</span>' +
      '</div>';
    }).join('');
  }

  // ─── Goals ring ───────────────────────────────────────────────────
  function renderGoals(goals) {
    var host = $('[data-v30-goals]');
    if (!host || !goals) return;
    var daily = goals.daily || {};
    var items = daily.items || {};
    var list = [
      { key: 'push',               label: 'Push' },
      { key: 'rdv',                label: 'RDV' },
      { key: 'sourcing_contacted', label: 'Contacts' }
    ];
    var totalCount = 0, totalTarget = 0;
    list.forEach(function (it) {
      var d = items[it.key] || {};
      totalCount  += d.count  || 0;
      totalTarget += d.target || 0;
    });
    var pct = totalTarget > 0 ? Math.round((totalCount / totalTarget) * 100) : 0;

    var C = 2 * Math.PI * 44;
    var arc = host.querySelector('[data-field="ring-arc"]');
    if (arc) {
      arc.setAttribute('stroke-dasharray', C.toFixed(2));
      arc.setAttribute('stroke-dashoffset', (C * (1 - pct / 100)).toFixed(2));
    }
    var pctEl = host.querySelector('[data-field="ring-pct"]');
    if (pctEl) pctEl.textContent = pct + '%';

    var listEl = host.querySelector('[data-field="list"]');
    if (!listEl) return;
    // BUG 23 : si aucune target définie, afficher un CTA de configuration
    if (totalTarget === 0) {
      listEl.innerHTML = '<div class="empty" style="padding:12px 0;font-size:12.5px;color:var(--text-3);">' +
        'Aucun objectif configuré. ' +
        '<a href="/v30/parametres" style="color:var(--accent);">Configurer vos objectifs →</a>' +
        '</div>';
      return;
    }
    listEl.innerHTML = list.map(function (it) {
      var d = items[it.key] || {};
      var count = d.count || 0, target = d.target || 0;
      var p = target > 0 ? Math.min(100, Math.round((count / target) * 100)) : 0;
      return '<div class="v30-goal__row">' +
        '<div class="v30-goal__head">' +
          '<span>' + it.label + '</span>' +
          '<span class="mono num"><b>' + count + '</b>/' + target + '</span>' +
        '</div>' +
        '<div class="v30-goal__track"><div class="v30-goal__fill" style="width:' + p + '%;"></div></div>' +
      '</div>';
    }).join('');
  }

  // ─── Priorités IA ─────────────────────────────────────────────────
  function renderPriorities(priority) {
    var host = $('[data-v30-priorities] [data-field="rows"]');
    if (!host) return;
    var items = (priority || []).slice(0, 5);
    if (items.length === 0) {
      host.innerHTML = '<div class="empty">Aucune priorité détectée.</div>';
      return;
    }
    var safe = function (s) {
      var t = document.createElement('span'); t.textContent = s; return t.innerHTML;
    };
    host.innerHTML = items.map(function (it, i) {
      // Urgence dérivée de la fraîcheur du dernier contact
      var last = it.lastContact || '';
      var days = 99;
      if (last) {
        try { days = Math.floor((Date.now() - new Date(last).getTime()) / 86400000); } catch (_) {}
      }
      var urg = days > 30 ? 'haut' : days > 14 ? 'moyen' : 'bas';
      var pill = urg === 'haut' ? 'badge-danger' : urg === 'moyen' ? 'badge-warn' : 'badge-info';
      var reason = last
        ? 'Dernier contact il y a ' + days + ' j · stage ' + (it.stage || '—') + '.'
        : 'Pas de dernier contact enregistré.';
      return '<div class="v30-prio__row">' +
        '<span class="avatar">' + safe(initials(it.name)) + '</span>' +
        '<div>' +
          '<div class="v30-prio__name">' + safe(it.name) +
            ' <span class="v30-prio__co">· ' + safe(it.company || '—') + '</span>' +
          '</div>' +
          '<div class="v30-prio__reason">' + safe(reason) + '</div>' +
        '</div>' +
        '<div class="v30-prio__tail">' +
          '<span class="badge ' + pill + '">' + urg + '</span>' +
          '<a class="btn btn-sm" href="/?prospect=' + encodeURIComponent(it.id) + '">Ouvrir</a>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  // ─── Activité récente (timeline) ──────────────────────────────────
  function renderActivity(feed) {
    var host = $('[data-v30-activity] [data-field="rows"]');
    if (!host) return;
    var events = [];
    ((feed && feed.push) || []).forEach(function (p) {
      events.push({
        t: timeHHmm(p.createdAt),
        tag: 'push',
        text: 'Push envoyé' + (p.subject ? ' — « ' + p.subject + ' »' : '') + (p.to_email ? ' à ' + p.to_email : '')
      });
    });
    ((feed && feed.rdv) || []).forEach(function (r) {
      events.push({
        t: timeHHmm(r.createdAt || r.rdvDate),
        tag: 'rdv',
        text: 'RDV ' + (r.prospect_name || '') + (r.company_name ? ' (' + r.company_name + ')' : '')
      });
    });
    ((feed && feed.notes) || []).forEach(function (n) {
      events.push({
        t: timeHHmm(n.date),
        tag: 'note',
        text: 'Note sur ' + (n.prospect_name || '—') + (n.content ? ' — « ' + (n.content.length > 60 ? n.content.slice(0, 60) + '…' : n.content) + ' »' : '')
      });
    });

    if (events.length === 0) {
      host.innerHTML = '<div class="empty">Aucune activité récente.</div>';
      return;
    }

    // Tri décroissant par heure (HH:mm string)
    events.sort(function (a, b) { return (b.t || '').localeCompare(a.t || ''); });
    events = events.slice(0, 6);

    var COLORS = {
      push:   'var(--accent)',
      rdv:    'oklch(0.50 0.15 280)',
      note:   'var(--text-3)',
      status: 'var(--success)'
    };
    var safe = function (s) {
      var t = document.createElement('span'); t.textContent = s; return t.innerHTML;
    };
    host.innerHTML = events.map(function (e) {
      return '<div class="v30-timeline__row">' +
        '<span class="v30-timeline__time mono">' + safe(e.t) + '</span>' +
        '<span class="v30-timeline__dot" style="background:' + (COLORS[e.tag] || 'var(--text-3)') + ';"></span>' +
        '<div class="v30-timeline__text">' + safe(e.text) + '</div>' +
      '</div>';
    }).join('');
  }

  // ─── Fetch + orchestration ────────────────────────────────────────
  function fetchJSON(url) {
    return fetch(url, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
  }

  // ─── Performance (v30.6 — reprise v29 dv2) ────────────────────────
  var PERF_COLORS = {
    contacts: '#f59e0b',
    notes:    '#3b82f6',
    push:     '#8b5cf6',
    rdv:      '#22c55e',
    overdue:  '#ef4444'
  };
  var PERF_STATE = { weekOffset: 0, chart: null };
  // Dernier payload `goals` reçu via /api/dashboard — utilisé par la modale
  // de détail (info button à côté du titre Objectifs).
  var LAST_GOALS = null;

  function weekMonday(offset) {
    var d = new Date(); d.setHours(0, 0, 0, 0);
    var day = d.getDay();
    var diff = (day === 0) ? -6 : 1 - day;
    d.setDate(d.getDate() + diff + (offset * 7));
    return d;
  }
  function isoWeek(offset) {
    var monday = weekMonday(offset);
    var d = new Date(Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate()));
    var dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    var weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return d.getUTCFullYear() + '-W' + String(weekNo).padStart(2, '0');
  }
  function weekLabel(offset) {
    if (offset === 0) return 'Cette semaine';
    var monday = weekMonday(offset);
    var sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6);
    var fmt = function (d) {
      return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
    };
    return 'Sem. ' + fmt(monday) + ' → ' + fmt(sunday);
  }
  function trendBadge(current, previous) {
    if (!previous || previous === 0) return '';
    var diff = current - previous;
    var pct = Math.round((diff / previous) * 100);
    if (diff > 0) return '<span class="v30-perf__trend v30-perf__trend--up">+' + pct + '%</span>';
    if (diff < 0) return '<span class="v30-perf__trend v30-perf__trend--down">' + pct + '%</span>';
    return '<span class="v30-perf__trend v30-perf__trend--flat">=</span>';
  }
  function sparklineSVG(values, color, w, h) {
    w = w || 60; h = h || 22;
    if (!values || !values.length) return '';
    var max = Math.max(1, Math.max.apply(null, values));
    var pts = values.map(function (v, i) {
      var x = values.length > 1 ? (i / (values.length - 1)) * w : w / 2;
      var y = h - ((v / max) * (h - 4)) - 2;
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    var lastPt = pts[pts.length - 1].split(',');
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true">' +
      '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + color + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="' + lastPt[0] + '" cy="' + lastPt[1] + '" r="2" fill="' + color + '"/>' +
    '</svg>';
  }
  function dayShort(iso) {
    var names = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
    try { return names[new Date(iso + 'T00:00:00').getDay()]; } catch (_) { return iso; }
  }

  function renderPerformance(data) {
    var root = $('[data-v30-perf]');
    if (!root) return;
    var t = data.today || {};
    var w = data.week || {};
    var pw = data.prev_week || {};
    var days = (w && w.days) || [];
    var isPast = !!data.is_past_week;

    var todayContacts = (t.calls || 0) > 0 ? t.calls : Math.max(t.relances || 0, t.notes || 0);
    var weekContacts = (w.calls || 0) > 0 ? w.calls : Math.max(w.relances || 0, w.notes || 0);
    var prevContacts = Math.max(pw.relances || 0, pw.notes || 0);

    var totalWeek = (weekContacts || 0) + (w.push_total || 0);
    var badge = root.querySelector('[data-field="badge"]');
    if (badge) badge.textContent = isPast ? weekLabel(PERF_STATE.weekOffset) : (totalWeek + ' actions cette semaine');

    var pipeline = data.pipeline || {};
    var chips = [
      { key: 'contacts', color: PERF_COLORS.contacts, label: 'Contacts',
        value: isPast ? weekContacts : todayContacts,
        weekVal: weekContacts, prevVal: prevContacts,
        sub: isPast ? (weekContacts + ' cette semaine') : ((t.calls || 0) + ' appels tracés') },
      { key: 'notes', color: PERF_COLORS.notes, label: 'Notes',
        value: isPast ? (w.notes || 0) : (t.notes || 0),
        weekVal: w.notes || 0, prevVal: pw.notes || 0,
        sub: (w.notes || 0) + ' cette semaine' },
      { key: 'push', color: PERF_COLORS.push, label: 'Push',
        value: isPast ? (w.push_total || 0) : (t.push_total || 0),
        weekVal: w.push_total || 0, prevVal: pw.push_total || 0,
        sub: (w.push_email || 0) + ' emails + ' + (w.push_linkedin || 0) + ' linkedin' },
      { key: 'rdv', color: PERF_COLORS.rdv, label: 'RDV',
        value: w.rdv_total || 0,
        weekVal: w.rdv_total || 0, prevVal: 0,
        sub: isPast ? 'RDV pris cette semaine' : ((w.rdv_total || 0) + ' pris · ' + (pipeline.rdv || 0) + ' en pipeline') }
    ];
    if (!isPast && (pipeline.overdue || 0) > 0) {
      chips.push({
        key: 'overdue', color: PERF_COLORS.overdue, label: 'En retard',
        value: pipeline.overdue,
        weekVal: pipeline.overdue, prevVal: 0,
        sub: (pipeline.due_today || 0) + ' à faire aujourd\'hui',
        alert: true
      });
    }

    var esc = function (s) { var el = document.createElement('span'); el.textContent = s == null ? '' : String(s); return el.innerHTML; };

    var chipsEl = root.querySelector('[data-field="chips"]');
    if (chipsEl) {
      chipsEl.innerHTML = chips.map(function (c) {
        var sparkVals = days.map(function (d) {
          if (c.key === 'contacts') return (d.calls || 0) > 0 ? d.calls : Math.max(d.relances || 0, d.notes || 0);
          if (c.key === 'notes') return d.notes || 0;
          if (c.key === 'push') return d.push || 0;
          if (c.key === 'rdv')  return d.rdv || 0;
          return 0;
        });
        var spark = c.key !== 'overdue'
          ? '<span class="v30-perf__chip-spark">' + sparklineSVG(sparkVals, c.color, 60, 22) + '</span>'
          : '';
        var trend = trendBadge(c.weekVal, c.prevVal);
        return '<div class="v30-perf__chip' + (c.alert ? ' v30-perf__chip--alert' : '') + '" style="--chip-color:' + c.color + ';">' +
          '<div class="v30-perf__chip-val num">' + esc(c.value) + '</div>' +
          '<div class="v30-perf__chip-label">' + esc(c.label) + ' ' + trend + '</div>' +
          '<div class="v30-perf__chip-sub">' + esc(c.sub) + '</div>' +
          spark +
        '</div>';
      }).join('');
    }

    renderPerformanceChart(days, w);
    renderPerfInsights(data, days, pw);
    renderPerfBreakdown(w);
  }

  function renderPerfBreakdown(w) {
    var host = document.querySelector('[data-v30-perf] [data-field="breakdown"]');
    if (!host) return;
    var contacts = (w.calls || 0) > 0 ? w.calls : Math.max(w.relances || 0, w.notes || 0);
    var metrics = [
      { label: 'Contacts', value: contacts,           color: PERF_COLORS.contacts },
      { label: 'Push',     value: w.push_total || 0,  color: PERF_COLORS.push },
      { label: 'Notes',    value: w.notes || 0,       color: PERF_COLORS.notes },
      { label: 'RDV',      value: w.rdv_total || 0,   color: PERF_COLORS.rdv }
    ];
    var total = metrics.reduce(function (s, m) { return s + m.value; }, 0);
    var max = Math.max(1, Math.max.apply(null, metrics.map(function (m) { return m.value; })));
    var esc = function (s) { var e = document.createElement('span'); e.textContent = s == null ? '' : String(s); return e.innerHTML; };

    var totalEl = host.querySelector('[data-field="breakdown-total"]');
    if (totalEl) totalEl.textContent = total + ' action' + (total > 1 ? 's' : '');

    var rowsEl = host.querySelector('[data-field="breakdown-rows"]');
    if (!rowsEl) return;
    rowsEl.innerHTML = metrics.map(function (m) {
      var pct = Math.round((m.value / max) * 100);
      return '<div class="v30-perf__breakdown-row">' +
        '<span class="v30-perf__breakdown-label">' + esc(m.label) + '</span>' +
        '<div class="v30-perf__breakdown-bar">' +
          '<div class="v30-perf__breakdown-fill" style="width:' + pct + '%;background:' + m.color + ';"></div>' +
        '</div>' +
        '<span class="v30-perf__breakdown-value num">' + esc(m.value) + '</span>' +
      '</div>';
    }).join('');
  }

  function renderPerfInsights(data, days, prevWeek) {
    var host = document.querySelector('[data-v30-perf] [data-field="insights"]');
    if (!host) return;
    var pipeline = data.pipeline || {};
    var w = data.week || {};
    var esc = function (s) { var e = document.createElement('span'); e.textContent = s == null ? '' : String(s); return e.innerHTML; };

    // 1. Meilleur jour : day with max (contacts + push), parmi les jours OUVRÉS
    //    (sam/dim/JF exclus — sinon on récompense un push fait par hasard le dimanche).
    var workingDays = (days || []).filter(function (d) { return d.is_working_day !== false; });
    var bestDay = null, bestScore = -1;
    workingDays.forEach(function (d) {
      var c = (d.calls || 0) > 0 ? d.calls : Math.max(d.relances || 0, d.notes || 0);
      var p = d.push || 0;
      var score = c + p;
      if (score > bestScore) { bestScore = score; bestDay = d; }
    });
    var bestDayLabel = bestDay && bestScore > 0 ? dayShort(bestDay.date) : '—';
    var bestDaySub = bestScore > 0 ? (bestScore + ' action' + (bestScore > 1 ? 's' : '')) : 'Pas d\'activité';

    // 2. Série active : nb de jours OUVRÉS consécutifs avec activité > 0,
    //    en remontant depuis aujourd'hui. Sam/dim/JF sont sautés (ne cassent pas le streak).
    var streak = 0;
    for (var i = (days || []).length - 1; i >= 0; i--) {
      var dd = days[i];
      if (dd.is_working_day === false) continue;
      var hasActivity = (dd.calls || 0) + (dd.notes || 0) + (dd.push || 0) + (dd.rdv || 0) > 0;
      if (hasActivity) streak++;
      else break;
    }
    // Recount jours OUVRÉS actifs sur la semaine pour le sous-titre
    var activeDays = workingDays.filter(function (d) {
      return (d.calls || 0) + (d.notes || 0) + (d.push || 0) + (d.rdv || 0) > 0;
    }).length;
    var wdTotal = (data.working_days && data.working_days.week_total) || workingDays.length;
    var streakSub = activeDays + '/' + wdTotal + ' jours ouvrés actifs';

    // 3. Conversion RDV : part de prospects en statut Rendez-vous sur le pipeline actif
    var total = pipeline.total || 0;
    var rdv = pipeline.rdv || 0;
    var convPct = total > 0 ? Math.round((rdv / total) * 1000) / 10 : 0;
    var convDelta = '';
    if (prevWeek && prevWeek.push_total != null) {
      var thisPush = w.push_total || 0;
      var prevPush = prevWeek.push_total || 0;
      if (prevPush > 0) {
        var diff = Math.round(((thisPush - prevPush) / prevPush) * 100);
        convDelta = (diff >= 0 ? '+' : '') + diff + '% push vs sem-1';
      }
    }

    var insights = [
      {
        label: 'Meilleur jour',
        value: bestDayLabel,
        sub: bestDaySub,
        icon: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>'
      },
      {
        label: 'Série active',
        value: streak + (streak <= 1 ? ' jour' : ' jours'),
        sub: streakSub,
        modifier: streak >= 3 ? 'positive' : ''
      },
      {
        label: 'Conversion RDV',
        value: convPct + '%',
        sub: convDelta || (rdv + ' sur ' + total),
        modifier: convPct >= 10 ? 'positive' : (convPct === 0 ? 'negative' : '')
      }
    ];

    host.innerHTML = insights.map(function (it) {
      var cls = 'v30-perf__insight' + (it.modifier ? ' v30-perf__insight--' + it.modifier : '');
      return '<div class="' + cls + '">' +
        '<div class="v30-perf__insight-label">' + (it.icon || '') + esc(it.label) + '</div>' +
        '<div class="v30-perf__insight-value num">' + esc(it.value) + '</div>' +
        '<div class="v30-perf__insight-sub">' + esc(it.sub) + '</div>' +
      '</div>';
    }).join('');
  }

  function renderPerformanceChart(days, week) {
    var host = document.querySelector('[data-v30-perf] [data-field="chart"]');
    if (!host) return;
    if (!days || !days.length) {
      host.innerHTML = '<div class="empty" style="padding:28px 0;text-align:center;color:var(--text-3);font-size:12px;">Aucune donnée cette semaine.</div>';
      return;
    }
    if (typeof Chart === 'undefined') {
      host.innerHTML = '<div class="empty" style="padding:28px 0;text-align:center;color:var(--text-3);font-size:12px;">Chart.js non chargé.</div>';
      return;
    }
    host.innerHTML = '<canvas></canvas>';
    var canvas = host.querySelector('canvas');
    var labels = days.map(function (d) { return dayShort(d.date); });
    var contactsVals = days.map(function (d) { return (d.calls || 0) > 0 ? d.calls : Math.max(d.relances || 0, d.notes || 0); });
    var pushVals = days.map(function (d) { return d.push || 0; });
    var totalVals = days.map(function (d, i) { return contactsVals[i] + pushVals[i]; });

    var textMuted = (getComputedStyle(document.documentElement).getPropertyValue('--text-3') || '#94a3b8').trim();

    if (PERF_STATE.chart) { try { PERF_STATE.chart.destroy(); } catch (_) {} PERF_STATE.chart = null; }
    PERF_STATE.chart = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Contacts', data: contactsVals,
            backgroundColor: 'rgba(245, 158, 11, 0.7)',
            borderRadius: 4, borderSkipped: false, stack: 'stack0'
          },
          {
            label: 'Push', data: pushVals,
            backgroundColor: 'rgba(139, 92, 246, 0.7)',
            borderRadius: 4, borderSkipped: false, stack: 'stack0'
          },
          {
            label: 'Total', data: totalVals,
            type: 'line',
            borderColor: textMuted,
            borderWidth: 1.5,
            pointRadius: 3,
            pointBackgroundColor: textMuted,
            fill: false, tension: 0.3, order: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true, position: 'bottom',
            labels: { boxWidth: 8, boxHeight: 8, borderRadius: 4, useBorderRadius: true, font: { size: 10, weight: '600' }, padding: 12, color: textMuted }
          },
          tooltip: { backgroundColor: 'rgba(0,0,0,0.8)', padding: 8, cornerRadius: 8, displayColors: true, boxWidth: 8, boxHeight: 8, boxPadding: 3 }
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { font: { size: 10, weight: '600' }, color: textMuted } },
          y: { stacked: true, beginAtZero: true, grid: { color: 'rgba(148, 163, 184, 0.12)' }, ticks: { font: { size: 10 }, color: textMuted, stepSize: 1 } }
        },
        animation: { duration: 500 }
      }
    });
  }

  function updatePerfNav() {
    var root = $('[data-v30-perf]');
    if (!root) return;
    var label = root.querySelector('[data-field="weeklabel"]');
    var prev = root.querySelector('[data-v30-perf-prev]');
    var next = root.querySelector('[data-v30-perf-next]');
    var today = root.querySelector('[data-v30-perf-today]');
    if (label) label.textContent = weekLabel(PERF_STATE.weekOffset);
    if (prev) prev.disabled = PERF_STATE.weekOffset <= -52;
    if (next) next.disabled = PERF_STATE.weekOffset >= 0;
    if (today) today.hidden = PERF_STATE.weekOffset === 0;
  }
  function bindPerfNav() {
    var root = $('[data-v30-perf]');
    if (!root) return;
    root.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-v30-perf-prev],[data-v30-perf-next],[data-v30-perf-today]');
      if (!btn) return;
      if (btn.matches('[data-v30-perf-prev]')) PERF_STATE.weekOffset = Math.max(-52, PERF_STATE.weekOffset - 1);
      else if (btn.matches('[data-v30-perf-next]')) PERF_STATE.weekOffset = Math.min(0, PERF_STATE.weekOffset + 1);
      else PERF_STATE.weekOffset = 0;
      updatePerfNav();
      var url = '/api/dashboard' + (PERF_STATE.weekOffset < 0 ? ('?week=' + encodeURIComponent(isoWeek(PERF_STATE.weekOffset))) : '');
      fetchJSON(url)
        .then(function (res) { renderPerformance((res && res.data) || {}); renderObjectifs((res && res.data && res.data.goals) || null); })
        .catch(function () {});
    });
  }

  // ─── Objectifs (rings + daily/weekly items avec XP) ──────────────
  var OBJ_ICONS = {
    done: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    star: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    target: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
    alert: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
  };
  function iconForRatio(ratio, done) {
    if (done || ratio >= 1) return OBJ_ICONS.done;
    if (ratio >= 0.6) return OBJ_ICONS.star;
    if (ratio >= 0.2) return OBJ_ICONS.target;
    return OBJ_ICONS.alert;
  }
  function barColorForRatio(r) {
    if (r >= 1) return 'var(--success)';
    if (r >= 0.6) return 'oklch(0.70 0.18 75)';
    if (r >= 0.3) return 'oklch(0.68 0.17 45)';
    return 'var(--danger)';
  }

  function renderObjectifs(goals) {
    LAST_GOALS = goals || null;
    // Si la modale détail est ouverte, on rafraîchit son contenu en live.
    var detailModal = $('[data-v30-dash-goals-modal]');
    if (detailModal && !detailModal.hidden) renderGoalsDetail(LAST_GOALS);
    var root = $('[data-v30-objs]');
    if (!root) return;
    if (!goals || !goals.daily || !goals.weekly) {
      var items = root.querySelector('[data-field="items"]');
      if (items) items.innerHTML = '<div class="empty" style="padding:16px 0;text-align:center;color:var(--text-3);font-size:12px;">Objectifs indisponibles.</div>';
      return;
    }
    var daily = goals.daily, weekly = goals.weekly;
    var dayRatio = daily.xp_total ? Math.min(1, (daily.xp_current || 0) / daily.xp_total) : 0;
    var wkRatio  = weekly.xp_total ? Math.min(1, (weekly.xp_current || 0) / weekly.xp_total) : 0;
    var level = Math.floor((weekly.xp_current || 0) / 100) + 1;

    // rings
    var r1 = 52, r2 = 40;
    var c1 = 2 * Math.PI * r1, c2 = 2 * Math.PI * r2;
    var wkEl = root.querySelector('[data-field="ring-week"]');
    var dyEl = root.querySelector('[data-field="ring-day"]');
    if (wkEl) {
      wkEl.setAttribute('stroke-dasharray', c1.toFixed(2));
      wkEl.setAttribute('stroke-dashoffset', (c1 * (1 - wkRatio)).toFixed(2));
    }
    if (dyEl) {
      dyEl.setAttribute('stroke-dasharray', c2.toFixed(2));
      dyEl.setAttribute('stroke-dashoffset', (c2 * (1 - dayRatio)).toFixed(2));
    }
    var xpEl = root.querySelector('[data-field="xp"]');
    var lvEl = root.querySelector('[data-field="level"]');
    if (xpEl) xpEl.textContent = Math.round(weekly.xp_current || 0);
    if (lvEl) lvEl.textContent = 'Lv ' + level;

    var wPct = root.querySelector('[data-field="week-pct"]');
    var dPct = root.querySelector('[data-field="day-pct"]');
    if (wPct) wPct.textContent = Math.round(wkRatio * 100) + '%';
    if (dPct) dPct.textContent = Math.round(dayRatio * 100) + '%';

    var xpLine = root.querySelector('[data-field="xp-line"]');
    if (xpLine) xpLine.textContent =
      Math.round(daily.xp_current || 0) + '/' + Math.round(daily.xp_total || 0) + ' XP jour · ' +
      Math.round(weekly.xp_current || 0) + '/' + Math.round(weekly.xp_total || 0) + ' XP semaine';

    var esc = function (s) { var el = document.createElement('span'); el.textContent = s == null ? '' : String(s); return el.innerHTML; };
    var itemsEl = root.querySelector('[data-field="items"]');
    if (!itemsEl) return;
    var OBJ_ACTIONS = { push: 'push_ready', rdv: 'rdv_ready', sourcing_contacted: 'sourcing' };
    var html = '';
    var totalItems = 0;
    ['daily', 'weekly'].forEach(function (scope) {
      var obj = goals[scope];
      if (!obj || !obj.items) return;
      var keys = Object.keys(obj.items).filter(function (k) { return Number(obj.items[k].target || 0) > 0; });
      if (!keys.length) return;
      totalItems += keys.length;
      var title = scope === 'daily' ? 'Objectifs du jour' : 'Objectifs de la semaine';
      var xpLabel = Math.round(obj.xp_current || 0) + '/' + Math.round(obj.xp_total || 0) + ' XP';
      html += '<div class="v30-objs__scope">' + esc(title) + '<span class="v30-objs__scope-xp">' + esc(xpLabel) + '</span></div>';
      keys.forEach(function (k) {
        var it = obj.items[k];
        var ratio = Math.max(0, Math.min(1, Number(it.ratio) || 0));
        var done = !!it.done;
        var action = OBJ_ACTIONS[k] || '';
        var actionAttr = action ? ' data-obj-action="' + action + '" tabindex="0" role="button" title="Cliquer pour agir"' : '';
        // Report d'objectif non atteint la veille (jour ouvré précédent) :
        // pastille + tooltip pour expliquer la cible inflatée.
        var carry = Math.max(0, Number(it.carryover) || 0);
        var carryBadge = carry > 0
          ? ' <span class="v30-objs__item-carryover" title="Reporté du dernier jour ouvré non atteint">+' + carry + ' reporté</span>'
          : '';
        var metaTxt = '+' + Math.round(it.xp_earned || 0) + ' / ' + Math.round(it.xp || 0) + ' XP';
        if (carry > 0) {
          metaTxt += ' · cible ' + (it.base_target || 0) + ' + ' + carry + ' reporté';
        }
        html += '<div class="v30-objs__item' + (done ? ' v30-objs__item--done' : '') + (action ? ' v30-objs__item--clickable' : '') + '"' + actionAttr + '>' +
          '<span class="v30-objs__item-icon">' + iconForRatio(ratio, done) + '</span>' +
          '<div class="v30-objs__item-body">' +
            '<div class="v30-objs__item-top">' +
              '<span class="v30-objs__item-label">' + esc(it.label || k) + carryBadge + '</span>' +
              '<span class="v30-objs__item-count"><b>' + (it.count || 0) + '</b>/' + (it.target || 0) + '</span>' +
            '</div>' +
            '<div class="v30-objs__item-bar"><div class="v30-objs__item-fill" style="width:' + Math.round(ratio * 100) + '%;background:' + barColorForRatio(ratio) + ';"></div></div>' +
            '<div class="v30-objs__item-meta' + (carry > 0 ? ' v30-objs__item-meta--carry' : '') + '">' + metaTxt + '</div>' +
          '</div>' +
        '</div>';
      });
    });
    if (!totalItems) {
      html = '<div class="empty" style="padding:16px 0;text-align:center;color:var(--text-3);font-size:12px;">' +
        'Aucun objectif configuré. <a href="/v30/parametres#goals" style="color:var(--accent);">Configurer →</a>' +
      '</div>';
    }
    itemsEl.innerHTML = html;
    bindObjItemClicks(itemsEl);
  }

  function bindObjItemClicks(itemsEl) {
    itemsEl.addEventListener('click', function (e) {
      var item = e.target.closest('[data-obj-action]');
      if (!item) return;
      var action = item.dataset.objAction;
      if (action === 'push_ready') handleObjPush();
      else if (action === 'rdv_ready') handleObjRdv();
      else if (action === 'sourcing') handleObjSourcing();
    });
    itemsEl.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var item = e.target.closest('[data-obj-action]');
      if (!item) return;
      e.preventDefault();
      item.click();
    });
  }

  function handleObjPush() {
    fetchJSON('/api/prospects/quick-filter?preset=push_ready').then(function (res) {
      if (!res || !res.ok || !res.ids || !res.ids.length) {
        if (typeof showToast === 'function') showToast('Aucun prospect éligible au push (email dispo, pas de tél, push non envoyé)', 'info');
        return;
      }
      window.location.href = '/v30/prospect/' + res.ids[0];
    }).catch(function () {
      if (typeof showToast === 'function') showToast('Erreur lors du filtrage', 'error');
    });
  }

  function handleObjRdv() {
    fetchJSON('/api/prospects/quick-filter?preset=rdv_ready').then(function (res) {
      if (!res || !res.ok || !res.ids || !res.ids.length) {
        if (typeof showToast === 'function') showToast('Aucun prospect éligible (Messagerie/Pas d\'actions/À rappeler avec téléphone)', 'info');
        return;
      }
      return fetch('/api/mode-prosp/start', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: res.ids })
        }).then(function (r) { return r.json(); }).then(function (r) {
        if (!r || !r.ok || !r.token) throw new Error((r && r.error) || 'Token manquant');
        window.open('/v30/mode-prosp?t=' + encodeURIComponent(r.token), '_blank');
      });
    }).catch(function (e) {
      if (typeof showToast === 'function') showToast('Erreur Mode Prosp : ' + (e && e.message), 'error');
    });
  }

  function handleObjSourcing() {
    window.open('https://www.linkedin.com/talent/contract-chooser/?trk=nav_account_sub_nav_cap', '_blank');
    window.location.href = '/v30/sourcing#inmails';
  }

  // ─── Quick access — Besoins ouverts ──────────────────────────────
  var BESOIN_STATUT = {
    'ouvert':    { cls: 'badge-danger', label: 'Ouvert' },
    'en_cours':  { cls: 'badge-warn',   label: 'En cours' },
    'pourvu':    { cls: 'badge-info',   label: 'Pourvu' },
    'abandonne': { cls: 'badge-info',   label: 'Abandonné' }
  };

  function renderBesoinsOuverts(payload) {
    var host = $('[data-v30-besoins]');
    if (!host) return false;
    var rows = host.querySelector('[data-field="rows"]');
    var count = host.querySelector('[data-field="count"]');
    var items = (payload && payload.items) || [];
    var openTotal = (payload && payload.open_total) || 0;
    var inprogTotal = (payload && payload.inprogress_total) || 0;
    var total = openTotal + inprogTotal;

    if (!items.length) {
      // Panneau vide → on le masque (le widget Aperçu rapide prend le relais).
      host.hidden = true;
      return false;
    }
    host.hidden = false;
    if (count) {
      count.textContent = total + (total > 1 ? ' besoins' : ' besoin');
    }
    if (!rows) return true;
    var esc = function (s) { var e = document.createElement('span'); e.textContent = s == null ? '' : String(s); return e.innerHTML; };
    rows.innerHTML = items.map(function (b) {
      var st = BESOIN_STATUT[b.statut] || { cls: 'badge-info', label: b.statut || '' };
      var sub = b.company_name || b.client || b.prospect_name || '—';
      if (b.localisation) sub += ' · ' + b.localisation;
      var cands = b.candidats_count || 0;
      var dateHint = b.date_besoin
        ? '<span class="v30-quick__hint">' + esc(b.date_besoin) + '</span>'
        : '';
      var candHint = cands > 0
        ? '<span class="v30-quick__hint">' + cands + ' cand.</span>'
        : '';
      return '<a class="v30-quick__row" href="/v30/besoins/' + encodeURIComponent(b.id) + '">' +
        '<span class="v30-quick__icon v30-quick__icon--besoin">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="1"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>' +
        '</span>' +
        '<div style="min-width:0;flex:1;">' +
          '<div class="v30-quick__name truncate">' + esc(b.intitule) + '</div>' +
          '<div class="v30-quick__sub truncate">' + esc(sub) + '</div>' +
        '</div>' +
        '<div class="v30-quick__tail">' +
          dateHint + candHint +
          '<span class="badge ' + st.cls + '">' + esc(st.label) + '</span>' +
        '</div>' +
      '</a>';
    }).join('');
    return true;
  }

  // ─── Quick access — Derniers candidats EC ────────────────────────
  function renderRecentEC(items) {
    var host = $('[data-v30-recent-ec]');
    if (!host) return false;
    var rows = host.querySelector('[data-field="rows"]');
    items = items || [];
    if (!items.length) {
      // Panneau vide → on le masque (le widget Aperçu rapide prend le relais).
      host.hidden = true;
      return false;
    }
    host.hidden = false;
    if (!rows) return true;
    var esc = function (s) { var e = document.createElement('span'); e.textContent = s == null ? '' : String(s); return e.innerHTML; };
    rows.innerHTML = items.map(function (c) {
      var roleParts = [];
      if (c.role) roleParts.push(c.role);
      if (c.seniority) roleParts.push(c.seniority);
      if (c.location) roleParts.push(c.location);
      var sub = roleParts.join(' · ') || (c.tech ? c.tech : '—');
      var dateLabel = relativeTime(c.entretien_date) || esc(c.entretien_date || '');
      var lieu = c.entretien_lieu ? ' · ' + esc(c.entretien_lieu) : '';
      return '<a class="v30-quick__row" href="/v30/candidat/' + encodeURIComponent(c.id) + '">' +
        '<span class="avatar">' + esc(initials(c.name)) + '</span>' +
        '<div style="min-width:0;flex:1;">' +
          '<div class="v30-quick__name truncate">' + esc(c.name) + '</div>' +
          '<div class="v30-quick__sub truncate">' + esc(sub) + '</div>' +
        '</div>' +
        '<div class="v30-quick__tail">' +
          '<span class="v30-quick__hint">EC ' + dateLabel + lieu + '</span>' +
        '</div>' +
      '</a>';
    }).join('');
    return true;
  }

  // ─── Aperçu rapide — fallback affiché quand besoins/recent_ec sont vides ──
  function renderQuickStats(data, hasBesoins, hasRecentEC) {
    var host = $('[data-v30-quick-stats]');
    if (!host) return;
    // Si les deux panneaux ont du contenu → on cache le widget Aperçu rapide.
    if (hasBesoins && hasRecentEC) {
      host.hidden = true;
      host.classList.remove('v30-quick-stats--full');
      return;
    }
    host.hidden = false;
    // Quand les deux panneaux sont vides → la carte prend toute la largeur.
    host.classList.toggle('v30-quick-stats--full', !hasBesoins && !hasRecentEC);

    var week = data.week || {};
    var prev = data.prev_week || {};
    var pipeline = data.pipeline || {};

    var setVal = function (field, value) {
      var el = host.querySelector('[data-field="' + field + '"]');
      if (el) el.textContent = (value == null || value === '') ? '—' : value;
    };
    var setSub = function (field, current, previous, suffix) {
      var el = host.querySelector('[data-field="' + field + '"]');
      if (!el) return;
      if (typeof current !== 'number' || typeof previous !== 'number') {
        el.textContent = suffix || '';
        el.classList.remove('is-pos', 'is-neg');
        return;
      }
      var d = current - previous;
      var sign = d > 0 ? '+' : (d < 0 ? '−' : '±');
      el.textContent = sign + Math.abs(d) + ' vs sem-1';
      el.classList.toggle('is-pos', d > 0);
      el.classList.toggle('is-neg', d < 0);
    };

    setVal('prospects', pipeline.total != null ? pipeline.total : '—');
    setVal('rdv', week.rdv_total != null ? week.rdv_total : '—');
    setSub('rdv-sub', null, null, 'cette semaine');
    setVal('push', week.push_total != null ? week.push_total : '—');
    setSub('push-sub', week.push_total, prev.push_total, 'cette semaine');

    // Conversion = part de prospects au statut Rendez-vous sur le pipeline actif
    var total = pipeline.total || 0;
    var rdv = pipeline.rdv || 0;
    if (total > 0) {
      var pct = Math.round((rdv / total) * 100 * 10) / 10;
      setVal('conv', pct + '%');
    } else {
      setVal('conv', '—');
    }
  }

  function hydrate() {
    var url = '/api/dashboard' + (PERF_STATE.weekOffset < 0 ? ('?week=' + encodeURIComponent(isoWeek(PERF_STATE.weekOffset))) : '');
    fetchJSON(url)
      .then(function (res) {
        var data = (res && res.data) || {};
        renderHero(data);
        var hasBesoins = renderBesoinsOuverts(data.besoins);
        var hasRecentEC = renderRecentEC(data.recent_ec);
        renderQuickStats(data, hasBesoins, hasRecentEC);
        renderPerformance(data);
        renderObjectifs(data.goals);
        renderGoals(data.goals);
        renderActivity(data.feed);
        return Promise.all([Promise.resolve(data), fetchJSON('/api/tasks?status=pending').catch(function () { return { tasks: [] }; })]);
      })
      .then(function (both) {
        renderActionCenter(both[0], both[1]);
      })
      .catch(function (err) {
        console.error('[v30 dashboard] /api/dashboard failed:', err);
      });

    fetchJSON('/api/dashboard/pipeline-stages')
      .then(function (res) {
        renderPipeline(res.stages, res.total);
        renderPriorities(res.priority_prospects);
      })
      .catch(function (err) {
        console.error('[v30 dashboard] pipeline-stages failed:', err);
      });
  }

  function bindRefresh() {
    var btn = $('[data-v30-refresh]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      btn.disabled = true;
      var label = btn.textContent;
      btn.textContent = 'Actualisation…';
      Promise.resolve(hydrate()).then(function () {
        setTimeout(function () {
          btn.disabled = false;
          btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg> Rafraîchir';
        }, 400);
      });
    });
  }

  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
  }

  function openModal(modal) {
    if (!modal) return;
    modal.hidden = false;
    // force reflow for transition
    void modal.offsetWidth;
    modal.classList.add('is-open');
    var first = modal.querySelector('input, select, textarea, button');
    if (first) try { first.focus(); } catch (_) {}
  }
  function closeModal(modal) {
    if (!modal) return;
    modal.classList.remove('is-open');
    setTimeout(function () { modal.hidden = true; }, 160);
  }
  function bindModalDismiss(modal) {
    if (!modal) return;
    modal.addEventListener('click', function (e) {
      if (e.target === modal || e.target.closest('[data-v30-modal-close]')) {
        closeModal(modal);
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.hidden) closeModal(modal);
    });
  }

  function openKpiModal() {
    var modal = $('[data-v30-dash-kpi-modal]');
    if (!modal) return;
    var today = new Date().toISOString().slice(0, 10);
    var dateEl = $('#v30-dash-kpi-date');
    if (dateEl) dateEl.value = today;
    var countEl = $('#v30-dash-kpi-count');
    if (countEl) countEl.value = '1';
    var descEl = $('#v30-dash-kpi-desc');
    if (descEl) descEl.value = '';
    openModal(modal);
  }

  function saveKpi() {
    var type = ($('#v30-dash-kpi-type') || {}).value || 'note';
    var date = ($('#v30-dash-kpi-date') || {}).value || new Date().toISOString().slice(0, 10);
    var count = parseInt(($('#v30-dash-kpi-count') || {}).value || '1', 10);
    var desc = ($('#v30-dash-kpi-desc') || {}).value || '';
    var btn = $('[data-v30-dash-kpi-save]');
    if (btn) btn.disabled = true;
    fetch('/api/manual-kpi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: type, date: date, count: count, description: desc })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.ok) {
          toast('KPI enregistré', 'success');
          closeModal($('[data-v30-dash-kpi-modal]'));
          hydrate();
        } else {
          toast('Erreur : ' + ((data && data.error) || 'Inconnue'), 'error');
        }
      })
      .catch(function (e) { toast('Erreur : ' + (e.message || 'réseau'), 'error'); })
      .then(function () { if (btn) btn.disabled = false; });
  }

  // ─── Goals detail modal (info button next to "Objectifs") ───────
  function goalsKindLabel(kind) {
    if (!kind) return 'Source';
    if (kind === 'rdv_taken') return 'RDV pris (transition statut)';
    if (kind === 'push_email') return 'Push email';
    if (kind === 'push_linkedin') return 'Push LinkedIn';
    if (kind === 'candidate_contacted') return 'Candidat contacté';
    if (kind === 'candidate_solid') return 'Candidat solide';
    if (kind === 'linkedin_inmail') return 'InMail LinkedIn';
    if (kind.indexOf('manual:') === 0) {
      var t = kind.slice(7);
      var map = {
        rdv: 'KPI manuel — RDV',
        push_email: 'KPI manuel — Push email',
        push_linkedin: 'KPI manuel — Push LinkedIn',
        sourcing: 'KPI manuel — Sourcing',
        contact: 'KPI manuel — Contact'
      };
      return map[t] || ('KPI manuel — ' + t);
    }
    return kind;
  }

  function goalsKindClass(kind) {
    if (!kind) return 'v30-objs-detail__kind--neutral';
    if (kind === 'rdv_taken') return 'v30-objs-detail__kind--rdv';
    if (kind === 'push_email' || kind === 'push_linkedin') return 'v30-objs-detail__kind--push';
    if (kind === 'candidate_contacted' || kind === 'candidate_solid' || kind === 'linkedin_inmail') return 'v30-objs-detail__kind--src';
    if (kind.indexOf('manual:') === 0) return 'v30-objs-detail__kind--manual';
    return 'v30-objs-detail__kind--neutral';
  }

  function renderGoalsDetail(goals) {
    var modal = $('[data-v30-dash-goals-modal]');
    if (!modal) return;
    var host = modal.querySelector('[data-field="content"]');
    if (!host) return;
    var esc = function (s) { var e = document.createElement('span'); e.textContent = s == null ? '' : String(s); return e.innerHTML; };
    if (!goals || !goals.breakdown) {
      host.innerHTML = '<div class="empty" style="padding:18px 0;text-align:center;color:var(--text-3);font-size:12.5px;">' +
        'Données indisponibles. Recharge le dashboard.' +
        '</div>';
      return;
    }
    var bd = goals.breakdown || {};

    function renderScope(scopeKey, scopeLabel) {
      var scopeBd = bd[scopeKey] || {};
      var scopeItems = (goals[scopeKey] && goals[scopeKey].items) || {};
      var keys = Object.keys(scopeItems).filter(function (k) { return Number(scopeItems[k].target || 0) > 0; });
      if (!keys.length) return '';
      var rows = keys.map(function (k) {
        var it = scopeItems[k] || {};
        var sources = scopeBd[k] || [];
        var sourceRows;
        if (!sources.length) {
          sourceRows = '<div class="v30-objs-detail__empty">Aucune source pour cet objectif sur la période.</div>';
        } else {
          sourceRows = sources.map(function (s) {
            var who = s.prospect_name || s.candidate_name || s.description || '—';
            var sub = [];
            if (s.kind === 'rdv_taken' && s.rdvDate) sub.push('RDV ' + s.rdvDate);
            if (s.subject) sub.push(s.subject);
            if (s.url) sub.push(s.url.replace(/^https?:\/\//, '').slice(0, 40));
            if (typeof s.count === 'number' && s.count !== 0) sub.push((s.count > 0 ? '+' : '') + s.count);
            if (s.description && s.kind && s.kind.indexOf('manual:') === 0) sub.push(s.description);
            var when = s.date || (s.createdAt || '').slice(0, 10) || '—';
            return '<div class="v30-objs-detail__src">' +
              '<span class="v30-objs-detail__kind ' + goalsKindClass(s.kind) + '">' + esc(goalsKindLabel(s.kind)) + '</span>' +
              '<div class="v30-objs-detail__src-body">' +
                '<div class="v30-objs-detail__who">' + esc(who) + '</div>' +
                (sub.length ? '<div class="v30-objs-detail__sub">' + esc(sub.join(' · ')) + '</div>' : '') +
              '</div>' +
              '<span class="v30-objs-detail__date">' + esc(when) + '</span>' +
            '</div>';
          }).join('');
        }
        var count = it.count || 0;
        var target = it.target || 0;
        var doneCls = (target > 0 && count >= target) ? ' v30-objs-detail__goal--done' : '';
        return '<div class="v30-objs-detail__goal' + doneCls + '">' +
          '<div class="v30-objs-detail__goal-head">' +
            '<span class="v30-objs-detail__goal-label">' + esc(it.label || k) + '</span>' +
            '<span class="v30-objs-detail__goal-count"><b>' + count + '</b> / ' + target + '</span>' +
          '</div>' +
          '<div class="v30-objs-detail__sources">' + sourceRows + '</div>' +
        '</div>';
      }).join('');
      return '<section class="v30-objs-detail__scope">' +
        '<h3 class="v30-objs-detail__scope-title">' + esc(scopeLabel) + '</h3>' +
        rows +
      '</section>';
    }

    var html = renderScope('daily', 'Aujourd’hui') + renderScope('weekly', 'Cette semaine');
    if (!html) {
      html = '<div class="empty" style="padding:18px 0;text-align:center;color:var(--text-3);font-size:12.5px;">' +
        'Aucun objectif configuré. <a href="/v30/parametres#goals" style="color:var(--accent);">Configurer →</a>' +
        '</div>';
    }
    host.innerHTML = html;
  }

  function openGoalsDetailModal() {
    var modal = $('[data-v30-dash-goals-modal]');
    if (!modal) return;
    renderGoalsDetail(LAST_GOALS);
    openModal(modal);
  }

  function exportDay() {
    var btn = $('[data-v30-dash-export]');
    if (btn) btn.disabled = true;
    fetch('/api/export/day')
      .then(function (r) { return r.json(); })
      .then(function (json) {
        if (!json || !json.ok) throw new Error((json && json.error) || 'Erreur');
        var recap = json.recap || {};
        var dateStr = recap.date || new Date().toISOString().slice(0, 10);
        var blob = new Blob([JSON.stringify(recap, null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'ProspUp_recap_' + dateStr + '.json';
        a.click();
        URL.revokeObjectURL(a.href);
        toast('Récap du jour téléchargé', 'success');
      })
      .catch(function (e) { toast(e.message || 'Erreur export', 'error'); })
      .then(function () { if (btn) btn.disabled = false; });
  }

  function bindHeroActions() {
    var btnKpi = $('[data-v30-dash-kpi-manual]');
    if (btnKpi) btnKpi.addEventListener('click', openKpiModal);
    var btnExport = $('[data-v30-dash-export]');
    if (btnExport) btnExport.addEventListener('click', exportDay);
    var btnSave = $('[data-v30-dash-kpi-save]');
    if (btnSave) btnSave.addEventListener('click', saveKpi);
    var btnGoalsDetail = $('[data-v30-objs-detail]');
    if (btnGoalsDetail) btnGoalsDetail.addEventListener('click', openGoalsDetailModal);
    bindModalDismiss($('[data-v30-dash-kpi-modal]'));
    bindModalDismiss($('[data-v30-dash-goals-modal]'));
  }

  function initAll() {
    hydrate();
    bindRefresh();
    bindHeroActions();
    bindPerfNav();
    updatePerfNav();
    // Auto-refresh quand l'onglet redevient actif
    var lastRefresh = Date.now();
    function maybeRefresh() {
      if (document.hidden) return;
      var now = Date.now();
      if (now - lastRefresh < 5000) return;
      lastRefresh = now;
      hydrate();
    }
    document.addEventListener('visibilitychange', maybeRefresh);
    window.addEventListener('focus', maybeRefresh);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
})();
