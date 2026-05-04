/* ProspUp v30 — Topbar : menu avatar + notification bell + burger mobile */
(function () {
  'use strict';

  /* ─── Burger → Sidebar drawer (mobile) ─── */
  var burger   = document.querySelector('[data-v30-burger]');
  var sidebar  = document.getElementById('v30-sidebar');
  var backdrop = document.querySelector('[data-v30-sidebar-backdrop]');
  if (burger && sidebar && backdrop) {
    function openDrawer() {
      sidebar.classList.add('is-open');
      backdrop.classList.add('is-open');
      backdrop.hidden = false;
      burger.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
    }
    function closeDrawer() {
      sidebar.classList.remove('is-open');
      backdrop.classList.remove('is-open');
      burger.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
      setTimeout(function () {
        if (!backdrop.classList.contains('is-open')) backdrop.hidden = true;
      }, 220);
    }
    burger.addEventListener('click', function (e) {
      e.stopPropagation();
      if (sidebar.classList.contains('is-open')) closeDrawer();
      else openDrawer();
    });
    backdrop.addEventListener('click', closeDrawer);
    // Ferme le drawer dès qu'on clique sur un lien de la sidebar
    sidebar.addEventListener('click', function (e) {
      var link = e.target.closest('a');
      if (link) closeDrawer();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && sidebar.classList.contains('is-open')) closeDrawer();
    });
    // Ferme automatiquement quand on repasse en desktop
    window.addEventListener('resize', function () {
      if (window.innerWidth > 900 && sidebar.classList.contains('is-open')) closeDrawer();
    });
  }

  /* ─── Bottom nav : positionne la pill sous l'onglet actif ─── */
  function positionBnavPill() {
    var pill = document.querySelector('[data-bnav-pill]');
    if (!pill) return;
    var active = document.querySelector('.v30-bnav__item.is-active');
    var glass = document.querySelector('.v30-bnav__glass');
    if (!active || !glass) {
      pill.style.opacity = '0';
      return;
    }
    var rect = active.getBoundingClientRect();
    var hostRect = glass.getBoundingClientRect();
    var offset = rect.left - hostRect.left;
    pill.style.opacity = '1';
    pill.style.width = rect.width + 'px';
    pill.style.transform = 'translateX(' + offset + 'px)';
  }
  if (document.querySelector('.v30-bnav')) {
    // Position immédiate puis après layout (fonts, images)
    positionBnavPill();
    requestAnimationFrame(positionBnavPill);
    window.addEventListener('resize', positionBnavPill);
    window.addEventListener('orientationchange', positionBnavPill);
    window.addEventListener('load', positionBnavPill);
  }

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

      // Items injectés par d'autres modules (ex. update-checker.js)
      (window._v30NotifExtra || []).forEach(function (ex) {
        if (ex && ex.html) items.push(ex.html);
      });

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
              '<div class="v30-notif-item__label">' + dueToday + ' relance' + (dueToday > 1 ? 's' : '') + " aujourd'hui</div>" +
              '<div class="v30-notif-item__sub">À traiter avant la fin de la journée</div>' +
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

    var _lastOverdue = 0, _lastDueToday = 0;

    function loadNotifications() {
      fetch('/api/dashboard', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          var pipeline = (res && res.data && res.data.pipeline) || {};
          _lastOverdue  = parseInt(pipeline.overdue, 10)   || 0;
          _lastDueToday = parseInt(pipeline.due_today, 10) || 0;
          var extrasCount = (window._v30NotifExtra || []).length;
          updateBadge(_lastOverdue + _lastDueToday + extrasCount);
          renderNotifItems(_lastOverdue, _lastDueToday);
        })
        .catch(function () {
          if (notifBody) notifBody.innerHTML = '<div class="v30-notif-empty">Impossible de charger les notifications</div>';
        });
    }

    // Modules externes peuvent déclencher un re-rendu du panel
    document.addEventListener('v30:notif:refresh', function () {
      var extrasCount = (window._v30NotifExtra || []).length;
      updateBadge(_lastOverdue + _lastDueToday + extrasCount);
      renderNotifItems(_lastOverdue, _lastDueToday);
    });

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
