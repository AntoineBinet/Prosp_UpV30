// Sourcing candidats (v5) : Pipeline + Productivité (matching entreprises)

let __candidates = [];
let __candFiltered = [];
let __candEditing = null;

// EC1 quick action (modal)
let __ec1CandidateId = null;

function _pad2(n) { return String(n).padStart(2, '0'); }
function _defaultEC1DatetimeLocal() {
    const d = new Date();
    // default: tomorrow 09:00
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return `${d.getFullYear()}-${_pad2(d.getMonth()+1)}-${_pad2(d.getDate())}T${_pad2(d.getHours())}:${_pad2(d.getMinutes())}`;
}

function openEC1Modal(ev, candidateId) {
    try { ev && ev.stopPropagation && ev.stopPropagation(); } catch(e) {}
    __ec1CandidateId = candidateId;
    const modal = document.getElementById('modalEC1');
    if (!modal) return;
    const dt = document.getElementById('ec1ModalDatetime');
    const note = document.getElementById('ec1ModalNote');
    if (dt && !dt.value) dt.value = _defaultEC1DatetimeLocal();
    if (note) note.value = '';
    if (window.openModal) {
        window.openModal(modal, { focusElement: '#ec1ModalDatetime' });
    } else {
        modal.classList.add('active');
    }
}

function closeEC1Modal() {
    const modal = document.getElementById('modalEC1');
    if (modal) {
        if (window.closeModal) {
            window.closeModal(modal);
        } else {
            modal.classList.remove('active');
        }
    }
    __ec1CandidateId = null;
}

async function confirmEC1() {
    const cid = __ec1CandidateId;
    if (!cid) return;
    const dt = (document.getElementById('ec1ModalDatetime')?.value || '').trim();
    const note = (document.getElementById('ec1ModalNote')?.value || '').trim();

    if (!dt) {
        if (typeof showToast === 'function') {
            showToast('❌ Date & heure requises pour planifier EC1', 'error');
        } else {
            alert('❌ Date & heure requises pour planifier EC1.');
        }
        return;
    }

    try {
        // 1) set candidate status
        const r1 = await fetch('/api/candidates/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: cid, status: 'ec1' })
        });
        if (!r1.ok) throw new Error(await r1.text().catch(()=> 'HTTP ' + r1.status));

        // 2) create/update EC1 checklist (interview date + optional note)
        const data = { "__note": note };
        const r2 = await fetch('/api/ec1-checklist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ candidate_id: cid, interviewAt: dt, data })
        });
        if (!r2.ok) throw new Error(await r2.text().catch(()=> 'HTTP ' + r2.status));

        closeEC1Modal();
        await loadCandidates();
        applyCandidateFilters();

        // Open candidate page directly on EC1 section
        window.location.href = `/candidat?id=${cid}&section=ec1`;
    } catch(e) {
        console.error(e);
        if (typeof showToast === 'function') {
            showToast('❌ Impossible de planifier EC1 : ' + (e?.message || e), 'error');
        } else {
            alert('❌ Impossible de planifier EC1 : ' + (e?.message || e));
        }
    }
}


// Productivité
let __activeKeywords = [];
let __customKeywords = []; // ajoutés par l'utilisateur (persistés)
let __selectedCompanyIds = [];

function candSkillsArray(c) {
    if (!c) return [];
    const v = c.skills;
    if (Array.isArray(v)) return v.map(x => safeStr(x).trim()).filter(Boolean);
    // fallback: allow string "a, b, c"
    const s = safeStr(v).trim();
    if (!s) return [];
    return s.split(',').map(x => x.trim()).filter(Boolean);
}

function normalizeSkill(s) { return safeStr(s).trim().toLowerCase(); }

function parseSkillsFilter() {
    const raw = (document.getElementById('candSkillsFilter')?.value || '').trim();
    if (!raw) return [];
    return raw
        .split(',')
        .map(x => normalizeSkill(x))
        .filter(Boolean);
}

function candStatusLabel(s) {
    const v = (s || '').toLowerCase();
    if (v === 'a_sourcer') return '🧲 À sourcer';
    if (v === 'a_contacter') return '📨 À contacter';
    if (v === 'en_cours') return '⏳ En cours';
    if (v === 'ec1') return '📞 EC1';
    if (v === 'ec2') return '📞📞 EC2';
    if (v === 'ed') return '📋 ED';
    if (v === 'interesse') return '✅ Intéressé';
    if (v === 'mission') return '🚀 Mission';
    if (v === 'refuse') return '❌ Refusé';
    if (v === 'embauche') return '🎉 Embauché';
    if (v === 'archive') return '📦 Archivé';
    return s || '—';
}
function safeStr(v) { return (v === null || v === undefined) ? '' : String(v); }

function renderClampCell(value, extraClass = '') {
    const txt = safeStr(value);
    const cls = `table-cell-clamp ${extraClass}`.trim();
    return `<span class="${cls}" title="${escapeHtml(txt)}">${escapeHtml(txt || '—')}</span>`;
}

function toTokens(txt) {
    return safeStr(txt)
        .toLowerCase()
        .replace(/[^a-z0-9àâäéèêëïîôöùûüç\+\#\-\s]/g, ' ')
        .split(/\s+/)
        .map(t => t.trim())
        .filter(t => t.length >= 2);
}

const STOP = new Set([
    'de','des','du','le','la','les','un','une','et','ou','au','aux','en','dans','sur','avec','pour','par','chez','ce','cet','cette','ces',
    'je','tu','il','elle','on','nous','vous','ils','elles','mon','ma','mes','ton','ta','tes','son','sa','ses','notre','votre','leur','leurs',
    'the','and','or','with','for','from','into','on','in','to','a','an','is','are','as','at','by','of','this','that'
]);

function uniq(arr) {
    const out = [];
    const set = new Set();
    arr.forEach(x => {
        const k = safeStr(x).trim();
        if (!k) return;
        const lk = k.toLowerCase();
        if (set.has(lk)) return;
        set.add(lk);
        out.push(k);
    });
    return out;
}

async function loadCandidates() {
    const res = await fetch('/api/candidates');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    __candidates = await res.json();
    if (!Array.isArray(__candidates)) __candidates = [];
}

function applyCandidateFilters() {
    const q = (document.getElementById('candSearch')?.value || '').trim().toLowerCase();
    const st = (document.getElementById('candStatusFilter')?.value || '').trim().toLowerCase();
    const skillsNeed = parseSkillsFilter();

    __candFiltered = __candidates.filter(c => {
        const skills = candSkillsArray(c);
        const hay = `${safeStr(c.name)} ${safeStr(c.role)} ${safeStr(c.location)} ${skills.join(' ')} ${safeStr(c.tech)} ${safeStr(c.notes)} ${safeStr(c.linkedin)} ${safeStr(c.source)}`.toLowerCase();
        const okQ = !q || hay.includes(q);
        const okS = !st || safeStr(c.status).toLowerCase() === st;
        // Hide archived unless explicitly filtered
        const okArchive = st === 'archive' || !c.is_archived;
        // skills filter = AND over requested skills
        let okSkills = true;
        if (skillsNeed.length) {
            const skillSet = new Set(skills.map(normalizeSkill));
            const techText = safeStr(c.tech).toLowerCase();
            okSkills = skillsNeed.every(sk => skillSet.has(sk) || techText.includes(sk));
        }
        return okQ && okS && okSkills && okArchive;
    });

    renderCandidateTable();
}

function renderCandidateTable() {
    const tbody = document.getElementById('candTableBody');
    const empty = document.getElementById('candEmptyState');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (__candFiltered.length === 0) {
        if (empty) empty.style.display = 'block';
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 35px; color: var(--color-text-secondary);">Aucun résultat</td></tr>';
        return;
    }
    if (empty) empty.style.display = 'none';

    __candFiltered.forEach(c => {
        const skills = candSkillsArray(c);
        const skillsLabel = skills.join(', ');
        const combinedTech = skillsLabel ? (skillsLabel + (c.tech ? ' · ' + safeStr(c.tech) : '')) : safeStr(c.tech);
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', (e) => {
            // Don't navigate if clicking on action buttons/links
            if (e.target.closest('.mini-action, button, a')) return;
            window.location.href = '/candidat?id=' + c.id;
        });
        tr.innerHTML = `
            <td data-label="Nom"><span title="${escapeHtml(c.name || '')}">${escapeHtml(c.name || '')}</span></td>
            <td data-label="Rôle">${renderClampCell(c.role, 'table-cell-clamp--wide')}</td>
            <td data-label="Localisation">${renderClampCell(c.location, 'table-cell-clamp--wide')}</td>
            <td data-label="Compétences / Tech">${renderClampCell(combinedTech)}</td>
            <td data-label="Statut"><span class="badge">${escapeHtml(candStatusLabel(c.status))}</span></td>
            <td data-label="MAJ">${escapeHtml((c.updatedAt || c.createdAt || '').slice(0, 10))}</td>
            <td data-label="Actions">
              <div class="table-actions-inline">
                <a class="mini-action" href="/candidat?id=${c.id}" title="Fiche candidat">👤</a>
                ${c.linkedin ? `<a class="mini-action" href="${escapeHtml(c.linkedin)}" target="_blank" title="LinkedIn">🔗</a>` : ''}
                <button class="mini-action" onclick="openEC1Modal(event, ${c.id})" title="Planifier EC1">📞 EC1</button>
                <button class="mini-action" onclick="editCandidate(${c.id})">✏️</button>
                <button class="mini-action danger" onclick="deleteCandidate(${c.id})">🗑️</button>
              </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function openCandidateModal(editing=false) {
    const modal = document.getElementById('modalCandidate');
    if (!modal) return;
    document.getElementById('candModalTitle').textContent = editing ? 'Modifier candidat' : 'Ajouter candidat';
    if (window.openModal) {
        window.openModal(modal, { focusElement: '#candName' });
    } else {
        modal.classList.add('active');
    }
}
function closeCandidateModal() {
    const modal = document.getElementById('modalCandidate');
    if (modal) {
        if (window.closeModal) {
            window.closeModal(modal);
        } else {
            modal.classList.remove('active');
        }
    }
    __candEditing = null;
    try { document.getElementById('candForm')?.reset(); } catch(e) {}
}

function fillCandidateForm(c) {
    document.getElementById('candName').value = safeStr(c.name);
    document.getElementById('candRole').value = safeStr(c.role);
    document.getElementById('candLocation').value = safeStr(c.location);
    document.getElementById('candSeniority').value = safeStr(c.seniority);
    document.getElementById('candTech').value = safeStr(c.tech);
    document.getElementById('candLinkedin').value = safeStr(c.linkedin);
    document.getElementById('candSource').value = safeStr(c.source);
    document.getElementById('candStatus').value = safeStr(c.status || 'a_sourcer');
    document.getElementById('candNotes').value = safeStr(c.notes);
    const vsaEl = document.getElementById('candVsaUrl');
    if (vsaEl) vsaEl.value = safeStr(c.vsa_url || '');
}

function editCandidate(id) {
    const c = __candidates.find(x => x.id === id);
    if (!c) return;
    __candEditing = c;
    fillCandidateForm(c);
    openCandidateModal(true);
}

async function saveCandidate(e) {
    e.preventDefault();

    const vsaUrlEl = document.getElementById('candVsaUrl');
    const payload = {
        id: __candEditing ? __candEditing.id : null,
        name: document.getElementById('candName').value.trim(),
        role: document.getElementById('candRole').value.trim(),
        location: document.getElementById('candLocation').value.trim(),
        seniority: document.getElementById('candSeniority').value.trim(),
        tech: document.getElementById('candTech').value.trim(),
        linkedin: document.getElementById('candLinkedin').value.trim(),
        source: document.getElementById('candSource').value.trim(),
        status: document.getElementById('candStatus').value,
        notes: document.getElementById('candNotes').value.trim(),
    };
    if (vsaUrlEl && vsaUrlEl.value) payload.vsa_url = vsaUrlEl.value.trim();

    const res = await fetch('/api/candidates/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        const txt = await res.text().catch(()=> '');
        if (typeof showToast === 'function') {
            showToast('❌ Enregistrement impossible: ' + (txt || ('HTTP ' + res.status)), 'error');
        } else {
            alert('❌ Enregistrement impossible: ' + (txt || ('HTTP ' + res.status)));
        }
        return;
    }

    closeCandidateModal();
    await loadCandidates();
    applyCandidateFilters();
    refreshProductivityMatching();
}

async function deleteCandidate(id) {
    const c = __candidates.find(x => x.id === id);
    const label = c ? safeStr(c.name) : `ID ${id}`;
    if (!confirm(`⚠️ Supprimer ce candidat ?\n\n${label}`)) return;

    const res = await fetch('/api/candidates/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
    });

    if (!res.ok) {
        const txt = await res.text().catch(()=> '');
        if (typeof showToast === 'function') {
            showToast('❌ Suppression impossible: ' + (txt || ('HTTP ' + res.status)), 'error');
        } else {
            alert('❌ Suppression impossible: ' + (txt || ('HTTP ' + res.status)));
        }
        return;
    }

    await loadCandidates();
    applyCandidateFilters();
    refreshProductivityMatching();
}

// ===== Ajouter via VSA =====
const VSA_MIN_LENGTH = 20;

// Rendre les fonctions VSA globales pour accès depuis Quick Add
// TOUT SE PASSE CÔTÉ CLIENT - aucune fenêtre ne s'ouvre sur le serveur
window.openVsaImportModal = function openVsaImportModal() {
    const modal = document.getElementById('modalVsaImport');
    if (!modal) {
        if (typeof showToast === 'function') {
            showToast('Modale VSA introuvable. Rechargez la page.', 'error');
        }
        return;
    }
    // Réinitialiser les champs
    const linkEl = document.getElementById('vsaImportLink');
    const textareaEl = document.getElementById('vsaImportTextarea');
    const errorEl = document.getElementById('vsaImportError');
    const prefillBtn = document.getElementById('btnVsaPreFillAnyway');
    const extractBtn = document.getElementById('btnVsaExtractOllama');
    
    if (linkEl) linkEl.value = '';
    if (textareaEl) textareaEl.value = '';
    if (errorEl) {
        errorEl.style.display = 'none';
        errorEl.textContent = '';
    }
    if (prefillBtn) prefillBtn.style.display = 'none';
    if (extractBtn) {
        extractBtn.disabled = true;
        extractBtn.textContent = '🤖 Extraire avec Ollama';
    }
    if (typeof _vsaImportToggleExtractButton === 'function') {
        _vsaImportToggleExtractButton();
    }
    
    // Ouvrir la modale (tout se passe dans le navigateur de l'utilisateur)
    // S'assurer que la modale est dans le body (pas dans un conteneur caché)
    if (modal.parentElement !== document.body) {
        document.body.appendChild(modal);
    }
    
    // Forcer l'affichage de manière directe
    modal.classList.add('active');
    
    // Appliquer les styles inline pour garantir l'affichage
    modal.style.cssText = `
        display: flex !important;
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        z-index: 99999 !important;
        background: rgba(0, 0, 0, 0.5) !important;
        align-items: center !important;
        justify-content: center !important;
        visibility: visible !important;
        opacity: 1 !important;
    `;
    
    // S'assurer que le modal-content est visible
    const modalContent = modal.querySelector('.modal-content');
    if (modalContent) {
        modalContent.style.cssText = `
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
            position: relative !important;
            z-index: 100000 !important;
        `;
    }
    
    // Utiliser openModal si disponible (pour la gestion du focus et des événements)
    if (window.openModal) {
        try {
            window.openModal(modal, { focusElement: '#vsaImportTextarea' });
        } catch (e) {
            // Fallback silencieux
        }
    }
    
    // Focus sur le textarea après un court délai
    setTimeout(() => {
        if (textareaEl) textareaEl.focus();
    }, 100);
}

window.closeVsaImportModal = function closeVsaImportModal() {
    const modal = document.getElementById('modalVsaImport');
    if (modal) {
        modal.classList.remove('active');
        modal.style.cssText = '';
        if (window.closeModal) {
            try {
                window.closeModal(modal);
            } catch (e) {}
        }
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
    }
}

function _vsaImportToggleExtractButton() {
    const ta = document.getElementById('vsaImportTextarea');
    const btn = document.getElementById('btnVsaExtractOllama');
    if (!btn || !ta) return;
    const ok = (ta.value || '').trim().length >= VSA_MIN_LENGTH;
    btn.disabled = !ok;
}

// Modale de validation VSA (similaire à celle des prospects)
function _ensureVsaValidationModal() {
    if (document.getElementById('modalVsaValidation')) return;
    const div = document.createElement('div');
    div.innerHTML = `
    <div id="modalVsaValidation" class="modal" role="dialog" aria-modal="true" aria-hidden="true">
        <div class="modal-content" style="max-width: 700px; max-height: 90vh; overflow-y: auto;">
            <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;">
                <span style="font-size: 18px; font-weight: 600;">✅ Validation des données extraites</span>
                <button class="modal-close" onclick="closeVsaValidationModal()" aria-label="Fermer" style="font-size:14px;padding:4px 10px;background:none;border:none;color:var(--color-text);cursor:pointer;">✕</button>
            </div>
            <div style="margin-top:16px;">
                <p class="muted" style="font-size:12px;margin-bottom:16px;">Vérifiez les champs extraits. Vous pouvez modifier chaque valeur avant de créer le candidat.</p>
                <div id="vsaFieldsPreview"></div>
                <div style="display:flex;gap:8px;margin-top:20px;justify-content:space-between;flex-wrap:wrap;">
                    <button class="btn btn-secondary" onclick="closeVsaValidationModal()">Annuler</button>
                    <div style="display:flex;gap:8px;">
                        <button class="btn btn-primary" onclick="applyVsaImport()">💾 Créer le candidat</button>
                    </div>
                </div>
            </div>
        </div>
    </div>`;
    document.body.appendChild(div.firstElementChild);
}

function _openVsaValidationModal() {
    closeVsaImportModal();
    
    setTimeout(() => {
        _ensureVsaValidationModal();
        _renderVsaPreview();
        const modal = document.getElementById('modalVsaValidation');
        if (modal) {
            // Utiliser openModal si disponible (gère correctement aria-hidden)
            if (window.openModal) {
                try {
                    window.openModal(modal);
                } catch (e) {
                    // Fallback si openModal échoue
                    modal.classList.add('active');
                    modal.setAttribute('aria-hidden', 'false');
                    modal.setAttribute('aria-modal', 'true');
                }
            } else {
                // Fallback manuel
                modal.classList.add('active');
                modal.setAttribute('aria-hidden', 'false');
                modal.setAttribute('aria-modal', 'true');
            }
        }
    }, 100);
}

window.closeVsaValidationModal = function() {
    const modal = document.getElementById('modalVsaValidation');
    if (modal) {
        // Utiliser closeModal si disponible (gère correctement aria-hidden)
        if (window.closeModal) {
            try {
                window.closeModal(modal);
            } catch (e) {
                // Fallback si closeModal échoue
                modal.classList.remove('active');
                modal.setAttribute('aria-hidden', 'true');
            }
        } else {
            modal.classList.remove('active');
            modal.setAttribute('aria-hidden', 'true');
        }
    }
    _vsaParsedData = null;
    _vsaRawText = '';
    _vsaUrl = '';
};

function _renderVsaPreview() {
    const container = document.getElementById('vsaFieldsPreview');
    if (!container || !_vsaParsedData) return;
    
    const data = _vsaParsedData;
    const fields = [];
    
    // Mapping des champs candidat
    const fieldMap = {
        name: { key: 'name', label: 'Nom', value: data.name || '' },
        role: { key: 'role', label: 'Rôle', value: data.role || '' },
        location: { key: 'location', label: 'Localisation', value: data.location || '' },
        years_experience: { key: 'years_experience', label: 'Années d\'expérience', value: data.years_experience != null ? String(data.years_experience) : '', isNumeric: true },
        seniority: { key: 'seniority', label: 'Seniorité', value: data.seniority || '' },
        tech: { key: 'tech', label: 'Technologies', value: data.tech || '' },
        skills: { key: 'skills', label: 'Compétences', value: Array.isArray(data.skills) ? data.skills.join(', ') : (data.skills || '') },
        phone: { key: 'phone', label: 'Téléphone', value: data.phone || '' },
        email: { key: 'email', label: 'Email', value: data.email || '' },
        linkedin: { key: 'linkedin', label: 'LinkedIn', value: data.linkedin || '' },
        sector: { key: 'sector', label: 'Secteur', value: data.sector || '' },
        notes: { key: 'notes', label: 'Notes', value: data.notes || '', isTextarea: true },
        vsa_url: { key: 'vsa_url', label: 'Lien VSA', value: _vsaUrl || data.vsa_url || '' }
    };
    
    let html = '';
    Object.values(fieldMap).forEach((field) => {
        // Afficher les champs importants même s'ils sont vides (pour permettre la saisie manuelle)
        if (!field.value && field.key !== 'vsa_url' && field.key !== 'years_experience') return;
        
        const fieldId = `vsaField_${field.key}`;
        const isTextarea = field.isTextarea;
        const isNumeric = field.isNumeric;
        const inputTag = isTextarea ? 'textarea' : 'input';
        let inputType = '';
        if (!isTextarea) {
            if (field.key === 'email') inputType = 'type="email"';
            else if (field.key === 'phone') inputType = 'type="tel"';
            else if (isNumeric) inputType = 'type="number" min="0" step="1"';
            else inputType = 'type="text"';
        }
        const inputAttrs = isTextarea ? `rows="3"` : '';
        const valueAttr = isTextarea ? '' : `value="${escapeHtml(field.value)}"`;
        const textareaContent = isTextarea ? escapeHtml(field.value) : '';
        
        html += `
        <div class="card" style="padding:14px;margin-bottom:12px;background:var(--color-surface-2, rgba(255,255,255,0.05));">
            <label style="display:block;font-size:12px;font-weight:600;color:var(--color-muted, #999);margin-bottom:6px;">${field.label}</label>
            <${inputTag} 
                id="${fieldId}" 
                data-field-key="${field.key}"
                ${inputType} 
                ${inputAttrs}
                ${valueAttr}
                style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-surface);color:var(--color-text);font-size:13px;"
            >${textareaContent}</${inputTag}>
        </div>`;
    });
    
    container.innerHTML = html || '<p class="muted">Aucun champ extrait.</p>';
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

window.updateVsaField = function(index) {
    // Les champs sont mis à jour directement dans le DOM, on les récupère lors de l'application
};

window.applyVsaImport = async function() {
    if (!_vsaParsedData) {
        if (typeof showToast === 'function') {
            showToast('Aucune donnée à appliquer.', 'warning');
        }
        return;
    }
    
    try {
        // Récupérer les valeurs depuis les inputs
        const fields = document.querySelectorAll('#vsaFieldsPreview input, #vsaFieldsPreview textarea');
        const data = { ..._vsaParsedData };
        
        fields.forEach(input => {
            const key = input.getAttribute('data-field-key');
            if (key) {
                const value = input.value.trim();
                if (key === 'skills') {
                    data[key] = value ? value.split(',').map(s => s.trim()).filter(Boolean) : [];
                } else if (key === 'years_experience') {
                    const num = parseInt(value);
                    data[key] = (!isNaN(num) && num >= 0) ? num : null;
                } else {
                    data[key] = value;
                }
            }
        });
        
        // Préparer les données pour le formulaire
        const techParts = [data.tech].filter(Boolean);
        if (Array.isArray(data.skills) && data.skills.length) {
            techParts.push(...data.skills);
        }
        const formData = {
            name: data.name || '',
            role: data.role || '',
            location: data.location || '',
            seniority: data.seniority || '',
            years_experience: data.years_experience != null ? data.years_experience : null,
            tech: techParts.join(', ').trim() || data.tech || '',
            linkedin: data.linkedin || '',
            source: 'VSA',
            status: 'a_sourcer',
            notes: data.notes || '',
            vsa_url: data.vsa_url || _vsaUrl || '',
            phone: data.phone || '',
            email: data.email || '',
            sector: data.sector || ''
        };
        
        if (!formData.name && (formData.role || formData.location)) {
            formData.name = [formData.role, formData.location].filter(Boolean).join(' — ').slice(0, 200);
        }
        
        // Fermer la modale de validation d'abord
        closeVsaValidationModal();
        
        // Attendre un peu pour que la fermeture soit effective
        setTimeout(() => {
            // Ouvrir le formulaire candidat avec les données pré-remplies
            __candEditing = null;
            const candForm = document.getElementById('candForm');
            if (candForm) candForm.reset();
            
            if (typeof fillCandidateForm === 'function') {
                fillCandidateForm(formData);
            }
            
            if (typeof openCandidateModal === 'function') {
                openCandidateModal(false);
            }
            
            if (typeof showToast === 'function') {
                showToast('Données extraites. Vérifiez la fiche candidat puis enregistrez.', 'success', 5000);
            }
        }, 100);
        
    } catch (e) {
        console.error('[VSA] Erreur lors de l\'application des données:', e);
        if (typeof showToast === 'function') {
            showToast('Erreur lors de l\'application des données.', 'error');
        }
    }
};

// Ancienne fonction conservée pour compatibilité
function _vsaImportApplyParsed(parsed) {
    _vsaParsedData = parsed;
    _vsaUrl = (document.getElementById('vsaImportLink')?.value || '').trim();
    _openVsaValidationModal();
}

// Variables pour la modale de validation VSA
let _vsaParsedData = null;
let _vsaRawText = '';
let _vsaUrl = '';

async function _vsaImportExtractWithOllama() {
    const ta = document.getElementById('vsaImportTextarea');
    const content = (ta?.value || '').trim();
    if (content.length < VSA_MIN_LENGTH) return;
    const btn = document.getElementById('btnVsaExtractOllama');
    const errEl = document.getElementById('vsaImportError');
    const prefillBtn = document.getElementById('btnVsaPreFillAnyway');
    const linkEl = document.getElementById('vsaImportLink');
    
    if (btn) { 
        btn.disabled = true; 
        btn.textContent = '⏳ Extraction en cours…';
    }
    if (errEl) { 
        errEl.style.display = 'none'; 
        errEl.textContent = ''; 
    }
    if (prefillBtn) prefillBtn.style.display = 'none';

    const prompt = typeof getVsaExtractionPrompt === 'function' ? getVsaExtractionPrompt(content) : '';
    if (!prompt) {
        if (btn) { btn.disabled = false; btn.textContent = '🤖 Extraire avec l\'IA'; }
        return;
    }
    
    try {
        // Afficher un overlay de loading (comme pour les prospects)
        _showVsaLoadingOverlay();
        
        // Appel Ollama avec timeout
        const text = typeof callOllama === 'function' ? await callOllama(prompt, { timeoutMs: 180000 }) : '';
        
        _hideVsaLoadingOverlay();
        
        if (!text || !text.trim()) {
            throw new Error('Réponse Ollama vide');
        }
        
        // Parser le résultat
        const parsed = typeof parseVsaCandidateText === 'function' ? parseVsaCandidateText(text) : {};
        
        // Stocker les données pour la modale de validation
        _vsaParsedData = parsed;
        _vsaRawText = text;
        _vsaUrl = (linkEl?.value || '').trim();
        
        // Fermer la modale VSA d'abord
        closeVsaImportModal();
        
        // Attendre un peu pour que la fermeture soit effective
        setTimeout(() => {
            _openVsaValidationModal();
        }, 150);
        
    } catch (e) {
        _hideVsaLoadingOverlay();
        console.error('[VSA] Erreur extraction Ollama:', e);
        if (errEl) {
            errEl.textContent = 'IA indisponible. Vous pouvez coller manuellement un texte au format : NOM: … ROLE: … LOCALISATION: … (une ligne par champ).';
            errEl.style.display = 'block';
        }
        if (prefillBtn) prefillBtn.style.display = 'inline-block';
        if (typeof showToast === 'function') {
            showToast('IA indisponible. Utilisez « Pré-remplir quand même » si le texte est au bon format.', 'warning', 6000);
        }
    } finally {
        if (btn) { 
            btn.disabled = false; 
            btn.textContent = '🤖 Extraire avec l\'IA'; 
            _vsaImportToggleExtractButton(); 
        }
    }
}

// Overlay de loading pendant l'extraction
function _showVsaLoadingOverlay() {
    let overlay = document.getElementById('vsaLoadingOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'vsaLoadingOverlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.7);
            z-index: 100000;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            color: var(--color-text, #fff);
        `;
        overlay.innerHTML = `
            <div style="font-size: 48px; margin-bottom: 16px;">⏳</div>
            <div style="font-weight: 600; margin-bottom: 8px; font-size: 18px;">Extraction en cours…</div>
            <div style="font-size: 14px; opacity: 0.8;">L'IA analyse le contenu VSA. Cela peut prendre quelques instants.</div>
        `;
        document.body.appendChild(overlay);
    }
    overlay.style.display = 'flex';
}

function _hideVsaLoadingOverlay() {
    const overlay = document.getElementById('vsaLoadingOverlay');
    if (overlay) overlay.style.display = 'none';
}

function _vsaImportPreFillAnyway() {
    const ta = document.getElementById('vsaImportTextarea');
    const text = (ta?.value || '').trim();
    if (!text) return;
    const parsed = typeof parseVsaCandidateText === 'function' ? parseVsaCandidateText(text) : {};
    _vsaImportApplyParsed(parsed);
}

// ===== Productivité =====

function loadCustomKeywords() {
    try {
        const raw = localStorage.getItem('sourcing_custom_keywords_v5');
        if (raw) __customKeywords = JSON.parse(raw) || [];
        if (!Array.isArray(__customKeywords)) __customKeywords = [];
    } catch(e) { __customKeywords = []; }
}
function saveCustomKeywords() {
    try { localStorage.setItem('sourcing_custom_keywords_v5', JSON.stringify(__customKeywords)); } catch(e) {}
}

function selectedCompanyObjects() {
    return (data?.companies || []).filter(c => __selectedCompanyIds.includes(Number(c.id)));
}

function deriveKeywordsFromCompanies() {
    const companies = selectedCompanyObjects();
    const companyById = new Map((data?.companies || []).map(c => [Number(c.id), c]));
    const prospects = data?.prospects || [];

    // fréquence simple de tokens
    const freq = new Map();

    const addTerm = (term, w=1) => {
        const t = safeStr(term).trim();
        if (!t) return;
        const key = t.toLowerCase();
        if (STOP.has(key)) return;
        freq.set(key, (freq.get(key) || 0) + w);
    };

    companies.forEach(c => {
        // tags entreprise
        try {
            const tags = Array.isArray(c.tags) ? c.tags : (safeStr(c.tags).split(',').map(x=>x.trim()).filter(Boolean));
            tags.forEach(t => addTerm(t, 6));
        } catch(e) {}
        // notes entreprise
        toTokens(c.notes).forEach(tok => addTerm(tok, 1));
    });

    // ajouter vocab depuis prospects de ces entreprises
    prospects
        .filter(p => __selectedCompanyIds.includes(Number(p.company_id)))
        .forEach(p => {
            toTokens(p.fonction).forEach(tok => addTerm(tok, 2));
            toTokens(p.notes).forEach(tok => addTerm(tok, 1));
            try { (Array.isArray(p.tags) ? p.tags : []).forEach(t => addTerm(t, 3)); } catch(e) {}
        });

    // privilégier certains patterns
    const prefer = ['c++','c','python','linux','rtos','can','autosar','embedded','embarqué','firmware','fpga','stm32','nvidia','ros','lidar','v2x','ethernet','do-178','iso26262'];
    prefer.forEach(k => { if (freq.has(k)) freq.set(k, freq.get(k) + 4); });

    // output top terms
    const sorted = [...freq.entries()].sort((a,b)=>b[1]-a[1]).map(([k])=>k);
    const base = sorted.slice(0, 14).map(s => s); // keep lowercase
    const merged = uniq(base.concat(__customKeywords));
    __activeKeywords = merged.slice(0, 24);
}

function renderKeywordChips() {
    const wrap = document.getElementById('keywordChips');
    if (!wrap) return;
    wrap.innerHTML = '';
    if (__activeKeywords.length === 0) {
        wrap.innerHTML = '<div class="muted">Sélectionnez une entreprise pour générer des mots-clés…</div>';
        return;
    }

    __activeKeywords.forEach(k => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip';
        chip.title = 'Cliquer pour supprimer';
        chip.innerHTML = `${escapeHtml(k)} <span class="chip-x">×</span>`;
        chip.addEventListener('click', () => {
            __activeKeywords = __activeKeywords.filter(x => x.toLowerCase() !== k.toLowerCase());
            renderKeywordChips();
            updateLinkedInQuery();
            refreshProductivityMatching();
        });
        wrap.appendChild(chip);
    });
}

function updateLinkedInQuery() {
    const ta = document.getElementById('liQuery');
    if (!ta) return;
    if (__activeKeywords.length === 0) { ta.value = ''; return; }

    const parts = __activeKeywords.map(k => {
        const kk = k.trim();
        if (!kk) return '';
        if (kk.includes(' ') || kk.includes('+') || kk.includes('#') || kk.includes('-')) return `"${kk}"`;
        return kk;
    }).filter(Boolean);

    const q = '(' + parts.join(' OR ') + ')';
    ta.value = q;
}

function computeCandidateScore(c) {
    const kw = __activeKeywords.map(x => x.toLowerCase());
    if (kw.length === 0) return { score: 0, matched: [] };

    const skills = candSkillsArray(c).join(' ');
    const text = `${safeStr(c.name)} ${safeStr(c.role)} ${safeStr(c.location)} ${skills} ${safeStr(c.tech)} ${safeStr(c.notes)}`.toLowerCase();
    const matched = [];
    kw.forEach(k => {
        if (!k) return;
        // match mot-clé en substring (simple & rapide)
        if (text.includes(k)) matched.push(k);
    });

    const score = Math.round((matched.length / kw.length) * 100);
    return { score, matched };
}

function renderMatchTable() {
    const tbody = document.getElementById('matchTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const st = (document.getElementById('matchStatusFilter')?.value || '').trim().toLowerCase();
    const q = (document.getElementById('matchSearch')?.value || '').trim().toLowerCase();

    const list = __candidates
        .filter(c => !st || safeStr(c.status).toLowerCase() === st)
        .filter(c => {
            const hay = `${safeStr(c.name)} ${safeStr(c.role)} ${safeStr(c.location)} ${candSkillsArray(c).join(' ')} ${safeStr(c.tech)} ${safeStr(c.notes)}`.toLowerCase();
            return !q || hay.includes(q);
        })
        .map(c => ({ c, ...computeCandidateScore(c) }))
        .sort((a,b)=> b.score - a.score);

    const summary = document.getElementById('matchSummary');
    if (summary) {
        summary.textContent = `Mots-clés: ${__activeKeywords.length} · Candidats: ${list.length}`;
    }

    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 35px; color: var(--color-text-secondary);">Aucun résultat</td></tr>';
        return;
    }

    list.forEach(({c, score, matched}) => {
        const m = matched.slice(0, 8).join(', ');
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td data-label="Match"><span class="match-pill" title="${escapeHtml(m)}">${score}%</span></td>
          <td data-label="Nom"><span title="${escapeHtml(c.name || '')}">${escapeHtml(c.name || '')}</span></td>
          <td data-label="Rôle">${renderClampCell(c.role, 'table-cell-clamp--wide')}</td>
          <td data-label="Localisation">${renderClampCell(c.location, 'table-cell-clamp--wide')}</td>
          <td data-label="Compétences / Tech">${renderClampCell(c.tech)}</td>
          <td data-label="Actions">
            <div class="table-actions-inline">
              <a class="mini-action" href="/candidat?id=${c.id}" title="Fiche candidat">👤</a>
              ${c.linkedin ? `<a class="mini-action" href="${escapeHtml(c.linkedin)}" target="_blank" title="LinkedIn">🔗</a>` : ''}
              <button class="mini-action" onclick="copyApproachMessage(${c.id})" title="Copier message">💬</button>
              <button class="mini-action" onclick="editCandidate(${c.id})">✏️</button>
            </div>
          </td>
        `;
        tbody.appendChild(tr);
    });
}

function refreshProductivityMatching() {
    if (document.getElementById('panelProd')?.style.display === 'none') return;
    updateLinkedInQuery();
    renderMatchTable();
}

function populateCompanyMultiSelect() {
    const sel = document.getElementById('targetCompanySelect');
    if (!sel) return;
    sel.innerHTML = '';

    const companies = (data?.companies || []).slice().sort((a,b) => safeStr(a.groupe).localeCompare(safeStr(b.groupe), 'fr', { sensitivity:'base' }));
    companies.forEach(c => {
        const opt = document.createElement('option');
        opt.value = String(c.id);
        opt.textContent = `${safeStr(c.groupe)}${c.site ? ' — ' + safeStr(c.site) : ''}`;
        sel.appendChild(opt);
    });
}

async function copyToClipboard(text) {
    const t = safeStr(text);
    if (!t) return false;
    try {
        await navigator.clipboard.writeText(t);
        return true;
    } catch (e) {
        // fallback
        try {
            const ta = document.createElement('textarea');
            ta.value = t;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
            return true;
        } catch (err) {
            return false;
        }
    }
}

function pickTopCompanyLabel() {
    const companies = selectedCompanyObjects();
    if (!companies.length) return '';
    const c = companies[0];
    return `${safeStr(c.groupe)}${c.site ? ' (' + safeStr(c.site) + ')' : ''}`;
}

async function copyApproachMessage(candidateId) {
    const c = __candidates.find(x => x.id === candidateId);
    if (!c) return;

    const target = pickTopCompanyLabel();
    const kw = __activeKeywords.slice(0, 6).join(', ');
    const msg =
`Bonjour ${safeStr(c.name).split(' ')[0] || ''},

Je suis ingénieur d’affaires chez Up Technologies. Je travaille en ce moment sur des besoins similaires à : ${target || 'des clients en région'}.

Votre profil m’a interpellé (mots-clés: ${kw || '—'}). Est-ce que vous seriez ouvert à un échange rapide (10-15 min) cette semaine ?

Merci et bonne journée !`;

    const ok = await copyToClipboard(msg);
    if (typeof showToast === 'function') {
        showToast(ok ? "✅ Message copié" : "❌ Impossible de copier (clipboard)", ok ? 'success' : 'error');
    } else {
        alert(ok ? "✅ Message copié." : "❌ Impossible de copier (clipboard).");
    }
}

async function handleCandidateOfDay() {
    // prend le meilleur match selon les filtres actuels
    const st = (document.getElementById('matchStatusFilter')?.value || '').trim().toLowerCase();
    const list = __candidates
        .filter(c => !st || safeStr(c.status).toLowerCase() === st)
        .map(c => ({ c, ...computeCandidateScore(c) }))
        .sort((a,b)=> b.score - a.score);

    if (list.length === 0) {
        if (typeof showToast === 'function') {
            showToast("Aucun candidat dans ce filtre", 'warning');
        } else {
            alert("Aucun candidat dans ce filtre.");
        }
        return;
    }

    const best = list[0];
    const c = best.c;
    const label = `${safeStr(c.name)} — ${best.score}%`;
    const ok = await copyToClipboard(document.getElementById('liQuery')?.value || '');
    if (typeof showToast === 'function') {
        showToast(`⭐ Candidat du jour : ${label}${ok ? " — Requête LinkedIn copiée" : ""}`, 'success', 4000);
    } else {
        alert(`⭐ Candidat du jour : ${label}\n\n${ok ? "La requête LinkedIn a été copiée." : ""}`);
    }
    // ouvrir LinkedIn du candidat si dispo
    if (c.linkedin) window.open(c.linkedin, '_blank');
}

async function saveCompanyTagsFromKeywords() {
    if (__selectedCompanyIds.length === 0) {
        if (typeof showToast === 'function') {
            showToast("Sélectionnez une entreprise", 'warning');
        } else {
            alert("Sélectionnez une entreprise.");
        }
        return;
    }
    if (__activeKeywords.length === 0) {
        if (typeof showToast === 'function') {
            showToast("Aucun mot-clé", 'warning');
        } else {
            alert("Aucun mot-clé.");
        }
        return;
    }

    // merge dans company.tags + save
    __selectedCompanyIds.forEach(cid => {
        const c = data.companies.find(x => Number(x.id) === Number(cid));
        if (!c) return;
        const existing = Array.isArray(c.tags) ? c.tags : (safeStr(c.tags).split(',').map(x=>x.trim()).filter(Boolean));
        const merged = uniq(existing.concat(__activeKeywords));
        c.tags = merged;
    });

    try {
        await saveToServerAsync();
        if (typeof showToast === 'function') {
            showToast("✅ Tags entreprise mis à jour", 'success');
        } else {
            alert("✅ Tags entreprise mis à jour.");
        }
    } catch (e) {
        console.error(e);
        if (typeof showToast === 'function') {
            showToast("❌ Impossible de sauvegarder les tags", 'error');
        } else {
            alert("❌ Impossible de sauvegarder les tags.");
        }
    }
}

function wireProductivityEvents() {
    const sel = document.getElementById('targetCompanySelect');
    sel && sel.addEventListener('change', () => {
        __selectedCompanyIds = Array.from(sel.selectedOptions).map(o => Number(o.value));
        deriveKeywordsFromCompanies();
        renderKeywordChips();
        updateLinkedInQuery();
        refreshProductivityMatching();
    });

    document.getElementById('btnAddKeyword')?.addEventListener('click', () => {
        const inp = document.getElementById('keywordAddInput');
        const v = inp ? inp.value.trim() : '';
        if (!v) return;
        __customKeywords = uniq(__customKeywords.concat([v]));
        saveCustomKeywords();
        deriveKeywordsFromCompanies();
        renderKeywordChips();
        updateLinkedInQuery();
        refreshProductivityMatching();
        if (inp) inp.value = '';
    });

    document.getElementById('btnCopyQuery')?.addEventListener('click', async () => {
        const q = document.getElementById('liQuery')?.value || '';
        const ok = await copyToClipboard(q);
        if (typeof showToast === 'function') {
            showToast(ok ? "✅ Requête copiée" : "❌ Impossible de copier", ok ? 'success' : 'error');
        } else {
            alert(ok ? "✅ Requête copiée." : "❌ Impossible de copier.");
        }
    });

    document.getElementById('btnOpenLinkedIn')?.addEventListener('click', () => {
        const q = document.getElementById('liQuery')?.value || '';
        const url = 'https://www.linkedin.com/search/results/people/?keywords=' + encodeURIComponent(q);
        window.open(url, '_blank');
    });

    document.getElementById('btnPickCandidateOfDay')?.addEventListener('click', handleCandidateOfDay);
    document.getElementById('btnRefreshMatch')?.addEventListener('click', refreshProductivityMatching);
    document.getElementById('matchStatusFilter')?.addEventListener('change', refreshProductivityMatching);
    document.getElementById('matchSearch')?.addEventListener('input', refreshProductivityMatching);

    document.getElementById('btnSaveCompanyTags')?.addEventListener('click', saveCompanyTagsFromKeywords);
}

// ===== Import LinkedIn CSV =====
async function importLinkedInCsv(file) {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);

    const res = await fetch('/api/candidates/import_linkedin_csv', { method: 'POST', body: fd });
    if (!res.ok) {
        const txt = await res.text().catch(()=> '');
        if (typeof showToast === 'function') {
            showToast('❌ Import impossible: ' + (txt || ('HTTP ' + res.status)), 'error');
        } else {
            alert('❌ Import impossible: ' + (txt || ('HTTP ' + res.status)));
        }
        return;
    }
    const j = await res.json().catch(()=> ({}));
    if (typeof showToast === 'function') {
        showToast(`✅ Import LinkedIn terminé : ${j.inserted || 0} ajouté(s), ${j.skipped || 0} ignoré(s)`, 'success', 5000);
    } else {
        alert(`✅ Import LinkedIn terminé : ${j.inserted || 0} ajouté(s), ${j.skipped || 0} ignoré(s).`);
    }
    await loadCandidates();
    applyCandidateFilters();
    refreshProductivityMatching();
}

// ===== Tabs =====
function setTab(tab) {
    const p1 = document.getElementById('panelPipeline');
    const p2 = document.getElementById('panelProd');
    const b1 = document.getElementById('tabPipeline');
    const b2 = document.getElementById('tabProd');
    if (!p1 || !p2 || !b1 || !b2) return;

    if (tab === 'prod') {
        p1.style.display = 'none';
        p2.style.display = 'block';
        b1.classList.remove('active');
        b2.classList.add('active');
        refreshProductivityMatching();
    } else {
        p1.style.display = 'block';
        p2.style.display = 'none';
        b1.classList.add('active');
        b2.classList.remove('active');
    }
}

async function loadCandidateFolderSettings() {
    try {
        const res = await fetch('/api/settings');
        const j = await res.json();
        if (j.ok && j.settings) {
            const base = document.getElementById('settingCandidateFolderBase');
            const fmt = document.getElementById('settingCandidateFolderFormat');
            if (base) base.value = j.settings.candidate_folder_base || '';
            if (fmt) fmt.value = j.settings.candidate_folder_format || '{NOM} {Prenom}';
        }
    } catch (e) { console.warn('Folder settings load:', e); }
}

async function saveCandidateFolderSettings() {
    const base = document.getElementById('settingCandidateFolderBase')?.value?.trim() || '';
    const fmt = (document.getElementById('settingCandidateFolderFormat')?.value?.trim() || '').trim() || '{NOM} {Prenom}';
    const statusEl = document.getElementById('folderSettingsStatus');
    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ settings: { candidate_folder_base: base, candidate_folder_format: fmt } })
        });
        const j = await res.json();
        if (j.ok) {
            if (statusEl) statusEl.textContent = '✅ Enregistré';
            if (typeof showToast === 'function') showToast('✅ Dossier candidats enregistré', 'success');
        } else { if (statusEl) statusEl.textContent = '❌ Erreur'; }
    } catch (e) { if (statusEl) statusEl.textContent = '❌ Erreur réseau'; }
    setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
}

async function scanCandidateFolder() {
    const statusEl = document.getElementById('folderSettingsStatus');
    const resultEl = document.getElementById('sourceFromFolderResult');
    if (!resultEl) return;
    resultEl.style.display = 'block';
    resultEl.innerHTML = '<span class="muted">⏳ Scan en cours…</span>';
    try {
        const res = await fetch('/api/candidates/source-from-folder');
        const j = await res.json();
        if (!j.ok) {
            resultEl.innerHTML = '<div class="muted" style="color:var(--color-danger);">' + (j.error || 'Erreur') + '</div>';
            return;
        }
        const newList = j.new || [];
        if (newList.length === 0) {
            resultEl.innerHTML = '<div class="muted">Aucun nouveau dossier (tous ont déjà une fiche candidat).</div>';
            return;
        }
        let html = '<div style="font-weight:600;margin-bottom:8px;">' + newList.length + ' nouveau(x) dossier(s) :</div>';
        newList.forEach(item => {
            const files = (item.files || []).slice(0, 5).map(f => f.name).join(', ');
            const more = (item.files || []).length > 5 ? '…' : '';
            html += '<div class="card" style="padding:10px 12px;margin-bottom:8px;">';
            html += '<strong>' + escapeHtml(item.folderName) + '</strong>';
            if (files) html += '<div class="muted" style="font-size:11px;margin-top:4px;">' + escapeHtml(files + more) + '</div>';
            html += '<div style="margin-top:8px;"><a href="/?openQuickAdd=1&type=candidate&context=' + encodeURIComponent(item.folderName) + '" class="btn btn-primary btn-sm">🤖 Créer fiche avec Ajout IA</a></div>';
            html += '</div>';
        });
        resultEl.innerHTML = html;
        if (typeof showToast === 'function') showToast(newList.length + ' nouveau(x) dossier(s) trouvé(s).', 'success');
    } catch (e) {
        resultEl.innerHTML = '<div class="muted" style="color:var(--color-danger);">Erreur : ' + (e.message || e) + '</div>';
    }
}

// Initialisation VSA (globale, accessible depuis partout) - optimisée pour éviter les doublons
let _vsaInitialized = false;

function _initVsaModal() {
    // Éviter les initialisations multiples
    if (_vsaInitialized) return;
    
    // Bouton sur page sourcing (optionnel)
    const btnAddViaVsa = document.getElementById('btnAddViaVsa');
    if (btnAddViaVsa && !btnAddViaVsa.hasAttribute('data-vsa-wired')) {
        btnAddViaVsa.setAttribute('data-vsa-wired', 'true');
        btnAddViaVsa.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            if (typeof window.openVsaImportModal === 'function') {
                window.openVsaImportModal();
            }
        });
    }
    
    // Event listeners pour la modale VSA (disponible partout) - une seule fois
    const textarea = document.getElementById('vsaImportTextarea');
    const btnExtract = document.getElementById('btnVsaExtractOllama');
    const btnPreFill = document.getElementById('btnVsaPreFillAnyway');
    
    if (textarea && !textarea.hasAttribute('data-vsa-wired')) {
        textarea.setAttribute('data-vsa-wired', 'true');
        textarea.addEventListener('input', _vsaImportToggleExtractButton);
    }
    if (btnExtract && !btnExtract.hasAttribute('data-vsa-wired')) {
        btnExtract.setAttribute('data-vsa-wired', 'true');
        btnExtract.addEventListener('click', () => _vsaImportExtractWithOllama());
    }
    if (btnPreFill && !btnPreFill.hasAttribute('data-vsa-wired')) {
        btnPreFill.setAttribute('data-vsa-wired', 'true');
        btnPreFill.addEventListener('click', _vsaImportPreFillAnyway);
    }
    
    _vsaInitialized = true;
}

// Fonction d'initialisation VSA globale (appelable depuis n'importe où) - optimisée
window.initVsaModal = function() {
    if (!_vsaInitialized) {
        _initVsaModal();
    }
};

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const fn = window.bootstrap || window.appBootstrap;
        if (typeof fn === 'function') await fn('sourcing');
    } catch (e) {}

    loadCustomKeywords();
    await loadCandidateFolderSettings();
    document.getElementById('btnSaveCandidateFolder')?.addEventListener('click', saveCandidateFolderSettings);
    document.getElementById('btnScanCandidateFolder')?.addEventListener('click', scanCandidateFolder);

    // Pipeline events
    document.getElementById('candSearch')?.addEventListener('input', applyCandidateFilters);
    document.getElementById('candStatusFilter')?.addEventListener('change', applyCandidateFilters);
    document.getElementById('candSkillsFilter')?.addEventListener('input', applyCandidateFilters);
    document.getElementById('btnAddCandidate')?.addEventListener('click', () => { __candEditing = null; document.getElementById('candForm')?.reset(); openCandidateModal(false); });
    document.getElementById('candForm')?.addEventListener('submit', saveCandidate);

    // import LinkedIn CSV
    const file = document.getElementById('candImportFile');
    document.getElementById('btnImportLinkedin')?.addEventListener('click', () => file && file.click());
    file && file.addEventListener('change', async () => {
        const f = file.files && file.files[0];
        await importLinkedInCsv(f);
        file.value = '';
    });

    // Initialisation VSA (une seule fois)
    _initVsaModal();

    // Tabs
    document.getElementById('tabPipeline')?.addEventListener('click', () => setTab('pipeline'));
    document.getElementById('tabProd')?.addEventListener('click', () => setTab('prod'));

    // Productivité init
    populateCompanyMultiSelect();
    wireProductivityEvents();

    try {
        await loadCandidates();
        applyCandidateFilters();
        deriveKeywordsFromCompanies();
        renderKeywordChips();
        updateLinkedInQuery();
        refreshProductivityMatching();
    } catch (err) {
        console.error(err);
        if (typeof showToast === 'function') {
            showToast("❌ Impossible de charger les candidats. Vérifiez que le serveur Python est lancé (app.py).", 'error');
        } else {
            alert("❌ Impossible de charger les candidats. Vérifiez que le serveur Python est lancé (app.py).");
        }
    }

    // URL param: editCandidate
    try {
        const params = new URLSearchParams(window.location.search);
        const id = params.get('editCandidate');
        if (id) {
            const cid = parseInt(id, 10);
            if (!Number.isNaN(cid)) {
                setTab('pipeline');
                editCandidate(cid);
            }
        }
    } catch(e) {}
});
