// Collaboration page (v25.6)

let __collaborators = [];
let __sharedCompanies = { sent: [], received: [] };
let __currentSharedCompanyId = null;
let __currentSharedFromUserId = null;
let __currentSharedSharerName = '';

async function loadCollaborators() {
    try {
        const res = await fetch('/api/collab/collaborators');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const json = await res.json();
        __collaborators = Array.isArray(json.collaborators) ? json.collaborators : [];
        return __collaborators;
    } catch (e) {
        console.error('Error loading collaborators:', e);
        if (e.message && e.message.includes('HTTP')) {
            showToast('Erreur lors du chargement des collaborateurs.', 'error');
        }
        return [];
    }
}

async function loadSharedCompanies() {
    try {
        const res = await fetch('/api/collab/shared-companies');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const json = await res.json();
        __sharedCompanies = {
            sent: Array.isArray(json.sent) ? json.sent : [],
            received: Array.isArray(json.received) ? json.received : []
        };
        return __sharedCompanies;
    } catch (e) {
        console.error('Error loading shared companies:', e);
        return { sent: [], received: [] };
    }
}

function renderCollaborators() {
    const container = document.getElementById('collabContainer');
    if (!container) return;

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
                            ${share.site && share.groupe ? `<div class="muted" style="font-size: 12px;">${escapeHtml(share.site)}</div>` : ''}
                            <div class="muted" style="font-size: 11px; margin-top: 4px;">Partagé le ${formatDate(share.shared_at)}</div>
                        </div>
                        <div style="display: flex; gap: 8px;">
                            <button class="btn btn-secondary btn-sm js-view-prospects" data-company-id="${share.company_id}" data-company-name="${escapeHtml(companyName)}" data-from-user-id="" data-sharer-name="" title="Voir les prospects">👁️ Prospects</button>
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
        const sharerName = share.display_name || share.username || 'Inconnu';
        return `
            <div class="card" style="margin-bottom: 8px; padding: 12px;">
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
                    <div style="flex: 1;">
                        <div style="font-weight: 600;">${escapeHtml(companyName)}</div>
                        ${share.site && share.groupe ? `<div class="muted" style="font-size: 12px;">${escapeHtml(share.site)}</div>` : ''}
                        <div class="muted" style="font-size: 11px; margin-top: 4px;">
                            Partagé par <strong>${escapeHtml(sharerName)}</strong> le ${formatDate(share.shared_at)}
                        </div>
                    </div>
                    <button class="btn btn-secondary btn-sm js-view-prospects" data-company-id="${share.company_id}" data-company-name="${escapeHtml(companyName)}" data-from-user-id="${share.from_user_id || ''}" data-sharer-name="${escapeHtml(sharerName)}" title="Voir les prospects">👁️ Prospects</button>
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

let __userCompanies = [];

async function loadUserCompanies() {
    try {
        const res = await fetch('/api/data');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const json = await res.json();
        __userCompanies = Array.isArray(json.companies) ? json.companies : [];
        return __userCompanies;
    } catch (e) {
        console.error('Error loading user companies:', e);
        if (typeof data !== 'undefined' && data.companies) {
            __userCompanies = data.companies;
            return __userCompanies;
        }
        return [];
    }
}

async function loadAllSharedProspects() {
    const container = document.getElementById('sharedProspectsContainer');
    if (!container) return;

    try {
        const res = await fetch('/api/collab/shared-prospects');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || 'Erreur');

        const prospects = Array.isArray(json.prospects) ? json.prospects : [];

        if (prospects.length === 0) {
            container.innerHTML = '<div class="card"><div class="muted">Aucun prospect dans les entreprises partagées avec vous.</div></div>';
            return;
        }

        // Group by company
        const byCompany = {};
        for (const p of prospects) {
            const key = `${p.shared_company_id}-${p.shared_from_user_id}`;
            if (!byCompany[key]) {
                byCompany[key] = {
                    companyName: p.shared_company_name || `Entreprise #${p.shared_company_id}`,
                    sharerName: p.shared_from || '',
                    companyId: p.shared_company_id,
                    fromUserId: p.shared_from_user_id,
                    prospects: []
                };
            }
            byCompany[key].prospects.push(p);
        }

        container.innerHTML = Object.values(byCompany).map(group => {
            const prospectsHtml = group.prospects.map(p => {
                const sharerBadge = `<span class="badge" style="background:rgba(120,80,255,0.25);color:#a78bfa;margin-left:6px;font-size:10px;">${escapeHtml(group.sharerName)}</span>`;
                const statutBadge = p.statut ? `<span class="badge" style="margin-left:6px;">${escapeHtml(p.statut)}</span>` : '';
                const prospectDataJson = JSON.stringify({statut: p.statut, notes: p.notes, lastContact: p.lastContact, nextFollowUp: p.nextFollowUp, pertinence: p.pertinence, nextAction: p.nextAction});
                return `
                    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.07);">
                        <div style="flex:1;">
                            <span style="font-weight:600;">${escapeHtml(p.name || '')}${sharerBadge}</span>${statutBadge}
                            ${p.fonction ? `<span class="muted" style="font-size:11px;margin-left:8px;">${escapeHtml(p.fonction)}</span>` : ''}
                            ${p.telephone ? `<span class="muted" style="font-size:11px;margin-left:8px;">📞 ${escapeHtml(p.telephone)}</span>` : ''}
                            ${p.email ? `<span class="muted" style="font-size:11px;margin-left:8px;">✉️ ${escapeHtml(p.email)}</span>` : ''}
                        </div>
                        <div style="display:flex;gap:6px;">
                            ${p.telephone ? `<a href="tel:${escapeHtml(p.telephone)}" class="mini-action" title="Appeler">📞</a>` : ''}
                            ${p.email ? `<a href="mailto:${escapeHtml(p.email)}" class="mini-action" title="Email">✉️</a>` : ''}
                            ${p.linkedin ? `<a href="${escapeHtml(p.linkedin)}" target="_blank" class="mini-action" title="LinkedIn">💼</a>` : ''}
                            <button class="btn btn-secondary btn-sm js-edit-shared-prospect"
                                data-prospect-id="${p.id}"
                                data-company-id="${p.shared_company_id}"
                                data-prospect-json="${escapeHtml(prospectDataJson)}"
                                title="Modifier">✏️</button>
                        </div>
                    </div>
                `;
            }).join('');

            return `
                <div class="card" style="margin-bottom:16px;">
                    <div style="font-weight:700;font-size:15px;margin-bottom:12px;">
                        ${escapeHtml(group.companyName)}
                        <span class="badge" style="background:rgba(120,80,255,0.2);color:#a78bfa;font-size:11px;margin-left:8px;">partagé par ${escapeHtml(group.sharerName)}</span>
                    </div>
                    ${prospectsHtml}
                </div>
            `;
        }).join('');
    } catch(e) {
        console.error(e);
        container.innerHTML = '<div class="card"><div class="muted">Erreur lors du chargement des prospects partagés.</div></div>';
    }
}

async function reloadCollab() {
    const container = document.getElementById('collabContainer');
    if (container) {
        container.innerHTML = '<div class="skeleton skeleton-row" style="margin:8px 0"></div><div class="skeleton skeleton-row" style="margin:8px 0"></div>';
    }

    await Promise.all([
        loadCollaborators(),
        loadSharedCompanies(),
        loadUserCompanies()
    ]);

    renderCollaborators();
    renderReceivedCompanies();
    await loadAllSharedProspects();
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
        const companies = __userCompanies.length > 0 ? __userCompanies : ((typeof data !== 'undefined' && data.companies) ? data.companies : []);
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
        if (opt.value === '') continue;
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

// Prospect data for edit modal
let __editingProspect = null;

async function viewSharedCompanyProspects(companyId, companyName, fromUserId, sharerName) {
    const modal = document.getElementById('sharedCompanyProspectsModal');
    const titleEl = document.getElementById('sharedCompanyProspectsTitle');
    const listEl = document.getElementById('sharedCompanyProspectsList');

    if (!modal || !listEl) return;

    __currentSharedCompanyId = companyId;
    __currentSharedFromUserId = fromUserId;
    __currentSharedSharerName = sharerName || '';

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

        // Use sharer name from API response if not passed
        const displaySharerName = sharerName || json.sharer_name || '';
        __currentSharedFromUserId = fromUserId || json.from_user_id || null;
        __currentSharedSharerName = displaySharerName;

        const prospects = Array.isArray(json.prospects) ? json.prospects : [];

        if (prospects.length === 0) {
            listEl.innerHTML = '<div class="muted">Aucun prospect pour cette entreprise.</div>';
            return;
        }

        const isReceived = !!displaySharerName; // if we have a sharer name, it's a received share

        listEl.innerHTML = prospects.map(p => {
            const tags = Array.isArray(p.tags) ? p.tags : [];
            const tagsHtml = tags.length > 0 ? `<div style="margin-top: 4px;">${tags.map(t => `<span class="badge" style="margin-right: 4px;">${escapeHtml(t)}</span>`).join('')}</div>` : '';
            const sharerBadge = displaySharerName ? `<span class="badge" style="background: rgba(120,80,255,0.25); color: #a78bfa; margin-left: 8px; font-size: 10px;">${escapeHtml(displaySharerName)}</span>` : '';
            const prospectDataJson = JSON.stringify({statut: p.statut, notes: p.notes, lastContact: p.lastContact, nextFollowUp: p.nextFollowUp, pertinence: p.pertinence, nextAction: p.nextAction});
            const editBtn = isReceived ? `<button class="btn btn-secondary btn-sm" onclick='openEditSharedProspectModal(${p.id}, ${escapeHtml(prospectDataJson)})' title="Modifier">✏️</button>` : '';

            return `
                <div class="card" style="margin-bottom: 12px; padding: 12px;" id="shared-prospect-${p.id}">
                    <div style="display: flex; align-items: start; justify-content: space-between; gap: 10px;">
                        <div style="flex: 1;">
                            <div style="font-weight: 600;">${escapeHtml(p.name || '')}${sharerBadge}</div>
                            ${p.fonction ? `<div class="muted" style="font-size: 12px;">${escapeHtml(p.fonction)}</div>` : ''}
                            ${p.email ? `<div class="muted" style="font-size: 11px; margin-top: 4px;">✉️ ${escapeHtml(p.email)}</div>` : ''}
                            ${p.telephone ? `<div class="muted" style="font-size: 11px;">📞 ${escapeHtml(p.telephone)}</div>` : ''}
                            ${p.statut ? `<div style="margin-top: 4px;"><span class="badge">${escapeHtml(p.statut)}</span></div>` : ''}
                            ${tagsHtml}
                            ${p.notes ? `<div class="muted" style="font-size: 11px; margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.1);">${escapeHtml(p.notes)}</div>` : ''}
                        </div>
                        <div style="display: flex; gap: 4px; flex-wrap: wrap; align-items: flex-start;">
                            ${p.email ? `<a href="mailto:${escapeHtml(p.email)}" class="mini-action" title="Envoyer un email">✉️</a>` : ''}
                            ${p.telephone ? `<a href="tel:${escapeHtml(p.telephone)}" class="mini-action" title="Appeler">📞</a>` : ''}
                            ${p.linkedin ? `<a href="${escapeHtml(p.linkedin)}" target="_blank" class="mini-action" title="LinkedIn">💼</a>` : ''}
                            ${editBtn}
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

function openEditSharedProspectModal(prospectId, prospectData) {
    __editingProspect = { id: prospectId, ...prospectData };

    const modal = document.getElementById('editSharedProspectModal');
    if (!modal) return;

    const statuts = ['', 'À contacter', 'Contacté', 'Intéressé', 'Rendez-vous', 'Proposition', 'Client', 'Non pertinent'];
    const statutSel = document.getElementById('editSharedStatut');
    if (statutSel) {
        statutSel.innerHTML = statuts.map(s => `<option value="${s}" ${prospectData.statut === s ? 'selected' : ''}>${s || '— Statut —'}</option>`).join('');
    }

    const notesEl = document.getElementById('editSharedNotes');
    if (notesEl) notesEl.value = prospectData.notes || '';

    const lastContactEl = document.getElementById('editSharedLastContact');
    if (lastContactEl) lastContactEl.value = prospectData.lastContact || '';

    const nextFollowUpEl = document.getElementById('editSharedNextFollowUp');
    if (nextFollowUpEl) nextFollowUpEl.value = prospectData.nextFollowUp || '';

    const nextActionEl = document.getElementById('editSharedNextAction');
    if (nextActionEl) nextActionEl.value = prospectData.nextAction || '';

    modal.style.display = 'flex';
}

function closeEditSharedProspectModal() {
    const modal = document.getElementById('editSharedProspectModal');
    if (modal) modal.style.display = 'none';
    __editingProspect = null;
}

async function saveSharedProspect() {
    if (!__editingProspect || !__currentSharedCompanyId) return;

    const updates = {
        statut: document.getElementById('editSharedStatut')?.value || '',
        notes: document.getElementById('editSharedNotes')?.value || '',
        lastContact: document.getElementById('editSharedLastContact')?.value || '',
        nextFollowUp: document.getElementById('editSharedNextFollowUp')?.value || '',
        nextAction: document.getElementById('editSharedNextAction')?.value || ''
    };

    try {
        const res = await fetch(`/api/collab/shared-company/${__currentSharedCompanyId}/prospect/${__editingProspect.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || 'Erreur');
        showToast('Prospect mis à jour.', 'success');
        closeEditSharedProspectModal();
        // Refresh the prospects list modal if open
        const titleEl = document.getElementById('sharedCompanyProspectsTitle');
        const companyName = titleEl ? titleEl.textContent.replace('Prospects — ', '') : '';
        const modalVisible = document.getElementById('sharedCompanyProspectsModal')?.style.display !== 'none';
        if (modalVisible && __currentSharedCompanyId) {
            await viewSharedCompanyProspects(__currentSharedCompanyId, companyName, __currentSharedFromUserId, __currentSharedSharerName);
        }
        // Also refresh the shared prospects section
        await loadAllSharedProspects();
    } catch (e) {
        console.error(e);
        showToast('Erreur lors de la mise à jour: ' + (e.message || 'Erreur inconnue'), 'error');
    }
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
    document.getElementById('editSharedProspectModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'editSharedProspectModal') closeEditSharedProspectModal();
    });

    // Event delegation for prospects buttons (avoids onclick escaping issues)
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.js-view-prospects');
        if (btn) {
            const companyId = parseInt(btn.dataset.companyId);
            const companyName = btn.dataset.companyName || '';
            const fromUserId = btn.dataset.fromUserId ? parseInt(btn.dataset.fromUserId) : null;
            const sharerName = btn.dataset.sharerName || null;
            viewSharedCompanyProspects(companyId, companyName, fromUserId, sharerName);
        }
    });

    // Event delegation for edit buttons in shared prospects section
    document.getElementById('sharedProspectsContainer')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.js-edit-shared-prospect');
        if (btn) {
            const prospectId = parseInt(btn.dataset.prospectId);
            const companyId = parseInt(btn.dataset.companyId);
            __currentSharedCompanyId = companyId;
            try {
                const prospectData = JSON.parse(btn.dataset.prospectJson);
                openEditSharedProspectModal(prospectId, prospectData);
            } catch(e2) {
                console.error('Error parsing prospect data:', e2);
            }
        }
    });

    try {
        await reloadCollab();
    } catch(err) {
        console.error(err);
        showToast('Erreur lors du chargement de la page collaboration.', 'error');
    }
});
