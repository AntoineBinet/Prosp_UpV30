// ═══════════════════════════════════════════════════
// Quick Add IA — Ajout rapide via prompt IA
// Flow: Choix type → Prompt copié → Colle retour → Parse → Création
// ═══════════════════════════════════════════════════

(function () {
    let _qaType = '';      // 'prospect' | 'company' | 'candidate'
    let _qaMode = '';      // 'single' | 'multiple'
    let _qaParsed = null;  // parsed result

    // ─── Open / Close ───
    window.openQuickAddModal = function () {
        const m = document.getElementById('modalQuickAdd');
        if (!m) return;
        _qaType = '';
        _qaMode = '';
        _qaParsed = null;
        document.getElementById('qaStep1').style.display = '';
        document.getElementById('qaStep3Paste').style.display = 'none';
        document.getElementById('qaStep4Preview').style.display = 'none';
        document.querySelectorAll('.qa-card').forEach(c => c.classList.remove('active'));
        m.classList.add('active');
    };

    window.closeQuickAddModal = function () {
        const m = document.getElementById('modalQuickAdd');
        if (m) m.classList.remove('active');
    };

    // ─── Step 1: pick type ───
    window.qaPickType = function (type) {
        _qaType = type;
        document.querySelectorAll('.qa-card').forEach(c => c.classList.remove('active'));
        document.querySelector(`.qa-card[data-type="${type}"]`)?.classList.add('active');
    };

    // ─── Step 2: copy prompt or generate with Ollama ───
    window.qaStartSingle = function () {
        if (!_qaType) { showToast('⚠️ Sélectionnez un type d\'abord', 'warning'); return; }
        _qaMode = 'single';
        _copyPrompt(_qaType, false);
        document.getElementById('qaStep1').style.display = 'none';
        document.getElementById('qaStep3Paste').style.display = '';
        document.getElementById('qaPasteTextarea').value = '';
        document.getElementById('qaPasteTextarea').focus();
        showToast('Prompt copié. Collez-le dans Ollama ou une autre IA, puis collez le retour ci-dessous.', 'info', 5000);
    };

    window.qaStartMultiple = function () {
        if (!_qaType) { showToast('⚠️ Sélectionnez un type d\'abord', 'warning'); return; }
        _qaMode = 'multiple';
        _copyPrompt(_qaType, true);
        document.getElementById('qaStep1').style.display = 'none';
        document.getElementById('qaStep3Paste').style.display = '';
        document.getElementById('qaPasteTextarea').value = '';
        document.getElementById('qaPasteTextarea').focus();
        showToast('Prompt copié. Collez-le dans Ollama ou une autre IA, puis collez le retour ci-dessous.', 'info', 5000);
    };

    window.qaGenerateWithOllama = function (multiple) {
        if (!_qaType) { showToast('⚠️ Sélectionnez un type d\'abord', 'warning'); return; }
        _qaMode = multiple ? 'multiple' : 'single';
        const contextEl = document.getElementById('qaContextInput');
        const context = (contextEl && contextEl.value && contextEl.value.trim()) ? contextEl.value.trim() : '';
        if (!context) {
            showToast('Sans contexte, l\'IA génère un exemple. Vous pourrez modifier le résultat puis cliquer Analyser.', 'info', 5000);
        }
        const prompt = multiple ? _buildMultiPrompt(_qaType, context) : _buildSinglePrompt(_qaType, context);
        if (typeof window.callOllama !== 'function') { showToast('Ollama non disponible', 'error'); return; }
        const overlay = document.getElementById('qaOllamaOverlay');
        if (overlay) {
            overlay.style.display = 'flex';
        }
        const opts = multiple ? { timeoutMs: 300000 } : { timeoutMs: 180000 };
        window.callOllama(prompt, opts).then(function (text) {
            if (overlay) overlay.style.display = 'none';
            const result = _tryParseQARaw(text || '', _qaType);
            if (result.ok) {
                _qaParsed = result.parsed;
                document.getElementById('qaStep1').style.display = 'none';
                document.getElementById('qaStep3Paste').style.display = 'none';
                document.getElementById('qaStep4Preview').style.display = '';
                _renderPreview(_qaParsed);
                showToast('Vérifiez les données ci-dessous, modifiez si besoin, puis cliquez Créer.', 'success', 4000);
            } else {
                document.getElementById('qaStep1').style.display = 'none';
                document.getElementById('qaStep3Paste').style.display = '';
                document.getElementById('qaStep4Preview').style.display = 'none';
                document.getElementById('qaPasteTextarea').value = text || '';
                showToast('Format non reconnu. Modifiez le JSON ci-dessous puis cliquez Analyser.', 'warning', 6000);
            }
        }).catch(function (err) {
            if (overlay) overlay.style.display = 'none';
            const msg = (err && err.message) === 'Timeout' ? 'Génération trop longue. Utilisez « Copier » puis collez le retour manuellement.' : 'Ollama indisponible. Utilisez « Copier » puis collez le retour manuellement.';
            showToast(msg, 'warning', 6000);
        });
    };

    window.qaBackToStep1 = function () {
        document.getElementById('qaStep3Paste').style.display = 'none';
        document.getElementById('qaStep4Preview').style.display = 'none';
        document.getElementById('qaStep1').style.display = '';
    };

    // ─── Parse: partagé entre Ollama direct et collage manuel ───
    function _fixJsonString(s) {
        // Remplacer les retours à la ligne non échappés dans les chaînes (invalides en JSON)
        let out = '', i = 0, inStr = false, quote = '', escape = false;
        while (i < s.length) {
            const c = s[i];
            if (escape) { out += c; escape = false; i++; continue; }
            if (c === '\\' && inStr) { out += c; escape = true; i++; continue; }
            if ((c === '"' || c === "'") && !inStr) { inStr = true; quote = c; out += c; i++; continue; }
            if (c === quote && inStr) { inStr = false; quote = ''; out += c; i++; continue; }
            if (inStr && (c === '\n' || c === '\r')) { out += '\\n'; i++; continue; }
            out += c;
            i++;
        }
        return out;
    }

    function _fixMarkdownAfterString(s) {
        // Corriger les cas où du texte markdown apparaît après la fermeture d'une chaîne JSON
        // Exemple: "notes": "texte" [linkedin](url) -> "notes": "texte [linkedin](url)"
        // Version améliorée qui détecte les guillemets non échappés et gère plusieurs occurrences
        
        let result = s;
        let changed = true;
        let iterations = 0;
        const maxIterations = 10; // Éviter les boucles infinies
        
        // Pattern pour détecter les liens markdown: [text](url)
        const markdownLinkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
        
        while (changed && iterations < maxIterations) {
            changed = false;
            iterations++;
            let newResult = result;
            
            // Chercher directement le pattern: guillemet, espaces, lien markdown
            // Pattern: " ... " [text](url) suivi de virgule, accolade, crochet, retour à la ligne ou fin
            const fullPattern = /"(\s+)(\[[^\]]+\]\([^)]+\))(\s*[,}\]]|\s*\r?\n|\s*$)/g;
            const matches = [];
            let match;
            fullPattern.lastIndex = 0; // Reset regex
            while ((match = fullPattern.exec(result)) !== null) {
                matches.push({
                    fullMatch: match[0],
                    quotePos: match.index,
                    spaces: match[1],
                    markdown: match[2],
                    after: match[3],
                    start: match.index,
                    end: match.index + match[0].length
                });
            }
            
            // Traiter les matches en ordre inverse pour préserver les positions
            for (let i = matches.length - 1; i >= 0; i--) {
                const mdMatch = matches[i];
                const quotePos = mdMatch.quotePos;
                
                // Vérifier que ce n'est pas un guillemet échappé
                let escapeCount = 0;
                for (let j = quotePos - 1; j >= 0 && result[j] === '\\'; j--) {
                    escapeCount++;
                }
                
                // Si le guillemet n'est pas échappé (nombre pair de backslashes)
                if (escapeCount % 2 === 0) {
                    // Correction : déplacer le markdown avant le guillemet
                    const beforeQuote = result.substring(0, quotePos);
                    const afterMarkdownText = result.substring(mdMatch.end);
                    
                    newResult = beforeQuote + ' ' + mdMatch.markdown + '"' + mdMatch.after + afterMarkdownText;
                    changed = true;
                    break; // Traiter une correction à la fois pour éviter les conflits
                }
            }
            
            result = newResult;
        }
        
        return result;
    }

    function _tryParseQARaw(raw, type) {
        if (!raw || !raw.trim()) return { ok: false };
        let rawStr = raw.trim()
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .replace(/[\u200B-\u200D\uFEFF]/g, '');
        let parsed = null;

        // 0) Correction automatique : texte markdown après fermeture de chaîne
        const fixedMarkdown = _fixMarkdownAfterString(rawStr);

        // 1) Essai direct : brut, virgules finales, newlines dans chaînes, markdown corrigé
        const candidates = [
            rawStr,
            fixedMarkdown,
            rawStr.replace(/,\s*([}\]])/g, '$1'),
            fixedMarkdown.replace(/,\s*([}\]])/g, '$1'),
            _fixJsonString(rawStr),
            _fixJsonString(fixedMarkdown),
            _fixJsonString(rawStr).replace(/,\s*([}\]])/g, '$1'),
            _fixJsonString(fixedMarkdown).replace(/,\s*([}\]])/g, '$1')
        ];
        for (const candidate of candidates) {
            try {
                const p = JSON.parse(candidate);
                if (p != null && (Array.isArray(p) || typeof p === 'object')) {
                    parsed = p;
                    break;
                }
            } catch (_) {}
        }

        // 2) Extraire bloc markdown puis réessayer
        if (!parsed) {
            const codeBlock = rawStr.match(/```(?:json)?\s*([\s\S]*?)```/);
            let jsonStr = codeBlock ? codeBlock[1].trim() : rawStr;
            jsonStr = _fixMarkdownAfterString(jsonStr); // Correction markdown avant autres corrections
            jsonStr = _fixJsonString(jsonStr);
            for (const toTry of [jsonStr, jsonStr.replace(/,\s*([}\]])/g, '$1')]) {
                try {
                    const p = JSON.parse(toTry);
                    if (p != null && (Array.isArray(p) || typeof p === 'object')) { parsed = p; break; }
                } catch (_) {}
            }
        }

        // 3) Extraire premier objet/array par accolades équilibrées
        if (!parsed) {
            let jsonStr = rawStr;
            const codeBlock = rawStr.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (codeBlock) jsonStr = codeBlock[1].trim();
            jsonStr = String(jsonStr).replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\r/g, '\n').trim();

            const openBrace = jsonStr.indexOf('{');
            const openBracket = jsonStr.indexOf('[');
            let start = -1, endChar = '';
            if (openBracket >= 0 && (openBrace < 0 || openBracket < openBrace)) {
                start = openBracket;
                endChar = ']';
            } else if (openBrace >= 0) {
                start = openBrace;
                endChar = '}';
            }
            if (start >= 0) {
                const closeChar = endChar === ']' ? ']' : '}';
                const openChar = endChar === ']' ? '[' : '{';
                let depth = 0, inString = false, escape = false, end = -1, quote = '';
                for (let i = start; i < jsonStr.length; i++) {
                    const c = jsonStr[i];
                    if (escape) { escape = false; continue; }
                    if (c === '\\' && inString) { escape = true; continue; }
                    if (inString) {
                        if (c === quote) inString = false;
                        else if (c === '\n' || c === '\r') { /* garder pour _fixJsonString plus bas */ }
                        continue;
                    }
                    if (c === '"' || c === "'") { inString = true; quote = c; continue; }
                    if (c === openChar) depth++;
                    else if (c === closeChar) {
                        depth--;
                        if (depth === 0) { end = i; break; }
                    }
                }
                if (end > start) jsonStr = jsonStr.slice(start, end + 1);
            }
            jsonStr = _fixMarkdownAfterString(jsonStr); // Correction markdown avant autres corrections
            jsonStr = _fixJsonString(jsonStr)
                .replace(/,\s*([}\]])/g, '$1')
                .replace(/\/\/[^\n]*/g, '')
                .trim();
            try {
                parsed = JSON.parse(jsonStr);
            } catch (_) {}
        }

        // 4) Fallback format KEY: value
        if (!parsed) {
            try {
                parsed = _parseTextFormat(rawStr, type);
            } catch (_) {}
        }

        if (!parsed || (typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length === 0))
            return { ok: false };
        if (!Array.isArray(parsed)) parsed = [parsed];
        return { ok: true, parsed: parsed };
    }

    window.qaParse = function () {
        const raw = document.getElementById('qaPasteTextarea').value.trim();
        if (!raw) { showToast('⚠️ Collez le retour de l\'IA', 'warning'); return; }
        const result = _tryParseQARaw(raw, _qaType);
        if (!result.ok) {
            showToast('⚠️ Format non reconnu. Modifiez le JSON ci-dessous puis réessayez.', 'warning');
            return;
        }
        _qaParsed = result.parsed;
        _renderPreview(_qaParsed);
    };

    // ─── Text parser (KEY: value) ───
    function _parseTextFormat(text, type) {
        const fieldMaps = {
            prospect: {
                'NOM': 'name', 'FONCTION': 'fonction', 'ENTREPRISE': '_company_name',
                'TELEPHONE': 'telephone', 'EMAIL': 'email', 'LINKEDIN': 'linkedin',
                'TAGS': 'tags', 'METIER': 'fixedMetier', 'PERTINENCE': 'pertinence',
                'NOTES': 'notes', 'SECTEUR': 'sector'
            },
            company: {
                'NOM': 'groupe', 'GROUPE': 'groupe', 'SITE': 'site',
                'TELEPHONE': 'phone', 'SECTEUR': 'industry', 'TAGS': 'tags',
                'NOTES': 'notes', 'EFFECTIF': 'size', 'ADRESSE': 'address',
                'VILLE': 'city', 'SITE_WEB': 'website', 'LINKEDIN': 'linkedin'
            },
            candidate: {
                'NOM': 'name', 'ROLE': 'role', 'LOCALISATION': 'location',
                'ANNEES_EXPERIENCE': 'years_experience', 'SENIORITE': 'seniority',
                'TECH': 'tech', 'SKILLS': 'skills', 'LINKEDIN': 'linkedin',
                'SOURCE': 'source', 'NOTES': 'notes', 'SECTEUR': 'sector',
                'DISPONIBILITE': '_dispo', 'TJM_ESTIME': '_tjm',
                'PARCOURS': '_parcours', 'TELEPHONE': 'phone', 'EMAIL': 'email'
            }
        };
        const map = fieldMaps[type] || {};
        const obj = {};
        const lines = text.split('\n');
        let currentKey = null, currentValue = '';

        for (const line of lines) {
            const match = line.match(/^([A-ZÀ-Ü_]+)\s*:\s*(.*)$/);
            if (match) {
                if (currentKey) _assignParsedField(obj, currentKey, currentValue, map);
                currentKey = match[1].trim();
                currentValue = match[2].trim();
            } else if (currentKey) {
                currentValue += '\n' + line;
            }
        }
        if (currentKey) _assignParsedField(obj, currentKey, currentValue, map);

        if (Object.keys(obj).length === 0) return null;
        return obj;
    }

    function _assignParsedField(obj, rawKey, rawValue, map) {
        const key = rawKey.toUpperCase().replace(/\s+/g, '_');
        const field = map[key];
        if (!field) return;
        const val = rawValue.trim();
        if (!val || val === '[À TROUVER]' || val === '[INCONNU]' || val === '[VIDE]') return;

        if (field === 'tags' || field === 'skills') {
            obj[field] = val.split(',').map(t => t.trim()).filter(Boolean);
        } else if (field === 'years_experience') {
            const n = parseInt(val);
            obj[field] = isNaN(n) ? null : n;
        } else if (field === 'pertinence') {
            const n = parseInt(val);
            obj[field] = (n >= 1 && n <= 5) ? String(n) : val;
        } else if (field.startsWith('_')) {
            // Append to notes
            obj.notes = (obj.notes || '') + '\n' + rawKey + ': ' + val;
        } else {
            obj[field] = val;
        }
    }

    // ─── Preview : formulaire de validation éditable ───
    function _fieldRow(label, fieldName, value, isTextarea) {
        const v = _escVal(value);
        const tag = isTextarea ? 'textarea' : 'input';
        const attrs = isTextarea
            ? `rows="2" data-field="${fieldName}" class="qa-preview-input" style="width:100%;border:1px solid var(--color-border);border-radius:6px;padding:6px 8px;font-size:12px;background:var(--color-surface);color:var(--color-text);resize:vertical;">${v}</textarea>`
            : `type="text" data-field="${fieldName}" class="qa-preview-input" value="${v}" style="width:100%;border:1px solid var(--color-border);border-radius:6px;padding:6px 8px;font-size:12px;background:var(--color-surface);color:var(--color-text);">`;
        return `<div class="qa-preview-row" style="margin-bottom:10px;">
            <label style="display:block;font-size:11px;font-weight:600;color:var(--color-muted);margin-bottom:4px;">${label}</label>
            <${tag} ${attrs}
        </div>`;
    }

    function _companySelectRow(value) {
        const companies = (typeof data !== 'undefined' && data.companies) ? data.companies : [];
        const v = _escVal(value);
        const valTrim = (value || '').toString().trim();
        let matchIndex = -1;
        companies.forEach((c, i) => { if ((c.groupe || '').trim() === valTrim) matchIndex = i; });
        const options = ['<option value="">— Choisir —</option>']
            .concat(companies.map((c, i) => '<option value="' + _esc(c.groupe || '') + '"' + (i === matchIndex ? ' selected' : '') + '>' + _esc(c.groupe || '') + '</option>'))
            .concat(['<option value="__other__"' + (matchIndex === -1 && valTrim ? ' selected' : '') + '>+ Autre (saisie libre)</option>']);
        return `<div class="qa-preview-row qa-company-row" style="margin-bottom:10px;">
            <label style="display:block;font-size:11px;font-weight:600;color:var(--color-muted);margin-bottom:4px;">Entreprise</label>
            <select class="qa-company-select" style="width:100%;border:1px solid var(--color-border);border-radius:6px;padding:6px 8px;font-size:12px;background:var(--color-surface);color:var(--color-text);margin-bottom:6px;">
                ${options.join('')}
            </select>
            <input type="text" data-field="_company_name" class="qa-preview-input qa-company-input" value="${v}" style="width:100%;border:1px solid var(--color-border);border-radius:6px;padding:6px 8px;font-size:12px;background:var(--color-surface);color:var(--color-text);" placeholder="Nom entreprise">
        </div>`;
    }

    function _escVal(s) {
        if (s == null) return '';
        if (Array.isArray(s)) return s.join(', ');
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function _renderPreview(items) {
        document.getElementById('qaStep3Paste').style.display = 'none';
        document.getElementById('qaStep4Preview').style.display = '';
        const labels = { prospect: 'Prospect', company: 'Entreprise', candidate: 'Candidat' };
        document.getElementById('qaPreviewTitle').textContent =
            `✅ ${items.length} ${labels[_qaType]}(s) — vérifiez et modifiez les champs puis créez`;

        const container = document.getElementById('qaPreviewList');
        container.innerHTML = items.map((item, i) => {
            if (_qaType === 'prospect') {
                const tagsVal = Array.isArray(item.tags) ? item.tags.join(', ') : (item.tags || '');
                return `<div class="card qa-preview-item" data-index="${i}" style="padding:14px;margin-bottom:12px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
                        <strong style="font-size:14px;">${_esc(item.name || item.nom || `Prospect #${i + 1}`)}</strong>
                        <label style="font-size:13px;cursor:pointer;display:flex;align-items:center;gap:6px;">
                            <input type="checkbox" class="qa-item-check" data-index="${i}" checked> Créer ce prospect
                        </label>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 12px;">
                        ${_fieldRow('Nom', 'name', item.name || item.nom)}
                        ${_fieldRow('Fonction', 'fonction', item.fonction || item.function)}
                        ${_companySelectRow(item._company_name || item.entreprise || item.company)}
                        ${_fieldRow('Téléphone', 'telephone', item.telephone || item.phone)}
                        ${_fieldRow('Email', 'email', item.email)}
                        ${_fieldRow('LinkedIn', 'linkedin', item.linkedin)}
                        ${_fieldRow('Tags (séparés par des virgules)', 'tags', tagsVal)}
                        ${_fieldRow('Métier', 'fixedMetier', item.fixedMetier || item.metier)}
                        ${_fieldRow('Pertinence (1-5)', 'pertinence', item.pertinence)}
                    </div>
                    ${_fieldRow('Notes', 'notes', item.notes, true)}
                </div>`;
            }
            if (_qaType === 'company') {
                return `<div class="card qa-preview-item" data-index="${i}" style="padding:14px;margin-bottom:12px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                        <strong style="font-size:14px;">${_esc(item.groupe || item.name || item.nom || `Entreprise #${i + 1}`)}</strong>
                        <label style="font-size:13px;cursor:pointer;"><input type="checkbox" class="qa-item-check" data-index="${i}" checked> Créer</label>
                    </div>
                    ${_fieldRow('Groupe / Nom', 'groupe', item.groupe || item.name || item.nom)}
                    ${_fieldRow('Site / Ville', 'site', item.site || item.city)}
                    ${_fieldRow('Téléphone', 'phone', item.phone || item.telephone)}
                    ${_fieldRow('Secteur', 'industry', item.industry || item.sector)}
                    ${_fieldRow('Tags (virgules)', 'tags', Array.isArray(item.tags) ? item.tags.join(', ') : (item.tags || ''))}
                    ${_fieldRow('Notes', 'notes', item.notes, true)}
                </div>`;
            }
            if (_qaType === 'candidate') {
                const skillsVal = Array.isArray(item.skills) ? item.skills.join(', ') : (item.skills || '');
                return `<div class="card qa-preview-item" data-index="${i}" style="padding:14px;margin-bottom:12px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                        <strong style="font-size:14px;">${_esc(item.name || item.nom || `Candidat #${i + 1}`)}</strong>
                        <label style="font-size:13px;cursor:pointer;"><input type="checkbox" class="qa-item-check" data-index="${i}" checked> Créer</label>
                    </div>
                    ${_fieldRow('Nom', 'name', item.name || item.nom)}
                    ${_fieldRow('Rôle', 'role', item.role)}
                    ${_fieldRow('Localisation', 'location', item.location || item.localisation)}
                    ${_fieldRow('LinkedIn', 'linkedin', item.linkedin)}
                    ${_fieldRow('Téléphone', 'phone', item.phone || item.telephone)}
                    ${_fieldRow('Email', 'email', item.email)}
                    ${_fieldRow('Compétences (virgules)', 'skills', skillsVal)}
                    ${_fieldRow('Secteur', 'sector', item.sector || item.secteur)}
                    ${_fieldRow('Notes', 'notes', item.notes, true)}
                </div>`;
            }
            return '';
        }).join('');
        container.querySelectorAll('.qa-company-row').forEach(row => {
            const sel = row.querySelector('.qa-company-select');
            const inp = row.querySelector('.qa-company-input');
            if (sel && inp) {
                sel.addEventListener('change', function () {
                    if (sel.value !== '__other__' && sel.value !== '') inp.value = sel.value;
                });
            }
        });
    }

    function _getPreviewItemsFromDOM() {
        const checked = document.querySelectorAll('.qa-item-check:checked');
        const indices = new Set(Array.from(checked).map(ch => parseInt(ch.dataset.index)));
        const items = [];
        document.querySelectorAll('.qa-preview-item').forEach(card => {
            const i = parseInt(card.dataset.index);
            if (!indices.has(i)) return;
            const item = {};
            card.querySelectorAll('.qa-preview-input').forEach(input => {
                const field = input.dataset.field;
                let val = input.value ? input.value.trim() : '';
                if (field === 'tags' || field === 'skills') {
                    item[field] = val ? val.split(',').map(s => s.trim()).filter(Boolean) : [];
                } else if (field === 'pertinence') {
                    const n = parseInt(val);
                    item[field] = (n >= 1 && n <= 5) ? String(n) : val;
                } else {
                    item[field] = val;
                }
            });
            items.push(item);
        });
        return items;
    }

    function _esc(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

    function _resolveCompanyIdForItem(item) {
        const companyName = item._company_name || item.entreprise || item.company || '';
        if (!companyName || typeof data === 'undefined') return 0;
        const found = data.companies.find(c =>
            (c.groupe || '').toLowerCase().includes(companyName.toLowerCase()) ||
            companyName.toLowerCase().includes((c.groupe || '').toLowerCase())
        );
        return found ? found.id : 0;
    }

    // ─── Create all (lit les valeurs depuis le formulaire de validation) ───
    window.qaCreateAll = async function () {
        const items = _getPreviewItemsFromDOM();
        if (!items || items.length === 0) { showToast('⚠️ Aucun élément sélectionné', 'warning'); return; }

        if (_qaType === 'prospect') {
            const prospectsToCheck = items.map(item => ({
                name: item.name || item.nom || '',
                email: (item.email || '').trim(),
                telephone: (item.telephone || item.phone || '').trim(),
                linkedin: (item.linkedin || '').trim(),
                company_id: _resolveCompanyIdForItem(item) || null
            }));
            try {
                const res = await fetch('/api/prospects/check-duplicates', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prospects: prospectsToCheck })
                });
                if (res.ok) {
                    const json = await res.json();
                    const dupList = json.duplicate_indexes || [];
                    if (dupList.length > 0) {
                        const duplicateIndexSet = new Set(dupList.map(d => d.index));
                        const msg = dupList.length === 1
                            ? '1 prospect semble déjà exister (même email, téléphone ou LinkedIn). Ne pas l\'ajouter ?'
                            : dupList.length + ' prospects semblent déjà exister (même email, téléphone ou LinkedIn). Ne pas les ajouter ?';
                        const skipDuplicates = confirm(msg + '\n\nCliquez OK pour ne pas ajouter les doublons, Annuler pour tout ajouter quand même.');
                        if (skipDuplicates) {
                            items = items.filter((_, i) => !duplicateIndexSet.has(i));
                        }
                    }
                }
            } catch (e) {
                console.warn('Check duplicates before add:', e);
            }
        }

        let created = 0, errors = 0;

        for (const item of items) {
            try {
                if (_qaType === 'prospect') await _createProspect(item);
                else if (_qaType === 'company') await _createCompany(item);
                else if (_qaType === 'candidate') await _createCandidate(item);
                created++;
            } catch (e) {
                console.error('QA create error:', e);
                errors++;
            }
        }

        showToast(`✅ ${created} créé(s)${errors > 0 ? ` — ${errors} erreur(s)` : ''}`, created > 0 ? 'success' : 'warning');
        closeQuickAddModal();

        // Refresh data
        if (_qaType === 'prospect' || _qaType === 'company') {
            try { await saveToServerAsync(); } catch (e) { }
            if (typeof filterProspects === 'function') filterProspects();
            if (typeof refreshCompaniesUI === 'function') refreshCompaniesUI();
        }
        if (_qaType === 'candidate' && window.location.pathname === '/sourcing') {
            if (typeof loadCandidates === 'function') loadCandidates();
        }
    };

    // ─── Create functions ───
    async function _createProspect(item) {
        let companyId = 0;
        const companyName = item._company_name || item.entreprise || item.company || '';
        if (companyName && typeof data !== 'undefined') {
            const found = data.companies.find(c =>
                (c.groupe || '').toLowerCase().includes(companyName.toLowerCase()) ||
                companyName.toLowerCase().includes((c.groupe || '').toLowerCase())
            );
            if (found) {
                companyId = found.id;
            } else {
                // Auto-create company
                const newC = {
                    id: Math.max(...data.companies.map(c => c.id), 0) + 1,
                    groupe: companyName, site: '', phone: 'Non disponible', notes: '', tags: []
                };
                data.companies.push(newC);
                companyId = newC.id;
            }
        }

        const newP = {
            id: Math.max(...data.prospects.map(p => p.id), 0) + 1,
            name: item.name || item.nom || '',
            company_id: companyId,
            fonction: item.fonction || item.function || '',
            telephone: item.telephone || item.phone || '',
            email: item.email || '',
            linkedin: item.linkedin || '',
            pertinence: item.pertinence || '',
            statut: item.statut || '',
            lastContact: new Date().toISOString().slice(0, 10),
            notes: (item.notes || '').trim(),
            callNotes: [],
            nextFollowUp: '',
            priority: 2,
            pushEmailSentAt: '',
            tags: Array.isArray(item.tags) ? item.tags : [],
            template_id: null,
            fixedMetier: item.fixedMetier || item.metier || '',
        };
        data.prospects.push(newP);
    }

    async function _createCompany(item) {
        if (typeof data !== 'undefined') {
            const newC = {
                id: Math.max(...data.companies.map(c => c.id), 0) + 1,
                groupe: item.groupe || item.name || item.nom || '',
                site: item.site || item.localisation || '',
                phone: item.phone || item.telephone || 'Non disponible',
                notes: (item.notes || '').trim(),
                tags: Array.isArray(item.tags) ? item.tags : [],
            };
            data.companies.push(newC);
        }
    }

    async function _createCandidate(item) {
        const skills = Array.isArray(item.skills) ? item.skills :
                       (item.skills ? item.skills.split(',').map(s => s.trim()).filter(Boolean) : []);

        let yearsExp = item.years_experience;
        if (yearsExp === undefined || yearsExp === null) {
            // Try to parse from seniority text
            const sen = (item.seniority || item.seniorite || '').toLowerCase();
            if (sen.includes('junior') || sen.includes('0-2')) yearsExp = 1;
            else if (sen.includes('confirmé') || sen.includes('3-5')) yearsExp = 4;
            else if (sen.includes('senior') || sen.includes('6-10')) yearsExp = 8;
            else if (sen.includes('expert') || sen.includes('10+') || sen.includes('15')) yearsExp = 12;
            // Try to extract a number
            else { const m = sen.match(/(\d+)/); if (m) yearsExp = parseInt(m[1]); }
        }

        await fetch('/api/candidates/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: item.name || item.nom || '',
                role: item.role || '',
                location: item.location || item.localisation || '',
                seniority: item.seniority || item.seniorite || '',
                years_experience: yearsExp || null,
                tech: item.tech || '',
                linkedin: item.linkedin || '',
                source: item.source || 'ia_quickadd',
                status: item.status || 'a_sourcer',
                notes: (item.notes || '').trim(),
                skills: skills,
                sector: item.sector || item.secteur || '',
                phone: item.phone || item.telephone || '',
                email: item.email || '',
            })
        });
    }

    // ═══════════════════════════════════════════════════
    // PROMPT GENERATORS
    // ═══════════════════════════════════════════════════

    function _copyPrompt(type, multiple) {
        const contextEl = document.getElementById('qaContextInput');
        const context = (contextEl && contextEl.value && contextEl.value.trim()) ? contextEl.value.trim() : '';
        const prompt = multiple ? _buildMultiPrompt(type, context) : _buildSinglePrompt(type, context);
        navigator.clipboard.writeText(prompt).then(() => {
            showToast('🤖 Prompt copié ! Collez-le dans votre IA favorite.', 'success', 4000);
        }).catch(() => {
            const ta = document.createElement('textarea');
            ta.value = prompt; ta.style.cssText = 'position:fixed;left:-9999px;';
            document.body.appendChild(ta); ta.select(); document.execCommand('copy');
            document.body.removeChild(ta);
            showToast('🤖 Prompt copié !', 'success', 3000);
        });
    }

    function _buildSinglePrompt(type, context) {
        const jsonFormats = {
            prospect: `{"name":"Prénom Nom","fonction":"Titre du poste","entreprise":"Nom entreprise","telephone":"...","email":"...","linkedin":"https://linkedin.com/in/...","tags":["tag1","tag2","tag3"],"metier":"Métier principal","pertinence":"5","secteur":"automobile","notes":"Résumé court"}`,
            company: `{"groupe":"Nom du groupe","site":"Ville du site","phone":"...","industry":"Secteur","tags":["tag1","tag2"],"size":"Effectif","city":"Ville","website":"https://...","notes":"Résumé court"}`,
            candidate: `{"name":"Prénom Nom","role":"Titre","location":"Ville","years_experience":5,"tech":"...","skills":["skill1","skill2"],"linkedin":"https://linkedin.com/in/...","sector":"automobile","phone":"...","email":"...","notes":"Résumé court"}`
        };

        const contexts = {
            prospect: `un PROSPECT (= un manager / responsable / décideur chez un client potentiel) pour une ESN spécialisée en systèmes embarqués, électronique et ingénierie autour de Lyon`,
            company: `une ENTREPRISE cliente/cible pour une ESN spécialisée en systèmes embarqués, électronique et ingénierie autour de Lyon`,
            candidate: `un CANDIDAT (= ingénieur / consultant potentiel à recruter) pour une ESN spécialisée en systèmes embarqués, électronique et ingénierie`
        };

        const contextBlock = (context && context.length > 0)
            ? `\n══════ INFORMATIONS DONT JE DISPOSE (utilise-les pour remplir la fiche) ══════\n${context}\n\n`
            : '';

        return `Tu es un assistant de prospection B2B spécialisé en ingénierie (systèmes embarqués, électronique, robotique, logiciel).

Je dois créer la fiche de ${contexts[type]} dans mon CRM.
${contextBlock ? contextBlock + 'Remplis la fiche à partir de ces informations. Si c\'est un lien LinkedIn ou un profil, extrais nom, fonction, entreprise, etc.' : 'Recherche toutes les informations disponibles sur cette personne/entité à partir des documents, liens ou informations que je te fournis.'}

══════ TAGS TECHNIQUES STANDARDS ══════
AUTOSAR, C/C++, RTOS, Linux embarqué, FPGA, VHDL, Verilog, Python, Java, C#, .NET, ARM, Microcontrôleur, PCB, Altium, KiCad, Yocto, QNX, FreeRTOS, VxWorks, CAN, LIN, Ethernet, TCP/IP, SPI, I2C, UART, JTAG, Modbus, ISO 26262, DO-178, IEC 61508, ADAS, Lidar, Radar, Vision, IA/ML, ROS, Matlab/Simulink, LabVIEW, Banc de test, Qualification, Validation, Electronique analogique, Electronique numérique, Puissance, RF, Mécatronique, CAO mécanique, Catia, SolidWorks, Gestion de projet, Agilité, V-cycle

══════ FORMAT DE SORTIE (JSON strict) ══════
Réponds UNIQUEMENT par un objet JSON valide, sans aucun texte avant ou après, sans \`\`\` ni markdown.
Utilise exactement les clés de l'exemple. Pour un prospect : name, fonction, entreprise, telephone, email, linkedin, tags, metier, pertinence, secteur, notes. Limite "tags" à 12 éléments max.
Exemple (une seule ligne si possible) :

${jsonFormats[type]}`;
    }

    function _buildMultiPrompt(type, context) {
        const jsonFormats = {
            prospect: `[
  { "name": "...", "fonction": "...", "entreprise": "...", "telephone": "...", "email": "...", "linkedin": "...", "tags": [...], "metier": "...", "pertinence": "1-5", "notes": "..." },
  ...
]`,
            company: `[
  { "groupe": "...", "site": "...", "phone": "...", "industry": "...", "tags": [...], "size": "...", "notes": "..." },
  ...
]`,
            candidate: `[
  { "name": "...", "role": "...", "location": "...", "years_experience": 5, "skills": [...], "linkedin": "...", "sector": "...", "notes": "..." },
  ...
]`
        };

        const contexts = {
            prospect: `des PROSPECTS (managers / responsables / décideurs)`,
            company: `des ENTREPRISES clientes/cibles`,
            candidate: `des CANDIDATS (ingénieurs / consultants)`
        };

        const contextBlock = (context && context.length > 0)
            ? `\n══════ INFORMATIONS DONT JE DISPOSE (extrais les fiches à partir de cela) ══════\n${context}\n\n`
            : '';

        return `Tu es un assistant de prospection B2B spécialisé en ingénierie (systèmes embarqués, électronique, robotique, logiciel).

Je dois créer les fiches de ${contexts[type]} dans mon CRM pour une ESN spécialisée en systèmes embarqués, électronique et ingénierie autour de Lyon.
${contextBlock ? contextBlock + 'Extrais toutes les fiches possibles à partir de ces informations.' : 'À partir des documents, liens ou informations que je te fournis, extrais toutes les fiches possibles.'}

══════ TAGS TECHNIQUES STANDARDS ══════
AUTOSAR, C/C++, RTOS, Linux embarqué, FPGA, VHDL, Verilog, Python, Java, C#, ARM, Microcontrôleur, PCB, Altium, KiCad, Yocto, QNX, FreeRTOS, VxWorks, CAN, LIN, Ethernet, TCP/IP, SPI, I2C, UART, ISO 26262, DO-178, ADAS, Lidar, Radar, Vision, IA/ML, ROS, Matlab/Simulink, LabVIEW, Banc de test, Validation, Electronique analogique, Electronique numérique, Puissance, RF, Mécatronique, CAO mécanique, Catia, SolidWorks, Gestion de projet, Agilité, V-cycle

══════ FORMAT DE SORTIE (JSON array strict) ══════
Réponds UNIQUEMENT par un array JSON valide, sans aucun texte avant ou après, sans \`\`\` ni markdown.
Limite les tableaux "tags" / "skills" à 12 éléments par fiche pour éviter la troncature.
Exemple : ${jsonFormats[type]}`;
    }

    // ─── Auto-open candidate modal if ?add=1 on sourcing page ───
    if (window.location.pathname === '/sourcing' && new URLSearchParams(window.location.search).get('add') === '1') {
        document.addEventListener('DOMContentLoaded', function () {
            setTimeout(function () {
                if (typeof openCandidateModal === 'function') openCandidateModal(false);
            }, 600);
        });
    }

    // ─── Auto-open Quick Add with type/context from URL (e.g. from page Candidats > Scanner dossier) ───
    document.addEventListener('DOMContentLoaded', function () {
        const params = new URLSearchParams(window.location.search);
        if (params.get('openQuickAdd') !== '1') return;
        const type = (params.get('type') || '').toLowerCase();
        const context = params.get('context') || '';
        if (!type || !document.getElementById('modalQuickAdd')) return;
        setTimeout(function () {
            openQuickAddModal();
            if (type === 'prospect' || type === 'company' || type === 'candidate') qaPickType(type);
            var ctxEl = document.getElementById('qaContextInput');
            if (ctxEl && context) ctxEl.value = context;
        }, 500);
    });
})();
