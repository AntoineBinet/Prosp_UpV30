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
      var max = rows[0].count;
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
        REP.data = res || {};
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
        alert('Export PDF : ' + err.message + '. Bascule vers la page legacy.');
        window.location.href = '/rapport?export=pdf&week=' + encodeURIComponent(REP.week || '');
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
