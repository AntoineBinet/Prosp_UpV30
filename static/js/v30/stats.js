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
      var d = (res && res.data) || res || {};
      // Structure probable (voir app.py /api/stats) :
      //   d.pushTotal, d.openRate, d.replyRate, d.rdvCount, ...
      // Fallbacks défensifs pour couvrir d'éventuelles variations.
      var push = d.pushTotal != null ? d.pushTotal : (d.push_total || d.push || 0);
      var open = d.openRate  != null ? d.openRate  : (d.open_rate  || 0);
      var reply= d.replyRate != null ? d.replyRate : (d.reply_rate || 0);
      var rdv  = d.rdvCount  != null ? d.rdvCount  : (d.rdv_count  || d.rdv || 0);
      setKPI('push',  Number(push).toLocaleString('fr-FR'));
      setKPI('open',  typeof open  === 'number' ? Math.round(open)  + '%' : open  || '—');
      setKPI('reply', typeof reply === 'number' ? Math.round(reply) + '%' : reply || '—');
      setKPI('rdv',   Number(rdv).toLocaleString('fr-FR'));
    }).catch(function (err) {
      console.error('[v30 stats] /api/stats failed:', err);
      // Fallback : /api/dashboard pour au moins Push + RDV
      fetchJSON('/api/dashboard').then(function (res) {
        var d = (res && res.data) || {};
        setKPI('push',  ((d.week  && d.week.push_total)  || 0).toLocaleString('fr-FR'));
        setKPI('rdv',   ((d.week  && d.week.rdv_total)   || 0).toLocaleString('fr-FR'));
        setKPI('open',  '—');
        setKPI('reply', '—');
      }).catch(function () {});
    });
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

  function init() {
    bindTabs();
    bindPeriod();
    loadKPIs();
    loadTop();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
