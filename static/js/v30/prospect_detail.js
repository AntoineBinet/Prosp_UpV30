/* ProspUp v30 — Fiche prospect : helpers + fetch */
(function () {
  'use strict';

  var fp = document.querySelector('[data-v30-fp]');
  if (!fp) return;
  var PROSPECT_ID = Number(fp.dataset.prospectId || 0);
  if (!PROSPECT_ID) return;

  var STATE = { prospect: null, events: [], pushLogs: [] };

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(s) {
    var t = document.createElement('span');
    t.textContent = s == null ? '' : String(s);
    return t.innerHTML;
  }

  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '??';
    return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }

  // Mapping aligné sur prospects.js (statuts ProspUp réels) — Phase 1.2.
  // Les libellés sans équivalent direct (Proposition, Gagné) tombent sur
  // un statut neutre — TODO design review pour décider d'une couleur dédiée.
  function statusClass(statut) {
    var map = {
      'Rendez-vous':    'status-rdv',
      'Prospecté':      'status-prosp',
      "Pas d'actions":  'status-idle',
      'Contacté':       'status-called',
      'Appelé':         'status-called',
      'Messagerie':     'status-voicemail',
      'À rappeler':     'status-callback',
      'Pas intéressé':  'status-cold'
    };
    return map[statut] || '';
  }

  function shortDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
    } catch (_) { return iso; }
  }

  function relativeTime(iso) {
    if (!iso) return '—';
    try {
      var t = new Date(iso).getTime();
      var diffMin = Math.floor((Date.now() - t) / 60000);
      if (diffMin < 60) return "aujourd'hui · " + Math.max(1, diffMin) + ' min';
      var diffH = Math.floor(diffMin / 60);
      if (diffH < 24) return "aujourd'hui · il y a " + diffH + ' h';
      var diffJ = Math.floor(diffH / 24);
      if (diffJ === 1) return 'hier';
      if (diffJ < 7) return 'il y a ' + diffJ + ' j';
      return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
    } catch (_) { return '—'; }
  }

  function parseTags(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.filter(Boolean);
    try { return JSON.parse(raw) || []; }
    catch (_) { return String(raw).split(',').map(function (s) { return s.trim(); }).filter(Boolean); }
  }

  function fetchJSON(url, opts) {
    return fetch(url, Object.assign({
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    }, opts || {})).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function fetchPostJSON(url, body) {
    return fetchJSON(url, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
  }

  // ─── Fetch ─────────────────────────────────────────────────
  function loadTimeline() {
    return fetchJSON('/api/prospect/timeline?id=' + encodeURIComponent(PROSPECT_ID))
      .then(function (res) {
        STATE.prospect = (res && res.prospect) || null;
        STATE.events = (res && res.events) || [];
        STATE.pushLogs = STATE.events.filter(function (e) { return (e.type || '').startsWith('push'); });
        if (window.ProspFPRender) window.ProspFPRender.all(STATE);
      })
      .catch(function (err) {
        console.error('[v30 fiche] /api/prospect/timeline failed:', err);
      });
  }

  // ─── Optimistic UI : push envoyé ───────────────────────────
  // Insère localement un événement push sans attendre le re-fetch,
  // pour que la timeline et les badges se mettent à jour instantanément.
  function applyPushOptimistic(detail) {
    if (!detail || Number(detail.prospect_id) !== PROSPECT_ID) return;
    var channel = detail.channel || 'email';
    var ev = {
      type: 'push',
      date: detail.sentAt || new Date().toISOString(),
      title: 'Push (' + channel + ')',
      content: '',
      meta: { channel: channel },
      source: 'push',
      _optimistic: true
    };
    STATE.events = [ev].concat(STATE.events || []);
    STATE.pushLogs = STATE.events.filter(function (e) { return (e.type || '').startsWith('push'); });
    if (window.ProspFPRender) window.ProspFPRender.all(STATE);
  }

  document.addEventListener('v30-push-sent', function (e) {
    applyPushOptimistic(e && e.detail);
    // Re-fetch peu après pour récupérer la version serveur enrichie
    // (template, candidats, consultants) et remplacer la version optimiste.
    setTimeout(loadTimeline, 1500);
  });

  // ─── Auto-refresh quand l'onglet redevient actif ───────────
  var lastRefresh = Date.now();
  var REFRESH_THROTTLE_MS = 5000;
  function maybeRefresh() {
    if (document.hidden) return;
    var now = Date.now();
    if (now - lastRefresh < REFRESH_THROTTLE_MS) return;
    lastRefresh = now;
    loadTimeline();
  }
  document.addEventListener('visibilitychange', maybeRefresh);
  window.addEventListener('focus', maybeRefresh);

  // Inline edit : utilise /api/prospects/bulk-edit avec ids=[PROSPECT_ID]
  function saveField(field, value) {
    var payload = { ids: [PROSPECT_ID], field: field, value: value };
    return fetchPostJSON('/api/prospects/bulk-edit', payload);
  }

  // Export pour les autres morceaux
  window.ProspFP = {
    STATE: STATE,
    ID: PROSPECT_ID,
    $: $, $$: $$,
    esc: esc,
    initials: initials,
    statusClass: statusClass,
    shortDate: shortDate,
    relativeTime: relativeTime,
    parseTags: parseTags,
    fetchJSON: fetchJSON,
    fetchPostJSON: fetchPostJSON,
    loadTimeline: loadTimeline,
    saveField: saveField
  };
})();
