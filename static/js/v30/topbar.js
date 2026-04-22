/* ProspUp v30 — Topbar : menu avatar + notification bell */
(function () {
  'use strict';

  /* ─── Notification bell ─── */
  var notifRoot = document.querySelector('[data-v30-notif]');
  if (notifRoot) {
    var notifTrigger = notifRoot.querySelector('[data-v30-notif-trigger]');
    var notifPanel   = notifRoot.querySelector('.v30-notif-panel');
    var notifBadge   = notifRoot.querySelector('.v30-notif-badge');
    var notifBody    = notifRoot.querySelector('[data-v30-notif-body]');
    var notifClose   = notifRoot.querySelector('[data-v30-notif-close]');

    var ICON_WARN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
    var ICON_CLOCK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';

    function openNotif() {
      notifPanel.hidden = false;
      notifTrigger.setAttribute('aria-expanded', 'true');
    }
    function closeNotif() {
      notifPanel.hidden = true;
      notifTrigger.setAttribute('aria-expanded', 'false');
    }
    function toggleNotif() { notifPanel.hidden ? openNotif() : closeNotif(); }

    notifTrigger.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleNotif();
    });
    if (notifClose) notifClose.addEventListener('click', closeNotif);

    document.addEventListener('click', function (e) {
      if (!notifRoot.contains(e.target)) closeNotif();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !notifPanel.hidden) closeNotif();
    });

    function updateBadge(count) {
      if (!notifBadge) return;
      if (count > 0) {
        notifBadge.textContent = count > 99 ? '99+' : String(count);
        notifBadge.hidden = false;
      } else {
        notifBadge.hidden = true;
      }
    }

    function renderNotifItems(overdue, dueToday) {
      if (!notifBody) return;
      var items = [];

      if (overdue > 0) {
        items.push(
          '<div class="v30-notif-item">' +
            '<div class="v30-notif-item__icon v30-notif-item__icon--warn">' + ICON_WARN + '</div>' +
            '<div class="v30-notif-item__body">' +
              '<div class="v30-notif-item__label">' + overdue + ' relance' + (overdue > 1 ? 's' : '') + ' en retard</div>' +
              '<div class="v30-notif-item__sub">Des prospects nécessitent un suivi urgent</div>' +
              '<div class="v30-notif-item__cta"><a class="btn btn-sm" href="/v30/focus">Voir Focus →</a></div>' +
            '</div>' +
          '</div>'
        );
      }

      if (dueToday > 0) {
        items.push(
          '<div class="v30-notif-item">' +
            '<div class="v30-notif-item__icon v30-notif-item__icon--info">' + ICON_CLOCK + '</div>' +
            '<div class="v30-notif-item__body">' +
              ‘<div class="v30-notif-item__label">’ + dueToday + ‘ relance’ + (dueToday > 1 ? ‘s’ : ‘’) + " aujourd’hui</div>" +
              ‘<div class="v30-notif-item__sub">À traiter avant la fin de la journée</div>’ +
              '<div class="v30-notif-item__cta"><a class="btn btn-sm" href="/v30/focus">Voir Focus →</a></div>' +
            '</div>' +
          '</div>'
        );
      }

      if (items.length === 0) {
        notifBody.innerHTML = '<div class="v30-notif-empty">Aucune notification</div>';
      } else {
        notifBody.innerHTML = items.join('');
      }
    }

    function loadNotifications() {
      fetch('/api/dashboard', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          var pipeline = (res && res.data && res.data.pipeline) || {};
          var overdue  = parseInt(pipeline.overdue, 10)   || 0;
          var dueToday = parseInt(pipeline.due_today, 10) || 0;
          updateBadge(overdue + dueToday);
          renderNotifItems(overdue, dueToday);
        })
        .catch(function () {
          if (notifBody) notifBody.innerHTML = '<div class="v30-notif-empty">Impossible de charger les notifications</div>';
        });
    }

    loadNotifications();
  }

  var menu = document.querySelector('[data-v30-avatar-menu]');
  if (!menu) return;
  var trigger = menu.querySelector('[data-v30-avatar-trigger]');
  var dropdown = menu.querySelector('.v30-avatar-menu__dropdown');
  var logoutBtn = menu.querySelector('[data-v30-logout]');
  if (!trigger || !dropdown) return;

  function open() {
    dropdown.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
  }
  function close() {
    dropdown.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  }
  function toggle() { dropdown.hidden ? open() : close(); }

  trigger.addEventListener('click', function (e) {
    e.stopPropagation();
    toggle();
  });
  document.addEventListener('click', function (e) {
    if (!menu.contains(e.target)) close();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') close();
  });

  if (logoutBtn) {
    logoutBtn.addEventListener('click', function () {
      fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Accept': 'application/json' }
      }).then(function () {
        window.location.href = '/login';
      }).catch(function () {
        // Fallback : redirige quand meme
        window.location.href = '/login';
      });
    });
  }
})();
