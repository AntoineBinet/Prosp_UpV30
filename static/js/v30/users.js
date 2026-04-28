/* ProspUp v30 — Users (admin) : table + login history + modal CRUD */
(function () {
  'use strict';

  var STATE = {
    users: [],
    currentUserId: null,
    isAdmin: false,
    editing: null,
    tab: 'list'
  };

  function $(s, root) { return (root || document).querySelector(s); }
  function $$(s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); }
  function esc(s) { var t = document.createElement('span'); t.textContent = s == null ? '' : String(s); return t.innerHTML; }
  function initials(n) {
    var p = String(n || '').trim().split(/\s+/).filter(Boolean);
    if (!p.length) return '??';
    return (p[0][0] + (p[1] ? p[1][0] : '')).toUpperCase();
  }
  function formatDate(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(String(iso).replace(' ', 'T'));
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
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
    }).then(function (r) {
      return r.json().then(function (j) {
        return { ok: r.ok, status: r.status, json: j };
      });
    });
  }
  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
  }

  // ─── Render table ─────────────────────────────────────────
  function renderTable() {
    var tbody = $('[data-v30-users-tbody]');
    if (!tbody) return;
    if (!STATE.users.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty" style="padding:24px;">Aucun utilisateur.</td></tr>';
      return;
    }
    tbody.innerHTML = STATE.users.map(function (u) {
      var isMe = STATE.currentUserId != null && Number(u.id) === Number(STATE.currentUserId);
      var roleLabel = u.role === 'admin' ? 'Administrateur' : 'Éditeur';
      var roleCls = u.role === 'admin' ? 'role-chip--admin' : 'role-chip--editor';
      var inactive = !u.is_active;
      return '<tr class="user-row' + (inactive ? ' is-inactive' : '') + '" data-user-id="' + u.id + '">' +
        '<td>' +
          '<div class="user-row__main">' +
            '<span class="user-row__avatar">' + esc(initials(u.display_name || u.username)) + '</span>' +
            '<div style="min-width:0;">' +
              '<div class="user-row__name"><span class="user-row__name-text">' + esc(u.display_name || u.username) + '</span>' +
                (isMe ? ' <span class="badge-self">Vous</span>' : '') +
                (inactive ? ' <span class="user-row__inactive-tag">Inactif</span>' : '') +
              '</div>' +
            '</div>' +
          '</div>' +
        '</td>' +
        '<td><span class="user-row__user">@' + esc(u.username) + '</span></td>' +
        '<td><span class="role-chip ' + roleCls + '">' + esc(roleLabel) + '</span></td>' +
        '<td class="u-hide-sm u-date">' + esc(formatDate(u.createdAt)) + '</td>' +
        '<td class="u-hide-sm u-date">' + esc(formatDate(u.lastLoginAt)) + '</td>' +
        '<td class="u-actions">' +
          '<div class="user-row__actions">' +
            '<button type="button" class="btn btn-ghost btn-sm" data-action="edit" data-id="' + u.id + '" aria-label="Éditer">Éditer</button>' +
            (isMe ? '' : '<button type="button" class="btn btn-ghost btn-sm" data-action="delete" data-id="' + u.id + '" aria-label="Supprimer">×</button>') +
          '</div>' +
        '</td>' +
      '</tr>';
    }).join('');

    tbody.querySelectorAll('[data-action="edit"]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var u = STATE.users.find(function (x) { return String(x.id) === b.dataset.id; });
        openModal(u);
      });
    });
    tbody.querySelectorAll('[data-action="delete"]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var u = STATE.users.find(function (x) { return String(x.id) === b.dataset.id; });
        if (u) inlineDelete(u);
      });
    });
    // Click on row → open edit
    tbody.querySelectorAll('tr.user-row').forEach(function (tr) {
      tr.addEventListener('click', function (e) {
        if (e.target.closest('button')) return;
        var u = STATE.users.find(function (x) { return String(x.id) === tr.dataset.userId; });
        openModal(u);
      });
    });
  }

  // ─── Render history ───────────────────────────────────────
  function renderHistory() {
    var tbody = $('[data-v30-users-history-tbody]');
    if (!tbody) return;
    var items = STATE.users
      .filter(function (u) { return !!u.lastLoginAt; })
      .slice()
      .sort(function (a, b) { return (a.lastLoginAt < b.lastLoginAt) ? 1 : -1; })
      .slice(0, 50);
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="3" class="empty" style="padding:24px;">Aucune connexion enregistrée.</td></tr>';
      return;
    }
    tbody.innerHTML = items.map(function (u) {
      var isMe = STATE.currentUserId != null && Number(u.id) === Number(STATE.currentUserId);
      var roleCls = u.role === 'admin' ? 'role-chip--admin' : 'role-chip--editor';
      var roleLabel = u.role === 'admin' ? 'Administrateur' : 'Éditeur';
      return '<tr>' +
        '<td>' +
          '<div class="user-row__main">' +
            '<span class="user-row__avatar">' + esc(initials(u.display_name || u.username)) + '</span>' +
            '<div><div class="user-row__name"><span class="user-row__name-text">' + esc(u.display_name || u.username) + '</span>' + (isMe ? ' <span class="badge-self">Vous</span>' : '') + '</div>' +
            '<div class="user-row__user">@' + esc(u.username) + '</div></div>' +
          '</div>' +
        '</td>' +
        '<td><span class="role-chip ' + roleCls + '">' + esc(roleLabel) + '</span></td>' +
        '<td class="u-date">' + esc(formatDate(u.lastLoginAt)) + '</td>' +
      '</tr>';
    }).join('');
  }

  function load() {
    return fetchJSON('/api/users').then(function (res) {
      STATE.users = (res && (res.users || res.items || (Array.isArray(res) ? res : []))) || [];
      STATE.currentUserId = (res && res.current_user_id) || null;
      STATE.isAdmin = !!(res && res.is_admin);
      renderTable();
      renderHistory();
    }).catch(function (err) {
      console.error('[v30 users]', err);
      var tbody = $('[data-v30-users-tbody]');
      if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="empty" style="padding:24px;">Erreur de chargement.</td></tr>';
    });
  }

  // ─── Tabs ─────────────────────────────────────────────────
  function setTab(tab) {
    STATE.tab = tab || 'list';
    var bar = $('[data-v30-users-tabs]');
    if (bar) {
      bar.querySelectorAll('button[data-tab]').forEach(function (b) {
        var act = b.getAttribute('data-tab') === STATE.tab;
        b.classList.toggle('is-active', act);
        b.setAttribute('aria-selected', act ? 'true' : 'false');
      });
    }
    $$('.v30-users__panel').forEach(function (p) {
      p.hidden = (p.getAttribute('data-panel') !== STATE.tab);
    });
  }
  function bindTabs() {
    var bar = $('[data-v30-users-tabs]');
    if (!bar) return;
    bar.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-tab]');
      if (btn) setTab(btn.getAttribute('data-tab'));
    });
  }

  // ─── Modal CRUD ───────────────────────────────────────────
  function setRole(value) {
    document.querySelectorAll('[data-v30-user-role-r]').forEach(function (r) {
      r.checked = (r.value === value);
    });
  }
  function getRole() {
    var sel = document.querySelector('[data-v30-user-role-r]:checked');
    return sel ? sel.value : 'editor';
  }
  function openModal(u) {
    STATE.editing = u || null;
    $('[data-v30-user-title]').textContent = u
      ? ('Éditer ' + (u.display_name || u.username))
      : 'Nouvel utilisateur';
    $('[data-v30-user-username]').value = u ? (u.username || '') : '';
    $('[data-v30-user-username]').readOnly = !!u;
    $('[data-v30-user-display]').value = u ? (u.display_name || '') : '';
    setRole(u ? (u.role || 'editor') : 'editor');
    $('[data-v30-user-password]').value = '';
    $('[data-v30-user-active]').checked = u ? !!u.is_active : true;
    var delBtn = $('[data-v30-user-delete]');
    if (delBtn) {
      var canDelete = !!u && (STATE.currentUserId == null || Number(u.id) !== Number(STATE.currentUserId));
      delBtn.hidden = !canDelete;
    }
    var bd = $('[data-v30-user-bd]');
    if (bd) { bd.hidden = false; bd.classList.add('is-open'); }
    setTimeout(function () {
      var first = $('[data-v30-user-username]');
      if (first && !first.readOnly) first.focus();
    }, 80);
  }
  function closeModal() {
    STATE.editing = null;
    var bd = $('[data-v30-user-bd]');
    if (bd) { bd.classList.remove('is-open'); bd.hidden = true; }
  }
  function saveModal() {
    var payload = {
      username: $('[data-v30-user-username]').value.trim(),
      display_name: $('[data-v30-user-display]').value.trim(),
      role: getRole(),
      password: $('[data-v30-user-password]').value,
      is_active: $('[data-v30-user-active]').checked ? 1 : 0
    };
    if (STATE.editing) payload.id = STATE.editing.id;
    if (!payload.username) { toast('Nom d\'utilisateur requis', 'error'); return; }
    if (!STATE.editing && (!payload.password || payload.password.length < 8)) {
      toast('Mot de passe requis (8+ car., 1 chiffre, 1 lettre)', 'error');
      return;
    }
    postJSON('/api/users/save', payload).then(function (res) {
      if (res.ok && res.json && res.json.ok !== false) {
        closeModal();
        load();
        toast('Utilisateur enregistré', 'success');
      } else {
        toast('Échec : ' + ((res.json && res.json.error) || 'inconnu'), 'error');
      }
    }).catch(function (err) { toast('Erreur : ' + err.message, 'error'); });
  }
  function deleteUser() {
    if (!STATE.editing) return;
    if (!confirm('Supprimer ' + (STATE.editing.display_name || STATE.editing.username) + ' ?\n\nCette action est irréversible et supprime aussi les données associées.')) return;
    postJSON('/api/users/delete', { id: STATE.editing.id }).then(function (res) {
      if (res.ok && res.json && res.json.ok !== false) {
        closeModal();
        load();
        toast('Utilisateur supprimé', 'success');
      } else {
        toast('Erreur : ' + ((res.json && res.json.error) || 'inconnu'), 'error');
      }
    }).catch(function (err) { toast('Erreur : ' + err.message, 'error'); });
  }
  function inlineDelete(u) {
    if (!u) return;
    if (!confirm('Supprimer ' + (u.display_name || u.username) + ' ?\n\nCette action est irréversible.')) return;
    postJSON('/api/users/delete', { id: u.id }).then(function (res) {
      if (res.ok && res.json && res.json.ok !== false) {
        load();
        toast('Utilisateur supprimé', 'success');
      } else {
        toast('Erreur : ' + ((res.json && res.json.error) || 'inconnu'), 'error');
      }
    }).catch(function (err) { toast('Erreur : ' + err.message, 'error'); });
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
    var bd = $('[data-v30-user-bd]');
    if (bd) bd.addEventListener('click', function (e) { if (e.target === bd) closeModal(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeModal();
    });
    bindTabs();
  }

  function init() { bind(); load(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
