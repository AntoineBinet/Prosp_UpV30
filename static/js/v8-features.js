// ═══════════════════════════════════════════════════════════════════
// v8-features.js — Toast, GlobalSearch, ThemeToggle, Mobile, Undo, Export
// ═══════════════════════════════════════════════════════════════════

(function () {
    'use strict';

    // ────────────── 1. TOAST NOTIFICATIONS ──────────────

    let _toastContainer = null;

    function _ensureToastContainer() {
        if (_toastContainer) return _toastContainer;
        _toastContainer = document.createElement('div');
        _toastContainer.id = 'toastContainer';
        _toastContainer.className = 'toast-container';
        document.body.appendChild(_toastContainer);
        return _toastContainer;
    }

    /**
     * showToast(message, type, duration)
     * @param {string} message
     * @param {'success'|'error'|'warning'|'info'} type
     * @param {number} duration ms (default 3500)
     */
    window.showToast = function (message, type, duration) {
        type = type || 'info';
        duration = duration || 3500;
        const container = _ensureToastContainer();

        const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
        const toast = document.createElement('div');
        toast.className = 'toast toast-' + type;
        toast.innerHTML = `
            <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
            <span class="toast-msg">${_escToastHtml(message)}</span>
            <button class="toast-close" onclick="this.parentElement.classList.add('toast-exit');setTimeout(()=>this.parentElement.remove(),300)">&times;</button>
            <div class="toast-progress"><div class="toast-progress-bar" style="animation-duration:${duration}ms"></div></div>
        `;
        container.appendChild(toast);

        // Force reflow then animate in
        void toast.offsetWidth;
        toast.classList.add('toast-enter');

        setTimeout(() => {
            if (toast.parentElement) {
                toast.classList.add('toast-exit');
                setTimeout(() => toast.remove(), 350);
            }
        }, duration);
    };

    function _escToastHtml(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    // Override native alert with toast
    const _origAlert = window.alert;
    window.alert = function (msg) {
        msg = String(msg || '');
        let type = 'info';
        if (msg.startsWith('✅') || msg.includes('succès') || msg.includes('copié') || msg.includes('sauveg')) type = 'success';
        else if (msg.startsWith('❌') || msg.includes('erreur') || msg.includes('Erreur') || msg.includes('Impossible')) type = 'error';
        else if (msg.startsWith('⚠️') || msg.includes('Aucun')) type = 'warning';
        window.showToast(msg, type, type === 'error' ? 5000 : 3500);
    };

    // ────────────── 2. GLOBAL SEARCH (Ctrl+K) ──────────────

    let _searchOverlay = null;
    let _searchInput = null;
    let _searchResults = null;
    let _searchDebounce = null;

    function _createSearchOverlay() {
        if (_searchOverlay) return;
        _searchOverlay = document.createElement('div');
        _searchOverlay.id = 'globalSearchOverlay';
        _searchOverlay.className = 'gsearch-overlay';
        _searchOverlay.innerHTML = `
            <div class="gsearch-modal">
                <div class="gsearch-header">
                    <span class="gsearch-icon">🔍</span>
                    <input type="text" class="gsearch-input" placeholder="Rechercher un prospect, une entreprise, un tag…" autofocus>
                    <kbd class="gsearch-kbd">ESC</kbd>
                </div>
                <div class="gsearch-results"></div>
                <div class="gsearch-footer">
                    <span>↑↓ naviguer</span>
                    <span>↵ ouvrir</span>
                    <span>esc fermer</span>
                </div>
            </div>
        `;
        document.body.appendChild(_searchOverlay);

        _searchInput = _searchOverlay.querySelector('.gsearch-input');
        _searchResults = _searchOverlay.querySelector('.gsearch-results');

        // Close on overlay click
        _searchOverlay.addEventListener('click', function (e) {
            if (e.target === _searchOverlay) _closeGlobalSearch();
        });

        // Input handler
        _searchInput.addEventListener('input', function () {
            clearTimeout(_searchDebounce);
            _searchDebounce = setTimeout(() => _performGlobalSearch(_searchInput.value), 150);
        });

        // Keyboard navigation
        _searchInput.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { _closeGlobalSearch(); return; }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                _navigateResults(e.key === 'ArrowDown' ? 1 : -1);
            }
            if (e.key === 'Enter') {
                const active = _searchResults.querySelector('.gsearch-item.active');
                if (active) active.click();
            }
        });
    }

    function _openGlobalSearch() {
        _createSearchOverlay();
        _searchOverlay.classList.add('open');
        _searchInput.value = '';
        _searchResults.innerHTML = '<div class="gsearch-hint">Tapez pour rechercher…</div>';
        setTimeout(() => _searchInput.focus(), 50);
    }

    function _closeGlobalSearch() {
        if (_searchOverlay) _searchOverlay.classList.remove('open');
    }

    window.openGlobalSearch = _openGlobalSearch;
    window.closeGlobalSearch = _closeGlobalSearch;

    function _performGlobalSearch(q) {
        q = (q || '').trim().toLowerCase();
        if (!q || q.length < 2) {
            _searchResults.innerHTML = '<div class="gsearch-hint">Tapez au moins 2 caractères…</div>';
            return;
        }

        // Use the full API search endpoint (prospects + companies + candidates + push)
        fetch('/api/search?q=' + encodeURIComponent(q) + '&limit=15')
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (json) {
                if (!json) { _performGlobalSearchFallback(q); return; }

                const results = [];

                // Prospects (P6: snippet = nextAction, nextFollowUp, statut)
                (json.prospects || []).forEach(function (p) {
                    results.push({
                        id: p.id, name: p.name || 'Sans nom',
                        company: p.company_groupe || '', fonction: p.fonction || '',
                        statut: p.statut || '', nextAction: p.nextAction || '', nextFollowUp: p.nextFollowUp || '',
                        type: 'prospect'
                    });
                });

                // Companies (P6: snippet = site)
                (json.companies || []).forEach(function (c) {
                    results.push({
                        id: c.id, name: c.groupe || c.site || '',
                        company: c.site || '', industry: c.industry || '', type: 'company'
                    });
                });

                // Candidates (P6: snippet = role, tech)
                (json.candidates || []).forEach(function (c) {
                    results.push({
                        id: c.id, name: c.name || 'Sans nom',
                        company: c.role || '', tech: c.tech || '', status: c.status || '',
                        type: 'candidate'
                    });
                });

                // Push logs (P6: already have subject, to_email, sentAt)
                (json.pushLogs || []).slice(0, 5).forEach(function (pl) {
                    results.push({
                        id: pl.prospect_id, name: pl.subject || 'Push',
                        company: pl.to_email || '', sentAt: pl.sentAt || '', prospect_name: pl.prospect_name || '',
                        type: 'push'
                    });
                });

                if (results.length === 0) {
                    _searchResults.innerHTML = '<div class="gsearch-hint">Aucun résultat pour "' + _escToastHtml(q) + '"</div>';
                    return;
                }

                _renderGlobalResults(results, q);
            })
            .catch(function () { _performGlobalSearchFallback(q); });
    }

    // Fallback: search in memory (for pages that don't have the API)
    function _performGlobalSearchFallback(q) {
        const prospects = (window._v8Data && window._v8Data.prospects) || [];
        const companies = (window._v8Data && window._v8Data.companies) || [];
        const companyMap = {};
        companies.forEach(c => companyMap[c.id] = c);

        const results = [];
        prospects.forEach(function (p) {
            const fields = [
                p.name || '', p.fonction || '', p.email || '', p.telephone || '',
                p.notes || '', p.tags || '', p.nextAction || '',
                (companyMap[p.company_id] || {}).groupe || ''
            ].join(' ').toLowerCase();

            if (fields.includes(q)) {
                results.push({
                    id: p.id, name: p.name || 'Sans nom',
                    company: (companyMap[p.company_id] || {}).groupe || '',
                    statut: p.statut || '', fonction: p.fonction || '',
                    nextAction: p.nextAction || '', nextFollowUp: p.nextFollowUp || '',
                    type: 'prospect'
                });
            }
        });

        companies.forEach(function (c) {
            const fields = [c.groupe || '', c.site || '', c.secteur || '', c.notes || ''].join(' ').toLowerCase();
            if (fields.includes(q)) {
                results.push({ id: c.id, name: c.groupe || c.site || '', company: c.site || '', type: 'company' });
            }
        });

        if (results.length === 0) {
            _searchResults.innerHTML = '<div class="gsearch-hint">Aucun résultat pour "' + _escToastHtml(q) + '"</div>';
            return;
        }
        _renderGlobalResults(results, q);
    }

    function _renderGlobalResults(results, q) {
        const highlight = function (text) {
            if (!text) return '';
            const regex = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
            return _escToastHtml(text).replace(regex, '<mark>$1</mark>');
        };

        const icons = { prospect: '👤', company: '🏢', candidate: '🧲', push: '📤' };
        const typeLabels = { prospect: 'Prospect', company: 'Entreprise', candidate: 'Candidat', push: 'Push' };
        const links = {
            prospect: function (r) { return '/?open=' + r.id; },
            company: function (r) { return '/entreprises?openCompany=' + r.id; },
            candidate: function (r) { return '/sourcing?open=' + r.id; },
            push: function (r) { return '/push'; }
        };

        const html = results.slice(0, 15).map(function (r, i) {
            const icon = icons[r.type] || '📄';
            const typeLabel = typeLabels[r.type] || r.type;
            const link = (links[r.type] || links.prospect)(r);
            var meta = r.type === 'prospect'
                ? highlight(r.company) + (r.fonction ? ' · ' + highlight(r.fonction) : '')
                : r.type === 'push'
                    ? highlight(r.company) + (r.sentAt ? ' · ' + r.sentAt.slice(0, 10) : '')
                    : r.type === 'candidate'
                        ? (r.company ? highlight(r.company) : '') + (r.tech ? ' · ' + highlight(r.tech) : '')
                        : highlight(r.company);
            var snippet = '';
            if (r.type === 'prospect') {
                var parts = [];
                if (r.nextFollowUp) parts.push('Relance ' + _escToastHtml(r.nextFollowUp.slice(0, 10)));
                if (r.statut) parts.push(_escToastHtml(r.statut));
                if (r.nextAction) parts.push(_escToastHtml(r.nextAction).slice(0, 40) + (r.nextAction.length > 40 ? '…' : ''));
                snippet = parts.length ? parts.join(' · ') : '';
            } else if (r.type === 'company' && r.industry) snippet = _escToastHtml(r.industry);
            else if (r.type === 'candidate' && r.status) snippet = _escToastHtml(r.status);

            return '<a href="' + link + '" class="gsearch-item' + (i === 0 ? ' active' : '') + '" data-idx="' + i + '">' +
                '<span class="gsearch-item-icon">' + icon + '</span>' +
                '<div class="gsearch-item-info">' +
                '<div class="gsearch-item-name">' + highlight(r.name) + ' <span class="gsearch-item-type">' + _escToastHtml(typeLabel) + '</span></div>' +
                '<div class="gsearch-item-meta">' + meta + '</div>' +
                (snippet ? '<div class="gsearch-item-snippet">' + snippet + '</div>' : '') +
                '</div>' +
                (r.statut ? '<span class="gsearch-item-badge">' + _escToastHtml(r.statut) + '</span>' : '') +
                '</a>';
        }).join('');

        _searchResults.innerHTML = html + (results.length > 15 ? '<div class="gsearch-hint">+' + (results.length - 15) + ' autres résultats…</div>' : '');
    }

    function _navigateResults(dir) {
        const items = _searchResults.querySelectorAll('.gsearch-item');
        if (!items.length) return;
        let activeIdx = -1;
        items.forEach(function (it, i) { if (it.classList.contains('active')) activeIdx = i; });
        items.forEach(function (it) { it.classList.remove('active'); });
        activeIdx += dir;
        if (activeIdx < 0) activeIdx = items.length - 1;
        if (activeIdx >= items.length) activeIdx = 0;
        items[activeIdx].classList.add('active');
        items[activeIdx].scrollIntoView({ block: 'nearest' });
    }

    // ────────────── 3. THEME TOGGLE ──────────────

    function _getEffectiveTheme() {
        const data = document.documentElement.getAttribute('data-theme');
        if (data === 'light' || data === 'dark') return data;
        return (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
    }

    function _updateThemeColor(theme) {
        theme = theme || _getEffectiveTheme();
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) {
            meta.setAttribute('content', theme === 'light' ? '#f6f7f9' : '#0f172a');
        }
    }

    function _initThemeToggle() {
        const saved = localStorage.getItem('theme');
        if (saved === 'light') {
            document.documentElement.setAttribute('data-theme', 'light');
        } else if (saved === 'dark') {
            document.documentElement.setAttribute('data-theme', 'dark');
        }
        _updateThemeColor();
        // Fix button text on load
        const btn = document.getElementById('themeToggleBtn');
        if (btn) {
            const current = document.documentElement.getAttribute('data-theme');
            const icon = (current === 'light') ? '☀️' : '🌙';
            // Check if spans exist (sidebar collapse wraps them)
            const iconSpan = btn.querySelector('.nav-icon');
            if (iconSpan) {
                iconSpan.textContent = icon;
            } else {
                btn.textContent = icon + ' Thème';
            }
        }
    }

    window.toggleTheme = function () {
        const current = document.documentElement.getAttribute('data-theme');
        let next;
        if (!current || current === 'dark') {
            next = 'light';
        } else {
            next = 'dark';
        }
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
        _updateThemeColor(next);

        // Update ALL toggle buttons (sidebar + collapsed)
        const icon = next === 'light' ? '☀️' : '🌙';
        document.querySelectorAll('#themeToggleBtn').forEach(function (btn) {
            const iconSpan = btn.querySelector('.nav-icon');
            if (iconSpan) {
                iconSpan.textContent = icon;
            } else {
                btn.textContent = icon + ' Thème';
            }
        });

        window.showToast('Thème ' + (next === 'light' ? 'clair' : 'sombre') + ' activé', 'info', 2000);
    };

    // ────────────── 3b. SIDEBAR COLLAPSE ──────────────

    function _initSidebarCollapse() {
        const sidebar = document.querySelector('.sidebar');
        if (!sidebar) return;
        if (document.getElementById('sidebarCollapseBtn')) return;

        // Create toggle button
        const toggle = document.createElement('button');
        toggle.className = 'sidebar-collapse-btn';
        toggle.id = 'sidebarCollapseBtn';
        toggle.title = 'Réduire / Agrandir le menu';
        toggle.textContent = '«';
        toggle.onclick = function () { _toggleSidebar(); };
        sidebar.prepend(toggle);

        // Wrap emoji and text in spans for CSS control
        sidebar.querySelectorAll('.nav-button').forEach(function (btn) {
            const text = btn.textContent.trim();
            // First 1-2 chars are emoji, rest is label
            const match = text.match(/^(\S+)\s*(.*)/);
            if (match) {
                const emoji = match[1];
                const label = match[2];
                btn.innerHTML = '<span class="nav-icon">' + emoji + '</span><span class="nav-label">' + label + '</span>';
                btn.setAttribute('data-tooltip', label);
            }
        });

        // Restore saved state
        const collapsed = localStorage.getItem('sidebar-collapsed') === 'true';
        if (collapsed) {
            document.body.classList.add('sidebar-collapsed');
            toggle.textContent = '»';
        }
    }

    function _toggleSidebar() {
        const collapsed = document.body.classList.toggle('sidebar-collapsed');
        localStorage.setItem('sidebar-collapsed', collapsed);
        const btn = document.getElementById('sidebarCollapseBtn');
        if (btn) btn.textContent = collapsed ? '»' : '«';
    }

    window.toggleSidebar = _toggleSidebar;

    // ────────────── 3b. HEADER LAYOUT (left + center for search + badge, v25) ──────────────
    function _initHeaderLayout() {
        if (window.location.pathname === '/login') return;
        const header = document.querySelector('header');
        if (!header || header.querySelector('.header-center')) return;
        const h1 = header.querySelector('h1');
        const subtitle = header.querySelector('.header-subtitle');
        if (!h1) return;
        const left = document.createElement('div');
        left.className = 'header-left';
        left.appendChild(h1);
        if (subtitle) left.appendChild(subtitle);
        const center = document.createElement('div');
        center.className = 'header-center';
        header.appendChild(left);
        header.appendChild(center);
        // Dispatcher un événement pour signaler que le header est prêt
        document.dispatchEvent(new CustomEvent('header-layout-ready'));
    }
    // ────────────── 3c. FLOATING SEARCH BUTTON ──────────────

    function _initFloatingSearch() {
        if (document.getElementById('floatingSearchBtn')) return;
        const btn = document.createElement('button');
        btn.id = 'floatingSearchBtn';
        btn.className = 'floating-search-btn';
        const center = document.querySelector('.header-center');
        if (center) {
            btn.classList.add('header-search-btn');
            center.appendChild(btn);
        } else {
            document.body.appendChild(btn);
        }
        btn.innerHTML = '🔍';
        btn.title = 'Recherche rapide (Ctrl+K)';
        btn.setAttribute('data-help-section', 'recherche');
        btn.onclick = _openGlobalSearch;
    }

    // ────────────── 3d. SCROLL: header-scrolled pour animation badge/loupe ──────────────
    function _initHeaderScroll() {
        const SCROLL_THRESHOLD = 50;
        let ticking = false;
        function updateScrolled() {
            const scrolled = (window.scrollY || document.documentElement.scrollTop) > SCROLL_THRESHOLD;
            document.body.classList.toggle('header-scrolled', scrolled);
            ticking = false;
        }
        function onScroll() {
            if (!ticking) {
                requestAnimationFrame(updateScrolled);
                ticking = true;
            }
        }
        window.addEventListener('scroll', onScroll, { passive: true });
        updateScrolled();
    }

    // ────────────── 4. MOBILE HAMBURGER ──────────────

    window.toggleMobileMenu = function () {
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.getElementById('mobileOverlay');
        if (!sidebar) return;
        sidebar.classList.toggle('sidebar-open');
        if (overlay) overlay.classList.toggle('active');
    };

    function _initMobile() {
        // Create overlay
        if (!document.getElementById('mobileOverlay')) {
            const ov = document.createElement('div');
            ov.id = 'mobileOverlay';
            ov.className = 'mobile-overlay';
            ov.onclick = window.toggleMobileMenu;
            document.body.appendChild(ov);
        }

        // Create hamburger button if not exists
        const header = document.querySelector('header');
        if (header && !document.getElementById('hamburgerBtn')) {
            const btn = document.createElement('button');
            btn.id = 'hamburgerBtn';
            btn.className = 'hamburger-btn';
            btn.innerHTML = '<span></span><span></span><span></span>';
            btn.onclick = window.toggleMobileMenu;
            header.prepend(btn);
        }

        // P4: Barre d'actions rapides mobile (Focus, Recherche, Ajouter prospect)
        if (!document.getElementById('mobileQuickActionsBar')) {
            const bar = document.createElement('div');
            bar.id = 'mobileQuickActionsBar';
            bar.className = 'mobile-quick-actions-bar';
            bar.innerHTML = '<a href="/focus" class="mobile-qa-item" title="Focus">🎯 Focus</a>' +
                '<button type="button" class="mobile-qa-item" onclick="window.openGlobalSearch && window.openGlobalSearch()" title="Recherche">🔍 Recherche</button>' +
                '<a href="/?add=1" class="mobile-qa-item" title="Ajouter prospect">➕ Ajouter</a>';
            document.body.appendChild(bar);
        }
    }

    // ────────────── 4b. DISPLAY PREFERENCES (Focus on/off, etc.) ──────────────
    function _displayPrefOn(key) {
        try {
            const v = localStorage.getItem(key);
            return v === null || v === '' || v === '1' || v === 'true' || v === 'yes' || v === 'on';
        } catch (e) { return true; }
    }

    window.getDisplayPref = function (key) {
        return _displayPrefOn(key);
    };

    var _navPrefMap = [
        { key: 'display_dashboard', selector: 'a.nav-button[href="/dashboard"], nav.mobile-bottom-nav a[href="/dashboard"]' },
        { key: 'display_focus', selector: 'a[href="/focus"]' },
        { key: 'display_calendrier', selector: 'a.nav-button[href="/calendrier"], nav.mobile-bottom-nav a[href="/calendrier"]' },
        { key: 'display_entreprises', selector: 'a.nav-button[href="/entreprises"]' },
        { key: 'display_sourcing', selector: 'a.nav-button[href="/sourcing"]' },
        { key: 'display_push', selector: 'a.nav-button[href="/push"], nav.mobile-bottom-nav a[href="/push"]' },
        { key: 'display_templates', selector: 'a.nav-button[href="/templates"]' },
        { key: 'display_stats', selector: 'a.nav-button[href="/stats"]' },
        { key: 'display_rapport', selector: 'a.nav-button[href="/rapport"]' },
        { key: 'display_contacts', selector: 'a.nav-button[href*="contacts=1"], #sidebarContactsBtn' }
    ];

    window.applyDisplayPrefs = function () {
        _navPrefMap.forEach(function (item) {
            var on = _displayPrefOn(item.key);
            try {
                document.querySelectorAll(item.selector).forEach(function (a) {
                    a.style.display = on ? '' : 'none';
                });
            } catch (e) {}
        });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            _initMobile();
            window.applyDisplayPrefs();
        });
    } else {
        window.applyDisplayPrefs();
    }

    // ────────────── 5. UNDO/REDO ──────────────

    const _undoStack = [];
    const MAX_UNDO = 30;

    /**
     * pushUndo(description, undoFn)
     * Records an undoable action.
     */
    window.pushUndo = function (description, undoFn) {
        _undoStack.push({ description: description, fn: undoFn, time: Date.now() });
        if (_undoStack.length > MAX_UNDO) _undoStack.shift();
    };

    window.performUndo = function () {
        if (_undoStack.length === 0) {
            window.showToast('Rien à annuler', 'warning', 2000);
            return;
        }
        const action = _undoStack.pop();
        try {
            action.fn();
            window.showToast('↩️ Annulé : ' + action.description, 'success', 3000);
        } catch (e) {
            window.showToast('Erreur lors de l\'annulation', 'error');
            console.error('Undo failed:', e);
        }
    };

    // ────────────── 6. EXPORT FUNCTIONS ──────────────

    window.exportCurrentViewCSV = function () {
        const table = document.querySelector('#tableBody');
        if (!table) { window.showToast('Aucune table à exporter', 'warning'); return; }

        // Normaliser le contenu cellule : pas de sauts de ligne pour éviter décalage des lignes CSV
        function csvCell(str) {
            const s = (str != null ? String(str) : '').trim().replace(/\r\n|\r|\n/g, ' ').replace(/"/g, '""');
            return '"' + s + '"';
        }

        // Get headers
        const ths = document.querySelectorAll('thead th');
        const headers = [];
        ths.forEach(function (th) { headers.push(csvCell(th.textContent)); });

        // Get rows
        const rows = table.querySelectorAll('tr');
        const csvRows = [headers.join(';')];
        rows.forEach(function (tr) {
            const cells = [];
            tr.querySelectorAll('td').forEach(function (td) {
                cells.push(csvCell(td.textContent));
            });
            if (cells.length) csvRows.push(cells.join(';'));
        });

        const blob = new Blob(['\uFEFF' + csvRows.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'prospects_export_' + new Date().toISOString().slice(0, 10) + '.csv';
        a.click();
        URL.revokeObjectURL(url);
        window.showToast('📁 Export CSV téléchargé', 'success');
    };

    window.exportCurrentViewJSON = function () {
        const prospects = (window._v8Data && window._v8Data.prospects) || [];
        const blob = new Blob([JSON.stringify(prospects, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'prospects_' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        URL.revokeObjectURL(url);
        window.showToast('📁 Export JSON téléchargé', 'success');
    };

    window.printCurrentView = function () {
        window.print();
    };

    // ────────────── 7. SPARKLINES ──────────────

    /**
     * Generate a tiny SVG sparkline
     * @param {number[]} values
     * @param {string} color
     * @returns {string} SVG HTML
     */
    window.generateSparkline = function (values, color) {
        if (!values || !values.length) return '<span class="sparkline-empty">—</span>';
        color = color || '#32b8c6';
        const w = 60, h = 18;
        const max = Math.max.apply(null, values) || 1;
        const step = w / Math.max(values.length - 1, 1);
        const points = values.map(function (v, i) {
            return (i * step).toFixed(1) + ',' + (h - (v / max * (h - 2)) - 1).toFixed(1);
        }).join(' ');
        return '<svg class="sparkline-svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
            '<polyline fill="none" stroke="' + color + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" points="' + points + '"/>' +
            '</svg>';
    };

    // ────────────── 8. TAG AUTOCOMPLETE ──────────────

    window.initTagAutocomplete = function (inputEl, onSelect) {
        if (!inputEl) return;
        let dropdown = null;

        inputEl.addEventListener('input', function () {
            const val = inputEl.value.trim().toLowerCase();
            if (val.length < 1) { _removeDropdown(); return; }

            // Collect all tags from prospects
            const allTags = new Set();
            var prospects = (window._v8Data && window._v8Data.prospects) || [];
            prospects.forEach(function (p) {
                (p.tags || '').split(',').forEach(function (t) {
                    t = t.trim();
                    if (t) allTags.add(t);
                });
            });

            const matches = Array.from(allTags).filter(function (t) { return t.toLowerCase().includes(val); }).slice(0, 8);
            if (!matches.length) { _removeDropdown(); return; }

            _showDropdown(matches);
        });

        inputEl.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') _removeDropdown();
        });

        function _showDropdown(items) {
            _removeDropdown();
            dropdown = document.createElement('div');
            dropdown.className = 'tag-autocomplete-dropdown';
            const rect = inputEl.getBoundingClientRect();
            dropdown.style.top = (rect.bottom + 2) + 'px';
            dropdown.style.left = rect.left + 'px';
            dropdown.style.width = Math.max(rect.width, 180) + 'px';

            items.forEach(function (tag) {
                const item = document.createElement('div');
                item.className = 'tag-autocomplete-item';
                item.textContent = tag;
                item.onclick = function () {
                    if (typeof onSelect === 'function') onSelect(tag);
                    else inputEl.value = tag;
                    _removeDropdown();
                };
                dropdown.appendChild(item);
            });
            document.body.appendChild(dropdown);
        }

        function _removeDropdown() {
            if (dropdown) { dropdown.remove(); dropdown = null; }
        }

        document.addEventListener('click', function (e) {
            if (dropdown && !dropdown.contains(e.target) && e.target !== inputEl) _removeDropdown();
        });
    };

    // ────────────── INIT ──────────────

    // ────────────── 4b. PULL-TO-REFRESH (mobile) ──────────────
    function _initPullToRefresh() {
        var mobile = window.matchMedia('(max-width: 600px)');
        if (!mobile.matches) return;
        var loadFn = typeof window.loadFromServer === 'function' ? window.loadFromServer : null;
        if (!loadFn) return;

        var startY = 0;
        var pulling = false;
        var indicator = null;

        function getScrollTop() {
            return document.documentElement.scrollTop || document.body.scrollTop || 0;
        }
        function ensureIndicator() {
            if (indicator) return indicator;
            indicator = document.createElement('div');
            indicator.id = 'pullToRefreshIndicator';
            indicator.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;padding:12px;padding-top:max(12px,env(safe-area-inset-top));text-align:center;background:var(--color-surface);border-bottom:1px solid var(--color-border);font-size:13px;color:var(--color-text-secondary);transform:translateY(-100%);transition:transform .2s;pointer-events:none;';
            indicator.textContent = 'Actualisation…';
            document.body.appendChild(indicator);
            return indicator;
        }
        function showIndicator() {
            var el = ensureIndicator();
            el.style.transform = 'translateY(0)';
        }
        function hideIndicator() {
            if (indicator) indicator.style.transform = 'translateY(-100%)';
        }

        document.addEventListener('touchstart', function (e) {
            if (getScrollTop() > 5) return;
            startY = e.touches[0].clientY;
            pulling = false;
        }, { passive: true });
        document.addEventListener('touchmove', function (e) {
            if (getScrollTop() > 5) return;
            var dy = e.touches[0].clientY - startY;
            if (dy > 40) pulling = true;
        }, { passive: true });
        document.addEventListener('touchend', function (e) {
            if (getScrollTop() > 5) { startY = 0; return; }
            var endY = e.changedTouches[0].clientY;
            var dy = endY - startY;
            if (pulling && dy > 60) {
                showIndicator();
                Promise.resolve(loadFn()).then(function (ok) {
                    try {
                        if (typeof window.normalizeData === 'function') window.normalizeData();
                        if (document.body.getAttribute('data-page') === 'prospects' && typeof window.filterProspects === 'function') window.filterProspects();
                    } catch (e) { /* page sans liste prospects (ex. Paramètres) */ }
                    hideIndicator();
                    if (window.showToast) window.showToast(ok !== false ? 'Données actualisées' : 'Données non rechargées', ok !== false ? 'success' : 'warning', 2000);
                }).catch(function () {
                    hideIndicator();
                    if (window.showToast) window.showToast('Erreur lors de l\'actualisation', 'error');
                });
            }
            startY = 0;
            pulling = false;
        }, { passive: true });
    }

    document.addEventListener('DOMContentLoaded', function () {
        _initHeaderLayout();
        _initThemeToggle();
        _initMobile();
        if (window.applyDisplayPrefs) window.applyDisplayPrefs();
        _initPullToRefresh();
        // Sidebar construit de façon asynchrone (fetch /api/auth/me) : bouton réduire après sidebar-ready
        document.addEventListener('sidebar-ready', function onSidebarReady() {
            document.removeEventListener('sidebar-ready', onSidebarReady);
            _initSidebarCollapse();
        });
        // Fallback si sidebar est déjà prêt (cache rapide) ou si sidebar-ready a été dispatché avant ce listener
        setTimeout(function () {
            const sidebar = document.querySelector('.sidebar');
            if (sidebar && sidebar.querySelector('.nav-button') && !document.getElementById('sidebarCollapseBtn'))
                _initSidebarCollapse();
        }, 400);
        _initFloatingSearch();
        _initHeaderScroll();

        // Ctrl+K global search
        document.addEventListener('keydown', function (e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                _openGlobalSearch();
            }
            // Ctrl+Z undo
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                // Only if no input/textarea is focused
                var tag = (document.activeElement || {}).tagName;
                if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
                    e.preventDefault();
                    window.performUndo();
                }
            }
            // Escape close search
            if (e.key === 'Escape') _closeGlobalSearch();
        });

        // Close export dropdown on outside click
        document.addEventListener('click', function (e) {
            var dd = document.getElementById('exportDropdown');
            if (dd && dd.classList.contains('open') && !dd.contains(e.target)) {
                dd.classList.remove('open');
            }
        });

        // Expose data reference for search
        // We'll hook into the data loading in app.js
        setTimeout(function () {
            if (typeof data !== 'undefined') window._v8Data = data;
        }, 1000);

        // Startup toasts
        setTimeout(function () {
            _showStartupAlerts();
        }, 1500);
    });

    // ── v22: Active bottom nav indicator ──
    (function _initBottomNavActive() {
        var path = window.location.pathname;
        document.querySelectorAll('.mobile-bottom-nav a').forEach(function (a) {
            if (a.getAttribute('href') === path) a.classList.add('active');
        });
    })();

    // ── v22: Centralized SW registration + update toast ──
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/static/sw.js').then(function (reg) {
            reg.addEventListener('updatefound', function () {
                var newWorker = reg.installing;
                if (!newWorker) return;
                newWorker.addEventListener('statechange', function () {
                    if (newWorker.state === 'activated' && navigator.serviceWorker.controller) {
                        if (window.showToast) {
                            window.showToast('Nouvelle version disponible — rechargez la page.', 'info', 8000);
                        }
                    }
                });
            });
        }).catch(function () { /* SW registration failed — silent */ });
    }

    // ── v22: Global error state helper ──
    window.showErrorState = function (containerId, message, retryFn) {
        var el = document.getElementById(containerId);
        if (!el) return;
        el.innerHTML =
            '<div class="error-state">' +
            '<div class="error-state-icon">&#x26A0;&#xFE0F;</div>' +
            '<div class="error-state-msg">' + (message || 'Erreur de chargement') + '</div>' +
            (retryFn ? '<button class="btn btn-secondary btn-sm error-retry-btn">Réessayer</button>' : '') +
            '</div>';
        if (retryFn) {
            var btn = el.querySelector('.error-retry-btn');
            if (btn) btn.addEventListener('click', retryFn);
        }
    };

    // ── v22: Haptic feedback helper ──
    window.haptic = function (ms) {
        if (navigator.vibrate) navigator.vibrate(ms || 10);
    };

    function _showStartupAlerts() {
        // Only on main page
        if (document.body.getAttribute('data-page') !== 'prospects') return;
        fetch('/api/dashboard')
            .then(function (r) { return r.json(); })
            .then(function (json) {
                var d = json.data || {};
                var overdue = (d.followup || {}).overdue || 0;
                var rdvToday = ((d.upcoming_rdv || []).filter(function (r) {
                    return (r.rdvDate || '').slice(0, 10) === new Date().toISOString().slice(0, 10);
                })).length;

                if (rdvToday > 0) {
                    window.showToast('🤝 ' + rdvToday + ' RDV aujourd\'hui !', 'success', 5000);
                }
                if (overdue > 0) {
                    setTimeout(function () {
                        window.showToast('⚠️ ' + overdue + ' relances en retard', 'warning', 5000);
                    }, 800);
                }
            })
            .catch(function () { /* silent */ });
    }

    // ────────────── v23.5: SWIPE-TO-ACTION (mobile) ──────────────

    function _initSwipeActions() {
        if (!window.matchMedia('(max-width: 768px)').matches) return;
        var swipeStartX = 0, swipeStartY = 0, swipeRow = null, swipeOverlay = null;
        var THRESHOLD = 70;

        document.addEventListener('touchstart', function (e) {
            var row = e.target.closest('tr[data-id]');
            if (!row) return;
            swipeRow = row;
            swipeStartX = e.touches[0].clientX;
            swipeStartY = e.touches[0].clientY;
        }, { passive: true });

        document.addEventListener('touchmove', function (e) {
            if (!swipeRow) return;
            var dx = e.touches[0].clientX - swipeStartX;
            var dy = e.touches[0].clientY - swipeStartY;
            if (Math.abs(dy) > Math.abs(dx)) { swipeRow = null; return; }
            if (Math.abs(dx) > 20) {
                swipeRow.style.transform = 'translateX(' + dx + 'px)';
                swipeRow.style.transition = 'none';
                if (!swipeOverlay) {
                    swipeOverlay = document.createElement('div');
                    swipeOverlay.className = 'swipe-action-overlay';
                    swipeOverlay.innerHTML = dx > 0
                        ? '<span class="swipe-action-icon swipe-call">📞</span>'
                        : '<span class="swipe-action-icon swipe-status">🔄</span>';
                    swipeRow.style.position = 'relative';
                    swipeRow.appendChild(swipeOverlay);
                } else {
                    swipeOverlay.innerHTML = dx > 0
                        ? '<span class="swipe-action-icon swipe-call">📞</span>'
                        : '<span class="swipe-action-icon swipe-status">🔄</span>';
                }
            }
        }, { passive: true });

        document.addEventListener('touchend', function (e) {
            if (!swipeRow) return;
            var dx = e.changedTouches[0].clientX - swipeStartX;
            swipeRow.style.transform = '';
            swipeRow.style.transition = 'transform 0.2s ease';
            if (swipeOverlay) { swipeOverlay.remove(); swipeOverlay = null; }
            var pid = swipeRow.getAttribute('data-id');
            if (Math.abs(dx) > THRESHOLD && pid) {
                window.haptic(15);
                if (dx > 0) {
                    // Swipe right → quick call
                    var tel = swipeRow.querySelector('[data-field="telephone"]');
                    if (tel && tel.textContent.trim()) {
                        window.open('tel:' + tel.textContent.trim());
                    } else {
                        window.showToast('Pas de numéro de téléphone', 'warning', 2000);
                    }
                } else {
                    // Swipe left → cycle status
                    _cycleProspectStatus(pid);
                }
            }
            swipeRow = null;
        }, { passive: true });
    }

    function _cycleProspectStatus(pid) {
        var statuses = ['À contacter', 'Contacté', 'En discussion', 'Rendez-vous', 'Proposition', 'Gagné', 'Perdu'];
        var currentData = window._v8Data || (typeof data !== 'undefined' ? data : null);
        if (!currentData || !currentData.prospects) return;
        var prospect = currentData.prospects.find(function (p) { return String(p.id) === String(pid); });
        if (!prospect) return;
        var idx = statuses.indexOf(prospect.statut || '');
        var next = statuses[(idx + 1) % statuses.length];
        var oldStatut = prospect.statut;
        prospect.statut = next;

        fetch('/api/prospects/bulk-status-tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: [parseInt(pid)], statut: next })
        }).then(function (r) { return r.json(); }).then(function (json) {
            if (json.ok) {
                window.showToast('Statut → ' + next, 'success', 2000);
                if (typeof window.filterProspects === 'function') window.filterProspects();
                // Celebration for "Gagné"
                if (next === 'Gagné') _celebrate();
                // Push undo
                window.pushUndo('Statut ' + next + ' → ' + oldStatut, function () {
                    prospect.statut = oldStatut;
                    fetch('/api/prospects/bulk-status-tags', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ids: [parseInt(pid)], statut: oldStatut })
                    });
                    if (typeof window.filterProspects === 'function') window.filterProspects();
                });
            }
        });
    }

    // ────────────── v23.5: BREADCRUMBS ──────────────

    function _initBreadcrumbs() {
        var page = document.body.getAttribute('data-page');
        if (!page || page === 'login') return;
        var header = document.querySelector('.content-header') || document.querySelector('header');
        if (!header) return;

        var crumbs = [{ label: '🏠', href: '/dashboard' }];
        var pageMap = {
            'dashboard': { label: 'Dashboard' },
            'prospects': { label: 'Prospects' },
            'entreprises': { label: 'Entreprises' },
            'sourcing': { label: 'Sourcing' },
            'focus': { label: 'Focus' },
            'push': { label: 'Push' },
            'stats': { label: 'Statistiques' },
            'search': { label: 'Recherche' },
            'settings': { label: 'Paramètres' },
            'templates': { label: 'Templates' },
            'company': { label: 'Entreprise', parent: 'entreprises' },
            'candidate': { label: 'Candidat', parent: 'sourcing' },
            'duplicates': { label: 'Doublons' },
            'calendrier': { label: 'Calendrier' },
            'kpi': { label: 'KPI' },
            'help': { label: 'Aide' },
        };

        var info = pageMap[page];
        if (!info) return;
        if (info.parent && pageMap[info.parent]) {
            crumbs.push({ label: pageMap[info.parent].label, href: '/' + info.parent });
        }
        crumbs.push({ label: info.label });

        var nav = document.createElement('nav');
        nav.className = 'breadcrumbs';
        nav.setAttribute('aria-label', 'Fil d\'Ariane');
        nav.innerHTML = crumbs.map(function (c, i) {
            if (i === crumbs.length - 1) return '<span class="breadcrumb-current">' + c.label + '</span>';
            return '<a href="' + c.href + '" class="breadcrumb-link">' + c.label + '</a><span class="breadcrumb-sep">›</span>';
        }).join('');
        header.insertBefore(nav, header.firstChild);
    }

    // ────────────── v23.5: QUICK PREVIEW PANEL ──────────────

    window.openQuickPreview = function (prospectId) {
        var existing = document.getElementById('quickPreviewPanel');
        if (existing) existing.remove();

        var panel = document.createElement('div');
        panel.id = 'quickPreviewPanel';
        panel.className = 'quick-preview-panel';
        panel.innerHTML = '<div class="qp-header"><span class="qp-title">Chargement…</span><button class="qp-close" onclick="document.getElementById(\'quickPreviewPanel\').classList.add(\'qp-exit\');setTimeout(function(){var p=document.getElementById(\'quickPreviewPanel\');if(p)p.remove();},300)">×</button></div><div class="qp-body"><div class="skeleton-loader"></div></div>';
        document.body.appendChild(panel);
        requestAnimationFrame(function () { panel.classList.add('qp-open'); });

        // Load prospect data
        var currentData = window._v8Data || (typeof data !== 'undefined' ? data : null);
        if (!currentData) return;
        var prospect = (currentData.prospects || []).find(function (p) { return p.id === prospectId || String(p.id) === String(prospectId); });
        if (!prospect) { panel.querySelector('.qp-title').textContent = 'Non trouvé'; return; }
        var company = (currentData.companies || []).find(function (c) { return c.id === prospect.company_id; });

        var statusColors = {
            'À contacter': '#6366f1', 'Contacté': '#3b82f6', 'En discussion': '#f59e0b',
            'Rendez-vous': '#8b5cf6', 'Proposition': '#ec4899', 'Gagné': '#10b981', 'Perdu': '#ef4444'
        };
        var statusColor = statusColors[prospect.statut] || '#64748b';

        panel.querySelector('.qp-title').textContent = _escToastHtml(prospect.name || 'Sans nom');
        panel.querySelector('.qp-body').innerHTML =
            '<div class="qp-status" style="background:' + statusColor + '">' + _escToastHtml(prospect.statut || 'N/A') + '</div>' +
            (company ? '<div class="qp-field"><strong>🏢</strong> ' + _escToastHtml(company.groupe || '') + '</div>' : '') +
            (prospect.fonction ? '<div class="qp-field"><strong>💼</strong> ' + _escToastHtml(prospect.fonction) + '</div>' : '') +
            (prospect.email ? '<div class="qp-field"><strong>📧</strong> <a href="mailto:' + _escToastHtml(prospect.email) + '">' + _escToastHtml(prospect.email) + '</a></div>' : '') +
            (prospect.telephone ? '<div class="qp-field"><strong>📞</strong> <a href="tel:' + _escToastHtml(prospect.telephone) + '">' + _escToastHtml(prospect.telephone) + '</a></div>' : '') +
            (prospect.linkedin ? '<div class="qp-field"><strong>🔗</strong> <a href="' + _escToastHtml(prospect.linkedin) + '" target="_blank">LinkedIn</a></div>' : '') +
            (prospect.nextFollowUp ? '<div class="qp-field"><strong>📅</strong> Relance: ' + _escToastHtml(prospect.nextFollowUp.slice(0, 10)) + '</div>' : '') +
            (prospect.nextAction ? '<div class="qp-field"><strong>📝</strong> ' + _escToastHtml(prospect.nextAction) + '</div>' : '') +
            '<div class="qp-actions">' +
            '<a href="/?open=' + prospect.id + '" class="btn btn-primary btn-sm">Ouvrir la fiche</a>' +
            '</div>';
    };

    // ────────────── v23.5: CELEBRATIONS ──────────────

    function _celebrate() {
        var colors = ['#10b981', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444'];
        var container = document.createElement('div');
        container.className = 'confetti-container';
        container.setAttribute('aria-hidden', 'true');
        document.body.appendChild(container);
        for (var i = 0; i < 50; i++) {
            var confetti = document.createElement('div');
            confetti.className = 'confetti';
            confetti.style.left = Math.random() * 100 + '%';
            confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
            confetti.style.animationDelay = Math.random() * 0.5 + 's';
            confetti.style.animationDuration = (1.5 + Math.random()) + 's';
            container.appendChild(confetti);
        }
        setTimeout(function () { container.remove(); }, 3000);
        window.showToast('🎉 Prospect gagné ! Bravo !', 'success', 4000);
    }
    window._celebrate = _celebrate;

    // ────────────── v23.5: SKELETON LOADING ──────────────

    window.showSkeletonLoading = function (containerId, rows) {
        var el = document.getElementById(containerId);
        if (!el) return;
        rows = rows || 5;
        var html = '';
        for (var i = 0; i < rows; i++) {
            html += '<div class="skeleton-row"><div class="skeleton-cell" style="width:' + (30 + Math.random() * 40) + '%"></div><div class="skeleton-cell" style="width:' + (20 + Math.random() * 30) + '%"></div><div class="skeleton-cell" style="width:' + (15 + Math.random() * 25) + '%"></div></div>';
        }
        el.innerHTML = html;
    };

    // Patch init
    var _origInit = document.addEventListener;
    document.addEventListener('DOMContentLoaded', function () {
        _initSwipeActions();
        // Breadcrumbs désactivés (v25) : fil d'Ariane maison + page retiré à la demande
        // _initBreadcrumbs();
    });

})();
