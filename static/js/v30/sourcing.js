/* ProspUp v30 — Sourcing : fetch candidats, kanban par status + grille + CRUD */
(function () {
  'use strict';

  var COLS = [
    { key: 'ec1',               title: 'EC1',         primary: 'ec1',               color: 'var(--info)',          statuses: ['ec1', 'EC1', 'entretien', 'En entretien', 'Entretien', 'a_faire', 'nouveau', 'proposition', 'Vivier', 'vivier', 'Actif', 'Qualifié', 'qualifie', 'Proposé', 'propose', 'Contacté', 'contacted', null, ''] },
    { key: 'oksi',              title: 'OKSI',        primary: 'oksi',              color: 'var(--accent)',        statuses: ['oksi', 'OKSI', 'Solide', 'interesse'] },
    { key: 'top_profil',        title: 'Top Profils', primary: 'top_profil',        color: 'oklch(0.50 0.15 280)', statuses: ['top_profil', 'top profil', 'Top Profils'] },
    { key: 'reunion_tech',      title: 'RT',          primary: 'reunion_tech',      color: 'oklch(0.50 0.14 75)',  statuses: ['reunion_tech', 'RT', 'reunion tech', 'valide_contrat', 'embauche'] },
    { key: 'freelance_mission', title: 'En mission',  primary: 'freelance_mission', color: 'var(--success)',       statuses: ['freelance_mission', 'en mission', 'mission', 'freelance', 'Placé', 'place', 'Placed'] },
    { key: 'nok',               title: 'Nok',         primary: 'nok',               color: 'var(--danger)',        statuses: ['nok', 'NOK', 'nok_prequal', 'refuse', 'refus_contrat'] },
    { key: 'plus_disponible',   title: 'Plus dispo',  primary: 'plus_disponible',   color: 'oklch(0.50 0.00 0)',   statuses: ['plus_disponible', 'plus_dispo', 'hors_aura', 'archive'] }
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
  function colForStatus(statut) { return COLS[findColForStatus(statut)]; }
  function statusLabel(statut) { return colForStatus(statut).title; }
  function statusKey(statut) { return colForStatus(statut).key; }
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
  var KEBAB_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/></svg>';
  var MAIL_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>';
  var PHONE_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.86 19.86 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.86 19.86 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
  var LINKEDIN_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 0h-14C2.24 0 0 2.24 0 5v14c0 2.76 2.24 5 5 5h14c2.76 0 5-2.24 5-5V5c0-2.76-2.24-5-5-5zM8 19H5V8h3v11zM6.5 6.7c-1 0-1.7-.7-1.7-1.6s.7-1.6 1.8-1.6 1.7.7 1.7 1.6-.7 1.6-1.8 1.6zM20 19h-3v-5.6c0-1.5-.6-2.4-1.8-2.4-1 0-1.5.7-1.8 1.4-.1.2-.1.6-.1.9V19h-3V8h3v1.3c.4-.6 1.1-1.5 2.6-1.5 1.9 0 3.1 1.2 3.1 3.7V19z"/></svg>';

  function renderStatusPill(c) {
    var col = colForStatus(c.status);
    return '<button type="button" class="v30-sc-pill" data-action="status" data-id="' + c.id + '" '
      + 'style="--pill-color:' + col.color + ';" title="Changer de statut">'
      + '<span class="v30-sc-pill__dot"></span>'
      + esc(col.title)
      + '</button>';
  }

  function renderContactRow(c) {
    var parts = [];
    if (c.email) parts.push('<a class="v30-sc-card__link" href="mailto:' + esc(c.email) + '" title="' + esc(c.email) + '" onclick="event.stopPropagation();">' + MAIL_SVG + '</a>');
    if (c.phone || c.telephone) {
      var phone = c.phone || c.telephone;
      parts.push('<a class="v30-sc-card__link" href="tel:' + esc(phone) + '" title="' + esc(phone) + '" onclick="event.stopPropagation();">' + PHONE_SVG + '</a>');
    }
    if (c.linkedin) parts.push('<a class="v30-sc-card__link" href="' + esc(c.linkedin) + '" target="_blank" rel="noopener" title="LinkedIn" onclick="event.stopPropagation();">' + LINKEDIN_SVG + '</a>');
    if (!parts.length) return '';
    return '<div class="v30-sc-card__contacts">' + parts.join('') + '</div>';
  }

  function renderCard(c) {
    var skills = parseSkills(c.skills || c.tech);
    var shown = skills.slice(0, 3);
    var extra = skills.length - 3;
    var role = c.titre || c.role || c.seniority || c.domaine_principal || '—';
    var location = c.location || '';
    var sel = STATE.selected.has(c.id);
    var key = statusKey(c.status);
    return '<div class="v30-sc-card v30-sc-card--' + esc(key) + (sel ? ' is-selected' : '') + '" data-id="' + c.id + '" data-kcard-id="' + c.id + '" data-kcard-status="' + esc(c.status || '') + '" draggable="true">' +
      '<div class="v30-sc-card__head">' +
        '<input type="checkbox" data-v30-sc-select' + (sel ? ' checked' : '') + ' aria-label="Sélectionner">' +
        '<a href="/v30/candidat/' + c.id + '" class="avatar" title="Voir fiche" draggable="false">' + esc(initials(c.name)) + '</a>' +
        '<div class="v30-sc-card__title">' +
          '<a href="/v30/candidat/' + c.id + '" draggable="false">' +
            '<div class="v30-sc-card__name truncate">' + esc(c.name || '—') + '</div>' +
            '<div class="v30-sc-card__role truncate">' + esc(role) + '</div>' +
          '</a>' +
        '</div>' +
        '<button type="button" class="v30-sc-card__kebab" data-action="menu" data-id="' + c.id + '" aria-label="Actions" title="Actions">' + KEBAB_SVG + '</button>' +
      '</div>' +
      (shown.length
        ? '<div class="v30-sc-card__skills">' +
            shown.map(function (s) { return '<span class="badge">' + esc(s) + '</span>'; }).join('') +
            (extra > 0 ? '<span class="badge muted">+' + extra + '</span>' : '') +
          '</div>'
        : '') +
      '<div class="v30-sc-card__foot">' +
        renderStatusPill(c) +
        (location
          ? '<span class="v30-sc-card__meta">' +
              '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="10" r="3"/><path d="M12 21s7-7 7-12a7 7 0 0 0-14 0c0 5 7 12 7 12z"/></svg>' +
              esc(location) +
            '</span>'
          : '') +
        renderContactRow(c) +
      '</div>' +
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
        ? '<button type="button" class="v30-sc-col__empty" data-action="add-here" data-status="' + col.primary + '" data-status-label="' + esc(col.title) + '">'
            + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
            + '<span>Ajouter dans ' + esc(col.title) + '</span>'
          + '</button>'
        : items.map(renderCard).join('');
      return '<div class="v30-sc-col" data-kcol-idx="' + i + '" data-kcol-status="' + col.key + '" style="--col-color:' + col.color + ';">' +
        '<div class="v30-sc-col__head">' +
          '<span class="v30-sc-col__dot"></span>' +
          '<span class="v30-sc-col__title">' + esc(col.title) + '</span>' +
          '<span class="v30-sc-col__count num">' + items.length + '</span>' +
          '<div class="v30-spacer"></div>' +
          '<button type="button" class="v30-sc-col__add" data-action="add-here" data-status="' + col.primary + '" data-status-label="' + esc(col.title) + '" aria-label="Ajouter un candidat dans ' + esc(col.title) + '" title="Ajouter dans ' + esc(col.title) + '">'
            + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
          + '</button>' +
        '</div>' + body +
      '</div>';
    }).join('');
    bindDndAfterRender(host);
  }

  function renderGrid() {
    var host = $('[data-v30-sc-grid]');
    if (!host) return;
    if (STATE.filtered.length === 0) {
      host.innerHTML = '<div class="empty" style="grid-column:1/-1;padding:20px;">Aucun candidat pour ces filtres.</div>';
      return;
    }
    host.innerHTML = STATE.filtered.map(function (c) {
      var skills = parseSkills(c.skills || c.tech);
      var shown = skills.slice(0, 4);
      var extra = skills.length - 4;
      var sel = STATE.selected.has(c.id);
      var key = statusKey(c.status);
      var role = c.titre || c.role || c.seniority || c.domaine_principal || '—';
      return '<div class="v30-sc-card v30-sc-card--grid v30-sc-card--' + esc(key) + (sel ? ' is-selected' : '') + '" data-id="' + c.id + '">' +
        '<div class="v30-sc-card__head">' +
          '<input type="checkbox" data-v30-sc-select' + (sel ? ' checked' : '') + ' aria-label="Sélectionner">' +
          '<a href="/v30/candidat/' + c.id + '" class="avatar avatar-md" title="Voir fiche">' + esc(initials(c.name)) + '</a>' +
          '<div class="v30-sc-card__title">' +
            '<a href="/v30/candidat/' + c.id + '">' +
              '<div class="v30-sc-card__name truncate">' + esc(c.name || '—') + '</div>' +
              '<div class="v30-sc-card__role truncate">' + esc(role) + '</div>' +
            '</a>' +
          '</div>' +
          '<button type="button" class="v30-sc-card__kebab" data-action="menu" data-id="' + c.id + '" aria-label="Actions" title="Actions">' + KEBAB_SVG + '</button>' +
        '</div>' +
        (shown.length
          ? '<div class="v30-sc-card__skills">' +
              shown.map(function (s) { return '<span class="badge">' + esc(s) + '</span>'; }).join('') +
              (extra > 0 ? '<span class="badge muted">+' + extra + '</span>' : '') +
            '</div>'
          : '') +
        '<div class="v30-sc-card__foot">' +
          renderStatusPill(c) +
          (c.location
            ? '<span class="v30-sc-card__meta">' +
                '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="10" r="3"/><path d="M12 21s7-7 7-12a7 7 0 0 0-14 0c0 5 7 12 7 12z"/></svg>' +
                esc(c.location) +
              '</span>'
            : '') +
          renderContactRow(c) +
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
  }

  // ─── Quick status change + card menu popover ────────────
  var POP = null;
  function closePop() {
    if (POP && POP.parentNode) POP.parentNode.removeChild(POP);
    POP = null;
    document.removeEventListener('click', onDocClickClosePop, true);
    document.removeEventListener('keydown', onKeyClosePop, true);
    window.removeEventListener('scroll', closePop, true);
    window.removeEventListener('resize', closePop, true);
  }
  function onDocClickClosePop(e) {
    if (POP && POP.contains(e.target)) return;
    closePop();
  }
  function onKeyClosePop(e) { if (e.key === 'Escape') closePop(); }

  function openPop(anchor, html) {
    closePop();
    var pop = document.createElement('div');
    pop.className = 'v30-sc-pop';
    pop.innerHTML = html;
    document.body.appendChild(pop);
    var r = anchor.getBoundingClientRect();
    var pw = pop.offsetWidth;
    var ph = pop.offsetHeight;
    var left = Math.max(8, Math.min(r.left, window.innerWidth - pw - 8));
    var top = r.bottom + 6;
    if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
    POP = pop;
    setTimeout(function () {
      document.addEventListener('click', onDocClickClosePop, true);
      document.addEventListener('keydown', onKeyClosePop, true);
      window.addEventListener('scroll', closePop, true);
      window.addEventListener('resize', closePop, true);
    }, 0);
  }

  function quickStatusChange(id, newStatus) {
    var cand = STATE.candidates.find(function (c) { return c.id === id; });
    if (!cand) return;
    if (cand.status === newStatus) return;
    var oldStatus = cand.status;
    cand.status = newStatus;
    applyFilter();
    fetchPost('/api/candidates/bulk-update', { ids: [id], field: 'status', value: newStatus })
      .then(function (res) {
        if (!res || !res.ok) throw new Error((res && res.error) || 'Erreur');
        toast('Statut mis à jour', 'success');
      })
      .catch(function (err) {
        cand.status = oldStatus;
        applyFilter();
        toast('Erreur : ' + err.message, 'error');
      });
  }

  function openStatusPop(anchor, id) {
    var cand = STATE.candidates.find(function (c) { return c.id === id; });
    var current = cand ? statusKey(cand.status) : '';
    var html = '<div class="v30-sc-pop__title">Changer de statut</div>'
      + '<div class="v30-sc-pop__list">'
      + COLS.map(function (col) {
          var active = col.key === current;
          return '<button type="button" class="v30-sc-pop__item' + (active ? ' is-active' : '') + '" '
            + 'data-pop-status="' + esc(col.primary) + '" style="--pill-color:' + col.color + ';">'
            + '<span class="v30-sc-pop__dot"></span>'
            + esc(col.title)
            + (active ? '<span class="v30-sc-pop__check">✓</span>' : '')
            + '</button>';
        }).join('')
      + '</div>';
    openPop(anchor, html);
    if (POP) POP.addEventListener('click', function (e) {
      var b = e.target.closest('[data-pop-status]');
      if (!b) return;
      quickStatusChange(id, b.dataset.popStatus);
      closePop();
    });
  }

  function openCardMenu(anchor, id) {
    var html = '<div class="v30-sc-pop__list">'
      + '<a class="v30-sc-pop__item" href="/v30/candidat/' + id + '">'
      +   '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>'
      +   ' Ouvrir la fiche'
      + '</a>'
      + '<button type="button" class="v30-sc-pop__item" data-menu-action="status">'
      +   '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>'
      +   ' Changer de statut'
      + '</button>'
      + '<button type="button" class="v30-sc-pop__item" data-menu-action="select">'
      +   '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
      +   ' Ajouter à la sélection'
      + '</button>'
      + '<div class="v30-sc-pop__sep"></div>'
      + '<button type="button" class="v30-sc-pop__item v30-sc-pop__item--danger" data-menu-action="delete">'
      +   '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>'
      +   ' Supprimer'
      + '</button>'
      + '</div>';
    openPop(anchor, html);
    if (POP) POP.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-menu-action]');
      if (!btn) return;
      var action = btn.dataset.menuAction;
      var anchorEl = anchor;
      closePop();
      if (action === 'status') {
        openStatusPop(anchorEl, id);
      } else if (action === 'select') {
        STATE.selected.add(id);
        var cb = document.querySelector('[data-id="' + id + '"] [data-v30-sc-select]');
        if (cb) cb.checked = true;
        var card = document.querySelector('[data-id="' + id + '"]');
        if (card) card.classList.add('is-selected');
        renderBulk();
      } else if (action === 'delete') {
        if (!confirm('Supprimer ce candidat ?')) return;
        fetchPost('/api/candidates/delete', { id: id })
          .then(function (res) {
            if (!res || !res.ok) throw new Error((res && res.error) || 'Erreur');
            toast('Candidat supprimé', 'success');
            reload();
          })
          .catch(function (err) { toast('Erreur : ' + err.message, 'error'); });
      }
    });
  }

  function openAddInColumn(statusKey, statusLabel) {
    var m = getModal('sc-add');
    if (!m) return;
    var sel = document.getElementById('v30-sc-add-status');
    if (sel) {
      var found = false;
      for (var i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === statusKey) { sel.selectedIndex = i; found = true; break; }
      }
      if (!found && statusKey) {
        var opt = document.createElement('option');
        opt.value = statusKey;
        opt.textContent = statusLabel || statusKey;
        sel.appendChild(opt);
        sel.value = statusKey;
      }
    }
    openModal(m);
  }

  function bindCardActions() {
    document.addEventListener('click', function (e) {
      // Status pill (inside card foot)
      var pill = e.target.closest('[data-action="status"]');
      if (pill && pill.classList.contains('v30-sc-pill')) {
        e.preventDefault();
        e.stopPropagation();
        openStatusPop(pill, Number(pill.dataset.id));
        return;
      }
      // Kebab menu
      var kebab = e.target.closest('[data-action="menu"]');
      if (kebab) {
        e.preventDefault();
        e.stopPropagation();
        openCardMenu(kebab, Number(kebab.dataset.id));
        return;
      }
      // Empty-column "Add here" / column "+" header
      var addHere = e.target.closest('[data-action="add-here"]');
      if (addHere) {
        e.preventDefault();
        openAddInColumn(addHere.dataset.status, addHere.dataset.statusLabel);
        return;
      }
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
        status: val('v30-sc-add-status') || 'ec1',
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
      var val = ($('#v30-sc-bulk-val') || {}).value || 'ec1';
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

  // ─── Kanban Drag & Drop ──────────────────────────────────
  var KANBAN_DND = { dragId: null, fromIdx: null };

  function bindDndAfterRender(host) {
    host.querySelectorAll('[data-kcard-id]').forEach(function (card) {
      card.addEventListener('dragstart', function (e) {
        KANBAN_DND.dragId = Number(card.dataset.kcardId);
        KANBAN_DND.fromIdx = findColForStatus(card.dataset.kcardStatus);
        setTimeout(function () { card.classList.add('is-dragging'); }, 0);
        e.dataTransfer.effectAllowed = 'move';
      });
      card.addEventListener('dragend', function () {
        card.classList.remove('is-dragging');
        host.querySelectorAll('.v30-sc-col.is-drop-target').forEach(function (c) {
          c.classList.remove('is-drop-target');
        });
      });
    });

    host.querySelectorAll('.v30-sc-col[data-kcol-idx]').forEach(function (col) {
      col.addEventListener('dragover', function (e) {
        e.preventDefault();
        host.querySelectorAll('.v30-sc-col.is-drop-target').forEach(function (c) {
          c.classList.remove('is-drop-target');
        });
        col.classList.add('is-drop-target');
        e.dataTransfer.dropEffect = 'move';
      });
      col.addEventListener('dragleave', function (e) {
        if (!col.contains(e.relatedTarget)) col.classList.remove('is-drop-target');
      });
      col.addEventListener('drop', function (e) {
        e.preventDefault();
        col.classList.remove('is-drop-target');
        var toIdx = Number(col.dataset.kcolIdx);
        var id = KANBAN_DND.dragId;
        if (!id || toIdx === KANBAN_DND.fromIdx) return;
        var newStatus = COLS[toIdx].primary;
        var cand = STATE.candidates.find(function (c) { return c.id === id; });
        if (!cand) return;
        var oldStatus = cand.status;
        cand.status = newStatus;
        applyFilter();
        fetchPost('/api/candidates/bulk-update', { ids: [id], field: 'status', value: newStatus })
          .then(function (res) {
            if (!res || !res.ok) throw new Error((res && res.error) || 'Erreur');
            toast('Statut mis à jour', 'success');
          })
          .catch(function (err) {
            cand.status = oldStatus;
            applyFilter();
            toast('Erreur : ' + err.message, 'error');
          });
      });
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
        var displayName = e.name || domain;
        return '<div class="v30-inmails__item" data-inmail-id="' + esc(e.id) + '">' +
          '<div class="v30-inmails__item-main">' +
            '<span class="v30-inmails__name-wrap">' +
              '<a class="v30-inmails__item-url" href="' + esc(e.url) + '" target="_blank" rel="noopener">' + esc(displayName) + '</a>' +
              '<button type="button" class="btn btn-ghost btn-sm btn-icon v30-inmails__name-edit" data-edit="' + esc(e.id) + '" data-href="' + esc(e.url) + '" data-name="' + esc(displayName) + '" aria-label="Modifier le nom" title="Modifier le nom">' +
                '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
              '</button>' +
            '</span>' +
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
        // Supprimer
        var delBtn = e.target.closest('[data-del]');
        if (delBtn) {
          var id = delBtn.dataset.del;
          delBtn.disabled = true;
          fetchJSON('/api/linkedin-inmails/' + id, { method: 'DELETE' })
            .then(function (res) {
              if (!res || !res.ok) throw new Error((res && res.error) || 'Erreur');
              toast('Supprimé', 'success');
              loadInmails();
            })
            .catch(function (e) { toast('Erreur : ' + e.message, 'error'); delBtn.disabled = false; });
          return;
        }
        // Ouvrir édition
        var editBtn = e.target.closest('[data-edit]');
        if (editBtn) {
          var id = editBtn.dataset.edit;
          var currentName = editBtn.dataset.name;
          var wrap = editBtn.closest('.v30-inmails__name-wrap');
          wrap.innerHTML =
            '<input class="v30-inmails__name-input" type="text" value="' + esc(currentName) + '" data-editing-id="' + esc(id) + '" />' +
            '<button type="button" class="btn btn-sm v30-inmails__name-save" data-save-id="' + esc(id) + '" aria-label="Enregistrer">✓</button>' +
            '<button type="button" class="btn btn-ghost btn-sm v30-inmails__name-cancel" aria-label="Annuler">✕</button>';
          var inp = wrap.querySelector('input');
          if (inp) { inp.focus(); inp.select(); }
          return;
        }
        // Sauvegarder
        var saveBtn = e.target.closest('[data-save-id]');
        if (saveBtn) {
          var id = saveBtn.dataset.saveId;
          var inp = saveBtn.closest('.v30-inmails__name-wrap').querySelector('input');
          _saveInmailName(id, inp ? inp.value.trim() : '');
          return;
        }
        // Annuler
        if (e.target.closest('.v30-inmails__name-cancel')) {
          loadInmails();
        }
      });
      list.addEventListener('keydown', function (e) {
        var inp = e.target.closest('.v30-inmails__name-input');
        if (!inp) return;
        if (e.key === 'Enter') { e.preventDefault(); _saveInmailName(inp.dataset.editingId, inp.value.trim()); }
        if (e.key === 'Escape') { loadInmails(); }
      });
    }
  }

  function _saveInmailName(id, name) {
    fetchJSON('/api/linkedin-inmails/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name })
    }).then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || 'Erreur');
      loadInmails();
    }).catch(function (err) {
      toast('Erreur : ' + err.message, 'error');
      loadInmails();
    });
  }

  // ─── Import PDF/CV + Collage IA ──────────────────────────
  var IMPORT_STATE = {
    pdfFile: null,
    pdfFields: null,
    aiEntries: []
  };

  function importSwitchTab(tab) {
    var tabs = document.querySelectorAll('[data-v30-src-tabs] [data-v30-src-tab]');
    tabs.forEach(function (b) {
      var on = b.dataset.v30SrcTab === tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('[data-v30-src-panel]').forEach(function (p) {
      p.hidden = (p.dataset.v30SrcPanel !== tab);
    });
  }

  function openImportModal(initialTab) {
    var m = getModal('sc-import');
    if (!m) return;
    importResetPdf();
    var ta = $('[data-v30-src-ai-json]');
    if (ta) ta.value = '';
    var res = $('[data-v30-src-ai-result]');
    if (res) { res.hidden = true; res.innerHTML = ''; }
    importSwitchTab(initialTab || 'pdf');
    openModal(m);
  }

  function importResetPdf() {
    IMPORT_STATE.pdfFile = null;
    IMPORT_STATE.pdfFields = null;
    var input = $('[data-v30-src-pdf-file]');
    if (input) input.value = '';
    var name = $('[data-v30-src-pdf-filename]');
    if (name) { name.hidden = true; name.textContent = ''; }
    var run = $('[data-v30-src-pdf-run]');
    if (run) { run.disabled = true; run.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5 5l3 3M16 16l3 3M5 19l3-3M16 8l3-3"/></svg> Analyser le PDF'; }
    var reset = $('[data-v30-src-pdf-reset]');
    if (reset) reset.hidden = true;
    var result = $('[data-v30-src-pdf-result]');
    if (result) { result.hidden = true; result.innerHTML = ''; }
    var drop = $('[data-v30-src-drop]');
    if (drop) drop.classList.remove('is-dragging');
  }

  function setPdfFile(f) {
    if (!f) return;
    if (!/\.pdf$/i.test(f.name)) {
      toast('Seuls les PDF sont acceptés', 'warning');
      return;
    }
    IMPORT_STATE.pdfFile = f;
    var name = $('[data-v30-src-pdf-filename]');
    if (name) {
      name.textContent = f.name + ' (' + Math.round(f.size / 1024) + ' Ko)';
      name.hidden = false;
    }
    var run = $('[data-v30-src-pdf-run]');
    if (run) run.disabled = false;
    var reset = $('[data-v30-src-pdf-reset]');
    if (reset) reset.hidden = false;
  }

  function renderPdfResult(fields) {
    var host = $('[data-v30-src-pdf-result]');
    if (!host) return;
    IMPORT_STATE.pdfFields = fields || {};
    var tags = Array.isArray(fields.tags) ? fields.tags.join(', ') : (fields.tags || '');
    host.innerHTML =
      '<h4>Résultat de l\'analyse</h4>' +
      '<dl class="v30-src-pdf-result__fields">' +
        '<div><dt>Nom</dt><dd>' + esc(fields.name || '—') + '</dd></div>' +
        '<div><dt>Prénom</dt><dd>' + esc(fields.prenom || '—') + '</dd></div>' +
        '<div><dt>Titre</dt><dd>' + esc(fields.titre || '—') + '</dd></div>' +
        '<div><dt>Rôle</dt><dd>' + esc(fields.role || '—') + '</dd></div>' +
        '<div><dt>Années XP</dt><dd>' + esc(fields.annees_experience != null ? fields.annees_experience : '—') + '</dd></div>' +
        '<div><dt>Domaine</dt><dd>' + esc(fields.domaine_principal || '—') + '</dd></div>' +
        '<div style="grid-column:1/-1;"><dt>Compétences</dt><dd>' + esc(tags || '—') + '</dd></div>' +
      '</dl>' +
      '<div class="v30-src-pdf-result__actions">' +
        '<button type="button" class="btn btn-primary btn-sm" data-v30-src-pdf-create>Créer le candidat</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-v30-src-pdf-edit>Modifier avant création</button>' +
      '</div>';
    host.hidden = false;
  }

  function runPdfAnalyze() {
    var f = IMPORT_STATE.pdfFile;
    if (!f) { toast('Sélectionne un PDF', 'warning'); return; }
    var btn = $('[data-v30-src-pdf-run]');
    if (!btn) return;
    var orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = 'Extraction IA en cours…';

    var fd = new FormData();
    fd.append('dc', f);

    fetch('/api/candidates/extract-dc', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' },
      body: fd
    })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (out) {
        if (out.status >= 200 && out.status < 300 && out.body && out.body.ok) {
          renderPdfResult(out.body.fields || {});
          toast('Analyse IA réussie', 'success');
        } else {
          var msg = (out.body && out.body.error) || ('HTTP ' + out.status);
          toast('IA indisponible — création manuelle possible (' + msg + ')', 'warning');
          renderPdfResult({}); // onglet de repli en saisie manuelle
        }
      })
      .catch(function (e) {
        toast('Erreur réseau : ' + (e && e.message ? e.message : 'inconnue'), 'error');
      })
      .then(function () {
        btn.disabled = false;
        btn.innerHTML = orig;
      });
  }

  function createCandidateFromPdf() {
    var f = IMPORT_STATE.pdfFields || {};
    var name = (f.name || '').trim();
    if (!name) {
      toast('Nom manquant — utilise « Modifier avant création »', 'warning');
      return;
    }
    var tags = Array.isArray(f.tags) ? f.tags : (f.tags ? String(f.tags).split(',').map(function (x) { return x.trim(); }).filter(Boolean) : []);
    var payload = {
      name: name,
      prenom: f.prenom || null,
      titre: f.titre || null,
      role: f.role || f.titre || null,
      annees_experience: (f.annees_experience != null && f.annees_experience !== '') ? f.annees_experience : null,
      domaine_principal: f.domaine_principal || null,
      skills: tags,
      tech: tags.join(', '),
      status: 'ec1',
      source: 'Import PDF/CV'
    };
    var btn = $('[data-v30-src-pdf-create]');
    if (btn) btn.disabled = true;

    fetchPost('/api/candidates/save', payload)
      .then(function (res) {
        if (!res || !res.ok || !res.id) throw new Error((res && res.error) || 'Erreur');
        var cid = res.id;
        toast('Candidat créé — upload du PDF en cours…', 'success');
        // Upload du DC sur le candidat créé
        if (IMPORT_STATE.pdfFile) {
          var fd = new FormData();
          fd.append('dc', IMPORT_STATE.pdfFile);
          fd.append('candidate_id', String(cid));
          return fetch('/api/candidates/upload-dc', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Accept': 'application/json' },
            body: fd
          }).then(function () { return cid; }, function () { return cid; });
        }
        return cid;
      })
      .then(function (cid) {
        closeModal(getModal('sc-import'));
        window.location.href = '/v30/candidat/' + cid;
      })
      .catch(function (e) {
        toast('Erreur : ' + e.message, 'error');
        if (btn) btn.disabled = false;
      });
  }

  function editBeforeCreateFromPdf() {
    var f = IMPORT_STATE.pdfFields || {};
    var tags = Array.isArray(f.tags) ? f.tags.join(', ') : (f.tags || '');
    closeModal(getModal('sc-import'));
    setTimeout(function () {
      var m = getModal('sc-add');
      if (!m) return;
      var nameEl = document.getElementById('v30-sc-add-name');
      var roleEl = document.getElementById('v30-sc-add-role');
      var skillsEl = document.getElementById('v30-sc-add-skills');
      var sourceEl = document.getElementById('v30-sc-add-source');
      var notesEl = document.getElementById('v30-sc-add-notes');
      if (nameEl) nameEl.value = f.name || '';
      if (roleEl) roleEl.value = f.role || f.titre || '';
      if (skillsEl) skillsEl.value = tags;
      if (sourceEl) sourceEl.value = 'Import PDF/CV';
      if (notesEl) {
        var meta = [];
        if (f.prenom) meta.push('Prénom: ' + f.prenom);
        if (f.titre) meta.push('Titre: ' + f.titre);
        if (f.annees_experience != null) meta.push(f.annees_experience + ' ans d\'expérience');
        if (f.domaine_principal) meta.push('Domaine: ' + f.domaine_principal);
        if (meta.length) notesEl.value = meta.join(' · ');
      }
      openModal(m);
    }, 180);
  }

  function bindImportPdf() {
    var drop = $('[data-v30-src-drop]');
    var input = $('[data-v30-src-pdf-file]');
    if (drop && input) {
      drop.addEventListener('click', function () { input.click(); });
      drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('is-dragging'); });
      drop.addEventListener('dragleave', function () { drop.classList.remove('is-dragging'); });
      drop.addEventListener('drop', function (e) {
        e.preventDefault();
        drop.classList.remove('is-dragging');
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) setPdfFile(f);
      });
      input.addEventListener('change', function () {
        var f = input.files && input.files[0];
        if (f) setPdfFile(f);
      });
    }
    var run = $('[data-v30-src-pdf-run]');
    if (run) run.addEventListener('click', runPdfAnalyze);
    var reset = $('[data-v30-src-pdf-reset]');
    if (reset) reset.addEventListener('click', importResetPdf);

    // Actions résultat (délégation, éléments créés dynamiquement)
    var resultHost = $('[data-v30-src-pdf-result]');
    if (resultHost) {
      resultHost.addEventListener('click', function (e) {
        if (e.target.closest('[data-v30-src-pdf-create]')) createCandidateFromPdf();
        else if (e.target.closest('[data-v30-src-pdf-edit]')) editBeforeCreateFromPdf();
      });
    }
  }

  // ─── Onglet IA (JSON) ──────────────────────────
  function parseAiJson(raw) {
    var text = String(raw || '').trim();
    if (!text) return { error: 'Colle un JSON.' };
    // Retirer les ``` éventuels
    text = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
    var parsed;
    try { parsed = JSON.parse(text); }
    catch (e) { return { error: 'JSON invalide : ' + e.message }; }
    var list = Array.isArray(parsed) ? parsed : [parsed];
    // Normaliser : clés fullName / full_name / Name → name
    var normalized = list.map(function (o) {
      if (!o || typeof o !== 'object') return null;
      var n = {};
      for (var k in o) { if (Object.prototype.hasOwnProperty.call(o, k)) n[k] = o[k]; }
      if (!n.name) n.name = n.fullName || n.full_name || n.Name || n.nom || '';
      return n;
    }).filter(function (o) { return o && String(o.name || '').trim(); });
    if (!normalized.length) return { error: 'Aucune entrée avec un nom trouvée.' };
    return { entries: normalized };
  }

  function renderAiPreview(entries, errorMsg) {
    var host = $('[data-v30-src-ai-result]');
    if (!host) return;
    if (errorMsg) {
      host.innerHTML = '<div class="v30-src-ai-preview__err">' + esc(errorMsg) + '</div>';
      host.hidden = false;
      IMPORT_STATE.aiEntries = [];
      return;
    }
    IMPORT_STATE.aiEntries = entries || [];
    host.innerHTML =
      '<h4>' + entries.length + ' candidat' + (entries.length > 1 ? 's' : '') + ' détecté' + (entries.length > 1 ? 's' : '') + '</h4>' +
      '<ul>' + entries.map(function (c) {
        var role = c.role || c.titre || c.position || c.poste || '';
        return '<li>' +
          '<span class="avatar">' + esc(initials(c.name)) + '</span>' +
          '<div style="flex:1;min-width:0;">' +
            '<div class="name truncate">' + esc(c.name) + '</div>' +
            (role ? '<div class="role truncate">' + esc(role) + '</div>' : '') +
          '</div>' +
        '</li>';
      }).join('') + '</ul>';
    host.hidden = false;
  }

  function runAiPreview() {
    var ta = $('[data-v30-src-ai-json]');
    var out = parseAiJson(ta ? ta.value : '');
    renderAiPreview(out.entries, out.error);
  }

  function aiEntryToPayload(c) {
    var skillsRaw = c.skills || c.tags || c.tech || c.competences || [];
    var skills = Array.isArray(skillsRaw)
      ? skillsRaw.filter(Boolean).map(function (s) { return String(s).trim(); })
      : String(skillsRaw).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var name = String(c.name || '').trim();
    return {
      name: name,
      role: c.role || c.titre || c.position || c.poste || null,
      titre: c.titre || null,
      prenom: c.prenom || null,
      seniority: c.seniority || c.niveau || null,
      location: c.location || c.lieu || c.ville || null,
      email: c.email || c.mail || null,
      phone: c.phone || c.tel || c.telephone || null,
      linkedin: c.linkedin || c.linkedIn || c.linkedin_url || null,
      status: c.status || c.statut || 'ec1',
      source: c.source || 'Import IA',
      notes: c.notes || c.comment || c.commentaire || null,
      skills: skills,
      tech: skills.join(', '),
      annees_experience: (c.annees_experience != null && c.annees_experience !== '') ? c.annees_experience
                         : (c.experience != null && c.experience !== '') ? c.experience : null,
      domaine_principal: c.domaine_principal || c.domain || c.domaine || null
    };
  }

  function runAiImport() {
    var ta = $('[data-v30-src-ai-json]');
    var out = parseAiJson(ta ? ta.value : '');
    if (out.error) { renderAiPreview(null, out.error); return; }
    var entries = out.entries;
    renderAiPreview(entries);
    var btn = $('[data-v30-src-ai-run]');
    if (btn) btn.disabled = true;

    var done = 0, errors = 0, i = 0, firstId = null;
    function next() {
      if (i >= entries.length) {
        if (btn) btn.disabled = false;
        toast(done + ' candidat(s) créé(s)' + (errors ? ', ' + errors + ' erreur(s)' : ''), errors ? 'warning' : 'success');
        closeModal(getModal('sc-import'));
        if (entries.length === 1 && firstId) {
          window.location.href = '/v30/candidat/' + firstId;
        } else {
          reload();
        }
        return;
      }
      fetchPost('/api/candidates/save', aiEntryToPayload(entries[i]))
        .then(function (res) {
          if (res && res.ok && res.id) { done++; if (firstId == null) firstId = res.id; }
          else errors++;
        })
        .catch(function () { errors++; })
        .then(function () { i++; next(); });
    }
    next();
  }

  function bindImport() {
    var btn = $('[data-v30-sc-import]');
    if (btn) btn.addEventListener('click', function () { openImportModal('pdf'); });
    // Lien depuis la modale "Add"
    document.addEventListener('click', function (e) {
      var link = e.target.closest('[data-v30-sc-open-import]');
      if (link) {
        e.preventDefault();
        closeModal(getModal('sc-add'));
        setTimeout(function () { openImportModal('pdf'); }, 180);
      }
    });
    // Tabs
    var tabsHost = $('[data-v30-src-tabs]');
    if (tabsHost) {
      tabsHost.addEventListener('click', function (e) {
        var b = e.target.closest('[data-v30-src-tab]');
        if (!b) return;
        importSwitchTab(b.dataset.v30SrcTab);
      });
    }
    bindImportPdf();
    // IA
    var prev = $('[data-v30-src-ai-preview]');
    if (prev) prev.addEventListener('click', runAiPreview);
    var runAi = $('[data-v30-src-ai-run]');
    if (runAi) runAi.addEventListener('click', runAiImport);
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
      var _nok_statuses = ['nok', 'NOK', 'nok_prequal', 'refuse', 'refus_contrat', 'plus_disponible', 'plus_dispo', 'hors_aura', 'archive'];
      STATE.candidates = list.filter(function (c) { return (!c.is_archived || _nok_statuses.indexOf(c.status) >= 0) && !c.deleted_at; });
      STATE.selected.clear();
      applyFilter();
      renderBulk();
    }).catch(function (err) {
      console.error('[v30 sourcing] /api/candidates failed:', err);
      var host = $('[data-v30-sc-kanban]');
      if (host) host.innerHTML = '<div class="empty" style="grid-column:1/-1;padding:40px;">Erreur de chargement.</div>';
    });
  }

  // ─── Keyboard shortcuts ──────────────────────────────────
  function bindShortcuts() {
    document.addEventListener('keydown', function (e) {
      var tag = (e.target && e.target.tagName) || '';
      var inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable);
      if (inField) return;
      // "/" focuses search
      if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        var input = $('[data-v30-sc-search]');
        if (input) { e.preventDefault(); input.focus(); input.select(); }
        return;
      }
      // Escape clears the selection
      if (e.key === 'Escape' && STATE.selected.size > 0) {
        STATE.selected.clear();
        applyFilter();
        renderBulk();
      }
    });
  }

  function bindSelectAll() {
    var bar = $('[data-v30-sc-bulk]');
    if (!bar) return;
    bar.addEventListener('click', function (e) {
      var sa = e.target.closest('[data-action="select-all"]');
      if (!sa) return;
      STATE.filtered.forEach(function (c) { STATE.selected.add(c.id); });
      applyFilter();
      renderBulk();
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
    bindCardActions();
    bindMatchClose();
    bindInmails();
    bindImport();
    bindShortcuts();
    bindSelectAll();
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
