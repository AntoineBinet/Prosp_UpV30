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

  const CAND_KEYS = ['candidat', 'commentaires', 'dispo', 'appel', 'dt', 'rdv1', 'rdv2', 'rt', 'envoi_dt', 'propal', 'rt_client', 'lieu_habitation', 'diplome'];

  // Statut "couleur" libre par ligne — non utilisé par l'export Excel mais
  // affiché dans l'UI : '' (pas contacté) | 'dispo' (vert) | 'nope' (rouge).
  const STATUS_ORDER = ['', 'dispo', 'nope'];
  const STATUS_LABELS = {
    '':      'Pas contacté',
    'dispo': 'Disponible',
    'nope':  'Non disponible',
  };

  const state = {
    besoin: null,
    dirty: false,
    saving: false,
    saveTimer: null,
    expanded: new Set(),
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
  // Format : feuille "recto verso", 13 colonnes A-M, données candidats rows 10-62.
  // Layout header : B1=client, H1=localisation, M1=duree_mission,
  //   B2=contact, I2=date_appel, L2=date_besoin, B3=intitule,
  //   B4=descriptif, B5=competences, B6=connaissances, B7=experience,
  //   I7=profil_type, B8=commentaires.
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
            const ws = wb.Sheets[sheetName];
            if (!ws) { reject(new Error('Feuille introuvable')); return; }

            function cellText(ref) {
              const c = ws[ref];
              if (!c) return '';
              const v = c.w !== undefined ? c.w : (c.v !== undefined ? String(c.v) : '');
              return String(v).trim();
            }

            const besoin = {
              client:        cellText('B1'),
              localisation:  cellText('H1'),
              duree_mission: cellText('M1'),
              contact:       cellText('B2'),
              date_appel:    cellText('I2'),
              date_besoin:   cellText('L2'),
              intitule:      cellText('B3'),
              descriptif:    cellText('B4'),
              competences:   cellText('B5'),
              connaissances: cellText('B6'),
              experience:    cellText('B7'),
              profil_type:   cellText('I7'),
              commentaires:  cellText('B8'),
              candidats: [],
            };

            const COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'];
            for (let r = 10; r <= 62; r++) {
              const cand = {};
              let hasData = false;
              for (let ci = 0; ci < CAND_KEYS.length; ci++) {
                const v = cellText(COLS[ci] + r);
                cand[CAND_KEYS[ci]] = v;
                if (v) hasData = true;
              }
              if (hasData) besoin.candidats.push(cand);
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
            markDirty();
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

  // ─── Rendu carte candidat ──────────────────────────────────
  function autoResizeTextarea(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.max(el.scrollHeight + 2, 78) + 'px';
  }

  function normalizeStatus(c) {
    const s = (c && c.cand_status) ? String(c.cand_status).toLowerCase() : '';
    return STATUS_ORDER.includes(s) ? s : '';
  }

  function getRefBadges(ref) {
    if (!ref) return '';
    const items = [];
    if (ref.role)     items.push({ k: 'Rôle',       v: ref.role });
    if (ref.location) items.push({ k: 'Lieu',       v: ref.location });
    if (ref.seniority)items.push({ k: 'Séniorité',  v: ref.seniority });
    if (ref.tech)     items.push({ k: 'Tech',       v: ref.tech });
    if (!items.length) return '<span class="v30-cand-card__ref-empty">Pas d\'info supplémentaire.</span>';
    return items.map(it =>
      `<span class="v30-cand-card__ref-tag"><span>${escapeHtml(it.k)}</span> ${escapeHtml(it.v)}</span>`
    ).join('');
  }

  function buildCandCard(c, idx) {
    const card = document.createElement('article');
    card.className = 'v30-cand-card';
    card.setAttribute('role', 'listitem');
    card.dataset.candIdx = String(idx);
    const status = normalizeStatus(c);
    card.dataset.status = status;
    if (state.expanded.has(idx)) card.classList.add('is-open');

    const ref = (c && c._ref) || null;
    const vsaUrl = ref && ref.vsa_url ? String(ref.vsa_url).trim() : '';
    const ficheUrl = c && c.cand_id ? '/v30/candidat/' + c.cand_id : '';
    const profileUrl = (c && c.profile_url) ? String(c.profile_url).trim() : '';

    // ── Header (toujours visible) ─────────────────────────────
    const head = document.createElement('div');
    head.className = 'v30-cand-card__head';

    // Toggle
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'v30-cand-card__toggle';
    toggle.setAttribute('aria-expanded', state.expanded.has(idx) ? 'true' : 'false');
    toggle.title = 'Déplier les détails';
    toggle.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const i = parseInt(card.dataset.candIdx, 10);
      if (state.expanded.has(i)) state.expanded.delete(i);
      else state.expanded.add(i);
      card.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', card.classList.contains('is-open') ? 'true' : 'false');
      // Auto-resize textareas après ouverture
      if (card.classList.contains('is-open')) {
        card.querySelectorAll('textarea').forEach(autoResizeTextarea);
      }
    });
    head.appendChild(toggle);

    // Status pill (cycle au clic)
    const statusBtn = document.createElement('button');
    statusBtn.type = 'button';
    statusBtn.className = 'v30-cand-card__status';
    statusBtn.title = 'Statut — clic pour cycler (Pas contacté → Dispo → Non dispo)';
    statusBtn.textContent = STATUS_LABELS[status];
    statusBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const cur = normalizeStatus(c);
      const next = STATUS_ORDER[(STATUS_ORDER.indexOf(cur) + 1) % STATUS_ORDER.length];
      c.cand_status = next;
      card.dataset.status = next;
      statusBtn.textContent = STATUS_LABELS[next];
      markDirty();
    });
    head.appendChild(statusBtn);

    // Nom (input)
    const nameWrap = document.createElement('div');
    nameWrap.className = 'v30-cand-card__name';
    const nameInp = document.createElement('input');
    nameInp.type = 'text';
    nameInp.placeholder = 'Nom du candidat';
    nameInp.value = (c && c.candidat) || '';
    nameInp.dataset.candField = 'candidat';
    nameInp.addEventListener('input', () => { c.candidat = nameInp.value; markDirty(); });
    nameInp.addEventListener('click', (e) => e.stopPropagation());
    nameWrap.appendChild(nameInp);
    head.appendChild(nameWrap);

    // Preview (dispo + dernier RDV) — synthèse
    const preview = document.createElement('div');
    preview.className = 'v30-cand-card__preview';
    const dispoVal = (c && c.dispo) || '';
    const rdv = (c && (c.rdv1 || c.rdv2)) || '';
    if (dispoVal) {
      preview.innerHTML += `<span class="v30-cand-card__preview-item"><span>Dispo</span><strong>${escapeHtml(dispoVal)}</strong></span>`;
    }
    if (rdv) {
      preview.innerHTML += `<span class="v30-cand-card__preview-item"><span>RDV</span><strong>${escapeHtml(rdv)}</strong></span>`;
    }
    if (ref && ref.role) {
      preview.innerHTML += `<span class="v30-cand-card__preview-item"><span>Rôle</span><strong>${escapeHtml(ref.role)}</strong></span>`;
    }
    head.appendChild(preview);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'v30-cand-card__actions';

    if (vsaUrl) {
      const vsa = document.createElement('a');
      vsa.href = vsaUrl;
      vsa.target = '_blank';
      vsa.rel = 'noopener noreferrer';
      vsa.className = 'btn btn-ghost btn-sm v30-cand-card__btn-vsa';
      vsa.title = 'Ouvrir la page VSA';
      vsa.textContent = 'VSA';
      vsa.addEventListener('click', (e) => e.stopPropagation());
      actions.appendChild(vsa);
    }

    if (ficheUrl) {
      const fiche = document.createElement('a');
      fiche.href = ficheUrl;
      fiche.target = '_blank';
      fiche.rel = 'noopener noreferrer';
      fiche.className = 'btn btn-ghost btn-sm btn-icon';
      fiche.title = 'Ouvrir la fiche candidat';
      fiche.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>';
      fiche.addEventListener('click', (e) => e.stopPropagation());
      actions.appendChild(fiche);
    } else {
      const headProfileBtn = document.createElement('a');
      headProfileBtn.target = '_blank';
      headProfileBtn.rel = 'noopener noreferrer';
      headProfileBtn.className = 'btn btn-ghost btn-sm btn-icon v30-cand-card__btn-profile';
      headProfileBtn.title = 'Ouvrir le profil';
      headProfileBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>';
      headProfileBtn.href = profileUrl || '#';
      headProfileBtn.style.opacity = profileUrl ? '1' : '0.35';
      headProfileBtn.style.pointerEvents = profileUrl ? '' : 'none';
      headProfileBtn.addEventListener('click', (e) => e.stopPropagation());
      actions.appendChild(headProfileBtn);

      const linkBtn = document.createElement('button');
      linkBtn.type = 'button';
      linkBtn.className = 'btn btn-ghost btn-sm btn-icon';
      linkBtn.title = 'Lier à une fiche candidat';
      linkBtn.style.opacity = '0.55';
      linkBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a5 5 0 0 1 0-7l3-3a5 5 0 0 1 7 7l-2 2"/><path d="M14 10a5 5 0 0 1 0 7l-3 3a5 5 0 0 1-7-7l2-2"/></svg>';
      linkBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        _linkCandIdx = parseInt(card.dataset.candIdx, 10);
        openCandModal(c.candidat || '');
      });
      actions.appendChild(linkBtn);
    }

    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'btn btn-ghost btn-sm btn-icon';
    rm.title = 'Supprimer la ligne';
    rm.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    rm.addEventListener('click', (e) => {
      e.stopPropagation();
      const cands = (state.besoin.candidats || []);
      const i = parseInt(card.dataset.candIdx, 10);
      if (i >= 0 && i < cands.length) {
        cands.splice(i, 1);
        // Réindexe les lignes ouvertes
        const newExpanded = new Set();
        state.expanded.forEach(j => {
          if (j < i) newExpanded.add(j);
          else if (j > i) newExpanded.add(j - 1);
        });
        state.expanded = newExpanded;
        renderCands();
        markDirty();
      }
    });
    actions.appendChild(rm);
    head.appendChild(actions);

    // Click sur le header (hors input/bouton) déplie la carte
    head.addEventListener('click', (e) => {
      if (e.target.closest('input, button, a, textarea, select')) return;
      toggle.click();
    });

    card.appendChild(head);

    // ── Body (déroulant) ─────────────────────────────────────
    const body = document.createElement('div');
    body.className = 'v30-cand-card__body';

    const bodyInner = document.createElement('div');
    bodyInner.className = 'v30-cand-card__body-inner';

    const grid = document.createElement('div');
    grid.className = 'v30-cand-card__grid';

    // Commentaires (large textarea)
    const fldComm = document.createElement('label');
    fldComm.className = 'v30-cand-card__field';
    fldComm.innerHTML = '<span>Commentaires</span>';
    const taComm = document.createElement('textarea');
    taComm.rows = 3;
    taComm.dataset.candField = 'commentaires';
    taComm.placeholder = 'Origine du candidat, contexte, premières impressions…';
    taComm.value = (c && c.commentaires) || '';
    taComm.addEventListener('input', () => {
      c.commentaires = taComm.value;
      autoResizeTextarea(taComm);
      markDirty();
    });
    fldComm.appendChild(taComm);
    grid.appendChild(fldComm);

    // Tracking : Dispo, Appel, DT, RDV1, RDV2, RT, Envoi DT, Propal, RT client, Lieu habitation, Diplôme
    const tracking = document.createElement('div');
    tracking.className = 'v30-cand-card__tracking';
    const TRACK = [
      { k: 'dispo',          label: 'Dispo',           placeholder: 'ASAP, 15j, 31/07…'   },
      { k: 'appel',          label: 'Appel',           placeholder: 'OK, à rappeler…'      },
      { k: 'dt',             label: 'DT',              placeholder: 'Demande technique'    },
      { k: 'rdv1',           label: 'RDV 1',           placeholder: 'Date / état'          },
      { k: 'rdv2',           label: 'RDV 2',           placeholder: 'Date / état'          },
      { k: 'rt',             label: 'RT',              placeholder: 'Retour…'              },
      { k: 'envoi_dt',       label: 'Envoi DT',        placeholder: 'Date envoi'           },
      { k: 'propal',         label: 'Propal',          placeholder: 'Proposition…'         },
      { k: 'rt_client',      label: 'RT client',       placeholder: 'Retour client'        },
      { k: 'lieu_habitation',label: 'Lieu habitation', placeholder: 'Ville, département…' },
      { k: 'diplome',        label: 'Diplôme',         placeholder: 'Bac+5, Ingénieur…'   },
    ];
    TRACK.forEach(t => {
      const lab = document.createElement('label');
      lab.className = 'v30-cand-card__field';
      const sp = document.createElement('span'); sp.textContent = t.label; lab.appendChild(sp);
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.dataset.candField = t.k;
      inp.placeholder = t.placeholder;
      inp.value = (c && c[t.k]) || '';
      inp.addEventListener('input', () => { c[t.k] = inp.value; markDirty(); });
      lab.appendChild(inp);
      tracking.appendChild(lab);
    });
    grid.appendChild(tracking);

    // Champ "Téléphone" — saisie libre, visible si pas de fiche candidat liée
    if (!ficheUrl) {
      const phoneFld = document.createElement('label');
      phoneFld.className = 'v30-cand-card__field v30-cand-card__field--profile';
      const phoneSp = document.createElement('span'); phoneSp.textContent = 'Téléphone'; phoneFld.appendChild(phoneSp);
      const phoneRow = document.createElement('div');
      phoneRow.className = 'v30-cand-card__profile-row';
      const phoneInp = document.createElement('input');
      phoneInp.type = 'tel';
      phoneInp.dataset.candField = 'phone';
      phoneInp.placeholder = '06 12 34 56 78';
      phoneInp.value = (c && c.phone) || '';
      const phoneCallBtn = document.createElement('a');
      phoneCallBtn.className = 'btn btn-ghost btn-sm v30-cand-card__profile-open';
      phoneCallBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>Appeler';
      const phoneInitial = (c && c.phone) ? String(c.phone).trim() : '';
      phoneCallBtn.href = phoneInitial ? 'tel:' + phoneInitial.replace(/\s+/g, '') : '#';
      phoneCallBtn.style.display = phoneInitial ? '' : 'none';
      phoneInp.addEventListener('input', () => {
        const v = phoneInp.value.trim();
        c.phone = v;
        phoneCallBtn.href = v ? 'tel:' + v.replace(/\s+/g, '') : '#';
        phoneCallBtn.style.display = v ? '' : 'none';
        markDirty();
      });
      phoneCallBtn.addEventListener('click', (e) => e.stopPropagation());
      phoneRow.appendChild(phoneInp);
      phoneRow.appendChild(phoneCallBtn);
      phoneFld.appendChild(phoneRow);
      grid.appendChild(phoneFld);

      // Champ "Lien profil" — saisie libre, VSA ou LinkedIn
      const profileFld = document.createElement('label');
      profileFld.className = 'v30-cand-card__field v30-cand-card__field--profile';
      const profileSp = document.createElement('span'); profileSp.textContent = 'Lien profil'; profileFld.appendChild(profileSp);
      const profileRow = document.createElement('div');
      profileRow.className = 'v30-cand-card__profile-row';
      const profileInp = document.createElement('input');
      profileInp.type = 'url';
      profileInp.dataset.candField = 'profile_url';
      profileInp.placeholder = 'https://… (VSA ou LinkedIn)';
      profileInp.value = profileUrl;
      const profileOpenBtn = document.createElement('a');
      profileOpenBtn.target = '_blank';
      profileOpenBtn.rel = 'noopener noreferrer';
      profileOpenBtn.className = 'btn btn-ghost btn-sm v30-cand-card__profile-open';
      profileOpenBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>Ouvrir';
      profileOpenBtn.href = profileUrl || '#';
      profileOpenBtn.style.display = profileUrl ? '' : 'none';
      profileInp.addEventListener('input', () => {
        const url = profileInp.value.trim();
        c.profile_url = url;
        profileOpenBtn.href = url || '#';
        profileOpenBtn.style.display = url ? '' : 'none';
        const hBtn = head.querySelector('.v30-cand-card__btn-profile');
        if (hBtn) {
          hBtn.href = url || '#';
          hBtn.style.opacity = url ? '1' : '0.35';
          hBtn.style.pointerEvents = url ? '' : 'none';
        }
        markDirty();
      });
      profileRow.appendChild(profileInp);
      profileRow.appendChild(profileOpenBtn);
      profileFld.appendChild(profileRow);
      grid.appendChild(profileFld);
    }

    // Ref info (depuis fiche candidat liée)
    if (ref) {
      const refBox = document.createElement('div');
      refBox.className = 'v30-cand-card__ref';
      refBox.innerHTML = getRefBadges(ref);
      grid.appendChild(refBox);
    }

    // Actions du body : VSA, fiche, lier, délier
    const bodyActions = document.createElement('div');
    bodyActions.className = 'v30-cand-card__body-actions';

    if (vsaUrl) {
      const vsaBtn = document.createElement('a');
      vsaBtn.href = vsaUrl;
      vsaBtn.target = '_blank';
      vsaBtn.rel = 'noopener noreferrer';
      vsaBtn.className = 'btn btn-ghost btn-sm';
      vsaBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>Page VSA';
      bodyActions.appendChild(vsaBtn);
    }
    if (ficheUrl) {
      const ficheBtn = document.createElement('a');
      ficheBtn.href = ficheUrl;
      ficheBtn.target = '_blank';
      ficheBtn.rel = 'noopener noreferrer';
      ficheBtn.className = 'btn btn-ghost btn-sm';
      ficheBtn.textContent = 'Fiche candidat ↗';
      bodyActions.appendChild(ficheBtn);

      const unlinkBtn = document.createElement('button');
      unlinkBtn.type = 'button';
      unlinkBtn.className = 'btn btn-ghost btn-sm';
      unlinkBtn.textContent = 'Délier la fiche';
      unlinkBtn.addEventListener('click', () => {
        delete c.cand_id;
        delete c._ref;
        renderCards();
        markDirty();
      });
      bodyActions.appendChild(unlinkBtn);
    } else {
      const linkBtn2 = document.createElement('button');
      linkBtn2.type = 'button';
      linkBtn2.className = 'btn btn-ghost btn-sm';
      linkBtn2.textContent = 'Lier à une fiche candidat…';
      linkBtn2.addEventListener('click', () => {
        _linkCandIdx = parseInt(card.dataset.candIdx, 10);
        openCandModal();
      });
      bodyActions.appendChild(linkBtn2);
    }
    grid.appendChild(bodyActions);

    bodyInner.appendChild(grid);
    body.appendChild(bodyInner);
    card.appendChild(body);

    // Auto-resize si déjà ouvert au render
    if (state.expanded.has(idx)) {
      requestAnimationFrame(() => {
        card.querySelectorAll('textarea').forEach(autoResizeTextarea);
      });
    }

    return card;
  }

  // Alias pour la lisibilité (renderCands est appelé depuis l'ancien code)
  function renderCards() { renderCands(); }

  function renderCands() {
    const host = root.querySelector('[data-v30-besoin-cand-body]');
    if (!host) return;
    if (!Array.isArray(state.besoin.candidats)) state.besoin.candidats = [];
    host.innerHTML = '';
    if (!state.besoin.candidats.length) {
      const empty = document.createElement('div');
      empty.className = 'v30-cand-list__empty';
      empty.textContent = 'Aucun candidat. Cliquez sur « Ajouter une ligne » ou « Chercher un candidat ».';
      host.appendChild(empty);
      return;
    }
    state.besoin.candidats.forEach((c, idx) => {
      host.appendChild(buildCandCard(c, idx));
    });
  }

  function addCand() {
    if (!Array.isArray(state.besoin.candidats)) state.besoin.candidats = [];
    state.besoin.candidats.push({});
    const newIdx = state.besoin.candidats.length - 1;
    state.expanded.add(newIdx);
    renderCands();
    markDirty();
    const host = root.querySelector('[data-v30-besoin-cand-body]');
    if (host) {
      const last = host.querySelector('.v30-cand-card:last-child input[data-cand-field="candidat"]');
      if (last) last.focus();
    }
  }

  // ─── Save ────────────────────────────────────────────────
  function updateSaveButton() {
    const btn = root.querySelector('[data-v30-besoin-save]');
    if (!btn) return;
    const clean = !state.dirty && !state.saving;
    btn.disabled = clean;
    btn.style.opacity = clean ? '0.45' : '';
    btn.style.cursor = clean ? 'default' : '';
  }

  function markDirty() {
    state.dirty = true;
    updateSaveButton();
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

  function _serializeCandRefs(cands) {
    if (!Array.isArray(cands)) return '';
    return cands.map(c => {
      const r = c && c._ref;
      if (!r) return (c && c.cand_id ? String(c.cand_id) : '') + '|';
      return [r.id, r.vsa_url || '', r.role || '', r.location || ''].join('§');
    }).join('||');
  }

  async function saveAuto() {
    if (!state.dirty) return;
    // Un save est déjà en cours : on replanifie après sa fin
    if (state.saving) {
      if (state.saveTimer) clearTimeout(state.saveTimer);
      state.saveTimer = setTimeout(saveAuto, 400);
      return;
    }
    state.saving = true;
    // Marquer propre de façon optimiste : si un markDirty() arrive pendant le save,
    // dirty repassera à true et un re-save sera déclenché après.
    state.dirty = false;
    updateSaveButton();
    const savedEl = root.querySelector('[data-v30-besoin-saved]');
    try {
      if (savedEl) savedEl.textContent = 'Enregistrement…';
      const prevRefSig = _serializeCandRefs(state.besoin && state.besoin.candidats);
      const payload = collectPayload();
      const data = await fetchJSON('/api/besoins/' + ID, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (data && data.ok) {
        // Conserver le tableau candidats en mémoire pour que les closures des cartes
        // DOM restent valides — sinon les changements de statut suivants écriraient
        // dans des objets orphelins non capturés par collectPayload().
        const freshBesoin = data.besoin || state.besoin;
        const currentCands = state.besoin.candidats || [];
        if (Array.isArray(freshBesoin.candidats)) {
          freshBesoin.candidats.forEach((sc, i) => {
            if (currentCands[i]) {
              if (sc._ref !== undefined) currentCands[i]._ref = sc._ref;
              if (sc.cand_id !== undefined) currentCands[i].cand_id = sc.cand_id;
            }
          });
        }
        freshBesoin.candidats = currentCands;
        state.besoin = freshBesoin;

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
        // Re-render les cartes uniquement si l'enrichissement (_ref/VSA) a changé
        const newRefSig = _serializeCandRefs(state.besoin && state.besoin.candidats);
        if (newRefSig !== prevRefSig) renderCands();
        state.saving = false;
        updateSaveButton();
        if (savedEl) savedEl.textContent = '✓ Enregistré';
        setTimeout(() => { if (savedEl && !state.dirty) savedEl.textContent = ''; }, 1800);
      }
    } catch (err) {
      state.saving = false;
      state.dirty = true; // restaurer dirty pour permettre un re-save
      updateSaveButton();
      if (savedEl) savedEl.textContent = '⚠ ' + err.message;
    }
  }

  // ─── Export Excel ────────────────────────────────────────
  function exportXlsx() {
    const url = '/api/besoins/' + ID + '/export.xlsx';
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
  function openCandModal(prefillName) {
    const md = document.querySelector('[data-v30-cand-modal]');
    if (!md) return;
    md.hidden = false;
    md.classList.add('is-open');
    const inp = document.getElementById('v30-cand-search-input');
    if (inp) {
      inp.value = prefillName || '';
      setTimeout(() => {
        inp.focus();
        if (prefillName && prefillName.trim().length >= 2) {
          inp.dispatchEvent(new Event('input'));
        }
      }, 50);
    }
    if (!prefillName) renderCandResults([]);
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
          if (typeof window.showToast === 'function') window.showToast('Fiche liée — VSA & infos disponibles après sauvegarde', 'success', 2200);
        } else {
          // Mode ajout
          state.besoin.candidats.push({ candidat: name, cand_id: cid });
          const newIdx = state.besoin.candidats.length - 1;
          state.expanded.add(newIdx);
          if (typeof window.showToast === 'function') window.showToast('Candidat ajouté', 'success', 1800);
        }

        renderCands();
        markDirty();
        closeCandModal();
        const host = root.querySelector('[data-v30-besoin-cand-body]');
        if (host) {
          const last = host.querySelector('.v30-cand-card:last-child input[data-cand-field="candidat"]');
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

  // ─── Création fiche candidat ─────────────────────────────
  function openCreateCandModal() {
    const md = document.querySelector('[data-v30-create-cand-modal]');
    if (!md) return;

    // Pré-remplir depuis le champ de recherche ou la ligne en cours
    const searchInp = document.getElementById('v30-cand-search-input');
    const nameInp   = document.getElementById('v30-cc-name');
    const roleInp   = document.getElementById('v30-cc-role');
    const skillsInp = document.getElementById('v30-cc-skills');
    const notesInp  = document.getElementById('v30-cc-notes');
    const dcInp     = document.getElementById('v30-cc-dc');
    const statusSel = document.getElementById('v30-cc-status');
    const errEl     = document.getElementById('v30-cc-error');

    if (nameInp) nameInp.value = (searchInp && searchInp.value.trim()) || '';
    if (roleInp) roleInp.value = (state.besoin && state.besoin.intitule) || '';
    if (skillsInp) skillsInp.value = (state.besoin && state.besoin.competences) || '';
    if (notesInp) notesInp.value = '';
    if (dcInp) dcInp.value = '';
    if (statusSel) statusSel.value = '';
    if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }

    md.hidden = false;
    md.classList.add('is-open');
    setTimeout(() => { if (nameInp) nameInp.focus(); }, 50);
  }

  function closeCreateCandModal() {
    const md = document.querySelector('[data-v30-create-cand-modal]');
    if (!md) return;
    md.classList.remove('is-open');
    setTimeout(() => { md.hidden = true; }, 160);
  }

  function _linkNewCandidate(name, cid) {
    if (!Array.isArray(state.besoin.candidats)) state.besoin.candidats = [];
    if (_linkCandIdx !== null) {
      const cand = state.besoin.candidats[_linkCandIdx];
      if (cand) { cand.candidat = name; cand.cand_id = cid; }
    } else {
      state.besoin.candidats.push({ candidat: name, cand_id: cid });
      state.expanded.add(state.besoin.candidats.length - 1);
    }
    renderCands();
    markDirty();
    closeCandModal();
    closeCreateCandModal();
    if (typeof window.showToast === 'function') window.showToast('Fiche créée et liée', 'success', 2500);
  }

  function bindCreateCandModal() {
    const openBtn = document.querySelector('[data-v30-create-cand-open]');
    if (openBtn) openBtn.addEventListener('click', openCreateCandModal);

    document.querySelectorAll('[data-v30-create-cand-close]').forEach(b => b.addEventListener('click', closeCreateCandModal));

    const md = document.querySelector('[data-v30-create-cand-modal]');
    if (md) {
      md.addEventListener('click', (e) => { if (e.target === md) closeCreateCandModal(); });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !md.hidden) closeCreateCandModal();
      });
    }

    const submitBtn = document.getElementById('v30-cc-submit');
    if (!submitBtn) return;

    submitBtn.addEventListener('click', async () => {
      const nameVal   = (document.getElementById('v30-cc-name')   || {}).value || '';
      const roleVal   = (document.getElementById('v30-cc-role')   || {}).value || '';
      const statusVal = (document.getElementById('v30-cc-status') || {}).value || '';
      const skillsVal = (document.getElementById('v30-cc-skills') || {}).value || '';
      const notesVal  = (document.getElementById('v30-cc-notes')  || {}).value || '';
      const dcFile    = document.getElementById('v30-cc-dc');
      const errEl     = document.getElementById('v30-cc-error');

      if (!nameVal.trim()) {
        if (errEl) { errEl.textContent = 'Le nom est obligatoire.'; errEl.style.display = 'block'; }
        document.getElementById('v30-cc-name').focus();
        return;
      }
      if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Création…';
      try {
        const payload = { name: nameVal.trim() };
        if (roleVal.trim())   payload.role   = roleVal.trim();
        if (statusVal)        payload.status = statusVal;
        if (skillsVal.trim()) payload.tech   = skillsVal.trim();
        if (notesVal.trim())  payload.notes  = notesVal.trim();

        const res = await fetchJSON('/api/candidates/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res || !res.ok) {
          throw new Error(res && res.error ? res.error : 'Erreur serveur');
        }

        const newId = res.id || res.candidate_id || (res.candidate && res.candidate.id);
        if (!newId) throw new Error('ID candidat non retourné');

        // Upload DC si présent
        if (dcFile && dcFile.files && dcFile.files.length > 0) {
          const fd = new FormData();
          fd.append('dc', dcFile.files[0]);
          fd.append('candidate_id', String(newId));
          try {
            await fetch('/api/candidates/upload-dc', { method: 'POST', body: fd });
          } catch (_e) {
            if (typeof window.showToast === 'function') window.showToast('Fiche créée mais échec upload DC', 'warning', 3000);
          }
        }

        _linkNewCandidate(nameVal.trim(), newId);
      } catch (err) {
        if (errEl) { errEl.textContent = 'Erreur : ' + err.message; errEl.style.display = 'block'; }
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> Créer et lier';
      }
    });
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
      b.addEventListener('click', () => exportXlsx());
    });
    const del = document.querySelector('[data-v30-besoin-delete]');
    if (del) del.addEventListener('click', doDelete);
    const save = document.querySelector('[data-v30-besoin-save]');
    if (save) save.addEventListener('click', () => { state.dirty = true; saveAuto(); });
    updateSaveButton();
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
    bindCreateCandModal();
    load();

    // Ctrl+S = save
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        state.dirty = true;
        saveAuto();
      }
    });

    // Avertir si l'utilisateur quitte avec des modifications non sauvegardées
    window.addEventListener('beforeunload', (e) => {
      if (state.dirty || state.saving) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
