/* ProspUp v30 — Métiers IA (custom_metiers CRUD) */
(function () {
  'use strict';

  var STATE = { items: [] };

  function $(s) { return document.querySelector(s); }
  function esc(s) { var t = document.createElement('span'); t.textContent = s == null ? '' : String(s); return t.innerHTML; }
  function fetchJSON(url) {
    return fetch(url, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function postJSON(url, body) {
    return fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) { return r.json(); });
  }

  function render() {
    var host = $('[data-v30-metiers-list]');
    if (!STATE.items.length) {
      host.innerHTML = '<div class="empty" style="padding:24px;">Aucun métier personnalisé. Clique sur <b>Ajouter</b>.</div>';
      return;
    }
    host.innerHTML = STATE.items.map(function (m) {
      return '<div class="v30-metier-row" data-id="' + m.id + '">' +
        '<span class="v30-metier-row__type">' + esc(m.type || '—') + '</span>' +
        '<span class="v30-metier-row__category">' + esc(m.category || '—') + '</span>' +
        '<span class="v30-metier-row__value">' + esc(m.value || '') + '</span>' +
        '<span class="v30-metier-row__specialty">' + esc(m.specialty || m.tech_group || '') + '</span>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-del="' + m.id + '">×</button>' +
      '</div>';
    }).join('');
  }

  function load() {
    return fetchJSON('/api/custom_metiers').then(function (res) {
      STATE.items = (res && (res.items || res.metiers || (Array.isArray(res) ? res : []))) || [];
      render();
    }).catch(function (err) {
      console.error('[v30 metiers]', err);
      $('[data-v30-metiers-list]').innerHTML = '<div class="empty" style="padding:24px;">Erreur de chargement.</div>';
    });
  }

  function bind() {
    $('[data-v30-metier-add]').addEventListener('click', function () {
      var type = prompt('Type (ex: metier, tech, specialty) :', 'tech');
      if (!type) return;
      var category = prompt('Catégorie (ex: Compétences) :', 'Compétences');
      if (!category) return;
      var value = prompt('Valeur (ex: Kubernetes) :');
      if (!value) return;
      postJSON('/api/custom_metiers', { type: type.trim(), category: category.trim(), value: value.trim() })
        .then(function (res) {
          if (res.ok !== false) load();
          else alert('Échec : ' + (res.error || 'inconnu'));
        });
    });
    $('[data-v30-metiers-list]').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-del]');
      if (!btn) return;
      if (!confirm('Supprimer ce métier ?')) return;
      fetch('/api/custom_metiers/' + btn.dataset.del, { method: 'DELETE', credentials: 'same-origin' })
        .then(load);
    });
  }

  function init() { bind(); load(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
