// Mode Prosp — standalone tab (v4: 2-column layout + timeline + date picker)
// Left: hero + form fields. Right: notes timeline.
// Uses server token (?t=TOKEN) for data.

// ── Phone choice dropdown (fixed positioning to avoid clipping) ──
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

(function () {
    'use strict';

    var prospects = [];
    var companies = [];
    var currentIndex = 0;
    var saving = false;
    var navDir = 0; // +1=next, -1=prev, 0=pas d'animation
    var token = '';

    var viewport = document.getElementById('mpViewport');
    var counter = document.getElementById('mpCounter');
    var prevBtn = document.getElementById('mpPrev');
    var nextBtn = document.getElementById('mpNext');

    function getToken() {
        return new URLSearchParams(location.search).get('t') || '';
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

    var STATUS_OPTIONS = ["Pas d'actions", "Appel\u00e9", "\u00c0 rappeler", "Rendez-vous", "Prospect\u00e9", "Messagerie", "Pas int\u00e9ress\u00e9"];
    var STATUS_COLORS = {
        "Pas d'actions": '#64748b', "Appel\u00e9": '#f59e0b', 'Messagerie': '#3b82f6',
        '\u00c0 rappeler': '#ef4444', 'Rendez-vous': '#22c55e', "Prospect\u00e9": '#8b5cf6', "Pas int\u00e9ress\u00e9": '#94a3b8'
    };
    var STATUS_GLOW = {
        "Pas d'actions": 'rgba(100,116,139,0.18)',
        "Appel\u00e9": 'rgba(245,158,11,0.22)',
        'Messagerie': 'rgba(59,130,246,0.22)',
        '\u00c0 rappeler': 'rgba(239,68,68,0.25)',
        'Rendez-vous': 'rgba(34,197,94,0.28)',
        "Prospect\u00e9": 'rgba(139,92,246,0.22)',
        "Pas int\u00e9ress\u00e9": 'rgba(148,163,184,0.12)'
    };

    var TL_ICONS = { call_note: '\uD83D\uDCDE', push: '\uD83D\uDCE7', done: '\u2705', rdv: '\uD83D\uDCC5', linkedin: '\uD83D\uDD17', event: '\uD83D\uDCCC', note_libre: '\uD83D\uDCDD' };
    var TL_LABELS = { call_note: "Note d'appel", push: 'Push', done: 'Fait', rdv: 'RDV', linkedin: 'LinkedIn', event: '\u00c9v\u00e9nement', note_libre: 'Note' };
    var TL_DOT = { call_note: 'call', push: 'push', done: 'done', rdv: 'rdv', linkedin: 'linkedin', note_libre: 'note', event: 'event' };

    // ── Init ──
    async function init() {
        token = getToken();
        if (!token) {
            viewport.innerHTML = '<div class="mp-empty">Aucun prospect transmis. Retournez sur la page Prospects et relancez le Mode Prosp.</div>';
            return;
        }
        viewport.innerHTML = '<div class="mp-empty">Chargement...</div>';
        try {
            var res = await fetch('/api/mode-prosp/data?t=' + encodeURIComponent(token));
            if (!res.ok) {
                if (res.status === 401) {
                    viewport.innerHTML = '<div class="mp-empty">Session expir\u00e9e. Retournez sur la page Prospects et relancez le Mode Prosp.</div>';
                } else { throw new Error('HTTP ' + res.status); }
                return;
            }
            var payload = await res.json();
            if (!payload.ok) { viewport.innerHTML = '<div class="mp-empty">' + escapeHtml(payload.error || 'Erreur') + '</div>'; return; }
            prospects = Array.isArray(payload.prospects) ? payload.prospects : [];
            companies = Array.isArray(payload.companies) ? payload.companies : [];
        } catch (e) {
            viewport.innerHTML = '<div class="mp-empty">Erreur de chargement. V\u00e9rifiez votre connexion.</div>';
            return;
        }
        if (prospects.length === 0) { viewport.innerHTML = '<div class="mp-empty">Aucun prospect trouv\u00e9.</div>'; return; }
        renderCurrentCard();
        updateUI();
        setupKeyboard();
        setupSwipe();
        setupVisibilitySync();
    }

    // ── Build card HTML (2-column: form left + timeline right) ──
    function buildCardHtml(p) {
        var company = getCompany(p.company_id);
        var companyName = company ? (company.groupe || '') + (company.site ? ' (' + company.site + ')' : '') : '';
        var pert = parseInt(p.pertinence, 10) || 3;
        var stars = '\u2605'.repeat(pert) + '\u2606'.repeat(5 - pert);
        var heroColor = STATUS_COLORS[p.statut] || '#64748b';
        var initials = (p.name || '??').split(/\s+/).map(function (w) { return w[0]; }).slice(0, 2).join('').toUpperCase();

        var statusOpts = STATUS_OPTIONS.map(function (s) {
            return '<option value="' + escapeHtml(s) + '"' + (p.statut === s ? ' selected' : '') + '>' + escapeHtml(s) + '</option>';
        }).join('');
        var companyOpts = companies.map(function (c) {
            return '<option value="' + c.id + '"' + (c.id === p.company_id ? ' selected' : '') + '>' + escapeHtml(c.groupe) + ' (' + escapeHtml(c.site || '') + ')</option>';
        }).join('');
        var pertOpts = [5, 4, 3, 2, 1].map(function (v) {
            return '<option value="' + v + '"' + (pert === v ? ' selected' : '') + '>\u2B50'.repeat(v) + '</option>';
        }).join('');
        var priorityOpts = [{ v: '1', l: 'P1 (haute)' }, { v: '2', l: 'P2 (normal)' }, { v: '3', l: 'P3 (basse)' }].map(function (o) {
            return '<option value="' + o.v + '"' + (String(p.priority || '2') === o.v ? ' selected' : '') + '>' + o.l + '</option>';
        }).join('');

        var photoUrl = p.photo_url ? '/api/photos/prospect/' + p.id : '';
        var avatarHtml = photoUrl
            ? '<img class="mp-avatar-img" src="' + photoUrl + '" alt="' + escapeHtml(initials) + '" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';" /><div class="mp-avatar" style="background:' + heroColor + ';display:none;">' + escapeHtml(initials) + '</div>'
            : '<div class="mp-avatar" style="background:' + heroColor + ';">' + escapeHtml(initials) + '</div>';

        var phoneNumbers = [];
        if (p.telephone) {
            phoneNumbers = p.telephone.split('/').map(function (n) { return n.trim(); }).filter(Boolean);
        }

        // Quick action buttons in hero
        var quickActions = '';
        if (phoneNumbers.length === 1) {
            quickActions += '<a href="tel:' + escapeHtml(phoneNumbers[0].replace(/\s/g, '')) + '" class="mp-quick-btn mp-quick-call" title="Appeler" onclick="mpLogCall(' + p.id + ')">TEL</a>';
        } else if (phoneNumbers.length > 1) {
            quickActions += '<div style="position:relative;">' +
                '<button type="button" class="mp-quick-btn mp-quick-call" title="Choisir un num\u00e9ro" onclick="mpTogglePhoneChoice(this)">TEL</button>' +
                '<div class="mp-phone-choice" style="display:none;">' +
                phoneNumbers.map(function (num) {
                    return '<a href="tel:' + escapeHtml(num.replace(/\s/g, '')) + '" class="mp-phone-choice-btn" onclick="mpLogCall(' + p.id + ')">\uD83D\uDCDE ' + escapeHtml(num) + '</a>';
                }).join('') +
                '</div></div>';
        }
        if (p.email) quickActions += '<a href="mailto:' + escapeHtml(p.email) + '" class="mp-quick-btn mp-quick-email" title="Email">MAIL</a>';
        if (p.linkedin) quickActions += '<a href="' + escapeHtml(p.linkedin) + '" target="_blank" class="mp-quick-btn mp-quick-linkedin" title="LinkedIn">IN</a>';

        // Inline phone links
        var phoneLinkHtml = '';
        if (phoneNumbers.length === 1) {
            phoneLinkHtml = '<a href="tel:' + escapeHtml(phoneNumbers[0].replace(/\s/g, '')) + '" class="mp-action-link" onclick="mpLogCall(' + p.id + ')">\uD83D\uDCDE Appeler</a>';
        } else if (phoneNumbers.length > 1) {
            phoneLinkHtml = phoneNumbers.map(function (num) {
                return '<a href="tel:' + escapeHtml(num.replace(/\s/g, '')) + '" class="mp-action-link" onclick="mpLogCall(' + p.id + ')">\uD83D\uDCDE ' + escapeHtml(num) + '</a>';
            }).join(' ');
        }

        var statusBadgeStyle = 'border-left: 3px solid ' + heroColor + ';';

        // ── LEFT COLUMN ──
        var leftCol =
            '<div class="mp-card-hero" style="--hero-color: ' + heroColor + ';">' +
                '<div class="mp-card-hero-bg"></div>' +
                '<div class="mp-card-hero-content">' +
                    '<div class="mp-avatar-wrap">' + avatarHtml + '</div>' +
                    '<div class="mp-hero-info">' +
                        '<div class="mp-hero-name">' + escapeHtml(p.name) + '</div>' +
                        '<div class="mp-hero-sub">' + escapeHtml(p.fonction || '') + (companyName ? ' \u00b7 ' + escapeHtml(companyName) : '') + '</div>' +
                        '<div class="mp-hero-meta">' +
                            '<span class="mp-hero-stars">' + stars + '</span>' +
                            '<span class="mp-status-badge" style="background:' + heroColor + '22;border-color:' + heroColor + '55;color:' + heroColor + ';">' + escapeHtml(p.statut || '') + '</span>' +
                        '</div>' +
                    '</div>' +
                    (quickActions ? '<div class="mp-quick-actions">' + quickActions + '</div>' : '') +
                '</div>' +
            '</div>' +
            '<div class="mp-card-body" data-pid="' + p.id + '">' +
                '<div class="mp-field-grid">' +
                    mpField('Statut', '<select class="mp-input mp-status-select" data-field="statut" style="' + statusBadgeStyle + '">' + statusOpts + '</select>') +
                    mpField('Entreprise', '<select class="mp-input" data-field="company_id">' + companyOpts + '</select>') +
                    mpField('Fonction', '<input type="text" class="mp-input" data-field="fonction" value="' + escapeHtml(p.fonction || '') + '">') +
                    mpField('T\u00e9l\u00e9phone', '<input type="text" class="mp-input" data-field="telephone" value="' + escapeHtml(p.telephone || '') + '">' + (phoneLinkHtml ? '<div class="mp-phone-links">' + phoneLinkHtml + '</div>' : '')) +
                    mpField('Email', '<input type="email" class="mp-input" data-field="email" value="' + escapeHtml(p.email || '') + '">' + (p.email ? '<a href="mailto:' + escapeHtml(p.email) + '" class="mp-action-link">Envoyer</a>' : '')) +
                    mpField('LinkedIn', '<input type="text" class="mp-input" data-field="linkedin" value="' + escapeHtml(p.linkedin || '') + '">' + (p.linkedin ? '<a href="' + escapeHtml(p.linkedin) + '" target="_blank" class="mp-action-link">Voir</a>' : '')) +
                    mpField('Pertinence', '<select class="mp-input" data-field="pertinence">' + pertOpts + '</select>') +
                    mpField('Priorit\u00e9', '<select class="mp-input" data-field="priority">' + priorityOpts + '</select>') +
                    mpField('Next action', '<input type="text" class="mp-input" data-field="nextAction" value="' + escapeHtml(p.nextAction || '') + '">') +
                    mpField('Relance', '<input type="date" class="mp-input" data-field="nextFollowUp" value="' + escapeHtml(p.nextFollowUp || '') + '">') +
                    mpField('Date RDV', '<input type="datetime-local" class="mp-input" data-field="rdvDate" value="' + escapeHtml(p.rdvDate || '') + '">') +
                    mpField('Dernier contact', '<input type="datetime-local" class="mp-input" data-field="lastContact" value="' + escapeHtml((p.lastContact || '').slice(0, 16)) + '">') +
                '</div>' +
                '<textarea class="mp-input" data-field="notes" style="display:none;">' + escapeHtml(p.notes || '') + '</textarea>' +
                '<div class="mp-card-actions">' +
                    '<button class="mp-save-btn" onclick="mpSaveCard()">Enregistrer</button>' +
                '</div>' +
            '</div>';

        // ── RIGHT COLUMN: Timeline ──
        var rightCol =
            '<div class="mp-card-timeline">' +
                '<div class="mp-tl-header">' +
                    '<span class="mp-tl-title">Notes & Suivi</span>' +
                    '<span class="mp-tl-count" id="mpTlCount"></span>' +
                '</div>' +
                '<div class="mp-tl-add">' +
                    '<textarea class="mp-tl-input" id="mpTlInput" placeholder="Ajouter une note\u2026" rows="2"></textarea>' +
                    '<button type="button" class="mp-tl-add-btn" onclick="mpAddNote()">+ Ajouter</button>' +
                '</div>' +
                '<div class="mp-tl-feed" id="mpTlFeed">' +
                    '<div class="mp-tl-empty">Chargement\u2026</div>' +
                '</div>' +
            '</div>';

        return '<div class="mp-card-main">' + leftCol + '</div>' + rightCol;
    }

    function mpField(label, inputHtml) {
        return '<div class="mp-field"><label class="mp-label">' + label + '</label>' + inputHtml + '</div>';
    }

    // ── Render current card ──
    function renderCurrentCard() {
        var p = prospects[currentIndex];
        if (!p) return;
        var card = document.createElement('div');
        card.className = 'mp-card';
        // Appliquer classe animation selon direction de navigation
        if (navDir > 0)      card.classList.add('mp-entering-next');
        else if (navDir < 0) card.classList.add('mp-entering-prev');
        else                 card.classList.add('mp-entering-init');
        navDir = 0; // reset après usage
        // Status glow CSS variable
        card.style.setProperty('--status-glow', STATUS_GLOW[p.statut] || 'rgba(99,102,241,0.18)');
        card.innerHTML = buildCardHtml(p);
        viewport.innerHTML = '';
        viewport.appendChild(card);

        // Supprimer la classe d'animation après qu'elle soit terminée
        // (évite que le transform résiduel de fill-mode:both crée un nouveau
        // containing block pour position:fixed → corrige le décalage dropdown tel)
        card.addEventListener('animationend', function () {
            card.classList.remove('mp-entering-next', 'mp-entering-prev', 'mp-entering-init');
        }, { once: true });

        // Status change => date picker
        var statusSelect = card.querySelector('[data-field="statut"]');
        if (statusSelect) {
            statusSelect.addEventListener('change', function () {
                var newVal = this.value;
                var heroColor = STATUS_COLORS[newVal] || '#64748b';
                this.style.borderLeftColor = heroColor;
                var heroEl = card.querySelector('.mp-card-hero');
                if (heroEl) heroEl.style.setProperty('--hero-color', heroColor);
                card.style.setProperty('--status-glow', STATUS_GLOW[newVal] || 'rgba(99,102,241,0.18)');
                // Mettre à jour le badge statut dans le hero
                var badge = card.querySelector('.mp-status-badge');
                if (badge) {
                    badge.style.background = heroColor + '22';
                    badge.style.borderColor = heroColor + '55';
                    badge.style.color = heroColor;
                    badge.textContent = newVal;
                }
                if (newVal === 'Rendez-vous') {
                    var rdvInput = card.querySelector('[data-field="rdvDate"]');
                    mpShowDatePicker({
                        title: 'Date du rendez-vous',
                        subtitle: 'Choisissez la date et l\'heure du RDV avec ce prospect.',
                        type: 'datetime-local',
                        currentValue: rdvInput ? rdvInput.value : '',
                        onConfirm: function (val) { if (rdvInput && val) rdvInput.value = val; }
                    });
                } else if (newVal === '\u00c0 rappeler') {
                    var relInput = card.querySelector('[data-field="nextFollowUp"]');
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

        // Load timeline
        mpLoadTimeline(p.id);
    }

    // ── Timeline ──
    function mpLoadTimeline(prospectId) {
        var feed = document.getElementById('mpTlFeed');
        if (!feed) return;
        fetch('/api/prospect/timeline?id=' + prospectId, { credentials: 'include' })
            .then(function (res) { return res.ok ? res.json() : Promise.reject('err'); })
            .then(function (payload) {
                var events = Array.isArray(payload.events) ? payload.events : [];
                if (events.length === 0) {
                    feed.innerHTML = '<div class="mp-tl-empty">Aucune note ou activit\u00e9</div>';
                    return;
                }
                events.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
                feed.innerHTML = events.map(function (e) { return mpRenderTlItem(e); }).join('');
                var countEl = document.getElementById('mpTlCount');
                if (countEl) {
                    var n = events.filter(function (e) { return e.type === 'call_note'; }).length;
                    countEl.textContent = n > 0 ? n + ' note' + (n > 1 ? 's' : '') : '';
                }
            })
            .catch(function () {
                feed.innerHTML = '<div class="mp-tl-empty">Timeline non disponible</div>';
            });
    }

    function mpRenderTlItem(event) {
        var type = event.type || 'event';
        var icon = TL_ICONS[type] || '\uD83D\uDCCC';
        var label = TL_LABELS[type] || type;
        var dotCls = TL_DOT[type] || 'event';
        var rawDate = event.date || '';
        var date = rawDate.slice(0, 10);
        var time = rawDate.slice(11, 16);
        var content = escapeHtml(event.content || '').replace(/\n/g, '<br>');
        return '<div class="mp-tl-item">' +
            '<div class="mp-tl-dot mp-tl-dot-' + dotCls + '"></div>' +
            '<div class="mp-tl-body">' +
                '<div class="mp-tl-head">' +
                    '<span class="mp-tl-icon">' + icon + '</span>' +
                    '<span class="mp-tl-label">' + escapeHtml(label) + '</span>' +
                    '<span class="mp-tl-date">' + date + (time ? ' ' + time : '') + '</span>' +
                '</div>' +
                (content ? '<div class="mp-tl-content">' + content + '</div>' : '') +
            '</div>' +
        '</div>';
    }

    // ── Add note via timeline ──
    window.mpAddNote = function () {
        var input = document.getElementById('mpTlInput');
        if (!input) return;
        var content = input.value.trim();
        if (!content) return;
        var p = prospects[currentIndex];
        if (!p) return;
        input.value = '';

        // Inject into DOM immediately
        var feed = document.getElementById('mpTlFeed');
        if (feed) {
            var emptyMsg = feed.querySelector('.mp-tl-empty');
            if (emptyMsg) emptyMsg.remove();
            var today = new Date().toISOString().slice(0, 10);
            var wrapper = document.createElement('div');
            wrapper.innerHTML = mpRenderTlItem({ type: 'call_note', date: today, content: content });
            var newEl = wrapper.firstElementChild;
            if (newEl) feed.insertBefore(newEl, feed.firstChild);
        }

        // Update notes field for save (append to existing notes)
        var notesEl = viewport.querySelector('[data-field="notes"]');
        if (notesEl) {
            var existing = notesEl.value.trim();
            var today2 = new Date().toISOString().slice(0, 10);
            notesEl.value = (existing ? existing + '\n' : '') + '[' + today2 + '] ' + content;
        }

        // Trigger save
        mpSaveCard();
    };

    // ── Date Picker Modal ──
    function mpShowDatePicker(options) {
        var overlay = document.createElement('div');
        overlay.className = 'mp-date-modal';
        var today = new Date().toISOString().split('T')[0];
        var defaultVal = options.currentValue || (options.type === 'datetime-local' ? today + 'T10:00' : today);
        overlay.innerHTML = '<div class="mp-date-modal-content">' +
            '<h3 class="mp-date-modal-title">\uD83D\uDCC5 ' + escapeHtml(options.title) + '</h3>' +
            '<p class="mp-date-modal-sub">' + escapeHtml(options.subtitle) + '</p>' +
            '<input type="' + options.type + '" class="mp-input mp-date-modal-input" id="mpDatePickerInput" value="' + escapeHtml(defaultVal) + '">' +
            '<div class="mp-date-modal-actions">' +
                '<button type="button" class="mp-date-modal-btn mp-date-skip">Passer</button>' +
                '<button type="button" class="mp-date-modal-btn mp-date-confirm">\u2705 Confirmer</button>' +
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
        counter.textContent = (currentIndex + 1) + ' / ' + prospects.length;
        prevBtn.disabled = currentIndex === 0;
        nextBtn.disabled = currentIndex === prospects.length - 1;
        var dotsEl = document.getElementById('mpDots');
        if (dotsEl && prospects.length <= 20) {
            dotsEl.innerHTML = prospects.map(function (_, i) {
                return '<span class="mp-dot' + (i === currentIndex ? ' active' : '') + '" onclick="mpGoTo(' + i + ')"></span>';
            }).join('');
        } else if (dotsEl) { dotsEl.innerHTML = ''; }
        var p = prospects[currentIndex];
        document.title = 'Mode Prosp \u2014 ' + (currentIndex + 1) + '/' + prospects.length + (p ? ' \u2014 ' + p.name : '');
        // Barre de progression
        var fill = document.getElementById('mpProgressFill');
        if (fill && prospects.length > 0) {
            fill.style.width = ((currentIndex + 1) / prospects.length * 100).toFixed(1) + '%';
        }
    }

    // Capture current card fields into local array synchronously, then navigate.
    // The server save runs in the background so navigation is instant and data
    // is never lost even if the network request fails.
    function _captureCurrentCard() {
        if (saving) return;
        var card = viewport.querySelector('.mp-card');
        var body = card && card.querySelector('.mp-card-body');
        var p = prospects[currentIndex];
        if (!body || !p) return;
        body.querySelectorAll('[data-field]').forEach(function (el) {
            var field = el.dataset.field;
            var val = el.value;
            if (field === 'company_id' || field === 'pertinence' || field === 'priority') val = parseInt(val, 10);
            p[field] = val;
        });
        mpSaveCard(); // fire-and-forget — index captured inside mpSaveCard via savedIndex
    }

    window.mpNavigate = function (dir) { _captureCurrentCard(); navDir = dir; goTo(currentIndex + dir); };
    window.mpGoTo = function (i) { _captureCurrentCard(); navDir = (i > currentIndex ? 1 : -1); goTo(i); };

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
        var card = viewport.querySelector('.mp-card');
        if (!card) return;
        var body = card.querySelector('.mp-card-body');
        if (!body) return;
        var prospectData = { id: p.id };
        body.querySelectorAll('[data-field]').forEach(function (el) {
            var field = el.dataset.field;
            var val = el.value;
            if (field === 'company_id' || field === 'pertinence' || field === 'priority') val = parseInt(val, 10);
            prospectData[field] = val;
            p[field] = val;
        });
        var savedIndex = currentIndex; // capture before any await — currentIndex may change if user navigates while fetch is in flight
        saving = true;
        var saveBtn = card.querySelector('.mp-save-btn');
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
            if (saveBtn) saveBtn.textContent = 'Enregistr\u00e9 !';
            setTimeout(function () { if (saveBtn) { saveBtn.textContent = 'Enregistrer'; saveBtn.disabled = false; } }, 1200);
            var heroEl = card.querySelector('.mp-card-hero');
            if (heroEl) heroEl.style.setProperty('--hero-color', STATUS_COLORS[p.statut] || '#64748b');
        } catch (e) {
            if (saveBtn) { saveBtn.textContent = 'Erreur !'; saveBtn.disabled = false; }
            setTimeout(function () { if (saveBtn) saveBtn.textContent = 'Enregistrer'; }, 2000);
        } finally { saving = false; }
    };

    // ── Keyboard ──
    function setupKeyboard() {
        document.addEventListener('keydown', function (e) {
            if (e.target.matches('input, select, textarea')) return;
            if (e.key === 'ArrowLeft') { e.preventDefault(); _captureCurrentCard(); goTo(currentIndex - 1); }
            if (e.key === 'ArrowRight') { e.preventDefault(); _captureCurrentCard(); goTo(currentIndex + 1); }
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
            if (dx < 0 && currentIndex < prospects.length - 1) { _captureCurrentCard(); navDir = 1; goTo(currentIndex + 1); haptic(10); }
            else if (dx > 0 && currentIndex > 0) { _captureCurrentCard(); navDir = -1; goTo(currentIndex - 1); haptic(10); }
        }, { passive: true });
    }

    function haptic(ms) { try { if (navigator.vibrate) navigator.vibrate(ms || 10); } catch (e) {} }

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

// Log call (outside IIFE for inline onclick)
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
          // Recharger la timeline pour afficher l'entrée "Appel sortant"
          if (data.ok && typeof ntLoadFeed === 'function') {
              ntLoadFeed('ntBox_' + prospectId, 'prospect', prospectId);
          }
      })
      .catch(function () {});
}
