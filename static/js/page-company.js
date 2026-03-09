// Company detail page (v6)

(function(){
  const STAGES = ["Prosp", "RDV", "Proposition", "RT", "Won", "Lost", "NoGo"];

  function qs(id){ return document.getElementById(id); }
  function getCid(){
    const p = new URLSearchParams(window.location.search);
    const id = p.get('id') || p.get('company') || '';
    const n = parseInt(id, 10);
    return Number.isFinite(n) ? n : null;
  }

  function showError(msg){
    const box = qs('companyError');
    const m = qs('companyErrorMsg');
    if (m) m.textContent = msg || 'Erreur inconnue';
    if (box) box.style.display = 'block';
    const main = qs('companyMain');
    if (main) main.style.display = 'none';
  }
  function showMain(){
    const box = qs('companyError');
    if (box) box.style.display = 'none';
    const main = qs('companyMain');
    if (main) main.style.display = 'block';
  }

  function safeText(v){ return escapeHtml(v ?? ''); }

  function stageOptions(current){
    const c = String(current || '').trim();
    return STAGES.map(s => `<option value="${safeText(s)}" ${c===s?'selected':''}>${safeText(s)}</option>`).join('');
  }

  function money(v){
    if (v === null || v === undefined || v === '') return '';
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return n.toLocaleString('fr-FR');
  }

  function renderOpp(opp){
    const id = opp && opp.id ? Number(opp.id) : 0;
    const title = opp?.title || '';
    const stage = opp?.stage || 'Prosp';
    const cand = opp?.candidate_name || '';
    const candLink = opp?.candidate_link || '';
    const amount = (opp?.amount === null || opp?.amount === undefined) ? '' : String(opp.amount);
    const notes = opp?.notes || '';

    return `
      <div class="card" style="margin-top:10px;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap;">
          <div style="font-weight:800;">${id ? ('#' + id) : 'Nouvelle opportunité'}</div>
          <div style="display:flex; gap:8px;">
            <button class="btn btn-primary" onclick="window.__oppSave(${id})">💾</button>
            <button class="btn btn-danger" onclick="window.__oppDelete(${id})" ${id? '':'disabled'}>🗑️</button>
          </div>
        </div>

        <div class="form-grid" style="margin-top:10px;">
          <div style="grid-column:1 / -1;">
            <label style="font-weight:600;">Titre *</label>
            <input id="opp_title_${id}" type="text" value="${safeText(title)}" style="width:100%; padding:10px; border:1px solid var(--color-border); border-radius:12px; margin-top:6px;">
          </div>

          <div>
            <label style="font-weight:600;">Stage</label>
            <select id="opp_stage_${id}" style="width:100%; padding:10px; border:1px solid var(--color-border); border-radius:12px; margin-top:6px;">
              ${stageOptions(stage)}
            </select>
          </div>

          <div>
            <label style="font-weight:600;">Montant (€)</label>
            <input id="opp_amount_${id}" type="number" step="0.01" value="${safeText(amount)}" style="width:100%; padding:10px; border:1px solid var(--color-border); border-radius:12px; margin-top:6px;">
          </div>

          <div>
            <label style="font-weight:600;">Candidat</label>
            <input id="opp_cand_${id}" type="text" value="${safeText(cand)}" style="width:100%; padding:10px; border:1px solid var(--color-border); border-radius:12px; margin-top:6px;">
          </div>

          <div>
            <label style="font-weight:600;">Lien candidat</label>
            <input id="opp_candlink_${id}" type="text" value="${safeText(candLink)}" style="width:100%; padding:10px; border:1px solid var(--color-border); border-radius:12px; margin-top:6px;">
          </div>

          <div style="grid-column:1 / -1;">
            <label style="font-weight:600;">Notes</label>
            <textarea id="opp_notes_${id}" rows="3" style="width:100%; padding:10px; border:1px solid var(--color-border); border-radius:12px; margin-top:6px;">${safeText(notes)}</textarea>
          </div>
        </div>
      </div>
    `;
  }

  function renderOppList(opps){
    const host = qs('oppList');
    if (!host) return;
    if (!Array.isArray(opps) || opps.length === 0) {
      host.innerHTML = '<div class="muted">Aucune opportunité.</div>';
      return;
    }
    // sort by stage order then updatedAt
    const order = Object.fromEntries(STAGES.map((s,i)=>[s,i]));
    const sorted = [...opps].sort((a,b)=>{
      const oa = order[String(a.stage||'')] ?? 999;
      const ob = order[String(b.stage||'')] ?? 999;
      if (oa !== ob) return oa - ob;
      return String(b.updatedAt||'').localeCompare(String(a.updatedAt||''), 'fr');
    });
    host.innerHTML = sorted.map(renderOpp).join('');
  }

  function renderProspects(prospects){
    const body = qs('companyProspectsBody');
    const count = qs('companyProspectCount');
    if (!body) return;
    const arr = Array.isArray(prospects) ? prospects : [];
    if (count) count.textContent = `${arr.length} prospect(s)`;

    if (arr.length === 0) {
      body.innerHTML = '<tr><td colspan="5" class="muted" style="padding:14px; text-align:center;">Aucun prospect lié.</td></tr>';
      return;
    }
    const rows = arr
      .sort((a,b)=> String(b.lastContact||'').localeCompare(String(a.lastContact||''), 'fr'))
      .map(p=>{
        const open = `/?open=${Number(p.id)}`;
        // The email icon now copies the address to the clipboard instead of opening the mail application.
        const mail = p.email ? `<a class="mini-action" href="javascript:void(0)" onclick="copyEmailToClipboard('${safeText(p.email).replace(/'/g,"\\'")}')" title="Copier l'email">✉️</a>` : '';
        const tel = p.telephone ? `<a class="mini-action" href="tel:${safeText(p.telephone)}" title="Appeler">📞</a>` : '';
        const li = p.linkedin ? `<a class="mini-action" href="${safeText(p.linkedin)}" target="_blank" title="LinkedIn">in</a>` : '';
        return `
          <tr>
            <td><div style="font-weight:700;">${safeText(p.name||'')}</div></td>
            <td class="muted">${safeText(p.fonction||'')}</td>
            <td>${safeText(p.statut||'')}</td>
            <td>${p.nextFollowUp ? `<span class="badge">${safeText(p.nextFollowUp)}</span>` : '<span class="muted">—</span>'}</td>
            <td style="text-align:right; white-space:nowrap;">
              ${tel}${mail}${li}
              <a class="mini-action" href="${open}" title="Ouvrir fiche">👁️</a>
            </td>
          </tr>
        `;
      }).join('');
    body.innerHTML = rows;
  }

  function renderTimeline(items){
    const host = qs('companyTimeline');
    if (!host) return;
    const arr = Array.isArray(items) ? items : [];
    if (!arr.length) {
      host.innerHTML = '<div class="muted">Aucun événement.</div>';
      return;
    }
    host.innerHTML = arr.map(e=>{
      const d = String(e.date||'').slice(0,19).replace('T',' ');
      const title = e.title || e.type || '';
      const content = (e.content || '').trim();
      return `
        <div class="timeline-item" style="padding: 10px 0; border-bottom: 1px solid var(--color-border);">
          <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;">
            <div style="font-weight:700;">${safeText(title)}</div>
            <div class="muted">${safeText(d)}</div>
          </div>
          ${content ? `<div style="margin-top:6px; white-space:pre-wrap;">${safeText(content)}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  async function loadAll(){
    const cid = getCid();
    if (!cid) {
      showError("ID entreprise manquant. Ouvrez la fiche depuis /entreprises.");
      return;
    }
    try {
      const res = await fetch(`/api/company/full?id=${cid}`);
      if (!res.ok) throw new Error('HTTP '+res.status);
      const payload = await res.json();
      if (!payload || !payload.ok) throw new Error(payload?.error || 'Erreur API');

      const company = payload.company || {};
      showMain();

      // header + links
      const title = `${company.groupe || 'Entreprise'}${company.site ? ' · ' + company.site : ''}`;
      const h = qs('companyTitle');
      if (h) h.textContent = title;
      const vbtn = qs('btnViewProspects');
      if (vbtn) vbtn.href = `/?company=${cid}`;
      const abtn = qs('btnAddProspect');
      if (abtn) abtn.href = `/?add=1&company=${cid}`;

      // hero + quick actions
      const heroTitle = qs('companyHeroTitle');
      if (heroTitle) heroTitle.textContent = title;
      const heroSub = qs('companyHeroSub');
      if (heroSub) {
        const parts = [company.industry, company.size].filter(Boolean).map(String);
        heroSub.textContent = parts.length ? parts.join(' · ') : '';
      }
      const phoneLink = qs('companyHeroPhone');
      if (phoneLink) {
        const phone = (company.phone || '').trim();
        if (phone && phone !== 'Non disponible') {
          phoneLink.href = 'tel:' + phone.replace(/\s/g, '');
          phoneLink.style.display = '';
        } else {
          phoneLink.style.display = 'none';
        }
      }
      const webLink = qs('companyHeroWebsite');
      if (webLink) {
        const url = (company.website || '').trim();
        if (url) {
          webLink.href = url.startsWith('http') ? url : 'https://' + url;
          webLink.style.display = '';
        } else {
          webLink.style.display = 'none';
        }
      }
      const liLink = qs('companyHeroLinkedin');
      if (liLink) {
        const url = (company.linkedin || '').trim();
        if (url) {
          liLink.href = url.startsWith('http') ? url : 'https://' + url;
          liLink.style.display = '';
        } else {
          liLink.style.display = 'none';
        }
      }
      const prospectsLink = qs('companyHeroProspects');
      if (prospectsLink) prospectsLink.href = `/?company=${cid}`;

      // fill fields
      qs('c_groupe').value = company.groupe || '';
      qs('c_site').value = company.site || '';
      qs('c_phone').value = company.phone || '';
      qs('c_notes').value = company.notes || '';
      qs('c_website').value = company.website || '';
      qs('c_linkedin').value = company.linkedin || '';
      qs('c_industry').value = company.industry || '';
      qs('c_size').value = company.size || '';
      qs('c_address').value = company.address || '';
      qs('c_city').value = company.city || '';
      qs('c_country').value = company.country || '';
      qs('c_stack').value = company.stack || '';
      qs('c_pain_points').value = company.pain_points || '';
      qs('c_budget').value = company.budget || '';
      qs('c_urgency').value = company.urgency || '';

      // tags editor
      try {
        const tags = Array.isArray(company.tags) ? company.tags : [];
        const hidden = qs('c_tags_value');
        if (hidden) hidden.value = JSON.stringify(tags);
        initTagsEditor('c_tags_editor', 'c_tags_value', tags);
      } catch(e){}

      // render
      window.__companyFull = payload;
      renderOppList(payload.opportunities || []);
      renderProspects(payload.prospects || []);
      renderTimeline(payload.timeline || []);
    } catch (e) {
      console.error(e);
      showError("Impossible de charger l'entreprise. Vérifiez que le serveur Python est lancé (app.py).");
    }
  }

  async function saveCompany(){
    const cid = getCid();
    if (!cid) return;
    const tags = readTagsFromHidden('c_tags_value');
    const payload = {
      id: cid,
      groupe: qs('c_groupe').value,
      site: qs('c_site').value,
      phone: qs('c_phone').value,
      notes: qs('c_notes').value,
      tags,
      website: qs('c_website').value,
      linkedin: qs('c_linkedin').value,
      industry: qs('c_industry').value,
      size: qs('c_size').value,
      address: qs('c_address').value,
      city: qs('c_city').value,
      country: qs('c_country').value,
      stack: qs('c_stack').value,
      pain_points: qs('c_pain_points').value,
      budget: qs('c_budget').value,
      urgency: qs('c_urgency').value
    };
    try {
      const res = await fetch('/api/company/update', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('HTTP '+res.status);
      const out = await res.json();
      if (!out.ok) throw new Error(out.error || 'Erreur');
      // also keep local caches
      await loadAll();
      alert("✅ Entreprise enregistrée.");
    } catch(e){
      console.error(e);
      alert("❌ Impossible d'enregistrer l'entreprise.");
    }
  }

  function getOppPayload(id){
    const cid = getCid();
    if (!cid) return null;
    const nid = Number(id||0) || null;
    const title = (qs(`opp_title_${id}`)?.value || '').trim();
    const stage = (qs(`opp_stage_${id}`)?.value || 'Prosp').trim();
    const candidate_name = (qs(`opp_cand_${id}`)?.value || '').trim();
    const candidate_link = (qs(`opp_candlink_${id}`)?.value || '').trim();
    const amount = (qs(`opp_amount_${id}`)?.value || '').trim();
    const notes = (qs(`opp_notes_${id}`)?.value || '');
    return { id: nid, company_id: cid, title, stage, candidate_name, candidate_link, amount: amount===''?null:amount, notes };
  }

  window.__oppSave = async function(id){
    const cid = getCid();
    if (!cid) return;
    const payload = getOppPayload(id);
    if (!payload || !payload.title) {
      alert("⚠️ Titre requis.");
      return;
    }
    try{
      const res = await fetch('/api/opportunities/save', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('HTTP '+res.status);
      const out = await res.json();
      if (!out.ok) throw new Error(out.error||'Erreur');
      await loadAll();
    }catch(e){
      console.error(e);
      alert("❌ Impossible d'enregistrer l'opportunité.");
    }
  };

  window.__oppDelete = async function(id){
    const nid = Number(id||0);
    if (!nid) return;
    if (!confirm("Supprimer cette opportunité ?")) return;
    try{
      const res = await fetch('/api/opportunities/delete', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({id:nid})
      });
      if (!res.ok) throw new Error('HTTP '+res.status);
      const out = await res.json();
      if (!out.ok) throw new Error(out.error||'Erreur');
      await loadAll();
    }catch(e){
      console.error(e);
      alert("❌ Suppression impossible.");
    }
  };

  async function addOpp(){
    // create a temporary entry locally to render a blank card
    const payload = window.__companyFull;
    const opps = Array.isArray(payload?.opportunities) ? payload.opportunities : [];
    // render a single new card with id 0 at top
    const host = qs('oppList');
    if (!host) return;
    const blank = { id: 0, title:'', stage:'Prosp', candidate_name:'', candidate_link:'', amount:'', notes:'' };
    host.insertAdjacentHTML('afterbegin', renderOpp(blank));
    // scroll to top of opp section
    try { host.scrollIntoView({ behavior:'smooth', block:'start' }); } catch(e){}
  }

  async function addEvent(){
    const cid = getCid();
    if (!cid) return;
    const title = (prompt("Titre (ex: Note / RDV / Infos)") || '').trim();
    if (!title) return;
    const content = (prompt("Contenu (optionnel)") || '').trim();
    try{
      const res = await fetch('/api/company/events/add', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ company_id: cid, title, content, type:'note' })
      });
      if (!res.ok) throw new Error('HTTP '+res.status);
      const out = await res.json();
      if (!out.ok) throw new Error(out.error||'Erreur');
      await loadAll();
    }catch(e){
      console.error(e);
      alert("❌ Impossible d'ajouter la note.");
    }
  }

  window.initCompanyPage = async function(){
    // refresh buttons
    qs('btnCompanyReload')?.addEventListener('click', loadAll);
    qs('btnCompanySave')?.addEventListener('click', saveCompany);
    qs('btnOppAdd')?.addEventListener('click', addOpp);
    qs('btnEventAdd')?.addEventListener('click', addEvent);
    await loadAll();
  };

  document.addEventListener('DOMContentLoaded', async ()=>{
    try {
      const fn = window.bootstrap || window.appBootstrap;
      if (typeof fn === 'function') await fn('company');
    } catch(e) {
      console.warn(e);
    }
    await loadAll();
  });
})();
