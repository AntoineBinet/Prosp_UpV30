// ProspUp v30 — Liste Traitement Besoin
(function () {
  'use strict';

  const state = {
    items: [],
    filterStatut: '',
  };

  const STATUT_LABELS = {
    ouvert:     { label: 'Ouvert',     cls: 'v30-besoin-pill--open' },
    en_cours:   { label: 'En cours',   cls: 'v30-besoin-pill--inprogress' },
    pourvu:     { label: 'Pourvu',     cls: 'v30-besoin-pill--done' },
    abandonne:  { label: 'Abandonné',  cls: 'v30-besoin-pill--cancel' },
  };

  // Picker entreprise pour la modale de création
  let _newBesoinPicker = null;
  // Données complètes issues du dernier import Excel (modale création)
  let _xlsxImportData = null;

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
      return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (_e) { return s; }
  }

  async function fetchJSON(url, opts) {
    const r = await fetch(url, opts || {});
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
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
  // Supporte le format recto (B4 = texte combiné) et verso (B4-B8 = champs séparés)
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

            // Priorité : "recto verso" → verso ; "recto" ou première feuille → recto
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

            // Détection format : verso si A5 contient "Comp" (Compétences requises)
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
            const CAND_KEYS = ['candidat', 'commentaires', 'dispo', 'appel', 'dt', 'rdv1', 'rdv2', 'note', 'envoi_dt', 'rt'];

            if (isVerso) {
              besoin.descriptif    = cellText('B4');
              besoin.competences   = cellText('B5');
              besoin.connaissances = cellText('B6');
              besoin.experience    = cellText('B7');
              besoin.profil_type   = cellText('I7');
              besoin.commentaires  = cellText('B8');

              // Tableau 1 : lignes 10-30 ; Tableau 2 : lignes 32-62
              const ranges = [[10, 30], [32, 62]];
              for (const [start, end] of ranges) {
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
              // Format recto : B4 = texte combiné avec préfixes
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

              // Candidats : lignes 6-58
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

  // ─── Remplissage modale depuis données Excel ─────────────────
  async function fillModalFromXlsx(besoin) {
    // Stocker toutes les données pour les passer à l'API à la création
    _xlsxImportData = besoin;
    const setVal = (id, val) => {
      const el = document.getElementById('v30-besoin-' + id);
      if (el && val !== undefined) el.value = val || '';
    };

    setVal('intitule',   besoin.intitule);
    setVal('contact',    besoin.contact);
    setVal('localisation', besoin.localisation);
    setVal('duree',      besoin.duree_mission);
    setVal('date-besoin', besoin.date_besoin);
    setVal('date-appel', besoin.date_appel);
    setVal('descriptif', besoin.descriptif || '');

    // Client : chercher l'entreprise dans la liste, puis l'injecter dans le picker
    if (besoin.client && _newBesoinPicker) {
      try {
        const data = await fetchJSON('/api/companies/list');
        const companies = data.companies || [];
        const normalize = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        const q = normalize(besoin.client);
        const match = companies.find(c => normalize(c.groupe) === q || normalize(c.groupe).startsWith(q));
        if (match) {
          _newBesoinPicker.setSelection({ id: match.id, groupe: match.groupe, site: match.site || '' });
        } else {
          // Non trouvé : afficher le nom et informer l'utilisateur
          _newBesoinPicker.input.value = besoin.client;
          if (typeof window.showToast === 'function') {
            window.showToast(
              `Entreprise « ${besoin.client} » non trouvée dans vos entreprises — sélectionnez-en une ou créez-la.`,
              'info', 4500
            );
          }
        }
      } catch (_e) {
        setVal('client', besoin.client);
      }
    }
  }

  // ─── Liste ─────────────────────────────────────────────────
  async function loadList() {
    const list = document.querySelector('[data-v30-besoins-list]');
    if (!list) return;
    list.innerHTML = '<div class="v30-besoins__skel"><span class="skel" style="width:200px;height:16px;"></span></div>';
    try {
      const params = new URLSearchParams();
      if (state.filterStatut) params.set('statut', state.filterStatut);
      const data = await fetchJSON('/api/besoins?' + params.toString());
      state.items = data.items || [];
      renderList();
    } catch (err) {
      list.innerHTML = '<div class="v30-besoins__empty">Erreur de chargement : ' + escapeHtml(err.message) + '</div>';
    }
  }

  function renderList() {
    const list = document.querySelector('[data-v30-besoins-list]');
    const countEl = document.querySelector('[data-v30-besoins-count]');
    if (!list) return;
    const items = state.items;
    if (countEl) countEl.textContent = items.length + (items.length > 1 ? ' besoins' : ' besoin');
    if (!items.length) {
      list.innerHTML = '<div class="v30-besoins__empty">Aucun besoin pour ces filtres.<br><span class="muted">Clique sur « Nouveau besoin » pour commencer.</span></div>';
      return;
    }
    const rows = items.map(b => {
      const stat = STATUT_LABELS[b.statut] || { label: b.statut || '—', cls: '' };
      const linked = b.prospect_name
        ? `<a class="muted" href="/v30/prospect/${b.prospect_id}">${escapeHtml(b.prospect_name)}</a>`
        : '<span class="muted">—</span>';
      const cands = b.candidats_count || 0;
      const intitule = (b.intitule || '').trim() || '<span class="muted">(sans intitulé)</span>';
      const client = (b.client || b.company_name || '').trim() || '<span class="muted">—</span>';
      return `
        <tr data-v30-besoin-row data-id="${b.id}" tabindex="0">
          <td class="v30-besoin-cell-strong">${escapeHtml(intitule)}</td>
          <td>${escapeHtml(client)}</td>
          <td><span class="v30-besoin-pill ${stat.cls}">${escapeHtml(stat.label)}</span></td>
          <td>${linked}</td>
          <td>${escapeHtml(b.date_besoin || '—')}</td>
          <td>${escapeHtml(b.duree_mission || '—')}</td>
          <td><span class="num">${cands}</span></td>
          <td class="muted">${escapeHtml(fmtDate(b.created_at))}</td>
          <td class="v30-besoin-actions">
            <a class="btn btn-ghost btn-sm" href="/v30/besoins/${b.id}" title="Ouvrir">Ouvrir</a>
            <a class="btn btn-ghost btn-sm" href="/api/besoins/${b.id}/export.xlsx?format=both" title="Export Excel">⬇</a>
          </td>
        </tr>
      `;
    }).join('');
    list.innerHTML = `
      <table class="v30-besoins-table">
        <thead>
          <tr>
            <th>Intitulé</th>
            <th>Client</th>
            <th>Statut</th>
            <th>Prospect lié</th>
            <th>Date besoin</th>
            <th>Durée</th>
            <th>Cand.</th>
            <th>Créé</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  function bindFilters() {
    const filters = document.querySelectorAll('.v30-besoins__filters [data-statut]');
    filters.forEach(btn => {
      btn.addEventListener('click', () => {
        filters.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.filterStatut = btn.dataset.statut || '';
        loadList();
      });
    });
  }

  function bindRefresh() {
    const btn = document.querySelector('[data-v30-besoins-refresh]');
    if (btn) btn.addEventListener('click', loadList);
  }

  function bindRowClick() {
    const list = document.querySelector('[data-v30-besoins-list]');
    if (!list) return;
    list.addEventListener('click', (e) => {
      if (e.target.closest('a, button')) return;
      const row = e.target.closest('[data-v30-besoin-row]');
      if (!row) return;
      const id = row.dataset.id;
      if (id) window.location.href = '/v30/besoins/' + id;
    });
  }

  // ─── Modale création ─────────────────────────────────────────
  function openModal() {
    const md = document.querySelector('[data-v30-besoin-modal]');
    if (!md) return;
    // Reset champs
    ['intitule', 'contact', 'localisation', 'duree', 'date-besoin', 'date-appel'].forEach(k => {
      const el = document.getElementById('v30-besoin-' + k);
      if (el) el.value = '';
    });
    const ta = document.getElementById('v30-besoin-descriptif');
    if (ta) ta.value = '';

    // Reset données Excel importées
    _xlsxImportData = null;

    // Reset picker entreprise
    if (_newBesoinPicker) _newBesoinPicker.clear();

    // Reset file input xlsx
    const xlsxInput = document.querySelector('[data-v30-besoin-xlsx-file]');
    if (xlsxInput) xlsxInput.value = '';

    md.hidden = false;
    md.classList.add('is-open');
    setTimeout(() => {
      const f = document.getElementById('v30-besoin-intitule');
      if (f) f.focus();
    }, 50);
  }

  function closeModal() {
    const md = document.querySelector('[data-v30-besoin-modal]');
    if (!md) return;
    md.classList.remove('is-open');
    setTimeout(() => { md.hidden = true; }, 160);
  }

  function bindModal() {
    const newBtn = document.querySelector('[data-v30-besoins-new]');
    if (newBtn) newBtn.addEventListener('click', openModal);
    document.querySelectorAll('[data-v30-besoin-close]').forEach(b => b.addEventListener('click', closeModal));

    const md = document.querySelector('[data-v30-besoin-modal]');
    if (md) {
      md.addEventListener('click', (e) => { if (e.target === md) closeModal(); });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && md && !md.hidden) closeModal();
    });

    // Attacher CompanyPicker au champ client de la modale
    const clientInput = document.getElementById('v30-besoin-client');
    if (clientInput && window.CompanyPicker) {
      _newBesoinPicker = window.CompanyPicker.attachToInput(clientInput, {});
    }

    // Import Excel
    const xlsxInput = document.querySelector('[data-v30-besoin-xlsx-file]');
    if (xlsxInput) {
      xlsxInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
          const besoin = await parseXlsxBesoin(file);
          await fillModalFromXlsx(besoin);
          // Si un intitulé a été trouvé, mettre le focus sur le premier champ vide
          const intituleEl = document.getElementById('v30-besoin-intitule');
          if (intituleEl && !intituleEl.value) intituleEl.focus();
          if (typeof window.showToast === 'function') {
            window.showToast('Données importées depuis Excel', 'success', 2500);
          }
        } catch (err) {
          if (typeof window.showToast === 'function') {
            window.showToast('Erreur import Excel : ' + err.message, 'error', 3500);
          }
        }
        // Reset pour permettre un nouvel import du même fichier
        xlsxInput.value = '';
      });
    }

    const create = document.querySelector('[data-v30-besoin-create]');
    if (create) create.addEventListener('click', async () => {
      const get = (k) => (document.getElementById('v30-besoin-' + k) || {}).value || '';
      const intitule = get('intitule').trim();
      if (!intitule) {
        if (typeof window.showToast === 'function') {
          window.showToast('Intitulé obligatoire', 'warning', 2500);
        } else { alert('Intitulé obligatoire'); }
        return;
      }

      // Récupérer la sélection entreprise depuis le picker
      const pick = _newBesoinPicker ? _newBesoinPicker.getSelection() : null;

      create.disabled = true;
      try {
        const xl = _xlsxImportData || {};
        const data = await fetchJSON('/api/besoins', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            intitule,
            client:        pick ? pick.groupe : get('client').trim(),
            company_id:    pick ? pick.id : null,
            contact:       get('contact').trim() || xl.contact || '',
            localisation:  get('localisation').trim() || xl.localisation || '',
            duree_mission: get('duree').trim() || xl.duree_mission || '',
            date_besoin:   get('date-besoin') || xl.date_besoin || '',
            date_appel:    get('date-appel') || xl.date_appel || '',
            descriptif:    (document.getElementById('v30-besoin-descriptif') || {}).value || xl.descriptif || '',
            // Champs complets issus de l'import Excel
            competences:   xl.competences  || '',
            connaissances: xl.connaissances || '',
            experience:    xl.experience   || '',
            profil_type:   xl.profil_type  || '',
            commentaires:  xl.commentaires || '',
            candidats:     xl.candidats    || [],
          }),
        });
        if (data && data.ok && data.besoin) {
          closeModal();
          window.location.href = '/v30/besoins/' + data.besoin.id;
        } else {
          throw new Error((data && data.error) || 'Erreur création');
        }
      } catch (err) {
        if (typeof window.showToast === 'function') window.showToast('Erreur : ' + err.message, 'error', 3000);
        else alert('Erreur : ' + err.message);
      } finally {
        create.disabled = false;
      }
    });
  }

  // ─── Init ─────────────────────────────────────────────────────
  function init() {
    bindFilters();
    bindRefresh();
    bindRowClick();
    bindModal();
    loadList();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
