// ═══════════════════════════════════════════════════════════════════
// Sidebar Navigation Builder — Single source of truth (v25)
// Generates desktop sidebar + mobile bottom nav from declarative data
// ═══════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    // ── Navigation structure ──────────────────────────────────────
    var NAV = [
        { group: 'Prospection', items: [
            { href: '/dashboard',   icon: '\uD83D\uDCCA', label: 'Dashboard',   page: 'dashboard',   helpSection: 'dashboard' },
            { href: '/',            icon: '\uD83D\uDC65', label: 'Prospects',    page: 'prospects',  helpSection: 'prospects' },
            { href: '/entreprises', icon: '\uD83D\uDCCD', label: 'Entreprises',  page: 'companies',  helpSection: 'entreprises' },
            { href: '/focus',       icon: '\uD83C\uDFAF', label: 'Focus',        page: 'focus',      helpSection: 'focus' }
        ]},
        { group: 'Actions', items: [
            { href: '/sourcing',  icon: '\uD83E\uDDF2', label: 'Candidats',         page: 'sourcing',  helpSection: 'sourcing' },
            { href: '/calendrier',  icon: '\uD83D\uDCC5', label: 'Calendrier',   page: 'calendar',   helpSection: 'calendrier' },
            { href: '/collab',      icon: '\uD83D\uDC65', label: 'Collaboration', page: 'collab',     helpSection: 'collab' }
        ]},
        { group: 'Analyse', items: [
            { href: '/stats',   icon: '\uD83D\uDCC8', label: 'Stats',   page: 'stats',   helpSection: 'stats' },
            { href: '/rapport', icon: '\uD83D\uDCCB', label: 'Rapport', page: 'rapport', helpSection: 'rapport' }
        ]},
        { group: 'Outils', items: [
            { href: '/parametres', icon: '\u2699\uFE0F', label: 'Param\u00e8tres', page: 'settings', helpSection: 'parametres',
              children: [
                  { href: '/duplicates', icon: '\uD83D\uDD00', label: 'Doublons',  page: 'duplicates', helpSection: 'doublons' },
                  { href: '/snapshots',  icon: '\uD83D\uDCBE', label: 'Snapshots', page: 'snapshots',  helpSection: 'snapshots' },
                  { href: '/metiers',    icon: '\uD83C\uDFD7\uFE0F', label: 'M\u00e9tiers',  page: 'metiers',  helpSection: 'metiers' },
                  { href: '/users',      icon: '\uD83D\uDC65', label: 'Utilisateurs', page: 'users',   helpSection: 'utilisateurs', adminOnly: true },
                  { href: '/activity',   icon: '\uD83D\uDCCB', label: 'Journal',   page: 'activity',   helpSection: 'activity', adminOnly: true },
                  { href: '/help',       icon: '\u2753',       label: 'Aide',      page: 'help',       helpSection: 'raccourcis' }
              ]
            },
            { href: '/push',      icon: '\uD83D\uDCE4', label: 'Push',             page: 'push',      helpSection: 'push' },
            { href: '/?archived=1', icon: '\uD83D\uDCC1', label: 'Archiv\u00e9s', id: 'sidebarArchivedBtn', page: '_archived', helpSection: 'archived' }
        ]}
    ];

    // Mobile bottom nav — subset of main nav
    var MOBILE_NAV = ['dashboard', 'prospects', 'focus', 'calendar', 'push'];

    // Detail pages → highlight their parent nav item
    var PAGE_PARENT_MAP = {
        candidate: 'sourcing',
        company: 'companies'
    };

    // Sub-pages that belong to Paramètres
    var SETTINGS_CHILDREN = ['duplicates', 'snapshots', 'kpi', 'metiers', 'users', 'activity', 'help'];

    // ── Prefetch (navigation fluidity) ────────────────────────────
    var PREFETCH_DELAY_MS = 120;
    var PREFETCH_MAX_CONCURRENT = 2;
    var _prefetchPending = 0;
    var _prefetchTimer = null;

    function _normalizeNavUrl(href) {
        if (!href || href.indexOf('javascript:') === 0 || href.indexOf('#') === 0) return null;
        try {
            var a = document.createElement('a');
            a.href = href;
            if (a.origin !== window.location.origin) return null;
            return a.pathname + (a.search || '');
        } catch (e) { return null; }
    }

    function _isCurrentPageUrl(navPath) {
        var current = window.location.pathname + (window.location.search || '');
        if (navPath === '/' && current === '/') return true;
        if (navPath === current) return true;
        if (navPath === '/' && current.indexOf('/') === 0 && current.length > 1) return false;
        return navPath === current;
    }

    function _doPrefetch(url) {
        if (_prefetchPending >= PREFETCH_MAX_CONCURRENT) return;
        var path = _normalizeNavUrl(url);
        if (!path || _isCurrentPageUrl(path)) return;
        _prefetchPending += 1;
        fetch(url, { credentials: 'same-origin', headers: { Accept: 'text/html' } })
            .then(function () { _prefetchPending -= 1; })
            .catch(function () { _prefetchPending -= 1; });
    }

    function _schedulePrefetch(url) {
        if (_prefetchTimer) clearTimeout(_prefetchTimer);
        _prefetchTimer = setTimeout(function () {
            _prefetchTimer = null;
            _doPrefetch(url);
        }, PREFETCH_DELAY_MS);
    }

    function _cancelPrefetch() {
        if (_prefetchTimer) {
            clearTimeout(_prefetchTimer);
            _prefetchTimer = null;
        }
    }

    function _attachPrefetch(el, href) {
        if (!href || href.indexOf('javascript:') === 0) return;
        el.addEventListener('mouseenter', function () {
            _schedulePrefetch(el.href);
        });
        el.addEventListener('mouseleave', _cancelPrefetch);
        el.addEventListener('click', _cancelPrefetch);
        el.addEventListener('touchend', function () {
            _schedulePrefetch(el.href);
        }, { passive: true });
    }

    function _attachNavLoading(el, href) {
        if (!href || href.indexOf('javascript:') === 0) return;
        el.addEventListener('click', function (e) {
            if (e.ctrlKey || e.metaKey || e.shiftKey) return;
            var path = _normalizeNavUrl(href);
            if (!path || _isCurrentPageUrl(path)) return;
            el.classList.add('nav-loading');
        });
    }

    // ── Accordion state (persistent via localStorage) ─────────────
    var ACCORDION_KEY = 'sidebar_accordion_state';

    function _getAccordionState() {
        try { return JSON.parse(localStorage.getItem(ACCORDION_KEY) || '{}'); } catch (e) { return {}; }
    }

    function _setAccordionState(key, value) {
        var state = _getAccordionState();
        state[key] = value;
        try { localStorage.setItem(ACCORDION_KEY, JSON.stringify(state)); } catch (e) {}
    }

    function _isAccordionOpen(itemPage) {
        // Auto-ouvrir si on est déjà dans cette section
        if (itemPage === 'settings' && isInSettingsSection) return true;
        var state = _getAccordionState();
        return state[itemPage] === true;
    }

    // ── State ─────────────────────────────────────────────────────
    var _currentUser = null;  // user from /api/auth/me (for badge)
    
    // Fonction pour mettre à jour l'utilisateur depuis app.js
    window.setSidebarCurrentUser = function(user) {
        _currentUser = user;
        if (typeof buildMobileBottomNav === 'function') {
            buildMobileBottomNav();
        }
    };
    var currentPage = (document.body.getAttribute('data-page') || '').toLowerCase();
    var effectivePage = PAGE_PARENT_MAP[currentPage] || currentPage;
    var currentPath = window.location.pathname;
    var currentSearch = window.location.search;
    var isInSettingsSection = currentPage === 'settings' || SETTINGS_CHILDREN.indexOf(currentPage) !== -1;

    // ── Helpers ───────────────────────────────────────────────────
    function _isActive(item) {
        if (!item.page) return false;
        // Direct match
        if (item.page === effectivePage) return true;
        // Contacts special case
        if (item.page === '_archived' && currentPath === '/' && currentSearch === '?archived=1') return true;
        return false;
    }

    function _isParentOfActive(item) {
        if (!item.children) return false;
        return item.children.some(function (child) { return child.page === currentPage; });
    }

    // ── Build desktop sidebar ─────────────────────────────────────
    function buildSidebar() {
        var sidebar = document.querySelector('.sidebar');
        if (!sidebar) return;

        sidebar.innerHTML = '';

        // Title
        var h2 = document.createElement('h2');
        h2.innerHTML = '\uD83E\uDDED <span class="nav-label">Navigation</span>';
        sidebar.appendChild(h2);

        NAV.forEach(function (group) {
            // Group label
            var gl = document.createElement('div');
            gl.className = 'nav-group-label';
            gl.textContent = group.group;
            sidebar.appendChild(gl);

            group.items.forEach(function (item) {
                var hasChildren = item.children && item.children.length > 0;
                var parentActive = hasChildren && _isParentOfActive(item);
                var selfActive = _isActive(item);

                if (hasChildren) {
                    // ── Split button : wrapper + lien nav + chevron toggle ──────────
                    var wrapper = document.createElement('div');
                    wrapper.className = 'nav-split';
                    if (item.id) wrapper.id = item.id;
                    if (selfActive && !parentActive) wrapper.classList.add('active');
                    if (parentActive) wrapper.classList.add('active-parent');

                    // Partie gauche : lien de navigation
                    var splitLink = document.createElement('a');
                    splitLink.className = 'nav-split-link';
                    splitLink.href = item.href;
                    _attachPrefetch(splitLink, item.href);
                    _attachNavLoading(splitLink, item.href);
                    if (item.helpSection) splitLink.setAttribute('data-help-section', item.helpSection);
                    splitLink.setAttribute('data-tooltip', item.label);
                    // Icône + label wrappés pour le mode sidebar collapsed
                    var iconSpan = document.createElement('span');
                    iconSpan.className = 'nav-icon';
                    iconSpan.textContent = item.icon;
                    var labelSpan = document.createElement('span');
                    labelSpan.className = 'nav-label';
                    labelSpan.textContent = '\u00a0' + item.label;
                    splitLink.appendChild(iconSpan);
                    splitLink.appendChild(labelSpan);

                    // Partie droite : chevron toggle (ne navigue pas)
                    var chevron = document.createElement('button');
                    chevron.type = 'button';
                    chevron.className = 'nav-split-chevron';
                    chevron.setAttribute('aria-label', 'Déplier / Replier');
                    chevron.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

                    wrapper.appendChild(splitLink);
                    wrapper.appendChild(chevron);
                    sidebar.appendChild(wrapper);

                    // Sous-menu
                    var sub = document.createElement('div');
                    sub.className = 'nav-submenu';
                    var isOpen = _isAccordionOpen(item.page);
                    sub.classList.toggle('expanded', isOpen);
                    chevron.classList.toggle('expanded', isOpen);

                    item.children.forEach(function (child) {
                        var ca = document.createElement('a');
                        ca.className = 'nav-button nav-sub-item';
                        ca.href = child.href;
                        _attachPrefetch(ca, child.href);
                        _attachNavLoading(ca, child.href);
                        if (child.helpSection) ca.setAttribute('data-help-section', child.helpSection);
                        if (child.page === currentPage) ca.classList.add('active');
                        ca.textContent = child.icon + ' ' + child.label;
                        sub.appendChild(ca);
                    });

                    sidebar.appendChild(sub);

                    chevron.addEventListener('click', function (e) {
                        e.preventDefault();
                        e.stopPropagation();
                        var opened = sub.classList.toggle('expanded');
                        chevron.classList.toggle('expanded', opened);
                        _setAccordionState(item.page, opened);
                    });

                } else {
                    // ── Bouton simple (pas de sous-menu) ────────────────────────────
                    var a = document.createElement('a');
                    a.className = 'nav-button';
                    if (item.id) a.id = item.id;

                    if (item.action) {
                        a.href = 'javascript:void(0)';
                        a.setAttribute('data-action', item.action);
                        a.onclick = function () {
                            if (window[item.action]) window[item.action]();
                        };
                    } else {
                        a.href = item.href;
                        _attachPrefetch(a, item.href);
                        _attachNavLoading(a, item.href);
                    }
                    if (item.helpSection) a.setAttribute('data-help-section', item.helpSection);
                    if (selfActive) a.classList.add('active');

                    a.textContent = item.icon + ' ' + item.label;
                    sidebar.appendChild(a);
                }
            });
        });
    }

    // Mobile bottom nav moved to mobile.js
    function buildMobileBottomNav() {}
    window._refreshProfileBadge = function() {};

    // ── Public API ────────────────────────────────────────────────
    window.buildSidebar = buildSidebar;
    window.buildMobileBottomNav = buildMobileBottomNav;

    window._sidebarCurrentUser = function() { return _currentUser; };

    // ── Auto-init (role-aware) ─────────────────────────────────────
    function _init() {
        fetch('/api/auth/me', { credentials: 'same-origin' })
            .then(function (r) { return r.ok ? r.json() : { ok: false }; })
            .then(function (d) {
                // Wrap entirely so that any internal error doesn't cascade to .catch()
                // (which would call buildSidebar() a second time and produce duplicate nav badges)
                try {
                    _currentUser = (d.ok && d.user) ? d.user : null;
                    var isAdmin = _currentUser && _currentUser.role === 'admin';
                    if (!isAdmin) {
                        NAV.forEach(function (group) {
                            group.items = group.items.filter(function (item) {
                                if (item.adminOnly) return false;
                                if (item.children) {
                                    item.children = item.children.filter(function (c) { return !c.adminOnly; });
                                }
                                return true;
                            });
                        });
                    }
                } catch (e) {
                    console.warn('Sidebar role filter error:', e);
                }
                buildSidebar();
                document.dispatchEvent(new CustomEvent('sidebar-ready'));
            })
            .catch(function (e) {
                // Only runs if fetch or JSON parsing failed — never after .then() completes
                console.warn('Sidebar init error:', e);
                buildSidebar();
                document.dispatchEvent(new CustomEvent('sidebar-ready'));
            });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
    } else {
        _init();
    }
})();
