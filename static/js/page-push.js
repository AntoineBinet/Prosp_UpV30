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
            `${safeStr(l.prospect_name)} ${safeStr(l.company_groupe)} ${safeStr(l.company_site)} ${safeStr(l.prospect_email)} ${safeStr(l.to_email)} ${safeStr(l.subject)} ${safeStr(l.channel)} ${safeStr(l.consultant1_name)} ${safeStr(l.consultant2_name)}`
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
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding: 35px; color: var(--color-text-secondary);">Aucun résultat</td></tr>';
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
        const consultants = [l.consultant1_name, l.consultant2_name].filter(Boolean).join(', ') || '—';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td data-label="Date">${escapeHtml(dateFormatted)}</td>
            <td data-label="Prospect"><span class="table-cell-clamp" title="${escapeHtml(l.prospect_name || '')}">${escapeHtml(l.prospect_name || '')}</span></td>
            <td data-label="Entreprise"><span class="table-cell-clamp" title="${escapeHtml(company)}">${escapeHtml(company)}</span></td>
            <td data-label="Email"><span class="table-cell-clamp" title="${escapeHtml(l.to_email || l.prospect_email || '')}">${escapeHtml(l.to_email || l.prospect_email || '')}</span></td>
            <td data-label="Sujet"><span class="table-cell-clamp" title="${escapeHtml(safeStr(l.subject))}">${escapeHtml(safeStr(l.subject) || '—')}</span></td>
            <td data-label="Consultant(s)"><span class="table-cell-clamp" title="${escapeHtml(consultants)}">${escapeHtml(consultants)}</span></td>
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

    const detailConsultants = [l.consultant1_name, l.consultant2_name].filter(Boolean).join(', ') || '—';
    body.innerHTML = `
        <div class="detail-info" style="margin-bottom: 10px;">
            <div><strong>Date:</strong> ${escapeHtml(dateFormatted)}</div>
            <div><strong>Prospect:</strong> ${escapeHtml(l.prospect_name || '')}</div>
            <div><strong>Entreprise:</strong> ${escapeHtml(company)}</div>
            <div><strong>Email:</strong> ${escapeHtml(l.to_email || l.prospect_email || '')}</div>
            <div><strong>Canal:</strong> ${escapeHtml(pushChannelLabel(l.channel))}</div>
            <div><strong>Template:</strong> ${escapeHtml(l.template_name || '—')}</div>
            <div><strong>Consultant(s):</strong> ${escapeHtml(detailConsultants)}</div>
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
let __catFilesData = {};    // cache: catId -> files[]
let __openCatDetailId = null;

function __catEl(id) { return document.getElementById(id); }

// Descriptions détaillées par catégorie (clé = nom exact de la catégorie)
const __catDescriptions = {
    'Automatisme_Informatique_Industrielle': 'Conception, programmation et mise en service de systèmes automatisés de production. Ces ingénieurs programment des automates (PLC/API), développent des architectures SCADA/supervision, et assurent la communication entre équipements via des réseaux industriels (Modbus, Profibus, EtherNet/IP, OPC-UA). Compétences clés : Siemens TIA Portal, Rockwell Studio 5000, Schneider, KUKA, ABB, jumeaux numériques, Industry 4.0. Managers cibles : Responsable Automatisme, Directeur de Production, Chef de Département Systèmes de Contrôle.',
    'Cybersécurité': 'Protection des systèmes informatiques et réseaux contre les cyberattaques. Interventions sur l\'audit de sécurité, la mise en place de politiques de sécurité (firewall, IAM, SOC), la détection d\'incidents (SIEM/XDR), la gestion des plans de reprise et la conformité réglementaire (NIS2, ISO 27001, ANSSI). Particulièrement critique dans les industries OT/IT (énergie, santé, infrastructure). Managers cibles : RSSI, Responsable Sécurité des SI, DSI.',
    'Data_IA': 'Regroupe trois profils complémentaires — Data Engineer (pipelines ETL, architectures Big Data, bases de données), Data Scientist (modèles prédictifs ML/DL, analyse métier) et Développeur IA (implémentation et mise en production de modèles d\'intelligence artificielle). Stratégiques pour la maintenance prédictive, l\'analyse de données biologiques, et l\'optimisation de performance industrielle. Managers cibles : Responsable Data, Chief Data Officer, Directeur R&D, Responsable Innovation.',
    'DevOps': 'Pont entre développement logiciel et opérations IT. Mise en place des pipelines CI/CD (intégration et déploiement continus), automatisation via Terraform, Ansible, Docker, Kubernetes, surveillance des systèmes en production et sécurisation des pipelines (DevSecOps). Essentiel pour les entreprises qui développent des logiciels embarqués ou des plateformes IoT industrielles. Managers cibles : Responsable Infrastructure, DSI, Lead Tech.',
    'Electronique_Système': 'Conception de cartes électroniques (PCB design, schématique), travail sur composants (FPGA, microcontrôleurs), tests électroniques et validation hardware. Profils : Ingénieur Électronique Hardware, Ingénieur FPGA/VHDL, Ingénieur Électronique Analogique/Numérique. Fortement demandé en électronique de puissance (ferroviaire), électronique embarquée véhicule et instrumentation médicale. Managers cibles : Responsable Bureau d\'Études Électronique, Chef de Projet Hardware, Responsable R&D.',
    'Gestion_de_Projet': 'Pilotage de projets techniques de bout en bout — planification, gestion des ressources, des coûts et des délais, coordination des équipes pluridisciplinaires et reporting client. Maîtrise de méthodologies PMI/PMP, Prince2 ou Agile/Scrum adapté à l\'industrie. Profil transversal très valorisé sur des projets d\'envergure pluriannuels. Managers cibles : Directeur de Projets, PMO, Directeur Technique.',
    'Ingenierie_Mecanique_CAO': 'Conception de pièces et assemblages mécaniques via des outils CAO (CATIA, SolidWorks, NX, Creo) et réalisation de calculs de structures (éléments finis, RDM). Profils : Ingénieur Conception Mécanique, Ingénieur Calcul Structure, Ingénieur Industrialisation. Indispensable pour la conception de poids lourds, de matériel ferroviaire et d\'instrumentation médicale. Managers cibles : Responsable Bureau d\'Études Mécanique, Chef de Projet Industrialisation, Responsable R&D Produit.',
    'Logiciels': 'Développement d\'applications logicielles industrielles (applications métier, interfaces HMI, middleware, architecture logicielle, maintenance applicative). Profils : Développeur C/C++, Développeur .NET/Java, Architecte Logiciel, Ingénieur Logiciel embarqué. Pertinent pour les clients développant en interne leurs logiciels de supervision, de pilotage ou d\'analyse. Managers cibles : Responsable Développement Logiciel, Lead Developer, DSI.',
    'Systèmes Embarqués & Traitement du Signal': 'Développement logiciel bas niveau (bare metal, RTOS), portage d\'OS temps réel (FreeRTOS, VxWorks, Linux embarqué), acquisition et traitement de signaux (filtres numériques, FFT, DSP). Profils : Ingénieur Systèmes Embarqués, Ingénieur DSP/Signal, Ingénieur BSP/Firmware. Cœur de métier d\'Up Technologie, forte demande en systèmes ferroviaires, ECU/BCM automobile et capteurs biologiques. Managers cibles : Responsable Systèmes Embarqués, Chef de Projet Firmware, Responsable R&D Électronique.',
    'Systèmes_Réseaux': 'Administration et évolution de l\'infrastructure IT/OT — serveurs, réseaux LAN/WAN, virtualisation (VMware, Hyper-V), stockage SAN/NAS, connectivité industrielle et supervision des systèmes critiques. Très utile pour les infrastructures de supervision énergétique et les sites industriels multi-sites. Managers cibles : Responsable Infrastructure IT, Responsable Systèmes d\'Information, DSI.',
    'Test_Qualite_Logicielle': 'Conception et exécution de plans de test (unitaires, intégration, validation), développement de frameworks de test automatisés (Robot Framework, Selenium, pytest), et conformité aux normes qualité sectorielles (ISO 26262 automobile, EN 50128 ferroviaire, IEC 62304 médical). Profil critique dans les industries où la certification logicielle est réglementaire. Managers cibles : Responsable Validation, Responsable Qualité Logicielle, Chef de Projet Test.',
    'Simulation_Modélisation': 'Développement de modèles de simulation et de modélisation numérique pour valider des systèmes avant prototypage physique. Utilisation de Matlab/Simulink, ANSYS, Altair, Model-Based Design (MBD). Profils : Ingénieur Simulation, Ingénieur Modélisation Numérique, Ingénieur Model-Based Design. Très demandé en R&D embarquée, ferroviaire et automobile pour la réduction des cycles de développement. Managers cibles : Responsable R&D, Chef de Projet Systèmes, Responsable Validation V&V.',
    'Electrotechnique_Energie': 'Conception et dimensionnement de systèmes électrotechniques et de génie électrique — électronique de puissance, variateurs, motorisation, réseaux HTA/HTB, postes de transformation, énergies renouvelables et stockage. Profils : Ingénieur Électrotechnicien, Ingénieur Génie Électrique, Ingénieur Énergie. Très demandé chez les producteurs/distributeurs d\'énergie et dans la traction électrique ferroviaire ou véhicule industriel. Managers cibles : Responsable Génie Électrique, Chef de Projet Énergie, Directeur Technique.',
    'Surete_Fonctionnement_SdF': 'Analyse et maîtrise de la sûreté de fonctionnement des systèmes critiques — fiabilité, disponibilité, maintenabilité et sécurité (RAMS). Réalisation d\'analyses FMECA, HAZOP, arbres de défaillances (FTA), et application des normes de sécurité fonctionnelle (IEC 61508, IEC 61511, EN 50129). Profils : Ingénieur SdF/RAMS, Ingénieur Sécurité Fonctionnelle, Expert Fiabilité. Critique dans les systèmes nucléaires, ferroviaires et industriels certifiés. Managers cibles : Responsable Sûreté de Fonctionnement, Chef de Projet Sécurité, Directeur Qualité & Risques.'
};

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
    // Charger les fichiers en arrière-plan pour mettre à jour les badges
    __categories.forEach(cat => loadCatFiles(cat.id));
}

async function loadCatFiles(catId) {
    try {
        const res = await fetch(`/api/push-categories/${catId}/files`);
        if (!res.ok) {
            __catFilesData[catId] = [];
        } else {
            const data = await res.json();
            __catFilesData[catId] = (data.ok && data.files && data.files.length) ? data.files : [];
        }
    } catch (e) {
        __catFilesData[catId] = [];
    }
    _updateCatTplBadge(catId);
    _renderModalCatFiles(catId);
}

function _updateCatTplBadge(catId) {
    const badge = document.getElementById(`catTplBadge_${catId}`);
    if (!badge) return;
    const files = __catFilesData[catId] || [];
    const has = files.length > 0;
    badge.className = `push-cat-badge ${has ? 'has' : 'none'}`;
    badge.textContent = has ? '📧 Template chargé' : '📧 Aucun template';
}

function _updateCatCandBadge(catId) {
    const cat = __categories.find(c => c.id === catId);
    if (!cat) return;
    const badge = document.getElementById(`catCandBadge_${catId}`);
    if (!badge) return;
    const n = (cat.candidate1_id ? 1 : 0) + (cat.candidate2_id ? 1 : 0);
    const text = n === 0 ? 'Aucun candidat' : n === 1 ? '1 candidat sélectionné' : '2 candidats sélectionnés';
    badge.className = `push-cat-badge ${n > 0 ? 'has' : 'none'}`;
    badge.textContent = '👤 ' + text;
}

function _renderModalCatFiles(catId) {
    const box = document.getElementById(`catFiles_${catId}`);
    if (!box) return; // modal non ouverte
    const files = __catFilesData[catId];
    if (files === undefined) {
        if (window.renderLoading) renderLoading(box, { rows: 3 });
        else box.innerHTML = '<span class="muted">Chargement…</span>';
        return;
    }
    if (!files.length) {
        if (window.renderEmpty) {
            renderEmpty(box, {
                icon: 'send',
                title: 'Aucun template',
                desc: 'Importez un template .msg ou .eml pour commencer.',
            });
        } else {
            box.innerHTML = '<span class="muted">Aucun template — cliquez "Ajouter" pour en importer un.</span>';
        }
        return;
    }
    box.innerHTML = files.map(f => `
        <div style="display:flex; align-items:center; justify-content:space-between; padding:4px 0; border-bottom:1px solid var(--color-border);">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;" title="${escapeHtml(f.name)}">📄 ${escapeHtml(f.name)} <span class="muted" style="font-size:10px;">${(f.size/1024).toFixed(0)} Ko</span></span>
            <div style="display:flex;gap:2px;flex-shrink:0;">
                <a href="${escapeHtml(f.url)}" download="${escapeHtml(f.name)}" style="background:none;border:none;cursor:pointer;color:var(--color-text-secondary);font-size:13px;padding:2px 6px;text-decoration:none;display:inline-flex;align-items:center;" title="Télécharger ce template">📥</a>
                <label style="background:none;border:none;cursor:pointer;color:var(--color-text-secondary);font-size:13px;padding:2px 6px;display:inline-flex;align-items:center;" title="Remplacer ce template">
                    🔄<input type="file" accept=".msg,.eml,.oft" style="display:none;" onchange="replaceCatTemplate(${catId}, '${escapeHtml(f.name)}', this)">
                </label>
                <button onclick="deleteCatTemplate(${catId}, '${escapeHtml(f.name)}')" style="background:none;border:none;cursor:pointer;color:var(--color-danger,#ef4444);font-size:13px;padding:2px 6px;" title="Supprimer ce template">🗑️</button>
            </div>
        </div>
    `).join('');
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

async function replaceCatTemplate(catId, oldName, input) {
    const file = input.files && input.files[0];
    if (!file) return;
    // Renommer le fichier côté FormData pour écraser l'existant
    const renamed = new File([file], oldName, { type: file.type });
    const formData = new FormData();
    formData.append('file', renamed);
    try {
        showToast('Remplacement en cours…', 'info');
        const res = await fetch(`/api/push-categories/${catId}/upload-template`, { method: 'POST', body: formData });
        const data = await res.json();
        if (data.ok) {
            showToast('Template remplacé !', 'success');
            loadCatFiles(catId);
        } else {
            showToast('❌ ' + (data.error || 'Erreur'), 'error');
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
    const nCandidates = (cat.candidate1_id ? 1 : 0) + (cat.candidate2_id ? 1 : 0);
    const candText = nCandidates === 0 ? 'Aucun candidat'
        : nCandidates === 1 ? '1 candidat sélectionné'
        : '2 candidats sélectionnés';
    const auto = cat.auto_detected
        ? '<span class="tag-pill" style="font-size:9px;padding:1px 6px;background:rgba(34,197,94,0.1);color:#22c55e;border-color:rgba(34,197,94,0.2);">auto</span>'
        : '';
    const desc = __catDescriptions[cat.name] || '';
    const shortDesc = desc ? (desc.length > 150 ? desc.slice(0, 150) + '…' : desc) : '';

    return `
        <div class="push-cat-card" onclick="openCatDetail(${cat.id})">
            ${shortDesc ? `<div class="push-cat-tooltip">${escapeHtml(shortDesc)}</div>` : ''}
            <div class="push-cat-card-title">${escapeHtml(cat.name)} ${auto}</div>
            <div class="push-cat-card-badges">
                <span class="push-cat-badge ${nCandidates > 0 ? 'has' : 'none'}" id="catCandBadge_${cat.id}">👤 ${escapeHtml(candText)}</span>
                <span class="push-cat-badge loading" id="catTplBadge_${cat.id}">📧 …</span>
            </div>
        </div>
    `;
}

function openCatDetail(catId) {
    __openCatDetailId = catId;
    const cat = __categories.find(c => c.id === catId);
    if (!cat) return;
    const modal = document.getElementById('modalCatDetail');
    if (!modal) return;

    document.getElementById('modalCatDetailTitle').textContent = cat.name;
    document.getElementById('modalCatBtnProspects').onclick = () => { closeCatDetail(); openCatProspects(catId); };
    document.getElementById('modalCatBtnEdit').onclick = () => { closeCatDetail(); editCat(catId); };
    document.getElementById('modalCatBtnDelete').onclick = () => deleteCat(catId);

    const desc = __catDescriptions[cat.name] || '';
    const kw = Array.isArray(cat.keywords) ? cat.keywords : [];
    const kwHtml = kw.length
        ? kw.map(k => `<span class="tag-pill" style="font-size:11px;">${escapeHtml(k)}</span>`).join(' ')
        : '<span class="muted">Aucun mot-clé</span>';

    document.getElementById('modalCatDetailBody').innerHTML = `
        ${desc ? `<p style="color:var(--color-text-secondary);font-size:13px;line-height:1.65;margin-bottom:18px;">${escapeHtml(desc)}</p>` : ''}
        <div style="margin-bottom:18px;">
            <div style="font-size:11px;font-weight:700;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px;">Tags</div>
            <div style="display:flex;flex-wrap:wrap;gap:5px;">${kwHtml}</div>
        </div>
        <div style="margin-bottom:18px;padding-top:16px;border-top:1px solid var(--color-border);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <div style="font-size:11px;font-weight:700;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.6px;">👤 Candidats par défaut</div>
                <button onclick="autoSuggestCandidates(${catId})" style="font-size:11px;padding:3px 10px;background:var(--color-surface-2,rgba(255,255,255,0.06));border:1px solid var(--color-border);border-radius:8px;cursor:pointer;" title="Suggérer automatiquement les 2 meilleurs candidats">🔁 Auto</button>
            </div>
            <div id="catCandidateSlots_${catId}">
                ${_catCandidateSlotHtml(cat, 1)}
                ${_catCandidateSlotHtml(cat, 2)}
            </div>
        </div>
        <div style="padding-top:16px;border-top:1px solid var(--color-border);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <div style="font-size:11px;font-weight:700;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.6px;">📧 Templates email (.msg)</div>
                <label style="cursor:pointer;font-size:11px;padding:4px 10px;background:var(--color-surface-2,rgba(255,255,255,0.06));border:1px solid var(--color-border);border-radius:8px;display:flex;align-items:center;gap:4px;" title="Ajouter un template .msg">
                    📤 Ajouter
                    <input type="file" accept=".msg,.eml,.oft" style="display:none;" onchange="uploadCatTemplate(${catId}, this)">
                </label>
            </div>
            <div id="catFiles_${catId}" style="font-size:12px;color:var(--color-text-secondary);">
                <span class="muted">Chargement…</span>
            </div>
        </div>
    `;

    if (window.openModal) window.openModal(modal); else modal.classList.add('active');
    // Charger / afficher les fichiers depuis le cache ou refetch
    loadCatFiles(catId);
}

function closeCatDetail() {
    const modal = document.getElementById('modalCatDetail');
    if (modal) {
        if (window.closeModal) window.closeModal(modal); else modal.classList.remove('active');
    }
    __openCatDetailId = null;
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
            _updateCatCandBadge(catId);
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
        _updateCatCandBadge(catId);
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
        _updateCatCandBadge(catId);
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
    const _cpList = document.getElementById('catProspectsList');
    if (window.renderLoading) renderLoading(_cpList, { rows: 4 });
    else _cpList.innerHTML = '<div style="text-align:center;padding:20px;color:var(--color-text-secondary);">Chargement…</div>';
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
    const _cpList2 = document.getElementById('catProspectsList');
    if (window.renderLoading) renderLoading(_cpList2, { rows: 4 });
    else _cpList2.innerHTML = '<div style="text-align:center;padding:20px;color:var(--color-text-secondary);">Chargement…</div>';
    await _fetchAndRenderCatProspects(__catProspectsCatId);
    if (btn) btn.disabled = false;
}

async function _fetchAndRenderCatProspects(catId) {
    try {
        const res = await fetch(`/api/push-categories/${catId}/match-prospects`);
        const data = await res.json();
        if (!data.ok) {
            const _el = document.getElementById('catProspectsList');
            if (window.renderError) renderError(_el, { title: 'Erreur serveur', desc: data.error || 'Réessayez dans un instant.', onRetry: () => _fetchAndRenderCatProspects(catId) });
            else _el.innerHTML = `<div style="color:var(--color-danger,#ef4444);padding:12px;">${escapeHtml(data.error || 'Erreur')}</div>`;
            return;
        }
        _renderCatProspectsList(data);
    } catch (e) {
        const _el2 = document.getElementById('catProspectsList');
        if (window.renderError) renderError(_el2, { title: 'Serveur indisponible.', desc: 'Réessayez dans un instant.', trace: e.message, onRetry: () => _fetchAndRenderCatProspects(catId) });
        else _el2.innerHTML = `<div style="color:var(--color-danger,#ef4444);padding:12px;">Erreur réseau : ${escapeHtml(e.message)}</div>`;
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

// ── Gestion des templates texte ────────────────────────────────────────────

let __templates = [];

async function openTemplateManager() {
    const modal = document.getElementById('modalTemplateManager');
    if (!modal) return;
    _tplShowEditor(false);
    const _tplEl = document.getElementById('tplList');
    if (window.renderLoading) renderLoading(_tplEl, { rows: 3 });
    else _tplEl.innerHTML = '<span class="muted" style="font-size:12px;">Chargement…</span>';
    if (window.openModal) window.openModal(modal); else modal.classList.add('active');
    await _loadTemplates();
}

function closeTemplateManager() {
    const modal = document.getElementById('modalTemplateManager');
    if (!modal) return;
    if (window.closeModal) window.closeModal(modal); else modal.classList.remove('active');
}

async function _loadTemplates() {
    try {
        const res = await fetch('/api/templates');
        __templates = await res.json();
    } catch (e) {
        __templates = [];
    }
    _renderTplList();
}

function _renderTplList() {
    const box = document.getElementById('tplList');
    if (!box) return;
    if (!__templates.length) {
        if (window.renderEmpty) renderEmpty(box, { icon: 'send', title: 'Aucun template', desc: 'Créez votre premier template email.' });
        else box.innerHTML = '<span class="muted" style="font-size:12px;">Aucun template. Créez-en un.</span>';
        return;
    }
    const currentId = document.getElementById('tplId')?.value;
    box.innerHTML = __templates.map(t => {
        const active = String(t.id) === String(currentId);
        const defBadge = t.is_default ? '<span style="font-size:9px;padding:1px 5px;background:rgba(249,115,22,0.15);color:var(--color-primary);border:1px solid rgba(249,115,22,0.3);border-radius:6px;margin-left:4px;">défaut</span>' : '';
        return `<button onclick="selectTemplate(${t.id})" style="text-align:left;padding:8px 10px;border-radius:10px;border:1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'};background:${active ? 'rgba(249,115,22,0.08)' : 'var(--color-surface)'};cursor:pointer;font-size:12px;color:var(--color-text);width:100%;">
            <div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(t.name)}${defBadge}</div>
            ${t.subject ? `<div style="color:var(--color-text-secondary);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;">${escapeHtml(t.subject)}</div>` : ''}
        </button>`;
    }).join('');
}

function _tplShowEditor(show) {
    const editor = document.getElementById('tplEditor');
    const empty = document.getElementById('tplEditorEmpty');
    if (editor) editor.style.display = show ? '' : 'none';
    if (empty) empty.style.display = show ? 'none' : '';
}

function selectTemplate(id) {
    const t = __templates.find(x => x.id === id);
    if (!t) return;
    document.getElementById('tplId').value = t.id;
    document.getElementById('tplName').value = t.name || '';
    document.getElementById('tplSubject').value = t.subject || '';
    document.getElementById('tplBody').value = t.body || '';
    document.getElementById('tplLinkedinBody').value = t.linkedin_body || '';
    document.getElementById('tplIsDefault').checked = !!t.is_default;
    const btnDel = document.getElementById('tplBtnDelete');
    if (btnDel) btnDel.style.display = '';
    _tplShowEditor(true);
    _renderTplList();
}

function newTemplate() {
    document.getElementById('tplId').value = '';
    document.getElementById('tplName').value = '';
    document.getElementById('tplSubject').value = '';
    document.getElementById('tplBody').value = '';
    document.getElementById('tplLinkedinBody').value = '';
    document.getElementById('tplIsDefault').checked = false;
    const btnDel = document.getElementById('tplBtnDelete');
    if (btnDel) btnDel.style.display = 'none';
    _tplShowEditor(true);
    _renderTplList();
    document.getElementById('tplName')?.focus();
}

async function saveTemplate() {
    const name = (document.getElementById('tplName')?.value || '').trim();
    if (!name) { showToast('Le nom du template est requis', 'warning'); return; }
    const payload = {
        id: document.getElementById('tplId').value ? Number(document.getElementById('tplId').value) : null,
        name,
        subject: document.getElementById('tplSubject').value || '',
        body: document.getElementById('tplBody').value || '',
        linkedin_body: document.getElementById('tplLinkedinBody').value || '',
        is_default: document.getElementById('tplIsDefault').checked
    };
    try {
        const res = await fetch('/api/templates/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!data.ok) { showToast('❌ ' + (data.error || 'Erreur'), 'error'); return; }
        document.getElementById('tplId').value = data.id;
        const btnDel = document.getElementById('tplBtnDelete');
        if (btnDel) btnDel.style.display = '';
        showToast('Template enregistré', 'success');
        await _loadTemplates();
        if (data.id) _renderTplList();
    } catch (e) {
        showToast('❌ Erreur : ' + e.message, 'error');
    }
}

async function deleteTemplate() {
    const id = document.getElementById('tplId')?.value;
    if (!id) return;
    const t = __templates.find(x => x.id === Number(id));
    if (!confirm(`Supprimer le template "${t?.name || id}" ?`)) return;
    try {
        const res = await fetch('/api/templates/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: Number(id) })
        });
        const data = await res.json();
        if (!data.ok) { showToast('❌ ' + (data.error || 'Erreur'), 'error'); return; }
        showToast('Template supprimé', 'success');
        _tplShowEditor(false);
        await _loadTemplates();
    } catch (e) {
        showToast('❌ Erreur : ' + e.message, 'error');
    }
}

// ── Catégories built-in (création automatique si absentes) ─────────────────

const __BUILTIN_CATEGORIES = [
    {
        name: 'Simulation_Modélisation',
        keywords: ['simulation', 'modélisation', 'matlab', 'simulink', 'ansys', 'altair', 'model-based design', 'mbd', 'éléments finis', 'fem', 'cfd', 'ansys fluent', 'dymola', 'modelica', 'dspace', 'rapid prototyping', 'hil', 'sil', 'validation', 'vérification', 'ferroviaire', 'automobile', 'aéronautique']
    },
    {
        name: 'Electrotechnique_Energie',
        keywords: ['électrotechnique', 'génie électrique', 'énergie', 'électronique de puissance', 'variateur', 'onduleur', 'convertisseur', 'hta', 'htb', 'poste de transformation', 'transformateur', 'motorisation', 'vfd', 'igbt', 'ups', 'alimentation', 'réseau électrique', 'smartgrid', 'energies renouvelables', 'photovoltaique', 'stockage énergie', 'batterie', 'bms', 'traction électrique', 'ev', 'véhicule électrique']
    },
    {
        name: 'Surete_Fonctionnement_SdF',
        keywords: ['sûreté de fonctionnement', 'sdf', 'rams', 'fiabilité', 'disponibilité', 'maintenabilité', 'sécurité', 'fmea', 'fmeca', 'hazop', 'fta', 'amdec', 'iec 61508', 'iec 61511', 'en 50128', 'en 50129', 'iso 26262', 'sil', 'asil', 'sécurité fonctionnelle', 'analyse de risque', 'nucléaire', 'ferroviaire', 'certification']
    }
];

async function ensureBuiltinCategories() {
    const existingNames = new Set(__categories.map(c => c.name));
    const missing = __BUILTIN_CATEGORIES.filter(b => !existingNames.has(b.name));
    if (!missing.length) return;
    let created = 0;
    for (const cat of missing) {
        try {
            const res = await fetch('/api/push-categories/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: null, name: cat.name, keywords: cat.keywords })
            });
            const data = await res.json();
            // ok normal, ou "existe déjà" (UNIQUE) = déjà présente, compter quand même
            if (data.ok || data.id || (typeof data.error === 'string' && data.error.includes('existe déjà'))) {
                created++;
            }
        } catch (e) {}
    }
    // Toujours recharger pour afficher les catégories nouvellement créées
    await loadCategories();
    if (created > 0) {
        showToast(`${created} catégorie(s) ajoutée(s) automatiquement`, 'success', 3000);
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
    const btnTpl = document.getElementById('btnManageTemplates');
    if (btnNew) btnNew.addEventListener('click', () => { resetCatEditor(); showCatEditor(true); });
    if (btnScan) btnScan.addEventListener('click', scanPushs);
    if (btnCancel) btnCancel.addEventListener('click', () => { showCatEditor(false); resetCatEditor(); });
    if (btnSave) btnSave.addEventListener('click', saveCat);
    if (btnTpl) btnTpl.addEventListener('click', openTemplateManager);

    // Onglet Catégories actif par défaut
    await loadCategories();
    __categoriesLoaded = true;
    // Créer les catégories built-in manquantes
    await ensureBuiltinCategories();
});
