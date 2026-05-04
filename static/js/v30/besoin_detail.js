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

  function hydrate() {
    const b = state.besoin || {};
    // Champs simples
    [
      'intitule', 'client', 'contact', 'localisation',
      'date_appel', 'date_besoin', 'duree_mission',
      'profil_type', 'descriptif', 'competences',
      'connaissances', 'experience', 'commentaires',
      'statut',
    ].forEach(k => {
      const el = root.querySelector('[data-v30-besoin-field="' + k + '"]');
      if (el) el.value = b[k] || '';
    });

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

    // Meta
    const meta = root.querySelector('[data-field="meta"]');
    if (meta) {
      const parts = [];
      if (b.client) parts.push(escapeHtml(b.client));
      if (b.contact) parts.push(escapeHtml(b.contact));
      if (b.localisation) parts.push(escapeHtml(b.localisation));
      meta.innerHTML = parts.length ? parts.join(' · ') : '<span class="muted">Pas encore de méta</span>';
    }

    // Created / updated
    const ca = root.querySelector('[data-field="created-at"]');
    if (ca) ca.textContent = fmtDate(b.created_at);
    const ua = root.querySelector('[data-field="updated-at"]');
    if (ua) ua.textContent = fmtDate(b.updated_at);

    // Lien prospect (banner + aside)
    renderLink();

    // Candidats
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
      'intitule', 'client', 'contact', 'localisation',
      'date_appel', 'date_besoin', 'duree_mission',
      'profil_type', 'descriptif', 'competences',
      'connaissances', 'experience', 'commentaires',
      'statut',
    ].forEach(k => {
      const el = root.querySelector('[data-v30-besoin-field="' + k + '"]');
      payload[k] = el ? el.value : (b[k] || '');
    });
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
        // Met à jour l'affichage du titre / pill / meta sans réinjecter les inputs
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
    // Save first if dirty
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

  // ─── Liaison prospect ────────────────────────────────────
  function openLinkModal() {
    const md = document.querySelector('[data-v30-link-modal]');
    if (!md) return;
    md.hidden = false;
    const search = document.getElementById('v30-link-search');
    if (search) {
      search.value = '';
      setTimeout(() => search.focus(), 50);
    }
    renderLinkResults([]);
  }
  function closeLinkModal() {
    const md = document.querySelector('[data-v30-link-modal]');
    if (md) md.hidden = true;
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
            // Normalisation : on attend [{id, name, company_name}]
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
          // Le serveur pré-remplit client / contact / localisation
          // depuis le prospect lié si ces champs sont vides.
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
