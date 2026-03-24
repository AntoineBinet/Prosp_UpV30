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
        // Afficher l'étape 0 (choix méthode) et masquer les autres
        const step0 = document.getElementById('qaStep0');
        if (step0) step0.style.display = '';
        document.getElementById('qaStep1').style.display = 'none';
        const stepFile = document.getElementById('qaStepFile');
        if (stepFile) stepFile.style.display = 'none';
        document.getElementById('qaStep3Paste').style.display = 'none';
        document.getElementById('qaStep4Preview').style.display = 'none';
        const stepContacts = document.getElementById('qaStepContacts');
        if (stepContacts) stepContacts.style.display = 'none';
        document.querySelectorAll('.qa-card').forEach(c => c.classList.remove('active'));
        const qaFileInput = document.getElementById('qaFileInput');
        if (qaFileInput) { qaFileInput.value = ''; }
        const qaFileChosen = document.getElementById('qaFileChosen');
        if (qaFileChosen) { qaFileChosen.style.display = 'none'; qaFileChosen.textContent = ''; }
        // Mettre à jour les labels des boutons IA avec le modèle configuré
        if (typeof window.updateAIButtonLabels === 'function') {
            window.updateAIButtonLabels();
        }
        if (window.openModal) {
            window.openModal(m);
        } else {
            m.classList.add('active');
        }
    };

    window.closeQuickAddModal = function () {
        const m = document.getElementById('modalQuickAdd');
        if (m) {
            if (window.closeModal) {
                window.closeModal(m);
            } else {
                m.classList.remove('active');
            }
        }
    };

    // ─── Step 0: pick method (manual or IA or file or VSA) ───
    window.qaPickMethod = function (method) {
        if (method === 'manual') {
            closeQuickAddModal();
            if (typeof openAddModal === 'function') {
                openAddModal();
            }
            return;
        }
        if (method === 'vsa') {
            closeQuickAddModal();
            // Ouvrir la modale VSA (fonction globale depuis page-sourcing.js)
            // TOUT SE PASSE CÔTÉ CLIENT - aucune fenêtre ne s'ouvre sur le serveur
            if (typeof window.openVsaImportModal === 'function') {
                window.openVsaImportModal();
            } else {
                // Si page-sourcing.js n'est pas encore chargé, attendre un peu
                setTimeout(() => {
                    if (typeof window.openVsaImportModal === 'function') {
                        window.openVsaImportModal();
                    } else {
                        showToast('Fonction VSA non disponible. Rechargez la page.', 'warning');
                    }
                }, 500);
            }
            return;
        }
        const step0 = document.getElementById('qaStep0');
        if (step0) step0.style.display = 'none';
        if (method === 'contacts') {
            document.getElementById('qaStep1').style.display = 'none';
            const sf2 = document.getElementById('qaStepFile');
            if (sf2) sf2.style.display = 'none';
            const sc = document.getElementById('qaStepContacts');
            if (sc) {
                // reset sub-steps
                document.getElementById('qaContactsFileZone').style.display = '';
                document.getElementById('qaContactsMapping').style.display = 'none';
                document.getElementById('qaContactsPreview').style.display = 'none';
                const fi = document.getElementById('qaContactsFileInput');
                if (fi) fi.value = '';
                const fc = document.getElementById('qaContactsFileChosen');
                if (fc) { fc.style.display = 'none'; fc.textContent = ''; }
                sc.style.display = '';
            }
            return;
        }
        if (method === 'file') {
            document.getElementById('qaStep1').style.display = 'none';
            const stepFile = document.getElementById('qaStepFile');
            if (stepFile) stepFile.style.display = '';
            _qaType = 'prospect';
            document.querySelectorAll('#qaStepFile .qa-card').forEach(c => {
                c.classList.toggle('active', c.dataset.type === 'prospect');
            });
            return;
        }
        const sf = document.getElementById('qaStepFile');
        if (sf) sf.style.display = 'none';
        document.getElementById('qaStep1').style.display = '';
    };

    window.qaBackFromFileToStep0 = function () {
        const stepFile = document.getElementById('qaStepFile');
        if (stepFile) stepFile.style.display = 'none';
        const step0 = document.getElementById('qaStep0');
        if (step0) step0.style.display = '';
        _qaType = '';
        const qaFileInput = document.getElementById('qaFileInput');
        if (qaFileInput) qaFileInput.value = '';
        const qaFileChosen = document.getElementById('qaFileChosen');
        if (qaFileChosen) { qaFileChosen.style.display = 'none'; qaFileChosen.textContent = ''; }
        document.querySelectorAll('.qa-card').forEach(c => c.classList.remove('active'));
    };

    // ─── File import: Excel/CSV (client) or PDF/Word (API) ───
    function _guessFieldProspect(h) {
        const x = (h || '').toLowerCase();
        if (/prénom|prenom|firstname/.test(x)) return 'prenom';
        if (/(^nom$|^name$|contact)/.test(x) && !/société|company|entreprise|groupe/.test(x)) return 'name';
        if (/entreprise|société|company|groupe/.test(x)) return '_company_name';
        if (/site|ville|city|filiale/.test(x)) return 'site';
        if (/fonction|poste|role|titre/.test(x)) return 'fonction';
        if (/tél|tel|telephone|phone|mobile|portable/.test(x)) return 'telephone';
        if (/mail|email/.test(x)) return 'email';
        if (/linkedin/.test(x)) return 'linkedin';
        if (/note|commentaire/.test(x)) return 'notes';
        if (/tag|compétence/.test(x)) return 'tags';
        if (/pertinence|score/.test(x)) return 'pertinence';
        return '';
    }
    function _guessFieldCompany(h) {
        const x = (h || '').toLowerCase();
        if (/nom|name|groupe|société|company|entreprise/.test(x)) return 'groupe';
        if (/site|ville|city|adresse|filiale/.test(x)) return 'site';
        if (/tél|tel|telephone|phone/.test(x)) return 'phone';
        if (/secteur|industry/.test(x)) return 'industry';
        if (/tag/.test(x)) return 'tags';
        if (/note|commentaire/.test(x)) return 'notes';
        return '';
    }
    function _guessFieldCandidate(h) {
        const x = (h || '').toLowerCase();
        if (/nom|name|contact/.test(x) && !/company|entreprise/.test(x)) return 'name';
        if (/rôle|role|poste|titre|position/.test(x)) return 'role';
        if (/localisation|location|ville|city/.test(x)) return 'location';
        if (/linkedin/.test(x)) return 'linkedin';
        if (/tél|tel|telephone|phone/.test(x)) return 'phone';
        if (/mail|email/.test(x)) return 'email';
        if (/compétence|skill|techno|tech/.test(x)) return 'skills';
        if (/secteur/.test(x)) return 'sector';
        if (/note|commentaire/.test(x)) return 'notes';
        return '';
    }

    function _parseCsvQuickAdd(text) {
        const lines = text.split(/\r?\n/).filter(function(l) { return l.trim(); });
        if (!lines.length) return null;
        let sep = ';';
        if (lines[0].includes('\t') && (lines[0].match(/\t/g) || []).length >= (lines[0].match(/[;,]/g) || []).length) sep = '\t';
        else if ((lines[0].match(/,/g) || []).length > (lines[0].match(/;/g) || []).length) sep = ',';
        function parseLine(line) {
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
        const headers = parseLine(lines[0]);
        const rows = [];
        for (let i = 1; i < lines.length; i++) {
            const cells = parseLine(lines[i]);
            if (cells.some(function(c) { return c; })) rows.push(cells);
        }
        return { headers: headers, rows: rows };
    }

    function _spreadsheetToItems(raw, entityType) {
        const guess = entityType === 'company' ? _guessFieldCompany : (entityType === 'candidate' ? _guessFieldCandidate : _guessFieldProspect);
        const colToField = {};
        raw.headers.forEach(function(h, i) {
            const f = guess(h);
            if (f && !colToField[i]) colToField[i] = f;
        });
        const items = [];
        raw.rows.forEach(function(row) {
            const item = {};
            Object.keys(colToField).forEach(function(colIdx) {
                const field = colToField[colIdx];
                const val = (row[parseInt(colIdx, 10)] != null ? row[parseInt(colIdx, 10)] : '').toString().trim();
                if (!val) return;
                if (field === 'tags' || field === 'skills') {
                    item[field] = val.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
                } else if (field === 'prenom') {
                    item.prenom = val;
                } else {
                    item[field] = val;
                }
            });
            if (entityType === 'prospect' && (item.prenom || item.name)) {
                item.name = (item.prenom || '') + ' ' + (item.name || '').trim();
                delete item.prenom;
            }
            if (Object.keys(item).length > 0) items.push(item);
        });
        return items;
    }

    function _qaOverlayShow(opts) {
        const overlay = document.getElementById('qaOllamaOverlay');
        if (!overlay) return;
        const titleEl = document.getElementById('qaOllamaOverlayTitle');
        const detailEl = document.getElementById('qaOllamaOverlayDetail');
        const phaseEl = document.getElementById('qaOllamaLivePhase');
        const liveEl = document.getElementById('qaOllamaLiveText');
        if (titleEl && opts.title !== undefined) titleEl.textContent = opts.title;
        if (detailEl && opts.detail !== undefined) detailEl.textContent = opts.detail;
        if (phaseEl && opts.phase !== undefined) { phaseEl.textContent = opts.phase; phaseEl.style.display = opts.phase ? '' : 'none'; }
        if (liveEl) {
            if (opts.liveText !== undefined) { liveEl.textContent = opts.liveText; liveEl.style.display = opts.liveText ? 'block' : 'none'; }
        }
        overlay.style.display = 'flex';
    }
    function _qaOverlayHide() {
        const overlay = document.getElementById('qaOllamaOverlay');
        if (overlay) overlay.style.display = 'none';
        const phaseEl = document.getElementById('qaOllamaLivePhase');
        const liveEl = document.getElementById('qaOllamaLiveText');
        if (phaseEl) { phaseEl.textContent = ''; phaseEl.style.display = 'none'; }
        if (liveEl) { liveEl.textContent = ''; liveEl.style.display = 'none'; }
    }

    function _onQaFileSelected(file) {
        if (!file || !_qaType) return;
        const name = file.name || '';
        const ext = name.indexOf('.') >= 0 ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
        const qaFileChosen = document.getElementById('qaFileChosen');
        if (qaFileChosen) { qaFileChosen.textContent = 'Fichier : ' + name; qaFileChosen.style.display = ''; }

        if (ext === '.pdf' || ext === '.doc' || ext === '.docx') {
            _qaOverlayShow({
                title: 'Traitement du document',
                detail: 'Le fichier est envoyé au serveur. Extraction puis analyse par l\'IA. Ne fermez pas.',
                phase: 'Envoi du fichier…'
            });
            const fd = new FormData();
            fd.append('file', file);
            fd.append('entity_type', _qaType);
            fetch('/api/quickadd/parse-document-stream', { method: 'POST', body: fd })
                .then(function(res) {
                    if (!res.ok || !res.body) {
                        return res.text().then(function(t) { throw new Error(t || res.statusText); });
                    }
                    return res.body.getReader();
                })
                .then(function(reader) {
                    const decoder = new TextDecoder();
                    let buffer = '';
                    let liveText = '';
                    const maxLiveLen = 400;
                    var event = '';
                    function readChunk() {
                        return reader.read().then(function(result) {
                            if (result.done) return;
                            buffer += decoder.decode(result.value, { stream: true });
                            var lines = buffer.split('\n');
                            buffer = lines.pop() || '';
                            for (var i = 0; i < lines.length; i++) {
                                var line = lines[i];
                                if (line === '') {
                                    event = '';
                                    continue;
                                }
                                if (line.indexOf('event: ') === 0) event = line.slice(7).trim();
                                else if (line.indexOf('data: ') === 0) {
                                    var dataStr = line.slice(6);
                                    try {
                                        var data = JSON.parse(dataStr);
                                        if (event === 'phase') {
                                            _qaOverlayShow({ phase: data.label || data.step || '' });
                                        } else if (event === 'token' && data.text) {
                                            liveText += data.text;
                                            if (liveText.length > maxLiveLen) liveText = liveText.slice(-maxLiveLen);
                                            var el = document.getElementById('qaOllamaLiveText');
                                            if (el) { el.textContent = liveText; el.style.display = 'block'; el.scrollTop = el.scrollHeight; }
                                        } else if (event === 'done') {
                                            _qaOverlayHide();
                                            var items = data.items;
                                            if (data.entity_type) _qaType = data.entity_type;
                                            if (items && items.length > 0) {
                                                _qaParsed = items;
                                                var sfel = document.getElementById('qaStepFile');
                                                if (sfel) sfel.style.display = 'none';
                                                var prevEl = document.getElementById('qaStep4Preview');
                                                if (prevEl) prevEl.style.display = '';
                                                _renderPreview(_qaParsed);
                                                showToast('Vérifiez les données puis cliquez Créer.', 'success', 4000);
                                            } else {
                                                showToast('Aucune donnée extraite.', 'warning', 5000);
                                            }
                                        } else if (event === 'error') {
                                            _qaOverlayHide();
                                            showToast(data.message || 'Erreur', 'error', 6000);
                                        }
                                    } catch (err) { }
                                }
                            }
                            return readChunk();
                        });
                    }
                    return readChunk();
                })
                .then(function() {})
                .catch(function(err) {
                    _qaOverlayHide();
                    var msg = (err && err.message) || 'Erreur réseau ou serveur. L\'IA peut être indisponible ou le modèle trop lent : essayez Excel/CSV ou un modèle plus léger.';
                    showToast(msg, 'error', 6000);
                });
            return;
        }

        if (ext === '.csv' || ext === '.xlsx' || ext === '.xls') {
            const reader = new FileReader();
            reader.onload = function(e) {
                let raw = null;
                if (ext === '.csv') {
                    const text = (e.target.result || '').toString();
                    raw = _parseCsvQuickAdd(text);
                } else {
                    if (typeof XLSX === 'undefined') { showToast('Bibliothèque Excel non chargée.', 'error'); return; }
                    try {
                        const wb = XLSX.read(e.target.result, { type: 'array' });
                        const sheetName = (wb.SheetNames && wb.SheetNames[0]) || '';
                        if (!sheetName) { showToast('Fichier Excel sans feuille.', 'warning'); return; }
                        const sh = wb.Sheets[sheetName];
                        const data = XLSX.utils.sheet_to_json(sh, { header: 1, defval: '' });
                        if (!data.length) { showToast('Feuille vide.', 'warning'); return; }
                        const headers = data[0].map(function(h) { return String(h || '').trim(); });
                        const rows = data.slice(1).filter(function(row) { return row.some(function(c) { return String(c || '').trim(); }); }).map(function(row) {
                            const r = [];
                            for (let i = 0; i < headers.length; i++) r.push(String(row[i] != null ? row[i] : '').trim());
                            return r;
                        });
                        raw = { headers: headers, rows: rows };
                    } catch (err) {
                        showToast('Fichier Excel illisible.', 'error');
                        return;
                    }
                }
                if (!raw || !raw.rows.length) { showToast('Aucune ligne de données.', 'warning'); return; }
                const items = _spreadsheetToItems(raw, _qaType);
                if (!items.length) { showToast('Aucune donnée reconnue. Vérifiez les en-têtes.', 'warning'); return; }
                _qaParsed = items;
                const sfel = document.getElementById('qaStepFile');
                if (sfel) sfel.style.display = 'none';
                const prevEl = document.getElementById('qaStep4Preview');
                if (prevEl) prevEl.style.display = '';
                _renderPreview(_qaParsed);
                showToast(items.length + ' élément(s) détecté(s). Vérifiez puis cliquez Créer.', 'success', 4000);
            };
            if (ext === '.csv') {
                reader.readAsText(file, 'UTF-8');
            } else {
                reader.readAsArrayBuffer(file);
            }
            return;
        }
        showToast('Format non supporté. Utilisez .xlsx, .csv, .pdf, .doc ou .docx', 'warning');
    }

    (function initQaFileInput() {
        const input = document.getElementById('qaFileInput');
        if (input) input.addEventListener('change', function(e) {
            const f = e.target.files && e.target.files[0];
            if (f) _onQaFileSelected(f);
            e.target.value = '';
        });
    })();

    // ─── Step 1: pick type (also used in file step) ───
    window.qaPickType = function (type) {
        _qaType = type;
        const stepFile = document.getElementById('qaStepFile');
        if (stepFile && stepFile.style.display !== 'none') {
            stepFile.querySelectorAll('.qa-card').forEach(c => c.classList.toggle('active', c.dataset.type === type));
        } else {
            document.querySelectorAll('.qa-card').forEach(c => c.classList.remove('active'));
            document.querySelector(`.qa-card[data-type="${type}"]`)?.classList.add('active');
        }
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
        showToast('Prompt copié. Collez-le dans votre IA, puis collez le retour ci-dessous.', 'info', 5000);
    };

    window.qaStartMultiple = function () {
        if (!_qaType) { showToast('⚠️ Sélectionnez un type d\'abord', 'warning'); return; }
        _qaMode = 'multiple';
        _copyPrompt(_qaType, true);
        document.getElementById('qaStep1').style.display = 'none';
        document.getElementById('qaStep3Paste').style.display = '';
        document.getElementById('qaPasteTextarea').value = '';
        document.getElementById('qaPasteTextarea').focus();
        showToast('Prompt copié. Collez-le dans votre IA, puis collez le retour ci-dessous.', 'info', 5000);
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
        if (typeof window.callOllama !== 'function') { showToast('IA non disponible', 'error'); return; }
        _qaOverlayShow({
            title: 'Génération en cours…',
            detail: 'Cela peut prendre plusieurs minutes. Ne fermez pas la fenêtre.',
            phase: '',
            liveText: ''
        });
        // Activer la recherche web si le contexte contient un lien LinkedIn ou une URL
        const hasLinkedInUrl = context && /linkedin\.com\/in\/|linkedin\.com\/company\//i.test(context);
        const hasUrl = context && /https?:\/\//i.test(context);
        const useWebSearch = hasLinkedInUrl || hasUrl;
        // Désactiver le streaming pour tous les appels (proxy/tunnel peut mal gérer le streaming SSE → erreur 405)
        const opts = multiple 
            ? { timeoutMs: 300000, stream: false, webSearch: useWebSearch } 
            : { timeoutMs: 180000, stream: false, webSearch: useWebSearch };
        window.callOllama(prompt, opts).then(function (text) {
            _qaOverlayHide();
            // Debug : afficher le retour brut de l'IA dans la console et dans un panneau debug
            console.log('[Quick Add IA] Retour brut de l\'IA:', text);
            _showIADebugPanel(text, prompt);
            
            const result = _tryParseQARaw(text || '', _qaType);
            if (result.ok) {
                _qaParsed = result.parsed;
                // Nettoyer les données parsées (corriger email/LinkedIn)
                _qaParsed = _qaParsed.map(function(item) {
                    return _cleanParsedItem(item);
                });
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
            _qaOverlayHide();
            const msg = (err && err.message) === 'Timeout' ? 'Génération trop longue. Utilisez « Copier » puis collez le retour manuellement.' : 'IA indisponible. Utilisez « Copier » puis collez le retour manuellement.';
            showToast(msg, 'warning', 6000);
        });
    };

    window.qaBackToStep0 = function () {
        document.getElementById('qaStep1').style.display = 'none';
        const stepFile = document.getElementById('qaStepFile');
        if (stepFile) stepFile.style.display = 'none';
        document.getElementById('qaStep3Paste').style.display = 'none';
        document.getElementById('qaStep4Preview').style.display = 'none';
        const step0 = document.getElementById('qaStep0');
        if (step0) step0.style.display = '';
        _qaType = '';
        _qaMode = '';
        _qaParsed = null;
        document.querySelectorAll('.qa-card').forEach(c => c.classList.remove('active'));
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
        
        // Normaliser la pertinence : forcer entre 1 et 5, sinon vide
        parsed = parsed.map(function(item) {
            if (item && typeof item === 'object' && item.pertinence !== undefined) {
                const pert = item.pertinence;
                if (typeof pert === 'string' || typeof pert === 'number') {
                    const n = parseInt(pert);
                    item.pertinence = (n >= 1 && n <= 5) ? String(n) : '';
                } else {
                    item.pertinence = '';
                }
            }
            return item;
        });
        
        // Nettoyer les données (corriger email/LinkedIn)
        parsed = parsed.map(function(item) {
            return _cleanParsedItem(item);
        });
        
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
            // Forcer la pertinence entre 1 et 5, sinon vide
            obj[field] = (n >= 1 && n <= 5) ? String(n) : '';
        } else if (field.startsWith('_')) {
            // Append to notes
            obj.notes = (obj.notes || '') + '\n' + rawKey + ': ' + val;
        } else {
            obj[field] = val;
        }
    }

    // ─── Nettoyer les données parsées (corriger erreurs courantes) ───
    function _cleanParsedItem(item) {
        if (!item || typeof item !== 'object') return item;
        const cleaned = Object.assign({}, item);
        
        // Corriger email qui contient une URL LinkedIn
        if (cleaned.email) {
            const email = String(cleaned.email).trim();
            // Si c'est une URL LinkedIn (même tronquée), vider le champ email
            if (/linkedin\.com|https?:\/\/.*linkedin/i.test(email) || /^https?:\/\//.test(email)) {
                console.warn('[Quick Add] Email contient une URL LinkedIn, champ vidé:', email);
                cleaned.email = '';
            }
            // Si c'est un email valide mais contient des caractères bizarres, nettoyer
            else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                // Si ça ressemble à une URL ou contient des caractères encodés, vider
                if (/https?:\/\/|%[0-9A-Fa-f]{2}/.test(email)) {
                    console.warn('[Quick Add] Email invalide (URL ou encodé), champ vidé:', email);
                    cleaned.email = '';
                }
            }
        }
        
        // Corriger LinkedIn qui est tronqué ou mal formaté
        if (cleaned.linkedin) {
            const linkedin = String(cleaned.linkedin).trim();
            // Si c'est une URL LinkedIn valide mais tronquée, essayer de la compléter
            if (/linkedin\.com\/in\/[^\/]+$/.test(linkedin) && !linkedin.endsWith('/')) {
                // URL valide mais peut-être tronquée, garder tel quel
            }
            // Si c'est une URL encodée ou malformée, nettoyer
            else if (/linkedin\.com\/in\/.*%/.test(linkedin)) {
                // Décoder l'URL
                try {
                    cleaned.linkedin = decodeURIComponent(linkedin);
                } catch (e) {
                    // Si le décodage échoue, garder tel quel
                }
            }
            // Si ce n'est pas une URL LinkedIn valide, vider
            else if (!/^https?:\/\/.*linkedin\.com\/in\/[^\/\s]+/.test(linkedin)) {
                if (linkedin && !linkedin.startsWith('http')) {
                    // Peut-être juste l'identifiant, construire l'URL
                    const id = linkedin.replace(/[^a-zA-Z0-9-]/g, '');
                    if (id.length > 3) {
                        cleaned.linkedin = 'https://www.linkedin.com/in/' + id;
                    } else {
                        cleaned.linkedin = '';
                    }
                } else {
                    cleaned.linkedin = '';
                }
            }
        }
        
        return cleaned;
    }

    // ─── Panneau de debug pour voir le retour brut de l'IA ───
    function _showIADebugPanel(rawText, prompt) {
        // Créer ou récupérer le panneau debug
        let panel = document.getElementById('qaIADebugPanel');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'qaIADebugPanel';
            panel.style.cssText = 'position:fixed;bottom:20px;right:20px;width:500px;max-height:400px;background:var(--color-surface);border:2px solid var(--color-primary);border-radius:8px;padding:12px;z-index:10000;box-shadow:0 4px 12px rgba(0,0,0,0.3);overflow:auto;font-size:11px;font-family:monospace;';
            panel.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <strong style="color:var(--color-primary);">🔍 Debug IA — Retour brut</strong>
                    <button onclick="document.getElementById('qaIADebugPanel').style.display='none'" style="background:none;border:none;color:var(--color-text);cursor:pointer;font-size:16px;padding:0 8px;">×</button>
                </div>
                <div style="margin-bottom:8px;">
                    <button onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'" style="font-size:10px;padding:4px 8px;background:var(--color-bg-secondary);border:1px solid var(--color-border);border-radius:4px;cursor:pointer;">📋 Voir le prompt</button>
                    <pre id="qaDebugPrompt" style="display:none;background:var(--color-bg-secondary);padding:8px;border-radius:4px;margin-top:4px;white-space:pre-wrap;word-wrap:break-word;max-height:150px;overflow:auto;font-size:10px;">${(prompt || '').substring(0, 1000)}${(prompt || '').length > 1000 ? '...' : ''}</pre>
                </div>
                <div style="margin-bottom:8px;">
                    <strong style="color:var(--color-text-secondary);font-size:10px;">Retour brut (${(rawText || '').length} caractères):</strong>
                    <pre id="qaDebugRawText" style="background:var(--color-bg-secondary);padding:8px;border-radius:4px;margin-top:4px;white-space:pre-wrap;word-wrap:break-word;max-height:200px;overflow:auto;font-size:10px;border:1px solid var(--color-border);">${_escDebugText(rawText || '')}</pre>
                </div>
                <div style="font-size:10px;color:var(--color-muted);">
                    💡 Ce panneau montre le retour brut de l'IA avant parsing. Vérifiez si l'IA a bien extrait les données.
                </div>
            `;
            document.body.appendChild(panel);
        } else {
            // Mettre à jour le contenu
            const rawEl = document.getElementById('qaDebugRawText');
            const promptEl = document.getElementById('qaDebugPrompt');
            if (rawEl) rawEl.textContent = rawText || '';
            if (promptEl) promptEl.textContent = (prompt || '').substring(0, 1000) + ((prompt || '').length > 1000 ? '...' : '');
            panel.style.display = 'block';
        }
    }

    function _escDebugText(text) {
        return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
                    // Forcer la pertinence entre 1 et 5, sinon vide
                    item[field] = (n >= 1 && n <= 5) ? String(n) : '';
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

        // Extraire le nom de l'URL LinkedIn si présent
        let extractedName = '';
        let extractedCompany = '';
        if (context) {
            const linkedinMatch = context.match(/linkedin\.com\/in\/([^\/\s\?]+)/i);
            if (linkedinMatch) {
                // Convertir "stephane-dalliet" en "Stéphane Dalliet" (approximation)
                const slug = linkedinMatch[1];
                extractedName = slug.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
            }
            // Chercher une entreprise mentionnée dans le contexte
            const companyMatch = context.match(/(?:chez|at|@|entreprise|company)\s+([A-Z][a-zA-Z\s&-]+)/i);
            if (companyMatch) {
                extractedCompany = companyMatch[1].trim();
            }
        }

        const contextBlock = (context && context.length > 0)
            ? `\n══════ INFORMATIONS DONT JE DISPOSE (utilise-les pour remplir la fiche) ══════\n${context}\n\n`
            : '';

        const isLinkedInUrl = context && /linkedin\.com\/in\/|linkedin\.com\/company\//i.test(context);
        let extractionInstructions = '';
        
        if (isLinkedInUrl) {
            // Extraire le nom et l'entreprise du lien LinkedIn pour améliorer la recherche
            const linkedinMatch = context.match(/linkedin\.com\/in\/([^\/\s]+)/i);
            const profileId = linkedinMatch ? linkedinMatch[1] : '';
            
            // Construire une recherche optimisée
            const searchTerms = [];
            if (extractedName) searchTerms.push(`"${extractedName}"`);
            if (extractedCompany) searchTerms.push(`"${extractedCompany}"`);
            const searchQuery = searchTerms.length > 0 ? searchTerms.join(' ') : 'profil LinkedIn';
            
            extractionInstructions = `IMPORTANT : Le contexte contient un lien LinkedIn (${context}).

⚠️ LinkedIn bloque souvent l'accès direct aux profils via API. Utilise ces stratégies :

1. **Recherche web par nom + entreprise** : 
   ${extractedName ? `- Nom extrait de l'URL : "${extractedName}"` : '- Nom à extraire de l\'URL LinkedIn'}
   ${extractedCompany ? `- Entreprise mentionnée : "${extractedCompany}"` : ''}
   - Cherche sur le web : "${searchQuery} LinkedIn" ou "${extractedName || 'nom'} ${extractedCompany || 'entreprise'} LinkedIn" pour trouver des informations publiques (articles, sites d'entreprise, communiqués de presse, etc.).

2. **Recherche alternative** : Si le contexte contient du texte copié-collé de la page LinkedIn, utilise directement ces informations (nom, poste, entreprise, localisation).

3. **Extraction depuis le lien** : ${extractedName ? `Le nom "${extractedName}" a été extrait de l'URL.` : 'Extrais le nom de l\'URL LinkedIn (ex: "linkedin.com/in/stephane-dalliet" → "Stéphane Dalliet").'} Utilise cette information pour ta recherche web.

4. **Informations à extraire** : Nom complet, titre du poste actuel, entreprise actuelle, localisation, description/résumé, expériences professionnelles. NE PAS INVENTER d'informations qui ne sont pas trouvées. Si une information n'est pas visible (ex: téléphone, email), utilise "" (chaîne vide).

5. **Si aucune info trouvée** : Retourne au moins le nom ${extractedName ? `"${extractedName}"` : '(déduit de l\'URL si possible)'} et l'URL LinkedIn complète "${context.match(/https?:\/\/[^\s]+/)?.[0] || context}", avec les autres champs vides plutôt que d'inventer.`;
        } else if (contextBlock) {
            extractionInstructions = 'Remplis la fiche à partir de ces informations. Extrais uniquement les données réellement présentes. Ne pas inventer d\'informations manquantes.';
        } else {
            extractionInstructions = 'Recherche toutes les informations disponibles sur cette personne/entité à partir des documents, liens ou informations que je te fournis. Extrais uniquement les données réellement trouvées.';
        }

        return `Tu es un assistant de prospection B2B spécialisé en ingénierie (systèmes embarqués, électronique, robotique, logiciel).

Je dois créer la fiche de ${contexts[type]} dans mon CRM.
${contextBlock}${extractionInstructions}

══════ TAGS TECHNIQUES STANDARDS ══════
AUTOSAR, C/C++, RTOS, Linux embarqué, FPGA, VHDL, Verilog, Python, Java, C#, .NET, ARM, Microcontrôleur, PCB, Altium, KiCad, Yocto, QNX, FreeRTOS, VxWorks, CAN, LIN, Ethernet, TCP/IP, SPI, I2C, UART, JTAG, Modbus, ISO 26262, DO-178, IEC 61508, ADAS, Lidar, Radar, Vision, IA/ML, ROS, Matlab/Simulink, LabVIEW, Banc de test, Qualification, Validation, Electronique analogique, Electronique numérique, Puissance, RF, Mécatronique, CAO mécanique, Catia, SolidWorks, Gestion de projet, Agilité, V-cycle

══════ PERTINENCE (OBLIGATOIRE : 1 à 5) ══════
Le champ "pertinence" DOIT être une chaîne de caractères : "1", "2", "3", "4" ou "5" (jamais autre chose).
- 5 = Décideur direct qui recrute des ingénieurs dans nos domaines (systèmes embarqués, électronique, robotique)
- 4 = Manager/responsable avec influence sur les recrutements dans nos domaines
- 3 = Contact dans une entreprise pertinente, rôle moins direct mais domaine aligné
- 2 = Contact dans une entreprise pertinente mais rôle peu lié à nos métiers
- 1 = Peu de lien avec nos domaines d'expertise
Si tu ne peux pas évaluer à partir des informations disponibles, utilise "" (chaîne vide).

══════ FORMAT DE SORTIE (JSON strict) ══════
Réponds UNIQUEMENT par un objet JSON valide, sans aucun texte avant ou après, sans \`\`\` ni markdown.
Utilise exactement les clés de l'exemple. Pour un prospect : name, fonction, entreprise, telephone, email, linkedin, tags, metier, pertinence, secteur, notes. Limite "tags" à 12 éléments max. IMPORTANT : "pertinence" doit être "1", "2", "3", "4" ou "5" (chaîne de caractères), jamais autre chose.

⚠️ RÈGLES IMPORTANTES :
- N'invente JAMAIS d'informations qui ne sont pas visibles dans le contexte fourni
- Si une information n'est pas disponible (téléphone, email, etc.), utilise "" (chaîne vide) au lieu d'inventer
- Pour les tags, utilise uniquement ceux qui correspondent réellement au profil (domaines techniques mentionnés)
- Le champ "linkedin" doit être l'URL complète du profil si fournie dans le contexte (ex: "https://www.linkedin.com/in/nom-profil/")
- Le champ "email" DOIT être une adresse email valide (format: nom@domaine.com). JAMAIS d'URL LinkedIn dans le champ email. Si l'email n'est pas visible, utilise "" (chaîne vide)
- Le champ "entreprise" doit être le nom exact de l'entreprise visible sur le profil
- Le champ "fonction" doit être le titre exact du poste actuel visible sur le profil
- Le champ "pertinence" DOIT être un nombre entre 1 et 5 (chaîne de caractères : "1", "2", "3", "4" ou "5"). 5 = décideur direct qui recrute dans nos domaines, 1 = peu de lien. Si tu ne peux pas évaluer, utilise "" (chaîne vide). JAMAIS de valeur hors de cette plage.

Exemple (une seule ligne si possible) :

${jsonFormats[type]}`;
    }

    function _buildMultiPrompt(type, context) {
        const jsonFormats = {
            prospect: `[
  { "name": "...", "fonction": "...", "entreprise": "...", "telephone": "...", "email": "...", "linkedin": "...", "tags": [...], "metier": "...", "pertinence": "5", "notes": "..." },
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

        const hasLinkedInUrls = context && /linkedin\.com\/in\/|linkedin\.com\/company\//i.test(context);
        let extractionInstructions = '';
        
        if (hasLinkedInUrls) {
            extractionInstructions = `IMPORTANT : Le contexte contient des liens LinkedIn.

⚠️ LinkedIn bloque souvent l'accès direct aux profils via API. Utilise ces stratégies :

1. **Recherche par nom + entreprise** : Pour chaque lien "linkedin.com/in/nom-profil", cherche sur le web "nom-profil LinkedIn [nom entreprise]" pour trouver des informations publiques.

2. **Recherche alternative** : Cherche les noms + entreprises sur le web (sites d'entreprise, articles, etc.) pour trouver des informations publiques.

3. **Extraction depuis les liens** : Les noms peuvent être déduits des URLs LinkedIn. Utilise ces informations pour ta recherche.

4. **Si aucune info trouvée** : Retourne au moins les noms (déduits des URLs si possible) et les URLs LinkedIn complètes, avec les autres champs vides plutôt que d'inventer.`;
        } else if (contextBlock) {
            extractionInstructions = 'Extrais toutes les fiches possibles à partir de ces informations. Utilise uniquement les données réellement présentes.';
        } else {
            extractionInstructions = 'À partir des documents, liens ou informations que je te fournis, extrais toutes les fiches possibles. Utilise uniquement les données réellement trouvées.';
        }

        return `Tu es un assistant de prospection B2B spécialisé en ingénierie (systèmes embarqués, électronique, robotique, logiciel).

Je dois créer les fiches de ${contexts[type]} dans mon CRM pour une ESN spécialisée en systèmes embarqués, électronique et ingénierie autour de Lyon.
${contextBlock}${extractionInstructions}

══════ TAGS TECHNIQUES STANDARDS ══════
AUTOSAR, C/C++, RTOS, Linux embarqué, FPGA, VHDL, Verilog, Python, Java, C#, ARM, Microcontrôleur, PCB, Altium, KiCad, Yocto, QNX, FreeRTOS, VxWorks, CAN, LIN, Ethernet, TCP/IP, SPI, I2C, UART, ISO 26262, DO-178, ADAS, Lidar, Radar, Vision, IA/ML, ROS, Matlab/Simulink, LabVIEW, Banc de test, Validation, Electronique analogique, Electronique numérique, Puissance, RF, Mécatronique, CAO mécanique, Catia, SolidWorks, Gestion de projet, Agilité, V-cycle

══════ PERTINENCE (OBLIGATOIRE : 1 à 5) ══════
Le champ "pertinence" DOIT être une chaîne de caractères : "1", "2", "3", "4" ou "5" (jamais autre chose).
- 5 = Décideur direct qui recrute des ingénieurs dans nos domaines (systèmes embarqués, électronique, robotique)
- 4 = Manager/responsable avec influence sur les recrutements dans nos domaines
- 3 = Contact dans une entreprise pertinente, rôle moins direct mais domaine aligné
- 2 = Contact dans une entreprise pertinente mais rôle peu lié à nos métiers
- 1 = Peu de lien avec nos domaines d'expertise
Si tu ne peux pas évaluer à partir des informations disponibles, utilise "" (chaîne vide).

══════ FORMAT DE SORTIE (JSON array strict) ══════
Réponds UNIQUEMENT par un array JSON valide, sans aucun texte avant ou après, sans \`\`\` ni markdown.
Limite les tableaux "tags" / "skills" à 12 éléments par fiche pour éviter la troncature.
IMPORTANT : "pertinence" doit être "1", "2", "3", "4" ou "5" (chaîne de caractères) pour chaque prospect, jamais autre chose.

⚠️ RÈGLES IMPORTANTES :
- N'invente JAMAIS d'informations qui ne sont pas visibles dans le contexte fourni
- Si une information n'est pas disponible, utilise "" (chaîne vide) au lieu d'inventer
- Pour les tags, utilise uniquement ceux qui correspondent réellement aux profils
- Les champs "linkedin" doivent être les URLs complètes des profils si fournies (ex: "https://www.linkedin.com/in/nom-profil/")
- Les champs "email" DOIVENT être des adresses email valides (format: nom@domaine.com). JAMAIS d'URL LinkedIn dans les champs email. Si l'email n'est pas visible, utilise "" (chaîne vide)
- Les champs "entreprise" doivent être les noms exacts des entreprises visibles
- Les champs "fonction" doivent être les titres exacts des postes actuels visibles
- Les champs "pertinence" DOIVENT être des nombres entre 1 et 5 (chaînes : "1", "2", "3", "4" ou "5"). 5 = décideur direct qui recrute dans nos domaines, 1 = peu de lien. Si tu ne peux pas évaluer, utilise "" (chaîne vide). JAMAIS de valeur hors de cette plage.

Exemple : ${jsonFormats[type]}`;
    }

    // ─── Contacts Import: enrich tel/email from Excel without duplicates ───
    let _contactsRaw = null;   // {headers, rows}
    let _contactsMatches = []; // [{rowIdx, prospectId, name, company, currentTel, currentEmail, newTel, newEmail}]

    /** Normalize a string for comparison: lowercase, no accents, collapse spaces */
    function _normStr(s) {
        s = (s || '').toLowerCase().trim();
        try {
            s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        } catch (e) { /* ignore */ }
        return s.replace(/\s+/g, ' ');
    }

    /** Return true if normStr(a) equals normStr(b) */
    function _namesMatch(a, b) {
        if (!a || !b) return false;
        const na = _normStr(a), nb = _normStr(b);
        if (na === nb) return true;
        // Also try reversing word order (Prénom Nom vs Nom Prénom)
        const partsA = na.split(' '), partsB = nb.split(' ');
        if (partsA.length === 2 && partsB.length === 2) {
            return (partsA[0] === partsB[1] && partsA[1] === partsB[0]);
        }
        return false;
    }

    /** Setup file input listener for contacts */
    document.addEventListener('DOMContentLoaded', function () {
        const fi = document.getElementById('qaContactsFileInput');
        if (!fi) return;
        fi.addEventListener('change', function () {
            const file = fi.files[0];
            if (!file) return;
            const fc = document.getElementById('qaContactsFileChosen');
            if (fc) { fc.textContent = file.name; fc.style.display = ''; }
            const reader = new FileReader();
            reader.onload = function (e) {
                try {
                    const wb = XLSX.read(e.target.result, { type: 'array' });
                    const ws = wb.Sheets[wb.SheetNames[0]];
                    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
                    if (!rows.length) { showToast('Fichier vide ou illisible', 'error'); return; }
                    _contactsRaw = { headers: rows[0].map(String), rows: rows.slice(1) };
                    _qaContactsBuildMapping();
                } catch (err) {
                    showToast('Impossible de lire le fichier Excel : ' + err.message, 'error');
                }
            };
            reader.readAsArrayBuffer(file);
        });
    });

    /** Build column mapping selectors */
    function _qaContactsBuildMapping() {
        const headers = _contactsRaw.headers;
        const grid = document.getElementById('qaContactsMappingGrid');
        if (!grid) return;

        // Auto-detect columns
        function detectCol(keywords) {
            const idx = headers.findIndex(h => {
                const hn = _normStr(h);
                return keywords.some(k => hn.includes(k));
            });
            return idx >= 0 ? idx : '';
        }
        const defaultNom = detectCol(['nom', 'name', 'contact', 'prenom', 'prénom']);
        const defaultTel = detectCol(['tel', 'téléphone', 'telephone', 'phone', 'portable', 'mobile']);
        const defaultEmail = detectCol(['email', 'mail', 'courriel', 'e-mail']);

        function buildSelect(id, label, defaultIdx) {
            const opts = ['<option value="">— Ne pas utiliser —</option>',
                ...headers.map((h, i) => `<option value="${i}"${i === defaultIdx ? ' selected' : ''}>${escapeHtml(h) || 'Colonne ' + (i + 1)}</option>`)
            ].join('');
            return `<div><label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px;">${label}</label>
                <select id="${id}" style="font-size:12px;padding:5px 8px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-surface);color:var(--color-text);width:100%;">${opts}</select></div>`;
        }

        grid.innerHTML = buildSelect('qaContactsColNom', 'Nom complet', defaultNom) +
            buildSelect('qaContactsColTel', 'Téléphone', defaultTel) +
            buildSelect('qaContactsColEmail', 'Email', defaultEmail);

        document.getElementById('qaContactsMapping').style.display = '';
        document.getElementById('qaContactsFileZone').style.display = 'none';
    }

    window.qaContactsBackToFile = function () {
        document.getElementById('qaContactsMapping').style.display = 'none';
        document.getElementById('qaContactsFileZone').style.display = '';
        const fi = document.getElementById('qaContactsFileInput');
        if (fi) fi.value = '';
        const fc = document.getElementById('qaContactsFileChosen');
        if (fc) { fc.style.display = 'none'; fc.textContent = ''; }
        _contactsRaw = null;
    };

    window.qaContactsBackToMapping = function () {
        document.getElementById('qaContactsPreview').style.display = 'none';
        document.getElementById('qaContactsMapping').style.display = '';
    };

    /** Match rows from Excel against existing prospects (using global data object) */
    window.qaContactsAnalyse = function () {
        const colNom = parseInt(document.getElementById('qaContactsColNom').value);
        const colTel = parseInt(document.getElementById('qaContactsColTel').value);
        const colEmail = parseInt(document.getElementById('qaContactsColEmail').value);

        if (isNaN(colNom)) { showToast('Veuillez sélectionner au moins la colonne Nom', 'warning'); return; }
        if (isNaN(colTel) && isNaN(colEmail)) { showToast('Veuillez sélectionner au moins Téléphone ou Email', 'warning'); return; }

        // Use global data.prospects
        const prospects = (typeof data !== 'undefined' && data.prospects) ? data.prospects : [];
        if (!prospects.length) { showToast('Aucun prospect chargé dans l\'application', 'warning'); return; }

        // Build a lookup by normalized name
        const byName = {};
        prospects.forEach(p => {
            const key = _normStr(p.name || '');
            if (key) {
                if (!byName[key]) byName[key] = [];
                byName[key].push(p);
            }
        });

        _contactsMatches = [];
        const unmatched = [];
        const { rows } = _contactsRaw;

        rows.forEach((row, idx) => {
            const nomRaw = String(row[colNom] || '').trim();
            const telRaw = isNaN(colTel) ? '' : String(row[colTel] || '').trim();
            const emailRaw = isNaN(colEmail) ? '' : String(row[colEmail] || '').trim();

            if (!nomRaw) return;  // skip empty rows
            if (!telRaw && !emailRaw) return;  // nothing to enrich

            // Try exact match
            let matched = byName[_normStr(nomRaw)] || null;

            // Try reversed name (Nom Prénom → Prénom Nom)
            if (!matched) {
                const parts = _normStr(nomRaw).split(' ');
                if (parts.length === 2) {
                    const reversed = parts[1] + ' ' + parts[0];
                    matched = byName[reversed] || null;
                }
            }

            if (matched) {
                // If multiple matches, use the first
                matched.forEach(p => {
                    _contactsMatches.push({
                        rowIdx: idx,
                        prospectId: p.id,
                        name: p.name,
                        company: p.groupe || '',
                        currentTel: p.telephone || '',
                        currentEmail: p.email || '',
                        newTel: telRaw,
                        newEmail: emailRaw,
                        selected: true
                    });
                });
            } else {
                unmatched.push(nomRaw);
            }
        });

        _qaContactsRenderPreview(unmatched);
    };

    function _qaContactsRenderPreview(unmatched) {
        const matchCount = document.getElementById('qaContactsMatchCount');
        const totalCount = document.getElementById('qaContactsTotalCount');
        const tableEl = document.getElementById('qaContactsTable');
        const unmatchedEl = document.getElementById('qaContactsUnmatched');

        const totalRows = _contactsRaw.rows.filter((r, i) => {
            const colNom = parseInt(document.getElementById('qaContactsColNom').value);
            return String(r[colNom] || '').trim();
        }).length;

        if (matchCount) matchCount.textContent = _contactsMatches.length;
        if (totalCount) totalCount.textContent = totalRows;

        // Render table
        if (!_contactsMatches.length) {
            tableEl.innerHTML = '<p class="muted" style="font-size:12px;padding:10px 0;">Aucun prospect correspondant trouvé. Vérifiez que les noms dans le fichier correspondent exactement aux noms dans Prosp\'Up.</p>';
        } else {
            let html = '<table style="width:100%;border-collapse:collapse;">';
            html += '<thead><tr style="position:sticky;top:0;background:var(--color-surface-2);font-size:11px;">' +
                '<th style="padding:5px 6px;text-align:left;font-weight:600;">✓</th>' +
                '<th style="padding:5px 6px;text-align:left;font-weight:600;">Prospect</th>' +
                '<th style="padding:5px 6px;text-align:left;font-weight:600;">Téléphone actuel → nouveau</th>' +
                '<th style="padding:5px 6px;text-align:left;font-weight:600;">Email actuel → nouveau</th>' +
                '</tr></thead><tbody>';
            _contactsMatches.forEach((m, i) => {
                const rowBg = i % 2 === 0 ? '' : 'background:var(--color-surface-2);';
                const telChange = m.newTel && m.newTel !== m.currentTel;
                const emailChange = m.newEmail && m.newEmail !== m.currentEmail;
                const telHtml = m.newTel
                    ? (telChange ? `<span style="color:var(--color-muted);text-decoration:line-through;">${escapeHtml(m.currentTel) || '—'}</span> → <span style="color:var(--color-success);">${escapeHtml(m.newTel)}</span>`
                        : `<span style="color:var(--color-muted);">${escapeHtml(m.newTel)} (identique)</span>`)
                    : `<span style="color:var(--color-muted);">—</span>`;
                const emailHtml = m.newEmail
                    ? (emailChange ? `<span style="color:var(--color-muted);text-decoration:line-through;">${escapeHtml(m.currentEmail) || '—'}</span> → <span style="color:var(--color-success);">${escapeHtml(m.newEmail)}</span>`
                        : `<span style="color:var(--color-muted);">${escapeHtml(m.newEmail)} (identique)</span>`)
                    : `<span style="color:var(--color-muted);">—</span>`;
                html += `<tr style="${rowBg}">
                    <td style="padding:5px 6px;"><input type="checkbox" data-ci="${i}" ${m.selected ? 'checked' : ''} onchange="_contactsMatches[${i}].selected=this.checked;_qaContactsUpdateApplyBtn();"></td>
                    <td style="padding:5px 6px;font-weight:500;">${escapeHtml(m.name)}<br><span style="color:var(--color-muted);font-size:10px;">${escapeHtml(m.company)}</span></td>
                    <td style="padding:5px 6px;">${telHtml}</td>
                    <td style="padding:5px 6px;">${emailHtml}</td>
                </tr>`;
            });
            html += '</tbody></table>';
            tableEl.innerHTML = html;
        }

        // Unmatched
        if (unmatched.length) {
            unmatchedEl.innerHTML = `<strong>${unmatched.length} ligne(s) sans correspondance :</strong> ${unmatched.map(n => escapeHtml(n)).join(', ')}`;
            unmatchedEl.style.display = '';
        } else {
            unmatchedEl.style.display = 'none';
        }

        _qaContactsUpdateApplyBtn();
        document.getElementById('qaContactsMapping').style.display = 'none';
        document.getElementById('qaContactsPreview').style.display = '';
    }

    function _qaContactsUpdateApplyBtn() {
        const btn = document.getElementById('qaContactsApplyBtn');
        if (!btn) return;
        const count = _contactsMatches.filter(m => m.selected).length;
        btn.textContent = count > 0 ? `✅ Appliquer (${count} prospect${count > 1 ? 's' : ''})` : '✅ Appliquer les mises à jour';
        btn.disabled = count === 0;
    }

    window.qaContactsApply = async function () {
        const overwrite = document.getElementById('qaContactsOverwrite').checked;
        const selected = _contactsMatches.filter(m => m.selected);
        if (!selected.length) { showToast('Aucun prospect sélectionné', 'warning'); return; }

        const updates = selected.map(m => {
            const item = { id: m.prospectId };
            // Respect overwrite setting
            if (m.newTel && (overwrite || !m.currentTel)) item.telephone = m.newTel;
            if (m.newEmail && (overwrite || !m.currentEmail)) item.email = m.newEmail;
            return item;
        }).filter(item => item.telephone || item.email);

        if (!updates.length) { showToast('Aucune valeur à mettre à jour (tous les champs sont déjà renseignés et "Écraser" est désactivé)', 'info'); return; }

        const btn = document.getElementById('qaContactsApplyBtn');
        if (btn) btn.disabled = true;
        try {
            const res = await fetch('/api/prospects/update-contacts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ updates })
            });
            const json = await res.json();
            if (json.ok) {
                showToast(`${json.updated} prospect(s) mis à jour`, 'success');
                closeQuickAddModal();
                if (typeof loadData === 'function') loadData();
            } else {
                showToast('Erreur : ' + (json.error || 'Inconnue'), 'error');
                if (btn) btn.disabled = false;
            }
        } catch (e) {
            showToast('Erreur réseau : ' + e.message, 'error');
            if (btn) btn.disabled = false;
        }
    };

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
