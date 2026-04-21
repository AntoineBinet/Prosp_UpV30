/* ProspUp v30 — Snapshots */
(function () {
  'use strict';

  var STATE = { snapshots: [] };

  function $(s) { return document.querySelector(s); }
  function esc(s) { var t = document.createElement('span'); t.textContent = s == null ? '' : String(s); return t.innerHTML; }
  function fmtSize(bytes) {
    if (bytes == null) return '—';
    var kb = bytes / 1024;
    if (kb < 1024) return Math.round(kb) + ' KB';
    return (kb / 1024).toFixed(1) + ' MB';
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(iso);
      return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) + ' ' +
             String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
    } catch (_) { return iso; }
  }
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
    var host = $('[data-v30-snap-list]');
    if (!STATE.snapshots.length) {
      host.innerHTML = '<div class="empty" style="padding:24px;">Aucun snapshot.</div>';
    } else {
      host.innerHTML = STATE.snapshots.map(function (s) {
        var isAuto = !!(s.is_auto || s.auto);
        var name = s.label || s.name || s.filename || '—';
        return '<div class="v30-snap-row">' +
          '<div class="v30-snap-row__name">' +
            esc(name) +
            (s.filename && s.filename !== name ? '<span class="muted">· ' + esc(s.filename) + '</span>' : '') +
            '<span class="v30-snap-badge ' + (isAuto ? 'is-auto' : '') + '">' + (isAuto ? 'Auto' : 'Manuel') + '</span>' +
          '</div>' +
          '<div class="v30-snap-row__when">' + esc(fmtDate(s.created_at || s.createdAt || s.mtime)) + '</div>' +
          '<div class="v30-snap-row__size">' + esc(fmtSize(s.size || s.bytes)) + '</div>' +
          '<div class="v30-snap-row__actions">' +
            '<button type="button" class="btn btn-ghost btn-sm" data-action="restore" data-name="' + esc(s.filename || name) + '">Restaurer</button>' +
            '<button type="button" class="btn btn-ghost btn-sm" data-action="delete" data-name="' + esc(s.filename || name) + '">Supprimer</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }
    var countEl = document.querySelector('[data-field="count"]');
    if (countEl) countEl.textContent = STATE.snapshots.length;
  }

  function load() {
    return fetchJSON('/api/snapshots').then(function (res) {
      STATE.snapshots = (res && (res.items || res.snapshots || (Array.isArray(res) ? res : []))) || [];
      render();
    }).catch(function (err) {
      console.error('[v30 snapshots]', err);
      $('[data-v30-snap-list]').innerHTML = '<div class="empty" style="padding:24px;">Erreur de chargement.</div>';
    });
  }

  function bind() {
    $('[data-v30-snap-create]').addEventListener('click', function () {
      var label = prompt('Étiquette du snapshot :', 'manual');
      if (label === null) return;
      postJSON('/api/snapshots/create', { label: label.trim() || 'manual' })
        .then(function (res) {
          if (res.ok) { if (window.showToast) window.showToast('Snapshot créé', 'success'); load(); }
          else alert('Échec : ' + (res.error || 'inconnu'));
        });
    });
    $('[data-v30-snap-list]').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;
      var name = btn.dataset.name;
      if (action === 'restore') {
        if (!confirm('Restaurer depuis ' + name + ' ? Les données actuelles seront remplacées.')) return;
        postJSON('/api/snapshots/restore', { filename: name }).then(function (res) {
          if (res.ok) { alert('Restaurée. L\'app va redémarrer.'); setTimeout(function(){ location.reload(); }, 2000); }
          else alert('Échec : ' + (res.error || 'inconnu'));
        });
      } else if (action === 'delete') {
        if (!confirm('Supprimer ' + name + ' ?')) return;
        postJSON('/api/snapshots/delete', { filename: name }).then(function () { load(); });
      }
    });
  }

  function init() { bind(); load(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
