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

  // /api/rapport-hebdo retourne { ok, data: { kpi, statuts, push_detail,
  // notes_detail, touched_companies, week_label, start, end } }.
  // On normalise en lisant toujours `data` (le wrap).

  function renderRange(data) {
    var el = $('[data-field="week-range"]');
    if (!el) return;
    if (data && data.week_label) { el.textContent = data.week_label; return; }
    var from = (data && data.start) || (data && data.week && data.week.from);
    var to = (data && data.end) || (data && data.week && data.week.to);
    if (from && to) el.textContent = 'Du ' + from + ' au ' + to;
    else el.textContent = STATE.week || '—';
  }

  function renderKpis(data) {
    var host = $('[data-v30-rapport-kpis]');
    if (!host) return;
    var k = (data && data.kpi) || {};
    var cards = [
      { label: 'Entreprises contactées', value: k.companies_touched },
      { label: 'RDV planifiés',          value: k.rdv },
      { label: 'Pushs envoyés',          value: k.push_total,
        sub: (k.push_email != null && k.push_linkedin != null)
          ? (k.push_email + ' email · ' + k.push_linkedin + ' LinkedIn') : '' },
      { label: 'Relances en retard',     value: k.overdue }
    ];
    host.innerHTML = cards.map(function (c) {
      var val = c.value != null ? c.value : '—';
      return '<div class="v30-kpi-card">' +
        '<div class="v30-kpi-card__label">' + esc(c.label) + '</div>' +
        '<div class="v30-kpi-card__value num">' + esc(val) + '</div>' +
        (c.sub ? '<div class="v30-kpi-card__delta">' + esc(c.sub) + '</div>' : '') +
      '</div>';
    }).join('');
  }

  function renderActivity(data) {
    var host = $('[data-v30-rapport-activity]');
    if (!host) return;
    // Fusion push_detail + notes_detail + touched_companies en activite.
    var items = [];
    (data && data.push_detail || []).forEach(function (p) {
      items.push({
        when: p.date || '',
        title: 'Push ' + (p.channel || '—'),
        value: p.prospect_name || ('prospect #' + (p.prospect_id || ''))
      });
    });
    (data && data.notes_detail || []).forEach(function (n) {
      items.push({
        when: n.date || '',
        title: 'Note d\'appel',
        value: n.prospect_name || ('prospect #' + (n.prospect_id || ''))
      });
    });
    if (!items.length) {
      host.innerHTML = '<div class="empty" style="padding:20px;">Aucune activité cette semaine.</div>';
      return;
    }
    items.sort(function (a, b) { return (a.when < b.when) ? 1 : -1; });
    host.innerHTML = items.slice(0, 20).map(function (it) {
      return '<div class="v30-rapport-row">' +
        '<span class="v30-rapport-row__when">' + esc(it.when) + '</span>' +
        '<span class="v30-rapport-row__label">' + esc(it.title) + '</span>' +
        '<span class="v30-rapport-row__value">' + esc(it.value) + '</span>' +
      '</div>';
    }).join('');
  }

  function renderPipeline(data) {
    var host = $('[data-v30-rapport-pipeline]');
    if (!host) return;
    var statuts = (data && data.statuts) || {};
    var keys = Object.keys(statuts).sort(function (a, b) { return statuts[b] - statuts[a]; });
    if (!keys.length) {
      host.innerHTML = '<div class="empty" style="padding:20px;">Aucune étape remontée.</div>';
      return;
    }
    host.innerHTML = keys.map(function (label) {
      return '<div class="v30-rapport-row">' +
        '<span class="v30-rapport-row__when"></span>' +
        '<span class="v30-rapport-row__label">' + esc(label) + '</span>' +
        '<span class="v30-rapport-row__value num">' + esc(statuts[label]) + '</span>' +
      '</div>';
    }).join('');
  }

  function loadWeek(whichOrIso) {
    if (whichOrIso && /^\d{4}-W\d{2}$/.test(whichOrIso)) {
      STATE.week = whichOrIso;
    } else {
      STATE.week = weekParam(whichOrIso);
    }
    WEEK_KEY = 'prospup_rapport_' + STATE.week;
    var picker = $('[data-v30-rapport-week-picker]');
    if (picker) picker.value = STATE.week;
    return fetchJSON('/api/rapport-hebdo?week=' + encodeURIComponent(STATE.week))
      .then(function (res) {
        // L'API emballe dans { data, ok }. On passe l'objet data partout.
        STATE.data = (res && res.data) || res || {};
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
    if (seg) seg.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-week]');
      if (!btn) return;
      seg.querySelectorAll('button[data-week]').forEach(function (b) {
        var active = (b === btn);
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      loadWeek(btn.dataset.week);
    });
    var picker = $('[data-v30-rapport-week-picker]');
    if (picker) picker.addEventListener('change', function () {
      if (!picker.value) return;
      if (seg) seg.querySelectorAll('button').forEach(function (x) { x.classList.remove('active'); });
      loadWeek(picker.value);
    });
  }

  function toMarkdown() {
    var d = STATE.data || {};
    var lines = ['# Rapport hebdomadaire · ' + (d.week_label || STATE.week || '')];
    var k = d.kpi || {};
    lines.push('', '## KPI');
    Object.keys(k).forEach(function (key) { lines.push('- ' + key + ' : ' + k[key]); });
    var statuts = d.statuts || {};
    if (Object.keys(statuts).length) {
      lines.push('', '## Répartition pipeline');
      Object.keys(statuts).forEach(function (s) { lines.push('- ' + s + ' : ' + statuts[s]); });
    }
    if ((d.touched_companies || []).length) {
      lines.push('', '## Entreprises contactées', (d.touched_companies || []).map(function (c) { return '- ' + c; }).join('\n'));
    }
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
      // Fallback : ouvre la page legacy pour l'export PDF existant (flux complet Markdown→PDF).
      window.location.href = '/rapport?export=pdf&week=' + encodeURIComponent(STATE.week || '') + '&force_v29=1';
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
