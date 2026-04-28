/* ProspUp v30 — Rapport hebdomadaire : templates, filtres, exports, historique */
(function () {
  'use strict';

  var STATE = {
    week: null,
    data: null,
    template: 'weekly',
    filters: { kpi: true, activity: true, pipeline: true, notes: true }
  };
  var WEEK_KEY = null;
  var HISTORY_KEY = 'prospup_rapport_history';

  function $(s) { return document.querySelector(s); }
  function $$(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
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
  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
  }

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
      return '<div class="kpi">' +
        '<div class="kpi__label">' + esc(c.label) + '</div>' +
        '<div class="kpi__value num">' + esc(val) + '</div>' +
        (c.sub ? '<div class="kpi__delta">' + esc(c.sub) + '</div>' : '') +
      '</div>';
    }).join('');
  }

  function renderActivity(data) {
    var host = $('[data-v30-rapport-activity]');
    if (!host) return;
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

  // ─── Templates ────────────────────────────────────────
  function bindTemplates() {
    var grid = $('[data-v30-templates]');
    if (!grid) return;
    grid.addEventListener('click', function (e) {
      var card = e.target.closest('button[data-template]');
      if (!card) return;
      grid.querySelectorAll('button[data-template]').forEach(function (b) {
        b.classList.toggle('is-active', b === card);
      });
      STATE.template = card.dataset.template || 'weekly';
      if (STATE.template === 'monthly') {
        // 4 dernières semaines : on cible la semaine en cours par défaut
        loadWeek('current');
        toast('Template mensuel sélectionné — données basées sur 4 semaines glissantes', 'info');
      } else if (STATE.template === 'custom') {
        toast('Template custom — utilise le sélecteur de semaine et les filtres', 'info');
      } else {
        loadWeek('current');
      }
    });
  }

  // ─── Filtres ────────────────────────────────────────────
  function bindFilters() {
    document.querySelectorAll('[data-v30-filter]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var key = cb.getAttribute('data-v30-filter');
        STATE.filters[key] = !!cb.checked;
      });
    });
  }

  // ─── Markdown / Aperçu ─────────────────────────────────
  function toMarkdown() {
    var d = STATE.data || {};
    var label = STATE.template === 'monthly' ? 'mensuel'
      : STATE.template === 'custom' ? 'personnalisé' : 'hebdomadaire';
    var lines = ['# Rapport ' + label + ' · ' + (d.week_label || STATE.week || '')];
    var k = d.kpi || {};
    if (STATE.filters.kpi) {
      lines.push('', '## KPI');
      Object.keys(k).forEach(function (key) { lines.push('- ' + key + ' : ' + k[key]); });
    }
    var statuts = d.statuts || {};
    if (STATE.filters.pipeline && Object.keys(statuts).length) {
      lines.push('', '## Répartition pipeline');
      Object.keys(statuts).forEach(function (s) { lines.push('- ' + s + ' : ' + statuts[s]); });
    }
    if (STATE.filters.activity && (d.touched_companies || []).length) {
      lines.push('', '## Entreprises contactées', (d.touched_companies || []).map(function (c) { return '- ' + c; }).join('\n'));
    }
    var notes = ($('[data-v30-rapport-notes]') || {}).innerText || '';
    if (STATE.filters.notes && notes.trim()) lines.push('', '## Notes', notes);
    return lines.join('\n');
  }

  function markdownToHtml(md) {
    // Conversion ultra-simple Markdown→HTML pour l'aperçu (titres, listes, paragraphes).
    var lines = (md || '').split('\n');
    var html = '';
    var inList = false;
    lines.forEach(function (l) {
      var line = l;
      if (/^# /.test(line)) { if (inList) { html += '</ul>'; inList = false; } html += '<h1>' + esc(line.slice(2)) + '</h1>'; }
      else if (/^## /.test(line)) { if (inList) { html += '</ul>'; inList = false; } html += '<h2>' + esc(line.slice(3)) + '</h2>'; }
      else if (/^### /.test(line)) { if (inList) { html += '</ul>'; inList = false; } html += '<h3>' + esc(line.slice(4)) + '</h3>'; }
      else if (/^- /.test(line)) { if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + esc(line.slice(2)) + '</li>'; }
      else if (line.trim() === '') { if (inList) { html += '</ul>'; inList = false; } html += ''; }
      else { if (inList) { html += '</ul>'; inList = false; } html += '<p>' + esc(line) + '</p>'; }
    });
    if (inList) html += '</ul>';
    return html;
  }

  function bindPreview() {
    var btn = $('[data-v30-rapport-preview]');
    var bd = $('[data-v30-rapport-preview-bd]');
    if (!btn || !bd) return;
    btn.addEventListener('click', function () {
      var body = $('[data-v30-rapport-preview-body]');
      if (body) body.innerHTML = markdownToHtml(toMarkdown());
      bd.hidden = false; bd.classList.add('is-open');
    });
    document.querySelectorAll('[data-v30-rapport-preview-close]').forEach(function (c) {
      c.addEventListener('click', function () {
        bd.classList.remove('is-open'); bd.hidden = true;
      });
    });
    bd.addEventListener('click', function (e) {
      if (e.target === bd) { bd.classList.remove('is-open'); bd.hidden = true; }
    });
    var pdfBtn = $('[data-v30-rapport-preview-pdf]');
    if (pdfBtn) pdfBtn.addEventListener('click', exportPdf);
  }

  function bindCopy() {
    var btn = $('[data-v30-rapport-copy]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var md = toMarkdown();
      navigator.clipboard.writeText(md).then(function () {
        toast('Markdown copié', 'success');
      }).catch(function () { toast('Markdown copié (fallback)', 'info'); });
    });
  }

  // ─── Historique local ────────────────────────────────
  function pushHistory(format) {
    var item = {
      date: new Date().toISOString(),
      template: STATE.template,
      week: STATE.week,
      format: format
    };
    var list = [];
    try { list = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (_) { list = []; }
    list.unshift(item);
    list = list.slice(0, 30);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch (_) {}
    renderHistory();
  }
  function renderHistory() {
    var tbody = $('[data-v30-rapport-history-tbody]');
    if (!tbody) return;
    var list = [];
    try { list = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (_) { list = []; }
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty" style="padding:20px;">Aucun rapport généré (historique local).</td></tr>';
      return;
    }
    var TEMPLATE_LABEL = { weekly: 'Weekly Summary', monthly: 'Monthly Digest', custom: 'Custom' };
    tbody.innerHTML = list.map(function (it) {
      var d = new Date(it.date);
      var dStr = isNaN(d.getTime()) ? it.date : d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
      return '<tr>' +
        '<td class="u-mono">' + esc(dStr) + '</td>' +
        '<td>' + esc(TEMPLATE_LABEL[it.template] || it.template || '—') + '</td>' +
        '<td class="u-mono">' + esc(it.week || '—') + '</td>' +
        '<td>' + esc((it.format || '—').toUpperCase()) + '</td>' +
      '</tr>';
    }).join('');
  }

  // ─── Exports ───────────────────────────────────────────
  function exportPdf() {
    var btn = $('[data-v30-rapport-pdf]');
    var label = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = 'Export en cours…'; }
    fetch('/api/rapport/export-pdf', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        week: STATE.week || '',
        markdown: toMarkdown(),
        template: STATE.template
      })
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.blob();
    }).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'rapport-' + (STATE.template || 'weekly') + '-' + (STATE.week || 'semaine') + '.pdf';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      toast('PDF téléchargé', 'success');
      pushHistory('pdf');
    }).catch(function (err) {
      toast('Export PDF : ' + err.message, 'error');
    }).finally(function () {
      if (btn) { btn.disabled = false; btn.innerHTML = label; }
    });
  }

  function exportXlsx() {
    var btn = $('[data-v30-rapport-xlsx]');
    var label = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = 'Export en cours…'; }
    var url = '/api/stats/export_weekly_xlsx?week=' + encodeURIComponent(STATE.week || '');
    fetch(url, { credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.blob();
      }).then(function (blob) {
        var dl = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = dl;
        a.download = 'rapport-' + (STATE.week || 'semaine') + '.xlsx';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(dl); }, 1000);
        toast('Excel téléchargé', 'success');
        pushHistory('excel');
      }).catch(function (err) {
        toast('Export Excel : ' + err.message, 'error');
      }).finally(function () {
        if (btn) { btn.disabled = false; btn.innerHTML = label; }
      });
  }

  function bindPdf() {
    var btn = $('[data-v30-rapport-pdf]');
    if (btn) btn.addEventListener('click', exportPdf);
  }
  function bindXlsx() {
    var btn = $('[data-v30-rapport-xlsx]');
    if (btn) btn.addEventListener('click', exportXlsx);
  }

  function init() {
    bindWeekToggle();
    bindNotes();
    bindCopy();
    bindPdf();
    bindXlsx();
    bindTemplates();
    bindFilters();
    bindPreview();
    renderHistory();
    loadWeek('current');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
