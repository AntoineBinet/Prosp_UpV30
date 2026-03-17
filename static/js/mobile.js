/* ═══════════════════════════════════════════════════════════════
   ProspUp — Mobile JS Layer (iPhone iOS 17+)
   Chargé en dernier, s'exécute uniquement sur mobile (≤ 768px).
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // Sécurité : ne rien faire sur desktop
  if (window.innerWidth > 768) return;

  // ── Active state footer flottant ───────────────────────────────
  // Lit data-page du body pour activer le bon item du footer mobile
  function initMobileFooterActive() {
    var currentPage = (document.body.getAttribute('data-page') || '').toLowerCase();
    var currentPath = window.location.pathname;

    // Mapping page_id / path → data-page du footer
    var footerLinks = document.querySelectorAll('.mobile-footer-float .mf-item');
    footerLinks.forEach(function (link) {
      var href = link.getAttribute('href') || '';
      var linkPage = link.getAttribute('data-page') || '';

      var isActive = false;

      // Correspondance par data-page attribut
      if (linkPage && linkPage === currentPage) {
        isActive = true;
      }
      // Correspondance par href exact
      if (!isActive && href && (currentPath === href || currentPath === href + '/')) {
        isActive = true;
      }
      // Page prospects : route "/"
      if (!isActive && href === '/' && currentPath === '/') {
        isActive = true;
      }

      if (isActive) {
        link.classList.add('active');
      }
    });
  }

  // ── FAB Speed Dial ─────────────────────────────────────────────
  function initFABSpeedDial() {
    var fabMain = document.getElementById('fab-main-btn');
    var fabOptions = document.getElementById('fab-options');
    var backdrop = document.getElementById('fab-backdrop');

    if (!fabMain || !fabOptions || !backdrop) return;

    var isOpen = false;

    function openFAB() {
      isOpen = true;
      fabMain.classList.add('is-open');
      fabOptions.classList.add('is-open');
      backdrop.classList.add('is-open');
      fabMain.setAttribute('aria-expanded', 'true');
      // Haptic feedback iOS
      if (navigator.vibrate) navigator.vibrate(10);
    }

    function closeFAB() {
      isOpen = false;
      fabMain.classList.remove('is-open');
      fabOptions.classList.remove('is-open');
      backdrop.classList.remove('is-open');
      fabMain.setAttribute('aria-expanded', 'false');
    }

    fabMain.addEventListener('click', function () {
      isOpen ? closeFAB() : openFAB();
    });

    backdrop.addEventListener('click', closeFAB);

    // Fermeture avec la touche Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen) closeFAB();
    });

    // Routing des actions — adapté aux vraies routes Flask de ProspUp
    document.querySelectorAll('.fab-option').forEach(function (option) {
      option.addEventListener('click', function () {
        var action = option.getAttribute('data-action');
        closeFAB();

        switch (action) {
          case 'add-prospect':
            // Utilise la fonction globale openQuickAddModal() de app.js si disponible
            if (typeof window.openQuickAddModal === 'function') {
              window.openQuickAddModal();
            } else if (typeof window.openAddModal === 'function') {
              window.openAddModal();
            } else {
              window.location.href = '/';
            }
            break;

          case 'add-candidate':
            // Navigation vers la page candidats
            window.location.href = '/sourcing';
            break;

          case 'quick-note':
            // Navigation vers Focus (liste relances + notes)
            window.location.href = '/focus';
            break;

          case 'mode-prosp':
            // Mode Prosp = vue défilante sur la page prospects
            if (typeof window.switchTableKanban === 'function') {
              // Si déjà sur la page prospects, activer le mode directement
              window.switchTableKanban('prosp');
            } else {
              window.location.href = '/?view=prosp';
            }
            break;
        }
      });
    });
  }

  // ── Avatar initial dans le footer ─────────────────────────────
  // Synchronise l'initiale de l'avatar du footer avec l'utilisateur connecté
  function syncFooterAvatar() {
    var avatarEl = document.getElementById('mf-avatar-initial');
    if (!avatarEl) return;

    // Essayer de récupérer depuis le badge desktop ou AppAuth
    function trySync() {
      var user = null;
      if (window.AppAuth && window.AppAuth.user) {
        user = window.AppAuth.user;
      }
      if (!user) {
        var bnAvatar = document.querySelector('.bn-user-avatar');
        if (bnAvatar) {
          avatarEl.textContent = bnAvatar.textContent.trim() || 'A';
          return;
        }
      }
      if (user) {
        var initial = ((user.display_name || user.username || '').charAt(0) || 'A').toUpperCase();
        avatarEl.textContent = initial;
      }
    }

    // Attendre que sidebar.js ait fini (sidebar-ready event)
    document.addEventListener('sidebar-ready', trySync);
    // Fallback après 1s si l'event ne se déclenche pas
    setTimeout(trySync, 1000);
  }

  // ── Init au chargement du DOM ──────────────────────────────────
  function init() {
    initMobileFooterActive();
    initFABSpeedDial();
    syncFooterAvatar();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
