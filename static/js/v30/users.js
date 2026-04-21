/* ProspUp v30 — Users (admin) : liste + modale CRUD */
(function () {
  'use strict';

  var STATE = { users: [], editing: null };

  function $(s) { return document.querySelector(s); }
  function esc(s) { var t = document.createElement('span'); t.textContent = s == null ? '' : String(s); return t.innerHTML; }
  function initials(n) {
    var p = String(n || '').trim().split(/\s+/).filter(Boolean);
    if (!p.length) return '??';
    return (p[0][0] + (p[1] ? p[1][0] : '')).toUpperCase();
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
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function render() {
    var host = $('[data-v30-users-grid]');
    if (!host) return;
    if (!STATE.users.length) {
      host.innerHTML = '<div class="empty" style="grid-column:1/-1;padding:24px;">Aucun utilisateur.</div>';
      return;
    }
    host.innerHTML = STATE.users.map(function (u) {
      var roleCls = u.role === 'admin' ? 'is-admin' : '';
      var inactive = !u.is_active ? ' v30-users__card-inactive' : '';
      return '<div class="v30-users__card' + inactive + '" data-user-id="' + u.id + '">' +
        '<div class="v30-users__card-head">' +
          '<span class="v30-users__card-avatar">' + esc(initials(u.display_name || u.username)) + '</span>' +
          '<div>' +
            '<div class="v30-users__card-name">' + esc(u.display_name || u.username) + '</div>' +
            '<div class="v30-users__card-user">@' + esc(u.username) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="row-sb">' +
          '<span class="v30-users__card-role ' + roleCls + '">' + esc(u.role === 'admin' ? 'Administrateur' : 'Éditeur') + '</span>' +
          (u.is_active ? '' : '<span class="v30-users__card-meta">Inactif</span>') +
        '</div>' +
        (u.lastLoginAt ? '<div class="v30-users__card-meta">Dernière connexion : ' + esc(u.lastLoginAt.slice(0,16).replace('T',' ')) + '</div>' : '') +
      '</div>';
    }).join('');
    host.querySelectorAll('[data-user-id]').forEach(function (card) {
      card.addEventListener('click', function () {
        var u = STATE.users.find(function (x) { return String(x.id) === card.dataset.userId; });
        openModal(u);
      });
    });
  }

  function load() {
    return fetchJSON('/api/users').then(function (res) {
      STATE.users = (res && (res.users || res.items || (Array.isArray(res) ? res : []))) || [];
      render();
    }).catch(function (err) {
      console.error('[v30 users]', err);
      $('[data-v30-users-grid]').innerHTML = '<div class="empty" style="grid-column:1/-1;padding:24px;">Erreur de chargement.</div>';
    });
  }

  // ─── Modal CRUD ───────────────────────────────────────────
  function openModal(u) {
    STATE.editing = u || null;
    $('[data-v30-user-title]').textContent = u ? ('Éditer ' + (u.display_name || u.username)) : 'Nouvel utilisateur';
    $('[data-v30-user-username]').value = u ? (u.username || '') : '';
    $('[data-v30-user-username]').readOnly = !!u;
    $('[data-v30-user-display]').value = u ? (u.display_name || '') : '';
    $('[data-v30-user-role]').value = u ? (u.role || 'editor') : 'editor';
    $('[data-v30-user-password]').value = '';
    $('[data-v30-user-active]').checked = u ? !!u.is_active : true;
    $('[data-v30-user-delete]').hidden = !u;
    $('[data-v30-user-bd]').hidden = false;
    $('[data-v30-user-modal]').hidden = false;
  }
  function closeModal() {
    STATE.editing = null;
    $('[data-v30-user-bd]').hidden = true;
    $('[data-v30-user-modal]').hidden = true;
  }
  function saveModal() {
    var payload = {
      username: $('[data-v30-user-username]').value.trim(),
      display_name: $('[data-v30-user-display]').value.trim(),
      role: $('[data-v30-user-role]').value,
      password: $('[data-v30-user-password]').value,
      is_active: $('[data-v30-user-active]').checked ? 1 : 0
    };
    if (STATE.editing) payload.id = STATE.editing.id;
    if (!payload.username) { alert('Nom d\'utilisateur requis'); return; }
    postJSON('/api/users/save', payload).then(function (res) {
      if (res && res.ok !== false) {
        closeModal();
        load();
        if (window.showToast) window.showToast('Utilisateur enregistré', 'success');
      } else {
        alert('Échec : ' + ((res && res.error) || 'inconnu'));
      }
    }).catch(function (err) { alert('Erreur : ' + err.message); });
  }
  function deleteUser() {
    if (!STATE.editing) return;
    if (!confirm('Supprimer ' + (STATE.editing.display_name || STATE.editing.username) + ' ?')) return;
    postJSON('/api/users/delete', { id: STATE.editing.id }).then(function () {
      closeModal();
      load();
      if (window.showToast) window.showToast('Utilisateur supprimé', 'success');
    }).catch(function (err) { alert('Erreur : ' + err.message); });
  }

  function bind() {
    var btn = $('[data-v30-users-new]');
    if (btn) btn.addEventListener('click', function () { openModal(null); });
    document.querySelectorAll('[data-v30-user-close]').forEach(function (b) {
      b.addEventListener('click', closeModal);
    });
    var save = $('[data-v30-user-save]');
    if (save) save.addEventListener('click', saveModal);
    var del = $('[data-v30-user-delete]');
    if (del) del.addEventListener('click', deleteUser);
  }

  function init() { bind(); load(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
