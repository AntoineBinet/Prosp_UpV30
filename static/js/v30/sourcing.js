/* ProspUp v30 — Sourcing : fetch candidats, kanban par status + grille + CRUD */
(function () {
  'use strict';

  var COLS = [
    { key: 'vivier',    title: 'Vivier',       color: 'var(--info)',          statuses: ['Vivier', 'vivier', 'Actif', null, ''] },
    { key: 'qualifie',  title: 'Qualifié',     color: 'var(--accent)',        statuses: ['Qualifié', 'qualifie', 'Solide'] },
    { key: 'propose',   title: 'Proposé',      color: 'oklch(0.50 0.15 280)', statuses: ['Proposé', 'propose', 'Contacté', 'contacted'] },
    { key: 'entretien', title: 'En entretien', color: 'oklch(0.50 0.14 75)',  statuses: ['En entretien', 'entretien', 'Entretien'] },
    { key: 'place',     title: 'Placé',        color: 'var(--success)',       statuses: ['Placé', 'place', 'Placed'] }
  ];

  var STATE = {
    candidates: [],
    filtered: [],
    q: '',
    selected: new Set(),
    filters: { statuts: [], skills: [], location: '' }
  };

  function $(s) { return document.querySelector(s); }
  function esc(s) { var t = document.createElement('span'); t.textContent = s == null ? '' : String(s); return t.innerHTML; }
  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '??';
    return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }
  function parseSkills(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.filter(Boolean);
    try { return JSON.parse(raw) || []; }
    catch (_) { return String(raw).split(',').map(function (s) { return s.trim(); }).filter(Boolean); }
  }
  function fetchJSON(url, opts) {
    return fetch(url, Object.assign({ credentials: 'same-origin', headers: { 'Accept': 'application/json' } }, opts || {}))
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function fetchPost(url, body) {
    return fetchJSON(url, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
  }
  function toast(msg, type) { if (typeof window.showToast === 'function') window.showToast(msg, type || 'info'); }
  function findColForStatus(statut) {
    for (var i = 0; i < COLS.length; i++) if (COLS[i].statuses.indexOf(statut) >= 0) return i;
    return 0;
  }

  // ─── Modal helpers ───────────────────────────────────────
  function getModal(name) { return document.querySelector('[data-v30-pp-modal="' + name + '"]'); }
  function openModal(m) { if (!m) return; m.hidden = false; void m.offsetWidth; m.classList.add('is-open'); var f = m.querySelector('input:not([type=hidden]),select,textarea,button:not([data-v30-modal-close])'); if (f) try { f.focus(); } catch (_) {} }
  function closeModal(m) { if (!m) return; m.classList.remove('is-open'); setTimeout(function () { m.hidden = true; }, 160); }
  function bindModalDismiss() {
    document.addEventListener('click', function (e) {
      var close = e.target.closest('[data-v30-modal-close]');
      if (close) { var m = close.closest('[data-v30-pp-modal]'); if (m) closeModal(m); return; }
      var bd = e.target.closest('.v30-modal-bd');
      if (bd && e.target === bd && bd.dataset.v30PpModal) closeModal(bd);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      document.querySelectorAll('.v30-modal-bd.is-open[data-v30-pp-modal]').forEach(closeModal);
    });
  }

  // ─── Filtres ─────────────────────────────────────────────
  function passesFilters(c) {
    var F = STATE.filters;
    if (F.statuts && F.statuts.length && F.statuts.indexOf(c.status) < 0) return false;
    if (F.location && (c.location || '').toLowerCase().indexOf(F.location.toLowerCase()) < 0) return false;
    if (F.skills && F.skills.length) {
      var candSkills = parseSkills(c.skills || c.tech).map(function (s) { return String(s).toLowerCase(); });
      for (var i = 0; i < F.skills.length; i++) {
        if (candSkills.indexOf(F.skills[i].toLowerCase()) < 0) return false;
      }
    }
    return true;
  }
  function applyFilter() {
    var q = (STATE.q || '').trim().toLowerCase();
    STATE.filtered = STATE.candidates.filter(function (c) {
      if (!passesFilters(c)) return false;
      if (!q) return true;
      var skills = parseSkills(c.skills || c.tech).join(' ').toLowerCase();
      return (c.name || '').toLowerCase().indexOf(q) >= 0
          || (c.role || '').toLowerCase().indexOf(q) >= 0
          || (c.location || '').toLowerCase().indexOf(q) >= 0
          || skills.indexOf(q) >= 0;
    });
    renderPipeline();
    var gridPanel = $('[data-v30-sc-panel="grid"]');
    if (gridPanel && !gridPanel.hidden) renderGrid();
    renderCount();
  }
  function countActiveFilters() {
    var F = STATE.filters;
    var n = 0;
    if (F.statuts && F.statuts.length) n++;
    if (F.skills && F.skills.length) n++;
    if (F.location) n++;
    return n;
  }
  function updateFilterBadge() {
    var host = $('[data-v30-sc-filters] [data-field="active"]');
    if (!host) return;
    var n = countActiveFilters();
    host.hidden = (n === 0);
    host.textContent = n;
  }

  // ─── Render ──────────────────────────────────────────────
  function renderCard(c) {
    var skills = parseSkills(c.skills || c.tech);
    var shown = skills.slice(0, 3);
    var extra = skills.length - 3;
    var role = c.role || c.seniority || '—';
    var location = c.location || '';
    var sel = STATE.selected.has(c.id);
    return '<div class="v30-sc-card' + (sel ? ' is-selected' : '') + '" data-id="' + c.id + '">' +
      '<div class="v30-sc-card__head">' +
        '<input type="checkbox" data-v30-sc-select' + (sel ? ' checked' : '') + ' style="margin-right:4px;" aria-label="Sélectionner">' +
        '<a href="/v30/candidat/' + c.id + '" class="avatar" title="Voir fiche" style="text-decoration:none;color:inherit;">' + esc(initials(c.name)) + '</a>' +
        '<div style="flex:1;min-width:0;">' +
          '<a href="/v30/candidat/' + c.id + '" style="text-decoration:none;color:inherit;">' +
            '<div class="v30-sc-card__name truncate">' + esc(c.name || '—') + '</div>' +
            '<div class="v30-sc-card__role truncate">' + esc(role) + '</div>' +
          '</a>' +
        '</div>' +
      '</div>' +
      (shown.length
        ? '<div class="v30-sc-card__skills">' +
            shown.map(function (s) { return '<span class="badge">' + esc(s) + '</span>'; }).join('') +
            (extra > 0 ? '<span class="badge muted">+' + extra + '</span>' : '') +
          '</div>'
        : '') +
      (location
        ? '<div class="v30-sc-card__meta">' +
            '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>' +
            esc(location) +
          '</div>'
        : '') +
    '</div>';
  }

  function renderPipeline() {
    var host = $('[data-v30-sc-kanban]');
    if (!host) return;
    var buckets = COLS.map(function () { return []; });
    STATE.filtered.forEach(function (c) { buckets[findColForStatus(c.status)].push(c); });
    host.innerHTML = COLS.map(function (col, i) {
      var items = buckets[i];
      var body = items.length === 0
        ? '<div class="v30-pp-empty" style="padding:16px 8px;font-size:12px;">—</div>'
        : items.map(renderCard).join('');
      return '<div class="v30-sc-col">' +
        '<div class="v30-sc-col__head">' +
          '<span class="v30-sc-col__dot" style="background:' + col.color + ';"></span>' +
          '<span class="v30-sc-col__title">' + esc(col.title) + '</span>' +
          '<span class="v30-sc-col__count num">' + items.length + '</span>' +
          '<div class="v30-spacer"></div>' +
        '</div>' + body +
      '</div>';
    }).join('');
  }

  function renderGrid() {
    var host = $('[data-v30-sc-grid]');
    if (!host) return;
    if (STATE.filtered.length === 0) {
      host.innerHTML = '<div class="empty" style="grid-column:1/-1;padding:20px;">Aucun candidat pour ce filtre.</div>';
      return;
    }
    host.innerHTML = STATE.filtered.map(function (c) {
      var skills = parseSkills(c.skills || c.tech).slice(0, 4);
      var sel = STATE.selected.has(c.id);
      return '<div class="card v30-sc-card' + (sel ? ' is-selected' : '') + '" style="padding:12px;" data-id="' + c.id + '">' +
        '<div class="v30-sc-card__head">' +
          '<input type="checkbox" data-v30-sc-select' + (sel ? ' checked' : '') + ' style="margin-right:4px;" aria-label="Sélectionner">' +
          '<span class="avatar avatar-md">' + esc(initials(c.name)) + '</span>' +
          '<div style="flex:1;min-width:0;">' +
            '<div style="font-size:13px;font-weight:500;" class="truncate">' + esc(c.name || '—') + '</div>' +
            '<div style="font-size:11.5px;color:var(--text-3);" class="truncate">' + esc(c.role || c.seniority || '—') + '</div>' +
          '</div>' +
        '</div>' +
        (skills.length
          ? '<div class="v30-sc-card__skills" style="margin-top:10px;">' +
              skills.map(function (s) { return '<span class="badge">' + esc(s) + '</span>'; }).join('') +
            '</div>'
          : '') +
        (c.location ? '<div class="v30-sc-card__meta" style="margin-top:8px;">' + esc(c.location) + '</div>' : '') +
        '<div style="display:flex;gap:6px;margin-top:10px;">' +
          '<a class="btn btn-sm" href="/v30/candidat/' + c.id + '">Voir fiche</a>' +
          '<span class="muted" style="font-size:11px;align-self:center;">' + esc(c.status || '—') + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function renderCount() {
    var el = $('[data-v30-sourcing] [data-field="count"]');
    if (el) el.textContent = '· ' + STATE.filtered.length + ' affiché' + (STATE.filtered.length > 1 ? 's' : '');
  }

  // ─── Selection + bulk ────────────────────────────────────
  function renderBulk() {
    var bar = $('[data-v30-sc-bulk]');
    if (!bar) return;
    var n = STATE.selected.size;
    bar.hidden = (n === 0);
    var c = bar.querySelector('[data-field="n"]');
    if (c) c.textContent = n;
  }
  function bindSelection() {
    document.addEventListener('change', function (e) {
      var cb = e.target.closest('[data-v30-sc-select]');
      if (!cb) return;
      var card = cb.closest('[data-id]');
      var id = Number(card && card.dataset.id);
      if (!id) return;
      if (cb.checked) STATE.selected.add(id);
      else STATE.selected.delete(id);
      card.classList.toggle('is-selected', cb.checked);
      renderBulk();
    });
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-v30-sc-select]') || e.target.closest('a') || e.target.closest('button')) return;
      // Désactivé : pas de toggle au clic du card, uniquement checkbox (évite conflit avec lien avatar/nom)
    });
  }

  // ─── View switch ─────────────────────────────────────────
  function bindViewSwitch() {
    var seg = $('[data-v30-sc-view]');
    if (!seg) return;
    seg.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-view]');
      if (!btn) return;
      var v = btn.dataset.view;
      seg.querySelectorAll('button[data-view]').forEach(function (b) {
        var active = (b === btn);
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      document.querySelectorAll('[data-v30-sc-panel]').forEach(function (p) {
        p.hidden = (p.dataset.v30ScPanel !== v);
      });
      if (v === 'grid') renderGrid();
      if (v === 'inmails') loadInmails();
    });
  }

  // ─── Search ──────────────────────────────────────────────
  function bindSearch() {
    var input = $('[data-v30-sc-search]');
    if (!input) return;
    var t = null;
    input.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () { STATE.q = input.value; applyFilter(); }, 150);
    });
  }

  // ─── Add ─────────────────────────────────────────────────
  function bindAdd() {
    var btn = $('[data-v30-sc-add]');
    if (btn) btn.addEventListener('click', function () { openModal(getModal('sc-add')); });
    var save = $('[data-v30-sc-add-save]');
    if (save) save.addEventListener('click', function () {
      var val = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
      var name = val('v30-sc-add-name');
      if (!name) { toast('Le nom est obligatoire', 'warning'); return; }
      var skillsRaw = val('v30-sc-add-skills');
      var skills = skillsRaw ? skillsRaw.split(',').map(function (t) { return t.trim(); }).filter(Boolean) : [];
      var payload = {
        name: name,
        role: val('v30-sc-add-role'),
        seniority: val('v30-sc-add-seniority'),
        location: val('v30-sc-add-location'),
        email: val('v30-sc-add-email'),
        phone: val('v30-sc-add-phone'),
        linkedin: val('v30-sc-add-linkedin'),
        status: val('v30-sc-add-status') || 'Vivier',
        source: val('v30-sc-add-source'),
        notes: val('v30-sc-add-notes'),
        skills: skills,
        tech: skills.join(', ')
      };
      save.disabled = true;
      fetchPost('/api/candidates/save', payload)
        .then(function (res) {
          if (!res || !res.ok) throw new Error((res && res.error) || 'Erreur');
          toast('Candidat ajouté', 'success');
          closeModal(getModal('sc-add'));
          ['v30-sc-add-name','v30-sc-add-role','v30-sc-add-seniority','v30-sc-add-location',
           'v30-sc-add-email','v30-sc-add-phone','v30-sc-add-linkedin','v30-sc-add-source',
           'v30-sc-add-notes','v30-sc-add-skills']
            .forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ''; });
          reload();
        })
        .catch(function (e) { toast('Erreur : ' + e.message, 'error'); })
        .then(function () { save.disabled = false; });
    });
  }

  // ─── Filters ─────────────────────────────────────────────
  function bindFilters() {
    var btn = $('[data-v30-sc-filters]');
    if (btn) btn.addEventListener('click', function () {
      var m = getModal('sc-filters');
      var F = STATE.filters;
      m.querySelectorAll('[data-v30-sc-flt-status] input[type=checkbox]').forEach(function (cb) {
        cb.checked = F.statuts.indexOf(cb.value) >= 0;
      });
      (m.querySelector('[data-v30-sc-flt-skills]') || {}).value = (F.skills || []).join(', ');
      (m.querySelector('[data-v30-sc-flt-location]') || {}).value = F.location || '';
      openModal(m);
    });
    var apply = $('[data-v30-sc-flt-apply]');
    if (apply) apply.addEventListener('click', function () {
      var m = getModal('sc-filters');
      var statuts = [];
      m.querySelectorAll('[data-v30-sc-flt-status] input[type=checkbox]:checked').forEach(function (cb) { statuts.push(cb.value); });
      var skillsRaw = (m.querySelector('[data-v30-sc-flt-skills]') || {}).value || '';
      var skills = skillsRaw.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
      STATE.filters = {
        statuts: statuts,
        skills: skills,
        location: (m.querySelector('[data-v30-sc-flt-location]') || {}).value || ''
      };
      updateFilterBadge();
      closeModal(m);
      applyFilter();
    });
    var reset = $('[data-v30-sc-flt-reset]');
    if (reset) reset.addEventListener('click', function () {
      STATE.filters = { statuts: [], skills: [], location: '' };
      updateFilterBadge();
      closeModal(getModal('sc-filters'));
      applyFilter();
    });
  }

  // ─── Bulk ────────────────────────────────────────────────
  function bindBulk() {
    var bar = $('[data-v30-sc-bulk]');
    if (!bar) return;
    bar.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;
      var ids = Array.from(STATE.selected);
      if (action === 'clear') {
        STATE.selected.clear();
        applyFilter();
        renderBulk();
        return;
      }
      if (!ids.length) { toast('Aucune sélection', 'warning'); return; }
      if (action === 'status') {
        var m = getModal('sc-bulk');
        var n = m.querySelector('[data-v30-sc-bulk-n]');
        if (n) n.textContent = ids.length;
        openModal(m);
      } else if (action === 'delete') {
        if (!confirm('Supprimer ' + ids.length + ' candidat(s) ?')) return;
        var done = 0, errors = 0, i = 0;
        function next() {
          if (i >= ids.length) {
            toast(done + ' supprimé(s)' + (errors ? ', ' + errors + ' erreur(s)' : ''), errors ? 'warning' : 'success');
            STATE.selected.clear();
            reload();
            return;
          }
          fetchPost('/api/candidates/delete', { id: ids[i] })
            .then(function () { done++; })
            .catch(function () { errors++; })
            .then(function () { i++; next(); });
        }
        next();
      }
    });
    var apply = $('[data-v30-sc-bulk-apply]');
    if (apply) apply.addEventListener('click', function () {
      var ids = Array.from(STATE.selected);
      var val = ($('#v30-sc-bulk-val') || {}).value || 'Vivier';
      apply.disabled = true;
      fetchPost('/api/candidates/bulk-update', { ids: ids, field: 'status', value: val })
        .then(function (res) {
          if (!res || !res.ok) throw new Error((res && res.error) || 'Erreur');
          toast(ids.length + ' candidat(s) mis à jour', 'success');
          closeModal(getModal('sc-bulk'));
          STATE.selected.clear();
          reload();
        })
        .catch(function (e) { toast('Erreur : ' + e.message, 'error'); })
        .then(function () { apply.disabled = false; });
    });
  }

  function bindMatchClose() {
    var btn = $('[data-v30-sc-match-close]');
    var banner = $('[data-v30-sc-match]');
    if (btn && banner) btn.addEventListener('click', function () { banner.hidden = true; });
  }

  // ─── InMails LinkedIn ────────────────────────────────────
  function loadInmails() {
    var list = $('[data-inmails-list]');
    if (!list) return;
    list.innerHTML = '<div class="empty" style="padding:24px 0;text-align:center;color:var(--text-3);">Chargement…</div>';
    fetchJSON('/api/linkedin-inmails').then(function (res) {
      var entries = (res && res.entries) || [];
      var countEl = $('[data-inmails-count]');
      if (countEl) countEl.textContent = entries.length;
      if (!entries.length) {
        list.innerHTML = '<div class="empty v30-inmails__empty">Aucun InMail enregistré. Ajoute le premier ci-dessus !</div>';
        return;
      }
      list.innerHTML = entries.map(function (e) {
        var domain = '';
        try { domain = new URL(e.url).hostname.replace('www.', ''); } catch (_) { domain = e.url; }
        return '<div class="v30-inmails__item" data-inmail-id="' + esc(e.id) + '">' +
          '<div class="v30-inmails__item-main">' +
            '<a class="v30-inmails__item-url" href="' + esc(e.url) + '" target="_blank" rel="noopener">' + esc(domain) + '</a>' +
            (e.note ? '<span class="v30-inmails__item-note">' + esc(e.note) + '</span>' : '') +
          '</div>' +
          '<span class="v30-inmails__item-date">' + esc(e.sent_at) + '</span>' +
          '<button type="button" class="btn btn-ghost btn-sm btn-icon v30-inmails__item-del" data-del="' + esc(e.id) + '" aria-label="Supprimer">' +
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>' +
          '</button>' +
        '</div>';
      }).join('');
    }).catch(function () {
      list.innerHTML = '<div class="empty" style="color:var(--danger);padding:16px 0;">Erreur de chargement.</div>';
    });
  }

  function bindInmails() {
    var submitBtn = $('[data-inmails-submit]');
    var list = $('[data-inmails-list]');
    if (submitBtn) {
      submitBtn.addEventListener('click', function () {
        var urlInput = $('[data-inmails-url]');
        var noteInput = $('[data-inmails-note]');
        var url = urlInput ? urlInput.value.trim() : '';
        if (!url) { toast('URL manquante', 'warning'); return; }
        submitBtn.disabled = true;
        fetchPost('/api/linkedin-inmails', { url: url, note: noteInput ? noteInput.value.trim() : '' })
          .then(function (res) {
            if (!res || !res.ok) throw new Error((res && res.error) || 'Erreur');
            if (urlInput) urlInput.value = '';
            if (noteInput) noteInput.value = '';
            toast('InMail enregistré ✓', 'success');
            loadInmails();
          })
          .catch(function (e) { toast('Erreur : ' + e.message, 'error'); })
          .then(function () { submitBtn.disabled = false; });
      });
    }
    if (list) {
      list.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-del]');
        if (!btn) return;
        var id = btn.dataset.del;
        btn.disabled = true;
        fetchJSON('/api/linkedin-inmails/' + id, { method: 'DELETE' })
          .then(function (res) {
            if (!res || !res.ok) throw new Error((res && res.error) || 'Erreur');
            toast('Supprimé', 'success');
            loadInmails();
          })
          .catch(function (e) { toast('Erreur : ' + e.message, 'error'); btn.disabled = false; });
      });
    }
  }

  function switchToView(v) {
    var seg = $('[data-v30-sc-view]');
    if (!seg) return;
    seg.querySelectorAll('button[data-view]').forEach(function (b) {
      var active = b.dataset.view === v;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('[data-v30-sc-panel]').forEach(function (p) {
      p.hidden = (p.dataset.v30ScPanel !== v);
    });
    if (v === 'grid') renderGrid();
    if (v === 'inmails') loadInmails();
  }

  // ─── Orchestration ───────────────────────────────────────
  function reload() {
    return fetchJSON('/api/candidates').then(function (res) {
      var list = Array.isArray(res) ? res : ((res && (res.candidates || res.items)) || []);
      STATE.candidates = list.filter(function (c) { return !c.is_archived && !c.deleted_at; });
      STATE.selected.clear();
      applyFilter();
      renderBulk();
    }).catch(function (err) {
      console.error('[v30 sourcing] /api/candidates failed:', err);
      var host = $('[data-v30-sc-kanban]');
      if (host) host.innerHTML = '<div class="empty" style="grid-column:1/-1;padding:40px;">Erreur de chargement.</div>';
    });
  }

  function init() {
    bindModalDismiss();
    bindViewSwitch();
    bindSearch();
    bindAdd();
    bindFilters();
    bindBulk();
    bindSelection();
    bindMatchClose();
    bindInmails();
    reload().then(function () {
      if (window.location.hash === '#inmails') {
        switchToView('inmails');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
