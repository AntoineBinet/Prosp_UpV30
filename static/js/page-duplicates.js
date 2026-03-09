// Duplicates page
// safeStr() and escapeHtml() are provided by app.js

function badge(text) {
  return `<span class="badge">${escapeHtml(text)}</span>`;
}

function companyLine(c) {
  const title = `${safeStr(c.groupe)}${c.site ? ' — ' + safeStr(c.site) : ''}`.trim() || `Entreprise #${c.id}`;
  const tags = Array.isArray(c.tags) ? c.tags : (typeof c.tags === 'string' ? (() => { try { return JSON.parse(c.tags||'[]'); } catch { return []; } })() : []);
  const tagsHtml = tags.length ? `<div class="chips" style="margin-top:6px;">${tags.map(t=>`<span class="chip">${escapeHtml(String(t))}</span>`).join('')}</div>` : '';
  const notes = safeStr(c.notes||'').trim();
  const notesHtml = notes ? `<div class="muted" style="margin-top:6px; white-space:pre-wrap;">${escapeHtml(notes.slice(0,160))}${notes.length>160?'…':''}</div>` : '';
  return `<div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px;">
    <div>
      <div style="font-weight:800;">${escapeHtml(title)}</div>
      ${tagsHtml}
      ${notesHtml}
    </div>
    <div class="muted">#${c.id}</div>
  </div>`;
}

function prospectLine(p) {
  const title = safeStr(p.name||'').trim() || `Prospect #${p.id}`;
  const secParts = [];
  if (p.company) secParts.push(p.company);
  if (p.email) secParts.push(p.email);
  if (p.telephone) secParts.push(p.telephone);
  if (p.linkedin) secParts.push('LinkedIn');
  const sec = secParts.filter(Boolean).join(' · ');
  return `<div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px;">
    <div>
      <div style="font-weight:800;">${escapeHtml(title)}</div>
      <div class="muted">${escapeHtml(sec)}</div>
    </div>
    <div class="muted">#${p.id}</div>
  </div>`;
}

function renderGroupCard(title, itemsHtml, dataAttr) {
  const attr = dataAttr ? ` ${dataAttr}` : '';
  return `<div class="card" style="margin-top:12px;"${attr}>
    <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:10px;">
      <div style="font-weight:900;">${escapeHtml(title)}</div>
    </div>
    ${itemsHtml}
  </div>`;
}

let prospectGroupsData = [];
let companyGroupsData = [];
const excludedFromProspectGroup = new Map();
const excludedFromCompanyGroup = new Map();

function updateDupSummary() {
  const summary = document.getElementById('dupSummary');
  if (!summary) return;
  const prospectCount = prospectGroupsData.filter((g, i) => {
    const items = (g.items || []).filter(p => !(excludedFromProspectGroup.get(i) || new Set()).has(p.id));
    return items.length >= 2;
  }).length;
  const companyCount = companyGroupsData.filter((g, i) => {
    const items = (g.items || []).filter(c => !(excludedFromCompanyGroup.get(i) || new Set()).has(c.id));
    return items.length >= 2;
  }).length;
  summary.textContent = `Prospects: ${prospectCount} groupes · Entreprises: ${companyCount} groupes`;
}

function excludeProspectFromGroup(groupIdx, prospectId) {
  if (!excludedFromProspectGroup.has(groupIdx)) excludedFromProspectGroup.set(groupIdx, new Set());
  excludedFromProspectGroup.get(groupIdx).add(prospectId);
  renderProspectGroups();
}

function mergeProspectIntoSelected(groupIdx, mergeId) {
  const card = document.querySelector(`[data-dup-group-idx="${groupIdx}"]`);
  if (!card) return;
  const radio = card.querySelector(`input[name="dup_keep_${groupIdx}"]:checked`);
  if (!radio) return;
  const keepId = parseInt(radio.value, 10);
  if (keepId === mergeId) {
    if (typeof showToast === 'function') showToast('Choisissez une autre fiche à garder.', 'warning');
    else alert('Choisissez une autre fiche à garder.');
    return;
  }
  openMergeModal(keepId, mergeId);
}

function mergeSelectedInGroup(groupIdx) {
  const card = document.querySelector(`[data-dup-group-idx="${groupIdx}"]`);
  if (!card) return;
  const radio = card.querySelector(`input[name="dup_keep_${groupIdx}"]:checked`);
  if (!radio) return;
  const keepId = parseInt(radio.value, 10);
  const checkboxes = card.querySelectorAll(`input[name="dup_merge_${groupIdx}"]:checked`);
  const mergeIds = Array.from(checkboxes).map(cb => parseInt(cb.value, 10)).filter(id => id !== keepId);
  if (mergeIds.length === 0) {
    if (typeof showToast === 'function') showToast('Sélectionnez au moins une fiche à fusionner (cochez « Inclure »).', 'warning');
    else alert('Sélectionnez au moins une fiche à fusionner (cochez « Inclure »).');
    return;
  }
  openMergeModal(keepId, mergeIds[0], mergeIds.slice(1));
}

function renderProspectGroups() {
  const outPros = document.getElementById('dupProspects');
  outPros.innerHTML = '';
  let visibleCount = 0;
  prospectGroupsData.forEach((g, idx) => {
    const items = (Array.isArray(g.items) ? g.items : []).filter(
      p => !(excludedFromProspectGroup.get(idx) || new Set()).has(p.id)
    );
    if (items.length < 2) return;
    visibleCount++;
    const typeLabel = (g.type === 'name_company' && g.score != null)
      ? `Similarité nom + même entreprise · ${g.score}`
      : (g.type || '');
    const itemsHtml = `
      <div class="muted" style="margin-bottom:10px;">Clé: <code>${escapeHtml(g.key||'')}</code> · Type: ${badge(typeLabel)}</div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr><th>Garder</th><th>Prospect</th><th>Fusionner</th><th style="text-align:right;">Actions</th></tr>
          </thead>
          <tbody>
            ${items.map((p,i)=>{
              const radioChecked = i === 0 ? ' checked' : '';
              const mergeCb = i === 0 ? '' : `<label><input type="checkbox" class="dup-merge-cb" name="dup_merge_${idx}" value="${p.id}"> Inclure</label>`;
              return `
                <tr>
                  <td style="width:120px;"><label><input type="radio" name="dup_keep_${idx}" value="${p.id}"${radioChecked}> Garder</label></td>
                  <td>${prospectLine(p)}</td>
                  <td style="width:90px;">${mergeCb}</td>
                  <td style="text-align:right; white-space:nowrap;">
                    <button class="mini-action" onclick="mergeProspectIntoSelected(${idx}, ${p.id})">Fusionner →</button>
                    <button class="mini-action" type="button" onclick="excludeProspectFromGroup(${idx}, ${p.id})">Exclure</button>
                    <a class="mini-action" href="/?open=${p.id}">👁️</a>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
      <div style="margin-top:10px;">
        <button type="button" class="btn btn-primary btn-sm" onclick="mergeSelectedInGroup(${idx})">Fusionner la sélection</button>
      </div>
    `;
    outPros.insertAdjacentHTML('beforeend', renderGroupCard(`Groupe prospect #${idx+1} (${items.length})`, itemsHtml, `data-dup-group-idx="${idx}"`));
  });
  if (visibleCount === 0) {
    outPros.innerHTML = '<div class="card"><div class="muted">Aucun doublon prospect détecté.</div></div>';
  }
  updateDupSummary();
}

function excludeCompanyFromGroup(groupIdx, companyId) {
  if (!excludedFromCompanyGroup.has(groupIdx)) excludedFromCompanyGroup.set(groupIdx, new Set());
  excludedFromCompanyGroup.get(groupIdx).add(companyId);
  renderCompanyGroups();
}

function mergeCompanyIntoSelected(groupIdx, mergeId) {
  const card = document.querySelector(`[data-dup-company-group-idx="${groupIdx}"]`);
  if (!card) return;
  const radio = card.querySelector(`input[name="dup_keep_company_${groupIdx}"]:checked`);
  if (!radio) return;
  const keepId = parseInt(radio.value, 10);
  if (keepId === mergeId) {
    if (typeof showToast === 'function') showToast('Choisissez une autre entreprise à garder.', 'warning');
    else alert('Choisissez une autre entreprise à garder.');
    return;
  }
  mergeCompany(keepId, mergeId);
}

function renderCompanyGroups() {
  const outComps = document.getElementById('dupCompanies');
  outComps.innerHTML = '';
  let visibleCount = 0;
  companyGroupsData.forEach((g, idx) => {
    const items = (Array.isArray(g.items) ? g.items : []).filter(
      c => !(excludedFromCompanyGroup.get(idx) || new Set()).has(c.id)
    );
    if (items.length < 2) return;
    visibleCount++;
    const itemsHtml = `
      <div class="muted" style="margin-bottom:10px;">Clé: <code>${escapeHtml(g.key||'')}</code></div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr><th>Garder</th><th>Entreprise</th><th style="text-align:right;">Actions</th></tr>
          </thead>
          <tbody>
            ${items.map((c,i)=>{
              const checked = i === 0 ? ' checked' : '';
              return `
                <tr>
                  <td style="width:120px;"><label><input type="radio" name="dup_keep_company_${idx}" value="${c.id}"${checked}> Garder</label></td>
                  <td>${companyLine(c)}</td>
                  <td style="text-align:right; white-space:nowrap;">
                    <button class="mini-action" onclick="mergeCompanyIntoSelected(${idx}, ${c.id})">Fusionner →</button>
                    <button class="mini-action" type="button" onclick="excludeCompanyFromGroup(${idx}, ${c.id})">Exclure</button>
                    <a class="mini-action" href="/entreprises?openCompany=${c.id}">👁️</a>
                    <a class="mini-action" href="/?company=${c.id}">👥</a>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
    outComps.insertAdjacentHTML('beforeend', renderGroupCard(`Groupe entreprise #${idx+1} (${items.length})`, itemsHtml, `data-dup-company-group-idx="${idx}"`));
  });
  if (visibleCount === 0) {
    outComps.innerHTML = '<div class="card"><div class="muted">Aucun doublon entreprise détecté.</div></div>';
  }
  updateDupSummary();
}

async function loadDuplicates() {
  const minScore = parseFloat(document.getElementById('dupMinScore')?.value || '0.7');
  const summary = document.getElementById('dupSummary');
  const outPros = document.getElementById('dupProspects');
  const outComps = document.getElementById('dupCompanies');

  outPros.innerHTML = '<div class="card"><div class="muted">Chargement…</div></div>';
  outComps.innerHTML = '<div class="card"><div class="muted">Chargement…</div></div>';

  const res = await fetch(`/api/duplicates?min_score=${encodeURIComponent(minScore)}`);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();

  prospectGroupsData = Array.isArray(json?.prospect_groups) ? json.prospect_groups : [];
  companyGroupsData = Array.isArray(json?.company_groups) ? json.company_groups : [];
  excludedFromProspectGroup.clear();
  excludedFromCompanyGroup.clear();

  renderProspectGroups();
  renderCompanyGroups();
}

// Libellés des champs pour la modale de fusion
const MERGE_FIELD_LABELS = {
  name: 'Nom',
  company_id: 'Entreprise',
  fonction: 'Fonction',
  telephone: 'Téléphone',
  email: 'Email',
  linkedin: 'LinkedIn',
  pertinence: 'Pertinence',
  statut: 'Statut',
  lastContact: 'Dernier contact',
  nextFollowUp: 'Prochaine relance',
  priority: 'Priorité',
  notes: 'Notes',
  callNotes: 'Notes d\'appel',
  pushEmailSentAt: 'Push email envoyé le',
  tags: 'Tags',
  template_id: 'Catégorie push'
};

let _mergeKeepId = null;
let _mergeMergeId = null;
let _mergeNextIds = [];

function closeMergeModal() {
  const el = document.getElementById('mergeProspectModal');
  if (el) el.classList.remove('active');
  _mergeKeepId = _mergeMergeId = null;
  _mergeNextIds = [];
}

function formatMergeValue(field, value, companies) {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'company_id' && companies && companies.length) {
    const c = companies.find(x => String(x.id) === String(value));
    if (c) return (c.groupe || '') + (c.site ? ' — ' + c.site : '');
  }
  if (field === 'tags') {
    try {
      const arr = typeof value === 'string' ? JSON.parse(value || '[]') : value;
      return Array.isArray(arr) ? arr.join(', ') : String(value);
    } catch { return String(value); }
  }
  if (field === 'callNotes') {
    try {
      const arr = typeof value === 'string' ? JSON.parse(value || '[]') : value;
      return Array.isArray(arr) ? arr.length + ' entrée(s)' : String(value);
    } catch { return String(value); }
  }
  return String(value);
}

async function openMergeModal(keepId, mergeId, nextMergeIds) {
  _mergeKeepId = keepId;
  _mergeMergeId = mergeId;
  _mergeNextIds = Array.isArray(nextMergeIds) ? nextMergeIds : [];
  document.getElementById('mergeKeepId').textContent = keepId;
  document.getElementById('mergeMergeId').textContent = mergeId;
  const body = document.getElementById('mergeModalBody');
  body.innerHTML = '<div class="muted">Chargement…</div>';
  document.getElementById('mergeProspectModal').classList.add('active');

  let data;
  try {
    const res = await fetch(`/api/duplicates/merge-preview?keep_id=${keepId}&merge_id=${mergeId}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    data = await res.json();
    if (!data.ok || !data.keep || !data.merge) throw new Error('Données invalides');
  } catch (e) {
    body.innerHTML = '<div class="muted" style="color: var(--color-danger);">Erreur: ' + escapeHtml(String(e.message)) + '</div>';
    return;
  }

  const keep = data.keep;
  const merge = data.merge;
  const companies = data.companies || [];
  const fields = data.mergeable_fields || [];
  const appendFields = data.append_fields || [];

  const rows = fields.map(field => {
    const label = MERGE_FIELD_LABELS[field] || field;
    const valA = formatMergeValue(field, keep[field], companies);
    const valB = formatMergeValue(field, merge[field], companies);
    const canBoth = appendFields.includes(field);
    const name = 'merge_choice_' + field;
    const opts = canBoth
      ? `
        <label><input type="radio" name="${name}" value="keep" checked> A (gardée)</label>
        <label><input type="radio" name="${name}" value="merge"> B (fusionnée)</label>
        <label><input type="radio" name="${name}" value="both"> Fusionner (A+B)</label>
      `
      : `
        <label><input type="radio" name="${name}" value="keep" checked> A (gardée)</label>
        <label><input type="radio" name="${name}" value="merge"> B (fusionnée)</label>
      `;
    return `
      <tr>
        <td style="vertical-align:top;"><strong>${escapeHtml(label)}</strong></td>
        <td class="muted" style="max-width:200px; word-break:break-word;">${escapeHtml(valA)}</td>
        <td class="muted" style="max-width:200px; word-break:break-word;">${escapeHtml(valB)}</td>
        <td style="white-space:nowrap;">${opts}</td>
      </tr>
    `;
  }).join('');

  body.innerHTML = `
    <div class="table-wrapper" style="max-height: 60vh; overflow: auto;">
      <table>
        <thead>
          <tr>
            <th>Champ</th>
            <th>Fiche A (gardée)</th>
            <th>Fiche B (fusionnée)</th>
            <th>Garder</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  const btn = document.getElementById('mergeConfirmBtn');
  btn.onclick = async () => {
    const choices = {};
    fields.forEach(field => {
      const radio = document.querySelector(`input[name="merge_choice_${field}"]:checked`);
      if (radio) choices[field] = radio.value;
    });
    btn.disabled = true;
    try {
      const res = await fetch('/api/duplicates/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keep_id: keepId, merge_id: mergeId, choices })
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        alert('Fusion impossible: ' + (t || ('HTTP ' + res.status)));
        return;
      }
      const remaining = _mergeNextIds.slice();
      closeMergeModal();
      if (remaining.length > 0) {
        openMergeModal(keepId, remaining[0], remaining.slice(1));
        if (typeof showToast === 'function') showToast('Fiche fusionnée. Choix pour la suivante…', 'success');
      } else {
        await loadDuplicates();
        if (typeof showToast === 'function') showToast('Prospects fusionnés.', 'success');
        else alert('Prospects fusionnés.');
      }
    } finally {
      btn.disabled = false;
    }
  };
}

async function mergeProspect(keepId, mergeId) {
  await openMergeModal(keepId, mergeId);
}

async function mergeCompany(keepId, mergeId) {
  if (!confirm(`Fusionner l’entreprise #${mergeId} dans #${keepId} ?\n\nLes prospects seront rattachés à l’entreprise gardée.`)) return;
  const res = await fetch('/api/companies/merge', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ keep_id: keepId, merge_id: mergeId })
  });
  if (!res.ok) {
    const t = await res.text().catch(()=> '');
    alert('❌ Fusion impossible: ' + (t || ('HTTP ' + res.status)));
    return;
  }
  await loadDuplicates();
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const fn = window.bootstrap || window.appBootstrap;
    if (typeof fn === 'function') await fn('duplicates');
  } catch(e) {}
  document.getElementById('btnDupReload')?.addEventListener('click', loadDuplicates);
  document.getElementById('dupMinScore')?.addEventListener('change', loadDuplicates);

  try {
    await loadDuplicates();
  } catch(err) {
    console.error(err);
    alert("❌ Impossible de charger les doublons. Vérifiez que le serveur Python est lancé (app.py)." );
  }
});
