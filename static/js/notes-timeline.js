/**
 * NotesTimeline — composant réutilisable Notes / Suivi
 * Utilisé sur : fiche prospect (onglet Infos) + fiche candidat
 * v27.x — PARTIE 1 refactor (fusion onglets Notes + Timeline)
 */

'use strict';

const NT_TYPE_ICONS = {
    call_note: '📞',
    push:      '📧',
    done:      '✅',
    rdv:       '📅',
    linkedin:  '🔗',
    event:     '📌',
    note_libre:'📝',
};

const NT_TYPE_LABELS = {
    call_note:  "Note d'appel",
    push:       'Push envoyé',
    done:       'Marqué fait',
    rdv:        'Rendez-vous',
    linkedin:   'Message LinkedIn',
    event:      'Événement',
    note_libre: 'Note',
};

const NT_TYPE_DOT = {
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
            <button type="button" class="btn btn-primary nt-add-btn"
                    onclick="ntAddNote('${containerId}','${entityType}',${entityId})">
                ➕ Ajouter une note
            </button>
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

        feed.innerHTML = events.map(e => _ntRenderItem(e)).join('');

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
        prospect.callNotes.push({ date: today, content });
        if (typeof saveToServer === 'function') saveToServer();
        if (typeof markUnsaved === 'function') markUnsaved();
        input.value = '';
        ntLoadFeed(containerId, entityType, entityId);

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

function _ntRenderItem(event) {
    const type    = event.type || 'event';
    const icon    = NT_TYPE_ICONS[type]  || '📌';
    const label   = NT_TYPE_LABELS[type] || type;
    const dotCls  = NT_TYPE_DOT[type]    || '';
    const esc     = (typeof escapeHtml === 'function') ? escapeHtml : (s => s);

    const rawDate = event.date || '';
    const date    = rawDate.slice(0, 10);
    const time    = rawDate.slice(11, 16);
    const title   = esc(event.title || '');
    const content = esc(event.content || '').replace(/\n/g, '<br>');

    const metaHtml = _ntMetaHtml(event.meta, type);

    return `
<div class="nt-item nt-type-${type}" style="animation:nt-slide-in 0.25s ease both;">
    <div class="nt-dot ${dotCls}"></div>
    <div class="nt-body">
        <div class="nt-head">
            <span class="nt-icon">${icon}</span>
            <span class="nt-label">${label}</span>
            <span class="nt-date">${date}${time ? '&nbsp;' + time : ''}</span>
        </div>
        ${title && title !== label ? `<div class="nt-title">${title}</div>` : ''}
        ${content ? `<div class="nt-content">${content}</div>` : ''}
        ${metaHtml}
    </div>
</div>`;
}

function _ntMetaHtml(meta, type) {
    if (!meta || typeof meta !== 'object') return '';
    if (type === 'push' && meta.template) {
        return `<div class="nt-meta">Template : ${escapeHtml ? escapeHtml(meta.template) : meta.template}</div>`;
    }
    return '';
}
