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
      var dueToday = (data && data.pipeline && data.pipeline.due_today) || 0;
      subtitle.innerHTML = 'Tu as <b>' + overdue + ' relance' + (overdue > 1 ? 's' : '') +
        '</b> en retard et <b>' + dueToday + ' RDV</b> aujourd\'hui.';
    }

    var kpis = [
      { key: 'rdv',      cur: data.week && data.week.rdv_total,   prev: null },
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
      // Pas de table streak/xp en DB — on affiche le total de la série si dispo,
      // sinon fallback sur nb de jours actifs cette semaine via data.week.days
      var days = (data.week && data.week.days) || [];
      var active = days.filter(function (d) {
        return (d.push || 0) + (d.rdv || 0) + (d.notes || 0) + (d.calls || 0) > 0;
      }).length;
      streak.innerHTML = active + ' jour' + (active > 1 ? 's' : '') +
        ' <span class="muted">cette semaine</span>';
    }
  }

  // ─── Action center ────────────────────────────────────────────────
  function statusPill(statut) {
    var map = {
      'Rendez-vous':  { cls: 'status-meeting',  label: statut },
      'Prospecté':    { cls: 'status-new',      label: statut },
      'Contacté':     { cls: 'status-contact',  label: statut },
      'À rappeler':   { cls: 'status-proposal', label: statut },
      'Proposition':  { cls: 'status-proposal', label: statut },
      'Gagné':        { cls: 'status-won',      label: statut },
      'Perdu':        { cls: 'status-lost',     label: statut }
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
    var rdvList = (data.feed && data.feed.rdv) || [];
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
  }

  // ─── Pipeline ─────────────────────────────────────────────────────
  function renderPipeline(stages, total) {
    var host = $('[data-v30-pipeline]');
    if (!host) return;

    // Mapping clé SQL/API → label + couleur
    var order = [
      { key: 'appel',        label: 'Prospecter',   bg: 'var(--info-soft)',            fg: 'var(--info)' },
      { key: 'rdv',          label: 'Contacté',     bg: 'var(--accent-soft)',          fg: 'var(--accent)' },
      { key: 'besoin',       label: 'RDV',          bg: 'oklch(0.92 0.05 280)',        fg: 'oklch(0.50 0.15 280)' },
      { key: 'reunion_tech', label: 'Proposition',  bg: 'var(--warn-soft)',            fg: 'oklch(0.50 0.14 75)' },
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

  function hydrate() {
    fetchJSON('/api/dashboard')
      .then(function (res) {
        var data = (res && res.data) || {};
        renderHero(data);
        renderGoals(data.goals);
        renderActivity(data.feed);
        // Action center RDV + En retard viennent de /api/dashboard ;
        // À faire arrive via /api/tasks, combiner après.
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { hydrate(); bindRefresh(); });
  } else {
    hydrate();
    bindRefresh();
  }
})();
