// Page fiche candidat — v10.1 : vue lecture / édition + auto-save

let __cand = null;
let __skills = [];
let __companies = [];
let __autoSaveTimer = null;
let __editMode = false;

// ═══ EC1 checklist (candidate) ═══

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

let __ec1Data = null;       // { key: {checked, note}, ..., __note: string }
let __ec1InterviewAt = '';  // datetime-local string
let __ec1SaveTimer = null;

function blankEC1Data() {
  const d = {};
  EC1_CHECKLIST_ITEMS_UI.forEach(it => { d[it.key] = { checked: false, note: '' }; });
  d.__note = '';
  return d;
}

function normalizeDateTimeLocal(v) {
  const s = safeStr(v).trim();
  if (!s) return '';
  // Accept "YYYY-MM-DD HH:MM" or ISO "YYYY-MM-DDTHH:MM:SS"
  let out = s.replace(' ', 'T');
  // Trim seconds if present
  if (out.length >= 19) out = out.slice(0, 16);
  if (out.length === 16) return out;
  // If only date provided, keep date
  if (out.length >= 10) return out.slice(0, 10) + 'T09:00';
  return '';
}

function shouldShowEC1Section() {
  const st = (document.getElementById('fStatus')?.value || __cand?.status || '').toLowerCase();
  return st === 'ec1';
}

function updateEC1Visibility(scrollTo=false) {
  const sec = document.getElementById('ec1Section');
  if (!sec) return;
  const show = shouldShowEC1Section();
  sec.style.display = show ? 'block' : 'none';
  if (show && scrollTo) {
    setTimeout(() => {
      try { sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch(e) {}
    }, 50);
  }
}

async function loadEC1Checklist() {
  if (!__cand?.id) return;
  try {
    const res = await fetch(`/api/ec1-checklist?candidate_id=${__cand.id}`);
    const j = await res.json();
    if (!j?.ok) throw new Error('API');
    __ec1Data = (j.data && typeof j.data === 'object') ? j.data : blankEC1Data();
    __ec1InterviewAt = normalizeDateTimeLocal(j.interviewAt || '');
  } catch(e) {
    console.error('EC1 load error', e);
    __ec1Data = blankEC1Data();
    __ec1InterviewAt = '';
  }
  renderEC1Checklist();
}

function renderEC1Checklist() {
  const wrap = document.getElementById('ec1Checklist');
  const dt = document.getElementById('ec1InterviewAt');
  const note = document.getElementById('ec1Note');
  if (!wrap) return;

  if (!__ec1Data || typeof __ec1Data !== 'object') __ec1Data = blankEC1Data();

  // Date
  if (dt) dt.value = __ec1InterviewAt || '';
  if (note) note.value = safeStr(__ec1Data.__note || '');

  wrap.innerHTML = EC1_CHECKLIST_ITEMS_UI.map(it => {
    const row = __ec1Data[it.key] || { checked: false, note: '' };
    return `
      <div class="ec1-row">
        <label class="ec1-left">
          <input type="checkbox" id="ec1_chk_${it.key}">
          <span>${escapeHtml(it.label)}</span>
        </label>
        <input class="ec1-note" type="text" id="ec1_note_${it.key}" placeholder="Note..." />
      </div>
    `;
  }).join('');

  // Wire events
  EC1_CHECKLIST_ITEMS_UI.forEach(it => {
    const row = __ec1Data[it.key] || { checked: false, note: '' };
    const chk = document.getElementById(`ec1_chk_${it.key}`);
    const inp = document.getElementById(`ec1_note_${it.key}`);
    if (chk) chk.checked = !!row.checked;
    if (inp) inp.value = safeStr(row.note || '');

    chk && chk.addEventListener('change', () => {
      __ec1Data[it.key] = __ec1Data[it.key] || { checked: false, note: '' };
      __ec1Data[it.key].checked = chk.checked;
      scheduleEC1Save();
    });
    inp && inp.addEventListener('input', () => {
      __ec1Data[it.key] = __ec1Data[it.key] || { checked: false, note: '' };
      __ec1Data[it.key].note = inp.value;
      scheduleEC1Save();
    });
  });

  if (dt && !dt.dataset.wired) {
    dt.addEventListener('change', () => {
      __ec1InterviewAt = dt.value || '';
      scheduleEC1Save(true);
    });
    dt.dataset.wired = '1';
  }

  if (note && !note.dataset.wired) {
    note.addEventListener('input', () => {
      __ec1Data.__note = note.value || '';
      scheduleEC1Save();
    });
    note.dataset.wired = '1';
  }
}

function scheduleEC1Save(immediate=false) {
  if (__ec1SaveTimer) clearTimeout(__ec1SaveTimer);
  const status = document.getElementById('ec1SaveStatus');
  if (status) status.textContent = '💾 Modifications...';
  __ec1SaveTimer = setTimeout(() => saveEC1Checklist(false), immediate ? 0 : 900);
}

async function saveEC1Checklist(showToastOnSuccess=false) {
  if (!__cand?.id) return;
  const status = document.getElementById('ec1SaveStatus');
  try {
    const payload = {
      candidate_id: __cand.id,
      interviewAt: __ec1InterviewAt || null,
      data: __ec1Data || blankEC1Data()
    };
    const res = await fetch('/api/ec1-checklist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(await res.text().catch(()=> 'HTTP ' + res.status));
    if (status) status.textContent = '✅ Sauvegardé';
    if (showToastOnSuccess && typeof showToast === 'function') showToast('✅ EC1 sauvegardé', 'success');
    setTimeout(() => { if (status) status.textContent = '—'; }, 2500);
  } catch(e) {
    console.error('EC1 save error', e);
    if (status) status.textContent = '❌ Erreur';
  }
}

function resetEC1Checklist() {
  if (!confirm('↩️ Réinitialiser la checklist EC1 ?')) return;
  __ec1Data = blankEC1Data();
  __ec1InterviewAt = '';
  renderEC1Checklist();
  scheduleEC1Save(true);
}

// expose for HTML buttons
window.saveEC1Checklist = saveEC1Checklist;
window.resetEC1Checklist = resetEC1Checklist;


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

function renderViewMode() {
    if (!__cand) return;
    const grid = document.getElementById('viewGrid');
    const viewSkills = document.getElementById('viewSkills');
    const viewCompanies = document.getElementById('viewCompanies');
    const viewNotes = document.getElementById('viewNotes');
    const archiveBtn = document.getElementById('btnArchiveView');

    // Info grid
    const fields = [
        { label: 'Statut', value: `<span class="${statusBadgeClass(__cand.status)}">${escapeHtml(candStatusLabel(__cand.status))}</span>` },
        { label: 'Rôle', value: escapeHtml(__cand.role || '—') },
        { label: 'Localisation', value: escapeHtml(__cand.location || '—') },
        { label: 'Expérience', value: __cand.years_experience ? `${__cand.years_experience} ans` : (escapeHtml(__cand.seniority || '—')) },
        { label: 'Secteur', value: escapeHtml(__cand.sector || '—') },
        { label: 'Source', value: escapeHtml(__cand.source || '—') },
        { label: 'Tech', value: escapeHtml(__cand.tech || '—') },
    ];

    if (__cand.phone) fields.push({ label: 'Téléphone', value: `<a href="tel:${escapeHtml(__cand.phone)}">${escapeHtml(__cand.phone)}</a>` });
    // For consistency with the prospects and companies lists we do not open a mailto: link directly here.
    // Instead, clicking the email simply copies it to the clipboard and gives a small hint via the tooltip.
    if (__cand.email) {
        const escaped = escapeHtml(__cand.email).replace(/'/g, "\\'");
        fields.push({ label: 'Email', value: `<a href="javascript:void(0)" onclick="copyEmailToClipboard('${escaped}')" title="Copier l\'email" style="cursor:pointer;">${escapeHtml(__cand.email)}</a>` });
    }
    if (__cand.linkedin) fields.push({ label: 'LinkedIn', value: `<a href="${escapeHtml(__cand.linkedin)}" target="_blank" style="word-break:break-all;">${escapeHtml(__cand.linkedin)}</a>` });
    if (__cand.onenote_url) fields.push({ label: 'OneNote', value: `<a href="${escapeHtml(__cand.onenote_url)}" target="_blank" style="word-break:break-all;">${escapeHtml(__cand.onenote_url)}</a>` });
    if (__cand.vsa_url) fields.push({ label: 'VSA', value: `<a href="${escapeHtml(__cand.vsa_url)}" target="_blank" style="word-break:break-all;">${escapeHtml(__cand.vsa_url)}</a>` });

    if (grid) {
        grid.innerHTML = fields.map(f =>
            `<div class="cand-view-row"><div class="cand-view-label">${f.label}</div><div class="cand-view-value">${f.value}</div></div>`
        ).join('');
    }

    // Skills
    if (viewSkills) {
        if (__skills.length === 0) {
            viewSkills.innerHTML = '<div class="muted">Aucune compétence renseignée.</div>';
        } else {
            viewSkills.innerHTML = __skills.map(s => `<span class="chip">${escapeHtml(s)}</span>`).join('');
        }
    }

    // Companies
    if (viewCompanies) {
        const companyIds = Array.isArray(__cand.company_ids) ? __cand.company_ids : [];
        const byId = new Map((__companies || []).map(c => [Number(c.id), c]));
        if (companyIds.length === 0) {
            viewCompanies.innerHTML = '<div class="muted">Aucune entreprise associée.</div>';
        } else {
            viewCompanies.innerHTML = companyIds
                .map(id => byId.get(Number(id)))
                .filter(Boolean)
                .map(c => {
                    const label = `${safeStr(c.groupe)}${c.site ? ' — ' + safeStr(c.site) : ''}`;
                    return `<a class="chip" href="/?company=${encodeURIComponent(c.id)}" style="text-decoration:none;" title="Voir prospects">${escapeHtml(label)}</a>`;
                }).join('');
        }
    }

    // Notes
    if (viewNotes) {
        viewNotes.textContent = __cand.notes || 'Aucune note.';
        if (!__cand.notes) viewNotes.classList.add('muted');
        else viewNotes.classList.remove('muted');
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
}

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
    alert('❌ ID candidat manquant. Ouvrez cette page avec ?id=123');
    return;
  }

  const res = await fetch(`/api/candidates/${id}`);
  if (!res.ok) {
    const txt = await res.text().catch(()=> '');
    alert('❌ Impossible de charger le candidat: ' + (txt || ('HTTP ' + res.status)));
    return;
  }

  const j = await res.json();
  if (!j?.ok) {
    alert('❌ Impossible de charger le candidat.');
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
  document.getElementById('fNotes').value = safeStr(__cand.notes);

  __skills = Array.isArray(__cand.skills) ? uniqCaseInsensitive(__cand.skills) : [];
  renderSkills();

  setLinkButton('btnOpenLinkedIn', __cand.linkedin);
  setLinkButton('btnOpenOneNote', __cand.onenote_url);
  setLinkButton('btnOpenVSA', __cand.vsa_url);

  applyCompanySelection(Array.isArray(__cand.company_ids) ? __cand.company_ids : []);

  // Render view mode
  renderViewMode();

  // EC1 section
  await loadEC1Checklist();
  updateEC1Visibility(false);
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
    alert('❌ Enregistrement impossible: ' + (txt || ('HTTP ' + res.status)));
    return;
  }

  if (typeof showToast === 'function') showToast('✅ Candidat enregistré', 'success');
  else alert('✅ Candidat enregistré.');
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

    // Show/hide EC1 section instantly on status change
    document.getElementById('fStatus')?.addEventListener('change', () => {
        updateEC1Visibility(true);
    });
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

    // ═══ Scrapping IA button (Ollama en 1 clic) ═══
    window.handleCandidateIAButton = function() {
        if (!__cand) { alert('Aucun candidat chargé'); return; }
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
        (typeof callOllama === 'function' ? callOllama(prompt) : Promise.reject(new Error('callOllama manquant')))
            .then(function (text) {
                if (typeof openIAImportModalWithText === 'function') openIAImportModalWithText('candidate', __cand.id, text);
                else if (typeof openIAImportModal === 'function') { openIAImportModal('candidate', __cand.id); document.getElementById('iaImportTextarea').value = text; if (typeof parseIAImportModal === 'function') parseIAImportModal(); }
            })
            .catch(function () {
                if (typeof openIAImportModal === 'function') openIAImportModal('candidate', __cand.id);
                if (typeof showToast === 'function') showToast('Ollama indisponible. Collez manuellement le retour ci-dessous.', 'warning', 6000);
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

    await loadCandidate();
    loadCandidateFolder();

    // URL param: auto edit mode / open section
    const params = new URLSearchParams(window.location.search);
    if (params.get('edit') === '1') switchToEditMode();
    if ((params.get('section') || '').toLowerCase() === 'ec1') {
        updateEC1Visibility(true);
    }

  } catch (e) {
    console.error(e);
    alert('❌ Erreur au chargement. Vérifiez que le serveur Python est lancé (app.py).');
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
            box.innerHTML = '';
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
