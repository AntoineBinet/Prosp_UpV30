// Page fiche candidat — v10.1 : vue lecture / édition + auto-save ; v25 : onglets EC1/note libre + timeline

let __cand = null;
let __skills = [];
let __companies = [];
let __autoSaveTimer = null;
let __editMode = false;

// ═══ Onglets candidat (EC1 + note libre) ═══
let __candidateTabs = [];
let __activeTabIndex = 0;
let __candidateTabsSaveTimer = null;

const EC1_CHECKLIST_ITEMS_UI = [
  { key: 'mobilite_dispo_souhaits', label: 'Infos mobilité, disponibilité, souhaits' },
  { key: 'impression_generale', label: 'Impression générale du candidat' },
  { key: 'evaluation_technique', label: 'Évaluation technique' },
  { key: 'evaluation_personnalite', label: 'Évaluation personnalité' },
  { key: 'evaluation_communication', label: 'Évaluation communication' },
  { key: 'rappel_valeurs_up', label: 'Rappel des valeurs UpTechnologie' },
  { key: 'fourchette_salaire', label: 'Annonce fourchette salariale' },
  { key: 'reponse_questions_craintes', label: 'Réponse aux questions/craintes du candidat' },
  { key: 'process_prochaines_etapes', label: 'Détail du process et des prochaines étapes' },
];

function blankEC1Data() {
  const d = {};
  EC1_CHECKLIST_ITEMS_UI.forEach(it => { d[it.key] = { checked: false, note: '' }; });
  d.__note = '';
  return d;
}

function normalizeDateTimeLocal(v) {
  const s = safeStr(v).trim();
  if (!s) return '';
  let out = s.replace(' ', 'T');
  if (out.length >= 19) out = out.slice(0, 16);
  if (out.length === 16) return out;
  if (out.length >= 10) return out.slice(0, 10) + 'T09:00';
  return '';
}

async function loadCandidateTabs() {
  if (!__cand?.id) return;
  try {
    const res = await fetch(`/api/candidate-tabs?candidate_id=${__cand.id}`);
    const j = await res.json();
    if (!j?.ok) throw new Error('API');
    __candidateTabs = Array.isArray(j.tabs) ? j.tabs : [];
    if (__candidateTabs.length === 0) {
      __candidateTabs = [{ id: null, type: 'ec1', title: 'EC1', payload: { interviewAt: null, data: blankEC1Data() }, sort_order: 0 }];
    }
    __activeTabIndex = 0;
    renderCandidateTabs();
  } catch (e) {
    console.error('Candidate tabs load error', e);
    __candidateTabs = [{ id: null, type: 'ec1', title: 'EC1', payload: { interviewAt: null, data: blankEC1Data() }, sort_order: 0 }];
    __activeTabIndex = 0;
    renderCandidateTabs();
  }
}

function getActiveTab() {
  return __candidateTabs[__activeTabIndex] || null;
}

function collectTabPayloadFromDOM(tab) {
  if (!tab) return null;
  const panelId = 'candidateTabPanel_' + (tab.id != null ? String(tab.id) : 'v' + __activeTabIndex);
  const panel = document.getElementById(panelId);
  if (!panel) return tab.payload;
  if (tab.type === 'ec1') {
    const data = tab.payload && tab.payload.data ? { ...tab.payload.data } : blankEC1Data();
    const dt = panel.querySelector('.ec1-datetime');
    const noteEl = panel.querySelector('.ec1-note-textarea');
    data.__note = noteEl ? noteEl.value || '' : (data.__note || '');
    EC1_CHECKLIST_ITEMS_UI.forEach(it => {
      const chk = panel.querySelector('#ec1_chk_' + it.key);
      const inp = panel.querySelector('#ec1_note_' + it.key);
      data[it.key] = { checked: !!(chk && chk.checked), note: inp ? safeStr(inp.value) : '' };
    });
    return { interviewAt: (dt && dt.value) ? dt.value : null, data };
  }
  if (tab.type === 'note_libre') {
    const ta = panel.querySelector('.note-libre-textarea');
    return { content: ta ? ta.value || '' : '' };
  }
  return tab.payload;
}

function renderCandidateTabs() {
  const bar = document.getElementById('candidateTabsBar');
  const panelsWrap = document.getElementById('candidateTabsPanels');
  if (!bar || !panelsWrap) return;

  bar.innerHTML = __candidateTabs.map((tab, idx) => {
    const active = idx === __activeTabIndex ? ' active' : '';
    const id = tab.id != null ? tab.id : 'v' + idx;
    return `<button type="button" class="candidate-tab-btn${active}" data-tab-index="${idx}" data-tab-id="${id}">${escapeHtml(tab.title || 'Onglet')}</button>`;
  }).join('');

  panelsWrap.innerHTML = __candidateTabs.map((tab, idx) => {
    const id = tab.id != null ? tab.id : 'v' + idx;
    const show = idx === __activeTabIndex ? '' : ' display:none;';
    if (tab.type === 'ec1') {
      const pl = tab.payload || {};
      const data = (pl.data && typeof pl.data === 'object') ? pl.data : blankEC1Data();
      const interviewAt = normalizeDateTimeLocal(pl.interviewAt || '');
      const rows = EC1_CHECKLIST_ITEMS_UI.map(it => {
        const row = data[it.key] || { checked: false, note: '' };
        return `
          <div class="ec1-row">
            <label class="ec1-left">
              <input type="checkbox" id="ec1_chk_${it.key}" ${row.checked ? 'checked' : ''}>
              <span>${escapeHtml(it.label)}</span>
            </label>
            <input class="ec1-note" type="text" id="ec1_note_${it.key}" placeholder="Note..." value="${escapeHtml(row.note || '')}" />
          </div>`;
      }).join('');
      return `
        <div class="candidate-tab-panel" id="candidateTabPanel_${id}" data-tab-index="${idx}" style="${show}">
          <div class="candidate-tab-panel-inner">
            <div class="form-row">
              <div class="form-group" style="flex:1 1 320px;">
                <label>📅 Date & heure de l'entretien (remonte dans le Calendrier)</label>
                <input class="ec1-datetime" type="datetime-local" value="${escapeHtml(interviewAt)}" />
              </div>
            </div>
            <div class="ec1-checklist">${rows}</div>
            <div class="form-group" style="margin-top:12px;">
              <label>📝 Note (EC1)</label>
              <textarea class="ec1-note-textarea" rows="4" placeholder="Résumé, points forts, points de vigilance…">${escapeHtml(data.__note || '')}</textarea>
            </div>
            <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:12px;">
              <button type="button" class="btn btn-secondary" onclick="resetCurrentEC1Tab()">↩️ Réinitialiser</button>
              <button type="button" class="btn btn-primary" onclick="saveCurrentTab(true)">💾 Sauver</button>
            </div>
          </div>
        </div>`;
    }
    const content = (tab.payload && tab.payload.content != null) ? tab.payload.content : '';
    return `
      <div class="candidate-tab-panel" id="candidateTabPanel_${id}" data-tab-index="${idx}" style="${show}">
        <div class="candidate-tab-panel-inner">
          <label>📝 Note libre</label>
          <textarea class="note-libre-textarea" rows="8" placeholder="Saisissez votre note…">${escapeHtml(content)}</textarea>
          <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:12px;">
            <button type="button" class="btn btn-primary" onclick="saveCurrentTab(true)">💾 Sauver</button>
          </div>
        </div>
      </div>`;
  }).join('');

  bar.querySelectorAll('.candidate-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-tab-index'), 10);
      if (Number.isFinite(idx) && idx !== __activeTabIndex) switchCandidateTab(idx);
    });
  });

  panelsWrap.querySelectorAll('.ec1-datetime, .ec1-note-textarea, .ec1-chk, .ec1-note').forEach(el => {
    if (el.classList && el.classList.contains('ec1-datetime')) {
      el.addEventListener('change', () => scheduleCurrentTabSave());
    } else if (el.classList && (el.classList.contains('ec1-note-textarea') || el.classList.contains('ec1-note'))) {
      el.addEventListener('input', () => scheduleCurrentTabSave());
    }
  });
  panelsWrap.querySelectorAll('.ec1-row input[type="checkbox"]').forEach(chk => {
    chk.addEventListener('change', () => scheduleCurrentTabSave());
  });
  panelsWrap.querySelectorAll('.note-libre-textarea').forEach(ta => {
    ta.addEventListener('input', () => scheduleCurrentTabSave());
  });
}

function switchCandidateTab(toIndex) {
  const tab = __candidateTabs[__activeTabIndex];
  if (tab) {
    const payload = collectTabPayloadFromDOM(tab);
    if (payload) __candidateTabs[__activeTabIndex] = { ...tab, payload };
  }
  __activeTabIndex = Math.max(0, Math.min(toIndex, __candidateTabs.length - 1));
  renderCandidateTabs();
}

function scheduleCurrentTabSave(immediate) {
  if (__candidateTabsSaveTimer) clearTimeout(__candidateTabsSaveTimer);
  __candidateTabsSaveTimer = setTimeout(() => saveCurrentTab(false), immediate ? 0 : 900);
}

async function saveCurrentTab(showToastOnSuccess) {
  const tab = getActiveTab();
  if (!tab || !__cand?.id) return;
  const payload = collectTabPayloadFromDOM(tab);
  if (payload) __candidateTabs[__activeTabIndex] = { ...tab, payload };

  if (tab.id == null) {
    try {
      const res = await fetch('/api/candidate-tabs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidate_id: __cand.id, type: tab.type, title: tab.title || 'EC1' })
      });
      const j = await res.json();
      if (!j?.ok || !j.tab) throw new Error(j.error || 'API');
      __candidateTabs[__activeTabIndex] = { ...j.tab, payload };
      const tabId = j.tab.id;
      const putRes = await fetch('/api/candidate-tabs/' + tabId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: __candidateTabs[__activeTabIndex].payload })
      });
      if (!putRes.ok) throw new Error(await putRes.text().catch(() => 'PUT failed'));
      __candidateTabs[__activeTabIndex].id = tabId;
      if (showToastOnSuccess && typeof showToast === 'function') showToast('✅ Onglet créé et sauvegardé', 'success');
    } catch (e) {
      console.error('Tab create/save error', e);
      if (typeof showToast === 'function') showToast('❌ Erreur sauvegarde', 'error');
    }
    return;
  }

  try {
    const res = await fetch('/api/candidate-tabs/' + tab.id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: __candidateTabs[__activeTabIndex].payload })
    });
    if (!res.ok) throw new Error(await res.text().catch(() => 'HTTP ' + res.status));
    if (showToastOnSuccess && typeof showToast === 'function') showToast('✅ Sauvegardé', 'success');
  } catch (e) {
    console.error('Tab save error', e);
    if (typeof showToast === 'function') showToast('❌ Erreur sauvegarde', 'error');
  }
}

function resetCurrentEC1Tab() {
  if (!confirm('↩️ Réinitialiser ce formulaire EC1 ?')) return;
  const tab = getActiveTab();
  if (!tab || tab.type !== 'ec1') return;
  __candidateTabs[__activeTabIndex] = { ...tab, payload: { interviewAt: null, data: blankEC1Data() } };
  renderCandidateTabs();
  scheduleCurrentTabSave(true);
}

function openNewTabModal() {
  const modal = document.getElementById('modalNewCandidateTab');
  if (modal) {
    modal.classList.add('active');
    if (typeof window.openModal === 'function') window.openModal(modal);
  }
}

function closeNewTabModal() {
  const modal = document.getElementById('modalNewCandidateTab');
  if (modal) {
    modal.classList.remove('active');
    if (typeof window.closeModal === 'function') window.closeModal(modal);
  }
}

async function createNewTab(type) {
  closeNewTabModal();
  if (!__cand?.id) return;
  try {
    const res = await fetch('/api/candidate-tabs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidate_id: __cand.id,
        type,
        title: type === 'ec1' ? 'EC1' : 'Note'
      })
    });
    const j = await res.json();
    if (!j?.ok || !j.tab) throw new Error(j.error || 'API');
    __candidateTabs.push(j.tab);
    __activeTabIndex = __candidateTabs.length - 1;
    renderCandidateTabs();
    if (typeof showToast === 'function') showToast('✅ Nouvel onglet créé', 'success');
  } catch (e) {
    console.error('Create tab error', e);
    if (typeof showToast === 'function') showToast('❌ Erreur création onglet', 'error');
  }
}

window.saveCurrentTab = saveCurrentTab;
window.resetCurrentEC1Tab = resetCurrentEC1Tab;
window.openNewTabModal = openNewTabModal;
window.closeNewTabModal = closeNewTabModal;
window.createNewTab = createNewTab;

// ═══ Timeline candidat ═══
async function loadCandidateTimeline() {
  const listEl = document.getElementById('candidateTimelineList');
  if (!listEl || !__cand?.id) return;
  try {
    const res = await fetch(`/api/candidate/timeline?id=${__cand.id}`);
    const j = await res.json();
    if (!j?.ok) {
      listEl.innerHTML = '<div class="muted" style="text-align:center;padding:14px;">Aucun événement</div>';
      return;
    }
    const events = Array.isArray(j.events) ? j.events : [];
    renderCandidateTimeline(events, listEl);
  } catch (e) {
    console.error('Timeline load error', e);
    listEl.innerHTML = '<div class="muted" style="text-align:center;padding:14px;">Impossible de charger la timeline</div>';
  }
}

function renderCandidateTimeline(events, listEl) {
  if (!listEl) return;
  if (events.length === 0) {
    listEl.innerHTML = '<div class="muted" style="text-align:center;padding:14px;">Aucun événement</div>';
    return;
  }
  listEl.innerHTML = events.map(ev => {
    const date = (ev.date || '').slice(0, 19).replace('T', ' ');
    const title = escapeHtml(ev.title || ev.type || '');
    const content = (ev.content || '').trim().split('\n').map(l => escapeHtml(l)).join('<br>');
    return `<div class="timeline-item"><div class="timeline-date">${escapeHtml(date)}</div><div class="timeline-title">${title}</div>${content ? `<div class="timeline-content">${content}</div>` : ''}</div>`;
  }).join('');
}

async function addCandidateTimelineEvent() {
  const title = (prompt('Titre de l\'événement') || '').trim() || 'Événement';
  const content = (prompt('Contenu (optionnel)') || '').trim();
  if (!__cand?.id) return;
  try {
    const res = await fetch('/api/candidate/events/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidate_id: __cand.id, title, content })
    });
    const j = await res.json();
    if (!j?.ok) throw new Error(j.error || 'API');
    if (typeof showToast === 'function') showToast('✅ Événement ajouté', 'success');
    await loadCandidateTimeline();
  } catch (e) {
    console.error('Add timeline event error', e);
    if (typeof showToast === 'function') showToast('❌ Erreur', 'error');
  }
}

// safeStr() and escapeHtml() are provided by app.js

function getCandidateId() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id') || params.get('candidate') || '';
  const n = parseInt(id, 10);
  return Number.isFinite(n) ? n : null;
}

function parseSkillInput(raw) {
  const s = safeStr(raw).trim();
  if (!s) return [];
  return s.split(',').map(x => x.trim()).filter(Boolean);
}

function uniqCaseInsensitive(arr) {
  const out = [];
  const seen = new Set();
  arr.forEach(x => {
    const v = safeStr(x).trim();
    if (!v) return;
    const k = v.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(v);
  });
  return out;
}

// ═══ Status helpers ═══

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

function statusBadgeClass(s) {
    const v = (s || '').toLowerCase();
    if (v === 'mission') return 'badge badge-success';
    if (v === 'embauche') return 'badge badge-success';
    if (v === 'interesse' || v === 'ec1' || v === 'ec2' || v === 'ed') return 'badge badge-warning';
    if (v === 'refuse' || v === 'archive') return 'badge badge-danger';
    return 'badge';
}

// ═══ View mode rendering ═══

// ═══ Inline field editing ═══

// Mapping: cand key → { formId, type }
const _INLINE_FIELD_MAP = {
    status:               { formId: 'fStatus',               type: 'status' },
    role:                 { formId: 'fRole',                  type: 'text' },
    location:             { formId: 'fLocation',              type: 'text' },
    years_experience:     { formId: 'fYearsExperience',       type: 'number' },
    seniority:            { formId: 'fSeniority',             type: 'text' },
    sector:               { formId: 'fSector',                type: 'text' },
    source:               { formId: 'fSource',                type: 'text' },
    tech:                 { formId: 'fTech',                  type: 'text' },
    phone:                { formId: 'fPhone',                 type: 'tel' },
    email:                { formId: 'fEmail',                 type: 'email' },
    linkedin:             { formId: 'fLinkedIn',              type: 'text' },
    onenote_url:          { formId: 'fOneNote',               type: 'text' },
    vsa_url:              { formId: 'fVSA',                   type: 'text' },
    disponibilite:        { formId: 'fDisponibilite',         type: 'text' },
    mobilite:             { formId: 'fMobilite',              type: 'text' },
    permis_travail:       { formId: 'fPermisTravail',         type: 'text' },
    fonctions_recherchees:{ formId: 'fFonctionsRecherchees',  type: 'text' },
    avancement_recherches:{ formId: 'fAvancementRecherches',  type: 'text' },
    motif_recherche:      { formId: 'fMotifRecherche',        type: 'textarea' },
    remuneration_actuelle:{ formId: 'fRemunerationActuelle',  type: 'text' },
    pretentions_salariales:{ formId: 'fPretentionsSalariales',type: 'text' },
    propal_a:             { formId: 'fPropalA',               type: 'text' },
    eval_technique:       { formId: 'fEvalTechnique',         type: 'text' },
    eval_personnalite:    { formId: 'fEvalPersonnalite',      type: 'text' },
    eval_communication:   { formId: 'fEvalCommunication',     type: 'text' },
    langues:              { formId: 'fLangues',               type: 'text' },
    references_candidat:  { formId: 'fReferencesCandidats',   type: 'textarea' },
    avis_perso:           { formId: 'fAvisPerso',             type: 'textarea' },
};

function _buildStatusSelect(current) {
    const opts = [
        ['nouveau','Nouveau / A traiter'],['proposition','Proposition faite'],
        ['entretien','Entretien en cours'],['a_faire','A FAIRE'],['oksi','OKSI'],
        ['top_profil','Top profil'],['reunion_tech','En Réunion Technique'],
        ['valide_contrat','Validé / Contrat'],['freelance','Freelance'],
        ['freelance_mission','FREELANCE EN MISSION UP'],
        ['nok_prequal','NOK Préqual'],['nok','NOK'],
        ['plus_disponible','Plus disponible'],['refus_contrat','Refus du contrat'],
    ];
    return `<select id="cand-inline-input" style="flex:1;min-width:0;">${opts.map(([v,l])=>`<option value="${v}"${v===current?' selected':''}>${l}</option>`).join('')}</select>`;
}

function startInlineEdit(key) {
    const map = _INLINE_FIELD_MAP[key];
    if (!map || !__cand) return;
    const valEl = document.getElementById('cand-val-' + key);
    if (!valEl || valEl.querySelector('#cand-inline-input')) return; // already editing

    const rawVal = __cand[key] != null ? String(__cand[key]) : '';
    let inputHtml;
    if (map.type === 'status') {
        inputHtml = _buildStatusSelect(rawVal);
    } else if (map.type === 'textarea') {
        inputHtml = `<textarea id="cand-inline-input" rows="3" style="flex:1;min-width:0;resize:vertical;">${escapeHtml(rawVal)}</textarea>`;
    } else {
        inputHtml = `<input id="cand-inline-input" type="${map.type}" value="${escapeHtml(rawVal)}" style="flex:1;min-width:0;" />`;
    }

    valEl.innerHTML = `<div style="display:flex;gap:6px;align-items:flex-start;width:100%;">
        ${inputHtml}
        <button class="btn btn-primary btn-sm" onclick="saveInlineEdit('${key}')" style="flex-shrink:0;">✓</button>
        <button class="btn btn-secondary btn-sm" onclick="renderViewMode()" style="flex-shrink:0;">✕</button>
    </div>`;

    const inp = document.getElementById('cand-inline-input');
    if (inp) {
        inp.focus();
        if (inp.tagName !== 'SELECT' && inp.tagName !== 'TEXTAREA') inp.select?.();
        inp.addEventListener('keydown', e => {
            if (e.key === 'Enter' && inp.tagName !== 'TEXTAREA') { e.preventDefault(); saveInlineEdit(key); }
            if (e.key === 'Escape') renderViewMode();
        });
    }
}

function startInlineEditPermis() {
    const valEl = document.getElementById('cand-val-permis');
    if (!valEl || valEl.querySelector('#cand-inline-permis')) return;
    const pc = !!__cand.permis_conduire;
    const vh = !!__cand.vehicule;
    valEl.innerHTML = `<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
        <label style="display:flex;align-items:center;gap:4px;font-weight:400;cursor:pointer;">
            <input type="checkbox" id="cand-inline-permis" ${pc?'checked':''} /> Permis de conduire
        </label>
        <label style="display:flex;align-items:center;gap:4px;font-weight:400;cursor:pointer;">
            <input type="checkbox" id="cand-inline-vehicule" ${vh?'checked':''} /> Véhicule
        </label>
        <button class="btn btn-primary btn-sm" onclick="saveInlineEditPermis()">✓</button>
        <button class="btn btn-secondary btn-sm" onclick="renderViewMode()">✕</button>
    </div>`;
}

function saveInlineEditPermis() {
    const pcEl = document.getElementById('cand-inline-permis');
    const vhEl = document.getElementById('cand-inline-vehicule');
    if (!pcEl) return;
    __cand.permis_conduire = pcEl.checked ? 1 : 0;
    __cand.vehicule = vhEl?.checked ? 1 : 0;
    const fPC = document.getElementById('fPermisConduire');
    const fVH = document.getElementById('fVehicule');
    if (fPC) fPC.checked = !!__cand.permis_conduire;
    if (fVH) fVH.checked = !!__cand.vehicule;
    triggerAutoSave(true);
    renderViewMode();
}

function saveInlineEdit(key) {
    const map = _INLINE_FIELD_MAP[key];
    const inp = document.getElementById('cand-inline-input');
    if (!inp || !map) return;
    let newVal = inp.value.trim();
    if (map.type === 'number') {
        const n = parseInt(newVal);
        __cand[key] = isNaN(n) ? null : n;
    } else {
        __cand[key] = newVal || null;
    }
    const formEl = document.getElementById(map.formId);
    if (formEl) formEl.value = newVal;
    triggerAutoSave(true);
    renderViewMode();
}

function _editBtn(key, label) {
    return `<button class="cand-edit-btn" onclick="startInlineEdit('${key}')" title="Modifier ${label}" aria-label="Modifier ${label}">✏️</button>`;
}

function _makeRow(key, label, valueHtml) {
    return `<div class="cand-view-row" id="cand-row-${key}">
        <div class="cand-view-label">${label}</div>
        <div class="cand-view-value" id="cand-val-${key}">${valueHtml}</div>
        ${_editBtn(key, label)}
    </div>`;
}

// ═══ View mode rendering ═══

function renderViewMode() {
    if (!__cand) return;
    const grid = document.getElementById('viewGrid');
    const viewSkills = document.getElementById('viewSkills');
    const archiveBtn = document.getElementById('btnArchiveView');

    // Info grid — always-visible fields
    let gridHtml = '';
    gridHtml += _makeRow('status', 'Statut', `<span class="${statusBadgeClass(__cand.status)}">${escapeHtml(candStatusLabel(__cand.status))}</span>`);
    gridHtml += _makeRow('role', 'Rôle', escapeHtml(__cand.role || '—'));
    gridHtml += _makeRow('location', 'Localisation', escapeHtml(__cand.location || '—'));
    const expVal = __cand.years_experience ? `${__cand.years_experience} ans` : escapeHtml(__cand.seniority || '—');
    gridHtml += _makeRow('years_experience', 'Expérience', expVal);
    gridHtml += _makeRow('sector', 'Secteur', escapeHtml(__cand.sector || '—'));
    gridHtml += _makeRow('source', 'Source', escapeHtml(__cand.source || '—'));
    gridHtml += _makeRow('tech', 'Tech', escapeHtml(__cand.tech || '—'));
    if (__cand.phone) {
        gridHtml += _makeRow('phone', 'Téléphone', `<a href="tel:${escapeHtml(__cand.phone)}">${escapeHtml(__cand.phone)}</a>`);
    }
    if (__cand.email) {
        const esc = escapeHtml(__cand.email).replace(/'/g, "\\'");
        gridHtml += _makeRow('email', 'Email', `<a href="javascript:void(0)" onclick="copyEmailToClipboard('${esc}')" title="Copier l'email" style="cursor:pointer;">${escapeHtml(__cand.email)}</a>`);
    }
    if (__cand.linkedin) {
        gridHtml += _makeRow('linkedin', 'LinkedIn', `<a href="${escapeHtml(__cand.linkedin)}" target="_blank" style="word-break:break-all;">${escapeHtml(__cand.linkedin)}</a>`);
    }
    if (__cand.onenote_url) {
        gridHtml += _makeRow('onenote_url', 'OneNote', `<a href="${escapeHtml(__cand.onenote_url)}" target="_blank" style="word-break:break-all;">${escapeHtml(__cand.onenote_url)}</a>`);
    }
    if (__cand.vsa_url) {
        gridHtml += _makeRow('vsa_url', 'VSA', `<a href="${escapeHtml(__cand.vsa_url)}" target="_blank" style="word-break:break-all;">${escapeHtml(__cand.vsa_url)}</a>`);
    }
    if (grid) grid.innerHTML = gridHtml;

    // Skills / Tags
    if (viewSkills) {
        if (__skills.length === 0) {
            viewSkills.innerHTML = '<div class="muted" style="font-size:12px;">Aucun tag renseigné — analysez un DC pour les extraire automatiquement.</div>';
        } else {
            viewSkills.innerHTML = __skills.map(s => `<span class="chip">${escapeHtml(s)}</span>`).join('');
        }
    }

    // DC indicator (async, non-bloquant)
    loadCandidateDcStatus();

    // ═══ Données entretien ═══
    const entretienGrid = document.getElementById('viewEntretienGrid');
    const viewEntretienSection = document.getElementById('viewEntretienSection');

    // Permis/Véhicule : seulement si au moins un est à 1 (explicitement coché)
    const hasPermis = __cand.permis_conduire === 1 || __cand.vehicule === 1;
    const permisDisplay = [
        __cand.permis_conduire === 1 ? '✅ Permis' : null,
        __cand.vehicule === 1 ? '✅ Véhicule' : null,
    ].filter(Boolean).join(' · ') || '—';

    const entretienFields = [
        __cand.disponibilite         ? { key: 'disponibilite',         label: 'Disponibilité',       val: escapeHtml(__cand.disponibilite) } : null,
        __cand.mobilite              ? { key: 'mobilite',              label: 'Mobilité',             val: escapeHtml(__cand.mobilite) } : null,
        hasPermis                    ? { key: '_permis',               label: 'Permis / Véhicule',    val: permisDisplay, special: 'permis' } : null,
        __cand.permis_travail        ? { key: 'permis_travail',        label: 'Permis de travail',    val: escapeHtml(__cand.permis_travail) } : null,
        __cand.fonctions_recherchees ? { key: 'fonctions_recherchees', label: 'Fonctions recherchées',val: escapeHtml(__cand.fonctions_recherchees) } : null,
        __cand.motif_recherche       ? { key: 'motif_recherche',       label: 'Motif de recherche',   val: escapeHtml(__cand.motif_recherche) } : null,
        __cand.avancement_recherches ? { key: 'avancement_recherches', label: 'Avancement',           val: escapeHtml(__cand.avancement_recherches) } : null,
        __cand.remuneration_actuelle ? { key: 'remuneration_actuelle', label: 'Rémunération actuelle',val: escapeHtml(__cand.remuneration_actuelle) } : null,
        __cand.pretentions_salariales? { key: 'pretentions_salariales',label: 'Prétentions',          val: escapeHtml(__cand.pretentions_salariales) } : null,
        __cand.propal_a              ? { key: 'propal_a',              label: 'Propal à',             val: escapeHtml(__cand.propal_a) } : null,
        __cand.langues               ? { key: 'langues',               label: 'Langues',              val: escapeHtml(__cand.langues) } : null,
    ].filter(Boolean);

    const evalFields = [
        __cand.eval_technique    ? { key: 'eval_technique',    label: 'Technique',    val: escapeHtml(__cand.eval_technique) } : null,
        __cand.eval_personnalite ? { key: 'eval_personnalite', label: 'Personnalité', val: escapeHtml(__cand.eval_personnalite) } : null,
        __cand.eval_communication? { key: 'eval_communication',label: 'Communication',val: escapeHtml(__cand.eval_communication) } : null,
    ].filter(Boolean);

    const hasEntretien = entretienFields.length > 0 || evalFields.length > 0 || __cand.references_candidat || __cand.avis_perso;

    if (viewEntretienSection) viewEntretienSection.style.display = '';
    // Zone d'import : visible quand vide, compacte quand données présentes
    const ficheZone = document.getElementById('ficheEntretienZone');
    if (ficheZone) ficheZone.style.display = hasEntretien ? 'none' : '';
    if (entretienGrid && hasEntretien) {
        entretienGrid.innerHTML = entretienFields.map(f => {
            if (f.special === 'permis') {
                return `<div class="cand-view-row" id="cand-row-_permis">
                    <div class="cand-view-label">${f.label}</div>
                    <div class="cand-view-value" id="cand-val-permis">${f.val}</div>
                    <button class="cand-edit-btn" onclick="startInlineEditPermis()" title="Modifier permis/véhicule">✏️</button>
                </div>`;
            }
            return _makeRow(f.key, f.label, f.val);
        }).join('');
    }

    const evalSection = document.getElementById('viewEvalSection');
    const evalGrid = document.getElementById('viewEvalGrid');
    if (evalGrid) {
        if (evalFields.length > 0) {
            evalGrid.innerHTML = evalFields.map(f => _makeRow(f.key, f.label, f.val)).join('');
            if (evalSection) evalSection.style.display = '';
        } else {
            if (evalSection) evalSection.style.display = 'none';
        }
    }

    const refSection = document.getElementById('viewRefSection');
    const refContent = document.getElementById('viewRefContent');
    if (refContent) {
        if (__cand.references_candidat) {
            if (refSection) refSection.style.display = '';
            refContent.innerHTML = `<div style="display:flex;gap:8px;align-items:flex-start;">
                <div id="cand-val-references_candidat" style="flex:1;white-space:pre-wrap;">${escapeHtml(__cand.references_candidat)}</div>
                <button class="cand-edit-btn" onclick="startInlineEdit('references_candidat')" title="Modifier références">✏️</button>
            </div>`;
        } else {
            if (refSection) refSection.style.display = 'none';
        }
    }

    const avisSection = document.getElementById('viewAvisPersoSection');
    const avisContent = document.getElementById('viewAvisPersoContent');
    if (avisContent) {
        if (__cand.avis_perso) {
            if (avisSection) avisSection.style.display = '';
            avisContent.innerHTML = `<div style="display:flex;gap:8px;align-items:flex-start;">
                <div id="cand-val-avis_perso" style="flex:1;white-space:pre-wrap;">${escapeHtml(__cand.avis_perso)}</div>
                <button class="cand-edit-btn" onclick="startInlineEdit('avis_perso')" title="Modifier avis perso">✏️</button>
            </div>`;
        } else {
            if (avisSection) avisSection.style.display = 'none';
        }
    }

    // Archive btn label
    if (archiveBtn) {
        if (__cand.is_archived || safeStr(__cand.status).toLowerCase() === 'archive') {
            archiveBtn.textContent = '♻️ Désarchiver';
            archiveBtn.onclick = unarchiveCandidate;
        } else {
            archiveBtn.textContent = '📦 Archiver';
            archiveBtn.onclick = archiveCandidate;
        }
    }

    // Load structured data
    loadCandidateStructuredData();
}

// ═══ DC (Dossier de Compétences) status + upload ═══

async function loadCandidateDcStatus() {
    const el = document.getElementById('viewDcIndicator');
    if (!el || !__cand?.id) return;
    try {
        const res = await fetch(`/api/candidates/${__cand.id}/dc-status`);
        const j = await res.json();
        if (!j?.ok) { el.innerHTML = '<span class="muted">Statut DC indisponible.</span>'; return; }
        if (j.has_dc) {
            const fileLinks = (j.files || []).map(f => {
                const url = `/api/candidates/${__cand.id}/dossier-competence`;
                return `<a href="${url}" target="_blank" class="btn btn-secondary btn-sm" style="font-size:12px;margin-left:8px;">⬇️ Télécharger${j.files.length > 1 ? ' (' + escapeHtml(f) + ')' : ''}</a>`;
            }).join('');
            const firstName = j.files[0] || '';
            el.innerHTML = `<span class="badge badge-success" style="font-size:12px;">✅ DC disponible</span>${fileLinks}<button class="btn btn-secondary btn-sm" style="font-size:12px;margin-left:8px;" onclick="openDcRenameInline(this,'${escapeHtml(firstName).replace(/'/g,"\\'")}')">✏️ Renommer</button><button class="btn btn-secondary btn-sm" style="font-size:12px;margin-left:8px;" onclick="openDcUploadModal()">🔄 Remplacer</button><button class="btn btn-danger btn-sm" style="font-size:12px;margin-left:8px;" onclick="deleteDcFile()">🗑️ Supprimer</button>`;
        } else {
            el.innerHTML = `<span class="badge" style="background:rgba(245,158,11,.15);color:#f59e0b;font-size:12px;">⚠ DC manquant</span>
                <button class="btn btn-secondary btn-sm" style="font-size:12px;margin-left:8px;" onclick="openDcUploadModal()">➕ Ajouter le DC</button>`;
        }
    } catch (e) {
        el.innerHTML = '<span class="muted">Statut DC indisponible.</span>';
    }
}

function openDcRenameInline(btn, currentName) {
    const container = btn.parentElement;
    const sanitized = currentName.replace(/\.pdf$/i, '');
    btn.replaceWith((() => {
        const wrap = document.createElement('span');
        wrap.style.cssText = 'display:inline-flex;align-items:center;gap:4px;margin-left:8px;';
        wrap.innerHTML = `
            <input id="dcRenameInput" value="${escapeHtml(sanitized)}" style="font-size:12px;padding:2px 6px;border-radius:4px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);width:220px;" />
            <button class="btn btn-primary btn-sm" id="dcRenameSaveBtn" style="font-size:12px;">✅</button>
            <button class="btn btn-secondary btn-sm" id="dcRenameCancelBtn" style="font-size:12px;">✕</button>`;
        return wrap;
    })());
    const inp = document.getElementById('dcRenameInput');
    const saveBtn = document.getElementById('dcRenameSaveBtn');
    const cancelBtn = document.getElementById('dcRenameCancelBtn');
    inp?.focus();
    inp?.select();
    async function doRename() {
        const newName = (inp?.value || '').trim();
        if (!newName) return;
        saveBtn.disabled = true;
        try {
            const res = await fetch(`/api/candidates/${__cand.id}/dc-rename`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ new_name: newName })
            });
            const j = await res.json();
            if (j.ok) {
                if (typeof showToast === 'function') showToast('Fichier DC renommé : ' + j.filename, 'success');
                loadCandidateDcStatus();
            } else {
                if (typeof showToast === 'function') showToast('Erreur : ' + (j.error || 'Renommage échoué'), 'error');
                saveBtn.disabled = false;
            }
        } catch (e) {
            if (typeof showToast === 'function') showToast('Erreur réseau', 'error');
            saveBtn.disabled = false;
        }
    }
    saveBtn?.addEventListener('click', doRename);
    cancelBtn?.addEventListener('click', () => loadCandidateDcStatus());
    inp?.addEventListener('keydown', e => {
        if (e.key === 'Enter') doRename();
        if (e.key === 'Escape') loadCandidateDcStatus();
    });
}

let __dcUploadFile = null;

function openDcUploadModal() {
    __dcUploadFile = null;
    const fn = document.getElementById('dcUploadFileName');
    const inp = document.getElementById('dcUploadFile');
    const btn = document.getElementById('dcUploadBtnSave');
    if (fn) { fn.style.display = 'none'; fn.textContent = ''; }
    if (inp) inp.value = '';
    if (btn) btn.disabled = true;
    const modal = document.getElementById('modalUploadDc');
    if (!modal) return;
    if (window.openModal) window.openModal(modal);
    else modal.classList.add('active');
}

function closeDcUploadModal() {
    const modal = document.getElementById('modalUploadDc');
    if (!modal) return;
    if (window.closeModal) window.closeModal(modal);
    else modal.classList.remove('active');
    __dcUploadFile = null;
}

function dcUploadOnFileChange(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    __dcUploadFile = file;
    const fn = document.getElementById('dcUploadFileName');
    if (fn) { fn.textContent = '📄 ' + file.name; fn.style.display = 'block'; }
    const btn = document.getElementById('dcUploadBtnSave');
    if (btn) btn.disabled = false;
}

function dcUploadHandleDrop(event) {
    event.preventDefault();
    document.getElementById('dcUploadDrop')?.classList.remove('dragging');
    const file = event.dataTransfer?.files?.[0];
    if (!file || !file.name.toLowerCase().endsWith('.pdf')) {
        if (typeof showToast === 'function') showToast('Veuillez déposer un fichier PDF', 'warning');
        return;
    }
    __dcUploadFile = file;
    const fn = document.getElementById('dcUploadFileName');
    if (fn) { fn.textContent = '📄 ' + file.name; fn.style.display = 'block'; }
    const btn = document.getElementById('dcUploadBtnSave');
    if (btn) btn.disabled = false;
}

async function saveDcUpload() {
    if (!__dcUploadFile || !__cand?.id) return;
    const btn = document.getElementById('dcUploadBtnSave');
    const orig = btn?.innerHTML; if (btn) { btn.disabled = true; btn.innerHTML = 'Envoi…'; }
    try {
        const fd = new FormData();
        fd.append('dc', __dcUploadFile);
        fd.append('candidate_id', __cand.id);
        const res = await fetch('/api/candidates/upload-dc', { method: 'POST', body: fd });
        if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            if (typeof showToast === 'function') showToast('Erreur : ' + (j.error || res.status), 'error');
            return;
        }
        if (typeof showToast === 'function') showToast('✅ DC enregistré', 'success');
        closeDcUploadModal();
        loadCandidateDcStatus();
    } catch (e) {
        if (typeof showToast === 'function') showToast('Erreur réseau : ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = orig; }
    }
}

async function deleteDcFile() {
    if (!__cand?.id) return;
    if (!confirm('Supprimer définitivement le dossier de compétences ? Cette action est irréversible.')) return;
    try {
        const res = await fetch(`/api/candidates/${__cand.id}/dc-delete`, { method: 'POST' });
        const j = await res.json();
        if (j.ok) {
            if (typeof showToast === 'function') showToast('Dossier de compétences supprimé', 'success');
            loadCandidateDcStatus();
        } else {
            if (typeof showToast === 'function') showToast('Erreur : ' + (j.error || 'Suppression échouée'), 'error');
        }
    } catch (e) {
        if (typeof showToast === 'function') showToast('Erreur réseau', 'error');
    }
}

// ═══ Structured data (experiences, educations, certifications) ═══

async function loadCandidateStructuredData() {
    if (!__cand?.id) return;
    await Promise.all([
        loadCandidateExperiences(),
        loadCandidateEducations(),
        loadCandidateCertifications()
    ]);
}

async function loadCandidateExperiences() {
    const el = document.getElementById('viewExperiences');
    if (!el || !__cand?.id) return;
    try {
        const res = await fetch(`/api/candidates/${__cand.id}/experiences`);
        const j = await res.json();
        if (!j?.ok || !Array.isArray(j.experiences)) {
            el.innerHTML = '<div class="muted">Aucune expérience renseignée.</div>';
            return;
        }
        if (j.experiences.length === 0) {
            el.innerHTML = '<div class="muted">Aucune expérience renseignée.</div>';
            return;
        }
        el.innerHTML = j.experiences.map(exp => {
            const start = exp.start_date || '—';
            const end = exp.end_date || 'En cours';
            const role = escapeHtml(exp.role || '—');
            const company = escapeHtml(exp.company_name || '—');
            const desc = exp.description ? escapeHtml(exp.description) : '';
            const techs = Array.isArray(exp.technologies) && exp.technologies.length > 0
                ? `<div style="margin-top:6px;"><span class="muted" style="font-size:11px;">Technologies: </span>${exp.technologies.map(t => `<span class="chip" style="font-size:11px;padding:2px 6px;">${escapeHtml(t)}</span>`).join('')}</div>`
                : '';
            return `
                <div style="padding:10px;border:1px solid var(--color-border);border-radius:8px;margin-bottom:8px;background:var(--color-surface-2);">
                    <div style="font-weight:600;font-size:13px;">${role} — ${company}</div>
                    <div class="muted" style="font-size:11px;margin-top:4px;">${start} → ${end}</div>
                    ${desc ? `<div style="margin-top:6px;font-size:12px;line-height:1.4;">${desc}</div>` : ''}
                    ${techs}
                </div>`;
        }).join('');
    } catch (e) {
        console.error('Failed to load experiences', e);
        el.innerHTML = '<div class="muted">Erreur au chargement.</div>';
    }
}

async function loadCandidateEducations() {
    const el = document.getElementById('viewEducations');
    if (!el || !__cand?.id) return;
    try {
        const res = await fetch(`/api/candidates/${__cand.id}/educations`);
        const j = await res.json();
        if (!j?.ok || !Array.isArray(j.educations)) {
            el.innerHTML = '<div class="muted">Aucune formation renseignée.</div>';
            return;
        }
        if (j.educations.length === 0) {
            el.innerHTML = '<div class="muted">Aucune formation renseignée.</div>';
            return;
        }
        el.innerHTML = j.educations.map(edu => {
            const degree = escapeHtml(edu.degree || '—');
            const school = escapeHtml(edu.school || '—');
            const year = edu.year || '—';
            const spec = edu.specialization ? escapeHtml(edu.specialization) : '';
            return `
                <div style="padding:10px;border:1px solid var(--color-border);border-radius:8px;margin-bottom:8px;background:var(--color-surface-2);">
                    <div style="font-weight:600;font-size:13px;">${degree}</div>
                    <div style="font-size:12px;margin-top:4px;">${school}${year !== '—' ? ' (' + year + ')' : ''}</div>
                    ${spec ? `<div class="muted" style="font-size:11px;margin-top:4px;">${spec}</div>` : ''}
                </div>`;
        }).join('');
    } catch (e) {
        console.error('Failed to load educations', e);
        el.innerHTML = '<div class="muted">Erreur au chargement.</div>';
    }
}

async function loadCandidateCertifications() {
    const el = document.getElementById('viewCertifications');
    if (!el || !__cand?.id) return;
    try {
        const res = await fetch(`/api/candidates/${__cand.id}/certifications`);
        const j = await res.json();
        if (!j?.ok || !Array.isArray(j.certifications)) {
            el.innerHTML = '<div class="muted">Aucune certification renseignée.</div>';
            return;
        }
        if (j.certifications.length === 0) {
            el.innerHTML = '<div class="muted">Aucune certification renseignée.</div>';
            return;
        }
        el.innerHTML = j.certifications.map(cert => {
            const name = escapeHtml(cert.name || '—');
            const issuer = cert.issuer ? escapeHtml(cert.issuer) : '';
            const obtained = cert.obtained_date || '—';
            const expiry = cert.expiry_date || null;
            const expiryText = expiry ? ` (Expire: ${expiry})` : ' (Sans expiration)';
            return `
                <div style="padding:10px;border:1px solid var(--color-border);border-radius:8px;margin-bottom:8px;background:var(--color-surface-2);">
                    <div style="font-weight:600;font-size:13px;">${name}</div>
                    ${issuer ? `<div style="font-size:12px;margin-top:4px;">${issuer}</div>` : ''}
                    <div class="muted" style="font-size:11px;margin-top:4px;">Obtenu: ${obtained}${expiryText}</div>
                </div>`;
        }).join('');
    } catch (e) {
        console.error('Failed to load certifications', e);
        el.innerHTML = '<div class="muted">Erreur au chargement.</div>';
    }
}

// Expose for IA import system
window.loadCandidateStructuredData = loadCandidateStructuredData;

// ═══ Mode switching ═══

function switchToEditMode() {
    __editMode = true;
    document.getElementById('viewSection').style.display = 'none';
    document.getElementById('editSection').style.display = 'block';
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function switchToViewMode() {
    __editMode = false;
    // Auto-save before switching
    triggerAutoSave(true);
    document.getElementById('editSection').style.display = 'none';
    document.getElementById('viewSection').style.display = 'block';
    renderViewMode();
}

// ═══ Skills (edit mode) ═══

function renderSkills() {
  const wrap = document.getElementById('skillsChips');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (__skills.length === 0) {
    wrap.innerHTML = '<div class="muted">Aucune compétence.</div>';
    return;
  }
  __skills.forEach(skill => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.title = 'Cliquer pour supprimer';
    chip.innerHTML = `${escapeHtml(skill)} <span class="chip-x">×</span>`;
    chip.addEventListener('click', () => {
      __skills = __skills.filter(s => s.toLowerCase() !== skill.toLowerCase());
      renderSkills();
      triggerAutoSave();
    });
    wrap.appendChild(chip);
  });
}

// ═══ Link buttons ═══

function setLinkButton(idBtn, url) {
  const a = document.getElementById(idBtn);
  if (!a) return;
  const u = safeStr(url).trim();
  if (u) {
    a.href = u;
    a.classList.remove('disabled');
    a.style.pointerEvents = 'auto';
    a.style.opacity = '1';
    a.style.display = '';
  } else {
    a.href = '#';
    a.classList.add('disabled');
    a.style.pointerEvents = 'none';
    a.style.opacity = '0.55';
  }
  // VSA toggle empty badge (v22.1)
  if (idBtn === 'btnOpenVSA') {
    const empty = document.getElementById('btnVSAEmpty');
    if (empty) {
      if (u) { a.style.display = ''; empty.style.display = 'none'; }
      else   { a.style.display = 'none'; empty.style.display = ''; }
    }
  }
}

// ═══ Companies ═══

async function fetchCompanies() {
  const res = await fetch('/api/data');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  __companies = Array.isArray(j?.companies) ? j.companies : [];
}

function populateCompanySelect() {
  const sel = document.getElementById('companySelect');
  if (!sel) return;
  sel.innerHTML = '';
  const list = (__companies || []).slice().sort((a,b) => safeStr(a.groupe).localeCompare(safeStr(b.groupe), 'fr', { sensitivity:'base' }));
  list.forEach(c => {
    const opt = document.createElement('option');
    opt.value = String(c.id);
    opt.textContent = `${safeStr(c.groupe)}${c.site ? ' — ' + safeStr(c.site) : ''}`;
    sel.appendChild(opt);
  });
}

function applyCompanySelection(companyIds) {
  const sel = document.getElementById('companySelect');
  if (!sel) return;
  const set = new Set((companyIds || []).map(n => Number(n)));
  Array.from(sel.options).forEach(o => {
    o.selected = set.has(Number(o.value));
  });
  renderLinkedCompanies();
}

function getSelectedCompanyIds() {
  const sel = document.getElementById('companySelect');
  if (!sel) return [];
  return Array.from(sel.selectedOptions).map(o => Number(o.value)).filter(n => Number.isFinite(n));
}

function renderLinkedCompanies() {
  const wrap = document.getElementById('linkedCompanies');
  if (!wrap) return;
  const ids = getSelectedCompanyIds();
  const byId = new Map((__companies || []).map(c => [Number(c.id), c]));
  wrap.innerHTML = '';
  if (ids.length === 0) {
    wrap.innerHTML = '<div class="muted">Aucune entreprise associée.</div>';
    return;
  }
  ids.map(id => byId.get(id)).filter(Boolean).forEach(c => {
    const label = `${safeStr(c.groupe)}${c.site ? ' — ' + safeStr(c.site) : ''}`;
    const chip = document.createElement('a');
    chip.className = 'chip';
    chip.href = '/?company=' + encodeURIComponent(String(c.id));
    chip.title = 'Ouvrir prospects';
    chip.style.textDecoration = 'none';
    chip.textContent = label;
    wrap.appendChild(chip);
  });
}

function wireCompanySearch() {
  const inp = document.getElementById('companySearch');
  const sel = document.getElementById('companySelect');
  if (!inp || !sel) return;
  inp.addEventListener('input', () => {
    const q = inp.value.trim().toLowerCase();
    Array.from(sel.options).forEach(opt => {
      opt.style.display = (!q || opt.textContent.toLowerCase().includes(q)) ? '' : 'none';
    });
  });
  sel.addEventListener('change', () => {
    renderLinkedCompanies();
    triggerAutoSave();
  });
}

// ═══ Auto-save ═══

function triggerAutoSave(immediate) {
    if (__autoSaveTimer) clearTimeout(__autoSaveTimer);
    const status = document.getElementById('autoSaveStatus');
    if (status) status.textContent = '💾 Modifications...';

    const delay = immediate ? 0 : 1200;
    __autoSaveTimer = setTimeout(async () => {
        await doAutoSave();
    }, delay);
}

async function doAutoSave() {
    if (!__cand?.id) return;
    const status = document.getElementById('autoSaveStatus');

    const payload = buildPayload();
    try {
        const res = await fetch('/api/candidates/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            if (status) status.textContent = '❌ Erreur sauvegarde';
            return;
        }
        if (status) status.textContent = '✅ Sauvegardé';
        // Update local __cand
        Object.assign(__cand, payload);
        // Update header
        updateHeader();
        setLinkButton('btnOpenLinkedIn', payload.linkedin);
        setLinkButton('btnOpenOneNote', payload.onenote_url);
        setLinkButton('btnOpenVSA', payload.vsa_url);

        // Mission → suggest archive
        if (payload.status === 'mission') {
            checkMissionArchive();
        }

        setTimeout(() => { if (status) status.textContent = '—'; }, 3000);
    } catch (e) {
        console.error(e);
        if (status) status.textContent = '❌ Erreur réseau';
    }
}

function buildPayload() {
    const yeRaw = document.getElementById('fYearsExperience')?.value;
    const yearsExp = yeRaw ? parseInt(yeRaw) : null;
    return {
        id: __cand.id,
        name: document.getElementById('fName').value.trim(),
        status: document.getElementById('fStatus').value,
        role: document.getElementById('fRole').value.trim(),
        location: document.getElementById('fLocation').value.trim(),
        seniority: document.getElementById('fSeniority').value.trim(),
        years_experience: isNaN(yearsExp) ? null : yearsExp,
        source: document.getElementById('fSource').value.trim(),
        linkedin: document.getElementById('fLinkedIn').value.trim(),
        onenote_url: document.getElementById('fOneNote').value.trim(),
        vsa_url: document.getElementById('fVSA').value.trim(),
        tech: document.getElementById('fTech').value.trim(),
        notes: document.getElementById('fNotes').value.trim(),
        skills: __skills,
        company_ids: getSelectedCompanyIds(),
        phone: (document.getElementById('fPhone')?.value || '').trim(),
        email: (document.getElementById('fEmail')?.value || '').trim(),
        sector: (document.getElementById('fSector')?.value || '').trim(),
        dossier_competence_pdf: (document.getElementById('fDossierCompetence')?.value || '').trim(),
        description_push: (document.getElementById('viewPresentationText')?.value ?? null),
        // v28.1 : champs fiche entretien
        disponibilite: (document.getElementById('fDisponibilite')?.value || '').trim() || null,
        mobilite: (document.getElementById('fMobilite')?.value || '').trim() || null,
        permis_conduire: document.getElementById('fPermisConduire')?.checked ? 1 : 0,
        vehicule: document.getElementById('fVehicule')?.checked ? 1 : 0,
        permis_travail: (document.getElementById('fPermisTravail')?.value || '').trim() || null,
        fonctions_recherchees: (document.getElementById('fFonctionsRecherchees')?.value || '').trim() || null,
        motif_recherche: (document.getElementById('fMotifRecherche')?.value || '').trim() || null,
        avancement_recherches: (document.getElementById('fAvancementRecherches')?.value || '').trim() || null,
        remuneration_actuelle: (document.getElementById('fRemunerationActuelle')?.value || '').trim() || null,
        pretentions_salariales: (document.getElementById('fPretentionsSalariales')?.value || '').trim() || null,
        propal_a: (document.getElementById('fPropalA')?.value || '').trim() || null,
        eval_technique: (document.getElementById('fEvalTechnique')?.value || '').trim() || null,
        eval_personnalite: (document.getElementById('fEvalPersonnalite')?.value || '').trim() || null,
        eval_communication: (document.getElementById('fEvalCommunication')?.value || '').trim() || null,
        langues: (document.getElementById('fLangues')?.value || '').trim() || null,
        references_candidat: (document.getElementById('fReferencesCandidats')?.value || '').trim() || null,
        avis_perso: (document.getElementById('fAvisPerso')?.value || '').trim() || null,
    };
}

let __missionPrompted = false;
function checkMissionArchive() {
    if (__missionPrompted) return;
    __missionPrompted = true;
    setTimeout(() => {
        if (confirm('🚀 Ce candidat est en mission !\n\nVoulez-vous l\'archiver automatiquement ?')) {
            document.getElementById('fStatus').value = 'archive';
            __cand.is_archived = 1;
            triggerAutoSave(true);
        }
    }, 500);
}

function updateHeader() {
    const name = document.getElementById('fName')?.value || __cand?.name || '';
    const role = document.getElementById('fRole')?.value || __cand?.role || '';
    const loc = document.getElementById('fLocation')?.value || __cand?.location || '';
    document.getElementById('candTitle').textContent = name ? `👤 ${name}` : '👤 Candidat';
    document.getElementById('candMeta').textContent = `${role}${role && loc ? ' · ' : ''}${loc}`;
}

// ═══ Archive actions ═══

async function archiveCandidate() {
    if (!__cand?.id) return;
    if (!confirm('📦 Archiver ce candidat ?')) return;
    __cand.is_archived = 1;
    __cand.status = 'archive';
    const payload = { ...__cand, is_archived: 1, status: 'archive' };
    await fetch('/api/candidates/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    await loadCandidate();
    if (typeof showToast === 'function') showToast('📦 Candidat archivé', 'success');
}

async function unarchiveCandidate() {
    if (!__cand?.id) return;
    __cand.is_archived = 0;
    __cand.status = 'a_sourcer';
    const payload = { ...__cand, is_archived: 0, status: 'a_sourcer' };
    await fetch('/api/candidates/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    await loadCandidate();
    if (typeof showToast === 'function') showToast('♻️ Candidat restauré', 'success');
}

// ═══ Load ═══

async function loadCandidate() {
  const id = getCandidateId();
  if (!id) {
    showToast('ID candidat manquant. Ouvrez cette page avec ?id=123', 'error');
    return;
  }

  const res = await fetch(`/api/candidates/${id}`);
  if (!res.ok) {
    const txt = await res.text().catch(()=> '');
    showToast('Impossible de charger le candidat: ' + (txt || ('HTTP ' + res.status)), 'error');
    return;
  }

  const j = await res.json();
  if (!j?.ok) {
    showToast('Impossible de charger le candidat.', 'error');
    return;
  }

  __cand = j.candidate;
  __missionPrompted = false;

  updateHeader();

  // Fill form fields
  document.getElementById('fName').value = safeStr(__cand.name);
  document.getElementById('fStatus').value = safeStr(__cand.status || 'a_sourcer');
  document.getElementById('fRole').value = safeStr(__cand.role);
  document.getElementById('fLocation').value = safeStr(__cand.location);
  document.getElementById('fSeniority').value = safeStr(__cand.seniority);
  document.getElementById('fSource').value = safeStr(__cand.source);
  if (document.getElementById('fYearsExperience')) {
      document.getElementById('fYearsExperience').value = __cand.years_experience != null ? __cand.years_experience : '';
  }
  if (document.getElementById('fPhone')) document.getElementById('fPhone').value = safeStr(__cand.phone);
  if (document.getElementById('fEmail')) document.getElementById('fEmail').value = safeStr(__cand.email);
  if (document.getElementById('fSector')) document.getElementById('fSector').value = safeStr(__cand.sector);
  document.getElementById('fLinkedIn').value = safeStr(__cand.linkedin);
  document.getElementById('fOneNote').value = safeStr(__cand.onenote_url);
  document.getElementById('fVSA').value = safeStr(__cand.vsa_url);
  document.getElementById('fTech').value = safeStr(__cand.tech);
  if (document.getElementById('fDossierCompetence')) {
      document.getElementById('fDossierCompetence').value = safeStr(__cand.dossier_competence_pdf || '');
  }
  if (document.getElementById('viewPresentationText')) {
      document.getElementById('viewPresentationText').value = safeStr(__cand.description_push || '');
  }
  // v28.1: champs fiche entretien
  if (document.getElementById('fDisponibilite')) document.getElementById('fDisponibilite').value = safeStr(__cand.disponibilite);
  if (document.getElementById('fMobilite')) document.getElementById('fMobilite').value = safeStr(__cand.mobilite);
  if (document.getElementById('fPermisConduire')) document.getElementById('fPermisConduire').checked = !!(__cand.permis_conduire);
  if (document.getElementById('fVehicule')) document.getElementById('fVehicule').checked = !!(__cand.vehicule);
  if (document.getElementById('fPermisTravail')) document.getElementById('fPermisTravail').value = safeStr(__cand.permis_travail);
  if (document.getElementById('fFonctionsRecherchees')) document.getElementById('fFonctionsRecherchees').value = safeStr(__cand.fonctions_recherchees);
  if (document.getElementById('fMotifRecherche')) document.getElementById('fMotifRecherche').value = safeStr(__cand.motif_recherche);
  if (document.getElementById('fAvancementRecherches')) document.getElementById('fAvancementRecherches').value = safeStr(__cand.avancement_recherches);
  if (document.getElementById('fRemunerationActuelle')) document.getElementById('fRemunerationActuelle').value = safeStr(__cand.remuneration_actuelle);
  if (document.getElementById('fPretentionsSalariales')) document.getElementById('fPretentionsSalariales').value = safeStr(__cand.pretentions_salariales);
  if (document.getElementById('fPropalA')) document.getElementById('fPropalA').value = safeStr(__cand.propal_a);
  if (document.getElementById('fEvalTechnique')) document.getElementById('fEvalTechnique').value = safeStr(__cand.eval_technique);
  if (document.getElementById('fEvalPersonnalite')) document.getElementById('fEvalPersonnalite').value = safeStr(__cand.eval_personnalite);
  if (document.getElementById('fEvalCommunication')) document.getElementById('fEvalCommunication').value = safeStr(__cand.eval_communication);
  if (document.getElementById('fLangues')) document.getElementById('fLangues').value = safeStr(__cand.langues);
  if (document.getElementById('fReferencesCandidats')) document.getElementById('fReferencesCandidats').value = safeStr(__cand.references_candidat);
  if (document.getElementById('fAvisPerso')) document.getElementById('fAvisPerso').value = safeStr(__cand.avis_perso);
  document.getElementById('fNotes').value = safeStr(__cand.notes);

  __skills = Array.isArray(__cand.skills) ? uniqCaseInsensitive(__cand.skills) : [];
  renderSkills();

  setLinkButton('btnOpenLinkedIn', __cand.linkedin);
  setLinkButton('btnOpenOneNote', __cand.onenote_url);
  setLinkButton('btnOpenVSA', __cand.vsa_url);

  applyCompanySelection(Array.isArray(__cand.company_ids) ? __cand.company_ids : []);

  // Render view mode
  renderViewMode();

  // Onglets (EC1 / note libre)
  await loadCandidateTabs();

  // v27.x PARTIE 3: Notes/Suivi via composant NotesTimeline (remplace loadCandidateTimeline)
  if (typeof initNotesTimeline === 'function' && __cand?.id) {
    initNotesTimeline('candidateNtBox', { entityType: 'candidate', entityId: __cand.id });
  } else {
    // Fallback : timeline classique
    await loadCandidateTimeline();
  }
}


async function saveCandidate(e) {
  e.preventDefault();
  if (!__cand?.id) return;

  const payload = buildPayload();
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

  showToast('Candidat enregistré', 'success');
  await loadCandidate();
}

// ═══ Skills input ═══

function wireSkillsInput() {
  const inp = document.getElementById('skillInput');
  const btn = document.getElementById('btnAddSkill');
  if (!inp) return;

  const add = () => {
    const parts = parseSkillInput(inp.value);
    if (parts.length === 0) return;
    __skills = uniqCaseInsensitive(__skills.concat(parts));
    inp.value = '';
    renderSkills();
    triggerAutoSave();
  };

  btn && btn.addEventListener('click', add);
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); add(); }
  });
  inp.addEventListener('input', () => {
    if (inp.value.includes(',')) add();
  });
}

// ═══ Wire auto-save on all .autosave-field ═══

function wireAutoSave() {
    document.querySelectorAll('.autosave-field').forEach(el => {
        const evt = (el.tagName === 'SELECT') ? 'change' : 'input';
        el.addEventListener(evt, () => triggerAutoSave());
    });

  document.getElementById('fStatus')?.addEventListener('change', () => {});
}

// ═══ Init ═══

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await fetchCompanies();
    populateCompanySelect();
    wireCompanySearch();
    wireSkillsInput();
    wireAutoSave();

    document.getElementById('candidateForm')?.addEventListener('submit', saveCandidate);
    document.getElementById('btnReload')?.addEventListener('click', loadCandidate);
    document.getElementById('btnAddCandidateTab')?.addEventListener('click', openNewTabModal);
    document.getElementById('btnAddTimelineEvent')?.addEventListener('click', addCandidateTimelineEvent);

    // ═══ Scrapping IA button (Ollama en 1 clic) ═══
    window.handleCandidateIAButton = function() {
        if (!__cand) { showToast('Aucun candidat chargé', 'warning'); return; }
        const byId = new Map((__companies || []).map(c => [Number(c.id), c]));
        const companyNames = (Array.isArray(__cand.company_ids) ? __cand.company_ids : [])
            .map(id => byId.get(Number(id)))
            .filter(Boolean)
            .map(c => `${c.groupe}${c.site ? ' (' + c.site + ')' : ''}`);
        const candidateData = {
            name: __cand.name || '',
            role: __cand.role || '',
            location: __cand.location || '',
            seniority: __cand.seniority || '',
            tech: __cand.tech || '',
            skills: __skills || [],
            linkedin: __cand.linkedin || '',
            source: __cand.source || '',
            notes: __cand.notes || '',
            linkedCompanyNames: companyNames
        };
        const prompt = typeof getScrapingPromptCandidate === 'function' ? getScrapingPromptCandidate(candidateData) : null;
        if (!prompt) return;
        const btn = document.getElementById('btnIA_candidate_0');
        if (btn) { btn.disabled = true; btn.textContent = 'Génération…'; }
        (typeof callOllama === 'function' ? callOllama(prompt, { webSearch: true }) : Promise.reject(new Error('callOllama manquant')))
            .then(function (text) {
                if (typeof openIAImportModalWithText === 'function') openIAImportModalWithText('candidate', __cand.id, text);
                else if (typeof openIAImportModal === 'function') { openIAImportModal('candidate', __cand.id); document.getElementById('iaImportTextarea').value = text; if (typeof parseIAImportModal === 'function') parseIAImportModal(); }
            })
            .catch(function () {
                if (typeof openIAImportModal === 'function') openIAImportModal('candidate', __cand.id);
                if (typeof showToast === 'function') showToast('IA indisponible. Collez manuellement le retour ci-dessous.', 'warning', 6000);
            })
            .finally(function () {
                if (btn) { btn.disabled = false; btn.textContent = '🤖 Scrapping IA'; }
            });
    };

    window.scrapCandidatePrompt = window.handleCandidateIAButton;

    // IA Import helper: add skills directly to __skills array
    window.addSkillsFromIA = function(newSkills) {
        if (!Array.isArray(newSkills)) return;
        __skills = uniqCaseInsensitive(__skills.concat(newSkills));
        renderSkills();
        triggerAutoSave();
    };

    // Expose triggerAutoSave for IA import system
    window.triggerCandidateAutoSave = function() { triggerAutoSave(true); };

    // Expose inline edit helpers globally (called from onclick in HTML)
    window.startInlineEdit = startInlineEdit;
    window.startInlineEditPermis = startInlineEditPermis;
    window.saveInlineEdit = saveInlineEdit;
    window.saveInlineEditPermis = saveInlineEditPermis;

    // "Ajouter un champ" entretien — ouvre le formulaire d'édition section entretien
    window.startInlineEditEntretienAdd = function() { switchToEditMode(); };

    // ═══ Parseur fiche entretien Excel via Ollama (avec progression + confirmation) ═══

    const _FICHE_FIELD_DEFS = [
        { key: 'disponibilite',         label: 'Disponibilité',           type: 'text' },
        { key: 'mobilite',              label: 'Mobilité géographique',    type: 'text' },
        { key: 'permis_conduire',       label: 'Permis de conduire',       type: 'checkbox' },
        { key: 'vehicule',              label: 'Véhicule',                 type: 'checkbox' },
        { key: 'permis_travail',        label: 'Permis de travail',        type: 'text' },
        { key: 'fonctions_recherchees', label: 'Fonctions recherchées',    type: 'text' },
        { key: 'motif_recherche',       label: 'Motif de recherche',       type: 'textarea' },
        { key: 'avancement_recherches', label: 'Avancement des recherches',type: 'text' },
        { key: 'remuneration_actuelle', label: 'Rémunération actuelle',    type: 'text' },
        { key: 'pretentions_salariales',label: 'Prétentions salariales',   type: 'text' },
        { key: 'propal_a',              label: 'Proposition à',            type: 'text' },
        { key: 'eval_technique',        label: 'Évaluation technique',     type: 'text' },
        { key: 'eval_personnalite',     label: 'Évaluation personnalité',  type: 'text' },
        { key: 'eval_communication',    label: 'Évaluation communication', type: 'text' },
        { key: 'langues',               label: 'Langues',                  type: 'text' },
        { key: 'references_candidat',   label: 'Références',               type: 'textarea' },
        { key: 'avis_perso',            label: 'Avis perso',               type: 'textarea' },
    ];

    let _ficheProgress = 0;
    let _ficheProgressTimer = null;

    function _setFicheProgress(pct, label, emoji) {
        _ficheProgress = pct;
        const bar = document.getElementById('ficheProgressBar');
        const pctEl = document.getElementById('ficheProgressPct');
        const lbl = document.getElementById('ficheProgressLabel');
        const emo = document.getElementById('ficheProgressEmoji');
        if (bar) bar.style.width = pct + '%';
        if (pctEl) pctEl.textContent = pct + '%';
        if (label && lbl) lbl.textContent = label;
        if (emoji && emo) emo.textContent = emoji;
    }

    function _animateProgressTo(target, label, emoji, durationMs) {
        if (_ficheProgressTimer) clearInterval(_ficheProgressTimer);
        if (label) { const lbl = document.getElementById('ficheProgressLabel'); if (lbl) lbl.textContent = label; }
        if (emoji) { const emo = document.getElementById('ficheProgressEmoji'); if (emo) emo.textContent = emoji; }
        const start = _ficheProgress;
        const steps = Math.max(1, Math.round(durationMs / 60));
        let step = 0;
        _ficheProgressTimer = setInterval(() => {
            step++;
            const t = step / steps;
            const eased = t < 0.5 ? 2*t*t : -1+(4-2*t)*t; // ease-in-out
            const cur = Math.round(start + (target - start) * eased);
            _setFicheProgress(cur);
            if (step >= steps) { clearInterval(_ficheProgressTimer); _setFicheProgress(target); }
        }, 60);
    }

    function _openProgressModal() {
        _ficheProgress = 0;
        _setFicheProgress(0, 'Lecture du fichier Excel…', '📄');
        const m = document.getElementById('modalFicheProgress');
        if (m) { if (window.openModal) window.openModal(m); else m.classList.add('active'); }
    }

    function _closeProgressModal() {
        if (_ficheProgressTimer) { clearInterval(_ficheProgressTimer); _ficheProgressTimer = null; }
        const m = document.getElementById('modalFicheProgress');
        if (m) { if (window.closeModal) window.closeModal(m); else m.classList.remove('active'); }
    }

    window.closeFicheReviewModal = function() {
        const m = document.getElementById('modalFicheReview');
        if (m) { if (window.closeModal) window.closeModal(m); else m.classList.remove('active'); }
    };

    function _openReviewModal(fields) {
        const container = document.getElementById('ficheReviewFields');
        if (!container) return;

        const rows = _FICHE_FIELD_DEFS.map(def => {
            const rawVal = fields[def.key];
            const isEmpty = rawVal == null || rawVal === '' || rawVal === 0;
            const displayVal = isEmpty ? '' : String(rawVal);
            const highlightStyle = isEmpty ? 'opacity:0.45;' : '';

            let inputHtml;
            if (def.type === 'checkbox') {
                const checked = rawVal === 1 || rawVal === true || rawVal === '1' ? 'checked' : '';
                inputHtml = `<label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                    <input type="checkbox" id="ficheReview_${def.key}" ${checked} style="width:16px;height:16px;" />
                    <span style="font-size:13px;">${checked ? '✅ Oui' : '❌ Non'}</span>
                </label>`;
            } else if (def.type === 'textarea') {
                inputHtml = `<textarea id="ficheReview_${def.key}" rows="2" style="width:100%;box-sizing:border-box;resize:vertical;font-size:13px;">${escapeHtml(displayVal)}</textarea>`;
            } else {
                inputHtml = `<input id="ficheReview_${def.key}" type="text" value="${escapeHtml(displayVal)}" style="width:100%;box-sizing:border-box;font-size:13px;" />`;
            }

            return `<div style="${highlightStyle}padding:8px 0;border-bottom:1px solid var(--color-border);display:grid;grid-template-columns:180px 1fr;gap:12px;align-items:start;">
                <div style="font-size:12px;font-weight:600;padding-top:6px;color:${isEmpty?'var(--color-text-muted)':'inherit'}">${def.label}${isEmpty?' <span style="font-size:10px;opacity:.6;">(vide)</span>':''}</div>
                <div>${inputHtml}</div>
            </div>`;
        }).join('');

        container.innerHTML = rows;

        // Live checkbox label update
        _FICHE_FIELD_DEFS.filter(d => d.type === 'checkbox').forEach(def => {
            const chk = document.getElementById('ficheReview_' + def.key);
            if (chk) chk.addEventListener('change', function() {
                const span = this.nextElementSibling;
                if (span) span.textContent = this.checked ? '✅ Oui' : '❌ Non';
            });
        });

        const m = document.getElementById('modalFicheReview');
        if (m) { if (window.openModal) window.openModal(m); else m.classList.add('active'); }
    }

    window.applyFicheEntretien = function() {
        const _fill = (formId, key, type) => {
            const reviewEl = document.getElementById('ficheReview_' + key);
            const formEl = document.getElementById(formId);
            if (!reviewEl || !formEl) return;
            if (type === 'checkbox') {
                const val = reviewEl.checked ? 1 : 0;
                formEl.checked = reviewEl.checked;
                __cand[key] = val;
            } else {
                const val = (reviewEl.value || '').trim();
                if (val !== '') { formEl.value = val; __cand[key] = val; }
            }
        };

        const formMap = {
            disponibilite:         ['fDisponibilite',         'text'],
            mobilite:              ['fMobilite',              'text'],
            permis_conduire:       ['fPermisConduire',        'checkbox'],
            vehicule:              ['fVehicule',              'checkbox'],
            permis_travail:        ['fPermisTravail',         'text'],
            fonctions_recherchees: ['fFonctionsRecherchees',  'text'],
            motif_recherche:       ['fMotifRecherche',        'textarea'],
            avancement_recherches: ['fAvancementRecherches',  'text'],
            remuneration_actuelle: ['fRemunerationActuelle',  'text'],
            pretentions_salariales:['fPretentionsSalariales', 'text'],
            propal_a:              ['fPropalA',               'text'],
            eval_technique:        ['fEvalTechnique',         'text'],
            eval_personnalite:     ['fEvalPersonnalite',      'text'],
            eval_communication:    ['fEvalCommunication',     'text'],
            langues:               ['fLangues',               'text'],
            references_candidat:   ['fReferencesCandidats',   'textarea'],
        };
        Object.entries(formMap).forEach(([k, [id, t]]) => _fill(id, k, t));

        triggerAutoSave(true);
        window.closeFicheReviewModal();
        renderViewMode();
        if (typeof showToast === 'function') showToast('✅ Données enregistrées', 'success', 4000);
    };

    window.parseFicheEntretien = async function(input) {
        const file = input?.files?.[0];
        if (!file) return;
        input.value = '';

        _openProgressModal();
        _animateProgressTo(25, 'Lecture du fichier Excel…', '📄', 600);

        const fd = new FormData();
        fd.append('file', file);

        _animateProgressTo(55, 'Envoi à l\'IA…', '🤖', 1200);

        let json;
        try {
            const fetchPromise = fetch('/api/candidates/parse-fiche-entretien', { method: 'POST', body: fd });
            // Animate to 85% while waiting
            await new Promise(r => setTimeout(r, 1500));
            _animateProgressTo(85, 'Analyse et extraction des données…', '🔍', 2000);
            const res = await fetchPromise;
            json = await res.json();
        } catch (e) {
            _closeProgressModal();
            if (typeof showToast === 'function') showToast('Erreur réseau : ' + e.message, 'error');
            return;
        }

        if (!json?.ok) {
            _closeProgressModal();
            if (typeof showToast === 'function') showToast('Erreur : ' + (json?.error || 'inconnue'), 'error');
            return;
        }

        _animateProgressTo(100, 'Extraction terminée !', '✅', 400);
        await new Promise(r => setTimeout(r, 600));
        _closeProgressModal();

        _openReviewModal(json.fields || {});
    };

    // Expose generatePresentationAI globally
    window.generatePresentationAI = async function() {
        if (!__cand?.id) return;
        const btn = document.getElementById('btnGeneratePresentationAI');
        const textarea = document.getElementById('viewPresentationText');
        const statusEl = document.getElementById('viewPresentationStatus');
        if (!textarea) return;

        if (!__cand.dossier_competence_pdf && !__cand.has_dc) {
            if (typeof showToast === 'function') showToast('Ce candidat n\'a pas de dossier de compétences uploadé', 'warning');
            return;
        }

        if (btn) { btn.disabled = true; btn.innerHTML = '<span class="pt-spinner"></span> Analyse DC…'; }
        if (statusEl) statusEl.textContent = '';
        textarea.value = 'Analyse du dossier de compétences en cours…';

        try {
            const res = await fetch(`/api/candidates/${__cand.id}/generate-description`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            if (!res.ok) {
                let errMsg = `Erreur HTTP ${res.status}`;
                try { const e = await res.json(); errMsg = e.error || errMsg; } catch(_) {}
                textarea.value = __cand.description_push || '';
                if (typeof showToast === 'function') showToast(errMsg, 'error');
                return;
            }
            const json = await res.json();
            if (json.ok && json.description) {
                textarea.value = json.description;
                __cand.description_push = json.description;
                if (statusEl) statusEl.textContent = '✅ Phrase générée et sauvegardée';
                if (typeof showToast === 'function') showToast('Phrase de présentation générée !', 'success');
            } else {
                textarea.value = __cand.description_push || '';
                if (typeof showToast === 'function') showToast(json.error || 'Erreur génération', 'error');
            }
        } catch (e) {
            textarea.value = __cand.description_push || '';
            if (typeof showToast === 'function') showToast(`Erreur: ${e.message}`, 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '🤖 Générer IA'; }
        }
    };

    await loadCandidate();
    loadCandidateFolder();

    // URL param: auto edit mode / open section
    const params = new URLSearchParams(window.location.search);
    if (params.get('edit') === '1') switchToEditMode();
    if ((params.get('section') || '').toLowerCase() === 'ec1') {
      const sec = document.getElementById('candidateTabsSection');
      if (sec) setTimeout(() => { try { sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch(e) {} }, 100);
    }

  } catch (e) {
    console.error(e);
    showToast('Erreur au chargement. Vérifiez que le serveur Python est lancé (app.py).', 'error');
  }
});

// ═══ Candidate Folder (v11) ═══

async function loadCandidateFolder() {
    const id = getCandidateId();
    if (!id) return;
    const pathEl = document.getElementById('candidateFolderPath');
    const listEl = document.getElementById('candidateFilesList');
    if (!pathEl || !listEl) return;

    try {
        const res = await fetch(`/api/candidate-folder/${id}/files`);
        const j = await res.json();

        if (!j.ok) {
            if (j.no_config) {
                pathEl.innerHTML = '⚠️ Chemin non configuré. <a href="/parametres" style="color:var(--color-primary);">Configurer dans Paramètres</a>';
                listEl.innerHTML = '';
            } else {
                pathEl.textContent = j.error || 'Erreur';
                listEl.innerHTML = '';
            }
            return;
        }

        pathEl.textContent = j.folder || '';

        if (!j.exists) {
            listEl.innerHTML = '<div class="muted">📁 Dossier introuvable sur le disque. Vérifiez le chemin ou le format du nom.</div>';
            return;
        }

        if (j.files.length === 0) {
            listEl.innerHTML = '<div class="muted">Dossier vide.</div>';
            return;
        }

        const icons = { '.pdf': '📄', '.docx': '📝', '.doc': '📝', '.xlsx': '📊', '.xls': '📊', '.pptx': '📊',
                        '.jpg': '🖼️', '.jpeg': '🖼️', '.png': '🖼️', '.msg': '📧', '.eml': '📧', '.txt': '📃', '.zip': '📦' };

        listEl.innerHTML = j.files.map(f => {
            const icon = f.is_dir ? '📁' : (icons[f.ext] || '📄');
            const size = f.is_dir ? '' : _formatSize(f.size);
            return `<div style="display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:8px;cursor:pointer;transition:background .15s;"
                         onmouseenter="this.style.background='var(--color-surface-2)'" onmouseleave="this.style.background=''"
                         onclick="openCandidateFile('${_jsEsc(f.path)}')">
                <span style="font-size:16px;">${icon}</span>
                <span style="flex:1;font-size:13px;font-weight:500;">${_esc(f.name)}</span>
                ${size ? `<span class="muted" style="font-size:11px;">${size}</span>` : ''}
            </div>`;
        }).join('');

    } catch (e) {
        console.error('Folder load error:', e);
        listEl.innerHTML = '<div class="muted">Impossible de charger le dossier.</div>';
    }
}

function _formatSize(bytes) {
    if (bytes < 1024) return bytes + ' o';
    if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' Ko';
    return (bytes / 1048576).toFixed(1) + ' Mo';
}

function _esc(s) { return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function _jsEsc(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

async function openCandidateFolder() {
    const id = getCandidateId();
    if (!id) return;
    try {
        await fetch(`/api/candidate-folder/${id}/open`, { method: 'POST' });
    } catch (e) {
        if (typeof showToast === 'function') showToast('⚠️ Impossible d\'ouvrir le dossier', 'warning');
    }
}

async function openCandidateFile(path) {
    try {
        await fetch('/api/candidate-folder/open-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: path, candidate_id: __cand ? __cand.id : null })
        });
    } catch (e) {
        if (typeof showToast === 'function') showToast('⚠️ Impossible d\'ouvrir le fichier', 'warning');
    }
}

// ════════════════════════════════════════════════════════════════════
// CANDIDATE PUSH — Proposer un candidat à un prospect / entreprise
// ════════════════════════════════════════════════════════════════════

let __pushProspects = [];
let __pushSelectedProspectId = null;

async function loadPushProspects() {
    if (__pushProspects.length) return;
    try {
        const res = await fetch('/api/data');
        if (res.ok) {
            const d = await res.json();
            __pushProspects = d.prospects || [];
        }
    } catch(e) { console.warn('Failed to load prospects for push', e); }
}

function filterCandidatePushTargets() {
    const q = (document.getElementById('candidatePushSearch')?.value || '').trim().toLowerCase();
    const box = document.getElementById('candidatePushResults');
    if (!box) return;

    if (!q || q.length < 2) {
        box.innerHTML = '<div class="muted" style="font-size:12px;">Tapez au moins 2 caractères.</div>';
        return;
    }

    loadPushProspects().then(() => {
        const byCompany = new Map((__companies || []).map(c => [Number(c.id), c]));
        const results = __pushProspects.filter(p => {
            const c = byCompany.get(Number(p.company_id));
            const hay = `${p.name || ''} ${p.fonction || ''} ${c?.groupe || ''} ${c?.site || ''}`.toLowerCase();
            return hay.includes(q);
        }).slice(0, 10);

        if (results.length === 0) {
            box.innerHTML = '<div class="muted" style="font-size:12px;">Aucun prospect trouvé.</div>';
            return;
        }

        box.innerHTML = results.map(p => {
            const c = byCompany.get(Number(p.company_id));
            const companyLabel = c ? `${c.groupe || ''}${c.site ? ' (' + c.site + ')' : ''}` : '';
            const selected = __pushSelectedProspectId === p.id ? 'background:rgba(99,102,241,0.12);border-color:var(--color-primary);' : '';
            return `<div style="padding:8px 10px;border:1px solid var(--color-border);border-radius:8px;margin-bottom:4px;cursor:pointer;transition:all .15s;${selected}"
                         onclick="selectCandidatePushTarget(${p.id})"
                         onmouseenter="this.style.background='var(--color-surface-2)'" onmouseleave="if(!this.classList.contains('selected'))this.style.background=''">
                <div style="font-weight:600;font-size:13px;">${escapeHtml(p.name || '')}</div>
                <div class="muted" style="font-size:11px;">${escapeHtml(p.fonction || '')} — ${escapeHtml(companyLabel)}</div>
            </div>`;
        }).join('');
    });
}

function selectCandidatePushTarget(prospectId) {
    __pushSelectedProspectId = prospectId;
    filterCandidatePushTargets(); // re-render to highlight
}

async function executeCandidatePush() {
    if (!__cand) { showToast('⚠️ Aucun candidat chargé.', 'warning'); return; }
    if (!__pushSelectedProspectId) { showToast('⚠️ Sélectionnez un prospect.', 'warning'); return; }

    await loadPushProspects();
    const prospect = __pushProspects.find(p => p.id === __pushSelectedProspectId);
    if (!prospect) { showToast('⚠️ Prospect introuvable.', 'warning'); return; }

    const byCompany = new Map((__companies || []).map(c => [Number(c.id), c]));
    const company = byCompany.get(Number(prospect.company_id));
    const companyLabel = company ? `${company.groupe || ''}${company.site ? ' (' + company.site + ')' : ''}` : '';

    if (!confirm(`Proposer ${__cand.name} à ${prospect.name} (${companyLabel}) ?`)) return;

    try {
        const res = await fetch('/api/candidate-push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                candidate_id: __cand.id,
                prospect_id: __pushSelectedProspectId,
                candidate_name: __cand.name,
                prospect_name: prospect.name,
                company_name: companyLabel
            })
        });
        const j = await res.json();
        if (j.ok) {
            showToast(`✅ ${__cand.name} proposé à ${prospect.name} !`, 'success', 4000);
            // Auto-copy "PREFIX - Company" for Teams Planner (v22.1)
            const teamsText = `${typeof getTeamsPrefix === 'function' ? getTeamsPrefix() : '???'} - ${companyLabel}`;
            if (typeof copyForTeams === 'function') copyForTeams(teamsText, teamsText);
            __pushSelectedProspectId = null;
            document.getElementById('candidatePushSearch').value = '';
            document.getElementById('candidatePushResults').innerHTML = '';
            loadCandidatePushHistory();
        } else {
            showToast('❌ ' + (j.error || 'Erreur'), 'error');
        }
    } catch(e) {
        showToast('❌ Erreur réseau : ' + e.message, 'error');
    }
}

async function loadCandidatePushHistory() {
    const box = document.getElementById('candidatePushHistory');
    if (!box || !__cand) return;

    try {
        const res = await fetch(`/api/candidate-push?candidate_id=${__cand.id}`);
        const j = await res.json();
        if (!j.ok || !j.pushes || j.pushes.length === 0) {
            box.innerHTML = '<div class="muted" style="font-size:12px;padding:8px 0;">Aucune proposition enregistrée.</div>';
            return;
        }
        box.innerHTML = `
            <div style="font-weight:600;font-size:12px;margin-bottom:6px;">Historique des propositions</div>
            ${j.pushes.map(p => {
                const _cn = escapeHtml(p.company_name || '');
                return `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;border:1px solid var(--color-border);border-radius:8px;margin-bottom:4px;">
                    <div>
                        <span style="font-weight:600;font-size:12px;">${escapeHtml(p.prospect_name || '')}</span>
                        <span class="muted" style="font-size:11px;"> — ${_cn}</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:6px;">
                        <button class="mini-action" title="Copier pour Teams" onclick="event.stopPropagation();if(typeof copyForTeams==='function'){const t=(typeof getTeamsPrefix==='function'?getTeamsPrefix():'???')+' - ${_cn.replace(/'/g,"\\'")}';copyForTeams(t,t);}">📋</button>
                        <span class="muted" style="font-size:11px;">${escapeHtml(p.createdAt || '')}</span>
                    </div>
                </div>`;
            }).join('')}
        `;
    } catch(e) {
        box.innerHTML = '';
    }
}

// Copy candidate profile for Teams (v22.1)
function copyCandidateForTeams() {
    if (!__cand) { if (typeof showToast === 'function') showToast('⚠️ Aucun candidat chargé.', 'warning'); return; }
    const prefix = typeof getTeamsPrefix === 'function' ? getTeamsPrefix() : '???';
    let text = `[${prefix}] Profil : ${__cand.name || '—'}`;
    if (__cand.role) text += `\nRôle : ${__cand.role}`;
    if (__cand.years_experience) text += ` — ${__cand.years_experience} ans XP`;
    if (__cand.location) text += `\nLocalisation : ${__cand.location}`;
    const skills = Array.isArray(__cand.skills) ? __cand.skills : [];
    if (skills.length) text += `\nTech : ${skills.join(', ')}`;
    if (__cand.status) text += `\nStatut : ${__cand.status}`;
    if (__cand.vsa_url) text += `\nVSA : ${__cand.vsa_url}`;
    if (typeof copyForTeams === 'function') copyForTeams(text, 'Profil copié');
}

// Auto-load push history when candidate loads
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => { loadCandidatePushHistory(); }, 1500);
});
