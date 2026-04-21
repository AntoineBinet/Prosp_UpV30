/* ProspUp v30 — Rapport hebdomadaire : fetch /api/rapport-hebdo + autosave notes */
(function () {
  'use strict';

  var STATE = { week: null, data: null };
  var WEEK_KEY = null;

  function $(s) { return document.querySelector(s); }
  function esc(s) { var t = document.createElement('span'); t.textContent = s == null ? '' : String(s); return t.innerHTML; }
  function fetchJSON(url) {
    return fetch(url, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function isoWeek(d) {
    var target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var day = target.getUTCDay() || 7;
    target.setUTCDate(target.getUTCDate() + 4 - day);
    var y1 = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
    var w = Math.ceil(((target - y1) / 86400000 + 1) / 7);
    return target.getUTCFullYear() + '-W' + String(w).padStart(2, '0');
  }
  function weekParam(which) {
    var d = new Date();
    if (which === 'prev') d.setDate(d.getDate() - 7);
    return isoWeek(d);
  }

  function renderRange(data) {
    var el = $('[data-field="week-range"]');
    if (!el) return;
    var from = data && data.week && data.week.from;
    var to = data && data.week && data.week.to;
    if (from && to) el.textContent = 'Du ' + from + ' au ' + to;
    else el.textContent = STATE.week || '—';
  }

  function renderKpis(data) {
    var host = $('[data-v30-rapport-kpis]');
    if (!host) return;
    var kpis = (data && data.kpis) || {};
    var cards = [
      { label: 'Prospects contactés', value: kpis.prospects_contacted, delta: kpis.prospects_delta },
      { label: 'RDV planifiés', value: kpis.rdv_scheduled, delta: kpis.rdv_delta },
      { label: 'Pushs envoyés', value: kpis.pushs_sent, delta: kpis.pushs_delta },
      { label: 'Appels passés', value: kpis.calls_made, delta: kpis.calls_delta }
    ];
    host.innerHTML = cards.map(function (c) {
      var val = c.value != null ? c.value : '—';
      var delta = c.delta != null ? (c.delta >= 0 ? '+' + c.delta : c.delta) + ' vs. sem. précédente' : '';
      return '<div class="v30-kpi-card">' +
        '<div class="v30-kpi-card__label">' + esc(c.label) + '</div>' +
        '<div class="v30-kpi-card__value num">' + esc(val) + '</div>' +
        (delta ? '<div class="v30-kpi-card__delta">' + esc(delta) + '</div>' : '') +
      '</div>';
    }).join('');
  }

  function renderActivity(data) {
    var host = $('[data-v30-rapport-activity]');
    if (!host) return;
    var items = (data && data.activity) || [];
    if (!items.length) {
      host.innerHTML = '<div class="empty" style="padding:20px;">Aucune activité cette semaine.</div>';
      return;
    }
    host.innerHTML = items.slice(0, 20).map(function (it) {
      return '<div class="v30-rapport-row">' +
        '<span class="v30-rapport-row__when">' + esc(it.when || it.date || '') + '</span>' +
        '<span class="v30-rapport-row__label">' + esc(it.title || it.type || '') + '</span>' +
        '<span class="v30-rapport-row__value">' + esc(it.value || it.detail || '') + '</span>' +
      '</div>';
    }).join('');
  }

  function renderPipeline(data) {
    var host = $('[data-v30-rapport-pipeline]');
    if (!host) return;
    var items = (data && data.pipeline) || [];
    if (!items.length) {
      host.innerHTML = '<div class="empty" style="padding:20px;">Aucune étape remontée.</div>';
      return;
    }
    host.innerHTML = items.map(function (it) {
      return '<div class="v30-rapport-row">' +
        '<span class="v30-rapport-row__when">' + esc(it.stage || '') + '</span>' +
        '<span class="v30-rapport-row__label">' + esc(it.label || it.title || '') + '</span>' +
        '<span class="v30-rapport-row__value num">' + esc(it.count != null ? it.count : '') + '</span>' +
      '</div>';
    }).join('');
  }

  function loadWeek(which) {
    STATE.week = weekParam(which);
    WEEK_KEY = 'prospup_rapport_' + STATE.week;
    return fetchJSON('/api/rapport-hebdo?week=' + encodeURIComponent(STATE.week))
      .then(function (res) {
        STATE.data = res || {};
        renderRange(STATE.data);
        renderKpis(STATE.data);
        renderActivity(STATE.data);
        renderPipeline(STATE.data);
        loadNotes();
      })
      .catch(function (err) {
        console.error('[v30 rapport]', err);
        renderRange({});
      });
  }

  // ─── Notes (autosave localStorage par semaine) ───────────
  function loadNotes() {
    var el = $('[data-v30-rapport-notes]');
    if (!el || !WEEK_KEY) return;
    try {
      var saved = localStorage.getItem(WEEK_KEY);
      el.innerHTML = saved || '';
    } catch (_) { el.innerHTML = ''; }
  }
  function bindNotes() {
    var el = $('[data-v30-rapport-notes]');
    if (!el) return;
    var t = null;
    el.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () {
        if (!WEEK_KEY) return;
        try { localStorage.setItem(WEEK_KEY, el.innerHTML); } catch (_) {}
      }, 300);
    });
  }

  // ─── Toolbar ────────────────────────────────────────────
  function bindWeekToggle() {
    var seg = $('[data-v30-rapport-weeks]');
    if (!seg) return;
    seg.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-week]');
      if (!btn) return;
      seg.querySelectorAll('button[data-week]').forEach(function (b) {
        var active = (b === btn);
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      loadWeek(btn.dataset.week);
    });
  }

  function toMarkdown() {
    var d = STATE.data || {};
    var lines = ['# Rapport hebdomadaire · ' + (STATE.week || '')];
    var k = d.kpis || {};
    lines.push('', '## KPI');
    Object.keys(k).forEach(function (key) { lines.push('- ' + key + ' : ' + k[key]); });
    (d.activity || []).slice(0, 15).forEach(function (it) {
      lines.push('- ' + (it.when || '') + ' — ' + (it.title || '') + ' · ' + (it.value || it.detail || ''));
    });
    var notes = ($('[data-v30-rapport-notes]') || {}).innerText || '';
    if (notes.trim()) lines.push('', '## Notes', notes);
    return lines.join('\n');
  }

  function bindCopy() {
    var btn = $('[data-v30-rapport-copy]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var md = toMarkdown();
      navigator.clipboard.writeText(md).then(function () {
        if (window.showToast) window.showToast('Markdown copié', 'success');
        else alert('Markdown copié');
      });
    });
  }

  function bindPdf() {
    var btn = $('[data-v30-rapport-pdf]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      // Fallback : ouvre la page legacy pour l'export PDF existant
      window.location.href = '/rapport?export=pdf&week=' + encodeURIComponent(STATE.week || '');
    });
  }

  function init() {
    bindWeekToggle();
    bindNotes();
    bindCopy();
    bindPdf();
    loadWeek('current');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
