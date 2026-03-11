// Collaboration page (v25.5)

let __collaborators = [];
let __sharedCompanies = { sent: [], received: [] };

async function loadCollaborators() {
    try {
        const res = await fetch('/api/collab/collaborators');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || 'Erreur');
        __collaborators = Array.isArray(json.collaborators) ? json.collaborators : [];
        return __collaborators;
    } catch (e) {
        console.error('Error loading collaborators:', e);
        showToast('Erreur lors du chargement des collaborateurs.', 'error');
        return [];
    }
}

async function loadSharedCompanies() {
    try {
        const res = await fetch('/api/collab/shared-companies');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || 'Erreur');
        __sharedCompanies = {
            sent: Array.isArray(json.sent) ? json.sent : [],
            received: Array.isArray(json.received) ? json.received : []
        };
        return __sharedCompanies;
    } catch (e) {
        console.error('Error loading shared companies:', e);
        showToast('Erreur lors du chargement des entreprises partagées.', 'error');
        return { sent: [], received: [] };
    }
}

function renderCollaborators() {
    const container = document.getElementById('collabContainer');
    if (!container) return;

    // Grouper les entreprises partagées par collaborateur
    const byCollaborator = {};
    for (const share of __sharedCompanies.sent) {
        const userId = share.to_user_id;
        if (!byCollaborator[userId]) {
            byCollaborator[userId] = {
                user: __collaborators.find(c => c.id === userId) || { id: userId, display_name: share.display_name || share.username || 'Inconnu', username: share.username },
                companies: []
            };
        }
        byCollaborator[userId].companies.push(share);
    }

    if (Object.keys(byCollaborator).length === 0) {
        container.innerHTML = '<div class="card"><div class="muted">Aucun collaborateur avec des entreprises partagées. Cliquez sur "➕ Ajouter collaborateur" pour commencer.</div></div>';
        return;
    }

    container.innerHTML = Object.values(byCollaborator).map(collab => {
        const user = collab.user;
        const companies = collab.companies;
        const companiesHtml = companies.map(share => {
            const companyName = share.groupe || share.site || `Entreprise #${share.company_id}`;
            return `
                <div class="card" style="margin-bottom: 8px; padding: 12px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
                        <div style="flex: 1;">
                            <div style="font-weight: 600;">${escapeHtml(companyName)}</div>
                            ${share.site ? `<div class="muted" style="font-size: 12px;">${escapeHtml(share.site)}</div>` : ''}
                            <div class="muted" style="font-size: 11px; margin-top: 4px;">Partagé le ${formatDate(share.shared_at)}</div>
                        </div>
                        <div style="display: flex; gap: 8px;">
                            <button class="btn btn-secondary btn-sm" onclick="viewSharedCompanyProspects(${share.company_id}, '${escapeHtml(companyName)}')" title="Voir les prospects">👁️ Prospects</button>
                            <button class="btn btn-danger btn-sm" onclick="unshareCompany(${share.id}, '${escapeHtml(companyName)}')" title="Retirer le partage">🗑️</button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="card" style="margin-bottom: 16px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                    <div>
                        <div style="font-weight: 800; font-size: 16px;">${escapeHtml(user.display_name || user.username || 'Inconnu')}</div>
                        <div class="muted" style="font-size: 12px;">${escapeHtml(user.username || '')}</div>
                    </div>
                    <button class="btn btn-primary btn-sm" onclick="openAddCollaboratorModal(${user.id})" title="Partager une entreprise">➕ Partager entreprise</button>
                </div>
                <div>
                    ${companies.length > 0 ? companiesHtml : '<div class="muted" style="padding: 8px;">Aucune entreprise partagée avec ce collaborateur.</div>'}
                </div>
            </div>
        `;
    }).join('');
}

function renderReceivedCompanies() {
    const container = document.getElementById('receivedCompaniesContainer');
    if (!container) return;

    if (__sharedCompanies.received.length === 0) {
        container.innerHTML = '<div class="card"><div class="muted">Aucune entreprise partagée avec vous.</div></div>';
        return;
    }

    container.innerHTML = __sharedCompanies.received.map(share => {
        const companyName = share.groupe || share.site || `Entreprise #${share.company_id}`;
        return `
            <div class="card" style="margin-bottom: 8px; padding: 12px;">
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
                    <div style="flex: 1;">
                        <div style="font-weight: 600;">${escapeHtml(companyName)}</div>
                        ${share.site ? `<div class="muted" style="font-size: 12px;">${escapeHtml(share.site)}</div>` : ''}
                        <div class="muted" style="font-size: 11px; margin-top: 4px;">
                            Partagé par ${escapeHtml(share.display_name || share.username || 'Inconnu')} le ${formatDate(share.shared_at)}
                        </div>
                    </div>
                    <button class="btn btn-secondary btn-sm" onclick="viewSharedCompanyProspects(${share.company_id}, '${escapeHtml(companyName)}')" title="Voir les prospects">👁️ Prospects</button>
                </div>
            </div>
        `;
    }).join('');
}

function formatDate(iso) {
    if (!iso) return '—';
    try {
        const d = new Date(iso);
        return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch {
        return iso;
    }
}

async function reloadCollab() {
    const container = document.getElementById('collabContainer');
    if (container) {
        container.innerHTML = '<div class="skeleton skeleton-row" style="margin:8px 0"></div><div class="skeleton skeleton-row" style="margin:8px 0"></div>';
    }
    
    // S'assurer que les données sont chargées
    if (typeof data === 'undefined' || !data.companies || data.companies.length === 0) {
        if (typeof loadFromServer === 'function') {
            await loadFromServer();
        }
    }
    
    await Promise.all([
        loadCollaborators(),
        loadSharedCompanies()
    ]);
    
    renderCollaborators();
    renderReceivedCompanies();
}

function openAddCollaboratorModal(preselectedUserId = null) {
    const modal = document.getElementById('addCollaboratorModal');
    if (!modal) return;

    const collaboratorSelect = document.getElementById('collaboratorSelect');
    const companySelect = document.getElementById('companySelect');
    const companySearchInput = document.getElementById('companySearchInput');
    
    if (collaboratorSelect) {
        collaboratorSelect.innerHTML = '<option value="">-- Sélectionner un collaborateur --</option>';
        __collaborators.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = `${c.display_name || c.username} (${c.username})`;
            if (preselectedUserId && c.id === preselectedUserId) {
                opt.selected = true;
            }
            collaboratorSelect.appendChild(opt);
        });
    }

    if (companySelect) {
        companySelect.innerHTML = '<option value="">-- Sélectionner une entreprise --</option>';
        const companies = (typeof data !== 'undefined' && data.companies) ? data.companies : [];
        companies.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            const name = c.groupe || c.site || `Entreprise #${c.id}`;
            opt.textContent = name + (c.site && c.groupe ? ` (${c.site})` : '');
            companySelect.appendChild(opt);
        });
    }

    if (companySearchInput) {
        companySearchInput.value = '';
    }

    modal.style.display = 'flex';
}

function closeAddCollaboratorModal() {
    const modal = document.getElementById('addCollaboratorModal');
    if (modal) modal.style.display = 'none';
}

function _filterCompanyOptions() {
    const q = (document.getElementById('companySearchInput')?.value || '').toLowerCase().trim();
    const sel = document.getElementById('companySelect');
    if (!sel) return;
    for (const opt of sel.options) {
        if (opt.value === '') continue; // Keep the placeholder
        const text = (opt.textContent || '').toLowerCase();
        opt.style.display = (!q || text.includes(q)) ? '' : 'none';
    }
}

async function shareCompany() {
    const collaboratorId = document.getElementById('collaboratorSelect')?.value;
    const companyId = document.getElementById('companySelect')?.value;

    if (!collaboratorId || !companyId) {
        showToast('Veuillez sélectionner un collaborateur et une entreprise.', 'error');
        return;
    }

    try {
        const res = await fetch('/api/collab/share-company', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                company_id: Number(companyId),
                to_user_id: Number(collaboratorId)
            })
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || 'Erreur');
        showToast('Entreprise partagée avec succès.', 'success');
        closeAddCollaboratorModal();
        await reloadCollab();
    } catch (e) {
        console.error(e);
        showToast('Erreur lors du partage: ' + (e.message || 'Erreur inconnue'), 'error');
    }
}

async function unshareCompany(shareId, companyName) {
    if (!confirm(`Retirer le partage de "${companyName}" ?`)) return;
    
    try {
        const res = await fetch('/api/collab/unshare-company', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ share_id: shareId })
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || 'Erreur');
        showToast('Partage retiré.', 'success');
        await reloadCollab();
    } catch (e) {
        console.error(e);
        showToast('Erreur lors de la suppression du partage.', 'error');
    }
}

async function viewSharedCompanyProspects(companyId, companyName) {
    const modal = document.getElementById('sharedCompanyProspectsModal');
    const titleEl = document.getElementById('sharedCompanyProspectsTitle');
    const listEl = document.getElementById('sharedCompanyProspectsList');
    
    if (!modal || !listEl) return;

    if (titleEl) {
        titleEl.textContent = `Prospects — ${companyName}`;
    }

    listEl.innerHTML = '<div class="muted">Chargement…</div>';
    modal.style.display = 'flex';

    try {
        const res = await fetch(`/api/collab/shared-company/${companyId}/prospects`);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || 'Erreur');
        
        const prospects = Array.isArray(json.prospects) ? json.prospects : [];
        
        if (prospects.length === 0) {
            listEl.innerHTML = '<div class="muted">Aucun prospect pour cette entreprise.</div>';
            return;
        }

        listEl.innerHTML = prospects.map(p => {
            const tags = Array.isArray(p.tags) ? p.tags : [];
            const tagsHtml = tags.length > 0 ? `<div style="margin-top: 4px;">${tags.map(t => `<span class="badge" style="margin-right: 4px;">${escapeHtml(t)}</span>`).join('')}</div>` : '';
            const emailLink = p.email ? `<a href="mailto:${escapeHtml(p.email)}" class="mini-action" title="Envoyer un email">✉️</a>` : '';
            const telLink = p.telephone ? `<a href="tel:${escapeHtml(p.telephone)}" class="mini-action" title="Appeler">📞</a>` : '';
            const linkedinLink = p.linkedin ? `<a href="${escapeHtml(p.linkedin)}" target="_blank" class="mini-action" title="LinkedIn">💼</a>` : '';

            return `
                <div class="card" style="margin-bottom: 12px; padding: 12px;">
                    <div style="display: flex; align-items: start; justify-content: space-between; gap: 10px;">
                        <div style="flex: 1;">
                            <div style="font-weight: 600;">${escapeHtml(p.name || '')}</div>
                            ${p.fonction ? `<div class="muted" style="font-size: 12px;">${escapeHtml(p.fonction)}</div>` : ''}
                            ${p.email ? `<div class="muted" style="font-size: 11px; margin-top: 4px;">✉️ ${escapeHtml(p.email)}</div>` : ''}
                            ${p.telephone ? `<div class="muted" style="font-size: 11px;">📞 ${escapeHtml(p.telephone)}</div>` : ''}
                            ${p.statut ? `<div style="margin-top: 4px;"><span class="badge">${escapeHtml(p.statut)}</span></div>` : ''}
                            ${tagsHtml}
                            ${p.notes ? `<div class="muted" style="font-size: 11px; margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.1);">${escapeHtml(p.notes)}</div>` : ''}
                        </div>
                        <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                            ${emailLink}
                            ${telLink}
                            ${linkedinLink}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    } catch (e) {
        console.error(e);
        listEl.innerHTML = '<div class="muted" style="color: var(--error-color);">Erreur lors du chargement des prospects.</div>';
    }
}

function closeSharedCompanyProspectsModal() {
    const modal = document.getElementById('sharedCompanyProspectsModal');
    if (modal) modal.style.display = 'none';
}

// ═══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const fn = window.bootstrap || window.appBootstrap;
        if (typeof fn === 'function') await fn('collab');
    } catch(e) {}

    document.getElementById('btnAddCollaborator')?.addEventListener('click', () => openAddCollaboratorModal());
    document.getElementById('btnReloadCollab')?.addEventListener('click', reloadCollab);
    document.getElementById('companySearchInput')?.addEventListener('input', _filterCompanyOptions);

    // Close modals on outside click
    document.getElementById('addCollaboratorModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'addCollaboratorModal') closeAddCollaboratorModal();
    });
    document.getElementById('sharedCompanyProspectsModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'sharedCompanyProspectsModal') closeSharedCompanyProspectsModal();
    });

    try {
        await reloadCollab();
    } catch(err) {
        console.error(err);
        showToast('Erreur lors du chargement de la page collaboration.', 'error');
    }
});
