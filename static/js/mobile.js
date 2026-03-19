/* ═══════════════════════════════════════════════════════════════
   ProspUp — Mobile JS Layer (iPhone iOS 17+)
   Chargé en dernier, s'exécute uniquement sur mobile (≤ 900px).
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // Sécurité : ne rien faire sur desktop
  if (window.innerWidth > 900) return;

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

          case 'assistant-ia':
            if (typeof window.toggleAssistantChat === 'function') {
              window.toggleAssistantChat();
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

  // ── Transitions slide horizontal iOS ──────────────────────────
  // Ordre des onglets dans le footer flottant (index = position)
  var PAGE_ORDER = {
    '/dashboard': 0,
    '/':          1,
    '/focus':     2,
    '/calendrier':3,
  };

  // Durée animation sortie en ms (avant navigation)
  var EXIT_DURATION = 200;

  function getPageIndex(pathname) {
    if (PAGE_ORDER[pathname] !== undefined) return PAGE_ORDER[pathname];
    // Correspondance partielle (ex: /focus/xxx → 2)
    for (var key in PAGE_ORDER) {
      if (key !== '/' && pathname.indexOf(key) === 0) return PAGE_ORDER[key];
    }
    return -1;
  }

  function getPageWrapper() {
    return document.querySelector('.container') || document.body;
  }

  function createNavOverlay() {
    if (document.getElementById('nav-transition-overlay')) return;
    var el = document.createElement('div');
    el.className = 'nav-transition-overlay';
    el.id = 'nav-transition-overlay';
    document.body.appendChild(el);
  }

  function animatePageEntrance() {
    var direction = sessionStorage.getItem('prospup_nav_direction');
    if (!direction) return;
    sessionStorage.removeItem('prospup_nav_direction');

    var wrapper = getPageWrapper();
    var cls = direction === 'forward' ? 'page-enter-from-right' : 'page-enter-from-left';
    wrapper.classList.add(cls);
    wrapper.addEventListener('animationend', function () {
      wrapper.classList.remove(cls);
    }, { once: true });
  }

  function handleNavClick(event) {
    var link = event.currentTarget;
    var href = link.getAttribute('href');
    if (!href || href.charAt(0) === '#' || href.indexOf('javascript') === 0) return;

    var targetPath;
    try {
      targetPath = new URL(href, window.location.origin).pathname;
    } catch (e) {
      return;
    }

    // Même page → pas d'animation
    if (targetPath === window.location.pathname) {
      event.preventDefault();
      return;
    }

    var currentIdx = getPageIndex(window.location.pathname);
    var targetIdx  = getPageIndex(targetPath);
    var direction  = 'forward';
    if (currentIdx !== -1 && targetIdx !== -1) {
      direction = targetIdx >= currentIdx ? 'forward' : 'backward';
    }

    sessionStorage.setItem('prospup_nav_direction', direction);
    event.preventDefault();

    var wrapper = getPageWrapper();
    var overlay = document.getElementById('nav-transition-overlay');
    var exitCls = direction === 'forward' ? 'page-exit-to-left' : 'page-exit-to-right';

    wrapper.classList.add(exitCls);
    if (overlay) overlay.classList.add('active');

    setTimeout(function () {
      window.location.href = href;
    }, EXIT_DURATION);
  }

  function initSlideTransitions() {
    createNavOverlay();
    animatePageEntrance();

    // Liens du footer flottant
    document.querySelectorAll('.mobile-footer-float .mf-item[href]').forEach(function (link) {
      link.addEventListener('click', handleNavClick);
    });

    // Autres liens internes hors footer (ex: liens dans les cartes, sidebar)
    document.querySelectorAll('a[href^="/"]').forEach(function (link) {
      if (!link.closest('.mobile-footer-float')) {
        link.addEventListener('click', handleNavClick);
      }
    });
  }

  // Gestion du bouton retour iOS (swipe bord gauche → bfcache)
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) {
      sessionStorage.setItem('prospup_nav_direction', 'backward');
      animatePageEntrance();
    }
  });

  // ── Init au chargement du DOM ──────────────────────────────────
  function init() {
    initMobileFooterActive();
    initFABSpeedDial();
    syncFooterAvatar();
    initSlideTransitions();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
