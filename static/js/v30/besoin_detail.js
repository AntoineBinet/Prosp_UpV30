// ProspUp v30 — Fiche Traitement Besoin (détail)
(function () {
  'use strict';

  const root = document.querySelector('[data-v30-besoin-detail]');
  if (!root) return;
  const ID = parseInt(root.dataset.besoinId, 10);
  if (!ID || isNaN(ID)) return;

  const STATUT_LABELS = {
    ouvert:     { label: 'Ouvert',     cls: 'v30-besoin-pill--open' },
    en_cours:   { label: 'En cours',   cls: 'v30-besoin-pill--inprogress' },
    pourvu:     { label: 'Pourvu',     cls: 'v30-besoin-pill--done' },
    abandonne:  { label: 'Abandonné',  cls: 'v30-besoin-pill--cancel' },
  };

  const CAND_KEYS = ['candidat', 'commentaires', 'dispo', 'appel', 'dt', 'rdv1', 'rdv2', 'note', 'envoi_dt', 'rt'];

  const state = {
    besoin: null,
    dirty: false,
    saveTimer: null,
  };

  // Picker entreprise pour le champ Client
  let _detailPicker = null;
  // Index du candidat en cours de liaison (-1 = mode ajout)
  let _linkCandIdx = null;

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function fmtDate(s) {
    if (!s) return '—';
    try {
      const d = new Date(s);
      if (isNaN(d.getTime())) return s;
      return d.toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (_e) { return s; }
  }

  async function fetchJSON(url, opts) {
    const r = await fetch(url, opts || {});
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  // ─── SheetJS ────────────────────────────────────────────────
  function ensureXLSX() {
    if (typeof window.XLSX !== 'undefined') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/static/js/xlsx.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Impossible de charger xlsx.min.js'));
      document.head.appendChild(s);
    });
  }

  // ─── Parsing Excel traitement besoin ────────────────────────
  function parseXlsxBesoin(file) {
    return new Promise((resolve, reject) => {
      ensureXLSX().then(() => {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const wb = window.XLSX.read(new Uint8Array(e.target.result), {
              type: 'array',
              dateNF: 'yyyy-mm-dd',
            });

            let sheetName = wb.SheetNames[0];
            if (wb.SheetNames.indexOf('recto verso') >= 0) sheetName = 'recto verso';
            else if (wb.SheetNames.indexOf('recto') >= 0) sheetName = 'recto';
            const ws = wb.Sheets[sheetName];
            if (!ws) { reject(new Error('Feuille introuvable')); return; }

            function cellText(ref) {
              const c = ws[ref];
              if (!c) return '';
              const v = c.w !== undefined ? c.w : (c.v !== undefined ? String(c.v) : '');
              return String(v).trim();
            }

            const a5 = cellText('A5').toLowerCase();
            const isVerso = a5.indexOf('comp') >= 0;

            const besoin = {
              client:        cellText('B1'),
              localisation:  cellText('H1'),
              contact:       cellText('B2'),
              date_appel:    cellText('I2'),
              intitule:      cellText('B3'),
              date_besoin:   cellText('D3'),
              duree_mission: cellText('H3'),
              candidats: [],
            };

            const COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

            if (isVerso) {
              besoin.descriptif    = cellText('B4');
              besoin.competences   = cellText('B5');
              besoin.connaissances = cellText('B6');
              besoin.experience    = cellText('B7');
              besoin.profil_type   = cellText('I7');
              besoin.commentaires  = cellText('B8');

              for (const [start, end] of [[10, 30], [32, 62]]) {
                for (let r = start; r <= end; r++) {
                  const cand = {};
                  let hasData = false;
                  for (let ci = 0; ci < 10; ci++) {
                    const v = cellText(COLS[ci] + r);
                    cand[CAND_KEYS[ci]] = v;
                    if (v) hasData = true;
                  }
                  if (hasData) besoin.candidats.push(cand);
                }
              }
            } else {
              const combined = cellText('B4');
              const lines = combined.split('\n');
              const descriptifLines = [];
              besoin.competences = '';
              besoin.connaissances = '';
              besoin.experience = '';
              besoin.profil_type = '';
              besoin.commentaires = '';

              for (const line of lines) {
                if (line.startsWith('Compétences requises : ')) {
                  besoin.competences = line.slice('Compétences requises : '.length);
                } else if (line.startsWith('Connaissances attendues : ')) {
                  besoin.connaissances = line.slice('Connaissances attendues : '.length);
                } else if (line.startsWith('Expérience : ')) {
                  besoin.experience = line.slice('Expérience : '.length);
                } else if (line.startsWith('Profil : ')) {
                  besoin.profil_type = line.slice('Profil : '.length);
                } else if (line.startsWith('Commentaires : ')) {
                  besoin.commentaires = line.slice('Commentaires : '.length);
                } else {
                  descriptifLines.push(line);
                }
              }
              besoin.descriptif = descriptifLines.join('\n').trim();

              for (let r = 6; r <= 58; r++) {
                const cand = {};
                let hasData = false;
                for (let ci = 0; ci < 10; ci++) {
                  const v = cellText(COLS[ci] + r);
                  cand[CAND_KEYS[ci]] = v;
                  if (v) hasData = true;
                }
                if (hasData) besoin.candidats.push(cand);
              }
            }

            resolve(besoin);
          } catch (err) {
            reject(err);
          }
        };
        reader.onerror = () => reject(new Error('Lecture du fichier impossible'));
        reader.readAsArrayBuffer(file);
      }).catch(reject);
    });
  }

  // ─── Application des données Excel à la fiche ────────────────
  async function importFromXlsx(file) {
    const besoin = await parseXlsxBesoin(file);

    // Champs texte simples (hors client géré par le picker)
    const fieldMap = {
      intitule: 'intitule', contact: 'contact', localisation: 'localisation',
      date_appel: 'date_appel', date_besoin: 'date_besoin',
      duree_mission: 'duree_mission', profil_type: 'profil_type',
      descriptif: 'descriptif', competences: 'competences',
      connaissances: 'connaissances', experience: 'experience',
      commentaires: 'commentaires',
    };
    for (const [srcKey, fieldKey] of Object.entries(fieldMap)) {
      if (besoin[srcKey] === undefined) continue;
      const el = root.querySelector('[data-v30-besoin-field="' + fieldKey + '"]');
      if (el) el.value = besoin[srcKey] || '';
    }

    // Client : via CompanyPicker si possible
    if (besoin.client) {
      if (_detailPicker) {
        try {
          const data = await fetchJSON('/api/companies/list');
          const companies = data.companies || [];
          const normalize = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
          const q = normalize(besoin.client);
          const match = companies.find(c => normalize(c.groupe) === q || normalize(c.groupe).startsWith(q));
          if (match) {
            _detailPicker.setSelection({ id: match.id, groupe: match.groupe, site: match.site || '' });
            state.besoin.company_id = match.id;
            state.besoin.client = match.groupe;
          } else {
            _detailPicker.input.value = besoin.client;
            state.besoin.company_id = null;
            state.besoin.client = besoin.client;
            if (typeof window.showToast === 'function') {
              window.showToast(
                `Entreprise « ${besoin.client} » non trouvée — sélectionnez-en une ou créez-la.`,
                'info', 4500
              );
            }
          }
        } catch (_e) {
          const el = root.querySelector('[data-v30-besoin-field="client"]');
          if (el) el.value = besoin.client;
          state.besoin.client = besoin.client;
        }
      } else {
        const el = root.querySelector('[data-v30-besoin-field="client"]');
        if (el) el.value = besoin.client;
        state.besoin.client = besoin.client;
      }
    }

    // Candidats : remplacer (ou étendre) la liste
    if (besoin.candidats && besoin.candidats.length) {
      state.besoin.candidats = besoin.candidats;
      renderCands();
    }

    markDirty();
  }

  // ─── Chargement / rendu ────────────────────────────────────────
  async function load() {
    try {
      const data = await fetchJSON('/api/besoins/' + ID);
      if (!data || !data.ok) throw new Error((data && data.error) || 'Erreur de chargement');
      state.besoin = data.besoin || {};
      hydrate();
    } catch (err) {
      if (typeof window.showToast === 'function') window.showToast('Erreur : ' + err.message, 'error', 3000);
    }
  }

  function autoResize(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.max(el.scrollHeight, 56) + 'px';
  }

  function updateMeta() {
    const b = state.besoin || {};
    const meta = root.querySelector('[data-field="meta"]');
    if (!meta) return;
    const parts = [];
    if (b.client) parts.push(escapeHtml(b.client));
    if (b.contact) parts.push(escapeHtml(b.contact));
    if (b.localisation) parts.push(escapeHtml(b.localisation));
    meta.innerHTML = parts.length ? parts.join(' · ') : '<span class="muted">Pas encore de méta</span>';
  }

  function hydrate() {
    const b = state.besoin || {};

    // Champs simples (hors 'client' — géré séparément via CompanyPicker)
    [
      'intitule', 'contact', 'localisation',
      'date_appel', 'date_besoin', 'duree_mission',
      'profil_type', 'descriptif', 'competences',
      'connaissances', 'experience', 'commentaires',
      'statut',
    ].forEach(k => {
      const el = root.querySelector('[data-v30-besoin-field="' + k + '"]');
      if (el) el.value = b[k] || '';
    });

    // Champ client via CompanyPicker
    // Nom autoritaire : company_name (JOIN) si company_id positionné, sinon client libre
    const clientGroupe = (b.company_id && b.company_name) ? b.company_name : (b.client || '');
    if (clientGroupe !== b.client) state.besoin.client = clientGroupe; // sync silencieux
    const clientInput = root.querySelector('[data-v30-besoin-field="client"]');
    if (clientInput && window.CompanyPicker) {
      if (!_detailPicker) {
        _detailPicker = window.CompanyPicker.attachToInput(clientInput, {
          currentId:     b.company_id || null,
          currentGroupe: clientGroupe,
          onSelect: (co) => {
            state.besoin.company_id = co.id;
            state.besoin.client = co.groupe;
            updateMeta();
            markDirty();
          },
          onClear: () => {
            state.besoin.company_id = null;
            state.besoin.client = '';
            updateMeta();
          },
        });
      } else {
        if (b.company_id) {
          _detailPicker.setSelection({ id: b.company_id, groupe: clientGroupe, site: '' });
        } else {
          _detailPicker.clear();
          if (clientGroupe) clientInput.value = clientGroupe;
        }
      }
    } else if (clientInput) {
      clientInput.value = clientGroupe;
    }

    // Display title
    const titleEl = root.querySelector('[data-field="intitule-display"]');
    if (titleEl) titleEl.textContent = (b.intitule || '').trim() || '(sans intitulé)';

    // Statut pill
    const pill = root.querySelector('[data-field="statut-pill"]');
    if (pill) {
      const stat = STATUT_LABELS[b.statut] || { label: b.statut || '—', cls: '' };
      pill.className = 'v30-besoin-detail__statut-pill v30-besoin-pill ' + stat.cls;
      pill.textContent = stat.label;
    }

    updateMeta();

    // Created / updated
    const ca = root.querySelector('[data-field="created-at"]');
    if (ca) ca.textContent = fmtDate(b.created_at);
    const ua = root.querySelector('[data-field="updated-at"]');
    if (ua) ua.textContent = fmtDate(b.updated_at);

    // Auto-resize textareas
    root.querySelectorAll('[data-v30-besoin-field]').forEach(el => {
      if (el.tagName === 'TEXTAREA') autoResize(el);
    });

    renderLink();
    renderCands();
  }

  function renderLink() {
    const b = state.besoin || {};
    const banner = root.querySelector('[data-v30-besoin-link]');
    const aside = root.querySelector('[data-v30-besoin-link-aside]');

    if (b.prospect_id && b.prospect_name) {
      if (banner) {
        banner.hidden = false;
        const a = banner.querySelector('[data-field="link-prospect-href"]');
        if (a) {
          a.href = '/v30/prospect/' + b.prospect_id;
          a.textContent = b.prospect_name;
        }
      }
      if (aside) {
        aside.innerHTML =
          '<p style="font-size:13px;margin:0 0 8px;">' +
          '<a href="/v30/prospect/' + b.prospect_id + '">' + escapeHtml(b.prospect_name) + '</a></p>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-v30-besoin-unlink>✕ Délier</button>';
      }
    } else {
      if (banner) banner.hidden = true;
      if (aside) {
        aside.innerHTML =
          '<p class="muted" style="font-size:12px;margin:0 0 8px;">Aucun prospect lié.</p>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-v30-besoin-link-pick>↗ Lier un prospect</button>';
      }
    }
  }

  function buildCandRow(c, idx) {
    const tr = document.createElement('tr');
    tr.dataset.candIdx = String(idx);
    CAND_KEYS.forEach(k => {
      const td = document.createElement('td');
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'v30-besoin-cand-input';
      inp.value = (c && c[k]) || '';
      inp.dataset.candField = k;
      inp.addEventListener('input', () => {
        c[k] = inp.value;
        markDirty();
      });
      td.appendChild(inp);
      tr.appendChild(td);
    });
    const tdAct = document.createElement('td');
    tdAct.className = 'v30-besoin-cand-actions';

    // Bouton fiche candidat : lien si cand_id connu, sinon bouton "lier"
    if (c && c.cand_id) {
      const link = document.createElement('a');
      link.href = '/v30/candidat/' + c.cand_id;
      link.target = '_blank';
      link.className = 'btn btn-ghost btn-sm btn-icon';
      link.title = 'Ouvrir la fiche candidat';
      link.textContent = '↗';
      tdAct.appendChild(link);
    } else {
      const linkBtn = document.createElement('button');
      linkBtn.type = 'button';
      linkBtn.className = 'btn btn-ghost btn-sm btn-icon';
      linkBtn.title = 'Lier à une fiche candidat';
      linkBtn.textContent = '⟳';
      linkBtn.style.opacity = '0.45';
      linkBtn.addEventListener('click', () => {
        _linkCandIdx = parseInt(tr.dataset.candIdx, 10);
        openCandModal();
      });
      tdAct.appendChild(linkBtn);
    }

    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'btn btn-ghost btn-sm btn-icon';
    rm.title = 'Supprimer la ligne';
    rm.textContent = '×';
    rm.addEventListener('click', () => {
      const cands = (state.besoin.candidats || []);
      const i = parseInt(tr.dataset.candIdx, 10);
      if (i >= 0 && i < cands.length) {
        cands.splice(i, 1);
        renderCands();
        markDirty();
      }
    });
    tdAct.appendChild(rm);
    tr.appendChild(tdAct);
    return tr;
  }

  function renderCands() {
    const tbody = root.querySelector('[data-v30-besoin-cand-body]');
    if (!tbody) return;
    if (!Array.isArray(state.besoin.candidats)) state.besoin.candidats = [];
    tbody.innerHTML = '';
    state.besoin.candidats.forEach((c, idx) => {
      tbody.appendChild(buildCandRow(c, idx));
    });
    if (!state.besoin.candidats.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="11" class="muted" style="padding:16px;text-align:center;">' +
        'Aucun candidat. Clique sur « Ajouter une ligne ».</td>';
      tbody.appendChild(tr);
    }
  }

  function addCand() {
    if (!Array.isArray(state.besoin.candidats)) state.besoin.candidats = [];
    state.besoin.candidats.push({});
    renderCands();
    markDirty();
    const tbody = root.querySelector('[data-v30-besoin-cand-body]');
    if (tbody) {
      const last = tbody.querySelector('tr:last-child input');
      if (last) last.focus();
    }
  }

  // ─── Save ────────────────────────────────────────────────
  function markDirty() {
    state.dirty = true;
    if (state.saveTimer) clearTimeout(state.saveTimer);
    const savedEl = root.querySelector('[data-v30-besoin-saved]');
    if (savedEl) savedEl.textContent = 'Modifié…';
    state.saveTimer = setTimeout(saveAuto, 1200);
  }

  function collectPayload() {
    const b = state.besoin || {};
    const payload = {};
    [
      'intitule', 'contact', 'localisation',
      'date_appel', 'date_besoin', 'duree_mission',
      'profil_type', 'descriptif', 'competences',
      'connaissances', 'experience', 'commentaires',
      'statut',
    ].forEach(k => {
      const el = root.querySelector('[data-v30-besoin-field="' + k + '"]');
      payload[k] = el ? el.value : (b[k] || '');
    });

    // Champ client : depuis le picker ou directement depuis l'input
    if (_detailPicker) {
      const sel = _detailPicker.getSelection();
      payload.client = sel ? sel.groupe : (b.client || '');
      payload.company_id = sel ? sel.id : (b.company_id || null);
    } else {
      const clientEl = root.querySelector('[data-v30-besoin-field="client"]');
      payload.client = clientEl ? clientEl.value : (b.client || '');
      payload.company_id = b.company_id || null;
    }

    payload.candidats = b.candidats || [];
    return payload;
  }

  async function saveAuto() {
    if (!state.dirty) return;
    const savedEl = root.querySelector('[data-v30-besoin-saved]');
    try {
      if (savedEl) savedEl.textContent = 'Enregistrement…';
      const payload = collectPayload();
      const data = await fetchJSON('/api/besoins/' + ID, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (data && data.ok) {
        state.besoin = data.besoin || state.besoin;
        state.dirty = false;
        const titleEl = root.querySelector('[data-field="intitule-display"]');
        if (titleEl) titleEl.textContent = (state.besoin.intitule || '').trim() || '(sans intitulé)';
        const pill = root.querySelector('[data-field="statut-pill"]');
        if (pill) {
          const stat = STATUT_LABELS[state.besoin.statut] || { label: state.besoin.statut || '—', cls: '' };
          pill.className = 'v30-besoin-detail__statut-pill v30-besoin-pill ' + stat.cls;
          pill.textContent = stat.label;
        }
        const ua = root.querySelector('[data-field="updated-at"]');
        if (ua) ua.textContent = fmtDate(state.besoin.updated_at);
        updateMeta();
        if (savedEl) savedEl.textContent = '✓ Enregistré';
        setTimeout(() => { if (savedEl && !state.dirty) savedEl.textContent = ''; }, 1800);
      }
    } catch (err) {
      if (savedEl) savedEl.textContent = '⚠ ' + err.message;
    }
  }

  // ─── Export Excel ────────────────────────────────────────
  function exportXlsx(format) {
    const url = '/api/besoins/' + ID + '/export.xlsx?format=' + encodeURIComponent(format || 'both');
    if (state.dirty) {
      saveAuto().then(() => { window.location.href = url; });
    } else {
      window.location.href = url;
    }
  }

  // ─── Suppression ─────────────────────────────────────────
  async function doDelete() {
    if (!confirm('Supprimer définitivement ce besoin ?')) return;
    try {
      const data = await fetchJSON('/api/besoins/' + ID, { method: 'DELETE' });
      if (data && data.ok) {
        window.location.href = '/v30/besoins';
      } else {
        throw new Error((data && data.error) || 'Erreur');
      }
    } catch (err) {
      if (typeof window.showToast === 'function') window.showToast('Erreur : ' + err.message, 'error', 3000);
      else alert('Erreur : ' + err.message);
    }
  }

  // ─── Recherche candidat ──────────────────────────────────
  function openCandModal() {
    const md = document.querySelector('[data-v30-cand-modal]');
    if (!md) return;
    md.hidden = false;
    md.classList.add('is-open');
    const inp = document.getElementById('v30-cand-search-input');
    if (inp) { inp.value = ''; setTimeout(() => inp.focus(), 50); }
    renderCandResults([]);
  }

  function closeCandModal() {
    _linkCandIdx = null;
    const md = document.querySelector('[data-v30-cand-modal]');
    if (!md) return;
    md.classList.remove('is-open');
    setTimeout(() => { md.hidden = true; }, 160);
  }

  function renderCandResults(items) {
    const host = document.querySelector('[data-v30-cand-results]');
    if (!host) return;
    if (!items || !items.length) {
      host.innerHTML = '<p class="muted" style="margin:8px 0;font-size:12px;">Aucun résultat.</p>';
      return;
    }
    host.innerHTML = items.map(c => {
      const sub = [c.role, c.location].filter(Boolean).join(' · ');
      return `<button type="button" class="v30-besoin-link__row" data-cid="${c.id}" data-cname="${escapeHtml(c.name || '')}">
        <strong>${escapeHtml(c.name || '')}</strong>
        ${sub ? '<span class="muted">' + escapeHtml(sub) + '</span>' : ''}
      </button>`;
    }).join('');
  }

  let _candTimer = null;
  function bindCandModal() {
    const inp = document.getElementById('v30-cand-search-input');
    if (inp) {
      inp.addEventListener('input', () => {
        const q = inp.value.trim();
        if (_candTimer) clearTimeout(_candTimer);
        if (q.length < 2) { renderCandResults([]); return; }
        _candTimer = setTimeout(async () => {
          try {
            const data = await fetchJSON('/api/search?' + new URLSearchParams({ q, limit: '20' }));
            renderCandResults((data && data.candidates) || []);
          } catch (_e) { renderCandResults([]); }
        }, 200);
      });
    }
    const host = document.querySelector('[data-v30-cand-results]');
    if (host) {
      host.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-cid]');
        if (!btn) return;
        const name = btn.dataset.cname || '';
        const cid  = parseInt(btn.dataset.cid, 10) || null;
        if (!Array.isArray(state.besoin.candidats)) state.besoin.candidats = [];

        if (_linkCandIdx !== null) {
          // Mode liaison : mettre à jour la ligne existante
          const cand = state.besoin.candidats[_linkCandIdx];
          if (cand) { cand.candidat = name; cand.cand_id = cid; }
          if (typeof window.showToast === 'function') window.showToast('Fiche liée', 'success', 1800);
        } else {
          // Mode ajout
          state.besoin.candidats.push({ candidat: name, cand_id: cid });
          if (typeof window.showToast === 'function') window.showToast('Candidat ajouté', 'success', 1800);
        }

        renderCands();
        markDirty();
        closeCandModal();
        const tbody = root.querySelector('[data-v30-besoin-cand-body]');
        if (tbody) {
          const last = tbody.querySelector('tr:last-child input');
          if (last) last.focus();
        }
      });
    }
    document.querySelectorAll('[data-v30-cand-close]').forEach(b => b.addEventListener('click', closeCandModal));
    const md = document.querySelector('[data-v30-cand-modal]');
    if (md) {
      md.addEventListener('click', (e) => { if (e.target === md) closeCandModal(); });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !md.hidden) closeCandModal();
      });
    }
  }

  // ─── Liaison prospect ────────────────────────────────────
  function openLinkModal() {
    const md = document.querySelector('[data-v30-link-modal]');
    if (!md) return;
    md.hidden = false;
    md.classList.add('is-open');
    const search = document.getElementById('v30-link-search');
    if (search) {
      search.value = '';
      setTimeout(() => search.focus(), 50);
    }
    renderLinkResults([]);
  }
  function closeLinkModal() {
    const md = document.querySelector('[data-v30-link-modal]');
    if (!md) return;
    md.classList.remove('is-open');
    setTimeout(() => { md.hidden = true; }, 160);
  }

  function renderLinkResults(items) {
    const host = document.querySelector('[data-v30-link-results]');
    if (!host) return;
    if (!items || !items.length) {
      host.innerHTML = '<p class="muted" style="margin:8px 0;font-size:12px;">Aucun résultat.</p>';
      return;
    }
    host.innerHTML = items.map(p => {
      return `<button type="button" class="v30-besoin-link__row" data-pid="${p.id}">
        <strong>${escapeHtml(p.name || '')}</strong>
        <span class="muted">${escapeHtml(p.company_name || '')}</span>
      </button>`;
    }).join('');
  }

  let _searchTimer = null;
  function bindLinkModal() {
    const search = document.getElementById('v30-link-search');
    if (search) {
      search.addEventListener('input', () => {
        const q = search.value.trim();
        if (_searchTimer) clearTimeout(_searchTimer);
        if (q.length < 2) { renderLinkResults([]); return; }
        _searchTimer = setTimeout(async () => {
          try {
            const params = new URLSearchParams({ q: q, limit: '20' });
            const data = await fetchJSON('/api/search?' + params.toString());
            const items = (data && data.items) ? data.items : (data && data.prospects) || [];
            const norm = items.map(p => ({
              id: p.id,
              name: p.name || p.full_name || '',
              company_name: p.company_name || p.company_groupe ||
                            (p.company && p.company.groupe) || '',
            })).filter(p => p.id);
            renderLinkResults(norm);
          } catch (_e) {
            renderLinkResults([]);
          }
        }, 200);
      });
    }
    const host = document.querySelector('[data-v30-link-results]');
    if (host) {
      host.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-pid]');
        if (!btn) return;
        const pid = parseInt(btn.dataset.pid, 10);
        if (!pid) return;
        try {
          const data = await fetchJSON('/api/besoins/' + ID, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prospect_id: pid }),
          });
          if (data && data.ok) {
            state.besoin = data.besoin || state.besoin;
            hydrate();
            closeLinkModal();
            if (typeof window.showToast === 'function') window.showToast('Prospect lié', 'success', 2000);
          }
        } catch (err) {
          if (typeof window.showToast === 'function') window.showToast('Erreur : ' + err.message, 'error', 3000);
        }
      });
    }
    document.querySelectorAll('[data-v30-link-close]').forEach(b => b.addEventListener('click', closeLinkModal));
    const md = document.querySelector('[data-v30-link-modal]');
    if (md) md.addEventListener('click', (e) => { if (e.target === md) closeLinkModal(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && md && !md.hidden) closeLinkModal();
    });
  }

  async function unlink() {
    try {
      const data = await fetchJSON('/api/besoins/' + ID, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospect_id: null, company_id: null }),
      });
      if (data && data.ok) {
        state.besoin = data.besoin;
        if (_detailPicker) _detailPicker.clear();
        renderLink();
      }
    } catch (err) {
      if (typeof window.showToast === 'function') window.showToast('Erreur : ' + err.message, 'error', 3000);
    }
  }

  // ─── Bind ────────────────────────────────────────────────
  function bindFields() {
    const inputs = root.querySelectorAll('[data-v30-besoin-field]');
    inputs.forEach(el => {
      el.addEventListener('input', markDirty);
      el.addEventListener('change', markDirty);
      if (el.tagName === 'TEXTAREA') {
        el.addEventListener('input', () => autoResize(el));
      }
    });
  }

  function bindActions() {
    document.querySelectorAll('[data-v30-besoin-export]').forEach(b => {
      b.addEventListener('click', () => exportXlsx(b.dataset.v30BesoinExport));
    });
    const del = document.querySelector('[data-v30-besoin-delete]');
    if (del) del.addEventListener('click', doDelete);
    const save = document.querySelector('[data-v30-besoin-save]');
    if (save) save.addEventListener('click', () => { state.dirty = true; saveAuto(); });
    const addBtn = document.querySelector('[data-v30-besoin-cand-add]');
    if (addBtn) addBtn.addEventListener('click', addCand);
    const candSearchBtn = document.querySelector('[data-v30-besoin-cand-search]');
    if (candSearchBtn) candSearchBtn.addEventListener('click', openCandModal);

    // Import Excel
    const xlsxInput = document.querySelector('[data-v30-besoin-import-xlsx]');
    if (xlsxInput) {
      xlsxInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
          await importFromXlsx(file);
          if (typeof window.showToast === 'function') {
            window.showToast('Données importées depuis Excel', 'success', 2500);
          }
        } catch (err) {
          if (typeof window.showToast === 'function') {
            window.showToast('Erreur import Excel : ' + err.message, 'error', 3500);
          }
        }
        xlsxInput.value = '';
      });
    }

    // Link delegation (boutons regenerés via innerHTML)
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-v30-besoin-link-pick]')) openLinkModal();
      if (e.target.closest('[data-v30-besoin-unlink]')) unlink();
    });
  }

  function init() {
    bindFields();
    bindActions();
    bindLinkModal();
    bindCandModal();
    load();

    // Ctrl+S = save
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        state.dirty = true;
        saveAuto();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
