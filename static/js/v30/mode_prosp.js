// Mode Prosp — Hybrid direction (v5)
// Layout: topbar + action rail (76px) + card pane + timeline éditoriale (340px) + command bar
// API layer inchangé — seule la présentation est refaite.

// ── Phone choice dropdown (fixed positioning) ──
window.mpTogglePhoneChoice = function (btn) {
    var dropdown = btn.nextElementSibling;
    if (!dropdown) return;
    var isVisible = dropdown.style.display === 'flex';
    if (isVisible) { dropdown.style.display = 'none'; return; }
    var rect = btn.getBoundingClientRect();
    var isMobile = window.innerWidth <= 600;
    if (!isMobile) {
        dropdown.style.position = 'fixed';
        dropdown.style.top = (rect.bottom + 4) + 'px';
        dropdown.style.left = Math.max(8, rect.right - 200) + 'px';
        dropdown.style.right = 'auto';
        dropdown.style.bottom = 'auto';
    }
    dropdown.style.display = 'flex';
    setTimeout(function () {
        document.addEventListener('click', function close(e) {
            if (!dropdown.contains(e.target) && e.target !== btn) {
                dropdown.style.display = 'none';
                document.removeEventListener('click', close);
            }
        });
    }, 0);
};

window.mpClose = function () {
    if (window.opener) { window.close(); }
    else if (history.length > 1) { history.back(); }
    else { window.location.href = '/'; }
};

window.mpOpenCandidats = function () {
    if (window.opener && !window.opener.closed) {
        window.opener.location.href = '/v30/sourcing';
        window.opener.focus();
    } else {
        window.open('/v30/sourcing', '_blank');
    }
};

window.mpToggleDarkMode = function () {
    var isDark = document.body.classList.toggle('mp-dark');
    try { localStorage.setItem('mp-dark', isDark ? '1' : '0'); } catch (_) {}
};

(function () {
    'use strict';

    var prospects = [];
    var companies = [];
    var currentIndex = 0;
    var saving = false;
    var navDir = 0; // +1=next, -1=prev, 0=init
    var token = '';
    var tlFilter = 'all'; // timeline filter
    var tlAllEvents = []; // cache for client-side filtering
    var noteType = 'note'; // selected type for quick note

    var viewport = document.getElementById('mpViewport');
    var prevBtn  = document.getElementById('mpPrev');
    var nextBtn  = document.getElementById('mpNext');

    function getToken() {
        return new URLSearchParams(location.search).get('t') || '';
    }
    function getIdsFromUrl() {
        var raw = new URLSearchParams(location.search).get('ids') || '';
        if (!raw) return [];
        return raw.split(',').map(function (s) { return parseInt(s.trim(), 10); }).filter(function (n) { return !isNaN(n) && n > 0; });
    }

    function escapeHtml(str) {
        var d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }
    function getCompany(id) {
        for (var i = 0; i < companies.length; i++) {
            if (companies[i].id === id) return companies[i];
        }
        return null;
    }

    // ── Status / color config ──
    var STATUS_OPTIONS = ["Pas d'actions", "Appelé", "À rappeler", "Rendez-vous", "Prospecté", "Messagerie", "Pas intéressé"];
    var STATUS_COLORS = {
        "Pas d'actions": '#64748b', "Appelé": '#f59e0b', 'Messagerie': '#5B3FBF',
        'À rappeler': '#ef4444', 'Rendez-vous': '#0F7B5C', "Prospecté": '#8b5cf6', "Pas intéressé": '#94a3b8'
    };
    var STATUS_BG = {
        "Messagerie": '#EFEAFB', "Rendez-vous": '#E3F2EC',
    };

    var PRIORITY_LABELS = { '1': 'haute', '2': 'normal', '3': 'basse' };

    // ── Timeline config ──
    var TL_LABELS = {
        call_note: "Note d'appel", push: 'Push', done: 'Fait', rdv: 'RDV',
        linkedin: 'LinkedIn', event: 'Événement', note_libre: 'Note', call: 'Appel sortant', status_change: 'Statut modifié', note: 'Note'
    };
    // Accent colors for editorial timeline (hex — used in inline border-left)
    var TL_COLORS = {
        call:         '#0F7B5C',
        call_note:    '#4B5FD6',
        push:         '#4B5FD6',
        done:         '#0F7B5C',
        rdv:          '#4B5FD6',
        linkedin:     '#0A66C2',
        note_libre:   '#4B5FD6',
        event:        '#4B5FD6',
        note:         '#4B5FD6',
        status_change:'#5B3FBF',
    };
    // Filter mapping: which event types belong to each filter tab
    var TL_FILTER_MAP = {
        all:  null, // show all
        call: ['call', 'call_note'],
        mail: ['push'],
        note: ['note_libre', 'note', 'event'],
    };

    // ── Date helpers ──
    var MONTHS_FR = ['jan','fév','mar','avr','mai','juin','juil','août','sep','oct','nov','déc'];
    function formatTlDate(isoDate) {
        if (!isoDate) return '';
        var parts = isoDate.split('-');
        if (parts.length < 3) return isoDate.slice(0, 10);
        var m = parseInt(parts[1], 10) - 1;
        var d = parseInt(parts[2], 10);
        return d + ' ' + (MONTHS_FR[m] || parts[1]);
    }
    function formatLastContact(isoStr) {
        if (!isoStr) return '';
        var day = formatTlDate(isoStr.slice(0, 10));
        var time = isoStr.slice(11, 16);
        return day + (time ? ' · ' + time : '');
    }
    function formatRelativeModified(isoStr) {
        if (!isoStr) return '';
        var diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
        if (diff < 60) return 'à l\'instant';
        if (diff < 3600) return 'il y a ' + Math.floor(diff / 60) + ' min';
        if (diff < 86400) return 'il y a ' + Math.floor(diff / 3600) + 'h';
        var d = Math.floor(diff / 86400);
        return 'il y a ' + d + ' jour' + (d > 1 ? 's' : '');
    }
    function splitName(fullName) {
        var parts = (fullName || '').trim().split(/\s+/);
        if (parts.length <= 1) return { prenom: fullName || '', nom: '' };
        var nom = parts.pop();
        return { prenom: parts.join(' '), nom: nom };
    }

    // ── Selection badge ──
    function showSelectionBadge(count) {
        var existing = document.getElementById('mpSelBadge');
        if (existing) existing.remove();
        if (!count || count <= 0) return;
        var badge = document.createElement('span');
        badge.id = 'mpSelBadge';
        badge.className = 'mp-sel-badge';
        badge.textContent = count + ' prospect' + (count > 1 ? 's' : '') + ' sélectionné' + (count > 1 ? 's' : '');
        var nav = document.getElementById('mpTopbarNav');
        if (nav) nav.appendChild(badge);
    }

    // ── Init ──
    async function init() {
        token = getToken();
        var directIds = getIdsFromUrl();

        if (!token && directIds.length > 0) {
            viewport.innerHTML = '<div class="mp-empty-state">Chargement...</div>';
            try {
                var startRes = await fetch('/api/mode-prosp/start', {
                    method: 'POST', credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids: directIds }),
                });
                if (!startRes.ok) throw new Error('HTTP ' + startRes.status);
                var startPayload = await startRes.json();
                if (!startPayload.ok || !startPayload.token) throw new Error(startPayload.error || 'Token manquant');
                token = startPayload.token;
                var newUrl = location.pathname + '?t=' + encodeURIComponent(token) + '&ids=' + directIds.join(',');
                try { history.replaceState(null, '', newUrl); } catch (_) {}
            } catch (e) {
                viewport.innerHTML = '<div class="mp-empty-state">Erreur lors du démarrage : ' + escapeHtml(e.message) + '</div>';
                return;
            }
        }

        if (!token) {
            viewport.innerHTML = '<div class="mp-empty-state">Aucun prospect transmis. Retournez sur la page Prospects et relancez le Mode Prosp.</div>';
            return;
        }
        viewport.innerHTML = '<div class="mp-empty-state">Chargement...</div>';
        try {
            var res = await fetch('/api/mode-prosp/data?t=' + encodeURIComponent(token));
            if (!res.ok) {
                if (res.status === 401) {
                    viewport.innerHTML = '<div class="mp-empty-state">Session expirée. Retournez sur la page Prospects et relancez le Mode Prosp.</div>';
                } else { throw new Error('HTTP ' + res.status); }
                return;
            }
            var payload = await res.json();
            if (!payload.ok) { viewport.innerHTML = '<div class="mp-empty-state">' + escapeHtml(payload.error || 'Erreur') + '</div>'; return; }
            prospects = Array.isArray(payload.prospects) ? payload.prospects : [];
            companies = Array.isArray(payload.companies) ? payload.companies : [];
        } catch (e) {
            viewport.innerHTML = '<div class="mp-empty-state">Erreur de chargement. Vérifiez votre connexion.</div>';
            return;
        }
        if (prospects.length === 0) { viewport.innerHTML = '<div class="mp-empty-state">Aucun prospect trouvé.</div>'; return; }

        if (directIds.length > 0) showSelectionBadge(prospects.length);

        renderCurrentCard();
        updateUI();
        setupKeyboard();
        setupSwipe();
        setupVisibilitySync();
    }

    // ── Custom select helpers (inchangés) ──
    function mpBuildSelect(field, options, selected, extraClass, inlineStyle) {
        var selStr = String(selected !== null && selected !== undefined ? selected : '');
        var selectedLabel = '';
        for (var i = 0; i < options.length; i++) {
            if (String(options[i].value) === selStr) { selectedLabel = options[i].label; break; }
        }
        if (!selectedLabel && options.length > 0) selectedLabel = options[0].label;
        var optHtml = options.map(function (o) {
            var isSel = String(o.value) === selStr;
            return '<button type="button" class="mp-select-option popover__item' + (isSel ? ' is-selected' : '') + '" data-val="' + escapeHtml(String(o.value)) + '">' + escapeHtml(o.label) + '</button>';
        }).join('');
        var cls = 'mp-select' + (extraClass ? ' ' + extraClass : '');
        var styleAttr = inlineStyle ? ' style="' + inlineStyle + '"' : '';
        return '<div class="' + cls + '" data-field="' + field + '" data-value="' + escapeHtml(selStr) + '"' + styleAttr + '>' +
            '<button type="button" class="mp-select-trigger" aria-haspopup="listbox" aria-expanded="false">' +
                '<span class="mp-select-label">' + escapeHtml(selectedLabel) + '</span>' +
                '<svg class="mp-select-chevron" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>' +
            '</button>' +
            '<div class="mp-select-dropdown popover" hidden role="listbox">' + optHtml + '</div>' +
        '</div>';
    }

    function _closeAllSelects() {
        document.querySelectorAll('.mp-select-dropdown:not([hidden])').forEach(function (d) {
            d.hidden = true;
            var t = d.previousElementSibling;
            if (t) t.setAttribute('aria-expanded', 'false');
        });
    }

    function _openSelect(sel, trigger, dropdown) {
        dropdown.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        var rect = trigger.getBoundingClientRect();
        dropdown.style.top = (rect.bottom + 3) + 'px';
        dropdown.style.left = rect.left + 'px';
        dropdown.style.minWidth = rect.width + 'px';
        requestAnimationFrame(function () {
            var dRect = dropdown.getBoundingClientRect();
            if (dRect.right > window.innerWidth - 8)
                dropdown.style.left = Math.max(8, window.innerWidth - dRect.width - 8) + 'px';
            if (dRect.bottom > window.innerHeight - 8)
                dropdown.style.top = Math.max(8, rect.top - dRect.height - 3) + 'px';
            var selOpt = dropdown.querySelector('.mp-select-option.is-selected');
            if (selOpt) selOpt.scrollIntoView({ block: 'nearest' });
        });
    }

    function mpInitSelects(root) {
        root.querySelectorAll('.mp-select').forEach(function (sel) {
            var trigger  = sel.querySelector('.mp-select-trigger');
            var dropdown = sel.querySelector('.mp-select-dropdown');
            if (!trigger || !dropdown) return;

            trigger.addEventListener('click', function (e) {
                e.stopPropagation();
                var isOpen = !dropdown.hidden;
                _closeAllSelects();
                if (!isOpen) _openSelect(sel, trigger, dropdown);
            });
            dropdown.querySelectorAll('.mp-select-option').forEach(function (opt) {
                opt.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var val = this.dataset.val;
                    sel.dataset.value = val;
                    trigger.querySelector('.mp-select-label').textContent = this.textContent;
                    dropdown.querySelectorAll('.mp-select-option').forEach(function (o) {
                        o.classList.toggle('is-selected', o.dataset.val === val);
                    });
                    dropdown.hidden = true;
                    trigger.setAttribute('aria-expanded', 'false');
                    sel.dispatchEvent(new CustomEvent('change', { bubbles: true, detail: { value: val } }));
                });
            });
            trigger.addEventListener('keydown', function (e) {
                if (e.key === 'Escape')  { dropdown.hidden = true; trigger.setAttribute('aria-expanded', 'false'); trigger.focus(); }
                else if ((e.key === 'Enter' || e.key === ' ') && dropdown.hidden) { e.preventDefault(); trigger.click(); }
                else if (e.key === 'ArrowDown' && !dropdown.hidden) { e.preventDefault(); var f = dropdown.querySelector('.mp-select-option'); if (f) f.focus(); }
            });
            dropdown.addEventListener('keydown', function (e) {
                var opts = Array.from(dropdown.querySelectorAll('.mp-select-option'));
                var idx  = opts.indexOf(document.activeElement);
                if (e.key === 'ArrowDown')  { e.preventDefault(); if (idx < opts.length - 1) opts[idx + 1].focus(); }
                else if (e.key === 'ArrowUp')   { e.preventDefault(); if (idx > 0) opts[idx - 1].focus(); else { dropdown.hidden = true; trigger.setAttribute('aria-expanded', 'false'); trigger.focus(); } }
                else if (e.key === 'Escape') { dropdown.hidden = true; trigger.setAttribute('aria-expanded', 'false'); trigger.focus(); }
            });
        });
    }
    document.addEventListener('click', _closeAllSelects);

    // ── Keyboard-shortcut tooltips ──
    var _tipEl = null, _tipTimer = null;
    function _getTipEl() {
        if (!_tipEl) { _tipEl = document.createElement('div'); _tipEl.className = 'mp-kbd-tip'; document.body.appendChild(_tipEl); }
        return _tipEl;
    }
    function _showTip(el, key) {
        clearTimeout(_tipTimer);
        _tipTimer = setTimeout(function () {
            var tip = _getTipEl();
            tip.textContent = key; tip.classList.remove('is-visible');
            tip.style.visibility = 'hidden'; tip.classList.add('is-visible');
            var rect = el.getBoundingClientRect();
            var tipW = tip.offsetWidth, tipH = tip.offsetHeight;
            var top = rect.bottom + 5;
            if (top + tipH > window.innerHeight - 6) top = rect.top - tipH - 5;
            var left = rect.left + rect.width / 2 - tipW / 2;
            left = Math.max(4, Math.min(left, window.innerWidth - tipW - 4));
            tip.style.top = top + 'px'; tip.style.left = left + 'px'; tip.style.visibility = '';
        }, 600);
    }
    function _hideTip() { clearTimeout(_tipTimer); if (_tipEl) _tipEl.classList.remove('is-visible'); }

    function mpInitTooltips(root) {
        var pairs = [
            { selector: '.mp-hd-call',                         key: 'C' },
            { selector: '.mp-hd-email',                        key: 'M' },
            { selector: '.mp-status-select .mp-select-trigger', key: 'S' },
            { selector: '.mp-save-btn',                        key: '↵' },
        ];
        pairs.forEach(function (p) {
            var el = root.querySelector(p.selector);
            if (!el) return;
            el.addEventListener('mouseenter', function () { _showTip(el, p.key); });
            el.addEventListener('mouseleave', _hideTip);
        });
        [{ id: 'mpPrev', key: '←' }, { id: 'mpNext', key: '→' }].forEach(function (a) {
            var el = document.getElementById(a.id);
            if (!el || el.dataset.tipBound) return;
            el.dataset.tipBound = '1';
            el.addEventListener('mouseenter', function () { _showTip(el, a.key); });
            el.addEventListener('mouseleave', _hideTip);
        });
    }

    // ── Star SVG helper ──
    function starSvg(filled) {
        var fill   = filled ? '#B5803A' : 'none';
        var stroke = filled ? '#B5803A' : '#D4CFC0';
        return '<svg class="mp-star-icon" width="13" height="13" viewBox="0 0 24 24" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.5" aria-hidden="true">' +
               '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
    }

    // ── Build the per-prospect HTML ──
    function buildCardHtml(p) {
        var company    = getCompany(p.company_id);
        var companyName = company ? (company.groupe || '') + (company.site ? ' (' + company.site + ')' : '') : '';
        var pert       = Math.min(5, Math.max(0, parseInt(p.pertinence, 10) || 3));
        var heroColor  = STATUS_COLORS[p.statut] || '#64748b';
        var name       = splitName(p.name);
        var initials   = ((name.prenom ? name.prenom[0] : '') + (name.nom ? name.nom[0] : '')).toUpperCase() || '??';
        var priorityNum = 'P' + (p.priority || '2');
        var priorityLbl = PRIORITY_LABELS[String(p.priority || '2')] || 'normal';
        var lastContactStr = formatLastContact(p.lastContact || '');
        var modifiedStr = p.updated_at ? formatRelativeModified(p.updated_at) : '';

        // Avatar
        var photoUrl = p.photo_url ? '/api/photos/prospect/' + p.id : '';
        var avatarHtml = photoUrl
            ? '<img class="mp-avatar-img" src="' + photoUrl + '" alt="' + escapeHtml(initials) + '" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';" />' +
              '<div class="mp-avatar" style="background:' + heroColor + ';display:none;">' + escapeHtml(initials) + '</div>'
            : '<div class="mp-avatar" style="background:' + heroColor + ';">' + escapeHtml(initials) + '</div>';

        // Phone numbers
        var phoneNumbers = [];
        if (p.telephone) {
            phoneNumbers = p.telephone.split(/[/;,]/).map(function (n) { return n.trim(); }).filter(Boolean);
        }

        // Header action buttons (Appeler / Email / LinkedIn / IA)
        var callBtnHtml = '';
        if (phoneNumbers.length === 1) {
            callBtnHtml = '<a href="tel:' + escapeHtml(phoneNumbers[0].replace(/\s/g, '')) + '" class="mp-hd-btn mp-hd-call" onclick="mpLogCall(' + p.id + ')">' +
                '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>' +
                'Appeler<kbd>C</kbd></a>';
        } else if (phoneNumbers.length > 1) {
            callBtnHtml = '<div style="position:relative;">' +
                '<button type="button" class="mp-hd-btn mp-hd-call" onclick="mpTogglePhoneChoice(this)">' +
                '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>' +
                'Appeler<kbd>C</kbd></button>' +
                '<div class="popover mp-phone-choice" style="display:none;">' +
                phoneNumbers.map(function (num) {
                    return '<a href="tel:' + escapeHtml(num.replace(/\s/g, '')) + '" class="popover__item" onclick="mpLogCall(' + p.id + ')">📞 ' + escapeHtml(num) + '</a>';
                }).join('') + '</div></div>';
        }

        var emailBtnHtml = p.email
            ? '<button type="button" class="mp-hd-btn mp-hd-email" onclick="window.V30PushModal && window.V30PushModal.open(' + p.id + ', \'email\')">' +
              '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>' +
              'Email<kbd>M</kbd></button>'
            : '';

        var linkedinBtnHtml = p.linkedin
            ? '<a href="' + escapeHtml(p.linkedin) + '" target="_blank" rel="noopener" class="mp-hd-btn mp-hd-linkedin">' +
              '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4.98 3.5C4.98 4.88 3.87 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1s2.48 1.12 2.48 2.5zM5 8H0v15h5V8zm7.98 0H8.02v15h4.96v-7.88c0-4.62 6-5 6 0V23H24v-9.62c0-7.71-8.79-7.43-11.02-3.64V8z"/></svg>' +
              'LinkedIn</a>'
            : '';

        var iaBtnHtml = '<a href="/v30/prospect/' + p.id + '?ia=scrap" target="_blank" rel="noopener" class="mp-hd-btn mp-hd-primary">' +
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></svg>' +
            'Demander à l\'IA</a>';

        // Status badge colors
        var badgeBg    = STATUS_BG[p.statut] || heroColor + '22';
        var badgeFg    = (STATUS_BG[p.statut] && p.statut === 'Messagerie') ? '#5B3FBF'
                       : (STATUS_BG[p.statut] && p.statut === 'Rendez-vous') ? '#0F7B5C'
                       : heroColor;

        // Stars
        var starsHtml = '';
        for (var si = 1; si <= 5; si++) { starsHtml += starSvg(si <= pert); }

        // Inline phone hint
        var phoneHintHtml = '';
        if (phoneNumbers.length === 1) {
            phoneHintHtml = '<a href="tel:' + escapeHtml(phoneNumbers[0].replace(/\s/g, '')) + '" class="mp-field-hint" onclick="mpLogCall(' + p.id + ')">↗ Composer ' + escapeHtml(phoneNumbers[0]) + '</a>';
        } else if (phoneNumbers.length > 1) {
            phoneHintHtml = phoneNumbers.map(function (n) {
                return '<a href="tel:' + escapeHtml(n.replace(/\s/g, '')) + '" class="mp-action-link" onclick="mpLogCall(' + p.id + ')">📞 ' + escapeHtml(n) + '</a>';
            }).join(' ');
        }

        // Status select
        var statusOptions = STATUS_OPTIONS.map(function (s) { return { value: s, label: s }; });
        var statusColorVar = '--status-color:' + heroColor + ';';
        var companyOptions = companies.map(function (c) {
            return { value: c.id, label: (c.groupe || '') + (c.site ? ' (' + c.site + ')' : '') };
        });
        var pertOptions = [5, 4, 3, 2, 1].map(function (v) { return { value: v, label: '⭐'.repeat(v) }; });
        var priorityOptions = [{ value: '1', label: 'P1 (haute)' }, { value: '2', label: 'P2 (normal)' }, { value: '3', label: 'P3 (basse)' }];

        // ── CARD PANE ──
        var cardPane =
            '<div class="mp-card-pane">' +
              '<div class="mp-folder-tabs">' +
                '<div class="mp-folder-tab">Fiche · #' + (currentIndex + 1) + '</div>' +
              '</div>' +
              '<div class="mp-card">' +

                // HEADER
                '<div class="mp-card-head">' +
                  '<div class="mp-head-row">' +
                    '<div style="overflow:hidden;">' + avatarHtml + '</div>' +
                    '<div class="mp-identity">' +
                      '<div class="mp-eyebrow">' + escapeHtml(p.fonction || '') + '</div>' +
                      '<h1 class="mp-prospect-name">' + escapeHtml(name.prenom) + (name.nom ? ' <em>' + escapeHtml(name.nom) + '</em>' : '') + '</h1>' +
                      (companyName ? '<div class="mp-company-line"><em>' + escapeHtml(companyName) + '</em></div>' : '') +
                    '</div>' +
                    '<div class="mp-hd-actions">' +
                      callBtnHtml + emailBtnHtml + linkedinBtnHtml + iaBtnHtml +
                    '</div>' +
                  '</div>' +
                  // STATUS ROW
                  '<div class="mp-stat-row">' +
                    '<div class="mp-stat-group">' +
                      '<span class="mp-stat-lbl">Statut</span>' +
                      '<span class="mp-stat-badge js-stat-badge" style="background:' + badgeBg + ';color:' + badgeFg + ';">' +
                        '<span class="mp-stat-badge-dot"></span>' + escapeHtml(p.statut || '') +
                      '</span>' +
                    '</div>' +
                    '<div class="mp-stat-div"></div>' +
                    '<div class="mp-stat-group">' +
                      '<span class="mp-stat-lbl">Pertinence</span>' +
                      '<div class="mp-stars">' + starsHtml + '</div>' +
                    '</div>' +
                    '<div class="mp-stat-div"></div>' +
                    '<div class="mp-stat-group">' +
                      '<span class="mp-stat-lbl">Priorité</span>' +
                      '<span class="mp-priority-val">' + escapeHtml(priorityNum) + '</span>' +
                      '<span class="mp-priority-lbl">' + escapeHtml(priorityLbl) + '</span>' +
                    '</div>' +
                    '<div class="mp-stat-flex"></div>' +
                    (lastContactStr ? '<div class="mp-last-contact-txt">Dernier contact <span>' + escapeHtml(lastContactStr) + '</span></div>' : '') +
                  '</div>' +
                '</div>' + // /.mp-card-head

                // FORM BODY
                '<div class="mp-card-body" data-pid="' + p.id + '">' +

                  // 3-col row 1: Statut, Entreprise, Fonction
                  // 3-col row 2: Téléphone, Email, LinkedIn
                  '<div class="mp-form-grid-3">' +
                    mpField('Statut', mpBuildSelect('statut', statusOptions, p.statut, 'mp-status-select', statusColorVar)) +
                    mpField('Entreprise', mpBuildSelect('company_id', companyOptions, p.company_id)) +
                    mpField('Fonction', '<input type="text" class="mp-input" data-field="fonction" value="' + escapeHtml(p.fonction || '') + '">') +
                    mpField('Téléphone',
                        '<input type="text" class="mp-input" data-field="telephone" value="' + escapeHtml(p.telephone || '') + '">' +
                        (phoneHintHtml ? '<div class="mp-phone-links" style="margin-top:3px;">' + phoneHintHtml + '</div>' : '')) +
                    mpField('Email',
                        '<input type="email" class="mp-input" data-field="email" value="' + escapeHtml(p.email || '') + '">' +
                        (p.email ? '<a href="mailto:' + escapeHtml(p.email) + '" class="mp-field-hint">↗ Envoyer à ' + escapeHtml(p.email) + '</a>' : '')) +
                    mpField('LinkedIn',
                        '<input type="text" class="mp-input" data-field="linkedin" value="' + escapeHtml(p.linkedin || '') + '">' +
                        (p.linkedin ? '<a href="' + escapeHtml(p.linkedin) + '" target="_blank" rel="noopener" class="mp-field-hint">↗ Voir le profil</a>' : '')) +
                  '</div>' +

                  '<div class="mp-form-divider"></div>' +

                  // 4-col: Next action, Relance, Date RDV, Dernier contact
                  '<div class="mp-form-grid-4">' +
                    mpField('Next action', '<input type="text" class="mp-input" data-field="nextAction" value="' + escapeHtml(p.nextAction || '') + '" placeholder="ex. Relancer mardi 14h">') +
                    mpField('Relance', '<input type="date" class="mp-input" data-field="nextFollowUp" value="' + escapeHtml(p.nextFollowUp || '') + '">') +
                    mpField('Date RDV', '<input type="datetime-local" class="mp-input" data-field="rdvDate" value="' + escapeHtml(p.rdvDate || '') + '">') +
                    mpField('Dernier contact', '<input type="datetime-local" class="mp-input" data-field="lastContact" value="' + escapeHtml((p.lastContact || '').slice(0, 16)) + '">') +
                  '</div>' +

                  '<div class="mp-form-divider"></div>' +

                  // 2-col: Pertinence, Priorité + Notes inline
                  '<div class="mp-form-grid-2">' +
                    mpField('Pertinence', mpBuildSelect('pertinence', pertOptions, pert)) +
                    mpField('Priorité', mpBuildSelect('priority', priorityOptions, String(p.priority || '2'))) +
                  '</div>' +
                  '<div style="margin-top:10px;">' +
                    mpField('Notes', '<textarea class="mp-input" data-field="notes" rows="2">' + escapeHtml(p.notes || '') + '</textarea>') +
                  '</div>' +

                  // Footer
                  '<div class="mp-card-foot">' +
                    (modifiedStr ? '<span class="mp-modified-txt">Modifié <span>' + escapeHtml(modifiedStr) + '</span></span>' : '<span></span>') +
                    '<div class="mp-foot-actions">' +
                      '<button type="button" class="mp-btn-cancel" onclick="mpCancelCard()">Annuler</button>' +
                      '<button type="button" class="mp-save-btn" onclick="mpSaveCard()">Enregistrer<kbd>↵</kbd></button>' +
                    '</div>' +
                  '</div>' +

                '</div>' + // /.mp-card-body
              '</div>' + // /.mp-card
            '</div>'; // /.mp-card-pane

        // ── TIMELINE PANEL ──
        var timelinePanel =
            '<div class="mp-card-timeline">' +
              '<div class="mp-tl-header">' +
                '<div class="mp-tl-title-row">' +
                  '<span class="mp-tl-label-sm">Journal</span>' +
                  '<span class="mp-tl-count" id="mpTlCount"></span>' +
                '</div>' +
                '<h3 class="mp-tl-heading">Notes &amp; <em>activité</em></h3>' +
                '<div class="mp-tl-filters" id="mpTlFilters">' +
                  ['all', 'call', 'mail', 'note'].map(function (f) {
                      var labels = { all: 'Tout', call: 'Appels', mail: 'Mails', note: 'Notes' };
                      return '<button type="button" class="mp-tl-filter' + (f === tlFilter ? ' is-active' : '') + '" data-filter="' + f + '" onclick="mpSetTlFilter(\'' + f + '\')">' + labels[f] + '</button>';
                  }).join('') +
                '</div>' +
              '</div>' +

              '<div class="mp-tl-add">' +
                '<div class="mp-tl-add-box">' +
                  '<input type="text" class="mp-quick-note-input" id="mpTlInput" placeholder="Note rapide…">' +
                  '<div class="mp-tl-add-footer">' +
                    '<div class="mp-tl-type-btns">' +
                      [
                        { type: 'call', icon: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>', title: 'Appel' },
                        { type: 'mail', icon: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>', title: 'Email' },
                        { type: 'rdv',  icon: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>', title: 'RDV' },
                        { type: 'note', icon: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>', title: 'Note' },
                      ].map(function (b) {
                          return '<button type="button" class="mp-tl-type-btn' + (b.type === noteType ? ' is-active' : '') + '" data-note-type="' + b.type + '" title="' + b.title + '" onclick="mpSetNoteType(\'' + b.type + '\')">' + b.icon + '</button>';
                      }).join('') +
                    '</div>' +
                    '<button type="button" class="mp-tl-add-btn" onclick="mpAddNote()">Ajouter</button>' +
                  '</div>' +
                '</div>' +
              '</div>' +

              '<div class="mp-tl-feed" id="mpTlFeed">' +
                '<div class="mp-tl-empty">Chargement…</div>' +
              '</div>' +
            '</div>'; // /.mp-card-timeline

        return cardPane + timelinePanel;
    }

    function mpField(label, inputHtml) {
        return '<div class="mp-field"><label class="mp-label">' + label + '</label>' + inputHtml + '</div>';
    }

    // ── Render current card ──
    function renderCurrentCard() {
        var p = prospects[currentIndex];
        if (!p) return;

        var wrapper = document.createElement('div');
        wrapper.className = 'mp-content-area';
        if (navDir > 0)      wrapper.classList.add('mp-entering-next');
        else if (navDir < 0) wrapper.classList.add('mp-entering-prev');
        else                 wrapper.classList.add('mp-entering-init');
        navDir = 0;

        wrapper.innerHTML = buildCardHtml(p);
        viewport.innerHTML = '';
        viewport.appendChild(wrapper);

        wrapper.addEventListener('animationend', function () {
            wrapper.classList.remove('mp-entering-next', 'mp-entering-prev', 'mp-entering-init');
        }, { once: true });

        _hideTip();
        mpInitSelects(wrapper);
        mpInitTooltips(wrapper);

        // Status change → update badge + date picker
        var statusSelect = wrapper.querySelector('[data-field="statut"]');
        if (statusSelect) {
            statusSelect.addEventListener('change', function (e) {
                var newVal = e.detail ? e.detail.value : statusSelect.dataset.value;
                var color  = STATUS_COLORS[newVal] || '#64748b';
                statusSelect.style.setProperty('--status-color', color);

                var badge  = wrapper.querySelector('.js-stat-badge');
                if (badge) {
                    var bg = STATUS_BG[newVal] || color + '22';
                    var fg = (newVal === 'Messagerie') ? '#5B3FBF' : (newVal === 'Rendez-vous') ? '#0F7B5C' : color;
                    badge.style.background = bg;
                    badge.style.color = fg;
                    var dot = badge.querySelector('.mp-stat-badge-dot');
                    badge.textContent = '';
                    if (dot) badge.appendChild(dot);
                    badge.appendChild(document.createTextNode(newVal));
                }

                if (newVal === 'Rendez-vous') {
                    var rdvInput = wrapper.querySelector('[data-field="rdvDate"]');
                    mpShowDatePicker({
                        title: 'Date du rendez-vous',
                        subtitle: 'Choisissez la date et l\'heure du RDV avec ce prospect.',
                        type: 'datetime-local',
                        currentValue: rdvInput ? rdvInput.value : '',
                        onConfirm: function (val) { if (rdvInput && val) rdvInput.value = val; }
                    });
                } else if (newVal === 'À rappeler') {
                    var relInput = wrapper.querySelector('[data-field="nextFollowUp"]');
                    mpShowDatePicker({
                        title: 'Date de relance',
                        subtitle: 'Choisissez quand rappeler ce prospect.',
                        type: 'date',
                        currentValue: relInput ? relInput.value : '',
                        onConfirm: function (val) { if (relInput && val) relInput.value = val; }
                    });
                }
            });
        }

        // Quick note Enter key
        var quickInput = document.getElementById('mpTlInput');
        if (quickInput) {
            quickInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); mpAddNote(); }
            });
        }

        mpLoadTimeline(p.id);
    }

    // ── Timeline filter ──
    window.mpSetTlFilter = function (filter) {
        tlFilter = filter;
        // Update active button
        var filters = document.querySelectorAll('.mp-tl-filter');
        filters.forEach(function (btn) {
            btn.classList.toggle('is-active', btn.dataset.filter === filter);
        });
        // Re-render with cached events
        renderTlFeed(tlAllEvents);
    };

    // ── Note type selector ──
    window.mpSetNoteType = function (type) {
        noteType = type;
        var btns = document.querySelectorAll('.mp-tl-type-btn');
        btns.forEach(function (btn) {
            btn.classList.toggle('is-active', btn.dataset.noteType === type);
        });
    };

    // ── Timeline loading ──
    function renderTlFeed(events) {
        var feed = document.getElementById('mpTlFeed');
        if (!feed) return;
        var allowed = TL_FILTER_MAP[tlFilter];
        var filtered = allowed ? events.filter(function (e) { return allowed.indexOf(e.type) >= 0; }) : events;
        if (filtered.length === 0) {
            feed.innerHTML = '<div class="mp-tl-empty">' + (tlFilter === 'all' ? 'Aucune note ou activité' : 'Aucun événement dans ce filtre') + '</div>';
            return;
        }
        feed.innerHTML = filtered.map(function (e) { return mpRenderTlItem(e); }).join('');

        var countEl = document.getElementById('mpTlCount');
        if (countEl) {
            var n = events.length;
            countEl.textContent = n + ' événement' + (n > 1 ? 's' : '');
        }
    }

    function mpLoadTimeline(prospectId) {
        var feed = document.getElementById('mpTlFeed');
        if (!feed) return;
        feed.innerHTML = '<div class="mp-tl-empty">Chargement…</div>';
        fetch('/api/prospect/timeline?id=' + prospectId, { credentials: 'include' })
            .then(function (res) { return res.ok ? res.json() : Promise.reject('err'); })
            .then(function (payload) {
                var events = Array.isArray(payload.events) ? payload.events : [];
                events.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
                tlAllEvents = events;
                renderTlFeed(events);
            })
            .catch(function () {
                var feed2 = document.getElementById('mpTlFeed');
                if (feed2) feed2.innerHTML = '<div class="mp-tl-empty">Timeline non disponible</div>';
            });
    }
    window.mpLoadTimeline = mpLoadTimeline;

    // ── Editorial timeline item ──
    function mpRenderTlItem(event) {
        var type       = event.type || 'event';
        var color      = TL_COLORS[type] || '#A0A29E';
        var label      = TL_LABELS[type] || type;
        var rawDate    = event.date || '';
        var dayStr     = formatTlDate(rawDate.slice(0, 10));
        var timeStr    = rawDate.slice(11, 16);
        var rawContent = event.content || '';
        var content    = escapeHtml(rawContent).replace(/\n/g, '<br>');
        var source     = event.source || '';
        var ref        = source === 'event' ? event.id : (source === 'note' ? event.note_index : '');
        var canEdit    = (source === 'event' || source === 'note') && (ref !== '' && ref !== null && ref !== undefined);
        var attrs      = canEdit
            ? ' data-mp-tl="1" data-source="' + escapeHtml(source) + '" data-ref="' + escapeHtml(String(ref)) + '" data-raw-content="' + escapeHtml(rawContent) + '"'
            : '';
        var actions = canEdit
            ? '<div class="mp-tl-actions">' +
                '<button type="button" class="mp-tl-act mp-tl-act-edit" title="Modifier" onclick="mpEditTlItem(this)" aria-label="Modifier">' +
                  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>' +
                '</button>' +
                '<button type="button" class="mp-tl-act mp-tl-act-del" title="Supprimer" onclick="mpDeleteTlItem(this)" aria-label="Supprimer">' +
                  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>' +
                '</button>' +
              '</div>'
            : '';

        return '<div class="mp-tl-item" data-type="' + type + '"' + attrs + '>' +
            '<div class="mp-tl-date-col">' +
                (dayStr ? escapeHtml(dayStr) : '') +
                (timeStr ? '<span class="mp-tl-time">' + escapeHtml(timeStr) + '</span>' : '') +
            '</div>' +
            '<div class="mp-tl-event" style="--event-color:' + color + '">' +
                '<div class="mp-tl-kind">' + escapeHtml(label) + '</div>' +
                (content ? '<div class="mp-tl-body">' + content + '</div>' : '') +
                actions +
            '</div>' +
        '</div>';
    }

    function _mpTlPid() {
        var p = prospects[currentIndex];
        return p ? p.id : null;
    }

    // ── Timeline edit ──
    window.mpEditTlItem = function (btn) {
        var item = btn.closest('.mp-tl-item');
        if (!item || item.dataset.editing === '1') return;
        var body = item.querySelector('.mp-tl-event');
        var contentEl = item.querySelector('.mp-tl-body');
        var rawContent = item.dataset.rawContent || (contentEl ? contentEl.innerText : '');
        item.dataset.editing = '1';
        var editor = document.createElement('div');
        editor.className = 'mp-tl-editor';
        editor.innerHTML = '<textarea class="mp-tl-edit-input" rows="2"></textarea>' +
            '<div class="mp-tl-edit-actions">' +
                '<button type="button" class="mp-tl-edit-cancel">Annuler</button>' +
                '<button type="button" class="mp-tl-edit-save">Enregistrer</button>' +
            '</div>';
        var ta = editor.querySelector('textarea');
        ta.value = rawContent;
        if (contentEl) contentEl.style.display = 'none';
        body.appendChild(editor);
        ta.focus();
        try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (_) {}
        function cleanup() { editor.remove(); if (contentEl) contentEl.style.display = ''; delete item.dataset.editing; }
        editor.querySelector('.mp-tl-edit-cancel').onclick = cleanup;
        editor.querySelector('.mp-tl-edit-save').onclick = function () {
            var newContent = ta.value.trim();
            var pid = _mpTlPid();
            if (!pid) { cleanup(); return; }
            var payload = { prospect_id: pid, source: item.dataset.source, content: newContent };
            if (item.dataset.source === 'event') payload.id = parseInt(item.dataset.ref, 10);
            else payload.note_index = parseInt(item.dataset.ref, 10);
            var saveBtn = editor.querySelector('.mp-tl-edit-save');
            saveBtn.disabled = true;
            fetch('/api/prospect/timeline/update', {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }).then(function (r) { return r.ok ? r.json() : Promise.reject(r); })
              .then(function (data) {
                if (!data.ok) throw new Error(data.error || 'Erreur');
                item.dataset.rawContent = newContent;
                if (contentEl) {
                    if (newContent) { contentEl.innerHTML = escapeHtml(newContent).replace(/\n/g, '<br>'); }
                    else { contentEl.remove(); }
                } else if (newContent) {
                    var nc = document.createElement('div'); nc.className = 'mp-tl-body';
                    nc.innerHTML = escapeHtml(newContent).replace(/\n/g, '<br>');
                    body.appendChild(nc);
                }
                cleanup();
                if (typeof window.showToast === 'function') window.showToast('Note modifiée', 'success');
              })
              .catch(function () {
                saveBtn.disabled = false;
                if (typeof window.showToast === 'function') window.showToast('Erreur lors de la modification', 'error');
              });
        };
    };

    // ── Timeline delete ──
    window.mpDeleteTlItem = function (btn) {
        var item = btn.closest('.mp-tl-item');
        if (!item) return;
        if (!confirm('Supprimer cet élément de la timeline ?')) return;
        var pid = _mpTlPid();
        if (!pid) return;
        var payload = { prospect_id: pid, source: item.dataset.source };
        if (item.dataset.source === 'event') payload.id = parseInt(item.dataset.ref, 10);
        else payload.note_index = parseInt(item.dataset.ref, 10);
        btn.disabled = true;
        fetch('/api/prospect/timeline/delete', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        }).then(function (r) { return r.ok ? r.json() : Promise.reject(r); })
          .then(function (data) {
            if (!data.ok) throw new Error(data.error || 'Erreur');
            if (item.dataset.source === 'note') {
                if (typeof window.mpLoadTimeline === 'function') window.mpLoadTimeline(pid);
                return;
            }
            // Remove from local cache and re-render
            var idx = tlAllEvents.indexOf(item._event);
            tlAllEvents = tlAllEvents.filter(function (e) { return e !== item._event; });
            item.remove();
            var feed = document.getElementById('mpTlFeed');
            if (feed && feed.children.length === 0) {
                feed.innerHTML = '<div class="mp-tl-empty">Aucune note ou activité</div>';
            }
            if (typeof window.showToast === 'function') window.showToast('Supprimé', 'success');
          })
          .catch(function () {
            btn.disabled = false;
            if (typeof window.showToast === 'function') window.showToast('Erreur lors de la suppression', 'error');
          });
    };

    // ── Add note ──
    window.mpAddNote = function () {
        var input = document.getElementById('mpTlInput');
        if (!input) return;
        var content = input.value.trim();
        if (!content) return;
        var p = prospects[currentIndex];
        if (!p) return;
        var currentNoteType = noteType;
        input.value = '';

        fetch('/api/prospect/events/add', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prospect_id: p.id, title: 'Note', content: content, type: currentNoteType })
        }).then(function (r) { return r.ok ? r.json() : Promise.reject(r); })
          .then(function (data) {
            if (!data || !data.ok) throw new Error('save failed');
            var newEvent = {
                type: data.type || 'note',
                date: data.date,
                title: data.title || 'Note',
                content: content,
                source: 'event',
                id: data.id
            };
            tlAllEvents.unshift(newEvent);
            var feed = document.getElementById('mpTlFeed');
            if (!feed) return;
            var emptyMsg = feed.querySelector('.mp-tl-empty');
            if (emptyMsg) emptyMsg.remove();
            var allowed = TL_FILTER_MAP[tlFilter];
            if (!allowed || allowed.indexOf(newEvent.type) >= 0) {
                var wrapper = document.createElement('div');
                wrapper.innerHTML = mpRenderTlItem(newEvent);
                var newEl = wrapper.firstElementChild;
                if (newEl) feed.insertBefore(newEl, feed.firstChild);
            }
            var countEl = document.getElementById('mpTlCount');
            if (countEl) {
                var n = tlAllEvents.length;
                countEl.textContent = n + ' événement' + (n > 1 ? 's' : '');
            }
          })
          .catch(function () {
            if (typeof window.showToast === 'function') window.showToast("Erreur lors de l'ajout de la note", 'error');
            input.value = content;
          });
    };

    // ── Date Picker Modal ──
    function mpShowDatePicker(options) {
        var overlay = document.createElement('div');
        overlay.className = 'mp-date-modal';
        var today = new Date().toISOString().split('T')[0];
        var defaultVal = options.currentValue || (options.type === 'datetime-local' ? today + 'T10:00' : today);
        overlay.innerHTML = '<div class="mp-date-modal-content">' +
            '<h3 class="mp-date-modal-title">📅 ' + escapeHtml(options.title) + '</h3>' +
            '<p class="mp-date-modal-sub">' + escapeHtml(options.subtitle) + '</p>' +
            '<input type="' + options.type + '" class="mp-input mp-date-modal-input" id="mpDatePickerInput" value="' + escapeHtml(defaultVal) + '">' +
            '<div class="mp-date-modal-actions">' +
                '<button type="button" class="mp-date-modal-btn mp-date-skip">Passer</button>' +
                '<button type="button" class="mp-date-modal-btn mp-date-confirm">✅ Confirmer</button>' +
            '</div></div>';
        document.body.appendChild(overlay);
        setTimeout(function () { var inp = document.getElementById('mpDatePickerInput'); if (inp) inp.focus(); }, 100);
        function close(confirmed) {
            var inp = document.getElementById('mpDatePickerInput');
            var val = (confirmed && inp) ? inp.value : null;
            overlay.style.opacity = '0';
            setTimeout(function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 200);
            if (confirmed && val && options.onConfirm) options.onConfirm(val);
        }
        overlay.querySelector('.mp-date-confirm').onclick = function () { close(true); };
        overlay.querySelector('.mp-date-skip').onclick = function () { close(false); };
        overlay.addEventListener('click', function (e) { if (e.target === overlay) close(false); });
        var escHandler = function (e) { if (e.key === 'Escape') { close(false); document.removeEventListener('keydown', escHandler); } };
        document.addEventListener('keydown', escHandler);
    }

    // ── Navigation ──
    function goTo(index) {
        if (index < 0 || index >= prospects.length) return;
        currentIndex = index;
        renderCurrentCard();
        updateUI();
    }

    function updateUI() {
        var numEl   = document.getElementById('mpCounterNum');
        var totEl   = document.getElementById('mpCounterTotal');
        var fillEl  = document.getElementById('mpProgressFill');
        if (numEl) numEl.textContent = currentIndex + 1;
        if (totEl) totEl.textContent = prospects.length;
        if (fillEl && prospects.length > 0) fillEl.style.width = ((currentIndex + 1) / prospects.length * 100).toFixed(1) + '%';
        if (prevBtn) prevBtn.disabled = currentIndex === 0;
        if (nextBtn) nextBtn.disabled = currentIndex === prospects.length - 1;
        var p = prospects[currentIndex];
        document.title = 'Mode Prosp — ' + (currentIndex + 1) + '/' + prospects.length + (p ? ' — ' + p.name : '');
    }

    function _captureCurrentCard() {
        if (saving) return;
        var body = viewport.querySelector('.mp-card-body');
        var p = prospects[currentIndex];
        if (!body || !p) return;
        body.querySelectorAll('[data-field]').forEach(function (el) {
            var field = el.dataset.field;
            var val = el.classList.contains('mp-select') ? el.dataset.value : el.value;
            if (field === 'company_id' || field === 'pertinence' || field === 'priority') val = parseInt(val, 10);
            p[field] = val;
        });
        mpSaveCard();
    }

    window.mpNavigate = function (dir) { _captureCurrentCard(); navDir = dir; goTo(currentIndex + dir); };
    window.mpGoTo    = function (i)   { _captureCurrentCard(); navDir = (i > currentIndex ? 1 : -1); goTo(i); };

    window.mpCancelCard = function () {
        navDir = 0;
        renderCurrentCard();
    };

    window.mpRefreshLastContact = function (prospectId, lastContact) {
        var idx = prospects.findIndex(function (p) { return p.id === prospectId; });
        if (idx < 0) return;
        prospects[idx].lastContact = lastContact;
        if (idx === currentIndex) {
            var input = viewport.querySelector('[data-field="lastContact"]');
            if (input) input.value = (lastContact || '').slice(0, 16);
        }
    };

    // ── Save ──
    window.mpSaveCard = async function () {
        if (saving) return;
        var p = prospects[currentIndex];
        if (!p) return;
        var body = viewport.querySelector('.mp-card-body');
        if (!body) return;
        var oldStatut = (p.statut || '');
        var prospectData = { id: p.id };
        body.querySelectorAll('[data-field]').forEach(function (el) {
            var field = el.dataset.field;
            var val = el.classList.contains('mp-select') ? el.dataset.value : el.value;
            if (field === 'company_id' || field === 'pertinence' || field === 'priority') val = parseInt(val, 10);
            prospectData[field] = val;
            p[field] = val;
        });
        var newStatut = (prospectData.statut || '');
        var statutChanged = (oldStatut !== newStatut);
        var savedIndex = currentIndex;
        saving = true;
        var saveBtn = viewport.querySelector('.mp-save-btn');
        if (saveBtn) { saveBtn.textContent = 'Sauvegarde...'; saveBtn.disabled = true; }
        try {
            var res = await fetch('/api/mode-prosp/save?t=' + encodeURIComponent(token), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prospect: prospectData })
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            var result = await res.json();
            if (!result.ok) throw new Error(result.error || 'Erreur');
            if (result.prospect) prospects[savedIndex] = result.prospect;
            if (saveBtn) {
                saveBtn.innerHTML = 'Enregistré !';
                setTimeout(function () {
                    if (saveBtn) { saveBtn.innerHTML = 'Enregistrer<kbd>↵</kbd>'; saveBtn.disabled = false; }
                }, 1200);
            }
            if (statutChanged && savedIndex === currentIndex) mpLoadTimeline(p.id);
        } catch (e) {
            if (saveBtn) { saveBtn.textContent = 'Erreur !'; saveBtn.disabled = false; }
            setTimeout(function () { if (saveBtn) saveBtn.innerHTML = 'Enregistrer<kbd>↵</kbd>'; }, 2000);
            if (typeof window.showToast === 'function') window.showToast('Erreur lors de l\'enregistrement', 'error');
        } finally { saving = false; }
    };

    // ── Rail action functions ──
    window.mpRailCall = function () {
        var btn = viewport.querySelector('.mp-hd-call');
        if (btn) btn.click();
    };
    window.mpRailEmail = function () {
        var btn = viewport.querySelector('.mp-hd-email');
        if (btn) btn.click();
    };
    window.mpRailLinkedIn = function () {
        var p = prospects[currentIndex];
        if (p && p.linkedin) window.open(p.linkedin, '_blank', 'noopener');
    };
    window.mpRailIA = function () {
        var p = prospects[currentIndex];
        if (p) window.open('/v30/prospect/' + p.id + '?ia=scrap', '_blank', 'noopener');
    };
    window.mpRailNote = function () {
        var input = document.getElementById('mpTlInput');
        if (input) { input.focus(); input.scrollIntoView({ block: 'nearest' }); }
    };
    window.mpRailStatus = function () {
        var trigger = viewport.querySelector('.mp-status-select .mp-select-trigger');
        if (trigger) { trigger.focus(); trigger.click(); }
    };

    // ── Keyboard shortcuts ──
    function mpSetStatusByIndex(idx) {
        var statusSel = viewport.querySelector('.mp-status-select');
        if (!statusSel) return;
        var opts = statusSel.querySelectorAll('.mp-select-option');
        if (opts[idx]) opts[idx].click();
    }

    function setupKeyboard() {
        document.addEventListener('keydown', function (e) {
            if (e.target.matches('input, select, textarea, .mp-select-trigger, .mp-select-option')) return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            var numKey = parseInt(e.key, 10);
            if (numKey >= 1 && numKey <= 7) { e.preventDefault(); _closeAllSelects(); mpSetStatusByIndex(numKey - 1); return; }
            if (e.key === 'ArrowLeft')  { e.preventDefault(); _captureCurrentCard(); navDir = -1; goTo(currentIndex - 1); return; }
            if (e.key === 'ArrowRight') { e.preventDefault(); _captureCurrentCard(); navDir = 1; goTo(currentIndex + 1); return; }
            if (e.key === 'Escape')     { e.preventDefault(); window.mpClose(); return; }
            if (document.querySelector('.mp-select-dropdown:not([hidden])')) return;
            var k = e.key;
            if (k === 'c' || k === 'C') { e.preventDefault(); window.mpRailCall(); }
            else if (k === 'm' || k === 'M') { e.preventDefault(); window.mpRailEmail(); }
            else if (k === 'l' || k === 'L') { e.preventDefault(); window.mpRailLinkedIn(); }
            else if (k === 'i' || k === 'I') { e.preventDefault(); window.mpRailIA(); }
            else if (k === 's' || k === 'S') { e.preventDefault(); window.mpRailStatus(); }
            else if (k === 'n' || k === 'N') { e.preventDefault(); window.mpRailNote(); }
            else if (k === 'Enter') { e.preventDefault(); window.mpSaveCard(); }
        });
    }

    // ── Swipe ──
    function setupSwipe() {
        var startX = null, startY = null;
        var THRESHOLD = 60;
        viewport.addEventListener('touchstart', function (e) {
            if (e.target.matches('input, select, textarea, a, button')) return;
            startX = e.touches[0].clientX; startY = e.touches[0].clientY;
        }, { passive: true });
        viewport.addEventListener('touchend', function (e) {
            if (startX === null) return;
            var dx = e.changedTouches[0].clientX - startX;
            var dy = e.changedTouches[0].clientY - startY;
            startX = null; startY = null;
            if (Math.abs(dx) < THRESHOLD || Math.abs(dy) > Math.abs(dx)) return;
            if (dx < 0 && currentIndex < prospects.length - 1) { _captureCurrentCard(); navDir = 1; goTo(currentIndex + 1); try { navigator.vibrate && navigator.vibrate(10); } catch (_) {} }
            else if (dx > 0 && currentIndex > 0) { _captureCurrentCard(); navDir = -1; goTo(currentIndex - 1); try { navigator.vibrate && navigator.vibrate(10); } catch (_) {} }
        }, { passive: true });
    }

    // ── Visibility sync ──
    function setupVisibilitySync() {
        var lastSync = 0;
        document.addEventListener('visibilitychange', async function () {
            if (document.hidden || !token || saving) return;
            var now = Date.now();
            if (now - lastSync < 5000) return;
            lastSync = now;
            try {
                var res = await fetch('/api/mode-prosp/data?t=' + encodeURIComponent(token));
                if (!res.ok) return;
                var payload = await res.json();
                if (!payload.ok) return;
                var fresh = Array.isArray(payload.prospects) ? payload.prospects : [];
                companies = Array.isArray(payload.companies) ? payload.companies : [];
                fresh.forEach(function (fp) {
                    var idx = prospects.findIndex(function (p) { return p.id === fp.id; });
                    if (idx >= 0) prospects[idx] = fp;
                });
                renderCurrentCard();
                updateUI();
            } catch (e) {}
        });
    }

    init();
})();

// ── Log call (outside IIFE for inline onclick) ──
function mpLogCall(prospectId) {
    if (!prospectId) return;
    fetch('/api/prospect/log-call', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospect_id: prospectId }),
    }).then(function (res) { return res.json(); })
      .then(function (data) {
          if (data.ok && data.lastContact && window.mpRefreshLastContact) {
              window.mpRefreshLastContact(prospectId, data.lastContact);
          }
          if (data.ok && typeof window.mpLoadTimeline === 'function') {
              window.mpLoadTimeline(prospectId);
          }
      })
      .catch(function () {});
}
