// ====== Import ma liste (Excel / CSV) — guide nouvel utilisateur ======
const IMPORT_LIST_FIELDS = [
    { value: '', label: '— Ignorer' },
    { value: 'name', label: 'Nom' },
    { value: 'prenom', label: 'Prénom' },
    { value: 'groupe', label: 'Entreprise' },
    { value: 'site', label: 'Site' },
    { value: 'fonction', label: 'Fonction' },
    { value: 'telephone', label: 'Téléphone' },
    { value: 'email', label: 'Email' },
    { value: 'linkedin', label: 'LinkedIn' },
    { value: 'notes', label: 'Notes' },
    { value: 'tags', label: 'Tags' },
    { value: 'pertinence', label: 'Pertinence' },
    { value: 'statut', label: 'Statut' },
    { value: 'lastContact', label: 'Date dernier contact' },
];

let _importListRaw = null; // { headers: string[], rows: string[][] }
let _importListMapping = null; // { name: [0], groupe: [1], telephone: [7, 8], ... } arrays of column indices
let _importListWorkbook = null; // XLSX workbook pour choix de feuille multi-sheets

function _ensureImportListModal() {
    if (document.getElementById('modalImportList')) return;
    const div = document.createElement('div');
    div.innerHTML = `
    <div id="modalImportList" class="modal">
        <div class="modal-content" style="max-width:620px;">
            <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;">
                <span>📥 Importer ma liste de prospection</span>
                <button class="btn btn-secondary" onclick="closeImportListModal()" style="font-size:14px;padding:4px 10px;">✕</button>
            </div>
            <div class="modal-body" style="padding:16px 0;">
                <div id="importListStepChoice">
                    <p class="muted" style="margin-bottom:14px;">Choisissez comment importer vos prospects (Excel, CSV ou collage).</p>
                    <div class="import-list-tabs">
                        <button type="button" class="import-list-tab active" data-tab="excel">📊 Fichier Excel</button>
                        <button type="button" class="import-list-tab" data-tab="csv">📄 Fichier CSV</button>
                        <button type="button" class="import-list-tab" data-tab="paste">📋 Coller (CSV)</button>
                        <button type="button" class="import-list-tab" data-tab="ia">🤖 Retour IA</button>
                        <button type="button" class="import-list-tab" data-tab="lusha">🔵 Enrichment Lusha</button>
                    </div>
                    <div id="importListPaneExcel" class="import-list-pane active">
                        <input type="file" id="importListFileExcel" accept=".xlsx,.xls" style="display:none;">
                        <button type="button" class="btn btn-primary" onclick="document.getElementById('importListFileExcel').click()">Choisir un fichier .xlsx ou .xls</button>
                        <div id="importListExcelSheetChoice" style="display:none;margin-top:12px;">
                            <label style="font-size:12px;">Feuille à importer :</label>
                            <select id="importListExcelSheetSelect" style="font-size:13px;padding:6px 10px;border-radius:6px;margin-left:8px;min-width:180px;"></select>
                            <button type="button" class="btn btn-primary" style="margin-left:8px;" onclick="applyImportListExcelSheetChoice()">Utiliser cette feuille</button>
                        </div>
                    </div>
                    <div id="importListPaneCsv" class="import-list-pane" style="display:none;">
                        <div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:12px;align-items:center;">
                            <label style="font-size:12px;">Séparateur :</label>
                            <select id="importListCsvSeparator" style="font-size:13px;padding:6px 10px;border-radius:6px;">
                                <option value="auto">Auto (détection)</option>
                                <option value=";">Point-virgule (;)</option>
                                <option value=",">Virgule (,)</option>
                                <option value="\t">Tabulation</option>
                            </select>
                            <label style="font-size:12px;">Encodage :</label>
                            <select id="importListCsvEncoding" style="font-size:13px;padding:6px 10px;border-radius:6px;">
                                <option value="utf-8">UTF-8</option>
                                <option value="iso-8859-1">Latin-1 / Windows</option>
                            </select>
                        </div>
                        <input type="file" id="importListFileCsv" accept=".csv,.txt" style="display:none;">
                        <button type="button" class="btn btn-primary" onclick="document.getElementById('importListFileCsv').click()">Choisir un fichier .csv ou .txt</button>
                    </div>
                    <div id="importListPanePaste" class="import-list-pane" style="display:none;">
                        <p class="muted" style="font-size:12px;margin-bottom:8px;">Collez ici le contenu copié depuis Excel (une ligne par prospect, première ligne = en-têtes).</p>
                        <textarea id="importListPasteArea" rows="8" style="width:100%;border:1px solid var(--color-border);border-radius:8px;padding:10px;font-size:12px;font-family:monospace;resize:vertical;" placeholder="Nom;Entreprise;Fonction;Téléphone;Email&#10;Jean Dupont;ACME;Directeur;06...;jean@..."></textarea>
                        <button type="button" class="btn btn-primary" style="margin-top:10px;" onclick="parseImportListPaste()">🔍 Analyser</button>
                    </div>
                    <div id="importListPaneIa" class="import-list-pane" style="display:none;">
                        <p class="muted" style="margin-bottom:12px;">Utilisez l’outil « Ajout IA » pour coller un retour Ollama local ou copier-coller (JSON ou texte).</p>
                        <button type="button" class="btn btn-primary" onclick="closeImportListModal(); openQuickAddModal();">Ouvrir Ajout IA</button>
                    </div>
                    <div id="importListPaneLusha" class="import-list-pane" style="display:none;">
                        <p class="muted" style="font-size:12px;margin-bottom:10px;">Fichier CSV exporté depuis Lusha — Phone number 1/2 et Work/Direct email consolidés automatiquement. Aucune étape de mapping requise.</p>
                        <input type="file" id="importListFileLusha" accept=".csv" style="display:none;">
                        <button type="button" class="btn btn-primary" onclick="document.getElementById(‘importListFileLusha’).click()">Choisir un fichier .csv Lusha</button>
                    </div>
                </div>
                <div id="importListStepMapping" style="display:none;">
                    <p class="muted" style="margin-bottom:10px;">Associez chaque colonne à un champ Prosp'Up (la première ligne de votre fichier est utilisée comme en-têtes).</p>
                    <div id="importListMappingGrid"></div>
                    <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;">
                        <button type="button" class="btn btn-secondary" onclick="importListBackToChoice()">← Retour</button>
                        <button type="button" class="btn btn-secondary" id="importListSuggestOllamaBtn" onclick="suggestImportListMappingWithOllama()">Suggérer le mapping avec Ollama</button>
                        <button type="button" class="btn btn-primary" onclick="importListGoPreview()">Aperçu →</button>
                    </div>
                </div>
                <div id="importListStepPreview" style="display:none;">
                    <p class="muted" style="margin-bottom:8px;"><strong id="importListPreviewCount">0</strong> prospect(s) à importer.</p>
                    <p class="muted" style="margin-bottom:8px;font-size:12px;">Colonnes mal détectées ? Reformatez avec l’IA (bouton « Générer avec Ollama » dans la modale) :</p>
                    <div id="importListReformatButtons" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;"></div>
                    <div id="importListPreviewTable" style="max-height:280px;overflow:auto;border:1px solid var(--color-border);border-radius:8px;"></div>
                    <div style="display:flex;gap:10px;margin-top:14px;">
                        <button type="button" class="btn btn-secondary" onclick="importListBackToMapping()">← Retour</button>
                        <button type="button" class="btn btn-secondary" id="importListReformatAllBtn" onclick="openImportListReformatAllModal()" style="display:none;">🤖 Reformater plusieurs colonnes</button>
                        <button type="button" class="btn btn-primary" onclick="applyImportList()">✅ Importer</button>
                    </div>
                </div>
                <div id="modalImportListReformat" class="modal" style="z-index:1150;">
                    <div class="modal-content" style="max-width:560px;">
                        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;">
                            <span id="importListReformatTitle">Reformater avec l’IA</span>
                            <button type="button" class="btn btn-secondary" onclick="closeImportListReformatModal()" style="padding:4px 10px;">✕</button>
                        </div>
                        <div class="modal-body">
                            <p class="muted" style="font-size:12px;margin-bottom:8px;">Générez avec Ollama (local) ou copiez le prompt dans une IA puis collez le résultat ci-dessous.</p>
                            <label class="import-reformat-label">Prompt</label>
                            <div style="display:flex;gap:8px;margin-bottom:6px;">
                                <button type="button" class="btn btn-primary" id="importListReformatOllamaBtn" onclick="runImportListReformatWithOllama()">Générer avec Ollama</button>
                            </div>
                            <textarea id="importListReformatPrompt" readonly style="width:100%;height:100px;font-size:12px;border:1px solid var(--color-border);border-radius:8px;padding:8px;resize:vertical;"></textarea>
                            <label class="import-reformat-label" style="margin-top:12px;">Résultat (réponse Ollama ou une valeur par ligne)</label>
                            <textarea id="importListReformatPaste" placeholder="Collez ici la réponse de l'IA (une valeur par ligne, même ordre que les données)" style="width:100%;height:120px;font-size:12px;border:1px solid var(--color-border);border-radius:8px;padding:8px;resize:vertical;"></textarea>
                            <div style="display:flex;gap:10px;margin-top:12px;">
                                <button type="button" class="btn btn-primary" onclick="applyImportListReformat()">Appliquer</button>
                                <button type="button" class="btn btn-secondary" onclick="closeImportListReformatModal()">Annuler</button>
                            </div>
                        </div>
                    </div>
                </div>
                <div id="modalImportListReformatAll" class="modal" style="z-index:1150;">
                    <div class="modal-content" style="max-width:600px;">
                        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;">
                            <span>🤖 Reformater plusieurs colonnes avec l'IA</span>
                            <button type="button" class="btn btn-secondary" onclick="closeImportListReformatAllModal()" style="padding:4px 10px;">✕</button>
                        </div>
                        <div class="modal-body">
                            <p class="muted" style="font-size:12px;margin-bottom:12px;">Sélectionnez les colonnes à reformater en une seule fois. Ollama normalisera toutes les colonnes sélectionnées.</p>
                            <div id="importListReformatAllCheckboxes" style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;"></div>
                            <div style="display:flex;gap:10px;margin-top:12px;">
                                <button type="button" class="btn btn-primary" id="importListReformatAllOllamaBtn" onclick="runImportListReformatAllWithOllama()">Générer avec Ollama</button>
                                <button type="button" class="btn btn-secondary" onclick="closeImportListReformatAllModal()">Annuler</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>`;
    document.body.appendChild(div.firstElementChild);

    document.getElementById('importListFileExcel').addEventListener('change', function(e) {
        const f = e.target.files && e.target.files[0];
        if (f) parseImportListExcel(f);
        e.target.value = '';
    });
    document.getElementById('importListFileCsv').addEventListener('change', function(e) {
        const f = e.target.files && e.target.files[0];
        if (f) parseImportListCsvFile(f);
        e.target.value = '';
    });
    document.getElementById('importListFileLusha').addEventListener('change', function(e) {
        const f = e.target.files && e.target.files[0];
        if (f) parseLushaFile(f);
        e.target.value = '';
    });
    document.querySelectorAll('.import-list-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            document.querySelectorAll('.import-list-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.import-list-pane').forEach(p => p.classList.remove('active'));
            this.classList.add('active');
            const tabName = this.getAttribute('data-tab');
            const pane = document.getElementById('importListPane' + tabName.charAt(0).toUpperCase() + tabName.slice(1));
            if (pane) { pane.style.display = ''; pane.classList.add('active'); }
            ['importListPaneExcel','importListPaneCsv','importListPanePaste','importListPaneIa','importListPaneLusha'].forEach(id => {
                const el = document.getElementById(id);
                if (el && !el.classList.contains('active')) el.style.display = 'none';
            });
        });
    });
}

function openImportListModal() {
    _ensureImportListModal();
    _importListRaw = null;
    _importListMapping = null;
    _importListWorkbook = null;
    const sheetBox = document.getElementById('importListExcelSheetChoice');
    if (sheetBox) sheetBox.style.display = 'none';
    document.getElementById('importListStepChoice').style.display = '';
    document.getElementById('importListStepMapping').style.display = 'none';
    document.getElementById('importListStepPreview').style.display = 'none';
    const modal = document.getElementById('modalImportList');
    if (modal) {
        if (window.openModal) {
            window.openModal(modal);
        } else {
            modal.classList.add('active');
        }
    }
}

function closeImportListModal() {
    const modal = document.getElementById('modalImportList');
    if (modal) {
        if (window.closeModal) {
            window.closeModal(modal);
        } else {
            modal.classList.remove('active');
        }
    }
}

function importListBackToChoice() {
    document.getElementById('importListStepMapping').style.display = 'none';
    document.getElementById('importListStepChoice').style.display = '';
}

function importListBackToMapping() {
    document.getElementById('importListStepPreview').style.display = 'none';
    document.getElementById('importListStepMapping').style.display = '';
}

function _detectSeparator(firstLine) {
    if (firstLine.includes('\t') && (firstLine.match(/\t/g) || []).length >= (firstLine.match(/[;,]/g) || []).length)
        return '\t';
    const semi = (firstLine.match(/;/g) || []).length;
    const comma = (firstLine.match(/,/g) || []).length;
    return semi >= comma ? ';' : ',';
}

/** options: { separator?: string } — 'auto', ';', ',', '\\t' ou non fourni = auto */
function _parseCsvText(text, options) {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) return null;
    let sep = (options && options.separator && options.separator !== 'auto') ? options.separator : _detectSeparator(lines[0]);
    if (sep === '\\t') sep = '\t';
    const headers = _parseCsvLine(lines[0], sep);
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const cells = _parseCsvLine(lines[i], sep);
        if (cells.some(c => c)) rows.push(cells);
    }
    return { headers, rows };
}

function _parseCsvLine(line, sep) {
    const cells = [];
    let cur = '', inQuotes = false;
    for (let j = 0; j < line.length; j++) {
        const c = line[j];
        if (c === '"' || c === "'") inQuotes = !inQuotes;
        else if (c === sep && !inQuotes) { cells.push(cur.replace(/^["']|["']$/g, '').trim()); cur = ''; }
        else cur += c;
    }
    cells.push(cur.replace(/^["']|["']$/g, '').trim());
    return cells;
}

function _excelSheetToRaw(wb, sheetName) {
    const sh = wb.Sheets[sheetName];
    if (!sh) return null;
    const data = XLSX.utils.sheet_to_json(sh, { header: 1, defval: '' });
    if (!data.length) return null;
    const headers = data[0].map(h => String(h || '').trim());
    const rows = data.slice(1).filter(row => row.some(c => String(c || '').trim())).map(row => {
        const r = [];
        for (let i = 0; i < headers.length; i++) r.push(String(row[i] != null ? row[i] : '').trim());
        return r;
    });
    return { headers, rows };
}

function parseImportListExcel(file) {
    if (typeof XLSX === 'undefined') { showToast('Bibliothèque Excel non chargée.', 'error'); return; }
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const wb = XLSX.read(e.target.result, { type: 'array' });
            _importListWorkbook = wb;
            const names = wb.SheetNames || [];
            if (names.length === 0) { showToast('Fichier Excel sans feuille.', 'warning'); return; }
            if (names.length === 1) {
                const raw = _excelSheetToRaw(wb, names[0]);
                if (!raw || !raw.rows.length) { showToast('Feuille vide.', 'warning'); return; }
                _importListRaw = raw;
                _importListWorkbook = null;
                showImportListMapping();
                return;
            }
            const box = document.getElementById('importListExcelSheetChoice');
            const sel = document.getElementById('importListExcelSheetSelect');
            if (box && sel) {
                sel.innerHTML = names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
                box.style.display = '';
            }
        } catch (err) {
            showToast('Erreur lecture Excel: ' + (err.message || err), 'error');
        }
    };
    reader.readAsArrayBuffer(file);
}

function applyImportListExcelSheetChoice() {
    const sel = document.getElementById('importListExcelSheetSelect');
    if (!_importListWorkbook || !sel) return;
    const sheetName = sel.value;
    const raw = _excelSheetToRaw(_importListWorkbook, sheetName);
    _importListWorkbook = null;
    const box = document.getElementById('importListExcelSheetChoice');
    if (box) box.style.display = 'none';
    if (!raw || !raw.rows.length) { showToast('Feuille vide.', 'warning'); return; }
    _importListRaw = raw;
    showImportListMapping();
}

function parseImportListCsvFile(file) {
    const encEl = document.getElementById('importListCsvEncoding');
    const sepEl = document.getElementById('importListCsvSeparator');
    const encoding = (encEl && encEl.value) ? encEl.value : 'utf-8';
    let sep = (sepEl && sepEl.value) ? sepEl.value : 'auto';
    if (sep === 'auto') sep = null;
    const options = sep ? { separator: sep } : {};
    const reader = new FileReader();
    reader.onload = function(e) {
        const raw = _parseCsvText(e.target.result, options);
        if (!raw || !raw.rows.length) { showToast('CSV vide ou invalide.', 'warning'); return; }
        _importListRaw = raw;
        showImportListMapping();
    };
    reader.onerror = function() { showToast('Erreur de lecture du fichier (encodage ?).', 'error'); };
    reader.readAsText(file, encoding);
}

function parseImportListPaste() {
    const text = document.getElementById('importListPasteArea').value.trim();
    const raw = _parseCsvText(text, {}); // séparateur auto
    if (!raw || !raw.rows.length) { showToast('Collez au moins une ligne d\'en-têtes et une ligne de données.', 'warning'); return; }
    _importListRaw = raw;
    showImportListMapping();
}

function _guessMapping(header) {
    const h = (header || '').toLowerCase().trim();
    if (/prénom|prenom|firstname|first\.name/.test(h)) return 'prenom';
    if (/(^nom$|^name$|contact)/.test(h) && !/société|company|entreprise|groupe|commentaire/.test(h)) return 'name';
    if (/entreprise|société|company|groupe|client/.test(h)) return 'groupe';
    if (/site|ville|city|adresse|filiale/.test(h)) return 'site';
    if (/fonction|poste|role|titre/.test(h)) return 'fonction';
    if (/tél|tel|telephone|phone|mobile|portable/.test(h)) return 'telephone';
    if (/mail|email|e-mail/.test(h)) return 'email';
    if (/linkedin|linked\.in/.test(h)) return 'linkedin';
    if (/note|commentaire/.test(h)) return 'notes';
    if (/tag|compétence|competence/.test(h)) return 'tags';
    if (/pertinence|score/.test(h)) return 'pertinence';
    if (/statut|status|action/.test(h)) return 'statut';
    if (/date.*dernier\.?contact|dernier\.?contact|last\.?contact/.test(h)) return 'lastContact';
    return '';
}

function showImportListMapping() {
    if (!_importListRaw) return;
    document.getElementById('importListStepChoice').style.display = 'none';
    document.getElementById('importListStepMapping').style.display = '';
    const grid = document.getElementById('importListMappingGrid');
    _importListMapping = {};
    grid.innerHTML = _importListRaw.headers.map((h, i) => {
        const guessed = _guessMapping(h);
        let opts = IMPORT_LIST_FIELDS.map(f => `<option value="${f.value}"${f.value === guessed ? ' selected' : ''}>${f.label}</option>`).join('');
        return `<div class="import-list-mapping-row"><label>${escapeHtml(h) || 'Colonne ' + (i+1)}</label><select class="import-list-map-select" data-col="${i}">${opts}</select></div>`;
    }).join('');
}

async function suggestImportListMappingWithOllama() {
    if (!_importListRaw || !_importListRaw.headers.length) return;
    const headers = _importListRaw.headers;
    const fieldsList = 'name, prenom, groupe, site, fonction, telephone, email, linkedin, notes, tags, pertinence, statut, lastContact';
    
    // Enrichir le prompt avec des exemples de formats variés
    const examples = [
        '{"NOM":"name","PRENOM":"prenom","GROUPE":"groupe","SITE":"site","FONCTION":"fonction","TEL":"telephone","PORTABLE":"telephone","MAIL":"email","COMMENTAIRE":"notes","LINKEDIN":"linkedin","ACTION":"statut","DATE DERNIER CONTACT":"lastContact"}',
        '{"Nom complet":"name","Société":"groupe","Ville":"site","Poste":"fonction","Téléphone":"telephone","Email":"email","Notes":"notes","Statut":"statut"}',
        '{"Contact":"name","Entreprise":"groupe","Localisation":"site","Fonction":"fonction","Tel":"telephone","E-mail":"email","Remarques":"notes","État":"statut"}',
        '{"FIRSTNAME":"prenom","LASTNAME":"name","COMPANY":"groupe","CITY":"site","ROLE":"fonction","PHONE":"telephone","EMAIL":"email","NOTES":"notes","STATUS":"statut"}'
    ];
    
    const prompt = `Tu es un assistant expert en mapping de données Excel pour un CRM de prospection B2B.

Voici les en-têtes de colonnes d'un fichier Excel d'import de prospects : ${JSON.stringify(headers)}

Tu dois retourner un objet JSON unique dont :
- Les clés sont exactement ces en-têtes (une par colonne, respecte la casse et les accents)
- Les valeurs sont exactement un des champs suivants (ou chaîne vide "" pour ignorer) : ${fieldsList}

Règles importantes :
- "name" = nom complet ou nom de famille (peut être combiné avec "prenom")
- "prenom" = prénom (peut être combiné avec "name" pour former le nom complet)
- "groupe" = nom de l'entreprise/société
- "site" = ville/localisation/filiale
- "telephone" = numéro de téléphone (peut être plusieurs colonnes fusionnées : TEL, PORTABLE, MOBILE, etc.)
- "email" = adresse email (MAIL, E-MAIL, EMAIL, etc.)
- "fonction" = poste/rôle/titre
- "notes" = commentaires/remarques/observations
- "statut" = statut/action/état
- "lastContact" = date dernier contact (peut être en format varié)

Exemples de mappings corrects :
${examples.join('\n')}

Réponds UNIQUEMENT avec le JSON, sans texte avant ou après, sans markdown, sans explications.`;
    
    const btn = document.getElementById('importListSuggestOllamaBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Génération…'; }
    try {
        const text = await callOllama(prompt);
        let jsonStr = (text || '').trim();
        // Extraire le JSON même s'il y a du texte autour
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) jsonStr = jsonMatch[0];
        const mapping = JSON.parse(jsonStr);
        const headerToIndex = {};
        headers.forEach((h, i) => { headerToIndex[h] = i; });
        let applied = 0;
        Object.keys(mapping).forEach(header => {
            const field = mapping[header];
            const idx = headerToIndex[header];
            if (idx === undefined || !field) return;
            const select = document.querySelector(`.import-list-map-select[data-col="${idx}"]`);
            if (select && IMPORT_LIST_FIELDS.some(f => f.value === field)) {
                select.value = field;
                applied++;
            }
        });
        if (applied > 0) {
            showToast(`Mapping suggéré appliqué (${applied} colonne(s)). Vérifiez puis cliquez Aperçu.`, 'success', 4000);
        } else {
            showToast('Aucun mapping valide trouvé. Vérifiez manuellement.', 'warning', 4000);
        }
    } catch (e) {
        console.error('Erreur mapping Ollama:', e);
        showToast('Ollama indisponible ou réponse invalide. Vérifiez le mapping manuellement.', 'warning', 5000);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Suggérer le mapping avec Ollama'; }
    }
}

function _detectDataIssues(previewRows) {
    /** Détecte les problèmes de données dans l'aperçu et suggère des actions. */
    const issues = [];
    
    // Vérifier les emails invalides
    const emailRows = previewRows.filter(r => r.email && r.email.trim());
    if (emailRows.length > 0) {
        const invalidEmails = emailRows.filter(r => {
            const email = r.email.trim();
            return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
        });
        if (invalidEmails.length > 0) {
            issues.push({
                field: 'email',
                count: invalidEmails.length,
                message: `${invalidEmails.length} email(s) invalide(s) détecté(s)`,
                severity: 'warning'
            });
        }
    }
    
    // Vérifier les téléphones mal formatés
    const phoneRows = previewRows.filter(r => r.telephone && r.telephone.trim());
    if (phoneRows.length > 0) {
        const invalidPhones = phoneRows.filter(r => {
            const phone = r.telephone.trim().replace(/\s+/g, '');
            // Format français : 10 chiffres commençant par 0, ou international
            return !/^(0[1-9]|(\+33|0033)[1-9])\d{8,9}$/.test(phone);
        });
        if (invalidPhones.length > phoneRows.length * 0.3) { // Si plus de 30% sont invalides
            issues.push({
                field: 'telephone',
                count: invalidPhones.length,
                message: `${invalidPhones.length} téléphone(s) avec format suspect`,
                severity: 'info'
            });
        }
    }
    
    // Vérifier les noms vides ou suspects
    const nameRows = previewRows.filter(r => r.name && r.name.trim());
    if (nameRows.length < previewRows.length * 0.5) {
        issues.push({
            field: 'name',
            count: previewRows.length - nameRows.length,
            message: `${previewRows.length - nameRows.length} prospect(s) sans nom`,
            severity: 'warning'
        });
    }
    
    // Vérifier les entreprises vides
    const groupeRows = previewRows.filter(r => r.groupe && r.groupe.trim());
    if (groupeRows.length < previewRows.length * 0.3) {
        issues.push({
            field: 'groupe',
            count: previewRows.length - groupeRows.length,
            message: `${previewRows.length - groupeRows.length} prospect(s) sans entreprise`,
            severity: 'info'
        });
    }
    
    return issues;
}

function importListGoPreview() {
    if (!_importListRaw) return;
    const selects = document.querySelectorAll('.import-list-map-select');
    _importListMapping = {};
    selects.forEach(s => {
        const col = parseInt(s.dataset.col, 10);
        const field = s.value;
        if (field) {
            if (!_importListMapping[field]) _importListMapping[field] = [];
            _importListMapping[field].push(col);
        }
    });
    const hasName = (_importListMapping.name && _importListMapping.name.length) || (_importListMapping.prenom && _importListMapping.prenom.length);
    if (!hasName && !(_importListMapping.groupe && _importListMapping.groupe.length)) {
        showToast('Associez au moins la colonne « Nom » ou « Prénom » ou « Entreprise ».', 'warning');
        return;
    }
    const previewRows = _importListRaw.rows.map(row => {
        const o = {};
        for (const [field, cols] of Object.entries(_importListMapping)) {
            const vals = cols.map(c => (row[c] != null && String(row[c]).trim() !== '') ? String(row[c]).trim() : null).filter(Boolean);
            o[field] = vals.join(' ; ').trim();
        }
        o.name = [o.prenom, o.name].filter(Boolean).join(' ').trim() || o.name || o.prenom || '';
        return o;
    }).filter(o => (o.name || '').trim() || (o.groupe || '').trim());
    window._importListPreviewRows = previewRows;
    document.getElementById('importListPreviewCount').textContent = previewRows.length;
    _renderImportListPreviewTable();
    
    // Détecter les problèmes de données
    const issues = _detectDataIssues(previewRows);
    const issuesHtml = issues.length > 0 ? `<div style="background:var(--color-bg-secondary);border:1px solid var(--color-border);border-radius:8px;padding:10px;margin-bottom:10px;font-size:12px;"><strong>💡 Suggestions d'amélioration :</strong><ul style="margin:8px 0 0 0;padding-left:20px;">${issues.map(i => `<li style="margin:4px 0;">${i.message} — <button type="button" class="btn btn-secondary" style="font-size:11px;padding:2px 6px;" onclick="openImportListReformatModal('${i.field}')">Reformater ${(IMPORT_LIST_FIELDS.find(f => f.value === i.field) || {}).label || i.field}</button></li>`).join('')}</ul></div>` : '';
    
    const reformatCols = ['name', 'groupe', 'fonction', 'telephone', 'email'];
    const btns = document.getElementById('importListReformatButtons');
    btns.innerHTML = issuesHtml + reformatCols.map(c => {
        const label = (IMPORT_LIST_FIELDS.find(f => f.value === c) || {}).label || c;
        const hasIssue = issues.some(i => i.field === c);
        return `<button type="button" class="btn ${hasIssue ? 'btn-warning' : 'btn-secondary'}" style="font-size:12px;padding:4px 10px;" onclick="openImportListReformatModal('${c}')">🤖 Reformater ${label}${hasIssue ? ' ⚠️' : ''}</button>`;
    }).join('');
    
    // Afficher le bouton de reformatage multi-colonnes si plusieurs colonnes ont des données
    const hasMultipleFields = reformatCols.filter(c => previewRows.some(r => r[c] && r[c].trim())).length > 1;
    const reformatAllBtn = document.getElementById('importListReformatAllBtn');
    if (reformatAllBtn) {
        reformatAllBtn.style.display = hasMultipleFields ? '' : 'none';
    }
    
    document.getElementById('importListStepMapping').style.display = 'none';
    document.getElementById('importListStepPreview').style.display = '';
}

function _renderImportListPreviewTable() {
    const previewRows = window._importListPreviewRows;
    if (!previewRows || !previewRows.length) return;
    const table = document.getElementById('importListPreviewTable');
    if (!table) return;
    const cols = ['name', 'groupe', 'fonction', 'telephone', 'email', 'statut', 'lastContact'];
    table.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:12px;"><thead><tr>${cols.map(c => `<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--color-border);">${(IMPORT_LIST_FIELDS.find(f => f.value === c) || {}).label || c}</th>`).join('')}</tr></thead><tbody>${previewRows.slice(0, 50).map(r => `<tr>${cols.map(c => `<td style="padding:6px 8px;border-bottom:1px solid var(--color-border);">${escapeHtml((r[c] || '').slice(0, 40))}</td>`).join('')}</tr>`).join('')}</tbody></table>${previewRows.length > 50 ? `<p class="muted" style="padding:8px;">… et ${previewRows.length - 50} autre(s)</p>` : ''}`;
}

const _IMPORT_REFORMAT_PROMPTS = {
    name: 'Tu es un assistant. Normalise les données suivantes pour qu\'elles soient des **noms de personnes** (Prénom Nom, sans titre, sans entreprise). Réponds uniquement avec une valeur par ligne, dans le même ordre, sans numérotation. Données :',
    groupe: 'Tu es un assistant. Normalise les données suivantes pour qu\'elles soient des **noms d\'entreprises** (raison sociale, pas de sigle seul si tu peux l’écrire en entier). Une valeur par ligne, même ordre, sans numérotation. Données :',
    fonction: 'Tu es un assistant. Normalise les données suivantes pour qu\'elles soient des **intitulés de poste / fonctions** (ex: Directeur technique, Ingénieur R&D). Une valeur par ligne, même ordre, sans numérotation. Données :',
    telephone: 'Tu es un assistant. Normalise les numéros de téléphone suivants (format français 0X XX XX XX XX ou international). Une valeur par ligne, même ordre. Données :',
    email: 'Tu es un assistant. Vérifie et normalise les adresses email suivantes (une par ligne, même ordre). Données :'
};

function openImportListReformatModal(field) {
    const rows = window._importListPreviewRows;
    if (!rows || !rows.length) return;
    window._importListReformatField = field;
    const label = (IMPORT_LIST_FIELDS.find(f => f.value === field) || {}).label || field;
    document.getElementById('importListReformatTitle').textContent = 'Reformater : ' + label;
    const values = rows.map(r => (r[field] || '').trim() || '(vide)');
    const promptText = (_IMPORT_REFORMAT_PROMPTS[field] || 'Normalise les données suivantes (une valeur par ligne, même ordre). Données :') + '\n\n' + values.join('\n');
    document.getElementById('importListReformatPrompt').value = promptText;
    document.getElementById('importListReformatPaste').value = '';
    // Mettre à jour les labels des boutons IA avec le modèle configuré
    if (typeof window.updateAIButtonLabels === 'function') {
        window.updateAIButtonLabels();
    }
    const modal = document.getElementById('modalImportListReformat');
    if (modal) {
        // Ne pas utiliser openModal() : ce modal est imbriqué dans le modal import,
        // openModal fermerait le parent. On ajoute juste la classe active directement.
        modal.classList.add('active');
        const ta = modal.querySelector('textarea');
        if (ta) setTimeout(() => ta.focus(), 50);
    }
}

async function runImportListReformatWithOllama() {
    const prompt = document.getElementById('importListReformatPrompt').value;
    if (!prompt) return;
    const btn = document.getElementById('importListReformatOllamaBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Génération…'; }
    try {
        const text = await callOllama(prompt);
        document.getElementById('importListReformatPaste').value = text || '';
    } catch (e) {
        showToast('Ollama indisponible. Collez manuellement le résultat ci-dessous.', 'warning', 5000);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Générer avec Ollama'; }
    }
}

function closeImportListReformatModal() {
    const modal = document.getElementById('modalImportListReformat');
    if (modal) modal.classList.remove('active');
    window._importListReformatField = null;
}

function applyImportListReformat() {
    const field = window._importListReformatField;
    const rows = window._importListPreviewRows;
    if (!field || !rows || !rows.length) return;
    const paste = (document.getElementById('importListReformatPaste').value || '').trim();
    const lines = paste.split(/\r?\n/).map(l => l.replace(/^\d+[.)\s\-]+/, '').trim());
    if (lines.length < rows.length) {
        showToast('Pas assez de lignes (attendu ' + rows.length + ', reçu ' + lines.length + ').', 'warning');
        return;
    }
    rows.forEach((r, i) => { r[field] = (lines[i] || '').trim(); });
    _renderImportListPreviewTable();
    closeImportListReformatModal();
    showToast('Colonne mise à jour. Vérifiez l’aperçu puis importez.', 'success');
}

function openImportListReformatAllModal() {
    const rows = window._importListPreviewRows;
    if (!rows || !rows.length) return;
    const modal = document.getElementById('modalImportListReformatAll');
    if (!modal) return;
    const checkboxes = document.getElementById('importListReformatAllCheckboxes');
    const reformatCols = ['name', 'groupe', 'fonction', 'telephone', 'email'];
    checkboxes.innerHTML = reformatCols.map(c => {
        const label = (IMPORT_LIST_FIELDS.find(f => f.value === c) || {}).label || c;
        const hasData = rows.some(r => r[c] && r[c].trim());
        return `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" value="${c}" ${hasData ? 'checked' : ''} style="cursor:pointer;"> ${label}${hasData ? '' : ' <span class="muted">(vide)</span>'}</label>`;
    }).join('');
    // Mettre à jour les labels des boutons IA avec le modèle configuré
    if (typeof window.updateAIButtonLabels === 'function') {
        window.updateAIButtonLabels();
    }
    // Modal imbriqué — ne pas passer par openModal() pour ne pas fermer le parent
    modal.classList.add('active');
}

function closeImportListReformatAllModal() {
    const modal = document.getElementById('modalImportListReformatAll');
    if (modal) modal.classList.remove('active');
}

async function runImportListReformatAllWithOllama() {
    const rows = window._importListPreviewRows;
    if (!rows || !rows.length) return;
    const checkboxes = document.querySelectorAll('#importListReformatAllCheckboxes input[type="checkbox"]:checked');
    const selectedFields = Array.from(checkboxes).map(cb => cb.value);
    if (selectedFields.length === 0) {
        showToast('Sélectionnez au moins une colonne à reformater.', 'warning');
        return;
    }
    const btn = document.getElementById('importListReformatAllOllamaBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Génération…'; }
    try {
        const fieldLabels = selectedFields.map(f => (IMPORT_LIST_FIELDS.find(fld => fld.value === f) || {}).label || f);
        const prompts = selectedFields.map(f => _IMPORT_REFORMAT_PROMPTS[f] || `Normalise les données suivantes pour le champ "${(IMPORT_LIST_FIELDS.find(fld => fld.value === f) || {}).label || f}" (une valeur par ligne, même ordre). Données :`);
        const combinedPrompt = `Tu es un assistant. Normalise les données suivantes pour ${selectedFields.length} colonne(s) : ${fieldLabels.join(', ')}.\n\nPour chaque colonne, je vais te donner les données à normaliser. Réponds avec un JSON où chaque clé est le nom du champ et la valeur est un tableau de valeurs normalisées (une par ligne, dans le même ordre).\n\n${selectedFields.map((f, i) => {
            const values = rows.map(r => (r[f] || '').trim() || '(vide)');
            return `Colonne "${fieldLabels[i]}" :\n${prompts[i]}\n${values.join('\n')}`;
        }).join('\n\n')}\n\nRéponds avec un JSON de cette forme :\n{\n  "${selectedFields[0]}": ["valeur1", "valeur2", ...],\n  ${selectedFields.slice(1).map(f => `"${f}": ["valeur1", "valeur2", ...]`).join(',\n  ')}\n}`;
        const text = await callOllama(combinedPrompt);
        let jsonStr = (text || '').trim();
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) jsonStr = jsonMatch[0];
        const result = JSON.parse(jsonStr);
        let applied = 0;
        selectedFields.forEach(field => {
            if (result[field] && Array.isArray(result[field])) {
                const values = result[field];
                if (values.length >= rows.length) {
                    rows.forEach((r, i) => { r[field] = (values[i] || '').trim(); });
                    applied++;
                }
            }
        });
        if (applied > 0) {
            _renderImportListPreviewTable();
            closeImportListReformatAllModal();
            showToast(`${applied} colonne(s) reformatée(s). Vérifiez l'aperçu puis importez.`, 'success', 5000);
        } else {
            showToast('Aucune colonne reformatée. Vérifiez le format de la réponse Ollama.', 'warning');
        }
    } catch (e) {
        console.error('Erreur reformatage multi-colonnes:', e);
        showToast('Ollama indisponible ou réponse invalide. Reformatez colonne par colonne.', 'warning', 5000);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Générer avec Ollama'; }
    }
}

function applyImportList() {
    const rows = window._importListPreviewRows;
    if (!rows || !rows.length) { showToast('Aucune ligne à importer.', 'warning'); return; }
    const unassignedId = ensureUnassignedCompany();
    const companyByKey = new Map();
    data.companies.forEach(c => { companyByKey.set((c.groupe || '').trim().toLowerCase() + '|' + (c.site || '').trim().toLowerCase(), c); });
    const localMaxCompanyId = Math.max(...data.companies.map(c => Number(c.id) || 0), 0);
    const localMaxProspectId = Math.max(...data.prospects.map(p => Number(p.id) || 0), 0);
    const baseMaxCompanyId = Number.isFinite(_globalMaxCompanyId) ? Math.max(Number(_globalMaxCompanyId) || 0, localMaxCompanyId) : localMaxCompanyId;
    const baseMaxProspectId = Number.isFinite(_globalMaxProspectId) ? Math.max(Number(_globalMaxProspectId) || 0, localMaxProspectId) : localMaxProspectId;
    let newCompanyId = baseMaxCompanyId + 1;
    let created = 0;
    let lastCreatedProspectId = baseMaxProspectId;
    rows.forEach((row, i) => {
        const groupe = (row.groupe || '').trim() || 'Sans entreprise';
        const site = (row.site || '').trim() || '';
        const key = groupe.toLowerCase() + '|' + site.toLowerCase();
        let companyId = unassignedId;
        if (groupe && groupe !== 'Sans entreprise') {
            let company = companyByKey.get(key);
            if (!company) {
                company = { id: newCompanyId, groupe, site, phone: 'Non disponible', notes: '', tags: [] };
                data.companies.push(company);
                companyByKey.set(key, company);
                newCompanyId++;
            }
            companyId = company.id;
        }
        const name = (row.name || '').trim() || 'Sans nom';
        const tags = (row.tags || '').trim() ? (row.tags || '').split(/[,;]/).map(t => t.trim()).filter(Boolean) : [];
        const newProspectId = baseMaxProspectId + 1 + i;
        const lastContactVal = (row.lastContact || '').trim();
        const p = {
            id: newProspectId,
            name,
            company_id: companyId,
            fonction: (row.fonction || '').trim(),
            telephone: (row.telephone || '').trim(),
            email: (row.email || '').trim(),
            linkedin: (row.linkedin || '').trim(),
            pertinence: (row.pertinence || '3').replace(/[⭐*]/g, '').trim() || '3',
            statut: (row.statut || '').trim() || "Pas d'actions",
            lastContact: lastContactVal || todayISO(),
            nextFollowUp: '',
            priority: 2,
            notes: (row.notes || '').trim(),
            callNotes: [],
            pushEmailSentAt: '',
            tags: Array.isArray(tags) ? tags : (typeof tags === 'string' ? [tags] : []),
            template_id: null,
            nextAction: '',
            pushLinkedInSentAt: '',
            photo_url: '',
            push_category_id: null,
            fixedMetier: '',
            rdvDate: '',
            is_archived: 0,
        };
        data.prospects.push(p);
        created++;
        lastCreatedProspectId = newProspectId;
    });
    if (created > 0) _globalMaxProspectId = Math.max(Number(_globalMaxProspectId) || 0, lastCreatedProspectId);
    _globalMaxCompanyId = Math.max(Number(_globalMaxCompanyId) || 0, newCompanyId - 1);
    closeImportListModal();
    saveToServerAsync().then(() => {
        normalizeData();
        filterProspects();
        renderProspects();
        populateCompanySelects();
        showToast(`✅ ${created} prospect(s) importé(s). Retrouvez votre liste ci-dessous.`, 'success', 6000);
    }).catch(err => showToast('Erreur sauvegarde: ' + (err && err.message), 'error'));
}


// ====== Import Lusha Enrichment ======

/**
 * Correspondance colonnes Lusha → champs internes.
 * Les clés sont en minuscules pour une comparaison insensible à la casse.
 * Les valeurs préfixées "_lusha" sont des champs intermédiaires (combinés plus bas).
 */
const LUSHA_COLUMN_MAP = {
    // Colonnes exactes de l'export Lusha (insensibles a la casse)
    'url':                          '_lushaLinkedinSrc',   // URL LinkedIn source (colonne 1)
    '(lusha) full name':            '_lushaFullName',      // Nom complet deja assemble
    '(lusha) linkedin url':         'linkedin',
    '(lusha) phone number 1':       '_lushaPhone1',
    '(lusha) phone number 2':       '_lushaPhone2',
    '(lusha) work email':           '_lushaWorkEmail',     // Email pro (prioritaire)
    '(lusha) direct email':         '_lushaDirectEmail',   // Email perso (fallback)
    '(lusha) job title':            'fonction',
    '(lusha) seniority':            '_lushaSeniority',     // non-manager / manager / director / c-suite
    '(lusha) company name':         'groupe',
    '(lusha) company city':         'site',                // Ville siege entreprise
    '(lusha) city':                 '_lushaCity',          // Ville de la personne -> notes
    '(lusha) country':              '_lushaCountry',
};

/** Verifie qu'une adresse email a un format valide. */
function _lushaIsValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((email || '').trim());
}

/**
 * Lit un fichier CSV Lusha, mappe les colonnes automatiquement
 * et affiche directement l'etape apercu (sans etape de mapping manuel).
 */
function parseLushaFile(file) {
    const reader = new FileReader();
    reader.onerror = function() {
        showToast('Impossible de lire le fichier. Verifiez que ce fichier CSV est accessible.', 'error');
    };
    reader.onload = function(e) {
        try {
        // Supprimer le BOM UTF-8 si present (export Lusha en UTF-8 BOM)
        const text = (e.target.result || '').replace(/^\uFEFF/, '');

        // Lusha exporte toujours en CSV separe par virgule
        const raw = _parseCsvText(text, { separator: ',' });
        if (!raw || !raw.headers.length) {
            showToast('Fichier Lusha vide ou illisible.', 'error');
            return;
        }

        // Construire l'index : champ interne -> index de colonne (insensible a la casse)
        const colIndex = {};
        raw.headers.forEach((h, i) => {
            const key = h.toLowerCase().trim();
            const field = LUSHA_COLUMN_MAP[key];
            // Conserver le premier index trouve pour chaque champ (evite les doublons)
            if (field && !(field in colIndex)) colIndex[field] = i;
        });

        // Compteurs pour le rapport de parsing
        const totalLignes = raw.rows.length;
        let prosValid = 0, avecTel = 0, avecEmail = 0, ignores = 0;

        // Helper : valeur de colonne pour une ligne donnee
        const get = (row, field) => {
            const idx = colIndex[field];
            return (idx !== undefined && row[idx] != null) ? String(row[idx]).trim() : '';
        };

        // Mapper chaque ligne vers un objet prospect ProspUp
        const mappedRows = [];
        raw.rows.forEach(row => {
            // Nom complet directement dans "(Lusha) Full name"
            const name = get(row, '_lushaFullName');

            // Ignorer les lignes non enrichies (nom vide = pas de donnees Lusha)
            if (!name) { ignores++; return; }

            // Telephones : consolider Phone number 1 et 2 avec " / "
            const phones = [get(row, '_lushaPhone1'), get(row, '_lushaPhone2')].filter(v => v);
            const telephone = phones.join(' / ');

            // Email : work email (pro) en priorite, direct email (perso) en fallback
            const emailCandidates = [get(row, '_lushaWorkEmail'), get(row, '_lushaDirectEmail')].filter(Boolean);
            const email = emailCandidates.find(v => _lushaIsValidEmail(v)) || emailCandidates[0] || '';

            // LinkedIn : URL enrichie par Lusha, sinon URL source de la liste
            const linkedin = get(row, 'linkedin') || get(row, '_lushaLinkedinSrc') || '';

            // Notes : ville de la personne + pays + niveau hierarchique
            const city      = get(row, '_lushaCity');
            const country   = get(row, '_lushaCountry');
            const seniority = get(row, '_lushaSeniority');
            const noteParts = [];
            if (city && country) noteParts.push(city + ', ' + country);
            else if (city)       noteParts.push(city);
            else if (country)    noteParts.push(country);
            if (seniority)       noteParts.push('Niveau : ' + seniority);
            const notes = noteParts.join(' — ');

            mappedRows.push({
                name,
                fonction:    get(row, 'fonction'),
                groupe:      get(row, 'groupe'),
                site:        get(row, 'site'),   // ville siege entreprise
                linkedin,
                telephone,
                email,
                notes,
                pertinence:  '3',
                statut:      "Pas d'actions",
                tags:        '',
                lastContact: '',
            });
            prosValid++;
            if (telephone) avecTel++;
            if (email)     avecEmail++;
        });

        if (!mappedRows.length) {
            showToast('Aucun prospect valide — verifiez que le fichier est bien un export Lusha.', 'warning', 6000);
            return;
        }

        _lushaShowPreview(mappedRows, { totalLignes, prosValid, avecTel, avecEmail, ignores });
        } catch (err) {
            console.error('[Lusha import] Erreur parsing:', err);
            showToast('Erreur lors du parsing Lusha : ' + (err && err.message ? err.message : String(err)), 'error', 8000);
        }
    };
    reader.readAsText(file, 'UTF-8');
}

/**
 * Affiche l'etape apercu avec les donnees deja mappees par parseLushaFile().
 * Saute completement l'etape de mapping manuel.
 */
function _lushaShowPreview(mappedRows, stats) {
    // Injecter les donnees dans la variable partagee avec applyImportList()
    window._importListPreviewRows = mappedRows;

    // Bandeau recapitulatif affiche au-dessus du tableau de preview
    const btns = document.getElementById('importListReformatButtons');
    const ignoresHtml = stats.ignores
        ? `&nbsp;&middot;&nbsp; <span style="color:var(--color-warning);">&#9888;&#65039; <strong>${stats.ignores}</strong> ignor&eacute;(s) (nom vide)</span>`
        : '';
    btns.innerHTML = `
        <div style="background:var(--color-bg-secondary);border:1px solid var(--color-border);border-radius:8px;padding:10px 14px;margin-bottom:10px;font-size:12px;line-height:2;">
            <strong>&#128309; Colonnes Lusha d&eacute;tect&eacute;es automatiquement</strong><br>
            &#9989; <strong>${stats.prosValid}</strong> prospect(s) valide(s) sur <strong>${stats.totalLignes}</strong> ligne(s)
            ${ignoresHtml}
            &nbsp;&middot;&nbsp; &#128222; <strong>${stats.avecTel}</strong> avec t&eacute;l&eacute;phone
            &nbsp;&middot;&nbsp; &#9993;&#65039; <strong>${stats.avecEmail}</strong> avec email
        </div>`;

    // Masquer le bouton "Reformater plusieurs colonnes" (non pertinent pour Lusha)
    const reformatAllBtn = document.getElementById('importListReformatAllBtn');
    if (reformatAllBtn) reformatAllBtn.style.display = 'none';

    // Mettre a jour le compteur et le tableau de preview
    document.getElementById('importListPreviewCount').textContent = mappedRows.length;
    _renderImportListPreviewTable();

    // Passer directement a l'etape apercu (sauter le mapping)
    document.getElementById('importListStepChoice').style.display = 'none';
    document.getElementById('importListStepMapping').style.display = 'none';
    document.getElementById('importListStepPreview').style.display = '';
}

