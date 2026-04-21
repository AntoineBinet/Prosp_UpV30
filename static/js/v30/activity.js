/* ProspUp v30 — Activity log (admin) */
(function () {
  'use strict';

  var STATE = { page: 1, total: 0, per_page: 50, user_id: '', action: '' };

  function $(s) { return document.querySelector(s); }
  function esc(s) { var t = document.createElement('span'); t.textContent = s == null ? '' : String(s); return t.innerHTML; }
  function fmt(iso) {
    if (!iso) return '';
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

  function render(rows) {
    var host = $('[data-v30-activity-list]');
    if (!rows.length) {
      host.innerHTML = '<div class="empty" style="padding:24px;">Aucune activité pour ces filtres.</div>';
      return;
    }
    host.innerHTML = rows.map(function (r) {
      return '<div class="v30-activity-row">' +
        '<span class="v30-activity-row__when">' + esc(fmt(r.createdAt || r.created_at || r.timestamp)) + '</span>' +
        '<span class="v30-activity-row__user">' + esc(r.display_name || r.username || ('user#' + (r.user_id||''))) + '</span>' +
        '<span class="v30-activity-row__what">' + esc(r.action || '') + '</span>' +
        '<span class="v30-activity-row__target">' + esc(r.target || r.detail || '') + '</span>' +
      '</div>';
    }).join('');
  }

  function updatePagination() {
    var from = (STATE.page - 1) * STATE.per_page + 1;
    var to = Math.min(STATE.page * STATE.per_page, STATE.total);
    $('[data-pag-range]').textContent = STATE.total === 0 ? '0 sur 0' : from + '–' + to + ' sur ' + STATE.total;
    $('[data-pag-prev]').disabled = STATE.page <= 1;
    $('[data-pag-next]').disabled = STATE.page * STATE.per_page >= STATE.total;
    var totalEl = document.querySelector('[data-v30-activity] [data-field="total"]');
    if (totalEl) totalEl.textContent = STATE.total.toLocaleString('fr-FR');
  }

  function load() {
    var qs = new URLSearchParams({ page: String(STATE.page) });
    if (STATE.user_id) qs.set('user_id', STATE.user_id);
    if (STATE.action) qs.set('action', STATE.action);
    return fetchJSON('/api/activity?' + qs.toString()).then(function (res) {
      var logs = (res && (res.logs || res.items || res.activity || (Array.isArray(res) ? res : []))) || [];
      STATE.total = (res && res.total) || logs.length;
      STATE.per_page = (res && res.per_page) || 50;
      render(logs);
      updatePagination();
    }).catch(function (err) {
      console.error('[v30 activity]', err);
      $('[data-v30-activity-list]').innerHTML = '<div class="empty" style="padding:24px;">Erreur de chargement.</div>';
    });
  }

  function loadUsers() {
    return fetchJSON('/api/users').then(function (res) {
      var users = (res && (res.users || (Array.isArray(res) ? res : []))) || [];
      var sel = $('[data-v30-activity-user]');
      users.forEach(function (u) {
        var opt = document.createElement('option');
        opt.value = u.id;
        opt.textContent = u.display_name || u.username;
        sel.appendChild(opt);
      });
    }).catch(function () {});
  }

  function bind() {
    $('[data-v30-activity-user]').addEventListener('change', function (e) {
      STATE.user_id = e.target.value;
      STATE.page = 1;
      load();
    });
    $('[data-v30-activity-action]').addEventListener('change', function (e) {
      STATE.action = e.target.value;
      STATE.page = 1;
      load();
    });
    $('[data-pag-prev]').addEventListener('click', function () {
      if (STATE.page > 1) { STATE.page--; load(); }
    });
    $('[data-pag-next]').addEventListener('click', function () {
      if (STATE.page * STATE.per_page < STATE.total) { STATE.page++; load(); }
    });
  }

  function init() { bind(); loadUsers(); load(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
