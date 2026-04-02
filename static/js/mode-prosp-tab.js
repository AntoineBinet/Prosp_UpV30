// Mode Prosp — standalone tab logic
// Loads filtered prospect IDs from sessionStorage, fetches data from API,
// renders editable cards with slide navigation, syncs via BroadcastChannel.

(function () {
    'use strict';

    // ── State ──
    let prospects = [];
    let companies = [];
    let currentIndex = 0;
    let prospectIds = [];
    let saving = false;

    // ── DOM refs ──
    const viewport = document.getElementById('mpViewport');
    const track = document.getElementById('mpCardTrack');
    const counter = document.getElementById('mpCounter');
    const prevBtn = document.getElementById('mpPrev');
    const nextBtn = document.getElementById('mpNext');

    // ── BroadcastChannel ──
    const bc = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel('prospup-mode-prosp') : null;

    // ── Init ──
    async function init() {
        // Read IDs from sessionStorage (set by main tab before window.open)
        let ids;
        try {
            ids = JSON.parse(sessionStorage.getItem('prospup_mode_prosp_ids'));
        } catch (e) {}
        if (!Array.isArray(ids) || ids.length === 0) {
            track.innerHTML = '<div class="mp-empty">Aucun prospect transmis. Retournez sur la page Prospects et relancez le Mode Prosp.</div>';
            return;
        }
        prospectIds = ids;
        // Clean up — one-shot transfer
        sessionStorage.removeItem('prospup_mode_prosp_ids');

        // Fetch data
        try {
            const res = await fetch('/api/data', { credentials: 'include' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const payload = await res.json();
            const allProspects = Array.isArray(payload.prospects) ? payload.prospects : [];
            companies = Array.isArray(payload.companies) ? payload.companies : [];
            // Keep only the filtered IDs, in order
            const pMap = new Map(allProspects.map(p => [p.id, p]));
            prospects = prospectIds.map(id => pMap.get(id)).filter(Boolean);
        } catch (e) {
            track.innerHTML = '<div class="mp-empty">Erreur de chargement des donnees. Verifiez que vous etes connecte.</div>';
            console.error(e);
            return;
        }

        if (prospects.length === 0) {
            track.innerHTML = '<div class="mp-empty">Aucun prospect trouve.</div>';
            return;
        }

        renderAllCards();
        goTo(0, false);
        setupKeyboard();
        setupSwipe();
        setupBroadcast();
    }

    // ── Rendering ──
    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }

    function getCompany(id) {
        return companies.find(c => c.id === id) || null;
    }

    const STATUS_OPTIONS = ["Pas d'actions", "Appelé", "A rappeler", "Rendez-vous", "Prospecte", "Messagerie", "Pas interesse"];
    const STATUS_COLORS = {
        "Pas d'actions": '#64748b', 'Appele': '#f59e0b', 'Messagerie': '#3b82f6',
        'A rappeler': '#ef4444', 'Rendez-vous': '#22c55e', 'Prospecte': '#8b5cf6', 'Pas interesse': '#94a3b8'
    };

    function renderAllCards() {
        track.innerHTML = '';
        prospects.forEach((p, i) => {
            const card = document.createElement('div');
            card.className = 'mp-card';
            card.dataset.index = i;
            card.innerHTML = buildCardHtml(p, i);
            track.appendChild(card);
        });
    }

    function buildCardHtml(p, index) {
        const company = getCompany(p.company_id);
        const companyName = company ? (company.groupe || '') + (company.site ? ' (' + company.site + ')' : '') : '';
        const pert = parseInt(p.pertinence, 10) || 3;
        const stars = '\u2605'.repeat(pert) + '\u2606'.repeat(5 - pert);
        const heroColor = STATUS_COLORS[p.statut] || '#64748b';
        const initials = (p.name || '??').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();

        const statusOpts = STATUS_OPTIONS.map(s =>
            '<option value="' + escapeHtml(s) + '"' + (p.statut === s ? ' selected' : '') + '>' + escapeHtml(s) + '</option>'
        ).join('');

        const companyOpts = companies.map(c =>
            '<option value="' + c.id + '"' + (c.id === p.company_id ? ' selected' : '') + '>' + escapeHtml(c.groupe) + ' (' + escapeHtml(c.site || '') + ')</option>'
        ).join('');

        const pertOpts = [5,4,3,2,1].map(v =>
            '<option value="' + v + '"' + (pert === v ? ' selected' : '') + '>' + '\u2B50'.repeat(v) + '</option>'
        ).join('');

        const priorityOpts = [
            { v: '1', l: 'P1 (haute)' },
            { v: '2', l: 'P2 (normal)' },
            { v: '3', l: 'P3 (basse)' }
        ].map(o => '<option value="' + o.v + '"' + (String(p.priority || '2') === o.v ? ' selected' : '') + '>' + o.l + '</option>').join('');

        const photoUrl = p.photo_url ? '/api/photos/prospect/' + p.id : '';
        const avatarHtml = photoUrl
            ? '<img class="mp-avatar-img" src="' + photoUrl + '?t=' + Date.now() + '" alt="' + escapeHtml(initials) + '" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';" /><div class="mp-avatar" style="background:' + heroColor + ';display:none;">' + escapeHtml(initials) + '</div>'
            : '<div class="mp-avatar" style="background:' + heroColor + ';">' + escapeHtml(initials) + '</div>';

        return '<div class="mp-card-hero" style="--hero-color: ' + heroColor + ';">' +
            '<div class="mp-card-hero-bg"></div>' +
            '<div class="mp-card-hero-content">' +
                '<div class="mp-avatar-wrap">' + avatarHtml + '</div>' +
                '<div class="mp-hero-info">' +
                    '<div class="mp-hero-name">' + escapeHtml(p.name) + '</div>' +
                    '<div class="mp-hero-sub">' + escapeHtml(p.fonction || '') + (companyName ? ' &middot; ' + escapeHtml(companyName) : '') + '</div>' +
                    '<div class="mp-hero-stars">' + stars + '</div>' +
                '</div>' +
            '</div>' +
        '</div>' +
        '<div class="mp-card-body" data-pid="' + p.id + '">' +
            '<div class="mp-field-grid">' +
                mpField('Statut', '<select class="mp-input" data-field="statut">' + statusOpts + '</select>') +
                mpField('Entreprise', '<select class="mp-input" data-field="company_id">' + companyOpts + '</select>') +
                mpField('Fonction', '<input type="text" class="mp-input" data-field="fonction" value="' + escapeHtml(p.fonction || '') + '">') +
                mpField('Telephone', '<input type="text" class="mp-input" data-field="telephone" value="' + escapeHtml(p.telephone || '') + '">' +
                    (p.telephone ? ' <a href="tel:' + escapeHtml(p.telephone.replace(/\s/g, '')) + '" class="mp-action-link">Appeler</a>' : '')) +
                mpField('Email', '<input type="email" class="mp-input" data-field="email" value="' + escapeHtml(p.email || '') + '">' +
                    (p.email ? ' <a href="mailto:' + escapeHtml(p.email) + '" class="mp-action-link">Envoyer</a>' : '')) +
                mpField('LinkedIn', '<input type="text" class="mp-input" data-field="linkedin" value="' + escapeHtml(p.linkedin || '') + '">' +
                    (p.linkedin ? ' <a href="' + escapeHtml(p.linkedin) + '" target="_blank" class="mp-action-link">Voir</a>' : '')) +
                mpField('Pertinence', '<select class="mp-input" data-field="pertinence">' + pertOpts + '</select>') +
                mpField('Priorite', '<select class="mp-input" data-field="priority">' + priorityOpts + '</select>') +
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
    function goTo(index, animate) {
        if (index < 0 || index >= prospects.length) return;
        currentIndex = index;
        const offset = -index * 100;

        if (animate === false) {
            track.style.transition = 'none';
        } else {
            track.style.transition = 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)';
            // Respect prefers-reduced-motion
            if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                track.style.transition = 'none';
            }
        }
        track.style.transform = 'translateX(' + offset + '%)';

        // Force reflow if no animation
        if (animate === false) void track.offsetWidth;

        updateUI();
    }

    function updateUI() {
        counter.textContent = (currentIndex + 1) + ' / ' + prospects.length;
        prevBtn.disabled = currentIndex === 0;
        nextBtn.disabled = currentIndex === prospects.length - 1;

        // Dots (show max 10)
        const dotsEl = document.getElementById('mpDots');
        if (dotsEl && prospects.length <= 20) {
            dotsEl.innerHTML = prospects.map((_, i) =>
                '<span class="mp-dot' + (i === currentIndex ? ' active' : '') + '" onclick="mpGoTo(' + i + ')"></span>'
            ).join('');
        } else if (dotsEl) {
            dotsEl.innerHTML = '';
        }

        document.title = 'Mode Prosp — ' + (currentIndex + 1) + '/' + prospects.length + ' — ' + (prospects[currentIndex]?.name || '');
    }

    window.mpNavigate = function (dir) {
        goTo(currentIndex + dir, true);
    };

    window.mpGoTo = function (i) {
        goTo(i, true);
    };

    // ── Save ──
    window.mpSaveCard = async function (index) {
        if (saving) return;
        const p = prospects[index];
        if (!p) return;

        const card = track.children[index];
        if (!card) return;

        // Read values from card inputs
        const body = card.querySelector('.mp-card-body');
        body.querySelectorAll('[data-field]').forEach(el => {
            const field = el.dataset.field;
            let val = el.value;
            if (field === 'company_id') val = parseInt(val, 10);
            if (field === 'pertinence') val = parseInt(val, 10);
            p[field] = val;
        });

        // Update in-memory data and save full dataset
        saving = true;
        const saveBtn = card.querySelector('.mp-save-btn');
        if (saveBtn) { saveBtn.textContent = 'Sauvegarde...'; saveBtn.disabled = true; }

        try {
            const res = await fetch('/api/save', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ companies: companies, prospects: prospects })
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            if (saveBtn) saveBtn.textContent = 'Enregistre !';
            setTimeout(() => { if (saveBtn) { saveBtn.textContent = 'Enregistrer'; saveBtn.disabled = false; } }, 1200);

            // Broadcast update to main tab
            if (bc) {
                bc.postMessage({ type: 'prospect-updated', prospect: { ...p }, source: 'mode-prosp' });
            }

            // Re-render hero (in case status/name changed)
            const heroColor = STATUS_COLORS[p.statut] || '#64748b';
            const heroEl = card.querySelector('.mp-card-hero');
            if (heroEl) heroEl.style.setProperty('--hero-color', heroColor);
        } catch (e) {
            console.error('Save error:', e);
            if (saveBtn) { saveBtn.textContent = 'Erreur !'; saveBtn.disabled = false; }
            setTimeout(() => { if (saveBtn) saveBtn.textContent = 'Enregistrer'; }, 2000);
        } finally {
            saving = false;
        }
    };

    // ── Keyboard ──
    function setupKeyboard() {
        document.addEventListener('keydown', function (e) {
            // Don't interfere with input fields
            if (e.target.matches('input, select, textarea')) return;
            if (e.key === 'ArrowLeft') { e.preventDefault(); mpNavigate(-1); }
            if (e.key === 'ArrowRight') { e.preventDefault(); mpNavigate(1); }
        });
    }

    // ── Swipe ──
    function setupSwipe() {
        let startX = null;
        let startY = null;
        const THRESHOLD = 60;

        viewport.addEventListener('touchstart', function (e) {
            if (e.target.matches('input, select, textarea')) return;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        }, { passive: true });

        viewport.addEventListener('touchend', function (e) {
            if (startX === null) return;
            const dx = e.changedTouches[0].clientX - startX;
            const dy = Math.abs(e.changedTouches[0].clientY - startY);
            if (Math.abs(dx) > THRESHOLD && Math.abs(dx) > dy) {
                if (dx < 0) mpNavigate(1);
                else mpNavigate(-1);
            }
            startX = null;
            startY = null;
        }, { passive: true });
    }

    // ── BroadcastChannel sync ──
    function setupBroadcast() {
        if (!bc) return;
        bc.onmessage = function (e) {
            if (!e.data || e.data.source === 'mode-prosp') return;
            if (e.data.type === 'prospect-updated' && e.data.prospect) {
                const updated = e.data.prospect;
                const idx = prospects.findIndex(p => p.id === updated.id);
                if (idx >= 0) {
                    prospects[idx] = updated;
                    // Re-render that card
                    const card = track.children[idx];
                    if (card) {
                        card.innerHTML = buildCardHtml(updated, idx);
                    }
                }
            }
        };
    }

    // Go
    init();
})();
