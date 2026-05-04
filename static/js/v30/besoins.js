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
      // ignore clicks on links / buttons
      if (e.target.closest('a, button')) return;
      const row = e.target.closest('[data-v30-besoin-row]');
      if (!row) return;
      const id = row.dataset.id;
      if (id) window.location.href = '/v30/besoins/' + id;
    });
  }

  // ─── Modale création ──────────────────────────────────────────
  function openModal() {
    const md = document.querySelector('[data-v30-besoin-modal]');
    if (!md) return;
    // Reset
    ['intitule', 'client', 'contact', 'localisation', 'duree', 'date-besoin', 'date-appel'].forEach(k => {
      const el = document.getElementById('v30-besoin-' + k);
      if (el) el.value = '';
    });
    const ta = document.getElementById('v30-besoin-descriptif');
    if (ta) ta.value = '';
    md.hidden = false;
    setTimeout(() => {
      const f = document.getElementById('v30-besoin-intitule');
      if (f) f.focus();
    }, 50);
  }

  function closeModal() {
    const md = document.querySelector('[data-v30-besoin-modal]');
    if (md) md.hidden = true;
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
      create.disabled = true;
      try {
        const data = await fetchJSON('/api/besoins', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            intitule,
            client: get('client').trim(),
            contact: get('contact').trim(),
            localisation: get('localisation').trim(),
            duree_mission: get('duree').trim(),
            date_besoin: get('date-besoin'),
            date_appel: get('date-appel'),
            descriptif: (document.getElementById('v30-besoin-descriptif') || {}).value || '',
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
