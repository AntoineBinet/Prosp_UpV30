// Suivi des push

let __pushLogs = [];
let __pushFiltered = [];
let __pushDetail = null;

function pushChannelLabel(ch) {
    const s = (ch || '').trim().toLowerCase();
    if (s === 'linkedin') return '🔗 LinkedIn';
    if (s === 'other') return '📨 Autre';
    return '✉️ Email';
}

async function reloadPushLogs() {
    try {
        const res = await fetch('/api/push-logs');
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText || 'Erreur de chargement'}`);
        }
        const data = await res.json();
        __pushLogs = Array.isArray(data) ? data : [];
        applyPushFilters();
    } catch (err) {
        console.error('Erreur chargement push logs:', err);
        __pushLogs = [];
        applyPushFilters();
        if (window.showToast) {
            showToast(`❌ Impossible de charger l'historique des push: ${err.message}`, 'error');
        } else {
            throw err; // Re-throw si showToast n'est pas disponible
        }
    }
}

function applyPushFilters() {
    const q = (document.getElementById('pushSearch')?.value || '').trim().toLowerCase();
    const ch = (document.getElementById('pushChannelFilter')?.value || '').trim().toLowerCase();

    __pushFiltered = __pushLogs.filter(l => {
        const hay = (
            `${safeStr(l.prospect_name)} ${safeStr(l.company_groupe)} ${safeStr(l.company_site)} ${safeStr(l.prospect_email)} ${safeStr(l.to_email)} ${safeStr(l.subject)} ${safeStr(l.channel)}`
        ).toLowerCase();
        const okQ = !q || hay.includes(q);
        const okC = !ch || safeStr(l.channel).toLowerCase() === ch;
        return okQ && okC;
    });

    renderPushTable();
}

function renderPushTable() {
    const tbody = document.getElementById('pushTableBody');
    const empty = document.getElementById('pushEmptyState');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (__pushFiltered.length === 0) {
        if (empty) empty.style.display = 'block';
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 35px; color: var(--color-text-secondary);">Aucun résultat</td></tr>';
        return;
    }
    if (empty) empty.style.display = 'none';

    __pushFiltered.forEach(l => {
        const company = typeof formatPushCompany === 'function'
            ? formatPushCompany(l.company_groupe, l.company_site)
            : ((l.company_groupe || l.company_site) ? `${safeStr(l.company_groupe)} (${safeStr(l.company_site || '-')})` : '—');
        const dateFormatted = typeof formatPushDate === 'function'
            ? formatPushDate(l.sentAt || l.createdAt)
            : (l.sentAt || l.createdAt || '');
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td data-label="Date">${escapeHtml(dateFormatted)}</td>
            <td data-label="Prospect"><span class="table-cell-clamp" title="${escapeHtml(l.prospect_name || '')}">${escapeHtml(l.prospect_name || '')}</span></td>
            <td data-label="Entreprise"><span class="table-cell-clamp" title="${escapeHtml(company)}">${escapeHtml(company)}</span></td>
            <td data-label="Email"><span class="table-cell-clamp" title="${escapeHtml(l.to_email || l.prospect_email || '')}">${escapeHtml(l.to_email || l.prospect_email || '')}</span></td>
            <td data-label="Sujet"><span class="table-cell-clamp" title="${escapeHtml(safeStr(l.subject))}">${escapeHtml(safeStr(l.subject) || '—')}</span></td>
            <td data-label="Canal">${escapeHtml(pushChannelLabel(l.channel))}</td>
            <td data-label="Actions">
                <div class="table-actions-inline">
                    <button class="mini-action" onclick="openPushDetail(${l.id})">👁️</button>
                    <button class="mini-action danger" onclick="deletePushLog(${l.id})">🗑️</button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function openPushDetail(id) {
    const l = __pushLogs.find(x => x.id === id);
    if (!l) return;
    __pushDetail = l;

    const modal = document.getElementById('modalPushDetail');
    const body = document.getElementById('pushDetailBody');
    if (!modal || !body) return;

    const company = typeof formatPushCompany === 'function'
        ? formatPushCompany(l.company_groupe, l.company_site)
        : ((l.company_groupe || l.company_site) ? `${safeStr(l.company_groupe)} (${safeStr(l.company_site || '-')})` : '—');
    const dateFormatted = typeof formatPushDate === 'function'
        ? formatPushDate(l.sentAt || l.createdAt)
        : (l.sentAt || l.createdAt || '');

    body.innerHTML = `
        <div class="detail-info" style="margin-bottom: 10px;">
            <div><strong>Date:</strong> ${escapeHtml(dateFormatted)}</div>
            <div><strong>Prospect:</strong> ${escapeHtml(l.prospect_name || '')}</div>
            <div><strong>Entreprise:</strong> ${escapeHtml(company)}</div>
            <div><strong>Email:</strong> ${escapeHtml(l.to_email || l.prospect_email || '')}</div>
            <div><strong>Canal:</strong> ${escapeHtml(pushChannelLabel(l.channel))}</div>
            <div><strong>Template:</strong> ${escapeHtml(l.template_name || '—')}</div>
        </div>
        <div style="margin-top: 12px;">
            <div style="font-weight:700; margin-bottom: 6px;">Sujet</div>
            <div class="card" style="padding: 12px; border: 1px solid var(--color-border); border-radius: 12px; background: var(--color-surface-2);">${escapeHtml(l.subject || '—')}</div>
        </div>
        <div style="margin-top: 12px;">
            <div style="font-weight:700; margin-bottom: 6px;">Contenu</div>
            <pre style="white-space: pre-wrap; border: 1px solid var(--color-border); border-radius: 12px; padding: 12px; background: var(--color-surface-2); max-height: 360px; overflow:auto;">${escapeHtml(l.body || '')}</pre>
        </div>
    `;

    if (window.openModal) {
        window.openModal(modal);
    } else {
        modal.classList.add('active');
    }
}

function closePushDetail() {
    const modal = document.getElementById('modalPushDetail');
    if (modal) {
        if (window.closeModal) {
            window.closeModal(modal);
        } else {
            modal.classList.remove('active');
        }
    }
    __pushDetail = null;
}

async function deletePushLog(id) {
    const l = __pushLogs.find(x => x.id === id);
    const label = l ? `${safeStr(l.prospect_name)} — ${safeStr(l.sentAt || l.createdAt)}` : `ID ${id}`;
    if (!confirm(`⚠️ Supprimer ce push ?\n\n${label}`)) return;

    try {
        const res = await fetch('/api/push-logs/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });
        if (!res.ok) {
            let errorMsg = `HTTP ${res.status}`;
            try {
                const data = await res.json();
                errorMsg = data.error || errorMsg;
            } catch (e) {
                errorMsg = res.statusText || errorMsg;
            }
            showToast(`Impossible de supprimer: ${errorMsg}`, 'error');
            return; // Retourner early si échec, ne pas appeler reloadPushLogs()
        }
        // Recharger seulement si la suppression a réussi
        await reloadPushLogs();
    } catch (err) {
        console.error('Erreur suppression push log:', err);
        showToast(`Erreur lors de la suppression: ${err.message}`, 'error');
    }
}

function exportPushCSV() {
    const rows = __pushFiltered.map(l => ({
        date: typeof formatPushDate === 'function' ? formatPushDate(l.sentAt || l.createdAt) : (l.sentAt || l.createdAt || ''),
        prospect: l.prospect_name || '',
        entreprise: typeof formatPushCompany === 'function' ? formatPushCompany(l.company_groupe, l.company_site) : `${safeStr(l.company_groupe)} (${safeStr(l.company_site || '-')})`,
        email: l.to_email || l.prospect_email || '',
        sujet: l.subject || '',
        canal: l.channel || 'email',
    }));

    const headers = ['date', 'prospect', 'entreprise', 'email', 'sujet', 'canal'];
    const csv = [headers.join(',')].concat(
        rows.map(r => headers.map(h => {
            const v = (safeStr(r[h]) || '').replace(/\r\n|\r|\n/g, ' ');
            const escaped = v.replace(/"/g, '""');
            return `"${escaped}"`;
        }).join(','))
    ).join('\r\n');

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `push_logs_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
}

// ── Onglets ────────────────────────────────────────────────────────────────

function switchPushTab(tab) {
    const tabH = document.getElementById('tab-historique');
    const tabC = document.getElementById('tab-categories');
    const btnH = document.getElementById('tabBtnHistorique');
    const btnC = document.getElementById('tabBtnCategories');
    if (!tabH || !tabC) return;

    if (tab === 'historique') {
        tabH.style.display = '';
        tabC.style.display = 'none';
        btnH.style.color = 'var(--color-primary)';
        btnH.style.fontWeight = '700';
        btnH.style.borderBottom = '2px solid var(--color-primary)';
        btnC.style.color = 'var(--color-text-secondary)';
        btnC.style.fontWeight = '600';
        btnC.style.borderBottom = '2px solid transparent';
        if (!__historiqueLoaded) {
            reloadPushLogs().catch(err => {
                console.error(err);
                showToast("Impossible de charger l'historique des push.", 'error');
            });
            __historiqueLoaded = true;
        }
    } else {
        tabH.style.display = 'none';
        tabC.style.display = '';
        btnC.style.color = 'var(--color-primary)';
        btnC.style.fontWeight = '700';
        btnC.style.borderBottom = '2px solid var(--color-primary)';
        btnH.style.color = 'var(--color-text-secondary)';
        btnH.style.fontWeight = '600';
        btnH.style.borderBottom = '2px solid transparent';
        if (!__categoriesLoaded) {
            loadCategories();
            __categoriesLoaded = true;
        }
    }
}

// ── Catégories Push ────────────────────────────────────────────────────────

let __categories = [];
let __categoriesLoaded = false;
let __historiqueLoaded = false;
let __allCandidates = null; // cache pour le sélecteur de candidats par défaut

function __catEl(id) { return document.getElementById(id); }

async function loadCategories() {
    try {
        const res = await fetch('/api/push-categories');
        if (res.ok) __categories = await res.json();
    } catch (e) {}
    renderCategories();
}

function renderCategories() {
    const list = __catEl('catList');
    const empty = __catEl('catEmpty');
    if (!__categories.length) {
        if (list) list.innerHTML = '';
        if (empty) empty.style.display = 'block';
        return;
    }
    if (empty) empty.style.display = 'none';
    list.innerHTML = __categories.map(catCard).join('');
    __categories.forEach(cat => loadCatFiles(cat.id));
}

async function loadCatFiles(catId) {
    const box = __catEl(`catFiles_${catId}`);
    if (!box) return;
    try {
        const res = await fetch(`/api/push-categories/${catId}/files`);
        if (!res.ok) { box.innerHTML = '<span class="muted">Erreur de chargement</span>'; return; }
        const data = await res.json();
        if (data.ok && data.files && data.files.length) {
            box.innerHTML = data.files.map(f => `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:4px 0; border-bottom:1px solid var(--color-border);">
                    <span>📄 ${escapeHtml(f.name)} <span class="muted" style="font-size:10px;">${(f.size/1024).toFixed(0)} Ko</span></span>
                    <button onclick="deleteCatTemplate(${catId}, '${escapeHtml(f.name)}')" style="background:none;border:none;cursor:pointer;color:var(--color-danger,#ef4444);font-size:13px;padding:2px 6px;" title="Supprimer ce template">🗑️</button>
                </div>
            `).join('');
        } else {
            box.innerHTML = '<span class="muted">Aucun template — cliquez "Ajouter" pour en importer un.</span>';
        }
    } catch (e) {
        box.innerHTML = '<span class="muted">Erreur</span>';
    }
}

async function uploadCatTemplate(catId, input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
        showToast('Upload en cours…', 'info');
        const res = await fetch(`/api/push-categories/${catId}/upload-template`, { method: 'POST', body: formData });
        const data = await res.json();
        if (data.ok) {
            showToast('Template ajouté !', 'success');
            loadCatFiles(catId);
        } else {
            showToast('❌ ' + (data.error || 'Erreur upload'), 'error');
        }
    } catch (e) {
        showToast('❌ Erreur réseau : ' + e.message, 'error');
    } finally {
        input.value = '';
    }
}

async function deleteCatTemplate(catId, filename) {
    if (!confirm(`Supprimer le template "${filename}" ?`)) return;
    try {
        const res = await fetch(`/api/push-categories/${catId}/delete-template`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename })
        });
        const data = await res.json();
        if (data.ok) {
            showToast('Template supprimé', 'success');
            loadCatFiles(catId);
        } else {
            showToast('❌ ' + (data.error || 'Erreur'), 'error');
        }
    } catch (e) {
        showToast('❌ Erreur réseau : ' + e.message, 'error');
    }
}

function _catCandidateSlotHtml(cat, slot) {
    const cid  = cat[`candidate${slot}_id`];
    const name = cat[`candidate${slot}_name`];
    const role = cat[`candidate${slot}_role`];
    const label = cid
        ? `<span style="font-size:12px;">${escapeHtml(name || '')}${role ? ' · <span style="color:var(--color-text-secondary);">' + escapeHtml(role) + '</span>' : ''}</span>`
        : `<span class="muted" style="font-size:12px;">Non défini</span>`;
    const clearBtn = cid
        ? `<button onclick="clearCatCandidate(${cat.id},${slot})" style="background:none;border:none;cursor:pointer;color:var(--color-text-secondary);font-size:11px;padding:2px 4px;" title="Effacer">✕</button>`
        : '';
    return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
        <span style="font-size:11px;color:var(--color-text-secondary);min-width:72px;flex-shrink:0;">Candidat ${slot} :</span>
        <span style="flex:1;">${label}</span>
        <button onclick="editCatCandidate(${cat.id},${slot})" style="background:none;border:none;cursor:pointer;font-size:11px;padding:2px 6px;" title="Modifier">✏️</button>
        ${clearBtn}
    </div>`;
}

function catCard(cat) {
    const kw = Array.isArray(cat.keywords) ? cat.keywords : [];
    const kwHtml = kw.length
        ? kw.map(k => `<span class="tag-pill" style="font-size:10px;padding:2px 8px;">${escapeHtml(k)}</span>`).join(' ')
        : '<span class="muted">Aucun mot-clé</span>';
    const auto = cat.auto_detected ? '<span class="tag-pill" style="font-size:9px;padding:1px 6px;background:rgba(34,197,94,0.1);color:#22c55e;border-color:rgba(34,197,94,0.2);">auto</span>' : '';
    return `
        <div class="card" style="margin-bottom: 10px;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
                <div style="flex:1; min-width:0;">
                    <div style="font-weight:800; font-size:15px;">${escapeHtml(cat.name)} ${auto}</div>
                    <div style="margin-top:6px; display:flex; flex-wrap:wrap; gap:4px;">${kwHtml}</div>
                </div>
                <div style="display:flex; gap:6px; flex-shrink:0;">
                    <button class="btn btn-secondary" style="padding:5px 10px;font-size:11px;" onclick="openCatProspects(${cat.id})" title="Voir les prospects les plus pertinents pour cette catégorie">👤 Prospects</button>
                    <button class="btn btn-secondary" style="padding:5px 10px;font-size:11px;" onclick="editCat(${cat.id})">✏️</button>
                    <button class="btn btn-danger" style="padding:5px 10px;font-size:11px;" onclick="deleteCat(${cat.id})">🗑️</button>
                </div>
            </div>
            <div style="margin-top:10px; padding-top:10px; border-top:1px solid var(--color-border);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                    <span style="font-weight:600; font-size:12px; color:var(--color-text-secondary);">👤 Candidats par défaut</span>
                    <button onclick="autoSuggestCandidates(${cat.id})" style="font-size:11px;padding:3px 10px;background:var(--color-surface-2,rgba(255,255,255,0.06));border:1px solid var(--color-border);border-radius:8px;cursor:pointer;" title="Suggérer automatiquement les 2 meilleurs candidats">🔁 Auto</button>
                </div>
                <div id="catCandidateSlots_${cat.id}">
                    ${_catCandidateSlotHtml(cat, 1)}
                    ${_catCandidateSlotHtml(cat, 2)}
                </div>
            </div>
            <div style="margin-top:10px; padding-top:10px; border-top:1px solid var(--color-border);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                    <span style="font-weight:600; font-size:12px; color:var(--color-text-secondary);">📧 Templates email (.msg)</span>
                    <label style="cursor:pointer; font-size:11px; padding:4px 10px; background:var(--color-surface-2,rgba(255,255,255,0.06)); border:1px solid var(--color-border); border-radius:8px; display:flex; align-items:center; gap:4px;" title="Ajouter un template .msg pour cette catégorie">
                        📤 Ajouter
                        <input type="file" accept=".msg,.eml,.oft" style="display:none;" onchange="uploadCatTemplate(${cat.id}, this)">
                    </label>
                </div>
                <div id="catFiles_${cat.id}" style="font-size:12px; color:var(--color-text-secondary);">
                    <span class="muted">Chargement…</span>
                </div>
            </div>
        </div>
    `;
}

async function _loadAllCandidatesCache() {
    if (__allCandidates) return;
    try {
        const res = await fetch('/api/candidates');
        const data = await res.json();
        __allCandidates = (data.candidates || data || []).filter(c => !c.is_archived);
        __allCandidates.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } catch (e) {
        __allCandidates = [];
    }
}

async function saveCatCandidates(catId, c1Id, c2Id) {
    await fetch(`/api/push-categories/${catId}/set-candidates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidate1_id: c1Id || null, candidate2_id: c2Id || null })
    });
}

async function autoSuggestCandidates(catId) {
    try {
        showToast('Recherche des meilleurs candidats…', 'info', 2000);
        const res = await fetch(`/api/push-categories/${catId}/match-candidates`);
        const data = await res.json();
        if (!data.ok) { showToast('❌ ' + (data.error || 'Erreur'), 'error'); return; }
        const top2 = (data.candidates || []).slice(0, 2);
        await saveCatCandidates(catId, top2[0]?.id || null, top2[1]?.id || null);
        // Mettre à jour __categories et re-render les slots
        const cat = __categories.find(c => c.id === catId);
        if (cat) {
            cat.candidate1_id = top2[0]?.id || null;
            cat.candidate1_name = top2[0]?.name || null;
            cat.candidate1_role = top2[0]?.role || null;
            cat.candidate2_id = top2[1]?.id || null;
            cat.candidate2_name = top2[1]?.name || null;
            cat.candidate2_role = top2[1]?.role || null;
            const box = document.getElementById(`catCandidateSlots_${catId}`);
            if (box) box.innerHTML = _catCandidateSlotHtml(cat, 1) + _catCandidateSlotHtml(cat, 2);
        }
        if (top2.length === 0) showToast('Aucun candidat trouvé pour ces mots-clés', 'warning');
        else showToast(`${top2.length} candidat(s) suggéré(s) automatiquement`, 'success');
    } catch (e) {
        showToast('❌ Erreur : ' + e.message, 'error');
    }
}

async function editCatCandidate(catId, slot) {
    await _loadAllCandidatesCache();
    const cat = __categories.find(c => c.id === catId);
    const currentId = cat?.[`candidate${slot}_id`] || '';
    const otherSlot = slot === 1 ? 2 : 1;
    const otherId = cat?.[`candidate${otherSlot}_id`] || null;
    const box = document.getElementById(`catCandidateSlots_${catId}`);
    if (!box) return;
    const options = __allCandidates.map(c =>
        `<option value="${c.id}" ${c.id == currentId ? 'selected' : ''}>${escapeHtml(c.name || '')}${c.role ? ' · ' + escapeHtml(c.role) : ''}</option>`
    ).join('');
    box.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px;">
            <span style="font-size:11px;color:var(--color-text-secondary);min-width:72px;flex-shrink:0;">Candidat ${slot} :</span>
            <select id="catCandSlot_${catId}_${slot}" style="flex:1;min-width:0;font-size:12px;padding:3px 6px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-surface-2,rgba(255,255,255,0.08));color:inherit;">
                <option value="">— Aucun —</option>
                ${options}
            </select>
            <button onclick="confirmCatCandidate(${catId},${slot},${otherId})" style="font-size:12px;padding:3px 10px;border-radius:6px;border:none;background:var(--color-primary,#f97316);color:#fff;cursor:pointer;">✔</button>
            <button onclick="cancelEditCatCandidate(${catId})" style="font-size:12px;padding:3px 8px;border-radius:6px;border:1px solid var(--color-border);background:none;cursor:pointer;">✕</button>
        </div>`;
}

async function confirmCatCandidate(catId, slot, otherId) {
    const sel = document.getElementById(`catCandSlot_${catId}_${slot}`);
    const newId = sel?.value ? Number(sel.value) : null;
    const c1 = slot === 1 ? newId : otherId;
    const c2 = slot === 2 ? newId : otherId;
    await saveCatCandidates(catId, c1, c2);
    // Mettre à jour le cache local et re-render
    const cat = __categories.find(c => c.id === catId);
    if (cat) {
        const picked = newId ? __allCandidates?.find(c => c.id === newId) : null;
        cat[`candidate${slot}_id`]   = newId;
        cat[`candidate${slot}_name`] = picked?.name || null;
        cat[`candidate${slot}_role`] = picked?.role || null;
        const box = document.getElementById(`catCandidateSlots_${catId}`);
        if (box) box.innerHTML = _catCandidateSlotHtml(cat, 1) + _catCandidateSlotHtml(cat, 2);
    }
    showToast('Candidat enregistré', 'success', 2000);
}

function cancelEditCatCandidate(catId) {
    const cat = __categories.find(c => c.id === catId);
    if (!cat) return;
    const box = document.getElementById(`catCandidateSlots_${catId}`);
    if (box) box.innerHTML = _catCandidateSlotHtml(cat, 1) + _catCandidateSlotHtml(cat, 2);
}

async function clearCatCandidate(catId, slot) {
    const cat = __categories.find(c => c.id === catId);
    const c1 = slot === 1 ? null : (cat?.candidate1_id || null);
    const c2 = slot === 2 ? null : (cat?.candidate2_id || null);
    await saveCatCandidates(catId, c1, c2);
    if (cat) {
        cat[`candidate${slot}_id`]   = null;
        cat[`candidate${slot}_name`] = null;
        cat[`candidate${slot}_role`] = null;
        const box = document.getElementById(`catCandidateSlots_${catId}`);
        if (box) box.innerHTML = _catCandidateSlotHtml(cat, 1) + _catCandidateSlotHtml(cat, 2);
    }
    showToast('Candidat effacé', 'info', 2000);
}

function showCatEditor(show) {
    const el = __catEl('catEditor');
    if (el) el.style.display = show ? 'block' : 'none';
}

function resetCatEditor() {
    __catEl('catEditorTitle').textContent = 'Nouvelle catégorie';
    __catEl('catId').value = '';
    __catEl('catName').value = '';
    __catEl('catKeywords').value = '';
}

function editCat(id) {
    const cat = __categories.find(c => c.id === id);
    if (!cat) return;
    __catEl('catEditorTitle').textContent = 'Modifier: ' + cat.name;
    __catEl('catId').value = cat.id;
    __catEl('catName').value = cat.name;
    __catEl('catKeywords').value = (Array.isArray(cat.keywords) ? cat.keywords : []).join(', ');
    showCatEditor(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteCat(id) {
    const cat = __categories.find(c => c.id === id);
    if (!confirm('Supprimer "' + (cat?.name || id) + '" ?')) return;
    await fetch('/api/push-categories/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
    });
    await loadCategories();
}

async function saveCat() {
    const name = __catEl('catName').value.trim();
    if (!name) { showToast('Nom requis', 'warning'); return; }
    const keywords = __catEl('catKeywords').value.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
    const payload = {
        id: __catEl('catId').value ? Number(__catEl('catId').value) : null,
        name,
        keywords
    };
    await fetch('/api/push-categories/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    showCatEditor(false);
    resetCatEditor();
    await loadCategories();
}

async function scanPushs() {
    const btn = __catEl('btnScanPushs');
    if (btn) btn.textContent = '⏳ Scan en cours...';
    try {
        const res = await fetch('/api/push-categories/scan', { method: 'POST' });
        const data = await res.json();
        if (data.ok) {
            showToast('Scan terminé ! Dossiers : ' + (data.found?.join(', ') || 'aucun') + ' — Nouvelles catégories : ' + (data.created || 0), 'success', 5000);
        } else {
            showToast('❌ ' + (data.error || 'Erreur'), 'error');
        }
    } catch (e) {
        showToast('❌ Erreur: ' + e.message, 'error');
    }
    if (btn) btn.textContent = '🔄 Scanner pushs/';
    await loadCategories();
}

// ── Prospects suggérés par catégorie ──────────────────────────────────────

let __catProspectsCatId = null;

async function openCatProspects(catId) {
    __catProspectsCatId = catId;
    const modal = document.getElementById('modalCatProspects');
    if (!modal) return;
    const title = document.getElementById('modalCatProspectsTitle');
    const cat = __categories.find(c => c.id === catId);
    if (title) title.textContent = `Prospects suggérés — ${cat ? escapeHtml(cat.name) : ''}`;
    document.getElementById('catProspectsList').innerHTML = '<div style="text-align:center;padding:20px;color:var(--color-text-secondary);">Chargement…</div>';
    document.getElementById('catProspectsInfo').textContent = '';
    if (window.openModal) window.openModal(modal); else modal.classList.add('active');
    await _fetchAndRenderCatProspects(catId);
}

function closeCatProspects() {
    const modal = document.getElementById('modalCatProspects');
    if (modal) {
        if (window.closeModal) window.closeModal(modal); else modal.classList.remove('active');
    }
    __catProspectsCatId = null;
}

async function refreshCatProspects() {
    if (!__catProspectsCatId) return;
    const btn = document.getElementById('btnRefreshCatProspects');
    if (btn) btn.disabled = true;
    document.getElementById('catProspectsList').innerHTML = '<div style="text-align:center;padding:20px;color:var(--color-text-secondary);">Chargement…</div>';
    await _fetchAndRenderCatProspects(__catProspectsCatId);
    if (btn) btn.disabled = false;
}

async function _fetchAndRenderCatProspects(catId) {
    try {
        const res = await fetch(`/api/push-categories/${catId}/match-prospects`);
        const data = await res.json();
        if (!data.ok) {
            document.getElementById('catProspectsList').innerHTML = `<div style="color:var(--color-danger,#ef4444);padding:12px;">❌ ${escapeHtml(data.error || 'Erreur')}</div>`;
            return;
        }
        _renderCatProspectsList(data);
    } catch (e) {
        document.getElementById('catProspectsList').innerHTML = `<div style="color:var(--color-danger,#ef4444);padding:12px;">❌ Erreur réseau : ${escapeHtml(e.message)}</div>`;
    }
}

function _renderCatProspectsList(data) {
    const prospects = data.prospects || [];
    const info = document.getElementById('catProspectsInfo');
    const list = document.getElementById('catProspectsList');

    if (info) {
        const kwPills = (data.keywords || []).map(k => `<span class="tag-pill" style="font-size:10px;padding:1px 7px;">${escapeHtml(k)}</span>`).join(' ');
        info.innerHTML = `Mots-clés : ${kwPills || '<span class="muted">—</span>'} &nbsp;·&nbsp; ${data.total_scored || 0} prospect(s) avec correspondance sur ${data.total_available || 0} éligibles`;
    }

    if (!prospects.length) {
        list.innerHTML = '<div style="text-align:center;padding:30px;color:var(--color-text-secondary);">Aucun prospect éligible (email sans téléphone, jamais pushé).</div>';
        return;
    }

    list.innerHTML = prospects.map(p => {
        const tagPills = (p.tags || []).map(t => `<span class="tag-pill" style="font-size:10px;padding:1px 7px;">${escapeHtml(t)}</span>`).join(' ');
        const matchedPills = (p.matched_keywords || []).map(k => `<span class="tag-pill" style="font-size:10px;padding:1px 7px;background:rgba(249,115,22,0.12);color:var(--color-primary);border-color:rgba(249,115,22,0.25);">${escapeHtml(k)}</span>`).join(' ');
        const scoreBar = p.score > 0
            ? `<span style="font-size:10px;font-weight:700;color:var(--color-primary);margin-left:6px;">▲${p.score} pts</span>`
            : '';

        return `<div style="padding:10px 0;border-bottom:1px solid var(--color-border);display:flex;flex-direction:column;gap:4px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                <div style="font-weight:700;font-size:13px;">${escapeHtml(p.name)}${scoreBar}</div>
                <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;">
                    <button onclick="_openProspectFromCategory(${p.id}, __catProspectsCatId)" title="Voir la fiche complète (catégorie pré-sélectionnée)" style="background:none;border:1px solid var(--color-border);border-radius:6px;cursor:pointer;font-size:11px;padding:3px 8px;color:var(--color-text);">👁️ Fiche</button>
                    <button onclick="_catProspectSendEmail(${p.id})" title="Envoyer un email push" style="background:none;border:1px solid var(--color-border);border-radius:6px;cursor:pointer;font-size:11px;padding:3px 8px;color:var(--color-text);">✉️ Email</button>
                </div>
            </div>
            <div style="font-size:11px;color:var(--color-text-secondary);">
                ${p.email ? escapeHtml(p.email) + ' · ' : ''}${p.fonction ? escapeHtml(p.fonction) : ''}${p.company ? ' · ' + escapeHtml(p.company) : ''}
            </div>
            ${tagPills ? `<div style="display:flex;flex-wrap:wrap;gap:3px;">${tagPills}</div>` : ''}
            ${matchedPills ? `<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:2px;">${matchedPills}</div>` : ''}
        </div>`;
    }).join('');
}

function _openProspectFromCategory(prospectId, catId) {
    // Pré-sélectionner la catégorie push dans la fiche avant ouverture
    if (catId && typeof data !== 'undefined' && Array.isArray(data.prospects)) {
        const p = data.prospects.find(x => x.id === prospectId);
        if (p) p.push_category_id = Number(catId);
    }
    if (typeof viewDetail === 'function') viewDetail(prospectId);
}

async function _catProspectSendEmail(prospectId) {
    if (typeof openEmailForProspect === 'function') {
        await openEmailForProspect(prospectId);
    } else {
        const p = (typeof data !== 'undefined' && data.prospects)
            ? data.prospects.find(x => x.id === prospectId)
            : null;
        if (p && p.email) window.location.href = 'mailto:' + encodeURIComponent(p.email);
        else showToast('⚠️ Email introuvable pour ce prospect.', 'warning');
    }
}

// ── Init ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const fn = window.bootstrap || window.appBootstrap;
        if (typeof fn === 'function') await fn('push');
    } catch (e) {}

    const q = document.getElementById('pushSearch');
    const f = document.getElementById('pushChannelFilter');
    q && q.addEventListener('input', applyPushFilters);
    f && f.addEventListener('change', applyPushFilters);

    // Boutons catégories
    const btnNew = document.getElementById('btnNewCat');
    const btnScan = document.getElementById('btnScanPushs');
    const btnCancel = document.getElementById('btnCancelCat');
    const btnSave = document.getElementById('btnSaveCat');
    if (btnNew) btnNew.addEventListener('click', () => { resetCatEditor(); showCatEditor(true); });
    if (btnScan) btnScan.addEventListener('click', scanPushs);
    if (btnCancel) btnCancel.addEventListener('click', () => { showCatEditor(false); resetCatEditor(); });
    if (btnSave) btnSave.addEventListener('click', saveCat);

    // Onglet Catégories actif par défaut
    loadCategories();
    __categoriesLoaded = true;
});
