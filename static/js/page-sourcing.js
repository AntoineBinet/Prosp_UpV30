// Sourcing candidats (v5) : Pipeline + Productivité (matching entreprises)

let __candidates = [];
let __candFiltered = [];
let __candEditing = null;
let __selectedCandidates = new Set();

// ===== Tri colonnes =====
let __candSortKey = 'updatedAt';
let __candSortDir = 'desc';

function _sortCandidates(arr) {
    const dir = __candSortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
        switch (__candSortKey) {
            case 'name':
                return dir * (a.name || '').localeCompare(b.name || '', 'fr', { sensitivity: 'base' });
            case 'role':
                return dir * (a.role || '').localeCompare(b.role || '', 'fr', { sensitivity: 'base' });
            case 'location':
                return dir * (a.location || '').localeCompare(b.location || '', 'fr', { sensitivity: 'base' });
            case 'status':
                return dir * (a.status || '').localeCompare(b.status || '', 'fr', { sensitivity: 'base' });
            case 'updatedAt': {
                const da = a.updatedAt || a.createdAt || '';
                const db = b.updatedAt || b.createdAt || '';
                return dir * da.localeCompare(db);
            }
            default: return 0;
        }
    });
}

function setCandSort(key) {
    if (__candSortKey === key) {
        __candSortDir = __candSortDir === 'asc' ? 'desc' : 'asc';
    } else {
        __candSortKey = key;
        __candSortDir = key === 'updatedAt' ? 'desc' : 'asc';
    }
    updateCandSortIndicators();
    applyCandidateFilters();
    applyLinkedinFilters();
    applyMissionFilters();
    applyArchiveFilters();
    applyHorsAuraFilters();
}

function updateCandSortIndicators() {
    const panels = ['pipeline', 'linkedin', 'mission', 'archive', 'horsaura'];
    const keys = ['name', 'role', 'location', 'status', 'updatedAt'];
    panels.forEach(p => {
        keys.forEach(k => {
            const el = document.getElementById(`sort-${p}-${k}`);
            if (!el) return;
            el.textContent = k === __candSortKey ? (__candSortDir === 'asc' ? '▲' : '▼') : '';
        });
    });
}

if (!window._candSortListenerAttached) {
    document.addEventListener('click', (e) => {
        const th = e.target.closest('th[data-cand-sort]');
        if (!th) return;
        setCandSort(th.dataset.candSort);
    });
    window._candSortListenerAttached = true;
}

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
        showToast('Date & heure requises pour planifier EC1.', 'warning');
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
        showToast('Impossible de planifier EC1 : ' + (e?.message || e), 'error');
    }
}


// Archive tab
let __archiveFiltered = [];

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
    const LABELS = {
        nouveau: 'Nouveau / A traiter',
        proposition: 'Proposition faite',
        entretien: 'Entretien en cours',
        a_faire: 'A FAIRE',
        oksi: 'OKSI',
        top_profil: 'Top profil',
        reunion_tech: 'En Réunion Technique',
        valide_contrat: 'Validé / Contrat',
        freelance: 'Freelance',
        freelance_mission: 'FREELANCE EN MISSION UP',
        nok_prequal: 'NOK Préqual',
        nok: 'NOK',
        plus_disponible: 'Plus disponible',
        refus_contrat: 'Refus du contrat',
        hors_aura: 'Hors Aura',
        // legacy fallbacks
        a_sourcer: 'Nouveau / A traiter',
        a_contacter: 'Proposition faite',
        en_cours: 'Entretien en cours',
        ec1: 'Entretien en cours',
        ec2: 'Entretien en cours',
        ed: 'A FAIRE',
        interesse: 'OKSI',
        mission: 'FREELANCE EN MISSION UP',
        refuse: 'NOK',
        embauche: 'Validé / Contrat',
        archive: 'Plus disponible',
    };
    return LABELS[v] || s || '—';
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
    const _skTb = document.getElementById('candTableBody');
    if (_skTb) {
        const sk = Array(7).fill('<div class="skeleton skeleton-row"></div>').join('');
        _skTb.innerHTML = '<tr><td colspan="9" style="padding:8px 0;">' + sk + '</td></tr>';
    }
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
        const status = safeStr(c.status).toLowerCase();
        // Refus, Mission, Hors Aura et LinkedIn → onglets dédiés
        if (CAND_ARCHIVE_STATUSES.has(status)) return false;
        if (CAND_MISSION_STATUSES.has(status)) return false;
        if (CAND_HORS_AURA_STATUSES.has(status)) return false;
        if (CAND_LINKEDIN_STATUSES.has(status)) return false;
        const skills = candSkillsArray(c);
        const hay = `${safeStr(c.name)} ${safeStr(c.role)} ${safeStr(c.location)} ${skills.join(' ')} ${safeStr(c.tech)} ${safeStr(c.notes)} ${safeStr(c.linkedin)} ${safeStr(c.source)}`.toLowerCase();
        const okQ = !q || hay.includes(q);
        const okS = !st || status === st;
        // skills filter = AND over requested skills
        let okSkills = true;
        if (skillsNeed.length) {
            const skillSet = new Set(skills.map(normalizeSkill));
            const techText = safeStr(c.tech).toLowerCase();
            okSkills = skillsNeed.every(sk => skillSet.has(sk) || techText.includes(sk));
        }
        return okQ && okS && okSkills;
    });

    _sortCandidates(__candFiltered);
    renderCandidateTable();
}

function renderCandidateTable() {
    const tbody = document.getElementById('candTableBody');
    const empty = document.getElementById('candEmptyState');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (__candFiltered.length === 0) {
        if (empty) empty.style.display = 'block';
        tbody.innerHTML = '<tr><td colspan="9" style="padding:0; border:none;"><div class="state" style="padding:32px 16px;"><div class="state-illus"><i data-icon="search" data-size="40"></i></div><h3 class="state-title">Aucun candidat trouvé</h3><p class="state-desc">Aucun résultat pour ces filtres.</p></div></td></tr>';
        if (window.renderIcons) renderIcons(tbody);
        updateCandidateBulkBar();
        updateCandidateSelectAllState();
        return;
    }
    if (empty) empty.style.display = 'none';

    __candFiltered.forEach(c => {
        const skills = candSkillsArray(c);
        const skillsLabel = skills.join(', ');
        const combinedTech = skillsLabel ? (skillsLabel + (c.tech ? ' · ' + safeStr(c.tech) : '')) : safeStr(c.tech);
        const isSelected = __selectedCandidates.has(c.id);
        const dcBadge = c.has_dc
            ? '<span class="dc-badge available" title="Dossier de compétences disponible">DC</span>'
            : `<button class="dc-badge missing dc-upload-btn" title="Cliquer pour uploader un DC (PDF)" onclick="event.stopPropagation();quickUploadDC(${c.id})">＋ DC</button>`;
        const descActionBtn = _buildDescActionBtn(c);
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.dataset.candidateId = c.id;
        if (isSelected) tr.classList.add('row-selected');
        tr.addEventListener('click', (e) => {
            if (e.target.closest('.mini-action, button, a, input, .dc-upload-btn, .desc-gen-btn')) return;
            window.location.href = '/candidat?id=' + c.id;
        });
        tr.innerHTML = `
            <td style="padding-left:12px;" onclick="event.stopPropagation()"><input type="checkbox" class="cand-row-select" title="Sélectionner" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation();toggleCandidateSelect(${c.id}, this.checked)"></td>
            <td data-label="Nom"><span title="${escapeHtml(c.name || '')}">${escapeHtml(c.name || '')}</span></td>
            <td data-label="Rôle">${renderClampCell(c.role, 'table-cell-clamp--wide')}</td>
            <td data-label="Localisation">${renderClampCell(c.location, 'table-cell-clamp--wide')}</td>
            <td data-label="Compétences / Tech">${renderClampCell(combinedTech)}</td>
            <td data-label="DC">${dcBadge}</td>
            <td data-label="Statut">${renderStatusSelect(c.id, c.status)}</td>
            <td data-label="MAJ">${escapeHtml((c.updatedAt || c.createdAt || '').slice(0, 10))}</td>
            <td data-label="Actions">
              <div class="table-actions-inline">
                ${c.linkedin ? `<a class="mini-action" href="${escapeHtml(c.linkedin)}" target="_blank" title="LinkedIn">🔗</a>` : ''}
                ${descActionBtn}
                ${c.vsa_url ? `<a class="mini-action" href="${escapeHtml(c.vsa_url)}" target="_blank" title="Profil VSA">🧭</a>` : `<button class="mini-action" disabled style="opacity:0.25;cursor:default;" title="Pas de lien VSA">🧭</button>`}
                <button class="mini-action danger" onclick="deleteCandidate(${c.id})">🗑️</button>
              </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    updateCandidateSelectAllState();
}

function quickUploadDC(candidateId) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
        const file = input.files[0];
        document.body.removeChild(input);
        if (!file) return;
        const btn = document.querySelector(`#candTableBody tr[data-candidate-id="${candidateId}"] .dc-upload-btn`);
        if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
        const fd = new FormData();
        fd.append('dc', file);
        fd.append('candidate_id', candidateId);
        try {
            const res = await fetch('/api/candidates/upload-dc', { method: 'POST', body: fd });
            const json = await res.json().catch(() => ({}));
            if (res.ok && json.ok) {
                showToast('DC enregistré : ' + json.filename, 'success');
                // Mettre à jour localement sans recharger tout
                const cand = __candidates.find(c => c.id === candidateId);
                if (cand) cand.has_dc = true;
                const cFilt = __candFiltered.find(c => c.id === candidateId);
                if (cFilt) cFilt.has_dc = true;
                const tr = document.querySelector(`#candTableBody tr[data-candidate-id="${candidateId}"]`);
                if (tr) {
                    const dcCell = tr.querySelector('[data-label="DC"]');
                    if (dcCell) dcCell.innerHTML = '<span class="dc-badge available" title="Dossier de compétences disponible">DC</span>';
                }
            } else {
                showToast('Échec upload DC : ' + (json.error || 'HTTP ' + res.status), 'error');
                if (btn) { btn.textContent = '＋ DC'; btn.disabled = false; }
            }
        } catch(e) {
            showToast('Erreur réseau : ' + (e?.message || e), 'error');
            if (btn) { btn.textContent = '＋ DC'; btn.disabled = false; }
        }
    });
    input.addEventListener('cancel', () => { document.body.removeChild(input); });
    input.click();
}

/**
 * Retourne le bouton IA pour la colonne Actions (remplace EC1).
 * - DC absent → '' (rien)
 * - DC présent + description générée → ✨ (régénérer au clic)
 * - DC présent + pas de description → 🤖 cliquable pour générer
 */
function _buildDescActionBtn(c) {
    if (!c.has_dc) return '';
    if (c.description_push && c.description_push.trim()) {
        return `<button class="mini-action desc-gen-btn" onclick="event.stopPropagation();quickGenerateDescription(${c.id})" title="Phrase IA rédigée — cliquer pour régénérer" style="opacity:.7;">✨</button>`;
    }
    return `<button class="mini-action desc-gen-btn" onclick="event.stopPropagation();quickGenerateDescription(${c.id})" title="Générer la phrase de présentation IA depuis le DC">🤖</button>`;
}

async function quickGenerateDescription(candidateId) {
    // Trouver le bouton dans le tableau (toutes les tables)
    const btn = document.querySelector(`tr[data-candidate-id="${candidateId}"] .desc-gen-btn`);
    if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
    try {
        const res = await fetch(`/api/candidates/${candidateId}/generate-description`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json.ok && json.description) {
            // Mettre à jour localement
            [__candidates, __candFiltered, __missionFiltered, __archiveFiltered].forEach(arr => {
                if (!arr) return;
                const c = arr.find(x => x.id === candidateId);
                if (c) c.description_push = json.description;
            });
            // Mettre à jour le bouton IA dans la colonne Actions
            const tr = document.querySelector(`tr[data-candidate-id="${candidateId}"]`);
            if (tr) {
                const descBtnEl = tr.querySelector('.desc-gen-btn');
                if (descBtnEl) {
                    descBtnEl.textContent = '✨';
                    descBtnEl.style.opacity = '0.7';
                    descBtnEl.title = 'Phrase IA rédigée — cliquer pour régénérer';
                    descBtnEl.disabled = false;
                }
            }
            showToast('Phrase de présentation générée !', 'success');
        } else {
            showToast(json.error || 'Erreur génération (vérifiez qu\'Ollama est actif)', 'error');
            if (btn) { btn.textContent = '🤖 Intro'; btn.disabled = false; }
        }
    } catch(e) {
        showToast('Erreur réseau : ' + (e?.message || e), 'error');
        if (btn) { btn.textContent = '🤖 Intro'; btn.disabled = false; }
    }
}

// ===== Statut inline =====

const CAND_STATUSES = [
    ['nouveau',          'Nouveau / A traiter'],
    ['proposition',      'Proposition faite'],
    ['entretien',        'Entretien en cours'],
    ['a_faire',          'A FAIRE'],
    ['oksi',             'OKSI'],
    ['top_profil',       'Top profil'],
    ['reunion_tech',     'En Réunion Technique'],
    ['valide_contrat',   'Validé / Contrat'],
    ['freelance',        'Freelance'],
    ['freelance_mission','FREELANCE EN MISSION UP'],
    ['nok_prequal',      'NOK Préqual'],
    ['nok',              'NOK'],
    ['plus_disponible',  'Plus disponible'],
    ['refus_contrat',    'Refus du contrat'],
    ['hors_aura',        'Hors Aura'],
];
const CAND_ARCHIVE_STATUSES = new Set(['nok_prequal', 'nok', 'plus_disponible', 'refus_contrat']);
const CAND_MISSION_STATUSES = new Set(['valide_contrat', 'freelance_mission']);
const CAND_HORS_AURA_STATUSES = new Set(['hors_aura']);
const CAND_LINKEDIN_STATUSES = new Set(['nouveau', 'proposition', 'entretien']);

function renderStatusSelect(candidateId, currentStatus) {
    const opts = CAND_STATUSES.map(([v, l]) =>
        `<option value="${v}"${v === currentStatus ? ' selected' : ''}>${escapeHtml(l)}</option>`
    ).join('');
    return `<select class="status-inline-select status-cand-${escapeHtml(currentStatus)}" onclick="event.stopPropagation()" onchange="quickChangeStatus(${candidateId}, this.value)">${opts}</select>`;
}

async function quickChangeStatus(candidateId, newStatus) {
    try {
        const res = await fetch('/api/candidates/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: candidateId, status: newStatus })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        // Mettre à jour localement
        const cand = __candidates.find(c => c.id === candidateId);
        if (cand) cand.status = newStatus;
        // Si le statut fait sortir de l'onglet courant, re-filtrer après un court délai
        const currentTab = document.getElementById('panelPipeline')?.style.display !== 'none' ? 'pipeline'
                         : document.getElementById('panelLinkedin')?.style.display !== 'none'  ? 'linkedin'
                         : document.getElementById('panelMission')?.style.display !== 'none'   ? 'mission'
                         : document.getElementById('panelHorsAura')?.style.display !== 'none'  ? 'horsaura'
                         : 'archive';
        const tabForStatus = CAND_ARCHIVE_STATUSES.has(newStatus) ? 'archive'
                           : CAND_MISSION_STATUSES.has(newStatus) ? 'mission'
                           : CAND_HORS_AURA_STATUSES.has(newStatus) ? 'horsaura'
                           : CAND_LINKEDIN_STATUSES.has(newStatus) ? 'linkedin'
                           : 'pipeline';
        const shouldMove = currentTab !== tabForStatus;
        if (shouldMove) {
            setTimeout(() => { applyCandidateFilters(); applyLinkedinFilters(); applyMissionFilters(); applyArchiveFilters(); applyHorsAuraFilters(); }, 600);
        } else {
            // Juste mettre à jour la couleur du select
            const sel = document.querySelector(`#candTableBody tr[data-candidate-id="${candidateId}"] .status-inline-select, #linkedinTableBody tr[data-candidate-id="${candidateId}"] .status-inline-select, #missionTableBody tr[data-candidate-id="${candidateId}"] .status-inline-select, #archiveTableBody tr[data-candidate-id="${candidateId}"] .status-inline-select, #horsAuraTableBody tr[data-candidate-id="${candidateId}"] .status-inline-select`);
            if (sel) {
                sel.className = `status-inline-select status-cand-${newStatus}`;
            }
        }
    } catch(e) {
        showToast('Impossible de changer le statut : ' + (e?.message || e), 'error');
    }
}

// ===== Onglet Archivés / Refusés =====

function applyArchiveFilters() {
    const q = (document.getElementById('archiveSearch')?.value || '').trim().toLowerCase();
    const st = (document.getElementById('archiveStatusFilter')?.value || '').trim().toLowerCase();
    __archiveFiltered = __candidates.filter(c => {
        const status = safeStr(c.status).toLowerCase();
        if (!CAND_ARCHIVE_STATUSES.has(status)) return false;
        if (st && status !== st) return false;
        if (q) {
            const skills = candSkillsArray(c);
            const hay = `${safeStr(c.name)} ${safeStr(c.role)} ${safeStr(c.location)} ${skills.join(' ')} ${safeStr(c.tech)} ${safeStr(c.notes)}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });
    _sortCandidates(__archiveFiltered);
    renderArchiveTable();
}

function renderArchiveTable() {
    const tbody = document.getElementById('archiveTableBody');
    const empty = document.getElementById('archiveEmptyState');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (__archiveFiltered.length === 0) {
        if (empty) empty.style.display = 'block';
        tbody.innerHTML = '<tr><td colspan="9" style="padding:0; border:none;"><div class="state" style="padding:32px 16px;"><div class="state-illus"><i data-icon="search" data-size="40"></i></div><h3 class="state-title">Aucun candidat trouvé</h3><p class="state-desc">Aucun résultat pour ces filtres.</p></div></td></tr>';
        if (window.renderIcons) renderIcons(tbody);
        return;
    }
    if (empty) empty.style.display = 'none';
    __archiveFiltered.forEach(c => {
        const skills = candSkillsArray(c);
        const skillsLabel = skills.join(', ');
        const combinedTech = skillsLabel ? (skillsLabel + (c.tech ? ' · ' + safeStr(c.tech) : '')) : safeStr(c.tech);
        const dcBadge = c.has_dc
            ? '<span class="dc-badge available" title="Dossier de compétences disponible">DC</span>'
            : `<button class="dc-badge missing dc-upload-btn" title="Cliquer pour uploader un DC (PDF)" onclick="event.stopPropagation();quickUploadDC(${c.id})">＋ DC</button>`;
        const descActionBtn = _buildDescActionBtn(c);
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.dataset.candidateId = c.id;
        tr.addEventListener('click', (e) => {
            if (e.target.closest('.mini-action, button, a, input, .dc-upload-btn, .desc-gen-btn, select')) return;
            window.location.href = '/candidat?id=' + c.id;
        });
        tr.innerHTML = `
            <td style="padding-left:12px;" onclick="event.stopPropagation()"><input type="checkbox" class="archive-row-select" title="Sélectionner" onclick="event.stopPropagation();toggleArchiveSelect(${c.id}, this.checked)"></td>
            <td data-label="Nom"><span title="${escapeHtml(c.name || '')}">${escapeHtml(c.name || '')}</span></td>
            <td data-label="Rôle">${renderClampCell(c.role, 'table-cell-clamp--wide')}</td>
            <td data-label="Localisation">${renderClampCell(c.location, 'table-cell-clamp--wide')}</td>
            <td data-label="Compétences / Tech">${renderClampCell(combinedTech)}</td>
            <td data-label="DC">${dcBadge}</td>
            <td data-label="Statut">${renderStatusSelect(c.id, c.status)}</td>
            <td data-label="MAJ">${escapeHtml((c.updatedAt || c.createdAt || '').slice(0, 10))}</td>
            <td data-label="Actions">
              <div class="table-actions-inline">
                ${c.linkedin ? `<a class="mini-action" href="${escapeHtml(c.linkedin)}" target="_blank" title="LinkedIn">🔗</a>` : ''}
                ${descActionBtn}
                ${c.vsa_url ? `<a class="mini-action" href="${escapeHtml(c.vsa_url)}" target="_blank" title="Profil VSA">🧭</a>` : `<button class="mini-action" disabled style="opacity:0.25;cursor:default;" title="Pas de lien VSA">🧭</button>`}
                <button class="mini-action danger" onclick="deleteCandidate(${c.id})">🗑️</button>
              </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

let __archiveSelected = new Set();
function toggleArchiveSelect(id, checked) {
    if (checked) __archiveSelected.add(id);
    else __archiveSelected.delete(id);
    updateArchiveSelectAllState();
}
function toggleArchiveSelectAll(checked) {
    if (checked) __archiveFiltered.forEach(c => __archiveSelected.add(c.id));
    else __archiveFiltered.forEach(c => __archiveSelected.delete(c.id));
    renderArchiveTable();
}
function updateArchiveSelectAllState() {
    const cb = document.getElementById('archiveSelectAll');
    if (!cb || !__archiveFiltered.length) return;
    const n = __archiveFiltered.filter(c => __archiveSelected.has(c.id)).length;
    cb.checked = n === __archiveFiltered.length;
    cb.indeterminate = n > 0 && n < __archiveFiltered.length;
}

// ===== Onglet En mission / Contrat =====

let __missionFiltered = [];

function applyMissionFilters() {
    const q = (document.getElementById('missionSearch')?.value || '').trim().toLowerCase();
    const st = (document.getElementById('missionStatusFilter')?.value || '').trim().toLowerCase();
    __missionFiltered = __candidates.filter(c => {
        const status = safeStr(c.status).toLowerCase();
        if (!CAND_MISSION_STATUSES.has(status)) return false;
        if (st && status !== st) return false;
        if (q) {
            const skills = candSkillsArray(c);
            const hay = `${safeStr(c.name)} ${safeStr(c.role)} ${safeStr(c.location)} ${skills.join(' ')} ${safeStr(c.tech)} ${safeStr(c.notes)}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });
    _sortCandidates(__missionFiltered);
    renderMissionTable();
}

function renderMissionTable() {
    const tbody = document.getElementById('missionTableBody');
    const empty = document.getElementById('missionEmptyState');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (__missionFiltered.length === 0) {
        if (empty) empty.style.display = 'block';
        tbody.innerHTML = '<tr><td colspan="9" style="padding:0; border:none;"><div class="state" style="padding:32px 16px;"><div class="state-illus"><i data-icon="search" data-size="40"></i></div><h3 class="state-title">Aucun candidat trouvé</h3><p class="state-desc">Aucun résultat pour ces filtres.</p></div></td></tr>';
        if (window.renderIcons) renderIcons(tbody);
        return;
    }
    if (empty) empty.style.display = 'none';
    __missionFiltered.forEach(c => {
        const skills = candSkillsArray(c);
        const skillsLabel = skills.join(', ');
        const combinedTech = skillsLabel ? (skillsLabel + (c.tech ? ' · ' + safeStr(c.tech) : '')) : safeStr(c.tech);
        const dcBadge = c.has_dc
            ? '<span class="dc-badge available" title="Dossier de compétences disponible">DC</span>'
            : `<button class="dc-badge missing dc-upload-btn" title="Cliquer pour uploader un DC (PDF)" onclick="event.stopPropagation();quickUploadDC(${c.id})">＋ DC</button>`;
        const descActionBtn = _buildDescActionBtn(c);
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.dataset.candidateId = c.id;
        tr.addEventListener('click', (e) => {
            if (e.target.closest('.mini-action, button, a, input, .dc-upload-btn, .desc-gen-btn, select')) return;
            window.location.href = '/candidat?id=' + c.id;
        });
        tr.innerHTML = `
            <td style="padding-left:12px;" onclick="event.stopPropagation()"><input type="checkbox" class="mission-row-select" title="Sélectionner" onclick="event.stopPropagation();toggleMissionSelect(${c.id}, this.checked)"></td>
            <td data-label="Nom"><span title="${escapeHtml(c.name || '')}">${escapeHtml(c.name || '')}</span></td>
            <td data-label="Rôle">${renderClampCell(c.role, 'table-cell-clamp--wide')}</td>
            <td data-label="Localisation">${renderClampCell(c.location, 'table-cell-clamp--wide')}</td>
            <td data-label="Compétences / Tech">${renderClampCell(combinedTech)}</td>
            <td data-label="DC">${dcBadge}</td>
            <td data-label="Statut">${renderStatusSelect(c.id, c.status)}</td>
            <td data-label="MAJ">${escapeHtml((c.updatedAt || c.createdAt || '').slice(0, 10))}</td>
            <td data-label="Actions">
              <div class="table-actions-inline">
                ${c.linkedin ? `<a class="mini-action" href="${escapeHtml(c.linkedin)}" target="_blank" title="LinkedIn">🔗</a>` : ''}
                ${descActionBtn}
                ${c.vsa_url ? `<a class="mini-action" href="${escapeHtml(c.vsa_url)}" target="_blank" title="Profil VSA">🧭</a>` : `<button class="mini-action" disabled style="opacity:0.25;cursor:default;" title="Pas de lien VSA">🧭</button>`}
                <button class="mini-action danger" onclick="deleteCandidate(${c.id})">🗑️</button>
              </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

let __missionSelected = new Set();
function toggleMissionSelect(id, checked) {
    if (checked) __missionSelected.add(id);
    else __missionSelected.delete(id);
    updateMissionSelectAllState();
}
function toggleMissionSelectAll(checked) {
    if (checked) __missionFiltered.forEach(c => __missionSelected.add(c.id));
    else __missionFiltered.forEach(c => __missionSelected.delete(c.id));
    renderMissionTable();
}
function updateMissionSelectAllState() {
    const cb = document.getElementById('missionSelectAll');
    if (!cb || !__missionFiltered.length) return;
    const n = __missionFiltered.filter(c => __missionSelected.has(c.id)).length;
    cb.checked = n === __missionFiltered.length;
    cb.indeterminate = n > 0 && n < __missionFiltered.length;
}

// ===== Onglet Hors Aura =====

let __horsAuraFiltered = [];

function applyHorsAuraFilters() {
    const q = (document.getElementById('horsAuraSearch')?.value || '').trim().toLowerCase();
    __horsAuraFiltered = __candidates.filter(c => {
        const status = safeStr(c.status).toLowerCase();
        if (!CAND_HORS_AURA_STATUSES.has(status)) return false;
        if (q) {
            const skills = candSkillsArray(c);
            const hay = `${safeStr(c.name)} ${safeStr(c.role)} ${safeStr(c.location)} ${skills.join(' ')} ${safeStr(c.tech)} ${safeStr(c.notes)}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });
    _sortCandidates(__horsAuraFiltered);
    renderHorsAuraTable();
}

function renderHorsAuraTable() {
    const tbody = document.getElementById('horsAuraTableBody');
    const empty = document.getElementById('horsAuraEmptyState');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (__horsAuraFiltered.length === 0) {
        if (empty) empty.style.display = 'block';
        tbody.innerHTML = '<tr><td colspan="9" style="padding:0; border:none;"><div class="state" style="padding:32px 16px;"><div class="state-illus"><i data-icon="search" data-size="40"></i></div><h3 class="state-title">Aucun candidat trouvé</h3><p class="state-desc">Aucun résultat pour ces filtres.</p></div></td></tr>';
        if (window.renderIcons) renderIcons(tbody);
        return;
    }
    if (empty) empty.style.display = 'none';
    __horsAuraFiltered.forEach(c => {
        const skills = candSkillsArray(c);
        const skillsLabel = skills.join(', ');
        const combinedTech = skillsLabel ? (skillsLabel + (c.tech ? ' · ' + safeStr(c.tech) : '')) : safeStr(c.tech);
        const dcBadge = c.has_dc
            ? '<span class="dc-badge available" title="Dossier de compétences disponible">DC</span>'
            : `<button class="dc-badge missing dc-upload-btn" title="Cliquer pour uploader un DC (PDF)" onclick="event.stopPropagation();quickUploadDC(${c.id})">＋ DC</button>`;
        const descActionBtn = _buildDescActionBtn(c);
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.dataset.candidateId = c.id;
        tr.addEventListener('click', (e) => {
            if (e.target.closest('.mini-action, button, a, input, .dc-upload-btn, .desc-gen-btn, select')) return;
            window.location.href = '/candidat?id=' + c.id;
        });
        const updatedAt = safeStr(c.updatedAt || c.createdAt || '').slice(0, 10);
        tr.innerHTML = `
            <td onclick="event.stopPropagation()"><input type="checkbox" ${__horsAuraSelected.has(c.id) ? 'checked' : ''} onchange="toggleHorsAuraSelect(${c.id}, this.checked)"></td>
            <td><strong>${escapeHtml(safeStr(c.name))}</strong></td>
            <td data-label="Rôle">${renderClampCell(c.role)}</td>
            <td data-label="Localisation">${renderClampCell(c.location)}</td>
            <td data-label="Compétences">${renderClampCell(combinedTech)}</td>
            <td>${dcBadge}</td>
            <td>${renderStatusSelect(c.id, c.status)}</td>
            <td>${escapeHtml(updatedAt)}</td>
            <td data-label="Actions">
              <div class="table-actions-inline">
                ${c.linkedin ? `<a class="mini-action" href="${escapeHtml(c.linkedin)}" target="_blank" title="LinkedIn">🔗</a>` : ''}
                ${descActionBtn}
                ${c.vsa_url ? `<a class="mini-action" href="${escapeHtml(c.vsa_url)}" target="_blank" title="Profil VSA">🧭</a>` : `<button class="mini-action" disabled style="opacity:0.25;cursor:default;" title="Pas de lien VSA">🧭</button>`}
                <button class="mini-action danger" onclick="deleteCandidate(${c.id})">🗑️</button>
              </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

let __horsAuraSelected = new Set();
function toggleHorsAuraSelect(id, checked) {
    if (checked) __horsAuraSelected.add(id);
    else __horsAuraSelected.delete(id);
    updateHorsAuraSelectAllState();
}
function toggleHorsAuraSelectAll(checked) {
    if (checked) __horsAuraFiltered.forEach(c => __horsAuraSelected.add(c.id));
    else __horsAuraFiltered.forEach(c => __horsAuraSelected.delete(c.id));
    renderHorsAuraTable();
}
function updateHorsAuraSelectAllState() {
    const cb = document.getElementById('horsAuraSelectAll');
    if (!cb || !__horsAuraFiltered.length) return;
    const n = __horsAuraFiltered.filter(c => __horsAuraSelected.has(c.id)).length;
    cb.checked = n === __horsAuraFiltered.length;
    cb.indeterminate = n > 0 && n < __horsAuraFiltered.length;
}

// ===== Onglet LinkedIn =====

let __linkedinFiltered = [];

function applyLinkedinFilters() {
    const q = (document.getElementById('linkedinSearch')?.value || '').trim().toLowerCase();
    const st = (document.getElementById('linkedinStatusFilter')?.value || '').trim().toLowerCase();
    __linkedinFiltered = __candidates.filter(c => {
        const status = safeStr(c.status).toLowerCase();
        if (!CAND_LINKEDIN_STATUSES.has(status)) return false;
        if (st && status !== st) return false;
        if (q) {
            const skills = candSkillsArray(c);
            const hay = `${safeStr(c.name)} ${safeStr(c.role)} ${safeStr(c.location)} ${skills.join(' ')} ${safeStr(c.tech)} ${safeStr(c.notes)}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });
    _sortCandidates(__linkedinFiltered);
    renderLinkedinTable();
}

function renderLinkedinTable() {
    const tbody = document.getElementById('linkedinTableBody');
    const empty = document.getElementById('linkedinEmptyState');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (__linkedinFiltered.length === 0) {
        if (empty) empty.style.display = 'block';
        tbody.innerHTML = '<tr><td colspan="9" style="padding:0; border:none;"><div class="state" style="padding:32px 16px;"><div class="state-illus"><i data-icon="search" data-size="40"></i></div><h3 class="state-title">Aucun candidat trouvé</h3><p class="state-desc">Aucun résultat pour ces filtres.</p></div></td></tr>';
        if (window.renderIcons) renderIcons(tbody);
        return;
    }
    if (empty) empty.style.display = 'none';
    __linkedinFiltered.forEach(c => {
        const skills = candSkillsArray(c);
        const skillsLabel = skills.join(', ');
        const combinedTech = skillsLabel ? (skillsLabel + (c.tech ? ' · ' + safeStr(c.tech) : '')) : safeStr(c.tech);
        const dcBadge = c.has_dc
            ? '<span class="dc-badge available" title="Dossier de compétences disponible">DC</span>'
            : `<button class="dc-badge missing dc-upload-btn" title="Cliquer pour uploader un DC (PDF)" onclick="event.stopPropagation();quickUploadDC(${c.id})">＋ DC</button>`;
        const descActionBtn = _buildDescActionBtn(c);
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.dataset.candidateId = c.id;
        tr.addEventListener('click', (e) => {
            if (e.target.closest('.mini-action, button, a, input, .dc-upload-btn, .desc-gen-btn, select')) return;
            window.location.href = '/candidat?id=' + c.id;
        });
        tr.innerHTML = `
            <td style="padding-left:12px;" onclick="event.stopPropagation()"><input type="checkbox" class="linkedin-row-select" title="Sélectionner" onclick="event.stopPropagation();toggleLinkedinSelect(${c.id}, this.checked)"></td>
            <td data-label="Nom"><span title="${escapeHtml(c.name || '')}">${escapeHtml(c.name || '')}</span></td>
            <td data-label="Rôle">${renderClampCell(c.role, 'table-cell-clamp--wide')}</td>
            <td data-label="Localisation">${renderClampCell(c.location, 'table-cell-clamp--wide')}</td>
            <td data-label="Compétences / Tech">${renderClampCell(combinedTech)}</td>
            <td data-label="DC">${dcBadge}</td>
            <td data-label="Statut">${renderStatusSelect(c.id, c.status)}</td>
            <td data-label="MAJ">${escapeHtml((c.updatedAt || c.createdAt || '').slice(0, 10))}</td>
            <td data-label="Actions">
              <div class="table-actions-inline">
                ${c.linkedin ? `<a class="mini-action" href="${escapeHtml(c.linkedin)}" target="_blank" title="LinkedIn">🔗</a>` : ''}
                ${descActionBtn}
                ${c.vsa_url ? `<a class="mini-action" href="${escapeHtml(c.vsa_url)}" target="_blank" title="Profil VSA">🧭</a>` : `<button class="mini-action" disabled style="opacity:0.25;cursor:default;" title="Pas de lien VSA">🧭</button>`}
                <button class="mini-action danger" onclick="deleteCandidate(${c.id})">🗑️</button>
              </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

let __linkedinSelected = new Set();
function toggleLinkedinSelect(id, checked) {
    if (checked) __linkedinSelected.add(id);
    else __linkedinSelected.delete(id);
    updateLinkedinSelectAllState();
}
function toggleLinkedinSelectAll(checked) {
    if (checked) __linkedinFiltered.forEach(c => __linkedinSelected.add(c.id));
    else __linkedinFiltered.forEach(c => __linkedinSelected.delete(c.id));
    renderLinkedinTable();
}
function updateLinkedinSelectAllState() {
    const cb = document.getElementById('linkedinSelectAll');
    if (!cb || !__linkedinFiltered.length) return;
    const n = __linkedinFiltered.filter(c => __linkedinSelected.has(c.id)).length;
    cb.checked = n === __linkedinFiltered.length;
    cb.indeterminate = n > 0 && n < __linkedinFiltered.length;
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
    document.getElementById('candStatus').value = safeStr(c.status || 'nouveau');
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
        showToast('Enregistrement impossible: ' + (txt || ('HTTP ' + res.status)), 'error');
        return;
    }

    closeCandidateModal();
    await loadCandidates();
    applyCandidateFilters();
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
        const txt = await res.text().catch(() => '');
        showToast('Suppression impossible: ' + (txt || ('HTTP ' + res.status)), 'error');
        return;
    }

    // Mise à jour UI immédiate
    await loadCandidates();
    applyCandidateFilters();

    // Toast avec bouton Annuler (10 secondes)
    if (typeof showUndoToast === 'function') {
        showUndoToast(`Candidat supprimé\u00a0: ${label}`, 'candidate', id, async () => {
            const r = await fetch('/api/soft-deleted/restore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'candidate', id })
            });
            if ((await r.json()).ok) {
                await loadCandidates();
                applyCandidateFilters();
                showToast('↩️ Candidat restauré', 'success', 2500);
            } else {
                showToast('❌ Impossible d\'annuler', 'error');
            }
        });
    }
}

// ===== Sélection multiple + actions en masse =====

function toggleCandidateSelect(id, checked) {
    if (checked) __selectedCandidates.add(id);
    else __selectedCandidates.delete(id);
    const tr = document.querySelector(`#candTableBody tr[data-candidate-id="${id}"]`);
    if (tr) {
        tr.classList.toggle('row-selected', checked);
        const cb = tr.querySelector('.cand-row-select');
        if (cb) cb.checked = checked;
    }
    updateCandidateBulkBar();
    updateCandidateSelectAllState();
}

function toggleCandidateSelectAll(checked) {
    if (checked) __candFiltered.forEach(c => __selectedCandidates.add(c.id));
    else __candFiltered.forEach(c => __selectedCandidates.delete(c.id));
    renderCandidateTable();
    updateCandidateBulkBar();
}

function clearCandidateSelection() {
    __selectedCandidates.clear();
    renderCandidateTable();
    updateCandidateBulkBar();
}

function updateCandidateBulkBar() {
    const bar = document.getElementById('candBulkActions');
    const countEl = document.getElementById('candBulkCount');
    if (!bar || !countEl) return;
    countEl.textContent = __selectedCandidates.size;
    bar.style.display = __selectedCandidates.size > 0 ? 'flex' : 'none';
}

function updateCandidateSelectAllState() {
    const cb = document.getElementById('candSelectAll');
    if (!cb) return;
    if (!__candFiltered.length) {
        cb.checked = false;
        cb.indeterminate = false;
        return;
    }
    const n = __candFiltered.filter(c => __selectedCandidates.has(c.id)).length;
    cb.checked = n === __candFiltered.length;
    cb.indeterminate = n > 0 && n < __candFiltered.length;
}

async function applyBulkCandidateStatus() {
    const status = document.getElementById('candBulkStatus')?.value;
    if (!status) { showToast('Choisissez un statut.', 'warning'); return; }
    if (!__selectedCandidates.size) return;
    const ids = [...__selectedCandidates];
    try {
        const res = await fetch('/api/candidates/bulk-update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids, field: 'status', value: status })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        showToast(`Statut mis à jour pour ${ids.length} candidat(s).`, 'success');
        clearCandidateSelection();
        await loadCandidates();
        applyCandidateFilters();
    } catch(e) {
        showToast('Impossible de mettre à jour : ' + (e?.message || e), 'error');
    }
}

async function deleteSelectedCandidates() {
    if (!__selectedCandidates.size) return;
    const ids = [...__selectedCandidates];
    if (!confirm(`⚠️ Supprimer ${ids.length} candidat(s) sélectionné(s) ?\nCette action peut être annulée.`)) return;
    let done = 0;
    for (const id of ids) {
        const res = await fetch('/api/candidates/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });
        if (res.ok) done++;
    }
    showToast(`${done} candidat(s) supprimé(s).`, 'success');
    clearCandidateSelection();
    await loadCandidates();
    applyCandidateFilters();
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
            status: 'nouveau',
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

// ===== Tabs =====
function setTab(tab) {
    const panels  = { pipeline: 'panelPipeline', linkedin: 'panelLinkedin', mission: 'panelMission', archive: 'panelArchive', horsaura: 'panelHorsAura', settings: 'panelSettings' };
    const buttons = { pipeline: 'tabPipeline',   linkedin: 'tabLinkedin',   mission: 'tabMission',   archive: 'tabArchive',   horsaura: 'tabHorsAura',   settings: 'tabSettings'   };
    Object.entries(panels).forEach(([t, id]) => {
        const el = document.getElementById(id);
        if (el) el.style.display = t === tab ? 'block' : 'none';
    });
    Object.entries(buttons).forEach(([t, id]) => {
        document.getElementById(id)?.classList.toggle('active', t === tab);
    });
    if (tab === 'linkedin') applyLinkedinFilters();
    if (tab === 'archive') applyArchiveFilters();
    if (tab === 'mission') applyMissionFilters();
    if (tab === 'horsaura') applyHorsAuraFilters();
    if (tab === 'settings') loadSettingsTab();
}

// ===== Onglet Paramètres =====

const _DEFAULT_PROMPT_PLACEHOLDER = '(prompt par défaut intégré — laissez vide pour l\'utiliser)';

async function loadSettingsTab() {
    try {
        const res = await fetch('/api/ai/config');
        const j = await res.json();
        if (!j.ok) return;
        const cfg = j.config;
        const promptEl = document.getElementById('settingDescPrompt');
        const maxCharsEl = document.getElementById('settingPdfMaxChars');
        if (promptEl) promptEl.value = cfg.candidate_description_prompt || '';
        if (maxCharsEl) maxCharsEl.value = cfg.candidate_pdf_max_chars || 6000;
    } catch(e) {
        showToast('Impossible de charger la config IA', 'error');
    }
}

async function saveSettingsTab() {
    const promptEl = document.getElementById('settingDescPrompt');
    const maxCharsEl = document.getElementById('settingPdfMaxChars');
    const btn = document.getElementById('btnSaveSettings');
    const payload = {
        candidate_description_prompt: (promptEl?.value ?? '').trim(),
        candidate_pdf_max_chars: parseInt(maxCharsEl?.value) || 6000,
    };
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Enregistrement…'; }
    try {
        const res = await fetch('/api/ai/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const j = await res.json().catch(() => ({}));
        if (res.ok && j.ok) {
            showToast('Paramètres enregistrés', 'success');
        } else {
            showToast(j.error || 'Erreur lors de la sauvegarde', 'error');
        }
    } catch(e) {
        showToast('Erreur réseau : ' + (e?.message || e), 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '💾 Enregistrer les paramètres'; }
    }
}

function resetPromptToDefault() {
    const el = document.getElementById('settingDescPrompt');
    if (el) { el.value = ''; el.focus(); }
    showToast('Prompt vidé — le prompt intégré sera utilisé', 'info');
}

function showDefaultPrompt() {
    const DEFAULT = `Tu es un commercial senior dans une société de conseil en ingénierie. Tu dois rédiger une présentation percutante pour un email de prospection B2B — l'objectif est de DONNER ENVIE au client de rencontrer le candidat.

Rédige EXACTEMENT 2 phrases à partir du dossier de compétences ci-dessous.

PHRASE 1 — Présentation générale (identité + titre + expérience) :
- Commence par le prénom en gras HTML : <b>{prenom}</b>
- Donne son vrai titre de poste (ingénieur, développeur, architecte, chef de projet… — jamais « consultant »)
- Mentionne ses années d'expérience réelles trouvées dans le dossier
- Cite ses domaines principaux d'intervention ou sa spécialité distinctive
- Style : clair, professionnel, direct

PHRASE 2 — Accroche vendeuse (réalisation concrète) :
- Ton dynamique avec un verbe d'action ("a conçu", "a piloté", "a développé", "a validé", "a déployé"…)
- S'appuie sur une réalisation ou mission concrète citée dans le dossier
- Met en avant la valeur apportée ou le résultat obtenu si disponible
- Peut citer 1 à 2 technologies clés pour rassurer le client

Règles communes :
- Tout le contenu doit venir EXCLUSIVEMENT du dossier ci-dessous
- En français — ne pas écrire "il/elle est disponible" ni "il/elle cherche un poste"
- Les 2 phrases ensemble font 70-100 mots max

Exemple de structure attendue :
"<b>Prénom</b>, [titre réel] avec [X] ans d'expérience, spécialisé(e) en [domaine(s) réel(s) du dossier]. Il/Elle a [réalisation concrète issue du dossier], [résultat ou point fort différenciant]."

Dossier de compétences :
{pdf_text}

Réponds UNIQUEMENT avec les 2 phrases, sans guillemets, sans tiret au début, sans commentaire.`;
    const el = document.getElementById('settingDescPrompt');
    if (el && !el.value.trim()) {
        el.value = DEFAULT;
        showToast('Prompt par défaut copié dans l\'éditeur — modifiez-le puis enregistrez', 'info', 5000);
    } else if (el) {
        // Ouvrir dans un alert pour ne pas écraser les modifs en cours
        alert('Prompt par défaut :\n\n' + DEFAULT);
    }
}

let __bulkGenRunning = false;
async function bulkGenerateDescriptions() {
    if (__bulkGenRunning) return;
    const targets = __candidates.filter(c => c.has_dc && !(c.description_push && c.description_push.trim()));
    if (targets.length === 0) {
        showToast('Tous les candidats avec DC ont déjà une phrase de présentation ✨', 'success');
        return;
    }
    if (!confirm(`Générer les phrases de présentation pour ${targets.length} candidat(s) ?\n\nOpération séquentielle — environ ${targets.length * 20}–${targets.length * 60} secondes selon Ollama.`)) return;

    __bulkGenRunning = true;
    const btn = document.getElementById('btnBulkGenerate');
    const progress = document.getElementById('bulkGenProgress');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Génération en cours…'; }

    let done = 0, errors = 0;
    for (const cand of targets) {
        if (progress) progress.textContent = `${done + errors + 1} / ${targets.length} — ${escapeHtml(cand.name)}…`;
        try {
            const res = await fetch(`/api/candidates/${cand.id}/generate-description`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }
            });
            const j = await res.json().catch(() => ({}));
            if (res.ok && j.ok && j.description) {
                cand.description_push = j.description;
                // Mettre à jour le bouton IA dans le DOM si visible
                const tr = document.querySelector(`tr[data-candidate-id="${cand.id}"]`);
                if (tr) {
                    const btn2 = tr.querySelector('.desc-gen-btn');
                    if (btn2) { btn2.textContent = '✨'; btn2.style.opacity = '0.7'; btn2.title = 'Phrase IA rédigée — cliquer pour régénérer'; }
                }
                done++;
            } else {
                errors++;
            }
        } catch(e) {
            errors++;
        }
    }

    __bulkGenRunning = false;
    if (btn) { btn.disabled = false; btn.textContent = '🤖 Générer les introductions manquantes'; }
    if (progress) progress.textContent = `✅ ${done} générée(s)${errors ? ` · ❌ ${errors} échec(s)` : ''}`;
    showToast(`Génération terminée : ${done} réussie(s)${errors ? ', ' + errors + ' échec(s)' : ''}`, errors ? 'warning' : 'success');
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


document.addEventListener('DOMContentLoaded', async () => {
    try {
        const fn = window.bootstrap || window.appBootstrap;
        if (typeof fn === 'function') await fn('sourcing');
    } catch (e) {}

    await loadCandidateFolderSettings();
    document.getElementById('btnSaveCandidateFolder')?.addEventListener('click', saveCandidateFolderSettings);
    document.getElementById('btnScanCandidateFolder')?.addEventListener('click', scanCandidateFolder);

    // Pipeline events
    document.getElementById('candSearch')?.addEventListener('input', applyCandidateFilters);
    document.getElementById('candStatusFilter')?.addEventListener('change', applyCandidateFilters);
    document.getElementById('candSkillsFilter')?.addEventListener('input', applyCandidateFilters);
    document.getElementById('btnAddCandidate')?.addEventListener('click', openWizardCandModal);
    document.getElementById('candForm')?.addEventListener('submit', saveCandidate);

    // Archive tab events
    document.getElementById('archiveSearch')?.addEventListener('input', applyArchiveFilters);
    document.getElementById('archiveStatusFilter')?.addEventListener('change', applyArchiveFilters);

    // Mission tab events
    document.getElementById('missionSearch')?.addEventListener('input', applyMissionFilters);
    document.getElementById('missionStatusFilter')?.addEventListener('change', applyMissionFilters);

    // Hors Aura tab events
    document.getElementById('horsAuraSearch')?.addEventListener('input', applyHorsAuraFilters);

    // LinkedIn tab events
    document.getElementById('linkedinSearch')?.addEventListener('input', applyLinkedinFilters);
    document.getElementById('linkedinStatusFilter')?.addEventListener('change', applyLinkedinFilters);

    // Tabs
    document.getElementById('tabPipeline')?.addEventListener('click', () => setTab('pipeline'));
    document.getElementById('tabLinkedin')?.addEventListener('click', () => setTab('linkedin'));
    document.getElementById('tabMission')?.addEventListener('click', () => setTab('mission'));
    document.getElementById('tabArchive')?.addEventListener('click', () => setTab('archive'));
    document.getElementById('tabHorsAura')?.addEventListener('click', () => setTab('horsaura'));
    document.getElementById('tabSettings')?.addEventListener('click', () => setTab('settings'));

    try {
        await loadCandidates();
        applyCandidateFilters();
        applyLinkedinFilters();
        updateCandSortIndicators();
    } catch (err) {
        console.error(err);
        showToast("❌ Impossible de charger les candidats. Vérifiez que le serveur Python est lancé (app.py).", 'error');
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

// ─────────────────────────────────────────────────────────────────────────────
// v27.x PARTIE 3 — Wizard ajout candidat (2 étapes)
// Étape 1 : Import DC PDF + VSA URL + statut
// Étape 2 : Validation champs extraits par Ollama
// ─────────────────────────────────────────────────────────────────────────────

let __wizardDcFile = null;

function openWizardCandModal() {
    __wizardDcFile = null;
    document.getElementById('wizardDcFileName').style.display = 'none';
    document.getElementById('wizardDcFileName').textContent = '';
    document.getElementById('wizardDcFile').value = '';
    const liEl = document.getElementById('wizardLinkedin');
    if (liEl) liEl.value = '';
    document.getElementById('wizardVsaUrl').value = '';
    document.getElementById('wizardStatus').value = 'nouveau';
    document.getElementById('wizardBtnAnalyze').disabled = true;
    document.getElementById('wizardStep1').style.display = '';
    document.getElementById('wizardStep2').style.display = 'none';
    const modal = document.getElementById('modalAddCandidateWizard');
    if (window.openModal) window.openModal(modal);
    else modal.classList.add('active');
}

function wizardSkipToStep2() {
    _wizardShowStep2({}, false, null);
}

function closeWizardCandModal() {
    const modal = document.getElementById('modalAddCandidateWizard');
    if (window.closeModal) window.closeModal(modal);
    else modal.classList.remove('active');
    __wizardDcFile = null;
}

function wizardOnFileChange(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    __wizardDcFile = file;
    const fn = document.getElementById('wizardDcFileName');
    fn.textContent = '📄 ' + file.name;
    fn.style.display = 'block';
    document.getElementById('wizardBtnAnalyze').disabled = false;
}

function wizardHandleDrop(event) {
    event.preventDefault();
    document.getElementById('wizardDcDrop').classList.remove('dragging');
    const file = event.dataTransfer.files && event.dataTransfer.files[0];
    if (!file || !file.name.endsWith('.pdf')) {
        if (typeof showToast === 'function') showToast('Veuillez déposer un fichier PDF', 'warning');
        return;
    }
    __wizardDcFile = file;
    const fn = document.getElementById('wizardDcFileName');
    fn.textContent = '📄 ' + file.name;
    fn.style.display = 'block';
    document.getElementById('wizardBtnAnalyze').disabled = false;
}

async function wizardAnalyzeDC() {
    const btn = document.getElementById('wizardBtnAnalyze');
    const origLabel = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="pt-spinner"></span> Extraction IA…';

    // Si pas de DC, passer directement à l'étape 2 avec champs vides
    if (!__wizardDcFile) {
        _wizardShowStep2({}, false, 'Saisie manuelle (pas de DC fourni)');
        btn.disabled = false; btn.innerHTML = origLabel;
        return;
    }

    try {
        const formData = new FormData();
        formData.append('dc', __wizardDcFile);
        const res = await fetch('/api/candidates/extract-dc', { method: 'POST', body: formData });
        if (!res.ok) {
            const e = await res.json().catch(() => ({}));
            const msg = e.error || `HTTP ${res.status}`;
            _wizardShowStep2({}, false, 'Extraction IA indisponible — saisie manuelle (' + msg + ')');
        } else {
            const payload = await res.json();
            _wizardShowStep2(payload.fields || {}, true, null);
        }
    } catch (_) {
        _wizardShowStep2({}, false, 'Extraction IA indisponible — saisie manuelle');
    } finally {
        btn.disabled = false; btn.innerHTML = origLabel;
    }
}

function _wizardShowStep2(fields, aiOk, message) {
    document.getElementById('wizardStep1').style.display = 'none';
    document.getElementById('wizardStep2').style.display = '';

    const msgEl = document.getElementById('wizardAiMessage');
    if (message) {
        msgEl.textContent = message;
        msgEl.style.display = 'block';
    } else {
        msgEl.style.display = 'none';
    }

    // Pré-remplir les champs
    _wizardSetField('wizardName',   fields.name   || '');
    _wizardSetField('wizardPrenom', fields.prenom || '', aiOk && !!fields.prenom);
    _wizardSetField('wizardTitre',  fields.titre  || '', aiOk && !!fields.titre);
    _wizardSetField('wizardAnnees', fields.annees_experience != null ? String(fields.annees_experience) : '', aiOk && fields.annees_experience != null);
    _wizardSetField('wizardDomaine',fields.domaine_principal || '', aiOk && !!fields.domaine_principal);
    _wizardSetField('wizardRole',   fields.role   || '', false);
    _wizardSetField('wizardTags',   Array.isArray(fields.tags) ? fields.tags.join(', ') : (fields.tags || ''), aiOk && !!fields.tags);
}

function _wizardSetField(id, value, showBadge = false) {
    const el = document.getElementById(id);
    if (el) el.value = value;
    const badge = document.getElementById(id + '_badge');
    if (badge) badge.style.display = showBadge ? 'inline-block' : 'none';
}

function wizardGoBack() {
    document.getElementById('wizardStep1').style.display = '';
    document.getElementById('wizardStep2').style.display = 'none';
}

async function wizardCreateCandidate() {
    const name = document.getElementById('wizardName').value.trim();
    if (!name) {
        if (typeof showToast === 'function') showToast('Le nom est obligatoire', 'warning');
        return;
    }

    const btn = document.getElementById('wizardBtnCreate');
    const orig = btn.innerHTML; btn.disabled = true; btn.innerHTML = 'Création…';

    const payload = {
        name,
        prenom: document.getElementById('wizardPrenom').value.trim() || null,
        titre:  document.getElementById('wizardTitre').value.trim()  || null,
        annees_experience: parseInt(document.getElementById('wizardAnnees').value) || null,
        domaine_principal: document.getElementById('wizardDomaine').value.trim() || null,
        role:   document.getElementById('wizardRole').value.trim()   || null,
        linkedin: document.getElementById('wizardLinkedin')?.value.trim() || null,
        vsa_url: document.getElementById('wizardVsaUrl').value.trim() || null,
        status: document.getElementById('wizardStatus').value,
        skills: document.getElementById('wizardTags').value.split(',').map(s => s.trim()).filter(Boolean),
    };

    try {
        const res = await fetch('/api/candidates/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            if (typeof showToast === 'function') showToast('Erreur création : ' + (txt || res.status), 'error');
            return;
        }
        const data = await res.json();
        const candidateId = data.id;

        // Upload DC si présent
        if (__wizardDcFile && candidateId) {
            const fd = new FormData();
            fd.append('dc', __wizardDcFile);
            fd.append('candidate_id', candidateId);
            await fetch('/api/candidates/upload-dc', { method: 'POST', body: fd }).catch(() => {});
        }

        if (typeof showToast === 'function') showToast('Candidat créé !', 'success');
        closeWizardCandModal();
        if (typeof loadCandidates === 'function') await loadCandidates();
        if (typeof applyCandidateFilters === 'function') applyCandidateFilters();
        if (typeof applyLinkedinFilters === 'function') applyLinkedinFilters();
    } catch (e) {
        if (typeof showToast === 'function') showToast('Erreur réseau : ' + e.message, 'error');
    } finally {
        btn.disabled = false; btn.innerHTML = orig;
    }
}
