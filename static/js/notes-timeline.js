/**
 * NotesTimeline — composant réutilisable Notes / Suivi
 * Utilisé sur : fiche prospect (onglet Infos) + fiche candidat
 * v27.x — PARTIE 1 refactor (fusion onglets Notes + Timeline)
 */

'use strict';

const NT_TYPE_ICONS = {
    call:      'phone',
    call_note: 'phone',
    push:      'mail',
    done:      'checkCircle',
    rdv:       'calendar',
    linkedin:  'linkedin',
    event:     'mapPin',
    note_libre:'note',
};

const NT_TYPE_LABELS = {
    call:       'Appel sortant',
    call_note:  "Note d'appel",
    push:       'Push envoyé',
    done:       'Marqué fait',
    rdv:        'Rendez-vous',
    linkedin:   'Message LinkedIn',
    event:      'Événement',
    note_libre: 'Note',
};

const NT_TYPE_DOT = {
    call:       'call',
    call_note:  'call',
    push:       'push',
    done:       'done',
    rdv:        'rdv',
    linkedin:   'linkedin',
    note_libre: 'note',
};

/**
 * Initialise le composant Notes/Suivi dans le div indiqué.
 * @param {string} containerId  ID du div racine
 * @param {object} options      { entityType: 'prospect'|'candidate', entityId: number }
 */
function initNotesTimeline(containerId, options = {}) {
    const { entityType = 'prospect', entityId } = options;
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `
        <div class="nt-add-form">
            <textarea id="nt-input-${containerId}" class="nt-textarea" placeholder="Ajouter une note…" rows="2"></textarea>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:6px;">
                <span id="nt-count-${containerId}" style="font-size:12px;color:var(--color-text-secondary);"></span>
                <button type="button" class="btn btn-primary nt-add-btn"
                        onclick="ntAddNote('${containerId}','${entityType}',${entityId})">
                    ${window.icon ? window.icon('plus', {size:14}) : '+'} Ajouter une note
                </button>
            </div>
        </div>
        <div class="nt-feed" id="nt-feed-${containerId}">
            <div class="muted" style="text-align:center;padding:14px;">Chargement…</div>
        </div>
    `;

    ntLoadFeed(containerId, entityType, entityId);
}

/**
 * Recharge et ré-affiche le fil d'activité.
 */
async function ntLoadFeed(containerId, entityType, entityId) {
    const feed = document.getElementById(`nt-feed-${containerId}`);
    if (!feed) return;

    const apiUrl = entityType === 'prospect'
        ? `/api/prospect/timeline?id=${entityId}`
        : `/api/candidate/timeline?id=${entityId}`;

    try {
        const res = await fetch(apiUrl, { credentials: 'include' });
        if (!res.ok) {
            feed.innerHTML = '<div class="muted" style="text-align:center;padding:14px;">Erreur de chargement</div>';
            return;
        }
        const payload = await res.json();
        const events = Array.isArray(payload.events) ? payload.events : [];

        if (events.length === 0) {
            feed.innerHTML = '<div class="muted" style="text-align:center;padding:14px;">Aucune note ou activité</div>';
            return;
        }

        // Tri chronologique descendant
        events.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

        feed.innerHTML = events.map(e => _ntRenderItem(e, { entityType, entityId, canDelete: true })).join('');

        // Mettre à jour le compteur de notes
        const noteCount = events.filter(e => e.type === 'call_note').length;
        _ntRefreshCount(containerId, noteCount);

    } catch (_) {
        feed.innerHTML = '<div class="muted" style="text-align:center;padding:14px;">Impossible de charger l\'activité</div>';
    }
}

/**
 * Ajoute une note, sauvegarde et recharge le fil.
 */
async function ntAddNote(containerId, entityType, entityId) {
    const input = document.getElementById(`nt-input-${containerId}`);
    if (!input) return;
    const content = input.value.trim();
    if (!content) {
        if (typeof showToast === 'function') showToast('Saisissez une note avant d\'ajouter', 'warning');
        return;
    }

    if (entityType === 'prospect') {
        // Mise à jour locale + sauvegarde (chemin existant)
        const prospect = (typeof data !== 'undefined') ? data.prospects.find(p => p.id === entityId) : null;
        if (!prospect) return;
        if (!Array.isArray(prospect.callNotes)) prospect.callNotes = [];
        const today = (typeof todayISO === 'function') ? todayISO() : new Date().toISOString().slice(0, 10);
        const newNote = { date: today, content };
        prospect.callNotes.push(newNote);
        if (typeof saveToServer === 'function') saveToServer();
        if (typeof markUnsaved === 'function') markUnsaved();
        input.value = '';

        // Injection immédiate dans le DOM sans attendre la réponse serveur
        const feed = document.getElementById(`nt-feed-${containerId}`);
        if (feed) {
            const emptyMsg = feed.querySelector('.muted');
            if (emptyMsg) emptyMsg.remove();
            const newEvent = { type: 'call_note', date: today, title: "Note d'appel", content };
            const wrapper = document.createElement('div');
            wrapper.innerHTML = _ntRenderItem(newEvent, { entityType, entityId, canDelete: true });
            const newEl = wrapper.firstElementChild;
            if (newEl) feed.insertBefore(newEl, feed.firstChild);
        }
        _ntRefreshCount(containerId, 1, true /* increment */);

    } else if (entityType === 'candidate') {
        try {
            const res = await fetch('/api/candidate/events/add', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    candidate_id: entityId,
                    type: 'note_libre',
                    title: 'Note',
                    content,
                })
            });
            if (res.ok) {
                input.value = '';
                ntLoadFeed(containerId, entityType, entityId);
            } else {
                if (typeof showToast === 'function') showToast('Erreur lors de l\'ajout de la note', 'error');
            }
        } catch (_) {
            if (typeof showToast === 'function') showToast('Erreur réseau lors de l\'ajout', 'error');
        }
    }
}

/* ── Rendu d'un élément ─────────────────────────────────────────── */

function _ntRenderItem(event, options = {}) {
    const { entityType = '', entityId = 0, canDelete = false } = options;
    const type    = event.type || 'event';
    const iconName = NT_TYPE_ICONS[type] || 'mapPin';
    const icon    = window.icon ? window.icon(iconName, {size:14}) : iconName;
    const label   = NT_TYPE_LABELS[type] || type;
    const dotCls  = NT_TYPE_DOT[type]    || '';
    const esc     = (typeof escapeHtml === 'function') ? escapeHtml : (s => s);

    const rawDate = event.date || '';
    const date    = rawDate.slice(0, 10);
    const time    = rawDate.slice(11, 16);
    const title   = esc(event.title || '');
    const content = esc(event.content || '').replace(/\n/g, '<br>');

    const metaHtml = _ntMetaHtml(event.meta, type);

    // Bouton suppression uniquement pour les notes d'appel (call_note) sur un prospect
    const canDeleteNote = canDelete && type === 'call_note' && entityType === 'prospect';
    const escapedDate    = JSON.stringify(event.date || '');
    const escapedContent = JSON.stringify(event.content || '');
    const deleteBtn = canDeleteNote
        ? `<button class="nt-del-btn" title="Supprimer cette note" onclick="ntDeleteNote('${entityType}',${entityId},${escapedDate},${escapedContent},this)" style="margin-left:auto;background:none;border:none;cursor:pointer;color:var(--color-text-secondary);font-size:14px;padding:2px 4px;border-radius:4px;opacity:0.5;transition:opacity 0.15s;" onmouseenter="this.style.opacity='1'" onmouseleave="this.style.opacity='0.5'">${window.icon ? window.icon('trash', {size:14}) : ''}</button>`
        : '';

    return `
<div class="nt-item nt-type-${type}" style="animation:nt-slide-in 0.25s ease both;">
    <div class="nt-dot ${dotCls}"></div>
    <div class="nt-body">
        <div class="nt-head" style="display:flex;align-items:center;gap:6px;">
            <span class="nt-icon">${icon}</span>
            <span class="nt-label">${label}</span>
            <span class="nt-date">${date}${time ? '&nbsp;' + time : ''}</span>
            ${deleteBtn}
        </div>
        ${title && title !== label ? `<div class="nt-title">${title}</div>` : ''}
        ${content ? `<div class="nt-content">${content}</div>` : ''}
        ${metaHtml}
    </div>
</div>`;
}

/**
 * Supprime une note d'appel (call_note) depuis la timeline.
 * Identifie la note par date+content dans prospect.callNotes.
 */
function ntDeleteNote(entityType, entityId, noteDate, noteContent, btnEl) {
    if (!confirm('Supprimer cette note ?')) return;

    if (entityType === 'prospect') {
        const prospect = (typeof data !== 'undefined') ? data.prospects.find(p => p.id === entityId) : null;
        if (!prospect || !Array.isArray(prospect.callNotes)) return;

        const idx = prospect.callNotes.findIndex(n => n.date === noteDate && n.content === noteContent);
        if (idx === -1) {
            if (typeof showToast === 'function') showToast('Note introuvable', 'error');
            return;
        }
        prospect.callNotes.splice(idx, 1);
        if (typeof saveToServer === 'function') saveToServer();
        if (typeof markUnsaved === 'function') markUnsaved();

        // Retrait immédiat du DOM
        const item = btnEl.closest('.nt-item');
        if (item) {
            const feed = item.closest('[id^="nt-feed-"]');
            const containerId = feed ? feed.id.replace('nt-feed-', '') : null;
            item.remove();
            if (containerId) _ntRefreshCount(containerId, -1, true /* decrement */);
            // Si feed vide, afficher message
            if (feed && feed.children.length === 0) {
                feed.innerHTML = '<div class="muted" style="text-align:center;padding:14px;">Aucune note ou activité</div>';
            }
        }
    }
}

/**
 * Met à jour le badge compteur de notes.
 * @param {string} containerId
 * @param {number} value  Valeur absolue (mode set) ou delta +1/-1 (mode increment)
 * @param {boolean} increment  Si true, ajoute value au compteur existant
 */
function _ntRefreshCount(containerId, value, increment = false) {
    const el = document.getElementById(`nt-count-${containerId}`);
    if (!el) return;
    let count = value;
    if (increment) {
        const current = parseInt(el.dataset.noteCount || '0', 10);
        count = Math.max(0, current + value);
    }
    el.dataset.noteCount = String(count);
    el.innerHTML = count > 0 ? `${window.icon ? window.icon('chat', {size:12}) : ''} ${count} note${count > 1 ? 's' : ''}` : '';
}

function _ntMetaHtml(meta, type) {
    if (!meta || typeof meta !== 'object') return '';
    if (type === 'push' && meta.template) {
        return `<div class="nt-meta">Template : ${escapeHtml ? escapeHtml(meta.template) : meta.template}</div>`;
    }
    return '';
}
