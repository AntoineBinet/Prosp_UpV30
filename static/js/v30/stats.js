/* ProspUp v30 — Stats / Tableau de bord
   Hero KPIs + Performance card + Pipeline + Urgence +
   Top entreprises + Top consultants pushés + charts secondaires.
   APIs : /api/stats, /api/stats/charts, /api/stats/data, /api/stats/export. */
(function () {
  'use strict';

  // ─── Constantes visuelles ──────────────────────────────
  var COLORS = {
    accent:   getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#5a7cff',
    success:  '#22c55e',
    warn:     '#f59e0b',
    info:     '#0ea5e9',
    danger:   '#ef4444',
    contacts: '#f59e0b',
    notes:    '#6366f1',
    push:     '#0ea5e9',
    rdv:      '#22c55e'
  };

  var STATUS_PALETTE = {
    "Pas d'actions": '#94a3b8',
    'Appelé':        '#3b82f6',
    'À rappeler':    '#f59e0b',
    'Messagerie':    '#8b5cf6',
    'Rendez-vous':   '#22c55e',
    'Prospecté':     '#10b981',
    'Pas intéressé': '#ef4444'
  };

  var STATE = {
    period: 30,                 // 7 / 30 / 90 / 'all'  (toolbar segmented)
    cursor: new Date(),         // mois courant (period-month-nav)
    customStart: null,          // Date | null
    customEnd: null,            // Date | null
    activeStatuts: [],          // [] = tous
    activeTags: [],             // [] = tous
    chartInstances: {},         // { id: Chart }
    statsCharts: null,          // dernier payload /api/stats/charts
    statsData: null,            // dernier payload /api/stats/data
    statsTotals: null           // dernier payload /api/stats
  };

  var MONTH_NAMES = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];

  // ─── Helpers ───────────────────────────────────────────
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) { var t = document.createElement('span'); t.textContent = s == null ? '' : String(s); return t.innerHTML; }
  function fmt(v) { return Number(v || 0).toLocaleString('fr-FR'); }
  function fetchJSON(url) {
    return fetch(url, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function isoMonth(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function monthLabel(d) { return MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear(); }
  function isDark() { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches; }
  function chartColors() {
    return {
      text: isDark() ? '#e2e8f0' : '#475569',
      grid: isDark() ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'
    };
  }

  // ─── Sparkline SVG (inspiré de dashboard.js) ───────────
  function sparklineSVG(values, color, w, h, opts) {
    w = w || 60; h = h || 22;
    if (!values || !values.length) return '';
    var max = Math.max(1, Math.max.apply(null, values));
    var pts = values.map(function (v, i) {
      var x = values.length > 1 ? (i / (values.length - 1)) * w : w / 2;
      var y = h - ((v / max) * (h - 4)) - 2;
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    var lastPt = pts[pts.length - 1].split(',');
    var areaPts = (opts && opts.area)
      ? pts.concat([w + ',' + h, '0,' + h])
      : null;
    var areaPath = areaPts
      ? '<polygon points="' + areaPts.join(' ') + '" fill="' + color + '" opacity="0.15"/>'
      : '';
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true">' +
      areaPath +
      '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + color + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="' + lastPt[0] + '" cy="' + lastPt[1] + '" r="2" fill="' + color + '"/>' +
    '</svg>';
  }

  function trendBadge(current, previous) {
    if (previous == null || previous === 0) return '';
    var diff = current - previous;
    var pct = Math.round((diff / previous) * 100);
    if (diff > 0) return '<span class="v30-perf__trend v30-perf__trend--up">+' + pct + '%</span>';
    if (diff < 0) return '<span class="v30-perf__trend v30-perf__trend--down">' + pct + '%</span>';
    return '<span class="v30-perf__trend v30-perf__trend--flat">=</span>';
  }

  // ─── Tabs (dashboard / rapport) ────────────────────────
  function bindTabs() {
    var host = $('[data-v30-stats-tabs]');
    if (!host) return;
    host.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-tab]');
      if (!btn) return;
      var key = btn.dataset.tab;
      $$('button[data-tab]', host).forEach(function (b) {
        var active = (b === btn);
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      $$('[data-v30-stats-panel]').forEach(function (p) {
        p.hidden = (p.dataset.v30StatsPanel !== key);
      });
    });
  }

  // ─── Période rapide (7/30/90/all) ──────────────────────
  function bindPeriod() {
    var host = $('[data-v30-stats-period]');
    if (!host) return;
    host.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-period]');
      if (!btn) return;
      $$('button[data-period]', host).forEach(function (b) {
        b.classList.toggle('active', b === btn);
      });
      STATE.period = btn.dataset.period === 'all' ? 'all' : parseInt(btn.dataset.period, 10);
      // période rapide → bypass mois custom
      STATE.customStart = null;
      STATE.customEnd = null;
      reloadAll();
    });
  }

  // ─── Période mensuelle / range custom ─────────────────
  function buildParams() {
    // Pour /api/stats/data (mensuel) — accepte period=YYYY-MM ou start/end
    var p = new URLSearchParams();
    if (STATE.customStart && STATE.customEnd) {
      p.set('start', STATE.customStart.toISOString().slice(0, 10));
      p.set('end', STATE.customEnd.toISOString().slice(0, 10));
    } else {
      p.set('period', isoMonth(STATE.cursor));
    }
    if (STATE.activeStatuts.length) p.set('statuts', STATE.activeStatuts.join(','));
    if (STATE.activeTags.length)    p.set('tags', STATE.activeTags.join(','));
    return p.toString();
  }
  function buildTotalsParams() {
    // Pour /api/stats — accepte days, range=all ou start/end
    var p = new URLSearchParams();
    if (STATE.customStart && STATE.customEnd) {
      p.set('start', STATE.customStart.toISOString().slice(0, 10));
      p.set('end', STATE.customEnd.toISOString().slice(0, 10));
    } else if (STATE.period === 'all') {
      p.set('range', 'all');
    } else {
      p.set('days', String(STATE.period));
    }
    return p.toString();
  }
  function updateMonthLabel() {
    var el = $('[data-stats-month-label]');
    if (!el) return;
    if (STATE.customStart && STATE.customEnd) {
      var f = function (d) { return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }); };
      el.textContent = f(STATE.customStart) + ' – ' + f(STATE.customEnd);
    } else {
      el.textContent = monthLabel(STATE.cursor);
    }
  }
  function bindMonthNav() {
    var prev = $('[data-stats-month-prev]'),
        next = $('[data-stats-month-next]'),
        today = $('[data-stats-month-today]');
    if (prev) prev.addEventListener('click', function () {
      STATE.customStart = null; STATE.customEnd = null;
      STATE.cursor = new Date(STATE.cursor.getFullYear(), STATE.cursor.getMonth() - 1, 1);
      // Désactiver segmented period (on est en mode mensuel)
      $$('[data-v30-stats-period] button').forEach(function (b) { b.classList.remove('active'); });
      updateMonthLabel(); reloadAll();
    });
    if (next) next.addEventListener('click', function () {
      STATE.customStart = null; STATE.customEnd = null;
      STATE.cursor = new Date(STATE.cursor.getFullYear(), STATE.cursor.getMonth() + 1, 1);
      $$('[data-v30-stats-period] button').forEach(function (b) { b.classList.remove('active'); });
      updateMonthLabel(); reloadAll();
    });
    if (today) today.addEventListener('click', function () {
      STATE.customStart = null; STATE.customEnd = null;
      STATE.cursor = new Date();
      // Reset au défaut (30j)
      STATE.period = 30;
      $$('[data-v30-stats-period] button').forEach(function (b) {
        b.classList.toggle('active', b.dataset.period === '30');
      });
      updateMonthLabel(); reloadAll();
    });
  }
  function bindRangeModal() {
    var open = $('[data-stats-range-open]'),
        modal = $('#statsRangeModal');
    if (!modal) return;
    function close() { modal.hidden = true; }
    if (open) open.addEventListener('click', function () {
      modal.hidden = false;
      var sI = $('[data-stats-range-start]', modal),
          eI = $('[data-stats-range-end]', modal);
      if (sI && STATE.customStart) sI.value = STATE.customStart.toISOString().slice(0, 10);
      if (eI && STATE.customEnd)   eI.value = STATE.customEnd.toISOString().slice(0, 10);
    });
    $$('[data-stats-range-close]', modal).forEach(function (el) { el.addEventListener('click', close); });
    var applyBtn = $('[data-stats-range-apply]', modal);
    if (applyBtn) applyBtn.addEventListener('click', function () {
      var s = $('[data-stats-range-start]', modal).value,
          e = $('[data-stats-range-end]', modal).value;
      if (s && e) {
        STATE.customStart = new Date(s);
        STATE.customEnd = new Date(e);
        $$('[data-v30-stats-period] button').forEach(function (b) { b.classList.remove('active'); });
        close(); updateMonthLabel(); reloadAll();
      }
    });
    document.addEventListener('keydown', function (ev) {
      if (!modal.hidden && ev.key === 'Escape') close();
    });
  }

  // ─── Filtres statut + tags ─────────────────────────────
  function bindFilters() {
    var bar = $('[data-stats-filter-bar]');
    if (!bar) return;
    bar.addEventListener('click', function (e) {
      var chip = e.target.closest('[data-chip-statut]');
      if (chip) {
        var val = chip.dataset.chipStatut;
        if (val === '') {
          STATE.activeStatuts = [];
          $$('[data-chip-statut]', bar).forEach(function (c) {
            c.classList.toggle('is-active', c.dataset.chipStatut === '');
          });
        } else {
          var idx = STATE.activeStatuts.indexOf(val);
          if (idx >= 0) STATE.activeStatuts.splice(idx, 1);
          else STATE.activeStatuts.push(val);
          var allChip = bar.querySelector('[data-chip-statut=""]');
          if (allChip) allChip.classList.toggle('is-active', STATE.activeStatuts.length === 0);
          chip.classList.toggle('is-active', STATE.activeStatuts.indexOf(val) >= 0);
        }
        reloadAll();
        return;
      }
      var tagChip = e.target.closest('[data-chip-tag]');
      if (tagChip) {
        var t = tagChip.dataset.chipTag;
        var ti = STATE.activeTags.indexOf(t);
        if (ti >= 0) STATE.activeTags.splice(ti, 1);
        else STATE.activeTags.push(t);
        tagChip.classList.toggle('is-active', STATE.activeTags.indexOf(t) >= 0);
        reloadAll();
      }
    });
  }
  function renderTagChips() {
    var c = $('#statsTagChips');
    if (!c) return;
    var tags = [];
    var top = (STATE.statsData && STATE.statsData.top_companies) || [];
    var seen = {};
    top.forEach(function (x) { if (x.name && !seen[x.name]) { seen[x.name] = 1; tags.push(x.name); } });
    if (!tags.length) { c.innerHTML = ''; return; }
    var html = '<span class="filter-bar__label">Entreprise</span>';
    tags.slice(0, 6).forEach(function (t) {
      var safe = t.replace(/"/g, '&quot;').replace(/</g, '&lt;');
      var act = STATE.activeTags.indexOf(t) >= 0 ? ' is-active' : '';
      html += '<span class="v30-chip' + act + '" data-chip-tag="' + safe + '">' + safe + '</span>';
    });
    c.innerHTML = html;
  }

  // ─── Export JSON / CSV ─────────────────────────────────
  function bindExport() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-stats-export]');
      if (!btn) return;
      var fmt2 = btn.dataset.statsExport;
      var p = buildParams() + '&format=' + fmt2;
      window.location.href = '/api/stats/export?' + p;
    });
  }

  // ─── Headline (sub-titre dynamique) ────────────────────
  function setHeadline() {
    var el = $('[data-stats-headline]');
    if (!el) return;
    var t = STATE.statsTotals;
    if (!t) return;
    var totals = t.totals || {};
    var act = t.activity || {};
    var statusC = t.statusCounts || {};
    var rdv = t.rdv != null ? t.rdv : (statusC.Rendezvous || 0);
    var totalP = totals.prospects || t.total_prospects || 0;
    var conv = totalP > 0 ? Math.round((rdv / totalP) * 1000) / 10 : 0;
    var period;
    if (STATE.customStart && STATE.customEnd) period = 'plage personnalisée';
    else if (STATE.period === 'all') period = 'tout l\'historique';
    else period = STATE.period + ' derniers jours';

    el.innerHTML = '<b>' + fmt(rdv) + '</b> RDV · <b>' + fmt(act.calls || 0) + '</b> appels · ' +
                   '<b>' + fmt(act.pushes || 0) + '</b> push · taux <b>' + conv.toFixed(1).replace('.', ',') + '%</b> · ' +
                   '<span class="muted">' + period + '</span>';
  }

  // ─── Hero KPIs (4 grosses cards serif) ─────────────────
  function setKPI(key, value, deltaLabel, deltaIsPos) {
    var v = $('[data-kpi="' + key + '"]');
    if (v) v.textContent = value == null ? '—' : value;
    var d = $('[data-kpi-delta="' + key + '"]');
    if (d) {
      d.classList.remove('is-pos', 'is-neg');
      if (deltaLabel == null) { d.innerHTML = '&nbsp;'; }
      else {
        d.textContent = deltaLabel;
        if (deltaIsPos === true) d.classList.add('is-pos');
        if (deltaIsPos === false) d.classList.add('is-neg');
      }
    }
  }
  function setKPISpark(key, values, color) {
    var host = $('[data-kpi-spark="' + key + '"]');
    if (!host) return;
    host.innerHTML = sparklineSVG(values, color, 70, 24, { area: true });
  }

  function renderHeroKPIs() {
    var t = STATE.statsTotals || {};
    var c = STATE.statsCharts || {};
    var d = STATE.statsData || {};
    var totals = t.totals || {};
    var act = t.activity || {};
    var statusC = t.statusCounts || {};
    var totalP = totals.prospects || t.total_prospects || 0;
    var rdv = t.rdv != null ? t.rdv : (statusC.Rendezvous || 0);

    // RDV avec sparkline mensuelle
    setKPI('rdv', fmt(rdv));
    setKPISpark('rdv', (c.rdvPerMonth || []).map(function (x) { return x.count; }), COLORS.success);

    // Conversion
    var convPct = totalP > 0 ? (rdv / totalP) * 100 : 0;
    setKPI('conv', convPct.toFixed(1).replace('.', ',') + '%');
    var funnel = (d.funnel || {});
    if (funnel.conversion_rate != null && funnel.prospects > 0) {
      var fr = Math.round((funnel.conversion_rate || 0) * 1000) / 10;
      setKPI('conv', fr.toFixed(1).replace('.', ',') + '%',
             fmt(funnel.rdv || 0) + ' RDV / ' + fmt(funnel.prospects || 0) + ' prosp', null);
    }

    // Calls : courbe = activityPerWeek calls
    setKPI('calls', fmt(act.calls != null ? act.calls : 0));
    setKPISpark('calls', (c.activityPerWeek || []).map(function (x) { return x.calls || 0; }), COLORS.warn);

    // Push
    setKPI('push', fmt(act.pushes != null ? act.pushes : 0));
    setKPISpark('push', (c.activityPerWeek || []).map(function (x) { return x.push || 0; }), COLORS.info);
  }

  // ─── KPI secondaires (8 mini cards) ────────────────────
  function avgPerDay() {
    var t = STATE.statsTotals || {};
    var act = t.activity || {};
    var total = (act.calls || 0) + (act.pushes || 0) + (act.callNotes || 0);
    var days;
    if (STATE.customStart && STATE.customEnd) {
      days = Math.max(1, Math.round((STATE.customEnd - STATE.customStart) / 86400000) + 1);
    } else if (STATE.period === 'all') {
      days = 365;
    } else {
      days = parseInt(STATE.period, 10) || 30;
    }
    return total / days;
  }
  function pertinenceAvg() {
    var c = STATE.statsCharts || {};
    var p = c.pertinenceDistribution || {};
    var total = 0, sum = 0;
    Object.keys(p).forEach(function (k) {
      var n = p[k] || 0;
      var v = parseInt(k, 10);
      if (isFinite(v) && v > 0) { total += n; sum += n * v; }
    });
    return total > 0 ? Math.round((sum / total) * 10) / 10 : 0;
  }
  function renderSecondaryKPIs() {
    var t = STATE.statsTotals || {};
    var totals = t.totals || {};
    var act = t.activity || {};
    var statusC = t.statusCounts || {};
    var followups = t.followups || {};
    setKPI('total',     fmt(totals.prospects || t.total_prospects || 0));
    setKPI('companies', fmt(totals.companies || 0));
    setKPI('callback',  fmt(statusC.A_rappeler || statusC['À rappeler'] || 0));
    setKPI('overdue',   fmt(t.overdue != null ? t.overdue : (followups.late || 0)));
    setKPI('notes',     fmt(act.callNotes != null ? act.callNotes : 0));
    setKPI('duetoday',  fmt(followups.dueToday || 0));
    var avg = avgPerDay();
    setKPI('avg',       avg < 10 ? avg.toFixed(1).replace('.', ',') : fmt(Math.round(avg)));
    var pa = pertinenceAvg();
    setKPI('pertavg',   pa > 0 ? (pa.toFixed(1).replace('.', ',') + ' ★') : '—');
  }

  // ─── Performance card (chips + chart + insights + breakdown) ──
  function renderPerf() {
    var c = STATE.statsCharts || {};
    var weeks = c.activityPerWeek || []; // 12 semaines

    // Chips: 4 KPI hebdo (somme période) avec sparklines
    var totals = weeks.reduce(function (acc, w) {
      acc.calls += w.calls || 0;
      acc.notes += w.callNotes || 0;
      acc.push  += w.push || 0;
      return acc;
    }, { calls: 0, notes: 0, push: 0 });

    // Trend : comparer dernière sem vs avant-dernière
    var last = weeks[weeks.length - 1] || {};
    var prev = weeks[weeks.length - 2] || {};

    var rdvWeeklyEst = (STATE.statsCharts && STATE.statsCharts.rdvPerMonth)
      ? Math.round(((STATE.statsCharts.rdvPerMonth.slice(-1)[0] || {}).count || 0) / 4)
      : 0;

    var chips = [
      { color: COLORS.contacts, label: 'Appels',
        value: last.calls || 0, weekVal: last.calls || 0, prevVal: prev.calls || 0,
        sub: fmt(totals.calls) + ' sur 12 sem.',
        spark: weeks.map(function (w) { return w.calls || 0; }) },
      { color: COLORS.notes,    label: 'Notes',
        value: last.callNotes || 0, weekVal: last.callNotes || 0, prevVal: prev.callNotes || 0,
        sub: fmt(totals.notes) + ' sur 12 sem.',
        spark: weeks.map(function (w) { return w.callNotes || 0; }) },
      { color: COLORS.push,     label: 'Push',
        value: last.push || 0, weekVal: last.push || 0, prevVal: prev.push || 0,
        sub: fmt(totals.push) + ' sur 12 sem.',
        spark: weeks.map(function (w) { return w.push || 0; }) },
      { color: COLORS.rdv,      label: 'RDV / sem.',
        value: rdvWeeklyEst, weekVal: rdvWeeklyEst, prevVal: 0,
        sub: 'Estimation mensuelle / 4',
        spark: (c.rdvPerMonth || []).map(function (x) { return x.count || 0; }) }
    ];

    var host = $('[data-v30-stats-perf] [data-field="chips"]');
    if (host) {
      host.innerHTML = chips.map(function (c2) {
        var trend = trendBadge(c2.weekVal, c2.prevVal);
        return '<div class="v30-perf__chip" style="--chip-color:' + c2.color + ';">' +
          '<div class="v30-perf__chip-val num">' + esc(c2.value) + '</div>' +
          '<div class="v30-perf__chip-label">' + esc(c2.label) + ' ' + trend + '</div>' +
          '<div class="v30-perf__chip-sub">' + esc(c2.sub) + '</div>' +
          '<span class="v30-perf__chip-spark">' + sparklineSVG(c2.spark, c2.color, 60, 22) + '</span>' +
        '</div>';
      }).join('');
    }

    // Badge : total actions sur 12 semaines
    var totalAct = totals.calls + totals.notes + totals.push;
    var badge = $('[data-v30-stats-perf] [data-field="badge"]');
    if (badge) badge.textContent = fmt(totalAct) + ' actions sur 12 sem.';

    // Insights : best week, active weeks, conversion
    renderInsights(weeks);

    // Breakdown : Appels / Notes / Push / RDV (totaux)
    renderBreakdown(weeks, totals);

    // Chart hebdo stacked (Activity)
    renderActivityChart(weeks);
  }

  function renderInsights(weeks) {
    var host = $('[data-v30-stats-perf] [data-field="insights"]');
    if (!host) return;

    // 1. Meilleure semaine
    var best = null, bestScore = -1;
    weeks.forEach(function (w, i) {
      var s = (w.calls || 0) + (w.callNotes || 0) + (w.push || 0);
      if (s > bestScore) { best = { w: w, idx: i, score: s }; bestScore = s; }
    });
    var bestLabel = best && bestScore > 0 ? best.w.label : '—';
    var bestSub = bestScore > 0 ? (bestScore + ' action' + (bestScore > 1 ? 's' : '')) : 'Pas d\'activité';

    // 2. Semaines actives (≥1 action)
    var activeW = weeks.filter(function (w) {
      return (w.calls || 0) + (w.callNotes || 0) + (w.push || 0) > 0;
    }).length;

    // 3. Taux de conversion
    var t = STATE.statsTotals || {};
    var totals = t.totals || {};
    var statusC = t.statusCounts || {};
    var totalP = totals.prospects || t.total_prospects || 0;
    var rdv = t.rdv != null ? t.rdv : (statusC.Rendezvous || 0);
    var convPct = totalP > 0 ? Math.round((rdv / totalP) * 1000) / 10 : 0;

    var insights = [
      {
        label: 'Meilleure sem.',
        value: bestLabel,
        sub: bestSub,
        icon: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>'
      },
      {
        label: 'Semaines actives',
        value: activeW + '/' + (weeks.length || 12),
        sub: activeW >= 8 ? 'Régularité solide' : (activeW >= 4 ? 'Régularité moyenne' : 'À renforcer'),
        modifier: activeW >= 8 ? 'positive' : (activeW <= 2 ? 'negative' : '')
      },
      {
        label: 'Conversion globale',
        value: convPct.toFixed(1).replace('.', ',') + '%',
        sub: fmt(rdv) + ' RDV / ' + fmt(totalP) + ' prosp.',
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

  function renderBreakdown(weeks, totals) {
    var host = $('[data-v30-stats-perf] [data-field="breakdown"]');
    if (!host) return;

    var rdvTotal = (STATE.statsCharts && STATE.statsCharts.rdvPerMonth || []).reduce(function (s, m) { return s + (m.count || 0); }, 0);
    var metrics = [
      { label: 'Appels',  value: totals.calls || 0,  color: COLORS.contacts },
      { label: 'Notes',   value: totals.notes || 0,  color: COLORS.notes },
      { label: 'Push',    value: totals.push || 0,   color: COLORS.push },
      { label: 'RDV',     value: rdvTotal,           color: COLORS.rdv }
    ];
    var sumAll = metrics.reduce(function (s, m) { return s + m.value; }, 0);
    var max = Math.max(1, Math.max.apply(null, metrics.map(function (m) { return m.value; })));

    var totalEl = host.querySelector('[data-field="breakdown-total"]');
    if (totalEl) totalEl.textContent = fmt(sumAll) + ' action' + (sumAll > 1 ? 's' : '');

    var rowsEl = host.querySelector('[data-field="breakdown-rows"]');
    if (!rowsEl) return;
    rowsEl.innerHTML = metrics.map(function (m) {
      var pct = Math.round((m.value / max) * 100);
      return '<div class="v30-perf__breakdown-row">' +
        '<span class="v30-perf__breakdown-label">' + esc(m.label) + '</span>' +
        '<div class="v30-perf__breakdown-bar">' +
          '<div class="v30-perf__breakdown-fill" style="width:' + pct + '%;background:' + m.color + ';"></div>' +
        '</div>' +
        '<span class="v30-perf__breakdown-value num">' + fmt(m.value) + '</span>' +
      '</div>';
    }).join('');
  }

  function renderActivityChart(weeks) {
    if (typeof Chart === 'undefined') return;
    destroyChart('chartStatsActivity');
    var ctx = document.getElementById('chartStatsActivity');
    if (!ctx) return;
    if (!weeks.length) return;
    var colors = chartColors();

    STATE.chartInstances['chartStatsActivity'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: weeks.map(function (w) { return w.label; }),
        datasets: [
          { label: 'Appels',  data: weeks.map(function (w) { return w.calls || 0; }),
            backgroundColor: COLORS.contacts + 'cc', borderRadius: 4, borderSkipped: false, stack: 'a' },
          { label: 'Notes',   data: weeks.map(function (w) { return w.callNotes || 0; }),
            backgroundColor: COLORS.notes + 'cc', borderRadius: 4, borderSkipped: false, stack: 'a' },
          { label: 'Push',    data: weeks.map(function (w) { return w.push || 0; }),
            backgroundColor: COLORS.push + 'cc', borderRadius: 4, borderSkipped: false, stack: 'a' }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { grid: { display: false }, stacked: true, ticks: { font: { size: 10 } } },
          y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 10 } }, grid: { color: colors.grid }, stacked: true }
        },
        plugins: {
          legend: { position: 'bottom', labels: { padding: 12, font: { size: 11 }, usePointStyle: true, boxWidth: 8 } }
        }
      }
    });
  }

  // ─── Pipeline (status distribution) ────────────────────
  function renderPipeline() {
    var host = $('[data-v30-stats-pipeline] [data-field="rows"]');
    if (!host) return;
    var c = STATE.statsCharts || {};
    var dist = c.statusDistribution || {};
    var entries = Object.keys(dist).map(function (k) { return [k, dist[k]]; });
    var sumAll = entries.reduce(function (s, e) { return s + e[1]; }, 0);
    if (!entries.length || sumAll === 0) {
      host.innerHTML = '<div class="empty" style="padding:14px 0;text-align:center;color:var(--text-3);font-size:12px;">Aucun prospect.</div>';
      var totEl = $('[data-v30-stats-pipeline] [data-field="total"]');
      if (totEl) totEl.textContent = '0';
      return;
    }
    entries.sort(function (a, b) { return b[1] - a[1]; });
    var max = entries[0][1];
    host.innerHTML = entries.map(function (e) {
      var lbl = e[0] || 'Autre';
      var n = e[1] || 0;
      var pct = Math.round((n / sumAll) * 100);
      var fillW = Math.round((n / max) * 100);
      var color = STATUS_PALETTE[lbl] || COLORS.accent;
      return '<div class="v30-stats-pipeline__row">' +
        '<span class="v30-stats-pipeline__label" title="' + esc(lbl) + '">' + esc(lbl) + '</span>' +
        '<div class="v30-stats-pipeline__bar">' +
          '<div class="v30-stats-pipeline__fill" style="width:' + fillW + '%;background:' + color + 'cc;"></div>' +
          '<span class="v30-stats-pipeline__num">' + fmt(n) + '</span>' +
        '</div>' +
        '<span class="v30-stats-pipeline__pct num">' + pct + '%</span>' +
      '</div>';
    }).join('');
    var totEl2 = $('[data-v30-stats-pipeline] [data-field="total"]');
    if (totEl2) totEl2.textContent = fmt(sumAll) + ' prospects';
  }

  // ─── Urgence (4 buckets) ───────────────────────────────
  function renderUrgency() {
    var host = $('[data-v30-stats-urgency] [data-field="rows"]');
    if (!host) return;
    var c = STATE.statsCharts || {};
    var ud = c.urgencyDistribution || [];
    var keys = ['overdue', 'today', 'week', 'later'];
    var labelsByKey = { overdue: 'En retard', today: "Aujourd'hui", week: 'Cette semaine', later: 'Plus tard' };
    // Mapper par index si l'API retourne dans cet ordre, sinon par label
    var indexed = {};
    ud.forEach(function (it, i) {
      var label = it.label || '';
      var key = keys[i];
      if (label.toLowerCase().indexOf('retard') >= 0) key = 'overdue';
      else if (label.toLowerCase().indexOf("aujourd") >= 0) key = 'today';
      else if (label.toLowerCase().indexOf('semaine') >= 0) key = 'week';
      else if (label.toLowerCase().indexOf('tard') >= 0) key = 'later';
      indexed[key] = it.count || 0;
    });

    var total = keys.reduce(function (s, k) { return s + (indexed[k] || 0); }, 0);
    if (!total) {
      host.innerHTML = '<div class="empty" style="padding:14px 0;text-align:center;color:var(--text-3);font-size:12px;">Aucune action planifiée.</div>';
      var tEl = $('[data-v30-stats-urgency] [data-field="total"]');
      if (tEl) tEl.textContent = '0';
      return;
    }
    var max = Math.max.apply(null, keys.map(function (k) { return indexed[k] || 0; }));
    host.innerHTML = keys.map(function (k) {
      var n = indexed[k] || 0;
      var pct = max > 0 ? Math.round((n / max) * 100) : 0;
      return '<div class="v30-stats-urgency__row" data-urgency="' + k + '">' +
        '<span class="v30-stats-urgency__dot" aria-hidden="true"></span>' +
        '<div class="v30-stats-urgency__body">' +
          '<div class="v30-stats-urgency__label"><span>' + esc(labelsByKey[k]) + '</span></div>' +
          '<div class="v30-stats-urgency__bar"><div class="v30-stats-urgency__fill" style="width:' + pct + '%;"></div></div>' +
        '</div>' +
        '<span class="v30-stats-urgency__count num">' + fmt(n) + '</span>' +
      '</div>';
    }).join('');
    var tEl2 = $('[data-v30-stats-urgency] [data-field="total"]');
    if (tEl2) tEl2.textContent = fmt(total) + ' à traiter';
  }

  // ─── Top entreprises chaudes ──────────────────────────
  function renderHot() {
    var host = $('[data-v30-stats-hot]');
    if (!host) return;
    var rows = (STATE.statsTotals && (STATE.statsTotals.hotCompanies || STATE.statsTotals.hot_companies)) || [];
    if (!rows.length) {
      host.innerHTML = '<div class="empty" style="padding:18px 16px;text-align:center;color:var(--text-3);font-size:12.5px;">Aucune entreprise active sur la période.</div>';
      return;
    }
    var head = '<div class="v30-stats-hot__row v30-stats-hot__row--head">' +
      '<span>Entreprise</span>' +
      '<span class="num">Score</span>' +
      '<span class="num">Prospects</span>' +
      '<span class="num">RDV</span>' +
      '<span class="num">Retard</span>' +
      '<span></span>' +
    '</div>';
    host.innerHTML = head + rows.slice(0, 10).map(function (r) {
      return '<div class="v30-stats-hot__row">' +
        '<span class="truncate"><strong>' + esc(r.groupe || '—') + '</strong>' +
          (r.site ? '<span class="muted" style="margin-left:6px;font-size:11.5px;">' + esc(r.site) + '</span>' : '') +
        '</span>' +
        '<span class="num mono">' + esc(r.score != null ? r.score : '—') + '</span>' +
        '<span class="num mono">' + esc(r.prospectCount != null ? r.prospectCount : '—') + '</span>' +
        '<span class="num mono">' + esc(r.rdvCount != null ? r.rdvCount : '—') + '</span>' +
        '<span class="num mono">' + esc(r.lateFollowups != null ? r.lateFollowups : '—') + '</span>' +
        '<span><a class="btn btn-ghost btn-sm" href="/v30/entreprises" title="Ouvrir">Voir</a></span>' +
      '</div>';
    }).join('');
  }

  // ─── Top consultants pushés ───────────────────────────
  function renderPushed() {
    var host = $('[data-v30-stats-pushed]');
    if (!host) return;
    var c = STATE.statsCharts || {};
    var rows = c.topPushedConsultants || [];
    if (!rows.length) {
      host.innerHTML = '<div class="empty">Aucun consultant pushé.</div>';
      return;
    }
    var max = Math.max.apply(null, rows.map(function (r) { return r.count || 0; }));
    host.innerHTML = rows.slice(0, 8).map(function (r, i) {
      var pct = max > 0 ? Math.round(((r.count || 0) / max) * 100) : 0;
      return '<div class="v30-stats-toplist__row" data-rank="' + (i + 1) + '">' +
        '<span class="v30-stats-toplist__rank">' + (i + 1) + '</span>' +
        '<span class="v30-stats-toplist__name" title="' + esc(r.name) + '">' + esc(r.name) + '</span>' +
        '<div class="v30-stats-toplist__bar">' +
          '<div class="v30-stats-toplist__fill" style="width:' + pct + '%;"></div>' +
        '</div>' +
        '<span class="v30-stats-toplist__count">' + fmt(r.count) + '</span>' +
      '</div>';
    }).join('');
  }

  // ─── Charts secondaires : RDV/mois + Pertinence ────────
  function destroyChart(id) {
    if (STATE.chartInstances[id]) { STATE.chartInstances[id].destroy(); delete STATE.chartInstances[id]; }
  }
  function renderRdvChart() {
    if (typeof Chart === 'undefined') return;
    destroyChart('chartStatsRdv');
    var ctx = document.getElementById('chartStatsRdv');
    if (!ctx) return;
    var c = STATE.statsCharts || {};
    var months = c.rdvPerMonth || [];
    if (!months.length) return;
    var colors = chartColors();
    STATE.chartInstances['chartStatsRdv'] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: months.map(function (m) { return m.label; }),
        datasets: [{
          label: 'RDV obtenus',
          data: months.map(function (m) { return m.count; }),
          borderColor: COLORS.success,
          backgroundColor: 'rgba(34,197,94,0.13)',
          fill: true,
          tension: 0.35,
          pointRadius: 4,
          pointBackgroundColor: COLORS.success,
          borderWidth: 2
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 10 } }, grid: { color: colors.grid } }
        },
        plugins: { legend: { display: false } }
      }
    });
  }
  function renderPertChart() {
    if (typeof Chart === 'undefined') return;
    destroyChart('chartStatsPert');
    var ctx = document.getElementById('chartStatsPert');
    if (!ctx) return;
    var c = STATE.statsCharts || {};
    var pert = c.pertinenceDistribution || {};
    var vals = ['1','2','3','4','5'].map(function (k) { return pert[k] || 0; });
    if (!vals.some(function (v) { return v; })) return;
    var colors = chartColors();
    STATE.chartInstances['chartStatsPert'] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['1 ★','2 ★','3 ★','4 ★','5 ★'],
        datasets: [{
          data: vals,
          backgroundColor: ['#94a3b8cc','#f59e0bcc','#eab308cc','#84cc16cc','#22c55ecc'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { padding: 12, font: { size: 11 }, usePointStyle: true, boxWidth: 8 } }
        },
        cutout: '60%'
      }
    });
  }

  // ─── Funnel de conversion cumulatif (Phase 3 productivité v32.x) ──
  // 5 étapes : Total → Contactés → RDV pris → RDV tenus → Signés.
  // Source : GET /api/stats/funnel (services/prospect_score.py:compute_funnel).
  // Clic sur une étape → drill-down (liste des prospects de l'étape).
  var FUNNEL_STAGE_COLORS = {
    total:     '#94a3b8',
    contacted: '#3b82f6',
    rdv_pris:  '#22c55e',
    rdv_tenus: '#10b981',
    signes:    '#a855f7'
  };

  function renderFunnel() {
    var host = $('[data-v30-stats-funnel] [data-field="rows"]');
    if (!host) return;

    fetchJSON('/api/stats/funnel').then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || 'HTTP error');
      var stages = res.stages || [];
      var rates = res.rates || {};

      var maxValue = Math.max(1, Math.max.apply(null, stages.map(function (s) { return s.count; })));
      var total = (stages[0] && stages[0].count) || 0;

      var rateEl = $('[data-v30-stats-funnel] [data-field="rate"]');
      if (rateEl) {
        var g = Number(rates.global_conversion || 0);
        rateEl.textContent = g.toFixed(1).replace('.', ',') + '% Total → Signés';
      }

      if (total === 0) {
        host.innerHTML = '<div class="empty" style="padding:18px 0;text-align:center;color:var(--text-3);font-size:12.5px;">Aucun prospect.</div>';
        return;
      }

      host.innerHTML = stages.map(function (s, i) {
        var color = FUNNEL_STAGE_COLORS[s.key] || '#94a3b8';
        var pct = total > 0 ? Math.round((s.count / total) * 1000) / 10 : 0;
        var fillW = Math.round((s.count / maxValue) * 100);
        var prev = i > 0 ? stages[i - 1].count : null;
        var dropTxt = '';
        if (prev != null && prev > 0 && s.count < prev) {
          var drop = Math.round(((prev - s.count) / prev) * 100);
          dropTxt = '<span class="v30-stats-funnel__drop" title="Perte vs étape précédente">−' + drop + '%</span>';
        }
        return '<div class="v30-stats-funnel__row" style="--stage-color:' + color + ';cursor:pointer;" ' +
          'data-v30-funnel-stage="' + esc(s.key) + '" data-v30-funnel-label="' + esc(s.label) + '" ' +
          'title="Cliquer pour lister les prospects à cette étape">' +
          '<span class="v30-stats-funnel__label">' + esc(s.label) + dropTxt + '</span>' +
          '<div class="v30-stats-funnel__bar">' +
            '<div class="v30-stats-funnel__fill" style="width:' + fillW + '%;"></div>' +
            '<span class="v30-stats-funnel__value num">' + fmt(s.count) + '</span>' +
          '</div>' +
          '<span class="v30-stats-funnel__pct num">' + pct.toFixed(1).replace('.', ',') + '%</span>' +
        '</div>';
      }).join('');
    }).catch(function (err) {
      console.error('[stats funnel] /api/stats/funnel failed:', err);
      host.innerHTML = '<div class="empty" style="padding:18px 0;font-size:12px;color:var(--text-3);">Erreur de chargement du funnel.</div>';
    });
  }

  // ─── Drill-down funnel : clic sur une étape liste ses prospects ──
  function bindFunnelDrill() {
    var section = $('[data-v30-stats-funnel]');
    if (!section) return;
    var drill = section.querySelector('[data-v30-funnel-drill]');
    var titleEl = drill && drill.querySelector('[data-field="drill-title"]');
    var listEl = drill && drill.querySelector('[data-field="drill-list"]');
    var closeBtn = drill && drill.querySelector('[data-v30-funnel-drill-close]');

    section.addEventListener('click', function (e) {
      var row = e.target.closest('[data-v30-funnel-stage]');
      if (!row) return;
      var stageKey = row.dataset.v30FunnelStage;
      var stageLabel = row.dataset.v30FunnelLabel || stageKey;
      openDrill(stageKey, stageLabel);
    });

    if (closeBtn) closeBtn.addEventListener('click', function () {
      drill.hidden = true;
    });

    function openDrill(stageKey, stageLabel) {
      if (!drill || !titleEl || !listEl) return;
      drill.hidden = false;
      titleEl.textContent = stageLabel + ' — chargement…';
      listEl.innerHTML = '<div class="empty" style="padding:8px;">Chargement…</div>';

      Promise.all([
        fetchJSON('/api/stats/funnel?with_ids=1'),
        fetchJSON('/api/data')
      ]).then(function (r) {
        var stage = (r[0].stages || []).find(function (s) { return s.key === stageKey; });
        var prospects = (r[1] && r[1].prospects) || [];
        if (!stage) {
          listEl.innerHTML = '<div class="empty">Étape introuvable.</div>';
          return;
        }
        var ids = new Set(stage.ids || []);
        var rows = prospects.filter(function (p) { return ids.has(p.id); });
        titleEl.textContent = stageLabel + ' · ' + rows.length + ' prospect' + (rows.length > 1 ? 's' : '');

        if (rows.length === 0) {
          listEl.innerHTML = '<div class="empty" style="padding:8px;">Aucun prospect à cette étape.</div>';
          return;
        }
        // Tri : nom asc
        rows.sort(function (a, b) {
          return String(a.name || '').localeCompare(String(b.name || ''), 'fr', { sensitivity: 'base' });
        });
        listEl.innerHTML = rows.slice(0, 200).map(function (p) {
          var company = p.company_groupe || p.company_site || '';
          return '<div style="display:flex;justify-content:space-between;gap:8px;padding:4px 6px;border-bottom:1px solid var(--border);">' +
            '<a href="/v30/prospect/' + p.id + '" style="text-decoration:none;color:inherit;min-width:0;flex:1;">' +
              '<span style="font-weight:600;">' + esc(p.name || '—') + '</span>' +
              (company ? ' <span class="muted">· ' + esc(company) + '</span>' : '') +
            '</a>' +
            '<span class="muted" style="font-size:11px;white-space:nowrap;">' + esc(p.statut || '') + '</span>' +
          '</div>';
        }).join('') +
        (rows.length > 200 ? '<div class="muted" style="padding:8px;font-size:11px;">+ ' + (rows.length - 200) + ' autres…</div>' : '');
      }).catch(function () {
        listEl.innerHTML = '<div class="empty" style="padding:8px;">Erreur de chargement.</div>';
      });
    }
  }

  // ─── Top compétences / tags (SVG bars) ────────────────
  function renderTopTags() {
    var host = $('[data-v30-stats-tags] [data-field="rows"]');
    if (!host) return;
    var c = STATE.statsCharts || {};
    var rows = c.topTags || [];
    var totEl = $('[data-v30-stats-tags] [data-field="total"]');

    if (!rows.length) {
      host.innerHTML = '<div class="empty" style="padding:18px 0;text-align:center;color:var(--text-3);font-size:12.5px;">Aucun tag renseigné sur tes prospects.</div>';
      if (totEl) totEl.textContent = '0';
      return;
    }
    var max = Math.max.apply(null, rows.map(function (r) { return r.count || 0; }));
    var total = rows.reduce(function (s, r) { return s + (r.count || 0); }, 0);
    if (totEl) totEl.textContent = fmt(total) + ' occurrences';

    host.innerHTML = rows.slice(0, 10).map(function (r, i) {
      var pct = max > 0 ? Math.round(((r.count || 0) / max) * 100) : 0;
      return '<div class="v30-stats-tags__row" data-rank="' + (i + 1) + '">' +
        '<span class="v30-stats-tags__name" title="' + esc(r.name) + '">' + esc(r.name) + '</span>' +
        '<div class="v30-stats-tags__bar">' +
          '<div class="v30-stats-tags__fill" style="width:' + pct + '%;"></div>' +
        '</div>' +
        '<span class="v30-stats-tags__count num">' + fmt(r.count) + '</span>' +
      '</div>';
    }).join('');
  }

  // ─── Heatmap activité 8 sem × 7 jours (SVG-CSS) ───────
  function renderHeatmap() {
    var host = $('[data-v30-stats-heatmap] [data-field="grid"]');
    if (!host) return;
    var c = STATE.statsCharts || {};
    var days = (c.dailyActivity || []).slice();
    var totEl = $('[data-v30-stats-heatmap] [data-field="total"]');

    if (!days.length) {
      host.innerHTML = '<div class="empty" style="padding:18px 0;text-align:center;color:var(--text-3);font-size:12.5px;">Pas de données d\'activité.</div>';
      if (totEl) totEl.textContent = '0';
      return;
    }
    // Compute thresholds (quartiles) for level mapping 1..4
    var counts = days.map(function (d) { return d.count || 0; }).filter(function (n) { return n > 0; });
    counts.sort(function (a, b) { return a - b; });
    function quartile(arr, q) {
      if (!arr.length) return 0;
      var pos = (arr.length - 1) * q;
      var lo = Math.floor(pos), hi = Math.ceil(pos);
      if (lo === hi) return arr[lo];
      return arr[lo] + (arr[hi] - arr[lo]) * (pos - lo);
    }
    var q1 = quartile(counts, 0.25),
        q2 = quartile(counts, 0.5),
        q3 = quartile(counts, 0.75);
    function level(n) {
      if (!n) return 0;
      if (n <= q1) return 1;
      if (n <= q2) return 2;
      if (n <= q3) return 3;
      return 4;
    }
    var total = days.reduce(function (s, d) { return s + (d.count || 0); }, 0);
    if (totEl) totEl.textContent = fmt(total) + ' actions sur 56 j.';

    // Build a 7-rows × 8-cols grid (rows=jours sem, cols=semaines)
    var DAYS_FR = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
    // days est trié par date asc (56 entries). On les groupe par semaine ISO (lundi).
    var weeks = [];      // array of arrays of {date, count, level} indexed by weekday 0..6
    var currentWeek = null;
    days.forEach(function (d) {
      var dt = new Date(d.date + 'T00:00:00');
      var wd = (dt.getDay() + 6) % 7; // Lundi=0..Dimanche=6
      if (wd === 0 || !currentWeek) {
        currentWeek = new Array(7);
        weeks.push(currentWeek);
      }
      currentWeek[wd] = { date: d.date, count: d.count || 0, level: level(d.count || 0) };
    });
    // tronquer/garantir 8 dernières semaines
    if (weeks.length > 8) weeks = weeks.slice(weeks.length - 8);

    // Collect month labels (top axis): one tick when month changes between week starts
    var monthHeaders = weeks.map(function (w) {
      var first = (w || []).find(function (c) { return c; });
      if (!first) return '';
      var dt = new Date(first.date + 'T00:00:00');
      return dt.toLocaleDateString('fr-FR', { month: 'short' });
    });
    var headerHTML = '<div class="v30-stats-heatmap__col-label"></div>' +
      monthHeaders.map(function (m, i) {
        var show = (i === 0) || (m !== monthHeaders[i - 1]);
        return '<div class="v30-stats-heatmap__col-label">' + (show ? esc(m) : '') + '</div>';
      }).join('');

    var rowsHTML = DAYS_FR.map(function (lbl, r) {
      var label = (r % 2 === 0) ? esc(lbl) : '';
      var cells = weeks.map(function (w, ci) {
        var cell = w && w[r];
        if (!cell) return '<div class="v30-stats-heatmap__cell" data-level="0" aria-hidden="true"></div>';
        var dt = new Date(cell.date + 'T00:00:00');
        var dispDate = dt.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'short' });
        var title = dispDate + ' · ' + cell.count + ' action' + (cell.count > 1 ? 's' : '');
        return '<div class="v30-stats-heatmap__cell" data-level="' + cell.level + '" title="' + esc(title) + '"></div>';
      }).join('');
      return '<div class="v30-stats-heatmap__row-label">' + label + '</div>' + cells;
    }).join('');

    host.innerHTML = '<div class="v30-stats-heatmap__grid" style="--cols:' + weeks.length + ';">' +
      headerHTML +
      rowsHTML +
    '</div>';
  }

  // ─── Évolution portefeuille (Chart.js line) ───────────
  function renderPortfolioChart() {
    if (typeof Chart === 'undefined') return;
    destroyChart('chartStatsPortfolio');
    var ctx = document.getElementById('chartStatsPortfolio');
    if (!ctx) return;
    var c = STATE.statsCharts || {};
    var weeks = c.portfolioPerWeek || [];
    if (!weeks.length) return;
    var colors = chartColors();

    // Trend chip
    var first = weeks[0].count || 0;
    var last = weeks[weeks.length - 1].count || 0;
    var diff = last - first;
    var trendEl = $('[data-v30-stats-portfolio-trend]');
    if (trendEl) {
      var pct = first > 0 ? Math.round((diff / first) * 100) : 0;
      var sign = diff > 0 ? '+' : '';
      var cls = diff > 0 ? 'is-pos' : (diff < 0 ? 'is-neg' : '');
      trendEl.className = 'muted num';
      if (cls) trendEl.classList.add(cls);
      trendEl.innerHTML = sign + fmt(diff) + ' prospects · ' + sign + pct + '%';
    }

    STATE.chartInstances['chartStatsPortfolio'] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: weeks.map(function (w) { return w.label; }),
        datasets: [{
          label: 'Portefeuille',
          data: weeks.map(function (w) { return w.count || 0; }),
          borderColor: COLORS.accent,
          backgroundColor: 'rgba(90,124,255,0.13)',
          fill: true,
          tension: 0.35,
          pointRadius: 3,
          pointHoverRadius: 5,
          pointBackgroundColor: COLORS.accent,
          borderWidth: 2
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          y: { beginAtZero: false, ticks: { font: { size: 10 } }, grid: { color: colors.grid } }
        },
        plugins: { legend: { display: false } }
      }
    });
  }

  // ─── Chart.js loader (CDN avec fallback) ──────────────
  var CHART_CDNS = [
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.7/chart.umd.min.js',
    'https://unpkg.com/chart.js@4.4.7/dist/chart.umd.min.js'
  ];
  var _chartLoading = null;
  function loadChartJS() {
    if (_chartLoading) return _chartLoading;
    _chartLoading = new Promise(function (resolve) {
      if (typeof Chart !== 'undefined') { resolve(true); return; }
      var i = 0;
      function tryNext() {
        if (i >= CHART_CDNS.length) { resolve(false); return; }
        var s = document.createElement('script');
        s.src = CHART_CDNS[i++];
        s.onload = function () { resolve(typeof Chart !== 'undefined'); };
        s.onerror = tryNext;
        document.head.appendChild(s);
      }
      tryNext();
    });
    return _chartLoading;
  }

  // ─── Reload all data + render ──────────────────────────
  function reloadAll() {
    var totalsP = fetchJSON('/api/stats?' + buildTotalsParams()).catch(function () { return {}; });
    var chartsP = fetchJSON('/api/stats/charts').catch(function () { return {}; });
    var dataP   = fetchJSON('/api/stats/data?' + buildParams()).catch(function () { return {}; });

    Promise.all([totalsP, chartsP, dataP]).then(function (r) {
      STATE.statsTotals = r[0] || {};
      STATE.statsCharts = r[1] && r[1].ok ? r[1] : (r[1] || {});
      STATE.statsData   = r[2] && r[2].ok ? r[2] : (r[2] || {});

      // Render synchrone (sans Chart.js)
      setHeadline();
      renderHeroKPIs();
      renderSecondaryKPIs();
      renderPipeline();
      renderUrgency();
      renderHot();
      renderPushed();
      renderTagChips();
      renderFunnel();
      renderTopTags();
      renderHeatmap();

      // Render avec Chart.js (async)
      loadChartJS().then(function (ok) {
        if (!ok) return;
        var colors = chartColors();
        Chart.defaults.color = colors.text;
        Chart.defaults.borderColor = colors.grid;
        renderPerf();      // chips + insights + breakdown + chartStatsActivity
        renderRdvChart();
        renderPertChart();
        renderPortfolioChart();
      });
    });
  }

  // ─── Init ──────────────────────────────────────────────
  function init() {
    bindTabs();
    bindPeriod();
    bindMonthNav();
    bindRangeModal();
    bindFilters();
    bindExport();
    bindFunnelDrill();
    updateMonthLabel();
    reloadAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
