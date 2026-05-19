/* ==================================================================
   ProspUp — Mobile JS Layer v2.0 (iPhone 17 / iOS 18+)
   Loaded LAST, executes only on mobile (<=900px).
   All DOM injection uses m- prefixed classes to avoid conflicts.
   ================================================================== */
(function () {
  'use strict';

  // ── Guard: skip on desktop ──────────────────────────────────────
  var MQ = window.matchMedia('(max-width: 900px)');
  if (!MQ.matches) return;

  // ── Constants ───────────────────────────────────────────────────
  var PAGE_ORDER = {
    '/v30/dashboard': 0,
    '/v30/prospects': 1,
    '/v30/focus': 2,
    '/v30/calendrier': 3
  };
  var EXIT_DURATION = 180;

  // ── Helpers ─────────────────────────────────────────────────────
  function haptic(ms) {
    if (window.haptic) window.haptic(ms || 10);
    else if (navigator.vibrate) navigator.vibrate(ms || 10);
  }

  function esc(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // ==================================================================
  //  1. TAB BAR — iOS 18+ floating bottom navigation
  // ==================================================================
  function buildTabBar() {
    var existing = document.getElementById('m-tabbar');
    if (existing) existing.remove();

    var nav = document.createElement('nav');
    nav.className = 'm-tabbar';
    nav.id = 'm-tabbar';
    nav.setAttribute('role', 'navigation');
    nav.setAttribute('aria-label', 'Navigation mobile');

    // 2026 — 5 tabs matching the iOS 26 prototype. The center tab (Prosp)
    // uses a bolt icon and a slightly larger size via the --primary modifier.
    var tabs = [
      { page: 'dashboard', href: '/v30/dashboard',         icon: window.icon ? window.icon('home',     {size: 22}) : '', label: 'Dashboard' },
      { page: 'prospects', href: '/v30/prospects',         icon: window.icon ? window.icon('users',    {size: 22}) : '', label: 'Prospects' },
      { page: 'mode-prosp',href: '/v30/mode-prosp',        icon: window.icon ? window.icon('zap',      {size: 24}) : '', label: 'Prosp', primary: true },
      { page: 'companies', href: '/v30/entreprises',       icon: window.icon ? window.icon('building', {size: 22}) : '', label: 'Sociétés' },
      { page: 'stats',     href: '/v30/stats',             icon: window.icon ? window.icon('chart',    {size: 22}) : '', label: 'Stats' }
    ];

    var currentPage = (document.body.getAttribute('data-page') || '').toLowerCase();
    var currentPath = window.location.pathname;

    // Inner wrapper holds the sliding pill + the tabs themselves, so the pill
    // sits behind via absolute positioning and z-index.
    var inner = document.createElement('div');
    inner.className = 'm26-tabbar-inner';

    var pill = document.createElement('div');
    pill.className = 'm26-tab-pill';
    pill.setAttribute('aria-hidden', 'true');
    inner.appendChild(pill);

    var activeIdx = -1;
    tabs.forEach(function (t, i) {
      var a = document.createElement('a');
      a.href = t.href;
      a.className = 'm-tab m26-tab' + (t.primary ? ' m26-tab--primary' : '');
      a.setAttribute('data-page', t.page);

      var isActive = (t.page === currentPage) ||
                     (t.href === currentPath) ||
                     (t.href === '/' && currentPath === '/');
      if (isActive) { a.classList.add('active'); activeIdx = i; }

      a.innerHTML =
        '<span class="m-tab-icon m26-tab-icon">' + t.icon + '</span>' +
        '<span class="m-tab-label m26-tab-label">' + escapeHtml(t.label) + '</span>';

      a.addEventListener('click', handleNavClick);
      inner.appendChild(a);
    });

    // Position the pill under the active tab. When no tab matches (e.g. we
    // are on a page not in the bar like Réglages), hide the pill entirely
    // rather than leave it stuck on tab 0.
    if (activeIdx < 0) {
      pill.style.display = 'none';
    } else {
      var slot = 100 / tabs.length;
      pill.style.left = 'calc(' + (activeIdx * slot) + '% + 4px)';
      pill.style.width = 'calc(' + slot + '% - 8px)';
    }

    nav.appendChild(inner);
    document.body.appendChild(nav);
  }

  function syncAvatar() {
    var el = document.getElementById('m-avatar');
    if (!el) return;
    var user = null;
    if (window.AppAuth && window.AppAuth.user) user = window.AppAuth.user;
    if (!user && window._sidebarCurrentUser) user = window._sidebarCurrentUser();
    if (user) {
      el.textContent = ((user.display_name || user.username || '').charAt(0) || 'A').toUpperCase();
    }
  }

  // ==================================================================
  //  2. FAB — Speed Dial
  // ==================================================================
  function buildFAB() {
    // Backdrop
    var backdrop = document.createElement('div');
    backdrop.className = 'm-fab-backdrop';
    backdrop.id = 'm-fab-backdrop';
    document.body.appendChild(backdrop);

    // Options container
    var options = document.createElement('div');
    options.className = 'm-fab-options';
    options.id = 'm-fab-options';

    var items = [
      { action: 'add-prospect',  label: 'Prospect',     icon: window.icon ? window.icon('userSingle', {size:18}) : '', bg: '#FF6B35' },
      { action: 'add-candidate', label: 'Candidat',     icon: window.icon ? window.icon('briefcase', {size:18}) : '', bg: '#4ECDC4' },
      { action: 'assistant-ia',  label: 'Assistant IA', icon: window.icon ? window.icon('robot', {size:18}) : '',     bg: '#22C55E' },
      { action: 'mode-prosp',    label: 'Mode Prosp',   icon: window.icon ? window.icon('cards', {size:18}) : '',      bg: '#F59E0B' }
    ];

    items.forEach(function (item) {
      var opt = document.createElement('div');
      opt.className = 'm-fab-option';
      opt.setAttribute('data-action', item.action);
      opt.innerHTML =
        '<span class="m-fab-option-label">' + item.label + '</span>' +
        '<button class="m-fab-option-btn" style="background:' + item.bg + '" aria-label="' + item.label + '">' + item.icon + '</button>';
      opt.addEventListener('click', function () {
        closeFAB();
        routeFABAction(item.action);
      });
      options.appendChild(opt);
    });

    document.body.appendChild(options);

    // Main button
    var fab = document.createElement('button');
    fab.className = 'm-fab';
    fab.id = 'm-fab';
    fab.setAttribute('aria-label', 'Actions rapides');
    fab.setAttribute('aria-expanded', 'false');
    fab.innerHTML = '<span>+</span>';
    fab.addEventListener('click', toggleFAB);
    document.body.appendChild(fab);

    backdrop.addEventListener('click', closeFAB);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && fab.classList.contains('is-open')) closeFAB();
    });
  }

  var _fabOpen = false;
  function toggleFAB() {
    _fabOpen ? closeFAB() : openFAB();
  }
  function openFAB() {
    _fabOpen = true;
    haptic(10);
    document.getElementById('m-fab').classList.add('is-open');
    document.getElementById('m-fab').setAttribute('aria-expanded', 'true');
    document.getElementById('m-fab-options').classList.add('is-open');
    document.getElementById('m-fab-backdrop').classList.add('is-open');
  }
  function closeFAB() {
    _fabOpen = false;
    var fab = document.getElementById('m-fab');
    if (fab) {
      fab.classList.remove('is-open');
      fab.setAttribute('aria-expanded', 'false');
    }
    var opts = document.getElementById('m-fab-options');
    if (opts) opts.classList.remove('is-open');
    var bd = document.getElementById('m-fab-backdrop');
    if (bd) bd.classList.remove('is-open');
  }

  function routeFABAction(action) {
    switch (action) {
      case 'add-prospect':
        if (typeof window.openQuickAddModal === 'function') window.openQuickAddModal();
        else if (typeof window.openAddModal === 'function') window.openAddModal();
        else window.location.href = '/?add=1';
        break;
      case 'add-candidate':
        window.location.href = '/v30/sourcing';
        break;
      case 'assistant-ia':
        if (typeof window.toggleAssistantChat === 'function') window.toggleAssistantChat();
        break;
      case 'mode-prosp':
        if (typeof window.switchTableKanban === 'function') window.switchTableKanban('prosp');
        else window.location.href = '/?view=prosp';
        break;
    }
  }

  // ==================================================================
  //  Mini-frise chronologique (5 dots) pour les cartes mobiles
  // ==================================================================
  function _buildMiniFrise(prospect) {
    var stage = (typeof window._getProspectStageFast === 'function')
      ? window._getProspectStageFast(prospect)
      : 0;
    var html = '<div class="prospect-frise-mini" title="Étape pipeline: ' +
      (['Appel Prosp','RDV Prosp','Besoin','Réunion Tech','Contrat Signé'][stage] || 'Appel Prosp') + '">';
    for (var i = 0; i < 5; i++) {
      var cls = i < stage ? 'done' : (i === stage ? 'active' : '');
      html += '<div class="prospect-frise-mini-dot ' + cls + '"></div>';
      if (i < 4) {
        html += '<div class="prospect-frise-mini-connector' + (i < stage ? ' done' : '') + '"></div>';
      }
    }
    html += '</div>';
    return html;
  }

  // ==================================================================
  //  3. PROSPECT CARDS — Replace table with mobile cards
  // ==================================================================
  function renderProspectCards() {
    if (document.body.getAttribute('data-page') !== 'prospects') return;

    var tableBody = document.getElementById('tableBody');
    if (!tableBody) return;

    // Get data from app.js
    var allData = window._v8Data || (typeof data !== 'undefined' ? data : null);
    if (!allData || !allData.prospects) return;

    // Get filtered prospect IDs from the visible table rows or use filterProspects result
    var container = document.getElementById('m-cards-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'm-cards';
      container.id = 'm-cards-container';
      var tableWrapper = document.querySelector('.table-wrapper');
      if (tableWrapper && tableWrapper.parentNode) {
        tableWrapper.parentNode.insertBefore(container, tableWrapper);
      } else {
        var content = document.querySelector('.content');
        if (content) content.appendChild(container);
      }
    }

    // Get visible prospect IDs from table
    var rows = tableBody.querySelectorAll('tr[data-id]');
    var html = '';
    rows.forEach(function (row, idx) {
      var pid = row.getAttribute('data-id');
      var prospect = allData.prospects.find(function (p) { return String(p.id) === String(pid); });
      if (!prospect) return;

      var sm = (typeof getStatusMeta === 'function') ? getStatusMeta(prospect.statut) : { icon: '', slug: 'none', label: '' };
      var name = esc((prospect.prenom || '') + ' ' + (prospect.nom || '')).trim() || 'Sans nom';
      var company = esc(prospect.entreprise || '');
      var fonction = esc(prospect.fonction || '');
      var sub = company + (company && fonction ? ' \u00B7 ' : '') + fonction;

      // Followup badge
      var followup = '';
      if (typeof renderFollowupMini === 'function') {
        followup = renderFollowupMini(prospect);
      }

      // Stars
      var stars = '';
      var pert = parseInt(prospect.pertinence) || 0;
      if (pert > 0) stars = '<span class="m-card-stars">' + '\u2605'.repeat(Math.min(pert, 5)) + '</span>';

      // RDV date
      var rdvBadge = '';
      if (sm.slug === 'rdv' && prospect.rdvDate && typeof formatRdvDateForBadge === 'function') {
        var fmtRdv = formatRdvDateForBadge(prospect.rdvDate);
        if (fmtRdv) rdvBadge = '<span class="m-card-rdv">' + esc(fmtRdv) + '</span>';
      }

      // Tel/email for swipe actions
      var tel = (prospect.telephone || '').trim();
      var email = (prospect.email || '').trim();

      html +=
        '<div class="m-swipe-wrap" data-pid="' + pid + '">' +
          '<div class="m-swipe-actions m-swipe-actions-left">' +
            (tel ? '<button class="m-swipe-action call" onclick="window.open(\'tel:' + esc(tel) + '\')"><span class="m-swipe-action-icon">' + (window.icon ? window.icon('phone', {size:18}) : '') + '</span><span class="m-swipe-action-label">Appeler</span></button>' : '') +
            (email ? '<button class="m-swipe-action email" onclick="window.open(\'mailto:' + esc(email) + '\')"><span class="m-swipe-action-icon">' + (window.icon ? window.icon('mail', {size:18}) : '') + '</span><span class="m-swipe-action-label">Email</span></button>' : '') +
            (!tel && !email ? '<span class="m-swipe-action" style="background:#64748B;color:white;min-width:64px;opacity:0.5"><span class="m-swipe-action-icon">' + (window.icon ? window.icon('ban', {size:18}) : '') + '</span><span class="m-swipe-action-label">Aucun</span></span>' : '') +
          '</div>' +
          '<div class="m-swipe-actions m-swipe-actions-right">' +
            '<button class="m-swipe-action status" data-pid="' + pid + '" onclick="window._mCycleStatus(' + pid + ')"><span class="m-swipe-action-icon">' + (window.icon ? window.icon('refreshCw', {size:18}) : '') + '</span><span class="m-swipe-action-label">Statut</span></button>' +
            '<button class="m-swipe-action log" onclick="if(typeof viewDetail===\'function\')viewDetail(' + pid + ')"><span class="m-swipe-action-icon">' + (window.icon ? window.icon('note', {size:18}) : '') + '</span><span class="m-swipe-action-label">Fiche</span></button>' +
          '</div>' +
          '<div class="m-card-inner m-card" onclick="if(typeof viewDetail===\'function\')viewDetail(' + pid + ')">' +
            '<div class="m-card-accent s-' + sm.slug + '"></div>' +
            '<div class="m-card-body">' +
              '<div class="m-card-row1">' +
                '<span class="m-card-name">' + name + '</span>' +
                (sm.label ? '<span class="m-card-pill s-' + sm.slug + '">' + sm.icon + ' ' + sm.label + '</span>' : '') +
              '</div>' +
              (sub ? '<div class="m-card-row2">' + sub + '</div>' : '') +
              '<div class="m-card-row3">' + followup + stars + rdvBadge + _buildMiniFrise(prospect) + '</div>' +
            '</div>' +
            '<div class="m-card-chevron">\u203A</div>' +
          '</div>' +
        '</div>';
    });

    container.innerHTML = html;
    initSwipeGestures();
  }

  // Hook into filterProspects to re-render cards
  var _origFilter = window.filterProspects;
  if (typeof _origFilter === 'function') {
    window.filterProspects = function () {
      _origFilter.apply(this, arguments);
      setTimeout(renderProspectCards, 50);
    };
  }

  // ==================================================================
  //  4. SWIPE GESTURES — iOS-style card swipe
  // ==================================================================
  var _swState = null;
  var _swAttached = false;

  function initSwipeGestures() {
    var container = document.getElementById('m-cards-container');
    if (!container || _swAttached) return;
    _swAttached = true;

    var SNAP = 50;
    var MAX_REVEAL = Math.min(140, Math.floor(window.innerWidth * 0.38));

    container.addEventListener('touchstart', function (e) {
      var wrap = e.target.closest('.m-swipe-wrap');
      if (!wrap) return;
      var inner = wrap.querySelector('.m-card-inner');
      if (!inner) return;
      _swState = {
        wrap: wrap, inner: inner,
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        moved: false, aborted: false
      };
    }, { passive: true });

    container.addEventListener('touchmove', function (e) {
      if (!_swState || _swState.aborted) return;
      var dx = e.touches[0].clientX - _swState.startX;
      var dy = e.touches[0].clientY - _swState.startY;
      var ax = Math.abs(dx), ay = Math.abs(dy);

      if (!_swState.moved) {
        if (ax < 3 && ay < 3) return;
        if (ay > ax + 4) { _swState.aborted = true; return; }
        if (ax < 6) return;
        _swState.moved = true;
        _swState.inner.style.transition = 'none';
        closeAllSwipes(_swState.inner);
      }

      var hasLeft = _swState.wrap.querySelector('.m-swipe-actions-left');
      var clamped = Math.max(-MAX_REVEAL, Math.min(MAX_REVEAL, dx));
      if (dx > 0 && hasLeft && !hasLeft.children.length) clamped = 0;
      _swState.inner.style.transform = 'translateX(' + clamped + 'px)';
    }, { passive: false });

    container.addEventListener('touchend', function (e) {
      if (!_swState) return;
      var s = _swState;
      _swState = null;
      if (!s.moved || s.aborted) { s.inner.style.transform = ''; return; }

      var dx = e.changedTouches[0].clientX - s.startX;
      s.inner.style.transition = 'transform 0.2s ease';

      if (dx > SNAP) {
        var leftW = s.wrap.querySelector('.m-swipe-actions-left');
        s.inner.style.transform = 'translateX(' + (leftW ? leftW.offsetWidth : 0) + 'px)';
        s.inner.setAttribute('data-swipe-open', 'left');
        haptic(8);
      } else if (dx < -SNAP) {
        var rightW = s.wrap.querySelector('.m-swipe-actions-right');
        s.inner.style.transform = 'translateX(-' + (rightW ? rightW.offsetWidth : 0) + 'px)';
        s.inner.setAttribute('data-swipe-open', 'right');
        haptic(8);
      } else {
        s.inner.style.transform = '';
        s.inner.removeAttribute('data-swipe-open');
      }
    }, { passive: true });

    container.addEventListener('touchcancel', function () {
      if (!_swState) return;
      _swState.inner.style.transition = 'transform 0.2s ease';
      _swState.inner.style.transform = '';
      _swState = null;
    }, { passive: true });

    document.addEventListener('touchstart', function (e) {
      if (!e.target.closest('.m-swipe-wrap')) closeAllSwipes();
    }, { passive: true });
  }

  function closeAllSwipes(except) {
    document.querySelectorAll('.m-card-inner[data-swipe-open]').forEach(function (el) {
      if (el === except) return;
      el.style.transition = 'transform 0.2s ease';
      el.style.transform = '';
      el.removeAttribute('data-swipe-open');
    });
  }

  // ==================================================================
  //  5. STATUS CYCLING — Swipe left action
  // ==================================================================
  var STATUS_ORDER = [
    'A contacter', 'Appele', 'Messagerie', 'Rendez-vous',
    'Prospecte', 'A rappeler', 'Pas interesse', "Pas d'actions"
  ];

  window._mCycleStatus = function (pid) {
    var allData = window._v8Data || (typeof data !== 'undefined' ? data : null);
    if (!allData || !allData.prospects) return;
    var p = allData.prospects.find(function (x) { return x.id === pid || String(x.id) === String(pid); });
    if (!p) return;
    var idx = STATUS_ORDER.indexOf(p.statut || '');
    var next = STATUS_ORDER[(idx + 1) % STATUS_ORDER.length];
    var old = p.statut;
    p.statut = next;

    fetch('/api/prospects/bulk-status-tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [parseInt(pid)], statut: next })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.ok) {
        haptic(15);
        if (window.showToast) window.showToast('Statut \u2192 ' + next, 'success', 2000);
        if (typeof window.filterProspects === 'function') window.filterProspects();
        if (window.pushUndo) {
          window.pushUndo('Statut ' + next + ' \u2192 ' + old, function () {
            p.statut = old;
            fetch('/api/prospects/bulk-status-tags', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ids: [parseInt(pid)], statut: old })
            });
            if (typeof window.filterProspects === 'function') window.filterProspects();
          });
        }
      }
    });
  };

  // ==================================================================
  //  6. PULL-TO-REFRESH
  // ==================================================================
  function initPullToRefresh() {
    var loadFn = typeof window.loadFromServer === 'function' ? window.loadFromServer : null;
    if (!loadFn) return;

    var startY = 0, pulling = false, indicator = null;

    function getScrollTop() {
      return document.documentElement.scrollTop || document.body.scrollTop || 0;
    }

    function ensureIndicator() {
      if (indicator) return indicator;
      indicator = document.createElement('div');
      indicator.className = 'm-pull-indicator';
      indicator.textContent = 'Actualisation\u2026';
      document.body.appendChild(indicator);
      return indicator;
    }

    document.addEventListener('touchstart', function (e) {
      if (getScrollTop() > 5) return;
      startY = e.touches[0].clientY;
      pulling = false;
    }, { passive: true });

    document.addEventListener('touchmove', function (e) {
      if (getScrollTop() > 5) return;
      if (e.touches[0].clientY - startY > 40) pulling = true;
    }, { passive: true });

    document.addEventListener('touchend', function () {
      if (!pulling || getScrollTop() > 5) { startY = 0; pulling = false; return; }
      ensureIndicator();
      indicator.classList.add('visible');
      haptic(15);

      Promise.resolve(loadFn()).then(function (ok) {
        try {
          if (typeof window.normalizeData === 'function') window.normalizeData();
          if (document.body.getAttribute('data-page') === 'prospects' && typeof window.filterProspects === 'function') window.filterProspects();
        } catch (e) { /* ignore */ }
        indicator.classList.remove('visible');
        if (window.showToast) window.showToast(ok !== false ? 'Donnees actualisees' : 'Donnees non rechargees', ok !== false ? 'success' : 'warning', 2000);
      }).catch(function () {
        indicator.classList.remove('visible');
        if (window.showToast) window.showToast('Erreur lors de l\'actualisation', 'error');
      });

      startY = 0;
      pulling = false;
    }, { passive: true });
  }

  // ==================================================================
  //  7. PAGE TRANSITIONS — iOS slide animations
  // ==================================================================
  function getPageIndex(pathname) {
    if (PAGE_ORDER[pathname] !== undefined) return PAGE_ORDER[pathname];
    for (var key in PAGE_ORDER) {
      if (key !== '/' && pathname.indexOf(key) === 0) return PAGE_ORDER[key];
    }
    return -1;
  }

  function getWrapper() {
    return document.querySelector('.container') || document.body;
  }

  function animatePageEntrance() {
    var dir = sessionStorage.getItem('prospup_nav_direction');
    if (!dir) return;
    sessionStorage.removeItem('prospup_nav_direction');
    var wrapper = getWrapper();
    var cls = dir === 'forward' ? 'page-enter-from-right' : 'page-enter-from-left';
    wrapper.classList.add(cls);
    wrapper.addEventListener('animationend', function () {
      wrapper.classList.remove(cls);
    }, { once: true });
  }

  function handleNavClick(event) {
    var link = event.currentTarget;
    var href = link.getAttribute('href');
    if (!href || href.charAt(0) === '#') return;

    var targetPath;
    try { targetPath = new URL(href, window.location.origin).pathname; } catch (e) { return; }

    if (targetPath === window.location.pathname) { event.preventDefault(); return; }

    var ci = getPageIndex(window.location.pathname);
    var ti = getPageIndex(targetPath);
    var direction = (ci !== -1 && ti !== -1) ? (ti >= ci ? 'forward' : 'backward') : 'forward';

    sessionStorage.setItem('prospup_nav_direction', direction);
    event.preventDefault();

    var wrapper = getWrapper();
    var exitCls = direction === 'forward' ? 'page-exit-to-left' : 'page-exit-to-right';
    wrapper.classList.add(exitCls);

    setTimeout(function () { window.location.href = href; }, EXIT_DURATION);
  }

  function initTransitions() {
    animatePageEntrance();
    // Internal links get transition too
    document.querySelectorAll('a[href^="/"]').forEach(function (link) {
      if (!link.closest('.m-tabbar')) {
        link.addEventListener('click', handleNavClick);
      }
    });
  }

  // Handle bfcache (back swipe)
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) {
      sessionStorage.setItem('prospup_nav_direction', 'backward');
      animatePageEntrance();
    }
  });

  // ==================================================================
  //  8. STATUS FILTER CHIPS (Prospects page)
  // ==================================================================
  function buildStatusChips() {
    if (document.body.getAttribute('data-page') !== 'prospects') return;

    var container = document.getElementById('m-status-chips');
    if (container) return; // already built

    container = document.createElement('div');
    container.className = 'm-status-chips mobile-only';
    container.id = 'm-status-chips';

    var statuses = [
      { key: 'all',    label: 'Tous' },
      { key: 'urgent', label: 'Urgents' },
      { key: 'rappeler', label: 'A rappeler' },
      { key: 'rdv',    label: 'RDV' },
      { key: 'appele', label: 'Appeles' },
      { key: 'messagerie', label: 'Messagerie' },
      { key: 'prospecte', label: 'Prospectes' },
      { key: 'pas-interesse', label: 'Pas int.' }
    ];

    statuses.forEach(function (s) {
      var chip = document.createElement('button');
      chip.className = 'm-chip' + (s.key === 'all' ? ' active' : '');
      chip.setAttribute('data-filter', s.key);
      chip.textContent = s.label;
      chip.addEventListener('click', function () {
        container.querySelectorAll('.m-chip').forEach(function (c) { c.classList.remove('active'); });
        chip.classList.add('active');
        haptic(8);
        applyStatusFilter(s.key);
      });
      container.appendChild(chip);
    });

    // Insert before the card container or table
    var content = document.querySelector('.content-header');
    if (content && content.nextSibling) {
      content.parentNode.insertBefore(container, content.nextSibling);
    }
  }

  function applyStatusFilter(key) {
    // Use the existing filter system from app.js
    var filterEl = document.getElementById('filterStatut');
    if (!filterEl) return;

    var mapping = {
      'all': '',
      'urgent': 'A rappeler',
      'rappeler': 'A rappeler',
      'rdv': 'Rendez-vous',
      'appele': 'Appele',
      'messagerie': 'Messagerie',
      'prospecte': 'Prospecte',
      'pas-interesse': 'Pas interesse'
    };

    filterEl.value = mapping[key] || '';
    if (typeof window.filterProspects === 'function') window.filterProspects();
  }

  // ==================================================================
  //  9. INITIALIZATION
  // ==================================================================
  function init() {
    buildTabBar();
    buildFAB();
    buildStatusChips();
    initPullToRefresh();
    initTransitions();

    // Render cards after data is loaded
    if (document.body.getAttribute('data-page') === 'prospects') {
      // Wait for app.js data load
      var checkData = setInterval(function () {
        var d = window._v8Data || (typeof data !== 'undefined' ? data : null);
        if (d && d.prospects) {
          clearInterval(checkData);
          setTimeout(renderProspectCards, 100);
        }
      }, 200);
      // Safety: stop checking after 10s
      setTimeout(function () { clearInterval(checkData); }, 10000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
