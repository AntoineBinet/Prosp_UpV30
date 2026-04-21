/* ProspUp v30 — Prospects : helpers + state */
(function (global) {
  'use strict';

  var STATE = {
    q: '',
    limit: 50,
    offset: 0,
    total: 0,
    prospects: [],
    companies: {},
    selected: new Set()
  };

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

  function relativeDate(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(iso);
      var diffJ = Math.floor((Date.now() - d.getTime()) / 86400000);
      if (diffJ <= 0) return "aujourd'hui";
      if (diffJ === 1) return 'hier';
      if (diffJ < 7) return 'il y a ' + diffJ + ' j';
      if (diffJ < 60) return 'il y a ' + Math.floor(diffJ / 7) + ' sem';
      return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
    } catch (_) { return iso; }
  }

  function shortDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    } catch (_) { return iso; }
  }

  function statusClass(statut) {
    var map = {
      'Rendez-vous':  'status-meeting',
      'Prospecté':    'status-new',
      "Pas d'actions": 'status-new',
      'Contacté':     'status-contact',
      'À rappeler':   'status-proposal',
      'Proposition':  'status-proposal',
      'Gagné':        'status-won',
      'Perdu':        'status-lost'
    };
    return map[statut] || '';
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

  // Export sur global pour les autres morceaux
  global.ProspV30 = {
    STATE: STATE,
    esc: esc,
    initials: initials,
    relativeDate: relativeDate,
    shortDate: shortDate,
    statusClass: statusClass,
    fetchJSON: fetchJSON,
    fetchPostJSON: fetchPostJSON
  };
})(window);
