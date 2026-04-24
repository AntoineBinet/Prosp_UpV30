/* ProspUp v30 — Stats : KPI hydration + top entreprises + tabs */
(function () {
  'use strict';

  var STATE = { period: 30 };

  function esc(s) {
    var t = document.createElement('span');
    t.textContent = s == null ? '' : String(s);
    return t.innerHTML;
  }
  function fetchJSON(url) {
    return fetch(url, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  // ─── Tabs (dashboard / rapport) ──────────────────────────
  function bindTabs() {
    var host = document.querySelector('[data-v30-stats-tabs]');
    if (!host) return;
    host.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-tab]');
      if (!btn) return;
      var key = btn.dataset.tab;
      host.querySelectorAll('button[data-tab]').forEach(function (b) {
        var active = (b === btn);
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      document.querySelectorAll('[data-v30-stats-panel]').forEach(function (p) {
        p.hidden = (p.dataset.v30StatsPanel !== key);
      });
    });
  }

  // ─── Period (7 / 30 / 90 / all) ─────────────────────────
  function bindPeriod() {
    var host = document.querySelector('[data-v30-stats-period]');
    if (!host) return;
    host.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-period]');
      if (!btn) return;
      host.querySelectorAll('button[data-period]').forEach(function (b) {
        b.classList.toggle('active', b === btn);
      });
      STATE.period = btn.dataset.period;
      loadKPIs();
    });
  }

  // ─── KPIs ────────────────────────────────────────────────
  function setKPI(key, value, delta) {
    var v = document.querySelector('[data-kpi="' + key + '"]');
    if (v) v.textContent = value == null ? '—' : value;
    var d = document.querySelector('[data-kpi-delta="' + key + '"]');
    if (d) {
      if (delta == null) { d.innerHTML = '&nbsp;'; return; }
      d.textContent = delta + ' vs période préc.';
      d.style.color = String(delta).indexOf('−') === 0 || String(delta).indexOf('-') === 0
        ? 'var(--danger)' : 'var(--success)';
    }
  }

  function loadKPIs() {
    var qs = STATE.period === 'all' ? '' : ('?days=' + encodeURIComponent(STATE.period));
    fetchJSON('/api/stats' + qs).then(function (res) {
      // /api/stats renvoie directement totals, activity, hotCompanies, rdv, pushes, overdue, statusCounts.
      var d = res || {};
      var fmt = function (v) { return Number(v || 0).toLocaleString('fr-FR'); };
      var totals = d.totals || {};
      var activity = d.activity || {};
      var statusCounts = d.statusCounts || {};
      setKPI('total',     fmt(totals.prospects || d.total_prospects));
      setKPI('companies', fmt(totals.companies));
      setKPI('calls',     fmt(activity.calls != null ? activity.calls : d.calls));
      setKPI('push',      fmt(activity.pushes != null ? activity.pushes : d.pushes));
      setKPI('rdv',       fmt(d.rdv != null ? d.rdv : statusCounts.Rendezvous));
      setKPI('callback',  fmt(statusCounts.A_rappeler || statusCounts['À rappeler']));
      setKPI('overdue',   fmt(d.overdue));
      setKPI('notes',     fmt(activity.callNotes != null ? activity.callNotes : 0));
      // Recharge les entreprises chaudes depuis la meme reponse
      renderHot(d.hotCompanies || d.hot_companies || []);
    }).catch(function (err) {
      console.error('[v30 stats] /api/stats failed:', err);
      // Fallback : /api/dashboard pour au moins Push + RDV
      fetchJSON('/api/dashboard').then(function (res) {
        var d = (res && res.data) || {};
        setKPI('push', ((d.week && d.week.push_total) || 0).toLocaleString('fr-FR'));
        setKPI('rdv',  ((d.week && d.week.rdv_total)  || 0).toLocaleString('fr-FR'));
        ['total','companies','calls','callback','overdue','notes'].forEach(function (k) { setKPI(k, '—'); });
      }).catch(function () {});
    });
  }

  // ─── Entreprises chaudes (remplace le bar chart) ─────────
  function renderHot(rows) {
    var host = document.querySelector('[data-v30-stats-hot]');
    if (!host) return;
    rows = rows || [];
    if (!rows.length) {
      host.innerHTML = '<div class="empty" style="padding:16px;">Aucune entreprise active sur la période.</div>';
      return;
    }
    var head = '<div class="v30-stats-hot__row v30-stats-hot__row--head">' +
      '<span>Entreprise</span>' +
      '<span class="num">Score</span>' +
      '<span class="num">Prospects</span>' +
      '<span class="num">RDV</span>' +
      '<span class="num">Relances retard</span>' +
      '<span></span>' +
    '</div>';
    host.innerHTML = head + rows.slice(0, 10).map(function (r) {
      var copyAddr = esc(r.groupe || '') + (r.site ? ' · ' + esc(r.site) : '');
      return '<div class="v30-stats-hot__row">' +
        '<span class="truncate"><strong>' + esc(r.groupe || '—') + '</strong>' +
          (r.site ? '<span class="muted" style="margin-left:6px;">' + esc(r.site) + '</span>' : '') +
        '</span>' +
        '<span class="num mono">' + esc(r.score != null ? r.score : '—') + '</span>' +
        '<span class="num mono">' + esc(r.prospectCount != null ? r.prospectCount : '—') + '</span>' +
        '<span class="num mono">' + esc(r.rdvCount != null ? r.rdvCount : '—') + '</span>' +
        '<span class="num mono">' + esc(r.lateFollowups != null ? r.lateFollowups : '—') + '</span>' +
        '<span>' +
          '<a class="btn btn-ghost btn-sm" href="/v30/entreprises" title="Ouvrir">Voir</a>' +
        '</span>' +
      '</div>';
    }).join('');
  }

  // ─── Top entreprises (nb prospects) ──────────────────────
  function loadTop() {
    var host = document.querySelector('[data-v30-stats-top]');
    if (!host) return;
    fetchJSON('/api/data').then(function (res) {
      var companies = (res && res.companies) || [];
      var prospects = (res && res.prospects) || [];
      var counts = {};
      prospects.forEach(function (p) {
        counts[p.company_id] = (counts[p.company_id] || 0) + 1;
      });
      var rows = companies.map(function (c) {
        return { name: c.groupe || '—', count: counts[c.id] || 0 };
      }).filter(function (r) { return r.count > 0; })
        .sort(function (a, b) { return b.count - a.count; })
        .slice(0, 8);
      if (rows.length === 0) {
        host.innerHTML = '<div class="empty">Aucune donnée.</div>';
        return;
      }
      var max = Math.max(1, rows[0].count);
      host.innerHTML = rows.map(function (r) {
        var pct = Math.round((r.count / max) * 100);
        return '<div style="display:grid;grid-template-columns:140px 1fr 60px;gap:10px;align-items:center;padding:6px 0;font-size:12px;">' +
          '<span class="truncate">' + esc(r.name) + '</span>' +
          '<div style="height:14px;background:var(--surface-2);border-radius:3px;overflow:hidden;">' +
            '<div style="height:100%;width:' + pct + '%;background:var(--accent);"></div>' +
          '</div>' +
          '<span class="mono num" style="text-align:right;">' + r.count + '</span>' +
        '</div>';
      }).join('');
    }).catch(function (err) {
      console.error('[v30 stats] /api/data failed:', err);
      host.innerHTML = '<div class="empty">Erreur de chargement.</div>';
    });
  }

  // ═══════════════════════════════════════════════════════
  // Rapport WYSIWYG (tab "Rapport")
  // ═══════════════════════════════════════════════════════
  var REP = { week: null, key: null, data: null };

  function isoWeek(d) {
    var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    var y1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    var w = Math.ceil(((t - y1) / 86400000 + 1) / 7);
    return t.getUTCFullYear() + '-W' + String(w).padStart(2, '0');
  }
  function weekParam(which) {
    var d = new Date();
    if (which === 'prev') d.setDate(d.getDate() - 7);
    return isoWeek(d);
  }

  function repRenderRange() {
    var el = document.querySelector('[data-v30-rep-range]');
    if (!el) return;
    var r = REP.data && REP.data.week;
    if (r && r.from && r.to) el.textContent = 'Du ' + r.from + ' au ' + r.to;
    else el.textContent = REP.week || '—';
  }
  function repRenderKpis() {
    var host = document.querySelector('[data-v30-rep-kpis]');
    if (!host) return;
    var k = (REP.data && REP.data.kpis) || {};
    var cards = [
      { label: 'Prospects contactés', value: k.prospects_contacted, delta: k.prospects_delta },
      { label: 'RDV planifiés',       value: k.rdv_scheduled,      delta: k.rdv_delta },
      { label: 'Pushs envoyés',       value: k.pushs_sent,         delta: k.pushs_delta },
      { label: 'Appels passés',       value: k.calls_made,         delta: k.calls_delta }
    ];
    host.innerHTML = cards.map(function (c) {
      var val = c.value != null ? c.value : '—';
      var delta = c.delta != null ? ((c.delta >= 0 ? '+' : '') + c.delta + ' vs. sem. précédente') : '';
      return '<div class="v30-rep-kpi">' +
        '<div class="v30-rep-kpi__label">' + esc(c.label) + '</div>' +
        '<div class="v30-rep-kpi__value num">' + esc(val) + '</div>' +
        (delta ? '<div class="v30-rep-kpi__delta">' + esc(delta) + '</div>' : '') +
      '</div>';
    }).join('');
  }
  function repRenderTable(hostSel, items, k1, k2, lbl1, lbl2) {
    var host = document.querySelector(hostSel);
    if (!host) return;
    items = items || [];
    if (!items.length) {
      host.innerHTML = '<div class="empty" style="padding:12px;">Aucune donnée.</div>';
      return;
    }
    var head = '<div class="v30-rep-row" style="font-weight:600;color:var(--text-3);border-bottom:1px solid var(--border);padding-bottom:4px;">' +
      '<span>' + esc(lbl1 || 'Nom') + '</span>' +
      '<span style="text-align:right;">' + esc(k1 || 'Valeur') + '</span>' +
      (k2 ? '<span style="text-align:right;">' + esc(k2) + '</span>' : '<span></span>') +
    '</div>';
    host.innerHTML = head + items.slice(0, 10).map(function (it) {
      return '<div class="v30-rep-row">' +
        '<span class="v30-rep-row__label">' + esc(it.name || it.label || it.groupe || '—') + '</span>' +
        '<span class="v30-rep-row__v1">' + esc(it[k1] != null ? it[k1] : '—') + '</span>' +
        (k2 ? '<span class="v30-rep-row__v2">' + esc(it[k2] != null ? it[k2] : '—') + '</span>' : '<span></span>') +
      '</div>';
    }).join('');
  }
  function repRenderTrend() {
    var host = document.querySelector('[data-v30-rep-push-trend]');
    if (!host) return;
    var trend = (REP.data && REP.data.push_trend) || [];
    if (!trend.length) {
      host.innerHTML = '<div class="empty" style="padding:12px;">Pas assez de données pour un graphique.</div>';
      return;
    }
    var max = Math.max.apply(null, trend.map(function (p) { return p.count || 0; })) || 1;
    host.innerHTML = trend.map(function (p) {
      var pct = ((p.count || 0) / max) * 100;
      return '<div class="v30-rep-sparkline__bar" data-label="' + esc(p.label || '') +
             '" style="height:' + Math.max(4, pct) + '%;">' +
             '<span>' + (p.count || 0) + '</span></div>';
    }).join('');
  }

  function repLoadCE() {
    if (!REP.key) return;
    try {
      var saved = JSON.parse(localStorage.getItem(REP.key) || '{}');
      ['title', 'author', 'summary', 'notes'].forEach(function (f) {
        var el = document.querySelector('[data-v30-rep-ce="' + f + '"]');
        if (el && saved[f] != null) el.innerHTML = saved[f];
      });
    } catch (_) {}
  }
  function repSaveCE() {
    if (!REP.key) return;
    var data = {};
    ['title', 'author', 'summary', 'notes'].forEach(function (f) {
      var el = document.querySelector('[data-v30-rep-ce="' + f + '"]');
      if (el) data[f] = el.innerHTML;
    });
    try {
      localStorage.setItem(REP.key, JSON.stringify(data));
      var hint = document.querySelector('[data-v30-rep-savehint]');
      if (hint) {
        hint.textContent = 'Sauvegardé ' + new Date().toLocaleTimeString('fr-FR').slice(0,5);
        setTimeout(function () { hint.textContent = 'Autosave local'; }, 2500);
      }
    } catch (_) {}
  }

  function repLoad(whichOrIso) {
    // whichOrIso : 'current' / 'prev' ou une semaine ISO directe (YYYY-Www).
    if (whichOrIso && /^\d{4}-W\d{2}$/.test(whichOrIso)) {
      REP.week = whichOrIso;
    } else {
      REP.week = weekParam(whichOrIso);
    }
    REP.key = 'prospup_rapport_' + REP.week;
    var picker = document.querySelector('[data-v30-rep-week-picker]');
    if (picker) picker.value = REP.week;
    return fetchJSON('/api/rapport-hebdo?week=' + encodeURIComponent(REP.week))
      .then(function (res) {
        // L'API retourne { ok, data: { start, end, kpi, touched_companies, push_detail, ... } }
        var d = (res && res.data) || {};
        var kpi = d.kpi || {};
        // Grouper push_detail par prospect pour avoir un count
        var pushCounts = {};
        (d.push_detail || []).forEach(function (p) {
          var k = p.prospect_name || '—';
          pushCounts[k] = (pushCounts[k] || 0) + 1;
        });
        // Normaliser dans la forme attendue par les fonctions de rendu
        REP.data = {
          week: { from: d.start || '', to: d.end || '' },
          kpis: {
            prospects_contacted: kpi.relances != null ? kpi.relances : null,
            rdv_scheduled:       kpi.rdv != null ? kpi.rdv : null,
            pushs_sent:          kpi.push_total != null ? kpi.push_total : null,
            calls_made:          kpi.notes != null ? kpi.notes : null,
            prospects_delta: null, rdv_delta: null, pushs_delta: null, calls_delta: null
          },
          // top_companies vient directement de l'API avec pushs+prospects counts
          top_companies: (d.top_companies || []).length
            ? d.top_companies
            : (d.touched_companies || []).map(function (name) { return { name: name, pushs: 0, prospects: 0 }; }),
          top_pushed: Object.keys(pushCounts)
            .sort(function (a, b) { return pushCounts[b] - pushCounts[a]; })
            .map(function (k) { return { name: k, count: pushCounts[k] }; }),
          push_trend: [],
          _raw: d
        };
        repRenderRange();
        repRenderKpis();
        repRenderTable('[data-v30-rep-top-companies]', REP.data.top_companies, 'pushs', 'prospects', 'Entreprise', 'Pushs · Prospects');
        repRenderTable('[data-v30-rep-top-pushed]', REP.data.top_pushed, 'count', null, 'Prospect', 'Pushs');
        repRenderTrend();
        repLoadCE();
      })
      .catch(function (err) {
        console.error('[v30 rapport]', err);
      });
  }

  function repToMarkdown() {
    var d = REP.data || {};
    var getCE = function (f) {
      var el = document.querySelector('[data-v30-rep-ce="' + f + '"]');
      return el ? (el.innerText || '').trim() : '';
    };
    var lines = ['# ' + (getCE('title') || 'Rapport hebdomadaire') + ' · ' + (REP.week || '')];
    if (getCE('author')) lines.push('*' + getCE('author') + '*');
    if (getCE('summary')) lines.push('', '## Résumé', getCE('summary'));
    var k = d.kpis || {};
    if (Object.keys(k).length) {
      lines.push('', '## KPI de la semaine');
      Object.keys(k).forEach(function (key) {
        if (!/delta$/.test(key)) lines.push('- **' + key + '** : ' + k[key]);
      });
    }
    if ((d.top_companies || []).length) {
      lines.push('', '## Top entreprises');
      d.top_companies.slice(0, 10).forEach(function (c) {
        lines.push('- ' + (c.name || c.groupe) + ' — ' + (c.pushs || 0) + ' push · ' + (c.prospects || 0) + ' prosp');
      });
    }
    if ((d.top_pushed || []).length) {
      lines.push('', '## Top pushés');
      d.top_pushed.slice(0, 10).forEach(function (p) { lines.push('- ' + (p.name || p.label) + ' (' + (p.count || 0) + ')'); });
    }
    if (getCE('notes')) lines.push('', '## Notes', getCE('notes'));
    return lines.join('\n');
  }

  function repBindToolbar() {
    var seg = document.querySelector('[data-v30-rep-weeks]');
    if (seg) seg.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-week]');
      if (!b) return;
      seg.querySelectorAll('button').forEach(function (x) { x.classList.toggle('active', x === b); });
      repLoad(b.dataset.week);
    });
    var picker = document.querySelector('[data-v30-rep-week-picker]');
    if (picker) picker.addEventListener('change', function () {
      if (!picker.value) return;
      // Desactive les pills (aucune n'est 'active')
      if (seg) seg.querySelectorAll('button').forEach(function (x) { x.classList.remove('active'); });
      repLoad(picker.value);
    });
    var refresh = document.querySelector('[data-v30-rep-refresh]');
    if (refresh) refresh.addEventListener('click', function () {
      var active = document.querySelector('[data-v30-rep-weeks] button.active');
      repLoad(active ? active.dataset.week : 'current');
    });
    var copy = document.querySelector('[data-v30-rep-copy]');
    if (copy) copy.addEventListener('click', function () {
      var md = repToMarkdown();
      navigator.clipboard.writeText(md).then(function () {
        if (window.showToast) window.showToast('Markdown copié', 'success');
      });
    });
    var genSummary = document.querySelector('[data-v30-rep-gen-summary]');
    if (genSummary) genSummary.addEventListener('click', function () {
      var k = (REP.data && REP.data.kpis) || {};
      var raw = (REP.data && REP.data._raw) || {};
      var kpi = raw.kpi || {};
      var week = REP.week || '—';
      var prompt = 'Tu es un assistant pour un cabinet de recrutement B2B (placement de consultants).\n' +
        'Génère un résumé éditorial professionnel et concis de la semaine ' + week + ' en 2-3 phrases (en français), ' +
        'basé sur ces chiffres :\n' +
        '- Prospects contactés : ' + (k.prospects_contacted || 0) + '\n' +
        '- RDV planifiés : ' + (k.rdv_scheduled || 0) + '\n' +
        '- Pushs envoyés : ' + (k.pushs_sent || 0) + '\n' +
        '- Notes d\'appel : ' + (k.calls_made || 0) + '\n' +
        '- Entreprises touchées : ' + (kpi.companies_touched || 0) + '\n' +
        '- Taux de conversion : ' + (kpi.conversion_pct || 0) + '%\n\n' +
        'Style : direct, professionnel, sans bullshit. Inclus les points forts de la semaine. ' +
        'Réponds uniquement avec le résumé, sans titre ni introduction.';
      var summaryEl = document.querySelector('[data-v30-rep-ce="summary"]');
      if (!summaryEl) return;
      genSummary.disabled = true;
      genSummary.textContent = 'Génération…';
      (typeof callOllama === 'function' ? callOllama(prompt, { stream: false, timeoutMs: 60000 }) : Promise.reject('callOllama indisponible'))
        .then(function (text) {
          if (text && text.trim()) {
            summaryEl.innerText = text.trim();
            repSaveCE();
            if (window.showToast) window.showToast('Résumé généré', 'success', 2000);
          }
        })
        .catch(function (err) {
          if (window.showToast) window.showToast('IA indisponible : ' + err, 'error', 4000);
        })
        .finally(function () {
          genSummary.disabled = false;
          genSummary.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Générer IA';
        });
    });
    var xlsx = document.querySelector('[data-v30-rep-xlsx]');
    if (xlsx) xlsx.addEventListener('click', function () {
      var week = REP.week || isoWeek(new Date());
      var a = document.createElement('a');
      a.href = '/api/stats/export_weekly_xlsx?week=' + encodeURIComponent(week);
      a.download = '';
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (window.showToast) window.showToast('Export Excel en cours…', 'info', 2500);
    });
    var pdf = document.querySelector('[data-v30-rep-pdf]');
    if (pdf) pdf.addEventListener('click', function () {
      var doc = document.querySelector('[data-v30-rep-doc]');
      if (!doc) return;
      // Envoie le HTML + markdown au back pour conversion ReportLab
      fetch('/api/rapport/export-pdf', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          week: REP.week,
          html: doc.outerHTML,
          markdown: repToMarkdown()
        })
      }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.blob();
      }).then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'rapport-' + (REP.week || 'semaine') + '.pdf';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      }).catch(function (err) {
        if (window.showToast) window.showToast('Export PDF : ' + err.message, 'error');
        else alert('Export PDF : ' + err.message);
      });
    });

    // Autosave CE on input (debounced)
    var t = null;
    document.addEventListener('input', function (e) {
      if (!e.target.matches || !e.target.matches('[data-v30-rep-ce]')) return;
      clearTimeout(t);
      t = setTimeout(repSaveCE, 350);
    });
  }

  // ═══════════════════════════════════════════════════════
  // Charts Chart.js
  // ═══════════════════════════════════════════════════════
  var CHART_CDNS = [
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.7/chart.umd.min.js',
    'https://unpkg.com/chart.js@4.4.7/dist/chart.umd.min.js'
  ];
  var _chartInstances = {};
  var _statsProspects = [];

  function _loadChartJS() {
    return new Promise(function (resolve) {
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
  }

  function _destroyChart(id) {
    if (_chartInstances[id]) { _chartInstances[id].destroy(); delete _chartInstances[id]; }
  }

  function _isDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function _chartColors() {
    var dark = _isDark();
    return {
      text: dark ? '#e2e8f0' : '#334155',
      grid: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'
    };
  }

  function _hideChart(canvasId, values) {
    var allZero = !values || values.every(function (v) { return !v; });
    var el = document.getElementById(canvasId);
    var card = el && el.closest('.v30-chart-card');
    if (card) card.style.display = allZero ? 'none' : '';
  }

  function _renderCharts(d, colors) {
    var palette8 = ['#64748b', '#f59e0b', '#3b82f6', '#ef4444', '#22c55e', '#94a3b8', '#8b5cf6', '#ec4899'];

    // 1) Répartition par statut (Doughnut)
    _destroyChart('chartStatus');
    var statusLabels = Object.keys(d.statusDistribution || {});
    var statusVals = Object.values(d.statusDistribution || {});
    _hideChart('chartStatus', statusVals);
    var ctxS = document.getElementById('chartStatus');
    if (ctxS && statusVals.some(function (v) { return v; })) {
      _chartInstances['chartStatus'] = new Chart(ctxS, {
        type: 'doughnut',
        data: { labels: statusLabels, datasets: [{ data: statusVals, backgroundColor: palette8.slice(0, statusLabels.length), borderWidth: 0 }] },
        options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { padding: 14, font: { size: 12 } } } } }
      });
    }

    // 2) Distribution pertinence (Polar Area)
    _destroyChart('chartPertinence');
    var pert = d.pertinenceDistribution || {};
    var pertVals = ['1', '2', '3', '4', '5'].map(function (k) { return pert[k] || 0; });
    _hideChart('chartPertinence', pertVals);
    var ctxP = document.getElementById('chartPertinence');
    if (ctxP && pertVals.some(function (v) { return v; })) {
      _chartInstances['chartPertinence'] = new Chart(ctxP, {
        type: 'polarArea',
        data: { labels: ['1 ★', '2 ★', '3 ★', '4 ★', '5 ★'], datasets: [{ data: pertVals, backgroundColor: ['#94a3b8cc', '#f59e0bcc', '#eab308cc', '#f97316cc', '#ef4444cc'], borderWidth: 0 }] },
        options: { responsive: true, scales: { r: { ticks: { display: false }, grid: { color: colors.grid } } }, plugins: { legend: { position: 'bottom', labels: { padding: 12, font: { size: 11 } } } } }
      });
    }

    // 3) Push par semaine (Bar)
    _destroyChart('chartPush');
    var pushItems = d.pushPerWeek || [];
    _hideChart('chartPush', pushItems.map(function (i) { return i.count; }));
    var ctxPush = document.getElementById('chartPush');
    if (ctxPush) {
      _chartInstances['chartPush'] = new Chart(ctxPush, {
        type: 'bar',
        data: { labels: pushItems.map(function (i) { return i.label; }), datasets: [{ label: 'Push envoyés', data: pushItems.map(function (i) { return i.count; }), backgroundColor: '#32b8c6cc', borderRadius: 6, borderSkipped: false }] },
        options: { responsive: true, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: colors.grid } } }, plugins: { legend: { display: false } } }
      });
    }

    // 4) RDV par mois (Line)
    _destroyChart('chartRdv');
    var rdvItems = d.rdvPerMonth || [];
    _hideChart('chartRdv', rdvItems.map(function (i) { return i.count; }));
    var ctxRdv = document.getElementById('chartRdv');
    if (ctxRdv) {
      _chartInstances['chartRdv'] = new Chart(ctxRdv, {
        type: 'line',
        data: { labels: rdvItems.map(function (i) { return i.label; }), datasets: [{ label: 'RDV', data: rdvItems.map(function (i) { return i.count; }), borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.15)', fill: true, tension: 0.35, pointRadius: 5, pointBackgroundColor: '#22c55e' }] },
        options: { responsive: true, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: colors.grid } } }, plugins: { legend: { display: false } } }
      });
    }

    // 5) Top entreprises (Horizontal Bar)
    _destroyChart('chartCompanies');
    var compItems = d.topCompanies || [];
    _hideChart('chartCompanies', compItems.map(function (i) { return i.count; }));
    var ctxComp = document.getElementById('chartCompanies');
    if (ctxComp) {
      _chartInstances['chartCompanies'] = new Chart(ctxComp, {
        type: 'bar',
        data: { labels: compItems.map(function (i) { return i.name; }), datasets: [{ label: 'Prospects', data: compItems.map(function (i) { return i.count; }), backgroundColor: ['#6366f1cc', '#8b5cf6cc', '#a78bfacc', '#c4b5fdcc', '#3b82f6cc', '#60a5facc', '#93c5fdcc', '#bfdbfecc'], borderRadius: 6, borderSkipped: false }] },
        options: { indexAxis: 'y', responsive: true, scales: { x: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: colors.grid } }, y: { grid: { display: false } } }, plugins: { legend: { display: false } } }
      });
    }

    // 6) Funnel de conversion (Bar)
    _destroyChart('chartFunnel');
    var statusOrder = ["Pas d'actions", 'Appelé', 'À rappeler', 'Messagerie', 'Rendez-vous', 'Prospecté', 'Pas intéressé'];
    var statusCounts = d.statusDistribution || {};
    var funnelData = statusOrder.map(function (s) { return statusCounts[s] || 0; });
    _hideChart('chartFunnel', funnelData);
    var ctxFunnel = document.getElementById('chartFunnel');
    if (ctxFunnel && funnelData.some(function (v) { return v; })) {
      _chartInstances['chartFunnel'] = new Chart(ctxFunnel, {
        type: 'bar',
        data: { labels: statusOrder, datasets: [{ data: funnelData, backgroundColor: ['#64748bcc', '#3b82f6cc', '#f59e0bcc', '#8b5cf6cc', '#22c55ecc', '#10b981cc', '#ef4444cc'], borderRadius: 8, borderSkipped: false }] },
        options: { responsive: true, scales: { x: { grid: { display: false }, ticks: { font: { size: 10 } } }, y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: colors.grid } } }, plugins: { legend: { display: false } } }
      });
    }

    // 7) Évolution du portefeuille (Line)
    _destroyChart('chartPortfolio');
    var ctxPort = document.getElementById('chartPortfolio');
    _hideChart('chartPortfolio', _statsProspects.length > 0 ? [1] : []);
    if (ctxPort && _statsProspects.length > 0) {
      var now = new Date();
      var portWeeks = [];
      var portLabels = [];
      for (var w = 11; w >= 0; w--) {
        var wEnd = new Date(now);
        wEnd.setDate(now.getDate() - w * 7);
        var dateStr = wEnd.toISOString().split('T')[0];
        var cnt = _statsProspects.filter(function (p) { var lc = p.lastContact || ''; return lc && lc <= dateStr; }).length;
        portWeeks.push(cnt || _statsProspects.length);
        portLabels.push('S-' + w);
      }
      _chartInstances['chartPortfolio'] = new Chart(ctxPort, {
        type: 'line',
        data: { labels: portLabels, datasets: [{ label: 'Prospects actifs', data: portWeeks, borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.12)', fill: true, tension: 0.4, pointRadius: 4, pointBackgroundColor: '#6366f1' }] },
        options: { responsive: true, scales: { x: { grid: { display: false } }, y: { beginAtZero: false, grid: { color: colors.grid } } }, plugins: { legend: { display: false } } }
      });
    }

    // 8) Top compétences/tags (Horizontal Bar)
    _destroyChart('chartTags');
    var ctxTags = document.getElementById('chartTags');
    if (ctxTags && _statsProspects.length > 0) {
      var tagCounts = {};
      _statsProspects.forEach(function (p) {
        (p.tags || []).forEach(function (t) {
          var k = (t || '').trim();
          if (k) tagCounts[k] = (tagCounts[k] || 0) + 1;
        });
      });
      var sortedTags = Object.keys(tagCounts).map(function (k) { return [k, tagCounts[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 15);
      _hideChart('chartTags', sortedTags.map(function (s) { return s[1]; }));
      if (sortedTags.length > 0) {
        var tagPalette = ['#f36f21cc', '#3b82f6cc', '#22c55ecc', '#f59e0bcc', '#8b5cf6cc', '#ec4899cc', '#14b8a6cc', '#6366f1cc', '#ef4444cc', '#64748bcc', '#10b981cc', '#a855f7cc', '#f97316cc', '#06b6d4cc', '#84cc16cc'];
        _chartInstances['chartTags'] = new Chart(ctxTags, {
          type: 'bar',
          data: { labels: sortedTags.map(function (s) { return s[0]; }), datasets: [{ data: sortedTags.map(function (s) { return s[1]; }), backgroundColor: tagPalette, borderRadius: 6, borderSkipped: false }] },
          options: { indexAxis: 'y', responsive: true, scales: { x: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: colors.grid } }, y: { grid: { display: false }, ticks: { font: { size: 11 } } } }, plugins: { legend: { display: false } } }
        });
      }
    }

    // 9) Appels par semaine (Bar)
    _destroyChart('chartCalls');
    var actItems = d.activityPerWeek || [];
    var callData = actItems.map(function (i) { return i.calls || 0; });
    _hideChart('chartCalls', callData);
    var ctxCalls = document.getElementById('chartCalls');
    if (ctxCalls && callData.some(function (v) { return v; })) {
      _chartInstances['chartCalls'] = new Chart(ctxCalls, {
        type: 'bar',
        data: { labels: actItems.map(function (i) { return i.label; }), datasets: [{ label: 'Appels passés', data: callData, backgroundColor: '#f59e0bcc', borderRadius: 6, borderSkipped: false }] },
        options: { responsive: true, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: colors.grid } } }, plugins: { legend: { display: false } } }
      });
    }

    // 10) Activité hebdo combinée : appels + notes + push (Stacked Bar)
    _destroyChart('chartActivityWeek');
    var noteData = actItems.map(function (i) { return i.callNotes || 0; });
    var pushData2 = actItems.map(function (i) { return i.push || 0; });
    var combined = callData.map(function (v, idx) { return v + noteData[idx] + pushData2[idx]; });
    _hideChart('chartActivityWeek', combined);
    var ctxAct = document.getElementById('chartActivityWeek');
    if (ctxAct && combined.some(function (v) { return v; })) {
      _chartInstances['chartActivityWeek'] = new Chart(ctxAct, {
        type: 'bar',
        data: {
          labels: actItems.map(function (i) { return i.label; }),
          datasets: [
            { label: 'Appels', data: callData, backgroundColor: '#f59e0bcc', borderRadius: 4, borderSkipped: false, stack: 'activity' },
            { label: "Notes d'appel", data: noteData, backgroundColor: '#6366f1cc', borderRadius: 4, borderSkipped: false, stack: 'activity' },
            { label: 'Push', data: pushData2, backgroundColor: '#32b8c6cc', borderRadius: 4, borderSkipped: false, stack: 'activity' }
          ]
        },
        options: { responsive: true, scales: { x: { grid: { display: false }, stacked: true }, y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: colors.grid }, stacked: true } }, plugins: { legend: { position: 'bottom', labels: { padding: 12, font: { size: 11 }, usePointStyle: true } } } }
      });
    }
  }

  function loadCharts() {
    var loader = document.getElementById('v30ChartsLoader');
    var grid = document.getElementById('v30ChartsGrid');
    if (!grid) return;

    _loadChartJS().then(function (available) {
      if (!available) {
        if (loader) loader.textContent = 'Charts indisponibles — vérifiez votre connexion internet.';
        return;
      }
      Promise.all([
        fetch('/api/stats/charts', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }),
        fetch('/api/data', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; })
      ]).then(function (results) {
        var d = results[0];
        var apiData = results[1];
        if (!d || !d.ok) {
          if (loader) loader.textContent = 'Impossible de charger les données des graphiques.';
          return;
        }
        _statsProspects = (apiData && Array.isArray(apiData.prospects)) ? apiData.prospects : [];
        var colors = _chartColors();
        Chart.defaults.color = colors.text;
        Chart.defaults.borderColor = colors.grid;
        if (loader) loader.style.display = 'none';
        grid.style.display = '';
        _renderCharts(d, colors);
      }).catch(function (err) {
        console.error('[v30 charts]', err);
        if (loader) loader.textContent = 'Erreur lors du chargement des graphiques.';
      });
    });
  }

  // ═══════════════════════════════════════════════════════
  // Rapport WYSIWYG (tab "Rapport")
  // ═══════════════════════════════════════════════════════

  // Expose loader pour tab switch (chargé quand on clique sur l'onglet Rapport)
  var repLoaded = false;
  function repMaybeLoad() {
    if (repLoaded) return;
    repLoaded = true;
    repLoad('current');
  }

  function init() {
    bindTabs();
    bindPeriod();
    loadKPIs();
    loadCharts();
    repBindToolbar();

    // Hook tab click : charge le rapport à la première ouverture
    var tabBtn = document.querySelector('[data-v30-stats-tabs] button[data-tab="rapport"]');
    if (tabBtn) tabBtn.addEventListener('click', repMaybeLoad);
    // Si l'ancre #rapport pointe déjà sur le tab, charge direct
    if (location.hash === '#rapport') repMaybeLoad();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
