// Mode Prosp — standalone tab logic (v2: server-side token)
// Uses a server token passed via URL param ?t=TOKEN.
// All data is fetched/saved via /api/mode-prosp/* endpoints.
// No localStorage, no sessionStorage, no BroadcastChannel.

// Close / go back
window.mpClose = function () {
    if (window.opener) {
        window.close();
    } else if (history.length > 1) {
        history.back();
    } else {
        window.location.href = '/';
    }
};

(function () {
    'use strict';

    // ── State ──
    var prospects = [];
    var companies = [];
    var currentIndex = 0;
    var saving = false;
    var token = '';

    // ── DOM refs ──
    var viewport = document.getElementById('mpViewport');
    var track = document.getElementById('mpCardTrack');
    var counter = document.getElementById('mpCounter');
    var prevBtn = document.getElementById('mpPrev');
    var nextBtn = document.getElementById('mpNext');

    // ── Read token from URL ──
    function getToken() {
        var params = new URLSearchParams(location.search);
        return params.get('t') || '';
    }

    // ── Init ──
    async function init() {
        token = getToken();
        if (!token) {
            track.innerHTML = '<div class="mp-empty">Aucun prospect transmis. Retournez sur la page Prospects et relancez le Mode Prosp.</div>';
            return;
        }

        // Show loading
        track.innerHTML = '<div class="mp-empty">Chargement...</div>';

        // Fetch data from server using token
        try {
            var res = await fetch('/api/mode-prosp/data?t=' + encodeURIComponent(token));
            if (!res.ok) {
                if (res.status === 401) {
                    track.innerHTML = '<div class="mp-empty">Session expirée. Retournez sur la page Prospects et relancez le Mode Prosp.</div>';
                } else {
                    throw new Error('HTTP ' + res.status);
                }
                return;
            }
            var payload = await res.json();
            if (!payload.ok) {
                track.innerHTML = '<div class="mp-empty">' + (payload.error || 'Erreur') + '</div>';
                return;
            }
            prospects = Array.isArray(payload.prospects) ? payload.prospects : [];
            companies = Array.isArray(payload.companies) ? payload.companies : [];
        } catch (e) {
            track.innerHTML = '<div class="mp-empty">Erreur de chargement. Vérifiez votre connexion.</div>';
            console.error('Mode Prosp init error:', e);
            return;
        }

        if (prospects.length === 0) {
            track.innerHTML = '<div class="mp-empty">Aucun prospect trouvé.</div>';
            return;
        }

        renderAllCards();
        goTo(0, false);
        setupKeyboard();
        setupSwipe();
        setupVisibilitySync();
    }

    // ── Rendering ──
    function escapeHtml(str) {
        var d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }

    function getCompany(id) {
        return companies.find(function (c) { return c.id === id; }) || null;
    }

    var STATUS_OPTIONS = ["Pas d'actions", "Appelé", "A rappeler", "Rendez-vous", "Prospecté", "Messagerie", "Pas interessé"];
    var STATUS_COLORS = {
        "Pas d'actions": '#64748b', 'Appelé': '#f59e0b', 'Messagerie': '#3b82f6',
        'A rappeler': '#ef4444', 'Rendez-vous': '#22c55e', 'Prospecté': '#8b5cf6', 'Pas interessé': '#94a3b8'
    };

    function renderAllCards() {
        track.innerHTML = '';
        prospects.forEach(function (p, i) {
            var card = document.createElement('div');
            card.className = 'mp-card';
            card.dataset.index = i;
            card.innerHTML = buildCardHtml(p, i);
            track.appendChild(card);
        });
    }

    function buildCardHtml(p, index) {
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
            return '<option value="' + v + '"' + (pert === v ? ' selected' : '') + '>' + '\u2B50'.repeat(v) + '</option>';
        }).join('');

        var priorityOpts = [
            { v: '1', l: 'P1 (haute)' },
            { v: '2', l: 'P2 (normal)' },
            { v: '3', l: 'P3 (basse)' }
        ].map(function (o) {
            return '<option value="' + o.v + '"' + (String(p.priority || '2') === o.v ? ' selected' : '') + '>' + o.l + '</option>';
        }).join('');

        var photoUrl = p.photo_url ? '/api/photos/prospect/' + p.id : '';
        var avatarHtml = photoUrl
            ? '<img class="mp-avatar-img" src="' + photoUrl + '?t=' + Date.now() + '" alt="' + escapeHtml(initials) + '" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';" /><div class="mp-avatar" style="background:' + heroColor + ';display:none;">' + escapeHtml(initials) + '</div>'
            : '<div class="mp-avatar" style="background:' + heroColor + ';">' + escapeHtml(initials) + '</div>';

        var quickActions = '';
        if (p.telephone) {
            quickActions += '<a href="tel:' + escapeHtml(p.telephone.replace(/\s/g, '')) + '" class="mp-quick-btn mp-quick-call" title="Appeler">tel</a>';
        }
        if (p.email) {
            quickActions += '<a href="mailto:' + escapeHtml(p.email) + '" class="mp-quick-btn mp-quick-email" title="Email">mail</a>';
        }
        if (p.linkedin) {
            quickActions += '<a href="' + escapeHtml(p.linkedin) + '" target="_blank" class="mp-quick-btn mp-quick-linkedin" title="LinkedIn">in</a>';
        }

        return '<div class="mp-card-hero" style="--hero-color: ' + heroColor + ';">' +
            '<div class="mp-card-hero-bg"></div>' +
            '<div class="mp-card-hero-content">' +
                '<div class="mp-avatar-wrap">' + avatarHtml + '</div>' +
                '<div class="mp-hero-info">' +
                    '<div class="mp-hero-name">' + escapeHtml(p.name) + '</div>' +
                    '<div class="mp-hero-sub">' + escapeHtml(p.fonction || '') + (companyName ? ' &middot; ' + escapeHtml(companyName) : '') + '</div>' +
                    '<div class="mp-hero-stars">' + stars + '</div>' +
                '</div>' +
                (quickActions ? '<div class="mp-quick-actions">' + quickActions + '</div>' : '') +
            '</div>' +
        '</div>' +
        '<div class="mp-card-body" data-pid="' + p.id + '">' +
            '<div class="mp-field-grid">' +
                mpField('Statut', '<select class="mp-input" data-field="statut">' + statusOpts + '</select>') +
                mpField('Entreprise', '<select class="mp-input" data-field="company_id">' + companyOpts + '</select>') +
                mpField('Fonction', '<input type="text" class="mp-input" data-field="fonction" value="' + escapeHtml(p.fonction || '') + '">') +
                mpField('Téléphone', '<input type="text" class="mp-input" data-field="telephone" value="' + escapeHtml(p.telephone || '') + '">' +
                    (p.telephone ? ' <a href="tel:' + escapeHtml(p.telephone.replace(/\s/g, '')) + '" class="mp-action-link">Appeler</a>' : '')) +
                mpField('Email', '<input type="email" class="mp-input" data-field="email" value="' + escapeHtml(p.email || '') + '">' +
                    (p.email ? ' <a href="mailto:' + escapeHtml(p.email) + '" class="mp-action-link">Envoyer</a>' : '')) +
                mpField('LinkedIn', '<input type="text" class="mp-input" data-field="linkedin" value="' + escapeHtml(p.linkedin || '') + '">' +
                    (p.linkedin ? ' <a href="' + escapeHtml(p.linkedin) + '" target="_blank" class="mp-action-link">Voir</a>' : '')) +
                mpField('Pertinence', '<select class="mp-input" data-field="pertinence">' + pertOpts + '</select>') +
                mpField('Priorité', '<select class="mp-input" data-field="priority">' + priorityOpts + '</select>') +
                mpField('Next action', '<input type="text" class="mp-input" data-field="nextAction" value="' + escapeHtml(p.nextAction || '') + '">') +
                mpField('Relance', '<input type="date" class="mp-input" data-field="nextFollowUp" value="' + escapeHtml(p.nextFollowUp || '') + '">') +
                mpField('Date RDV', '<input type="datetime-local" class="mp-input" data-field="rdvDate" value="' + escapeHtml(p.rdvDate || '') + '">') +
                mpField('Dernier contact', '<input type="datetime-local" class="mp-input" data-field="lastContact" value="' + escapeHtml((p.lastContact || '').slice(0, 16)) + '">') +
            '</div>' +
            '<div class="mp-field-full">' +
                '<label class="mp-label">Notes</label>' +
                '<textarea class="mp-input mp-textarea" data-field="notes" rows="3">' + escapeHtml(p.notes || '') + '</textarea>' +
            '</div>' +
            '<div class="mp-card-actions">' +
                '<button class="mp-save-btn" onclick="mpSaveCard(' + index + ')">Enregistrer</button>' +
            '</div>' +
        '</div>';
    }

    function mpField(label, inputHtml) {
        return '<div class="mp-field"><label class="mp-label">' + label + '</label>' + inputHtml + '</div>';
    }

    // ── Navigation ──
    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    function goTo(index, animate) {
        if (index < 0 || index >= prospects.length) return;
        currentIndex = index;
        var offset = -index * 100;

        if (animate === false || reducedMotion.matches) {
            track.style.transition = 'none';
        } else {
            track.style.transition = 'transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        }
        track.style.transform = 'translateX(' + offset + '%)';

        if (animate === false) void track.offsetWidth;

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
        } else if (dotsEl) {
            dotsEl.innerHTML = '';
        }

        document.title = 'Mode Prosp — ' + (currentIndex + 1) + '/' + prospects.length + ' — ' + (prospects[currentIndex] ? prospects[currentIndex].name : '');
    }

    window.mpNavigate = function (dir) {
        goTo(currentIndex + dir, true);
    };

    window.mpGoTo = function (i) {
        goTo(i, true);
    };

    // ── Save (single prospect via server token) ──
    window.mpSaveCard = async function (index) {
        if (saving) return;
        var p = prospects[index];
        if (!p) return;

        var card = track.children[index];
        if (!card) return;

        // Read values from card inputs
        var body = card.querySelector('.mp-card-body');
        var prospectData = { id: p.id };
        body.querySelectorAll('[data-field]').forEach(function (el) {
            var field = el.dataset.field;
            var val = el.value;
            if (field === 'company_id' || field === 'pertinence' || field === 'priority') {
                val = parseInt(val, 10);
            }
            prospectData[field] = val;
            p[field] = val; // update local state
        });

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

            // Update local prospect with server response
            if (result.prospect) {
                prospects[index] = result.prospect;
                p = result.prospect;
            }

            if (saveBtn) saveBtn.textContent = 'Enregistré !';
            setTimeout(function () { if (saveBtn) { saveBtn.textContent = 'Enregistrer'; saveBtn.disabled = false; } }, 1200);

            // Re-render hero (status/color may have changed)
            var heroColor = STATUS_COLORS[p.statut] || '#64748b';
            var heroEl = card.querySelector('.mp-card-hero');
            if (heroEl) heroEl.style.setProperty('--hero-color', heroColor);
        } catch (e) {
            console.error('Save error:', e);
            if (saveBtn) { saveBtn.textContent = 'Erreur !'; saveBtn.disabled = false; }
            setTimeout(function () { if (saveBtn) saveBtn.textContent = 'Enregistrer'; }, 2000);
        } finally {
            saving = false;
        }
    };

    // ── Keyboard ──
    function setupKeyboard() {
        document.addEventListener('keydown', function (e) {
            if (e.target.matches('input, select, textarea')) return;
            if (e.key === 'ArrowLeft') { e.preventDefault(); mpNavigate(-1); }
            if (e.key === 'ArrowRight') { e.preventDefault(); mpNavigate(1); }
        });
    }

    // ── Swipe (drag feedback for mobile) ──
    function setupSwipe() {
        var startX = null;
        var startY = null;
        var isDragging = false;
        var dragLocked = false;
        var THRESHOLD = 50;
        var LOCK_ANGLE_THRESHOLD = 20;

        viewport.addEventListener('touchstart', function (e) {
            if (e.target.matches('input, select, textarea, a, button')) return;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            isDragging = false;
            dragLocked = false;
            track.style.transition = 'none';
        }, { passive: true });

        viewport.addEventListener('touchmove', function (e) {
            if (startX === null) return;
            var dx = e.touches[0].clientX - startX;
            var dy = e.touches[0].clientY - startY;

            if (!dragLocked && (Math.abs(dx) > LOCK_ANGLE_THRESHOLD || Math.abs(dy) > LOCK_ANGLE_THRESHOLD)) {
                if (Math.abs(dy) > Math.abs(dx)) {
                    startX = null;
                    return;
                }
                dragLocked = true;
            }

            if (!dragLocked) return;

            isDragging = true;
            e.preventDefault();

            var effectiveDx = dx;
            if ((currentIndex === 0 && dx > 0) || (currentIndex === prospects.length - 1 && dx < 0)) {
                effectiveDx = dx * 0.3;
            }

            var baseOffset = -currentIndex * viewport.offsetWidth;
            track.style.transform = 'translateX(' + (baseOffset + effectiveDx) + 'px)';
        }, { passive: false });

        viewport.addEventListener('touchend', function (e) {
            if (startX === null) return;
            var dx = e.changedTouches[0].clientX - startX;
            startX = null;
            startY = null;

            if (!isDragging) {
                track.style.transition = '';
                track.style.transform = 'translateX(' + (-currentIndex * 100) + '%)';
                return;
            }

            isDragging = false;
            dragLocked = false;

            if (Math.abs(dx) > THRESHOLD) {
                if (dx < 0 && currentIndex < prospects.length - 1) {
                    goTo(currentIndex + 1, true);
                    haptic(10);
                } else if (dx > 0 && currentIndex > 0) {
                    goTo(currentIndex - 1, true);
                    haptic(10);
                } else {
                    goTo(currentIndex, true);
                }
            } else {
                goTo(currentIndex, true);
            }
        }, { passive: true });
    }

    function haptic(ms) {
        try {
            if (navigator.vibrate) navigator.vibrate(ms || 10);
        } catch (e) {}
    }

    // ── Visibility sync: re-fetch data when tab regains focus ──
    function setupVisibilitySync() {
        document.addEventListener('visibilitychange', async function () {
            if (document.hidden || !token || saving) return;
            try {
                var res = await fetch('/api/mode-prosp/data?t=' + encodeURIComponent(token));
                if (!res.ok) return;
                var payload = await res.json();
                if (!payload.ok) return;
                var fresh = Array.isArray(payload.prospects) ? payload.prospects : [];
                companies = Array.isArray(payload.companies) ? payload.companies : [];
                // Update prospects that changed (compare by simple JSON)
                fresh.forEach(function (fp) {
                    var idx = prospects.findIndex(function (p) { return p.id === fp.id; });
                    if (idx >= 0) {
                        prospects[idx] = fp;
                        var card = track.children[idx];
                        if (card) card.innerHTML = buildCardHtml(fp, idx);
                    }
                });
            } catch (e) {
                // Silent — don't disrupt user
            }
        });
    }

    // Go
    init();
})();
